'use strict';
// 木管・サックス・ファゴットのメッシュと握り。座標系は instruments.js と同じ（足の裏 y=0、+Z が前、左 = +X）。
// 実物の寸法（クラリネット 66cm・オーボエ 65cm・ファゴット 1.34m・フルート 67cm・アルトサックス 70cm…）と、
// 銀のキーワーク（キーカップ・リングキー・ロッド・ポスト）、ジョイントのリング、マウスピースとリガチャを作る
const {V, Q, lerp} = require('./math');
const M = require('./materials');
const P = require('./parts');
const {circ, arcPts, hornBell, ferrule, mouthpiece2} = P;

// 軸 d に垂直で「前・上」を向く法線（音孔・キーが付く面）
const faceN = d => V.norm([0, d[2], -d[1]]);
const pt = (a, d, s) => V.madd(a, d, s);
const rod = (mb, a, b, r = 0.0016, mat = M.NICKEL) => mb.tube(a, b, r, r, mat, {N: 5});
// キーカップ（丸い皿＋革のパッド）。法線 n 向きに浅く張り出す
function cup(mb, p, n, r, mat = M.NICKEL, h = 0.0042) {
  mb.tube(p, V.madd(p, n, h), r, r, mat, {N: 10});
  mb.ellipsoid(V.madd(p, n, h), [r * 0.62, h * 0.55, r * 0.62], M.PAD, {axis: n, N: 8, lat: 3});
}
// 楕円のキータッチ（小指のキーなど）。長軸 u 方向
function touch(mb, p, n, u, a, b, mat = M.NICKEL) {
  mb.ellipsoid(p, [a, 0.0034, b], mat, {axis: n, u: V.norm(u), N: 10, lat: 3});
}
// リングキー（音孔のまわりの輪）
function ringKey(mb, p, n, r, mat = M.NICKEL) { mb.sweep(circ(p, n, r, 14), 0.0017, mat, {N: 5, sub: 1, smooth: false}); }
// ポスト（ロッドを支える小さな柱）
const post = (mb, p, n, h, mat = M.NICKEL) => mb.tube(p, V.madd(p, n, h), 0.0026, 0.0026, mat, {N: 6});
// ジョイントのリング（金属の帯とコルクの継ぎ目）
function joint(mb, S, d, s, r, mat = M.NICKEL) {
  mb.tube(pt(S, d, s - 0.0045), pt(S, d, s + 0.0045), r + 0.0030, r + 0.0030, mat, {N: 16});
  mb.tube(pt(S, d, s + 0.0045), pt(S, d, s + 0.0075), r + 0.0012, r + 0.0012, M.CORK, {N: 14});
}
// マウスピース（硬質ゴム）とリガチャ・リード。a から dm 向き、長さ len
function reedMouthpiece(mb, a, dm, len, wid, sax = false) {
  dm = V.norm(dm);
  const side = V.norm(V.cross(dm, faceN(dm)));
  const prof = [[0.0105, 0.0], [0.0125, 0.012], [0.0145, 0.03], [0.0160, 0.050], [0.0170, len]].map(([r, h]) => [r * wid, h]);
  // 先端（チップ）は薄く細い。ふつうのレース: 下面にリードを当てる
  mb.lathe(a, dm, [[0.0035 * wid, 0.0], [0.0095 * wid, 0.004], ...prof.slice(0)], M.EBONITE, {N: 14, capS: true, capE: true, squash: 0.92});
  // リード（薄い籐の板）と金属のリガチャ
  const nrm = faceN(dm);
  mb.box(V.add(V.madd(a, dm, 0.040), V.mul(nrm, -0.0135 * wid)), [0.0185 * wid, 0.0016, 0.060], M.CANE, {q: Q.fromBasis(side, nrm, dm)});
  const lg = a => V.madd(a, dm, len * 0.62);
  mb.tube(pt(a, dm, len * 0.52), pt(a, dm, len * 0.74), 0.0185 * wid, 0.0187 * wid, M.NICKEL, {N: 14});
  for (const sx of [-1, 1]) mb.ellipsoid(V.madd(V.madd(lg(a), nrm, 0.017 * wid), side, sx * 0.007), [0.0034, 0.0034, 0.0034], M.NICKEL, {N: 6, lat: 3});
  mb.tube(V.madd(V.madd(lg(a), nrm, 0.0185 * wid), side, -0.007), V.madd(V.madd(lg(a), nrm, 0.0185 * wid), side, 0.007), 0.0016, 0.0016, M.NICKEL, {N: 5});
}

// ---- クラリネット族・ソプラノサックス（まっすぐな本体）----
// o: {d 本体の向き, dm 吹き口の向き, len 本体長さ（バレル〜下管）, r0, r1 半径, bellR, bellLen, neck {k}, up 金属ベルの上向き量, bodyMat, keyMat, bellMat, gL gR 握りの位置, ring 1 でリングキー}
function reedWind(mb, o) {
  const a = [0, 1.505, 0.100], d = V.norm(o.d), dm = V.norm(o.dm || o.d), n = faceN(d), side = V.norm(V.cross(d, n)), body = o.bodyMat || M.BLACKWOOD, keyMat = o.keyMat || M.NICKEL;
  const sc = o.r0 / 0.0165;
  reedMouthpiece(mb, a, dm, 0.080, Math.max(1, sc * 0.92));
  let S = pt(a, dm, 0.082);
  if (o.neck) {
    const k = o.neck.k, p0 = pt(a, dm, 0.078);
    const pts = [p0, V.madd(p0, dm, 0.05 * k), V.madd(V.madd(p0, dm, 0.085 * k), d, 0.03 * k), V.madd(V.madd(p0, dm, 0.105 * k), d, 0.085 * k)];
    mb.sweep(pts, s => 0.0112 + 0.0030 * s, o.neckMat || M.NICKEL, {N: 12, sub: 6});
    S = pts[3];
  }
  const E = V.madd(S, d, o.len), rAt = s => (s < 0.1 ? lerp(o.r0 * 1.12, o.r0 * 1.08, s / 0.1) : lerp(o.r0 * 1.0, o.r1, (s - 0.1) / 0.9));
  // 本体: バレル（少し太い）→ 上管 → 下管。継ぎ目にリング
  const segs = [[0, 0.10], [0.10, 0.52], [0.52, 1.0]];
  for (const [s0, s1] of segs) mb.sweep([pt(S, d, o.len * s0), pt(S, d, o.len * s1)], s => rAt(lerp(s0, s1, s)) * 1.0, body, {N: 18, smooth: false});
  for (const s of [0.10, 0.52]) joint(mb, S, d, o.len * s, rAt(s));
  mb.tube(pt(S, d, -0.002), pt(S, d, 0.010), rAt(0) + 0.0028, rAt(0) + 0.0028, M.NICKEL, {N: 16});
  const R = s => rAt(s) + 0.0016;
  const at = (s, off = 0, sd = 0) => V.madd(V.madd(pt(S, d, o.len * s), n, R(s) + off), side, sd);
  // 指穴のリングキー（左手 3・右手 3）
  const holes = o.holes || [0.27, 0.33, 0.39, 0.62, 0.68, 0.74];
  for (const s of holes) { ringKey(mb, at(s, 0.0006), n, 0.0072 * sc); }
  // 左右のロッドとポスト
  const rl = V.madd(V.madd(S, n, 0.004), side, 0.0), pL = (s, sd) => V.madd(V.madd(pt(S, d, o.len * s), n, R(s) * 0.55), side, sd * (R(s) + 0.0022));
  for (const sd of [-1, 1]) {
    const s0 = sd < 0 ? 0.16 : 0.13, s1 = sd < 0 ? 0.93 : 0.60;
    rod(mb, pL(s0, sd), pL(s1, sd), 0.0017, keyMat);
    for (let s = s0 + 0.04; s < s1; s += 0.13) post(mb, V.madd(pL(s, sd), side, -sd * 0.0025), V.mul(side, sd), 0.0035, keyMat);
  }
  // スロートキー・サイドキー（キーカップ）
  [[0.12, 1, 0.0060], [0.17, -1, 0.0062], [0.22, 1, 0.0058], [0.45, -1, 0.0070], [0.50, 1, 0.0062], [0.57, -1, 0.0066]].forEach(([s, sd, rr]) => {
    const p = V.madd(at(s, 0), side, sd * rr * 1.1); cup(mb, V.madd(p, side, 0), V.norm(V.add(n, V.mul(side, sd * 0.5))), rr * sc, keyMat);
    rod(mb, V.madd(p, n, 0.002), at(s + 0.045, 0.002, 0), 0.0015, keyMat);
  });
  // 下管の小指のキー（左右 4 つ）と最下部のキーカップ
  [[0.82, -1], [0.86, 1], [0.90, -1], [0.93, 1]].forEach(([s, sd]) => {
    const p = V.madd(at(s, 0.002), side, sd * 0.011);
    touch(mb, p, n, d, 0.0062 * sc, 0.0107 * sc, keyMat);
    rod(mb, V.madd(p, d, -0.01), V.madd(at(s - 0.05, 0.001, sd * 0.004), n, 0), 0.0017, keyMat);
  });
  cup(mb, V.madd(at(0.965, 0, 0), side, 0.003), n, 0.0072 * sc, keyMat);
  // 裏側: サムレストとレジスターキー（ベントの管とキー）
  const nb = V.mul(n, -1);
  mb.tube(V.madd(pt(S, d, o.len * 0.56), nb, rAt(0.56)), V.madd(V.madd(pt(S, d, o.len * 0.56), nb, rAt(0.56)), nb, 0.012), 0.0036, 0.0036, M.EBONITE, {N: 8});
  mb.tube(V.madd(pt(S, d, o.len * 0.115), nb, rAt(0.12) - 0.001), V.madd(V.madd(pt(S, d, o.len * 0.115), nb, rAt(0.12)), nb, 0.012), 0.0030, 0.0030, keyMat, {N: 7});
  cup(mb, V.madd(V.madd(pt(S, d, o.len * 0.115), nb, rAt(0.12) + 0.010), nb, 0), nb, 0.0045, keyMat);
  // ベル
  const bl = o.bellLen || 0.1;
  if (o.up) {
    const ub = V.norm([0, 0.8, 0.6]);
    const B1 = V.madd(E, d, bl * 0.45), B2 = V.madd(B1, V.norm(V.add(d, ub)), bl * 0.45), B3 = V.madd(B2, ub, bl * 0.55);
    mb.sweep([E, B1, B2], o.r1 * 1.02, o.bellMat || keyMat, {N: 18, sub: 6, capS: true});
    hornBell(mb, [B2, V.madd(B2, V.norm(V.add(ub, d)), 0.05), B3], o.r1 * 1.02, o.bellR, {b: 1.0, N: 30, rings: 20, mat: o.bellMat || keyMat, inMat: o.bellMat || keyMat, rim: 0.003});
  } else {
    hornBell(mb, [E, V.madd(E, d, bl * 0.6), V.madd(E, d, bl)], o.r1, o.bellR, {b: 1.6, N: 26, rings: 14, cl: 1.3, mat: body, inMat: body, rimMat: keyMat, rim: 0.0028, wall: 0.003});
    joint(mb, E, d, -0.002, o.r1 * 1.0);
  }
  const gL = o.gL || 0.20, gR = o.gR || 0.33, rg = o.r1 + 0.004;
  return {
    ax: d,
    L: {G: pt(a, d, gL), fd: V.norm([-0.3, d[1] * 0.4, 0.9]), pn: V.norm([-1, 0.1, 0.1]), r: rg, pole: [0.5, -1, -0.3]},
    R: {G: pt(a, d, gR), fd: V.norm([0.3, d[1] * 0.4, 0.9]), pn: V.norm([1, 0.1, 0.1]), r: rg, pole: [-0.5, -1, -0.3]},
  };
}
function clarinet(mb) { return reedWind(mb, {d: [0, -0.60, 0.30], len: 0.50, r0: 0.0165, r1: 0.0148, bellR: 0.040, bellLen: 0.11, gL: 0.20, gR: 0.33}); }
function ebClarinet(mb) { return reedWind(mb, {d: [0, -0.55, 0.36], len: 0.36, r0: 0.0140, r1: 0.0128, bellR: 0.031, bellLen: 0.08, gL: 0.17, gR: 0.27}); }
// アルトクラリネット: 曲がった金属ネックと上向きの金属ベル。身体の前に斜めに構える
function altoClarinet(mb) {
  return reedWind(mb, {d: [0, -0.80, 0.60], dm: [0, -0.10, 1], neck: {k: 1.15}, len: 0.62, r0: 0.0185, r1: 0.0205, bellR: 0.062, bellLen: 0.17, up: true, gL: 0.30, gR: 0.52, bellMat: M.NICKEL, holes: [0.25, 0.31, 0.37, 0.62, 0.68, 0.74]});
}
function bassClarinet(mb) {
  return reedWind(mb, {d: [0, -0.92, 0.40], dm: [0, -0.08, 1], neck: {k: 1.6}, len: 0.74, r0: 0.0215, r1: 0.0255, bellR: 0.080, bellLen: 0.22, up: true, gL: 0.36, gR: 0.62, bellMat: M.NICKEL, holes: [0.25, 0.31, 0.37, 0.62, 0.68, 0.74]});
}

// ---- オーボエ（黒・細く、ダブルリード。ベルは広がり、縁に金属のリング）----
function oboe(mb) {
  const a = [0, 1.505, 0.100], d = V.norm([0, -0.50, 0.86]), n = faceN(d), side = V.norm(V.cross(d, n));
  // ダブルリード（平たい籐）とステープル（金属）、コルクの付け根
  mb.sweep([a, pt(a, d, 0.052)], s => [0.0078 - 0.0022 * s, 0.0020], M.CANE, {N: 10, smooth: false});
  mb.tube(pt(a, d, 0.046), pt(a, d, 0.090), 0.0042, 0.0048, M.NICKEL, {N: 8});
  mb.tube(pt(a, d, 0.038), pt(a, d, 0.066), 0.0084, 0.0090, M.CORK, {N: 10});
  mb.tube(pt(a, d, 0.052), pt(a, d, 0.058), 0.0102, 0.0102, M.NICKEL, {N: 10}); // リードの巻き糸
  const S = pt(a, d, 0.090), L = 0.50, r0 = 0.0092, r1 = 0.0175, rAt = s => lerp(r0, r1, Math.pow(s, 0.85)), E = pt(S, d, L);
  const segs = [[0, 0.40], [0.40, 0.76], [0.76, 1.0]];
  for (const [s0, s1] of segs) mb.sweep([pt(S, d, L * s0), pt(S, d, L * s1)], s => rAt(lerp(s0, s1, s)), M.BLACKWOOD, {N: 14, smooth: false});
  for (const s of [0.40, 0.76]) joint(mb, S, d, L * s, rAt(s));
  const R = s => rAt(s) + 0.0014, at = (s, off = 0, sd = 0) => V.madd(V.madd(pt(S, d, L * s), n, R(s) + off), side, sd);
  // 指穴のリング・プレートキー、ロッドとポスト、キーカップ（オーボエは小さなカップが多い）
  for (const s of [0.18, 0.25, 0.32, 0.55, 0.62, 0.69]) ringKey(mb, at(s, 0.0005), n, 0.0058);
  for (const sd of [-1, 1]) {
    const a0 = sd < 0 ? 0.08 : 0.06, a1 = sd < 0 ? 0.96 : 0.74;
    const pp = s => V.madd(V.madd(pt(S, d, L * s), n, R(s) * 0.5), side, sd * (R(s) + 0.0022));
    rod(mb, pp(a0), pp(a1), 0.0015);
    for (let s = a0 + 0.05; s < a1; s += 0.12) post(mb, V.madd(pp(s), side, -sd * 0.0024), V.mul(side, sd), 0.0030);
  }
  [[0.07, 1], [0.12, -1], [0.14, 1], [0.38, -1], [0.44, 1], [0.48, -1], [0.50, 1], [0.78, -1], [0.82, 1], [0.86, -1], [0.90, 1], [0.94, -1]].forEach(([s, sd]) => {
    const rr = 0.0050 + 0.0010 * s, p = V.madd(at(s, 0), side, sd * rr);
    cup(mb, p, V.norm(V.add(n, V.mul(side, sd * 0.4))), rr, M.NICKEL, 0.0038);
    rod(mb, V.madd(p, n, 0.002), at(s + 0.04, 0.002, sd * 0.002), 0.0013);
  });
  // 裏: サムプレートとオクターブキー
  const nb = V.mul(n, -1);
  mb.tube(V.madd(pt(S, d, L * 0.30), nb, rAt(0.30)), V.madd(V.madd(pt(S, d, L * 0.30), nb, rAt(0.30)), nb, 0.010), 0.0030, 0.0030, M.NICKEL, {N: 6});
  cup(mb, V.madd(V.madd(pt(S, d, L * 0.08), nb, rAt(0.08)), nb, 0.002), nb, 0.0040);
  // 広がったベル（縁に金属の帯）
  hornBell(mb, [E, pt(E, d, 0.040), pt(E, d, 0.085)], r1, 0.034, {b: 1.4, N: 22, rings: 14, cl: 1.3, mat: M.BLACKWOOD, inMat: M.BLACKWOOD, rimMat: M.NICKEL, rim: 0.0030, wall: 0.003});
  joint(mb, E, d, -0.002, r1);
  return {
    ax: d,
    L: {G: pt(a, d, 0.22), fd: V.norm([-0.3, d[1] * 0.4, 0.9]), pn: V.norm([-1, 0.1, 0.1]), r: 0.014, pole: [0.5, -1, -0.3]},
    R: {G: pt(a, d, 0.40), fd: V.norm([0.3, d[1] * 0.4, 0.9]), pn: V.norm([1, 0.1, 0.1]), r: 0.016, pole: [-0.5, -1, -0.3]},
  };
}

// ---- フルート・ピッコロ（右向きの横笛）----
// 頭部管（リッププレート・クラウン）、胴部管のキーカップ（2 列）、足部管のキー、ロッドとポスト
function sideFlute(mb, o) {
  const y0 = 1.505, a = [0.03, y0, 0.085], d = V.norm([-0.62 - 0.03, -0.05, 0.115]), b = V.madd(a, d, o.len), body = o.mat, r = o.r;
  const up = [0, 1, 0], side = V.norm(V.cross(d, up)), sc = o.len / 0.64;
  mb.sweep([a, b], r, body, {N: 16, smooth: false});
  // クラウン（頭部管の端のキャップ）とリッププレート（楕円の板・歌口の穴）
  mb.tube(V.madd(a, d, -0.016), V.madd(a, d, 0.004), 0.0105, 0.0098, M.NICKEL, {N: 14});
  mb.ellipsoid(V.madd(a, d, -0.017), [0.0105, 0.0040, 0.0105], M.NICKEL, {axis: V.mul(d, -1), N: 14, lat: 4});
  mb.ellipsoid(V.madd(V.madd(a, d, 0.040), up, r + 0.001), [0.0155, 0.0030, 0.011], M.NICKEL, {axis: up, u: d, N: 16, lat: 4});
  mb.ellipsoid(V.madd(V.madd(a, d, 0.040), up, r + 0.0028), [0.0070, 0.0012, 0.0048], M.BLACKWOOD, {axis: up, u: d, N: 10, lat: 3});
  // 継ぎ目のリング
  for (const s of o.rings) mb.tube(V.madd(a, d, s), V.madd(a, d, s + 0.007), r + 0.0022, r + 0.0022, M.NICKEL, {N: 16});
  // 胴部管のキーカップ（上面に 2 列 + ロッド）
  const cupN = V.norm([0, 1, 0.1]), keyN = i => V.madd(V.madd(a, d, i), up, r + 0.0006);
  const kc = o.keys;
  kc.forEach((s, i) => {
    const p = keyN(s), rr = 0.0078 * Math.min(1, sc + 0.3) * (i % 4 === 3 ? 0.8 : 1);
    cup(mb, V.madd(p, side, 0.0), cupN, rr, M.NICKEL, 0.0042);
    mb.tube(V.madd(p, cupN, 0.0042), V.madd(p, cupN, 0.0056), rr * 0.3, rr * 0.3, M.NICKEL, {N: 6});
  });
  // ロッド（胴の横を走る）とポスト
  for (const sd of [-1, 1]) {
    const s0 = kc[0] - 0.02, s1 = kc[kc.length - 1] + 0.02, o2 = (s) => V.madd(V.madd(V.madd(a, d, s), up, r * 0.45), side, sd * (r + 0.003));
    rod(mb, o2(s0), o2(s1), 0.0017);
    for (let s = s0 + 0.03; s < s1; s += 0.07) post(mb, V.madd(o2(s), side, -sd * 0.0025), V.mul(side, sd), 0.0034);
  }
  // 足部管: キーのレバー（小指のローラー）
  const fs = o.len - 0.045 * sc;
  for (let i = 0; i < 3; i++) mb.ellipsoid(V.madd(V.madd(V.madd(a, d, fs + i * 0.011), up, r * 0.2), side, -(r + 0.006)), [0.0050, 0.0050, 0.0072], M.NICKEL, {axis: side, u: d, N: 8, lat: 3});
  // 吹き口のあたり: 頭部管の先端を閉じる
  mb.ellipsoid(b, [r, r * 0.9, r], body, {axis: d, N: 12, lat: 4});
  return {
    ax: d,
    L: {G: V.madd(a, d, o.gL), fd: [0.2, -0.3, 1], pn: [0, 1, -0.1], r: r, pole: [0.6, -1, -0.2]},
    R: {G: V.madd(a, d, o.gR), fd: [0.2, -0.2, 1], pn: [0.0, 1, -0.2], r: r, pole: [-0.3, -1, -0.3]},
  };
}
const fluteKeys = (len, from) => { const o = []; for (let s = from; s < len - 0.06; s += 0.0345) o.push(s); return o; };
function flute(mb) { return sideFlute(mb, {len: 0.67, r: 0.0095, mat: M.NICKEL, gL: 0.05, gR: 0.42, rings: [0.17, 0.36, 0.55], keys: fluteKeys(0.67, 0.21)}); }
function piccolo(mb) { return sideFlute(mb, {len: 0.32, r: 0.0085, mat: M.BLACKWOOD, gL: 0.03, gR: 0.17, rings: [0.10, 0.20, 0.27], keys: fluteKeys(0.32, 0.12).map(s => s * 1.0)}); }

// ---- サックス（アルト・テナー・バリトン）----
// 吹き口 → ネック → まっすぐな本体 → U 字の「ボウ」→ 上向きのベル（1 本の掃引）。ブラスのラッカー、ニッケルのキーワーク
// o: {k 大きさ, x 本体の x, zb 本体の z, yNeck ネックが終わる高さ, yBow ボウの上端の高さ, bowR, up ベルの立ち上がり長さ, bellR, hump バリトンの山, gy [左手, 右手の高さ]}
function sax(mb, o) {
  const k = o.k, x = o.x, m = M.BRASS, y = 1.505, zb = o.zb, nz = o.neckZ || [0.215, 0.275];
  // 吹き口（硬質ゴム）とリガチャ、ネックコルク
  reedMouthpiece(mb, [0, y, 0.095], [0, -0.02, 1], 0.078, 1.12 + 0.0 * k, true);
  mb.tube([0, y - 0.0005, 0.168], [0, y - 0.0005, 0.186], 0.0125, 0.0125, M.CORK, {N: 12});
  const pts = [[0, y, 0.18]];
  if (o.hump) {
    const C = [0, 1.58, 0.255], R = 0.058;
    pts.push([0, 1.545, 0.20]);
    for (let i = 0; i <= 8; i++) { const ph = Math.PI * i / 8; pts.push([0, C[1] + R * 0.9 * Math.sin(ph), C[2] - R * Math.cos(ph)]); }
    pts.push([x, 1.50, zb]);
  } else pts.push([0, y - 0.016, nz[0]], [lerp(0, x, 0.5), y - 0.06, nz[1]], [x, o.yNeck, zb]);
  const body = [[x, o.yNeck, zb], [x, o.yBow, zb]];
  const bw = [];
  for (let i = 1; i <= 10; i++) { const ph = Math.PI * i / 10; bw.push([x, o.yBow - o.bowR * Math.sin(ph), zb + o.bowR * (1 - Math.cos(ph))]); }
  const Pb = bw[bw.length - 1], upv = V.norm([0, 1, o.fwd || 0.30]);
  const tail = [V.madd(Pb, upv, o.up * 0.5), V.madd(Pb, upv, o.up)];
  const all = pts.concat(body.slice(1), bw, tail);
  const total = (() => { let s = 0; for (let i = 1; i < all.length; i++) s += V.len(V.sub(all[i], all[i - 1])); return s; })();
  const lenUp = o.up, sFlare = 1 - lenUp * 0.62 / total, r0 = 0.0112 * k, r1 = 0.0235 * k + 0.003;
  const fr = s => (s < sFlare ? lerp(r0, r1, Math.pow(s / sFlare, 1.15)) : (() => { const u = (s - sFlare) / (1 - sFlare); return r1 + (o.bellR - r1) * Math.pow(u, 3.2); })());
  mb.sweep(all, fr, m, {N: 24, sub: 6, capS: true, capE: false});
  mb.sweep(all, s => Math.max(0.003, fr(s) - 0.0014), M.BRASSIN, {N: 24, sub: 6, capS: false, capE: false, invert: true});
  const e = all[all.length - 1], de = V.norm(V.sub(e, all[all.length - 2]));
  mb.sweep(circ(e, de, o.bellR - 0.0004, 44), 0.0034, m, {N: 8, sub: 1, smooth: false, capS: false, capE: false});
  // 本体の位置 s → 半径
  const rb = yy => lerp(r0 * 1.12, r1 * 0.98, Math.min(1, Math.max(0, (o.yNeck - yy) / (o.yNeck - o.yBow))) ** 1.15);
  const zf = yy => zb + rb(yy);
  const nkeys = 6, yTop = o.yNeck - 0.05, yBot = o.yBow + 0.07 + 0.0, step = (yTop - yBot) / (nkeys - 1);
  const Kn = [0, 0, 1];
  // 主指キー（6 つ。カップを胴の中央に縦に並べる）と、パールのキータッチ
  for (let i = 0; i < nkeys; i++) {
    const yy = yTop - i * step, rc = (0.0088 + 0.0016 * i) * k + 0.001, c = [x, yy, zf(yy)];
    cup(mb, c, Kn, rc, M.NICKEL, 0.0050);
    rod(mb, [x, yy, c[2] + 0.002], [x + 0.021 * k, yy + step * 0.15, c[2] + 0.002], 0.0020);
    mb.tube([x + 0.021 * k, yy + step * 0.15, c[2] + 0.001], [x + 0.021 * k, yy + step * 0.15, c[2] + 0.0075], 0.0045 * k, 0.0045 * k, M.PEARL, {N: 10});
    mb.ellipsoid([x + 0.021 * k, yy + step * 0.15, c[2] + 0.0075], [0.0070 * k, 0.0026, 0.0070 * k], M.PEARL, {axis: Kn, u: [1, 0, 0], N: 10, lat: 3});
  }
  // 左手のパームキー（上のほう、左寄りの小さなカップ）・サイドキー
  for (let i = 0; i < 4; i++) { const yy = o.yNeck - 0.02 - i * 0.045 * k, c = [x - 0.021 * k, yy, zf(yy) - 0.002]; cup(mb, c, V.norm([-0.4, 0, 1]), 0.0058 * k, M.NICKEL, 0.0038); }
  for (let i = 0; i < 4; i++) { const yy = yBot + 0.03 + i * 0.03 * k, c = [x + 0.027 * k, yy, zf(yy) - 0.003]; touch(mb, c, Kn, [1, 0, 0], 0.0056 * k, 0.0085 * k); }
  // 本体に沿った 2 本のロッドとポスト
  for (const sd of [-1, 1]) {
    const xr = x + sd * 0.0285 * k, a1 = [xr, o.yNeck - 0.01, zf(o.yNeck) - 0.003], a2 = [xr, o.yBow + 0.03, zf(o.yBow) - 0.003];
    rod(mb, a1, a2, 0.0024);
    for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6, p = V.lerp(a1, a2, t); post(mb, [p[0] - sd * 0.006 * k, p[1], p[2] - 0.004], [sd, 0, 0.0], 0.006 * k); }
  }
  // 下のベルの側の大きなカップ（低い音のキー）: ボウとベルの間に 3 つ
  for (let i = 0; i < 3; i++) { const bp = bw[bw.length - 1 - i * 2 - 1], dir = V.norm(V.sub(bw[Math.max(0, bw.length - i * 2 - 2)], bw[Math.max(0, bw.length - i * 2 - 3)])); cup(mb, V.madd(bp, [1, 0, 0], r1 * 0.95), [1, 0, 0], (0.0105 + 0.0025 * i) * k, M.NICKEL, 0.0045); }
  // ボウのガード（金属の棒）とサムフック、ネックのオクターブキー
  mb.sweep(arcPts([x, o.yBow, zb + o.bowR], [0, 0, 1], [0, 1, 0], o.bowR + 0.018 * k, Math.PI * 1.06, Math.PI * 1.96, 16), 0.0034, M.NICKEL, {N: 6, sub: 1, smooth: false});
  mb.tube([x - 0.02, o.gy[1] + 0.035, zb - r1 - 0.008], [x - 0.02, o.gy[1] - 0.01, zb - r1 - 0.008], 0.0052, 0.0052, M.EBONITE, {N: 8});
  const nk = pts[2];
  mb.tube(V.add(nk, [0, 0.0105 * k, 0]), V.add(nk, [0, 0.020 * k, 0]), 0.0032, 0.0032, M.NICKEL, {N: 6});
  cup(mb, V.add(nk, [0, 0.020 * k, 0]), [0, 1, 0], 0.0048 * k, M.NICKEL, 0.0030);
  rod(mb, V.add(pts[2], [0, 0.012, 0]), [x, o.yNeck - 0.004 + 0.012, zb + r0 + 0.004], 0.0016);
  // ネックストラップ
  mb.sweep([[0, 1.43, -0.02], [x * 0.5, 1.33, 0.12], [x, o.gy[0] + 0.06, zb - r1 * 0.2]], 0.0028, M.LEATHER, {N: 5, sub: 4});
  return {
    ax: [0, 1, 0],
    L: {G: [x, o.gy[0], zb], fd: [0.0, 0.0, 1], pn: [-1, 0, -0.25], r: 0.022 * k, pole: [0.5, -1, -0.3]},
    R: {G: [x, o.gy[1], zb], fd: [0.0, 0.0, 1], pn: [1, 0, -0.2], r: 0.024 * k, pole: [-0.5, -1, -0.3]},
  };
}
// 楽器全体を z 軸まわりに傾ける（ストラップで下げたサックスが体の右側へ流れる）。握りの位置・向きも同じ変換にする
function tiltZ(mb, spec, pivot, ang) {
  const q = Q.axis([0, 0, 1], ang), rp = p => V.add(pivot, Q.rot(q, V.sub(p, pivot))), rd = d => Q.rot(q, d);
  mb.P = mb.P.map(rp);
  for (const k of ['L', 'R']) { const g = spec[k]; g.G = rp(g.G); g.fd = rd(g.fd); g.pn = rd(g.pn); }
  if (spec.ax) spec.ax = rd(spec.ax);
  return spec;
}
function sopranoSax(mb) {
  return reedWind(mb, {d: [0, -0.62, 0.50], dm: [0, -0.04, 1], neck: {k: 0.9}, len: 0.50, r0: 0.0135, r1: 0.021, bellR: 0.050, bellLen: 0.09, up: true, bodyMat: M.BRASS, neckMat: M.BRASS, bellMat: M.BRASS, keyMat: M.NICKEL, gL: 0.19, gR: 0.34, holes: [0.25, 0.31, 0.37, 0.62, 0.68, 0.74]});
}
// アルト 70cm・テナー 85cm・バリトンは約 1.2m（上に山）。ベルの口径も実物に近づける（Ø13・Ø16・Ø20）
function altoSax(mb) { return tiltZ(mb, sax(mb, {k: 1.0, x: 0, zb: 0.285, yNeck: 1.385, yBow: 0.915, bowR: 0.052, up: 0.22, bellR: 0.066, gy: [1.26, 1.09]}), [0, 1.5, 0.12], -0.13); }
function tenorSax(mb) { return tiltZ(mb, sax(mb, {k: 1.22, x: -0.02, zb: 0.31, yNeck: 1.365, yBow: 0.745, bowR: 0.066, up: 0.19, bellR: 0.080, gy: [1.24, 1.05], neckZ: [0.24, 0.30]}), [0, 1.5, 0.12], -0.13); }
function baritoneSax(mb) { return tiltZ(mb, sax(mb, {k: 1.5, x: -0.10, zb: 0.33, yNeck: 1.42, yBow: 0.640, bowR: 0.090, up: 0.28, bellR: 0.100, gy: [1.20, 1.00], hump: true}), [0, 1.5, 0.12], -0.08); }

// ---- ファゴット（メイプルの赤茶。ブーツジョイントで U ターン、金属のボーカルが口へ）----
function bassoon(mb) {
  const W = M.MAPLE;
  const b0 = [-0.17, 0.80, 0.30], up = V.norm([0.42, 1, -0.12]);
  const front = V.norm(V.cross(up, [-1, 0, 0])), sd = V.norm(V.cross(up, front));
  const A0 = V.madd(b0, front, -0.034), B0 = V.madd(b0, front, 0.034);
  const LA = 0.66, LB = 1.00;
  const A1 = V.madd(A0, up, LA), B1 = V.madd(B0, up, LB);
  // ブーツ（太い土台）と金属の U 字のキャップ
  mb.tube(V.madd(b0, up, -0.06), V.madd(b0, up, 0.12), 0.050, 0.046, W, {N: 20});
  mb.ellipsoid(V.madd(b0, up, -0.065), [0.050, 0.03, 0.050], W, {axis: up, N: 20, lat: 5});
  mb.tube(V.madd(b0, up, -0.060), V.madd(b0, up, -0.075), 0.040, 0.040, M.NICKEL, {N: 18});
  mb.tube(V.madd(b0, up, 0.115), V.madd(b0, up, 0.14), 0.0535, 0.0535, M.NICKEL, {N: 20});
  mb.tube(V.madd(b0, up, 0.03), V.madd(b0, up, 0.038), 0.0515, 0.0515, M.NICKEL, {N: 20});
  // ウィングジョイントとロングジョイント→ベル（太く）、継ぎ目の金属リング
  mb.sweep([V.madd(A0, up, 0.1), A1], s => lerp(0.019, 0.015, s), W, {N: 16, smooth: false});
  mb.sweep([V.madd(B0, up, 0.1), B1], s => lerp(0.022, 0.036, Math.pow(s, 1.2)), W, {N: 18, smooth: false});
  for (const s of [0.30, 0.58, 0.82]) mb.tube(V.madd(B0, up, 0.1 + 0.9 * s), V.madd(B0, up, 0.112 + 0.9 * s), 0.0285 + 0.012 * s, 0.0285 + 0.012 * s, M.NICKEL, {N: 16});
  mb.tube(V.madd(A0, up, 0.30), V.madd(A0, up, 0.312), 0.0215, 0.0215, M.NICKEL, {N: 14});
  // ベル（上向きの小さなラッパ状。縁と継ぎ目に金属）
  hornBell(mb, [V.madd(B1, up, -0.02), B1, V.madd(B1, up, 0.07)], 0.036, 0.056, {b: 1.2, N: 22, rings: 12, mat: W, inMat: W, rimMat: M.NICKEL, wall: 0.004, rim: 0.0034});
  // キー: 前面のキーカップとリングキー、ロッド、ウィングのキー
  for (let i = 0; i < 14; i++) {
    const t = 0.16 + i * 0.058, p = V.madd(B0, up, t), c = V.madd(p, front, 0.034 + 0.0006 * i);
    cup(mb, V.madd(c, sd, (i % 2 ? 1 : -1) * 0.007), front, 0.0075 + 0.0006 * (i % 3), M.NICKEL, 0.0045);
    if (i % 2 === 0) ringKey(mb, V.madd(c, sd, 0.0), front, 0.0068);
  }
  for (const s of [-1, 1]) { rodLine(mb, V.madd(V.madd(B0, front, 0.036), sd, s * 0.012), up, 0.14, 0.86); }
  for (let i = 0; i < 8; i++) { const p = V.madd(V.madd(A0, up, 0.13 + i * 0.065), front, -0.0155); cup(mb, V.madd(p, sd, (i % 2 ? 1 : -1) * 0.004), V.mul(front, -1), 0.0066, M.NICKEL, 0.004); }
  rodLine(mb, V.madd(V.madd(A0, front, -0.017), sd, 0.012), up, 0.12, 0.60);
  // 左手親指のキー（裏側）
  for (let i = 0; i < 4; i++) mb.ellipsoid(V.madd(V.madd(V.madd(A0, up, 0.34 + i * 0.04), front, -0.026), sd, 0.01), [0.0075, 0.003, 0.0105], M.NICKEL, {axis: V.mul(front, -1), N: 8, lat: 3});
  // ボーカル（金属の S 字管）: ウィングジョイントの上端 → 口のリードへ
  const bc = [A1, V.madd(A1, up, 0.05), [A1[0] + 0.035, A1[1] + 0.12, A1[2] - 0.02], [0.04, 1.44, 0.17], [0.012, 1.495, 0.12], [0.0, 1.507, 0.10]];
  mb.sweep(bc, s => lerp(0.0112, 0.0070, s), M.NICKEL, {N: 12, sub: 8});
  mb.tube(V.madd(A1, up, -0.012), V.madd(A1, up, 0.008), 0.0188, 0.0188, M.NICKEL, {N: 14});
  mb.ellipsoid(V.add(bc[3], [0, 0.003, 0]), [0.0125, 0.0125, 0.0125], M.NICKEL, {N: 8, lat: 4}); // ボーカルのコブ
  mb.tube(V.add(bc[4], [0, 0.0, 0.0]), V.add(bc[5], [0, 0, 0.012]), 0.0100, 0.0100, M.CORK, {N: 8});
  // ダブルリード（口元）
  mb.sweep([[0.0, 1.505, 0.092], [0.0, 1.503, 0.112]], [0.0085, 0.0024], M.CANE, {N: 10, smooth: false});
  mb.tube([0.0, 1.5055, 0.108], [0.0, 1.5055, 0.116], 0.0098, 0.0098, M.NICKEL, {N: 8});
  // ネックストラップ（シートストラップ）
  mb.sweep([[0.0, 1.42, -0.02], [0.05, 1.20, 0.14], V.madd(A0, up, 0.30)], 0.0032, M.LEATHER, {N: 5, sub: 4});
  return {
    ax: up,
    L: {G: V.madd(A0, up, 0.52), fd: [-0.15, -0.3, 1], pn: [-1, 0, -0.2], r: 0.02, pole: [0.5, -1, -0.3]},
    R: {G: V.madd(B0, up, 0.30), fd: [0.15, -0.2, 1], pn: [1, 0, -0.2], r: 0.026, pole: [-0.5, -1, -0.3]},
  };
}
// 軸 up に沿ったロッド（支柱つき）
function rodLine(mb, p0, up, t0, t1) {
  const a = V.madd(p0, up, t0), b = V.madd(p0, up, t1);
  rod(mb, a, b, 0.0020);
  for (let t = t0 + 0.04; t < t1; t += 0.14) mb.tube(V.madd(p0, up, t), V.madd(V.madd(p0, up, t), V.norm(V.cross(up, [1, 0, 0])), -0.006), 0.0024, 0.0024, M.NICKEL, {N: 5});
}

module.exports = {clarinet, ebClarinet, altoClarinet, bassClarinet, sopranoSax, oboe, flute, piccolo, altoSax, tenorSax, baritoneSax, bassoon};
