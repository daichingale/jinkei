#!/usr/bin/env node
// Rust 版エンジンと web/engine.js の一致を確かめる。
//   node web/conformance.js [--keep-going] [filter]
// 比較: `jinkei json/model/fix`（CLI）と、`jinkei edit` のサーバ API（/api/compile, /api/fix）
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const engine = require('./engine.js');

const ROOT = path.resolve(__dirname, '..');
const BIN_SRC = path.join(ROOT, 'target/release/jinkei');
const TOL = 2e-3;
const filter = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && !/^--fuzz$/.test(arr[i - 1] || '') && !/^--fuzz$/.test(arr[i - 2] || ''))[0];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jk-conf-'));
const BIN = path.join(tmp, 'jinkei'); // 並行ビルドで差し替わっても影響を受けないようコピーして使う
fs.copyFileSync(BIN_SRC, BIN);
fs.chmodSync(BIN, 0o755);

function run(args) {
  const r = spawnSync(BIN, args, { encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 28 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// ---------------------------------------------------------------- 比較
const diffs = [];
function numClose(a, b, tol) {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}
/** 文字列中の数値の最後の桁の違いだけを許す */
function strClose(a, b) {
  if (a === b) return true;
  const re = /-?\d+(?:\.\d+)?/g;
  const na = a.match(re) || [], nb = b.match(re) || [];
  if (na.length !== nb.length) return false;
  if (a.replace(re, '#') !== b.replace(re, '#')) return false;
  for (let i = 0; i < na.length; i++) {
    const dec = (na[i].split('.')[1] || '').length;
    const unit = Math.pow(10, -dec);
    if (Math.abs(parseFloat(na[i]) - parseFloat(nb[i])) > unit * 1.0001 + 1e-12) return false;
  }
  return true;
}
function cmp(a, b, p, o, out) {
  // a = JS, b = Rust
  if (out.length > 8) return;
  if (typeof b === 'number' || typeof a === 'number') {
    if (typeof a !== 'number' || typeof b !== 'number') { out.push(`${p}: 型が違う js=${JSON.stringify(a)} rust=${JSON.stringify(b)}`); return; }
    if (!numClose(a, b, o.tol)) out.push(`${p}: js=${a} rust=${b}`);
    return;
  }
  if (typeof b === 'string' || typeof a === 'string') {
    if (typeof a !== 'string' || typeof b !== 'string') { out.push(`${p}: 型が違う js=${JSON.stringify(a)} rust=${JSON.stringify(b)}`); return; }
    const ok = o.strLoose && o.strLoose(p) ? strClose(a, b) : a === b;
    if (!ok) out.push(`${p}: js=${JSON.stringify(a)} rust=${JSON.stringify(b)}`);
    return;
  }
  if (b === null || a === null || typeof b === 'boolean' || typeof a === 'boolean') {
    if (a !== b) out.push(`${p}: js=${JSON.stringify(a)} rust=${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(b) || Array.isArray(a)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { out.push(`${p}: 配列かどうかが違う`); return; }
    if (a.length !== b.length) { out.push(`${p}: 長さ js=${a.length} rust=${b.length}`); return; }
    for (let i = 0; i < b.length; i++) cmp(a[i], b[i], `${p}[${i}]`, o, out);
    return;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) { out.push(`${p}: キーが違う js=${ka} rust=${kb}`); return; }
  for (const k of kb) cmp(a[k], b[k], `${p}.${k}`, o, out);
}
const looseWarn = (p) => /^\$\.data\.warnings\[\d+\]\.msg$/.test(p);

// ---------------------------------------------------------------- サーバ
let server = null, port = 0;
function startServer() {
  return new Promise((resolve, reject) => {
    port = 20000 + Math.floor(Math.random() * 20000);
    const f = path.join(tmp, 'server.jk');
    fs.writeFileSync(f, 'show "x" {\n}\n');
    server = spawn(BIN, ['edit', f, '--port', String(port), '--no-open'], { cwd: ROOT, stdio: 'ignore' });
    let tries = 0;
    const probe = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/source' }, (res) => { res.resume(); resolve(); });
      req.on('error', () => { if (++tries > 100) reject(new Error('サーバが起動しません')); else setTimeout(probe, 50); });
    };
    probe();
  });
}
function post(url, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const req = http.request({ host: '127.0.0.1', port, path: url, method: 'POST', headers: { 'Content-Length': buf.length } }, (res) => {
      const ch = [];
      res.on('data', (d) => ch.push(d));
      res.on('end', () => resolve(Buffer.concat(ch).toString('utf8')));
    });
    req.on('error', reject);
    req.end(buf);
  });
}

// ---------------------------------------------------------------- 1ケース
async function testCase(file) {
  const rel = path.relative(ROOT, file);
  if (process.env.SHOW_FUZZ && file.includes('fuzz')) console.log(fs.readFileSync(file, 'utf8'));
  const src = fs.readFileSync(file, 'utf8');
  const problems = [];
  const add = (what, list) => { for (const l of list) problems.push(`${what} ${l}`); };

  // --- サーバAPI /api/compile
  const rustC = JSON.parse(await post('/api/compile', src));
  const jsC = engine.jinkeiCompile(src);
  {
    const out = [];
    cmp(jsC, rustC, '$', { tol: TOL, strLoose: looseWarn }, out);
    add('compile', out);
    // handles は有効桁をそのまま比べる
    if (jsC.ok && rustC.ok) {
      const o2 = [];
      cmp(jsC.handles, rustC.handles, '$.handles', { tol: 1e-9 }, o2);
      add('handles(strict)', o2);
    }
  }
  // --- サーバAPI /api/fix
  const rustF = JSON.parse(await post('/api/fix', src));
  const jsF = engine.jinkeiFix(src);
  {
    const out = [];
    cmp(jsF, rustF, '$', { tol: 0 }, out);
    add('fix(api)', out);
  }
  // --- CLI json
  const cj = run(['json', file]);
  if (cj.code === 0) {
    if (!jsC.ok) problems.push('json: Rust は成功したが JS はエラー');
    else {
      const out = [];
      cmp(jsC.data, JSON.parse(cj.out), '$', { tol: TOL, strLoose: (p) => /^\$\.warnings\[\d+\]\.msg$/.test(p) }, out);
      add('json(cli)', out);
    }
  } else {
    const first = cj.err.split('\n')[0];
    if (jsC.ok) problems.push(`json: Rust はエラー「${first}」だが JS は成功`);
    else {
      const e = jsC.error;
      const want = `エラー: ${file}: ${e.line > 0 ? `${e.line}行${e.col}列: ` : ''}${e.msg}`;
      if (first !== want) problems.push(`error line: js=${want} rust=${first}`);
    }
  }
  // --- CLI model
  const cm = run(['model', file]);
  if (cm.code === 0) {
    const m = JSON.parse(cm.out);
    const out = [];
    cmp(engine.jinkeiModel(src), m, '$', { tol: 0 }, out);
    add('model(cli)', out);
  } else {
    const r = engine.jinkeiModel(src);
    if (r.ok !== false) problems.push('model: Rust はエラーだが JS は成功');
    else {
      const want = `エラー: ${r.error.line > 0 ? `${r.error.line}行${r.error.col}列: ` : ''}${r.error.msg}`;
      const first = cm.err.split('\n')[0];
      if (first !== want) problems.push(`model error: js=${want} rust=${first}`);
    }
  }
  // --- CLI fix（テキスト）
  const cf = run(['fix', file]);
  if (cf.code === 0) {
    if (!jsF.ok) problems.push('fix: Rust は成功したが JS は失敗');
    else {
      const text = jsF.notes.length === 0
        ? `自動で直せる衝突は見つかりませんでした（衝突 ${jsF.before}件）\n`
        : `衝突 ${jsF.before}件 → ${jsF.after}件 にできます。次のように書き足してください（エディタの「自動で直す」なら一度で反映されます）:\n` + jsF.notes.map((n) => `  ・${n}\n`).join('');
      if (text !== cf.out) problems.push(`fix(cli) テキストが違う\n js:\n${text}\n rust:\n${cf.out}`);
    }
  } else if (jsF.ok) problems.push('fix: Rust は失敗したが JS は成功');
  return { rel, problems, ncoll: jsF.ok ? jsF.before : -1, notes: jsF.ok ? jsF.notes.length : 0, ok: jsC.ok };
}


// ---------------------------------------------------------------- ランダム生成（--fuzz N）
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function genProgram(seed) {
  const R = mulberry(seed);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const venue = pick(['gym', 'gym', 'football', 'stage', 'floor', 'gymc']);
  let field = '', rx = 12, ry = 12, cy = 0, unit = 1;
  switch (venue) {
    case 'football': field = pick(['field football', 'field football college', 'field football nfl']); rx = 60; ry = 40; cy = 40; unit = 0.57; break;
    case 'stage': field = 'field stage'; rx = 8; ry = 4; cy = 5; break;
    case 'floor': field = 'field floor 20 x 14'; rx = 9; ry = 6; cy = 7; break;
    case 'gymc': field = 'field gym 24 x 20'; rx = 11; ry = 9; cy = 0; break;
    default: field = ''; rx = 13; ry = 13;
  }
  const num = (lo, hi) => { const v = lo + R() * (hi - lo); return R() < 0.5 ? String(Math.round(v)) : v.toFixed(1); };
  const X = () => num(-rx, rx);
  const Y = () => num(cy - ry, cy + ry);
  const P = () => `(${X()}, ${Y()})`;
  const secs = []; const nsec = ri(2, 4);
  for (let i = 0; i < nsec; i++) secs.push({ id: 's' + i, n: ri(1, 8) });
  let out = `show "fuzz${seed}" {\n  ${field}\n`;
  if (R() < 0.3) out += `  tempo ${ri(80, 160)}\n`;
  if (R() < 0.2) out += `  clearance ${pick([0.3, 0.5, 0.8, 1.2])}\n`;
  if (R() < 0.2) out += `  maxstep ${pick([0.5, 0.6, 1, 4, 8])}\n`;
  for (const s of secs) out += `  section ${s.id} "S${s.id}" ${s.n}${R() < 0.5 ? ' color "#abcdef"' : ''}\n`;
  const nsets = ri(2, 5);
  const shape = (k, g) => {
    const r = R();
    const mods = [];
    let sh;
    if (r < 0.2) sh = `line ${P()} -> ${P()}`;
    else if (r < 0.32) sh = `arc ${P()} radius ${num(2, rx / 2)} from ${ri(0, 180)} to ${ri(181, 360)}`;
    else if (r < 0.44) sh = `circle ${P()} radius ${num(2, rx / 2)}${R() < 0.3 ? ' start ' + ri(0, 359) : ''}`;
    else if (r < 0.54) sh = `block ${P()} cols ${ri(1, 6)}${R() < 0.5 ? ' spacing ' + num(1, 3) : ''}${R() < 0.3 ? ' rows ' + num(1, 3) : ''}`;
    else if (r < 0.64) sh = `curve ${P()} -> ${P()} -> ${P()}`;
    else if (r < 0.72) sh = `poly ${P()} -> ${P()} -> ${P()} -> ${P()}`;
    else if (r < 0.78 && k > 0) sh = `follow ${P()} -> ${P()} -> ${P()}${R() < 0.4 ? ' spacing ' + num(0.5, 3) : ''}`;
    else if (r < 0.9 && k > 0) sh = 'same';
    else sh = `line ${P()} -> ${P()}`;
    const isFollow = sh.startsWith('follow');
    if (R() < 0.25) mods.push(`rotate ${ri(-180, 180)}${R() < 0.3 ? ' about ' + P() : ''}`);
    if (R() < 0.2) mods.push(`shift (${num(-3, 3)}, ${num(-3, 3)})`);
    if (R() < 0.2) mods.push(`scale ${pick([0.5, 0.8, 1.5, 2])}`);
    if (R() < 0.2) mods.push(`assign ${pick(['keep', 'auto'])}`);
    if (k > 0) {
      if (R() < 0.15) mods.push(`wait ${ri(1, 4)}`);
      if (R() < 0.12) mods.push(`in ${ri(3, 8)}`);
      if (R() < 0.15 && !isFollow) mods.push(`bend ${pick([20, -20, 45, -60, 100, -120])}`);
    }
    if (R() < 0.15) mods.push(`face ${pick(['front', 'back', 'kami', 'shimo', 'center', 'out', 'travel', '30', 'toward (0, 0)'])}`);
    if (R() < 0.1) mods.push(`step ${pick(['glide', 'back', 'slide', 'jazz', 'high'])}`);
    if (R() < 0.1) mods.push(`action ${pick(['spin', 'toss', 'swing', 'rest'])}`);
    if (R() < 0.15) mods.push(`pose ${pick(['attention', 'rest', 'wide', 'cross', 'kneel', 'kneel2', 'lunge', 'crouch', 'toe', '休め', 'ランジ', 'つま先'])}`);
    if (R() < 0.12) mods.push(`carry ${pick(['play', 'right', 'left', 'front', 'diag', '右手', '斜め'])}`);
    return sh + (mods.length ? ' ' + mods.join(' ') : '');
  };
  for (let k = 0; k < nsets; k++) {
    const counts = k === 0 ? '' : ` counts ${pick([4, 8, 8, 12, 16, 24])}`;
    const extra = (R() < 0.2 ? ` hold ${ri(1, 8)}` : '') + (k > 0 && R() < 0.15 ? ` tempo ${ri(90, 150)}` : '') + (R() < 0.1 ? ' mark' : '');
    out += `  set ${k + 1}${counts}${extra} {\n`;
    const chosen = k === 0 ? secs.slice() : secs.filter(() => R() < 0.7);
    for (const s of chosen) {
      let grp = s.id;
      if (R() < 0.15 && s.n > 1) grp = `${s.id}1..${s.id}${ri(1, s.n)}`;
      const g = grp.includes('..') ? Number(grp.split('..')[1].slice(s.id.length)) : s.n;
      let sh = shape(k, g);
      if (sh.startsWith('at')) sh = 'same';
      out += `    ${grp} : ${sh}\n`;
      if (R() < 0.25) {
        const at = [];
        if (R() < 0.6) at.push(`face ${pick(['front', 'back', 'kami', 'shimo', 'center', 'out', 'travel', '30', 'toward (0, 0)'])}`);
        if (R() < 0.6) at.push(`pose ${pick(['attention', 'rest', 'wide', 'cross', 'kneel', 'kneel2', 'lunge', 'crouch', 'toe'])}`);
        if (R() < 0.4) at.push(`carry ${pick(['play', 'right', 'left', 'front', 'diag'])}`);
        if (R() < 0.3) at.push(`step ${pick(['glide', 'slide', 'jazz'])}`);
        if (R() < 0.3) at.push(`action ${pick(['spin', 'toss', 'rest'])}`);
        if (at.length && !(k === 0 && R() < 0.3)) {
          const g2 = R() < 0.3 && s.n > 1 ? `${s.id}1..${s.id}${ri(1, s.n)}` : (R() < 0.3 ? `${s.id}${ri(1, s.n)}` : s.id);
          out += `    ${g2} : ${at.join(' ')}\n`;
        }
      }
      if (R() < 0.2 && s.n > 0) out += `    ${s.id}${ri(1, s.n)} : at ${P()}\n`;
    }
    out += '  }\n';
  }
  // 楽譜パート（ときどき壊れた記法や存在しないセットも混ぜる）
  const nparts = ri(0, 2);
  const toks = ['R', 'l', 'r', 'L', 'B', 'b', '^R', '>l', 'xr', 'fR', 'dl', 'zr', 'R2', 'l5', '-', '~', '|', '4:', '8:', '16:', '32:', '8.:', '3[ r l r ]', '5[ R l r l r ]', 'rlrl', 'RLRL', '//c\n', '# n\n'];
  const bad = ['q', '7:', '3[ r ]', '[', '}', 'meter 4/5', '1', '^', '~~'];
  const cnt = secs.map((s) => s.id);
  for (let p = 0; p < nparts; p++) {
    let body = '';
    if (R() < 0.3) body += `meter ${pick(['4/4', '3/4', '6/8', '2/4', '7/8'])} `;
    if (R() < 0.4) body += `start ${pick(['0', '4', '8.5', 'set 1', 'set 2', 'set 3', 'set 9'])} `;
    const nn = ri(3, 40);
    for (let k = 0; k < nn; k++) body += pick(toks) + ' ';
    if (R() < 0.3) body += `repeat ${ri(1, 3)} { ${pick(toks)} ${pick(toks)} | } `;
    if (R() < 0.12) body += pick(bad) + ' ';
    const g = R() < 0.1 ? 'zz' : pick([pick(cnt), 'all', cnt[0] + ' + ' + cnt[1 % cnt.length], cnt[0] + '1..' + cnt[0] + '1']);
    out += `  part "P${p}" for ${g} {\n    ${body}\n  }\n`;
  }
  return out + '}\n';
}

// ---------------------------------------------------------------- メイン
(async () => {
  const files = [];
  for (const d of ['examples', 'web/cases']) {
    const dir = path.join(ROOT, d);
    for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.jk')) files.push(path.join(dir, f));
  }
  const fz = process.argv.indexOf('--fuzz');
  if (fz >= 0) {
    const cnt = Number(process.argv[fz + 1]) || 50;
    const base = Number(process.argv[fz + 2]) || 1;
    fs.mkdirSync(path.join(tmp, 'fuzz'));
    for (let i = 0; i < cnt; i++) { const f = path.join(tmp, 'fuzz', `fz${base + i}.jk`); fs.writeFileSync(f, genProgram(base + i)); files.push(f); }
  }
  const sel = filter ? files.filter((f) => f.includes(filter)) : files;
  await startServer();
  let pass = 0, fail = 0, withFix = 0;
  const rows = [];
  for (const f of sel) {
    let r;
    try { r = await testCase(f); } catch (e) { r = { rel: path.relative(ROOT, f), problems: ['例外: ' + (e.stack || e)], ncoll: -1, notes: 0, ok: false }; }
    if (r.notes > 0) withFix++;
    const okc = r.problems.length === 0;
    if (okc) pass++; else fail++;
    rows.push(r);
    console.log(`${okc ? 'PASS' : 'FAIL'}  ${r.rel.padEnd(42)} ${r.ok ? 'build-ok' : 'error   '}  衝突${String(Math.max(r.ncoll, 0)).padStart(3)}  fix-notes ${r.notes}`);
    for (const p of r.problems) console.log('      ' + p.split('\n').join('\n      '));
  }
  // 速度
  const gym = fs.readFileSync(path.join(ROOT, 'examples/gym.jk'), 'utf8');
  engine.jinkeiCompile(gym);
  const t0 = process.hrtime.bigint();
  const N = 10;
  for (let i = 0; i < N; i++) engine.jinkeiCompile(gym);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  const t1 = process.hrtime.bigint();
  engine.jinkeiCompile(gym.replace(/ /g, ' '));
  console.log(`\nspeed: jinkeiCompile(gym.jk) = ${ms.toFixed(1)} ms (avg of ${N}, warm)`);
  console.log(`result: ${pass} passed, ${fail} failed, ${rows.length} total (fix proposals in ${withFix} cases)`);
  if (server) server.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
