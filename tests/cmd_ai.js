#!/usr/bin/env node
// 日本語で指示する「判断AI」（src/cmd_core.js ＋ src/cmd_model.json）のテスト。
//   node tests/cmd_ai.js [--quick]
// 1) モデルの大きさ（500KB 未満）・3か所のファイルが同じ・型つきの行動の一覧（40〜70個）
// 2) 漏れ検査: 学習 / 較正 / 保持 のテンプレートが重ならない。手書きの指示が学習データに入っていない
// 3) 精度: 保持データ（別のテンプレート・言い回し）と、手書き 208 文（dev 108 ＋ test 100）で
//      意図の正解率・値の一致・ECE・「まちがった行動を実行した」割合（1% 未満）
// 4) 安全: 削除・切り取りは確認なしには実行されない。わからない文は実行されない
// 5) 速さ: 1回の判断が 20ms 未満（p99）
// 6) 画面側（src/cmd_ui.js）が、全部の行動に実行を持っている
// 画面での通し（入力 → 確認 → 実行 → 元に戻す）は tests/cmd_ai_e2e.py
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/cmd_core.js'));
const {genSet, TPL} = require(path.join(ROOT, 'tools/cmd_corpus.js'));
const EV = require(path.join(ROOT, 'tools/cmd_eval.js'));
const QUICK = process.argv.includes('--quick');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const pc = x => (x * 100).toFixed(1) + '%';

// ---------------------------------------------------------------- 1) モデル
const f1 = fs.readFileSync(path.join(ROOT, 'assets/cmd_model.json'), 'utf8'), f2 = fs.readFileSync(path.join(ROOT, 'src/cmd_model.json'), 'utf8');
ok(f1 === f2, 'assets/cmd_model.json と src/cmd_model.json が違います');
ok(f1.length < 500 * 1024, `モデルが大きすぎます: ${(f1.length / 1024).toFixed(0)}KB`);
const model = JSON.parse(f1);
C.loadModel(model);
ok(C.modelReady(), 'モデルが読み込めていません');
ok(model.policy && model.policy.high > 0.5, 'しきい値がありません');
ok(model.info && model.info.held && model.info.held.wrong < 0.01, '学習時の保持データで まちがい実行 1% 未満になっていません');
const intents = C.INTENTS.filter(i => i !== 'none');
ok(intents.length >= 40 && intents.length <= 70, `行動の数 ${intents.length}`);
ok(C.INTENTS.includes('none'), 'none（わからない）がありません');
console.log(`モデル ${(f1.length / 1024).toFixed(0)}KB・行動 ${intents.length} 個（+わからない）・温度 T=${model.T}・しきい値 high=${model.policy.high} margin=${model.policy.margin}`);

// ---------------------------------------------------------------- 2) 漏れ検査
{
  let overlap = 0;
  for (const [intent, lists] of Object.entries(TPL)) {
    const A = new Set(lists[0]), B = new Set(lists[1]), Cc = new Set(lists[2] || []);
    for (const t of B) if (A.has(t) || Cc.has(t)) overlap++;
    for (const t of Cc) if (A.has(t)) overlap++;
  }
  ok(overlap === 0, `テンプレートが ${overlap} 個、train / dev / held で重なっています`);
  const raw = genSet('train', 1, 60000, {noneRate: 0.07, compoundRate: 0}).filter(x => x.intent !== 'compound');
  const hand = EV.loadHand('cmd_hand_dev.tsv').concat(EV.loadHand('cmd_hand_test.tsv'));
  ok(hand.length >= 150, `手書きの指示が ${hand.length} 文しかありません`);
  const handSet = new Set(hand.map(h => C.norm(h.text)));
  const same = raw.filter(x => handSet.has(C.norm(x.text))).length;
  // 手書きと同じ文は、学習のデータから外してある（外した数が、学習時に記録した数と一致する）
  ok(model.info.handExcluded === same, `手書きと同じ学習文を外した数が合いません: 記録 ${model.info.handExcluded} / 今 ${same}`);
  ok(same > 0, '漏れ検査が働いていません（同じ文が1つも見つかりません）');
  const trainTexts0 = new Set(raw.map(x => C.norm(x.text)).filter(t => !handSet.has(t)));
  const leak = hand.filter(h => trainTexts0.has(C.norm(h.text)));
  ok(leak.length === 0, `手書きの指示が学習データに入っています: ${leak.slice(0, 3).map(x => x.text).join(' / ')}`);
  console.log(`漏れ検査: テンプレートの重なり 0 / 手書き ${hand.length} 文のうち、学習データに入っていた同じ文 ${same} 件は学習から外した / 外したあとの重なり ${leak.length}`);
}

// ---------------------------------------------------------------- 3) 精度
const heldN = QUICK ? 1500 : 6000;
const handHas = new Set(EV.loadHand('cmd_hand_dev.tsv').concat(EV.loadHand('cmd_hand_test.tsv')).map(x => C.norm(x.text)));
const held = genSet('held', 1, Math.round(heldN * 1.1), {noneRate: 0.06, compoundRate: 0.04}).filter(x => true);
const trainTexts = new Set(genSet('train', 1, 60000, {noneRate: 0.07, compoundRate: 0}).map(x => C.norm(x.text)).filter(t => !handHas.has(t)));
const heldClean = held.filter(x => !trainTexts.has(C.norm(x.text))).slice(0, heldN);
const RH = EV.evaluate(C, heldClean, {});
const handDev = EV.loadHand('cmd_hand_dev.tsv'), handTest = EV.loadHand('cmd_hand_test.tsv');
const RD = EV.evaluate(C, handDev, {}), RT = EV.evaluate(C, handTest, {});
const RA = EV.evaluate(C, handDev.concat(handTest), {});
const line = (nm, r) => `${nm.padEnd(10)} n=${String(r.n).padEnd(5)} 意図 ${pc(r.acc)}  上位3 ${pc(r.top3acc)}  値一致 ${pc(r.slotEM)} (${r.slotOk}/${r.slotN})  ECE ${pc(r.ece)}  実行できた ${pc(r.coverage)}  まちがい実行 ${pc(r.wrongRate)}（行動 ${pc(r.wrongActionRate)}）  複合 ${r.compAcc == null ? '-' : pc(r.compAcc)}  none誤実行 ${r.noneRun}/${r.noneN}`;
console.log(line('保持(合成)', RH)); console.log(line('手書き dev', RD)); console.log(line('手書き test', RT)); console.log(line('手書き全体', RA));
ok(RH.acc >= 0.80, `保持データの意図の正解率 ${pc(RH.acc)}`);
ok(RH.top3acc >= 0.90, `保持データの上位3の正解率 ${pc(RH.top3acc)}`);
ok(RH.slotEM >= 0.88, `保持データの値の一致 ${pc(RH.slotEM)}`);
ok(RH.ece <= 0.06, `保持データの ECE ${pc(RH.ece)}`);
ok(RH.wrongRate < 0.01, `保持データで まちがった行動を実行した割合 ${pc(RH.wrongRate)}`);
ok(RH.noneRun === 0, 'わからない文を実行してしまいました');
ok(RT.acc >= 0.85 && RT.slotEM >= 0.95, `手書き test: 意図 ${pc(RT.acc)} 値 ${pc(RT.slotEM)}`);
ok(RA.wrongRate < 0.01, `手書きで まちがい実行 ${pc(RA.wrongRate)}`);
ok(RA.ece <= 0.08, `手書きの ECE ${pc(RA.ece)}`);
ok(RA.compAcc == null || RA.compAcc >= 0.9, `複合の指示の正解率 ${RA.compAcc}`);
ok(RH.coverage >= 0.2 && RA.coverage >= 0.5, `確認なしで実行できる割合が低すぎます: 保持 ${pc(RH.coverage)} / 手書き ${pc(RA.coverage)}`);

// ---------------------------------------------------------------- 4) 安全・仕組み
const ctx = EV.fixtureCtx('@tp');
for (const t of ['tp3を削除して', 'トランペットを全部消して', '選んだ人を切り取って', 'このセットを削除して', '選んだ人を消して', 'ホルンを削除', 'tp1とtp2を削除して']) {
  const d = C.decideOne(t, ctx);
  ok(d.status !== 'run', `削除・切り取りが確認なしで実行されます: ${t} → ${d.intent} ${d.status}`);
}
for (const t of ['あしたの天気は', 'こんにちは', 'ラーメンが食べたい', 'ふむふむ', '12345', '']) {
  const d = C.decideOne(t, ctx);
  ok(d.status === 'unknown' || d.status === 'choose' || d.status === 'ask', `関係のない文が実行されます: ${t} → ${d.intent} ${d.status}`);
}
{   // 決定の形（Jev 型）
  const d = C.decide('トランペットを前に3歩動かして', EV.fixtureCtx(''));
  ok(d.action === 'move' && d.status === 'run' && d.confidence > 0.9 && d.alternatives.length === 3 && d.args.dirs[0] === 'front' && d.args.amount.v === 3, '決定の形が違います');
  const c = C.decide('トランペットを選んで前に3歩、それから円にして', EV.fixtureCtx(''));
  ok(c.action === 'compound' && c.args.steps.length === 3 && c.args.steps.map(s => s.action).join() === 'select,move,arrange_circle', '複合の分け方が違います');
  const q = C.decide('前に動かして', EV.fixtureCtx(''));
  ok(q.status === 'ask' && q.missing.length > 0 && q.missing[0].choices.length > 0, '足りない値の質問が出ません');
  const w = C.decide('全員を選んで前に5歩、それをさらに右に2歩', EV.fixtureCtx(''));
  ok(w.args && w.args.steps && w.args.steps.length === 3, `「それ」の複合が分かれていません ${JSON.stringify(w.args && w.args.steps && w.args.steps.length)}`);
}
{   // 代名詞（それ・選んだ人）は、いま選んでいる人
  const d = C.decideOne('それを右に3歩動かして', EV.fixtureCtx('@tb'));
  const ids = C.resolveTarget(d.args.target, EV.fixtureCtx('@tb'));
  ok(d.intent === 'move' && ids.length === 6 && ids.every(i => i.startsWith('tb')), '「それ」が選んでいる人になりません');
}
{   // 実際のショーの名前（別名・番号・セクション）を読む
  const cx = {sections: [{id: 'hr', label: 'ホルン', n: 4}, {id: 'fl', label: 'フルート', n: 3}], members: [], sel: [], sets: ['1', '2'], curSet: 0, field: {type: 'gym'}, stride: 0.625, beatsPerBar: 4};
  for (const s of cx.sections) for (let i = 1; i <= s.n; i++) cx.members.push({id: s.id + i, sec: cx.sections.indexOf(s), x: i, y: cx.sections.indexOf(s)});
  const d = C.decideOne('ホルンを前に2歩', cx);
  ok(d.intent === 'move' && C.resolveTarget(d.args.target, cx).join() === 'hr1,hr2,hr3,hr4', 'ホルンが読めません');
  const e = C.decideOne('fl2を左に1m', cx);
  ok(e.intent === 'move' && C.resolveTarget(e.args.target, cx).join() === 'fl2', 'fl2 が読めません');
}

// ---------------------------------------------------------------- 5) 速さ
{
  const texts = handDev.concat(handTest).map(h => h.text), cx = EV.fixtureCtx('@tp'), ms = [];
  for (let r = 0; r < 3; r++) for (const t of texts) { const t0 = process.hrtime.bigint(); C.understand(t, cx); ms.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  ms.sort((a, b) => a - b);
  const p50 = ms[Math.floor(ms.length * 0.5)], p99 = ms[Math.floor(ms.length * 0.99)];
  console.log(`速さ: p50 ${p50.toFixed(2)}ms / p99 ${p99.toFixed(2)}ms（${ms.length} 回）`);
  ok(p99 < 20, `遅すぎます p99=${p99.toFixed(1)}ms`);
}

// ---------------------------------------------------------------- 6) 画面側が全部の行動を実行できる
{
  const ui = fs.readFileSync(path.join(ROOT, 'src/cmd_ui.js'), 'utf8');
  const miss = intents.filter(id => !(new RegExp('(^|\\n|[,{])\\s*(async\\s+)?' + id + '\\s*[(:]').test(ui) || (C.ARR_KIND[id] && /for \(const k of Object\.keys\(CMD\.ARR_KIND\)\)/.test(ui))));
  ok(!miss.length, '画面側に実行が無い行動: ' + miss.join(','));
  // 3か所に組み込まれている
  for (const f of ['src/server.rs', 'tools/build_browser_app.js']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    ok(/cmd_core\.js/.test(t) && /cmd_ui\.js/.test(t) && /cmd_model\.json/.test(t), `${f} に組み込まれていません`);
  }
}
console.log(`cmd_ai: ${n} 項目 OK`);
