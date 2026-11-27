#!/usr/bin/env node
// 性能ベンチ（node + Rust）。決定的なシードで、同じ入力を before/after で比べられる。
//   node tools/bench.js [--engine web/engine.js] [--bin target/release/jinkei] [--json out.json] [--quick]
//   node tools/bench.js --compare before.json after.json     # 2つの結果の比較表
// エンジンのソースにカウンタ/計時を差し込んで読み込むので、古いエンジン（git の main 版）にもそのまま使える。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {spawnSync} = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const {genShow} = require('./gen_shows.js');
const A = process.argv.slice(2);
const opt = (n, d) => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : d; };
const QUICK = A.includes('--quick');

if (A.includes('--compare')) {
  const i = A.indexOf('--compare');
  const b = JSON.parse(fs.readFileSync(A[i + 1], 'utf8')), a = JSON.parse(fs.readFileSync(A[i + 2], 'utf8'));
  const rows = [];
  const walk = (x, y, p) => { for (const k of Object.keys(x)) { if (typeof x[k] === 'number' && typeof y[k] === 'number') rows.push([p + k, x[k], y[k]]); else if (x[k] && typeof x[k] === 'object' && y[k]) walk(x[k], y[k], p + k + '.'); } };
  walk(b, a, '');
  for (const [k, x, y] of rows) console.log(k.padEnd(52), String(x).padStart(10), '→', String(y).padStart(10), x > 0 && y > 0 ? ('x' + (x / y).toFixed(2)).padStart(8) : '');
  process.exit(0);
}

// ---------------------------------------------------------------- エンジンの読み込み（計測つき）
function loadEngine(file) {
  let src = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
  const wrap = (name, sig) => {   // function name(sig) {…} を計測ラッパー経由にする
    const re = new RegExp('function ' + name + '\\(' + sig + '\\) \\{');
    if (!re.test(src)) return;
    src = src.replace(re, `function ${name}(${sig}) { return __T('${name}', () => ${name}__0(${sig})); }\nfunction ${name}__0(${sig}) {`);
  };
  const count = (name, sig) => {  // 回数だけ数える（ホットパス）
    const re = new RegExp('function ' + name + '\\(' + sig + '\\) \\{');
    if (re.test(src)) src = src.replace(re, `function ${name}(${sig}) { __C.${name} = (__C.${name} || 0) + 1;`);
  };
  wrap('parse', 'src'); wrap('build', 'a'); wrap('analyze', 's'); wrap('dataJson', 's, r'); wrap('modelJson', 'a'); wrap('hungarian', 'cost');
  wrap('fixScore', 'ast'); wrap('assignAvoiding', 'from, to, w, e, bend, others, c, clearance');
  count('closest', 'a, b, c'); count('mvFar', 'm, o, cl');
  const T = {}, C = {};
  const __T = (n, f) => { const t = process.hrtime.bigint(); try { return f(); } finally { const d = Number(process.hrtime.bigint() - t) / 1e6; const e = T[n] || (T[n] = {n: 0, ms: 0}); e.n++; e.ms += d; } };
  const ctx = {module: {exports: {}}, exports: {}, __T, __C: C, console, process, Math, Number, JSON, Map, Set, Array, Object, String, Error, RegExp, Infinity, NaN, isFinite, parseFloat, parseInt, Symbol, WeakMap};
  ctx.globalThis = ctx; ctx.window = undefined;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, {filename: file});
  const api = ctx.module.exports.jinkeiCompile ? ctx.module.exports : ctx;
  return {api, T, C, reset() { for (const k of Object.keys(T)) delete T[k]; for (const k of Object.keys(C)) delete C[k]; }};
}
const ENG = loadEngine(opt('--engine', 'web/engine.js'));
const E = ENG.api;

const now = () => Number(process.hrtime.bigint()) / 1e6;
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r1 = v => Math.round(v * 10) / 10;
const CLEAR = () => { if (E.jinkeiMemoClear) E.jinkeiMemoClear(); };   // 記憶（セットごとの結果の再利用）を空にする。古いエンジンには無い
function timeIt(fn, reps, warm, pre) {
  for (let i = 0; i < (warm === undefined ? 1 : warm); i++) { if (pre) pre(); fn(); }
  const t = [];
  for (let i = 0; i < reps; i++) { if (pre) pre(); const s = now(); fn(); t.push(now() - s); }
  return {median: r1(med(t)), min: r1(Math.min(...t)), reps};
}
// ドラッグ直後の再計算: 直前の状態が記憶に入っている前提で、1 つの数字だけ違うソースをコンパイルする（毎回違う値）
function dragTime(s, reps) {
  CLEAR(); E.jinkeiCompile(s);
  const t = [];
  for (let i = 1; i <= reps + 1; i++) {
    const s2 = s.replace(/(\d+(?:\.\d+)?)/, m => String(+m + 0.25 * i));
    const t0 = now(); E.jinkeiCompile(s2); if (i > 1) t.push(now() - t0);
  }
  return r1(med(t));
}
const out = {meta: {node: process.version, engine: opt('--engine', 'web/engine.js'), cpus: os.cpus().length, cpu: os.cpus()[0].model}};
const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- 1) コンパイル時間
const ex = fs.readdirSync(path.join(ROOT, 'examples')).filter(f => f.endsWith('.jk')).sort();
out.compile = {};
for (const f of ex) {
  const s = fs.readFileSync(path.join(ROOT, 'examples', f), 'utf8');
  const r = E.jinkeiCompile(s);
  if (!r.ok) continue;
  const cold = timeIt(() => E.jinkeiCompile(s), QUICK ? 3 : 9, 1, CLEAR);
  out.compile[f] = Object.assign({members: r.data.performers.length, sets: r.data.sets.length}, cold, {warm_median: timeIt(() => E.jinkeiCompile(s), QUICK ? 3 : 9).median, drag_median: dragTime(s, QUICK ? 3 : 7)});
}
const BIG = [[60, 30, 11], [80, 40, 12], [80, 60, 13]];
out.compileBig = {};
const bigSrc = {};
for (const [m, k, seed] of BIG) {
  const s = genShow(seed, {members: m, sets: k, field: 'gym'}); bigSrc[`gen${m}x${k}`] = s;
  const r = E.jinkeiCompile(s);
  if (!r.ok) { log('big failed', m, k, r.error); continue; }
  out.compileBig[`gen${m}x${k}`] = Object.assign({members: m, sets: k, warnings: r.data.warnings.length}, timeIt(() => E.jinkeiCompile(s), QUICK ? 3 : 7, 1, CLEAR), {warm_median: timeIt(() => E.jinkeiCompile(s), QUICK ? 3 : 7).median, drag_median: dragTime(s, QUICK ? 3 : 7)});
}
// フェーズ別（80人×40セット / パレード80人）
out.phases = {};
for (const [name, s] of [['gen80x40', bigSrc.gen80x40], ['parade_contest80', fs.readFileSync(path.join(ROOT, 'examples/parade_contest80.jk'), 'utf8')]]) {
  CLEAR(); E.jinkeiCompile(s); ENG.reset();
  const N = QUICK ? 3 : 8;
  for (let i = 0; i < N; i++) { CLEAR(); E.jinkeiCompile(s); }
  const ph = {};
  for (const k of ['parse', 'build', 'analyze', 'dataJson', 'modelJson']) ph[k + '_ms'] = r1((ENG.T[k] ? ENG.T[k].ms : 0) / N);
  ph.closest_calls = Math.round((ENG.C.closest || 0) / N); ph.mvFar_calls = Math.round((ENG.C.mvFar || 0) / N);
  ph.hungarian_calls = Math.round((ENG.T.hungarian ? ENG.T.hungarian.n : 0) / N); ph.hungarian_ms = r1((ENG.T.hungarian ? ENG.T.hungarian.ms : 0) / N);
  ph.total_ms = r1(timeIt(() => E.jinkeiCompile(s), N, 1, CLEAR).median);
  out.phases[name] = ph;
}

// ---------------------------------------------------------------- 2) 自動修正（候補評価数・時間）
const fixSeeds = []; // 衝突があるショー
for (let sd = 1; fixSeeds.length < (QUICK ? 6 : 24) && sd < 400; sd++) {
  const members = [10, 16, 24, 32][sd % 4];
  const s = genShow(sd, {members, sets: 4 + (sd % 4)});
  const r = E.jinkeiCompile(s);
  if (r.ok && r.data.warnings.some(w => w.kind === '衝突') && r.data.warnings.filter(w => w.kind === '衝突').length <= 25) fixSeeds.push({sd, members, s});
}
const fixRun = (opts) => {
  const o = {shows: fixSeeds.length, evals: 0, ms: 0, hungarian_ms: 0, build_ms: 0, analyze_ms: 0, fixedAll: 0, collBefore: 0, collAfter: 0, otherBefore: 0, otherAfter: 0, perShow: []};
  for (const {sd, members, s} of fixSeeds) {
    CLEAR(); ENG.reset();
    const e0 = E.jinkeiStats ? E.jinkeiStats().fixEvals : 0;
    const t = now(); const r = E.jinkeiFix(s, opts); const ms = now() - t;
    const ev = E.jinkeiStats ? E.jinkeiStats().fixEvals - e0 : (ENG.T.fixScore ? ENG.T.fixScore.n : 0);   // 候補を 1 つ評価した回数
    o.evals += ev; o.ms += ms;
    o.hungarian_ms += ENG.T.hungarian ? ENG.T.hungarian.ms : 0; o.build_ms += ENG.T.build ? ENG.T.build.ms : 0; o.analyze_ms += ENG.T.analyze ? ENG.T.analyze.ms : 0;
    o.collBefore += r.before; o.collAfter += r.after; o.otherBefore += r.others[0]; o.otherAfter += r.others[1];
    if (r.after === 0) o.fixedAll++;
    o.perShow.push({sd, members, evals: ev, ms: r1(ms), before: r.before, after: r.after, others: r.others});
  }
  for (const k of ['ms', 'hungarian_ms', 'build_ms', 'analyze_ms']) o[k] = r1(o[k]);
  o.ms_per_show = r1(o.ms / Math.max(1, o.shows));
  o.evals_per_show = r1(o.evals / Math.max(1, o.shows));
  return o;
};
out.fix = fixRun(undefined);   // 既定（判断AI版があればそれ）
if (E.jinkeiStats) out.fixExhaustive = fixRun({exhaustive: true});   // 総当たりのみ（比較用）

// ---------------------------------------------------------------- 3) 割り当て（ハンガリアン）単体
{
  const R = require('./gen_shows.js').mulberry(5);
  out.hungarian = {};
  for (const n of [20, 40, 80, 160]) {
    const cost = Array.from({length: n}, () => Array.from({length: n}, () => R() * 30));
    ENG.reset();
    // hungarian は内部関数なので、gAssign 相当をショー経由で測る代わりに、同じ形の行列で測れるよう公開版があれば使う
    const h = E.__hungarian;
    if (h) out.hungarian['n' + n] = timeIt(() => h(cost), 20);
  }
  if (!Object.keys(out.hungarian).length) {   // 公開されていないエンジン: 1セットに n 人の整列だけのショーのコンパイル時間で代用（assign auto が1回）
    for (const n of [20, 40, 80, 160]) {
      const sec = `section a "A" ${n}`;
      const s = `show "h" {\n  field football\n  ${sec}\n  set 1 { a : line (-${n}, 20) -> (${n}, 20) }\n  set 2 counts 32 { a : circle (0, 40) radius ${Math.max(6, n / 2)} }\n}\n`;
      ENG.reset(); const t = timeIt(() => E.jinkeiCompile(s), 7);
      out.hungarian['n' + n] = Object.assign({via: 'compile(assign auto)', hungarian_ms_per_compile: r1((ENG.T.hungarian ? ENG.T.hungarian.ms : 0) / (t.reps + 1))}, t);
    }
  }
}

// ---------------------------------------------------------------- 4) エディタ操作（メンバー追加・セット分割・ドラッグ再計算・パレード）
const SC = require(path.join(ROOT, 'src/shortcuts_core.js'));
const {printModel} = require(path.join(ROOT, 'src/printer.js'));
const PAR = require(path.join(ROOT, 'src/parade.js'));
function opsFor(counter) {
  return {mode: 'keep', print: printModel, compile: async s => { counter.n++; return E.jinkeiCompile(s); }, fix: async s => { counter.fix++; return E.jinkeiFix(s); }};
}
(async () => {
  out.edit = {};
  const cases = [['battery', fs.readFileSync(path.join(ROOT, 'examples/battery.jk'), 'utf8')], ['opener', fs.readFileSync(path.join(ROOT, 'examples/opener.jk'), 'utf8')],
    ['parade_contest', fs.readFileSync(path.join(ROOT, 'examples/parade_contest.jk'), 'utf8')], ['parade_contest80', fs.readFileSync(path.join(ROOT, 'examples/parade_contest80.jk'), 'utf8')], ['gen60x30', genShow(21, {members: 60, sets: 30, field: 'gym'})]];
  for (const [name, s] of cases) {
    const R0 = E.jinkeiCompile(s); if (!R0.ok) continue;
    const row = {members: R0.data.performers.length, sets: R0.data.sets.length};
    // 同じパートに1人追加
    { const sec = R0.data.performers[Math.floor(R0.data.performers.length / 2)].id;
      const reps = name === 'parade_contest80' ? 1 : 3, ts = [], cs = [];
      for (let i = 0; i < reps; i++) { const c = {n: 0, fix: 0}; ENG.reset(); const t = now(); const r = await SC.addMembers(R0.model, [sec], opsFor(c)); ts.push(now() - t); cs.push(c.n); if (!r.ok) { row.addMemberError = r.error; break; } row.addMemberExact = !!r.exact; row.addMemberWarn = (r.warnings || []).length; row.addMemberFixCalls = c.fix; }
      row.addMember_ms = r1(med(ts)); row.addMember_compiles = med(cs); }
    // セット分割
    { const k = Math.floor(R0.data.sets.length / 2), S = R0.data.sets[k];
      if (S.counts >= 2) { const c = {n: 0, fix: 0}; const t = now(); const r = await SC.splitSet(R0.model, k, Math.floor(S.counts / 2), Object.assign(opsFor(c), {mode: 'split'})); row.splitSet_ms = r1(now() - t); row.splitSet_ok = !!r.ok; row.splitSet_compiles = c.n; } }
    // ドラッグ直後の再計算（フル）: 1 点を動かしたソースをコンパイル
    { row.recompile_ms = dragTime(s, QUICK ? 3 : 7); }
    out.edit[name] = row;
  }
  // 自動修正（メンバー追加後）
  // ウィザード = パレード自動作成
  out.parade = {};
  for (const n of QUICK ? [36, 80] : [12, 36, 60, 80]) {
    const ids = ['fl', 'tp', 'cl', 'tb', 'sd', 'pc'], per = Math.ceil(n / ids.length), secs = []; let left = n;
    ids.forEach(id => { const c = Math.min(per, left); if (c > 0) { secs.push({id, n: c}); left -= c; } });
    const o = {field: {type: 'gym', w: 30, d: 30}, sections: secs, order: secs.map(s => s.id), pattern: 'contest', corner: 'pinblock', cornerCounts: 8, ccw: true, style: 'glide', dm: 'new'};
    const r = PAR.generate(o);
    const t = timeIt(() => PAR.generate(o), QUICK ? 2 : 5);
    out.parade['n' + n] = Object.assign({ok: r.ok, sets: r.ok ? r.sets.length : 0}, t);
  }
  // ---------------------------------------------------------------- 5) Rust（CLI）
  const BIN = path.resolve(ROOT, opt('--bin', 'target/release/jinkei'));
  if (fs.existsSync(BIN)) {
    out.rust = {};
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jk-bench-'));
    const files = {};
    for (const f of ['battery.jk', 'opener.jk', 'parade_contest.jk', 'parade_contest80.jk']) files[f] = path.join(ROOT, 'examples', f);
    for (const [k, s] of Object.entries(bigSrc)) { files[k + '.jk'] = path.join(tmp, k + '.jk'); fs.writeFileSync(files[k + '.jk'], s); }
    const runT = (args, reps) => { const t = []; for (let i = 0; i < reps; i++) { const s0 = now(); spawnSync(BIN, args, {maxBuffer: 1 << 28}); t.push(now() - s0); } return r1(med(t)); };
    out.rust.startup_ms = runT(['--help'], 5);
    out.rust.json = {};
    for (const [f, p] of Object.entries(files)) out.rust.json[f] = runT(['json', p], QUICK ? 2 : 5);
    out.rust.fix = {};
    let tot = 0;
    for (const {sd, s} of fixSeeds.slice(0, QUICK ? 3 : 12)) { const p = path.join(tmp, `fx${sd}.jk`); fs.writeFileSync(p, s); const t = runT(['fix', p], 3); out.rust.fix['seed' + sd] = t; tot += t; }
    out.rust.fix_total_ms = r1(tot);
  }
  const jf = opt('--json', null);
  if (jf) fs.writeFileSync(jf, JSON.stringify(out, null, 1));
  // 表で出す
  const P = (a, w) => String(a).padEnd(w);
  console.log('## compile (ms, median)');
  for (const [k, v] of Object.entries(Object.assign({}, out.compile, out.compileBig))) console.log(' ', P(k, 22), P(v.members + '人/' + v.sets + 'set', 12), v.median);
  console.log('## phases', JSON.stringify(out.phases));
  console.log('## fix', JSON.stringify(Object.assign({}, out.fix, {perShow: undefined})));
  if (out.fixExhaustive) console.log('## fixExhaustive', JSON.stringify(Object.assign({}, out.fixExhaustive, {perShow: undefined})));
  console.log('## hungarian', JSON.stringify(out.hungarian));
  console.log('## edit', JSON.stringify(out.edit));
  console.log('## parade', JSON.stringify(out.parade));
  if (out.rust) console.log('## rust', JSON.stringify(out.rust));
})();
