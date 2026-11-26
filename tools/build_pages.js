#!/usr/bin/env node
// GitHub Pages 用の公開物を docs/ に作る（Cargo 不要）。
//   docs/index.html            エディタ本体（3D 部品は別ファイル）
//   docs/assets/*              three.min.js / view3d.js / human.bin.gz（別々にキャッシュされる）
//   docs/sw.js                 オフライン用のサービスワーカー
//   docs/manifest.webmanifest  「ホーム画面に追加」用
//   docs/icons/*               192 / 512 / maskable / apple-touch-icon（マスコットの SVG から作る）
//   docs/snare-preview.html    examples/snare.jk の 4 分割プレビュー（現行の描画）
// 使用例: node tools/build_pages.js [出力先ディレクトリ（既定 docs）]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {build} = require('./build_browser_app.js');
const {previewTemplate} = require('./build_preview.js');
const {jinkeiCompile} = require('../web/engine.js');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs'));
const rd = f => fs.readFileSync(path.join(ROOT, f));
const wr = (f, data) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, data); return p; };

// ---- アイコン: マスコットの SVG を PNG に ----
const mascot = path.join(ROOT, 'assets/ui/mascot-face.svg');
function png(size, file, pad) {
  let svg = fs.readFileSync(mascot, 'utf8');
  if (pad) {   // maskable: 角丸の四角を全面に広げ、顔を安全領域（中央 80%）に収める
    svg = svg.replace(/<rect[^>]*>/, '<rect width="64" height="64" fill="#fde9c9" stroke="none"/>').replace(/<g transform="[^"]*">/, '<g transform="translate(5.6 12) scale(.46)">');
  }
  const tmp = path.join(require('os').tmpdir(), 'jk-icon-' + process.pid + '.svg');
  fs.writeFileSync(tmp, svg);
  const p = path.join(OUT, file); fs.mkdirSync(path.dirname(p), {recursive: true});
  try { execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', p, tmp]); }
  catch (e) { execFileSync('convert', ['-background', 'none', '-density', '600', tmp, '-resize', size + 'x' + size, p]); }
  fs.unlinkSync(tmp);
}
png(192, 'icons/icon-192.png'); png(512, 'icons/icon-512.png');
png(512, 'icons/maskable-512.png', true); png(180, 'icons/apple-touch-icon.png');
fs.copyFileSync(mascot, (wr('icons/icon.svg', ''), path.join(OUT, 'icons/icon.svg')));

// ---- 3D 部品（別ファイル）----
wr('assets/three.min.js', rd('vendor/three.min.js'));
wr('assets/view3d.js', rd('src/view3d.js'));
wr('assets/human.bin.gz', zlib.gzipSync(rd('assets/human.bin'), {level: 9}));

// ---- manifest ----
wr('manifest.webmanifest', JSON.stringify({
  name: '陣形エディタ', short_name: '陣形', description: 'マーチング・ドリルの陣形を作るエディタ',
  start_url: './', scope: './', display: 'standalone', orientation: 'any', lang: 'ja',
  background_color: '#14161a', theme_color: '#1c1f25',
  icons: [
    {src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any'},
    {src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any'},
    {src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
  ],
}, null, 2) + '\n');

// ---- エディタ本体 ----
const headLinks = '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" type="image/png" href="icons/icon-192.png"><link rel="apple-touch-icon" href="icons/apple-touch-icon.png">';
let html = build({pages: true, headLinks});
const reg = `<script>if('serviceWorker' in navigator&&/^https?:/.test(location.protocol)){addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});}</script>\n</body>`;
if (!html.includes('</body>')) throw new Error('</body> が見つかりません');
html = html.replace(/<\/body>(?![\s\S]*<\/body>)/, () => reg);
wr('index.html', html);

// ---- スネアのプレビュー（現行の描画。単体 HTML）----
{
  const src = fs.readFileSync(path.join(ROOT, 'examples/snare.jk'), 'utf8');
  const r = jinkeiCompile(src);
  if (!r.ok) throw new Error('snare.jk をコンパイルできません: ' + JSON.stringify(r));
  const title = r.data.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const data = JSON.stringify(r.data).replace(/</g, '\\u003c');
  wr('snare-preview.html', previewTemplate({pages: true}).replaceAll('__JK_BASE__', './').replaceAll('__JK_TITLE__', title).replaceAll('__JK_DATA__', data));
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// ---- サービスワーカー（内容のハッシュでキャッシュ名を決める → 更新が自動で入る）----
const precache = ['./', 'index.html', 'manifest.webmanifest', 'assets/three.min.js', 'assets/view3d.js', 'assets/human.bin.gz',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg', 'snare-preview.html'];
const h = crypto.createHash('sha256');
for (const f of precache.filter(f => f !== './')) h.update(f).update(fs.readFileSync(path.join(OUT, f)));
const ver = h.digest('hex').slice(0, 10);
wr('sw.js', `// 自動生成（tools/build_pages.js）。内容が変わるとバージョンが変わり、古いキャッシュは消える。
'use strict';
const CACHE = 'jinkei-${ver}';
const FILES = ${JSON.stringify(precache)};
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('jinkei-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// キャッシュ優先（オフラインでも即起動）。ページ本体だけはネットがあれば裏で取り直す。
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(r, {ignoreSearch: true});
    const net = fetch(r).then(res => { if (res && res.ok && r.mode === 'navigate') c.put(r, res.clone()); return res; });
    if (hit) { if (r.mode === 'navigate') net.catch(() => {}); return hit; }
    try { return await net; } catch (err) { return (r.mode === 'navigate' && await c.match('index.html')) || Response.error(); }
  }));
});
`);
const size = f => (fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(2) + ' MiB';
console.log(OUT, 'キャッシュ版', ver);
for (const f of ['index.html', 'assets/three.min.js', 'assets/view3d.js', 'assets/human.bin.gz', 'snare-preview.html']) console.log('  ' + f.padEnd(24), size(f));
