// 自動生成（tools/build_pages.js）。内容が変わるとバージョンが変わり、古いキャッシュは消える。
'use strict';
const CACHE = 'jinkei-10cf6abca8';
const FILES = ["./","index.html","manifest.webmanifest","assets/three.min.js","assets/view3d.js","assets/human.bin.gz","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","icons/apple-touch-icon.png","icons/icon.svg","snare-preview.html"];
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
