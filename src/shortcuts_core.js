// ショートカットと「人を増やす・減らす」の、画面に依存しない部分。
// ブラウザでは window.JKSC、Node では module.exports として使える（tests/shortcuts.js で検証）。
//  - 人の削除・追加（モデルを書き換える。ほかの人の位置は動かさない／詰める）
//  - 位置の貼り付け
//  - キーの表記（"Mod+Shift+N"）の読み書き・競合検出・あいまい検索
(function (root) {
'use strict';
const clone = o => JSON.parse(JSON.stringify(o));
const r2 = v => Math.round(v * 100) / 100;
const num6 = v => { const x = Math.round(v * 1e6) / 1e6; return String(Object.is(x, -0) ? 0 : x); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nOf = v => { const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10); return Number.isFinite(n) ? n : NaN; };

// ================= 文（モデル）の部品 =================
const mkStmt = (group, shape) => ({group, shape, xf: [], assign: null, wait: null, within: null, bend: null, face: null, step: null, action: null, pose: null, carry: null, note: [], tail: null, line: 0});
const isIndividual = st => st.shape.kind === 'at' && !st.xf.length && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(st.group.trim()) && st.group.trim() !== 'all';
const groupTokens = g => String(g).split('+').map(x => x.trim()).filter(Boolean);
// 属性だけの文（pose/face…）は、位置を決める文より後ろに置く決まりなので、その手前に入れる
function pushPositional(set, st) {
  let at = set.stmts.length;
  while (at > 0 && set.stmts[at - 1].shape.kind === 'attr') at--;
  set.stmts.splice(at, 0, st);
}
// 向き（数値: 客席 0°、上手側が +）の文字
function faceStr(N) {
  const n = ((N + 180) % 360 + 360) % 360 - 180, m = n === -180 ? 180 : n;
  if (Math.abs(m) < 0.01) return 'front';
  if (Math.abs(m - 90) < 0.01) return 'kami';
  if (Math.abs(m + 90) < 0.01) return 'shimo';
  if (Math.abs(Math.abs(m) - 180) < 0.01) return 'back';
  return String(r2(m));
}
// 1人の「個別の位置」（1人用の at 文）を、そのセットの最後に置き直す。後に書いた指定が優先なので必ず効く
function setPin(model, k, id, p, attrs) {
  const set = model.sets[k];
  const old = set.stmts.findIndex(s => isIndividual(s) && s.group.trim() === id);
  let keep = null;
  if (old >= 0) { keep = set.stmts[old]; set.stmts.splice(old, 1); }
  const st = mkStmt(id, {kind: 'at', p: [num6(p[0]), num6(p[1])]});
  if (keep) for (const f of ['wait', 'within', 'bend', 'face', 'step', 'action', 'pose', 'carry']) st[f] = keep[f];
  if (attrs) Object.assign(st, attrs);
  pushPositional(set, st);
  return st;
}

// ================= メンバー表 =================
function perfInfo(D) {
  const perf = new Map(), count = new Map();
  D.performers.forEach((p, i) => {
    const sid = D.sections[p.sec].id, num = parseInt(p.id.slice(sid.length), 10);
    perf.set(p.id, {id: p.id, idx: i, sid, sec: p.sec, num});
    count.set(sid, (count.get(sid) || 0) + 1);
  });
  return {perf, count};
}

// ================= 削除 =================
function removalPlan(D, removeIds) {
  const {perf} = perfInfo(D), rm = new Set(removeIds), plan = {}, by = new Map();
  for (const id of rm) if (!perf.has(id)) throw new Error(`「${id}」というメンバーはいません`);
  D.performers.forEach(p => { const x = perf.get(p.id); if (!by.has(x.sid)) by.set(x.sid, []); by.get(x.sid).push(x); });
  for (const [sid, arr] of by) {
    if (!arr.some(x => rm.has(x.id))) continue;
    arr.sort((a, b) => a.num - b.num);
    const newOf = new Map(); let c = 0;
    for (const x of arr) if (!rm.has(x.id)) newOf.set(x.num, ++c);
    plan[sid] = {oldN: arr.length, newN: c, newOf};
  }
  return {plan, perf};
}
const newIdOf = (perf, plan, id) => {
  const p = perf.get(id), pl = plan[p.sid];
  if (!pl) return id;
  const n = pl.newOf.get(p.num);
  return n == null ? null : p.sid + n;
};
// 対象の書き方（tp + tb2..tb4 など）を、人が抜けたあとの番号に書き直す。誰もいなくなったら null
function rewriteGroup(group, plan, perf) {
  const out = [];
  for (const t of groupTokens(group)) {
    if (t === 'all') { out.push(t); continue; }
    const m = t.split('..');
    if (m.length === 1) {
      if (plan[t]) { if (plan[t].newN > 0) out.push(t); continue; }
      const p = perf.get(t), pl = p && plan[p.sid];
      if (!pl) { out.push(t); continue; }
      const n = pl.newOf.get(p.num);
      if (n != null) out.push(p.sid + n);
    } else if (m.length === 2) {
      const a = perf.get(m[0]), b = perf.get(m[1]);
      if (!a || !b || a.sid !== b.sid || !plan[a.sid]) { out.push(t); continue; }
      let first = null, last = null;
      for (let n = a.num; n <= b.num; n++) { const nn = plan[a.sid].newOf.get(n); if (nn != null) { if (first == null) first = nn; last = nn; } }
      if (first != null) out.push(first === last ? a.sid + first : `${a.sid}${first}..${a.sid}${last}`);
    } else out.push(t);
  }
  return out.length ? out.join(' + ') : null;
}
function applyRemoval(model, plan, perf) {
  const m = clone(model), droppedParts = [], droppedSections = [];
  const rw = g => { const r = rewriteGroup(g, plan, perf); if (r == null) return null; return r === groupTokens(g).join(' + ') ? g : r; };
  for (const set of m.sets) set.stmts = set.stmts.filter((st, oi) => { const g = rw(st.group); if (g == null) return false; st.group = g; st._oi = oi; return true; });
  m.parts = (m.parts || []).filter(p => { const g = rw(p.group); if (g == null) { droppedParts.push(p.name); return false; } p.group = g; return true; });
  for (const sid of Object.keys(plan)) {
    const i = m.sections.findIndex(s => s.id === sid), pl = plan[sid];
    if (i < 0) continue;
    if (pl.newN === 0) { droppedSections.push(m.sections[i].label); m.sections.splice(i, 1); }
    else m.sections[i].n = typeof m.sections[i].n === 'number' ? pl.newN : String(pl.newN);
  }
  return {model: m, droppedParts, droppedSections};
}

// そのセクションに「楽譜」や「個別の指定」など、消すと失われるものがあるか
function sectionHasData(model, sid, D) {
  const ids = new Set(D ? D.performers.filter(p => D.sections[p.sec].id === sid).map(p => p.id) : []);
  const hit = g => groupTokens(g).some(t => t === sid || ids.has(t) || t.split('..').some(x => ids.has(x)));
  if ((model.parts || []).some(p => hit(p.group))) return true;
  return model.sets.some(s => s.stmts.some(st => (st.shape.kind === 'attr' || isIndividual(st)) && hit(st.group) && st.group.trim() !== sid));
}



// 残す人の「元の位置」(want: 新しい名前 → {old: 元の番号, pos: セットごとの位置}) と食い違う人だけ、
// 最初にずれたセットに個別の位置（1人用の at 文）を置いて、完全に元どおりにする
async function stabilize(cur, want, R0, D, opts, Rc) {
  const orig = R0.model, K = D.sets.length;
  let pinned = 0;
  for (let it = 0; it < K + 3; it++) {
    const idx = new Map(Rc.data.performers.map((p, i) => [p.id, i]));
    let any = false;
    for (const [nid, w] of want) {
      const j = idx.get(nid);
      for (let k = 0; k < K; k++) {
        if (dist(Rc.data.sets[k].pos[j], w.pos[k]) <= 1e-4) continue;
        any = true;
        const si = R0.owner && R0.owner[k] ? R0.owner[k][w.old] : -1, os = si >= 0 && orig.sets[k].stmts[si] ? orig.sets[k].stmts[si] : null;
        const attrs = {};
        if (os && os.shape.kind !== 'attr') {
          for (const f of ['wait', 'within', 'bend', 'step', 'action', 'pose', 'carry']) if (os[f] != null && os[f] !== '') attrs[f] = os[f];
          if (os.face != null && os.face !== '') {
            if (/^(center|out|中心|外)/.test(String(os.face).trim())) { const fd = D.sets[k].face && D.sets[k].face[w.old]; if (fd != null) attrs.face = faceStr(fd + 90); }
            else attrs.face = os.face;
          }
        }
        setPin(cur, k, nid, w.pos[k], attrs); pinned++;
        break; // 最初にずれたセットだけ。あとのセットは次の計算で確かめる
      }
    }
    if (!any) break;
    Rc = await opts.compile(opts.print(cur));
    if (!Rc.ok) return {ok: false, error: '組み立てられませんでした: ' + (Rc.error && Rc.error.msg || '')};
  }
  const idx = new Map(Rc.data.performers.map((p, i) => [p.id, i]));
  let worst = 0;
  for (const [nid, w] of want) for (let k = 0; k < K; k++) worst = Math.max(worst, dist(Rc.data.sets[k].pos[idx.get(nid)], w.pos[k]));
  return {ok: true, Rc, pinned, exact: worst <= 1e-4, maxDiff: worst};
}

// 空き（skip）: 抜けた人の席を空けて、隊形そのものは変えない（個別の位置を増やさずに、ほかの人をその場に残す）
// 対象は line / arc / circle / block / curve / poly の文。same・follow・at は席の概念がないので、あとで個別に固定する
const SKIP_SHAPES = new Set(['line', 'arc', 'circle', 'block', 'curve', 'poly']);
function applySkips(cur, base, R0, removeIds) {
  const D = R0.data, rm = new Set(removeIds);
  let n = 0;
  cur.sets.forEach((set, k) => {
    for (const st of set.stmts) {
      const oi = st._oi;
      if (oi == null) continue;
      const os = base.sets[k].stmts[oi];
      if (!os) continue;
      // same + rotate は、グループの重心まわりに回る。人が抜けると重心が動くので、元の重心を about に書いて回転の中心を固定する
      if (os.shape.kind === 'same' && k > 0 && os.xf.some(x => x.kind === 'rotate' && !x.about)) {
        const mm = R0.members && R0.members[k] && R0.members[k][oi];
        if (mm && mm.some(pi => rm.has(D.performers[pi].id))) {
          const ps = mm.map(pi => D.sets[k - 1].pos[pi]), c = [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
          st.xf.forEach(x => { if (x.kind === 'rotate' && !x.about) x.about = [num6(c[0]), num6(c[1])]; });
        }
        continue;
      }
      if (!SKIP_SHAPES.has(os.shape.kind)) continue;
      const mem = R0.members && R0.members[k] && R0.members[k][oi], slots = D.sets[k].slots && D.sets[k].slots[oi];
      if (!mem || !slots || mem.length !== slots.length) continue;
      const add = [];
      mem.forEach((pi, gi) => { if (rm.has(D.performers[pi].id) && slots[gi] > 0) add.push(slots[gi]); });
      if (!add.length) continue;
      st.skip = [...new Set([...(os.skip || []), ...add])].sort((a, b) => a - b);
      n += add.length;
    }
  });
  return n;
}
const stripTmp = m => { for (const set of m.sets) for (const st of set.stmts) { delete st._oi; delete st._ord; } };
// 空きを詰める: skip を外して隊形を作り直す（その分、人の位置は動く）。filter(k, si, st) が真の文だけ
function closeSkips(model, filter) {
  const m = clone(model);
  let n = 0;
  m.sets.forEach((set, k) => set.stmts.forEach((st, si) => { if (st.skip && st.skip.length && (!filter || filter(k, si, st))) { n += st.skip.length; st.skip = []; } }));
  return {model: m, closed: n};
}

// 自動の割り当ては、人が減ると同点に近い人どうしが入れ替わることがある。入れ替わった文は、
// 「元の席の順」に人を並べて assign keep にして、席と人の組み合わせをそのまま保つ（個別の位置は増やさない）
function groupByOrder(ids, pinfo) {
  const out = []; let run = null;
  const flush = () => { if (!run) return; out.push(run.a === run.b ? run.sid + run.a : `${run.sid}${run.a}..${run.sid}${run.b}`); run = null; };
  for (const id of ids) {
    const p = pinfo.get(id);
    if (!p) { flush(); out.push(id); continue; }
    if (run && run.sid === p.sid && p.num === run.b + 1) run.b = p.num;
    else { flush(); run = {sid: p.sid, a: p.num, b: p.num}; }
  }
  flush();
  return out.join(' + ');
}
async function orderBySlots(cur, want, R0, D, opts, Rc, idMap) {
  const K = D.sets.length, oldOf = new Map();
  D.performers.forEach((p, i) => { if (idMap[p.id]) oldOf.set(idMap[p.id], i); });
  let ordered = 0;
  for (let it = 0; it < 3; it++) {
    const idx = new Map(Rc.data.performers.map((p, i) => [p.id, i])), todo = new Set(), pinfo = perfInfo(Rc.data).perf;
    for (const [nid, w] of want) {
      const j = idx.get(nid);
      for (let k = 0; k < K; k++) {
        if (dist(Rc.data.sets[k].pos[j], w.pos[k]) <= 1e-4) continue;
        const si = Rc.owner && Rc.owner[k] ? Rc.owner[k][j] : -1, st = si >= 0 ? cur.sets[k].stmts[si] : null;
        if (st && st._oi != null && !st._ord && SKIP_SHAPES.has(st.shape.kind)) todo.add(k + ':' + si);
        break;
      }
    }
    if (!todo.size) break;
    for (const key of todo) {
      const [k, si] = key.split(':').map(Number), st = cur.sets[k].stmts[si], oi = st._oi;
      const mem0 = R0.members[k][oi], slots0 = D.sets[k].slots[oi], mem1 = Rc.members[k][si];
      const rows = mem1.map(pj => {
        const old = oldOf.get(Rc.data.performers[pj].id), gi = mem0.indexOf(old);
        return {id: Rc.data.performers[pj].id, slot: gi >= 0 ? slots0[gi] : 1e9};
      });
      if (rows.some(r => r.slot >= 1e9)) { st._ord = 1; continue; }
      rows.sort((a, b) => a.slot - b.slot);
      st.group = groupByOrder(rows.map(r => r.id), pinfo); st.assign = 'keep'; st._ord = 1; ordered++;
    }
    Rc = await opts.compile(opts.print(cur));
    if (!Rc.ok) return {ok: false, error: '組み立てられませんでした: ' + (Rc.error && Rc.error.msg || '')};
  }
  return {ok: true, Rc, ordered};
}

// 人を抜く。opts: {mode: 'keep'（その場から抜く。ほかの人は動かない）| 'reflow'（詰める）, compile(src)→Promise<結果>, print(model)→文字列}
async function deleteMembers(M, removeIds, opts) {
  const mode = opts.mode === 'reflow' ? 'reflow' : 'keep';
  const R0 = await opts.compile(opts.print(M));
  if (!R0 || !R0.ok) return {ok: false, error: '今のショーを読み込めないため、削除できません'};
  const D = R0.data, base = R0.model || M;
  const ids = [...new Set(removeIds)];
  if (!ids.length) return {ok: false, error: '消す人が選ばれていません'};
  if (ids.length >= D.performers.length) return {ok: false, error: '全員は削除できません（最低1人は残してください）'};
  let pl;
  try { pl = removalPlan(D, ids); } catch (e) { return {ok: false, error: e.message}; }
  const {plan, perf} = pl;
  for (const sid of Object.keys(plan)) { const s = base.sections.find(x => x.id === sid); if (!s || !Number.isFinite(nOf(s.n))) return {ok: false, error: `セクション ${sid} の人数が数字ではないため、削除できません`}; }
    const rm = applyRemoval(base, plan, perf);
  let cur = rm.model;
  const res = {ok: true, mode, removed: ids.length, pinned: 0, droppedParts: rm.droppedParts, droppedSections: rm.droppedSections, exact: true, maxDiff: 0};
  // 抜けたあとの番号
  res.idMap = {}; D.performers.forEach(p => { res.idMap[p.id] = newIdOf(perf, plan, p.id); });
  res.skipped = mode === 'keep' ? applySkips(cur, base, R0, ids) : 0;
  let Rc = await opts.compile(opts.print(cur));
  if (!Rc.ok) return {ok: false, error: '削除後のショーを組み立てられませんでした: ' + (Rc.error && Rc.error.msg || '')};
  if (mode === 'keep') {
    const want = new Map();
    D.performers.forEach((p, i) => { const nid = res.idMap[p.id]; if (nid) want.set(nid, {old: i, pos: D.sets.map(s => s.pos[i])}); });
    const od = await orderBySlots(cur, want, R0, D, opts, Rc, res.idMap);
    if (!od.ok) return od;
    Rc = od.Rc; res.ordered = od.ordered;
    stripTmp(cur);
    const st = await stabilize(cur, want, R0, D, opts, Rc);
    if (!st.ok) return st;
    Rc = st.Rc; res.pinned = st.pinned; res.exact = st.exact; res.maxDiff = st.maxDiff;
  }
  stripTmp(cur);
  res.model = cur; res.compiled = Rc;
  return res;
}

// ================= 追加 =================
function fieldBounds(f) {
  const T = f && f.type, w = +(f && f.w), d = +(f && f.d);
  if (T === 'football') { const b = +f.bsl || 84; return {x0: -78, x1: 78, y0: 0.5, y1: b - 0.5}; }
  if (T === 'stage') { const W = w || 16, Dd = d || 10; return {x0: -W / 2 + 0.4, x1: W / 2 - 0.4, y0: 0.6, y1: Dd - 0.4}; }
  if (T === 'floor') { const W = w || 24, Dd = d || 18; return {x0: -W / 2 + 0.4, x1: W / 2 - 0.4, y0: 0.4, y1: Dd - 0.4}; }
  const W = w || 30, Dd = d || 30;
  return {x0: -W / 2 + 0.4, x1: W / 2 - 0.4, y0: -Dd / 2 + 0.4, y1: Dd / 2 - 0.4};
}
function rewriteGroupForAdd(group, grown, sections) {
  const rng = (sid, n) => n <= 1 ? sid + '1' : `${sid}1..${sid}${n}`, out = [];
  for (const t of groupTokens(group)) {
    if (t === 'all') { for (const s of sections) out.push(grown.has(s.id) ? rng(s.id, grown.get(s.id)) : s.id); }
    else if (grown.has(t)) out.push(rng(t, grown.get(t)));
    else out.push(t);
  }
  return out.join(' + ');
}
// 空いている近くの場所を探す。anchor（隣に置きたい人の位置）から、右・左・手前・奥…の順に、ぶつからない所を返す
function findSpot(anchor, obstacles, o) {
  const dirs = [0, 180, 270, 90, 315, 225, 45, 135, 337.5, 202.5, 292.5, 112.5, 22.5, 157.5, 247.5, 67.5];
  const ok = c => c[0] >= o.b.x0 && c[0] <= o.b.x1 && c[1] >= o.b.y0 && c[1] <= o.b.y1 && obstacles.every(q => dist(q, c) >= o.minD);
  let best = null, bestD = -1;
  for (const mul of [1, 1.5, 2, 2.5, 3, 4, 5, 6.5, 8]) {
    for (const a of dirs) {
      const c = [r2(anchor[0] + Math.cos(a * Math.PI / 180) * o.sp * mul), r2(anchor[1] + Math.sin(a * Math.PI / 180) * o.sp * mul)];
      if (ok(c)) return c;
      // 場内で、いちばん空いている所を覚えておく（見つからなかったときの代わり）
      if (c[0] >= o.b.x0 && c[0] <= o.b.x1 && c[1] >= o.b.y0 && c[1] <= o.b.y1) { const md = Math.min(...obstacles.map(q => dist(q, c)), 99); if (md > bestD) { bestD = md; best = c; } }
    }
  }
  return best || [r2(Math.min(o.b.x1, Math.max(o.b.x0, anchor[0] + o.sp))), r2(anchor[1])];
}
// 人を足す。srcIds: 隣に置きたい人（足す人数ぶん。同じ人を何度でも）
// 既存の隊形の対象は番号の範囲（tp1..tp8）に書き直して、新しい人を巻き込まない。
// それでも自動割り当てが変わって動いてしまう人は、元の位置に個別の位置で固定する → ほかの人は動かない
async function addMembers(M, srcIds, opts) {
  const R0 = await opts.compile(opts.print(M));
  if (!R0 || !R0.ok) return {ok: false, error: '今のショーを読み込めないため、追加できません'};
  const D = R0.data, orig = R0.model || M, {perf, count} = perfInfo(D);
  if (!srcIds.length) return {ok: false, error: '追加する場所（人）が選ばれていません'};
  const grown = new Map(), plan = [];
  for (const sid of srcIds) {
    const p = perf.get(sid);
    if (!p) return {ok: false, error: `「${sid}」というメンバーはいません`};
    if (!grown.has(p.sid)) grown.set(p.sid, count.get(p.sid));
    const sec = orig.sections.find(s => s.id === p.sid);
    if (!sec || !Number.isFinite(nOf(sec.n))) return {ok: false, error: `セクション ${p.sid} の人数が数字ではありません`};
    const k = plan.filter(x => x.sid === p.sid).length + 1;
    plan.push({srcIdx: p.idx, sid: p.sid, newId: p.sid + (count.get(p.sid) + k)});
  }
  const unitFB = D.field && D.field.type === 'football';
  const clr = +D.clearance || (unitFB ? 1 : 0.6);
  const o = {b: fieldBounds(D.field), sp: unitFB ? 2 : 1.2, minD: Math.max(clr * 1.35, unitFB ? 1.6 : 0.85)};
  const K = D.sets.length, banned = new Map(); // 移動中にぶつかった場所は、あとで避ける
  const want = new Map(D.performers.map((p, i) => [p.id, {old: i, pos: D.sets.map(s => s.pos[i])}]));
  const baseWarn = new Set(D.warnings.map(w => w.msg));
  let out = null, strat = 'follow';
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt === 4) { // 隣についていく置き方でぶつかるなら、その場にとどまる置き方も試す
      const first = out; banned.clear(); strat = 'stay'; out = null;
      const again = await tryOnce(); out = again && again.warnings.length < first.warnings.length ? again : first; break;
    }
    out = await tryOnce(); if (!out.ok || !out.warnings.length) break;
  }
  // それでも移動中に近づく所が残るなら、時間差・早着き・カーブ（自動で直す）で解く。止まる位置は変わらない
  if (out && out.ok && out.warnings.length && opts.fix) {
    try {
      const fx = await opts.fix(opts.print(out.model));
      if (fx && fx.ok && fx.model && fx.notes && fx.notes.length) {
        const R2 = await opts.compile(opts.print(fx.model));
        if (R2.ok) {
          const idx = new Map(R2.data.performers.map((p, i) => [p.id, i]));
          let worst = 0;
          D.performers.forEach((p, i) => { for (let k = 0; k < K; k++) worst = Math.max(worst, dist(R2.data.sets[k].pos[idx.get(p.id)], D.sets[k].pos[i])); });
          const left = R2.data.warnings.filter(w => !baseWarn.has(w.msg));
          if (worst <= 1e-4 && left.length < out.warnings.length) { out.model = fx.model; out.compiled = R2; out.warnings = left.map(w => w.msg); out.fixed = true; out.exact = true; }
        }
      }
    } catch (e) { /* 直せなければそのまま */ }
  }
  return out;
  async function tryOnce() {
    const m = clone(orig);
    for (const set of m.sets) for (const st of set.stmts) if (st.shape.kind !== 'attr') st.group = rewriteGroupForAdd(st.group, grown, m.sections);
    for (const [sid, oldN] of grown) { const sec = m.sections.find(s => s.id === sid), add = plan.filter(x => x.sid === sid).length; sec.n = typeof sec.n === 'number' ? oldN + add : String(oldN + add); }
    const items = plan.map(x => Object.assign({off: null, last: null, lastFace: null, spots: []}, x));
    for (let k = 0; k < K; k++) {
      const obst = D.sets[k].pos.map(p => p.slice());
      items.forEach((it, ii) => {
        const a = D.sets[k].pos[it.srcIdx], bad = banned.get(ii + ':' + k) || [];
        const free = c => c[0] >= o.b.x0 && c[0] <= o.b.x1 && c[1] >= o.b.y0 && c[1] <= o.b.y1 && obst.every(q => dist(q, c) >= o.minD) && bad.every(q => dist(q, c) > 0.05);
        let spot = null;
        if (strat === 'stay' && it.last && free(it.last)) spot = it.last;
        else if (strat === 'follow' && it.off) { const c = [r2(a[0] + it.off[0]), r2(a[1] + it.off[1])]; if (free(c)) spot = c; }
        if (!spot) spot = findSpot(a, obst.concat(bad.map(q => q)), {b: o.b, sp: o.sp, minD: o.minD});
        it.off = [spot[0] - a[0], spot[1] - a[1]];
        obst.push(spot); it.spots[k] = spot;
        const fd = D.sets[k].face && D.sets[k].face[it.srcIdx], fs = fd == null ? null : faceStr(fd + 90);
        if (k === 0 || !it.last || dist(it.last, spot) > 1e-6 || (fs != null && fs !== it.lastFace)) {
          const st = mkStmt(it.newId, {kind: 'at', p: [num6(spot[0]), num6(spot[1])]});
          if (fs != null) st.face = fs;
          pushPositional(m.sets[k], st);
        }
        it.last = spot; if (fs != null) it.lastFace = fs;
      });
    }
    let Rc = await opts.compile(opts.print(m));
    if (!Rc.ok) return {ok: false, error: '追加後のショーを組み立てられませんでした: ' + (Rc.error && Rc.error.msg || '')};
    const st = await stabilize(m, want, R0, D, opts, Rc);
    if (!st.ok) return st;
    Rc = st.Rc;
    const idx = new Map(Rc.data.performers.map((p, i) => [p.id, i]));
    const newIdx = new Map(items.map((it, ii) => [idx.get(it.newId), ii]));
    const bad = Rc.data.warnings.filter(w => !baseWarn.has(w.msg) && (w.who || []).some(i => newIdx.has(i)));
    const out = {ok: true, model: m, compiled: Rc, newIds: items.map(x => x.newId), exact: st.exact, maxDiff: st.maxDiff, pinned: st.pinned, added: items.length, warnings: bad.map(w => w.msg)};
    for (const w of bad) for (const i of w.who || []) if (newIdx.has(i)) {
      const ii = newIdx.get(i), key = ii + ':' + w.set;
      banned.set(key, (banned.get(key) || []).concat([items[ii].spots[w.set]]));
    }
    return out;
  }
}

// ================= 貼り付け =================
function pastePositions(model, k, pairs) {
  const m = clone(model);
  for (const {id, p} of pairs) setPin(m, k, id, p);
  return m;
}
// 貼り付ける先を決める: クリップボードの人（clip: [{id, p}]）と、選んでいる人（selIds）から [{id, p}] を作る
function pasteTargets(clip, selIds, existing) {
  const have = new Set(existing);
  const same = clip.filter(c => have.has(c.id));
  const sel = selIds.filter(id => have.has(id));
  const clipIds = new Set(clip.map(c => c.id));
  const selSame = sel.length === clip.length && sel.every(id => clipIds.has(id));
  if (!sel.length || selSame) return {pairs: same.map(c => ({id: c.id, p: c.p})), mode: 'same', skipped: clip.length - same.length};
  const n = Math.min(sel.length, clip.length);
  return {pairs: sel.slice(0, n).map((id, i) => ({id, p: clip[i].p})), mode: 'order', skipped: Math.max(0, clip.length - sel.length), extra: Math.max(0, sel.length - clip.length)};
}

// ================= セットの分割・カット・コピー・移動 =================
// 動きの式は Rust の geom::arc_point / poly_at と同じ（src/motion.js と同じ）
const jkArcPt = (a, b, bend, u) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  if (Math.abs(bend) < 1e-6 || l < 1e-9) return [a[0] + dx * u, a[1] + dy * u];
  const th = Math.min(Math.abs(bend), 179) * Math.PI / 180, s = -Math.sign(bend);
  const rot = (v, g) => [v[0] * Math.cos(g) - v[1] * Math.sin(g), v[0] * Math.sin(g) + v[1] * Math.cos(g)];
  const t0 = rot([dx / l, dy / l], -s * th / 2), n0 = rot(t0, s * Math.PI / 2);
  const r = l / (2 * Math.sin(th / 2)), ph = th * u;
  return [a[0] + r * (Math.sin(ph) * t0[0] + (1 - Math.cos(ph)) * n0[0]), a[1] + r * (Math.sin(ph) * t0[1] + (1 - Math.cos(ph)) * n0[1])];
};
const jkPolyPt = (r, u) => {
  let total = 0; for (let j = 1; j < r.length; j++) total += Math.hypot(r[j][0] - r[j - 1][0], r[j][1] - r[j - 1][1]);
  if (r.length < 2 || total < 1e-12) return r[r.length - 1];
  let left = total * Math.min(1, Math.max(0, u));
  for (let j = 1; j < r.length; j++) {
    const d = Math.hypot(r[j][0] - r[j - 1][0], r[j][1] - r[j - 1][1]);
    if (left <= d) { const t = d > 0 ? left / d : 0; return [r[j - 1][0] + (r[j][0] - r[j - 1][0]) * t, r[j - 1][1] + (r[j][1] - r[j - 1][1]) * t]; }
    left -= d;
  }
  return r[r.length - 1];
};
// セット k の中の c カウント目での、i 番目の人の位置
function memberAtLocal(D, k, i, c) {
  const s = D.sets[k];
  if (k === 0 || !s.counts) return s.pos[i].slice();
  const a = D.sets[k - 1].pos[i], b = s.pos[i], w = s.wait[i], e = s.end[i], bend = s.bend ? s.bend[i] : 0;
  const u = e - w <= 0 ? 1 : Math.min(1, Math.max(0, (c - w) / (e - w)));
  const rt = s.route ? s.route[i] : null;
  return rt ? jkPolyPt(rt, u) : jkArcPt(a, b, bend, u);
}
// 通算カウント t での位置（Node のテストでも使う）
function positionAt(D, i, t) {
  let k = 0; for (let j = 0; j < D.sets.length; j++) if (D.sets[j].start <= t + 1e-9) k = j;
  return memberAtLocal(D, k, i, t - D.sets[k].start);
}

// ---- 点の並びが、直線・円・円弧・ブロックのどれかになっているか ----
const FIT_TOL = 2e-4;
function fitLine(pts) {
  const n = pts.length; if (n < 2) return null;
  let A = 0, B = 1, best = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = dist(pts[i], pts[j]); if (d > best) { best = d; A = i; B = j; } }
  if (best < 1e-6) return null;
  const a = pts[A], d = [(pts[B][0] - a[0]) / best, (pts[B][1] - a[1]) / best];
  const t = pts.map(p => (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]);
  for (let i = 0; i < n; i++) if (Math.abs((pts[i][0] - a[0]) * d[1] - (pts[i][1] - a[1]) * d[0]) > FIT_TOL) return null;
  const ord = pts.map((_, i) => i).sort((x, y) => t[x] - t[y]), t0 = t[ord[0]], L = t[ord[n - 1]] - t0;
  for (let j = 0; j < n; j++) if (Math.abs(t[ord[j]] - t0 - L * j / (n - 1)) > FIT_TOL) return null;
  const p0 = pts[ord[0]], p1 = pts[ord[n - 1]];
  return {order: ord, shape: {kind: 'line', a: [num6(p0[0]), num6(p0[1])], b: [num6(p1[0]), num6(p1[1])]}};
}
function fitCircleLike(pts, full) {
  const n = pts.length; if (n < 3) return null;
  let c;
  if (full) c = [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  else { // 3 点を通る円の中心
    let A = 0, B = 1, best = -1;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = dist(pts[i], pts[j]); if (d > best) { best = d; A = i; B = j; } }
    let M = -1, md = 1e18; const mid = [(pts[A][0] + pts[B][0]) / 2, (pts[A][1] + pts[B][1]) / 2];
    for (let i = 0; i < n; i++) if (i !== A && i !== B) { const d = dist(pts[i], mid); if (M < 0 || d < md) { M = i; md = d; } }
    if (M < 0) return null;
    const [ax, ay] = pts[A], [bx, by] = pts[B], [cx, cy] = pts[M];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-9) return null;
    c = [((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D, ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D];
  }
  const rs = pts.map(p => dist(p, c)), r = rs.reduce((s, v) => s + v, 0) / n;
  if (!(r > 1e-6) || r > 5000 || rs.some(v => Math.abs(v - r) > FIT_TOL)) return null;
  const ang = pts.map(p => Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI);
  const ord = pts.map((_, i) => i).sort((x, y) => ang[x] - ang[y]);
  const sorted = ord.map(i => ang[i]), tolD = (FIT_TOL / r) * 180 / Math.PI * 3 + 1e-6;
  const gaps = sorted.map((v, i) => i + 1 < n ? sorted[i + 1] - v : sorted[0] + 360 - v);
  if (full) {
    for (const g of gaps) if (Math.abs(g - 360 / n) > tolD) return null;
    return {order: ord, shape: {kind: 'circle', c: [num6(c[0]), num6(c[1])], r: num6(r), start: num6(sorted[0])}};
  }
  // 円弧: いちばん大きいすき間のあとから始まる
  let gi = 0; for (let i = 1; i < n; i++) if (gaps[i] > gaps[gi]) gi = i;
  const start = (gi + 1) % n, seq = [], un = [];
  for (let j = 0; j < n; j++) { const q = (start + j) % n; seq.push(ord[q]); let v = sorted[q]; if (j && v < un[j - 1]) v += 360; un.push(v); }
  const d = (un[n - 1] - un[0]) / (n - 1);
  if (d < 1e-3 || un[n - 1] - un[0] > 359) return null;
  for (let j = 0; j < n; j++) if (Math.abs(un[j] - un[0] - d * j) > tolD) return null;
  return {order: seq, shape: {kind: 'arc', c: [num6(c[0]), num6(c[1])], r: num6(r), a1: num6(un[0]), a2: num6(un[n - 1])}};
}
function fitBlock(pts) {
  const n = pts.length; if (n < 4) return null;
  const idx = pts.map((_, i) => i).sort((a, b) => pts[a][1] - pts[b][1] || pts[a][0] - pts[b][0]);
  const rows = [];
  for (const i of idx) { const r = rows[rows.length - 1]; if (r && Math.abs(pts[i][1] - r.y) <= FIT_TOL) r.m.push(i); else rows.push({y: pts[i][1], m: [i]}); }
  if (rows.length < 2) return null;
  rows.forEach(r => r.m.sort((a, b) => pts[a][0] - pts[b][0]));
  const cols = rows[0].m.length; if (cols < 2) return null;
  for (let k = 0; k < rows.length - 1; k++) if (rows[k].m.length !== cols) return null;
  if (rows[rows.length - 1].m.length > cols) return null;
  const sp = (pts[rows[0].m[cols - 1]][0] - pts[rows[0].m[0]][0]) / (cols - 1);
  if (!(sp > 1e-6)) return null;
  const rsp = (rows[rows.length - 1].y - rows[0].y) / (rows.length - 1);
  if (!(rsp > 1e-6)) return null;
  const cx = (pts[rows[0].m[0]][0] + pts[rows[0].m[cols - 1]][0]) / 2, cy = (rows[0].y + rows[rows.length - 1].y) / 2;
  rows.forEach((r, k) => {
    if (Math.abs(r.y - (cy + (k - (rows.length - 1) / 2) * rsp)) > FIT_TOL) throw 0;
    r.m.forEach((i, j) => { if (Math.abs(pts[i][0] - (cx + (j - (r.m.length - 1) / 2) * sp)) > FIT_TOL) throw 0; });
  });
  return {order: rows.flatMap(r => r.m), shape: {kind: 'block', c: [num6(cx), num6(cy)], cols: String(cols), spacing: num6(sp), rows: num6(rsp)}};
}
function fitShape(pts) {
  if (pts.length < 2) return null;
  const tryFit = f => { try { return f(); } catch (e) { return null; } };
  return tryFit(() => fitLine(pts)) || tryFit(() => fitCircleLike(pts, true)) || tryFit(() => fitCircleLike(pts, false)) || tryFit(() => fitBlock(pts));
}
const ATTR_KEEP = ['step', 'action', 'carry'];
// 決まった位置（items: [{id, p}]）に人を置く文。形が見つかれば1文、なければ人ごとの at 文
function formationStmts(items, pinfo, o) {
  o = o || {};
  const mk = (group, shape) => {
    const st = mkStmt(group, shape);
    if (o.wait) st.wait = o.wait;
    if (o.bend) st.bend = o.bend;
    for (const f of (o.attrs || [])) if (o.from && o.from[f] != null && o.from[f] !== '') st[f] = o.from[f];
    if (o.from && o.from.face != null && o.from.face !== '' && !/^(center|out|toward|中心|外)/.test(String(o.from.face).trim())) st.face = o.from.face;
    return st;
  };
  const fit = o.noFit ? null : fitShape(items.map(x => x.p));
  if (fit) { const st = mk(groupByOrder(fit.order.map(i => items[i].id), pinfo), fit.shape); st.assign = 'keep'; return {stmts: [st], shaped: true}; }
  return {stmts: items.map(x => mk(x.id, {kind: 'at', p: [num6(x.p[0]), num6(x.p[1])]})), shaped: false};
}

const SPLITTABLE = new Set(['line', 'arc', 'circle', 'block', 'curve', 'poly', 'at']);
const freeSetName = (names, base) => { const have = new Set(names); for (const suf of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) if (!have.has(base + suf)) return base + suf; let i = 2; while (have.has(`${base}_${i}`)) i++; return `${base}_${i}`; };
const cleanStmt = st => Object.assign(st, {note: [], tail: null, line: 0});
// 組み立てた A・B が、元の動きと同じ終わりの位置になっているか。ずれた文は「席の順に人を並べて assign keep」にして直す
async function fixOrders(m, kA, kB, want, R0, k, opts) {
  const D = R0.data, K = D.sets.length;
  let Rc = await opts.compile(opts.print(m));
  if (!Rc.ok) return {ok: false, error: '組み立てられませんでした: ' + (Rc.error && Rc.error.msg || '')};
  const oldIdx = new Map(D.performers.map((p, i) => [p.id, i]));
  let worst = 0;
  for (let it = 0; it < 4; it++) {
    const idx = new Map(Rc.data.performers.map((p, i) => [p.id, i])), todo = new Set();
    worst = 0;
    for (const [kk, list] of [[kA, want.A], [kB, want.B]]) {
      if (!list) continue;
      for (const [id, p] of list) {
        const j = idx.get(id), d = dist(Rc.data.sets[kk].pos[j], p); worst = Math.max(worst, d);
        if (d <= 1e-4) continue;
        const si = Rc.owner && Rc.owner[kk] ? Rc.owner[kk][j] : -1, st = si >= 0 ? m.sets[kk].stmts[si] : null;
        if (st && st._os != null && !st._ord && SKIP_SHAPES.has(st.shape.kind)) todo.add(kk + ':' + si);
      }
    }
    if (!todo.size) break;
    const pinfo = perfInfo(Rc.data).perf;
    for (const key of todo) {
      const [kk, si] = key.split(':').map(Number), st = m.sets[kk].stmts[si];
      const mem0 = R0.members[k][st._os], slots0 = D.sets[k].slots[st._os], mem1 = Rc.members[kk][si];
      const rows = mem1.map(pj => { const gi = mem0.indexOf(oldIdx.get(Rc.data.performers[pj].id)); return {id: Rc.data.performers[pj].id, slot: gi >= 0 ? slots0[gi] : 1e9}; });
      st._ord = 1;
      if (rows.some(r => r.slot >= 1e9)) continue;
      rows.sort((a, b) => a.slot - b.slot);
      st.group = groupByOrder(rows.map(r => r.id), pinfo); st.assign = 'keep';
    }
    Rc = await opts.compile(opts.print(m));
    if (!Rc.ok) return {ok: false, error: '組み立てられませんでした: ' + (Rc.error && Rc.error.msg || '')};
  }
  for (const s of m.sets) for (const st of s.stmts) { delete st._os; delete st._ord; }
  return {ok: true, Rc, maxDiff: worst};
}
// セットを c カウントの所で割る／切る。mode: 'split'（2つに分ける）| 'cut'（c で終わりにして、あとの動きを捨てる）| 'cutafter'（c より後ろをすべて削除）
// 動きは変えない（途中の位置は、元の動きの式で求める）。途中の隊形は、直線・円・円弧・ブロックならその形で書く
async function splitSet(model, k, c, opts) {
  const mode = opts.mode || 'split';
  const R0 = await opts.compile(opts.print(model));
  if (!R0 || !R0.ok) return {ok: false, error: '今のショーを読み込めないため、操作できません'};
  const D = R0.data, base = R0.model || model, S = D.sets[k];
  if (!S) return {ok: false, error: 'セットがありません'};
  const C = S.counts, H = S.hold, m = clone(base), orig = m.sets[k];
  const cut = mode !== 'split';
  const finish = async (m2, extra) => {
    const Rf = await opts.compile(opts.print(m2));
    if (!Rf.ok) return {ok: false, error: '組み立てられませんでした: ' + (Rf.error && Rf.error.msg || '')};
    return Object.assign({ok: true, model: m2, compiled: Rf, mode, set: k}, extra || {});
  };
  // ホールドの中で切る／割る
  if (k === 0 || c >= C - 1e-9) {
    const ch = k === 0 ? c : c - C;
    if (!(ch > 1e-9) || ch >= H - 1e-9 && mode === 'split') return {ok: false, error: k === 0 ? '最初のセットは、ホールドの途中でだけ切れます' : 'この位置では、分けられません（動きの途中か、ホールドの途中で選んでください）'};
    if (cut) {
      orig.hold = qsFmt(Math.min(H, ch));
      if (mode === 'cutafter') m.sets.length = k + 1;
      return finish(m, {trimmed: true});
    }
    const B = {name: freeSetName(m.sets.map(s => s.name), orig.name), counts: '0', hold: qsFmt(H - ch), note: [], tail: null, foot: [], mark: !!orig.mark, tempo: null, stmts: [Object.assign(mkStmt('all', {kind: 'same'}))]};
    orig.hold = qsFmt(ch);
    m.sets.splice(k + 1, 0, B);
    return finish(m, {kB: k + 1, holdSplit: true});
  }
  if (!(c > 1e-9)) return {ok: false, error: 'セットの先頭では分けられません'};
  const pinfo = perfInfo(D).perf, n = D.performers.length;
  const own = R0.owner[k], stmts = orig.stmts;
  const A = [], B = [];
  const wantA = [], wantB = [];
  let approx = 0, moved = 0;
  const ownersOf = si => { const r = []; for (let i = 0; i < n; i++) if (own[i] === si) r.push(i); return r; };
  const num = v => num6(v);
  stmts.forEach((st, si) => {
    const tag = x => { x._os = si; return x; };
    if (st.shape.kind === 'attr') {
      const a = cleanStmt(clone(st)); for (const f of ['pose']) a[f] = null;
      if (a.face != null || a.step || a.action || a.carry) A.push(a);
      B.push(cleanStmt(clone(st)));
      return;
    }
    const ow = ownersOf(si);
    if (!ow.length) return;
    const i0 = ow[0], w = S.wait[i0], e = S.end[i0];
    const mv = ow.some(i => dist(D.sets[k - 1].pos[i], S.pos[i]) > 1e-6);
    ow.forEach(i => { wantB.push([D.performers[i].id, S.pos[i]]); });
    const sameStmt = (g, from) => { const x = mkStmt(g, {kind: 'same'}); for (const f of ['face', 'step', 'action', 'pose', 'carry']) x[f] = from[f]; return x; };
    if (!mv) { // 動かない文: A は元のまま（タイミングは外す）、B は「その場」
      const a = tag(cleanStmt(clone(st))); a.wait = null; a.within = null; a.bend = null; A.push(a);
      B.push(sameStmt(st.group, st));
      ow.forEach(i => wantA.push([D.performers[i].id, S.pos[i]]));
      return;
    }
    moved += ow.length;
    if (e <= c + 1e-9) { // c より前に終わる動き: A に全部。B はその場
      A.push(tag(cleanStmt(clone(st))));
      B.push(sameStmt(st.group, st));
      ow.forEach(i => wantA.push([D.performers[i].id, S.pos[i]]));
      return;
    }
    const clonable = SPLITTABLE.has(st.shape.kind) && st.shape.kind !== 'follow';
    const hasRoute = st.shape.kind === 'follow' || ow.some(i => S.route && S.route[i]);
    const bendV = S.bend ? S.bend[i0] : 0;
    if (w >= c - 1e-9) { // まだ動き出していない: A ではその場（前の文が動かしていても止める）。B は元の文（待ちだけ詰める）
      A.push(mkStmt(groupByOrder(ow.map(i => D.performers[i].id), pinfo), {kind: 'same'}));
      ow.forEach(i => wantA.push([D.performers[i].id, D.sets[k - 1].pos[i]]));
      const b = tag(cleanStmt(clone(st)));
      b.wait = w - c > 1e-9 ? num(w - c) : null;
      if (b.within != null && b.within !== '') b.within = num(e - w);
      if (!clonable) { const f = formationStmts(ow.map(i => ({id: D.performers[i].id, p: S.pos[i]})), pinfo, {wait: b.wait, from: st, attrs: ATTR_KEEP.concat(['pose'])}); f.stmts.forEach(x => { x.within = b.within; B.push(x); }); approx += st.shape.kind === 'follow' ? ow.length : 0; }
      else B.push(b);
      return;
    }
    // 動きの途中
    const u = Math.min(1, Math.max(0, (c - w) / (e - w)));
    const mids = ow.map(i => ({id: D.performers[i].id, p: memberAtLocal(D, k, i, c)}));
    mids.forEach(x => wantA.push([x.id, x.p]));
    const fa = formationStmts(mids, pinfo, {wait: w > 1e-9 ? num(w) : null, bend: hasRoute || Math.abs(bendV) < 1e-6 ? null : num(bendV * u), from: st, attrs: ATTR_KEEP});
    fa.stmts.forEach(x => A.push(x));
    if (hasRoute) approx += ow.length;
    // 後半
    const bendB = Math.abs(bendV) < 1e-6 || hasRoute ? null : num(bendV * (1 - u));
    if (clonable && !hasRoute) {
      const b = tag(cleanStmt(clone(st)));
      b.wait = null; b.within = e < C - 1e-9 ? num(e - c) : null; b.bend = bendB;
      B.push(b);
    } else {
      const f = formationStmts(ow.map(i => ({id: D.performers[i].id, p: S.pos[i]})), pinfo, {from: st, attrs: ATTR_KEEP.concat(['pose'])});
      f.stmts.forEach(x => { x.within = e < C - 1e-9 ? num(e - c) : null; x.bend = null; B.push(x); });
    }
  });
  // 組み立て
  const setA = Object.assign(clone(orig), {counts: qsFmt(c), stmts: A, hold: cut ? (mode === 'cutafter' ? '0' : qsFmt(H)) : '0'});
  const m2 = clone(base);
  m2.sets[k] = setA;
  let kB = -1;
  if (mode === 'split') {
    const Bset = {name: freeSetName(m2.sets.map(s => s.name), orig.name), counts: qsFmt(C - c), hold: qsFmt(H), note: [], tail: null, foot: [], mark: !!orig.mark, tempo: null, stmts: B};
    m2.sets.splice(k + 1, 0, Bset); kB = k + 1;
  } else if (mode === 'cutafter') m2.sets.length = k + 1;
  const want = {A: wantA.map(([id, p]) => [id, p]), B: mode === 'split' ? wantB : null};
  const fx = await fixOrders(m2, k, kB, want, R0, k, opts);
  if (!fx.ok) return fx;
  for (const s of m2.sets) for (const st of s.stmts) { delete st._os; delete st._ord; }
  return {ok: true, model: m2, compiled: fx.Rc, mode, set: k, kB, c, approx, exact: fx.maxDiff <= 1e-4, maxDiff: fx.maxDiff, moved};
}

// ---- セットのコピー・貼り付け・移動・削除 ----
// コピーした内容（別のショーにも貼れる形）。copy.sections は、貼り付け先で使えるかの確認に使う
function setsPayload(model, idxs) {
  const list = [...new Set(idxs)].filter(i => model.sets[i]).sort((a, b) => a - b);
  return {format: 'jinkei-sets', v: 1, show: model.name || '', sections: (model.sections || []).map(s => ({id: s.id, n: s.n})),
    sets: list.map(i => { const s = clone(model.sets[i]); if (i === 0) s.counts = '8'; s.stmts.forEach(cleanStmt); s.note = []; s.tail = null; s.foot = []; return s; })};
}
function validPayload(p) { return !!(p && p.format === 'jinkei-sets' && Array.isArray(p.sets) && p.sets.length && p.sets.every(s => s && Array.isArray(s.stmts) && typeof s.name === 'string')); }
// 貼り付け先のメンバーで読めない対象を取り除く
function groupFor(group, secs) {
  const toks = groupTokens(group), out = [];
  for (const t of toks) {
    if (t === 'all') { out.push(t); continue; }
    const ends = t.split('..');
    if (ends.length > 2) continue;
    const ok = ends.every(x => { const mm = /^(.*?)(\d+)$/.exec(x); if (!mm) return secs.has(x) && ends.length === 1; const n = secs.get(mm[1]); return n != null && (!Number.isFinite(n) || +mm[2] <= n && +mm[2] >= 1); });
    if (ok) out.push(t);
  }
  return out.length ? out.join(' + ') : null;
}
const negX = s => { const t = String(s).trim(); if (/^-?\d+(\.\d+)?$/.test(t)) return num6(-parseFloat(t)); return t.startsWith('-(') ? t.slice(2, -1) : `-(${t})`; };
const flipAng = s => { const t = String(s).trim(); if (/^-?\d+(\.\d+)?$/.test(t)) return num6(180 - parseFloat(t)); return `180 - (${t})`; };
const negA = s => { const t = String(s).trim(); if (/^-?\d+(\.\d+)?$/.test(t)) return num6(-parseFloat(t)); return t.startsWith('-(') ? t.slice(2, -1) : `-(${t})`; };
const ptX = p => [negX(p[0]), p[1]];
// 左右反転（原点が中央の会場。x を逆にする）
function mirrorStmt(st) {
  const s = st.shape;
  switch (s.kind) {
    case 'line': s.a = ptX(s.a); s.b = ptX(s.b); break;
    case 'arc': s.c = ptX(s.c); s.a1 = flipAng(s.a1); s.a2 = flipAng(s.a2); break;
    case 'circle': s.c = ptX(s.c); if (s.start != null && s.start !== '') s.start = flipAng(s.start); else s.start = '270'.replace('270', num6(180 - 270)); break;
    case 'block': s.c = ptX(s.c); break;
    case 'curve': case 'poly': case 'follow': s.pts = s.pts.map(ptX); break;
    case 'at': s.p = ptX(s.p); break;
    default: break;
  }
  for (const x of st.xf) {
    if (x.kind === 'rotate') { x.a = negA(x.a); if (x.about) x.about = ptX(x.about); }
    else if (x.kind === 'shift') x.d = ptX(x.d);
  }
  if (st.bend != null && st.bend !== '' && +st.bend !== 0) st.bend = negA(st.bend);
  if (st.face != null && st.face !== '') {
    const f = String(st.face).trim();
    if (f === 'kami') st.face = 'shimo'; else if (f === 'shimo') st.face = 'kami';
    else if (/^-?\d+(\.\d+)?$/.test(f)) st.face = num6(-parseFloat(f));
    else { const mm = /^toward\s*\((.*),(.*)\)$/.exec(f); if (mm) st.face = `toward (${negX(mm[1])}, ${mm[2].trim()})`; }
  }
  return st;
}
function mirrorSet(set) { set.stmts.forEach(mirrorStmt); return set; }
// 貼り付けるセットに、貼り付け先で使える名前をつける
function pasteNames(existing, names) {
  const have = new Set(existing), out = [];
  for (const nm of names) { let t = nm, i = 2; while (have.has(t)) t = `${nm}_${i++}`; have.add(t); out.push(t); }
  return out;
}
// 貼り付け: after のセットの後ろに入れる。o.mirror = 左右反転。使えない対象の文は外す（skipped に数）
function pasteSets(model, after, payload, o) {
  o = o || {};
  if (!validPayload(payload)) return {ok: false, error: '貼り付けられるセットがありません'};
  const m = clone(model), secs = new Map(m.sections.map(s => [s.id, nOf(s.n)]));
  const sets = clone(payload.sets);
  let skipped = 0, emptied = 0;
  const names = pasteNames(m.sets.map(s => s.name), sets.map(s => s.name));
  sets.forEach((s, i) => {
    s.name = names[i];
    s.stmts = s.stmts.filter(st => { if (st.shape.kind === 'attr' || st.shape.kind === 'same' || true) { const g = groupFor(st.group, secs); if (g == null) { skipped++; return false; } st.group = g; } return true; });
    if (!s.stmts.length) emptied++;
    s.stmts.forEach(cleanStmt);
    s.note = []; s.tail = null; s.foot = [];
    if (o.mirror) mirrorSet(s);
    if (!(parseFloat(s.counts) > 0)) s.counts = '8';
  });
  const at = Math.max(1, Math.min(m.sets.length, after + 1));
  m.sets.splice(at, 0, ...sets);
  return {ok: true, model: m, at, count: sets.length, names, skipped, emptied};
}
function deleteSets(model, idxs) {
  const m = clone(model), rm = new Set(idxs.filter(i => i > 0 && i < m.sets.length));
  if (rm.size >= m.sets.length) return {ok: false, error: '全部は削除できません'};
  m.sets = m.sets.filter((_, i) => !rm.has(i));
  return {ok: true, model: m, removed: rm.size};
}
// セットを動かす。idxs を並べたまま、to（動かさないセットだけで数えた位置。その手前）に入れる。最初のセットは動かせない
function moveSets(model, idxs, to) {
  const m = clone(model), mv = [...new Set(idxs)].filter(i => i > 0 && i < m.sets.length).sort((a, b) => a - b);
  if (!mv.length) return {ok: false, error: '最初のセットは動かせません'};
  const set = new Set(mv), moving = mv.map(i => m.sets[i]), rest = m.sets.filter((_, i) => !set.has(i));
  const at = Math.max(1, Math.min(rest.length, to));
  rest.splice(at, 0, ...moving);
  m.sets = rest;
  return {ok: true, model: m, at, count: mv.length};
}
// セット全体を、左右反転する
function mirrorSets(model, idxs) {
  const m = clone(model);
  for (const i of idxs) if (m.sets[i]) mirrorSet(m.sets[i]);
  return m;
}

// ---- 人の位置の貼り付け（形にして貼る・複数のセットへ・反転） ----
// clip: [{id, p}]。o: {mode: 'same'|'order'|'auto', flipX, flipY, place: [x, y]（形として置く中心）, field}
function pastePlan(clip, selIds, existing, o) {
  o = o || {};
  const t = o.mode === 'same' ? (() => { const have = new Set(existing); const same = clip.filter(c => have.has(c.id)); return {pairs: same.map(c => ({id: c.id, p: c.p})), mode: 'same', skipped: clip.length - same.length}; })()
    : o.mode === 'order' ? (() => { const have = new Set(existing), sel = selIds.filter(id => have.has(id)), n = Math.min(sel.length, clip.length); return {pairs: sel.slice(0, n).map((id, i) => ({id, p: clip[i].p})), mode: 'order', skipped: Math.max(0, clip.length - sel.length), extra: Math.max(0, sel.length - clip.length)}; })()
    : pasteTargets(clip, selIds, existing);
  const b = fieldBounds(o.field), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let pairs = t.pairs.map(x => ({id: x.id, p: [o.flipX ? 2 * cx - x.p[0] : x.p[0], o.flipY ? 2 * cy - x.p[1] : x.p[1]]}));
  if (o.place && pairs.length) {
    const mx = pairs.reduce((s, x) => s + x.p[0], 0) / pairs.length, my = pairs.reduce((s, x) => s + x.p[1], 0) / pairs.length;
    pairs = pairs.map(x => ({id: x.id, p: [x.p[0] - mx + o.place[0], x.p[1] - my + o.place[1]]}));
  }
  pairs = pairs.map(x => ({id: x.id, p: [Math.round(x.p[0] * 1e4) / 1e4, Math.round(x.p[1] * 1e4) / 1e4]}));
  return Object.assign({}, t, {pairs});
}
// 貼り付けをモデルに反映する。すでに同じ位置の人は触らない。形になっていれば1文（assign keep）、そうでなければ個別の位置
// R = 今のコンパイル結果（位置と、誰がどの文で決まっているかを見る）
function applyPaste(model, ks, pairs, R) {
  const m = clone(model), D = R.data, idx = new Map(D.performers.map((p, i) => [p.id, i])), pinfo = perfInfo(D).perf;
  let stmtsAdded = 0, pins = 0, touched = 0, shapes = 0;
  for (const k of ks) {
    const todo = pairs.filter(x => idx.has(x.id) && dist(D.sets[k].pos[idx.get(x.id)], x.p) > 1e-4);
    if (!todo.length) continue;
    touched += todo.length;
    const set = m.sets[k], ids = new Set(todo.map(x => x.id));
    // 同じ人の古い個別の位置は外す（新しい指定が優先されるので、残すと散らかるだけ）
    set.stmts = set.stmts.filter(st => !(isIndividual(st) && ids.has(st.group.trim())));
    const owners = new Set(todo.map(x => R.owner && R.owner[k] ? R.owner[k][idx.get(x.id)] : -1));
    const src = owners.size === 1 && [...owners][0] >= 0 ? (R.model || model).sets[k].stmts[[...owners][0]] : null;
    const f = todo.length >= 3 ? formationStmts(todo, pinfo, {from: src && src.shape.kind !== 'attr' ? src : null, attrs: ATTR_KEEP.concat(['pose'])}) : {stmts: [], shaped: false};
    if (f.shaped) {
      const st = f.stmts[0];
      if (src && src.shape.kind !== 'attr') for (const fld of ['wait', 'within', 'bend']) if (src[fld] != null && src[fld] !== '') st[fld] = src[fld];
      pushPositional(set, st); stmtsAdded++; shapes++;
    } else for (const x of todo) { setPin(m, k, x.id, x.p); pins++; }
  }
  return {model: m, touched, shapes, pins, stmtsAdded};
}

// 複数のセットへ順番に貼る。前のセットに貼った結果（あとのセットが「その場」なら一緒に動く）を見て、要らない指定は足さない
async function applyPasteSeq(model, ks, pairs, opts) {
  let m = model, R = await opts.compile(opts.print(m)), touched = 0, shapes = 0, pins = 0;
  if (!R || !R.ok) return {ok: false, error: '今のショーを読み込めないため、貼り付けられません'};
  for (const k of [...ks].sort((a, b) => a - b)) {
    const r = applyPaste(m, [k], pairs, R);
    if (!r.touched) continue;
    touched += r.touched; shapes += r.shapes; pins += r.pins; m = r.model;
    R = await opts.compile(opts.print(m));
    if (!R.ok) return {ok: false, error: '貼り付け後のショーを組み立てられませんでした: ' + (R.error && R.error.msg || '')};
  }
  return {ok: true, model: m, compiled: R, touched, shapes, pins};
}

// ================= キー =================
const ORDER = ['Mod', 'Alt', 'Shift'];
// KeyboardEvent（または同じ形のもの）→ "Mod+Shift+N" 形式。記号キーは Shift を含めない（? や + など）
function evCombo(e) {
  const code = e.code || '', k = e.key == null ? '' : String(e.key);
  let name;
  if (/^Digit\d$/.test(code)) name = code.slice(5);
  else if (/^Numpad\d$/.test(code)) name = code.slice(6);
  else if (e.altKey && /^Key[A-Z]$/.test(code)) name = code.slice(3).toLowerCase();
  else if (k.length === 1) name = /[a-z]/i.test(k) ? k.toLowerCase() : k;
  else name = k;
  if (name === ' ') name = 'Space';
  if (name === '+') name = 'Plus';
  if (name === 'Esc') name = 'Escape';
  const symbol = k.length === 1 && !/[a-z0-9]/i.test(k) && !/^(Digit|Numpad)\d$/.test(code);
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Mod');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey && !symbol) mods.push('Shift');
  return mods.concat(name).join('+');
}
const isModifierKey = e => /^(Shift|Control|Alt|Meta|AltGraph|CapsLock|OS)$/.test(e.key);
function parseCombo(c) { const parts = String(c).split('+'); let key = parts.pop(); if (/^[A-Z]$/.test(key)) key = key.toLowerCase(); const mods = parts.filter(x => ORDER.includes(x)); return {mods: ORDER.filter(m => mods.includes(m)), key}; }
function normCombo(c) { const {mods, key} = parseCombo(c); return mods.concat(key).join('+'); }
const KEYNAME_MAC = {Mod: '⌘', Alt: '⌥', Shift: '⇧'}, KEYNAME_WIN = {Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift'};
const KEYS = {ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Plus: '+', Escape: 'Esc', Space: 'Space', Backspace: '⌫'};
// 表示用のキーの並び（キーキャップごと）
function comboCaps(c, mac) {
  const {mods, key} = parseCombo(c), N = mac ? KEYNAME_MAC : KEYNAME_WIN;
  const k = KEYS[key] || (key.length === 1 ? key.toUpperCase() : key);
  return mods.map(m => N[m]).concat(k === '⌫' && !mac ? 'Backspace' : k);
}
const comboLabel = (c, mac) => mac ? comboCaps(c, true).join('') : comboCaps(c, false).join('+');
// 同じキーを使っている別の操作
function conflictsOf(map, id, combo) {
  const c = normCombo(combo), out = [];
  for (const [aid, keys] of Object.entries(map)) if (aid !== id && keys.some(k => normCombo(k) === c)) out.push(aid);
  return out;
}
// 既定のキーに、保存してある変更を重ねる。壊れた値は無視する
function mergeKeymap(defs, saved) {
  const out = {};
  for (const [id, keys] of Object.entries(defs)) out[id] = keys.slice();
  if (saved && typeof saved === 'object') {
    for (const [id, keys] of Object.entries(saved)) if (out[id] && Array.isArray(keys) && keys.every(k => typeof k === 'string' && k)) out[id] = keys.map(normCombo);
  }
  return out;
}
// 変更点だけ（保存用）
function diffKeymap(defs, cur) {
  const o = {};
  for (const [id, keys] of Object.entries(cur)) { const a = (defs[id] || []).map(normCombo).join('|'), b = keys.map(normCombo).join('|'); if (a !== b) o[id] = keys.slice(); }
  return o;
}

// ================= あいまい検索（日本語・ひらがな・ローマ字） =================
const kata2hira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const normQ = s => kata2hira(String(s == null ? '' : s).normalize('NFKC').toLowerCase()).replace(/\s+/g, ' ').trim();
function subseq(w, f) { // w が f の中に、順番どおり・間があきすぎずに含まれるか
  let j = 0, first = -1, last = -1;
  for (let i = 0; i < f.length && j < w.length; i++) if (f[i] === w[j]) { if (first < 0) first = i; last = i; j++; }
  if (j < w.length || w.length < 2) return 0;
  return last - first + 1 <= w.length * 2 ? 22 : 0;
}
// ひらがな → ローマ字（検索用。ヘボン式でも訓令式でも打てるように、比べる前に canon() でそろえる）
const KANA = {あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'o',ん:'n',が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゔ:'vu'};
const YOON = {ゃ:'ya',ゅ:'yu',ょ:'yo'};
function toRomaji(str) {
  const s = kata2hira(String(str).normalize('NFKC').toLowerCase());
  let out = '', sok = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 'っ') { sok = true; continue; }
    if (c === 'ー') { out += out.slice(-1); continue; }
    let r = KANA[c];
    if (r == null) { out += c; sok = false; continue; }
    if (YOON[s[i + 1]]) { r = (r === 'chi' ? 'ch' : r === 'shi' ? 'sh' : r === 'ji' ? 'j' : r.slice(0, -1)) + (/^(ch|sh|j)$/.test(r === 'chi' ? 'ch' : r === 'shi' ? 'sh' : r === 'ji' ? 'j' : '') ? YOON[s[i + 1]].slice(1) : YOON[s[i + 1]]); i++; }
    if (sok) { out += r[0]; sok = false; }
    out += r;
  }
  return out;
}
const canon = s => String(s).replace(/shi/g, 'si').replace(/chi/g, 'ti').replace(/tsu/g, 'tu').replace(/fu/g, 'hu').replace(/sh([aeiou])/g, 'sy$1').replace(/ch([aeiou])/g, 'ty$1').replace(/j([aeiou])/g, 'zy$1').replace(/jy/g, 'zy').replace(/zyi/g, 'zi').replace(/syi/g, 'si').replace(/tyi/g, 'ti').replace(/nn/g, 'n').replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u');
const hasKana = s => /[\u3041-\u3096]/.test(s);
function wordScore(w, f) {
  if (!f) return 0;
  if (f === w) return 100;
  if (f.startsWith(w)) return 85;
  if ((' ' + f).includes(' ' + w)) return 75;
  if (f.includes(w)) return 58;
  return subseq(w, f);
}
function fuzzyScore(query, a) {
  const q = normQ(query);
  if (!q) return 1;
  const name = normQ(a.name), kw = normQ(a.kw || ''), grp = normQ(a.group || '');
  // ローマ字の欄: 読み（ひらがな）をローマ字にしたもの
  const rom = canon(toRomaji(name + ' ' + kw)), romWords = rom;
  const words = q.split(' ');
  let total = 0;
  for (const w of words) {
    let best = Math.max(wordScore(w, name), wordScore(w, kw) * 0.9, wordScore(w, grp) * 0.55);
    const rw = canon(toRomaji(w));
    if (/^[a-z0-9]+$/.test(rw)) best = Math.max(best, wordScore(rw, romWords) * 0.85);
    if (!best) return 0;
    total += best;
  }
  return total / words.length;
}


// ================= セットの長さ（カウント）をすばやく作る =================
// 「8 8 16 4 12」「8x4 16 6」「(8 4)x2」のような書き方を、カウントの並びに直す。
const QS_STEP = 0.5, QS_MAX_ONE = 999, QS_MAX_TOTAL = 6000, QS_MAX_REP = 256;
const qsRound = (v, step) => { step = step || QS_STEP; return Math.round(v / step) * step; };
const qsFmt = v => { const x = Math.round(v * 1000) / 1000; return Number.isInteger(x) ? String(x) : String(x); };
function parseCountSeq(text) {
  const errors = [], out = [];
  let s = String(text == null ? '' : text).normalize('NFKC').replace(/[×✕✖＊]/g, 'x').replace(/\*/g, 'x');
  s = s.replace(/\s*x\s*/gi, 'x');
  let i = 0;
  const err = (msg, at) => { errors.push({msg, at: at == null ? i : at}); };
  const isSep = c => /[\s,、，;；|:：]/.test(c);
  function seq(depth, close) {
    const items = [];
    while (i < s.length) {
      const c = s[i];
      if (isSep(c)) { i++; continue; }
      if (c === ')') { if (close) return items; err('「)」に対応する「(」がありません'); i++; continue; }
      let atom = null;
      const start = i;
      if (c === '(') {
        if (depth > 4) { err('かっこが深すぎます'); return items; }
        i++;
        const inner = seq(depth + 1, true);
        if (s[i] === ')') i++; else err('「(」を閉じる「)」がありません', start);
        atom = inner;
      } else {
        const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
        if (!m) { const bad = /^[^\s,、，;；|:：()\d]+/.exec(s.slice(i)); const w = bad ? bad[0] : s[i]; err(`「${w}」は使えません（数字・スペース・x・かっこで書きます）`); i += w.length; continue; }
        i += m[0].length;
        const v = parseFloat(m[0]);
        if (!(v >= QS_STEP)) { err(`${m[0]} は小さすぎます（0.5カウント以上）`, start); continue; }
        if (Math.abs(v / QS_STEP - Math.round(v / QS_STEP)) > 1e-9) { err(`${m[0]} は 0.5 カウント単位にしてください`, start); continue; }
        if (v > QS_MAX_ONE) { err(`${m[0]} は大きすぎます（${QS_MAX_ONE}まで）`, start); continue; }
        atom = [v];
      }
      let rep = 1;
      if (s[i] === 'x' || s[i] === 'X') {
        i++;
        const r = /^\d+/.exec(s.slice(i));
        if (!r) { err('「x」のあとに繰り返す回数を書いてください（例: 8x4）'); continue; }
        i += r[0].length; rep = parseInt(r[0], 10);
        if (rep < 1 || rep > QS_MAX_REP) { err(`繰り返しは 1〜${QS_MAX_REP} 回にしてください`, start); continue; }
      }
      for (let k = 0; k < rep; k++) for (const v of atom) { items.push(v); if (items.length > QS_MAX_TOTAL) { err('セットが多すぎます'); return items; } }
    }
    return items;
  }
  const counts = seq(0, false);
  for (const v of counts) out.push(v);
  const total = out.reduce((a, b) => a + b, 0);
  if (out.length > 400) errors.push({msg: '一度に作れるセットは400個までです', at: 0});
  else if (total > QS_MAX_TOTAL) errors.push({msg: `合計が長すぎます（${QS_MAX_TOTAL}カウントまで）`, at: 0});
  return {ok: !errors.length && out.length > 0, counts: out, errors, total};
}
// 拍子 "3/4" → 1小節のカウント数（カウントは4分音符）。6/8 → 3、7/8 → 3.5
function parseMeter(m) {
  const r = /^\s*(\d{1,2})\s*\/\s*(1|2|4|8|16)\s*$/.exec(String(m == null ? '4/4' : m).normalize('NFKC'));
  if (!r) return null;
  const num = +r[1], den = +r[2];
  if (num < 1) return null;
  return {num, den, perBar: num * 4 / den};
}
// 小節数のならび（"4 4 2x2"）→ カウントの並び
function parseBarSeq(text, meter) {
  const mt = parseMeter(meter);
  if (!mt) return {ok: false, counts: [], errors: [{msg: '拍子は 4/4・3/4・6/8 のように書いてください', at: 0}], total: 0, bars: []};
  const r = parseCountSeq(text);
  const errors = r.errors.slice(), bars = r.counts;
  for (const b of bars) if (Math.abs(b - Math.round(b)) > 1e-9) { errors.push({msg: `小節数 ${b} は整数にしてください`, at: 0}); break; }
  const counts = bars.map(b => b * mt.perBar);
  const bad = counts.find(c => Math.abs(c / QS_STEP - Math.round(c / QS_STEP)) > 1e-9);
  if (bad != null) errors.push({msg: `${meter} の小節数では 0.5 カウント単位になりません`, at: 0});
  const total = counts.reduce((a, b) => a + b, 0);
  return {ok: !errors.length && counts.length > 0, counts, errors, total, bars, perBar: mt.perBar};
}
// 「N小節ずつ、全部で M 小節」→ 小節数のならび（割り切れない端は最後の短いセット）
function everyBars(n, totalBars) {
  n = Math.max(1, Math.round(n)); totalBars = Math.max(0, Math.round(totalBars));
  const out = [];
  for (let b = 0; b < totalBars; b += n) out.push(Math.min(n, totalBars - b));
  return out;
}
// セット名を作る。existing: すでにある名前。style: 'num'（1,2,3…）・'alpha'（A,B,C…）・'list'（list を使う）
function alphaName(i) { let s = ''; i = Math.max(0, i); do { s = String.fromCharCode(65 + i % 26) + s; i = Math.floor(i / 26) - 1; } while (i >= 0); return s; }
function alphaIndex(name) { if (!/^[A-Z]+$/.test(name)) return -1; let n = 0; for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function makeNames(existing, n, style, list) {
  const used = new Set(existing.map(String)), out = [];
  const take = nm => { let x = String(nm), k = 2; while (used.has(x)) x = nm + '_' + (k++); used.add(x); out.push(x); };
  if (style === 'list' && list) { for (let i = 0; i < n; i++) take(list[i] != null ? list[i] : String(i + 1)); return out; }
  if (style === 'alpha') {
    let from = Math.max(-1, ...existing.map(alphaIndex)) + 1;
    for (let i = 0; i < n; i++) { while (used.has(alphaName(from))) from++; take(alphaName(from++)); }
    return out;
  }
  const nums = existing.map(x => parseInt(x, 10)).filter(x => !isNaN(x));
  let from = nums.length ? Math.max(...nums) + 1 : existing.length + 1;
  for (let i = 0; i < n; i++) { while (used.has(String(from))) from++; take(String(from++)); }
  return out;
}
// 新しいセット（モデルの形）を作る。afterIdx のセットの後ろに入れる想定。
//   copy: 'prev' = 直前のセットの隊形をそのまま写す（動かない）／ 'hold' = 空のセット（全員その場）
function planSets(model, afterIdx, counts, o) {
  o = o || {};
  const base = model.sets[Math.max(0, Math.min(model.sets.length - 1, afterIdx))];
  const names = makeNames(model.sets.map(s => s.name), counts.length, o.names || 'num', o.nameList);
  const sets = counts.map((c, i) => ({
    name: names[i], counts: qsFmt(c), hold: o.hold ? String(o.hold) : '0', note: [], tail: null, foot: [], mark: false,
    stmts: o.copy === 'hold' ? [] : clone(base.stmts).map(st => Object.assign(st, {note: [], tail: null, line: 0}))
  }));
  return {sets, names};
}
// モデルにセットを入れる（元は変えず、新しいモデルを返す）。at = 入れる位置（その手前に入る）
function insertSets(model, at, sets) {
  const m = clone(model);
  m.sets.splice(Math.max(0, Math.min(m.sets.length, at)), 0, ...sets);
  return m;
}
// セットの長さ（counts・hold）を変える。値は 0.5 単位に丸める。最初のセットの counts は無視されるので触らない
function resizeSet(model, k, counts, hold) {
  const m = clone(model), s = m.sets[k];
  if (!s) return m;
  if (counts != null && k > 0) s.counts = qsFmt(Math.max(QS_STEP, qsRound(counts)));
  if (hold != null) s.hold = qsFmt(Math.max(0, qsRound(hold)));
  return m;
}
// 各セットの [開始, 終わり（counts のあと）, ホールドの終わり]。counts / hold が式のときは数えられないので NaN
function setTimes(model) {
  let t = 0;
  return model.sets.map((s, k) => {
    const c = k ? parseFloat(s.counts) || 0 : 0, h = parseFloat(s.hold) || 0, o = {t0: t, arrive: t + c, t1: t + c + h};
    t = o.t1; return o;
  });
}
// 曲の小節線（パートの小節の頭）の時刻。part: パートの番号。省略 or -1 ですべて。複数パートで同じ時刻は1つに
function barTimes(D, part) {
  const ps = (D && D.parts || []).filter((p, i) => part == null || part < 0 || i === part);
  const set = new Set();
  for (const p of ps) { for (const b of p.bars) set.add(Math.round(b * 1000) / 1000); set.add(Math.round(p.end * 1000) / 1000); }
  return [...set].sort((a, b) => a - b);
}
// 小節線の時刻から、N小節ごとの区切りの時刻と、その小節番号（1始まり）を作る。from: ここ以降だけ（カウント）
function barBoundaries(bars, every, from) {
  every = Math.max(1, Math.round(every || 1));
  const heads = bars.slice(0, -1).map((t, i) => ({t, bar: i + 1})); // 最後の1つは曲の終わり
  const out = [];
  for (let i = 0; i < heads.length; i += every) if (heads[i].t > (from || 0) + 1e-9) out.push(heads[i]);
  return {points: out, end: bars.length ? bars[bars.length - 1] : 0};
}
// 区切りの時刻 [t1, t2, …] と終わり（end）から、origin（最初のセットの始まり）からのカウントの並びを作る
function boundsToCounts(origin, points, end, o) {
  o = o || {};
  const step = o.step || QS_STEP, min = o.min == null ? 1 : o.min;
  const ts = points.slice().sort((a, b) => a - b).map(t => qsRound(t, step)).concat(end == null ? [] : [qsRound(end, step)]);
  const counts = [], from = [];
  let prev = qsRound(origin, step);
  for (const t of ts) {
    const d = t - prev;
    if (d + 1e-9 >= min) { counts.push(d); from.push(prev); prev = t; }
    else if (counts.length && d >= 0) { counts[counts.length - 1] += d; prev = t; }  // 短すぎる区切りは前のセットに足す
  }
  return {counts, from, total: counts.reduce((a, b) => a + b, 0)};
}
// タップで区切る: 押した時刻（開始からのカウント）と終わりの時刻から、セットのカウントの並びを作る
function tapsToCounts(taps, end, o) { return boundsToCounts(0, taps, end, o); }
// 作るセットの一覧（プレビュー用の文字列）
function seqSummary(counts) {
  if (!counts.length) return '';
  const runs = [];
  for (const c of counts) { const l = runs[runs.length - 1]; if (l && l[0] === c) l[1]++; else runs.push([c, 1]); }
  return runs.map(([c, n]) => n > 1 ? `${qsFmt(c)}×${n}` : qsFmt(c)).join('  ');
}

const API = {parseCountSeq, parseMeter, parseBarSeq, everyBars, makeNames, alphaName, planSets, insertSets, resizeSet, setTimes, barTimes, barBoundaries, boundsToCounts, tapsToCounts, seqSummary, qsRound, qsFmt, clone, mkStmt, isIndividual, groupTokens, pushPositional, faceStr, setPin, perfInfo, removalPlan, newIdOf, rewriteGroup, applyRemoval, sectionHasData,
  splitSet, memberAtLocal, positionAt, fitShape, formationStmts, setsPayload, validPayload, pasteSets, deleteSets, moveSets, mirrorSets, mirrorSet, mirrorStmt, pastePlan, applyPaste, applyPasteSeq, groupFor,
  deleteMembers, applySkips, closeSkips, fieldBounds, rewriteGroupForAdd, findSpot, addMembers, pastePositions, pasteTargets,
  evCombo, isModifierKey, parseCombo, normCombo, comboCaps, comboLabel, conflictsOf, mergeKeymap, diffKeymap, normQ, fuzzyScore, toRomaji};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.JKSC = API;
})(typeof window !== 'undefined' ? window : globalThis);
