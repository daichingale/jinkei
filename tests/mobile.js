#!/usr/bin/env node
// スマホ対応のテスト（ブラウザ不要の部分）。
// 使い方: node tests/mobile.js            ビルド物・CSS・Pages 一式の検査
//         node tests/mobile.js --e2e URL  さらに実機相当の通し検証（Playwright + Chromium が必要）を実行する
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; };

// 1) 単体 HTML のビルド: プレースホルダが残らず、スマホ用の部品が入っている
const {build} = require('../tools/build_browser_app.js');
const one = build();
const PH = /__(MOBILE_CSS|MOBILE|BOOT|HEAD_LINKS|UX_CSS|UI_ICONS|EXAMPLES|UX_CORE|FIELD2D|PRINTER|MOTION|SC_CORE|UX|SC)__/;
ok(!PH.test(one), '置換されていないプレースホルダがある: ' + (one.match(PH) || [''])[0]);
ok(/viewport-fit=cover/.test(one), 'viewport-fit=cover');
ok(/id="jkboot"/.test(one) && /window\.jkBoot/.test(one), '読み込み画面');
ok(/classList\.toggle\('mp'/.test(one), 'html.mp の早期判定');
const mb = (one.length / 1048576);
ok(mb > 10 && mb < 16, `単体 HTML の大きさ ${mb.toFixed(1)} MiB（約 12.8 MiB 前後のはず）`);
ok(!/src="assets\//.test(one), '単体 HTML は外部ファイルを読まない');

// 2) スマホ用 CSS は .mp の下だけ（デスクトップ・タブレットの見た目を変えない）
const css = rd('src/mobile.css').replace(/\/\*[\s\S]*?\*\//g, '');
const bad = [];
(function scan(text) {
  let i = 0;
  while (i < text.length) {
    const o = text.indexOf('{', i); if (o < 0) break;
    const head = text.slice(i, o).trim();
    let d = 1, j = o + 1; while (j < text.length && d) { if (text[j] === '{') d++; else if (text[j] === '}') d--; j++; }
    const body = text.slice(o + 1, j - 1);
    if (/^@media|^@supports/.test(head)) scan(body);
    else if (!/^@/.test(head)) for (const sel of head.split(',').map(x => x.trim()).filter(Boolean)) if (!/^(html\.mp|\.mp|#mb|#zpct|#jkboot)/.test(sel)) bad.push(sel);
    i = j;
  }
})(css);
ok(bad.length === 0, 'mobile.css に .mp の外の規則がある: ' + bad.slice(0, 4).join(' | '));
ok(/\.mp[^{]*input[^{]*\{[^}]*font-size:\s*16px/.test(css) || /font-size:\s*16px\s*!important/.test(css), '入力欄は 16px 以上（iOS のズーム防止）');
ok(/safe-area-inset-bottom/.test(css) && /safe-area-inset-top/.test(css), 'セーフエリア');
ok(!/:hover\b[^{]*\{[^}]*display\s*:\s*(block|flex)/.test(css), 'ホバー頼みの表示がない');

// 3) 画面ごとのスクリプトが読み込める（構文）
for (const f of ['src/mobile.js', 'src/view3d.js', 'src/audio.js', 'web/shim.js']) {
  const code = rd(f).replace('__JK_TEMPLATE_SHOW__', '""');
  try { new Function(code); n++; } catch (e) { assert.fail(`${f}: ${e.message}`); }
}
ok(/jkAudio|unlock\(\)/.test(rd('src/audio.js')) && /unlock\(\) \{/.test(rd('src/audio.js')), 'jkAudio.unlock');
ok(/PHONE/.test(rd('src/view3d.js')) && /JK_HUMAN_BIN/.test(rd('src/view3d.js')), '3D のスマホ向け設定と別ファイルの人体データ');

// 4) Pages 一式
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jk-pages-'));
const r = spawnSync('node', [path.join(ROOT, 'tools/build_pages.js'), tmp], {encoding: 'utf8'});
assert.equal(r.status, 0, 'build_pages.js が失敗: ' + r.stderr);
const f = x => path.join(tmp, x);
for (const x of ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/three.min.js', 'assets/view3d.js', 'assets/human.bin.gz', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'snare-preview.html', '.nojekyll']) ok(fs.existsSync(f(x)), x + ' がない');
const png = x => { const b = fs.readFileSync(f(x)); assert.equal(b.slice(1, 4).toString(), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
assert.deepEqual(png('icons/icon-192.png'), [192, 192]); assert.deepEqual(png('icons/icon-512.png'), [512, 512]); n += 2;
const man = JSON.parse(fs.readFileSync(f('manifest.webmanifest'), 'utf8'));
ok(man.display === 'standalone' && man.icons.some(i => i.sizes === '512x512') && man.icons.some(i => i.sizes === '192x192'), 'manifest');
const sw = fs.readFileSync(f('sw.js'), 'utf8');
const files = JSON.parse(sw.match(/const FILES = (\[.*\]);/)[1]);
for (const x of files) ok(x === './' || fs.existsSync(f(x)), 'sw.js のキャッシュ一覧にある ' + x + ' がない');
ok(files.includes('assets/human.bin.gz') && files.includes('index.html'), 'sw.js が主要ファイルを持つ');
const idx = fs.readFileSync(f('index.html'), 'utf8');
ok(/rel="manifest"/.test(idx) && /serviceWorker/.test(idx), 'index.html が manifest と SW を使う');
ok(idx.length / 1048576 < 3, `Pages の index.html は軽い（${(idx.length / 1048576).toFixed(2)} MiB）`);
ok(!idx.includes('JKH1') && !/window\.JK_HUMAN="/.test(idx), '人体データを index.html に埋め込まない');
// gzip が展開でき、人体データとして正しい
const bin = require('zlib').gunzipSync(fs.readFileSync(f('assets/human.bin.gz')));
ok(bin.slice(0, 4).toString() === 'JKH1' && bin.equals(fs.readFileSync(path.join(ROOT, 'assets/human.bin'))), 'human.bin.gz が元と一致');
// 内容が同じなら SW のバージョンも同じ、違えば変わる
const ver = s => s.match(/const CACHE = '([^']+)'/)[1];
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'jk-pages-'));
spawnSync('node', [path.join(ROOT, 'tools/build_pages.js'), tmp2], {encoding: 'utf8'});
ok(ver(sw) === ver(fs.readFileSync(path.join(tmp2, 'sw.js'), 'utf8')), 'SW のバージョンが再現できる');
// プレビューのひな形（Pages 版）: base と別ファイルの読み込み
const snare = fs.readFileSync(f('snare-preview.html'), 'utf8');
ok(/<base href="\.\/">/.test(snare) && /assets\/view3d\.js/.test(snare) && !snare.includes('JKH1'), 'snare-preview.html は別ファイルの 3D 部品を使う');
fs.rmSync(tmp, {recursive: true, force: true}); fs.rmSync(tmp2, {recursive: true, force: true});
console.log(`mobile: ${n} checks ok`);

const i = process.argv.indexOf('--e2e');
if (i > 0) {
  const e = spawnSync('python3', [path.join(__dirname, 'mobile_e2e.py'), process.argv[i + 1] || 'file://' + path.join(ROOT, 'docs/index.html'), '/tmp/mb'], {stdio: 'inherit'});
  process.exit(e.status || 0);
}
