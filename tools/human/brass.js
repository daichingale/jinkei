'use strict';
// 金管楽器のメッシュと握り（実物の寸法・ベッセル型のベル・巻き管・ピストン／ロータリーバルブ）。
// 座標は instruments.js と同じ（足の裏 y=0、+Z が前、左 = +X、口の位置 y=1.512 z≈0.098）
const {V, Q, lerp} = require('./math');
const M = require('./materials');
const P = require('./parts');
const {circ, arcPts, roundPath, hornBell, pipe, ferrule, mouthpiece2, piston, rotary, waterKey, uSlide, besselR} = P;

const Y0 = 1.512;
// 銀メッキ仕上げにする楽器は m に M.NICKEL を渡す（既定は金色のラッカー）
const LAC = M.BRASS;

// ---- 前向きのベルを持つ金管（トランペット・メロフォン・マーチングホルン）----
// o: {tube 管の半径, bellStart, bellEnd, bellR, bellB, loopH, valveZ, vr バルブの半径, vsp バルブの間隔, coil マーチングホルンの巻き管}
function forwardBrass(mb, o) {
  const y = Y0, tr = o.tube, k = tr / 0.0064, vr = o.vr || 0.0105 * Math.max(1, k * 0.95), sp = o.vsp || 0.0295 * Math.max(1, k * 0.9);
  const S = mouthpiece2(mb, [0, y, 0.098], [0, 0, 1], 1.0, M.SILVER);
  const zs = S[2];
  const vz = o.valveZ, yb = y - 0.075, yt = y + 0.012;
  const xr = -0.017 * k;
  // 受け口（レシーバー）→ リードパイプ: 右側を通って前の主管（チューニングスライド）へ
  ferrule(mb, [0, y, zs - 0.004], [0, 0, 1], tr, 0.014);
  const zf = o.bellStart + 0.045 * k;
  pipe(mb, [[0, y, zs - 0.004], [xr * 0.4, y + 0.002, zs + 0.025], [xr, y + 0.004, zs + 0.06], [xr, y + 0.004, zf], [xr, y - 0.044 * k, zf], [xr, y - 0.044 * k, vz - 0.02]], [0.0, 0.02, 0.02 * k, 0.02 * k], tr, LAC, {N: 10});
  ferrule(mb, [xr, y + 0.004, zf - 0.02], [0, 0, 1], tr, 0.012);
  // 主管のスライドの上の曲がり（チューニングスライドの U）の補強の銀の継ぎ手
  ferrule(mb, [xr, y - 0.044 * k, zf - 0.03], [0, 0, 1], tr, 0.010);
  // バルブ → ベルへの管（軸上）
  const zv1 = vz + 2 * sp + vr + 0.006;
  pipe(mb, [[0, y - 0.004, zv1 - 0.012], [0, y, zv1 + 0.01], [0, y, o.bellStart + 0.01]], 0, tr * 1.05, LAC, {N: 12});
  // ベル（Bessel 型。縁は巻いたビード）
  hornBell(mb, [[0, y, o.bellStart], [0, y, lerp(o.bellStart, o.bellEnd, 0.5)], [0, y, o.bellEnd]], tr * 1.05, o.bellR, {b: o.bellB || 1.0, N: 36, rings: 30, collar: true, mat: LAC});
  // ベルのブレース（ベルと管をつなぐ棒）
  mb.tube([0, y - 0.07, vz + 2 * sp + 0.03], [0, y - 0.012, o.bellStart + 0.05], 0.0034, 0.0034, M.NICKEL, {N: 6});
  // 3 本のバルブ（ケーシング・キャップ・パールのボタン）
  for (let i = 0; i < 3; i++) piston(mb, 0, vz + i * sp, yb, yt, vr, {mat: LAC});
  // バルブスライド（下に垂れる U 字管）: 1 番は長く後ろ向き、2 番は短く、3 番は長く前向きでリング付き
  const rr = tr * 0.82, ys = yb - 0.012;
  const sl = [[0, -0.034, 0.010], [1, -0.022, 0.009], [2, -0.044, 0.010]];
  sl.forEach(([i, ln, w]) => {
    const z = vz + i * sp;
    const u = uSlide(mb, [0, ys, z + w * k], [0, ys, z - w * k], [0, -1, i === 0 ? -0.6 : i === 2 ? 0.5 : 0], -ln * 1.0 * k, rr, M.NICKEL, {N: 8, n: 8});
  });
  // 3 番スライドのリング・1 番のサムフック（トリガー）
  mb.sweep(arcPts([0, ys - 0.052 * k, vz + 2 * sp + 0.03 * k], [0, 0, 1], [0, 1, 0], 0.012, 0, Math.PI * 2, 16), 0.0022, M.NICKEL, {N: 6, sub: 1, smooth: false});
  mb.sweep(arcPts([0, y - 0.003, zs + 0.035], [0, 0, 1], [0, 1, 0], 0.013, Math.PI * 0.05, Math.PI * 1.15, 12), 0.0025, M.NICKEL, {N: 6, sub: 1, smooth: false});
  // 水抜き
  waterKey(mb, [0, ys - 0.04 * k, vz + 0.04], [0, -1, 0], k);
  // 下の連結管（左手で支える）
  const g = {
    R: {G: [0.0, y - 0.04, vz + 0.03], fd: [0.3, -0.12, 1], pn: [1, 0, 0], r: 0.014, pole: [-0.6, -1, -0.2]},
    L: {G: [0.0, y - 0.07, vz + 0.075], fd: [-0.2, 0.0, 1], pn: [-1, 0, 0], r: 0.012, pole: [0.5, -1, -0.3]},
  };
  mb.tube([0, y - 0.072, vz - 0.015], [0, y - 0.072, vz + 0.105], 0.0052, 0.0052, M.NICKEL, {N: 8}); // 握りの管
  return g;
}
const trumpet = mb => forwardBrass(mb, {tube: 0.0064, bellStart: 0.37, bellEnd: 0.585, bellR: 0.060, bellB: 1.0, valveZ: 0.215});
const mellophone = mb => forwardBrass(mb, {tube: 0.0085, bellStart: 0.34, bellEnd: 0.575, bellR: 0.120, bellB: 0.9, valveZ: 0.205});
function marchingHorn(mb) {
  const g = forwardBrass(mb, {tube: 0.0090, bellStart: 0.33, bellEnd: 0.62, bellR: 0.138, bellB: 0.9, valveZ: 0.200});
  const y = Y0;
  // ベルの付け根の下の巻き管（2 周）
  const sp = [];
  for (let i = 0; i <= 64; i++) { const t = i / 64, th = Math.PI * 2 * 2 * t + 1.2; sp.push([-0.012 + 0.024 * t, y - 0.115 + 0.078 * Math.sin(th), 0.42 + 0.078 * Math.cos(th)]); }
  mb.sweep(sp, 0.0088, LAC, {N: 10, sub: 1, smooth: false});
  mb.tube([0, y - 0.115, 0.335], [0, y - 0.045, 0.30], 0.0088, 0.0088, LAC, {N: 8});
  return g;
}


// ---- トロンボーン ----
// 長いスライド（内管のペア＋ストッキング＋外管のペア＋先端のクルック）が体の前に水平に伸び、ベルの管は左肩のほうを通って前へ
function trombone(mb) {
  const y = Y0 - 0.007, m = LAC;
  // スライドは水平より少し下へ傾けて前へ伸びる（z が進むほど低くなる）
  const ys = z => y - 0.10 * Math.max(0, z - 0.2) / 0.95;
  const S = mouthpiece2(mb, [0, Y0, 0.098], [0, -0.004, 1], 1.15, M.SILVER);
  const xa = -0.012, xb = 0.040, ri = 0.0085, ro = 0.0118;
  const sd = [xa, xb];
  // マウスパイプ → 内管 A
  ferrule(mb, [0, Y0 - 0.001, S[2] - 0.004], [0, 0, 1], 0.0075, 0.014);
  pipe(mb, [[0, Y0 - 0.001, S[2] - 0.004], [0, y, 0.20], [xa, ys(0.27), 0.27]], [0.05], 0.0078, m, {N: 10});
  // スライドの内管（ニッケルシルバー）とストッキング（先端が太くなる）、外管（手で動かす太い管）
  for (const x of sd) {
    mb.tube([x, ys(0.255), 0.255], [x, ys(0.76), 0.76], ri, ri, M.NICKEL, {N: 12});
    mb.tube([x, ys(0.73), 0.73], [x, ys(0.785), 0.785], ri, ri * 1.35, M.NICKEL, {N: 12});
    mb.tube([x, ys(0.56), 0.56], [x, ys(1.16), 1.16], ro, ro, M.NICKEL, {N: 12});
    for (const z of [0.565, 1.14]) ferrule(mb, [x, ys(z), z], [0, 0, 1], ro, 0.014, M.GOLD);
  }
  // クルック（先端の U 字）: 傾きに沿って 2 本の外管をつなぐ
  const cm = (xa + xb) / 2, wr = (xb - xa) / 2, z1 = 1.16;
  mb.sweep(arcPts([cm, ys(z1), z1], [1, 0, 0], [0, -0.10 / 0.95, 1].map((v, i, a) => v / Math.hypot(...a)), wr, 0, Math.PI, 14), ro, M.NICKEL, {N: 12, smooth: false, capS: false, capE: false});
  // ブレース（外管をつなぐ）と握りの革
  for (const z of [0.64, 0.93]) mb.tube([xa, ys(z), z], [xb, ys(z), z], 0.0048, 0.0048, M.NICKEL, {N: 8});
  mb.tube([xa + 0.008, ys(0.64), 0.64], [xb - 0.008, ys(0.64), 0.64], 0.0085, 0.0085, M.LEATHER, {N: 10});
  // ベル側: 内管 B → 手前の U ベンド（ベルボウ）→ 左側を通って前のベル
  const BX = 0.150;
  pipe(mb, [[xb, ys(0.258), 0.258], [xb + 0.02, y, 0.20], [0.085, y, 0.15], [BX - 0.02, y, 0.17], [BX, y, 0.24], [BX, y + 0.004, 0.40]], [0.0, 0.03, 0.03, 0.045, 0.0], 0.0095, m, {N: 12});
  ferrule(mb, [BX, y, 0.30], [0, 0, 1], 0.0095, 0.010, M.GOLD);
  hornBell(mb, [[BX, y + 0.004, 0.40], [BX, y + 0.006, 0.54], [BX, y + 0.008, 0.70]], 0.0108, 0.112, {b: 0.9, N: 36, rings: 28, collar: true, mat: m});
  // ベルとスライドをつなぐブレース、左手のグリップ、ウォーターキー
  mb.tube([xb, ys(0.43), 0.43], [BX - 0.006, y, 0.43], 0.0045, 0.0045, M.NICKEL, {N: 8});
  mb.tube([0.056, y, 0.20], [0.098, y, 0.19], 0.0060, 0.0060, M.NICKEL, {N: 8});
  mb.ellipsoid([0.11, y - 0.004, 0.20], [0.012, 0.012, 0.030], M.LEATHER, {N: 12, lat: 5});
  waterKey(mb, [0.085, y - 0.008, 0.15], [0, -1, 0], 1.1);
  return {
    R: {G: [(xa + xb) / 2, ys(0.64) + 0.001, 0.64], fd: [0.1, -0.05, 1], pn: [-1, 0, 0], r: 0.014, pole: [-0.5, -1, -0.2]},
    L: {G: [0.11, y - 0.001, 0.22], fd: [-0.1, 0.0, 1], pn: [-1, 0, 0], r: 0.014, pole: [0.6, -1, -0.3]},
  };
}

// ---- フレンチホルン ----
function horn(mb) {
  const C = [0.04, 1.33, 0.30], R = 0.155, m = LAC, tr = 0.0085;
  const S = mouthpiece2(mb, [0, Y0, 0.098], [0, -0.12, 1], 1.12, M.SILVER);
  pipe(mb, [S, [0, 1.49, 0.20], [0.0, 1.45, 0.25], [0.02, 1.42, 0.28]], [0.04, 0.05], tr * 0.9, m, {N: 10});
  // コイル（円盤状に 2.6 周。管は先へ行くほど太い）
  const spiral = [];
  for (let i = 0; i <= 150; i++) {
    const t = i / 150, th = t * Math.PI * 2 * 2.6 + 0.6, r = R * (1 - 0.30 * t), zz = C[2] - 0.035 + 0.026 * Math.sin(t * Math.PI * 2 * 1.3);
    spiral.push([C[0] + r * Math.cos(th), C[1] + r * Math.sin(th), zz]);
  }
  mb.sweep(spiral, s => 0.0082 + 0.0045 * s, m, {N: 10, sub: 1, smooth: false});
  // ベル（右の腰のほうへ向かって大きく開く。縁 Ø30）
  const bs = spiral[0];
  hornBell(mb, [bs, [bs[0] - 0.05, bs[1] - 0.1, 0.29], [-0.10, 1.10, 0.22], [-0.2, 1.09, 0.14], [-0.30, 1.12, 0.06]], 0.0125, 0.150, {b: 0.8, N: 36, rings: 30, cl: 1.5, mat: m});
  // ロータリーバルブ（左手側の 4 つの円筒）とレバー（指かけ）
  for (let k = 0; k < 4; k++) {
    const yk = 1.375 - k * 0.026;
    rotary(mb, [0.158, yk, 0.33], [1, 0, 0], 0.0115, 0.032, m);
    mb.tube([0.178, yk, 0.33], [0.200, yk, 0.322], 0.0030, 0.0030, M.NICKEL, {N: 6});
    mb.ellipsoid([0.202, yk, 0.321], [0.0046, 0.0092, 0.0092], M.PEARL, {N: 10, lat: 4, axis: [1, 0, 0]});
  }
  // 抜差管（チューニングスライドの輪）、バルブスライドの輪
  mb.sweep(circ([0.04, 1.33, 0.272], [0, 0, 1], R * 0.47, 22), 0.0072, m, {N: 8, sub: 1, smooth: false});
  mb.tube([0.04, 1.33, 0.26], [0.04, 1.33, 0.30], 0.012, 0.012, M.NICKEL, {N: 10});
  waterKey(mb, [0.04, 1.33 - R * 0.47 - 0.005, 0.272], [0, -1, 0], 1.0);
  return {
    L: {G: [0.185, 1.33, 0.30], fd: [-0.4, -0.3, 1], pn: [-1, 0, 0], r: 0.014, pole: [0.8, -1, -0.2]},
    R: {G: [-0.22, 1.10, 0.14], fd: [-0.5, -0.3, -1], pn: [0.4, 0.2, 1], r: 0.02, pole: [-0.6, -1, 0.3]},
  };
}

// ---- 上向きのベルの低音金管（ユーフォニアム・チューバ）----
// o: {k 大きさ, z, yBot 下端, yT ベルののど, yRim 縁, rb ベルの半径, vy バルブの下端, nv バルブ数, tr 主管の半径}
function upright(mb, o) {
  const k = o.k, z = o.z, m = LAC, tr = o.tr, zv = z + 0.085 * k;
  const S = mouthpiece2(mb, [0, Y0, 0.098], [0, -0.1, 1], 1.0 + 0.55 * (k - 1), M.SILVER);
  // リードパイプ: 前へ → 下へ → バルブの上へ
  pipe(mb, [S, [0, 1.485, 0.20], [0, 1.44, z - 0.02], [0.0, o.vy + 0.15, zv]], [0.04, 0.05 * k], tr * 0.42, m, {N: 10});
  // ベル（まっすぐ立ち上がって縁で大きく開く）と、のどから下の管
  hornBell(mb, [[0, o.yT, z], [0, lerp(o.yT, o.yRim, 0.5), z], [0, o.yRim, z]], tr, o.rb, {b: o.b || 0.85, N: 40, rings: 30, collar: true, mat: m});
  const yb1 = o.yBot + 0.10 * k;
  mb.tube([0, o.yT + 0.004, z], [0, yb1, z], tr, tr, m, {N: 14, capS: false, capE: false});
  ferrule(mb, [0, o.yT - 0.03, z], [0, 1, 0], tr, 0.012);
  // 下の大きな U ターン（ベルボウ）と戻りの管
  const wB = 0.085 * k, xB = -wB * 2;
  mb.sweep(arcPts([-wB, yb1, z], [1, 0, 0], [0, -1, 0], wB, 0, Math.PI, 16), tr, m, {N: 14, smooth: false, capS: false, capE: false});
  mb.tube([xB, yb1, z], [xB, o.yT - 0.06 * k, z], tr * 0.95, tr * 0.95, m, {N: 14});
  // 大きな巻き管（ベルのまわりの 2 つの輪）と、そこからバルブへの管
  mb.sweep(circ([0, o.yBot + 0.30 * k, z], [0, 0, 1], 0.17 * k, 32, 0.25, Math.PI * 1.95), tr * 0.9, m, {N: 12, sub: 1, smooth: false});
  mb.sweep(circ([0, o.yBot + 0.30 * k, z + 0.03 * k], [0, 0, 1], 0.125 * k, 28, 0.6, Math.PI * 1.85), tr * 0.78, m, {N: 12, sub: 1, smooth: false});
  // バルブ（前面）。ケーシングとキャップ、パールのボタン
  const nv = o.nv, vsp = 0.03 * Math.max(1, k * 0.85);
  for (let i = 0; i < nv; i++) piston(mb, (i - (nv - 1) / 2) * vsp, zv, o.vy, o.vy + 0.13, 0.0108 * Math.max(1, k * 0.9), {mat: m});
  mb.tube([-0.05 * k, o.vy + 0.06, zv - 0.03], [0.05 * k, o.vy + 0.06, zv - 0.03], 0.0055 * k, 0.0055 * k, M.NICKEL, {N: 8});
  // バルブスライド（下に垂れる U 字管）と主管のチューニングスライド（左に張り出す U）
  for (let i = 0; i < nv; i++) {
    const x = (i - (nv - 1) / 2) * vsp;
    uSlide(mb, [x, o.vy - 0.012, zv + 0.012 * k], [x, o.vy - 0.012, zv - 0.012 * k], [0, -1, 0.15], 0.03 * k * (1 + (i % 2) * 0.6), tr * 0.36, M.NICKEL, {N: 8, n: 8});
  }
  uSlide(mb, [0.07 * k, o.yBot + 0.52 * k, z + 0.036 * k], [0.07 * k, o.yBot + 0.52 * k, z - 0.036 * k], [1, 0, 0], 0.10 * k, tr * 0.62, M.NICKEL, {N: 10, n: 10});
  waterKey(mb, [0, yb1 - wB - 0.0, z], [0, -1, 0], k);
  return {
    R: {G: [0.0, o.vy + 0.17, zv], fd: [0.0, -0.1, -1], pn: [0, -1, 0.15], r: 0.02, pole: [-0.6, -1, 0.1]},
    L: {G: [0.0, o.vy - 0.02, z + 0.05], fd: [-0.1, 0.0, 1], pn: [-1, 0, 0], r: 0.025, pole: [0.8, -1, -0.2]},
  };
}
const euphonium = mb => upright(mb, {k: 1.0, z: 0.30, yBot: 1.10, yT: 1.43, yRim: 1.80, rb: 0.150, vy: 1.12, nv: 4, tr: 0.0215, b: 0.9});
const tuba = mb => upright(mb, {k: 1.38, z: 0.34, yBot: 0.84, yT: 1.30, yRim: 2.02, rb: 0.225, vy: 1.12, nv: 4, tr: 0.030, b: 0.85});

// ---- スーザフォン ----
function sousaphone(mb) {
  // 体を通す大きな輪（約 2.4 周のコイル）を左肩が高くなるよう傾けて掛け、左肩の後ろから立ち上がった管が頭の上をまわって前向きのベルになる
  const m = LAC, ctr = [0, 1.18, -0.08], tilt = P.Qz(0.78), rx = 0.43, rz = 0.37;
  const T = p => V.add(ctr, Q.rot(tilt, V.sub(p, ctr)));
  mouthpiece2(mb, [0, Y0, 0.098], [0, -0.1, 1], 1.5, M.SILVER);
  const L = 2.38, th0 = 2.35, NS = 170, helix = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, th = th0 - Math.PI * 2 * L * t, kk = 1 - 0.1 * t;
    helix.push(T([ctr[0] + rx * kk * Math.cos(th), ctr[1] - 0.13 + 0.26 * t, ctr[2] + rz * kk * Math.sin(th)]));
  }
  const rt = s => 0.0175 + 0.0175 * Math.pow(s, 1.6); // 管は進むほど太くなる（Ø 3.5 → 7 cm）
  pipe(mb, [[0, Y0, 0.15], [-0.04, 1.49, 0.19], [-0.12, 1.40, 0.24], helix[0]], [0.04, 0.06], 0.0088, m, {N: 10});
  const E = helix[helix.length - 1], rE = rt(1);
  mb.sweep(helix, rt, m, {N: 16, sub: 1, smooth: false, capS: true, capE: false});
  // 輪の終わり（左肩の上）から頭上へ → 前向きのベル。首の曲がりは一定の太さ
  mb.sweep([E, [E[0] + 0.01, E[1] + 0.20, E[2] - 0.02], [0.33, 1.84, -0.10], [0.27, 2.03, -0.02], [0.14, 2.14, 0.12], [0.03, 2.17, 0.26], [0, 2.17, 0.34]], rE, m, {N: 16, sub: 8, capS: false});
  hornBell(mb, [[0, 2.17, 0.34], [0, 2.165, 0.56], [0, 2.155, 0.82]], rE, 0.335, {b: 0.75, N: 44, rings: 30, collar: true, mat: m});
  // 輪をつなぐ補強の管（前面）と、輪の継ぎ目のリング
  mb.tube(T([-0.26, 1.02, 0.28]), T([-0.26, 1.28, 0.28]), 0.011, 0.011, M.NICKEL, {N: 8});
  for (const t of [0.25, 0.5, 0.75]) { const i = Math.round(NS * t); ferrule(mb, helix[i], V.norm(V.sub(helix[i + 1], helix[i - 1])), rt(t), 0.010); }
  // ピストンバルブ（胸の前）
  for (let i = 0; i < 3; i++) piston(mb, -0.14 + i * 0.035, 0.41, 1.05, 1.19, 0.0118, {mat: m});
  for (let i = 0; i < 3; i++) uSlide(mb, [-0.14 + i * 0.035, 1.04, 0.425], [-0.14 + i * 0.035, 1.04, 0.395], [0, -1, 0.2], 0.04, 0.006, M.NICKEL, {N: 8, n: 8});
  return {
    R: {G: [-0.105, 1.21, 0.41], fd: [0.0, -0.1, -1], pn: [0, -1, 0.1], r: 0.02, pole: [-0.6, -1, 0.2]},
    L: {G: [0.22, 1.28, 0.38], fd: [0.0, 0.0, 1], pn: [-1, 0, 0], r: 0.045, pole: [0.8, -1, -0.2]},
  };
}

// ---- マーチングユーフォニアム（前向きのベル。右手は上のバルブ、左手は巻き管を支える）----
function marchingEuphonium(mb) {
  const m = LAC, yb = 1.30, tr = 0.0165;
  const S = mouthpiece2(mb, [0, Y0, 0.098], [0, -0.1, 1], 1.15, M.SILVER);
  pipe(mb, [S, [0, 1.47, 0.185], [0, 1.43, 0.23], [0, 1.40, 0.27]], [0.04, 0.04], 0.0085, m, {N: 10});
  for (let i = 0; i < 3; i++) piston(mb, 0, 0.255 + i * 0.037, 1.28, 1.37, 0.0118, {mat: m});
  // 巻き管（縦向きの輪を 2 つ並べる）と戻りの管、バルブスライド
  for (const x of [-0.048, 0.048]) mb.sweep(circ([x, 1.19, 0.34], [1, 0, 0], 0.115, 30, 0, Math.PI * 2), tr, m, {N: 12, sub: 1, smooth: false});
  mb.sweep(circ([0, 1.22, 0.31], [1, 0, 0], 0.14, 24, 0.4, Math.PI * 1.6), tr * 0.8, m, {N: 10, sub: 1, smooth: false});
  mb.tube([-0.055, 1.37, 0.38], [0.055, 1.37, 0.38], 0.0075, 0.0075, M.NICKEL, {N: 8});
  for (let i = 0; i < 3; i++) uSlide(mb, [0, 1.270, 0.255 + i * 0.037 + 0.011], [0, 1.270, 0.255 + i * 0.037 - 0.011], [0, -1, 0.1], 0.03, 0.0058, M.NICKEL, {N: 8, n: 8});
  pipe(mb, [[0, 1.37, 0.33], [0, 1.31, 0.40]], 0, 0.012, m, {N: 10});
  hornBell(mb, [[0, yb - 0.01, 0.40], [0, yb + 0.005, 0.58], [0, yb + 0.02, 0.82]], 0.026, 0.150, {b: 0.85, N: 40, rings: 30, collar: true, mat: m});
  waterKey(mb, [0, 1.19 - 0.115 - 0.004, 0.34], [0, -1, 0], 1.2);
  return {
    R: {G: [0.0, 1.405, 0.31], fd: [0.0, -0.05, 1], pn: [0, -1, 0], r: 0.02, pole: [-0.6, -1, -0.1]},
    L: {G: [0.12, 1.19, 0.42], fd: [-0.3, 0.1, 1], pn: [-1, 0, -0.2], r: 0.03, pole: [0.8, -1, -0.2]},
  };
}

// ---- マーチングチューバ（左肩に載せて担ぐ）----
function marchingTuba(mb) {
  const m = LAC, c = [0.265, 1.50], R = 0.175;
  mouthpiece2(mb, [0, Y0, 0.098], [0.15, -0.1, 1], 1.4, M.SILVER);
  pipe(mb, [[0.03, 1.50, 0.20], [0.045, 1.47, 0.27], [0.045, 1.43, 0.30]], [0.03], 0.0092, m, {N: 10});
  for (let i = 0; i < 3; i++) piston(mb, i * 0.04, 0.31, 1.27, 1.40, 0.0125, {mat: m});
  // 左肩を囲む輪（2.5 周。前→後ろへ。管は進むほど太い）
  const hx = [];
  for (let i = 0; i <= 100; i++) { const t = i / 100, th = -Math.PI / 2 + Math.PI * 2 * 2.5 * t, r = R * (1 - 0.1 * t); hx.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th), lerp(0.20, -0.22, t)]); }
  const rt = s => 0.0155 + 0.0125 * s;
  mb.sweep(hx, rt, m, {N: 14, sub: 1, smooth: false, capS: true, capE: false});
  pipe(mb, [[0.0, 1.27, 0.31], [0.04, 1.22, 0.31], [0.16, 1.24, 0.27], [hx[0][0] - 0.03, hx[0][1] - 0.03, hx[0][2] + 0.02], hx[0]], [0.02, 0.04, 0.03], 0.0125, m, {N: 10});
  for (let i = 0; i < 3; i++) uSlide(mb, [i * 0.04, 1.26, 0.322], [i * 0.04, 1.26, 0.298], [0, -1, 0], 0.04, 0.0065, M.NICKEL, {N: 8, n: 8});
  const E = hx[hx.length - 1], rE = rt(1);
  pipe(mb, [E, [0.31, 1.80, -0.20], [0.33, 1.94, -0.08], [0.33, 2.00, 0.12], [0.33, 1.99, 0.30]], [0.12, 0.10, 0.08], rE, m, {N: 14, capS: false});
  hornBell(mb, [[0.33, 1.99, 0.30], [0.33, 1.97, 0.55], [0.33, 1.95, 0.88]], rE, 0.275, {b: 0.8, N: 44, rings: 30, collar: true, mat: m});
  mb.ellipsoid([0.20, 1.405, -0.02], [0.095, 0.022, 0.13], M.LEATHER, {N: 14, lat: 5}); // 肩当て（革）
  return {
    R: {G: [0.04, 1.44, 0.31], fd: [0.0, -0.1, -1], pn: [0, -1, 0.1], r: 0.02, pole: [-0.6, -1, 0.1]},
    L: {G: [c[0], c[1] - R + 0.01, 0.17], fd: [0.0, 0.3, 1], pn: [0, 1, 0], r: 0.034, pole: [0.9, -1, -0.2]},
  };
}
module.exports = {Y0, forwardBrass, trumpet, mellophone, marchingHorn, trombone, horn, euphonium, tuba, sousaphone, marchingEuphonium, marchingTuba};
