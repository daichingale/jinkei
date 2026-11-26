#!/usr/bin/env node
// Cargo 不要。JavaScript エンジン入りのオフラインエディタを1つの HTML にまとめる。
// 使用例: node tools/build_browser_app.js jinkei-editor.html
'use strict';
const fs = require('fs');
const path = require('path');
const {previewTemplate} = require('./build_preview.js');
const ROOT = path.resolve(__dirname, '..');
function build(opts) {
opts = opts || {};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const js = s => JSON.stringify(s).replace(/</g, '\\u003c');
const motion = ['motion.js','strike.js','bravura.js','staff.js','reel.js','audio.js','musicxml.js']
  .map(f => read('src/' + f)).join('\n');
const exFiles = fs.readdirSync(path.join(ROOT, 'examples')).filter(f => /\.jk$/.test(f)).sort();
const examples = 'window.JK_EXAMPLES=' + js(exFiles.map(f => ({file: f, src: read('examples/' + f)}))) + ';';
const iconsPath = path.join(ROOT, 'src', 'ui_icons.js');
const icons = fs.existsSync(iconsPath) ? read('src/ui_icons.js') : '';
// 置換は関数で行う（文字列だと中の $& などが特殊扱いされるため）
let html = read('src/editor.html')
  .replaceAll('__UX_CSS__', () => read('src/ux.css'))
  .replaceAll('__UI_ICONS__', () => icons)
  .replaceAll('__EXAMPLES__', () => examples)
  .replaceAll('__UX_CORE__', () => read('src/ux_core.js'))
  .replaceAll('__FIELD2D__', () => read('src/field2d.js'))
  .replaceAll('__PRINTER__', () => read('src/printer.js')).replaceAll('__MOTION__', () => motion)
  .replaceAll('__SC_CORE__', () => read('src/shortcuts_core.js'))
  .replaceAll('__MOBILE_CSS__', () => read('src/mobile.css'))
  .replaceAll('__MOBILE__', () => read('src/mobile.js'))
  .replaceAll('__BOOT__', () => read('src/boot.html'))
  .replaceAll('__HEAD_LINKS__', () => opts.headLinks || '')
  .replaceAll('__UX__', () => read('src/ux.js'))
  .replaceAll('__SC__', () => read('src/parade.js') + '\n</script>\n<script>/* parade ui */\n' + read('src/parade_ui.js') + '\n</script>\n<script>/* shortcuts (2) */\n' + read('src/shortcuts.js'));
const server = read('src/server.rs');
const def = server.match(/pub const TEMPLATE_SHOW: &str = r##"([\s\S]*?)"##;/);
if (!def) throw new Error('TEMPLATE_SHOW が見つかりません');
const esc = '<@@JK@@';
const tpl = previewTemplate(opts).replace(/<\/script/gi, esc + '/script').replaceAll('<!--', esc + '!--');
const shim = read('web/shim.js').replace('__JK_TEMPLATE_SHOW__', js(def[1]));
const marker = "<script>\n'use strict';";
if (!html.includes(marker)) throw new Error('エディタのスクリプト挿入位置が見つかりません');
const inject = `<script type="text/plain" id="jk-preview-tpl">${tpl}</script>\n` +
  `<script>window.JK_ESC = ${js(esc)};</script>\n` +
  `<script id="jk-engine">${read('web/engine.js')}</script>\n<script>${read('web/project.js')}</script>\n<script>${shim}</script>\n${marker}`;
html = html.replace(marker, () => inject);
return html;
}
module.exports = {build};
if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('使い方: node tools/build_browser_app.js 出力.html'); process.exit(2); }
  const html = build();
  fs.writeFileSync(out, html);
  console.log(path.resolve(out), `(${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB)`);
}
