#!/usr/bin/env node
// 自動修正の「判断AI」（候補の並べ替え）のテスト。
//   node tests/fix_ai.js [--bin target/release/jinkei] [--n 40]
// 1) モデルの JSON が3か所（assets/fix_model.json・src/fix_model.json・web/engine.js の欄）で同じ
// 2) 「総当たり以上」の保証: 保持データ（学習に使っていないシード）のショーで、判断AI版の最終結果が総当たりより悪くならない
//      （衝突の数 ×10 + ほかの警告の数 で比べる。同じ or 良い）
// 3) 並べ替えで評価回数が減る（総当たり以下）／直せるものは総当たりと同じだけ直る
// 4) --bin があれば、Rust 版（jinkei fix）が JS 版と同じ修正案・同じ件数を返す
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const E = require('../web/engine.js');
const {genShow} = require('../tools/gen_shows.js');
const ROOT = path.resolve(__dirname, '..');
const A = process.argv.slice(2);
const opt = (n, d) => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : d; };
const N = +opt('--n', 40);
const BIN = opt('--bin', null);

// 1) モデルの一致
const m1 = fs.readFileSync(path.join(ROOT, 'assets/fix_model.json'), 'utf8').trim();
const m2 = fs.readFileSync(path.join(ROOT, 'src/fix_model.json'), 'utf8').trim();
const em = fs.readFileSync(path.join(ROOT, 'web/engine.js'), 'utf8').match(/\/\*FIXMODEL\*\/\nconst FIX_MODEL = ([\s\S]*?);\n\/\*ENDFIXMODEL\*\//);
assert(em, 'engine.js にモデル欄がありません');
assert.strictEqual(m1, m2, 'assets/fix_model.json と src/fix_model.json が違います');
assert.strictEqual(JSON.stringify(JSON.parse(m1)), JSON.stringify(JSON.parse(em[1])), 'engine.js のモデルが assets/fix_model.json と違います');
const model = JSON.parse(m1);
assert(model.trees.length >= 10 && m1.length < 20000, 'モデルが小さな JSON（数KB〜十数KB）');

// 2) 3) 保持データでの比較
const TEST0 = 500001;
const showFor = sd => genShow(sd, {members: 8 + (sd * 7) % 17, sets: 3 + (sd % 4)});
let n = 0, equal = 0, better = 0, evEx = 0, evAi = 0, fixedEx = 0, fixedAi = 0;
const rustCases = [];
for (let sd = TEST0; n < N && sd < TEST0 + 400; sd++) {
  const s = showFor(sd);
  const r = E.jinkeiCompile(s);
  if (!r.ok || !r.data.warnings.some(w => w.kind === '衝突')) continue;
  E.jinkeiMemoClear();
  const ex = E.jinkeiFix(s, {exhaustive: true, stats: true});
  E.jinkeiMemoClear();
  const ai = E.jinkeiFix(s, {stats: true});
  n++;
  const wEx = ex.after * 10 + ex.others[1], wAi = ai.after * 10 + ai.others[1];
  assert(wAi <= wEx, `シード ${sd}: 判断AI版 ${ai.after}/${ai.others[1]} が総当たり ${ex.after}/${ex.others[1]} より悪い`);
  assert(ai.after <= ai.before && ai.others[1] <= ai.others[0] + 10 * 0 + (ai.before - ai.after) * 10, `シード ${sd}: 修正で悪化`);
  if (wAi === wEx) equal++; else better++;
  evEx += ex.stat.evals; evAi += ai.stat.evals + (ai.stat.guidedEvals || 0);
  if (ex.after === 0) fixedEx++; if (ai.after === 0) fixedAi++;
  assert(fixedAi >= fixedEx, `シード ${sd}: 総当たりで直せたのに判断AI版では直せない`);
  rustCases.push({sd, s, ai});
}
assert(n >= Math.min(N, 10), '衝突のあるショーが足りません');
assert(evAi <= evEx * 1.0001, `評価回数が総当たりより増えています（${evAi} > ${evEx}）`);
console.log(`fix_ai: ${n} 本（保持データ）で 総当たり以上: 同じ ${equal} / 良い ${better} / 悪い 0。直せた本数 総当たり ${fixedEx} = 判断AI ${fixedAi}。評価回数 ${evEx} → ${evAi}（${(evEx / Math.max(1, evAi)).toFixed(2)}倍）`);

// 4) Rust と一致
if (BIN) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jk-fixai-'));
  let same = 0;
  for (const {sd, s, ai} of rustCases.slice(0, 25)) {
    const p = path.join(tmp, `s${sd}.jk`); fs.writeFileSync(p, s);
    const out = spawnSync(path.resolve(ROOT, BIN), ['fix', p], {encoding: 'utf8'}).stdout;
    const notes = out.split('\n').filter(l => l.startsWith('  ・')).map(l => l.slice(3));
    if (ai.notes.length === 0) { assert(/見つかりませんでした/.test(out), `シード ${sd}: Rust は直せるのに JS は直せない`); same++; continue; }
    assert.deepStrictEqual(notes, ai.notes, `シード ${sd}: Rust と JS の修正案が違います`);
    assert(out.includes(`衝突 ${ai.before}件 → ${ai.after}件`), `シード ${sd}: 件数が違います`);
    same++;
  }
  console.log(`fix_ai: Rust 版と JS 版が ${same} 本で同じ修正案`);
}
console.log('fix_ai: OK');
