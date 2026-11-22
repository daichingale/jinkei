'use strict';
// 顔まわり: 頭の断面（リアル・イラスト共通）、顔のテクスチャ（目・眉・口・ほお）とそれを貼る曲面パッチ、頭の拡大
// 目・眉・口・ほおは「顔テクスチャ」（RGBA8 を2枚: A, B）に焼き、頭の表面から 1mm 浮かせた曲面（face パッチ）に貼る。
//   A.r = 墨（まつげ・瞳孔・鼻の影）  A.g = 眉  A.b = 白目  A.a = 虹彩
//   B.r = 虹彩のグラデーション位置（0 = 暗い上 … 1 = 明るい下）  B.g = ハイライト  B.b = ほお  B.a = 口（0.5 = くちびる, 1 = 口の線）
// 色（虹彩・眉・肌）は実行時に隊員ごとに決める。左右は x の絶対値で描くので完全に対称。
const {ss, lerp, clamp} = require('./math');

// ---- 頭の断面（下から上）: [y, rx, rz, 中心z]。ほおは丸く、あごは小さくとがらせる ----
const HEAD_ROWS = [
  [1.458, 0.000, 0.000, 0.082],
  [1.461, 0.014, 0.020, 0.077], [1.467, 0.032, 0.042, 0.060], [1.477, 0.052, 0.062, 0.044], [1.490, 0.067, 0.077, 0.031], [1.507, 0.074, 0.088, 0.019],
  [1.530, 0.080, 0.097, 0.010], [1.560, 0.083, 0.101, 0.006], [1.595, 0.082, 0.102, 0.005], [1.630, 0.077, 0.100, 0.003], [1.665, 0.067, 0.087, 0.0], [1.69, 0.047, 0.063, -0.002], [1.703, 0.0, 0.0, 0],
];
const HEAD_TOP = 1.703, HEAD_BOT = 1.458;
// y での (rx, rz, zc, n)。区間ごとの 3 次補間（なめらか）。n は下ほど 2.0 に寄せる
function headAt(y) {
  y = clamp(y, HEAD_BOT, HEAD_TOP);
  const R = HEAD_ROWS;
  let i = 0;
  while (i + 2 < R.length && y > R[i + 1][0]) i++;
  const p0 = R[Math.max(0, i - 1)], p1 = R[i], p2 = R[i + 1], p3 = R[Math.min(R.length - 1, i + 2)];
  const h = p2[0] - p1[0], t = (y - p1[0]) / h, t2 = t * t, t3 = t2 * t;
  const o = [1, 2, 3].map(k => {
    // 不等間隔の Catmull-Rom（接線は前後の点を結ぶ傾き）
    const d1 = (p2[k] - p0[k]) / (p2[0] - p0[0]) * h, d2 = (p3[k] - p1[k]) / (p3[0] - p1[0]) * h;
    const a = 2 * t3 - 3 * t2 + 1, b = t3 - 2 * t2 + t, c = -2 * t3 + 3 * t2, d = t3 - t2;
    return a * p1[k] + b * d1 + c * p2[k] + d * d2;
  });
  return {rx: Math.max(0, o[0]), rz: Math.max(0, o[1]), zc: o[2], n: lerp(2.0, 2.3, ss(1.49, 1.53, y))};
}
// 頭のループ用の断面（細かく）。先頭（あご先）と末尾（頭頂）は点で閉じる
function headRings() {
  const rows = [];
  const NY = 30;
  for (let i = 0; i <= NY; i++) {
    const y = lerp(HEAD_BOT + 0.0012, HEAD_TOP - 0.0012, i / NY), h = headAt(y);
    rows.push({c: [0, y, 0], rx: h.rx, rz: h.rz, oz: h.zc, n: h.n});
  }
  return rows;
}
// 頭の表面（高さ y・横 x）の前側の点と外向き法線（off だけ浮かせる）
function headFront(x, y, off = 0) {
  const F = (h, xx, zz) => Math.pow(Math.abs(xx) / Math.max(1e-6, h.rx), h.n) + Math.pow(Math.abs(zz - h.zc) / Math.max(1e-6, h.rz), h.n);
  const h = headAt(y), k = Math.min(0.9995, Math.abs(x) / h.rx), z = h.zc + h.rz * Math.pow(1 - Math.pow(k, h.n), 1 / h.n);
  const e = 0.0006, hp = headAt(y + e), hm = headAt(y - e), dx = 1e-5;
  const g = [(F(h, x + dx, z) - F(h, x - dx, z)) / (2 * dx), (F(hp, x, z) - F(hm, x, z)) / (2 * e), (F(h, x, z + dx) - F(h, x, z - dx)) / (2 * dx)];
  const l = Math.hypot(g[0], g[1], g[2]) || 1, n = [g[0] / l, g[1] / l, g[2] / l];
  return {p: [x + n[0] * off, y + n[1] * off, z + n[2] * off], n};
}

// 頭の表面の点（角度 th: 0 = 正面、π = 後ろ、+ が +x 側。高さ y）を外向きの法線方向へ off だけ浮かせる（髪の面などに使う）
function headSurf(th, y, off = 0) {
  y = Math.min(y, HEAD_TOP - 0.0008);
  const F = (h, xx, zz) => Math.pow(Math.abs(xx) / Math.max(1e-6, h.rx), h.n) + Math.pow(Math.abs(zz - h.zc) / Math.max(1e-6, h.rz), h.n);
  const h = headAt(y), e = 2 / h.n, sn = Math.sin(th), cs = Math.cos(th);
  const x = h.rx * Math.sign(sn) * Math.pow(Math.abs(sn), e), z = h.zc + h.rz * Math.sign(cs) * Math.pow(Math.abs(cs), e);
  const ey = 0.0008, hp = headAt(y + ey), hm = headAt(Math.max(HEAD_BOT, y - ey)), dx = 1e-5;
  const g = [(F(h, x + dx, z) - F(h, x - dx, z)) / (2 * dx), (F(hp, x, z) - F(hm, x, z)) / (2 * ey), (F(h, x, z + dx) - F(h, x, z - dx)) / (2 * dx)];
  let l = Math.hypot(g[0], g[1], g[2]);
  const n = l < 1e-9 ? [0, 1, 0] : [g[0] / l, g[1] / l, g[2] / l];
  return [x + n[0] * off, y + n[1] * off, z + n[2] * off];
}

// ---- 頭の拡大: 口の位置（楽器の吹き口の当たる場所）を動かさずに頭を大きくする ----
// 横・奥行きを 1.14 倍、高さを 1.05 倍（全体でおよそ +9%。丸く幼い頭の比率）
const HEAD_SCALE = [1.14, 1.05, 1.14], PIV = [0, 1.512, 0.106];
const headS = p => [PIV[0] + (p[0] - PIV[0]) * HEAD_SCALE[0], PIV[1] + (p[1] - PIV[1]) * HEAD_SCALE[1], PIV[2] + (p[2] - PIV[2]) * HEAD_SCALE[2]];
// MeshBuilder の頂点 [from, to) を拡大する
function scaleHeadVerts(mb, from, to) {
  for (let i = from; i < to; i++) mb.P[i] = headS(mb.P[i]);
}

// ================= 顔テクスチャ =================
const TW = 384, TH = 384;
const FX0 = -0.0735, FX1 = 0.0735, FY0 = 1.487, FY1 = 1.634; // テクスチャが覆う範囲（x, y）
const uOf = x => (x - FX0) / (FX1 - FX0), vOf = y => (FY1 - y) / (FY1 - FY0);
const pxX = (FX1 - FX0) / TW, pxY = (FY1 - FY0) / TH;

// 1枚の層。bb = [x0, y0, x1, y1]（メートル）の範囲だけ走査する
class Layer {
  constructor() { this.d = new Float32Array(TW * TH); }
  range(bb) {
    return [Math.max(0, Math.floor(uOf(bb[0]) * TW)), Math.min(TW - 1, Math.ceil(uOf(bb[2]) * TW)), Math.max(0, Math.floor(vOf(bb[3]) * TH)), Math.min(TH - 1, Math.ceil(vOf(bb[1]) * TH))];
  }
  // f(|x|, y) → 0..1 を n×n の超サンプリングで塗る（縁がなめらか）
  // 範囲は x > 0 側で指定し、x < 0 側にも鏡像で塗る（|x| で評価するので左右は完全に対称）
  paint(bb, f, n = 4) {
    for (const r of [this.range(bb), this.range([-bb[2], bb[1], -bb[0], bb[3]])]) {
      const [i0, i1, j0, j1] = r;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        let s = 0;
        for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) s += f(Math.abs(FX0 + (i + (a + 0.5) / n) * pxX), FY1 - (j + (b + 0.5) / n) * pxY);
        const k = j * TW + i;
        this.d[k] = Math.max(this.d[k], s / (n * n));
      }
    }
  }
  // 連続値（グラデーション）。超サンプリングなし。mode 'set' は上書き、'max' は大きいほうを残す
  field(bb, f, mode = 'max') {
    for (const r of [this.range(bb), this.range([-bb[2], bb[1], -bb[0], bb[3]])]) {
      const [i0, i1, j0, j1] = r;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = f(Math.abs(FX0 + (i + 0.5) * pxX), FY1 - (j + 0.5) * pxY), k = j * TW + i;
        this.d[k] = mode === 'set' ? v : Math.max(this.d[k], v);
      }
    }
  }
}
// 太さの変わる線（折れ線 [x, y, 直径]）の範囲と判定関数
function stroke(pts, val = 1) {
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) { const r = p[2] / 2 + 0.001; bb[0] = Math.min(bb[0], p[0] - r); bb[1] = Math.min(bb[1], p[1] - r); bb[2] = Math.max(bb[2], p[0] + r); bb[3] = Math.max(bb[3], p[1] + r); }
  const f = (x, y) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
      const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1), r = lerp(a[2], b[2], t) / 2, ex = x - (a[0] + dx * t), ey = y - (a[1] + dy * t);
      if (ex * ex + ey * ey <= r * r) return val;
    }
    return 0;
  };
  return {bb, f};
}
const ell = (cx, cy, a, b, shear = 0) => (x, y) => { const dx = x - cx, dy = y - cy - shear * dx; return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1 ? 1 : 0; };
const gauss = (cx, cy, sx, sy, k) => (x, y) => k * Math.exp(-((x - cx) * (x - cx)) / (2 * sx * sx) - ((y - cy) * (y - cy)) / (2 * sy * sy));

// 目の形（ここでまとめて調整する）。x は中心からの絶対値、目じりが +x 側
const EYE = {cx: 0.0360, cy: 1.5640, a: 0.0182, b: 0.0250, shear: 0.11};
const eyeRho = (x, y) => { const dx = x - EYE.cx, dy = y - EYE.cy - EYE.shear * dx; return Math.hypot(dx / EYE.a, dy / EYE.b); };
// まぶたの縁の点（th: 0 = 目じり側、π/2 = 上、π = 目がしら側）
const eyeEdge = (th, off = 0) => {
  const a = EYE.a + off, b = EYE.b + off, dx = a * Math.cos(th), dy = b * Math.sin(th);
  return [EYE.cx + dx, EYE.cy + dy + EYE.shear * dx];
};

function bakeFace() {
  const mk = () => [0, 1, 2, 3].map(() => new Layer());
  const A = mk(), B = mk(), [ink, brow, sclera, iris] = A, [irisT, hi, blush, mouth] = B;
  const eb = [EYE.cx - 0.03, EYE.cy - 0.04, EYE.cx + 0.045, EYE.cy + 0.05];
  const eyeShape = ell(EYE.cx, EYE.cy, EYE.a, EYE.b, EYE.shear);
  // ---- 白目・虹彩・瞳孔 ----
  sclera.paint(eb, eyeShape);
  const IC = {cx: EYE.cx - 0.0004, cy: EYE.cy - 0.0018, a: 0.0142, b: 0.0228};
  iris.paint(eb, (x, y) => (ell(IC.cx, IC.cy, IC.a, IC.b)(x, y) && eyeShape(x, y) ? 1 : 0));
  irisT.field(eb, (x, y) => {
    const u = clamp((IC.cy + IC.b - y) / (2 * IC.b), 0, 1);                  // 0 = 上 … 1 = 下
    const rho = Math.hypot((x - IC.cx) / IC.a, (y - IC.cy) / IC.b);
    let t = 0.10 + 0.62 * Math.pow(u, 1.15);                                // 上が暗く下が明るい
    t += 0.28 * ss(0.45, 1.0, u) * ss(0.25, 0.85, rho);                     // 下の縁に光がたまる
    t -= 0.42 * ss(0.80, 1.02, rho);                                         // 外周は暗い輪
    return clamp(t, 0, 1);
  }, 'set');
  ink.paint(eb, (x, y) => (ell(IC.cx, IC.cy + 0.0006, 0.0066, 0.0124)(x, y) && eyeShape(x, y) ? 1 : 0)); // 瞳孔
  // 白目の上のまぶたの影（墨のうすい面）
  ink.field(eb, (x, y) => { const rho = eyeRho(x, y); return rho > 1 ? 0 : 0.30 * ss(0.55, 1.0, rho) * ss(-0.002, 0.012, y - EYE.cy); });
  // ---- 上まつげ（太く、目じりを少し跳ね上げる）----
  {
    const pts = [], N = 28, th0 = Math.PI * 1.06, th1 = -0.03;
    for (let i = 0; i <= N; i++) {
      const s = i / N, e = eyeEdge(lerp(th0, th1, s), 0.0007);
      const w = 0.0010 + 0.0036 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(s, 0.8) * 0.95 + 0.04)), 0.8) + 0.0006 * ss(0.6, 1.0, s);
      pts.push([e[0], e[1] + w * 0.35, w]);
    }
    const o = pts[pts.length - 1];
    pts.push([o[0] + 0.0030, o[1] + 0.0020, 0.0028], [o[0] + 0.0058, o[1] + 0.0044, 0.0017], [o[0] + 0.0085, o[1] + 0.0074, 0.0006]); // 目じりの跳ね上げ
    const st = stroke(pts); ink.paint(st.bb, st.f);
    const e0 = eyeEdge(Math.PI * 1.02, 0.0006);
    ink.paint([e0[0] - 0.003, e0[1] - 0.003, e0[0] + 0.003, e0[1] + 0.003], ell(e0[0] + 0.0002, e0[1] - 0.0002, 0.0012, 0.0010)); // 目がしらの点
  }
  // ---- 下まつげ（細く、うすく）----
  {
    const pts = [];
    for (let i = 0; i <= 14; i++) { const e = eyeEdge(lerp(Math.PI * 1.12, Math.PI * 1.95, i / 14), 0.0004); pts.push([e[0], e[1], 0.00065 + 0.0005 * Math.sin(Math.PI * i / 14)]); }
    const st = stroke(pts, 0.55); ink.paint(st.bb, st.f);
  }
  // ---- 二重のしわ（まぶたの上のうすい線）----
  {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const e = eyeEdge(lerp(Math.PI * 0.80, Math.PI * 0.12, i / 12), 0.0056); pts.push([e[0], e[1], 0.0006 * Math.sin(Math.PI * (0.1 + 0.8 * i / 12)) + 0.0002]); }
    const st = stroke(pts, 0.32); ink.paint(st.bb, st.f);
  }
  // ---- ハイライト（大小。左右で同じ側 = 鏡像）----
  hi.paint(eb, ell(IC.cx - 0.0058, IC.cy + 0.0088, 0.0052, 0.0060));
  hi.paint(eb, ell(IC.cx + 0.0048, IC.cy - 0.0098, 0.0024, 0.0026));
  hi.paint(eb, ell(IC.cx + 0.0066, IC.cy + 0.0036, 0.0011, 0.0012));
  // ---- 眉（細く高い位置）----
  {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push([lerp(0.0235, 0.0585, t), 1.6018 + 0.0036 * Math.sin(Math.PI * Math.pow(t, 0.85)) - 0.0020 * t, 0.0009 + 0.0011 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (1 - 0.5 * t) + 0.0002]);
    }
    const st = stroke(pts, 0.92); brow.paint(st.bb, st.f);
  }
  // ---- 鼻（ちいさな影）・ほお ----
  ink.field([0, 1.533, 0.01, 1.547], gauss(0, 1.5405, 0.0020, 0.0014, 0.24));
  blush.field([0.02, 1.52, 0.074, 1.556], gauss(0.0478, 1.5385, 0.0100, 0.0046, 0.55));
  // ---- 口（小さく笑った線と、その下のくちびる）----
  {
    const y0 = 1.5105, pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12 * 2 - 1; pts.push([0.0078 * t, y0 - 0.0016 * (1 - t * t), 0.0011 * (1 - 0.35 * Math.abs(t))]); }
    mouth.field([0, y0 - 0.008, 0.012, y0 + 0.004], gauss(0, y0 - 0.0030, 0.0036, 0.0014, 0.5));
    const st = stroke(pts); mouth.paint([0, st.bb[1], st.bb[2], st.bb[3]], st.f);
  }
  const pack = L => {
    const out = new Uint8Array(TW * TH * 4);
    for (let k = 0; k < TW * TH; k++) for (let c = 0; c < 4; c++) out[k * 4 + c] = Math.round(clamp(L[c].d[k], 0, 1) * 255);
    return out;
  };
  return {w: TW, h: TH, a: pack(A), b: pack(B)};
}

// ================= 顔パッチ（頭の表面から少し浮かせた、テクスチャを貼る曲面）=================
// 頂点は拡大前の座標で返す（呼び出し側で headS を通す）。UV の v は上が 0
function facePatch(nx = 26, ny = 22, off = 0.0013) {
  const P = [], N = [], UV = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const y = lerp(FY0, FY1, j / ny), xm = Math.min(0.0735, headAt(y).rx * 0.9);
    for (let i = 0; i <= nx; i++) {
      const x = lerp(-xm, xm, i / nx), f = headFront(x, y, off);
      P.push(f.p); N.push(f.n); UV.push([uOf(x), vOf(y)]);
    }
  }
  const W = nx + 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, b, d, a, d, c); // 前（+z）向きが表になる巻き
  }
  return {P, N, UV, idx};
}

module.exports = {HEAD_ROWS, HEAD_TOP, HEAD_BOT, headAt, headRings, headFront, headSurf, headS, scaleHeadVerts, HEAD_SCALE, PIV, bakeFace, facePatch, TW, TH};
