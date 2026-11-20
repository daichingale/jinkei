'use strict';
// ポーズ・歩行の焼き込み。IK（2関節）で腕と脚を解き、各ボーンの局所回転（クォータニオン）にして出力する
const {V, Q, frameFU, ss, clamp, lerp} = require('./math');
const S = require('./skeleton');
const B = S.id;

const LOWER = ['root', 'spine', 'chest', 'neck', 'head', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'toeL', 'toeR'];
const UPPER = ['clavL', 'clavR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR', 'prop'];

const newPose = () => S.bones.map(b => ({p: b.pos.slice(), q: Q.id()}));
const clonePose = p => p.map(b => ({p: b.p.slice(), q: b.q.slice()}));
const Qx = a => Q.axis([1, 0, 0], a), Qy = a => Q.axis([0, 1, 0], a), Qz = a => Q.axis([0, 0, 1], a);

// ---- 足 ----
// 足の向き: yaw（つま先を開く）・pitch（正でつま先が下がる）
function footFrame(yaw, pitch) {
  const q = Q.mul(Qy(yaw), Qx(pitch));
  return {f: Q.rot(q, [0, 0, 1]), u: Q.rot(q, [0, 1, 0])};
}
// 靴底の点（足首からの相対）。つま先側は母趾球まわりに toe 回転する
const HEEL = [0, -0.083, -0.07], BALL = [0, -0.077, 0.145], TIP = [0, -0.073, 0.243], BALLJ = [0, -0.051, 0.145];
function groundAnkleY(ff, toe) {
  const [x, y, z] = frameFU(ff.f, ff.u), R = v => V.add(V.add(V.mul(x, v[0]), V.mul(y, v[1])), V.mul(z, v[2]));
  const tip = V.add(BALLJ, Q.rot(Qx(toe || 0), V.sub(TIP, BALLJ)));
  const ball = V.add(BALLJ, Q.rot(Qx(toe || 0), V.sub(BALL, BALLJ)));
  let m = -1e9;
  for (const p of [HEEL, ball, tip]) m = Math.max(m, -R(p)[1]);
  return m + 0.002;
}

// 脚の解法。rootP: ルート位置、target: {ankle, pole, ff（足の向き）, toe} または {thighDir, shinDir, ff, toe}
function solveLeg(pose, side, rootP, t) {
  const L = side > 0 ? 'L' : 'R', th = S.bones[B('thigh' + L)];
  const hip = V.add(rootP, th.pos), T = S.THIGH, Sh = S.SHIN;
  let knee, ankle;
  if (t.thighDir) {
    knee = V.madd(hip, V.norm(t.thighDir), T); ankle = V.madd(knee, V.norm(t.shinDir), Sh);
  } else {
    const d = V.sub(t.ankle, hip), dist0 = V.len(d), dn = V.mul(d, 1 / dist0);
    const dist = Math.min(dist0, (T + Sh) * 0.9995), a = (T * T - Sh * Sh + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, T * T - a * a));
    const pole = t.pole || [side * 0.12, 0, 1], pv = V.norm(V.sub(pole, V.mul(dn, V.dot(pole, dn))));
    knee = V.add(V.madd(hip, dn, a), V.mul(pv, h)); ankle = V.madd(hip, dn, dist);
  }
  const qT = Q.arc([0, -1, 0], V.sub(knee, hip));
  const qS = Q.mul(Q.arc(Q.rot(qT, [0, -1, 0]), V.sub(ankle, knee)), qT);
  pose[B('thigh' + L)].q = qT; pose[B('shin' + L)].q = Q.mul(Q.inv(qT), qS);
  const [x, y, z] = frameFU(t.ff.f, t.ff.u), qF = Q.fromBasis(x, y, z);
  pose[B('foot' + L)].q = Q.mul(Q.inv(qS), qF);
  pose[B('toe' + L)].q = Qx(t.toe || 0);
  const kd = V.sub(knee, hip);
  return {hip, knee, ankle, thighAngle: Math.atan2(kd[2], -kd[1]), kneeFlex: Math.acos(clamp(V.dot(V.norm(V.sub(knee, hip)), V.norm(V.sub(ankle, knee))), -1, 1))};
}

// 体幹の前傾（スパイン・胸）と、頭の補正
function setLean(pose, lean, twist = 0) {
  pose[B('spine')].q = Q.mul(Qy(twist * 0.5), Qx(lean * 0.5));
  pose[B('chest')].q = Q.mul(Qy(twist * 0.5), Qx(lean * 0.5));
  pose[B('neck')].q = Qx(-lean * 0.45); pose[B('head')].q = Qx(-lean * 0.45);
}

// ---- 立ち姿勢 ----
const FW = [0, 0, 1];
function stance(name) {
  const g = 0, pose = newPose();
  const fl = (yaw, pitch = 0) => footFrame(yaw, pitch);
  const flat = (yaw, pitch = 0, toe = 0) => { const ff = fl(yaw, pitch); return {ff, y: groundAnkleY(ff, toe), toe}; };
  let hipY = 0.93, lean = 0, rootX = 0, rootZ = 0, legs;
  const stand = (ax, az, yaw, h, pole) => {
    const a = flat(yaw), b = flat(-yaw);
    return {R: {ankle: [-ax, a.y, az], ff: fl(-yaw), pole}, L: {ankle: [ax, a.y, az], ff: fl(yaw), pole}};
  };
  switch (name) {
    case 'attention': hipY = 0.935; legs = stand(0.055, 0, 0.35); break;
    case 'rest': hipY = 0.93; legs = stand(0.18, 0, 0.22); break;
    case 'wide': {
      hipY = 0.895; legs = stand(0.30, 0, 0.4); legs.R.pole = [-0.45, 0, 1]; legs.L.pole = [0.45, 0, 1]; break;
    }
    case 'cross': {
      hipY = 0.92; rootX = 0.035;
      const f = flat(0.1);
      legs = {R: {ankle: [0.185, f.y, 0.15], ff: fl(-0.15), pole: [0.3, 0, 1]}, L: {ankle: [0.115, f.y, -0.06], ff: fl(0.35), pole: FW}};
      break;
    }
    case 'kneel': case 'kneel2': {
      const two = name === 'kneel2';
      hipY = 0.505; lean = 0.04;
      const kneeY = 0.072, ky = kneeY + 0.0;
      const back = x => ({thighDir: [0, -1, 0.04], shinDir: [0, 0.0, -1], ff: {f: [0, 0, -1], u: [0, -1, 0]}, toe: 0, kneeY: ky});
      legs = {R: back(-0.1), L: two ? back(0.1) : {ankle: [0.095, groundAnkleY(fl(0.1), 0), 0.40], ff: fl(0.1), pole: [0.1, 0, 1]}};
      // 膝が床に付くよう、腿の向きを腰の高さから決める
      for (const k of ['R', 'L']) if (legs[k].thighDir) {
        const hipP = [k === 'L' ? 0.095 : -0.095, hipY - 0.02, 0];
        legs[k].thighDir = V.norm([0, -(hipP[1] - kneeY), 0.03]);
      }
      break;
    }
    case 'lunge': {
      lean = 0.12; rootZ = 0.12; hipY = 0.575;
      const fb = fl(-0.1, 0.75), by = groundAnkleY(fb, 0.0), ff = fl(0.1), fy = groundAnkleY(ff, 0);
      legs = {R: {ankle: [-0.095, by, -0.62], ff: fb, pole: FW}, L: {ankle: [0.095, fy, 0.52], ff, pole: FW}};
      break;
    }
    case 'crouch': {
      hipY = 0.56; lean = 0.38;
      const f = flat(0.3);
      legs = {R: {ankle: [-0.14, f.y, 0.1], ff: fl(-0.3), pole: [-0.15, 0, 1]}, L: {ankle: [0.14, f.y, 0.1], ff: fl(0.3), pole: [0.15, 0, 1]}};
      rootZ = -0.02; break;
    }
    case 'toe': {
      const ff = fl(0.2, 0.95), y = groundAnkleY(ff, 0), ffR = fl(-0.2, 0.95);
      legs = {R: {ankle: [-0.06, y, 0], ff: ffR}, L: {ankle: [0.06, y, 0], ff}};
      hipY = y + 0.838; break;
    }
    default: throw new Error('stance ' + name);
  }
  if (!['kneel', 'kneel2', 'lunge', 'wide', 'crouch', 'cross'].includes(name) && legs.R.ankle) {
    hipY = Math.min(hipY, legs.R.ankle[1] + 0.84);
  }
  const rootP = [rootX, hipY + 0.02, rootZ];
  pose[0].p = rootP;
  setLean(pose, lean);
  const info = {};
  for (const [k, side] of [['R', -1], ['L', 1]]) info[k] = solveLeg(pose, side, rootP, legs[k]);
  return {pose, info};
}

// ---- 歩行サイクル ----
const ST = 0.55, N_FRAMES = 20;
const GAITS = {
  glide: {vault: 0.9, drop: 0.0, bob: 0.006, clear: 0.045, lean: 0.02, strike: -0.32, off: 0.5, swingToe: 0.0, markTh: 0.62, zb: 0.07},
  jazz: {vault: 0.35, drop: 0.07, bob: 0.032, clear: 0.10, lean: 0.12, strike: -0.15, off: 0.35, swingToe: 0.25, markTh: 0.50, zb: 0.05},
  high: {vault: 0.7, drop: 0.0, bob: 0.014, clear: 0.0, lean: 0.0, strike: -0.12, off: 0.5, swingToe: 0.5, thMax: 1.40, markTh: 1.40, zb: 0.04},
  back: {vault: 0.9, drop: 0.02, bob: 0.01, clear: 0.05, lean: 0.0, strike: 0.38, off: -0.15, swingToe: 0.1, markTh: 0.62, zb: 0.07},
  // 横歩き（スライド）: 上半身は正面のまま脚だけ横へ。slideL = 体の左（+x）へ、slideR = 右（-x）へ。
  // 遊脚は交互に体の前・後ろを通ってクロスする（キャリオカ）。歩幅は横方向の1カウントあたりの移動量
  slideL: {vault: 0.9, drop: 0.0, bob: 0.008, clear: 0.07, lean: 0.0, strike: 0.0, off: 0.1, swingToe: 0.1, markTh: 0.62, zb: 0.03, lat: 1},
  slideR: {vault: 0.9, drop: 0.0, bob: 0.008, clear: 0.07, lean: 0.0, strike: 0.0, off: 0.1, swingToe: 0.1, markTh: 0.62, zb: 0.03, lat: -1},
};
function gaitTargets(gt, g, L, ph, clear) {
  const strideAbs = Math.abs(L), kscale = clamp(strideAbs / 0.4, 0, 1);
  const strike = g.strike * kscale * Math.sign(L || 1), off = g.off * kscale * (L < 0 ? 1 : 1);
  let z, pitch, lift = 0;
  const zh = L * ST;
  if (ph < ST) {
    const s = ph / ST; z = zh - 2 * zh * s;
    pitch = s < 0.3 ? lerp(strike, 0, ss(0, 0.3, s)) : s > 0.62 ? lerp(0, off, ss(0.62, 1, s)) : 0;
  } else {
    const u = (ph - ST) / (1 - ST), e = u * u * (3 - 2 * u);
    z = strideAbs < 0.01 ? g.zb * Math.sin(Math.PI * u) : -zh + 2 * zh * e;
    pitch = lerp(off, strike, ss(0.25, 1, u)) + g.swingToe * Math.sin(Math.PI * u);
    lift = clear * Math.pow(Math.sin(Math.PI * u), 0.9);
  }
  const ff = footFrame(0, pitch), y = groundAnkleY(ff, 0) + lift;
  return {z, y, ff, pitch};
}
function legPeak(g, L, clear, hipY) {
  let mx = 0;
  for (let k = 0; k <= 24; k++) {
    const ph = ST + (1 - ST) * k / 24, t = gaitTargets(null, g, L, ph, clear);
    const hip = [0, hipY - 0.02, 0], d = V.sub([0, t.y, t.z], hip), dist = Math.min(V.len(d), (S.THIGH + S.SHIN) * 0.9995), dn = V.mul(d, 1 / V.len(d));
    const a = (S.THIGH ** 2 - S.SHIN ** 2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, S.THIGH ** 2 - a * a)), pv = V.norm(V.sub([0, 0, 1], V.mul(dn, dn[2])));
    const knee = V.add(V.madd(hip, dn, a), V.mul(pv, h)), kd = V.sub(knee, hip);
    mx = Math.max(mx, Math.atan2(kd[2], -kd[1]));
  }
  return mx;
}
// 歩幅 L（m / 1カウント、負なら後ろ向き）の1サイクル（2カウント）を N_FRAMES 枚のポーズにする
function walkCycle(type, L) {
  const g = GAITS[type], Lmax = (S.THIGH + S.SHIN) * 0.985;
  if (g.lat) L = Math.abs(L) * g.lat;
  // 腰の高さ: 接地している足が届く範囲の最小値（水平に保つ）
  let hipMin = 9, targets = [];
  let clear = g.clear;
  const hipGuess = 0.88;
  if (g.thMax !== undefined || Math.abs(L) < 0.01) {
    const want = Math.abs(L) < 0.01 ? g.markTh : g.thMax;
    let lo = 0, hi = 0.7;
    for (let it = 0; it < 28; it++) { const mid = (lo + hi) / 2; if (legPeak(g, L, mid, hipGuess - g.drop) < want) lo = mid; else hi = mid; }
    clear = (lo + hi) / 2;
  }
  for (let k = 0; k < N_FRAMES; k++) {
    const ph = k / N_FRAMES, tR = gaitTargets(null, g, L, ph % 1, clear), tL = gaitTargets(null, g, L, (ph + ST) % 1, clear);
    targets.push({R: tR, L: tL, phR: ph % 1, phL: (ph + ST) % 1});
    let need = 9;
    for (const [t, p] of [[tR, ph % 1], [tL, (ph + ST) % 1]]) if (p < ST) need = Math.min(need, t.y + Math.sqrt(Math.max(0.01, Lmax * Lmax - t.z * t.z)));
    targets[targets.length - 1].need = need; hipMin = Math.min(hipMin, need);
  }
  const frames = [], stats = {maxThigh: 0, minHip: 9};
  for (let k = 0; k < N_FRAMES; k++) {
    const pose = newPose(), ph = k / N_FRAMES, tg = targets[k];
    const bob = g.bob * 0.5 * (1 - Math.cos(4 * Math.PI * ph));
    const hipY = lerp(hipMin, tg.need, g.vault) - g.drop + bob * 0.5 - 0.004;
    const rootP = [0, hipY + 0.02, 0];
    pose[0].p = rootP;
    const lean = g.lean * (Math.abs(L) < 0.01 ? 0.6 : 1);
    setLean(pose, lean, g.lat ? 0 : 0.045 * Math.sin(2 * Math.PI * ph));
    for (const [key, side] of [['R', -1], ['L', 1]]) {
      const t = tg[key], toe = 0;
      let ax = side * (S.LX - 0.005), az = t.z;
      if (g.lat) {
        // 横歩き: 足は x 方向に動く。遊脚は R が体の前、L が後ろを通る
        const p = key === 'R' ? tg.phR : tg.phL, u = p < ST ? -1 : (p - ST) / (1 - ST);
        ax += t.z; az = u < 0 ? 0 : (key === 'R' ? 1 : -1) * 0.10 * Math.sin(Math.PI * u);
      }
      const r = solveLeg(pose, side, rootP, {ankle: [ax, t.y, az], ff: t.ff, pole: [side * 0.05, 0, 1], toe});
      stats.maxThigh = Math.max(stats.maxThigh, r.thighAngle);
    }
    stats.minHip = Math.min(stats.minHip, hipY);
    frames.push(pose);
  }
  stats.clear = clear;
  return {frames, stats};
}

// ---- 腕 ----
// 肩から手首までの IK。target: {wrist, fd（指の向き）, pn（手のひらの法線）, pole, clav}
function solveArm(pose, side, t) {
  const L = side > 0 ? 'L' : 'R';
  const cl = S.bones[B('clav' + L)], ua = S.bones[B('upperArm' + L)];
  const cq = Qz(side * (t.clav || 0));
  const clavW = V.add(S.bones[B('chest')].world, cl.pos);
  const sh = V.add(clavW, Q.rot(cq, ua.pos));
  const mx = v => [v[0] * side, v[1], v[2]];
  const dU = V.norm(mx(S.dirU)), dF = V.norm(mx(S.dirF)), dH = V.norm(mx(S.dirH));
  const d = V.sub(t.wrist, sh), dist0 = V.len(d), dn = V.mul(d, 1 / dist0), A = S.LU, Bf = S.LF;
  const dist = Math.min(dist0, (A + Bf) * 0.9995), a = (A * A - Bf * Bf + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, A * A - a * a));
  const pole = t.pole || [side * 0.35, -1, -0.25], pv = V.norm(V.sub(pole, V.mul(dn, V.dot(pole, dn))));
  const elbow = V.add(V.madd(sh, dn, a), V.mul(pv, h)), wrist = V.madd(sh, dn, dist);
  const qU = Q.arc(dU, V.sub(elbow, sh));
  const qF = Q.mul(Q.arc(Q.rot(qU, dF), V.sub(wrist, elbow)), qU);
  const pn0 = [-side, 0, 0];
  const R0 = frameFU(dH, pn0), Rd = frameFU(t.fd, t.pn);
  const qH = Q.mul(Q.fromBasis(...Rd), Q.inv(Q.fromBasis(...R0)));
  pose[B('clav' + L)].q = cq;
  pose[B('upperArm' + L)].q = Q.mul(Q.inv(cq), qU);
  pose[B('foreArm' + L)].q = Q.mul(Q.inv(qU), qF);
  pose[B('hand' + L)].q = Q.mul(Q.inv(qF), qH);
  return {elbow, wrist, reach: dist0 / (A + Bf), short: dist0 - dist};
}
// 握り（grip）→ 手首の位置。G: 物の軸上の点、fd: 指の向き、pn: 手のひらから物へ向かう向き、r: 物の半径
function gripToWrist(gr) {
  const fd = V.norm(gr.fd), pn = V.norm(gr.pn);
  const palm = V.madd(gr.G, pn, -((gr.r || 0.012) + 0.017));
  return {wrist: V.add(V.madd(palm, fd, -0.07), V.mul(pn, -0.006)), fd, pn};
}
// 小道具の変換 T = {pivot, q, shift}。世界点 → 変換後の世界点
const applyT = (T, p) => (T ? V.add(V.add(T.pivot, Q.rot(T.q, V.sub(p, T.pivot))), T.shift || [0, 0, 0]) : p);
const applyTd = (T, d) => (T ? Q.rot(T.q, d) : d);
// 小道具ボーンの局所変換（親は胸＝静止姿勢）
function setProp(pose, T) {
  const bone = S.bones[B('prop')], par = S.bones[B('chest')];
  if (!T) { pose[B('prop')].p = bone.pos.slice(); pose[B('prop')].q = Q.id(); return; }
  const Bp = bone.world, q = T.q;
  // world = pivot + q*(v - pivot) + shift,  v_local = v - Bp  →  p_loc = pivot - q*pivot + shift + q*Bp - chestOrigin
  const pl = V.sub(V.add(V.add(T.pivot, V.mul(Q.rot(q, T.pivot), -1)), V.add(T.shift || [0, 0, 0], Q.rot(q, Bp))), par.world);
  pose[B('prop')].p = pl; pose[B('prop')].q = q.slice();
}

function pickBones(pose, names) { return names.map(n => pose[B(n)]); }
module.exports = {LOWER, UPPER, newPose, clonePose, Qx, Qy, Qz, solveLeg, solveArm, setLean, stance, walkCycle, GAITS, N_FRAMES, gripToWrist, applyT, applyTd, setProp, pickBones, footFrame, groundAnkleY};
