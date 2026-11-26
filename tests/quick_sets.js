#!/usr/bin/env node
// セットをすばやく作る機能（src/shortcuts_core.js の「セットの長さ」部分）の、画面に依存しないテスト。
// 使い方: node tests/quick_sets.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SC = require('../src/shortcuts_core.js');
const {printModel} = require('../src/printer.js');
const {jinkeiCompile} = require('../web/engine.js');
const root = path.resolve(__dirname, '..');
const load = f => jinkeiCompile(fs.readFileSync(path.join(root, 'examples', f), 'utf8'));
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);

// 1) カウントの並び
eq(SC.parseCountSeq('8 8 16 4 12').counts, [8, 8, 16, 4, 12]);
eq(SC.parseCountSeq('8x4 16 6').counts, [8, 8, 8, 8, 16, 6]);
eq(SC.parseCountSeq('8 x 4').counts, [8, 8, 8, 8], '空白あり');
eq(SC.parseCountSeq('8×2 4').counts, [8, 8, 4], '×');
eq(SC.parseCountSeq('(8 4)x2 16').counts, [8, 4, 8, 4, 16], 'かっこ');
eq(SC.parseCountSeq('((4)x2 8)x2').counts, [4, 4, 8, 4, 4, 8], 'かっこの入れ子');
eq(SC.parseCountSeq('８　８、16，4').counts, [8, 8, 16, 4], '全角・読点');
eq(SC.parseCountSeq('7.5 8.5').counts, [7.5, 8.5], '0.5刻み');
eq(SC.parseCountSeq('8,8;16|4').counts, [8, 8, 16, 4], '区切りいろいろ');
for (const bad of ['', '   ', 'abc', '8x', '8x0', '0', '0.3', '8.25', '(8', '8)', '1000', 'x4', '8xx2']) {
  const r = SC.parseCountSeq(bad);
  assert(!r.ok, `「${bad}」は失敗するはず`);
  if (bad.trim()) assert(r.errors.length > 0, `「${bad}」はエラーを返す`);
}
assert(SC.parseCountSeq('8 foo 16').errors.length === 1, '変な語は1か所のエラー');
eq(SC.parseCountSeq('8 foo 16').counts, [8, 16], '変な語は読み飛ばして続きを返す');
assert(!SC.parseCountSeq('1x500').ok, '繰り返しの上限');
assert(!SC.parseCountSeq('999x999').ok, '合計の上限');
eq(SC.parseCountSeq('8x4').total, 32);

// 2) 小節で
eq(SC.parseBarSeq('4 4 2x2 8', '4/4').counts, [16, 16, 8, 8, 32]);
eq(SC.parseBarSeq('4 2x2', '3/4').counts, [12, 6, 6], '3/4');
eq(SC.parseBarSeq('2 1', '6/8').counts, [6, 3], '6/8は1小節3カウント');
eq(SC.parseBarSeq('1', '7/8').counts, [3.5], '7/8');
assert(!SC.parseBarSeq('1', '7/16').ok, '7/16 は0.5カウント単位にならない');
assert(!SC.parseBarSeq('1.5', '4/4').ok, '小節数は整数');
assert(!SC.parseBarSeq('4', '4').ok, '拍子の書き方');
eq(SC.parseMeter('2/2').perBar, 4); eq(SC.parseMeter('12/8').perBar, 6); assert(SC.parseMeter('0/4') === null);
eq(SC.everyBars(4, 10), [4, 4, 2]); eq(SC.everyBars(4, 8), [4, 4]); eq(SC.everyBars(1, 3), [1, 1, 1]);

// 3) 名前
eq(SC.makeNames(['1', '2'], 3, 'num'), ['3', '4', '5']);
eq(SC.makeNames(['A', 'B'], 3, 'alpha'), ['C', 'D', 'E']);
eq(SC.makeNames([], 3, 'alpha'), ['A', 'B', 'C']);
eq(SC.makeNames(['intro', 'x'], 2, 'num'), ['3', '4'], '数字でない名前しかないとき');
eq(SC.makeNames(['1', '3'], 2, 'num'), ['4', '5'], '最大の次から');
eq(SC.makeNames(['m3'], 3, 'list', ['m3', 'm5', 'm5']), ['m3_2', 'm5', 'm5_2'], '重なる名前は避ける');
eq(SC.alphaName(0), 'A'); eq(SC.alphaName(25), 'Z'); eq(SC.alphaName(26), 'AA');
eq(SC.makeNames(['Z'], 2, 'alpha'), ['AA', 'AB']);

// 4) 小節線・タップ → カウント
const bars = [0, 4, 8, 12, 16, 20, 24];
const bb = SC.barBoundaries(bars, 2, 0);
eq(bb.points.map(p => p.t), [8, 16], '2小節ごと（頭の0は含めない）'); eq(bb.points.map(p => p.bar), [3, 5]); eq(bb.end, 24);
eq(SC.boundsToCounts(0, bb.points.map(p => p.t), bb.end).counts, [8, 8, 8]);
eq(SC.boundsToCounts(8, [16, 20], 24).counts, [8, 4, 4], '途中から');
eq(SC.boundsToCounts(0, [7.9, 16.2, 20.1], 32.4).counts, [8, 8, 4, 12.5], '丸め');
eq(SC.tapsToCounts([8.1, 15.9, 20.2], 32.1).counts, [8, 8, 4, 12], 'タップ → 0.5カウントに丸める');
eq(SC.tapsToCounts([8.2, 8.4], 16).counts, [8.5, 7.5], '近すぎる区切りは前のセットに足される');
eq(SC.tapsToCounts([], 12).counts, [12], '区切りなしなら1セット');
eq(SC.tapsToCounts([4, 4, 8], 16).counts, [4, 4, 8], '同じ時刻の区切りは1つ');
eq(SC.tapsToCounts([2.3, 6.8], 12.6).counts, [2.5, 4.5, 5.5], '0.5カウント単位');
eq(SC.seqSummary([8, 8, 16, 4, 4]), '8×2  16  4×2');

// 5) セットを作る → 書き出し → 読み込み（往復）
const roundtrip = (m, label) => {
  const s = printModel(m), r = jinkeiCompile(s);
  assert(r.ok, `${label}: ${r.error && r.error.msg}`);
  assert.equal(printModel(r.model), s, `${label}: 書き出し→読み込み→書き出し が一致`);
  return r;
};
{
  const R0 = load('gym.jk'), m0 = R0.model, K = m0.sets.length;
  const names0 = m0.sets.map(s => s.name);
  const plan = SC.planSets(m0, K - 1, [8, 8, 16, 4, 12], {copy: 'prev'});
  eq(plan.sets.map(s => s.counts), ['8', '8', '16', '4', '12']);
  const m1 = SC.insertSets(m0, K, plan.sets);
  assert.equal(m1.sets.length, K + 5);
  assert.equal(m0.sets.length, K, '元のモデルは変えない');
  const r1 = roundtrip(m1, 'gym+5');
  eq(r1.data.sets.slice(K).map(s => s.counts), [8, 8, 16, 4, 12], 'エンジン側のカウント');
  eq(r1.data.sets.slice(K).map(s => s.name), plan.names, 'セット名');
  assert(!names0.some(n => plan.names.includes(n)), '名前がかぶらない');
  // 隊形のコピー: 新しいセットの位置は、直前のセットと同じ（動かない）
  const last = R0.data.sets[K - 1].pos;
  for (const k of [K, K + 4]) r1.data.sets[k].pos.forEach((p, i) => assert(Math.hypot(p[0] - last[i][0], p[1] - last[i][1]) < 1e-6, `set ${k} person ${i} がコピー元と同じ位置`));
  // コピーで「個別に動かした人」を増やさない（元のセットに個別指定がなければ、新しいセットにも作らない）
  const lastInd = m0.sets[K - 1].stmts.filter(SC.isIndividual).length;
  for (const s of plan.sets) assert.equal(s.stmts.filter(SC.isIndividual).length, lastInd);
  // 全員その場: 空のセット
  const mh = SC.insertSets(m0, K, SC.planSets(m0, K - 1, [8, 8], {copy: 'hold'}).sets);
  const rh = roundtrip(mh, 'gym+hold');
  eq(rh.data.sets.slice(K).map(s => s.counts), [8, 8]);
  assert(mh.sets[K].stmts.length === 0);
  rh.data.sets[K].pos.forEach((p, i) => assert(Math.hypot(p[0] - last[i][0], p[1] - last[i][1]) < 1e-6));
  // 途中に入れる
  const mid = SC.insertSets(m0, 1, SC.planSets(m0, 0, [6, 6], {copy: 'prev', names: 'alpha'}).sets);
  const rm = roundtrip(mid, 'gym+mid');
  eq(rm.data.sets.map(s => s.name).slice(0, 4), [names0[0], 'A', 'B', names0[1]]);
  eq(rm.data.sets.slice(1, 3).map(s => s.counts), [6, 6]);
  // 長さの変更（counts / hold）
  const rs = SC.resizeSet(m0, 1, 12.3, 2);
  eq([rs.sets[1].counts, rs.sets[1].hold], ['12.5', '2'], '0.5刻みに丸める');
  eq(SC.resizeSet(m0, 0, 99, null).sets[0].counts, m0.sets[0].counts, '最初のセットの counts は触らない');
  assert(SC.resizeSet(m0, 1, 0, 0).sets[1].counts === '0.5', '最小は0.5');
  const rr = roundtrip(SC.resizeSet(m0, 1, 24, 4), 'resize');
  eq([rr.data.sets[1].counts, rr.data.sets[1].hold], [24, 4]);
  // 時刻
  const T = SC.setTimes(SC.insertSets(m0, K, SC.planSets(m0, K - 1, [8, 4], {}).sets));
  eq(T[K + 1].t0, T[K].t1); eq(T[K + 1].arrive, T[K].t1 + 4);
  eq(r1.data.total, SC.setTimes(m1)[K + 4].t1, 'エンジンの全体の長さと、モデルから数えた長さが一致');
}
// 6) 楽譜（part）の小節線に合わせる
{
  const R0 = load('battery.jk'), m0 = R0.model, D = R0.data;
  const b = SC.barTimes(D, -1);
  assert(b.length > 4 && b[0] === 0 && b[b.length - 1] === D.parts[0].end, '小節線と曲の終わり');
  eq(SC.barTimes(D, 0), b, '4つのパートが同じ小節なら、1つのパートと同じ');
  const origin = SC.setTimes(m0)[0].t1;
  const bd = SC.barBoundaries(b, 4, origin);
  const c = SC.boundsToCounts(origin, bd.points.map(p => p.t), bd.end);
  eq(c.counts.reduce((a, x) => a + x, 0), D.parts[0].end - origin, '曲の終わりまでぴったり');
  c.counts.slice(0, -1).forEach((x, i) => { assert.equal((c.from[i] + x) % 16, 0, '区切りは4小節（16カウント）の頭'); });
  const names = c.from.map(t => 'm' + (b.slice(0, -1).filter(x => x <= t + 1e-6).length));
  const mm = SC.insertSets(m0, 1, SC.planSets(m0, 0, c.counts, {names: 'list', nameList: names, copy: 'hold'}).sets);
  const r = roundtrip(mm, 'battery+song');
  eq(r.data.sets.slice(1, 1 + c.counts.length).map(s => s.counts), c.counts);
  eq(r.data.sets[1].name, 'm' + (b.filter(x => x <= origin + 1e-6).length), 'リハーサル番号の名前');
}
// 7) 拍子のあるパート（3/4 と 6/8）の小節線
{
  const src = `show "w" {\n  field gym\n  tempo 120\n  section tp "T" 2 instrument trumpet\n  set 1 hold 4 {\n    tp : line (-1, 0) -> (1, 0)\n  }\n  set 2 counts 12 {\n    tp : line (-2, 2) -> (2, 2)\n  }\n  part "p" for tp {\n    meter 3/4\n    4: r r r | r r r | r r r |\n  }\n}\n`;
  const r = jinkeiCompile(src);
  assert(r.ok, r.error && r.error.msg);
  eq(SC.barTimes(r.data, 0), [0, 3, 6, 9], '3/4 は1小節3カウント（最後は曲の終わり）');
  const bd = SC.barBoundaries(SC.barTimes(r.data, 0), 1, 0);
  eq(SC.boundsToCounts(0, bd.points.map(p => p.t), bd.end).counts, [3, 3, 3]);
  // 拍子から作ったカウントを、実際に入れて読み込める
  const m = SC.insertSets(r.model, 2, SC.planSets(r.model, 1, SC.parseBarSeq('2x2', '3/4').counts, {}).sets);
  const rr = roundtrip(m, '3/4');
  eq(rr.data.sets.slice(2).map(x => x.counts), [6, 6]);
}
console.log('quick_sets: OK');
