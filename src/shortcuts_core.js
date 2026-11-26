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
  for (const set of m.sets) set.stmts = set.stmts.filter(st => { const g = rw(st.group); if (g == null) return false; st.group = g; return true; });
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
  let Rc = await opts.compile(opts.print(cur));
  if (!Rc.ok) return {ok: false, error: '削除後のショーを組み立てられませんでした: ' + (Rc.error && Rc.error.msg || '')};
  if (mode === 'keep') {
    const want = new Map();
    D.performers.forEach((p, i) => { const nid = res.idMap[p.id]; if (nid) want.set(nid, {old: i, pos: D.sets.map(s => s.pos[i])}); });
    const st = await stabilize(cur, want, R0, D, opts, Rc);
    if (!st.ok) return st;
    Rc = st.Rc; res.pinned = st.pinned; res.exact = st.exact; res.maxDiff = st.maxDiff;
  }
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

const API = {clone, mkStmt, isIndividual, groupTokens, pushPositional, faceStr, setPin, perfInfo, removalPlan, newIdOf, rewriteGroup, applyRemoval, sectionHasData,
  deleteMembers, fieldBounds, rewriteGroupForAdd, findSpot, addMembers, pastePositions, pasteTargets,
  evCombo, isModifierKey, parseCombo, normCombo, comboCaps, comboLabel, conflictsOf, mergeKeymap, diffKeymap, normQ, fuzzyScore, toRomaji};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.JKSC = API;
})(typeof window !== 'undefined' ? window : globalThis);
