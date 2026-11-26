#!/usr/bin/env node
// パレード自動作成（src/parade.js）の、画面に依存しない部分のテスト。
//   node tests/parade.js [パターンid] [--bin target/release/jinkei]
// 全パターン × 会場 × 人数(8/20/41) × 回り方向 について、
//  ・セットを作って .jk に印刷（src/printer.js）→ エンジンで計算（web/engine.js。--bin があれば Rust の check も）
//  ・衝突 0・大股 0・場外 0、各セットのカウントが整数か半分、一周の最後が出発点に戻る
// を確かめる。収まらない組み合わせは「収まりません」という理由つきで ok:false になるのが正しい（無理な図は出さない）。
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const P = require('../src/parade.js');
const {printModel} = require('../src/printer.js');
const E = require('../web/engine.js');

const args = process.argv.slice(2);
const binIx = args.indexOf('--bin'), BIN = binIx >= 0 ? args[binIx + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--bin')[0];
const SEC = {
  8: [{id: 'tp', n: 4}, {id: 'sd', n: 4}],
  20: [{id: 'tp', n: 8}, {id: 'cl', n: 8}, {id: 'sd', n: 4}],
  37: [{id: 'fl', n: 6}, {id: 'tp', n: 10}, {id: 'cl', n: 10}, {id: 'tb', n: 6}, {id: 'sd', n: 5}],
  60: [{id: 'fl', n: 8}, {id: 'tp', n: 14}, {id: 'cl', n: 14}, {id: 'tb', n: 12}, {id: 'sd', n: 12}],
  41: [{id: 'fl', n: 8}, {id: 'tp', n: 12}, {id: 'cl', n: 10}, {id: 'tb', n: 6}, {id: 'sd', n: 5}]
};
const VENUES = {
  gym: {type: 'gym', w: 30, d: 30}, stage: {type: 'stage', w: 16, d: 10, wing: 4},
  football: {type: 'football', level: 'hs'}, floor: {type: 'floor', w: 24, d: 18}
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function baseModel(field, secs) {
  return {name: 'parade-test', header: [], settings_notes: [], foot: [], field, tempo: 120, clearance: null, maxstep: null, look: null,
    sections: secs.map(s => ({id: s.id, label: s.id, n: s.n, color: null, instrument: null, note: [], tail: null})), sets: [], parts: []};
}
function toModel(field, secs, r) {
  const m = baseModel(field, secs);
  m.sets = r.sets.map((s, k) => ({name: s.name || String(k + 1), counts: s.counts, hold: s.hold, mark: s.mark, tempo: null, note: [], tail: s.label || null, foot: [], stmts: s.stmts}));
  return m;
}
function check(pattern, venue, n, ccw, extra) {
  const field = VENUES[venue], secs = SEC[n];
  const r = P.generate(Object.assign({field, sections: secs, pattern, ccw, stepM: 0.75, style: 'glide', laps: 1}, extra || {}));
  if (!r.ok) return {ok: false, skip: true, reason: r.error};
  const m = toModel(field, secs, r), src = printModel(m);
  const c = E.jinkeiCompile(src);
  const out = {ok: true, src, sets: m.sets.length, total: r.info.total, problems: [], notes: r.notes, info: r.info};
  if (!c.ok) { out.ok = false; out.problems.push('コンパイルできない: ' + (c.error && c.error.msg)); return out; }
  const D = c.data, W = D.warnings;
  const bad = k => W.filter(w => w.kind === k);
  ['衝突', '大股', '場外'].forEach(k => { const b = bad(k); if (b.length) out.problems.push(`${k} ${b.length}件: ${b[0].msg}`); });
  // セット数（一周で 14 以内。フットボール場・うずまき・2隊は余裕を持たせる）と、カウントは偶数
  const lim = (venue === 'football' ? 24 : 14) + (pattern === 'spiral' || pattern === 'split' ? 8 : 0);
  if (m.sets.length > lim) out.problems.push(`セットが多すぎる: ${m.sets.length}（上限 ${lim}）`);
  if (new Set(m.sets.map(s => s.name)).size !== m.sets.length) out.problems.push('セット名が重複');
  D.sets.forEach((s, k) => { if (k && s.counts && s.counts % 2) out.problems.push(`セット${s.name} のカウントが偶数でない: ${s.counts}`); });
  // カウントは整数か .5
  D.sets.forEach((s, k) => { if (k && Math.abs(s.counts * 2 - Math.round(s.counts * 2)) > 1e-9) out.problems.push(`セット${s.name} のカウントが整数・半分でない: ${s.counts}`); });
  // 一周して出発点に戻る（周回パターン）。往復は全員の重心が戻る
  let first = D.sets[0].pos;
  if (r.info.refAfterHold) { const k = D.sets.findIndex(s => s.hold > 0); first = D.sets[k].pos; }
  const lastMove = (() => { let k = D.sets.length - 1; while (k > 0 && D.sets[k].counts === 0) k--; return D.sets[k].pos; })();
  if (r.info.loop) {
    const lead = r.info.lead || [0];
    const maxd = Math.max(...first.map((p, i) => dist(p, lastMove[i])));
    const lim = r.info.follow ? 3.0 : 0.5;
    if (!(r.info.follow && pattern === 'spiral') && maxd > lim) out.problems.push(`一周して戻らない（最大 ${maxd.toFixed(2)} ずれ）`);
    if (pattern === 'spiral') { const d0 = dist(first[0], lastMove[0]); if (d0 > 1.5) out.problems.push(`先頭が出発点に戻らない（${d0.toFixed(2)}）`); }
  } else {
    const bb = ps => [Math.min(...ps.map(p => p[0])), Math.max(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])), Math.max(...ps.map(p => p[1]))];
    const b0 = bb(first), b1 = bb(lastMove);
    if (r.info.back && Math.max(...b0.map((v, i) => Math.abs(v - b1[i]))) > 1.5) out.problems.push('往復して戻らない（隊形の範囲）');
  }
  // 表示用に最大歩幅
  out.maxStep = Math.max(...D.max_step || [0]);
  if (BIN) {
    const f = path.join(os.tmpdir(), `pt_${pattern}_${venue}_${n}_${ccw ? 'l' : 'r'}.jk`);
    fs.writeFileSync(f, src);
    const rr = spawnSync(BIN, ['check', f], {encoding: 'utf8'});
    if (rr.status === 1 || /エラー/.test(rr.stdout + rr.stderr) && rr.status !== 0 && rr.status !== 2) out.problems.push('Rust check がエラー: ' + (rr.stderr || rr.stdout).slice(0, 120));
    else if (rr.status === 2) out.problems.push('Rust check が警告あり: ' + (rr.stdout || '').split('\n').slice(0, 2).join(' / '));
    else out.rust = 'ok';
  }
  return out;
}
// いまの隊形（体育館の中央付近に固まって立っている）から入る場合。入り口の移動も含めて衝突 0 か
function checkEntry(pattern, venue, n, ccw, shape) {
  const field = VENUES[venue], secs = SEC[n], V = P.core.venueOf(field);
  const mem = []; secs.forEach(s => { for (let i = 1; i <= s.n; i++) mem.push(s.id + i); });
  const cx = (V.area.x0 + V.area.x1) / 2, cy = (V.area.y0 + V.area.y1) / 2, per = Math.max(5, Math.ceil(Math.sqrt(n * 1.6)));
  const g = 1.4 / V.mpu;
  const cur = mem.map((_, i) => shape === 'rows' ? [cx + ((i % per) - (per - 1) / 2) * g, cy + (Math.floor(i / per) - 2) * g * 1.3] : [cx + ((i % 10) - 4.5) * g, cy - 3 / V.mpu - Math.floor(i / 10) * g]);
  const r = P.generate({field, sections: secs, pattern, ccw, stepM: 0.75, style: 'glide', laps: 1, entry: 'near', curPos: cur});
  if (!r.ok) return {skip: true, reason: r.error};
  const m = baseModel(field, secs);
  m.sets = [{name: '0', counts: 0, hold: 8, mark: false, tempo: null, note: [], tail: null, foot: [], stmts: mem.map((id, i) => ({idx: [i], group: id, shape: {kind: 'at', p: cur[i].map(v => Math.round(v * 1000) / 1000)}, xf: [], assign: null, wait: null, within: null, bend: null, face: null, step: null, action: null, pose: null, carry: null, note: [], tail: null}))}]
    .concat(r.sets.map((s, k) => ({name: String(k + 1), counts: k === 0 && !s.counts ? 0 : s.counts, hold: s.hold, mark: s.mark, tempo: null, note: [], tail: s.label || null, foot: [], stmts: s.stmts})));
  const c = E.jinkeiCompile(printModel(m));
  if (!c.ok) return {problems: ['コンパイルできない: ' + (c.error && c.error.msg)]};
  const W = c.data.warnings.filter(w => ['衝突', '大股', '場外'].includes(w.kind));
  return {problems: W.length ? [`入場つき: ${W.length}件 ${W[0].kind} ${W[0].msg}`] : []};
}
module.exports = {checkEntry, check, VENUES, SEC, toModel, baseModel};
if (require.main === module) {
  const pats = P.PATTERNS.map(p => p.id).filter(id => !only || id === only);
  let fail = 0, ok = 0, skip = 0;
  const rows = [];
  for (const pat of pats) for (const v of Object.keys(VENUES)) for (const n of [8, 20, 37, 41, 60]) for (const ccw of [true, false]) {
    const r = check(pat, v, n, ccw);
    const tag = `${pat}/${v}/${n}/${ccw ? '反時計' : '時計'}`;
    if (r.skip) { skip++; rows.push(`SKIP ${tag}  ${r.reason}`); if (v === 'gym' || v === 'football') { fail++; rows.push(`NG   ${tag}  体育館・フットボール場は人数に関わらず収まるはず: ${r.reason}`); } continue; }
    if (r.problems.length) { fail++; rows.push(`NG   ${tag}  sets=${r.sets}  ${r.problems.join(' | ')}`); } else { ok++; rows.push(`OK   ${tag}  sets=${r.sets} ${r.total}カウント${r.notes.length ? ' 注:' + r.notes.join('/') : ''}`); }
  }
  // 入り口（いまの隊形から）の移動を含めても衝突 0
  for (const pat of pats) for (const v of ['gym', 'stage', 'floor', 'football']) for (const n of [8, 20, 41]) for (const ccw of [true, false]) {
    const r = checkEntry(pat, v, n, ccw, 'rows');
    if (r.skip) continue;
    if (r.problems.length) { fail++; rows.push(`NG   入場/${pat}/${v}/${n}/${ccw ? '反時計' : '時計'}  ${r.problems.join(' | ')}`); } else ok++;
  }
  rows.filter(x => !x.startsWith('OK')).forEach(x => console.log(x));
  if (process.env.VERBOSE) rows.filter(x => x.startsWith('OK')).forEach(x => console.log(x));
  console.log(`\n合格 ${ok} / 失敗 ${fail} / 収まらない（理由つきで断った） ${skip}`);
  process.exit(fail ? 1 : 0);
}
