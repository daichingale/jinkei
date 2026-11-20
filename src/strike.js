// 楽譜の音符 → 打楽器を叩く腕の動き（プレビュー・3D共用）。Rust の src/strike.rs と同じ式。
// ストローク列を作る（jkStrokes）→ 時刻 t の手ごとの状態を引く（jkStrikeState）→ 上半身ボーンへ書く（jkStrikeApply）。
// 状態は手ごとに lift（スティックの高さ 0..1。0 = 打面）・x（先端の目標 x。モデル座標 m）・rim（縁へ寄せる量 -1..1）。
const JK_AH = [0.30, 0.60, 1.0];
const jkSst = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
// 楽器の分類（メッシュ名 → 'snare' | 'tenors' | 'bass' | 'cymbals' | 'xylo' | 'glock' | null）
function jkStrikeFam(kind) {
  if (kind === 'snare' || kind === 'tenors') return kind;
  if (/^bass[1-5]$/.test(kind)) return 'bass';
  if (kind === 'cymbals_mid' || kind === 'cymbals_high') return 'cymbals';
  if (kind === 'xylophone') return 'xylo';
  if (kind === 'glockenspiel') return 'glock';
  return null;
}
// スティック先端の待機位置 x（モデル座標、手 R は負、L は正）
function jkStickBase(fam, h) { const a = fam === 'tenors' ? 0.11 : fam === 'xylo' ? 0.16 : fam === 'glock' ? 0.045 : 0.05; return h === 'R' ? -a : a; }
// テナーのドラム位置（低→高 = 大→小、スポックは上手側）。手の届く範囲に収める
function jkTenorX(idx, h) {
  const x = idx >= 5 ? 0.30 : 0.343 - Math.min(4, Math.max(0, idx)) / 4 * 0.686;
  return h === 'R' ? Math.min(x, 0.10) : Math.max(x, -0.10);
}
// 1人ぶんの音符（[t, dur, hand, accent, kind, pad]）→ 手ごとのストローク列 {R:[...], L:[...]}
function jkStrokes(notes, kind, spc) {
  const fam = jkStrikeFam(kind), out = {R: [], L: []};
  if (!fam || !notes.length) return out;
  const bs = fam === 'bass' ? +kind[4] : 0, grace = 0.065 / spc;
  let ni = 0;
  for (const n of notes) {
    const [t, dur, hand, acc, kd, pad] = n;
    if (fam === 'bass' && pad > 0 && pad !== bs) continue;
    const hs = fam === 'cymbals' ? ['R', 'L'] : fam === 'glock' ? ['R'] : hand === 'B' ? ['R', 'L'] : [hand];
    for (const h of hs) {
      let H = JK_AH[acc] !== undefined ? JK_AH[acc] : 0.3, x = jkStickBase(fam, h), rim = 0, buzz = 0, te = t;
      if (fam === 'snare') {
        if (pad === 2 || kd === 'click') { rim = 1; if (kd === 'click') H *= 0.6; }
        else if (pad === 3) { rim = -0.6; H *= 0.8; }
      } else if (fam === 'tenors') x = jkTenorX(pad > 0 ? pad - 1 : ni % 5, h);
      else if (fam === 'xylo') x = jkStickBase(fam, h) + 0.2 * Math.sin(ni * 2.3 + (h === 'R' ? 0 : 1.7));
      else if (fam === 'glock') x = jkStickBase(fam, h) + 0.04 * Math.sin(ni * 2.3);
      else if (fam === 'cymbals') {
        if (pad === 2) H *= 0.35; else if (pad === 3) H = H * 0.5 + 0.2; else if (pad === 4) { buzz = 2; te = t + Math.max(dur, 0.5); }
      }
      const list = out[h], oh = h === 'R' ? 'L' : 'R';
      if (kd === 'buzz' && fam !== 'cymbals') { H = 0.08; buzz = 1; te = t + dur; }
      list.push({t, te, H, x, rim, buzz});
      if (kd === 'diddle' && fam !== 'cymbals') list.push({t: t + dur / 2, te: t + dur / 2, H: H * 0.65, x, rim, buzz: 0});
      if (kd === 'flam' && hand !== 'B' && fam !== 'cymbals' && fam !== 'glock') out[oh].push({t: t - grace, te: t - grace, H: 0.2, x: fam === 'tenors' ? x : jkStickBase(fam, oh), rim: 0, buzz: 0});
    }
    ni++;
  }
  out.R.sort((a, b) => a.t - b.t); out.L.sort((a, b) => a.t - b.t);
  return out;
}
// 1本ぶんの状態。list = ストローク列、t = カウント、spc = 秒/カウント。dp / dn = 直前の音の終わり・次の音までのカウント
function jkHandState(list, t, spc, base) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t > t + 1e-9) hi = m; else lo = m + 1; }
  const next = lo < list.length ? list[lo] : null, prev = lo > 0 ? list[lo - 1] : null;
  const o = {lift: 0, x: base, rim: 0, dp: 1e9, dn: 1e9};
  if (prev) o.dp = Math.max(0, t - Math.max(prev.t, prev.te));
  if (next) o.dn = next.t - t;
  if (prev && prev.buzz && t <= prev.te) { // バズ・チョーク: 打面に押しつけたまま（バズは細かく震える）
    o.lift = prev.buzz === 1 ? 0.05 + 0.035 * Math.sin(2 * Math.PI * 14 * t * spc) : 0; o.x = prev.x; o.rim = prev.rim; o.dp = 0; return o;
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
  if (prev && next) { const s = jkSst(sg / ((sg + tau) * 0.75)); o.x = prev.x + (next.x - prev.x) * s; o.rim = prev.rim + (next.rim - prev.rim) * s; }
  else if (next) { o.x = next.x; o.rim = next.rim; } else if (prev) { o.x = prev.x; o.rim = prev.rim; }
  return o;
}
// 時刻 t の状態 {R, L, w}。w = 演奏中の度合い 0..1（音が 1 カウント以上途切れると手がなめらかに構えへ戻る）
function jkStrikeState(strk, fam, t, spc) {
  const R = jkHandState(strk.R, t, spc, jkStickBase(fam, 'R')), L = jkHandState(strk.L, t, spc, jkStickBase(fam, 'L'));
  const d = Math.min(R.dp, R.dn, L.dp, L.dn);
  return {R, L, w: 1 - jkSst((d - 0.4) / 0.9)};
}
const jkQm = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const jkQi = a => [-a[0], -a[1], -a[2], a[3]];
const jkQx = a => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)], jkQy = a => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
// ボーン b の「モデル座標での回転 Rm」を、関節（ボーンの原点）まわりに掛ける。Q は局所回転（フラット配列）、par は親の番号
function jkRotateJoint(Q, par, b, Rm) {
  const q = k => [Q[k * 4], Q[k * 4 + 1], Q[k * 4 + 2], Q[k * 4 + 3]];
  const chain = []; for (let k = par[b]; k >= 0; k = par[k]) chain.push(k);
  let wp = [0, 0, 0, 1]; for (let i = chain.length - 1; i >= 0; i--) wp = jkQm(wp, q(chain[i]));
  const n = jkQm(jkQm(jkQm(jkQi(wp), Rm), wp), q(b));
  Q[b * 4] = n[0]; Q[b * 4 + 1] = n[1]; Q[b * 4 + 2] = n[2]; Q[b * 4 + 3] = n[3];
}
// 打つ動きを前腕・手首へ足す。amt = 演奏の構えのときの度合い（構えの切り替え中は 0 へ）
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
    } else if (fam === 'bass') {
      const th = s.lift * amt, yaw = sd * 0.5 * th;
      fr = jkQm(jkQy(yaw * 0.4), jkQx(-th * 0.5)); hr = jkQm(jkQy(yaw * 0.6), jkQx(-th * 0.5));
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
