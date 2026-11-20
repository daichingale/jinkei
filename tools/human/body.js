'use strict';
// 人体メッシュ（制服を着た隊員）。素材 ID は materials.js
const {V, Q, ss, lerp} = require('./math');
const S = require('./skeleton');
const M = require('./materials');
const {id: B, W: BW} = S;

const norm = a => { const s = a.reduce((x, y) => x + y[1], 0) || 1; return a.map(([b, w]) => [b, w / s]); };
const bidx = n => B(n);

// ---- 胴体の高さに対する重み（root → spine → chest → neck）----
function spineW(y) {
  const c = [[0.95, 'root'], [1.07, 'spine'], [1.24, 'chest'], [1.42, 'neck']];
  if (y <= c[0][0]) return [[bidx('root'), 1]];
  if (y >= c[3][0]) return [[bidx('neck'), 1]];
  for (let i = 0; i < 3; i++) if (y <= c[i + 1][0]) {
    const t = ss(c[i][0], c[i + 1][0], y);
    return [[bidx(c[i][1]), 1 - t], [bidx(c[i + 1][1]), t]];
  }
}
// 補間テーブル
const interp = (tab, y, key) => {
  // tab: [[y, ...]] を y の降順で並べた配列
  for (let i = 0; i + 1 < tab.length; i++) if (y <= tab[i][0] && y >= tab[i + 1][0]) {
    const t = (tab[i][0] - y) / (tab[i][0] - tab[i + 1][0]);
    return lerp(tab[i][key], tab[i + 1][key], t);
  }
  return y > tab[0][0] ? tab[0][key] : tab[tab.length - 1][key];
};

// 胴の断面（上から下へ）: [y, rx, rz, 中心z, n]
const TORSO = [
  [1.468, 0.0575, 0.0615, 0.004, 2.2], [1.457, 0.062, 0.066, 0.004, 2.2], [1.425, 0.066, 0.070, 0.003, 2.2], [1.412, 0.120, 0.086, 0.0, 2.4], [1.395, 0.182, 0.099, 0.0, 2.6],
  [1.372, 0.200, 0.108, 0.002, 2.7], [1.32, 0.198, 0.113, 0.006, 2.6], [1.26, 0.186, 0.116, 0.010, 2.5], [1.20, 0.173, 0.112, 0.008, 2.4],
  [1.12, 0.158, 0.102, 0.004, 2.3], [1.05, 0.152, 0.097, 0.0, 2.3], [0.98, 0.160, 0.102, -0.002, 2.3], [0.91, 0.168, 0.106, -0.003, 2.3],
  [0.862, 0.172, 0.108, -0.003, 2.3], [0.82, 0.180, 0.113, -0.003, 2.3], [0.79, 0.191, 0.121, -0.003, 2.3], [0.765, 0.200, 0.129, -0.003, 2.3],
];
// 表面の z（前 = +、後 = -）を x, y から求める（サッシュ・ボタン用）
function torsoZ(x, y, front) {
  const rx = interp(TORSO, y, 1), rz = interp(TORSO, y, 2), zc = interp(TORSO, y, 3), n = interp(TORSO, y, 4);
  const k = Math.min(0.999, Math.abs(x) / rx), v = rz * Math.pow(1 - Math.pow(k, n), 1 / n);
  return zc + (front ? v : -v);
}

// 表面の点（x, z）を外向きに off だけ押し出す
function torsoSurf(x, y, front, off) {
  const rx = interp(TORSO, y, 1), rz = interp(TORSO, y, 2), zc = interp(TORSO, y, 3), n = interp(TORSO, y, 4);
  const k = Math.min(0.999, Math.abs(x) / rx), zz = rz * Math.pow(1 - Math.pow(k, n), 1 / n);
  const nx = Math.sign(x) * Math.pow(k, n - 1) / rx, nz = (front ? 1 : -1) * Math.pow(zz / rz, n - 1) / rz, nl = Math.hypot(nx, nz) || 1;
  return [x + nx / nl * off, zc + (front ? zz : -zz) + nz / nl * off];
}
function buildBody(mb) {
  const bi = bidx;
  // ---------- 胴（上着）----------
  {
    const rings = TORSO.map(([y, rx, rz, zc, n]) => ({c: [0, y, 0], rx, rz, oz: zc, n}));
    // 襟（スタンドカラー）と裾の金モール
    const hem = TORSO[TORSO.length - 1];
    rings.push({c: [0, 0.76, 0], rx: hem[1] + 0.002, rz: hem[2] + 0.002, oz: hem[3], n: 2.3});
    rings.push({c: [0, 0.754, 0], rx: hem[1] - 0.012, rz: hem[2] - 0.012, oz: hem[3], n: 2.3});
    mb.loft(rings, {
      N: 28, capE: true, capS: true,
      mat: i => (i === 0 || i >= TORSO.length - 1 ? M.TRIM : M.JACKET),
      wt: (r, p) => {
        const w = spineW(p[1]).map(a => a.slice());
        // 肩まわりは鎖骨にも引かれる
        const k = ss(1.30, 1.39, p[1]) * ss(0.09, 0.19, Math.abs(p[0])) * 0.45;
        if (k > 0) { w.forEach(a => a[1] *= 1 - k); w.push([bi(p[0] > 0 ? 'clavL' : 'clavR'), k]); }
        // 裾の両脇は脚にも少し引かれる（脚を開いても腿が上着を突き抜けない・前も腿に乗り上げる）
        const kh = ss(0.92, 0.80, p[1]) * ss(0.05, 0.14, Math.abs(p[0])) * 0.6;
        if (kh > 0) { w.forEach(a => a[1] *= 1 - kh); w.push([bi(p[0] > 0 ? 'thighL' : 'thighR'), kh]); }
        return norm(w);
      },
    });
  }
  // ---------- 骨盤〜脚つけ根（ズボン）----------
  {
    const rows = [[1.02, 0.130, 0.080, 0.0], [0.97, 0.136, 0.084, -0.003], [0.91, 0.142, 0.086, -0.004], [0.86, 0.146, 0.088, -0.003], [0.81, 0.150, 0.090, -0.002], [0.775, 0.140, 0.088, 0.0], [0.745, 0.095, 0.06, 0.0], [0.735, 0.0, 0.0, 0.0]];
    const rings = rows.map(([y, rx, rz, zc]) => ({c: [0, y, 0], rx, rz, oz: zc, n: 2.3}));
    mb.loft(rings, {
      N: 24, mat: M.PANTS, capS: true,
      wt: (r, p) => {
        const side = p[0] > 0 ? 'L' : 'R', k = ss(0.80, 0.76, p[1]) * ss(0.0, 0.07, Math.abs(p[0])) * 0.85;
        return norm([[bi('root'), 1 - k], [bi('thigh' + side), k]]);
      },
    });
  }
  // ---------- 首 ----------
  {
    const ys = [[1.40, 0.052, 0.056, 0.0], [1.43, 0.049, 0.053, 0.002], [1.47, 0.047, 0.052, 0.008], [1.505, 0.050, 0.056, 0.012]];
    mb.loft(ys.map(([y, rx, rz, zc]) => ({c: [0, y, 0], rx, rz, oz: zc, n: 2.2})), {
      N: 16, mat: M.SKIN, capS: true,
      wt: (r, p) => { const t = ss(1.44, 1.50, p[1]); return norm([[bi('neck'), 1 - t], [bi('head'), t]]); },
    });
  }
  // ---------- 頭 ----------
  const headW = (r, p) => { const t = ss(1.46, 1.50, p[1]); return norm([[bi('head'), 0.4 + 0.6 * t], [bi('neck'), 0.6 * (1 - t)]]); };
  {
    const prof = [[1.462, 0.014, 0.020, 0.062], [1.470, 0.034, 0.048, 0.052], [1.485, 0.054, 0.072, 0.036], [1.505, 0.067, 0.088, 0.018],
      [1.53, 0.074, 0.095, 0.010], [1.56, 0.077, 0.099, 0.008], [1.595, 0.078, 0.101, 0.006], [1.630, 0.076, 0.099, 0.003], [1.665, 0.066, 0.086, 0.0], [1.69, 0.046, 0.062, -0.002], [1.703, 0.0, 0.0, 0]];
    mb.loft(prof.map(([y, rx, rz, zc]) => ({c: [0, y, 0], rx, rz, oz: zc, n: y < 1.5 ? 2.0 : 2.3})), {N: 24, mat: M.SKIN, capS: true, wt: headW});
    const hd = {wt: () => [[bi('head'), 1]]};
    // 鼻・耳・目（白目＋黒目）・眉・口。ひさしの影でも見えるよう、目と眉は少し大きめにする
    mb.ellipsoid([0, 1.542, 0.104], [0.014, 0.025, 0.020], M.SKIN, {axis: V.norm([0, 1, 0.35]), lat: 6, N: 10, ...hd});
    mb.ellipsoid([0, 1.529, 0.112], [0.015, 0.0075, 0.010], M.SKIN, {axis: [0, 0, 1], u: [1, 0, 0], lat: 4, N: 10, ...hd}); // 鼻先
    for (const s of [-1, 1]) {
      mb.ellipsoid([s * 0.0775, 1.562, -0.006], [0.0085, 0.026, 0.017], M.SKIN, {lat: 6, N: 8, ...hd});
      mb.ellipsoid([s * 0.032, 1.577, 0.0975], [0.0135, 0.0092, 0.0045], M.FELT, {axis: [0, 0, 1], u: [1, 0, 0], lat: 5, N: 10, ...hd});
      mb.ellipsoid([s * 0.032, 1.577, 0.1005], [0.0072, 0.0072, 0.0035], M.EYE, {axis: [0, 0, 1], u: [1, 0, 0], lat: 5, N: 10, ...hd});
      mb.ellipsoid([s * 0.034, 1.596, 0.0975], [0.021, 0.0050, 0.0075], M.HAIR, {axis: [0, 0, 1], u: [1, 0, 0], lat: 4, N: 10, ...hd});
    }
    mb.ellipsoid([0, 1.508, 0.091], [0.022, 0.0055, 0.011], M.LIP, {axis: [0, 0, 1], u: [1, 0, 0], lat: 4, N: 10, ...hd});
    // 髪（シャコー帽の下から見える後頭部・耳のまわり・もみあげ）。頭より一回り大きく、後ろへずらして生え際を作る
    const headR = y => { const t = [[1.53, 0.074, 0.095, 0.010], [1.56, 0.077, 0.099, 0.008], [1.595, 0.078, 0.101, 0.006], [1.63, 0.076, 0.099, 0.003], [1.665, 0.066, 0.086, 0.0], [1.69, 0.046, 0.062, -0.002], [1.703, 0.0, 0.0, 0]]; for (let i = 0; i + 1 < t.length; i++) if (y >= t[i][0] && y <= t[i + 1][0]) { const k = (y - t[i][0]) / (t[i + 1][0] - t[i][0]); return [1, 2, 3].map(j => lerp(t[i][j], t[i + 1][j], k)); } return t[t.length - 1].slice(1); };
    const hair = [1.538, 1.552, 1.575, 1.61, 1.65, 1.685, 1.707].map((y, i) => { const [rx, rz, zc] = headR(y), g = i === 0 ? 0.002 : 0.0055; return [y, i === 6 ? 0 : rx + g, i === 6 ? 0 : rz + g, zc - (i === 0 ? 0.004 : 0.016)]; });
    mb.loft(hair.map(([y, rx, rz, zc]) => ({c: [0, y, 0], rx, rz, oz: zc, n: 2.2})), {N: 28, mat: M.HAIR, capS: true, wt: () => [[bi('head'), 1]]});
  }
  // ---------- シャコー帽（紺・金のバンド・黒いひさし・白い羽根）----------
  {
    const hw = () => [[bi('head'), 1]];
    const rows = [[1.620, 0.086, 0.106, 0.004, M.TRIM], [1.641, 0.088, 0.108, 0.004, M.TRIM], [1.648, 0.089, 0.109, 0.004, M.HAT], [1.745, 0.094, 0.114, 0.004, M.HAT], [1.756, 0.094, 0.114, 0.004, M.TRIM], [1.768, 0.094, 0.114, 0.004, M.TRIM],
      [1.775, 0.093, 0.113, 0.004, M.HAT], [1.782, 0.088, 0.108, 0.004, M.HAT], [1.7865, 0.072, 0.09, 0.004, M.HAT], [1.788, 0.0, 0.0, 0.004, M.HAT]];
    mb.loft(rows.map(([y, rx, rz, zc]) => ({c: [0, y, 0], rx, rz, oz: zc, n: 2.5})), {N: 28, mat: i => rows[i + 1][4], capS: true, wt: hw});
    // ひさし
    const rx = 0.088, rz = 0.108, zc = 0.004;
    mb.grid(20, 3, (u, v) => {
      const a = (u - 0.5) * 2 * 1.35, s = Math.sin(a), c = Math.cos(a), x = rx * s, z = zc + rz * c;
      const nx = x / (rx * rx), nz = (z - zc) / (rz * rz), nl = Math.hypot(nx, nz), len = 0.055 * Math.pow(Math.max(0, Math.cos(a * 0.9)), 0.8) * v;
      return [x + nx / nl * len, 1.627 - 0.012 * v * v - 0.004 * v, z + nz / nl * len];
    }, M.BRIM, {double: true, wt: hw});
    // 帽章（金）と羽根の根もと
    mb.ellipsoid([0, 1.70, 0.117], [0.022, 0.026, 0.008], M.TRIM, {axis: [0, 0, 1], u: [1, 0, 0], lat: 6, N: 10, wt: hw});
    mb.tube([0, 1.784, 0.045], [0, 1.802, 0.045], 0.016, 0.013, M.TRIM, {wt: hw});
    mb.sweep([[0, 1.800, 0.045], [0, 1.86, 0.050], [0, 1.95, 0.052], [0, 2.03, 0.044]], s => [0.030 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.6) + 0.002, 0.020 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.6) + 0.002], M.PLUME, {N: 10, sub: 6, wt: hw, smooth: true});
    // あご紐（黒い細い帯）
    for (const s of [-1, 1]) mb.tube([s * 0.080, 1.60, 0.03], [s * 0.040, 1.472, 0.07], 0.003, 0.003, M.LEATHER, {N: 5, wt: hw});
  }
  // ---------- 腕 ----------
  for (const sd of [1, -1]) {
    const L = sd > 0 ? 'L' : 'R', mx = v => [v[0] * sd, v[1], v[2]];
    const S0 = mx(S.SH), E = mx(S.ELB), Wr = mx(S.WRI), tU = V.norm(V.sub(E, S0)), tF = V.norm(V.sub(Wr, E));
    const pointAt = s => (s <= S.LU ? V.madd(S0, tU, s) : V.madd(E, tF, s - S.LU));
    const tanAt = s => { const k = ss(S.LU - 0.03, S.LU + 0.03, s); return V.norm(V.lerp(tU, tF, k)); };
    const frame = t => { const u = V.norm(V.sub([1, 0, 0], V.mul(t, t[0]))), w = V.cross(t, u); return [u, w]; };
    const wArm = s => {
      const w = [];
      const cap = ss(0.12, -0.02, s); // 肩口は胴にも引かれる
      const uw = 1 - ss(S.LU - 0.05, S.LU + 0.05, s), fw = ss(S.LU - 0.05, S.LU + 0.05, s) * (1 - ss(S.LU + S.LF - 0.05, S.LU + S.LF + 0.01, s)), hw = ss(S.LU + S.LF - 0.05, S.LU + S.LF + 0.01, s);
      w.push([bi('upperArm' + L), uw * (1 - 0.5 * cap)], [bi('clav' + L), uw * 0.28 * cap], [bi('chest'), uw * 0.22 * cap], [bi('foreArm' + L), fw], [bi('hand' + L), hw]);
      return norm(w.filter(a => a[1] > 0));
    };
    // 袖
    const tab = [[-0.060, 0.0, 0.0], [-0.052, 0.028, 0.028], [-0.036, 0.046, 0.046], [-0.016, 0.056, 0.056], [0.01, 0.060, 0.058], [0.07, 0.058, 0.056], [0.15, 0.054, 0.052], [0.23, 0.050, 0.049], [0.30, 0.049, 0.048], [0.34, 0.050, 0.049], [0.40, 0.048, 0.046], [0.46, 0.044, 0.042], [0.50, 0.041, 0.040], [0.525, 0.040, 0.039], [0.545, 0.0405, 0.0395]];
    const rings = tab.map(([s, rx, rz]) => {
      const t = tanAt(s), [u, w] = frame(t), c = s < 0 ? V.madd(S0, tU, s) : pointAt(s);
      return {c, u, w, rx, rz, n: 2.1, s, wt: wArm(s)};
    });
    // 金のカフス（袖口）
    rings.push({...rings[rings.length - 1], c: pointAt(0.552), rx: 0.0415, rz: 0.0405, wt: wArm(0.552)});
    rings.push({...rings[rings.length - 1], c: pointAt(0.553), rx: 0.031, rz: 0.031, wt: wArm(0.553)});
    mb.loft(rings, {N: 16, capS: false, capE: true, mat: i => (i >= 12 ? M.TRIM : M.JACKET), wt: r => r.wt});
    // 肩章（金）
    mb.ellipsoid(V.add(S0, [sd * 0.002, 0.048, 0]), [0.050, 0.009, 0.046], M.TRIM, {axis: [0, 1, 0], lat: 4, N: 12, wt: () => wArm(-0.02)});
    // 手袋（白）: 手首〜手のひら〜指。指は少し曲げた形
    const tH = V.norm(mx(S.dirH)), pn = [-sd, 0, 0];
    const hu = V.norm(V.sub(pn, V.mul(tH, V.dot(pn, tH)))), hw2 = V.cross(tH, V.mul(hu, -1));
    const wrist = Wr;
    const htab = [[-0.045, 0.029, 0.031], [-0.005, 0.0285, 0.0315], [0.02, 0.0245, 0.033], [0.05, 0.0210, 0.037], [0.085, 0.0220, 0.039], [0.115, 0.0220, 0.037], [0.15, 0.0185, 0.034], [0.178, 0.0135, 0.028], [0.19, 0.006, 0.016], [0.195, 0.0, 0.0]];
    const hr = htab.map(([s, rx, rz]) => {
      const curl = 0.055 * Math.pow(Math.max(0, s) / 0.19, 2.2);
      const t = V.norm(V.madd(tH, pn, 0.55 * Math.pow(Math.max(0, s) / 0.19, 1.2)));
      const c = V.madd(V.madd(wrist, tH, s), pn, curl);
      const u = V.norm(V.sub(pn, V.mul(t, V.dot(pn, t)))), w = V.cross(u, t);
      return {c, u, w, rx, rz, n: 2.3, wt: norm([[bi('foreArm' + L), 1 - ss(-0.03, 0.02, s)], [bi('hand' + L), ss(-0.03, 0.02, s)]])};
    });
    mb.loft(hr, {N: 14, mat: M.GLOVE, capS: false, wt: r => r.wt});
    // 親指（手のひらの前側）
    const t0 = V.madd(V.madd(V.madd(wrist, tH, 0.04), [0, 0, 1], 0.026), pn, 0.012), td = V.norm(V.add(V.mul(tH, 0.9), V.add(V.mul(pn, 0.22), [0, 0, 0.12])));
    mb.sweep([t0, V.madd(t0, td, 0.03), V.madd(t0, V.norm(V.add(td, V.mul(pn, 0.5))), 0.065)], s => 0.0125 - 0.004 * s, M.GLOVE, {N: 8, sub: 4, wt: () => [[bi('hand' + L), 1]]});
  }
  // ---------- 脚（ズボン）と靴 ----------
  for (const sd of [1, -1]) {
    const L = sd > 0 ? 'L' : 'R', X = S.LX * sd - 0.002 * sd;
    const tab = [[0.96, 0.0, 0.0, 0], [0.952, 0.045, 0.045, 0], [0.925, 0.050, 0.055, -0.004], [0.89, 0.056, 0.064, -0.006], [0.85, 0.060, 0.070, -0.006], [0.80, 0.062, 0.072, -0.005], [0.76, 0.064, 0.077, -0.004], [0.71, 0.072, 0.085, -0.002], [0.66, 0.070, 0.076, 0.002],
      [0.57, 0.061, 0.066, 0.004], [0.50, 0.057, 0.062, 0.002], [0.44, 0.057, 0.065, -0.006], [0.37, 0.056, 0.064, -0.012], [0.30, 0.051, 0.057, -0.010], [0.22, 0.045, 0.049, -0.006], [0.15, 0.042, 0.046, -0.002], [0.115, 0.043, 0.048, 0.0], [0.088, 0.046, 0.052, 0.002], [0.083, 0.037, 0.044, 0.0]];
    const rings = tab.map(([y, rx, rz, zc]) => ({c: [X, y, 0], rx: rx * 1.07, rz: rz * 1.07, oz: zc, n: 2.2}));
    mb.loft(rings, {
      N: 18, mat: M.PANTS, capS: false, capE: true,
      wt: (r, p) => {
        const y = p[1], rootW = ss(0.84, 1.0, y) * 0.55, shinW = ss(0.56, 0.44, y), footW = ss(0.16, 0.088, y) * 0.8;
        const th = (1 - rootW) * (1 - shinW);
        return norm([[bi('root'), rootW], [bi('thigh' + L), th], [bi('shin' + L), (1 - rootW) * shinW * (1 - footW)], [bi('foot' + L), (1 - rootW) * shinW * footW]]);
      },
    });
    // 靴（黒・エナメル）。前後方向（+z）に断面を並べる
    const shoe = [[-0.078, 0.030, 0.034, 0.052], [-0.062, 0.038, 0.047, 0.057], [-0.03, 0.043, 0.058, 0.066], [0.0, 0.045, 0.056, 0.064], [0.04, 0.046, 0.048, 0.055], [0.09, 0.048, 0.040, 0.042], [0.14, 0.050, 0.032, 0.034], [0.19, 0.045, 0.025, 0.027], [0.225, 0.034, 0.018, 0.02], [0.24, 0.018, 0.010, 0.014], [0.2455, 0.0, 0.0, 0.012]];
    const sr = shoe.map(([z, rx, ry, cy]) => ({c: [X, cy, z], u: [1, 0, 0], w: [0, 1, 0], rx, rz: ry, n: 2.6}));
    mb.loft(sr, {
      N: 20, mat: M.SHOE, capS: true,
      wt: (r, p) => {
        const z = p[2], tw = ss(0.105, 0.175, z), up = ss(0.085, 0.12, p[1]) * ss(0.02, -0.04, z) * 0.6;
        return norm([[bi('foot' + L), (1 - tw) * (1 - up)], [bi('toe' + L), tw], [bi('shin' + L), (1 - tw) * up]]);
      },
    });
  }
  // ---------- 白いクロスベルト（胸と背中に X）と金ボタン ----------
  {
    const sw = (x, y) => { const w = spineW(y); const k = ss(1.30, 1.39, y) * ss(0.09, 0.19, Math.abs(x)) * 0.45; const r = w.map(a => [a[0], a[1] * (1 - k)]); if (k > 0) r.push([bi(x > 0 ? 'clavL' : 'clavR'), k]); return norm(r); };
    for (const front of [true, false]) for (const dirn of [1, -1]) {
      const x0 = 0.115 * dirn, x1 = -0.15 * dirn, y0 = 1.392, y1 = 1.03;
      mb.grid(30, 2, (u, v) => {
        const xc = lerp(x0, x1, u), yc = lerp(y0, y1, u), dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), off = (v - 0.5) * 0.050;
        const x = xc + (-dy / l) * off, y = yc + (dx / l) * off;
        const xx = Math.max(-0.185, Math.min(0.185, x)), [px, pz] = torsoSurf(xx, y, front, 0.005);
        return [px, y, pz];
      }, M.SASH, {nz: front ? 1 : -1, wt: p => sw(p[0], p[1])});
    }
    // ボタン
    for (let k = 0; k < 6; k++) {
      const y = 1.355 - k * 0.058, z = torsoZ(0, y, true) + 0.002;
      mb.ellipsoid([0, y, z], [0.0085, 0.0085, 0.005], M.TRIM, {axis: [0, 0, 1], u: [1, 0, 0], lat: 4, N: 8, wt: () => sw(0, y)});
    }
  }
}
module.exports = {buildBody, spineW, torsoZ, TORSO, torsoSurf, interp};
