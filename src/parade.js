// パレード（行進で会場を一周する）の自動作成。画面に依存しない純粋なロジック。
// ブラウザでは window.JKParade、Node では module.exports。使い方と仕組みは README「パレード自動作成」。
//
// しくみ（要約）
//  1. 会場・コース・隊列から「全員の軌道 pos(i, t)」を数式で決める（t はカウント）。
//     - 列車モデル: 横列（ランク）が道に直角のまま、時間差 τ で同じ道をたどる。
//       コーナーでは外側の人ほど大きな円を描くので、外側が歩幅の上限になるよう中心の速さを落とす。
//     - フォロー: 1本の列が先頭の通った道をたどる（`follow`）。
//     - 剛体ブロック: 隊形を保ったまま平行移動し、角では向きだけ変える（直角フランク）。
//  2. 軌道を「セット」に切り分ける。長い直進はまとめ、曲がり・速さが変わるところは
//     円弧（bend）または直線で近似できる長さまで自動で細かく割る（許容誤差 tol）。
//  3. 同じ動きの人はまとめて 1 つの文にする（same shift / same rotate about … bend）。
(function (root) {
'use strict';
const PI = Math.PI, hyp = Math.hypot, D2R = PI / 180;
const r3 = v => Math.round(v * 1000) / 1000;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dist = (a, b) => hyp(a[0] - b[0], a[1] - b[1]);
const unit = v => { const l = hyp(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const norm180 = d => { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; };
const ceilN = (x, eps) => Math.ceil(x - (eps || 1e-9));

// ================= 会場 =================
// 単位はフィールド単位（体育館・ステージ・フロア = m、フットボール = 8to5 の1歩）。mpu = 1単位が何mか
function venueOf(field, extra) {
  extra = extra || {};
  const t = field.type;
  const V = {type: t, mpu: 1, unit: 'm'};
  const clr = extra.clearance != null && extra.clearance !== '' && isFinite(+extra.clearance) ? +extra.clearance : null;
  const ms = extra.maxstep != null && extra.maxstep !== '' && isFinite(+extra.maxstep) ? +extra.maxstep : null;
  if (t === 'football') {
    const BSL = 160 * 12 / 22.5;
    Object.assign(V, {mpu: 0.5625, unit: '歩', maxPer: 8 / (ms || 6), cl: clr || 1.0,
      area: {x0: -80, x1: 80, y0: 0, y1: BSL}, inb: (x, y) => Math.abs(x) <= 96 + 1e-6 && y >= -1e-6 && y <= BSL + 1e-6, inset: 7});
  } else if (t === 'stage') {
    const w = +field.w || 16, d = +field.d || 10, wing = field.wing != null ? +field.wing : 4;
    Object.assign(V, {maxPer: ms || 0.8, cl: clr || 0.6, area: {x0: -w / 2, x1: w / 2, y0: 0, y1: d},
      inb: (x, y) => Math.abs(x) <= w / 2 + wing + 1e-6 && y >= -1e-6 && y <= d + 1e-6, inset: 0.7, w, d, wing});
  } else if (t === 'floor') {
    const w = +field.w || 24, d = +field.d || 18;
    Object.assign(V, {maxPer: ms || 0.8, cl: clr || 0.6, area: {x0: -w / 2, x1: w / 2, y0: 0, y1: d},
      inb: (x, y) => Math.abs(x) <= w / 2 + 1e-6 && y >= -1e-6 && y <= d + 1e-6, inset: 0.8, w, d});
  } else {
    const w = +field.w || 30, d = +field.d || 30;
    Object.assign(V, {type: 'gym', maxPer: ms || 0.8, cl: clr || 0.6, area: {x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2},
      inb: (x, y) => Math.abs(x) <= w / 2 + 4.5 + 1e-6 && Math.abs(y) <= d / 2 + 4.5 + 1e-6, inset: 0.8, w, d});
  }
  V.front = V.area.y0; // 客席側（y が小さい側）
  return V;
}
const shrink = (b, m) => ({x0: b.x0 + m, x1: b.x1 - m, y0: b.y0 + m, y1: b.y1 - m});

// ================= 道（直線と円弧の列） =================
const segL = (a, b) => ({t: 'L', a, b, len: dist(a, b), th: Math.atan2(b[1] - a[1], b[0] - a[0])});
const segA = (c, r, a0, da) => ({t: 'A', c, r, a0, da, len: r * Math.abs(da)});
// 道の上の点と進行方向。x = 区間の始点からの距離、u = 進行方向の左へのずれ
function segAt(sg, x, u) {
  if (sg.t === 'L') {
    const f = sg.len > 1e-12 ? x / sg.len : 0, th = sg.th;
    return {p: [sg.a[0] + (sg.b[0] - sg.a[0]) * f - u * Math.sin(th), sg.a[1] + (sg.b[1] - sg.a[1]) * f + u * Math.cos(th)], th};
  }
  const sgn = sg.da >= 0 ? 1 : -1, ang = sg.a0 + sg.da * (sg.len > 1e-12 ? x / sg.len : 0), rr = sg.r - sgn * u;
  return {p: [sg.c[0] + rr * Math.cos(ang), sg.c[1] + rr * Math.sin(ang)], th: ang + sgn * PI / 2};
}
function splitSeg(sg, x) {
  const e = 1e-7;
  if (x <= e) return [null, sg];
  if (x >= sg.len - e) return [sg, null];
  const o = sg.orig || sg.len;
  if (sg.t === 'L') {
    const m = segAt(sg, x, 0).p, A = segL(sg.a, m), B = segL(m, sg.b);
    A.orig = B.orig = o; return [A, B];
  }
  const f = x / sg.len, A = segA(sg.c, sg.r, sg.a0, sg.da * f), B = segA(sg.c, sg.r, sg.a0 + sg.da * f, sg.da * (1 - f));
  A.orig = B.orig = o; return [A, B];
}
function projectX(sg, p) {
  if (sg.t === 'L') {
    const d = [sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]], l2 = d[0] * d[0] + d[1] * d[1];
    return l2 < 1e-12 ? 0 : Math.max(0, Math.min(sg.len, ((p[0] - sg.a[0]) * d[0] + (p[1] - sg.a[1]) * d[1]) / Math.sqrt(l2)));
  }
  const sgn = sg.da >= 0 ? 1 : -1;
  let d = (Math.atan2(p[1] - sg.c[1], p[0] - sg.c[0]) - sg.a0) * sgn;
  d = ((d % (2 * PI)) + 2 * PI) % (2 * PI);
  return Math.min(d, Math.abs(sg.da)) * sg.r;
}
// 角を丸めた多角形。rad = 半径（配列可）。閉じた道
function roundedPoly(P, rad, closed) {
  closed = closed !== false;
  const n = P.length, cs = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], c = P[i], b = P[(i + 1) % n];
    const v1 = unit(sub(c, a)), v2 = unit(sub(b, c));
    const phi = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]);
    let r = Array.isArray(rad) ? rad[i] : rad;
    if (!closed && (i === 0 || i === n - 1)) r = 0;
    if (r < 1e-6 || Math.abs(phi) < 1e-6) { cs.push({c, none: true}); continue; }
    let t = r * Math.tan(Math.abs(phi) / 2);
    const lim = Math.min(dist(a, c), dist(c, b)) / 2;
    if (t > lim) { t = lim; r = t / Math.tan(Math.abs(phi) / 2); }
    const A = [c[0] - v1[0] * t, c[1] - v1[1] * t], B = [c[0] + v2[0] * t, c[1] + v2[1] * t];
    const nr = phi > 0 ? [-v1[1], v1[0]] : [v1[1], -v1[0]];
    const C = [A[0] + nr[0] * r, A[1] + nr[1] * r];
    cs.push({A, B, C, r, phi, a0: Math.atan2(A[1] - C[1], A[0] - C[0])});
  }
  const segs = [];
  const push = s => { if (s.len > 1e-6) segs.push(s); };
  const first = closed ? 0 : 1, last = closed ? n : n - 1;
  let prev = closed ? (cs[n - 1].none ? cs[n - 1].c : cs[n - 1].B) : P[0];
  for (let i = first; i < last; i++) {
    const k = cs[i];
    if (k.none) { push(segL(prev, k.c)); prev = k.c; continue; }
    push(segL(prev, k.A)); push(segA(k.C, k.r, k.a0, k.phi)); prev = k.B;
  }
  if (!closed) push(segL(prev, P[n - 1]));
  return segs;
}
// 道の途中の点を始点にして並べ替える（その点で区間を2つに割る）
function pathFrom(segs, pt) {
  let best = null;
  segs.forEach((sg, i) => {
    const x = projectX(sg, pt), d = dist(segAt(sg, x, 0).p, pt);
    if (!best || d < best.d - 1e-9) best = {i, x, d};
  });
  const sg = segs[best.i], parts = splitSeg(sg, best.x);
  const tag = s => { if (s && !s.orig) s.orig = s.len; return s; };
  const out = [];
  if (parts[1]) out.push(parts[1]);
  for (let k = 1; k < segs.length; k++) out.push(segs[(best.i + k) % segs.length]);
  if (parts[0]) out.push(parts[0]);
  return out.map(s => { if (!s.orig) s.orig = s.len; return s; });
}

// ================= 隊列の並び（スロット） =================
// 戻り値: [{rank, u}]  u は左右のずれ（ファイル間隔の倍数、進行方向の左が +）
function layoutBlock(N, F, fill) {
  F = Math.max(1, Math.min(F, N));
  const R = Math.ceil(N / F), out = [];
  if (fill === 'cols') {
    const Fc = Math.ceil(N / R);
    for (let m = 0; m < N; m++) out.push({rank: m % R, u: (Fc - 1) / 2 - Math.floor(m / R)});
    return out;
  }
  for (let m = 0; m < N; m++) {
    const rk = Math.floor(m / F), c = Math.min(F, N - rk * F);
    out.push({rank: rk, u: (c - 1) / 2 - (m % F)});
  }
  return out;
}
function layoutWedge(N, cap) {
  const out = [];
  let m = 0, rk = 0;
  cap = cap || 99;
  while (m < N) {
    const wdt = Math.min(rk + 1, cap, N - m);
    for (let k = 0; k < wdt; k++) out.push({rank: rk, u: (wdt - 1) / 2 - k});
    m += wdt; rk++;
  }
  return out;
}

// ================= 列車モデル =================
// slots: [{rank, u}]（u はすでに単位長に直したもの）。道 segs を速さ vt で進む。
// ランク r は rank 0 より τ·r だけ遅れて同じ道をたどる。外側ほど大回りなので、コーナーでは中心の速さを落とす
function makeTrain(o) {
  const {segs, closed, laps = 1, slots, tau, vt} = o;
  const us = slots.map(s => s.u), uMax = o.ext ? o.ext.uMax : Math.max(...us), uMin = o.ext ? o.ext.uMin : Math.min(...us);
  const maxRank = Math.max(...slots.map(s => s.rank));
  const speedOf = sg => {
    const orig = sg.orig || sg.len;
    let v = vt;
    if (sg.t === 'A') {
      const sgn = sg.da >= 0 ? 1 : -1, rmax = Math.max(sg.r - sgn * uMax, sg.r - sgn * uMin), rmin = Math.min(sg.r - sgn * uMax, sg.r - sgn * uMin);
      if (rmin < 0.05) throw new Error('tight');
      if (rmax > sg.r) v = vt * sg.r / rmax;
    }
    const n = Math.max(2, Math.ceil(ceilN(orig / v) / 2) * 2), vv = orig / n;
    return {v: vv, n};
  };
  const mk = sg => { const s = speedOf(sg); return {sg, v: s.v, len: sg.len, dt: sg.len / s.v}; };
  const main = [];
  for (let l = 0; l < laps; l++) segs.forEach(sg => main.push(mk(sg)));
  let t = 0;
  main.forEach(p => { p.t0 = t; t += p.dt; p.t1 = t; });
  const T = t;
  // 出発前（列の後ろ）の道
  const pre = [], need = maxRank * tau + 2;
  let tp = 0;
  if (closed) {
    for (let k = segs.length - 1, c = 0; tp < need && c < segs.length * 6; k = (k - 1 + segs.length) % segs.length, c++) {
      const p = mk(segs[k]); p.t1 = -tp; tp += p.dt; p.t0 = -tp; pre.unshift(p);
    }
  } else {
    const f = segs[0], d = f.t === 'L' ? f.th : f.a0 + (f.da >= 0 ? PI / 2 : -PI / 2), L = need * vt + 2;
    const a = segAt(f, 0, 0).p, b = [a[0] - Math.cos(d) * L, a[1] - Math.sin(d) * L];
    const sg = segL(b, a); sg.orig = sg.len;
    const p = {sg, v: vt, len: L, dt: L / vt, t0: -L / vt, t1: 0}; pre.push(p);
  }
  const pieces = pre.concat(main);
  const tmin = pieces[0].t0;
  const find = tt => {
    let lo = 0, hi = pieces.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pieces[m].t0 <= tt + 1e-12) lo = m; else hi = m - 1; }
    return pieces[lo];
  };
  const tr = {T, pieces, tmin, tau, slots, maxRank, laps};
  tr.state = (i, t) => {
    const s = slots[i];
    let tt = t - s.rank * tau;
    if (tt < tmin) tt = tmin;
    if (tt > T) tt = T;
    const p = find(tt), x = Math.min(p.len, Math.max(0, (tt - p.t0) * p.v));
    return segAt(p.sg, x, s.u);
  };
  tr.pos = (i, t) => tr.state(i, t).p;
  // その時刻に、いずれかのランクが曲がっているか
  tr.arcAt = t => { for (let r = 0; r <= maxRank; r++) { let tt = t - r * tau; tt = Math.min(T, Math.max(tmin, tt)); if (find(tt).sg.t === 'A') return true; } return false; };
  return tr;
}
// 内側の列どうしの前後間隔が gmin を割らないための最小の（中心の）半径
function needRadius(uMax, uMin, d, gmin) {
  const q = Math.min(0.98, gmin / d);
  const left = (uMax - q * uMin) / (1 - q), right = (q * uMax - uMin) / (1 - q);
  return Math.max(left, right, Math.max(uMax, -uMin) + 0.45);
}

// ================= 軌道 → セット =================
function arcPoint(a, b, bend, u) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = hyp(dx, dy);
  if (Math.abs(bend) < 1e-6 || l < 1e-9) return [a[0] + dx * u, a[1] + dy * u];
  const th = Math.min(Math.abs(bend), 179) * D2R, s = -Math.sign(bend);
  const rot = (v, g) => [v[0] * Math.cos(g) - v[1] * Math.sin(g), v[0] * Math.sin(g) + v[1] * Math.cos(g)];
  const t0 = rot([dx / l, dy / l], -s * th / 2), n0 = rot(t0, s * PI / 2);
  const r = l / (2 * Math.sin(th / 2)), ph = th * u;
  return [a[0] + r * (Math.sin(ph) * t0[0] + (1 - Math.cos(ph)) * n0[0]), a[1] + r * (Math.sin(ph) * t0[1] + (1 - Math.cos(ph)) * n0[1])];
}
// 1人の [a,b] の動きを「直線」か「円弧（bend）」で近似する
function approxOne(f, i, a, b, ns) {
  const pa = f(i, a), pb = f(i, b), L = dist(pa, pb), len = b - a;
  const samp = [];
  for (let k = 1; k < ns; k++) samp.push([k / ns, f(i, a + len * k / ns)]);
  let maxFromA = 0;
  samp.forEach(s => { maxFromA = Math.max(maxFromA, dist(s[1], pa)); });
  if (L < 0.03) return {type: maxFromA < 0.05 ? 'none' : 'line', pa, pb, bend: 0, dev: Math.max(maxFromA, 0)};
  let devL = 0;
  samp.forEach(s => { devL = Math.max(devL, dist(s[1], [pa[0] + (pb[0] - pa[0]) * s[0], pa[1] + (pb[1] - pa[1]) * s[0]])); });
  if (devL < 0.06) return {type: 'line', pa, pb, bend: 0, dev: devL};
  const pm = f(i, a + len / 2), c = [(pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L];
  const h = (pm[0] - (pa[0] + pb[0]) / 2) * -c[1] + (pm[1] - (pa[1] + pb[1]) / 2) * c[0];
  const bend = Math.max(-175, Math.min(175, 4 * Math.atan(2 * h / L) / D2R));
  let devA = 0;
  samp.forEach(s => { devA = Math.max(devA, dist(s[1], arcPoint(pa, pb, bend, s[0]))); });
  if (devA < devL) return {type: 'arc', pa, pb, bend, dev: devA};
  return {type: 'line', pa, pb, bend: 0, dev: devL};
}
function snapMid(a, b) {
  const len = b - a;
  let m = a + Math.round(len / 2);
  if (len >= 8) { const q = a + 4 * Math.max(1, Math.round(len / 8)); if (q - a >= 2 && b - q >= 2) m = q; }
  if (m <= a) m = a + 1;
  if (m >= b) m = b - 1;
  return m;
}
// 軌道 f(i,t) の [0,T] をセットに切る → [{a,b,ap:[各人の近似]}]
// できるだけ長く（最大 cfg.maxLen）、切れ目は 4 カウントの倍数（だめなら 2、1）にする。
// 1セットの中の動きが「直線か円弧」で tol 以内に近似できる最大の長さを、前から順に選ぶ。
function sliceMotion(f, N, T, cfg, tol) {
  tol = tol == null ? cfg.tol : tol;
  const out = [];
  const tryB = (a, b) => {
    const len = b - a, ns = Math.max(4, Math.min(24, Math.ceil(len)));
    const ap = [];
    let dev = 0, bendMax = 0;
    for (let i = 0; i < N; i++) {
      const x = approxOne(f, i, a, b, ns); ap.push(x); dev = Math.max(dev, x.dev); bendMax = Math.max(bendMax, Math.abs(x.bend));
      if (dev > tol || bendMax > 170) return null;
    }
    return {a, b, ap, dev};
  };
  let a = 0;
  while (a < T - 1e-9) {
    const maxB = Math.min(T, a + cfg.maxLen);
    let got = null;
    for (const q of [4, 2, 1]) {
      const cand = [];
      if (maxB >= T - 1e-9) cand.push(T);
      for (let b = Math.floor((maxB - 1e-9) / q) * q; b > a + 1e-9; b -= q) if (b < T - 1e-9) cand.push(b);
      for (const b of cand) {
        if (T - b > 1e-9 && T - b < 2 - 1e-9) continue; // 端に 1 カウントだけ余らせない
        if (b - a < Math.min(2, T - a) - 1e-9) continue;
        got = tryB(a, b); if (got) break;
      }
      if (got) break;
    }
    if (!got) { // どうしても近似できないときは 1 カウントずつ
      const b = Math.min(T, a + 1); const len = b - a; const ap = [];
      for (let i = 0; i < N; i++) ap.push(approxOne(f, i, a, b, 4));
      got = {a, b, ap, dev: Math.max(...ap.map(x => x.dev))};
    }
    out.push(got); a = got.b;
  }
  return out;
}
// 切ったセットの動き（直線・円弧）を実際にたどって、ぶつかり・大股・場外がないかを確かめる
function checkSlices(sl, N, chk) {
  if (!chk) return {ok: true};
  let minD = 1e9, maxStep = 0, out = 0;
  const posAt = (s, i, t) => {
    const x = s.ap[i], u = (t - s.a) / (s.b - s.a);
    if (x.type === 'none') return x.pa;
    if (x.type === 'line') return [x.pa[0] + (x.pb[0] - x.pa[0]) * u, x.pa[1] + (x.pb[1] - x.pa[1]) * u];
    return arcPoint(x.pa, x.pb, x.bend, u);
  };
  for (const s of sl) {
    const len = s.b - s.a;
    s.ap.forEach(x => {
      let l = dist(x.pa, x.pb);
      if (x.type === 'arc') { const th = Math.abs(x.bend) * D2R; l = l / (2 * Math.sin(th / 2)) * th; }
      maxStep = Math.max(maxStep, l / len);
    });
    const ns = Math.max(2, Math.ceil(len * 4));
    for (let k = 0; k <= ns; k++) {
      const t = s.a + len * k / ns, P = [];
      for (let i = 0; i < N; i++) { const p = posAt(s, i, t); P.push(p); if (chk.inb && !chk.inb(p[0], p[1])) out++; }
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const d = hyp(P[i][0] - P[j][0], P[i][1] - P[j][1]); if (d < minD) minD = d; }
    }
  }
  return {ok: minD >= chk.cl * 1.03 && maxStep <= chk.maxPer * 0.995 && !out, minD, maxStep, out};
}

// ================= 文の生成 =================
const mkStmt = (idx, shape, extra) => Object.assign({idx, group: '', shape, xf: [], assign: null, wait: null, within: null, bend: null, face: null, step: null, action: null, pose: null, carry: null, note: [], tail: null, line: 0}, extra || {});
const headDeg = th => norm180(th / D2R + 90); // 進行方向（数学角, rad）→ face の度（客席 = 0, 上手 = +90）
function arcCenter(pa, pb, bend) {
  const L = dist(pa, pb), th = Math.abs(bend) * D2R, r = L / (2 * Math.sin(th / 2)), c = [(pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L];
  const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], k = r * Math.cos(th / 2) * (bend > 0 ? 1 : -1);
  return [mid[0] + c[1] * k, mid[1] - c[0] * k]; // bend>0 のとき中心は進行方向の右
}
// 1セット分の文（idx は人の通し番号）
function stmtsOf(slice, head, style) {
  const groups = new Map();
  const add = (key, mk, i) => { let g = groups.get(key); if (!g) { g = {mk, idx: []}; groups.set(key, g); } g.idx.push(i); };
  const out = [], still = [];
  slice.ap.forEach((x, i) => {
    if (x.type === 'none') { still.push(i); return; }
    if (x.type === 'line') {
      const dx = r3(x.pb[0] - x.pa[0]), dy = r3(x.pb[1] - x.pa[1]);
      add('S' + dx + ',' + dy, idx => mkStmt(idx, {kind: 'same'}, {xf: [{kind: 'shift', d: [dx, dy]}]}), i);
    } else {
      const c = arcCenter(x.pa, x.pb, x.bend), bd = r3(x.bend);
      add('R' + r3(c[0]) + ',' + r3(c[1]) + ',' + bd, idx => mkStmt(idx, {kind: 'same'}, {xf: [{kind: 'rotate', a: r3(-bd), about: [r3(c[0]), r3(c[1])]}], bend: bd}), i);
    }
  });
  groups.forEach(g => {
    if (g.idx.length === 1 && g.mk.length) {
      const i = g.idx[0], x = slice.ap[i];
      out.push(mkStmt([i], {kind: 'at', p: [r3(x.pb[0]), r3(x.pb[1])]}, x.type === 'arc' ? {bend: r3(x.bend)} : {}));
    } else out.push(g.mk(g.idx));
  });
  out.forEach(s => { if (style) s.step = style; });
  // 動かない人は向きだけ（進行方向のまま）
  const byFace = new Map();
  still.forEach(i => { const d = r3(Math.round(head[i] * 2) / 2); (byFace.get(d) || byFace.set(d, []).get(d)).push(i); });
  byFace.forEach((idx, d) => out.push(mkStmt(idx, {kind: 'attr'}, {face: d})));
  return out;
}

// 先頭セット（隊形）: 人の並びを直線にまとめられるところはまとめる
function formationStmts(pos, rankGroups, style) {
  const out = [], done = new Set();
  rankGroups.forEach(g => {
    const idx = g.filter(i => !done.has(i));
    if (idx.length >= 3) {
      const a = pos[idx[0]], b = pos[idx[idx.length - 1]], L = dist(a, b), c = unit(sub(b, a)), step = L / (idx.length - 1);
      let ok = L > 1e-6;
      idx.forEach((i, k) => {
        const e = [a[0] + c[0] * step * k, a[1] + c[1] * step * k];
        if (dist(e, pos[i]) > 0.004) ok = false;
      });
      if (ok) { out.push(mkStmt(idx, {kind: 'line', a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])]}, {assign: 'keep'})); idx.forEach(i => done.add(i)); }
    }
  });
  for (let i = 0; i < pos.length; i++) if (!done.has(i)) out.push(mkStmt([i], {kind: 'at', p: [r3(pos[i][0]), r3(pos[i][1])]}));
  out.forEach(s => { if (style) s.step = style; });
  return out;
}

// フェーズの並び → セットの並び（人は通し番号 idx のまま）
// phase: {type:'move', T, pos(i,t), label} | {type:'turn', T, d(度), label} | {type:'hold', H, label, front}
//        {type:'sets', sets:[{counts, stmts, label}], pos0(i), end(i), headEnd(i)}
function compilePhases(phases, N, cfg, rankGroups) {
  const sets = [];
  let head = new Array(N).fill(0), started = false, cur = null;
  const setHead = (f, T) => {
    for (let i = 0; i < N; i++) {
      const p1 = f(i, T), p0 = f(i, T - 0.05);
      if (dist(p0, p1) > 1e-4) head[i] = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) / D2R;
    }
  };
  for (let ph of phases) {
    if (ph.type === 'move') {
      { // 長さは偶数カウントに（少しだけゆっくりにして合わせる）
        const T2 = Math.max(2, 2 * Math.ceil(ph.T / 2 - 1e-9)), k = ph.T / T2, f0 = ph.pos, lf0 = ph.labelFn;
        if (Math.abs(T2 - ph.T) > 1e-9) ph = Object.assign({}, ph, {T: T2, pos: (i, t) => f0(i, t * k), labelFn: lf0 ? (a, b) => lf0(a * k, b * k) : null});
      }
      if (!started) {
        cur = []; for (let i = 0; i < N; i++) cur.push(ph.pos(i, 0));
        sets.push({counts: 0, hold: 0, mark: false, label: ph.firstLabel || '整列', stmts: formationStmts(cur, rankGroups, cfg.style)});
        started = true; setHead(ph.pos, 0.2);
      }
      let sl = null;
      for (const tl of (cfg.tols || [cfg.tol])) { sl = sliceMotion(ph.pos, N, Math.round(ph.T), cfg, tl); if (checkSlices(sl, N, cfg.chk).ok) break; }
      sl.forEach((s, k) => {
        const h2 = head.slice();
        for (let i = 0; i < N; i++) { const p1 = ph.pos(i, s.b), p0 = ph.pos(i, s.b - 0.05); if (dist(p0, p1) > 1e-4) h2[i] = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) / D2R; }
        head = h2;
        sets.push({counts: s.b - s.a, hold: 0, mark: false, label: ph.labelFn ? ph.labelFn(s.a, s.b) : (ph.label || ''), dev: s.dev, stmts: stmtsOf(s, head.map(h => h + 90), cfg.style)});
      });
      cur = []; for (let i = 0; i < N; i++) cur.push(ph.pos(i, Math.round(ph.T)));
    } else if (ph.type === 'turn') {
      head = head.map(h => h + ph.d);
      const byFace = new Map();
      for (let i = 0; i < N; i++) { const d = r3(norm180(head[i] + 90)); (byFace.get(d) || byFace.set(d, []).get(d)).push(i); }
      const stmts = []; byFace.forEach((idx, d) => stmts.push(mkStmt(idx, {kind: 'attr'}, {face: d})));
      sets.push({counts: ph.T, hold: 0, mark: false, label: ph.label || '向きを変える', stmts});
    } else if (ph.type === 'hold') {
      const byFace = new Map();
      for (let i = 0; i < N; i++) { const d = ph.front ? 0 : r3(norm180(head[i] + 90)); (byFace.get(d) || byFace.set(d, []).get(d)).push(i); }
      const stmts = []; byFace.forEach((idx, d) => stmts.push(mkStmt(idx, {kind: 'attr'}, {face: d})));
      if (ph.front) head = head.map(() => -90);
      sets.push({counts: 0, hold: ph.H, mark: ph.mark !== false, label: ph.label || '足踏み', stmts});
    } else if (ph.type === 'sets') {
      if (!started) {
        cur = []; for (let i = 0; i < N; i++) cur.push(ph.pos0(i));
        sets.push({counts: 0, hold: 0, mark: false, label: ph.firstLabel || '整列', stmts: formationStmts(cur, rankGroups, cfg.style)});
        started = true;
      }
      ph.sets.forEach(s => sets.push(Object.assign({hold: 0, mark: false}, s)));
      for (let i = 0; i < N; i++) head[i] = ph.headEnd(i);
      cur = []; for (let i = 0; i < N; i++) cur.push(ph.end(i));
    }
  }
  return {sets, end: cur, head};
}

// ================= Hungarian（今の位置から近い順に割り当てる） =================
function hungarian(cost) {
  const n = cost.length, INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Array(n);
  for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
  return ans; // ans[i] = 行 i に割り当てられた列
}


// ================= パターン =================
// ctx（単位はフィールド単位）: V 会場, N 人数, w 左右の間隔, d 前後の間隔, vt 1カウントの歩幅, gmin 前後の最小間隔,
//   F 列数(null=自動), fill, laps, ccw, start, course:{type,margin,pts}, margin, halt, notes[]
class Infeasible extends Error { constructor(m) { super(m); this.infeasible = true; } }
const fileCandidates = (F0, N) => {
  const out = [], mx = Math.min(N, 10);
  for (let k = 0; k <= 10; k++) for (const F of k ? [F0 - k, F0 + k] : [F0]) if (F >= 1 && F <= mx && !out.includes(F)) out.push(F);
  return out;
};
const autoFiles = N => Math.max(1, Math.min(8, Math.round(Math.sqrt(N / 1.6))));
function slotsOf(ctx, F, opt) {
  const lay = opt && opt.wedge ? layoutWedge(ctx.N, opt.cap) : layoutBlock(ctx.N, F, ctx.fill);
  return lay.map(s => ({rank: s.rank, u: s.u * ctx.w}));
}
const extOf = slots => { const us = slots.map(s => s.u); return {uMax: Math.max(...us), uMin: Math.min(...us), uExt: Math.max(Math.abs(Math.max(...us)), Math.abs(Math.min(...us)))}; };
function startPoint(ctx, box) {
  const s = ctx.start || {side: 'front'};
  if (s.pt) return s.pt;
  const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
  return {front: [mx, box.y0], back: [mx, box.y1], left: [box.x0, my], right: [box.x1, my]}[s.side] || [mx, box.y0];
}
const rectCorners = (b, ccw) => { const c = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]; return ccw ? c : c.slice().reverse(); };
// 閉じたコース（会場の外周・楕円・自分で描いた点）を、角の半径 r で丸めた道にする
function loopSegs(ctx, box, r, rneed) {
  const c = ctx.course || {type: 'perimeter'};
  let segs;
  if (c.type === 'custom' && c.pts && c.pts.length >= 3) {
    const pts = c.pts.map(p => p.slice());
    const ar = pts.reduce((a, p, i) => a + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
    const isCcw = ar > 0;
    segs = roundedPoly(isCcw === ctx.ccw ? pts : pts.slice().reverse(), r);
  } else if (c.type === 'oval') {
    const half = Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2;
    segs = roundedPoly(rectCorners(box, ctx.ccw), half);
  } else segs = roundedPoly(rectCorners(box, ctx.ccw), r);
  segs.forEach(sg => { if (sg.t === 'A' && sg.r < rneed * 0.97) throw new Infeasible('corner'); });
  return segs;
}
const loopLen = segs => segs.reduce((a, s) => a + s.len, 0);

// 周回（ゲート／ウィール／くさび／客席前停止）の共通部分
function loopTry(ctx, F, opt) {
  const slots = slotsOf(ctx, F, opt), {uMax, uMin, uExt} = extOf(slots);
  const {V, w, d, vt} = ctx, tau = d / vt;
  const marg = ctx.margin || 0;
  const box = shrink(V.area, uExt + V.inset + marg);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  if (bw < 3 || bh < 3) throw new Infeasible('box');
  const rneed = needRadius(uMax, uMin, d, ctx.gmin), half = Math.min(bw, bh) / 2;
  if (rneed * 1.02 > half && (!ctx.course || ctx.course.type !== 'custom')) throw new Infeasible('radius');
  const r = opt.corner === 'gate' ? rneed * 1.04 : Math.min(half, Math.max(rneed * 1.12, Math.min(half * 0.9, 0.3 * Math.min(bw, bh) + uExt)));
  let segs = opt.segsFn ? opt.segsFn(ctx, box, rneed, slots) : loopSegs(ctx, box, r, rneed);
  if (!opt.segsFn) segs = pathFrom(segs, startPoint(ctx, box));
  const L = loopLen(segs), maxRank = Math.max(...slots.map(s => s.rank));
  const colLen = maxRank * d;
  if (colLen + 2 > L - 2 || (opt.fitCol && colLen + opt.fitCol(segs, L) > L)) throw new Infeasible('long');
  let tr;
  try { tr = makeTrain({segs, closed: true, laps: ctx.laps || 1, slots, tau, vt}); } catch (e) { if (e.message === 'tight') throw new Infeasible('tight'); throw e; }
  const groups = [];
  slots.forEach((s, i) => { (groups[s.rank] || (groups[s.rank] = [])).push(i); });
  return {tr, slots, segs, box, r, F, rankGroups: groups.filter(Boolean), L, maxRank, tau, rneed};
}
function loopAny(ctx, opt, pick) {
  const F0 = ctx.F || autoFiles(ctx.N);
  let first = null, err = null;
  const cands = opt.wedge ? [14, 11, 9, 7, 5, 4, 3, 2, 1] : fileCandidates(F0, ctx.N);
  for (const F of cands) {
    try {
      const o2 = opt.wedge ? Object.assign({}, opt, {cap: F}) : opt;
      const res = loopTry(ctx, F, o2);
      if (pick && !pick(res)) { if (!first) first = res; continue; }
      if (opt.wedge) res.cap = F;
      if (!opt.wedge && F !== F0 && !ctx.F) ctx.notes.push(`会場の広さに合わせて ${F} 列にしました`);
      else if (!opt.wedge && F !== F0) ctx.notes.push(`${F0}列では収まらないため ${F} 列にしました`);
      return res;
    } catch (e) { if (!e.infeasible) throw e; err = e; }
  }
  if (first) return first;
  throw new Infeasible('このコースには収まりません（人数・列数・間隔を減らすか、会場を広げてください）');
}
const trainPhase = (res, T0, T1, label) => ({
  type: 'move', T: T1 - T0, pos: (i, t) => res.tr.pos(i, T0 + t), label,
  labelFn: (a, b) => { let arc = false; for (let k = 0; k <= 4; k++) if (res.tr.arcAt(T0 + a + (b - a) * k / 4)) arc = true; return arc ? 'コーナー' : '直進'; }
});

// --- 外周を一周（ゲートターン / ウィール）
function patLoop(corner) {
  return ctx => {
    const res = loopAny(ctx, {corner});
    return {phases: [trainPhase(res, 0, res.tr.T)], rankGroups: res.rankGroups, info: {F: res.F, ranks: res.maxRank + 1, loop: true, lead: [0]}};
  };
}
// --- くさび形
function patWedge(ctx) {
  const res = loopAny(ctx, {corner: 'wheel', wedge: true});
  return {phases: [trainPhase(res, 0, res.tr.T)], rankGroups: res.rankGroups, info: {F: res.cap, ranks: res.maxRank + 1, loop: true, lead: [0]}};
}
// --- 客席前で止まる（パス・イン・レビュー）
function patReview(ctx) {
  const res = loopAny(ctx, {corner: 'wheel'}, r => {
    const front = r.segs.reduce((m, s) => s.t === 'L' ? Math.max(m, s.orig || s.len) : m, 0);
    return r.maxRank * ctx.d <= front - 1;
  });
  const T = res.tr.T, th = Math.round(res.maxRank / 2 * res.tau), H = Math.max(4, Math.round(ctx.halt || 16));
  const turn = ctx.ccw ? -90 : 90;
  const labelFn = (a, b) => 'パレード';
  const phases = [
    Object.assign(trainPhase(res, 0, th), {firstLabel: '整列'}),
    {type: 'turn', T: 2, d: turn, label: '客席へ向く（横一列）'},
    {type: 'hold', H, label: '客席前で足踏み（演奏）', mark: true},
    {type: 'turn', T: 2, d: -turn, label: '進行方向へ向き直る'},
    trainPhase(res, th, T, '')
  ];
  return {phases, rankGroups: res.rankGroups, info: {F: res.F, ranks: res.maxRank + 1, loop: true, haltCounts: H, lead: [0]}};
}


// --- 8の字（列がまんなかで交差する）
function eightSegs(ctx, box, rneed, slots) {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const rho = Math.min(bh / 2, bw / 2 / 2.2);
  if (rho < rneed * 1.02) throw new Infeasible('eight');
  const c = bw / 2 - rho, al = Math.asin(rho / c), ca = Math.cos(al), sa = Math.sin(al);
  const Q = [c * ca * ca, c * ca * sa], Qb = [c * ca * ca, -c * ca * sa];
  const cR = [c, 0], cL = [-c, 0], up = a => a, mir = ctx.ccw ? 1 : -1;
  const ang = (p, q) => Math.atan2(p[1] - q[1], p[0] - q[0]);
  const sw = (a0, a1, cw) => { let da = a1 - a0; if (cw) { while (da > 0) da -= 2 * PI; } else { while (da < 0) da += 2 * PI; } return da; };
  const QLu = [-Q[0], Q[1]], QLl = [-Q[0], -Q[1]];
  let segs = [segL([0, 0], Q), segA(cR, rho, ang(Q, cR), sw(ang(Q, cR), ang(Qb, cR), true)), segL(Qb, QLu), segA(cL, rho, ang(QLu, cL), sw(ang(QLu, cL), ang(QLl, cL), false)), segL(QLl, [0, 0])];
  // 左右反転（時計回り用）: x を符号反転すると向きも反転するので、反転後に並びを逆にする
  const tr = p => [cx + p[0], cy + p[1]];
  const mv = sg => sg.t === 'L' ? segL(tr(sg.a), tr(sg.b)) : segA(tr(sg.c), sg.r, sg.a0, sg.da);
  segs = segs.map(mv);
  if (!ctx.ccw) { // y を反転して逆向きにする
    segs = segs.map(sg => sg.t === 'L' ? segL([sg.a[0], 2 * cy - sg.a[1]], [sg.b[0], 2 * cy - sg.b[1]]) : segA([sg.c[0], 2 * cy - sg.c[1]], sg.r, -sg.a0, -sg.da));
  }
  segs.forEach(x => { x.orig = x.len; });
  return segs;
}
function patEight(ctx) {
  const res = loopAny(ctx, {corner: 'wheel', segsFn: eightSegs, fitCol: (segs, L) => 4});
  // 交差点で列が自分とぶつからないよう、列の長さは一周の半分より短いことを確認済み
  const L = res.L, col = res.maxRank * ctx.d;
  if (col + 4 > L / 2) throw new Infeasible('このコースには収まりません（8の字は列が短いほうが向いています。人数か列の間隔を減らしてください）');
  return {phases: [trainPhase(res, 0, res.tr.T)], rankGroups: res.rankGroups, info: {F: res.F, ranks: res.maxRank + 1, loop: true, lead: [0]}};
}

// --- 剛体ブロック（隊形を保ったまま平行移動し、角では向きだけ変える）: 直角フランク
function patFlank(ctx) {
  const {V, w, d, vt} = ctx, marg = ctx.margin || 0;
  const F0 = ctx.F || autoFiles(ctx.N);
  for (const F of fileCandidates(F0, ctx.N)) {
    const slots = slotsOf(ctx, F), {uExt} = extOf(slots), maxRank = Math.max(...slots.map(s => s.rank));
    const ex = maxRank * d / 2, box = {x0: V.area.x0 + V.inset + marg + ex, x1: V.area.x1 - V.inset - marg - ex, y0: V.area.y0 + V.inset + marg + uExt, y1: V.area.y1 - V.inset - marg - uExt};
    if (box.x1 - box.x0 < 3 || box.y1 - box.y0 < 3) continue;
    if (F !== F0) ctx.notes.push(`会場の広さに合わせて ${F} 列にしました`);
    const th0 = ctx.ccw ? 0 : PI, mx = (box.x0 + box.x1) / 2;
    const off = slots.map(sl => { const fwd = (maxRank / 2 - sl.rank) * d; return [fwd * Math.cos(th0) - sl.u * Math.sin(th0), fwd * Math.sin(th0) + sl.u * Math.cos(th0)]; });
    const pts = ctx.ccw ? [[mx, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1], [box.x0, box.y0], [mx, box.y0]]
      : [[mx, box.y0], [box.x0, box.y0], [box.x0, box.y1], [box.x1, box.y1], [box.x1, box.y0], [mx, box.y0]];
    const phases = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], len = dist(a, b), T = Math.max(1, ceilN(len / vt));
      phases.push({type: 'move', T, label: '直進（隊形のまま）', pos: (i, t) => { const f = t / T; return [a[0] + (b[0] - a[0]) * f + off[i][0], a[1] + (b[1] - a[1]) * f + off[i][1]]; }});
      if (k + 2 < pts.length) phases.push({type: 'turn', T: 2, d: ctx.ccw ? 90 : -90, label: '角で全員 90° 方向転換（フランク）'});
    }
    const groups = []; slots.forEach((s, i) => { (groups[s.rank] || (groups[s.rank] = [])).push(i); });
    return {phases, rankGroups: groups.filter(Boolean), info: {F, ranks: maxRank + 1, loop: true, lead: [0]}};
  }
  throw new Infeasible('このコースには収まりません（人数・列数・間隔を減らすか、会場を広げてください）');
}

// --- 2隊に分かれて逆回り → 反対側で合流
function patSplit(ctx) {
  const {V, w, d, vt} = ctx, marg = ctx.margin || 0;
  const F0 = ctx.F || autoFiles(ctx.N);
  const cand = fileCandidates(Math.max(2, F0), ctx.N).filter(F => F >= 2);
  for (const F of cand) {
    const lay = layoutBlock(ctx.N, F, ctx.fill);
    const A = [], B = [];
    lay.forEach((s, i) => { (s.u >= 0 ? A : B).push(i); });
    if (!A.length || !B.length) continue;
    const mk = (idxs, sgn) => { // 群の中での左右位置 u'（群の中心からのずれ）
      const us = idxs.map(i => lay[i].u * w), mid = (Math.max(...us) + Math.min(...us)) / 2;
      return {idxs, slots: idxs.map(i => ({rank: lay[i].rank, u: lay[i].u * w - mid})), mid, hw: (Math.max(...us) - Math.min(...us)) / 2};
    };
    const gA = mk(A), gB = mk(B);
    const tmp = loopTryGroups([gA, gB], ctx, marg, d, vt);
    if (!tmp) continue;
    if (F !== F0) ctx.notes.push(`会場の広さに合わせて ${F} 列にしました`);
    return tmp;
  }
  throw new Infeasible('このコースには収まりません（人数・列数・間隔を減らすか、会場を広げてください）');
}
function loopTryGroups(gs, ctx, marg, d, vt) {
  const {V, w} = ctx;
  const extMax = Math.max(...gs.map(g => extOf(g.slots).uExt));
  const rneed = Math.max(...gs.map(g => { const e = extOf(g.slots); return needRadius(e.uMax, e.uMin, d, ctx.gmin); }));
  const box = shrink(V.area, extMax + V.inset + marg);
  const mid = (box.x0 + box.x1) / 2;
  // 中央の2車線: 左(A)は x = -(hwA + w/2)、右(B)は +(hwB + w/2)
  const hwA = gs[0].hw, hwB = gs[1].hw;
  const xA = mid - (w / 2 + hwA), xB = mid + (w / 2 + hwB);
  const wLoop = Math.min(xA - box.x0, box.x1 - xB);
  if (wLoop < rneed * 1.05 * 2 || box.y1 - box.y0 < 6) return null;
  const maxRank = Math.max(...gs.map(g => Math.max(...g.slots.map(s => s.rank))));
  const tau = d / vt;
  const mkLoop = (xl, xr, ccw) => { // 左右が [xl,xr] の長方形を一周する（xr 側が中央の車線）
    const r = Math.min(rneed * 1.06, (xr - xl) / 2 - 0.01, (box.y1 - box.y0) / 2 - 0.01);
    if (r < rneed) throw new Infeasible('radius');
    const c = [[xl, box.y0], [xr, box.y0], [xr, box.y1], [xl, box.y1]];
    return roundedPoly(ccw ? c : c.slice().reverse(), r);
  };
  const trs = [];
  const eG = gs.map(g => extOf(g.slots)), cext = {uMax: Math.max(...eG.map(e => e.uMax)), uMin: Math.min(...eG.map(e => e.uMin))};
  try {
    gs.forEach((g, k) => {
      const left = (k === 0);
      const xl = left ? xA - wLoop : xB, xr = left ? xA : xB + wLoop, lane = left ? xA : xB;
      const ccw = left;
      let segs = mkLoop(xl, xr, ccw);
      const colLen = Math.max(...g.slots.map(s => s.rank)) * d, ys = Math.min(box.y1 - 1, box.y0 + colLen + 1.5);
      segs = pathFrom(segs, [lane, ys]);
      if (loopLen(segs) < colLen + 6) throw new Infeasible('long');
      trs.push(makeTrain({segs, closed: true, laps: ctx.laps || 1, slots: g.slots, tau, vt, ext: cext}));
    });
  } catch (e) { if (e.infeasible || e.message === 'tight') return null; throw e; }
  const T = Math.max(trs[0].T, trs[1].T), who = new Array(ctx.N), loc = new Array(ctx.N);
  gs.forEach((g, k) => g.idxs.forEach((i, j) => { who[i] = k; loc[i] = j; }));
  const phases = [{type: 'move', T, pos: (i, t) => trs[who[i]].pos(loc[i], t), label: '2隊に分かれて逆回り',
    labelFn: (a, b) => { let arc = false; for (let q = 0; q <= 4; q++) if (trs[0].arcAt(a + (b - a) * q / 4)) arc = true; return arc ? '2隊でコーナー' : '2隊で直進'; }}];
  const groups = [];
  const lay = []; gs.forEach(g => g.idxs.forEach((i, j) => { lay[i] = g.slots[j].rank; }));
  const byRank = []; for (let i = 0; i < ctx.N; i++) (byRank[lay[i]] || (byRank[lay[i]] = [])).push(i);
  // 行ごとの並び順は左→右（u の大きい順）
  return {phases, rankGroups: [], info: {F: null, ranks: maxRank + 1, loop: true, lead: [0], groups: 2}};
}

// --- カウンターマーチ（往復）: 左右に割れて外側を折り返し、最後に隊形へ戻る
function patCounter(ctx) {
  const {V, w, d, vt} = ctx, marg = ctx.margin || 0, tau = d / vt;
  const F0 = Math.max(2, ctx.F || autoFiles(ctx.N));
  for (const F of fileCandidates(F0, ctx.N).filter(F => F >= 2)) {
    const lay = layoutBlock(ctx.N, F, ctx.fill), A = [], B = [];
    lay.forEach((s, i) => { (s.u >= 0 ? A : B).push(i); });
    if (!A.length || !B.length) continue;
    const grp = idxs => { const us = idxs.map(i => lay[i].u * w), mid = (Math.max(...us) + Math.min(...us)) / 2; return {idxs, mid, hw: (Math.max(...us) - Math.min(...us)) / 2, slots: idxs.map(i => ({rank: lay[i].rank, u: lay[i].u * w - mid}))}; };
    const gA = grp(A), gB = grp(B), maxRank = Math.max(...lay.map(s => s.rank));
    const eA = extOf(gA.slots), eB = extOf(gB.slots);
    const Rr = Math.max(needRadius(eA.uMax, eA.uMin, d, ctx.gmin), needRadius(eB.uMax, eB.uMin, d, ctx.gmin), gA.hw + 0.9, gB.hw + 0.9) * 1.06;
    const Wtot = (Math.max(...lay.map(s => s.u)) - Math.min(...lay.map(s => s.u))) * w;
    const swapXY = V.area.y1 - V.area.y0 > V.area.x1 - V.area.x0 && V.type !== 'gym'; // 長い方向に沿って進む
    // 進行方向 +x（横長の会場）。縦長の会場は未対応（回転して作る）
    const ox0 = V.area.x0 + V.inset + marg, ox1 = V.area.x1 - V.inset - marg;
    const oy0 = V.area.y0 + V.inset + marg, oy1 = V.area.y1 - V.inset - marg;
    const cy = (oy0 + oy1) / 2, spanY = Wtot + 4 * Rr + 2 * 0.0;
    const colLen = maxRank * d;
    const xa = ox0, xt = ox1 - Rr - 0.5;
    if (spanY > oy1 - oy0 + 1e-6 || xt - (xa + colLen) < 6) continue;
    // 先頭の x: 発進位置 xa+colLen、折り返し点 xt、帰りの先頭は xa まで
    const mkPath = (yc, left) => { // left=true: 左（+y）側の群、左回りに折り返す
      const sg = left ? 1 : -1;
      const a = [xa + colLen, yc], b = [xt, yc];
      const c0 = [xt, yc + sg * Rr];
      const arc = segA(c0, Rr, -sg * PI / 2, sg * PI);
      const e = [xa, yc + sg * 2 * Rr];
      const segs = [segL(a, b), arc, segL([xt, yc + sg * 2 * Rr], e)];
      segs.forEach(x => { x.orig = x.len; });
      return segs;
    };
    const yA = cy + gA.mid, yB = cy + gB.mid;
    let trs;
    try {
      const ext = {uMax: Math.max(eA.uMax, eB.uMax), uMin: Math.min(eA.uMin, eB.uMin)};
      trs = [makeTrain({segs: mkPath(yA, true), closed: false, slots: gA.slots, tau, vt, ext}), makeTrain({segs: mkPath(yB, false), closed: false, slots: gB.slots, tau, vt, ext})];
    } catch (e) { if (e.message === 'tight') continue; throw e; }
    // 帰りの車線を、もとの隊形の位置へ戻す平行移動
    const shiftA = -2 * Rr, shiftB = 2 * Rr, T1 = Math.max(trs[0].T, trs[1].T);
    const closeT = Math.max(2, ceilN(2 * Rr / vt));
    const who = new Array(ctx.N), loc = new Array(ctx.N);
    [gA, gB].forEach((g, k) => g.idxs.forEach((i, j) => { who[i] = k; loc[i] = j; }));
    const endPos = i => trs[who[i]].pos(loc[i], T1);
    if (F !== F0) ctx.notes.push(`会場の広さに合わせて ${F} 列にしました`);
    // 先頭セットの並び: 発進時は先頭が +x、ランクは後ろ（-x）
    const groups = []; lay.forEach((s, i) => { (groups[s.rank] || (groups[s.rank] = [])).push(i); });
    const phases = [
      {type: 'move', T: T1, pos: (i, t) => trs[who[i]].pos(loc[i], t), label: '左右に割れて折り返し',
       labelFn: (a, b) => { let arc = false; for (let q = 0; q <= 4; q++) if (trs[0].arcAt(a + (b - a) * q / 4) || trs[1].arcAt(a + (b - a) * q / 4)) arc = true; return arc ? 'カウンターマーチ（折り返し）' : '直進'; }},
      {type: 'move', T: closeT, pos: (i, t) => { const p = endPos(i), sh = who[i] === 0 ? shiftA : shiftB; return [p[0], p[1] + sh * (t / closeT)]; }, label: '左右から中央へ寄って隊形に戻る'}
    ];
    return {phases, rankGroups: groups.filter(Boolean), info: {F, ranks: maxRank + 1, loop: false, lead: [0], back: true}};
  }
  throw new Infeasible('このコースには収まりません（人数・列数・間隔を減らすか、会場を広げてください）');
}

// --- 蛇行（サーペンタイン）
function patSerpentine(ctx) {
  const {V, w, d, vt} = ctx, marg = ctx.margin || 0, tau = d / vt;
  const F0 = Math.min(ctx.F || autoFiles(ctx.N), 4);
  const cands = fileCandidates(F0, ctx.N).filter(F => F <= 7);
  let fallback = null;
  for (const F of cands) {
    const slots = slotsOf(ctx, F), e = extOf(slots), maxRank = Math.max(...slots.map(s => s.rank)), colLen = maxRank * d;
    const rho = needRadius(e.uMax, e.uMin, d, ctx.gmin) * 1.08;
    const box = shrink(V.area, e.uExt + V.inset + marg);
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0, legLen = bw - 2 * rho;
    const n = Math.min(4, Math.floor(bh / (2 * rho)) + 1);
    if (n < 2 || legLen < colLen + 2) continue;
    const cand = {F, slots, e, maxRank, colLen, rho, box, bh, legLen, n};
    if (n >= 3) { fallback = cand; break; }
    if (!fallback) fallback = cand;
  }
  if (!fallback) return serpentineFile(ctx);
  const {F, slots, colLen, box, bh, n, maxRank} = fallback;
  if (F !== F0 && !ctx.F) ctx.notes.push(`会場の広さに合わせて ${F} 列にしました`);
  const rho = fallback.rho0 = Math.max(fallback.rho, bh / (2 * (n - 1)) * (n >= 4 ? 0.92 : 0.8));
  const y0 = box.y0 + (bh - (n - 1) * 2 * rho) / 2, dir0 = ctx.ccw ? 1 : -1;
  const segs = [];
  let cur = [(dir0 > 0 ? box.x0 + rho : box.x1 - rho) + dir0 * (colLen + 1), y0];
  for (let k = 0; k < n; k++) {
    const dir = (k % 2 === 0) ? dir0 : -dir0, endX = dir > 0 ? box.x1 - rho : box.x0 + rho;
    segs.push(segL(cur, [endX, cur[1]]));
    if (k < n - 1) { segs.push(segA([endX, cur[1] + rho], rho, -PI / 2, dir > 0 ? PI : -PI)); cur = [endX, cur[1] + 2 * rho]; }
  }
  segs.forEach(sg => { sg.orig = sg.len; });
  const tr = makeTrain({segs, closed: false, slots, tau, vt});
  const groups = []; slots.forEach((s, i) => { (groups[s.rank] || (groups[s.rank] = [])).push(i); });
  return {phases: [trainPhase({tr}, 0, tr.T, '蛇行')], rankGroups: groups.filter(Boolean), info: {F, ranks: maxRank + 1, loop: false, lead: [0]}};
}

// 列が広くて収まらないとき: 1本の列（follow）で蛇行する
function serpentineFile(ctx) {
  const {V, vt} = ctx, N = ctx.N, marg = ctx.margin || 0;
  const sp = Math.max(1.2 * (ctx.k || 1) / V.mpu, V.cl * 1.35 + 0.1 / V.mpu);
  const box = shrink(V.area, V.inset + marg + 0.5), bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const rho = Math.max(1.7 / V.mpu, V.cl * 2.6);
  const n = Math.min(4, Math.floor(bh / (2 * rho)) + 1), colLen = (N - 1) * sp;
  if (n < 3 || bw - 2 * rho < 4) throw new Infeasible('このコースには収まりません（人数・列数・間隔を減らすか、会場を広げてください）');
  const y0 = box.y0 + (bh - (n - 1) * 2 * rho) / 2, dir0 = ctx.ccw ? 1 : -1, segs = [];
  let cur = [dir0 > 0 ? box.x0 + rho : box.x1 - rho, y0];
  for (let k = 0; k < n; k++) {
    const dir = (k % 2 === 0) ? dir0 : -dir0, endX = dir > 0 ? box.x1 - rho : box.x0 + rho;
    segs.push(segL(cur, [endX, cur[1]]));
    if (k < n - 1) { segs.push(segA([endX, cur[1] + rho], rho, -PI / 2, dir > 0 ? PI : -PI)); cur = [endX, cur[1] + 2 * rho]; }
  }
  segs.forEach(sg => { sg.orig = sg.len; });
  const path = arcPath(segs, false, 1), L = path.L, first = segs[0].len;
  // 先頭は最初の直線の上で、列の全長ぶん進んだ所から出発（列は直線の上に並ぶ）。収まらなければ折り返しの輪を使う
  if (colLen > L * 0.55) throw new Infeasible('このコースには収まりません（人数・列数・間隔を減らすか、会場を広げてください）');
  const shift = colLen;
  const ph = openFollow(ctx, path, shift, sp, N, '蛇行の入り口に整列');
  ctx.notes.push(colLen > first - 0.1 ? '人数が多いので、1本の列が蛇行の途中まで伸びた形から始めます' : '列が広くて収まらないため、1本の列で蛇行します');
  return {phases: [ph], rankGroups: [Array.from({length: N}, (_, i) => i)], info: {F: 1, ranks: N, loop: false, lead: [0], follow: true, path: path.segs.length ? [] : []}};
}
// 開いた道を、s = shift を先頭の出発点として follow の並びにする
function openFollow(ctx, path, shift, sp, N, firstLabel, labelFn) {
  const pathS = {at: s => path.at(s + shift)};
  return followPhaseLine(ctx, pathS, sp, N, path.L - shift, firstLabel, labelFn);
}
// ================= フォロー型（1本の列が先頭の通った道をたどる） =================
// 道: segs（直線・円弧の列）を s（距離）で引く。s<0 は列の後ろ（閉じた道なら一周前）
function arcPath(segs, closed, laps) {
  const cum = [0]; segs.forEach(sg => cum.push(cum[cum.length - 1] + sg.len));
  const L = cum[cum.length - 1];
  const loc = s => {
    if (closed) s = ((s % L) + L) % L; else s = Math.max(0, Math.min(L, s));
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    return {sg: segs[lo], x: Math.min(segs[lo].len, s - cum[lo])};
  };
  return {L, cum, segs, closed, total: L * (closed ? laps : 1), at(s) { const q = loc(s); return segAt(q.sg, q.x, 0); },
    // s 区間の通過点（直線は端だけ、円弧は 12° ごと）
    route(sa, sb) {
      const pts = [this.at(sa).p], step = 12 * D2R;
      const rep = closed ? Math.ceil((sb) / L) + 1 : 1;
      for (let lap = Math.floor(sa / L) * (closed ? 1 : 0); lap < (closed ? rep : 1); lap++) {
        segs.forEach((sg, k) => {
          const g0 = (closed ? lap * L : 0) + cum[k], g1 = g0 + sg.len;
          if (g1 <= sa + 1e-6 || g0 >= sb - 1e-6) return;
          if (sg.t === 'A') { const nA = Math.max(1, Math.ceil(Math.abs(sg.da) / step)); for (let q = 1; q < nA; q++) { const g = g0 + sg.len * q / nA; if (g > sa + 1e-6 && g < sb - 1e-6) pts.push(this.at(g).p); } }
          if (g1 < sb - 1e-6 && g1 > sa + 1e-6) pts.push(this.at(g1).p);
        });
      }
      pts.push(this.at(sb).p);
      return pts;
    }};
}
function followPhase(ctx, path, sp, N, firstLabel) {
  const vt = ctx.vt, Lt = 32 * vt;
  // 区切り: 区間（直線・円弧）の境目と、長すぎるものの分割
  const pieces = [];
  const reps = path.closed ? (ctx.laps || 1) : 1;
  for (let lap = 0; lap < reps; lap++) path.segs.forEach((sg, k) => {
    const g0 = lap * path.L + path.cum[k], n = Math.max(1, Math.ceil(sg.len / Lt));
    for (let q = 0; q < n; q++) pieces.push({s0: g0 + sg.len * q / n, s1: g0 + sg.len * (q + 1) / n});
  });
  const chunks = []; let cur = null;
  pieces.forEach(p => {
    if (cur && (cur.s1 - cur.s0) + (p.s1 - p.s0) > Lt * 1.1) { chunks.push(cur); cur = null; }
    if (!cur) cur = {s0: p.s0, s1: p.s1}; else cur.s1 = p.s1;
  });
  if (cur) chunks.push(cur);
  // engine の follow は「経路の長さ ≥ 列の長さ」でないと後ろの人が先頭の出発点に溜まるので、
  // 経路の長さで入る人数ごとのブロックに分け、ブロックごとに（同じ長さだけ進む）follow にする
  const sets = chunks.map(ch => {
    const len = ch.s1 - ch.s0, n = Math.max(2, Math.ceil(ceilN(len / vt) / 2) * 2), K = Math.max(1, Math.floor(len / sp + 1e-9) + 1), stmts = [];
    for (let b = 0; b * K < N; b++) {
      const idx = []; for (let i = b * K; i < Math.min(N, (b + 1) * K); i++) idx.push(i);
      const pts = path.route(ch.s0 - b * K * sp, ch.s1 - b * K * sp).map(p => [r3(p[0]), r3(p[1])]);
      stmts.push(mkStmt(idx, {kind: 'follow', pts, spacing: r3(sp)}, {assign: 'keep', step: ctx.o.style || null}));
    }
    return {counts: n, hold: 0, mark: false, label: '先頭について進む', stmts, sEnd: ch.s1};
  });
  const sEnd = chunks.length ? chunks[chunks.length - 1].s1 : 0;
  return {type: 'sets', sets, pos0: i => path.at(-i * sp).p, end: i => path.at(sEnd - i * sp).p, firstLabel,
    headEnd: i => path.at(sEnd - i * sp).th / D2R};
}
function patFollowLap(ctx) {
  const {V, vt} = ctx, N = ctx.N, marg = ctx.margin || 0;
  const sp = Math.max(1.2 * (ctx.k || 1) / V.mpu, V.cl * 1.35 + 0.1 / V.mpu);
  const box = shrink(V.area, V.inset + marg + 0.5);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0, half = Math.min(bw, bh) / 2;
  const r = Math.min(half, Math.max(2.2 / V.mpu, 0.28 * Math.min(bw, bh)));
  let segs = (ctx.course && ctx.course.type === 'oval') ? roundedPoly(rectCorners(box, ctx.ccw), half) : loopSegs(Object.assign({}, ctx, {course: ctx.course && ctx.course.type === 'custom' ? ctx.course : {type: 'perimeter'}}), box, r, 0);
  segs = pathFrom(segs, startPoint(ctx, box));
  const L = loopLen(segs);
  if ((N - 1) * sp + 3 > L - 2) throw new Infeasible('このコースには収まりません（一本の列が長すぎます。人数を減らすか、会場を広げてください）');
  const path = arcPath(segs, true, ctx.laps || 1);
  const ph = followPhase(ctx, path, sp, N, '一本の列で整列');
  return {phases: [ph], rankGroups: [Array.from({length: N}, (_, i) => i)], info: {F: 1, ranks: N, loop: true, lead: [0], follow: true}};
}
// --- うずまき（スパイラル）で中央へ → ほどけて戻る
function patSpiral(ctx) {
  const {V, vt} = ctx, N = ctx.N, marg = ctx.margin || 0;
  const sp = Math.max(1.2 * (ctx.k || 1) / V.mpu, V.cl * 1.35 + 0.1 / V.mpu);
  const box = shrink(V.area, V.inset + marg + 0.5), C = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  const r0 = Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2;
  const pb = Math.max(V.cl * 2.4 + 0.2 / V.mpu, 1.7 / V.mpu), P = 2 * pb;   // となりの輪どうしの間隔 pb
  const turns = Math.max(1, Math.min(2, Math.floor((r0 - pb * 1.6) / P * 2) / 2));
  if (r0 < pb * 1.6 + P || 2 * PI * r0 < (N - 1) * sp + 4) throw new Infeasible('このコースには収まりません（うずまきは広い会場と少ない人数向きです。人数を減らすか、会場を広げてください）');
  const sg = ctx.ccw ? 1 : -1, phi0 = -PI / 2, k = P / (2 * PI), Th = 2 * PI * turns;
  const pts = [];
  const A = th => { const rho = r0 - k * th, ph = phi0 + sg * th; return [C[0] + rho * Math.cos(ph), C[1] + rho * Math.sin(ph)]; };
  const ds = 0.4 / V.mpu;
  // 入り口の輪（列の後ろ）: 円周を逆向きに
  const preLen = (N - 1) * sp + 6, preN = Math.ceil(preLen / ds);
  const pre = [];
  for (let q = preN; q >= 1; q--) { const th = -q * ds / r0; pre.push([C[0] + r0 * Math.cos(phi0 + sg * th), C[1] + r0 * Math.sin(phi0 + sg * th)]); }
  const main = [];
  // 内側へ（媒介変数を弧長でほぼ均等に刻む）
  let th = 0;
  while (th < Th) { main.push(A(th)); const rho = Math.max(0.5, r0 - k * th); th += ds / Math.hypot(rho, k); }
  main.push(A(Th));
  const pa = A(Th), rc = dist(pa, C), e = [(pa[0] - C[0]) / rc, (pa[1] - C[1]) / rc];
  // 中心の S 字: 半径 rc/2 の半円を2つ（同じ向きの接線でつなぐ）
  {
    const nS = Math.max(8, Math.ceil(PI * rc / 2 / ds)), M1 = [C[0] + e[0] * rc / 2, C[1] + e[1] * rc / 2], M2 = [C[0] - e[0] * rc / 2, C[1] - e[1] * rc / 2], f0 = Math.atan2(e[1], e[0]);
    for (let q = 1; q <= nS; q++) { const a = f0 + sg * PI * q / nS; main.push([M1[0] + rc / 2 * Math.cos(a), M1[1] + rc / 2 * Math.sin(a)]); }
    for (let q = 1; q <= nS; q++) { const a = f0 - sg * PI * q / nS; main.push([M2[0] + rc / 2 * Math.cos(a), M2[1] + rc / 2 * Math.sin(a)]); }
  }
  // 外側へ（点対称）
  th = Th; const out = [];
  while (th > 0) { th -= ds / Math.hypot(Math.max(0.5, r0 - k * th), k); const a = A(Math.max(0, th)); out.push([2 * C[0] - a[0], 2 * C[1] - a[1]]); }
  out.forEach(p => main.push(p));
  // 最後は外周を半周して出発点へ
  const last = main[main.length - 1], aL = Math.atan2(last[1] - C[1], last[0] - C[0]);
  const rr = dist(last, C), nR = Math.ceil(PI * rr / ds);
  for (let q = 1; q <= nR; q++) { const a = aL - sg * PI * q / nR; main.push([C[0] + rr * Math.cos(a), C[1] + rr * Math.sin(a)]); }
  const all = pre.concat(main), segs = [];
  for (let q = 0; q + 1 < all.length; q++) { const s2 = segL(all[q], all[q + 1]); if (s2.len > 1e-6) { s2.orig = s2.len; segs.push(s2); } }
  // s=0 は main の先頭
  const preL = pre.length ? (() => { let t = 0; const full = pre.concat([main[0]]); for (let q = 0; q + 1 < full.length; q++) t += dist(full[q], full[q + 1]); return t; })() : 0;
  const path = arcPath(segs, false, 1);
  const shift = preL;
  const pathS = {L: path.L - shift, closed: false, segs: path.segs, cum: path.cum, at: s => path.at(s + shift), route(sa, sb) { return path.route(sa + shift, sb + shift); }};
  pathS.segs = path.segs; pathS.cum = path.cum.map(c => c - shift);
  // followPhase は segs/cum を使って区切るので、s=0 起点に合わせる
  const lenMain = path.L - shift;
  const ph = followPhaseLine(ctx, pathS, sp, N, lenMain, '一本の列で整列', (q, nS) => q < nS / 2 ? '渦の中心へ' : '渦をほどいて戻る');
  return {phases: [ph], rankGroups: [Array.from({length: N}, (_, i) => i)], info: {F: 1, ranks: N, loop: true, lead: [0], follow: true, turns, path: main.filter((_, q) => q % 3 === 0).map(p => [r3(p[0]), r3(p[1])])}};
}
// 折れ線の道（うずまき）用の区切り（等間隔・一定の速さ）
function followPhaseLine(ctx, path, sp, N, len, firstLabel, labelFn) {
  const vt = ctx.vt, nSet = Math.max(1, Math.ceil(len / (32 * vt)));
  const all = []; for (let i = 0; i < N; i++) all.push(i);
  const sets = [];
  for (let q = 0; q < nSet; q++) {
    const s0 = len * q / nSet, s1 = len * (q + 1) / nSet, n = Math.max(2, Math.ceil(ceilN((s1 - s0) / vt) / 2) * 2);
    const K = Math.max(1, Math.floor((s1 - s0) / sp + 1e-9) + 1), stmts = [];
    const stride = Math.max(0.9 / ctx.V.mpu, 0.9);
    for (let b = 0; b * K < N; b++) {
      const idx = []; for (let i = b * K; i < Math.min(N, (b + 1) * K); i++) idx.push(i);
      const m = Math.max(2, Math.ceil((s1 - s0) / stride)), pts = [];
      for (let z = 0; z <= m; z++) { const p = path.at(s0 - b * K * sp + (s1 - s0) * z / m).p; pts.push([r3(p[0]), r3(p[1])]); }
      stmts.push(mkStmt(idx, {kind: 'follow', pts, spacing: r3(sp)}, {assign: 'keep', step: ctx.o.style || null}));
    }
    sets.push({counts: n, hold: 0, mark: false, label: labelFn ? labelFn(q, nSet) : '先頭について進む', stmts});
  }
  return {type: 'sets', sets, pos0: i => path.at(-i * sp).p, end: i => path.at(len - i * sp).p, firstLabel, headEnd: i => path.at(len - i * sp).th / D2R};
}

// --- カンパニーフロント（横一列で客席へ前進）を挟む一周
function patCompany(ctx) {
  const res = loopAny(ctx, {corner: 'wheel'});
  const N = ctx.N, tr = res.tr, {V, vt} = ctx;
  const pos0 = []; for (let i = 0; i < N; i++) pos0.push(tr.pos(i, 0));
  const ymax = Math.max(...pos0.map(p => p[1])), ytop = V.area.y1 - V.inset - 0.2;
  const D = Math.min(ytop - ymax, 18 / V.mpu);
  if (D < vt * 4) throw new Infeasible('このコースには収まりません（奥から客席へ前進する余白がありません。人数・列数を減らすか、会場を広げてください）');
  const T1 = Math.max(4, ceilN(D / vt)), H = Math.max(4, Math.round(ctx.halt || 8));
  const turn = ctx.ccw ? 90 : -90;
  const phases = [
    {type: 'move', T: T1, pos: (i, t) => [pos0[i][0], pos0[i][1] + D * (1 - t / T1)], label: 'カンパニーフロントで客席へ前進', firstLabel: 'カンパニーフロント（客席向き）'},
    {type: 'hold', H, label: '客席前で足踏み', mark: true},
    {type: 'turn', T: 2, d: turn, label: '進行方向へ向きを変える'},
    trainPhase(res, 0, tr.T, ''),
    {type: 'turn', T: 2, d: -turn, label: '客席へ向き直る'}
  ];
  return {phases, rankGroups: res.rankGroups, info: {F: res.F, ranks: res.maxRank + 1, loop: true, lead: [0], front: true, refAfterHold: true}};
}

/*PATTERNS*/


const PATTERNS = [
  {id: 'wheel', name: '外周を一周（ウィール：弧を描いて回る）', short: 'ウィール', icon: 'wheel', loop: true, build: patLoop('wheel'),
   desc: '角をなめらかな弧で回る。横一列を保ったまま、外側ほど大きな弧を描く。いちばん見栄えのする標準の周回'},
  {id: 'gate', name: '外周を一周（ゲートターン：内側は足踏みで回る）', short: 'ゲートターン', icon: 'gate', loop: true, build: patLoop('gate'),
   desc: '角で横一列がゲート（扉）のように回る。内側の列はほとんど足踏み、外側が大きく回る。列は時間差で次々に角を曲がる'},
  {id: 'flank', name: '外周を一周（直角フランク：全員同時に90°）', short: '直角フランク', icon: 'flank', loop: true, build: patFlank,
   desc: '隊形を崩さずまっすぐ進み、角では全員が同時に90°向きを変える。いちばんカンタンで、ぶつかりにくい'},
  {id: 'counter', name: 'カウンターマーチで折り返し（往復）', short: 'カウンターマーチ', icon: 'counter', loop: false, build: patCounter,
   desc: '列が左右に割れて外側を折り返し、反対向きに戻って隊形をつくり直す。まっすぐな往復コース向き'},
  {id: 'serpentine', name: '蛇行（サーペンタイン）', short: '蛇行', icon: 'serpentine', loop: false, build: patSerpentine,
   desc: '会場を左右に折り返しながら、ヘビのように進む。細い列（1〜4列）で、先頭の通った道をたどる'},
  {id: 'eight', name: '8の字', short: '8の字', icon: 'eight', loop: true, build: patEight,
   desc: '2つの輪を作ってまんなかで交差する8の字。列が短いと見栄えがよい（列は交差でぶつからない長さに自動調整）'},
  {id: 'spiral', name: 'うずまき → ほどけて戻る', short: 'うずまき', icon: 'spiral', loop: true, build: patSpiral,
   desc: '1本の列が渦を巻いて中央へ。中心で折り返し、巻いた列のすき間を通ってほどけるように外へ戻る'},
  {id: 'review', name: '客席前で止まって演奏', short: 'パス・イン・レビュー', icon: 'review', loop: true, build: patReview,
   desc: '客席前で全員そろって止まり、横一列に向き直って足踏み（演奏）。その後、再び縦隊で周回を続ける'},
  {id: 'split', name: '2隊に分かれて逆回り→合流', short: '2隊で逆回り', icon: 'split', loop: true, build: patSplit,
   desc: '縦隊が奥で左右に分かれ、それぞれ会場の半分を逆回りに一周。手前で合流してもとの隊形に戻る'},
  {id: 'company', name: 'カンパニーフロント前進＋一周', short: 'カンパニーフロント', icon: 'company', loop: true, build: patCompany,
   desc: '奥から横一列（カンパニーフロント）で客席へ前進して止まり、縦隊に向きを変えて一周。最後は再び客席向きに'},
  {id: 'wedge', name: 'くさび形パレード', short: 'くさび形', icon: 'wedge', loop: true, build: patWedge,
   desc: '先頭が1人のくさび（Vの字）の形で周回する。先頭が道を切り開くイメージ'},
  {id: 'follow', name: 'フォロー・ザ・リーダーの一周（1本の列）', short: 'フォロー', icon: 'follow', loop: true, build: patFollowLap,
   desc: '1本の列が先頭の通った道をそのままたどる、なめらかな一周。少人数・細いコース向き（follow 文を使う）'},
];
const PATTERN_BY = Object.fromEntries(PATTERNS.map(p => [p.id, p]));

// ================= 生成 =================
const STEPS = {'8to5': 0.5625, '6to5': 0.75};
function groupString(idxs, slotMem, mem, total, natural) {
  if (natural && idxs.length === total) return 'all';
  const ms = idxs.map(i => mem[slotMem[i]]), out = [];
  let k = 0;
  while (k < ms.length) {
    let j = k;
    while (j + 1 < ms.length && ms[j + 1].s === ms[k].s && ms[j + 1].i === ms[j].i + 1) j++;
    const a = ms[k], b = ms[j];
    if (a.i === 1 && b.i === a.n) out.push(a.s);
    else out.push(j === k ? a.id : `${a.id}..${b.id}`);
    k = j + 1;
  }
  return out.join(' + ');
}
// o: {field, clearance, maxstep, sections:[{id,n}], order:[id], pattern, ccw, laps, files, fill, fileGap, rankGap(m),
//     stepM(m/カウント), style, endHold, halt, course, start, entry:'new'|'ordered'|'near', curPos:[[x,y]..]（order 順）}
function generate(o) {
  const V = venueOf(o.field || {type: 'gym', w: 30, d: 30}, {clearance: o.clearance, maxstep: o.maxstep});
  const secs = o.sections || [], order = o.order || secs.map(s => s.id), mem = [];
  order.forEach(sid => { const s = secs.find(x => x.id === sid); if (s) for (let i = 1; i <= s.n; i++) mem.push({id: sid + i, s: sid, i, n: s.n}); });
  const N = mem.length;
  if (N < 1) return {ok: false, error: '人数が0です'};
  const mpu = V.mpu, stepM = +o.stepM > 0 ? +o.stepM : 0.75;
  const vt = Math.min(stepM / mpu, V.maxPer * 0.985);
  const gmin = V.cl * 1.3 + 0.1 / mpu;
  const w = Math.max((+o.fileGap || 1.2) / mpu, V.cl * 1.6), d = Math.max((+o.rankGap || 2) / mpu, gmin * 1.7);
  const ctx = {V, N, w, d, vt, gmin, F: +o.files > 0 ? Math.min(+o.files, N) : null, fill: o.fill || 'rows', laps: Math.max(1, Math.min(3, Math.round(+o.laps || 1))),
    ccw: o.ccw !== false, start: o.start || {side: 'front'}, course: o.course || {type: 'perimeter'}, margin: (+(o.course && o.course.margin) || 0) / mpu,
    halt: +o.halt || 16, notes: [], mem, o};
  const P = PATTERN_BY[o.pattern] || PATTERNS[1];
  let built = null, lastErr = null;
  const wmin = V.cl * 1.6, dmin = gmin * 1.7, tried = new Set();
  const friendlyErr = e => (['corner', 'radius', 'box', 'tight', 'long'].includes(e.message) ? 'このコースには収まりません（人数・列数・間隔を減らすか、会場を広げてください）' : e.message);
  for (const k of [1, 0.85, 0.72, 0.6, 0]) {
    const w2 = Math.max(wmin, w * k), d2 = Math.max(dmin, d * k), key = r3(w2) + '/' + r3(d2);
    if (tried.has(key)) continue; tried.add(key);
    const c2 = Object.assign({}, ctx, {w: w2, d: d2, k, notes: []});
    try { built = P.build(c2); } catch (e) { if (!e.infeasible) throw e; lastErr = e; continue; }
    ctx.notes = c2.notes; ctx.w = w2; ctx.d = d2;
    if (k !== 1) ctx.notes.unshift(`会場に収めるため、間隔を狭めました（横 ${r3(w2 * mpu)}m・前後 ${r3(d2 * mpu)}m）`);
    break;
  }
  if (!built) return {ok: false, error: friendlyErr(lastErr)};
  const phases = built.phases.slice();
  const endHold = o.endHold == null ? 8 : +o.endHold;
  if (endHold > 0) phases.push({type: 'hold', H: endHold, front: true, label: '整列・停止', mark: true});
  const cfg = {tol: 0.3 / mpu, tols: [1.6, 1.1, 0.8, 0.55, 0.4, 0.28, 0.2].map(x => x / mpu), maxLen: Math.max(4, +o.maxLen || 48), minLen: 2, style: o.style || null,
    chk: {cl: V.cl, maxPer: V.maxPer, inb: V.inb}};
  const out = compilePhases(phases, N, cfg, built.rankGroups);
  // 人 → スロット
  const slotMem = mem.map((_, i) => i);
  const f0 = out.sets[0].stmts;
  const F = new Array(N);
  f0.forEach(st => {
    if (st.shape.kind === 'at') F[st.idx[0]] = st.shape.p;
    else if (st.shape.kind === 'line') { const a = st.shape.a, b = st.shape.b, n = st.idx.length; st.idx.forEach((i, k) => { F[i] = [a[0] + (b[0] - a[0]) * (n > 1 ? k / (n - 1) : 0), a[1] + (b[1] - a[1]) * (n > 1 ? k / (n - 1) : 0)]; }); }
  });
  let entryCounts = 0;
  if ((o.entry === 'near' || o.entry === 'ordered') && o.curPos && o.curPos.length === N) {
    if (o.entry === 'near') {
      const cost = o.curPos.map(p => F.map(q => { const d = dist(p, q); return d * d; }));
      const ans = hungarian(cost); // ans[m] = slot
      ans.forEach((slot, m) => { slotMem[slot] = m; });
    }
    let md = 0;
    for (let sl = 0; sl < N; sl++) md = Math.max(md, dist(o.curPos[slotMem[sl]], F[sl]));
    entryCounts = md < 0.05 ? 0 : Math.max(4, Math.ceil(md / (vt * 0.92) / 4) * 4);
  }
  const natural = slotMem.every((m, i) => m === i) && (!o.order || o.order.join() === secs.map(x => x.id).join());
  const sets = out.sets.map((s, k) => ({counts: k === 0 ? entryCounts : s.counts, hold: s.hold, mark: s.mark, label: s.label,
    stmts: s.stmts.map(st => Object.assign(st, {group: groupString(st.idx, slotMem, mem, N, natural)}))}));
  // セットの名前（「入場」「直進1」「角1」「正面で停止」…）。同じ名前が続くときだけ数字をつける
  {
    const base = sets.map((s, k) => {
      const l = String(s.label || '').trim();
      if (k === 0) return entryCounts > 0 ? '入場' : (l && l !== '整列' ? l : '整列');
      if (l === '直進') return '直進';
      if (l === 'コーナー') return '角';
      if (/整列・停止|客席へ向き直る/.test(l)) return '停止';
      return (l || 'セット').replace(/[（(].*$/, '').slice(0, 12);
    });
    const cnt = {}, seen = {}; base.forEach(b => { cnt[b] = (cnt[b] || 0) + 1; });
    sets.forEach((s, k) => { const b = base[k]; seen[b] = (seen[b] || 0) + 1; s.name = cnt[b] > 1 ? b + seen[b] : b; });
  }
  let total = 0; sets.forEach(s => { total += s.counts + s.hold; });
  const info = Object.assign({}, built.info, {total, entryCounts, N, vt, V: {type: V.type, mpu}, notes: ctx.notes, unit: V.unit});
  const rankIds = (built.rankGroups || []).map(g => g.map(i => mem[slotMem[i]].id));
  return {ok: true, sets, mem, slotMem, info, notes: ctx.notes, end: out.end, F, vt, V, rankIds};
}

function _end(){}
/*PART2*/
root.JKParade = {PATTERNS, PATTERN_BY, generate, STEPS};
root.JKParadeCore = {venueOf, shrink, segL, segA, segAt, splitSeg, roundedPoly, pathFrom, layoutBlock, layoutWedge, makeTrain, needRadius,
  arcPoint, approxOne, sliceMotion, stmtsOf, formationStmts, compilePhases, hungarian, mkStmt, r3, dist, unit, sub, norm180, ceilN, headDeg, arcCenter};
if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign(root.JKParade, {core: root.JKParadeCore});
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
