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
  '__HUMAN__': fs.readFileSync(path.join(ROOT, 'assets/human2.bin.gz')).toString('base64'),
  '__VIEW3D__': read('src/view3d.js'),
};
// 3D 部品（three.js・人体データ・view3d.js）を別ファイルにして読み込む版（Pages 用）
const PAGES_TAIL = `<script>
/* 3D 部品（three.js・人体データ・view3d.js）は 3D を初めて開くときに別ファイルから読み込む。
   assets/ は初回に取り込んだあと sw.js がキャッシュする（オフラインでも開ける） */
(function () {
  var btn = document.getElementById('mode3d'), st = 0;
  function sc(src) { return new Promise(function (ok, ng) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ng; document.head.appendChild(s); }); }
  window.jkLoad3d = function () {
    if (st) return st; btn.textContent = '3D を読み込み中…'; btn.disabled = true;
    var human = fetch('assets/human2.bin.gz').then(function (r) { if (!r.ok) throw new Error('human'); return r.arrayBuffer(); });
    st = Promise.all([sc('assets/three.min.js'), human]).then(function (r) {
      window.JK_HUMAN_BIN = new Uint8Array(r[1]); btn.disabled = false; return sc('assets/view3d.js');
    }).then(function () {
      if (!/(^|&)view=3d(&|$)/.test(location.hash.slice(1))) btn.click();
    }).catch(function (e) { st = 0; btn.disabled = false; btn.textContent = '3D で見る'; btn.title = '3D を読み込めませんでした: ' + String(e && e.message || e); });
    return st;
  };
  btn.onclick = window.jkLoad3d;
  if (/(^|&)(view=3d|rec=1)/.test(location.hash.slice(1))) window.jkLoad3d();
})();
</script>`;
function previewTemplate(opts) {
  let html = mat[1];
  if (opts && opts.pages) {
    html = html.replace(/<script type="text\/plain" id="jk-three">__THREE__<\/script>\n<script type="text\/plain" id="jk-human">__HUMAN__<\/script>\n<script type="text\/plain" id="jk-view3d">__VIEW3D__<\/script>\n<script>\n\/\* 3D 部品[\s\S]*?<\/script>/, () => PAGES_TAIL)
      .replace('<head><meta charset="utf-8">', '<head><meta charset="utf-8"><base href="__JK_BASE__">');
    if (html.includes('__THREE__')) throw new Error('Pages 用のテンプレート置換に失敗しました');
  }
  for (const [key, value] of Object.entries(values)) html = html.split(key).join(value);
  return html;
}
module.exports = {previewTemplate, PAGES_TAIL};
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
