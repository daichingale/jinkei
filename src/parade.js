// パレード（吹奏楽連盟マーチングコンテストの規定課題 ①→②→③）の自動作成。画面に依存しない純粋なロジック。
// ブラウザでは window.JKParade、Node では module.exports。使い方と仕組みは README「パレード自動作成」。
//
// 考え方（全日本吹奏楽連盟 マーチングコンテスト 規定課題）
//  ① 3列以上の縦隊が四角形ライン（20m 線の外側）を一周する。行進は止めない。一周 = 全員が出発位置に戻る。
//  ② センターラインに沿って行進し、180°ターン（カウンターマーチ）を1回以上。ターンの前後は2歩以上まっすぐ。ドラムメジャー（DM）も同時にターン。
//  ③ 足踏み演奏を連続32歩以上（客席向き）。
//
// 実装の約束
//  ・直進は、縦（段）・横（列）が揃ったまま、全員がきっちり 1 本の直線を一定の歩幅で歩く（歩幅の格子に載る）。
//  ・角は 3 通り（拍数 N を選ぶ）
//      pinblock : ブロック全体が内側の先頭の人を軸に 90° 回る（軸の人は足踏み）。1 セット。
//      pinseq   : 段ごとに順番に（1 段ずつ遅れて）N 拍で回る。内側の列は小さい弧で小さい歩幅。
//      column   : 先頭について曲がる（follow）。N = 曲がり弧の長さ（0 = 直角）。内側の列ほど歩幅が小さい。
//  ・② は列ごとに、先頭の人から順にターンする（follow）。隣の列との間のレーンへ折り返す。
//  ・座標は「反時計回りの正準座標」で組み立て、時計回りは左右反転して出力する。
(function (root) {
'use strict';
const PI = Math.PI, D2R = PI / 180, hyp = Math.hypot;
const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const dist = (a, b) => hyp(a[0] - b[0], a[1] - b[1]);
const norm180 = d => { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; };
const rotQ = (v, k) => { k = ((k % 4) + 4) % 4; let x = v[0], y = v[1]; for (let i = 0; i < k; i++) { const t = x; x = -y; y = t; } return [x, y]; };
const rotA = (p, c, deg) => { const a = deg * D2R, s = Math.sin(a), co = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co]; };
class Infeasible extends Error { constructor(m, why) { super(m); this.infeasible = true; this.why = why || m; } }

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
  V.front = V.area.y0;
  return V;
}
// コンテストのフロア。中心座標系（原点 = フロア中心）で組み立て、出力時に (cx, cy) を足す。20m ライン = 外周から 5m 内側
function floorOf(V) {
  if (V.type !== 'gym' && V.type !== 'floor') throw new Infeasible('マーチングコンテストの課題は体育館（30m×30m）またはフロアで使えます', 'venue');
  const hx = (V.area.x1 - V.area.x0) / 2, hy = (V.area.y1 - V.area.y0) / 2;
  if (hx < 9 || hy < 9) throw new Infeasible('フロアが小さすぎます（四角形ラインに 18m 四方以上が必要です）', 'venue');
  const inset = Math.min(5, Math.min(hx, hy) / 3);
  return {margin: V.type === 'gym' ? 4.2 : 0.3, hx, hy, cx: (V.area.x0 + V.area.x1) / 2, cy: (V.area.y0 + V.area.y1) / 2, ix: hx - inset, iy: hy - inset, inset};
}

// ================= ビルダー（セットと文を作りながら、全員の現在位置を持つ） =================
// 正準座標 = 反時計回り・左手が内側。mir = -1 のとき x を反転して出力（時計回り）
function makeBuilder(N, env) {
  const cur = new Array(N).fill(null), sets = [];
  const G = p => [r6(env.cx + env.mir * p[0]), r6(env.cy + p[1])];
  const mkStmt = (idx, shape, extra) => Object.assign({idx: idx.slice(), group: '', shape, xf: [], assign: null, wait: null, within: null, bend: null, face: null, step: env.style || null, action: null, pose: null, carry: null, note: [], tail: null, line: 0}, extra || {});
  const B = {cur, sets, G, env};
  B.snapshot = () => cur.map(p => G(p));
  B.newSet = (name, counts, o) => {
    const s = Object.assign({name: name || '', counts: r6(counts), hold: 0, mark: false, sub: false, label: '', kind: 'leg', tag: '', stmts: [], end: null}, o || {});
    sets.push(s); return s;
  };
  B.close = s => { s.end = B.snapshot(); };
  B.shift = (s, idx, dx, dy) => {
    if (!idx.length || (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12)) return;
    s.stmts.push(mkStmt(idx, {kind: 'same'}, {xf: [{kind: 'shift', d: [r6(env.mir * dx), r6(dy)]}]}));
    idx.forEach(i => { cur[i] = [cur[i][0] + dx, cur[i][1] + dy]; });
  };
  B.rot = (s, idx, C, a) => { // a: 正準座標での反時計回りの角度（度）
    if (!idx.length) return;
    const ag = r6(env.mir * a);
    s.stmts.push(mkStmt(idx, {kind: 'same'}, {xf: [{kind: 'rotate', a: ag, about: G(C)}], bend: r6(-ag)}));
    idx.forEach(i => { cur[i] = rotA(cur[i], C, a); });
  };
  // follow: pts は正準座標の経路（先頭の人の今の位置から）。先頭 = idx[0]。idx の並び = 先頭から
  B.follow = (s, idx, pts, sp) => {
    s.stmts.push(mkStmt(idx, {kind: 'follow', pts: pts.map(G), spacing: r6(sp)}, {assign: 'keep'}));
    let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += dist(pts[i], pts[i + 1]);
    idx.forEach((i, j) => { cur[i] = pointAlong(pts, Math.max(0, L - j * sp)); });
  };
  B.attr = (s, idx, face) => { if (idx.length) s.stmts.push(mkStmt(idx, {kind: 'attr'}, {face, step: null})); };
  // 整列（最初のセット）: 段ごとの直線。idx 列は左から右（先頭の人から）
  B.formation = (s, rows, singles, pos) => {
    pos.forEach((p, i) => { cur[i] = p; });
    rows.forEach(r => {
      if (r.length >= 2) s.stmts.push(mkStmt(r, {kind: 'line', a: G(pos[r[0]]), b: G(pos[r[r.length - 1]])}, {assign: 'keep'}));
      else s.stmts.push(mkStmt(r, {kind: 'at', p: G(pos[r[0]])}));
    });
    singles.forEach(i => s.stmts.push(mkStmt([i], {kind: 'at', p: G(pos[i])})));
  };
  return B;
}
function pointAlong(pts, d) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = dist(pts[i], pts[i + 1]);
    if (d <= l + 1e-12) { const t = l > 0 ? d / l : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; }
    d -= l;
  }
  return pts[pts.length - 1].slice();
}

// ================= 角の枠（フレーム） =================
// 正準の角: 手前の道は y = 0（外側の列の線）を +x へ、向こうの道は x = 0 を +y へ。内側は (-x, +y)。原点 K = 外側の列の角。
// フレーム {K, rot}: 正準 (x,y) → K + 90°×rot 回転
const G_ = (fr, p) => { const r = rotQ(p, fr.rot); return [fr.K[0] + r[0], fr.K[1] + r[1]]; };
const heading = rot => rotQ([1, 0], rot);

// 道（外側の列の先頭を追う基準）を、直線と角に分ける。ent/ex は正準座標の入口・出口
function makeItems(frames, S, endPt, ent, ex) {
  const items = [];
  let pos = S.slice(), u = heading(frames.length ? frames[0].rot : 0);
  const leg = (to, tag) => {
    const dx = to[0] - pos[0], dy = to[1] - pos[1], len = dx * u[0] + dy * u[1], cr = dx * u[1] - dy * u[0];
    if (len < -1e-7 || Math.abs(cr) > 1e-6) throw new Infeasible('このコースには収まりません（角の間隔が足りません）', 'geometry');
    items.push({kind: 'leg', p0: pos.slice(), p1: to.slice(), u: u.slice(), len: Math.max(0, len), tag});
    pos = to.slice();
  };
  frames.forEach((fr, j) => {
    u = heading(fr.rot);
    leg(G_(fr, ent(fr)), fr.tag);
    const ex_ = G_(fr, ex(fr));
    items.push({kind: 'corner', fr, entry: pos.slice(), exit: ex_, tag: fr.tag, name: fr.name});
    pos = ex_; u = rotQ(u, 1);
  });
  if (endPt) { if (!frames.length) u = heading(0); leg(endPt, 'end'); }
  return items;
}

// ================= 角の寸法 =================
function ceilTo(x, q) { return Math.ceil(x / q - 1e-9) * q; }
// 正準の角で、外側の列の弧（半径 Rr）が 20m ライン内に入らない最小の張り出し e を探す（外側の線 = 20m ライン + e）
function arcRingOk(Lx, Ly, Rr, ix, iy) {
  if (Rr < 1e-9) return Lx >= ix - 1e-9 && Ly >= iy - 1e-9;
  const cx = Lx - Rr, cy = -Ly + Rr;
  for (let b = 0; b <= 90; b += 1) {
    const x = cx + Rr * Math.sin(b * D2R), y = cy - Rr * Math.cos(b * D2R);
    if (x < ix - 1e-6 && y > -iy + 1e-6) return false;
  }
  return true;
}

// ================= 生成 =================
const STEPS = {'8to5': 0.5625, '6to5': 0.75, 'm5': 0.625, 'm75': 0.75};
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
  return ans;
}

const METHODS = [
  {id: 'pinseq', name: 'ピンホイール（順番に回る）', short: '順次ピンホイール', icon: 'pinseq',
   desc: '段が角に来た順に、1段ずつ N 拍で 90° 回る（先頭から1段ぶんの時間ずつ遅れて回り出す）。段は常に角の中心を向いてそろったまま回り、内側の列は小さな弧で小さい歩幅、外側の列は大きな弧。'},
  {id: 'pinblock', name: 'ピンホイール（ブロック全体）', short: 'ブロック・ピンホイール', icon: 'pinblock',
   desc: 'ブロック全体が内側の先頭の人を軸に、N 拍で 90° 回る（軸の人は足踏み）。1セットで終わる。人数が多く角の半径がとれない会場向き。'},
  {id: 'column', name: 'カラムターン（大きな弧で順番に）', short: 'カラムターン', icon: 'column',
   desc: '先頭の通った道を後ろの段が順にたどって曲がる。N は外側の列の弧の長さ（歩数）。弧は大きく、ゆるやかに曲がる。0 は最小の弧。'}
];
const PATTERNS = [
  {id: 'contest', name: 'マーチングコンテスト規定課題（①→②→③）', short: '規定課題 ①②③', icon: 'contest', parts: {lap: 1, center: 1, mark: 1},
   desc: '①四角形ラインを一周 → ②センターラインで180°ターン（カウンターマーチ） → ③客席向きで32歩以上の足踏み。ドラムメジャーが先頭に立てる。'},
  {id: 'lap', name: '①だけ：四角形ラインを一周', short: '①外周一周', icon: 'lap', parts: {lap: 1, center: 0, mark: 0},
   desc: '20m ラインの外側を、列を保ったまま一周して出発位置に戻る。行進は止まらない。'},
  {id: 'center', name: '②だけ：センターラインで往復（カウンターマーチ）', short: '②センターライン往復', icon: 'center', parts: {lap: 0, center: 1, mark: 0},
   desc: 'センターラインに沿って直進し、列ごとに先頭の人から順にUターンして戻る。ターンの前後は2歩以上まっすぐ。'},
  {id: 'mark', name: '③だけ：足踏み（客席向き）', short: '③足踏み32歩', icon: 'mark', parts: {lap: 0, center: 0, mark: 1},
   desc: '客席向きのブロックで、32歩以上（連続）足踏み演奏する。足踏みしながら向きを変えることもできる。'},
  {id: 'free', name: '自由な組み合わせ', short: '自由に組む', icon: 'free', parts: null,
   desc: '①②③のどれを入れるかを自分で選ぶ。'}
];
const PATTERN_BY = Object.fromEntries(PATTERNS.map(p => [p.id, p]));
const METHOD_BY = Object.fromEntries(METHODS.map(p => [p.id, p]));
const ceil4 = x => Math.ceil(x / 4 - 1e-9) * 4;
const ceil8 = x => Math.ceil(x / 8 - 1e-9) * 8;

// ================= 生成 =================
// o: {field, clearance, maxstep, sections:[{id,n}], order:[id], pattern, parts:{lap,center,mark}, corner:'pinseq'|'pinblock'|'column',
//     cornerCounts(4/8/12/16), ccw, files, fileGap(m), rankGap(m), stepM(m), style, startHold, endHold, markCounts(>=32), markPivot:'none'|'kami'|'shimo',
//     dm:'none'|'sec:<id>'|'new', dmTurn:'U'|'I', entry:'new'|'ordered'|'near', curPos:[[x,y]..]（order の並び）}
function generate(o) {
  let V, fl;
  try { V = venueOf(o.field || {type: 'gym', w: 30, d: 30}, {clearance: o.clearance, maxstep: o.maxstep}); fl = floorOf(V); } catch (e) { if (!e.infeasible) throw e; return {ok: false, error: e.message}; }
  const secs = o.sections || [], order = o.order || secs.map(s => s.id);
  const memAll = [];
  order.forEach(sid => { const s = secs.find(x => x.id === sid); if (s) for (let i = 1; i <= s.n; i++) memAll.push({id: sid + i, s: sid, i, n: s.n}); });
  const extraSections = [];
  let dmEnt = null;
  const dmMode = o.dm || 'none';
  if (dmMode === 'new' && secs.find(x => x.id === 'dm' && x.n >= 1)) { dmEnt = memAll.find(m => m.s === 'dm') || null; }
  else if (dmMode === 'new') { dmEnt = {id: 'dm1', s: 'dm', i: 1, n: 1, isNew: true}; extraSections.push({id: 'dm', label: 'ドラムメジャー', n: 1}); memAll.push(dmEnt); }
  else if (dmMode.startsWith('sec:')) { dmEnt = memAll.find(m => m.s === dmMode.slice(4)) || null; if (!dmEnt) return {ok: false, error: 'ドラムメジャーにするセクションが見つかりません'}; }
  const band = memAll.filter(m => m !== dmEnt), Nb = band.length;
  if (Nb < 3) return {ok: false, error: '3列以上の縦隊にするため、バンドの人数は3人以上にしてください（ドラムメジャーを除く）'};
  const pat = PATTERN_BY[o.pattern] || PATTERNS[0];
  const parts = Object.assign({lap: 0, center: 0, mark: 0}, pat.parts || o.parts || {lap: 1, center: 1, mark: 1});
  if (!parts.lap && !parts.center && !parts.mark) return {ok: false, error: '①②③のどれかを選んでください'};
  const method = METHOD_BY[o.corner] ? o.corner : 'pinseq';
  const notes = [];
  let q = +o.stepM > 0 ? +o.stepM : 0.625;
  q = Math.max(0.3, Math.min(1.2, q));
  const vmax = V.maxPer * 0.999;
  if (q > vmax) { notes.push(`歩幅 ${r6(q)}m は上限（${r6(vmax)}m）を超えるため ${r6(Math.floor(vmax / 0.0625) * 0.0625)}m にしました`); q = Math.floor(vmax / 0.0625) * 0.0625; }
  const nr0 = o.cornerCounts == null ? 8 : Math.max(4, Math.round(+o.cornerCounts) || 8);
  const par0 = {V, q, method, ccw: o.ccw !== false, style: o.style || 'glide', parts, markCounts: Math.max(32, Math.round(+o.markCounts || 32)), markPivot: o.markPivot || 'none',
    dmTurn: o.dmTurn === 'I' ? 'I' : 'U', dm: !!dmEnt, vmax, g: V.cl + 0.002, startHold: Math.max(0, Math.round(+o.startHold || 0)),
    endHold: o.endHold == null ? 8 : Math.max(0, Math.round(+o.endHold)), m: 2, Nreq: nr0};
  const w0 = +o.fileGap > 0 ? +o.fileGap : 1.25, nd0 = Math.max(2, Math.round((+o.rankGap > 0 ? +o.rankGap : 2 * q) / q));
  // 列数（既定: 人数に応じて 3〜6。指定があればそれを先頭に、細い順に試す）
  const fAuto = Nb < 24 ? 3 : Nb <= 40 ? 4 : Nb <= 64 ? 5 : 6;
  const f0 = +o.files > 0 ? Math.max(3, Math.min(Math.round(+o.files), Nb, 8)) : Math.min(fAuto, Nb);
  const cands = [f0];
  for (let F = f0 - 1; F >= 3; F--) cands.push(F);
  for (let F = f0 + 1; F <= Math.min(8, Nb); F++) cands.push(F);
  const wList = [w0]; if (!parts.center) [1.0, 0.75].forEach(v => { if (v < w0 - 1e-9) wList.push(v); });
  const ndList = [nd0]; if (method !== 'pinblock' && nd0 < 3) ndList.push(3);
  const nrList = method === 'pinseq' ? [nr0, nr0 + 4, nr0 + 8, nr0 + 12].filter(v => v <= 24) : [nr0];
  let built = null, lastErr = null;
  search: for (const nr of nrList) for (const F of cands) for (const nd of ndList) for (const w of wList) {
    const par = Object.assign({}, par0, {Nreq: nr, nd, nw: w / q, w, d: nd * q, tau: nd});
    try {
      built = planAll(par, fl, band, dmEnt, F);
      if (built.info && built.info.analytic && built.slots) {   // 動きの全体が会場の中に収まるか（体育館は外側に 4.5m の余白がある）
        const Tt = built.info.T || 0;
        for (let t = 0; t <= Tt + 1e-9; t += 0.5) for (let i = 0; i < built.slots.length; i++) { const a = built.info.analytic(i, t); if (a && !V.inb(a[0], a[1])) throw new Infeasible('動きが会場の外に出ます（人数・列数・間隔を減らすか、会場を広げてください）', 'bounds'); }
      }
      const nt = [];
      if (F !== f0 && !(+o.files > 0 && F === +o.files)) nt.push(`${f0}列では収まらないため、${F}列にしました`);
      if (w !== w0) nt.push(`列の間隔を ${r6(w)}m にしました`);
      if (nd !== nd0) nt.push(`段の間隔を ${nd} 歩にしました（${nr}拍で回るため）`);
      if (nr !== nr0 && method === 'pinseq') nt.push(`${nr0}拍では内側の人どうしが近づきすぎる（または外側の歩幅が上限を超える）ため、角を ${nr}拍にしました。列を細くするか段の間隔を広げると ${nr0}拍で回れます`);
      if (method === 'pinblock' && built.info && built.info.Neff !== nr0) nt.push(`ブロック全体が回るには外側の歩幅が大きくなるため、角を ${built.info.Neff}拍にしました。順次ピンホイールなら ${nr0}拍で回れます`);
      built.notes = nt.concat(built.notes);
      break search;
    } catch (e) { built = null; if (!e.infeasible) throw e; if (!lastErr || (nr === nr0 && F === f0 && nd === nd0 && w === w0)) lastErr = e; }
  }
  if (!built) return {ok: false, error: lastErr ? lastErr.message : 'このコースには収まりません'};
  return finish(o, built, memAll, band, dmEnt, extraSections, V, fl, notes.concat(built.notes));
}

// ================= 計画 =================
// 角の大きさ。pinseq: N 拍で回りきる中心（内側の人どうしの間隔 >= g、外側の歩幅 <= vmax）。column: 先頭が 90° 曲がる窓の大きさ A
function solveCorner(par, W, slots) {
  const {q, d, tau, method, vmax, g} = par, N = par.Nreq, h = q / 2;
  if (method === 'pinblock') {
    let rmax = 0; slots.forEach(s => { rmax = Math.max(rmax, hyp(s.k * d, W - s.o)); });
    let Nc = Math.max(4, ceil4(N));
    while ((PI / 2) * rmax / Nc > vmax + 1e-9 && Nc < 64) Nc += 4;
    if ((PI / 2) * rmax / Nc > vmax + 1e-9) throw new Infeasible('ブロックが大きすぎて回りきれません', 'block');
    return {N: Nc, Ro: W, hole: 0, rmax, mode: 'rot'};
  }
  if (method === 'pinseq') {
    const Ro = ceilTo(W + 2 * g * N / (PI * tau), h);
    if (Ro * PI / (2 * N) > vmax + 1e-9) throw new Infeasible(`横幅 ${r6(W)}m では ${N}拍で回りきれません（外側の歩幅 ${r6(Ro * PI / (2 * N))}m）`, 'wheel');
    return {N, Ro, hole: Ro - W, mode: 'rot'};
  }
  const gc = g * Math.SQRT2 / (q * tau);   // 角をはさんだ前後の人の間隔は、道に沿った間隔の 1/√2 まで縮む
  if (gc >= 0.9) throw new Infeasible('段の間隔が狭すぎてカラムターンできません', 'column');
  const A = ceilTo(Math.max(W / (1 - gc), W + 1), h);
  return {N: Math.round(2 * A / q), Ro: A, A, hole: A - W, mode: 'col'};
}
function planAll(par, fl, band, dmEnt, F) {
  const {q, d, w, m} = par;
  const Nb = band.length, R = Math.ceil(Nb / F), W = (F - 1) * w;
  const slots = [];
  for (let j = 0; j < Nb; j++) slots.push({k: Math.floor(j / F), o: W - (j % F) * w, dm: false});
  if (dmEnt) slots.push({k: -m, o: r6(Math.round(W / 2 / w) * w), dm: true});
  const N = slots.length, dmI = dmEnt ? N - 1 : -1;
  const colLen = (R - 1) * d, dmAhead = dmEnt ? m * d : 0;
  const cp = solveCorner(par, W, slots);
  const notes = [];
  const Rr = cp.Ro, hx = fl.hx, hy = fl.hy, h = q / 2;
  const ixq = ceilTo(fl.ix, h), iyq = ceilTo(fl.iy, h);
  const base = {par, fl, F, R, W, slots, N, dmI, cp, colLen, dmAhead};
  const ringOK = (Lx, Ly) => {
    if (!arcRingOk(Lx, Ly, par.method === 'column' ? 0 : Rr, fl.ix, fl.iy)) return false;
    if (par.method !== 'pinblock') return true;
    const P = [Lx - W, -Ly + W];
    for (let k = 0; k < R; k++) for (let a = 0; a <= 90; a += 2) {
      const p = rotA([P[0] - k * d, -Ly], P, a);
      if (Math.abs(p[0]) < fl.ix - 1e-6 && Math.abs(p[1]) < fl.iy - 1e-6) return false;
      if (Math.abs(p[0]) > hx + 3.5 || Math.abs(p[1]) > hy + 3.5) return false;
    }
    return true;
  };
  let best = null, lastErr = null, tries = 0;
  for (let e = 0; ixq + e <= hx - 0.8 + 1e-9 && iyq + e <= hy - 0.8 + 1e-9 && tries < 6; e += h) {
    const Lx = ixq + e, Ly = iyq + e;
    if (!ringOK(Lx, Ly)) { lastErr = new Infeasible('四角形ラインの外側に収まりません（人数・列数・間隔を減らすか、会場を広げてください）', 'ring'); continue; }
    try {
      const r = buildRoutine(Object.assign({}, base, {Lx, Ly, e}));
      r.notes = notes.slice();
      r.score = (r.info.rhythm ? 10 : 0) - e;
      if (!best || r.score > best.score) best = r;
      tries++;
      if (r.info.rhythm) break;
    } catch (err) { if (!err.infeasible) throw err; lastErr = err; }
  }
  if (!best) throw lastErr || new Infeasible('このコースには収まりません', 'ring');
  return best;
}

// ================= ルーチン全体 =================
function buildRoutine(c) {
  const {par, fl, F, R, W, slots, N, dmI, cp, Lx, Ly, colLen, dmAhead} = c;
  const {q, d, w, m, tau, method, parts} = par;
  const Rr = cp.Ro, hx = fl.hx, h = q / 2;
  const env = {mir: par.ccw ? 1 : -1, cx: fl.cx, cy: fl.cy, style: par.style};
  const B = makeBuilder(N, env);
  const all = []; for (let i = 0; i < N; i++) all.push(i);
  const bandIdx = all.filter(i => i !== dmI);
  const rows = []; for (let k = 0; k < R; k++) rows.push(bandIdx.filter(i => slots[i].k === k));
  const info = {F, R, W, w, d, q, N, method, method_name: METHOD_BY[method].short, Nreq: par.Nreq, Neff: cp.N, Ro: cp.Ro, hole: cp.hole, tau, Lx, Ly,
    roles: slots.map(s => ({k: s.k, o: s.o, dm: s.dm})), ring: {cx: fl.cx, cy: fl.cy, ix: fl.ix, iy: fl.iy, mir: env.mir}, parts: Object.assign({}, parts), colLen,
    minGap: par.g, rankStep: (PI / 2) * cp.Ro / cp.N};
  const Yo = r6(W / 2 - w / 4), rr = w / 4, aHead = dmAhead + 2 * q, bRun = colLen + 4 * q;
  const posAt = (Q, u, k, o) => { const n = [-u[1], u[0]]; return [Q[0] - u[0] * k * d + n[0] * o, Q[1] - u[1] * k * d + n[1] * o]; };
  const K = [[Lx, -Ly], [Lx, Ly], [-Lx, Ly], [-Lx, -Ly]];
  const Rc = cp.mode === 'col' ? cp.A : Rr;
  const entP = method === 'pinblock' ? [-W, 0] : cp.mode === 'col' ? [-Rc, 0] : [-Rr, 0], exP = method === 'pinblock' ? [0, W] : cp.mode === 'col' ? [0, Rc] : [0, Rr];
  const Rx = method === 'pinblock' ? W : Rc;
  const frames = [];
  let xs = null, S = null, xu0 = null, xt = null, pos0 = null, endPt = null, its = null, T = 0, tLap = 0;
  const floorEdge = hx + fl.margin;
  if (parts.lap) {
    for (let j = 0; j < 4; j++) frames.push({K: K[j], rot: j, tag: '①', num: j + 1});
    const xA = -Lx + Rx, entry0x = Lx - Rx;
    let lb = Math.max(xA, -hx + 1.25 + colLen);
    const ub = entry0x - dmAhead - 2 * q;
    if (lb > ub + 1e-9) { lb = Math.max(xA, -floorEdge + colLen); info.outside = true; }
    if (lb > ub + 1e-9) throw new Infeasible('この人数では出発位置の列が会場に収まりません（列数を増やすか、段の間隔を詰めてください）', 'start');
    lb = ceilTo(lb, h);
    xs = lb;
    let bestMod = 99;
    for (let x = lb; x <= ub + 1e-9; x += h) { const cc = (entry0x - x) / q, md = Math.abs(cc - Math.round(cc)) > 1e-6 ? 3 : Math.round(cc) % 8 === 0 ? 0 : Math.round(cc) % 4 === 0 ? 1 : 2; if (md < bestMod) { bestMod = md; xs = x; if (md === 0) break; } }
    S = [xs, -Ly];
    pos0 = slots.map(sl => posAt(S, [1, 0], sl.k, sl.o));
    endPt = S;
    const mk = xuTry => {
      const fr = frames.slice(0, 4);
      if (parts.center) fr.push({K: K[0], rot: 0, tag: '②', num: 1}, {K: [Lx, Yo], rot: 1, tag: '②', num: 2});
      return makeItems(fr, S, parts.center ? [xuTry, Yo] : S, () => entP, () => exP);
    };
    if (parts.center) {
      const xExit = Lx - Rx;
      const xu00 = Math.floor((xExit - colLen - 2 * q) / h + 1e-9) * h;
      let pick = null;
      for (let j = 0; j < 16; j++) {
        const xx = xu00 - j * h, xtt = xx - aHead;
        if (xtt - rr < -floorEdge + 0.5) break;
        const its2 = mk(xx); its2.forEach(it => { if (it.kind === 'corner') it.Ro = Rr; });
        const Tt = timelineOf(its2, q, cp);
        if (!pick) pick = {xx, its2};
        if (Math.abs(Tt / 8 - Math.round(Tt / 8)) < 1e-6) { pick = {xx, its2}; break; }
      }
      if (!pick) throw new Infeasible('センターラインに収まりません（段数が多すぎます）', 'center');
      xu0 = pick.xx; xt = xu0 - aHead; its = pick.its2; endPt = [xu0, Yo];
    } else its = mk();
    its.forEach(it => { if (it.kind === 'corner') it.Ro = Rr; });
    T = timelineOf(its, q, cp);
    let lapIdx = -1;
    its.forEach((it, i) => { if (it.kind === 'corner' && it.fr.tag === '①' && it.fr.num === 4) lapIdx = i + 1; });
    const lg = its[lapIdx];
    if (!lg || lg.kind !== 'leg') throw new Infeasible('周回の最後の直進がとれません', 'start');
    const lapDist = (xs - lg.p0[0]) * lg.u[0] + (-Ly - lg.p0[1]) * lg.u[1];
    if (lapDist < -1e-7) throw new Infeasible('出発位置が角の出口より手前です', 'start');
    tLap = lg.t0 + lapDist / q;
    info.rhythm = Math.abs(T / 8 - Math.round(T / 8)) < 1e-6;
    info.T = T; info.tLap = tLap;
  } else if (parts.center) {
    xt = -Math.round((bRun + dmAhead) / 2 / q) * q; xu0 = xt + aHead;
    pos0 = slots.map(sl => posAt([xu0, Yo], [-1, 0], sl.k, sl.o));
    info.rhythm = true;
  } else {
    pos0 = slots.map(sl => [sl.o - W / 2, -colLen / 2 + sl.k * d]);
    info.rhythm = true;
  }
  if (parts.center && (xt - rr < -floorEdge + 0.5 || xt + bRun + dmAhead > floorEdge - 0.5)) throw new Infeasible('センターラインに収まりません（段数が多すぎます）', 'center');
  const first = B.newSet('', 0, {kind: 'init', tag: '', label: '整列', hold: par.startHold, mark: par.startHold > 0});
  B.formation(first, rows.filter(r => r.length), dmI >= 0 ? [dmI] : [], pos0);
  B.close(first);
  info.start = B.snapshot();
  const ctx = {B, all, bandIdx, rows, info, Yo, rr, aHead, bRun, xu0, xt, xs, S, c, pos0};
  if (parts.lap) runTimeline(ctx, its, T, tLap);
  if (parts.center) centerRun(ctx);
  if (parts.mark) markRun(ctx);
  else if (parts.lap && !parts.center && par.endHold > 0) {
    const s = B.newSet('整列・停止', 0, {kind: 'mark', tag: '①', hold: par.endHold, mark: true, label: '整列・停止'});
    B.attr(s, all, 'front'); B.close(s);
  }
  info.setTags = B.sets.map(s => s.tag);
  info.setKinds = B.sets.map(s => s.kind);
  info.end = B.snapshot();
  return {B, info, slots, N, dmI, F, par, cp, fl};
}

// ---------------------------------------------------------------- ① 周回: 全員の軌道を「直線・円弧の区間」にして、8 カウントごとのセット（と、動きが変わる所のサブセット）に切る
// 順次ピンホイール/カラムターン: 段 k は先頭の k×τ カウント後に同じ道をたどる。ブロック: 全員同時
function timelineOf(its, q, cp) {
  let t = 0;
  its.forEach(it => {
    it.t0 = t;
    if (it.kind === 'leg') it.dur = it.len / q;
    else { it.dur = cp.mode === 'col' ? 2 * cp.A / q : cp.N; it.mode = cp.mode; it.C = G_(it.fr, [-it.Ro, it.Ro]); }
    t += it.dur; it.t1 = t;
  });
  return t;
}
function slotPieces(par, cp, sl, its, T) {
  const q = par.q, lam = par.method === 'pinblock' ? 0 : sl.k * par.tau, out = [];
  its.forEach((it, i) => {
    let a = it.t0 + lam, b = it.t1 + lam;
    if (i === 0) a = -1e9;
    if (i === its.length - 1) b = 1e9;
    const lo = Math.max(a, 0), hi = Math.min(b, T);
    if (it.kind === 'leg') { if (hi - lo > 1e-9) out.push({t0: lo, t1: hi, type: 'shift', vec: [it.u[0] * q * (hi - lo), it.u[1] * q * (hi - lo)]}); }
    else if (it.mode === 'rot') { if (hi - lo > 1e-9) out.push({t0: lo, t1: hi, type: 'rot', C: it.C, ang: 90 * (hi - lo) / it.dur}); }
    else {
      const ln = cp.A - sl.o, ha = a + it.dur / 2, v1 = rotQ([ln, 0], it.fr.rot), v2 = rotQ([0, ln], it.fr.rot), hd = it.dur / 2;
      const l1 = Math.max(a, 0), h1 = Math.min(ha, T), l2 = Math.max(ha, 0), h2 = Math.min(b, T);
      if (h1 - l1 > 1e-9) out.push({t0: l1, t1: h1, type: 'shift', vec: [v1[0] * (h1 - l1) / hd, v1[1] * (h1 - l1) / hd]});
      if (h2 - l2 > 1e-9) out.push({t0: l2, t1: h2, type: 'shift', vec: [v2[0] * (h2 - l2) / hd, v2[1] * (h2 - l2) / hd]});
    }
  });
  return out;
}
function evalPieces(p0, pieces, t) {
  let p = p0.slice();
  for (const pc of pieces) {
    if (pc.t0 >= t) break;
    const f = Math.min(1, (t - pc.t0) / (pc.t1 - pc.t0));
    if (pc.type === 'shift') p = [p[0] + pc.vec[0] * f, p[1] + pc.vec[1] * f]; else p = rotA(p, pc.C, pc.ang * f);
  }
  return p;
}
function runTimeline(x, its, T, tLap) {
  const {B, info, pos0} = x, {par, slots, cp, R} = x.c, {tau} = par;
  const pcs = slots.map(sl => slotPieces(par, cp, sl, its, T));
  info.analytic = (slot, t) => B.G(evalPieces(pos0[slot], pcs[slot], t));
  const ev = new Set([0, r6(T)]);
  pcs.forEach(ps => ps.forEach(pc => { ev.add(r6(pc.t0)); ev.add(r6(pc.t1)); }));
  const lead = r6(((T % 8) + 8) % 8) > 1e-6 && r6(((T % 8) + 8) % 8) < 8 - 1e-6 ? r6(((T % 8) + 8) % 8) : 0;   // 合計が 8 の倍数でないとき、最初のセットを短くして以後を 8 拍ごとにそろえる
  info.lead = lead;
  if (lead > 1e-9) ev.add(lead);
  for (let t = lead + 8; t < T - 1e-9; t += 8) ev.add(r6(t));
  if (tLap > 1e-9 && tLap < T - 1e-9) ev.add(r6(tLap));
  const times = [...ev].filter(t => t >= 0 && t <= r6(T)).sort((a, b) => a - b);
  const ptr = slots.map(() => 0), cnt = {};
  const lamTail = par.method === 'pinblock' ? 0 : (R - 1) * tau;
  const how = par.method === 'pinseq' ? 'ピンホイール' : par.method === 'pinblock' ? 'ブロックピンホイール' : 'カラムターン';
  const describe = (w0, w1) => {
    const out = [];
    its.forEach(it => {
      if (it.kind !== 'corner') return;
      const nm = `${it.fr.tag}角${it.fr.num}`;
      if (it.t0 >= w0 - 1e-9 && it.t0 < w1 - 1e-9) out.push(`先頭が${nm}で${how}`);
      if (par.method !== 'pinblock' && it.t1 + lamTail > w0 + 1e-9 && it.t1 + lamTail <= w1 + 1e-9) out.push(`最後尾が${nm}を回り終える`);
    });
    if (tLap > w0 + 1e-9 && tLap <= w1 + 1e-9) out.push('先頭が出発位置に戻る（①おわり）');
    return out.length ? out.join('、') : '直進';
  };
  for (let z = 0; z + 1 < times.length; z++) {
    const ta = times[z], tb = times[z + 1], tm = (ta + tb) / 2, len = tb - ta;
    if (len < 1e-9) continue;
    const groups = new Map();
    slots.forEach((sl, i) => {
      const ps = pcs[i];
      while (ptr[i] < ps.length - 1 && ps[ptr[i]].t1 <= tm) ptr[i]++;
      const pc = ps[ptr[i]];
      if (!pc) return;
      const f = len / (pc.t1 - pc.t0);
      if (pc.type === 'shift') {
        const dx = pc.vec[0] * f, dy = pc.vec[1] * f, key = 'S' + r6(dx) + ',' + r6(dy);
        let g = groups.get(key); if (!g) groups.set(key, g = {type: 'shift', d: [dx, dy], idx: []}); g.idx.push(i);
      } else {
        const a = pc.ang * f, key = 'R' + r6(pc.C[0]) + ',' + r6(pc.C[1]) + ',' + r6(a);
        let g = groups.get(key); if (!g) groups.set(key, g = {type: 'rot', C: pc.C, a, idx: []}); g.idx.push(i);
      }
    });
    const tag = tb <= tLap + 1e-9 ? '①' : '②';
    const isMain = z === 0 || Math.abs((ta - lead) / 8 - Math.round((ta - lead) / 8)) < 1e-6;
    const pureLeg = [...groups.values()].every(g => g.type === 'shift') && new Set([...groups.values()].map(g => Math.abs(g.d[0]) > Math.abs(g.d[1]) ? (g.d[0] > 0 ? '+x' : '-x') : (g.d[1] > 0 ? '+y' : '-y'))).size === 1;
    let s;
    if (isMain) {
      cnt[tag] = (cnt[tag] || 0) + 1;
      const w1 = ta < lead - 1e-9 ? lead : lead + (Math.floor((ta - lead) / 8 + 1e-9) + 1) * 8;
      s = B.newSet(`${tag}${cnt[tag]}`, len, {kind: pureLeg ? 'leg' : 'corner', tag, label: '', tail: describe(ta, Math.min(T, w1))});
    } else s = B.newSet('', len, {kind: pureLeg ? 'leg' : 'corner', tag, label: '', sub: true});
    groups.forEach(g => { if (g.type === 'shift') B.shift(s, g.idx, g.d[0], g.d[1]); else B.rot(s, g.idx, g.C, g.a); });
    B.close(s);
  }
}

// ---------------------------------------------------------------- ② センターラインで180°ターン（カウンターマーチ）
function centerRun(x) {
  const {B, H, info, Yo, rr, aHead, bRun, xu0, xt} = x, {par, slots, dmI, colLen, dmAhead, W} = x.c, {q, d, w, m} = par;
  const lanes = new Map();
  slots.forEach((sl, i) => { if (i === dmI) return; if (!lanes.has(sl.o)) lanes.set(sl.o, []); lanes.get(sl.o).push(i); });
  lanes.forEach(a => a.sort((p, r) => slots[p].k - slots[r].k));
  const uPts = (yf, sharp) => {
    const pts = [[xu0, yf], [xt, yf]];
    if (sharp) pts.push([xt, yf + w / 2]);
    else for (let th = -105; th >= -270; th -= 15) pts.push([xt + rr * Math.cos(th * D2R), yf + rr + rr * Math.sin(th * D2R)]);
    return pts;
  };
  const len = pts => { let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += dist(pts[i], pts[i + 1]); return L; };
  const lane0 = uPts(Yo, false), Lmax = len(lane0) + bRun;
  const counts = ceil8(Lmax / q);
  const s = B.newSet(par.dmTurn === 'I' && dmI >= 0 ? '②Uターン（ドラムメジャーはIターン）' : '②Uターン', counts, {kind: 'center', tag: '②', label: 'カウンターマーチ'});
  [...lanes.keys()].sort((a, b) => a - b).forEach(o => {
    const yf = Yo - o, pts = uPts(yf, false); pts.push([xt + bRun, yf + w / 2]);
    B.follow(s, lanes.get(o), pts, d);
  });
  if (dmI >= 0) {
    const yf = Yo - slots[dmI].o, pts = uPts(yf, par.dmTurn === 'I');
    pts.push([xt + bRun, yf + w / 2]);
    const pe = [[xu0 - dmAhead, yf]].concat(pts.slice(1)); pe.push([xt + bRun + dmAhead, yf + w / 2]);
    B.follow(s, [dmI], pe, d);
  }
  B.close(s);
  info.u = {pre: (aHead - dmAhead) / q, post: (bRun - colLen) / q, turn: par.dmTurn};
}
// ---------------------------------------------------------------- ③ 客席向きで足踏み
function markRun(x) {
  const {B, info, all} = x, {par, slots} = x.c, {vmax, parts} = par;
  if (parts.lap || parts.center) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    all.forEach(i => { const p = B.cur[i]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    const C = [(x0 + x1) / 2, (y0 + y1) / 2];
    let rmax = 0; all.forEach(i => { rmax = Math.max(rmax, dist(B.cur[i], C)); });
    const Nt = Math.max(8, ceil8((PI / 2) * rmax / vmax));
    const s = B.newSet('③客席へ向き直る', Nt, {kind: 'rot', tag: '③', label: '客席向き'});
    B.rot(s, all, C, -90); B.close(s);
  }
  const n = par.markCounts;
  const pivot = par.markPivot === 'kami' || par.markPivot === 'shimo' ? par.markPivot : 'none';
  const n1 = pivot === 'none' ? n : Math.ceil(n / 2 / 4) * 4;
  let s = B.newSet(`③足踏み${n}歩`, 0, {kind: 'mark', tag: '③', hold: n1, mark: true, label: '足踏み'});
  B.attr(s, all, 'front'); B.close(s);
  if (pivot !== 'none') {
    s = B.newSet(`③足踏み（${pivot === 'kami' ? '上手' : '下手'}向き）`, 0, {kind: 'mark', tag: '③', hold: n - n1, mark: true, label: '足踏み'});
    B.attr(s, all, pivot); B.close(s);
  }
  info.markCounts = n;
}

// ================= 仕上げ（人の割り当て・名前・入場） =================
function groupString(idxs, slotMem, mem, total, allowAll) {
  if (allowAll && idxs.length === total) return 'all';
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
function finish(o, built, memAll, band, dmEnt, extraSections, V, fl, notes) {
  const {B, info, slots, N, dmI, par} = built;
  const slotMem = new Array(N);
  band.forEach((b, j) => { slotMem[j] = memAll.indexOf(b); });
  if (dmEnt) slotMem[dmI] = memAll.indexOf(dmEnt);
  const F0 = info.start.map(p => p.slice());
  let entryCounts = 0;
  const base = memAll.filter(mm => !mm.isNew);
  if ((o.entry === 'near' || o.entry === 'ordered') && o.curPos && o.curPos.length === base.length) {
    const curOf = mm => o.curPos[base.indexOf(mm)];
    if (o.entry === 'near') {
      const nb = band.length, cost = band.map(b => { const cp0 = curOf(b); return slots.slice(0, nb).map((_, sl) => { const d0 = dist(cp0, F0[sl]); return d0 * d0; }); });
      const ans = hungarian(cost);
      ans.forEach((sl, bi) => { slotMem[sl] = memAll.indexOf(band[bi]); });
    }
    let md = 0;
    for (let sl = 0; sl < N; sl++) { const mm = memAll[slotMem[sl]]; if (mm.isNew) continue; md = Math.max(md, dist(curOf(mm), F0[sl])); }
    entryCounts = md < 0.05 ? 0 : Math.max(4, Math.ceil(md / (par.vmax * 0.92) / 8) * 8);
  }
  const natural = slotMem.every((mi, i) => mi === i) || true;
  const sets = B.sets.map((s, k) => ({name: s.name, counts: k === 0 ? entryCounts : s.counts, hold: s.hold, mark: s.mark, sub: !!s.sub, label: s.label, tail: s.tail || null, kind: s.kind, tag: s.tag,
    stmts: s.stmts.map(st => Object.assign(st, {group: groupString(st.idx, slotMem, memAll, N, st.shape.kind === 'same' || st.shape.kind === 'attr')}))}));
  if (sets[0]) sets[0].name = entryCounts > 0 ? '入場' : '整列';
  const used = new Set();
  sets.forEach(s => { if (s.sub) return; let n = s.name, i = 2; while (used.has(n)) n = s.name + '_' + (i++); used.add(n); s.name = n; });
  let total = 0; sets.forEach(s => { total += s.counts + s.hold; });
  info.total = total; info.entryCounts = entryCounts; info.notes = notes;
  info.phases = ['①', '②', '③'].map(tg => { const ix = sets.map((s, k) => s.tag === tg ? k : -1).filter(k => k >= 0); return ix.length ? {tag: tg, from: ix[0], to: ix[ix.length - 1] + 1} : null; }).filter(Boolean);
  const rankIds = []; const R = info.R;
  for (let k = 0; k < R; k++) rankIds.push(slots.map((sl, i) => (sl.k === k && !sl.dm ? memAll[slotMem[i]].id : null)).filter(Boolean));
  const sections = extraSections.map(e => ({id: e.id, label: e.label, n: e.n}));
  if (info.lead > 1e-9) notes.push(`①②の合計が 8 の倍数にならないため、最初のセットを ${info.lead} 拍にして、あとを 8 拍ごとにそろえました`);
  return {ok: true, sets, mem: memAll, slotMem, info, notes, extraSections, sectionsFirst: sections, F: F0, vt: par.q, V, rankIds, fl};
}

// ================= 検算（チェックリスト） =================
// r: generate の結果、D: コンパイル結果の data、stateFn: jkState、off: D のセット番号と r.sets の番号のずれ
function validate(r, D, stateFn, off, o) {
  off = off || 0; o = o || {};
  const info = r.info, tags = info.setTags || r.sets.map(s => s.tag), checks = [];
  const add = (id, label, ok, detail) => checks.push({id, label, ok: !!ok, detail: detail || ''});
  const mi = slot => r.slotMem[slot];
  const parts = info.parts || {};
  const roles = info.roles;
  const startOf = k => D.sets[k + off].start, endOf = k => D.sets[k + off].start + D.sets[k + off].counts;
  if (parts.lap) {
    const lapK = tags.map((t, k) => t === '①' ? k : -1).filter(k => k >= 0);
    const t0 = startOf(lapK[0]), t1 = endOf(lapK[lapK.length - 1]);
    const rg = info.ring;
    let worst = 1e9, minMoving = 1e9;
    for (let t = t0; t <= t1 + 1e-9; t += 0.25) {
      roles.forEach((ro, slot) => {
        if (ro.dm || ro.o > 1e-9) return;
        const p = stateFn(D, mi(slot), t).p;
        const ins = Math.min(rg.ix - Math.abs(p[0] - rg.cx), rg.iy - Math.abs(p[1] - rg.cy));
        worst = Math.min(worst, -ins);
      });
    }
    for (let t = t0 + 0.37; t < t1 - 0.4; t += 0.5) {
      let mv = 0; roles.forEach((ro, slot) => { if (stateFn(D, mi(slot), t).moving) mv++; });
      minMoving = Math.min(minMoving, mv);
    }
    add('ring', '外側の列がずっと 20m ライン上か外側', worst >= -1e-3, worst >= -1e-3 ? `ラインから最小 ${(Math.max(0, worst)).toFixed(2)}m 外側` : `ラインの内側に ${(-worst).toFixed(2)}m 入る`);
    add('nostop', '①の間、止まらず行進（軸の人 1 人まで）', minMoving >= roles.length - 1, `動いている人は最少 ${minMoving} / ${roles.length}`);
    const e = D.sets[lapK[lapK.length - 1] + off].pos, s0 = D.sets[off].pos;
    let md = 0; roles.forEach((ro, slot) => { if (ro.k > 0) return; const i = mi(slot); md = Math.max(md, dist(e[i], s0[i])); });
    add('return', '先頭の段が出発位置に戻る', md < 0.05, `最大のずれ ${md.toFixed(3)}m`);
  }
  if (parts.center && info.u) {
    add('uturn', '180°ターンの前後に 2 歩以上の直進', info.u.pre >= 2 - 1e-9 && info.u.post >= 2 - 1e-9, `ターン前 ${r6(info.u.pre)} 歩・ターン後 ${r6(info.u.post)} 歩`);
  }
  if (parts.mark) {
    let run = 0, best = 0;
    D.sets.slice(off).forEach(s => { if (s.mark && !s.counts) { run += s.hold; best = Math.max(best, run); } else if (!s.hold) run = 0; else { run = 0; } });
    add('mark', '足踏みが連続 32 歩以上', best >= 32, `連続 ${best} 歩`);
  }
  const W = D.warnings || [];
  ['衝突', '大股', '場外'].forEach(k => { const n = W.filter(w => w.kind === k).length; add('w' + k, k + 'なし', n === 0, n ? `${n} 件` : ''); });
  return {ok: checks.every(c => c.ok), checks};
}

root.JKParade = {PATTERNS, PATTERN_BY, METHODS, METHOD_BY, generate, validate, STEPS};
root.JKParadeCore = {venueOf, floorOf, r6, dist, hungarian, groupString};
if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign(root.JKParade, {core: root.JKParadeCore});
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
