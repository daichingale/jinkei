'use strict';
// 髪（リアル・イラスト共通。頭の骨に付く剛体メッシュ）。7 種類:
//   hime（姫カット: ロングストレート）・twin（ツインテール）・pony（ポニーテール）・bob（ボブ）・side（サイドテール）・wavy（ゆるいウェーブのロング）・braid（三つ編み）
// real = true は、シャコー帽（つばの下端 y≈1.62）の下から見える髪型にする: 結び目は帽子の下、前髪は帽子のつばの下から垂らす。
// 頂点は拡大前の頭の座標で作り、最後に headS（頭の拡大）を通す。
const {V, ss, lerp, clamp} = require('./math');
const S = require('./skeleton');
const M = require('./materials');
const F = require('./face');
const bi = S.id;

const HW = () => [[bi('head'), 1]];
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

// 頭の高さ y・角度 th（0 = 正面、π = 真後ろ、+ が +x 側）の表面の点（gap だけ外へ。頭頂は上へ）
const surf = (th, y, gap) => F.headSurf(th, y, gap);
// 頭を覆う帽子型の面。low(|th|) = 下端の高さ。flare = 裾の広がり、back = 後ろへの張り出し
function cap(hb, o) {
  const {low, gap = 0.0065, top = 1.7022, N = 36, MM = 12, back = 0, mat = M.HAIR} = o;
  const flare = (o.flare || 0) * (hb.real ? 0.2 : 1);
  const vol = (o.vol || 0) * (hb.real ? 0.1 : 1); // リアルは帽子の中に収まる厚みにする
  const pt = (th, v) => {
    const y0 = low(th) + (hb.real ? 0.008 * Math.max(0, 1 - Math.abs(th) / 0.9) : 0), y = lerp(y0, top, v), gp = gap + vol * ss(1.55, 1.665, y) * ss(0, 0.45, v) - 0.0035 * Math.exp(-Math.pow((th - 0.2) / 0.06, 2)) * ss(0.35, 0.75, v) * (vol > 0 ? 1 : 0) + flare * Math.pow(1 - v, 1.4) * (0.35 + 0.65 * Math.abs(Math.sin(th / 2)));
    const p = surf(th, y, gp);
    const bk = back * Math.pow(1 - v, 1.4) * Math.max(0, -Math.cos(th));
    if (y < 1.5) { // 首より下は頭の断面が無いので、1.5 の断面を使って筒状に伸ばす
      const q = surf(th, 1.5, gp);
      return [q[0] * (1 + (1.5 - y) * 0.15), y, q[2] - bk];
    }
    return [p[0], p[1], p[2] - bk];
  };
  hb.grid(N, MM, (u, v) => pt((u - 0.5) * 2 * Math.PI, v), mat, {flip: o.flip, wt: HW});
}
// 帽子型の下端の高さ: 前（生え際）→ 横 → 後ろ。結んだ髪型は後頭部も首すじの近くまで覆う
const tiedLow = (sideY = 1.575, backY = 1.495) => th => {
  const a = Math.abs(th);
  if (a < 0.9) return lerp(1.620, 1.597, a / 0.9);
  if (a < 1.6) return lerp(1.597, sideY, ss(0.9, 1.6, a));
  return lerp(sideY, backY, ss(1.6, 2.5, a));
};
// 先の細くなる毛束（板状）。pts = 経路、w0 → w1 = 幅、th = 厚み
let FAT = 1;
function lock(hb, pts, w0, w1, th = 0.55, mat = M.HAIR, pw = 0.9, fat = FAT) {
  w0 *= fat;
  const p0 = pts[0], up = V.norm([p0[0] * 1.0, 0, p0[2] - 0.0]);
  hb.sweep(pts, s => { const w = lerp(w0, w1, Math.pow(s, pw)); return [w, w * th]; }, mat, {N: 6, sub: pts.length <= 4 ? 3 : 4, wt: HW, up});
}
// 前髪: [x, 毛先の y, 毛先の横ずれ, 幅] の束を額に沿って垂らす。根もとは頭頂側（髪の面の下）から出て、毛先は細く尖る。
// 束は隣と重なり、長さと向きをばらつかせる（くし状のぎざぎざにしない）
function fringe(hb, tips, real, o = {}) {
  const yr = real ? 1.619 : 1.676, gap = o.gap || 0.0085;
  tips.forEach(([x, yb0, lean0, w0], i) => {
    const r1 = ((i * 53 + 17) % 11) / 10 - 0.5, r2 = ((i * 29 + 5) % 7) / 6 - 0.5;
    const yb = yb0 + r1 * (o.jy === undefined ? 0.011 : o.jy), lean = lean0 + r2 * 0.006, w = w0 * (o.wm || 1.7);
    const ys = [yr, lerp(yr, yb, 0.35), lerp(yr, yb, 0.72), yb];
    const pts = ys.map((y, k) => {
      const s = k / 3, xx = x + lean * Math.pow(s, 1.5) + (o.spread || 0) * x * s * 0.3;
      const g = gap + (real ? 0.0045 * Math.pow(1 - s, 1.5) + (k === 0 ? -0.0030 : 0) + 0.005 * s * s : [0.0070, 0.0010, 0.0013, 0.0050][k]);
      const f = F.headFront(clamp(xx, -0.076, 0.076), Math.max(y, 1.47), g);
      return [f.p[0], y, f.p[2]];
    });
    lock(hb, pts, w, o.tip === undefined ? 0.0008 : o.tip, 0.5, M.HAIR, o.pw || 0.85, 1);
  });
}
// ぱっつん前髪: 幅の広い毛束を重ね、毛先は細く尖らせて長さをばらつかせる
function fringeBlunt(hb, real, {base = 1.612, n = 15, xw = 0.068, w = 0.0085, side = 0.005, tip = 0.0008, pw = 1.2} = {}) {
  const tips = [];
  for (let i = 0; i < n; i++) {
    const x = lerp(-xw, xw, i / (n - 1));
    tips.push([x, base + side * Math.pow(Math.abs(x) / xw, 2) - (i % 3 === 1 ? 0.004 : 0), 0, w]);
  }
  fringe(hb, tips, real, {tip, pw});
}
// 前髪（ぱっつん）: 額に沿った 1 枚の面。下の縁は毛束ごとのゆるい尖りで切る（使っていない）
function fringeSheet(hb, real, o) {
  const {xw = 0.068, base = 1.612, clump = 0.0225, notch = 0.0045, side = 0.005, slope = 0, vee = 0} = o, yr = real ? 1.619 : 1.676, gap = 0.0085;
  const yb = x => { const c = ((x + xw) / clump) % 1; return base + side * Math.pow(Math.abs(x) / xw, 2) + slope * x - vee * Math.abs(x) - notch * (1 - Math.abs(2 * c - 1)) * (Math.abs(x) < xw * 0.98 ? 1 : 0); };
  hb.grid(44, 8, (u, v) => {
    const x = lerp(-xw, xw, u), y = lerp(yr, yb(x), v), f = F.headFront(x, y, gap + (real && v < 0.2 ? -0.005 * (1 - v / 0.2) : 0) + 0.0045 * v * v);
    return f.p;
  }, M.HAIR, {nz: 1, double: true, wt: HW});
}
// 横髪（耳の前を通ってあご・胸へ垂らす）。len = 毛先の y、sx = 外への広がり、wv = 波の振幅
const Q = [];
const sideLocks = (...a) => Q.push(() => sideLocks0(...a));
function sideLocks0(hb, len, w = 0.016, o = {}) {
  for (const s of [-1, 1]) {
    const th = s * (o.th || 1.12), pts = [];
    const ys = [1.636, 1.585, lerp(1.585, len, 0.5), len];
    ys.forEach((y, k) => {
      const t = k / 3, p = surf(th + s * 0.18 * t, Math.max(y, 1.5), 0.010 + 0.010 * t);
      const sw = (o.wave || 0) * Math.sin(t * 6.0) * s;
      pts.push([p[0] + s * (o.sx || 0) * t * t + sw, y, y < 1.5 ? lerp(p[2], o.zEnd === undefined ? 0.05 : o.zEnd, ss(1.5, len, y)) : p[2]]);
    });
    lock(hb, pts, w * (hb.real ? 1.35 : 1.15), 0.0006, 0.5, M.HAIR, 0.9, 1);
  }
}
// 後ろ髪の房（頭の後ろから背中へ。うねりつき）
function backLocks(hb, n, yEnd, spread, wave, w = 0.022) {
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1, th = Math.PI + u * spread, pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5, y = lerp(1.63, yEnd, Math.pow(t, 0.9)), p = surf(th, Math.max(y, 1.5), 0.010 + 0.034 * t * (1 - 0.3 * Math.abs(u)));
      pts.push([p[0] * (1 + 0.35 * t) + wave * Math.sin(t * 7 + i * 1.7) * 0.5 * t, y, y < 1.5 ? Math.min(p[2], -0.085 - 0.01 * t) : p[2]]);
    }
    lock(hb, pts, w, 0.003, 0.5, M.HAIR, 1.4);
  }
}
// 髪ゴム（セクションの色）
const tie = (hb, c, r = 0.017) => hb.ellipsoid(c, [r * 1.25, r, r * 1.25], M.SLEEVE, {N: 10, lat: 6, wt: HW});

const BANG_FULL = (y, e = 0) => [[-0.066, y + 0.006, -0.004, 0.0075], [-0.054, y + 0.002, 0, 0.0075], [-0.042, y, 0, 0.0075], [-0.030, y - 0.0005, 0, 0.0075], [-0.018, y - 0.001, 0, 0.0075], [-0.006, y - 0.001, 0, 0.0075],
  [0.006, y - 0.001, 0, 0.0075], [0.018, y - 0.001, 0, 0.0075], [0.030, y - 0.0005, 0, 0.0075], [0.042, y, 0, 0.0075], [0.054, y + 0.002, 0, 0.0075], [0.066, y + 0.006, 0.004, 0.0075]];
// 流し前髪（左の分け目から右へ流す）
const BANG_SWEPT = (y, dir = 1) => [[-0.062 * dir, y + 0.012, -0.010 * dir, 0.011], [-0.047 * dir, y + 0.004, -0.004 * dir, 0.0105], [-0.032 * dir, y - 0.001, 0.004 * dir, 0.0105],
  [-0.016 * dir, y - 0.002, 0.008 * dir, 0.0105], [0.0, y - 0.003, 0.010 * dir, 0.0105], [0.016 * dir, y - 0.003, 0.010 * dir, 0.0100], [0.032 * dir, y - 0.002, 0.008 * dir, 0.0100], [0.048 * dir, y + 0.003, 0.004 * dir, 0.0100], [0.062 * dir, y + 0.012, 0.001 * dir, 0.0095]];
// 中分けの前髪（毛先が外へ流れる）
const BANG_PART = (y) => [[-0.060, y + 0.010, -0.014, 0.0095], [-0.046, y + 0.003, -0.012, 0.0095], [-0.032, y - 0.001, -0.009, 0.0095], [-0.018, y - 0.002, -0.006, 0.0095], [-0.006, y - 0.0015, -0.003, 0.0090],
  [0.006, y - 0.0015, 0.003, 0.0090], [0.018, y - 0.002, 0.006, 0.0095], [0.032, y - 0.001, 0.009, 0.0095], [0.046, y + 0.003, 0.012, 0.0095], [0.060, y + 0.010, 0.014, 0.0095]];

// 前髪の種類ごとに、イラストは毛束（先が尖る）、リアルは帽子のつばの下から見える 1 枚の面（縁を毛束ごとに切る）
const bangs = (...a) => Q.push(() => bangs0(...a));
function bangs0(hb, real, kind, y) {
  if (real) {
    const o = {blunt: {base: y - 0.006, notch: 0.0028, clump: 0.0272}, bob: {base: y - 0.007, notch: 0.0022, clump: 0.022, xw: 0.066},
      sw1: {base: y - 0.007, slope: -0.14, notch: 0.003, clump: 0.0272}, sw2: {base: y - 0.007, slope: 0.14, notch: 0.003, clump: 0.0272}, part: {base: y - 0.002, vee: 0.10, notch: 0.003, clump: 0.0272}}[kind];
    fringeSheet(hb, real, o);
  } else if (kind === 'blunt') fringeBlunt(hb, real, {base: y});
  else if (kind === 'bob') fringeBlunt(hb, real, {base: y - 0.001, n: 13, xw: 0.064, tip: 0.0035});
  else if (kind === 'sw1') fringe(hb, BANG_SWEPT(y, 1), real);
  else if (kind === 'sw2') fringe(hb, BANG_SWEPT(y, -1), real);
  else fringe(hb, BANG_PART(y), real);
}

const STYLES = {
  // 姫カット: 眉の上でまっすぐそろえた前髪、あごから胸までの横髪、背中までのロングストレート
  hime(hb, real) {
    cap(hb, {low: th => { const a = Math.abs(th); return a < 0.9 ? lerp(1.620, 1.597, a / 0.9) : lerp(1.597, 1.30, Math.pow(Math.min(1, (a - 0.9) / 1.6), 0.85)); }, gap: 0.0065, flare: 0.022, back: 0.040, vol: 0.013});
    bangs(hb, real, 'blunt', 1.612);
    sideLocks(hb, 1.43, 0.0165, {sx: 0.004});
  },
  // ツインテール: 低め（帽子の下）または高め（イラスト）の左右の結び目から、ゆるいカーブの毛束
  twin(hb, real) {
    cap(hb, {low: tiedLow(1.57, 1.475), gap: 0.0065, vol: 0.013});
    bangs(hb, real, 'part', 1.604);
    sideLocks(hb, 1.485, 0.013, {sx: 0.004});
    const ay = real ? 1.585 : 1.655, ax = real ? 0.082 : 0.075, az = real ? -0.028 : -0.034;
    for (const s of [-1, 1]) {
      tie(hb, [s * ax, ay, az], 0.0165);
      const pts = [[s * ax, ay, az], [s * (ax + 0.034), ay - 0.025, az - 0.012], [s * (ax + 0.062), ay - 0.085, az - 0.018], [s * (ax + 0.066), ay - 0.165, az - 0.012], [s * (ax + 0.060), ay - 0.235, az + 0.000], [s * (ax + 0.068), ay - 0.275, az + 0.006]];
      lock(hb, pts, 0.030, 0.004, 1.0, M.HAIR, 1.1);
      lock(hb, pts.map(p => [p[0] + s * 0.012, p[1] + 0.004, p[2] - 0.006]), 0.016, 0.003, 0.7, M.HAIR, 1.1);
    }
  },
  // ポニーテール: 高い位置（帽子のときは首の後ろ）で結ぶ
  pony(hb, real) {
    cap(hb, {low: tiedLow(1.57, 1.475), gap: 0.0065, vol: 0.013});
    bangs(hb, real, 'sw1', 1.604);
    sideLocks(hb, 1.49, 0.012, {sx: 0.002});
    const ay = real ? 1.575 : 1.668, az = real ? -0.108 : -0.094;
    tie(hb, [0, ay, az], 0.018);
    const sh = real ? 0.0 : 0.05;
    const pts = [[0, ay, az], [0, ay + 0.012 + sh * 0.3, az - 0.055], [0, ay - 0.040 + sh * 0.2, az - 0.105], [0.004, ay - 0.130, az - 0.120], [0.012, ay - 0.220, az - 0.112], [0.006, ay - 0.300, az - 0.098]];
    lock(hb, pts, 0.034, 0.004, 1.0, M.HAIR, 1.0);
    lock(hb, pts.map(p => [p[0] - 0.017, p[1] + 0.003, p[2] - 0.006]), 0.017, 0.003, 0.7, M.HAIR, 1.1);
    lock(hb, pts.map(p => [p[0] + 0.019, p[1] + 0.003, p[2] - 0.004]), 0.015, 0.003, 0.7, M.HAIR, 1.1);
  },
  // ボブ: あごのラインで内巻き。丸いシルエット
  bob(hb, real) {
    cap(hb, {low: th => { const a = Math.abs(th); return a < 0.9 ? lerp(1.620, 1.597, a / 0.9) : lerp(1.597, 1.478, Math.pow(Math.min(1, (a - 0.9) / 1.0), 0.8)); }, gap: 0.0065, flare: 0.013, back: 0.004, vol: 0.013});
    bangs(hb, real, 'bob', 1.609);
    sideLocks(hb, 1.468, 0.0185, {sx: -0.006, zEnd: 0.075, th: 1.18});
  },
  // サイドテール: 左（+x）の耳の後ろで結んで肩の後ろへ流す
  side(hb, real) {
    cap(hb, {low: tiedLow(1.57, 1.475), gap: 0.0065, vol: 0.013});
    bangs(hb, real, 'sw2', 1.605);
    sideLocks(hb, 1.49, 0.012, {sx: 0.003});
    const ay = real ? 1.585 : 1.640, ax = 0.082, az = -0.045;
    tie(hb, [ax, ay, az], 0.0165);
    const pts = [[ax, ay, az], [ax + 0.040, ay - 0.030, az - 0.020], [ax + 0.072, ay - 0.100, az - 0.040], [ax + 0.078, ay - 0.190, az - 0.060], [ax + 0.066, ay - 0.265, az - 0.068], [ax + 0.070, ay - 0.320, az - 0.062]];
    lock(hb, pts, 0.032, 0.004, 1.0, M.HAIR, 1.0);
    lock(hb, pts.map(p => [p[0] + 0.014, p[1] + 0.004, p[2] - 0.006]), 0.016, 0.003, 0.7, M.HAIR, 1.1);
  },
  // ゆるいウェーブのロング: 毛先がゆれる。中分けの前髪
  wavy(hb, real) {
    cap(hb, {low: th => { const a = Math.abs(th); return a < 0.9 ? lerp(1.620, 1.597, a / 0.9) : lerp(1.597, 1.35, Math.pow(Math.min(1, (a - 0.9) / 1.6), 0.9)) + 0.014 * Math.sin(a * 8) * ss(1.0, 1.6, a); }, gap: 0.0065, flare: 0.026, back: 0.036, vol: 0.013});
    bangs(hb, real, 'part', 1.603);
    sideLocks(hb, 1.43, 0.016, {sx: 0.010, wave: 0.006});
    backLocks(hb, 5, 1.36, 0.85, 0.02, 0.020);
  },
  // 三つ編み: 後ろで一本に編んで背中へ。前髪は斜め
  braid(hb, real) {
    cap(hb, {low: tiedLow(1.57, 1.475), gap: 0.0065, vol: 0.013, back: 0.006});
    bangs(hb, real, 'sw1', 1.606);
    sideLocks(hb, 1.50, 0.013, {sx: 0.002});
    // 三つ編み: 交互に傾けた楕円体を連ねる
    const ay = real ? 1.572 : 1.600, az = -0.104;
    const nb = 12, step = 0.0245;
    for (let i = 0; i < nb; i++) {
      const y = ay - i * step * 0.98, z = az - 0.020 - 0.028 * Math.sin(Math.min(1, i / 4) * 1.2) - 0.002 * i, r = lerp(0.0185, 0.011, i / nb), sgn = i % 2 ? 1 : -1;
      hb.ellipsoid([sgn * 0.0045, y, z], [r * 1.05, step * 0.78, r * 0.95], M.HAIR, {N: 10, lat: 6, axis: V.norm([sgn * 0.35, 1, 0]), wt: HW});
    }
    const ye = ay - nb * step * 0.98;
    hb.ellipsoid([0, ye - 0.004, az - 0.050], [0.010, 0.012, 0.010], M.HAIR, {N: 8, lat: 5, wt: HW});
    tie(hb, [0, ye + 0.002, az - 0.048], 0.0125);
    tie(hb, [0, ay + 0.004, az - 0.016], 0.016);
  },
};
const NAMES = Object.keys(STYLES);

// 1 つの髪メッシュを作る（頭の拡大つき）
function build(hb, name, real) {
  hb.real = real; FAT = real ? 1.3 : 1.1; Q.length = 0;
  STYLES[name](hb, real);
  // 輪郭線は、ここまでの面（頭の丸み・結んだ毛束）だけ。前髪・横髪の毛束ごとの縁には付けない
  hb.noOutline = hb.T.length;
  for (const f of Q) f();
  F.scaleHeadVerts(hb, 0, hb.P.length);
}
module.exports = {NAMES, build};
