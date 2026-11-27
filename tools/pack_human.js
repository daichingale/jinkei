#!/usr/bin/env node
// 人体アセットを軽くする: assets/human.bin（JKH1 version 1, 約 8.6MB）→ assets/human2.bin（JKH1 version 2）
//   node tools/pack_human.js [--check]     --check は assets/human2.bin が今の human.bin から作り直した結果と同じかだけ確かめる
// 詰め方（ブラウザ view3d.js と Rust human.rs の読み込み側が、元の version 1 の並びに戻す。戻したあとの使い方は同じ）:
//   位置 f32x3        → 軸ごと u16 に量子化（メッシュの外接箱の中で 65535 段階 = 約 0.02mm）、下位バイト面と上位バイト面に分けて並べる
//   法線 f32x3        → 八面体（oct）符号化 int8x2（最も近い近傍を探して角度誤差を最小にする。最大およそ 0.4°）
//   スキンの重み f32x4 → u16（1/65535）。UV f32x2 → u16（0〜1 の箱）
//   三角形の頂点番号 u16 → 前の番号との差を zigzag + 可変長（ほぼ 1 バイト）
//   そのほか（クリップ・顔テクスチャ・材質 ID・スキン番号）はそのまま
// 先頭 JSON の version は 2 になり、pack = {size, ops, check}。ops の各行: [種類, 戻し先, 個数, 詰めた側の位置, ...]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets/human.bin'), DST = path.join(ROOT, 'assets/human2.bin');
const f32 = Math.fround;

function fnv64(buf) {   // 戻した結果の照合用（JS と Rust で同じ式）
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < buf.length; i++) { h ^= BigInt(buf[i]); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}
function octEnc(nx, ny, nz) {
  const l1 = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let x = nx / l1, y = ny / l1;
  if (nz < 0) { const ox = x, oy = y; x = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1); y = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1); }
  const cx = [Math.floor(x * 127), Math.ceil(x * 127)], cy = [Math.floor(y * 127), Math.ceil(y * 127)];
  let best = null, bd = -2;
  for (const qx of cx) for (const qy of cy) {
    const q = [Math.max(-127, Math.min(127, qx)), Math.max(-127, Math.min(127, qy))];
    const d = octDec(q[0], q[1]);
    const dot = d[0] * nx + d[1] * ny + d[2] * nz;
    if (dot > bd) { bd = dot; best = q; }
  }
  return best;
}
function octDec(qx, qy) {   // 読み込み側と同じ式（+ - * / sqrt のみ）
  let x = qx / 127, y = qy / 127;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) { const ox = x, oy = y; x = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1); y = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1); }
  const zz = z;
  const l = Math.sqrt(x * x + y * y + zz * zz) || 1;
  return [x / l, y / l, zz / l];
}
function pack() {
  const b = fs.readFileSync(SRC);
  if (b.slice(0, 4).toString() !== 'JKH1') throw new Error('JKH1 ではありません');
  const jl = b.readUInt32LE(4);
  const json = JSON.parse(b.slice(8, 8 + jl).toString('utf8'));
  if (json.version !== 1) throw new Error('version 1 のアセットを渡してください（version=' + json.version + '）');
  const blob = b.slice(8 + jl);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.length);
  const ops = [], chunks = [];
  let srcOff = 0;
  const covered = [];   // [dst, len]
  const emit = (buf) => { chunks.push(buf); const o = srcOff; srcOff += buf.length; return o; };
  const rdF = (o, n) => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat32(o + i * 4, true); return a; };
  const stats = {posErr: 0, norErr: 0, wErr: 0};
  const meshes = [];
  const addMesh = (d, name) => { if (d && d.vertices) meshes.push([d, name]); };
  addMesh(json.body, 'body'); addMesh(json.illust && json.illust.body, 'illust'); addMesh(json.face && json.face.mesh, 'face');
  for (const [k, d] of Object.entries(json.instruments)) addMesh(d, 'inst:' + k);
  const doneAt = new Map();   // 同じ場所を指す重複（bass1+R など）は1度だけ詰める
  const once = (key, fn) => { if (doneAt.has(key)) return; doneAt.set(key, 1); fn(); };
  for (const [d, name] of meshes) {
    const nv = d.vertices;
    once('pos' + d.pos + ':' + nv, () => {
      const p = rdF(d.pos, nv * 3);
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i * 3 + k]); mx[k] = Math.max(mx[k], p[i * 3 + k]); }
      const lo = mn.map(f32), hi = mx.map(f32);
      const buf = Buffer.alloc(nv * 6);
      for (let k = 0; k < 3; k++) {
        const sc = (hi[k] - lo[k]) / 65535;
        for (let i = 0; i < nv; i++) {
          const q = sc > 0 ? Math.max(0, Math.min(65535, Math.round((p[i * 3 + k] - lo[k]) / sc))) : 0;
          buf[k * 2 * nv + i] = q & 255; buf[(k * 2 + 1) * nv + i] = q >> 8;
          const back = f32(lo[k] + q * sc);
          stats.posErr = Math.max(stats.posErr, Math.abs(back - p[i * 3 + k]));
        }
      }
      ops.push([2, d.pos, nv, emit(buf), ...lo, ...hi]); covered.push([d.pos, nv * 12]);
    });
    once('nor' + d.nor + ':' + nv, () => {
      const n = rdF(d.nor, nv * 3);
      const buf = Buffer.alloc(nv * 2);
      for (let i = 0; i < nv; i++) {
        const q = octEnc(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
        buf[i] = q[0] & 255; buf[nv + i] = q[1] & 255;
        const dd = octDec(q[0], q[1]);
        const len = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
        const dot = Math.max(-1, Math.min(1, (dd[0] * n[i * 3] + dd[1] * n[i * 3 + 1] + dd[2] * n[i * 3 + 2]) / len));
        stats.norErr = Math.max(stats.norErr, Math.acos(dot) * 180 / Math.PI);
      }
      ops.push([3, d.nor, nv, emit(buf)]); covered.push([d.nor, nv * 12]);
    });
    if (d.skinWeight !== undefined) once('sw' + d.skinWeight + ':' + nv, () => {
      const w = rdF(d.skinWeight, nv * 4);
      const buf = Buffer.alloc(nv * 8);
      for (let k = 0; k < 4; k++) for (let i = 0; i < nv; i++) {
        const q = Math.max(0, Math.min(65535, Math.round(w[i * 4 + k] * 65535)));
        buf[k * 2 * nv + i] = q & 255; buf[(k * 2 + 1) * nv + i] = q >> 8;
        stats.wErr = Math.max(stats.wErr, Math.abs(q / 65535 - w[i * 4 + k]));
      }
      ops.push([5, d.skinWeight, nv, emit(buf)]); covered.push([d.skinWeight, nv * 16]);
    });
    if (d.uv !== undefined) once('uv' + d.uv + ':' + nv, () => {
      const u = rdF(d.uv, nv * 2);
      const mn = [1e9, 1e9], mx = [-1e9, -1e9];
      for (let i = 0; i < nv; i++) for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], u[i * 2 + k]); mx[k] = Math.max(mx[k], u[i * 2 + k]); }
      const lo = mn.map(f32), hi = mx.map(f32);
      const buf = Buffer.alloc(nv * 4);
      for (let k = 0; k < 2; k++) {
        const sc = (hi[k] - lo[k]) / 65535;
        for (let i = 0; i < nv; i++) { const q = sc > 0 ? Math.max(0, Math.min(65535, Math.round((u[i * 2 + k] - lo[k]) / sc))) : 0; buf[k * 2 * nv + i] = q & 255; buf[(k * 2 + 1) * nv + i] = q >> 8; }
      }
      ops.push([6, d.uv, nv, emit(buf), ...lo, ...hi]); covered.push([d.uv, nv * 8]);
    });
    once('idx' + d.index + ':' + d.indices, () => {
      const ni = d.indices;
      const out = [];
      let prev = 0;
      for (let i = 0; i < ni; i++) {
        const v = dv.getUint16(d.index + i * 2, true);
        let z = v - prev; prev = v; z = z >= 0 ? z * 2 : -z * 2 - 1;
        while (z >= 128) { out.push((z & 127) | 128); z >>= 7; }
        out.push(z);
      }
      const buf = Buffer.from(out);
      ops.push([4, d.index, ni, emit(buf), buf.length]); covered.push([d.index, ni * 2]);
    });
  }
  // 詰めなかった部分（クリップ・顔テクスチャ・材質 ID・スキン番号・その他）はそのまま写す
  covered.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  const raws = [];
  for (const [o, l] of covered) { if (o < pos) throw new Error('重なっています @' + o); if (o > pos) raws.push([pos, o - pos]); pos = o + l; }
  if (pos < blob.length) raws.push([pos, blob.length - pos]);
  for (const [o, l] of raws) ops.push([1, o, l, emit(blob.slice(o, o + l)), l]);
  ops.sort((a, b) => a[1] - b[1]);
  // JSON は version 2 + pack。元の JSON（オフセットは戻したあとの並びを指す）はそのまま
  const j2 = Object.assign({}, json, {version: 2, pack: {size: blob.length, ops, check: ''}});
  // 戻した結果の照合値を作る（読み込み側と同じ復元を、この場で実行）
  const payload = Buffer.concat(chunks);
  const restored = unpackOps(payload, j2.pack);
  j2.pack.check = fnv64(restored);
  let js = JSON.stringify(j2);
  while ((js.length + 0) % 4) js += ' ';
  const head = Buffer.alloc(8); head.write('JKH1'); head.writeUInt32LE(Buffer.byteLength(js), 4);
  let jb = Buffer.from(js, 'utf8');
  const pad = (4 - jb.length % 4) % 4; if (pad) jb = Buffer.concat([jb, Buffer.alloc(pad, 32)]);
  head.writeUInt32LE(jb.length, 4);
  return {out: Buffer.concat([head, jb, payload]), stats, orig: b, restored, blob, covered: covered.length};
}
// 復元（view3d.js の jkhUnpack と src/human.rs の unpack と同じ）
function unpackOps(payload, pk) {
  const out = Buffer.alloc(pk.size);
  const dv = new DataView(out.buffer, out.byteOffset, out.length);
  for (const op of pk.ops) {
    const [t, dst, n, src] = op;
    if (t === 1) payload.copy(out, dst, src, src + op[4]);
    else if (t === 2) {
      for (let k = 0; k < 3; k++) {
        const lo = op[4 + k], sc = (op[7 + k] - op[4 + k]) / 65535;
        for (let i = 0; i < n; i++) dv.setFloat32(dst + (i * 3 + k) * 4, lo + (payload[src + k * 2 * n + i] | (payload[src + (k * 2 + 1) * n + i] << 8)) * sc, true);
      }
    } else if (t === 3) {
      for (let i = 0; i < n; i++) {
        const d = octDec((payload[src + i] << 24) >> 24, (payload[src + n + i] << 24) >> 24);
        dv.setFloat32(dst + i * 12, d[0], true); dv.setFloat32(dst + i * 12 + 4, d[1], true); dv.setFloat32(dst + i * 12 + 8, d[2], true);
      }
    } else if (t === 4) {
      let p = src, prev = 0;
      for (let i = 0; i < n; i++) {
        let z = 0, s = 0, c;
        do { c = payload[p++]; z |= (c & 127) << s; s += 7; } while (c & 128);
        prev += (z & 1) ? -((z + 1) >> 1) : (z >> 1);
        dv.setUint16(dst + i * 2, prev, true);
      }
    } else if (t === 5) {
      for (let k = 0; k < 4; k++) for (let i = 0; i < n; i++) dv.setFloat32(dst + (i * 4 + k) * 4, (payload[src + k * 2 * n + i] | (payload[src + (k * 2 + 1) * n + i] << 8)) / 65535, true);
    } else if (t === 6) {
      for (let k = 0; k < 2; k++) {
        const lo = op[4 + k], sc = (op[6 + k] - op[4 + k]) / 65535;
        for (let i = 0; i < n; i++) dv.setFloat32(dst + (i * 2 + k) * 4, lo + (payload[src + k * 2 * n + i] | (payload[src + (k * 2 + 1) * n + i] << 8)) * sc, true);
      }
    }
  }
  return out;
}
module.exports = {pack, unpackOps, fnv64, octDec};
if (require.main === module) {
  const r = pack();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(DST) ? fs.readFileSync(DST) : null;
    const curgz = fs.existsSync(DST + '.gz') ? fs.readFileSync(DST + '.gz') : null;
    if (!cur || !cur.equals(r.out) || !curgz || !curgz.equals(zlib.gzipSync(r.out, {level: 9}))) { console.error('assets/human2.bin が human.bin から作り直した結果と違います（node tools/pack_human.js を実行）'); process.exit(1); }
    console.log('human2.bin は human.bin と一致しています'); process.exit(0);
  }
  fs.writeFileSync(DST, r.out);
  const gz = zlib.gzipSync(r.out, {level: 9});
  fs.writeFileSync(DST + '.gz', gz);
  const gz1 = zlib.gzipSync(r.orig, {level: 9}), br = zlib.brotliCompressSync(r.out);
  console.log(`human.bin ${(r.orig.length / 1e6).toFixed(2)}MB (gzip ${(gz1.length / 1e6).toFixed(2)}MB) → human2.bin ${(r.out.length / 1e6).toFixed(2)}MB (gzip ${(gz.length / 1e6).toFixed(2)}MB / brotli ${(br.length / 1e6).toFixed(2)}MB)`);
  console.log(`量子化の最大誤差: 位置 ${(r.stats.posErr * 1000).toFixed(4)}mm / 法線 ${r.stats.norErr.toFixed(3)}° / 重み ${r.stats.wErr.toExponential(2)}`);
}
