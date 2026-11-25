// イラストSVGを assets/ui/<name>.svg に書き出す（原画生成）。 実行: node tools/gen_icon_art.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'assets', 'ui');
fs.mkdirSync(dir, { recursive: true });
const all = Object.assign({}, require('./icon_src/instruments').out, require('./icon_src/figures').out, require('./icon_src/scenes').out, require('./icon_src/mascot').out);
// 楽器: 契約名 inst-<id>
const out = {};
for (const [k, v] of Object.entries(all)) {
  const isInst = !/^(shape|venue|pose|step|carry|face|action|look|layout|help|mascot|empty)-/.test(k);
  out[isInst ? 'inst-' + k : k] = v;
}
for (const f of fs.readdirSync(dir)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(dir, f));
for (const [k, v] of Object.entries(out)) fs.writeFileSync(path.join(dir, k + '.svg'), v + '\n');
console.log(Object.keys(out).length + ' svg -> assets/ui');
