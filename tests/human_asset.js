// 人体アセット: version 2（量子化・可変長）→ version 1 の並びへ戻した結果が元と一致する範囲を確かめる
//  - pack_human.js の復元 / view3d.js の jkhUnpack・gunzip（ブラウザと同じコード）/ Rust の復元（cargo test human_asset）が同じ
//  - 量子化誤差が見た目に出ない大きさ（位置 0.05mm・法線 1°・重み 1e-4 未満）
//  - 三角形の頂点番号・材質・スキン番号・クリップ・顔テクスチャは完全一致
// 使い方: node tests/human_asset.js
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const {pack, fnv64} = require('../tools/pack_human.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('NG ' + m); } else console.log('ok ' + m); };
const rd = f => fs.readFileSync(path.join(ROOT, f));
const v1 = rd('assets/human.bin'), v2 = rd('assets/human2.bin'), v2gz = rd('assets/human2.bin.gz');
ok(zlib.gunzipSync(v2gz).equals(v2), 'human2.bin.gz は human2.bin の gzip');
ok(v2.equals(pack().out), 'human2.bin は human.bin から作り直した結果と同じ（node tools/pack_human.js）');
// ブラウザ側の復元コードを切り出して実行
const src = fs.readFileSync(path.join(ROOT, 'src/view3d.js'), 'utf8');
const code = src.slice(src.indexOf('/*JKH-BEGIN*/'), src.indexOf('/*JKH-END*/'));
const {gunzip, jkhUnpack} = new Function(code + '\nreturn {gunzip, jkhUnpack};')();
const t0 = Date.now();
const raw = gunzip(new Uint8Array(v2gz));
const tg = Date.now() - t0;
ok(Buffer.from(raw).equals(v2), 'view3d.js の gunzip が zlib と同じ結果（' + tg + 'ms）');
function parse(b) { const jl = b.readUInt32LE(4); return {json: JSON.parse(b.slice(8, 8 + jl).toString()), blob: b.slice(8 + jl)}; }
const a = parse(v1), b = parse(Buffer.from(raw));
const t1 = Date.now();
const un = Buffer.from(jkhUnpack(b.blob, b.json.pack));
const tu = Date.now() - t1;
ok(un.length === a.blob.length, '復元後の大きさが version 1 と同じ');
ok(fnv64(un) === b.json.pack.check, '復元結果の照合値が pack_human.js と一致（' + tu + 'ms）');
// 項目ごとの誤差
const dvA = new DataView(a.blob.buffer, a.blob.byteOffset, a.blob.length), dvB = new DataView(un.buffer, un.byteOffset, un.length);
const J = a.json;
let posErr = 0, norErr = 0, wErr = 0, uvErr = 0, idxBad = 0, matBad = 0, skBad = 0;
const meshes = [J.body, J.illust && J.illust.body, J.face && J.face.mesh, ...Object.values(J.instruments)].filter(Boolean);
for (const d of meshes) {
  const nv = d.vertices;
  for (let i = 0; i < nv * 3; i++) posErr = Math.max(posErr, Math.abs(dvA.getFloat32(d.pos + i * 4, true) - dvB.getFloat32(d.pos + i * 4, true)));
  for (let i = 0; i < nv; i++) {
    const g = k => dvA.getFloat32(d.nor + (i * 3 + k) * 4, true), h = k => dvB.getFloat32(d.nor + (i * 3 + k) * 4, true);
    const len = Math.hypot(g(0), g(1), g(2)) || 1;
    const dot = (g(0) * h(0) + g(1) * h(1) + g(2) * h(2)) / len / (Math.hypot(h(0), h(1), h(2)) || 1);
    norErr = Math.max(norErr, Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
  }
  if (d.skinWeight !== undefined) for (let i = 0; i < nv * 4; i++) wErr = Math.max(wErr, Math.abs(dvA.getFloat32(d.skinWeight + i * 4, true) - dvB.getFloat32(d.skinWeight + i * 4, true)));
  if (d.uv !== undefined) for (let i = 0; i < nv * 2; i++) uvErr = Math.max(uvErr, Math.abs(dvA.getFloat32(d.uv + i * 4, true) - dvB.getFloat32(d.uv + i * 4, true)));
  for (let i = 0; i < d.indices; i++) if (dvA.getUint16(d.index + i * 2, true) !== dvB.getUint16(d.index + i * 2, true)) idxBad++;
  if (d.mat !== undefined && !a.blob.slice(d.mat, d.mat + nv).equals(un.slice(d.mat, d.mat + nv))) matBad++;
  if (d.skinIndex !== undefined && !a.blob.slice(d.skinIndex, d.skinIndex + nv * 4).equals(un.slice(d.skinIndex, d.skinIndex + nv * 4))) skBad++;
}
ok(posErr < 5e-5, `位置の最大誤差 ${(posErr * 1000).toFixed(4)}mm < 0.05mm`);
ok(norErr < 1, `法線の最大誤差 ${norErr.toFixed(3)}° < 1°`);
ok(wErr < 1e-4, `スキン重みの最大誤差 ${wErr.toExponential(2)} < 1e-4`);
ok(uvErr < 1e-4, `UV の最大誤差 ${uvErr.toExponential(2)} < 1e-4`);
ok(idxBad === 0, '三角形の頂点番号が完全一致');
ok(matBad === 0 && skBad === 0, '材質 ID・スキン番号が完全一致');
// クリップ・顔テクスチャ（詰めていない領域）: 量子化した範囲（pack の ops 1 以外）を除いて同じ
let rawDiff = 0, rawTotal = 0;
for (const op of b.json.pack.ops) if (op[0] === 1) { rawTotal += op[4]; if (!a.blob.slice(op[1], op[1] + op[4]).equals(un.slice(op[1], op[1] + op[4]))) rawDiff++; }
ok(rawDiff === 0, `そのまま写した領域 ${rawTotal} バイトが完全一致`);
// 同じ JSON の見た目に関わる部分（骨・材質・クリップ名など）は version 1 と同じ
const strip = j => { const c = JSON.parse(JSON.stringify(j)); delete c.pack; c.version = 0; return JSON.stringify(c); };
ok(strip(a.json) === strip(b.json), 'JSON の見出し（骨・材質・オフセット表）が version 1 と同じ');
console.log(`human.bin ${(v1.length / 1e6).toFixed(2)}MB → human2.bin ${(v2.length / 1e6).toFixed(2)}MB → gzip ${(v2gz.length / 1e6).toFixed(2)}MB`);
if (fails) { console.log(fails + ' 件失敗'); process.exit(1); }
console.log('全て成功');
