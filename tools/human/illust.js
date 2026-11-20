'use strict';
// イラスト（look illust）の人体: 白いTシャツ・黒い細身のパンツ・スニーカー・腕の色スリーブ・アニメ調の顔。
// 骨格・スキニングは制服（body.js）と同じ。髪は頭の骨に付く別メッシュ（hairs）として5種類作る。
const {V, ss, lerp} = require('./math');
const S = require('./skeleton');
const M = require('./materials');
const {TORSO, spineW, interp} = require('./body');
const {id: B} = S;

const norm = a => { const s = a.reduce((x, y) => x + y[1], 0) || 1; return a.map(([b, w]) => [b, w / s]); };
const bi = B;

// 頭の断面（body.js と同じ）
const HEAD = [[1.462, 0.014, 0.020, 0.062], [1.470, 0.034, 0.048, 0.052], [1.485, 0.054, 0.072, 0.036], [1.505, 0.067, 0.088, 0.018],
  [1.53, 0.074, 0.095, 0.010], [1.56, 0.077, 0.099, 0.008], [1.595, 0.078, 0.101, 0.006], [1.630, 0.076, 0.099, 0.003], [1.665, 0.066, 0.086, 0.0], [1.69, 0.046, 0.062, -0.002], [1.703, 0.0, 0.0, 0]];
const HEAD_Y = 1.51; // head ボーンの静止位置の高さ
// 高さ y での頭の半径（rx, rz, 中心 z）。下は首、上は頭頂
function headR(y) {
  for (let i = 0; i + 1 < HEAD.length; i++) if (y >= HEAD[i][0] && y <= HEAD[i + 1][0]) {
    const k = (y - HEAD[i][0]) / (HEAD[i + 1][0] - HEAD[i][0]);
    return [1, 2, 3].map(j => lerp(HEAD[i][j], HEAD[i + 1][j], k));
  }
  return y < HEAD[0][0] ? [0.014, 0.02, 0.062] : [0, 0, 0];
}

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
  // ---------- 頭と顔（アニメ調: 大きな目・小さな鼻と口・ほお）----------
  {
    const headW = (r, p) => { const t = ss(1.46, 1.50, p[1]); return norm([[bi('head'), 0.4 + 0.6 * t], [bi('neck'), 0.6 * (1 - t)]]); };
    mb.loft(HEAD.map(([y, rx, rz, zc]) => ({c: [0, y, 0], rx, rz, oz: zc, n: y < 1.5 ? 2.0 : 2.3})), {N: 24, mat: M.SKIN, capS: true, wt: headW});
    const hd = {wt: () => [[bi('head'), 1]]};
    const face = (c, rad, mat, yaw = 0, extra = {}) => {
      const a = [Math.sin(yaw), 0, Math.cos(yaw)], u = [Math.cos(yaw), 0, -Math.sin(yaw)];
      mb.ellipsoid(c, [rad[0], rad[2], rad[1]], mat, {axis: a, u, lat: 6, N: 12, ...hd, ...extra}); // 引数は [横, 高さ, 奥行き]（ellipsoid は 軸方向 = 奥行きが2番目）
    };
    // 耳
    for (const s of [-1, 1]) mb.ellipsoid([s * 0.0775, 1.553, -0.006], [0.0085, 0.022, 0.015], M.SKIN, {lat: 6, N: 8, ...hd});
    // 鼻（小さな影）と口
    face([0, 1.5455, 0.1055], [0.0045, 0.0035, 0.004], M.LIP);
    const mp = [-0.0135, -0.0065, 0, 0.0065, 0.0135].map((x, i) => [x, 1.5275 - [0.0012, 0.0003, -0.0004, 0.0003, 0.0012][i] + 0.0, 0.1035 - Math.abs(x) * 0.3]);
    mb.sweep(mp, 0.0016, M.MOUTH, {N: 6, sub: 3, ...hd});
    for (const s of [-1, 1]) {
      const ex = s * 0.0365, yaw = s * 0.22, z0 = 0.0955;
      face([ex, 1.5765, z0], [0.0185, 0.0245, 0.0075], M.EYEW, yaw);                       // 白目
      face([ex + s * 0.0006, 1.5745, z0 + 0.0025], [0.0138, 0.0215, 0.0075], M.IRIS, yaw);  // 虹彩
      face([ex + s * 0.0006, 1.5735, z0 + 0.005], [0.0078, 0.0138, 0.0075], M.EYE, yaw);    // 瞳孔
      face([ex - s * 0.0045, 1.5845, z0 + 0.0085], [0.0045, 0.0052, 0.004], M.EYEW, yaw);   // ハイライト
      face([ex + s * 0.0045, 1.5665, z0 + 0.0085], [0.0022, 0.0025, 0.003], M.EYEW, yaw);
      face([ex + s * 0.001, 1.5985, z0 + 0.0035], [0.0215, 0.0042, 0.0085], M.EYE, yaw);    // まぶた（まつげ）
      face([ex + s * 0.0035, 1.6175, z0 - 0.0005], [0.0165, 0.0033, 0.006], M.HAIR, yaw * 1.2); // まゆ
      face([s * 0.0505, 1.5455, 0.0845], [0.0125, 0.0065, 0.004], M.BLUSH, s * 0.6);        // ほお
    }
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

// ---------- 髪 ----------
// 頭に沿った面（grid）: 高さ v、角度 th（0 = 正面、π = 後ろ）。lowFn(|th|) = 下端の高さ、gap = 頭からの浮き
function hairCap(hb, opts) {
  const {low, gap = 0.006, flare = 0.0, top = 1.713, N = 36, M2 = 14, back = 0.0} = opts;
  const pt = (th, v) => {
    const y0 = low(th), y = lerp(y0, top, v);
    let [rx, rz, zc] = headR(Math.min(y, 1.7029));
    if (y < 1.505) { const d = 1.505 - y; rx = 0.067 + d * 0.12 * 0 + 0.0; rz = 0.088; zc = 0.018 - d * 0.2 * 0; }
    const fl = flare * Math.pow(1 - v, 1.5) * (0.4 + 0.6 * Math.abs(Math.sin(th / 2)));
    const e = 2 / 2.3, cs = Math.cos(th), sn = Math.sin(th);
    const x = (rx + gap + fl) * Math.sign(sn) * Math.pow(Math.abs(sn), e), z = zc + (rz + gap + fl) * Math.sign(cs) * Math.pow(Math.abs(cs), e) - back * Math.pow(1 - v, 1.4) * Math.max(0, -cs);
    return [x, y, z];
  };
  hb.grid(N, M2, (u, v) => pt((u - 0.5) * 2 * Math.PI, v), M.HAIR, {double: false, flip: opts.flip, wt: () => [[bi('head'), 1]]});
}
const tw = (hb, pts, r0, r1, flat = 1.0) => hb.sweep(pts, s => [lerp(r0, r1, Math.pow(s, 0.9)) * flat, lerp(r0, r1, Math.pow(s, 0.9))], M.HAIR, {N: 8, sub: 4, wt: () => [[bi('head'), 1]]});
// 前髪（額に沿って垂らす）: 根元（生え際より上）→ 毛先
function bangs(hb, tips) {
  tips.forEach(([x, yb, lean, w]) => {
    const yr = 1.668, zf = headR(1.64)[2] + headR(1.64)[1] + 0.012;
    const pts = [[x * 0.7, yr, zf - 0.03], [x * 0.9, 1.645, zf + 0.004], [x * 1.0 + lean * 0.4, 1.625, zf + 0.007], [x * 1.0 + lean, yb, zf - 0.004]];
    tw(hb, pts, w, 0.0016);
  });
}
function sideLocks(hb, len, wd = 0.013) {
  for (const s of [-1, 1]) {
    const pts = [[s * 0.080, 1.62, 0.055], [s * 0.088, 1.58, 0.045], [s * 0.088, (1.58 + len) / 2, 0.045], [s * 0.084, len, 0.052]];
    tw(hb, pts, wd, 0.002, 0.8);
  }
}
const HAIR_STYLES = {
  // 短髪: 耳が出る長さ、前髪は流す
  short(hb) {
    hairCap(hb, {low: th => { const a = Math.abs(th); return a < 1.1 ? lerp(1.628, 1.60, a / 1.1) : lerp(1.60, 1.535, Math.min(1, (a - 1.1) / 1.4)); }, gap: 0.0065});
    bangs(hb, [[-0.050, 1.601, -0.008, 0.012], [-0.025, 1.598, -0.006, 0.012], [0.0, 1.600, 0.002, 0.012], [0.025, 1.597, 0.008, 0.012], [0.05, 1.604, 0.012, 0.011]]);
    // 頭頂のはね
    tw(hb, [[0.0, 1.700, 0.01], [0.012, 1.728, 0.0], [0.034, 1.738, -0.02]], 0.014, 0.002, 1.2);
  },
  // ボブ: あご先までの丸いシルエット
  bob(hb) {
    hairCap(hb, {low: th => { const a = Math.abs(th); return a < 0.9 ? lerp(1.628, 1.60, a / 0.9) : lerp(1.60, 1.492, Math.min(1, (a - 0.9) / 1.0)); }, gap: 0.0065, flare: 0.016});
    bangs(hb, [[-0.055, 1.604, -0.01, 0.013], [-0.03, 1.599, -0.006, 0.013], [-0.005, 1.598, 0.0, 0.013], [0.02, 1.599, 0.006, 0.013], [0.045, 1.600, 0.01, 0.013], [0.062, 1.606, 0.012, 0.012]]);
    sideLocks(hb, 1.50, 0.016);
  },
  // ポニーテール: 高い位置でまとめる
  pony(hb) {
    hairCap(hb, {low: th => { const a = Math.abs(th); return a < 1.0 ? lerp(1.628, 1.60, a / 1.0) : lerp(1.60, 1.545, Math.min(1, (a - 1.0) / 1.5)); }, gap: 0.0065});
    bangs(hb, [[-0.05, 1.602, -0.01, 0.012], [-0.025, 1.598, -0.006, 0.012], [0.0, 1.598, 0.0, 0.012], [0.025, 1.599, 0.006, 0.012], [0.05, 1.603, 0.01, 0.012]]);
    sideLocks(hb, 1.545, 0.011);
    hb.ellipsoid([0, 1.668, -0.088], [0.026, 0.026, 0.026], M.HAIR, {N: 10, lat: 6, wt: () => [[bi('head'), 1]]});
    tw(hb, [[0, 1.672, -0.092], [0, 1.700, -0.15], [0, 1.668, -0.215], [0.01, 1.58, -0.245], [0.02, 1.46, -0.24], [0.01, 1.37, -0.215]], 0.034, 0.004, 0.8);
  },
  // ロング: 背中まで
  long(hb) {
    hairCap(hb, {low: th => { const a = Math.abs(th); return a < 0.9 ? lerp(1.628, 1.60, a / 0.9) : lerp(1.60, 1.30, Math.pow(Math.min(1, (a - 0.9) / 1.5), 0.8)); }, gap: 0.0065, flare: 0.026, back: 0.045});
    bangs(hb, [[-0.055, 1.603, -0.01, 0.013], [-0.03, 1.598, -0.006, 0.013], [-0.005, 1.597, 0.0, 0.013], [0.02, 1.598, 0.006, 0.013], [0.045, 1.600, 0.01, 0.013], [0.062, 1.606, 0.012, 0.012]]);
    sideLocks(hb, 1.40, 0.017);
  },
  // ツインテール: 左右の高い位置で結ぶ
  twin(hb) {
    hairCap(hb, {low: th => { const a = Math.abs(th); return a < 1.0 ? lerp(1.628, 1.60, a / 1.0) : lerp(1.60, 1.545, Math.min(1, (a - 1.0) / 1.5)); }, gap: 0.0065});
    bangs(hb, [[-0.05, 1.604, -0.012, 0.013], [-0.025, 1.599, -0.006, 0.013], [0.0, 1.598, 0.0, 0.013], [0.025, 1.599, 0.006, 0.013], [0.05, 1.604, 0.012, 0.013]]);
    sideLocks(hb, 1.55, 0.011);
    for (const s of [-1, 1]) {
      hb.ellipsoid([s * 0.074, 1.655, -0.03], [0.02, 0.02, 0.02], M.HAIR, {N: 10, lat: 6, wt: () => [[bi('head'), 1]]});
      tw(hb, [[s * 0.078, 1.655, -0.03], [s * 0.125, 1.63, -0.04], [s * 0.15, 1.53, -0.04], [s * 0.145, 1.41, -0.02], [s * 0.15, 1.33, 0.0]], 0.028, 0.004, 0.9);
    }
  },
};
module.exports = {buildIllust, HAIR_STYLES, HEAD_Y};
