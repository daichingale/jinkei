// 楽譜の音符 → 打楽器を叩く腕の動き（プレビュー・3D共用）。Rust の src/strike.rs と同じ式。
// ストローク列を作る（jkStrokes）→ 時刻 t の手ごとの状態を引く（jkStrikeState）→ 上半身ボーンへ書く（jkStrikeApply）。
// スネア・テナー・バスドラムは、アセット（human.json の strike）に書いた打面の位置へスティックの先が正確に着くように、
// 肩から手首までを 2 関節 IK で解く（jkStrikeIK）。それ以外（シンバル・シロフォン・グロッケン）は前腕・手首の回転だけ足す。
// 手ごとの状態は lift（打面からの高さの度合い。0 = 打面）・p（打面の接点）・n（打面の外向き）など。座標は構え（hold）のときのモデル座標。
const JK_AH = [0.30, 0.60, 1.0];
const jkSst = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
// 強弱 vel（0..1）→ 振り上げの高さの倍率（pp はごく低く、ff は高く）。vel が無い音符は 0.6
const jkVs = v => 0.2 + 1.15 * Math.pow(Math.min(1, Math.max(0, v === undefined || v === null ? 0.6 : v)), 1.3);
// 楽器の分類（メッシュ名 → 'snare' | 'tenors' | 'bass' | 'cymbals' | 'xylo' | 'glock' | null）
function jkStrikeFam(kind) {
  if (kind === 'snare' || kind === 'tenors') return kind;
  if (/^bass[1-5]$/.test(kind)) return 'bass';
  if (kind === 'cymbals_mid' || kind === 'cymbals_high') return 'cymbals';
  if (kind === 'xylophone') return 'xylo';
  if (kind === 'glockenspiel') return 'glock';
  return null;
}
// 打面の表を持つ（IK で叩く）楽器か
const jkIsIK = (fam, tbl) => !!tbl && (fam === 'snare' || fam === 'tenors' || fam === 'bass');
// スティック先端の待機位置 x（モデル座標、手 R は負、L は正）。IK を使わない楽器用
function jkStickBase(fam, h) { const a = fam === 'xylo' ? 0.16 : fam === 'glock' ? 0.045 : 0.05; return h === 'R' ? -a : a; }

// ---- 小さなベクトル（3 要素の配列）----
const jvA = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], jvS = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const jvM = (a, s) => [a[0] * s, a[1] * s, a[2] * s], jvD = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const jvMA = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const jvL = a => Math.hypot(a[0], a[1], a[2]);
const jvN = a => { const l = jvL(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const jvC = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const jvLerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];

// ---- 打面・接点 ----
// 手 h（R は体の右 = -x）が打面 d を叩く接点まわりの記述 {p, p1, n, f, b0, buzz}
//   p = 接点、p1 = こすり（scrape）の終点、n = 離れる向き、f = スティックの前向き（null なら手首の待機位置から決める）、b0 = 打つときの棒の傾き（打面に対して、先が下を向くほど正。rad）
function jkContact(fam, d, h, kd, pad, n0) {
  const sx = h === 'R' ? -1 : 1, r = d.r, sp = d.spread;
  const off = (a, b) => jvA(d.c, jvA(jvM(d.ex, a * r), jvM(d.ez, b * r)));
  const b0 = fam === 'bass' ? 0.38 : fam === 'tenors' ? 0.35 : 0.30;
  const o = {p: off(sx * 0.28 * sp, -0.10 * sp), p1: null, n: d.n, f: null, b0, buzz: 0, hm: 1};
  if (kd === 'rimshot') {
    if (fam === 'bass') { o.hm = 1.15; return o; }
    o.p = off(sx * 0.15 * sp, -0.55); o.b0 = 0.05; o.hm = 1.1; // 先は打面、棒の腹がフープに当たる
  } else if (kd === 'click' || (fam === 'snare' && pad === 2)) {
    if (fam === 'snare') { o.p = jvMA(off(sx * 0.93, 0), d.n, 0.006); o.b0 = 0.10; }
    else if (fam === 'bass') o.p = off(0.92, 0);
    else { o.p = jvMA(off(sx * 0.15 * sp, -0.93), d.n, 0.006); o.b0 = 0.10; }
    o.hm = 0.6;
  } else if (kd === 'gock') {
    if (fam === 'snare') { o.p = jvMA(jvMA(d.c, d.ex, sx * (r + 0.014)), d.n, -0.06); o.n = jvN(jvA(jvM(d.ex, sx * 0.5), jvM(d.n, 0.85))); }
    else if (fam === 'tenors') { o.p = jvMA(jvMA(d.c, d.ez, -(r + 0.014)), d.n, -0.06); o.n = jvN(jvA(jvM(d.ez, -0.5), jvM(d.n, 0.85))); }
    else o.p = jvA(d.c, jvA(jvM(d.ex, 0.55 * r), jvM(d.ez, 0.65 * r))); // バス: マレットの柄が縁に当たる
    o.b0 = 0.12; o.hm = 0.8;
  } else if (kd === 'scrape') {
    o.p = off(-sx * 0.55 * sp, -0.15 * sp); o.p1 = off(sx * 0.55 * sp, -0.15 * sp);
    if (fam === 'bass') { o.p = off(-0.5, 0.0); o.p1 = off(0.5, 0.0); }
    o.buzz = 3; o.hm = 0.3;
  } else if (kd === 'mute') { o.buzz = 2; o.hm = 0.8; }
  else if (fam === 'snare' && pad === 3) { o.p = off(sx * 0.3, 0.72); o.hm = 0.8; }
  return o;
}
// 手首の待機位置 anc から、棒の前向き（打面の面内で anc → p の向き）
function jkFOf(p, n, anc, h) {
  let v = jvS(p, anc); v = jvS(v, jvM(n, jvD(v, n)));
  if (jvL(v) < 1e-4) { v = [0, 0, 1]; v = jvS(v, jvM(n, jvD(v, n))); }
  return jvN(v);
}
// テナーの打面の番号 → 表の項目。番号なしは R が 1、L が 2
function jkDrumOf(fam, tbl, h, pad) {
  const ds = tbl.drums;
  if (fam === 'bass') return ds.find(d => d.hand === h) || ds[0];
  if (fam === 'snare') return ds[0];
  return ds.find(d => d.pad === pad) || ds.find(d => d.pad === (h === 'R' ? 1 : 2)) || ds[0];
}
// 1人ぶんの音符（[t, dur, hand, accent, kind, pad, vel]）→ 手ごとのストローク列 {R:[...], L:[...]}。tbl = アセットの strike[kind]（無ければ前腕だけの旧方式）
function jkStrokes(notes, kind, spc, tbl) {
  const fam = jkStrikeFam(kind), out = {R: [], L: [], ik: jkIsIK(fam, tbl)};
  if (!fam || !notes.length) return out;
  const bs = fam === 'bass' ? +kind[4] : 0, grace = 0.065 / spc;
  let ni = 0;
  for (const n of notes) {
    const [t, dur, hand, acc, kd, pad] = n, vs = jkVs(n[6]);
    if (fam === 'bass' && pad > 0 && pad !== bs) continue;
    if (out.ik) {
      const hands = kd === 'stickclick' ? ['R', 'L'] : hand === 'B' ? ['R', 'L'] : [hand];
      if (kd === 'stickclick') {
        for (const h of hands) {
          const sx = h === 'R' ? -1 : 1, list = out[h];
          if (list.length && Math.abs(list[list.length - 1].t - t) < 1e-6 && list[list.length - 1].click) continue;
          list.push({t, te: t, H: 0.35 * vs, p: jvA(tbl.click, [sx * 0.012, 0, 0]), p1: null, n: jvN([sx * 0.9, 0.35, 0]), f: jvN([-sx * 0.55, 0, 1]), b0: -0.15, buzz: 0, click: true});
        }
        ni++; continue;
      }
      // バスドラムの buzz / ロール: 両手の小さな交互打ち
      if (fam === 'bass' && kd === 'buzz') {
        const step = 0.125, cnt = Math.max(2, Math.round(dur / step));
        for (let i = 0; i < cnt; i++) {
          const h = (hand === 'L') !== (i % 2 === 1) ? 'L' : 'R', d = jkDrumOf(fam, tbl, h, pad), c = jkContact(fam, d, h, 'tap', pad);
          out[h].push({t: t + i * step, te: t + i * step, H: 0.14 * vs, p: c.p, p1: null, n: c.n, f: c.f, b0: c.b0, buzz: 0});
        }
        ni++; continue;
      }
      for (const h of hands) {
        const d = jkDrumOf(fam, tbl, h, pad), c = jkContact(fam, d, h, kd, pad);
        let H = (JK_AH[acc] !== undefined ? JK_AH[acc] : 0.3) * vs * c.hm, te = t;
        if (c.buzz === 3) te = t + Math.max(dur, 0.25);
        else if (c.buzz === 2) te = t + Math.max(dur, 0.25);
        if (kd === 'buzz') { H = 0.08; c.buzz = 1; te = t + dur; }
        const list = out[h], oh = h === 'R' ? 'L' : 'R';
        list.push({t, te, H, p: c.p, p1: c.p1, n: c.n, f: c.f, b0: c.b0, buzz: c.buzz});
        if (kd === 'diddle') list.push({t: t + dur / 2, te: t + dur / 2, H: H * 0.65, p: c.p, p1: null, n: c.n, f: c.f, b0: c.b0, buzz: 0});
        if (kd === 'flam' && hand !== 'B') {
          const d2 = jkDrumOf(fam, tbl, oh, pad), c2 = jkContact(fam, d2, oh, 'tap', pad);
          out[oh].push({t: t - grace, te: t - grace, H: 0.2 * vs, p: c2.p, p1: null, n: c2.n, f: c2.f, b0: c2.b0, buzz: 0});
        }
      }
      ni++; continue;
    }
    // ---- 旧方式（シンバル・シロフォン・グロッケン）----
    const hs = fam === 'cymbals' ? ['R', 'L'] : fam === 'glock' ? ['R'] : hand === 'B' ? ['R', 'L'] : [hand];
    for (const h of hs) {
      let H = (JK_AH[acc] !== undefined ? JK_AH[acc] : 0.3) * (fam === 'cymbals' ? vs : 1), x = jkStickBase(fam, h), rim = 0, buzz = 0, te = t;
      if (fam === 'xylo') x = jkStickBase(fam, h) + 0.2 * Math.sin(ni * 2.3 + (h === 'R' ? 0 : 1.7));
      else if (fam === 'glock') x = jkStickBase(fam, h) + 0.04 * Math.sin(ni * 2.3);
      else if (fam === 'cymbals') {
        if (pad === 2) H *= 0.35; else if (pad === 3) H = H * 0.5 + 0.2; else if (pad === 4) { buzz = 2; te = t + Math.max(dur, 0.5); }
      }
      const list = out[h], oh = h === 'R' ? 'L' : 'R';
      if (kd === 'buzz' && fam !== 'cymbals') { H = 0.08; buzz = 1; te = t + dur; }
      list.push({t, te, H, x, rim, buzz});
      if (kd === 'diddle' && fam !== 'cymbals') list.push({t: t + dur / 2, te: t + dur / 2, H: H * 0.65, x, rim, buzz: 0});
      if (kd === 'flam' && hand !== 'B' && fam !== 'cymbals' && fam !== 'glock') out[oh].push({t: t - grace, te: t - grace, H: 0.2, x: jkStickBase(fam, oh), rim: 0, buzz: 0});
    }
    ni++;
  }
  out.R.sort((a, b) => a.t - b.t); out.L.sort((a, b) => a.t - b.t);
  return out;
}
// 1本ぶんの状態。list = ストローク列、t = カウント、spc = 秒/カウント。dp / dn = 直前の音の終わり・次の音までのカウント
// anc = 手首の待機位置（IK の楽器のみ）。IK でない楽器は x / rim を返す
function jkHandState(list, t, spc, base, anc) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t > t + 1e-9) hi = m; else lo = m + 1; }
  const next = lo < list.length ? list[lo] : null, prev = lo > 0 ? list[lo - 1] : null;
  const o = {lift: 0, x: base, rim: 0, dp: 1e9, dn: 1e9, has: list.length > 0, p: null, n: null, f: null, b0: 0.3, arc: 0};
  if (prev) o.dp = Math.max(0, t - Math.max(prev.t, prev.te));
  if (next) o.dn = next.t - t;
  const ik = !!anc, pe = s => (s.buzz === 3 ? s.p1 : s.p);
  if (prev && prev.buzz && t <= prev.te) { // バズ・チョーク・ミュート・こすり: 打面に押しつけたまま（バズは細かく震える。こすりは接点が動く）
    o.lift = prev.buzz === 1 ? 0.05 + 0.035 * Math.sin(2 * Math.PI * 14 * t * spc) : prev.buzz === 3 ? 0.02 : 0; o.x = prev.x; o.rim = prev.rim; o.dp = 0;
    if (ik) {
      o.p = prev.buzz === 3 ? jvLerp(prev.p, prev.p1, jkSst((t - prev.t) / Math.max(1e-6, prev.te - prev.t))) : prev.p;
      o.n = prev.n; o.f = prev.f || jkFOf(o.p, o.n, anc); o.b0 = prev.b0;
    }
    return o;
  }
  const sg = prev ? (t - Math.max(prev.t, prev.te)) * spc : 1e9, tau = next ? (next.t - t) * spc : 1e9;
  let lift = 0;
  if (!next) { const x = sg / 0.32; lift = prev && x < 1 ? prev.H * 0.45 * Math.sin(Math.PI * x) : 0; }
  else {
    const P = next.H, g = sg + tau, f = Math.min(0.10 + 0.14 * P, 0.55 * g);
    if (tau <= f) lift = P * (1 - Math.pow(1 - tau / f, 1.7));
    else if (!prev) lift = tau < f + 0.18 ? P * Math.sin(Math.PI / 2 * (1 - (tau - f) / 0.18)) : 0;
    else if (g > f + 0.32) {
      const m = Math.min(P, 0.1 + 0.2 * P);
      if (tau < f + 0.10) lift = m + (P - m) * jkSst(1 - (tau - f) / 0.10);
      else if (sg < 0.12) lift = m * Math.sin(Math.PI / 2 * sg / 0.12);
      else lift = m;
    } else lift = P * Math.sin(Math.PI / 2 * Math.min(1, sg / (g - f)));
  }
  o.lift = lift;
  if (!ik) {
    if (prev && next) { const s = jkSst(sg / ((sg + tau) * 0.75)); o.x = prev.x + (next.x - prev.x) * s; o.rim = prev.rim + (next.rim - prev.rim) * s; }
    else if (next) { o.x = next.x; o.rim = next.rim; } else if (prev) { o.x = prev.x; o.rim = prev.rim; }
    return o;
  }
  if (prev && next) {
    // 前の打面から次の打面へ。次の音の手前（間の 75%）で着き、そのまま構えて振り下ろす。離れた打面の間は弧を描いて持ち上げる
    const s = jkSst(sg / ((sg + tau) * 0.75)), pp = pe(prev);
    o.p = jvLerp(pp, next.p, s); o.n = jvN(jvLerp(prev.n, next.n, s)); o.b0 = prev.b0 + (next.b0 - prev.b0) * s;
    o.arc = 0.22 * jvL(jvS(next.p, pp)) * Math.sin(Math.PI * s);
    o.f = prev.f || next.f ? jvN(jvLerp(prev.f || jkFOf(pp, prev.n, anc), next.f || jkFOf(next.p, next.n, anc), s)) : jkFOf(o.p, o.n, anc);
  } else if (next || prev) {
    const s0 = next || prev;
    o.p = next ? next.p : pe(prev); o.n = s0.n; o.b0 = s0.b0; o.f = s0.f || jkFOf(o.p, o.n, anc);
  }
  return o;
}
// 時刻 t の状態 {R, L, w}。w = 演奏中の度合い 0..1（音が 1 カウント以上途切れると手がなめらかに構えへ戻る）
function jkStrikeState(strk, fam, t, spc, tbl) {
  const ik = strk.ik;
  const R = jkHandState(strk.R, t, spc, jkStickBase(fam, 'R'), ik ? tbl.anchor.R : null), L = jkHandState(strk.L, t, spc, jkStickBase(fam, 'L'), ik ? tbl.anchor.L : null);
  const d = Math.min(R.dp, R.dn, L.dp, L.dn);
  return {R, L, w: 1 - jkSst((d - 0.4) / 0.9)};
}

// ---- クォータニオン [x, y, z, w] ----
const jkQm = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const jkQi = a => [-a[0], -a[1], -a[2], a[3]];
const jkQx = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)], jkQy = a => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const jkQrot = (q, v) => {
  const t = jvM(jvC([q[0], q[1], q[2]], v), 2);
  return jvA(jvA(v, jvM(t, q[3])), jvC([q[0], q[1], q[2]], t));
};
// a を b へ回す最短の回転
function jkQarc(a, b) {
  a = jvN(a); b = jvN(b);
  const d = jvD(a, b);
  if (d < -0.999999) { let ax = jvC([1, 0, 0], a); if (jvL(ax) < 1e-3) ax = jvC([0, 1, 0], a); ax = jvN(ax); return [ax[0], ax[1], ax[2], 0]; }
  const c = jvC(a, b), l = Math.hypot(c[0], c[1], c[2], 1 + d);
  return [c[0] / l, c[1] / l, c[2] / l, (1 + d) / l];
}
function jkQslerp(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b;
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  let wa = 1 - t, wb = t;
  if (d < 0.9995) { const th = Math.acos(d), s = Math.sin(th); wa = Math.sin((1 - t) * th) / s; wb = Math.sin(t * th) / s; }
  const r = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb], l = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
  return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
}
// ボーン b の「モデル座標での回転 Rm」を、関節（ボーンの原点）まわりに掛ける。Q は局所回転（フラット配列）、par は親の番号
function jkRotateJoint(Q, par, b, Rm) {
  const q = k => [Q[k * 4], Q[k * 4 + 1], Q[k * 4 + 2], Q[k * 4 + 3]];
  const chain = []; for (let k = par[b]; k >= 0; k = par[k]) chain.push(k);
  let wp = [0, 0, 0, 1]; for (let i = chain.length - 1; i >= 0; i--) wp = jkQm(wp, q(chain[i]));
  const n = jkQm(jkQm(jkQm(jkQi(wp), Rm), wp), q(b));
  Q[b * 4] = n[0]; Q[b * 4 + 1] = n[1]; Q[b * 4 + 2] = n[2]; Q[b * 4 + 3] = n[3];
}
// 全ボーンのモデル座標の位置・回転（親が先に並んでいる前提）
function jkFK(P, Q, par, nb) {
  const wp = new Array(nb), wq = new Array(nb);
  for (let i = 0; i < nb; i++) {
    const lp = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], lq = [Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]];
    if (par[i] < 0) { wp[i] = lp; wq[i] = lq; } else { wp[i] = jvA(wp[par[i]], jkQrot(wq[par[i]], lp)); wq[i] = jkQm(wq[par[i]], lq); }
  }
  return {wp, wq};
}
const JK_HT = {snare: 0.30, tenors: 0.30, bass: 0.80}, JK_CAP = {snare: 0.42, tenors: 0.42, bass: 0.62}, JK_RISE = {snare: 0.07, tenors: 0.07, bass: 0.12}, JK_UP = {snare: 0, tenors: 0, bass: 0.16};
// 胴体のひねり（テナー）: 右手が左の打面、左手が右の打面へ越えるとき、胸を 20° ほどまわす。楽器は動かさない（キャリアは腰に付くので）
function jkTwist(st, fam) {
  if (fam !== 'tenors' || !st.R.p || !st.L.p) return 0;
  const aR = Math.min(1, Math.max(0, st.R.p[0] - 0.02) / 0.40), aL = Math.min(1, Math.max(0, -st.L.p[0] - 0.02) / 0.40);
  return 0.34 * (jkSst(aR) - jkSst(aL));
}
// 1本ぶんの IK。h = 'R' | 'L'。W = 手首の位置、手の向きを求めてボーンへ書く。戻り値なし
function jkSolveHand(Q, par, BI, h, s, fam, tbl, F, PR, amt, cross) {
  const sd = h === 'R' ? -1 : 1, sk = tbl.stick[h], tL = sk.tip, aL = sk.ax, ell = jvL(tL), rh = sk.rh;
  const {wp, wq} = F, pm = p => jvA(wp[BI.prop], jkQrot(wq[BI.prop], jvS(p, PR))), pd = d => jkQrot(wq[BI.prop], d);
  // 構えのモデル座標で、手首を支点に棒が振れるとして先端の位置と向きを決める
  const Ht = Math.min(s.lift * JK_HT[fam] + s.arc, JK_CAP[fam]), w = JK_RISE[fam] * Math.min(s.lift, 1.3);
  const sb0 = Math.sin(s.b0), sb = Math.min(0.95, Math.max(-0.96, sb0 - (Ht - w) / ell)), cb0 = Math.cos(s.b0), cb = Math.sqrt(1 - sb * sb);
  const d0 = jvS(jvM(s.f, cb0), jvM(s.n, sb0)), d = jvS(jvM(s.f, cb), jvM(s.n, sb));
  const Wc = jvS(jvMA(s.p, s.n, rh), jvM(d0, ell)), Wh = jvA(jvMA(Wc, s.n, w), [0, JK_UP[fam] * Math.min(s.lift, 1.3), 0]), tip = jvA(Wh, jvM(d, ell));
  const T = pm(tip), dm = pd(d);
  // 手の向き: クリップの手の向きから、棒の軸を dm へ回す最短の回転
  const hb = BI['hand' + h], qh = wq[hb];
  let Rh = jkQm(jkQarc(jkQrot(qh, aL), dm), qh);
  let W = jvS(T, jkQrot(Rh, tL));
  if (cross > 0) { // 腕が越えるとき: 手首を持ち上げ・前へ出す（先端は動かさない）
    const W2 = jvA(W, [0, 0.085 * cross, 0.035 * cross]), u = jvM(jvN(jvS(T, W2)), ell);
    Rh = jkQm(jkQarc(jkQrot(Rh, tL), u), Rh); W = jvS(T, u);
  }
  // 2 関節 IK（肩 → 肘 → 手首）
  const ua = BI['upperArm' + h], fa = BI['foreArm' + h], cl = BI['clav' + h];
  const SH = wp[ua], A = jvL(F.loc[fa]), B = jvL(F.loc[hb]);
  const dv = jvS(W, SH), dist0 = jvL(dv), dn = jvM(dv, 1 / dist0), dist = Math.min(dist0, (A + B) * 0.9995);
  const a = (A * A - B * B + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, A * A - a * a));
  const pole = fam === 'bass' ? [sd * 0.9, -0.5 + 0.9 * cross, -0.2] : [sd * 0.6, -1 + 1.3 * cross, -0.35];
  const pv = jvN(jvS(pole, jvM(dn, jvD(pole, dn))));
  const elbow = jvA(jvMA(SH, dn, a), jvM(pv, hh)), wrist = jvMA(SH, dn, dist);
  const qU0 = wq[ua], uLoc = jvN(F.loc[fa]), fLoc = jvN(F.loc[hb]);
  const qU = jkQm(jkQarc(jkQrot(qU0, uLoc), jvS(elbow, SH)), qU0);
  const qF0 = jkQm(qU, [Q[fa * 4], Q[fa * 4 + 1], Q[fa * 4 + 2], Q[fa * 4 + 3]]);
  const qF = jkQm(jkQarc(jkQrot(qF0, fLoc), jvS(wrist, elbow)), qF0);
  const nU = jkQm(jkQi(wq[cl]), qU), nF = jkQm(jkQi(qU), qF), nH = jkQm(jkQi(qF), Rh);
  const put = (b, nq) => { const o = [Q[b * 4], Q[b * 4 + 1], Q[b * 4 + 2], Q[b * 4 + 3]], r = jkQslerp(o, nq, amt); Q[b * 4] = r[0]; Q[b * 4 + 1] = r[1]; Q[b * 4 + 2] = r[2]; Q[b * 4 + 3] = r[3]; };
  put(ua, nU); put(fa, nF); put(hb, nH);
}
// IK で叩く楽器: 上半身ボーンへ書く。PR = 小道具ボーンの静止位置、amt = 演奏の構えのときの度合い
function jkStrikeIK(P, Q, par, BI, PR, fam, tbl, st, amt) {
  if (amt <= 0.001 || !(st.R.has || st.L.has)) return;
  const nb = par.length;
  // 胴体のひねり（楽器の位置は変えない）
  const th = jkTwist(st, fam) * amt;
  if (Math.abs(th) > 1e-4) {
    const F0 = jkFK(P, Q, par, nb), pw = F0.wp[BI.prop], pq = F0.wq[BI.prop];
    jkRotateJoint(Q, par, BI.chest, jkQy(th));
    jkRotateJoint(Q, par, BI.neck, jkQy(-0.65 * th));
    const F1 = jkFK(P, Q, par, nb), ci = jkQi(F1.wq[BI.chest]), pl = jkQrot(ci, jvS(pw, F1.wp[BI.chest])), ql = jkQm(ci, pq);
    P[BI.prop * 3] = pl[0]; P[BI.prop * 3 + 1] = pl[1]; P[BI.prop * 3 + 2] = pl[2];
    Q[BI.prop * 4] = ql[0]; Q[BI.prop * 4 + 1] = ql[1]; Q[BI.prop * 4 + 2] = ql[2]; Q[BI.prop * 4 + 3] = ql[3];
  }
  const F = jkFK(P, Q, par, nb);
  F.loc = {}; for (const b of ['foreArmR', 'foreArmL', 'handR', 'handL']) F.loc[BI[b]] = [P[BI[b] * 3], P[BI[b] * 3 + 1], P[BI[b] * 3 + 2]];
  // 越える腕: 手が体の反対側にあり、相手の手より中央を越えているほうが、相手の腕の上を通る
  let cR = 0, cL = 0;
  if (fam === 'tenors' && st.R.p && st.L.p) {
    const xR = st.R.p[0], xL = st.L.p[0], aR = xR, aL = -xL, c = jkSst((xR - xL + 0.08) / 0.16) * jkSst(Math.max(aR, aL) / 0.12), k = jkSst(0.5 + (aR - aL) / 0.1);
    cR = c * k; cL = c * (1 - k);
  }
  if (st.R.has) jkSolveHand(Q, par, BI, 'R', st.R, fam, tbl, F, PR, amt, cR);
  if (st.L.has) jkSolveHand(Q, par, BI, 'L', st.L, fam, tbl, F, PR, amt, cL);
}
// 打つ動きを前腕・手首へ足す（旧方式: シンバル・シロフォン・グロッケン）。amt = 演奏の構えのときの度合い（構えの切り替え中は 0 へ）
function jkStrikeApply(Q, par, BI, fam, st, amt) {
  if (amt <= 0.001) return;
  for (const h of ['R', 'L']) {
    if (fam === 'glock' && h === 'L') continue;
    const sd = h === 'R' ? -1 : 1, s = st[h], fa = BI['foreArm' + h], hd = BI['hand' + h];
    let fr, hr;
    if (fam === 'cymbals') {
      const c = amt * st.w * (1 - 1.5 * s.lift), up = -s.lift * 0.35 * amt;
      const yaw = -sd * c * 0.28;
      fr = jkQm(jkQy(yaw), jkQx(up)); hr = jkQm(jkQy(-sd * c * 0.1), jkQx(up * 0.5));
    } else {
      const th = s.lift * amt, yaw = (Math.atan((s.x - jkStickBase(fam, h)) / 0.47) + sd * s.rim * 0.28) * amt;
      fr = jkQm(jkQy(yaw * 0.7), jkQx(-th * 0.4)); hr = jkQm(jkQy(yaw * 0.3), jkQx(-th * 0.6));
    }
    jkRotateJoint(Q, par, fa, fr); jkRotateJoint(Q, par, hd, hr);
  }
}
// 1人ぶんの音符を集める（そのメンバーを含むパートの音符を時刻順に）
function jkNotesFor(D, i) {
  const a = [];
  for (const p of D.parts || []) if (p.members.includes(i)) for (const n of p.notes) a.push(n);
  return a.sort((x, y) => x[0] - y[0]);
}
