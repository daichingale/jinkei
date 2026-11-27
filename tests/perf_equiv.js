#!/usr/bin/env node
// 性能改善（差分コンパイル・高速な最接近・自動修正の並べ替え）で「結果が変わっていない」ことの確認。
//   node tests/perf_equiv.js            tests/fixtures/golden_perf.json と比べる
//   node tests/perf_equiv.js --make [--engine 元のengine.js]   元のエンジンから基準値を作り直す
// 基準値 = 例・web/cases・シード固定の自動生成ショー 120 本の、コンパイル結果（JSON）の SHA-256 と、
//          総当たりの自動修正（exhaustive）の「前→後の件数」と「直したあとのソースのコンパイル結果」の SHA-256。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const {genShow} = require('../tools/gen_shows.js');
const ROOT = path.resolve(__dirname, '..');
const A = process.argv.slice(2);
const opt = (n, d) => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : d; };
function load(file) {
  if (!opt('--engine')) return require(path.resolve(ROOT, file));
  const ctx = {module: {exports: {}}, console, Math, Number, JSON, Map, Set, Array, Object, String, Error, RegExp, Infinity, NaN, isFinite, parseFloat, parseInt, Symbol, WeakMap};
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.module.exports;
}
const E = load(opt('--engine', 'web/engine.js'));
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const cases = {};
for (const f of fs.readdirSync(path.join(ROOT, 'examples')).filter(f => f.endsWith('.jk')).sort()) cases['ex:' + f] = fs.readFileSync(path.join(ROOT, 'examples', f), 'utf8');
for (const f of fs.readdirSync(path.join(ROOT, 'web/cases')).filter(f => f.endsWith('.jk')).sort()) cases['case:' + f] = fs.readFileSync(path.join(ROOT, 'web/cases', f), 'utf8');
for (let sd = 1; sd <= 120; sd++) cases['gen:' + sd] = genShow(sd, {members: [8, 12, 16, 24, 32][sd % 5], sets: 3 + (sd % 6)});
const FIXN = 40;   // 自動修正は先頭の40本だけ（時間がかかるため）
const out = {};
let nfix = 0;
for (const [k, src] of Object.entries(cases)) {
  const r = E.jinkeiCompile(src);
  const row = {c: sha(JSON.stringify(r))};
  if (k.startsWith('gen:') && nfix < FIXN && r.ok && r.data.warnings.some(w => w.kind === '衝突')) {
    nfix++;
    const fx = (E.jinkeiFix.length > 1 || opt('--engine') === undefined) ? E.jinkeiFix(src, {exhaustive: true}) : E.jinkeiFix(src);
    row.f = [fx.ok, fx.before, fx.after, fx.others && fx.others.join('/'), sha(JSON.stringify(fx.model)), fx.notes && fx.notes.length];
  }
  out[k] = row;
}
const GOLD = path.join(ROOT, 'tests/fixtures/golden_perf.json');
if (A.includes('--make')) { fs.writeFileSync(GOLD, JSON.stringify(out)); console.log('基準値を書きました:', Object.keys(out).length, '件（修正あり', nfix, '件）'); process.exit(0); }
const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
let bad = 0;
for (const k of Object.keys(gold)) {
  const g = gold[k], o = out[k];
  if (!o || g.c !== o.c) { bad++; console.error('コンパイル結果が違います:', k); }
  else if (g.f && JSON.stringify(g.f) !== JSON.stringify(o.f)) { bad++; console.error('自動修正（総当たり）の結果が違います:', k, JSON.stringify(g.f), JSON.stringify(o.f)); }
}
if (bad) { console.error(bad + ' 件の違い'); process.exit(1); }
console.log(`perf_equiv: OK（コンパイル ${Object.keys(gold).length} 件・総当たり修正 ${nfix} 件が元のエンジンと完全一致）`);
