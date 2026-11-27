// 「日本語で指示する」の画面と実行部分。判断（意図・値・確信度）は src/cmd_core.js、ここは
//   1. 判断の結果を「一行の説明 → Enter で実行 / 候補3つ / 質問 / わかりません」の形で見せる
//   2. 実行は、手でやるときと同じエディタの部品（setIndividual・arrange・SC.deleteMembers…）を通す
//   3. 複合の指示（選んで → 動かして → 円に）も、元に戻すのは1回（undoStack を1つにまとめる）
// editor.html の本体スクリプトと shortcuts.js のあとに読み込まれ、グローバル（M, R, sel, curSet …）を使う。
(function () {
'use strict';
const CMD = window.JKCMD;
if (!CMD) return;
let API = null, started = false;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 使えない環境 */ } };
const AUTO_KEY = 'jk_cmd_auto', HIST_KEY = 'jk_cmd_hist';
const autoPref = () => lsGet(AUTO_KEY) === '1';
const ic = (n, s) => API ? API.icon(n, s) : '';
const fail = m => Object.assign(new Error(m), {cmd: true});

// ===================================================================== 今のショーを、判断に渡す形にする
const showReady = () => !!(API && API.ready());
function buildCtx() {
  if (!showReady()) return {sections: [], members: [], sel: [], sets: [], curSet: 0, field: {type: 'gym'}, stride: 0.625, beatsPerBar: 4};
  const D = R.data, k = Math.min(curSet, D.sets.length - 1), pos = D.sets[k].pos;
  const msec = (M && M.sections) || [];
  const sections = D.sections.map((s, i) => ({id: s.id, label: s.label, n: D.performers.filter(p => p.sec === i).length, instrument: s.instrument || (msec[i] && (msec[i].instrument || msec[i].inst)) || undefined}));
  const members = D.performers.map((p, i) => ({id: p.id, sec: p.sec, x: pos[i][0], y: pos[i][1]}));
  let names = []; try { names = JKX.displayNames(M.sets); } catch (e) { names = M.sets.map(s => s.name); }
  let bpb = 4; try { if (typeof SEEK !== 'undefined' && SEEK.beats) bpb = +SEEK.beats || 4; } catch (e) { /* 既定 */ }
  let stride = 0.625; try { stride = strideM(); } catch (e) { /* 既定 */ }
  return {sections, members, sel: API.selIds(), sets: names.map(String), curSet: k, field: {type: (D.field && D.field.type) || 'gym'}, stride, beatsPerBar: bpb};
}
const idxMap = () => new Map(R.data.performers.map((p, i) => [p.id, i]));
const idxOf = ids => { const m = idxMap(); return ids.map(id => m.get(id)).filter(i => i != null).sort((a, b) => a - b); };
function setSel(ix) { sel = new Set(ix); try { updateSel(); drawCanvas(); } catch (e) { /* 描画前 */ } }
// 対象を解いて、エディタの「選んだ人」にする（並べる・向きなど、手で使う部品は選んだ人に対して働く）
function pick(t, ctx, min, what) {
  const ix = idxOf(CMD.resolveTarget(t, ctx));
  if (!ix.length) throw fail('対象の人がいません');
  if (min && ix.length < min) throw fail(`${what || 'この操作'}は ${min}人以上が必要です（対象は${ix.length}人）`);
  setSel(ix);
  return ix;
}
const posOf = j => R.data.sets[curSet].pos[j];
const srcOf = () => currentSource();
async function flush() {   // 編集をすぐ計算して、R（今の位置）を最新にする。複合の指示で、次の文が前の結果を見るため
  if (timer) { clearTimeout(timer); timer = null; }
  const p = pending; pending = null;
  if (p != null) await compile(p, false);
}
const unitLen = (a, ctx) => CMD.unitToLen(a.v, a.unit, ctx);
const defSp = () => (typeof isFB === 'function' && isFB()) ? 2 : 1.2;

// ===================================================================== 実行（意図ごと）
function pcaAxis(pts) {
  const n = pts.length, c = [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n];
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p[0] - c[0], dy = p[1] - c[1]; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy); let u = [Math.cos(a), Math.sin(a)];
  if (u[0] < -1e-9 || (Math.abs(u[0]) < 1e-9 && u[1] < 0)) u = [-u[0], -u[1]];
  return {c, u};
}
function arrangeCustom(a, ix, ctx) {   // 間隔・列数・向きの指定があるとき、または くさび・斜め
  const kind = a.kind, n = ix.length, pts = ix.map(j => posOf(j).slice()), F2 = p => [f3(p[0]), f3(p[1])];
  const sp = a.spacing ? Math.max(0.2, unitLen(a.spacing, ctx)) : null;
  const {c, u: u0} = pcaAxis(pts);
  if (kind === 'wedge') {   // 先頭が客席側に突き出す V 字。ぶつからないよう、左から右へ順に割り当てる
    const s = (sp || defSp()) * 0.9, slots = [];
    for (let k = 0; k < n; k++) { const side = k === 0 ? 0 : (k % 2 ? 1 : -1), rank = Math.ceil(k / 2); slots.push([c[0] + side * rank * s, c[1] + (rank - Math.floor(n / 4)) * s * 0.9]); }
    const byX = ix.slice().sort((p, q) => posOf(p)[0] - posOf(q)[0] || posOf(p)[1] - posOf(q)[1]);
    slots.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    byX.forEach((j, i) => setIndividual(curSet, j, f3(slots[i][0]), f3(slots[i][1])));
    edited(true); return;
  }
  if (kind === 'block') {
    let cols = a.cols, rows = a.rows;
    if (rows && !cols) cols = Math.ceil(n / rows);
    const byRow = ix.slice().sort((p, q) => (posOf(p)[1] - posOf(q)[1]) || (posOf(p)[0] - posOf(q)[0]));
    addPositional(curSet, ix, groupOf(byRow), {kind: 'block', c: F2(c), cols: String(cols || Math.ceil(Math.sqrt(n))), spacing: sp ? fmt(sp) : null, rows: null});
    return;
  }
  // line / diag
  let u = u0;
  if (kind === 'diag') u = [Math.SQRT1_2, Math.SQRT1_2];
  else if (a.orient === 'h') u = [1, 0]; else if (a.orient === 'v') u = [0, 1];
  const t = pts.map(p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]);
  let tmin = Math.min(...t), tmax = Math.max(...t);
  const need = (n - 1) * (sp || defSp());
  if (sp) { tmin = -need / 2; tmax = need / 2; } else if (tmax - tmin < need) { const m = (tmax + tmin) / 2; tmin = m - need / 2; tmax = m + need / 2; }
  const at = s => [c[0] + u[0] * s, c[1] + u[1] * s];
  const order = ix.map((j, i) => [j, t[i]]).sort((p, q) => p[1] - q[1]).map(x => x[0]);
  addPositional(curSet, ix, groupOf(order), {kind: 'line', a: F2(at(tmin)), b: F2(at(tmax))});
}
const secOfIdx = ix => [...new Set(ix.map(j => R.data.performers[j].sec))];
const NAME_JA = {front: '客席', back: '奥', kami: '上手', shimo: '下手'};
function setCountsOf(k) { return parseFloat(M.sets[k].counts) || 0; }
function goalSet(t, ctx) {
  const n = M.sets.length;
  if (t.first) return 0; if (t.last) return n - 1; if (t.rel) return curSet + t.rel;
  if (t.index != null) return t.index;
  throw fail(`セット「${t.name}」が見つかりません`);
}
async function copySetClip() { setSel.clear(); setSel.add(curSet); API.copySets(true); }
function oneSetFocus() { setSel.clear(); setSel.add(curSet); tlFocus = true; }
const EX = {
  select_all() { setSel(R.data.performers.map((p, i) => i)); return `全員（${R.data.performers.length}人）を選びました`; },
  select(a, ctx) { const ix = pick(a.target, ctx); return `${ix.length}人を選びました`; },
  select_none() { setSel([]); return '選択を解除しました'; },
  select_invert() { const cur = sel, all = R.data.performers.map((p, i) => i).filter(i => !cur.has(i)); if (!all.length) throw fail('選んでいない人がいません'); setSel(all); return `残りの${all.length}人を選びました`; },
  move(a, ctx) {
    const ix = pick(a.target, ctx), len = unitLen(a.amount, ctx);
    let dx = 0, dy = 0; for (const d of a.dirs || []) { const v = CMD.DIRVEC[d]; if (v) { dx += v[0] * len; dy += v[1] * len; } }
    if (!dx && !dy) throw fail('動かす向きが分かりません');
    moveSelected(dx, dy, new Map(ix.map(j => [j, basePos(curSet, j)]))); edited(true);
  },
  move_to(a, ctx) {
    const ix = pick(a.target, ctx), ps = ix.map(posOf);
    let cx = 0, cy = 0; try { const dc = defaultCenter(); const nx = parseFloat(dc[0]), ny = parseFloat(dc[1]); cx = Number.isFinite(nx) ? nx : 0; cy = Number.isFinite(ny) ? ny : (R.data.field && R.data.field.d ? R.data.field.d / 2 : 0); } catch (e) { /* 原点 */ }
    const mx = ps.reduce((s, p) => s + p[0], 0) / ps.length, my = ps.reduce((s, p) => s + p[1], 0) / ps.length;
    const sh = Math.hypot(cx - mx, cy - my) < 0.3 ? 0.6 : 1;   // すでに中心なら、中心へ寄せて（縮めて）集める
    ix.forEach((j, i) => setIndividual(curSet, j, f3(cx + (ps[i][0] - mx) * sh), f3(cy + (ps[i][1] - my) * sh))); edited(true);
  },
  rotate(a, ctx) { pick(a.target, ctx); API.rotateSel(a.cw ? -a.deg : a.deg); },
  scale(a, ctx) { pick(a.target, ctx, 2, '広げる・狭める'); API.scaleSel(a.factor); },
  spacing(a, ctx) {
    const ix = pick(a.target, ctx, 2, '間隔を決める'), ps = ix.map(posOf);
    const nn = ps.map((p, i) => Math.min(...ps.map((q, j) => j === i ? Infinity : Math.hypot(p[0] - q[0], p[1] - q[1]))));
    const cur = nn.reduce((s, v) => s + v, 0) / nn.length, want = unitLen(a.value, ctx);
    if (!(cur > 1e-6)) throw fail('いまの間隔が測れません（重なっています）');
    API.transformSel((p, c) => [c[0] + (p[0] - c[0]) * want / cur, c[1] + (p[1] - c[1]) * want / cur]);
  },
  flip(a, ctx) { pick(a.target, ctx, 2, '反転'); flipSel(a.axis); },
  swap(a, ctx) {
    const A = idxOf(CMD.resolveTarget(a.a, ctx)), B = idxOf(CMD.resolveTarget(a.b, ctx));
    if (!A.length || A.length !== B.length) throw fail('入れ替える人数がそろっていません');
    const pa = A.map(j => posOf(j).slice()), pb = B.map(j => posOf(j).slice());
    A.forEach((j, i) => setIndividual(curSet, j, f3(pb[i][0]), f3(pb[i][1])));
    B.forEach((j, i) => setIndividual(curSet, j, f3(pa[i][0]), f3(pa[i][1])));
    setSel(A.concat(B)); edited(true);
  },
  unpin(a, ctx) { const ix = pick(a.target, ctx); removeIndividual(curSet, ix); edited(true); },
  async delete_members(a, ctx) {
    const ix = pick(a.target, ctx);
    if (ix.length >= R.data.performers.length) throw fail('全員は削除できません。最低1人は残してください');
    const res = await window.JKSC.deleteMembers(M, ix.map(j => R.data.performers[j].id), API.coreOpts('keep'));
    if (!res.ok) throw fail(res.error);
    sel = new Set(); await API.commit(res.model); updateSel(); drawCanvas();
  },
  async add_members(a, ctx) {
    let ix = a.target ? idxOf(CMD.resolveTarget(a.target, ctx)) : idxOf(ctx.sel);
    if (!ix.length) throw fail('どのセクションを増やすか分かりません');
    const src = [];
    for (const si of secOfIdx(ix)) { const last = R.data.performers.filter(p => p.sec === si).pop(); for (let c = 0; c < a.count; c++) src.push(last.id); }
    const res = await window.JKSC.addMembers(M, src, API.coreOpts('keep'));
    if (!res.ok) throw fail(res.error);
    await API.commit(res.model);
    const nix = res.newIds.map(id => R.data.performers.findIndex(p => p.id === id)).filter(i => i >= 0); setSel(nix);
  },
  async duplicate_members(a, ctx) {
    const ix = pick(a.target, ctx), res = await window.JKSC.addMembers(M, ix.map(j => R.data.performers[j].id), API.coreOpts('keep'));
    if (!res.ok) throw fail(res.error);
    await API.commit(res.model);
    setSel(res.newIds.map(id => R.data.performers.findIndex(p => p.id === id)).filter(i => i >= 0));
  },
  copy_members(a, ctx) { pick(a.target, ctx); API.copySel(true); },
  async paste_members() { if (!sel.size) throw fail('貼り付け先の人を、先に選んでください'); await API.pasteSel(); },
  async cut_members(a, ctx) { const ix = pick(a.target, ctx); API.copySel(true); await EX.delete_members({target: {ids: ix.map(j => R.data.performers[j].id)}}, ctx); },
  set_add(a) {
    if (a.where === 'end') { curSet = M.sets.length - 1; curStmt = -1; }
    if (!qsNewSet(a.counts == null ? null : a.counts, a.hold ? 'hold' : undefined)) throw fail('セットを追加できません');
  },
  set_bulk(a) { if (!qsInsertSets(a.counts, {})) throw fail('セットを作れません'); },
  async set_split(a) { return splitLike('split', a); },
  async set_cut(a) { return splitLike('cut', a); },
  set_copy() { oneSetFocus(); if (!API.copySets(true)) throw fail('コピーできません'); },
  async set_paste() { oneSetFocus(); await API.pasteSetsOp(false); },
  async set_dup() { oneSetFocus(); await API.dupSetsOp(); },
  async set_delete() { if (curSet === 0) throw fail('最初のセットは削除できません'); oneSetFocus(); await API.deleteSetsOp(); },
  set_next() { if (curSet >= M.sets.length - 1) throw fail('これが最後のセットです'); API.gotoSet(curSet + 1); },
  set_prev() { if (curSet <= 0) throw fail('これが最初のセットです'); API.gotoSet(curSet - 1); },
  set_goto(a, ctx) { const k = goalSet(a.to, ctx); if (k < 0 || k >= M.sets.length) throw fail('そのセットはありません'); API.gotoSet(k); },
  set_move(a) {
    const to = a.dir === 'next' ? curSet + 1 : curSet - 1;
    if (curSet === 0 && a.dir !== 'next') throw fail('最初のセットは前へ動かせません');
    if (to < 1 || to > M.sets.length - 1) throw fail('これ以上は動かせません');
    [M.sets[curSet], M.sets[to]] = [M.sets[to], M.sets[curSet]]; curSet = to; edited(true);
  },
  async set_mirror() { oneSetFocus(); await API.mirrorSetsOp(); },
  set_counts(a) {
    if (curSet === 0) throw fail('最初のセットには長さ（カウント）がありません。ホールドで決めます');
    const cur = setCountsOf(curSet), v = a.value.abs != null ? a.value.abs : cur + a.value.rel;
    if (!(v >= 0.5 && v <= 999)) throw fail('カウントは 0.5〜999 で決めてください');
    M.sets[curSet].counts = String(Math.round(v * 100) / 100); edited(true);
  },
  set_hold(a) {
    const cur = parseFloat(M.sets[curSet].hold) || 0, v = a.value.abs != null ? a.value.abs : cur + a.value.rel;
    if (!(v >= 0 && v <= 999)) throw fail('ホールドは 0〜999 で決めてください');
    M.sets[curSet].hold = String(Math.round(v * 100) / 100); edited(true);
  },
  tempo(a) {
    const cur = parseFloat(M.tempo) || 120, v = a.value.abs != null ? a.value.abs : a.value.mul != null ? cur * a.value.mul : cur + a.value.rel;
    if (!(v >= 30 && v <= 300)) throw fail('テンポは 30〜300 で決めてください');
    M.tempo = String(Math.round(v)); edited(true);
  },
  face(a, ctx) { pick(a.target, ctx); applyFx('sel', 'face', a.value); },
  pose(a, ctx) { pick(a.target, ctx); applyFx('sel', 'pose', a.value); },
  carry(a, ctx) { pick(a.target, ctx); applyFx('sel', 'carry', a.value); },
  step_style(a, ctx) { pick(a.target, ctx); applyFx('sel', 'step', a.value); },
  action(a, ctx) { pick(a.target, ctx); applyFx('sel', 'action', a.value); },
  async auto_fix() { await autoFix(); },
  parade(a) {
    if (typeof window.jkOpenParade !== 'function') throw fail('パレード機能が使えません');
    try { const st = window.JKParadeUI && JKParadeUI.state; if (st && a.pattern) st.pattern = a.pattern; } catch (e) { /* 既定のまま */ }
    window.jkOpenParade();
  },
  play(a) { if (a.from === 'set') API.playFromSet(); else if (playing) stopPlay(); else API.runAction('play'); },
  stop() { stopPlay(); },
  view_3d() { $('preview').click(); },
  export_video() { $('video').click(); },
  print() { $('printbtn').click(); },
  async save() { await save(); },
  undo() { undo(); }, redo() { redo(); },
  grid(a) { const g = $('gridmode'); g.value = a.mode; g.onchange(); },
  grid_points(a) { const g = $('gridpts'); g.checked = !!a.on; g.onchange(); },
  snap(a, ctx) {
    const sn = $('snap'); let v;
    if (a.value.off) v = '0'; else { const want = unitLen(a.value, ctx); v = [...sn.options].filter(o => +o.value > 0).sort((p, q) => Math.abs(p.value - want) - Math.abs(q.value - want))[0]; v = v && v.value; }
    if (v == null) throw fail('その刻みは選べません');
    sn.value = v; sn.dispatchEvent(new Event('change'));
  },
  zoom(a) { $(a.dir === 'in' ? 'zin' : a.dir === 'out' ? 'zout' : 'zfit').click(); },
  names(a) { const c = $('shownames'); if (c.checked !== !!a.on) { c.checked = !!a.on; c.onchange(); } },
  tool(a) { setTool(a.tool); },
  help() { $('helpbtn').click(); },
  none() { throw fail('わかりませんでした'); }
};
for (const k of Object.keys(CMD.ARR_KIND)) {
  EX[k] = function (a, ctx) {
    const kind = CMD.ARR_KIND[k];
    if (kind === 'follow') { pick(a.target, ctx, 2, 'フォロー'); if (curSet === 0) throw fail('最初のセットではフォローは使えません'); makeFollow(); return; }
    const ix = pick(a.target, ctx, 2, '並べる');
    const custom = a.spacing || a.cols || a.rows || a.orient || kind === 'wedge' || kind === 'diag';
    if (custom) arrangeCustom(Object.assign({}, a, {kind}), ix, ctx); else arrange(kind);
  };
}
async function splitLike(mode, a) {
  let pt;
  if (a.at.here) { pt = API.playPoint(); if (!pt.scrubbed) throw fail('先に、再生ヘッドを分けたい位置に置いてください'); }
  else { const S = R.data.sets[curSet], total = curSet === 0 ? S.hold : S.counts; pt = {k: curSet, c: a.at.half ? Math.round(total / 2 * 100) / 100 : a.at.c}; }
  if (!API.canSplitAt(pt)) throw fail(`このセットは ${pt.c} カウントでは${mode === 'split' ? '分けられません' : '切れません'}（長さの範囲内で指定してください）`);
  await API.splitOp(mode, pt);
}

// ===================================================================== 1つの指示（複合も）を実行。元に戻すのは1回
let running = false;
const READONLY = /^(select|play|stop|view_3d|export_video|print|help|zoom|names|tool|grid|snap|set_goto|set_next|set_prev|copy_members|set_copy|undo|redo|save|parade)/;
async function runCommand(steps, text) {
  if (running) return {ok: false, msg: '前の指示を実行中です'};
  if (!showReady()) return {ok: false, msg: 'ショーを読み込めていないため、実行できません。エラーを直してからお試しください'};
  running = true;
  if (window.uxBusy) uxBusy(true);
  const n0 = undoStack.length, before = srcOf();
  window.JK_TOAST_MUTE = true; window.JK_TOAST_LOG = [];
  const done = [];
  let errMsg = null;
  try {
    for (const st of steps) {
      const f = EX[st.intent]; if (!f) throw fail('その操作はまだできません');
      const ctx = buildCtx(), s0 = srcOf();
      const info = await f(st.args || {}, ctx);
      await flush();
      if (lastErr) throw fail('この操作でショーにエラーが出ました。「元に戻す」で戻せます');
      if (!READONLY.test(st.intent) && srcOf() === s0 && !(st.intent === 'auto_fix')) {
        const lg = window.JK_TOAST_LOG.slice(-1)[0];
        throw fail(lg ? lg.msg + (lg.sub ? '（' + lg.sub + '）' : '') : '変化がありませんでした（すでにその状態です）');
      }
      done.push(typeof info === 'string' ? info : st.preview);
    }
  } catch (e) {
    if (!e || !e.cmd) console.error(e);
    errMsg = e && e.cmd ? e.message : 'うまくいきませんでした: ' + (e && e.message || e);
  } finally {
    window.JK_TOAST_MUTE = false; window.JK_TOAST_LOG = [];
    running = false;
    if (window.uxBusy) uxBusy(false);
  }
  const after = srcOf();
  const changed = after !== before;
  const onlyUndo = steps.every(s => s.intent === 'undo' || s.intent === 'redo');
  if (changed && !onlyUndo) { undoStack.splice(n0); pushUndo(before); }   // 途中の1手ずつの記録を捨てて、実行前の状態を1つだけ積む
  return {ok: !errMsg, msg: errMsg, done, changed: changed && !onlyUndo, steps: steps.length, onlyUndo};
}
function report(res, text) {
  if (!res) return;
  if (res.onlyUndo && res.ok) { API.scToast(res.done.filter(Boolean).join(' → ') || '戻しました', {kind: 'info', icon: 'undo', force: true}); return; }
  if (!res.ok) { API.scToast(res.msg, {kind: 'info', icon: 'warn', force: true, undo: res.changed, sub: res.changed ? `ここまでは実行しました。「${text}」` : '', ms: 5200}); return; }
  const msg = res.done.filter(Boolean).join(' → ');
  API.scToast(msg.length > 70 ? msg.slice(0, 68) + '…' : msg || '実行しました', {undo: res.changed, icon: 'wand', force: true, sub: `「${text}」`, kind: 'ok'});
}
function remember(text) {
  try { const h = JSON.parse(lsGet(HIST_KEY) || '[]').filter(x => x !== text); h.unshift(text); lsSet(HIST_KEY, JSON.stringify(h.slice(0, 8))); } catch (e) { /* 使えない */ }
}
const histOf = () => { try { return JSON.parse(lsGet(HIST_KEY) || '[]'); } catch (e) { return []; } };

// ===================================================================== 判断の見せ方（共通の部品）
const ORDER = ['unknown', 'ask', 'choose', 'confirm', 'run'];
function overall(steps) {
  let st = 'run';
  for (const s of steps) if (ORDER.indexOf(s.status) < ORDER.indexOf(st)) st = s.status;
  if (st === 'run' && steps.some(s => s.destructive && s.complete)) st = 'confirm';
  return st;
}
function chipsFor(ctx) {
  const s0 = (ctx.sections[0] || {}).label, s1 = (ctx.sections[1] || {}).label, out = [];
  if (s0) out.push(`${s0}を前に3歩動かして`);
  out.push('全員を円にして');
  if (s0) out.push(`${s0}を選んで前に2歩、それから横一列に`);
  if (s0 && s1) out.push(`${s0}と${s1}を入れ替えて`);
  out.push('時計回りに90度回して', 'セットを8拍で追加', 'ぶつかりを自動で直して', '元に戻して');
  return out.slice(0, 6);
}
function makeAsk(host) {
  const S = {text: '', u: null, steps: null, status: 'idle', pick: 0, armed: false, opts: [], autoT: 0, autoOn: false, ms: 0};
  const clearAuto = () => { clearTimeout(S.autoT); S.autoT = 0; S.autoOn = false; };
  function recompute() {
    clearAuto(); S.armed = false; S.pick = 0;
    if (!S.text.trim()) { S.u = null; S.steps = null; S.status = 'idle'; return; }
    const t0 = performance.now();
    S.u = CMD.understand(S.text, buildCtx());
    S.ms = performance.now() - t0;
    S.steps = S.u.steps.map(s => Object.assign({}, s));
    S.status = overall(S.steps);
  }
  const problem = () => { const i = S.steps.findIndex(s => s.status !== 'run' && s.status !== 'confirm'); return i < 0 ? null : {i, s: S.steps[i]}; };
  function pct(p) { return Math.max(1, Math.min(99, Math.round(p * 100))); }
  function render() {
    const el = host.panel; if (!el) return;
    S.opts = [];
    const add = (label, run) => { S.opts.push({label, run}); return S.opts.length - 1; };
    const btn = (label, run, cls, extra) => { const i = add(label, run); return `<button type="button" class="ai-b ${cls || ''}${i === S.pick ? ' on' : ''}" data-opt="${i}">${label}${extra || ''}</button>`; };
    let html = '';
    if (S.status === 'idle') {
      const ch = chipsFor(buildCtx()), hist = histOf().filter(h => !ch.includes(h)).slice(0, 2);
      html = `<div class="ai-card ai-idle"><div class="ai-ex">${showReady() ? '' : '<p class="ai-w">ショーを読み込むと、使えるようになります。</p>'}<span class="ai-l">例</span>${hist.concat(ch).map(c => btn(esc(c), () => host.setText(c), 'ai-chip')).join('')}</div><p class="ai-note">順番に書けば、まとめて実行できます（例:「トランペットを選んで前に3歩、それから円に」）。実行したあとは「元に戻す」1回で戻せます。</p></div>`;
    } else if (S.status === 'run' || S.status === 'confirm') {
      const conf = pct(S.u.conf), many = S.steps.length > 1, danger = S.status === 'confirm';
      const list = many ? `<ol class="ai-steps">${S.steps.map(s => `<li>${esc(s.preview)}</li>`).join('')}</ol>` : `<div class="ai-one">${esc(S.steps[0].preview)}</div>`;
      const go = danger
        ? btn(S.armed ? 'はい、実行します' : '内容を確認して実行', () => exec(), 'ai-go ai-danger', ` <kbd>Enter</kbd>`)
        : btn('実行', () => exec(), 'ai-go', ` <kbd>Enter</kbd>`);
      const warn = danger ? `<div class="ai-warnl">${ic('warn', 16)}<span>${S.armed ? 'もう一度 Enter（またはボタン）で実行します。' : '消す操作です。内容をよく確かめてください。'}元に戻せます。</span></div>` : '';
      const auto = S.autoOn ? `<div class="ai-auto"><i></i><span>まもなく実行します（Esc で中止）</span></div>` : '';
      html = `<div class="ai-card ai-${danger ? 'danger' : 'run'}"><div class="ai-hd">${ic('wand', 16)}<span class="ai-k">${many ? S.steps.length + '段階の指示' : 'こう理解しました'}</span><span class="ai-cf" title="AIの確信度（実際の正解率に合わせて補正済み）">確信 ${conf}%</span></div>${list}${warn}${auto}<div class="ai-act">${go}<span class="ai-hint">${danger ? '' : '実行後は「元に戻す」1回で戻せます'}</span></div></div>`;
    } else if (S.status === 'choose') {
      const pr = problem(), alts = pr.s.alts.filter((a, i) => i === 0 || a.p >= 0.03).slice(0, 3);
      if (alts.length === 1 && S.steps.length === 1) {   // 候補が事実上1つ（念のため確かめる）
        const a = alts[0];
        html = `<div class="ai-card ai-run"><div class="ai-hd">${ic('wand', 16)}<span class="ai-k">こう理解しました</span><span class="ai-cf" title="AIの確信度（実際の正解率に合わせて補正済み）">確信 ${pct(a.p)}%</span></div><div class="ai-one">${esc(a.preview || a.label)}</div><div class="ai-act">${a.complete ? btn(a.destructive ? '内容を確認して実行' : '実行', () => chooseAlt(pr.i, a), 'ai-go' + (a.destructive ? ' ai-danger' : ''), ' <kbd>Enter</kbd>') : btn('続ける', () => chooseAlt(pr.i, a), 'ai-go')}<span class="ai-hint">言い回しが少し珍しいので、確かめています</span></div></div>`;
      } else
      html = `<div class="ai-card ai-choose"><div class="ai-hd">${ic('help', 16)}<span class="ai-k">どれですか？</span><span class="ai-cf">確信 ${pct(S.u.conf)}%</span></div>${S.steps.length > 1 ? `<div class="ai-sub">${S.steps.length}段階の指示の ${pr.i + 1} つ目「${esc(pr.s.text)}」</div>` : ''}<div class="ai-alts">${alts.map(a => btn(`<b>${esc(a.preview || a.label)}</b><small>${esc(a.label)}・${pct(a.p)}%</small>`, () => chooseAlt(pr.i, a), 'ai-alt')).join('')}</div><div class="ai-act"><span class="ai-hint">どれも違うときは、言い方を変えてください</span></div></div>`;
    } else if (S.status === 'ask') {
      const pr = problem(), m = pr.s.missing[0];
      html = `<div class="ai-card ai-ask"><div class="ai-hd">${ic('help', 16)}<span class="ai-k">もう少し教えてください</span></div><div class="ai-q">${esc(m.q)}</div><div class="ai-ch">${(m.choices || []).map(c => btn(esc(c.label), () => answer(pr.i, c.patch), 'ai-chip ai-pick')).join('') || '<span class="ai-hint">言い方を変えてもう一度入力してください</span>'}</div>${pr.s.preview && !/？/.test(pr.s.preview) ? `<div class="ai-sub">いまの理解: ${esc(pr.s.preview)}</div>` : ''}</div>`;
    } else {
      html = `<div class="ai-card ai-unk"><div class="ai-hd">${ic('help', 16)}<span class="ai-k">わかりませんでした</span></div><div class="ai-q">言い方を変えて、もう一度お試しください。たとえば:</div><div class="ai-ch">${chipsFor(buildCtx()).slice(0, 4).map(c => btn(esc(c), () => host.setText(c), 'ai-chip')).join('')}</div>${host.menuBtn ? `<div class="ai-act">${btn('メニューから探す', () => host.menuBtn(), 'ai-menu')}</div>` : ''}</div>`;
    }
    if (S.status === 'idle' || S.status === 'run') html = html.replace(/<\/div>$/, `<label class="ai-autochk"><input type="checkbox" data-aiauto${autoPref() ? ' checked' : ''}> 確実なときは、確認なしですぐ実行する（声の入力は自動）</label></div>`);
    el.innerHTML = html;
    host.onRender && host.onRender(S);
  }
  function chooseAlt(i, alt) {
    const old = S.steps[i];
    S.steps[i] = Object.assign({}, old, {intent: alt.intent, args: alt.args, missing: alt.missing, complete: alt.complete, destructive: alt.destructive, preview: alt.preview, conf: 0.9, chosen: true, status: alt.complete ? (alt.destructive ? 'confirm' : 'run') : 'ask'});
    S.status = overall(S.steps); S.pick = 0; S.armed = false;
    if (S.status === 'run') exec(true); else render();
  }
  function answer(i, patch) {
    S.steps[i] = CMD.applyPatch(S.steps[i], patch, buildCtx());
    S.status = overall(S.steps); S.pick = 0; S.armed = false;
    if (S.status === 'run') exec(true); else render();
  }
  async function exec(explicit) {
    clearAuto();
    if (S.status !== 'run' && S.status !== 'confirm') return;
    if (S.status === 'confirm' && !S.armed) { S.armed = true; render(); return; }
    const steps = S.steps.slice(), text = S.text;
    remember(text);
    host.beforeRun && host.beforeRun();
    const res = await runCommand(steps, text);
    host.afterRun && host.afterRun(res);
    report(res, text);
    void explicit;
  }
  function armAuto(voice) {
    clearAuto();
    if (!autoPref() || S.status !== 'run' || !S.u || !S.u.auto) return;
    const t = CMD.norm(S.text);
    if (!voice && !/(?:て|で|ろ|な|い|る|ます|ください|にして|したい|ほしい|くれ)$/.test(t)) return;
    S.autoOn = true; render();
    S.autoT = setTimeout(() => { if (S.autoOn) exec(); }, voice ? 700 : 1100);
  }
  const ctl = {
    S, render,
    setText(t, o) { host.input && (host.input.value = t); S.text = t; recompute(); render(); if (o && o.voice) { if (autoPref() && S.status === 'run' && S.u.auto) exec(); } else armAuto(false); },
    onInput(t) { S.text = t; recompute(); render(); armAuto(false); },
    enter() { if (S.status === 'idle') return false; if (S.status === 'run' || S.status === 'confirm') { exec(); return true; } if (S.opts[S.pick]) { S.opts[S.pick].run(); return true; } return true; },
    move(d) { if (S.autoOn) clearAuto(); const n = S.opts.length; if (!n) return false; S.pick = (S.pick + d + n) % n; host.panel.querySelectorAll('[data-opt]').forEach(b => b.classList.toggle('on', +b.dataset.opt === S.pick)); return true; },
    cancelAuto() { if (S.autoOn) { clearAuto(); render(); return true; } return false; },
    click(i) { const o = S.opts[i]; if (o) { S.pick = i; o.run(); } },
    reset() { clearAuto(); S.text = ''; S.u = null; S.steps = null; S.status = 'idle'; S.armed = false; S.pick = 0; if (host.input) host.input.value = ''; }
  };
  host.panel && host.panel.addEventListener('mousedown', e => { if (e.target.closest('[data-opt]')) e.preventDefault(); });
  host.panel && host.panel.addEventListener('click', e => { const b = e.target.closest('[data-opt]'); if (b) { e.preventDefault(); ctl.click(+b.dataset.opt); } });
  host.panel && host.panel.addEventListener('change', e => { if (e.target.matches('[data-aiauto]')) lsSet(AUTO_KEY, e.target.checked ? '1' : '0'); });
  return ctl;
}

// ===================================================================== マイク（Web Speech API。使えない端末ではボタンを出さない）
function mountMic(btn, ctl) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.hidden = true; return; }
  let rec = null, on = false;
  btn.onclick = () => {
    if (on && rec) { rec.stop(); return; }
    try {
      rec = new SR(); rec.lang = 'ja-JP'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      rec.onstart = () => { on = true; btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); };
      rec.onend = () => { on = false; btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); };
      rec.onerror = e => { on = false; btn.classList.remove('on'); if (e && /not-allowed|service-not-allowed/.test(e.error)) API.scToast('マイクが使えません', {kind: 'info', sub: 'ブラウザのマイクの許可を確認してください', force: true}); };
      rec.onresult = e => { let t = '', fin = false; for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; } ctl.setText(t, {voice: fin}); };
      rec.start();
    } catch (e) { on = false; }
  };
  btn.title = '声で指示する（日本語）'; btn.setAttribute('aria-label', '声で指示する');
}

// ===================================================================== コマンドパレット（Ctrl+K）の「AIに頼む」
const PAL = {el: null, hooks: null, ctl: null, manual: false, shown: false, inp: null, list: null, btn: null};
function palMount(el, hooks) {
  PAL.el = el; PAL.hooks = hooks; PAL.inp = el.querySelector('#scpin'); PAL.list = el.querySelector('#scplist');
  const row = el.querySelector('.scp-in');
  const b = document.createElement('button'); b.type = 'button'; b.id = 'scpai'; b.className = 'scp-aitg'; b.setAttribute('aria-pressed', 'false');
  b.title = '日本語で指示する（AI）。メニューに無い言い方は、自動でこちらになります';
  b.innerHTML = `${ic('wand', 16)}<span>AIに頼む</span>`;
  row.insertBefore(b, row.querySelector('.kc'));
  b.onclick = () => { palSetMode(!PAL.manual); PAL.inp.focus(); };
  PAL.btn = b;
  PAL.ctl = makeAsk({
    panel: PAL.list, get input() { return PAL.inp; },
    setText(t) { PAL.inp.value = t; PAL.ctl.onInput(t); PAL.inp.focus(); },
    beforeRun() { PAL.hooks.close(false); },
    menuBtn() { palSetMode(false); PAL.inp.value = ''; PAL.hooks.render(''); PAL.inp.focus(); },
    onRender() { PAL.list.classList.add('ai-on'); }
  });
  // マイクは入力欄の横
  const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'scp-mic'; mb.innerHTML = ic('mic', 18); mb.hidden = false;
  row.insertBefore(mb, b); mountMic(mb, PAL.ctl);
}
function palSetMode(on) {
  PAL.manual = !!on; if (PAL.btn) { PAL.btn.classList.toggle('on', PAL.manual); PAL.btn.setAttribute('aria-pressed', String(PAL.manual)); }
  if (PAL.inp) { PAL.inp.placeholder = PAL.manual ? 'やりたいことを日本語で（例: トランペットを前に3歩動かして）' : 'やりたいことを入力（例: さくじょ / sakujo / 回転 / 保存）'; }
  if (!PAL.manual) { PAL.ctl.reset(); palHide(); PAL.hooks.render(PAL.inp.value); } else { PAL.ctl.onInput(PAL.inp.value); }
}
function palShow(q) { PAL.shown = true; PAL.list.classList.add('ai-on'); PAL.ctl.onInput(q); }
function palHide() { PAL.shown = false; if (PAL.list) PAL.list.classList.remove('ai-on'); }
function palReset(opt) {
  if (!PAL.ctl) return;
  PAL.ctl.reset(); palHide(); PAL.manual = !!(opt && opt.ai); palSetMode(PAL.manual);
}
function palKey(e) {
  if (!PAL.shown && !PAL.manual) return false;
  if (e.key === 'Enter') { e.preventDefault(); PAL.ctl.enter(); return true; }
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { if (PAL.ctl.S.opts.length > 1) { e.preventDefault(); PAL.ctl.move(1); } else if (e.key === 'Tab') e.preventDefault(); return true; }
  if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { if (PAL.ctl.S.opts.length > 1) { e.preventDefault(); PAL.ctl.move(-1); } else if (e.key === 'Tab') e.preventDefault(); return true; }
  if (e.key === 'Escape' && PAL.ctl.cancelAuto()) { e.preventDefault(); e.stopPropagation(); return true; }
  return false;
}

// ===================================================================== かんたんモードの、いつも見える入力欄
const BAR = {el: null, inp: null, panel: null, ctl: null};
function mountBar() {
  if ($('aibar')) return;
  const center = $('center'); if (!center) return;
  const bar = document.createElement('div'); bar.id = 'aibar'; bar.setAttribute('role', 'search');
  bar.innerHTML = `<div class="aib-row">${ic('wand', 20)}<input id="aiin" type="text" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="やりたいことを日本語で…" aria-label="やりたいことを日本語で指示する"><button type="button" class="aib-mic" id="aimic" aria-label="声で指示する" aria-pressed="false">${ic('mic', 20)}</button><button type="button" class="aib-go" id="aigo" aria-label="実行">${ic('send', 18)}</button></div><div class="aib-panel" id="aipanel" hidden></div>`;
  center.insertBefore(bar, center.firstChild);
  BAR.el = bar; BAR.inp = $('aiin'); BAR.panel = $('aipanel');
  const show = () => { BAR.panel.hidden = false; bar.classList.add('open'); };
  const hide = () => { BAR.panel.hidden = true; bar.classList.remove('open'); };
  BAR.ctl = makeAsk({
    panel: BAR.panel, input: BAR.inp,
    setText(t) { BAR.inp.value = t; BAR.ctl.onInput(t); BAR.inp.focus(); show(); },
    beforeRun() { },
    afterRun(res) { if (res && res.ok) { BAR.ctl.reset(); BAR.inp.value = ''; BAR.ctl.render(); hide(); BAR.inp.blur(); } else { BAR.ctl.render(); } },
    menuBtn() { API.openPalette(); },
    onRender() { BAR.panel.hidden = !bar.classList.contains('open'); }
  });
  BAR.inp.addEventListener('focus', () => { show(); BAR.ctl.onInput(BAR.inp.value); });
  BAR.inp.addEventListener('input', () => { show(); BAR.ctl.onInput(BAR.inp.value); });
  BAR.inp.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); BAR.ctl.enter(); }
    else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey && BAR.ctl.S.opts.length > 1)) { if (BAR.ctl.move(1)) e.preventDefault(); }
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey && BAR.ctl.S.opts.length > 1)) { if (BAR.ctl.move(-1)) e.preventDefault(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!BAR.ctl.cancelAuto()) { if (BAR.inp.value) { BAR.ctl.reset(); BAR.ctl.render(); } else { hide(); BAR.inp.blur(); } } }
  });
  $('aigo').onclick = () => { if (!BAR.ctl.enter()) BAR.inp.focus(); };
  document.addEventListener('pointerdown', e => { if (!bar.contains(e.target)) { hide(); } }, true);
  mountMic($('aimic'), BAR.ctl);
  if (!(API.isMobileW && API.isMobileW())) BAR.inp.placeholder = 'やりたいことを日本語で…（例: トランペットを前に3歩）';
}

// ===================================================================== 公開
function init() {
  if (started) return;
  API = window.JKSCAPI; if (!API) return;
  started = true;
  mountBar();
  window.JKCMDUI.api = API;
}
const UI = {
  init, ready: () => !!(API && CMD.modelReady()), buildCtx, chipsFor,
  palMount, palActive: () => PAL.manual, palRender: q => palShow(q), palAuto: q => { if (!PAL.ctl) return; palShow(q); }, palHide, palKey, palReset, palStart(q) { palSetMode(true); PAL.inp.value = q; PAL.ctl.onInput(q); PAL.inp.focus(); },
  // テスト・外部から: 文を判断して（確認が要るものも含めて）実行する
  decide: text => CMD.understand(text, buildCtx()),
  async run(text, o) {
    const u = CMD.understand(text, buildCtx());
    if (!(u.status === 'run' || (u.status === 'confirm' && o && o.confirm))) return {ok: false, status: u.status, u};
    const res = await runCommand(u.steps, text);
    if (!(o && o.quiet)) report(res, text);
    return Object.assign({status: u.status, u}, res);
  },
  autoPref, setAuto: v => lsSet(AUTO_KEY, v ? '1' : '0'),
  EX
};
window.JKCMDUI = UI;
if (window.JKSCAPI) init();
})();
