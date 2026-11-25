#!/usr/bin/env node
// 初心者向けUI（かんたん作成）の画面に依存しない部分のテスト。
// 使い方: node tests/ux_core.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const X = require('../src/ux_core.js');
const {printModel} = require('../src/printer.js');
const {jinkeiCompile, jinkeiFix} = require('../web/engine.js');
const root = path.resolve(__dirname, '..');

// 1) どの会場・編成・形でも、置いた直後に「ぶつかる」「場外」がない
let n = 0;
for (const v of X.VENUES) for (const p of X.PRESETS) {
  const m = X.buildModel({venue: v.id, counts: p.counts, forms: ['line', ...X.FORMS.map(f => f.id)], bpm: 120, moveCount: 16});
  const r = jinkeiCompile(printModel(m));
  assert(r.ok, `${v.id}/${p.id}: ${r.error && r.error.msg}`);
  assert.equal(r.data.performers.length, X.total(p.counts), '人数が合う');
  r.data.sets.forEach((s, k) => {
    const bad = r.data.warnings.filter(w => w.set === k && (w.kind === '場外' || (w.kind === '衝突' && !/移動中/.test(w.msg))));
    assert.equal(bad.length, 0, `${v.id}/${p.id}/set${k}: ${bad.map(w => w.msg).join(' | ')}`);
  });
  n++;
}
// 2) 既定の流れは、自動で仕上げると衝突0・警告0になる
(async () => {
  for (const [v, p] of [['gym', 'band30'], ['football', 'small8'], ['stage', 'guard'], ['floor', 'drum']]) {
    const forms = ['block', 'arc', 'circle', 'company-front'];
    const preset = X.PRESETS.find(x => x.id === p);
    const m = X.buildModel({venue: v, counts: preset.counts, forms, bpm: 120, moveCount: 16});
    const field = X.VENUES.find(x => x.id === v).field;
    const log = await X.finalize(m, {print: printModel, compile: async s => jinkeiCompile(s), fix: async s => jinkeiFix(s)},
      {forms: forms.slice(), V: X.venueGeom(field), secs: X.sectionsFromCounts(preset.counts)});
    assert(log.ok, log.error);
    assert.equal(log.after, 0, `${v}/${p}: 衝突が残った`);
    assert.equal(log.other, 0, `${v}/${p}: 大股・場外が残った`);
  }
  // 3) 部品
  assert.equal(X.groupStr([{s: 'tp', i: 1, n: 3}, {s: 'tp', i: 2, n: 3}, {s: 'tp', i: 3, n: 3}, {s: 'tb', i: 2, n: 4}, {s: 'tb', i: 3, n: 4}]), 'tp + tb2..tb3');
  assert(/^<svg/.test(X.miniSvg({type: 'gym', w: 30, d: 30}, [{x: 0, y: 0, color: '#fff'}])), 'ミニ図はSVG');
  const D = jinkeiCompile(fs.readFileSync(path.join(root, 'examples', 'snare.jk'), 'utf8')).data;
  const f = X.friendly(D, {set: 1, kind: '衝突', msg: 'セット2への移動中（3.5カウント目）: sn1 と sn2 が 0.31m まで接近', who: [0, 1]}, '2');
  assert(/ぶつかりそう/.test(f.title) && /スネア/.test(f.body) && f.acts.includes('fix'), f.body);
  assert(X.GUIDES.length >= 8 && X.GLOSSARY.length >= 12);
  // 4) 埋め込み用ファイルの構文と、エディタのプレースホルダ
  for (const file of ['ux.js', 'ux_core.js']) new Function(fs.readFileSync(path.join(root, 'src', file), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'src', 'editor.html'), 'utf8');
  for (const ph of ['__UX_CSS__', '__UI_ICONS__', '__EXAMPLES__', '__UX_CORE__', '__UX__']) assert(html.includes(ph), ph);
  console.log(`OK ux_core: ${n}通りの会場×編成、既定の流れ4通りの自動仕上げ、部品`);
})().catch(e => { console.error(e); process.exit(1); });
