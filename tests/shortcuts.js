#!/usr/bin/env node
// ショートカット・メンバー削除/追加（src/shortcuts_core.js）の、画面に依存しない部分のテスト。
// 使い方: node tests/shortcuts.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SC = require('../src/shortcuts_core.js');
const {printModel} = require('../src/printer.js');
const {jinkeiCompile} = require('../web/engine.js');
const root = path.resolve(__dirname, '..');
const opts = mode => ({mode, compile: async s => jinkeiCompile(s), print: printModel, fix: null});
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

(async () => {
  // 1) キー表記・競合・保存形式
  assert.equal(SC.normCombo('Shift+Mod+Z'), 'Mod+Shift+z');
  assert.equal(SC.comboLabel('Mod+Shift+z', false), 'Ctrl+Shift+Z');
  assert.equal(SC.comboLabel('Mod+Shift+z', true), '⌘⇧Z');
  assert.deepEqual(SC.comboCaps('Delete', false), ['Delete']);
  const defs = {a: ['Mod+z'], b: ['Delete', 'Backspace'], c: ['x']};
  assert.deepEqual(SC.conflictsOf(defs, 'c', 'Mod+Z'), ['a']);
  assert.deepEqual(SC.conflictsOf(defs, 'c', 'q'), []);
  const cur = SC.mergeKeymap(defs, {a: ['Mod+y'], zz: ['q'], b: 'bad', c: [1]});
  assert.deepEqual(cur.a, ['Mod+y']); assert.deepEqual(cur.b, defs.b); assert.deepEqual(cur.c, defs.c); assert(!cur.zz);
  assert.deepEqual(SC.diffKeymap(defs, cur), {a: ['Mod+y']});
  assert.deepEqual(SC.diffKeymap(defs, defs), {});
  const ev = (o) => Object.assign({key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false}, o);
  assert.equal(SC.evCombo(ev({key: 'z', code: 'KeyZ', metaKey: true})), 'Mod+z');
  assert.equal(SC.evCombo(ev({key: 'Delete', code: 'Delete', shiftKey: true})), 'Shift+Delete');
  assert.equal(SC.evCombo(ev({key: '?', code: 'Slash', shiftKey: true})), '?');
  assert(SC.isModifierKey(ev({key: 'Shift'})));

  // 2) あいまい検索（日本語・ひらがな・ローマ字）
  const a = {name: '選んだ人を削除', kw: 'さくじょ けす delete', group: '編集'};
  assert(SC.fuzzyScore('削除', a) > 0);
  assert(SC.fuzzyScore('さくじょ', a) > 0);
  assert(SC.fuzzyScore('sakujo', a) > 0, 'ローマ字');
  assert(SC.fuzzyScore('del', a) > 0);
  assert.equal(SC.fuzzyScore('ぜんぜんちがう', a), 0);
  assert(SC.fuzzyScore('', a) > 0);

  // 3) 全サンプルで、削除・追加・貼り付けをしても他の人の位置が1ミリも動かない
  let checked = 0;
  for (const f of fs.readdirSync(path.join(root, 'examples')).filter(x => /\.jk$/.test(x))) {
    const R = jinkeiCompile(fs.readFileSync(path.join(root, 'examples', f), 'utf8'));
    if (!R.ok) continue;
    const D = R.data, ids = D.performers.map(p => p.id);
    if (ids.length < 5) continue;
    const rm = [ids[1], ids[4]];
    const r = await SC.deleteMembers(R.model, rm, opts('keep'));
    assert(r.ok, `${f}: ${r.error}`);
    const t = printModel(r.model), c = jinkeiCompile(t);
    assert(c.ok, `${f}: 削除後に読み込めない`);
    assert.equal(c.data.performers.length, ids.length - 2, `${f}: 人数`);
    assert.equal(c.data.sets.length, D.sets.length, `${f}: セット数`);
    // 残った人の位置は全セットで同じ（名前は詰め直される）
    const left = ids.filter(i => !rm.includes(i));
    left.forEach((oid, n) => {
      const oi = ids.indexOf(oid);
      // 同じ位置の人が、削除後のどこかにいる（名前の振り直しがあるので位置で照合）
      for (let k = 0; k < D.sets.length; k++) {
        const hit = c.data.performers.findIndex((p, j) => dist(c.data.sets[k].pos[j], D.sets[k].pos[oi]) <= 1e-3);
        assert(hit >= 0, `${f}: ${oid} がセット${k + 1}で動いた`);
      }
    });
    assert(r.exact, `${f}: 完全には元どおりになっていない (${r.maxDiff})`);
    // 詰める削除は読み込めること
    const r2 = await SC.deleteMembers(R.model, rm, opts('reflow'));
    assert(r2.ok, `${f}: 詰める削除 ${r2.error}`);
    assert(jinkeiCompile(printModel(r2.model)).ok, `${f}: 詰めた後に読み込めない`);
    // 往復
    const c2 = jinkeiCompile(printModel(c.model));
    assert(c2.ok && printModel(c2.model) === printModel(c.model), `${f}: 往復で変わる`);
    // 追加: 既存の人は動かず、新しい人は他とぶつからない
    const ad = await SC.addMembers(R.model, [ids[2]], opts('keep'));
    assert(ad.ok, `${f}: 追加 ${ad.error}`);
    const ca = ad.compiled;
    assert.equal(ca.data.performers.length, ids.length + 1, `${f}: 追加後の人数`);
    assert(ad.exact, `${f}: 追加で他の人が動いた`);
    const still = ad.warnings.filter(w => !/移動中/.test(w));
    assert.equal(still.length, 0, `${f}: 追加した人が止まっている位置で警告 ${still.join(' / ')}`);
    // 貼り付け: 1人の位置を別のセットへ
    if (D.sets.length > 1) {
      const m = SC.pastePositions(R.model, 1, [{id: ids[2], p: [D.sets[0].pos[2][0], D.sets[0].pos[2][1]]}]);
      const cp = jinkeiCompile(printModel(m));
      assert(cp.ok && dist(cp.data.sets[1].pos[2], D.sets[0].pos[2]) <= 1e-3, `${f}: 貼り付け`);
    }
    checked++;
  }
  assert(checked >= 4, '確かめたサンプルが少ない: ' + checked);

  // 4) 貼り付け先の決め方
  const clip = [{id: 'tp1', p: [0, 0]}, {id: 'tp2', p: [1, 0]}];
  assert.equal(SC.pasteTargets(clip, [], ['tp1', 'tp2', 'tp3']).mode, 'same');
  assert.equal(SC.pasteTargets(clip, ['tp3', 'tp1'], ['tp1', 'tp2', 'tp3']).mode, 'order');

  // 5) 部品・差し込み口がそろっている
  for (const f of ['src/shortcuts.js', 'src/shortcuts_core.js']) new Function(fs.readFileSync(path.join(root, f), 'utf8')); // 構文だけ確かめる
  const html = fs.readFileSync(path.join(root, 'src/editor.html'), 'utf8');
  for (const ph of ['__SC_CORE__', '__SC__']) assert(html.includes(ph), ph);
  const css = fs.readFileSync(path.join(root, 'src/ux.css'), 'utf8');
  for (const sel of ['#scpal', '#scsheet', '#scfloat', '.sct']) assert(css.includes(sel), sel);
  console.log(`shortcuts: OK (${checked} 例で削除・追加・貼り付けを確認)`);
})().catch(e => { console.error(e); process.exit(1); });
