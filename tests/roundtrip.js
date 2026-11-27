// 往復テスト: ソース → 編集モデル → ソース で、全員の位置・警告・コメントが変わらないこと
// 実行: node tests/roundtrip.js target/release/jinkei examples/*.jk
const {execFileSync} = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const {printModel} = require('../src/printer.js');
const [bin, ...files] = process.argv.slice(2);
let fail = 0;
for (const f of files) {
  const model = JSON.parse(execFileSync(bin, ['model', f], {maxBuffer: 1 << 28}).toString());
  const out = printModel(model);
  const tmp = path.join(os.tmpdir(), 'rt_' + path.basename(f));
  fs.writeFileSync(tmp, out);
  const a = JSON.parse(execFileSync(bin, ['json', f], {maxBuffer: 1 << 28}).toString());
  const b = JSON.parse(execFileSync(bin, ['json', tmp], {maxBuffer: 1 << 28}).toString());
  const same = JSON.stringify(a.sets) === JSON.stringify(b.sets) && JSON.stringify(a.warnings) === JSON.stringify(b.warnings) && JSON.stringify(a.parts) === JSON.stringify(b.parts) && a.name === b.name;
  const comments = s => (s.match(/#.*$/gm) || []).map(c => c.replace(/^#\s?/, '').trim()).filter(Boolean).sort();
  const lost = comments(fs.readFileSync(f, 'utf8')).filter(c => !comments(out).includes(c));
  // 2回目の往復で完全に同じ文字列になること（安定性）
  const model2 = JSON.parse(execFileSync(bin, ['model', tmp], {maxBuffer: 1 << 28}).toString());
  const stable = printModel(model2) === out;
  console.log(`${same && !lost.length && stable ? 'OK ' : 'NG '} ${f}  位置一致:${same} コメント欠落:${lost.length} 安定:${stable}`);
  if (lost.length) console.log('   欠落:', lost);
  if (!(same && !lost.length && stable)) fail++;
}
process.exit(fail ? 1 : 0);
