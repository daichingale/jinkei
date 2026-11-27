#!/usr/bin/env node
// パレード自動作成（src/parade.js ＝ マーチングコンテスト規定課題 ①→②→③）のテスト。
//   node tests/parade.js [--bin target/release/jinkei] [--quick]
// 人数 12/24/36/48/60 × 角の方法（順次ピンホイール／ブロック・ピンホイール／カラムターン）× 角の拍数（4/8/12/16）× 向き について、
//  セットを作り → .jk に印刷（src/printer.js）→ エンジン（web/engine.js。--bin があれば Rust の check も）でコンパイルして
//   ・直進は縦横そろった直線（軸に平行・各列が一直線・ずれ 1cm 未満）
//   ・外側の列が 0.25 カウントごとに 20m ラインの内側へ入らない
//   ・①の間止まらない／一周して出発位置に戻る／衝突・大股・場外 0
//   ・②の180°ターンの前後 2 歩以上／③の足踏み 32 歩以上
//   ・順次・ブロックのピンホイールでは、各段が回っている間も 2cm 以内の一直線（段の中の間隔も保つ）
//   ・全員の最小間隔 ≥ 0.58m（エンジンの衝突しきい値 0.6m。内側の人どうしの物理的な限界）
//   ・セットが 8 拍ごと（①②③の本セットの開始が 8 の倍数。最後の足踏みを除く）
//   ・コンパイルされた動きが、解析的な経路と 0.25 カウントごとに 3cm 以内で一致
//   ・人数 12/24/36/48/60/80
// を確かめる。会場に収まらない組み合わせは「収まりません」という理由つきで ok:false になるのが正しい（無理な図は出さない）。
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const {spawnSync} = require('child_process');
const P = require('../src/parade.js');
const {printModel} = require('../src/printer.js');
const E = require('../web/engine.js');
const M = new Function(fs.readFileSync(path.join(__dirname, '../src/motion.js'), 'utf8') + ';return {jkState,jkSetAt}')();

const args = process.argv.slice(2);
const binIx = args.indexOf('--bin'), BIN = binIx >= 0 ? args[binIx + 1] : null;
const QUICK = args.includes('--quick');
const VENUES = {gym: {type: 'gym', w: 30, d: 30}, floor: {type: 'floor', w: 30, d: 30}};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function secsFor(n) {
  const ids = ['fl', 'tp', 'cl', 'tb', 'sd', 'pc'], per = Math.ceil(n / ids.length), out = [];
  let left = n;
  ids.forEach(id => { const c = Math.min(per, left); if (c > 0) { out.push({id, n: c}); left -= c; } });
  return out;
}
function modelOf(field, secs, r, extra) {
  const all = secs.concat(r.extraSections.map(e => ({id: e.id, label: e.label, n: e.n}))).map(s => ({id: s.id, label: s.label || s.id, n: s.n, color: null, instrument: null, note: [], tail: null}));
  return {name: 'parade-test', header: [], settings_notes: [], foot: [], field, tempo: 120, clearance: null, maxstep: null, look: null, sections: all, parts: [],
    sets: (extra || []).concat(r.sets.map(s => ({name: s.name, counts: s.counts, hold: s.hold, mark: s.mark, sub: !!s.sub, tempo: null, note: [], tail: s.tail || null, foot: [], stmts: s.stmts})))};
}
// 直進セット（kind === 'leg'）が、軸に平行で、各列が一直線かを確かめる。ずれの最大値（m）を返す
function legDeviation(r, D) {
  let worst = 0;
  r.sets.forEach((s, k) => {
    if (k === 0 || s.kind !== 'leg') return;
    const a = D.sets[k - 1].pos, b = D.sets[k].pos;
    let dirs = new Set();
    for (let i = 0; i < a.length; i++) {
      const dx = b[i][0] - a[i][0], dy = b[i][1] - a[i][1];
      if (Math.hypot(dx, dy) < 1e-9) continue;
      if (r.info.method !== 'column') worst = Math.max(worst, Math.min(Math.abs(dx), Math.abs(dy)));
      dirs.add(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '+x' : '-x') : (dy > 0 ? '+y' : '-y'));
    }
    if (dirs.size === 1 && r.info.method !== 'column') { // 全員が同じ向きに動く直進 → 各列（同じ o）は一直線、各段（同じ k）は一直線
      const key = [...dirs][0], alongX = key[1] === 'x';
      const byRole = (sel) => {
        const g = new Map();
        r.info.roles.forEach((ro, slot) => { const kk = sel(ro); if (!g.has(kk)) g.set(kk, []); g.get(kk).push(D.sets[k].pos[r.slotMem[slot]]); });
        g.forEach(ps => { const c = ps.map(p => p[alongX ? 1 : 0]); worst = Math.max(worst, Math.max(...c) - Math.min(...c)); });
      };
      byRole(ro => (ro.dm ? 'dm' : 'o' + ro.o));
      // 段は進行方向と直角な直線 = 進行方向の座標が等しい
      const g2 = new Map();
      r.info.roles.forEach((ro, slot) => { if (ro.dm) return; if (!g2.has(ro.k)) g2.set(ro.k, []); g2.get(ro.k).push(D.sets[k].pos[r.slotMem[slot]]); });
      g2.forEach(ps => { const c = ps.map(p => p[alongX ? 0 : 1]); worst = Math.max(worst, Math.max(...c) - Math.min(...c)); });
    }
  });
  return worst;
}
// ①の間の幾何: 段の一直線・最小間隔・解析経路との一致・8 拍ごとのセット
function geomChecks(r, D, out) {
  const info = r.info, roles = info.roles, mi = slot => r.slotMem[slot];
  const tags = info.setTags || r.sets.map(s => s.tag);
  const lapK = tags.map((t, k) => t === '①' ? k : -1).filter(k => k >= 0);
  if (!lapK.length) return;
  const t0 = D.sets[lapK[0]].start, t1 = D.sets[lapK[lapK.length - 1]].start + D.sets[lapK[lapK.length - 1]].counts;
  const method = info.method;
  let worstLine = 0, minD = 1e9, worstAn = 0, stepWorst = 0;
  const ranks = new Map();
  roles.forEach((ro, slot) => { if (ro.dm) return; if (!ranks.has(ro.k)) ranks.set(ro.k, []); ranks.get(ro.k).push(slot); });
  ranks.forEach(l => l.sort((a, b) => roles[a].o - roles[b].o));
  const all = roles.map((_, slot) => slot);
  for (let t = t0 + 0.01; t < t1; t += 0.25) {
    const P = all.map(slot => M.jkState(D, mi(slot), t).p);
    if (method === 'pinseq' || method === 'pinblock') {
      ranks.forEach(l => {
        if (l.length < 3) return;
        const a = P[l[0]], b = P[l[l.length - 1]], L = dist(a, b);
        if (L < 1e-6) return;
        l.forEach(s => { worstLine = Math.max(worstLine, Math.abs((b[0] - a[0]) * (a[1] - P[s][1]) - (a[0] - P[s][0]) * (b[1] - a[1])) / L); });
      });
    }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const d = dist(P[i], P[j]); if (d < minD) minD = d; }
    if (info.analytic) all.forEach(slot => { const a = info.analytic(slot, t - t0); if (a) worstAn = Math.max(worstAn, dist(a, P[slot])); });
  }
  if (worstLine > 0.02) out.problems.push(`段が一直線でない（${worstLine.toFixed(3)}m）`);
  if (minD < 0.58) out.problems.push(`最小間隔 ${minD.toFixed(2)}m < 0.58m`);
  if (worstAn > 0.03) out.problems.push(`解析経路とのずれ ${worstAn.toFixed(3)}m > 3cm`);
  out.minDist = minD; out.worstLine = worstLine; out.worstAn = worstAn;
  // 8 拍ごと: ①の各セット（sub でない）の開始が、①の最初から 8 の倍数
  let bad = 0;
  lapK.forEach((k, ix) => { if (!r.sets[k].sub && !(ix === 0 && info.lead)) { const rel = D.sets[k].start - t0 - (info.lead || 0); if (Math.abs(rel / 8 - Math.round(rel / 8)) > 1e-6) bad++; } });
  if (bad) out.problems.push(`本セットの開始が 8 拍ごとでない: ${bad} 件`);
}
function check(o0, label) {
  const field = o0.field || VENUES.gym, secs = secsFor(o0.n);
  const o = Object.assign({field, sections: secs, order: secs.map(s => s.id), pattern: 'contest', corner: 'pinblock', cornerCounts: 8, ccw: true, style: 'glide', dm: 'new'}, o0);
  const r = P.generate(o);
  if (!r.ok) return {ok: false, skip: true, reason: r.error};
  const m = modelOf(field, secs, r), src = printModel(m);
  const c = E.jinkeiCompile(src);
  const out = {ok: true, src, r, problems: [], sets: r.sets.length, total: r.info.total};
  if (!c.ok) { out.ok = false; out.problems.push('コンパイルできない: ' + (c.error && c.error.msg)); return out; }
  const D = c.data;
  const v = P.validate(r, D, M.jkState, 0);
  v.checks.filter(x => !x.ok).forEach(x => out.problems.push(`${x.label}: ${x.detail}`));
  geomChecks(r, D, out);
  const dev = legDeviation(r, D);
  if (dev > 0.01) out.problems.push(`直進が直線でない（ずれ ${dev.toFixed(3)}m）`);
  D.sets.forEach((s, k) => { if (k && Math.abs(s.counts * 2 - Math.round(s.counts * 2)) > 1e-9) out.problems.push(`セット${s.name} のカウントが整数・半分でない: ${s.counts}`); });
  if (new Set(r.sets.filter(s => !s.sub).map(s => s.name)).size !== r.sets.filter(s => !s.sub).length) out.problems.push('セット名が重複');
  if (o.pattern === 'contest' || o.pattern === 'lap') {
    // 角の拍数が要求どおり（上限で増えたときは注記がある）か
    if (r.info.Neff !== o.cornerCounts && !r.notes.some(t => /拍/.test(t))) out.problems.push(`角の拍数が ${o.cornerCounts} でなく ${r.info.Neff} になったのに注記がない`);
  }
  if (o.pattern === 'contest' && r.info.method !== 'pinblock' && r.sets.length > 220) out.problems.push(`セットが多すぎる: ${r.sets.length}`);
  if (BIN) {
    const f = path.join(os.tmpdir(), `pt_${o.pattern}_${o.corner}_${o0.n}_${o.cornerCounts}_${o.ccw ? 'l' : 'r'}.jk`);
    fs.writeFileSync(f, src);
    const rr = spawnSync(BIN, ['check', f], {encoding: 'utf8'});
    if (rr.status !== 0) out.problems.push('Rust check: ' + ((rr.stdout || '') + (rr.stderr || '')).split('\n').slice(0, 2).join(' / '));
  }
  out.ok = out.problems.length === 0;
  return out;
}
// いまの隊形から入る（entry:'near'）。入場の移動も含めて衝突 0 か
function checkEntry(o0) {
  const field = VENUES.gym, secs = secsFor(o0.n), mem = [];
  secs.forEach(s => { for (let i = 1; i <= s.n; i++) mem.push(s.id + i); });
  const per = Math.max(5, Math.ceil(Math.sqrt(mem.length * 1.6))), g = 1.4;
  const cur = mem.map((_, i) => [((i % per) - (per - 1) / 2) * g, (Math.floor(i / per) - 2) * g * 1.3]);
  const r = P.generate(Object.assign({field, sections: secs, order: secs.map(s => s.id), pattern: 'contest', corner: 'pinblock', dm: 'none', entry: 'near', curPos: cur}, o0));
  if (!r.ok) return {skip: true, reason: r.error};
  const pre = {name: '0', counts: 0, hold: 8, mark: false, tempo: null, note: [], tail: null, foot: [], stmts: mem.map((id, i) => ({idx: [i], group: id, shape: {kind: 'at', p: cur[i].map(v => Math.round(v * 1000) / 1000)}, xf: [], assign: null, wait: null, within: null, bend: null, face: null, step: null, action: null, pose: null, carry: null, note: [], tail: null}))};
  const m = modelOf(field, secs, r, [pre]);
  const c = E.jinkeiCompile(printModel(m));
  if (!c.ok) return {problems: ['コンパイルできない: ' + (c.error && c.error.msg)]};
  const W = c.data.warnings.filter(w => ['衝突', '大股', '場外'].includes(w.kind));
  return {problems: W.length ? [`入場つき: ${W.length}件 ${W[0].kind} ${W[0].msg}`] : []};
}
module.exports = {check, checkEntry, secsFor, modelOf, VENUES};

if (require.main === module) {
  let ok = 0, fail = 0, skip = 0;
  const rows = [];
  const NAME = {pinseq: '順次ピンホイール', pinblock: 'ブロックピンホイール', column: 'カラムターン'};
  // 収まるはずの下限（これを下回ったら失敗として数える）: ブロックは 48 人まで、順次・カラムは 24 人まで
  const MUST = {pinblock: 60, pinseq: 80, column: 36};
  const sizes = QUICK ? [12, 36] : [12, 24, 36, 48, 60, 80], counts = QUICK ? [8] : [8, 16];
  for (const [vn, field] of Object.entries(VENUES)) {
    if (QUICK && vn !== 'gym') continue;
    for (const corner of Object.keys(NAME)) for (const n of sizes) for (const cc of counts) for (const ccw of QUICK ? [true] : [true, false]) {
      const tag = `${vn}/${NAME[corner]}/${n}人/${cc}拍/${ccw ? '反時計' : '時計'}`;
      const r = check({n, corner, cornerCounts: cc, ccw, field});
      if (r.skip) {
        skip++; rows.push(`SKIP ${tag}  ${r.reason}`);
        if (vn === 'gym' && n <= MUST[corner]) { fail++; rows.push(`NG   ${tag}  この人数は収まるはず: ${r.reason}`); }
        continue;
      }
      if (r.problems.length) { fail++; rows.push(`NG   ${tag}  sets=${r.sets}  ${r.problems.join(' | ')}`); } else { ok++; rows.push(`OK   ${tag}  sets=${r.sets} ${r.total}カウント`); }
    }
  }
  // 部分パターン（①だけ・②だけ・③だけ）と DM の有無・Iターン・足踏みの向き
  for (const n of [12, 24, 36]) for (const pattern of ['lap', 'center', 'mark']) for (const dm of ['none', 'new']) for (const corner of ['pinblock', 'pinseq']) {
    if (pattern !== 'lap' && corner === 'pinseq') continue;
    if (pattern === 'lap' && corner === 'pinseq' && n > 24) continue;
    const r = check({n, pattern, dm, corner, dmTurn: dm === 'new' && pattern === 'center' ? 'I' : 'U', markPivot: pattern === 'mark' && dm === 'none' ? 'kami' : 'none', markCounts: 40});
    const tag = `部分/${pattern}/${n}人/DM=${dm}/${corner}`;
    if (r.skip) { skip++; rows.push(`SKIP ${tag}  ${r.reason}`); if (n <= 24) { fail++; rows.push(`NG   ${tag}  収まるはず: ${r.reason}`); } continue; }
    if (r.problems.length) { fail++; rows.push(`NG   ${tag}  ${r.problems.join(' | ')}`); } else ok++;
  }
  // 入場（いまの隊形から）
  for (const n of [12, 24, 36]) for (const ccw of [true, false]) {
    const r = checkEntry({n, ccw});
    if (r.skip) continue;
    if (r.problems.length) { fail++; rows.push(`NG   入場/${n}人/${ccw ? '反時計' : '時計'}  ${r.problems.join(' | ')}`); } else ok++;
  }
  rows.filter(x => !x.startsWith('OK')).forEach(x => console.log(x));
  if (process.env.VERBOSE) rows.filter(x => x.startsWith('OK')).forEach(x => console.log(x));
  console.log(`\n合格 ${ok} / 失敗 ${fail} / 収まらない（理由つきで断った） ${skip}`);
  process.exit(fail ? 1 : 0);
}
