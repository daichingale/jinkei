'use strict';
// 楽器メッシュの共通部品（ベル・吹き口・バルブ・ドラム胴・キャリア・スティック）
const {V, Q, ss, lerp} = require('./math');
const M = require('./materials');
const {catmull} = require('./mesh');

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
  const shellM = o.shell === undefined ? M.DRUMSHELL : o.shell;
  mb.lathe(c, ax, [[R, -h / 2], [R, h / 2]], shellM, {N: 40, capS: true, capE: false});
  // 胴の内側のベアリングエッジ（白木のリング）
  for (const sgn of o.both ? [1, -1] : [1]) {
    const e = V.madd(c, ax, sgn * h / 2);
    // 皮（ヘッド）: 中央が少し盛り上がり、周囲でフープに止まる
    mb.lathe(V.madd(e, ax, sgn * 0.001), ax, [[0, sgn * 0.0050], [R * 0.4, sgn * 0.0046], [R * 0.75, sgn * 0.0030], [R - 0.005, sgn * 0.0007], [R - 0.005, 0]], M.DRUMHEAD, {N: 40, capS: false});
    // フープ（クロームのカウンターフープ: 外に出たフランジ＋巻いた縁）とヘッドを押さえるリング
    mb.lathe(V.madd(e, ax, sgn * -0.010), ax, [[R + 0.0005, 0], [R + 0.0005, sgn * 0.016], [R + 0.0085, sgn * 0.016], [R + 0.0085, sgn * 0.011]], M.CHROME, {N: 40, capS: false});
    mb.sweep(circ(V.madd(e, ax, sgn * 0.0075), ax, R + 0.0010, 44), 0.0050, M.CHROME, {N: 8, sub: 1, smooth: false});
    mb.sweep(circ(V.madd(e, ax, sgn * 0.0010), ax, R - 0.0035, 44), 0.0028, M.CHROME, {N: 6, sub: 1, smooth: false});
  }
  // テンションロッド・ラグ（胴に付くクロームの箱）
  const n = o.lugs || 8;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * Math.PI * 2, d = V.add(V.mul(u, Math.cos(t)), V.mul(w, Math.sin(t))), p = V.madd(c, d, R + 0.0075);
    mb.tube(V.madd(p, ax, -h * 0.20), V.madd(p, ax, h * 0.20), 0.0085, 0.0085, M.CHROME, {N: 6});
    mb.tube(V.madd(p, ax, h * 0.20), V.madd(p, ax, h * 0.20 + 0.004), 0.0095, 0.0095, M.DARKSTEEL, {N: 6});
    for (const sgn of o.both ? [1, -1] : [1]) {
      mb.tube(V.madd(p, ax, sgn * h * 0.14), V.madd(p, ax, sgn * (h / 2 + 0.012)), 0.0023, 0.0023, M.CHROME, {N: 5});
      mb.tube(V.madd(p, ax, sgn * (h / 2 + 0.010)), V.madd(p, ax, sgn * (h / 2 + 0.017)), 0.0048, 0.0048, M.CHROME, {N: 6});
    }
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

// ================= 実物らしい管楽器の部品（管・ベル・マウスピース・バルブ）=================
// 折れ線の角を半径 R の円弧で丸める（管の曲がり）。R は数値、または角ごとの配列。端の線分は最後まで使える
function roundPath(pts, R, seg = 8) {
  const out = [pts[0]], n = pts.length;
  for (let i = 1; i < n - 1; i++) {
    const P = pts[i], r = Array.isArray(R) ? R[i - 1] : R;
    const d1 = V.norm(V.sub(P, pts[i - 1])), d2 = V.norm(V.sub(pts[i + 1], P));
    const dot = Math.min(1, Math.max(-1, V.dot(d1, d2))), al = Math.acos(dot);
    if (al < 1e-3 || r <= 0) { out.push(P); continue; }
    const l1 = V.len(V.sub(P, pts[i - 1])) * (i === 1 ? 0.98 : 0.5), l2 = V.len(V.sub(pts[i + 1], P)) * (i === n - 2 ? 0.98 : 0.5);
    let t = r * Math.tan(al / 2), rr = r;
    const tm = Math.min(l1, l2);
    if (t > tm) { t = tm; rr = t / Math.tan(al / 2); }
    const A = V.madd(P, d1, -t), nperp = V.norm(V.sub(d2, V.mul(d1, dot))), C = V.madd(A, nperp, rr), a = V.sub(A, C), k = V.norm(V.cross(d1, d2));
    const m = Math.max(3, Math.ceil(seg * al / (Math.PI / 2)));
    for (let j = 0; j <= m; j++) out.push(V.add(C, Q.rot(Q.axis(k, al * j / m), a)));
  }
  out.push(pts[n - 1]);
  return out;
}
// 折れ線上の弧長 s（0..全長）の位置
function polyAt(path, cum, s) {
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
  return V.lerp(path[lo], path[hi], Math.min(1, Math.max(0, t)));
}
// 経路（滑らかにしたもの）を弧長で再サンプル。cl > 1 で終わりのほうを密に
function resample(path, n, cl = 1, sm = 8) {
  const q = catmull(path, sm), cum = [0];
  for (let i = 1; i < q.length; i++) cum.push(cum[i - 1] + V.len(V.sub(q[i], q[i - 1])));
  const L = cum[cum.length - 1], out = [];
  for (let k = 0; k <= n; k++) out.push(polyAt(q, cum, L * (1 - Math.pow(1 - k / n, cl))));
  return {pts: out, L};
}
// ベッセルホルンの半径: 喉 r0 から縁 r1 へ。s = 0..1。b が大きいほど縁で急に開く
const besselR = (r0, r1, b = 0.7) => { const c = 1 - Math.pow(r0 / r1, 1 / b); return s => r0 * Math.pow(1 - c * Math.min(1, s), -b); };
// 実物のベル: 喉が細く縁に向かって急に開く。外面（ラッカー）・内面（暗い金）・巻いた縁（ビード）・継ぎ目のリング
//   path: 喉 → 縁 の経路（曲がっていてもよい）。o: {b, N, rings, cl, wall, rim, mat, inMat, rimMat, collar}
function hornBell(mb, path, r0, r1, o = {}) {
  const N = o.N || 32, b = o.b || 0.7, wall = o.wall || 0.0016, mat = o.mat === undefined ? M.BRASS : o.mat, inMat = o.inMat === undefined ? M.BRASSIN : o.inMat;
  const rs = resample(path, o.rings || 26, o.cl || 1.7), fr = besselR(r0, r1, b), pts = rs.pts, n = pts.length;
  mb.sweep(pts, s => fr(s) + wall * 0.5, mat, {N, smooth: false, capS: true, capE: false});
  mb.sweep(pts, s => Math.max(0.0015, fr(s) - wall * 0.5), inMat, {N, smooth: false, capS: false, capE: false, invert: true});
  const e = pts[n - 1], d = V.norm(V.sub(e, pts[n - 2])), rr = o.rim || 0.0034;
  mb.sweep(circ(e, d, fr(1) - 0.0004, Math.max(40, N + 8)), rr, o.rimMat === undefined ? mat : o.rimMat, {N: 8, sub: 1, smooth: false, capS: false, capE: false});
  if (o.collar) { const c0 = pts[1], d0 = V.norm(V.sub(pts[2], pts[0])); mb.tube(V.madd(pts[1], d0, -0.006), V.madd(pts[1], d0, 0.006), fr(0.02) * 1.3 + 0.002, fr(0.02) * 1.3 + 0.002, o.collarMat || M.NICKEL, {N: 14}); }
  return {end: e, dir: d, fr, len: rs.L};
}
// 管: 経路（折れ線＋曲がりの半径 R）に沿って、半径 r（数値 or s→半径）の管を掃引
function pipe(mb, pts, R, r, mat = M.BRASS, o = {}) {
  const p = R ? roundPath(pts, R, o.seg || 7) : pts;
  return mb.sweep(p, r, mat, {N: o.N || 10, smooth: false, capS: o.capS !== false, capE: o.capE !== false});
}
// 円筒の継ぎ手（フェルール）
const ferrule = (mb, p, d, r, w = 0.008, mat = M.NICKEL) => mb.tube(V.madd(p, d, -w / 2), V.madd(p, d, w / 2), r * 1.28 + 0.001, r * 1.28 + 0.001, mat, {N: 12});
// マウスピース: リム・カップ・のど・シャンク。from = リムの位置、dir = 奥へ向かう向き、k = 大きさ（1 = トランペット）
function mouthpiece2(mb, from, dir, k = 1, mat = M.SILVER) {
  dir = V.norm(dir);
  const prof = [[0.0150, 0.0], [0.0150, 0.0035], [0.0138, 0.0075], [0.0112, 0.0125], [0.0095, 0.0195], [0.0085, 0.030], [0.0078, 0.045], [0.0070, 0.062], [0.0066, 0.068]].map(([r, h]) => [r * k, h * (0.5 + 0.5 * k)]);
  mb.lathe(from, dir, prof, mat, {N: 16, capS: false, capE: true});
  // カップの内側（くぼみ）とリムのビード
  const cup = [[0.0038 * k, 0.0125], [0.0075 * k, 0.0105], [0.0105 * k, 0.0062], [0.0130 * k, 0.0018]].map(([r, h]) => [r, h * (0.5 + 0.5 * k)]);
  mb.lathe(from, dir, cup, mat, {N: 16, invert: true, capS: false, capE: false});
  mb.sweep(circ(V.madd(from, dir, 0.0004), dir, 0.0141 * k, 28), 0.0018 * k, mat, {N: 6, sub: 1, smooth: false, capS: false, capE: false});
  return V.madd(from, dir, 0.068 * (0.5 + 0.5 * k)); // シャンクの終わり
}
// ピストンバルブ: ケーシング・上下のキャップ・ガイドの軸・パールのボタン。yb = 下端、yt = ケーシングの上端
function piston(mb, x, z, yb, yt, r = 0.0105, o = {}) {
  const k = r / 0.0105;
  mb.tube([x, yb, z], [x, yt, z], r, r, o.mat || M.BRASS, {N: 14});
  mb.tube([x, yb - 0.010 * k, z], [x, yb, z], r * 1.12, r * 1.12, M.NICKEL, {N: 14});
  mb.ellipsoid([x, yb - 0.010 * k, z], [r * 0.9, 0.006 * k, r * 0.9], M.NICKEL, {N: 12, lat: 4, axis: [0, -1, 0]});
  mb.tube([x, yt, z], [x, yt + 0.011 * k, z], r * 1.18, r * 1.18, M.NICKEL, {N: 14});
  mb.tube([x, yt + 0.011 * k, z], [x, yt + 0.0145 * k, z], r * 1.25, r * 1.25, M.NICKEL, {N: 14});
  mb.tube([x, yt + 0.0145 * k, z], [x, yt + 0.034 * k, z], 0.0042 * k, 0.0042 * k, M.NICKEL, {N: 8});
  mb.tube([x, yt + 0.034 * k, z], [x, yt + 0.040 * k, z], 0.0092 * k, 0.0092 * k, M.PEARL, {N: 12});
  mb.ellipsoid([x, yt + 0.040 * k, z], [0.0092 * k, 0.0035 * k, 0.0092 * k], M.PEARL, {N: 12, lat: 3});
}
// ロータリーバルブ（ホルン）: 横向きの円筒のケーシングとキャップ
function rotary(mb, c, ax, r, h, mat = M.BRASS) {
  ax = V.norm(ax);
  mb.tube(V.madd(c, ax, -h / 2), V.madd(c, ax, h / 2), r, r, mat, {N: 16});
  mb.tube(V.madd(c, ax, h / 2), V.madd(c, ax, h / 2 + 0.004), r * 1.06, r * 1.06, M.NICKEL, {N: 16});
  mb.tube(V.madd(c, ax, h / 2 + 0.004), V.madd(c, ax, h / 2 + 0.006), r * 0.62, r * 0.62, M.NICKEL, {N: 12});
  mb.tube(V.madd(c, ax, -h / 2 - 0.004), V.madd(c, ax, -h / 2), r * 1.06, r * 1.06, M.NICKEL, {N: 16});
}
// 水抜き（ウォーターキー）: 管に付く小さなレバーと受け皿
function waterKey(mb, p, d, k = 1) {
  mb.tube(p, V.madd(p, d, 0.012 * k), 0.0045 * k, 0.0045 * k, M.NICKEL, {N: 8});
  mb.tube(V.madd(p, d, 0.008 * k), V.madd(V.madd(p, d, 0.012 * k), [0, 0, 1], 0.025 * k), 0.0018 * k, 0.0018 * k, M.NICKEL, {N: 5});
  mb.ellipsoid(V.madd(V.madd(p, d, 0.012 * k), [0, 0, 1], 0.027 * k), [0.0055 * k, 0.0025 * k, 0.0055 * k], M.PEARL, {N: 8, lat: 3});
}
// 平面上の円弧: 中心 c、基底 e1・e2（単位ベクトル）、半径 R、角度 a0..a1
const arcPts = (c, e1, e2, R, a0, a1, n = 14) => Array.from({length: n + 1}, (_, i) => { const t = a0 + (a1 - a0) * i / n; return V.add(c, V.add(V.mul(e1, R * Math.cos(t)), V.mul(e2, R * Math.sin(t)))); });
// U 字の管（スライド）: 2 本の平行な管を U ターンでつなぐ。a, b = 2 本の根元、out = 出る向き、len = 管の長さ
function uSlide(mb, a, b, out, len, r, mat = M.BRASS, o = {}) {
  out = V.norm(out);
  const a2 = V.madd(a, out, len), b2 = V.madd(b, out, len), c = V.mul(V.add(a2, b2), 0.5), w = V.len(V.sub(a, b)) / 2, ax = V.norm(V.sub(a, b));
  mb.tube(a, a2, r, r, mat, {N: o.N || 10, capS: true, capE: false}); mb.tube(b, b2, r, r, mat, {N: o.N || 10, capS: true, capE: false});
  mb.sweep(arcPts(c, ax, out, w, 0, Math.PI, o.n || 12), r, mat, {N: o.N || 10, smooth: false, capS: false, capE: false});
  return {tip: V.madd(c, out, w), c, w};
}

module.exports = {arcPts, roundPath, resample, besselR, hornBell, pipe, ferrule, mouthpiece2, piston, rotary, waterKey, uSlide, MOUTH, Qx, Qz, circ, flare, bell, mouthpiece, valve, drumAt, harness, stick};
