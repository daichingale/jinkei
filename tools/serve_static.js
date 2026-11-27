#!/usr/bin/env node
// 確認用の静的サーバ（GitHub Pages のように、文字ものだけ gzip で送る。.bin / .gz / 画像は圧縮しない）。
//   node tools/serve_static.js <ディレクトリ> [ポート=8765]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.resolve(process.argv[2] || 'docs'), port = +process.argv[3] || 8765;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gz': 'application/gzip', '.bin': 'application/octet-stream', '.txt': 'text/plain'};
const GZ = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.txt']);
const cache = new Map();
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(f), h = {'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=600'};
  let body = fs.readFileSync(f);
  if (GZ.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) { const k = f + body.length; if (!cache.has(k)) cache.set(k, zlib.gzipSync(body, {level: 6})); body = cache.get(k); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = body.length; res.writeHead(200, h); res.end(body);
}).listen(port, '127.0.0.1', () => console.error('serving', root, 'on', port));
