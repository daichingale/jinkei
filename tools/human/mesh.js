'use strict';
// メッシュ生成: 断面をつないだ筒（loft）、回転体、楕円体、掃引（sweep）、箱、布のグリッドなど
const {V, Q} = require('./math');

const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

class MeshBuilder {
  constructor() { this.P = []; this.W = []; this.T = []; this.M = []; this.NRM = null; }
  v(p, wt) { this.P.push([p[0], p[1], p[2]]); this.W.push(wt || null); return this.P.length - 1; }
  tri(a, b, c, m) { if (a === b || b === c || a === c) return; this.T.push([a, b, c]); this.M.push(m); }

  // 断面（超楕円）をつないだ筒。rings: [{c, u, w, rx, rz, n, ox, oz, wt}]
  //   u, w: 断面の2軸（省略時は x, z）。n: 超楕円の指数（2=楕円、大きいほど角ばる）
  //   opts: {N 分割数, mat 数値または f(i)（リング i と i+1 の間の素材）, wt(ring, pos, i, k) 重み, capS, capE}
  loft(rings, o = {}) {
    const N = o.N || 16, base = this.P.length, idx = [];
    const matOf = typeof o.mat === 'function' ? o.mat : () => o.mat;
    rings.forEach((r, i) => {
      const u = r.u || [1, 0, 0], w = r.w || [0, 0, 1], n = r.n || o.n || 2.2, e = 2 / n;
      const rx = r.rx !== undefined ? r.rx : r.r, rz = r.rz !== undefined ? r.rz : r.r;
      const ox = r.ox || 0, oz = r.oz || 0, row = [];
      if (rx < 1e-6 && rz < 1e-6) {
        const p = V.add(r.c, V.add(V.mul(u, ox), V.mul(w, oz)));
        const id = this.v(p, o.wt ? o.wt(r, p, i, 0) : r.wt);
        for (let k = 0; k < N; k++) row.push(id);
      } else {
        for (let k = 0; k < N; k++) {
          const th = (k / N) * Math.PI * 2, a = ox + rx * spow(Math.cos(th), e), b = oz + rz * spow(Math.sin(th), e);
          const p = V.add(r.c, V.add(V.mul(u, a), V.mul(w, b)));
          row.push(this.v(p, o.wt ? o.wt(r, p, i, k) : r.wt));
        }
      }
      idx.push(row);
    });
    const tris = [];
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let k = 0; k < N; k++) {
        const k1 = (k + 1) % N, a = idx[i][k], b = idx[i][k1], c = idx[i + 1][k], d = idx[i + 1][k1], m = matOf(i);
        tris.push([a, c, b, m, i], [b, c, d, m, i]);
      }
    }
    const caps = [];
    const cap = (i, m, dirv) => {
      const r = rings[i], rx = r.rx !== undefined ? r.rx : r.r, rz = r.rz !== undefined ? r.rz : r.r;
      if (rx < 1e-6 && rz < 1e-6) return;
      const cp = V.add(r.c, V.add(V.mul(r.u || [1, 0, 0], r.ox || 0), V.mul(r.w || [0, 0, 1], r.oz || 0)));
      const ctr = this.v(cp, o.wt ? o.wt(r, r.c, i, -1) : r.wt);
      for (let k = 0; k < N; k++) {
        const k1 = (k + 1) % N, a = idx[i][k], b = idx[i][k1];
        const nn = V.cross(V.sub(this.P[a], cp), V.sub(this.P[b], cp));
        caps.push(V.dot(nn, dirv) >= 0 ? [ctr, a, b, m] : [ctr, b, a, m]);
      }
    };
    const nR = rings.length;
    if (o.capS && nR > 1) cap(0, matOf(0), V.sub(rings[0].c, rings[1].c));
    if (o.capE && nR > 1) cap(nR - 1, matOf(nR - 2), V.sub(rings[nR - 1].c, rings[nR - 2].c));
    // 巻き方向の判定: 外向き（リング中心から離れる向き）との内積の合計が負なら反転
    let s = 0;
    for (const [a, b, c, , ri] of tris) {
      const pa = this.P[a], pb = this.P[b], pc = this.P[c], nn = V.cross(V.sub(pb, pa), V.sub(pc, pa));
      s += V.dot(nn, V.sub(V.mul(V.add(V.add(pa, pb), pc), 1 / 3), rings[ri].c));
    }
    const flip = (o.flip !== undefined ? o.flip : s < 0) !== !!o.invert;
    for (const [a, b, c, m] of tris) flip ? this.tri(a, c, b, m) : this.tri(a, b, c, m);
    for (const [a, b, c, m] of caps) this.tri(a, b, c, m);
    return {base, idx};
  }

  // 回転体: profile = [[半径, 軸方向の位置], ...]
  lathe(origin, axis, profile, mat, o = {}) {
    axis = V.norm(axis);
    const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = V.norm(V.cross(ref, axis)), w = V.cross(axis, u);
    const rings = profile.map(([r, h]) => ({c: V.madd(origin, axis, h), u, w, rx: r, rz: r * (o.squash || 1), n: o.n || 2}));
    return this.loft(rings, {N: o.N || 20, mat, wt: o.wt, capS: o.capS, capE: o.capE, flip: o.flip});
  }

  // 楕円体（軸 axis 方向に ry、ほかは rx）
  ellipsoid(c, rad, mat, o = {}) {
    const lat = o.lat || 8, ax = V.norm(o.axis || [0, 1, 0]);
    const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = o.u || V.norm(V.cross(ref, ax)), w = V.cross(ax, u);
    const rings = [];
    for (let i = 0; i <= lat; i++) {
      const ph = (i / lat) * Math.PI, s = Math.sin(ph), cc = Math.cos(ph);
      rings.push({c: V.madd(c, ax, rad[1] * cc), u, w, rx: i === 0 || i === lat ? 0 : rad[0] * s, rz: i === 0 || i === lat ? 0 : rad[2] * s, n: 2});
    }
    return this.loft(rings, {N: o.N || 12, mat, wt: o.wt});
  }

  // 2点間の円柱・円錐
  tube(a, b, r0, r1, mat, o = {}) {
    const ax = V.sub(b, a), l = V.len(ax), t = V.mul(ax, 1 / l);
    const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = V.norm(V.cross(ref, t)), w = V.cross(t, u);
    const rings = [{c: a, u, w, rx: r0, rz: r0 * (o.squash || 1)}, {c: b, u, w, rx: r1, rz: r1 * (o.squash || 1)}];
    return this.loft(rings, {N: o.N || 10, mat, wt: o.wt, capS: o.capS !== false, capE: o.capE !== false, n: 2});
  }

  // 経路（点列）に沿った筒。radius: 数値、または s(0..1) → 半径 / [rx, rz] の関数。パスは Catmull-Rom で滑らかにする
  sweep(pts, radius, mat, o = {}) {
    const path = o.smooth === false ? pts : catmull(pts, o.sub || 8);
    const n = path.length, seg = [0];
    for (let i = 1; i < n; i++) seg.push(seg[i - 1] + V.len(V.sub(path[i], path[i - 1])));
    const L = seg[n - 1] || 1;
    // 平行移動フレーム
    const tan = path.map((p, i) => V.norm(V.sub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)])));
    let u = o.up ? V.norm(V.cross(o.up, tan[0])) : null;
    if (!u || V.len(u) < 1e-4) { const ref = Math.abs(tan[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; u = V.norm(V.cross(ref, tan[0])); }
    const rings = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) { const q = Q.arc(tan[i - 1], tan[i]); u = V.norm(Q.rot(q, u)); }
      const w = V.cross(tan[i], u), s = seg[i] / L;
      const r = typeof radius === 'function' ? radius(s) : radius, rx = Array.isArray(r) ? r[0] : r, rz = Array.isArray(r) ? r[1] : r;
      rings.push({c: path[i], u, w, rx, rz, n: 2});
    }
    return this.loft(rings, {N: o.N || 10, mat, wt: o.wt, capS: o.capS !== false, capE: o.capE !== false, flip: o.flip, invert: o.invert});
  }

  // 箱（面ごとに頂点を分けて平らに見せる）。rot は任意のクォータニオン
  box(c, s, mat, o = {}) {
    const q = o.q || Q.id(), h = [s[0] / 2, s[1] / 2, s[2] / 2];
    const P = (x, y, z) => V.add(c, Q.rot(q, [x * h[0], y * h[1], z * h[2]]));
    const faces = [[[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]];
    for (const f of faces) {
      const id = f.map(([x, y, z]) => this.v(P(x, y, z), o.wt));
      this.tri(id[0], id[1], id[2], mat); this.tri(id[0], id[2], id[3], mat);
    }
  }

  // パラメトリック面（布・ベルトなど）。f(u, v) → 位置。両面にするときは裏も作る
  grid(nu, nv, f, mat, o = {}) {
    const id = [];
    for (let i = 0; i <= nu; i++) { const row = []; for (let j = 0; j <= nv; j++) { const p = f(i / nu, j / nv); row.push(this.v(p, typeof o.wt === 'function' ? o.wt(p) : o.wt)); } id.push(row); }
    let fl = o.flip ? 1 : 0;
    if (o.nz !== undefined) { // 最初の三角形の法線の z 向きで巻き方向を決める
      const a = this.P[id[0][0]], b = this.P[id[1][0]], c = this.P[id[1][1]], nn = V.cross(V.sub(b, a), V.sub(c, a));
      fl = (nn[2] * o.nz < 0) ? 1 : 0;
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = id[i][j], b = id[i + 1][j], c = id[i + 1][j + 1], d = id[i][j + 1];
      if (fl) { this.tri(a, c, b, mat); this.tri(a, d, c, mat); } else { this.tri(a, b, c, mat); this.tri(a, c, d, mat); }
    }
    if (o.double) {
      // 裏面は頂点を別に作る（法線を逆向きにするため）
      const id2 = [];
      for (let i = 0; i <= nu; i++) { const row = []; for (let j = 0; j <= nv; j++) row.push(this.v(this.P[id[i][j]], typeof o.wt === 'function' ? o.wt(this.P[id[i][j]]) : o.wt)); id2.push(row); }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = id2[i][j], b = id2[i + 1][j], c = id2[i + 1][j + 1], d = id2[i][j + 1];
        if (fl) { this.tri(a, b, c, mat); this.tri(a, c, d, mat); } else { this.tri(a, c, b, mat); this.tri(a, d, c, mat); }
      }
    }
    return id;
  }

  // 頂点法線（面積重み）を計算して、素材ごとに頂点を分け、重みを上位4つに整えて返す
  finalize(nbones) {
    const NR = this.P.map(() => [0, 0, 0]);
    for (const [a, b, c] of this.T) {
      const n = V.cross(V.sub(this.P[b], this.P[a]), V.sub(this.P[c], this.P[a]));
      for (const i of [a, b, c]) { NR[i][0] += n[0]; NR[i][1] += n[1]; NR[i][2] += n[2]; }
    }
    // 近い位置の頂点は法線をそろえる（loft の継ぎ目・端など）。位置のハッシュで平均化する
    if (this.weldNormals) {
      const map = new Map(), key = p => Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4) + ',' + Math.round(p[2] * 1e4);
      this.P.forEach((p, i) => { const k = key(p); if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
      for (const g of map.values()) if (g.length > 1) {
        const s = [0, 0, 0]; for (const i of g) { s[0] += NR[i][0]; s[1] += NR[i][1]; s[2] += NR[i][2]; }
        for (const i of g) NR[i] = s.slice();
      }
    }
    const out = {pos: [], nor: [], mat: [], idx: [], skin: [], skinW: []}, key = new Map();
    const get = (i, m) => {
      const k = i * 64 + m;
      if (key.has(k)) return key.get(k);
      const id = out.pos.length / 3, nn = V.norm(NR[i]);
      out.pos.push(...this.P[i]); out.nor.push(...nn); out.mat.push(m);
      let wt = this.W[i] ? this.W[i].filter(x => x[1] > 1e-4).sort((p, q) => q[1] - p[1]).slice(0, 4) : [[0, 1]];
      if (!wt.length) wt = [[0, 1]];
      const sum = wt.reduce((s, x) => s + x[1], 0);
      for (let j = 0; j < 4; j++) { out.skin.push(wt[j] ? wt[j][0] : 0); out.skinW.push(wt[j] ? wt[j][1] / sum : 0); }
      key.set(k, id); return id;
    };
    this.T.forEach(([a, b, c], t) => { const m = this.M[t]; out.idx.push(get(a, m), get(b, m), get(c, m)); });
    return out;
  }
}

// Catmull-Rom（各区間を sub 分割）
function catmull(pts, sub) {
  if (pts.length < 3) {
    const o = []; for (let i = 0; i <= sub; i++) o.push(V.lerp(pts[0], pts[pts.length - 1], i / sub)); return o;
  }
  const o = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < sub; j++) {
      const t = j / sub, t2 = t * t, t3 = t2 * t;
      o.push([0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  o.push(pts[pts.length - 1]);
  return o;
}
module.exports = {MeshBuilder, catmull, spow};
