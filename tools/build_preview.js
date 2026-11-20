#!/usr/bin/env node
// Rust のビルド環境がなくても、jinkei の .jk からブラウザ用の単体HTMLプレビューを作る。
// 使用例: node tools/build_preview.js examples/snare.jk snare-preview.html
'use strict';
const fs = require('fs');
const path = require('path');
const {jinkeiCompile} = require('../web/engine.js');
const ROOT = path.resolve(__dirname, '..');
const rs = fs.readFileSync(path.join(ROOT, 'src/output.rs'), 'utf8');
const mat = rs.match(/const TEMPLATE: &str = r##"([\s\S]*?)"##;/);
if (!mat) throw new Error('src/output.rs のプレビューテンプレートが見つかりません');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const motion = ['motion.js', 'strike.js', 'bravura.js', 'staff.js', 'reel.js', 'audio.js', 'musicxml.js']
  .map(f => read('src/' + f)).join('\n');
const values = {
  '__TITLE__': '__JK_TITLE__',
  '__DATA__': '__JK_DATA__',
  '__FIELD2D__': read('src/field2d.js'),
  '__MOTION__': motion,
  '__THREE__': read('vendor/three.min.js'),
  '__HUMAN__': fs.readFileSync(path.join(ROOT, 'assets/human.bin')).toString('base64'),
  '__VIEW3D__': read('src/view3d.js'),
};
function previewTemplate() {
  let html = mat[1];
  for (const [key, value] of Object.entries(values)) html = html.split(key).join(value);
  return html;
}
module.exports = {previewTemplate};
if (require.main === module) {
  const [srcFile, outFile] = process.argv.slice(2);
  if (!srcFile || !outFile) {
    console.error('使い方: node tools/build_preview.js 入力.jk 出力.html'); process.exit(2);
  }
  const r = jinkeiCompile(fs.readFileSync(srcFile, 'utf8'));
  if (!r.ok) { console.error(JSON.stringify(r, null, 2)); process.exit(1); }
  const title = r.data.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const data = JSON.stringify(r.data).replace(/</g, '\\u003c');
  let html = previewTemplate().replaceAll('__JK_TITLE__', title).replaceAll('__JK_DATA__', data);
  fs.writeFileSync(outFile, html);
  console.log(path.resolve(outFile), `(${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB)`);
}
