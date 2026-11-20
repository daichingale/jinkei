'use strict';
// 木管・サックス・ファゴットのメッシュと握り。座標系は instruments.js と同じ（足の裏 y=0、+Z が前、左 = +X）
const {V, Q, lerp} = require('./math');
const M = require('./materials');
const {MOUTH, circ, flare, bell} = require('./parts');

// 軸 d に垂直で「前・上」を向く法線（音孔・キーが付く面）
const faceN = d => V.norm([0, d[2], -d[1]]);
// 軸上の s の位置の点
const pt = (a, d, s) => V.madd(a, d, s);
// 薄い円盤状のキー（法線 n 方向に張り出す）
const button = (mb, p, n, r, mat = M.SILVER) => mb.ellipsoid(p, [r, 0.0032, r], mat, {axis: n, N: 8, lat: 3});
// 軸まわりの帯（リング・ジョイント）
const band = (mb, a, d, s, w, r, mat = M.SILVER) => mb.tube(pt(a, d, s), pt(a, d, s + w), r, r, mat, {N: 14});

// ---- クラリネット族・ソプラノサックス（まっすぐな本体）----
// o: {d 本体の向き, dm 吹き口の向き, len 本体長さ, r0, r1 半径, nk キーの数, bodyMat, keyMat, bellR, bellLen,
//     neck {k} 曲がった金属ネック, up 金属ベルの上向き量, bellMat, gL gR 握りの位置（吹き口からの距離）}
function reedWind(mb, o) {
  const a = [0, 1.505, 0.100], d = V.norm(o.d), dm = V.norm(o.dm || o.d), n = faceN(d), body = o.bodyMat || M.BLACKWOOD, keyMat = o.keyMat || M.SILVER;
  // 吹き口（黒）とリガチャ
  const m1 = pt(a, dm, 0.075);
  mb.sweep([a, m1], s => 0.0105 + 0.0045 * s, M.BLACKWOOD, {N: 12, smooth: false});
  mb.tube(pt(a, dm, 0.034), pt(a, dm, 0.056), 0.0148, 0.0148, M.SILVER, {N: 12});
  mb.tube(pt(a, dm, 0.074), pt(a, dm, 0.082), 0.0185, 0.0185, M.SILVER, {N: 14});
  let S = pt(a, dm, 0.08);
  if (o.neck) {
    const k = o.neck.k, p0 = m1;
    const pts = [p0, V.madd(p0, dm, 0.05 * k), V.madd(V.madd(p0, dm, 0.085 * k), d, 0.03 * k), V.madd(V.madd(p0, dm, 0.105 * k), d, 0.085 * k)];
    mb.sweep(pts, s => 0.0105 + 0.0025 * s, o.neckMat || M.SILVER, {N: 12, sub: 6});
    S = pts[3];
  }
  const E = V.madd(S, d, o.len);
  mb.sweep([S, E], s => lerp(o.r0, o.r1, s), body, {N: 16, smooth: false});
  // 継ぎ目のリングとキー
  for (const s of o.rings || [0.02, 0.30, 0.62]) band(mb, S, d, o.len * s, 0.006, lerp(o.r0, o.r1, s) + 0.0025);
  const nk = o.nk || 8;
  for (let i = 0; i < nk; i++) {
    const s = 0.16 + i * (0.74 / nk), rr = lerp(o.r0, o.r1, s);
    button(mb, V.madd(pt(S, d, o.len * s), n, rr + 0.004), n, 0.0072, keyMat);
    if (i % 2 === 0) mb.tube(V.madd(pt(S, d, o.len * (s - 0.03)), n, rr + 0.004), V.madd(pt(S, d, o.len * (s + 0.05)), n, rr + 0.004), 0.0022, 0.0022, keyMat, {N: 5});
  }
  // 長いキーの棒（本体に沿って）
  const side = V.norm(V.cross(d, n));
  mb.tube(V.madd(V.madd(pt(S, d, o.len * 0.12), n, o.r0 + 0.004), side, 0.012), V.madd(V.madd(pt(S, d, o.len * 0.88), n, o.r1 + 0.004), side, 0.012), 0.0022, 0.0022, keyMat, {N: 5});
  // ベル
  const bl = o.bellLen || 0.07;
  if (o.up) {
    const ub = V.norm([0, 0.8, 0.6]);
    const B1 = V.madd(E, d, bl * 0.45), B2 = V.madd(B1, V.norm(V.add(d, ub)), bl * 0.45), B3 = V.madd(B2, ub, bl * 0.55);
    bell(mb, [E, B1, B2, B3], flare(o.r1, o.bellR, 0.45, 2.2), o.bellMat || keyMat, {N: 22, sub: 6, rim: keyMat});
  } else {
    bell(mb, [E, V.madd(E, d, bl * 0.55), V.madd(E, d, bl)], flare(o.r1, o.bellR, 0.3, 2.3), body, {N: 20, smooth: false, rim: keyMat});
  }
  const gL = o.gL || 0.20, gR = o.gR || 0.33, rg = o.r1 + 0.004;
  return {
    ax: d,
    L: {G: pt(a, d, gL), fd: V.norm([-0.3, d[1] * 0.4, 0.9]), pn: V.norm([-1, 0.1, 0.1]), r: rg, pole: [0.5, -1, -0.3]},
    R: {G: pt(a, d, gR), fd: V.norm([0.3, d[1] * 0.4, 0.9]), pn: V.norm([1, 0.1, 0.1]), r: rg, pole: [-0.5, -1, -0.3]},
  };
}
function clarinet(mb) { return reedWind(mb, {d: [0, -0.60, 0.30], len: 0.50, r0: 0.0165, r1: 0.0148, bellR: 0.043, bellLen: 0.11, nk: 9, gL: 0.20, gR: 0.33}); }
function ebClarinet(mb) { return reedWind(mb, {d: [0, -0.55, 0.36], len: 0.36, r0: 0.0140, r1: 0.0128, bellR: 0.034, bellLen: 0.08, nk: 7, gL: 0.17, gR: 0.27, rings: [0.02, 0.34, 0.66]}); }
// アルトクラリネット: 曲がった金属ネックと上向きの金属ベル。身体の前に斜めに構える
function altoClarinet(mb) {
  return reedWind(mb, {d: [0, -0.80, 0.60], dm: [0, -0.10, 1], neck: {k: 1.15}, len: 0.62, r0: 0.0185, r1: 0.0215, bellR: 0.068, bellLen: 0.17, up: true, nk: 10, gL: 0.30, gR: 0.52, bellMat: M.SILVER});
}
function bassClarinet(mb) {
  return reedWind(mb, {d: [0, -0.92, 0.40], dm: [0, -0.08, 1], neck: {k: 1.6}, len: 0.74, r0: 0.0215, r1: 0.027, bellR: 0.088, bellLen: 0.22, up: true, nk: 11, gL: 0.36, gR: 0.62, bellMat: M.SILVER});
}
function sopranoSax(mb) {
  return reedWind(mb, {d: [0, -0.62, 0.50], dm: [0, -0.04, 1], neck: {k: 0.9}, len: 0.50, r0: 0.0135, r1: 0.021, bellR: 0.055, bellLen: 0.09, up: true, nk: 10, bodyMat: M.BRASS, neckMat: M.BRASS, bellMat: M.BRASS, keyMat: M.SILVER, gL: 0.19, gR: 0.34, rings: [0.06, 0.5]});
}

// ---- オーボエ（黒・細く、ダブルリード）----
function oboe(mb) {
  const a = [0, 1.505, 0.100], d = V.norm([0, -0.50, 0.86]), n = faceN(d);
  // ダブルリード（平たい籐）とステープル（金属）
  mb.sweep([a, pt(a, d, 0.045)], s => [0.0075 - 0.002 * s, 0.0022], M.CANE, {N: 10, smooth: false});
  mb.tube(pt(a, d, 0.044), pt(a, d, 0.085), 0.0042, 0.0055, M.SILVER, {N: 8});
  band(mb, a, d, 0.04, 0.008, 0.0088, M.SILVER);
  const S = pt(a, d, 0.085), L = 0.50, E = pt(S, d, L), r0 = 0.0095, r1 = 0.0175;
  mb.sweep([S, E], s => lerp(r0, r1, Math.pow(s, 0.9)), M.BLACKWOOD, {N: 14, smooth: false});
  for (const s of [0.0, 0.34, 0.66]) band(mb, S, d, L * s, 0.007, lerp(r0, r1, s) + 0.0025);
  for (let i = 0; i < 9; i++) {
    const s = 0.10 + i * 0.09, rr = lerp(r0, r1, s);
    button(mb, V.madd(pt(S, d, L * s), n, rr + 0.004), n, 0.0066);
    if (i % 2 === 0) mb.tube(V.madd(pt(S, d, L * (s - 0.03)), n, rr + 0.004), V.madd(pt(S, d, L * (s + 0.06)), n, rr + 0.004), 0.002, 0.002, M.SILVER, {N: 5});
  }
  bell(mb, [E, pt(E, d, 0.035), pt(E, d, 0.07)], flare(r1, 0.040, 0.3, 2.4), M.BLACKWOOD, {N: 18, smooth: false, rim: M.SILVER});
  return {
    ax: d,
    L: {G: pt(a, d, 0.22), fd: V.norm([-0.3, d[1] * 0.4, 0.9]), pn: V.norm([-1, 0.1, 0.1]), r: 0.014, pole: [0.5, -1, -0.3]},
    R: {G: pt(a, d, 0.40), fd: V.norm([0.3, d[1] * 0.4, 0.9]), pn: V.norm([1, 0.1, 0.1]), r: 0.016, pole: [-0.5, -1, -0.3]},
  };
}

// ---- フルート・ピッコロ（右向きの横笛）----
function sideFlute(mb, o) {
  const y0 = 1.505, a = [0.03, y0, 0.085], d = V.norm([-0.62 - 0.03, -0.05, 0.115]), b = V.madd(a, d, o.len), body = o.mat;
  mb.sweep([a, b], o.r, body, {N: 12, smooth: false});
  mb.tube(V.add(a, [0, 0.002, 0]), V.add(a, [0.045, 0.001, 0]), 0.0085, 0.0085, M.SILVER, {N: 10});
  mb.ellipsoid(V.madd(a, d, 0.038), [0.011, 0.007, 0.011], M.BLACKWOOD, {N: 10, lat: 4});
  const n = Math.round(o.len / 0.0475) * 1;
  for (let i = 0; i < n; i++) {
    const s = 0.12 * o.len / 0.6 + i * 0.043 * (o.len / 0.6 > 0.7 ? 1 : 0.75), p = V.madd(a, d, s);
    if (s > o.len - 0.015) break;
    mb.ellipsoid(V.add(p, [0, o.r, 0.004]), [0.0085, 0.003, 0.0085], M.SILVER, {N: 8, lat: 3});
    if (i % 3 === 0) mb.tube(V.add(p, [0, 0, -0.01]), V.add(p, [0, o.r, -0.01]), 0.003, 0.003, M.SILVER, {N: 6});
  }
  for (const s of o.rings) mb.tube(V.madd(a, d, s), V.madd(a, d, s + 0.006), o.r + 0.0022, o.r + 0.0022, M.SILVER, {N: 12});
  return {
    ax: d,
    L: {G: V.madd(a, d, o.gL), fd: [0.2, -0.3, 1], pn: [0, 1, -0.1], r: o.r, pole: [0.6, -1, -0.2]},
    R: {G: V.madd(a, d, o.gR), fd: [0.2, -0.2, 1], pn: [0.0, 1, -0.2], r: o.r, pole: [-0.3, -1, -0.3]},
  };
}
function flute(mb) { return sideFlute(mb, {len: 0.64, r: 0.0095, mat: M.SILVER, gL: 0.05, gR: 0.42, rings: [0.15, 0.32, 0.5]}); }
function piccolo(mb) { return sideFlute(mb, {len: 0.32, r: 0.0085, mat: M.BLACKWOOD, gL: 0.03, gR: 0.17, rings: [0.10, 0.20, 0.27]}); }

// ---- サックス（アルト・テナー・バリトン）----
// 吹き口 → ネック → まっすぐな本体 → U 字の「ボウ」→ 上向きのベル（1本の掃引）
// o: {k 大きさ, x 本体の x, zb 本体の z, yNeck ネックが終わる高さ, yBow ボウの上端の高さ, bowR, up ベルの立ち上がり長さ, bellR, hump バリトンの山, gy [左手, 右手の高さ]}
function sax(mb, o) {
  const k = o.k, x = o.x, m = M.BRASS, y = 1.505, zb = o.zb, nz = o.neckZ || [0.20, 0.265];
  // ネックの付け根（黒い吹き口とリガチャ）
  mb.sweep([[0, y, 0.10], [0, y, 0.15]], s => 0.0112 - 0.0035 * s, M.BLACKWOOD, {N: 12, smooth: false});
  mb.tube([0, y, 0.115], [0, y, 0.145], 0.0145, 0.0145, M.SILVER, {N: 12});
  const pts = [[0, y, 0.15]];
  if (o.hump) {
    // バリトン: 上に大きく回るループ（山）
    const C = [0, 1.58, 0.255], R = 0.058;
    pts.push([0, 1.545, 0.19]);
    for (let i = 0; i <= 8; i++) { const ph = Math.PI * i / 8; pts.push([0, C[1] + R * 0.9 * Math.sin(ph), C[2] - R * Math.cos(ph)]); }
    pts.push([x, 1.50, zb]);
  } else {
    pts.push([0, y - 0.015, nz[0]], [lerp(0, x, 0.5), y - 0.06, nz[1]], [x, o.yNeck, zb]);
  }
  // 本体の直線
  const body = [[x, o.yNeck, zb], [x, o.yBow, zb]];
  // ボウ（半円）
  const bw = [];
  for (let i = 1; i <= 8; i++) { const ph = Math.PI * i / 8; bw.push([x, o.yBow - o.bowR * Math.sin(ph), zb + o.bowR * (1 - Math.cos(ph))]); }
  const P = bw[bw.length - 1];
  const upv = V.norm([0, 1, o.fwd || 0.30]);
  const tail = [V.madd(P, upv, o.up * 0.5), V.madd(P, upv, o.up)];
  const all = pts.concat(body.slice(1), bw, tail);
  const total = (() => { let s = 0; for (let i = 1; i < all.length; i++) s += V.len(V.sub(all[i], all[i - 1])); return s; })();
  // 半径: ネックは細く、本体は円錐状に太く、最後に大きく開く
  const lenUp = o.up, sFlare = 1 - lenUp * 0.75 / total, r0 = 0.0115 * k, r1 = 0.0245 * k + 0.004;
  const fr = s => (s < sFlare ? lerp(r0, r1, Math.pow(s / sFlare, 1.2)) : r1 + (o.bellR - r1) * Math.pow((s - sFlare) / (1 - sFlare), 2.4));
  bell(mb, all, fr, m, {N: 24, sub: 5, rim: M.SILVER});
  // キー（本体の前面）
  const nkeys = Math.round(11 * k * 0.9);
  const yTop = o.yNeck - 0.02, yBot = o.yBow + 0.03, step = (yTop - yBot) / nkeys;
  for (let i = 0; i < nkeys; i++) {
    const yy = yTop - i * step, rr = lerp(r0, r1, (o.yNeck - yy) / (o.yNeck - o.yBow));
    mb.ellipsoid([x, yy, zb + rr + 0.004], [0.0105 * k, 0.0035, 0.0105 * k], M.SILVER, {axis: [0, 0, 1], u: [1, 0, 0], N: 8, lat: 3});
    if (i % 2 === 0) mb.tube([x + 0.010 * k, yy, zb + rr + 0.003], [x + 0.032 * k, yy - step * 0.6, zb + rr - 0.002], 0.0033, 0.0033, M.SILVER, {N: 5});
  }
  mb.tube([x + 0.014 * k, yTop, zb + r0 + 0.01], [x + 0.014 * k, yBot, zb + r1 + 0.01], 0.0026, 0.0026, M.SILVER, {N: 5});
  // ボウのガード（金属の棒）とサムフック
  mb.sweep(circ([x, o.yBow, zb + o.bowR], [1, 0, 0], o.bowR + 0.045 * k, 14, Math.PI * 0.95, Math.PI * 1.98).map(p => V.add(p, [0, 0, 0])), 0.0042, M.BRASS, {N: 6, sub: 1, smooth: false});
  mb.tube([x - 0.025, o.gy[1] + 0.03, zb - r1 - 0.008], [x - 0.025, o.gy[1] - 0.02, zb - r1 - 0.008], 0.005, 0.005, M.BLACKWOOD, {N: 6});
  // ネックストラップ（首の後ろから本体へ）
  mb.sweep([[0, 1.43, -0.02], [x * 0.5, 1.33, 0.12], [x, o.gy[0] + 0.06, zb - r1 * 0.2]], 0.003, M.LEATHER, {N: 5, sub: 4});
  return {
    ax: [0, 1, 0],
    L: {G: [x, o.gy[0], zb], fd: [0.0, 0.0, 1], pn: [-1, 0, -0.25], r: 0.022 * k, pole: [0.5, -1, -0.3]},
    R: {G: [x, o.gy[1], zb], fd: [0.0, 0.0, 1], pn: [1, 0, -0.2], r: 0.024 * k, pole: [-0.5, -1, -0.3]},
  };
}
function altoSax(mb) { return sax(mb, {k: 1.0, x: 0, zb: 0.285, yNeck: 1.40, yBow: 0.88, bowR: 0.062, up: 0.24, bellR: 0.092, gy: [1.26, 1.09]}); }
function tenorSax(mb) { return sax(mb, {k: 1.25, x: -0.02, zb: 0.31, yNeck: 1.38, yBow: 0.80, bowR: 0.082, up: 0.30, bellR: 0.118, gy: [1.24, 1.05], neckZ: [0.24, 0.30]}); }
function baritoneSax(mb) { return sax(mb, {k: 1.55, x: -0.10, zb: 0.33, yNeck: 1.42, yBow: 0.66, bowR: 0.10, up: 0.34, bellR: 0.150, gy: [1.20, 1.00], hump: true}); }

// ---- ファゴット（赤茶の木製。体の前を斜めに構え、ボーカルが口へ）----
function bassoon(mb) {
  const W = M.ROSEWOOD;
  // 組み立ての軸: 下端（ブーツ）→上。右下から左上へ傾ける
  const b0 = [-0.17, 0.80, 0.30], up = V.norm([0.42, 1, -0.12]);
  const front = V.norm(V.cross(up, [-1, 0, 0])); // up に直交する前向き
  const A0 = V.madd(b0, front, -0.034), B0 = V.madd(b0, front, 0.034); // A: ウィングジョイント（体側）、B: ロングジョイント（前側）
  const LA = 0.66, LB = 1.00;
  const A1 = V.madd(A0, up, LA), B1 = V.madd(B0, up, LB);
  // ブーツ（太い土台）と U ターン
  mb.tube(V.madd(b0, up, -0.06), V.madd(b0, up, 0.12), 0.050, 0.046, W, {N: 16});
  mb.ellipsoid(V.madd(b0, up, -0.065), [0.050, 0.03, 0.050], W, {axis: up, N: 16, lat: 5});
  mb.tube(V.madd(b0, up, 0.12), V.madd(b0, up, 0.15), 0.052, 0.052, M.SILVER, {N: 16});
  // ウィングジョイント（細い）とロングジョイント→ベル（太く）
  mb.sweep([V.madd(A0, up, 0.1), A1], s => lerp(0.019, 0.015, s), W, {N: 14, smooth: false});
  mb.sweep([V.madd(B0, up, 0.1), B1], s => lerp(0.022, 0.036, Math.pow(s, 1.2)), W, {N: 16, smooth: false});
  for (const s of [0.30, 0.58, 0.82]) mb.tube(V.madd(B0, up, 0.1 + 0.9 * s * 1.0), V.madd(B0, up, 0.108 + 0.9 * s * 1.0), 0.0285 + 0.012 * s, 0.0285 + 0.012 * s, M.SILVER, {N: 14});
  mb.tube(V.madd(A0, up, 0.30), V.madd(A0, up, 0.308), 0.0215, 0.0215, M.SILVER, {N: 12});
  // ベルの金属の飾りと上向きの開口（ベルは上を向く小さなラッパ状）
  bell(mb, [V.madd(B1, up, -0.02), B1, V.madd(B1, up, 0.07)], flare(0.036, 0.052, 0.2, 2.0), W, {N: 18, smooth: false, rim: M.SILVER});
  // キー（前面）とキーの棒
  for (let i = 0; i < 12; i++) {
    const t = 0.18 + i * 0.062, p = V.madd(B0, up, t);
    mb.ellipsoid(V.madd(p, front, 0.032), [0.009, 0.0032, 0.009], M.SILVER, {axis: front, N: 8, lat: 3});
    if (i % 2 === 0) mb.tube(V.madd(p, front, 0.03), V.madd(V.madd(p, front, 0.03), up, 0.06), 0.0024, 0.0024, M.SILVER, {N: 5});
  }
  for (let i = 0; i < 7; i++) { const p = V.madd(A0, up, 0.14 + i * 0.07); mb.ellipsoid(V.madd(p, front, 0.0), [0.0075, 0.0032, 0.0075], M.SILVER, {axis: V.mul(front, -1), N: 8, lat: 3}); }
  // ボーカル（金属の S 字管）: ウィングジョイントの上端 → 口のリードへ
  const bc = [A1, V.madd(A1, up, 0.05), [A1[0] + 0.035, A1[1] + 0.12, A1[2] - 0.02], [0.04, 1.44, 0.17], [0.012, 1.495, 0.12], [0.0, 1.507, 0.10]];
  mb.sweep(bc, s => lerp(0.0105, 0.0065, s), M.SILVER, {N: 10, sub: 6});
  mb.tube(V.madd(A1, up, -0.012), V.madd(A1, up, 0.006), 0.0185, 0.0185, M.SILVER, {N: 12});
  // ダブルリード（口元）
  mb.sweep([[0.0, 1.505, 0.095], [0.0, 1.503, 0.115]], [0.008, 0.0024], M.CANE, {N: 10, smooth: false});
  // ネックストラップ（シートストラップ）
  mb.sweep([[0.0, 1.42, -0.02], [0.05, 1.20, 0.14], V.madd(A0, up, 0.30)], 0.0032, M.LEATHER, {N: 5, sub: 4});
  return {
    ax: up,
    L: {G: V.madd(A0, up, 0.52), fd: [-0.15, -0.3, 1], pn: [-1, 0, -0.2], r: 0.02, pole: [0.5, -1, -0.3]},
    R: {G: V.madd(B0, up, 0.30), fd: [0.15, -0.2, 1], pn: [1, 0, -0.2], r: 0.026, pole: [-0.5, -1, -0.3]},
  };
}

module.exports = {clarinet, ebClarinet, altoClarinet, bassClarinet, sopranoSax, oboe, flute, piccolo, altoSax, tenorSax, baritoneSax, bassoon};
