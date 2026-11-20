#!/usr/bin/env node
// Cargo 不要。JavaScript エンジン入りのオフラインエディタを1つの HTML にまとめる。
// 使用例: node tools/build_browser_app.js jinkei-editor.html
'use strict';
const fs = require('fs');
const path = require('path');
const {previewTemplate} = require('./build_preview.js');
const ROOT = path.resolve(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('使い方: node tools/build_browser_app.js 出力.html'); process.exit(2); }
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const js = s => JSON.stringify(s).replace(/</g, '\\u003c');
const motion = ['motion.js','strike.js','bravura.js','staff.js','reel.js','audio.js','musicxml.js']
  .map(f => read('src/' + f)).join('\n');
let html = read('src/editor.html').replaceAll('__FIELD2D__', read('src/field2d.js'))
  .replaceAll('__PRINTER__', read('src/printer.js')).replaceAll('__MOTION__', motion);
const server = read('src/server.rs');
const def = server.match(/pub const TEMPLATE_SHOW: &str = r##"([\s\S]*?)"##;/);
if (!def) throw new Error('TEMPLATE_SHOW が見つかりません');
const esc = '<@@JK@@';
const tpl = previewTemplate().replace(/<\/script/gi, esc + '/script').replaceAll('<!--', esc + '!--');
const shim = read('web/shim.js').replace('__JK_TEMPLATE_SHOW__', js(def[1]));
const marker = "<script>\n'use strict';";
if (!html.includes(marker)) throw new Error('エディタのスクリプト挿入位置が見つかりません');
const inject = `<script type="text/plain" id="jk-preview-tpl">${tpl}</script>\n` +
  `<script>window.JK_ESC = ${js(esc)};</script>\n` +
  `<script>${read('web/engine.js')}</script>\n<script>${read('web/project.js')}</script>\n<script>${shim}</script>\n${marker}`;
html = html.replace(marker, inject);
fs.writeFileSync(out, html);
console.log(path.resolve(out), `(${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MiB)`);
