'use strict';
// 楽器・手具のメッシュと、構えたときの握り（grip）。座標は「構えた姿勢のときの体の座標系」（足の裏 y=0、+Z が前、左 = +X）
// grip: {G 物の軸上の点, fd 指の向き, pn 手のひらから物へ向かう向き, r 物の半径, pole 肘の向きのヒント}
const {V, Q, ss, lerp} = require('./math');
const M = require('./materials');
const {MeshBuilder} = require('./mesh');
const W = require('./winds');

const {MOUTH, Qx, Qz, circ, flare, bell, mouthpiece, valve, drumAt, harness, stick} = require('./parts');
// 前向きのベルを持つ金管（トランペット・メロフォン）
function forwardBrass(mb, o) {
  const y = 1.512, z0 = 0.135;
  mouthpiece(mb);
  const tr = o.tube || 0.0072;
  mb.sweep([[0, y, z0 - 0.002], [0, y, 0.20], [0, y, o.bellStart]], tr, M.BRASS, {N: 10, sub: 3, smooth: false});
  // ベル（ゆるやかに開いて先端で急に広がる）
  bell(mb, [[0, y, o.bellStart], [0, y, lerp(o.bellStart, o.bellZ, 0.5)], [0, y, o.bellZ]], flare(tr, o.bellR, 0.0, 3.4), M.BRASS, {N: 24, sub: 14, smooth: false});
  // 下側のループ（チューニングスライド）
  const yl = y - o.loopH, zf = o.bellStart + 0.02;
  mb.sweep([[0, y, z0 + 0.02], [0, y - 0.018, z0 - 0.015], [0, yl + 0.004, z0 - 0.01], [0, yl, z0 + 0.06], [0, yl, zf - 0.08], [0, yl + 0.005, zf + 0.0], [0, y - 0.012, zf + 0.028], [0, y - 0.004, zf + 0.012]], tr * 0.95, M.BRASS, {N: 10, sub: 6});
  // 3本のバルブ
  const vz = o.valveZ;
  for (let k = 0; k < 3; k++) valve(mb, 0, vz + k * 0.03, y - 0.075, y + 0.012);
  // バルブの下のループ
  for (let k = 0; k < 3; k++) mb.sweep(circ([0, y - 0.1 - k * 0.012, vz + k * 0.03 - 0.025 - k * 0.006], [1, 0, 0], 0.02 + k * 0.006, 12, -0.5, Math.PI + 0.5), 0.0045, M.BRASS, {N: 6, sub: 1, smooth: false});
  mb.tube([0, y - 0.072, vz - 0.035], [0, y - 0.072, vz + 0.1], 0.0055, 0.0055, M.BRASS, {N: 8});
  // 指かけ・水抜き
  mb.sweep(circ([0, y - 0.012, 0.185], [1, 0, 0], 0.014, 12, Math.PI, Math.PI * 2), 0.0028, M.BRASS, {N: 6, sub: 1, smooth: false});
  return {
    R: {G: [0.0, y - 0.04, vz + 0.03], fd: [0.3, -0.12, 1], pn: [1, 0, 0], r: 0.014, pole: [-0.6, -1, -0.2]},
    L: {G: [0.0, y - 0.07, vz + 0.075], fd: [-0.2, 0.0, 1], pn: [-1, 0, 0], r: 0.012, pole: [0.5, -1, -0.3]},
  };
}
function trumpet(mb) { return forwardBrass(mb, {bellStart: 0.34, bellZ: 0.60, bellR: 0.06, loopH: 0.05, valveZ: 0.22}); }
function mellophone(mb) {
  const g = forwardBrass(mb, {bellStart: 0.30, bellZ: 0.54, bellR: 0.095, loopH: 0.06, valveZ: 0.20, tube: 0.0085});
  return g;
}
function trombone(mb) {
  const y = 1.505, m = M.BRASS;
  mouthpiece(mb);
  // マウスパイプ→スライドの内管（銀）
  mb.sweep([[0, y, 0.135], [0, y, 0.22], [0.0, y - 0.004, 0.27]], 0.0075, m, {N: 10, smooth: false});
  // スライド: 2本の外管と内管（体の前に長く伸びる）
  for (const x of [-0.012, 0.038]) {
    mb.tube([x, y - 0.004, 0.24], [x, y - 0.004, 0.80], 0.0095, 0.0095, M.SILVER, {N: 10});
    mb.tube([x, y - 0.004, 0.80], [x, y - 0.004, 1.02], 0.0075, 0.0075, M.SILVER, {N: 10});
    mb.tube([x, y - 0.004, 0.795], [x, y - 0.004, 0.815], 0.0115, 0.0115, M.BRASS, {N: 10});
  }
  mb.sweep(circ([0.013, y - 0.004, 1.02], [1, 0, 0], 0.025, 14, -Math.PI / 2, Math.PI / 2).map(p => [p[0], p[1] + 0, p[2]]), 0.0075, M.SILVER, {N: 8, sub: 1, smooth: false}); // 先端の U ベンド（簡略）
  mb.box([0.013, y - 0.004, 0.62], [0.06, 0.012, 0.012], m);            // ハンドブレース
  mb.box([0.013, y - 0.004, 0.40], [0.06, 0.010, 0.010], m);
  // ベル側: 手前の U ベンドから左側を通って前へ
  mb.sweep([[0.038, y - 0.004, 0.25], [0.06, y - 0.004, 0.17], [0.095, y - 0.004, 0.155], [0.125, y - 0.004, 0.19], [0.13, y - 0.0, 0.32]], 0.0095, m, {N: 10, sub: 6});
  bell(mb, [[0.13, y, 0.32], [0.13, y + 0.004, 0.50], [0.13, y + 0.008, 0.66]], flare(0.0095, 0.095, 0.1, 3.0), m, {sub: 14, smooth: false});
  mb.box([0.08, y - 0.004, 0.22], [0.1, 0.012, 0.012], m);
  return {
    R: {G: [0.013, y - 0.004, 0.62], fd: [0.1, 0, 1], pn: [-1, 0, 0], r: 0.014, pole: [-0.5, -1, -0.2]},
    L: {G: [0.10, y - 0.004, 0.22], fd: [-0.1, 0.0, 1], pn: [-1, 0, 0], r: 0.014, pole: [0.6, -1, -0.3]},
  };
}
function horn(mb) {
  const C = [0.04, 1.33, 0.30], R = 0.145, m = M.BRASS;
  mouthpiece(mb);
  mb.sweep([[0, 1.512, 0.135], [0, 1.49, 0.19], [0.0, 1.45, 0.25], [0.02, 1.42, 0.28]], 0.0075, m, {N: 10, sub: 5});
  // コイル（円盤状に3周）
  const spiral = [];
  for (let i = 0; i <= 90; i++) {
    const t = i / 90, th = t * Math.PI * 2 * 2.6 + 0.6, r = R * (1 - 0.30 * t), zz = C[2] - 0.035 + 0.07 * (1 - Math.abs(2 * t - 1) * 0.0) * 0 + 0.026 * Math.sin(t * Math.PI * 2 * 1.3);
    spiral.push([C[0] + r * Math.cos(th), C[1] + r * Math.sin(th), zz]);
  }
  mb.sweep(spiral, s => 0.0085 + 0.003 * s, m, {N: 8, sub: 2, smooth: false});
  // ベル（右の腰のほうへ向かって大きく開く）
  const bs = spiral[0];
  bell(mb, [bs, [bs[0] - 0.05, bs[1] - 0.1, 0.29], [-0.10, 1.10, 0.22], [-0.2, 1.09, 0.14], [-0.29, 1.12, 0.06]], flare(0.0095, 0.14, 0.35, 2.4), m, {N: 28, sub: 6});
  // 回転バルブ（左手側）
  for (let k = 0; k < 4; k++) mb.tube([0.145 + 0.0 * k, 1.36 - k * 0.026, 0.33], [0.185, 1.36 - k * 0.026, 0.33], 0.011, 0.011, M.SILVER, {N: 10});
  mb.sweep(circ([0.04, 1.33, 0.272], [0, 0, 1], R * 0.45, 20), 0.0075, m, {N: 6, sub: 1, smooth: false});
  mb.tube([0.04, 1.33, 0.26], [0.04, 1.33, 0.30], 0.012, 0.012, M.SILVER, {N: 10});
  return {
    L: {G: [0.185, 1.33, 0.30], fd: [-0.4, -0.3, 1], pn: [-1, 0, 0], r: 0.014, pole: [0.8, -1, -0.2]},
    R: {G: [-0.22, 1.10, 0.14], fd: [-0.5, -0.3, -1], pn: [0.4, 0.2, 1], r: 0.02, pole: [-0.6, -1, 0.3]},
  };
}
// 上向きのベルの低音金管（ユーフォニアム・チューバ）
function upright(mb, o) {
  const z = o.z, m = M.BRASS, k = o.s;
  mouthpiece(mb);
  mb.sweep([[0, 1.512, 0.135], [0, 1.47, 0.20], [0.0, 1.43, z - 0.04], [0, 1.38, z]], 0.0075 * k, m, {N: 10, sub: 5});
  // ベル（まっすぐ立ち上がって上で大きく開く）
  bell(mb, [[0, o.y0, z], [0, o.y0 + 0.4 * k, z], [0, o.y1 - 0.34 * k, z], [0, o.y1, z]], flare(0.024 * k, o.rb, 0.40, 3.3), m, {N: 28, sub: 14, smooth: false});
  // 巻き管（下で U ターンする2本）
  for (const x of [-0.075 * k, 0.075 * k]) mb.tube([x, o.y0 + 0.02, z], [x, o.y0 + 0.5 * k, z], 0.017 * k, 0.017 * k, m, {N: 12});
  mb.sweep(circ([0, o.y0 + 0.02, z], [0, 0, 1], 0.075 * k, 14, Math.PI, Math.PI * 2), 0.017 * k, m, {N: 12, sub: 1, smooth: false});
  mb.sweep(circ([0, o.y0 + 0.30 * k, z + 0.0], [1, 0, 0], 0.11 * k, 20, -Math.PI / 2, Math.PI * 0.6).map(p => [p[0], p[1], p[2]]), 0.014 * k, m, {N: 10, sub: 1, smooth: false});
  // 大きなコイル
  mb.sweep(circ([0, o.y0 + 0.22 * k, z], [0, 0, 1], 0.16 * k, 28, 0.2, Math.PI * 1.9), 0.015 * k, m, {N: 10, sub: 1, smooth: false});
  mb.sweep(circ([0, o.y0 + 0.22 * k, z], [0, 0, 1], 0.12 * k, 28, 0.5, Math.PI * 1.8), 0.013 * k, m, {N: 10, sub: 1, smooth: false});
  // ピストンバルブ（前面）
  const vy0 = o.vy, vz = z + 0.085 * k;
  for (let i = 0; i < o.nv; i++) valve(mb, (i - (o.nv - 1) / 2) * 0.03, vz, vy0, vy0 + 0.13, 0.0105);
  mb.tube([-0.05, vy0 + 0.06, vz - 0.03], [0.05, vy0 + 0.06, vz - 0.03], 0.0055, 0.0055, m, {N: 8});
  return {
    R: {G: [0.0, vy0 + 0.17, vz], fd: [0.0, -0.1, -1], pn: [0, -1, 0.15], r: 0.02, pole: [-0.6, -1, 0.1]},
    L: {G: [0.0, vy0 - 0.02, z + 0.05], fd: [-0.1, 0.0, 1], pn: [-1, 0, 0], r: 0.025, pole: [0.8, -1, -0.2]},
  };
}
function euphonium(mb) { return upright(mb, {z: 0.30, s: 1.0, y0: 0.98, y1: 1.88, rb: 0.17, vy: 1.12, nv: 4}); }
function tuba(mb) { return upright(mb, {z: 0.34, s: 1.35, y0: 0.82, y1: 2.02, rb: 0.235, vy: 1.12, nv: 4}); }
function sousaphone(mb) {
  // 体を通す大きな輪（約2.4周のコイル）を左肩が高くなるよう傾けて掛け、左肩の後ろから立ち上がった管が
  // 頭の上をまわって前向きの大きなベルになる。バルブは輪の前（胸の前）。
  const m = M.BRASS, ctr = [0, 1.18, -0.08], tilt = Qz(0.78), rx = 0.43, rz = 0.37, tr = 0.048;
  const T = p => V.add(ctr, Q.rot(tilt, V.sub(p, ctr)));
  mouthpiece(mb);
  const L = 2.38, th0 = 2.35, NS = 150, helix = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, th = th0 - Math.PI * 2 * L * t, k = 1 - 0.1 * t;
    helix.push(T([ctr[0] + rx * k * Math.cos(th), ctr[1] - 0.13 + 0.26 * t, ctr[2] + rz * k * Math.sin(th)]));
  }
  // 吹き口 → 右前から輪に入る
  mb.sweep([[0, 1.512, 0.135], [-0.04, 1.49, 0.19], [-0.12, 1.40, 0.24], helix[0]], 0.0085, m, {N: 10, sub: 6});
  mb.sweep(helix, tr, m, {N: 14, sub: 1, smooth: false, capS: true, capE: false});
  // 輪の終わり（左肩の上）から頭上へ → 前向きのベル
  const E = helix[helix.length - 1];
  bell(mb, [E, [E[0] + 0.01, E[1] + 0.22, E[2] - 0.02], [0.33, 1.82, -0.10], [0.27, 2.02, -0.02], [0.14, 2.14, 0.12], [0.03, 2.17, 0.26], [0, 2.17, 0.38], [0, 2.165, 0.58], [0, 2.155, 0.83]],
    flare(tr, 0.345, 0.55, 2.8), m, {N: 36, sub: 6});
  // 輪をつなぐ補強の短い管（前面）
  mb.tube(T([-0.26, 1.02, 0.28]), T([-0.26, 1.28, 0.28]), 0.012, 0.012, m, {N: 8});
  // ピストンバルブ（胸の前）
  for (let i = 0; i < 3; i++) valve(mb, -0.14 + i * 0.035, 0.41, 1.05, 1.19, 0.012);
  return {
    R: {G: [-0.105, 1.21, 0.41], fd: [0.0, -0.1, -1], pn: [0, -1, 0.1], r: 0.02, pole: [-0.6, -1, 0.2]},
    L: {G: [0.22, 1.28, 0.38], fd: [0.0, 0.0, 1], pn: [-1, 0, 0], r: 0.045, pole: [0.8, -1, -0.2]},
  };
}
// ---- マーチング用の金管 ----
// マーチングホルン: メロフォンより大きなベルと、フレンチホルン風の巻き管
function marchingHorn(mb) {
  const g = forwardBrass(mb, {bellStart: 0.32, bellZ: 0.60, bellR: 0.125, loopH: 0.05, valveZ: 0.20, tube: 0.0088});
  const y = 1.512, m = M.BRASS;
  // ベルの付け根の下の巻き管（2周）
  const sp = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60, th = Math.PI * 2 * 2 * t + 1.2; sp.push([-0.012 + 0.024 * t, y - 0.105 + 0.078 * Math.sin(th), 0.415 + 0.078 * Math.cos(th)]); }
  mb.sweep(sp, 0.0085, m, {N: 8, sub: 1, smooth: false});
  mb.tube([0, y - 0.105, 0.335], [0, y - 0.04, 0.30], 0.0085, 0.0085, m, {N: 8});
  return g;
}
// マーチングユーフォニアム: ベルが前向きの大きなバリトン型。右手は上のバルブ、左手は巻き管を支える
function marchingEuphonium(mb) {
  const m = M.BRASS, yb = 1.30;
  mouthpiece(mb);
  mb.sweep([[0, 1.512, 0.135], [0, 1.47, 0.185], [0, 1.43, 0.23], [0, 1.40, 0.27]], 0.0085, m, {N: 10, sub: 5});
  // 上面のバルブ（3本、前後に並ぶ）
  for (let i = 0; i < 3; i++) valve(mb, 0, 0.255 + i * 0.037, 1.28, 1.37, 0.0115);
  // 巻き管（縦向きの輪を2つ並べる）と戻りの管
  for (const x of [-0.045, 0.045]) mb.sweep(circ([x, 1.19, 0.34], [1, 0, 0], 0.115, 28, 0, Math.PI * 2 * 1.0), 0.0165, m, {N: 12, sub: 1, smooth: false});
  mb.sweep(circ([0, 1.22, 0.31], [1, 0, 0], 0.14, 24, 0.4, Math.PI * 1.6), 0.0135, m, {N: 10, sub: 1, smooth: false});
  mb.tube([-0.05, 1.37, 0.38], [0.05, 1.37, 0.38], 0.0075, 0.0075, m, {N: 8});
  // ベル（前向き。口径は大きい）
  bell(mb, [[0, yb - 0.02, 0.40], [0, yb, 0.52], [0, yb + 0.01, 0.66], [0, yb + 0.02, 0.86]], flare(0.034, 0.185, 0.35, 2.6), m, {N: 30, sub: 8, smooth: false});
  // 支柱の管
  mb.tube([0, 1.37, 0.33], [0, 1.31, 0.45], 0.012, 0.012, m, {N: 8});
  return {
    R: {G: [0.0, 1.405, 0.31], fd: [0.0, -0.05, 1], pn: [0, -1, 0], r: 0.02, pole: [-0.6, -1, -0.1]},
    L: {G: [0.12, 1.19, 0.42], fd: [-0.3, 0.1, 1], pn: [-1, 0, -0.2], r: 0.03, pole: [0.8, -1, -0.2]},
  };
}
// マーチングチューバ: 左肩に載せて担ぐ（YBB型）。管の輪は左肩を囲んで頭の左側にあり、大きなベルは左の頭の横〜上で前を向く。
// 左腕は輪の下から回して支え、右手は顔の近くのバルブへ。吹き口は左から口へ
function marchingTuba(mb) {
  const m = M.BRASS, c = [0.265, 1.50], R = 0.175, tr = 0.032;
  mouthpiece(mb);
  mb.sweep([[0, 1.512, 0.135], [0.03, 1.50, 0.20], [0.045, 1.47, 0.27], [0.045, 1.43, 0.30]], 0.0088, m, {N: 10, sub: 5});
  for (let i = 0; i < 3; i++) valve(mb, 0.0 + i * 0.04, 0.31, 1.27, 1.40, 0.0125);
  // 左肩を囲む輪（2.5周。前→後ろへ）
  const hx = [];
  for (let i = 0; i <= 90; i++) { const t = i / 90, th = -Math.PI / 2 + Math.PI * 2 * 2.5 * t, r = R * (1 - 0.1 * t); hx.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th), lerp(0.20, -0.22, t)]); }
  mb.sweep(hx, tr, m, {N: 14, sub: 1, smooth: false, capS: true, capE: true});
  // バルブの下から輪の前へ
  mb.sweep([[0.0, 1.27, 0.31], [0.04, 1.22, 0.31], [0.16, 1.24, 0.27], [hx[0][0] - 0.03, hx[0][1] - 0.03, hx[0][2] + 0.02], hx[0]], 0.012, m, {N: 10, sub: 5});
  // 輪の後ろ端から頭の左上を回って前向きのベルへ
  const E = hx[hx.length - 1];
  bell(mb, [E, [0.31, 1.80, -0.20], [0.33, 1.94, -0.08], [0.33, 2.00, 0.12], [0.33, 1.98, 0.34], [0.33, 1.96, 0.52], [0.33, 1.95, 0.70], [0.33, 1.95, 0.96]], flare(tr, 0.28, 0.58, 2.7), m, {N: 36, sub: 6});
  // 肩当て（革）
  mb.box([0.20, 1.40, -0.02], [0.17, 0.03, 0.24], M.LEATHER);
  return {
    R: {G: [0.04, 1.44, 0.31], fd: [0.0, -0.1, -1], pn: [0, -1, 0.1], r: 0.02, pole: [-0.6, -1, 0.1]},
    L: {G: [c[0], c[1] - R + 0.01, 0.17], fd: [0.0, 0.3, 1], pn: [0, 1, 0], r: 0.034, pole: [0.9, -1, -0.2]},
  };
}

// ---- 打楽器 ----
// 手に持つもの（スティック・マレット・シンバルの板）は parts.R / parts.L（手のボーンに付く別メッシュ）に作る。parts が無ければ本体に混ぜる
const partOf = (mb, parts, k) => (parts ? parts[k] : mb);
// 打つ動きの記述（strike.js / strike.rs が読む）: 打面 drums = {pad, c: 打面の中心, n: 打面の法線（外向き）, ex: 打面内の左（+x）向き, ez: 打面内の前向き, r: 打面の半径}、
// 手に持つ棒 sticks = {R, L: {a: 後端, b: 先端の球の中心, rh: 先端の球の半径}}、anchor = 手首の待機位置。座標は構え（hold）のときのモデル座標
const unit = v => V.norm(v);
function drumRec(pad, c, n, r, o = {}) {
  n = unit(n);
  const ex = unit(o.ex || V.sub([1, 0, 0], V.mul(n, n[0]))), ez = unit(o.ez || V.sub(V.sub([0, 0, 1], V.mul(n, n[2])), V.mul(ex, ex[2])));
  return {pad, c, n, ex, ez, r, spread: o.spread === undefined ? 1 : o.spread, ...(o.hand ? {hand: o.hand} : {})};
}
// 棒の後ろ端を手の後ろへ伸ばして（握りの位置 G は変えない）、実物の長さにする
function longStick(pm, G, tip, rh, butt, m = M.WOOD, tm = M.WOOD) {
  const d = unit(V.sub(tip, G)), a = V.madd(G, d, -butt);
  stick(pm, a, tip, m, tm, rh);
  return {a, b: tip, rh};
}
function snare(mb, parts) {
  const c = [0, 0.93, 0.31], ax = V.norm([0, 1, 0.16]);
  drumAt(mb, c, ax, 0.178, 0.19, {both: true});
  // 胴の縞（リアルでは胴と同じ色、イラストでは黒）
  for (const [a, b] of [[-0.062, -0.044], [0.044, 0.062]]) mb.lathe(V.madd(c, ax, a), ax, [[0.1795, 0], [0.1795, b - a]], M.STRIPE, {N: 32, capS: false, capE: false});
  harness(mb);
  // ストラップ受けと支柱
  for (const s of [-1, 1]) mb.tube([s * 0.10, 1.12, 0.15], [s * 0.115, 0.99, 0.25], 0.007, 0.007, M.LEATHER, {N: 6});
  mb.box(V.madd(c, ax, -0.1), [0.06, 0.03, 0.06], M.SILVER); // スナッピー（下側）のつまみ
  const top = V.madd(c, ax, 0.095);
  const GR = [-0.095, 1.085, 0.22], GL = [0.095, 1.085, 0.22];
  const sR = longStick(partOf(mb, parts, 'R'), GR, V.add(top, [-0.05, 0.003, 0.06]), 0.0075, 0.11);
  const sL = longStick(partOf(mb, parts, 'L'), GL, V.add(top, [0.05, 0.003, 0.06]), 0.0075, 0.11);
  return {
    R: {G: [-0.098, 1.082, 0.225], fd: [0.0, -0.4, 1], pn: [0.0, -1, 0.1], r: 0.006, pole: [-0.6, -1, -0.4]},
    L: {G: [0.098, 1.082, 0.225], fd: [0.0, -0.4, 1], pn: [0.0, -1, 0.1], r: 0.006, pole: [0.6, -1, -0.4]},
    strike: {drums: [drumRec(1, V.madd(c, ax, 0.095), ax, 0.178)], sticks: {R: sR, L: sL}, anchor: {R: GR, L: GL}, click: [0, 1.20, 0.33]},
  };
}
const FLAG_G = [-0.30, 1.05, 0.15];
function flag(mb) {
  // ポール 1.8m。旗（シルク）は 長さ1.2m × 高さ0.9m をポールの上端に沿って縫い付け、-x へ広がる。
  // 布の揺れは view3d.js の頂点シェーダ（ポールからの距離に応じた正弦波）で動かす。ここでは静止形（わずかな反り）だけ作る
  const g = FLAG_G, y0 = g[1] - 0.42, y1 = y0 + 1.8;
  mb.tube([g[0], y0, g[2]], [g[0], y1, g[2]], 0.0105, 0.0105, M.POLE, {N: 12});
  mb.tube([g[0], y1 - 0.02, g[2]], [g[0], y1 + 0.005, g[2]], 0.014, 0.012, M.SILVER, {N: 12});
  mb.ellipsoid([g[0], y1 + 0.016, g[2]], [0.016, 0.02, 0.016], M.SILVER, {N: 10, lat: 5});
  mb.ellipsoid([g[0], y0 - 0.004, g[2]], [0.014, 0.014, 0.014], M.LEATHER, {N: 10, lat: 5});
  // 握りのテープ（右手のあたり）
  mb.tube([g[0], g[1] - 0.12, g[2]], [g[0], g[1] + 0.12, g[2]], 0.0122, 0.0122, M.LEATHER, {N: 12});
  const W = 1.2, Hh = 0.9, top = y1 - 0.03, NU = 18, NV = 24;
  const cl = (u, v) => [g[0] - 0.016 - W * v, top - Hh * u, g[2] + 0.025 * Math.sin(v * 4.2 + u * 1.6) * v];
  // 上 62% がパートの色、下 38% が白。素材は三角形ごとに分ける（帯の境目は格子線に合わせる）
  const split = Math.round(NU * 0.62);
  const id = [];
  for (let i = 0; i <= NU; i++) { const row = []; for (let j = 0; j <= NV; j++) row.push(mb.v(cl(i / NU, j / NV), null)); id.push(row); }
  const id2 = id.map(r => r.map(k => mb.v(mb.P[k], null)));
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const m = i < split ? M.CLOTH : M.CLOTH2;
    const a = id[i][j], b = id[i + 1][j], c = id[i + 1][j + 1], d = id[i][j + 1];
    mb.tri(a, c, b, m); mb.tri(a, d, c, m);
    const a2 = id2[i][j], b2 = id2[i + 1][j], c2 = id2[i + 1][j + 1], d2 = id2[i][j + 1];
    mb.tri(a2, b2, c2, m); mb.tri(a2, c2, d2, m);
  }
  // ポール側の縫い代（細い革の帯）
  mb.tube([g[0] - 0.013, top, g[2]], [g[0] - 0.013, top - Hh, g[2]], 0.0045, 0.0045, M.LEATHER, {N: 6});
  return {
    R: {G: g, fd: [0, 0, 1], pn: [-1, 0, 0], r: 0.0105, pole: [-0.8, -1, -0.3]},
    L: {G: [g[0], g[1] + 0.27, g[2]], fd: [0, 0, 1], pn: [-1, 0, 0], r: 0.0105, pole: [0.6, -1, -0.4]},
  };
}

// カラーガードの旗: ポールの軸は鉛直、右手の位置 G を通る

// テナードラム（クイント / セクステット）: 主ドラム4つを手前から見て弧に並べ、その上に小さなスポック2つ。
// 番号は実際のドラムラインの数え方: 1 = 最高音・最小（手前の右）、2 = 手前の左、3 = 外側の右、4 = 外側の左（最大）、5 = スポック1（手前中央の右）、6 = スポック2（左）。
// サイズは 10・12・13・14 インチ、スポックは 6 インチ。ヘッドは奏者の側へ傾ける
const TENOR_DRUMS = [
  {pad: 1, R: 0.127, h: 0.19, c: [-0.140, 1.005, 0.505], n: [0.07, 1, -0.20]},
  {pad: 2, R: 0.152, h: 0.19, c: [0.165, 1.005, 0.505], n: [-0.07, 1, -0.20]},
  {pad: 3, R: 0.165, h: 0.20, c: [-0.440, 0.955, 0.385], n: [0.30, 1, -0.17]},
  {pad: 4, R: 0.178, h: 0.21, c: [0.480, 0.955, 0.375], n: [-0.30, 1, -0.17]},
  {pad: 5, R: 0.076, h: 0.11, c: [-0.072, 1.19, 0.435], n: [0.06, 1, -0.26]},
  {pad: 6, R: 0.076, h: 0.11, c: [0.078, 1.19, 0.435], n: [-0.06, 1, -0.26]},
];
function tenors(mb, parts) {
  harness(mb);
  const recs = [], low = [];
  for (const d of TENOR_DRUMS) {
    const n = unit(d.n), sh = V.madd(d.c, n, -d.h / 2);
    drumAt(mb, sh, n, d.R, d.h, {lugs: d.pad >= 5 ? 5 : 6});
    recs.push(drumRec(d.pad, d.c, n, d.R));
    if (d.pad <= 4) low.push(V.madd(d.c, n, -d.h - 0.035));
  }
  // キャリア: 主ドラムの下をくぐる弧のレール、各ドラムの胴をつなぐ支柱、ハーネスの板からのアーム、スポックの支柱
  const rail = [low[2], low[0], low[1], low[3]];
  mb.sweep(rail, 0.011, M.SILVER, {N: 8, sub: 6});
  for (const d of TENOR_DRUMS) if (d.pad <= 4) {
    const n = unit(d.n), bt = V.madd(d.c, n, -d.h - 0.035);
    mb.tube(bt, V.madd(d.c, n, -d.h * 0.55), 0.008, 0.008, M.SILVER, {N: 6});
    mb.ellipsoid(V.madd(d.c, n, -d.h * 0.55), [0.012, 0.012, 0.012], M.LEATHER, {N: 8, lat: 4});
  }
  for (const s of [-1, 1]) {
    mb.sweep([[s * 0.085, 1.14, 0.135], [s * 0.11, 1.02, 0.20], [s * 0.10, 0.93, 0.32], V.add(s < 0 ? low[0] : low[1], [0, 0.02, 0.0])], 0.009, M.LEATHER, {N: 6, sub: 5});
  }
  for (const d of TENOR_DRUMS) if (d.pad >= 5) {
    const n = unit(d.n), bt = V.madd(d.c, n, -d.h - 0.01), sx = d.pad === 5 ? -1 : 1, base = [sx * 0.03, 1.02, 0.43];
    mb.tube(base, bt, 0.007, 0.007, M.SILVER, {N: 6});
  }
  mb.tube([-0.03, 1.02, 0.43], [0.03, 1.02, 0.43], 0.008, 0.008, M.SILVER, {N: 6});
  mb.tube([0, 1.02, 0.43], [0, 0.95, 0.47], 0.009, 0.009, M.SILVER, {N: 6});
  // 右手・左手のスティック: 構えでは先が主ドラム1・2の打面に載る
  const GR = [-0.10, 1.118, 0.205], GL = [0.10, 1.118, 0.205];
  const tipOn = (d, sx) => V.madd(V.add(d.c, V.add(V.mul(d.ex, sx * 0.28 * d.r), V.mul(d.ez, -0.10 * d.r))), d.n, 0.012);
  const tR = tipOn(recs[0], -1), tL = tipOn(recs[1], 1);
  const sR = longStick(partOf(mb, parts, 'R'), GR, tR, 0.012, 0.115), sL = longStick(partOf(mb, parts, 'L'), GL, tL, 0.012, 0.115);
  const fdR = unit(V.sub(tR, GR)), fdL = unit(V.sub(tL, GL));
  return {
    R: {G: GR, fd: fdR, pn: [0.0, -1, 0.1], r: 0.006, pole: [-0.6, -1, -0.4]},
    L: {G: GL, fd: fdL, pn: [0.0, -1, 0.1], r: 0.006, pole: [0.6, -1, -0.4]},
    strike: {drums: recs, sticks: {R: sR, L: sL}, anchor: {R: GR, L: GL}, click: [0, 1.30, 0.36]},
  };
}
// バスドラム（キャリア付き）。胴径 R が大きいほど低音。胴の軸は左右（ヘッドが体の右と左を向く）。右手のマレットは右のヘッド、左手は左のヘッドを横から打つ
function bassdrum(mb, R, h, parts) {
  harness(mb, 1.20);
  const zc = 0.12 + R + 0.05, c = [0, 0.66 + R, zc], rh = 0.04, hr = R - 0.004;
  drumAt(mb, c, [1, 0, 0], R, h, {both: true, lugs: 12});
  // キャリアのアーム（板から胴の手前の上・下へ）
  for (const s of [-1, 1]) {
    mb.tube([s * 0.09, 1.22, 0.14], [s * h * 0.38, c[1] + R * 0.62, zc - R * 0.78], 0.008, 0.008, M.LEATHER, {N: 6});
    mb.tube([s * 0.10, 1.00, 0.12], [s * h * 0.38, c[1] - R * 0.62, zc - R * 0.78], 0.008, 0.008, M.LEATHER, {N: 6});
  }
  const g = {}, recs = [], sticks = {}, anchor = {};
  for (const [key, s] of [['L', 1], ['R', -1]]) {
    const headC = [s * (h / 2 + 0.004), c[1], zc], n = [s, 0, 0];
    recs.push(drumRec(s < 0 ? 1 : 2, headC, n, hr, {ex: [0, 1, 0], ez: [0, 0, 1], spread: 0, hand: key}));
    const G = [s * (h / 2 + 0.17), c[1] + 0.08, zc - 0.26], tip = [s * (h / 2 + 0.004 + rh), c[1] + 0.02, zc - 0.02];
    const dir = unit(V.sub(tip, G)), pm = partOf(mb, parts, key), a = V.madd(G, dir, -0.13);
    pm.tube(a, V.madd(tip, dir, -rh * 0.9), 0.008, 0.0065, M.WOOD, {N: 6});
    pm.ellipsoid(tip, [rh, rh, rh], M.FELT, {N: 12, lat: 7});
    sticks[key] = {a, b: tip, rh}; anchor[key] = G;
    g[key] = {G, fd: dir, pn: [0, -1, 0.1], r: 0.008, pole: [s * 0.8, -1, -0.2]};
  }
  g.strike = {drums: recs, sticks, anchor, click: [0, c[1] + R + 0.10, zc]};
  return g;
}
// シンバル: 2枚を縦（板面は左右に向き合う）に持つ。mid は胸の高さ、high は頭上に高く掲げる
function cymbalsAt(mb0, y, z, X, up, parts) {
  const prof = [[0.0, 0.014], [0.026, 0.014], [0.034, 0.007], [0.10, 0.0], [0.178, -0.007], [0.18, -0.009], [0.178, -0.0105], [0.10, -0.0035], [0.036, 0.0035], [0.028, 0.011], [0.0, 0.011]];
  const g = {};
  for (const [key, s] of [['L', 1], ['R', -1]]) {
    const c = [s * X, y, z], ax = [s, 0, 0], mb = partOf(mb0, parts, key); // ドーム（取っ手側）は外向き
    mb.lathe(c, ax, prof, M.BRASS, {N: 36, capS: true, capE: true});
    mb.tube(V.madd(c, ax, 0.012), V.madd(c, ax, 0.04), 0.0145, 0.0145, M.SILVER, {N: 10});
    // 革ひもの輪（手を通す）
    mb.sweep(circ(V.madd(c, ax, 0.04), [1, 0, 0], 0.045, 16, 0, Math.PI * 2), 0.0045, M.LEATHER, {N: 6, sub: 1, smooth: false});
    g[key] = {G: V.madd(c, ax, 0.046), fd: up ? [-s * 0.2, 1, 0.1] : [-s * 0.15, -0.1, 1], pn: [-s, 0, 0], r: 0.006, pole: [s * 0.8, -1, -0.2]};
  }
  return g;
}
const cymbalsMid = (mb, parts) => cymbalsAt(mb, 1.20, 0.30, 0.11, false, parts);
function cymbalsHigh(mb, parts) {
  const g = cymbalsAt(mb, 1.94, 0.13, 0.13, true, parts);
  // 下ろしたときは胸の高さ（体のそばに）
  g.carryT = {pivot: [0, 1.5, 0.2], q: [0, 0, 0, 1], shift: [0, -0.70, 0.17]};
  return g;
}
// グロッケン（マーチング用ベルライラ）: 前に傾けて縦に構える。左手で下の短い柄を持ち、右手のマレットで叩く。バーの面は奏者の側
function glockenspiel(mb, parts) {
  const C = [0.0, 1.24, 0.36], up = V.norm([0, 1, 0.58]), nrm = V.norm([0, 0.58, -1]), ex = [1, 0, 0];
  const P = (xp, t, o = 0) => V.add(V.add(V.add(C, V.mul(ex, xp)), V.mul(up, t)), V.mul(nrm, o));
  const NB = 20, pitch = 0.0172, t0 = -0.168, len = i => lerp(0.30, 0.14, i / (NB - 1)), tt = t0 + (NB - 1) * pitch + 0.024;
  const bq = Q.fromBasis(ex, nrm, V.cross(ex, nrm));
  for (let i = 0; i < NB; i++) mb.box(P(0, t0 + i * pitch), [len(i), 0.0045, 0.0125], M.SILVER, {q: bq});
  // バーを支える黒いフェルト帯（2本）と裏の支え棒
  for (const s of [-1, 1]) {
    mb.box(P(s * 0.062, (t0 + tt) / 2, 0.0045), [0.007, 0.0035, tt - t0], M.LEATHER, {q: bq});
    mb.tube(P(s * 0.062, t0 - 0.02, 0.011), P(s * 0.062, tt, 0.011), 0.0035, 0.0035, M.SILVER, {N: 6});
  }
  // ライラ形の枠（左右の外側の曲線、上の渦巻き、下の収束）
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const k = i / 10, t = lerp(-0.24, tt, k), bi = Math.min(NB - 1, Math.max(0, (t - t0) / pitch)); pts.push(P(s * lerp(0.05, len(bi) / 2 + 0.014, Math.min(1, k * 2.2)), t, 0.003)); }
    mb.sweep(pts, 0.0065, M.SILVER, {N: 8, sub: 3});
    const top = pts[pts.length - 1];
    mb.sweep(circ(V.madd(top, ex, s * 0.022), V.cross(ex, up), 0.022, 14, 0, Math.PI * 1.7), 0.0048, M.SILVER, {N: 6, sub: 1, smooth: false});
  }
  mb.tube(P(-0.075, tt, 0.003), P(0.075, tt, 0.003), 0.006, 0.006, M.SILVER, {N: 8});
  // 柄（左手で持つ）
  const base = P(0, -0.24, 0.003), hd = V.mul(up, -1);
  mb.tube(base, V.madd(base, hd, 0.20), 0.0125, 0.0125, M.SILVER, {N: 12});
  mb.tube(V.madd(base, hd, 0.03), V.madd(base, hd, 0.16), 0.0148, 0.0148, M.LEATHER, {N: 12});
  mb.ellipsoid(V.madd(base, hd, 0.205), [0.016, 0.012, 0.016], M.LEATHER, {axis: hd, N: 10, lat: 4});
  // 右手のマレット（真鍮の玉）
  const tip = P(-0.045, 0.02, 0.012), H = V.add(V.madd(tip, nrm, 0.26), [-0.12, 0.0, 0]), dir = V.norm(V.sub(tip, H));
  const mr = partOf(mb, parts, 'R');
  mr.tube(V.madd(tip, dir, -0.30), V.madd(tip, dir, -0.012), 0.0045, 0.0036, M.WOOD, {N: 6});
  mr.ellipsoid(tip, [0.012, 0.012, 0.012], M.BRASS, {N: 10, lat: 6});
  return {
    L: {G: V.madd(base, hd, 0.085), fd: [0, 0.0, 1], pn: [-1, 0, 0], r: 0.0148, pole: [0.8, -1, -0.2]},
    R: {G: V.madd(tip, dir, -0.17), fd: dir, pn: [0, -1, 0.1], r: 0.005, pole: [-0.8, -1, -0.2]},
  };
}
// シロフォン: 体の前の台（フレーム）に載せる。バーは木（ローズウッド色）、下に共鳴管。ひとりに2本のマレット
function xylophone(mb, parts) {
  const yb = 0.93, zc = 0.42, NN = 22, pitch = 0.0455, x0 = -(NN - 1) * pitch / 2;
  const bar = (x, z, Lb, w) => mb.box([x, yb, z], [w, 0.016, Lb], M.ROSEWOOD);
  const resonator = (x, z, Lr, r) => { mb.tube([x, yb - 0.012, z], [x, yb - 0.012 - Lr, z], r, r, M.BRASS, {N: 10}); };
  for (let i = 0; i < NN; i++) {
    const x = x0 + i * pitch, k = i / (NN - 1), Lb = lerp(0.20, 0.115, k), w = lerp(0.038, 0.030, k);
    bar(x, zc, Lb, w); resonator(x, zc, lerp(0.46, 0.14, k), lerp(0.018, 0.014, k));
    mb.tube([x, yb + 0.008, zc - Lb * 0.22], [x, yb + 0.011, zc - Lb * 0.22], 0.0022, 0.0022, M.SILVER, {N: 5});
  }
  // 半音のバー（奥の列）: E-F・B-C の間には無い
  const skip = new Set([2, 6, 9, 13, 16, 20]);
  for (let i = 0; i < NN - 1; i++) {
    if (skip.has(i)) continue;
    const x = x0 + (i + 0.5) * pitch, k = (i + 0.5) / (NN - 1);
    bar(x, zc + 0.205, lerp(0.16, 0.095, k), lerp(0.030, 0.024, k));
  }
  // フレーム: 長辺のレール、脚（4本）、横木
  for (const z of [zc - 0.14, zc + 0.30]) mb.tube([x0 - 0.04, yb - 0.02, z], [-x0 + 0.04, yb - 0.02, z], 0.016, 0.016, M.DARKSTEEL, {N: 8});
  for (const x of [x0 - 0.04, -x0 + 0.04]) mb.tube([x, yb - 0.02, zc - 0.14], [x, yb - 0.02, zc + 0.30], 0.016, 0.016, M.DARKSTEEL, {N: 8});
  for (const x of [x0 - 0.03, -x0 + 0.03]) for (const z of [zc - 0.12, zc + 0.28]) {
    mb.tube([x, 0.0, z], [x, yb - 0.02, z], 0.014, 0.014, M.DARKSTEEL, {N: 8});
    mb.ellipsoid([x, 0.012, z], [0.026, 0.012, 0.026], M.LEATHER, {N: 8, lat: 3});
  }
  for (const z of [zc - 0.12, zc + 0.28]) mb.tube([x0 - 0.03, 0.30, z], [-x0 + 0.03, 0.30, z], 0.009, 0.009, M.DARKSTEEL, {N: 6});
  // マレット（左右1本ずつ）
  const g = {};
  for (const [key, s] of [['L', 1], ['R', -1]]) {
    const dir = V.norm([0, -0.50, 1]), G = [s * 0.16, 1.03, 0.22], tip = V.madd(G, dir, 0.17);
    const pm = partOf(mb, parts, key);
    pm.tube(V.madd(G, dir, -0.09), tip, 0.0048, 0.0042, M.WOOD, {N: 6});
    pm.ellipsoid(V.madd(tip, dir, 0.004), [0.0145, 0.0145, 0.0145], M.FELT, {N: 10, lat: 6});
    g[key] = {G, fd: dir, pn: [0, -1, 0.1], r: 0.006, pole: [s * 0.7, -1, -0.4]};
  }
  return g;
}

const KINDS = {
  trumpet, mellophone, marching_horn: marchingHorn, horn, trombone,
  euphonium, marching_euphonium: marchingEuphonium, tuba, marching_tuba: marchingTuba, sousaphone,
  piccolo: W.piccolo, flute: W.flute, oboe: W.oboe, bassoon: W.bassoon,
  eb_clarinet: W.ebClarinet, clarinet: W.clarinet, alto_clarinet: W.altoClarinet, bass_clarinet: W.bassClarinet,
  soprano_sax: W.sopranoSax, alto_sax: W.altoSax, tenor_sax: W.tenorSax, baritone_sax: W.baritoneSax,
  snare, tenors,
  bass1: (mb, p) => bassdrum(mb, 0.23, 0.26, p), bass2: (mb, p) => bassdrum(mb, 0.255, 0.28, p), bass3: (mb, p) => bassdrum(mb, 0.28, 0.30, p), bass4: (mb, p) => bassdrum(mb, 0.33, 0.34, p), bass5: (mb, p) => bassdrum(mb, 0.38, 0.38, p),
  cymbals_mid: cymbalsMid, cymbals_high: cymbalsHigh, glockenspiel, xylophone, guard: flag,
};
module.exports = {KINDS, FLAG_G};
