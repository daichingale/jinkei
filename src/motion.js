// 動きの計算（プレビュー・3D・エディタで共用）。Rust の geom::arc_point / render::state_at と同じ式
function jkArc(a, b, bend, u) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  if (Math.abs(bend) < 1e-6 || l < 1e-9) return [a[0] + dx * u, a[1] + dy * u];
  const th = Math.min(Math.abs(bend), 179) * Math.PI / 180, s = -Math.sign(bend);
  const rot = (v, g) => [v[0] * Math.cos(g) - v[1] * Math.sin(g), v[0] * Math.sin(g) + v[1] * Math.cos(g)];
  const t0 = rot([dx / l, dy / l], -s * th / 2), n0 = rot(t0, s * Math.PI / 2);
  const r = l / (2 * Math.sin(th / 2)), ph = th * u;
  return [a[0] + r * (Math.sin(ph) * t0[0] + (1 - Math.cos(ph)) * n0[0]), a[1] + r * (Math.sin(ph) * t0[1] + (1 - Math.cos(ph)) * n0[1])];
}
function jkPolyAt(r, u) {
  let total = 0; for (let j = 1; j < r.length; j++) total += Math.hypot(r[j][0] - r[j - 1][0], r[j][1] - r[j - 1][1]);
  if (r.length < 2 || total < 1e-12) return r[r.length - 1];
  let left = total * Math.min(1, Math.max(0, u));
  for (let j = 1; j < r.length; j++) {
    const d = Math.hypot(r[j][0] - r[j - 1][0], r[j][1] - r[j - 1][1]);
    if (left <= d) { const t = d > 0 ? left / d : 0; return [r[j - 1][0] + (r[j][0] - r[j - 1][0]) * t, r[j - 1][1] + (r[j][1] - r[j - 1][1]) * t]; }
    left -= d;
  }
  return r[r.length - 1];
}
function jkSetAt(D, t) { let k = 0; for (let i = 0; i < D.sets.length; i++) if (D.sets[i].start <= t + 1e-9) k = i; return k; }
// 姿勢の出入りの補間（0.5カウントでなめらかに）。1 = 完全に姿勢中
function jkPoseBlend(tt, w, e, moved) {
  if (!moved) return 1;
  const ss = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  if (tt <= w) return 1 - ss((tt - (w - 0.5)) / 0.5);
  if (tt >= e) return ss((tt - e) / 0.5);
  return 0;
}
// 構えの切り替え（前のセットの構え → このセットの構え）を、セットの頭から 1 カウントでなめらかに。1 = 完全に新しい構え
function jkCarryBlend(tt) {
  const x = Math.min(1, Math.max(0, tt));
  return x * x * (3 - 2 * x);
}
function jkState(D, i, t) {
  const k = jkSetAt(D, t), s = D.sets[k], tt = t - s.start;
  const face = s.face ? s.face[i] : null, step = s.step ? s.step[i] : null, action = s.action ? s.action[i] : null;
  const pose = s.pose ? s.pose[i] || null : null;
  const carry = s.carry ? s.carry[i] || null : null;
  if (k === 0 || !s.counts) return {p: s.pos[i], moving: false, dir: [0, 0], phase: tt, face, mark: !!s.mark, step, action, pose, poseBlend: pose ? 1 : 0, carry, carryFrom: carry, carryBlend: 1};
  const carryFrom = D.sets[k - 1].carry ? D.sets[k - 1].carry[i] || null : null;
  const a = D.sets[k - 1].pos[i], b = s.pos[i], w = s.wait[i], e = s.end[i], bend = s.bend ? s.bend[i] : 0;
  const U = x => e - w <= 0 ? 1 : Math.min(1, Math.max(0, (x - w) / (e - w)));
  const route = s.route ? s.route[i] : null;
  const at = u => route ? jkPolyAt(route, u) : jkArc(a, b, bend, u);
  const p = at(U(tt));
  const moved = Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6, moving = moved && tt > w && tt < e;
  const p0 = at(U(tt - 0.05)), p1 = at(U(tt + 0.05));
  const dir = moving ? [p1[0] - p0[0], p1[1] - p0[1]] : [b[0] - a[0], b[1] - a[1]];
  const mark = !!s.mark && !moving && (tt >= s.counts || (moved && tt < w) || tt >= e);
  return {p, moving, dir, phase: tt - w, face, mark, step, action, pose, poseBlend: pose ? jkPoseBlend(tt, w, e, moved) : 0, carry, carryFrom, carryBlend: (carry || 'play') === (carryFrom || 'play') ? 1 : jkCarryBlend(tt)};
}
// 向き（フィールド座標の角度、度）。null なら自動: 移動中は進行方向、止まると客席向き
function jkFacing(st) {
  if (st.face != null) return st.face;
  if (st.moving && Math.hypot(st.dir[0], st.dir[1]) > 1e-9) return Math.atan2(st.dir[1], st.dir[0]) * 180 / Math.PI + (st.step === 'back' ? 180 : 0);
  return -90;
}
function jkTempoAt(D, t) { return D.sets[jkSetAt(D, t)].tempo || D.tempo; }
