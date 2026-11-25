'use strict';
// イラスト（look illust）の人体: 白いTシャツ・黒い細身のパンツ・スニーカー・腕の色スリーブ・アニメ調の顔。
// 骨格・スキニングは制服（body.js）と同じ。髪は頭の骨に付く別メッシュ（hair.js。リアルと共通）、顔は顔テクスチャ（face.js）。
const {V, ss, lerp} = require('./math');
const S = require('./skeleton');
const M = require('./materials');
const {TORSO, spineW, interp} = require('./body');
const F = require('./face');
const {id: B} = S;

const norm = a => { const s = a.reduce((x, y) => x + y[1], 0) || 1; return a.map(([b, w]) => [b, w / s]); };
const bi = B;

const HEAD_Y = 1.51; // head ボーンの静止位置の高さ

function buildIllust(mb) {
  // ---------- 胴（白いTシャツ。首まわりは肌）----------
  {
    const top = TORSO.findIndex(r => r[0] <= 1.412), hemY = 0.86;
    const rows = TORSO.slice(0, top - 1).concat(TORSO.filter(r => r[0] <= 1.425 && r[0] >= hemY - 0.0001));
    const rings = rows.map(([y, rx, rz, zc, n]) => ({c: [0, y, 0], rx, rz, oz: zc, n}));
    const hem = rows[rows.length - 1];
    rings.push({c: [0, hemY - 0.012, 0], rx: hem[1] + 0.002, rz: hem[2] + 0.002, oz: hem[3], n: 2.3});
    rings.push({c: [0, hemY - 0.016, 0], rx: hem[1] - 0.01, rz: hem[2] - 0.01, oz: hem[3], n: 2.3});
    const neckN = rows.filter(r => r[0] >= 1.425).length; // 首のリング数
    mb.loft(rings, {
      N: 28, capE: true, capS: true,
      mat: i => (i < neckN - 1 ? M.SKIN : M.TSHIRT),
      wt: (r, p) => {
        const w = spineW(p[1]).map(a => a.slice());
        const k = ss(1.30, 1.39, p[1]) * ss(0.09, 0.19, Math.abs(p[0])) * 0.45;
        if (k > 0) { w.forEach(a => a[1] *= 1 - k); w.push([bi(p[0] > 0 ? 'clavL' : 'clavR'), k]); }
        const kh = ss(0.92, 0.80, p[1]) * ss(0.05, 0.14, Math.abs(p[0])) * 0.6;
        if (kh > 0) { w.forEach(a => a[1] *= 1 - kh); w.push([bi(p[0] > 0 ? 'thighL' : 'thighR'), kh]); }
        return norm(w);
      },
    });
  }
  // ---------- 骨盤〜脚つけ根（パンツ）----------
  {
    const rows = [[0.90, 0.142, 0.086, -0.004], [0.86, 0.146, 0.088, -0.003], [0.81, 0.150, 0.090, -0.002], [0.775, 0.140, 0.088, 0.0], [0.745, 0.095, 0.06, 0.0], [0.735, 0.0, 0.0, 0.0]];
    mb.loft(rows.map(([y, rx, rz, zc]) => ({c: [0, y, 0], rx, rz, oz: zc, n: 2.3})), {
      N: 24, mat: M.IPANTS, capS: true,
      wt: (r, p) => { const side = p[0] > 0 ? 'L' : 'R', k = ss(0.80, 0.76, p[1]) * ss(0.0, 0.07, Math.abs(p[0])) * 0.85; return norm([[bi('root'), 1 - k], [bi('thigh' + side), k]]); },
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
  // ---------- 頭（顔は顔テクスチャ。リアルと同じ形）----------
  {
    const headW = (r, p) => { const t = ss(1.46, 1.50, p[1]); return norm([[bi('head'), 0.4 + 0.6 * t], [bi('neck'), 0.6 * (1 - t)]]); };
    const from = mb.P.length;
    mb.loft(F.headRings().map(r => ({...r})), {N: 36, mat: M.SKIN, capS: true, capE: true, wt: headW});
    const hd = {wt: () => [[bi('head'), 1]]};
    for (const s of [-1, 1]) mb.ellipsoid([s * 0.0795, 1.560, -0.006], [0.0085, 0.024, 0.016], M.SKIN, {lat: 6, N: 8, ...hd});
    F.scaleHeadVerts(mb, from, mb.P.length);
  }
  // ---------- 腕（半袖Tシャツ → 肌 → 色スリーブ → 手）----------
  for (const sd of [1, -1]) {
    const L = sd > 0 ? 'L' : 'R', mx = v => [v[0] * sd, v[1], v[2]];
    const S0 = mx(S.SH), E = mx(S.ELB), Wr = mx(S.WRI), tU = V.norm(V.sub(E, S0)), tF = V.norm(V.sub(Wr, E));
    const pointAt = s => (s <= S.LU ? V.madd(S0, tU, s) : V.madd(E, tF, s - S.LU));
    const tanAt = s => { const k = ss(S.LU - 0.03, S.LU + 0.03, s); return V.norm(V.lerp(tU, tF, k)); };
    const frame = t => { const u = V.norm(V.sub([1, 0, 0], V.mul(t, t[0]))), w = V.cross(t, u); return [u, w]; };
    const wArm = s => {
      const w = [];
      const cap = ss(0.12, -0.02, s);
      const uw = 1 - ss(S.LU - 0.05, S.LU + 0.05, s), fw = ss(S.LU - 0.05, S.LU + 0.05, s) * (1 - ss(S.LU + S.LF - 0.05, S.LU + S.LF + 0.01, s)), hw = ss(S.LU + S.LF - 0.05, S.LU + S.LF + 0.01, s);
      w.push([bi('upperArm' + L), uw * (1 - 0.5 * cap)], [bi('clav' + L), uw * 0.28 * cap], [bi('chest'), uw * 0.22 * cap], [bi('foreArm' + L), fw], [bi('hand' + L), hw]);
      return norm(w.filter(a => a[1] > 0));
    };
    // [s, rx, rz, 素材（このリングから次のリングまで）]。素材の切れ目は同じ位置にリングを2つ置く（半径の段差）
    const SH_END = 0.16, EL = 0.292, WR = 0.545;
    const tab = [[-0.060, 0.0, 0.0, M.TSHIRT], [-0.052, 0.028, 0.028, M.TSHIRT], [-0.036, 0.046, 0.046, M.TSHIRT], [-0.016, 0.057, 0.057, M.TSHIRT], [0.01, 0.062, 0.060, M.TSHIRT], [0.08, 0.061, 0.058, M.TSHIRT], [SH_END - 0.002, 0.062, 0.059, M.TSHIRT],
      [SH_END, 0.0505, 0.049, M.SKIN], [0.23, 0.0475, 0.046, M.SKIN], [EL - 0.002, 0.047, 0.0455, M.SKIN],
      [EL, 0.0505, 0.049, M.SLEEVE], [0.34, 0.0505, 0.0495, M.SLEEVE], [0.40, 0.0485, 0.047, M.SLEEVE], [0.46, 0.0455, 0.044, M.SLEEVE], [0.50, 0.043, 0.0415, M.SLEEVE], [WR - 0.004, 0.0415, 0.040, M.SLEEVE],
      [WR - 0.002, 0.036, 0.0345, M.SKIN], [0.552, 0.030, 0.030, M.SKIN]];
    const rings = tab.map(([s, rx, rz]) => {
      const t = tanAt(s), [u, w] = frame(t), c = s < 0 ? V.madd(S0, tU, s) : pointAt(s);
      return {c, u, w, rx, rz, n: 2.1, s, wt: wArm(s)};
    });
    mb.loft(rings, {N: 16, capS: false, capE: true, mat: i => tab[i][3], wt: r => r.wt});
    // 手（素手）: 手首〜手のひら〜指。少し曲げた形
    const tH = V.norm(mx(S.dirH)), pn = [-sd, 0, 0];
    const wrist = Wr;
    const htab = [[-0.045, 0.027, 0.029], [-0.005, 0.0265, 0.0295], [0.02, 0.0235, 0.031], [0.05, 0.0200, 0.035], [0.085, 0.0205, 0.037], [0.115, 0.0205, 0.035], [0.15, 0.0175, 0.032], [0.178, 0.0128, 0.026], [0.19, 0.006, 0.015], [0.195, 0.0, 0.0]];
    const hr = htab.map(([s, rx, rz]) => {
      const curl = 0.055 * Math.pow(Math.max(0, s) / 0.19, 2.2);
      const t = V.norm(V.madd(tH, pn, 0.55 * Math.pow(Math.max(0, s) / 0.19, 1.2)));
      const c = V.madd(V.madd(wrist, tH, s), pn, curl);
      const u = V.norm(V.sub(pn, V.mul(t, V.dot(pn, t)))), w = V.cross(u, t);
      return {c, u, w, rx, rz, n: 2.3, wt: norm([[bi('foreArm' + L), 1 - ss(-0.03, 0.02, s)], [bi('hand' + L), ss(-0.03, 0.02, s)]])};
    });
    mb.loft(hr, {N: 14, mat: M.SKIN, capS: false, wt: r => r.wt});
    const t0 = V.madd(V.madd(V.madd(wrist, tH, 0.04), [0, 0, 1], 0.026), pn, 0.012), td = V.norm(V.add(V.mul(tH, 0.9), V.add(V.mul(pn, 0.22), [0, 0, 0.12])));
    mb.sweep([t0, V.madd(t0, td, 0.03), V.madd(t0, V.norm(V.add(td, V.mul(pn, 0.5))), 0.065)], s => 0.0118 - 0.004 * s, M.SKIN, {N: 8, sub: 4, wt: () => [[bi('hand' + L), 1]]});
  }
  // ---------- 脚（黒い細身のパンツ）とスニーカー ----------
  for (const sd of [1, -1]) {
    const L = sd > 0 ? 'L' : 'R', X = S.LX * sd - 0.002 * sd;
    const tab = [[0.96, 0.0, 0.0, 0], [0.952, 0.045, 0.045, 0], [0.925, 0.050, 0.055, -0.004], [0.89, 0.056, 0.064, -0.006], [0.85, 0.060, 0.070, -0.006], [0.80, 0.062, 0.072, -0.005], [0.76, 0.064, 0.077, -0.004], [0.71, 0.072, 0.085, -0.002], [0.66, 0.070, 0.076, 0.002],
      [0.57, 0.061, 0.066, 0.004], [0.50, 0.057, 0.062, 0.002], [0.44, 0.057, 0.065, -0.006], [0.37, 0.056, 0.064, -0.012], [0.30, 0.051, 0.057, -0.010], [0.22, 0.045, 0.049, -0.006], [0.15, 0.042, 0.046, -0.002], [0.115, 0.043, 0.048, 0.0], [0.100, 0.044, 0.050, 0.002], [0.095, 0.037, 0.044, 0.0]];
    const rings = tab.map(([y, rx, rz, zc]) => ({c: [X, y, 0], rx: rx * 1.0, rz: rz * 1.0, oz: zc, n: 2.2}));
    mb.loft(rings, {
      N: 18, mat: M.IPANTS, capS: false, capE: true,
      wt: (r, p) => {
        const y = p[1], rootW = ss(0.84, 1.0, y) * 0.55, shinW = ss(0.56, 0.44, y), footW = ss(0.16, 0.088, y) * 0.8;
        const th = (1 - rootW) * (1 - shinW);
        return norm([[bi('root'), rootW], [bi('thigh' + L), th], [bi('shin' + L), (1 - rootW) * shinW * (1 - footW)], [bi('foot' + L), (1 - rootW) * shinW * footW]]);
      },
    });
    // スニーカー: 白い甲と黒いソール（前後方向に断面を並べる）
    const shoe = [[-0.078, 0.030, 0.034, 0.052], [-0.062, 0.038, 0.047, 0.057], [-0.03, 0.043, 0.058, 0.066], [0.0, 0.045, 0.056, 0.064], [0.04, 0.046, 0.048, 0.055], [0.09, 0.048, 0.040, 0.042], [0.14, 0.050, 0.032, 0.034], [0.19, 0.045, 0.025, 0.027], [0.225, 0.034, 0.018, 0.02], [0.24, 0.018, 0.010, 0.014], [0.2455, 0.0, 0.0, 0.012]];
    const sw = (r, p) => { const z = p[2], tw = ss(0.105, 0.175, z), up = ss(0.085, 0.12, p[1]) * ss(0.02, -0.04, z) * 0.6; return norm([[bi('foot' + L), (1 - tw) * (1 - up)], [bi('toe' + L), tw], [bi('shin' + L), (1 - tw) * up]]); };
    mb.loft(shoe.map(([z, rx, ry, cy]) => ({c: [X, cy + 0.003, z], u: [1, 0, 0], w: [0, 1, 0], rx, rz: ry, n: 2.6})), {N: 20, mat: M.SNEAKER, capS: true, wt: sw});
    const sole = [[-0.082, 0.028, 0.010], [-0.06, 0.040, 0.013], [0.0, 0.0475, 0.0145], [0.1, 0.0515, 0.0145], [0.18, 0.047, 0.0125], [0.235, 0.032, 0.010], [0.2505, 0.012, 0.006]];
    mb.loft(sole.map(([z, rx, ry]) => ({c: [X, 0.0125 + 0.003 - 0.006, z], u: [1, 0, 0], w: [0, 1, 0], rx, rz: ry, n: 2.4})), {N: 20, mat: M.SOLE, capS: true, capE: true, wt: sw});
    // 靴紐のあたり（黒い小さな帯）
    mb.ellipsoid([X, 0.085 + 0.003, 0.085], [0.034, 0.006, 0.05], M.SOLE, {axis: [0, 1, 0.3], N: 10, lat: 4, wt: sw});
  }
}

module.exports = {buildIllust, HEAD_Y};
