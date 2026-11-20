'use strict';
// 楽器メッシュの共通部品（ベル・吹き口・バルブ・ドラム胴・キャリア・スティック）
const {V, Q, ss, lerp} = require('./math');
const M = require('./materials');

const MOUTH = [0, 1.512, 0.098];
const Qx = a => Q.axis([1, 0, 0], a), Qz = a => Q.axis([0, 0, 1], a);
const circ = (c, ax, R, n = 28, a0 = 0, a1 = Math.PI * 2) => {
  ax = V.norm(ax); const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = V.norm(V.cross(ref, ax)), w = V.cross(ax, u), p = [];
  for (let i = 0; i <= n; i++) { const t = lerp(a0, a1, i / n); p.push(V.add(c, V.add(V.mul(u, R * Math.cos(t)), V.mul(w, R * Math.sin(t))))); }
  return p;
};
const flare = (r0, r1, s0, k) => s => (s < s0 ? r0 : r0 + (r1 - r0) * Math.pow((s - s0) / (1 - s0), k));
// 開いたベル: 外側・内側（裏向き）・巻いた縁。fr は 0..1 → 半径
const bell = (mb, pts, fr, mat, o = {}) => {
  const N = o.N || 26, sub = o.sub || 10, smooth = o.smooth !== false;
  mb.sweep(pts, fr, mat, {N, sub, smooth, capS: true, capE: false});
  mb.sweep(pts, s => Math.max(0.002, fr(s) - 0.0018), mat, {N, sub, smooth, capS: false, capE: false, invert: true});
  const n = pts.length, e = pts[n - 1], d = V.norm(V.sub(e, pts[n - 2])), R = fr(1);
  mb.sweep(circ(e, d, R, 40), 0.0042, o.rim || M.SILVER, {N: 8, sub: 1, smooth: false, capS: false, capE: false});
};
const mouthpiece = (mb, from = MOUTH, to) => {
  to = to || V.add(from, [0, -0.002, 0.034]);
  mb.sweep([from, to], s => 0.0135 - 0.0075 * s, M.SILVER, {N: 12, smooth: false});
  mb.tube(V.sub(to, [0, 0, 0.002]), V.add(to, V.mul(V.norm(V.sub(to, from)), 0.012)), 0.0075, 0.0065, M.SILVER, {N: 10});
};
// ピストンバルブ（円柱＋キャップ＋ボタン）
const valve = (mb, x, z, y0, y1, r = 0.0095) => {
  mb.tube([x, y0, z], [x, y1, z], r, r, M.BRASS, {N: 12});
  mb.tube([x, y1, z], [x, y1 + 0.008, z], r * 1.22, r * 1.22, M.SILVER, {N: 12});
  mb.tube([x, y1 + 0.008, z], [x, y1 + 0.026, z], 0.0042, 0.0042, M.SILVER, {N: 8});
  mb.tube([x, y1 + 0.026, z], [x, y1 + 0.031, z], 0.0085, 0.0085, M.BLACKWOOD, {N: 10});
  mb.tube([x, y0 - 0.008, z], [x, y0, z], r * 1.2, r * 1.2, M.SILVER, {N: 12});
};
function drumAt(mb, c, ax, R, h, o = {}) {
  ax = V.norm(ax);
  const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = V.norm(V.cross(ref, ax)), w = V.cross(ax, u);
  mb.lathe(c, ax, [[R, -h / 2], [R, h / 2]], o.shell === undefined ? M.DRUMSHELL : o.shell, {N: 32, capS: true, capE: false});
  // 皮・フープ（銀）
  for (const sgn of o.both ? [1, -1] : [1]) {
    const e = V.madd(c, ax, sgn * h / 2);
    mb.lathe(V.madd(e, ax, sgn * 0.001), ax, [[0, sgn * 0.005], [R * 0.4, sgn * 0.0045], [R * 0.75, sgn * 0.0028], [R - 0.004, sgn * 0.0005], [R - 0.004, 0]], M.DRUMHEAD, {N: 32, capS: false});
    mb.sweep(circ(V.madd(e, ax, sgn * -0.004), ax, R + 0.001, 36), 0.0055, M.SILVER, {N: 8, sub: 1, smooth: false});
    mb.sweep(circ(V.madd(e, ax, sgn * 0.0), ax, R - 0.002, 36), 0.0035, M.SILVER, {N: 6, sub: 1, smooth: false});
  }
  const n = o.lugs || 8;
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2, d = V.add(V.mul(u, Math.cos(t)), V.mul(w, Math.sin(t))), p = V.madd(c, d, R + 0.004);
    mb.tube(V.madd(p, ax, -h * 0.36), V.madd(p, ax, h * 0.40), 0.0055, 0.0055, M.SILVER, {N: 6});
  }
  return {u, w};
}
const harness = (mb, plateY = 1.22) => {
  // 体の前に付ける黒いキャリア: 肩ベルトと腰ベルト、胸の小さな当て板
  mb.box([0, plateY - 0.03, 0.124], [0.15, 0.07, 0.016], M.LEATHER);
  for (const s of [-1, 1]) {
    mb.sweep([[s * 0.11, 1.405, 0.10], [s * 0.118, 1.415, 0.0], [s * 0.10, 1.40, -0.10]], [0.016, 0.0035], M.LEATHER, {N: 6, sub: 4});
    mb.sweep([[s * 0.118, 1.41, 0.04], [s * 0.115, 1.36, 0.115], [s * 0.07, 1.25, 0.128], [s * 0.04, 1.2, 0.126]], [0.014, 0.0035], M.LEATHER, {N: 6, sub: 4});
  }
  mb.sweep(Array.from({length: 25}, (_, i) => { const t = i / 24 * Math.PI * 2; return [0.172 * Math.cos(t), 1.0, -0.002 + 0.112 * Math.sin(t)]; }), [0.03, 0.004], M.LEATHER, {N: 6, sub: 1, smooth: false});
};
const stick = (mb, a, b, m = M.WOOD, tip = M.WOOD, tr = 0.0075) => {
  mb.tube(a, b, 0.0058, 0.0042, m, {N: 6});
  mb.ellipsoid(b, [tr, tr, tr], tip, {N: 8, lat: 5});
};
module.exports = {MOUTH, Qx, Qz, circ, flare, bell, mouthpiece, valve, drumAt, harness, stick};
