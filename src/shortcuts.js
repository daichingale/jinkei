// キーボードショートカット・コマンドパレット・ショートカット一覧・人の削除/追加の画面部分。
// editor.html の本体スクリプトと ux.js のあとに読み込まれ、そのグローバル（M, R, sel, edited …）を使う。
// キー操作はすべて、下の「操作の表」（ACTIONS）を通る。パレット・一覧・ツールチップ・メニューも同じ表から作る。
(function () {
'use strict';
const SC = window.JKSC;
if (!SC) return;
const KM_KEY = 'jk_keymap_v1', RECENT_KEY = 'jk_palette_recent_v1', HINT_KEY = 'jk_sc_hint_v1', REFLOW_KEY = 'jk_sc_reflow_v1';
const MAC = /Mac|iPhone|iPad|iPod/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 使えない環境 */ } };

// ================= アイコン（24px の線画。パレットと一覧で使う） =================
const IC = {
  gen: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h9a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9h-9a6 6 0 000 12h3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4.5 4.5"/>',
  kbd: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 115 0c0 1.7-2.5 2-2.5 3.7M12 17h.01"/>',
  mode: '<rect x="3" y="6" width="18" height="12" rx="6"/><circle cx="9" cy="12" r="3"/>',
  home: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/>',
  eye3d: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  select: '<path d="M6 3l0 14 3.5-3 2.5 6 2.5-1-2.5-6 4.5-.5z"/>',
  line: '<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.8"/><circle cx="20" cy="5" r="1.8"/>',
  arc: '<path d="M3 17C6 5 18 5 21 17"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  curve: '<path d="M3 16C7 3 11 20 15 10S21 8 21 8"/>',
  follow: '<path d="M3 18L9 10L14 15L21 5"/><circle cx="3" cy="18" r="1.5"/><circle cx="6.5" cy="13" r="1.2"/>',
  block: '<rect x="4" y="5" width="16" height="14"/><path d="M9 5v14M14.5 5v14M4 12h16"/>',
  selall: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="2"/>',
  esc: '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  prev: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  people: '<circle cx="8.5" cy="8.5" r="2.7"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c0-3.2 2.2-5 5-5s5 1.8 5 5M14 15.2c.9-.5 1.7-.7 2.6-.7 2.4 0 4 1.5 4 4.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5"/>',
  trash2: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M9 12l6 4M15 12l-6 4"/>',
  adduser: '<circle cx="9.5" cy="8" r="3.2"/><path d="M3.5 20c0-3.6 2.7-6 6-6 1.2 0 2.3.3 3.2.9M18 13v6M15 16h6"/>',
  dup: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6.5A1.5 1.5 0 0013.5 5h-7A1.5 1.5 0 005 6.5v7A1.5 1.5 0 006.5 15H9"/>',
  paste: '<rect x="6" y="5" width="12" height="15" rx="2"/><path d="M9 5V4h6v1M9 11h6M9 15h4"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.2 15.7L18 4M15.8 15.7L6 4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', left: '<path d="M19 12H5M11 6l-6 6 6 6"/>', right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  rotcw: '<path d="M20 12a8 8 0 11-2.6-5.9M20 4v5h-5"/>', rotccw: '<path d="M4 12a8 8 0 102.6-5.9M4 4v5h5"/>',
  scaleup: '<path d="M14 5h5v5M19 5l-6 6M10 19H5v-5M5 19l6-6"/>', scaledown: '<path d="M19 10h-5V5M14 10l6-6M5 14h5v5M10 14l-6 6"/>',
  fliph: '<path d="M12 4v16M8 7L3 12l5 5zM16 7l5 5-5 5z"/>', flipv: '<path d="M4 12h16M7 8l5-5 5 5zM7 16l5 5 5-5z"/>',
  unpin: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  play: '<path d="M8 5l11 7-11 7z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  setprev: '<path d="M15 5l-7 7 7 7"/>', setnext: '<path d="M9 5l7 7-7 7"/>',
  setfirst: '<path d="M17 5l-7 7 7 7M6 5v14"/>', setlast: '<path d="M7 5l7 7-7 7M18 5v14"/>',
  stepb: '<path d="M14 6l-6 6 6 6M19 7v10"/>', stepf: '<path d="M10 6l6 6-6 6M5 7v10"/>',
  newset: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M12 9v6M9 12h6"/>',
  delset: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 12h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zoomin: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4.5 4.5M8.5 11h5M11 8.5v5"/>', zoomout: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4.5 4.5M8.5 11h5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5"/>',
  tab: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17"/>',
  wand: '<path d="M5 19L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM18 12l.7 1.3L20 14l-1.3.7L18 16l-.7-1.3L16 14l1.3-.7z"/>',
  arrange: '<circle cx="5" cy="17" r="1.8"/><circle cx="10" cy="12.5" r="1.8"/><circle cx="15" cy="9" r="1.8"/><circle cx="20" cy="6" r="1.8"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6"/>'
};
const icon = (n, s) => `<svg class="sci" width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.gen}</svg>`;
const esc2 = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ================= 状況の判定 =================
const ready = () => typeof M !== 'undefined' && M && typeof R !== 'undefined' && R && !lastErr;
const selIdx = () => [...sel].sort((a, b) => a - b);
const selIds = () => selIdx().map(i => R.data.performers[i].id);
const allIds = () => R.data.performers.map(p => p.id);
function isTyping() {
  const a = document.activeElement;
  if (!a) return false;
  const t = a.tagName;
  if (t === 'INPUT') return !/^(checkbox|radio|button|submit|reset|color|file|image)$/i.test(a.type || 'text');
  return t === 'TEXTAREA' || t === 'SELECT' || !!a.isContentEditable;
}
const onButton = () => { const a = document.activeElement; return !!a && (/^(BUTTON|A|SUMMARY)$/.test(a.tagName) || (a.tagName === 'INPUT' && /^(checkbox|radio|button|submit|reset|color|file)$/i.test(a.type))); };
const hasTextSel = () => { try { return !!String(window.getSelection()); } catch (e) { return false; } };
const isMobileW = () => window.matchMedia && matchMedia('(max-width:760px)').matches;

// ================= トースト（「元に戻す」ボタン付き） =================
let toastLast = {msg: '', t: 0};
function scToast(msg, o) {
  o = o || {};
  const now = Date.now();
  if (!o.undo && msg === toastLast.msg && now - toastLast.t < 1500) return;
  toastLast = {msg, t: now};
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast sct ' + (o.kind || 'ok');
  t.innerHTML = `<span class="sct-ic">${icon(o.icon || (o.kind === 'err' ? 'esc' : o.kind === 'info' ? 'help' : 'people'), 22)}</span><span class="sct-t"><b>${esc2(msg)}</b>${o.sub ? `<small>${esc2(o.sub)}</small>` : ''}</span>`;
  let timer = null;
  const close = () => { clearTimeout(timer); t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  if (o.undo) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sct-undo'; b.innerHTML = `元に戻す <span class="kc kc-s">${esc2(labelOf('undo'))}</span>`;
    b.onclick = () => { close(); undo(); };
    t.appendChild(b);
  }
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  timer = setTimeout(close, o.ms || (o.undo ? 7000 : 2600));
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => { timer = setTimeout(close, 2500); });
  return t;
}
window.scToast = scToast;

// ================= 編集の確定（元に戻せる1回の操作として） =================
let opBusy = false;
async function commit(model) {
  const prev = currentSource(), s = printModel(model);
  stopPlay(); playT = null;
  clearEditTimers();
  pushUndo(prev);
  recordEdit(s);
  await compile(s, true);
}
const coreOpts = mode => ({
  mode,
  print: printModel,
  compile: src => fetch('/api/compile', {method: 'POST', body: src}).then(r => r.json()),
  fix: src => fetch('/api/fix', {method: 'POST', body: src}).then(r => r.json())
});
async function guarded(fn) {
  if (opBusy) return;
  opBusy = true;
  if (window.uxBusy) uxBusy(true);
  try { await fn(); }
  catch (e) { console.error(e); scToast('うまくいきませんでした', {kind: 'err', sub: String(e && e.message || e)}); }
  finally { opBusy = false; if (window.uxBusy) uxBusy(false); }
}

// ================= 人を減らす・増やす =================
const reflowPref = () => lsGet(REFLOW_KEY) === '1';
async function removeMembers(ids, mode) {
  if (!ready()) { scToast('エラーを直してから操作してください', {kind: 'info'}); return; }
  if (!ids.length) return;
  if (ids.length >= R.data.performers.length) { notice('全員は削除できません。最低1人は残してください。'); return; }
  await guarded(async () => {
    const res = await SC.deleteMembers(M, ids, coreOpts(mode));
    if (!res.ok) { notice(res.error); return; }
    sel = new Set();
    await commit(res.model);
    updateSel(); drawCanvas();
    const nm = ids.length === 1 ? `${ids[0]} を削除しました` : `${ids.length}人を削除しました`;
    const sub = [mode === 'reflow' ? '抜けた分を詰めて、隊形を作り直しました' : (res.pinned ? 'ほかの人の位置はそのままです' : 'ほかの人は動いていません')];
    if (res.droppedParts.length) sub.push(`楽譜「${res.droppedParts.join('」「')}」は対象がいなくなったので外しました`);
    if (res.droppedSections.length) sub.push(`セクション「${res.droppedSections.join('」「')}」も削除しました`);
    if (!res.exact && mode === 'keep') sub.push('一部の位置がずれた可能性があります（チェックしてください）');
    scToast(nm, {undo: true, sub: sub.join('。'), icon: 'trash'});
  });
}
async function deleteSelected(reflow) {
  if (!sel.size) { scToast('先に、消したい人を選んでください', {kind: 'info', sub: 'クリック・範囲ドラッグ・Tab・1〜9 で選べます'}); return; }
  await removeMembers(selIds(), reflow ? 'reflow' : 'keep');
}
async function addMembers(dup) {
  if (!ready()) { scToast('エラーを直してから操作してください', {kind: 'info'}); return; }
  if (!sel.size) { scToast('先に、そばに増やしたい人を選んでください', {kind: 'info', sub: '選んだ人と同じパートが、隣に増えます'}); return; }
  const D = R.data, ids = selIdx();
  let src;
  if (dup) src = ids.map(i => D.performers[i].id);
  else { const by = new Map(); ids.forEach(i => by.set(D.performers[i].sec, D.performers[i].id)); src = [...by.values()]; }
  await guarded(async () => {
    const res = await SC.addMembers(M, src, coreOpts('keep'));
    if (!res.ok) { notice(res.error); return; }
    await commit(res.model);
    const idx = res.newIds.map(id => R.data.performers.findIndex(p => p.id === id)).filter(i => i >= 0);
    sel = new Set(idx); updateSel(); drawCanvas();
    const sub = ['ほかの人の位置はそのままです'];
    if (res.warnings && res.warnings.length) sub.push(`移動中に近づく所が${res.warnings.length}か所あります（チェックタブ）`);
    scToast(res.added === 1 ? `${res.newIds[0]} を追加しました` : `${res.added}人を追加しました`, {undo: true, sub: sub.join('。'), icon: 'adduser'});
  });
}

// ---- コピー・貼り付け（位置だけ） ----
let clip = null;
function copySel(quiet) {
  if (!ready() || !sel.size) { if (!quiet) scToast('先に、コピーしたい人を選んでください', {kind: 'info'}); return false; }
  const pos = R.data.sets[curSet].pos;
  clip = {set: M.sets[curSet].name, items: selIdx().map(i => ({id: R.data.performers[i].id, p: pos[i].slice()}))};
  if (!quiet) scToast(`${clip.items.length}人の位置をコピーしました`, {kind: 'info', sub: '別のセットに移って Ctrl+V で貼り付けます', icon: 'dup'});
  return true;
}
async function pasteSel() {
  if (!clip) { scToast('先に、位置をコピーしてください', {kind: 'info', sub: '人を選んで Ctrl+C'}); return false; }
  if (!ready()) return false;
  const t = SC.pasteTargets(clip.items, sel.size ? selIds() : [], allIds());
  if (!t.pairs.length) { scToast('貼り付け先の人がいません', {kind: 'info', sub: '貼り付けたい人を選んでから Ctrl+V'}); return true; }
  const pos = R.data.sets[curSet].pos, idx = new Map(R.data.performers.map((p, i) => [p.id, i]));
  if (t.pairs.every(x => Math.hypot(pos[idx.get(x.id)][0] - x.p[0], pos[idx.get(x.id)][1] - x.p[1]) < 1e-6)) { scToast('すでに同じ位置です', {kind: 'info', sub: '別のセットに移ってから貼り付けてください'}); return true; }
  await guarded(async () => {
    await commit(SC.pastePositions(M, curSet, t.pairs));
    sel = new Set(t.pairs.map(x => idx.get(x.id))); updateSel(); drawCanvas();
    scToast(`${t.pairs.length}人の位置を貼り付けました`, {undo: true, sub: t.mode === 'order' ? '選んだ人に、並び順で当てはめました' : `セット ${M.sets[curSet].name} に反映しました`, icon: 'paste'});
  });
  return true;
}
async function cutSel() {
  if (!sel.size) { scToast('先に、切り取りたい人を選んでください', {kind: 'info'}); return; }
  copySel(true);
  await removeMembers(selIds(), reflowPref() ? 'reflow' : 'keep');
}

// ---- 動かす・整える ----
// 回転・拡大縮小の中心は「みんなの平均の位置」。繰り返して押しても、中心がずれない（R のあと Shift+R で元に戻る）
function selCenter(ids) { const ps = ids.map(i => R.data.sets[curSet].pos[i]); return [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length]; }
function transformSel(fn) {
  const k = curSet, ids = selIdx(), c = selCenter(ids);
  for (const i of ids) { const q = fn(R.data.sets[k].pos[i], c); setIndividual(k, i, f3(q[0]), f3(q[1])); }
  edited(true);
}
function rotateSel(deg) {
  if (sel.size >= 2) { const a = rad(deg); transformSel((p, c) => rotPt(p, c, a)); $('info').textContent = `${sel.size}人を${deg < 0 ? '右' : '左'}に${Math.abs(deg)}°回しました`; }
  else if (sel.size === 1) { // 1人なら体の向きを回す（画面上で右回り = 下手側へ）
    const i = selIdx()[0], f = (R.data.sets[curSet].face || [])[i], N = (f == null ? -90 : f) + 90;
    setAttr([i], {face: faceStrOf(N + deg)}); $('info').textContent = `向きを ${faceName(faceStrOf(N + deg))} にしました`;
  }
}
function scaleSel(k) { if (sel.size >= 2) { transformSel((p, c) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]); $('info').textContent = `${sel.size}人を ×${fmt(k)} にしました`; } }
function nudge(dir, combo) {
  const base = +$('snap').value || 0.1, big = /Shift/.test(combo), fine = /Alt/.test(combo);
  const st = fine ? Math.max(0.01, base / 5) : base * (big ? 5 : 1);
  const d = {l: [-st, 0], r: [st, 0], u: [0, st], d: [0, -st]}[dir];
  moveSelected(d[0], d[1], new Map(selIdx().map(j => [j, basePos(curSet, j)])));
  edited(true);
}

// ---- セット・時間 ----
function gotoSet(k) { if (!ready()) return; k = Math.max(0, Math.min(M.sets.length - 1, k)); if (k !== curSet) selectSet(k); }
function stepCount(d) {
  if (!ready() || R.data.sets.length !== M.sets.length) return;
  stopPlay();
  const lay = tlLayout();
  drawAt(Math.max(0, Math.min(lay.total, playheadT() + d)));
}
function playFromSet() {
  if (!ready()) return;
  if (playing) stopPlay();
  playT = tlLayout().segs[Math.min(curSet, M.sets.length - 1)].t0;
  startPlay();
}
// 隣の人を選ぶ（Tab）
function stepMember(d) {
  if (!ready()) return false;
  const n = R.data.performers.length, cur = sel.size ? (d > 0 ? Math.max(...sel) : Math.min(...sel)) : (d > 0 ? -1 : n);
  const i = ((cur + d) % n + n) % n;
  sel = new Set([i]);
  if (document.querySelector('.tabs button.on') && document.querySelector('.tabs button.on').dataset.p === 'pset') pickPerformer(i);
  else { const p = R.data.performers[i]; $('info').textContent = `${p.id}（${R.data.sections[p.sec].label}）`; updateSel(); drawCanvas(); }
  return true;
}
function selectSection(n, add) {
  if (!ready()) return;
  const idx = R.data.performers.map((p, i) => p.sec === n - 1 ? i : -1).filter(i => i >= 0);
  if (!idx.length) { scToast(`セクション${n}はありません`, {kind: 'info'}); return; }
  sel = add ? new Set([...sel, ...idx]) : new Set(idx);
  updateSel(); drawCanvas();
  $('info').textContent = `${R.data.sections[n - 1].label}（${idx.length}人）を選びました`;
}
function escape() {
  if (document.activeElement && isTyping()) { document.activeElement.blur(); return; }
  if ($('ctx').style.display === 'block' || $('pop').style.display === 'block') { closePops(); return; }
  if (!R) return;
  if (draw || pendingDraw) { cancelDraw(); return; }
  if (tool !== 'select') { setTool('select'); return; }
  exitScrub(); sel.clear(); curStmt = -1; updateSel(); markCards(); drawCanvas();
}

// ================= 操作の表 =================
const GROUPS = [['gen', '基本'], ['mem', '人を増やす・減らす'], ['sel', '選ぶ'], ['mov', '動かす・整える'], ['tool', 'ツール'], ['set', 'セット・再生'], ['view', '表示'], ['pane', '画面・パネル']];
const GNOTE = {mov: '矢印キー: Shift で5倍、Alt で細かく動かせます。何も選んでいないときは、← → でセットを送ります。', mem: 'Delete は「その場から抜く」（ほかの人は動きません）。Shift+Delete は抜けた分を詰めて隊形を作り直します。'};
const GNAME = Object.fromEntries(GROUPS);
const ACTIONS = [], BYID = {};
const NEED_MSG = {sel: '先に人を選んでください', sel2: '2人以上選んでください', show: 'ショーを読み込んでから使えます'};
// def(id, 名前, グループ, 既定のキー, {icon, kw: 検索語(ひらがな・ローマ字・英語), run, need, typing, always, repeat, fixed, why})
function def(id, name, group, keys, o) {
  const a = Object.assign({id, name, group, keys: keys.map(SC.normCombo), icon: 'gen', kw: '', need: 'show'}, o || {});
  ACTIONS.push(a); BYID[id] = a; return a;
}
// 基本
def('save', '保存', 'gen', ['Mod+S'], {icon: 'save', kw: 'ほぞん save こうしん ダウンロード', typing: true, always: true, need: null, run: () => { save(); }});
def('undo', '元に戻す', 'gen', ['Mod+Z'], {icon: 'undo', kw: 'もどす もどる undo ひとつまえ', always: true, need: null, run: () => { undo(); }});
def('redo', 'やり直す', 'gen', ['Mod+Shift+Z', 'Mod+Y'], {icon: 'redo', kw: 'やりなおす redo もういちど', always: true, need: null, run: () => { redo(); }});
def('palette', 'コマンド検索を開く', 'gen', ['Mod+K'], {icon: 'search', kw: 'こまんど けんさく ぱれっと palette command search さがす', typing: true, always: true, need: null, noPal: true, run: () => { togglePalette(); }});
def('shortcuts', 'ショートカット一覧を開く', 'gen', ['?', 'F1'], {icon: 'kbd', kw: 'しょーとかっと いちらん きー keyboard shortcut keys へるぷ ヘルプ きーぼーど', always: true, need: null, run: () => { openSheet(); }});
def('help', '使い方ヘルプを開く', 'gen', [], {icon: 'help', kw: 'へるぷ つかいかた help guide ガイド ようご', always: true, need: null, run: () => { $('helpbtn').click(); }});
def('mode', 'かんたん／詳細を切り替える', 'gen', [], {icon: 'mode', kw: 'かんたん しょうさい easy pro もーど mode きりかえ', always: true, need: null, run: () => { const b = document.querySelector('#modesw button:not(.on)'); if (b) b.click(); }});
def('home', 'はじめに画面を開く', 'gen', [], {icon: 'home', kw: 'はじめに ほーむ home ようこそ かんたんさくせい さんぷる 新規 しんき', always: true, need: null, run: () => { $('homebtn').click(); if (window.JK_LOCAL) $('newfile').click(); }});
def('preview', '2D/3Dプレビューを開く', 'gen', [], {icon: 'eye3d', kw: 'ぷれびゅー preview 3d 3でぃー みる', need: 'show', run: () => { $('preview').click(); }});
def('video', '3D動画を書き出す', 'gen', [], {icon: 'video', kw: 'どうが video mp4 かきだし export れこーど', need: 'show', run: () => { $('video').click(); }});
// ツール
for (const [id, name, key, , ] of TOOLS) {
  const nm = {select: '選択ツール', line: '直線ツール', arc: '弧ツール', circle: '円ツール', curve: '曲線ツール', follow: 'フォローツール', block: 'ブロックツール'}[id] || name;
  const kw = {select: 'せんたく select かーそる', line: 'ちょくせん line せん', arc: 'こ arc えんこ', circle: 'えん circle まる', curve: 'きょくせん curve かーぶ', follow: 'ふぉろー follow ふぉろーざりーだー', block: 'ぶろっく block ほうけい しかく'}[id] || '';
  def('tool-' + id, nm, 'tool', [key.toLowerCase()], {icon: id, kw: kw + ' つーる tool', need: 'show', run: () => { setTool(id); }});
}
// 選ぶ
def('select-all', '全員を選ぶ', 'sel', ['Mod+A'], {icon: 'selall', kw: 'ぜんいん すべて ぜんぶ select all せんたく', run: () => { sel = new Set(R.data.performers.map((_, i) => i)); updateSel(); drawCanvas(); $('info').textContent = `全員（${sel.size}人）を選びました`; }});
def('escape', '選択を解除・操作をやめる', 'sel', ['Escape'], {icon: 'esc', kw: 'かいじょ やめる きゃんせる esc cancel deselect とじる', typing: true, always: true, fixed: true, need: null, run: () => { escape(); }});
def('member-next', '次の人を選ぶ', 'sel', ['Tab'], {icon: 'next', kw: 'つぎ ひと めんばー next member たぶ', run: () => { if (onButton()) return false; return stepMember(1); }});
def('member-prev', '前の人を選ぶ', 'sel', ['Shift+Tab'], {icon: 'prev', kw: 'まえ ひと めんばー previous member たぶ', run: () => { if (onButton()) return false; return stepMember(-1); }});
for (let n = 1; n <= 9; n++) def('select-sec-' + n, `セクション${n}を選ぶ`, 'sel', [String(n), 'Shift+' + n], {icon: 'people', kw: 'せくしょん ぱーと section select', fixed: true, merge: 'select-sec', run: e => { selectSection(n, !!(e && e.shiftKey)); }});
// 人を増やす・減らす
def('delete', '削除（その場から抜く）', 'mem', ['Delete', 'Backspace'], {icon: 'trash', kw: 'さくじょ けす のぞく ぬく delete remove del めんばー ひと じょがい', need: 'sel', run: () => { deleteSelected(false); }});
def('delete-reflow', '削除して詰める（隊形を作り直す）', 'mem', ['Shift+Delete', 'Shift+Backspace'], {icon: 'trash2', kw: 'さくじょ つめる けす delete reflow つめて さいこうせい かたをつめる', need: 'sel', run: () => { deleteSelected(true); }});
def('add-member', '同じパートに1人追加', 'mem', ['n'], {icon: 'adduser', kw: 'ついか ふやす ひとり あたらしい add new member ふやす にんずう', need: 'sel', run: () => { addMembers(false); }});
def('duplicate', '選んだ人を複製', 'mem', ['Mod+D'], {icon: 'dup', kw: 'ふくせい こぴー おなじ duplicate clone ふやす', need: 'sel', run: () => { addMembers(true); }});
def('copy', '位置をコピー', 'mem', ['Mod+C'], {icon: 'dup', kw: 'こぴー ぴー copy いち', need: 'sel', skip: hasTextSel, run: () => copySel()});
def('cut', '切り取り（コピーして削除）', 'mem', ['Mod+X'], {icon: 'cut', kw: 'きりとり かっと cut', need: 'sel', skip: hasTextSel, run: () => { cutSel(); }});
def('paste', '位置を貼り付け', 'mem', ['Mod+V'], {icon: 'paste', kw: 'はりつけ ぺーすと paste いち', need: 'show', run: () => { if (!clip) return false; pasteSel(); }});
// 動かす・整える
for (const [dir, nm, k] of [['l', '左', 'ArrowLeft'], ['r', '右', 'ArrowRight'], ['u', '奥', 'ArrowUp'], ['d', '手前', 'ArrowDown']])
  def('nudge-' + dir, `選んだ人を${nm}へ動かす`, 'mov', [k, 'Shift+' + k, 'Alt+' + k], {icon: {l: 'left', r: 'right', u: 'up', d: 'down'}[dir], kw: 'うごかす ずらす nudge move やじるし', repeat: true, noPal: true, run: (e, combo) => {
    if (sel.size) { nudge(dir, combo); return; }
    if (dir === 'l') gotoSet(curSet - 1); else if (dir === 'r') gotoSet(curSet + 1); else return false; // 選んでいないときは、セットを送る
  }});
def('rotate-cw', '選んだ人を右に15°回す', 'mov', ['r'], {icon: 'rotcw', kw: 'かいてん まわす みぎ rotate cw', need: 'sel', repeat: true, run: () => { rotateSel(-15); }});
def('rotate-ccw', '選んだ人を左に15°回す', 'mov', ['Shift+R'], {icon: 'rotccw', kw: 'かいてん まわす ひだり rotate ccw', need: 'sel', repeat: true, run: () => { rotateSel(15); }});
def('scale-up', '選んだ人を広げる（選択なしなら拡大表示）', 'mov', ['Plus', '='], {icon: 'scaleup', kw: 'ひろげる かくだい ずーむ scale zoom in おおきく', repeat: true, run: () => { if (sel.size >= 2) scaleSel(1.1); else $('zin').click(); }});
def('scale-down', '選んだ人を縮める（選択なしなら縮小表示）', 'mov', ['-'], {icon: 'scaledown', kw: 'ちぢめる しゅくしょう ずーむ scale zoom out ちいさく', repeat: true, run: () => { if (sel.size >= 2) scaleSel(1 / 1.1); else $('zout').click(); }});
def('flip-h', '左右に反転', 'mov', ['h'], {icon: 'fliph', kw: 'はんてん さゆう ひっくりかえす flip horizontal みぎひだり', need: 'sel2', run: () => { flipSel('x'); }});
def('flip-v', '前後に反転', 'mov', ['Shift+H'], {icon: 'flipv', kw: 'はんてん ぜんご ひっくりかえす flip vertical まえうしろ', need: 'sel2', run: () => { flipSel('y'); }});
for (const [k, nm, ic, kw] of [['line', '直線', 'line', 'ちょくせん line'], ['curve', '曲線', 'curve', 'きょくせん curve'], ['arc', '弧', 'arc', 'こ arc'], ['circle', '円', 'circle', 'えん circle'], ['block', 'ブロック', 'block', 'ぶろっく block']])
  def('arrange-' + k, `選んだ人を${nm}に並べる`, 'mov', [], {icon: ic, kw: kw + ' ならべる せいれつ そろえる arrange', need: 'sel2', run: () => { arrange(k); }});
def('arrange-follow', '選んだ人をフォローにする', 'mov', [], {icon: 'follow', kw: 'ふぉろー follow ならべる', need: 'sel2', run: () => { makeFollow(); }});
def('unpin', '個別の位置を解除', 'mov', [], {icon: 'unpin', kw: 'こべつ かいじょ unpin もどす いち', need: 'sel', run: () => { $('unpin').click(); }});
// セット・再生
def('play', '再生／停止', 'set', ['Space'], {icon: 'play', kw: 'さいせい ていし play stop すたーと ぷれい', run: () => { if (onButton()) return false; $('tlplay').click(); }});
def('play-from-set', '今のセットから再生', 'set', ['Mod+Enter'], {icon: 'play', kw: 'さいせい いまから play from set', run: () => { playFromSet(); }});
def('play-set', '前のセットからの動きを再生', 'set', [], {icon: 'play', kw: 'うごき さいせい play move', run: () => { $('playset').click(); }});
def('set-prev', '前のセットへ', 'set', ['[', 'PageUp'], {icon: 'setprev', kw: 'まえ せっと previous set もどる', repeat: true, run: () => { gotoSet(curSet - 1); }});
def('set-next', '次のセットへ', 'set', [']', 'PageDown'], {icon: 'setnext', kw: 'つぎ せっと next set すすむ', repeat: true, run: () => { gotoSet(curSet + 1); }});
def('set-first', '最初のセットへ', 'set', ['Home'], {icon: 'setfirst', kw: 'さいしょ せっと first home', run: () => { gotoSet(0); }});
def('set-last', '最後のセットへ', 'set', ['End'], {icon: 'setlast', kw: 'さいご せっと last end', run: () => { gotoSet(1e9); }});
def('step-back', '1カウント戻る', 'set', [','], {icon: 'stepb', kw: 'かうんと もどる step back たいむらいん 1かうんと', repeat: true, run: () => { stepCount(-1); }});
def('step-fwd', '1カウント進む', 'set', ['.'], {icon: 'stepf', kw: 'かうんと すすむ step forward たいむらいん 1かうんと', repeat: true, run: () => { stepCount(1); }});
def('dup-set', '新しいセット（今のセットのコピー）', 'set', ['Mod+Shift+N'], {icon: 'newset', kw: 'あたらしい せっと ふくせい copy new set つくる', run: () => { $('dupset').click(); }});
def('add-set', '新しいセット（全員その場）', 'set', [], {icon: 'newset', kw: 'あたらしい せっと ついか add new set からの', run: () => { $('addset').click(); }});
def('del-set', '今のセットを削除', 'set', [], {icon: 'delset', kw: 'さくじょ せっと delete set けす', run: () => { $('delset').click(); }});
def('set-move-prev', '今のセットを前へ動かす', 'set', [], {icon: 'setprev', kw: 'せっと ならびかえ まえへ move set', run: () => { $('upset').click(); }});
def('set-move-next', '今のセットを後ろへ動かす', 'set', [], {icon: 'setnext', kw: 'せっと ならびかえ うしろへ move set', run: () => { $('downset').click(); }});
// 表示
def('fit', '全体を表示', 'view', ['0', 'Shift+F'], {icon: 'fit', kw: 'ぜんたい ひょうじ ふぃっと fit view ずーむ りせっと', always: true, need: null, run: () => { $('zfit').click(); }});
def('zoom-in', '拡大表示', 'view', [], {icon: 'zoomin', kw: 'かくだい ずーむ zoom in', always: true, need: null, run: () => { $('zin').click(); }});
def('zoom-out', '縮小表示', 'view', [], {icon: 'zoomout', kw: 'しゅくしょう ずーむ zoom out', always: true, need: null, run: () => { $('zout').click(); }});
def('toggle-names', '名前の表示を切り替える', 'view', [], {icon: 'eye', kw: 'なまえ ひょうじ names label しめい', run: () => { $('shownames').click(); }});
def('toggle-prev', '前のセットの表示を切り替える', 'view', [], {icon: 'eye', kw: 'まえのせっと ひょうじ ごーすと previous ghost', run: () => { $('showprev').click(); }});
// パネル
for (const [id, nm, pane, kw] of [['tab-set', '「隊形」タブ', 'pset', 'たいけい かたち formation'], ['tab-sec', '「セクション」タブ', 'psec', 'せくしょん めんばー ぱーと にんずう section member'], ['tab-show', '「ショー」タブ', 'pshow', 'しょー かいじょう てんぽ show tempo venue'], ['tab-score', '「楽譜」タブ', 'pscore', 'がくふ ぱーと score part'], ['tab-warn', '「チェック」タブ', 'pwarn', 'ちぇっく けいこく しょうとつ check warning'], ['tab-code', '「コード」タブ', 'pcode', 'こーど code ソース source']])
  def(id, nm + 'を開く', 'pane', [], {icon: 'tab', kw: kw + ' たぶ tab ひらく', always: true, need: null, run: () => { showTab(pane); }});
def('autofix', 'ぶつかりを自動で直す', 'pane', [], {icon: 'wand', kw: 'じどう なおす しゅうせい しょうとつ ぶつかり fix auto autofix', run: () => { autoFix(); }});

// ================= キーの割り当て（既定 + 保存した変更） =================
const DEFAULTS = Object.fromEntries(ACTIONS.map(a => [a.id, a.keys.slice()]));
let KM = {}, INDEX = new Map();
function loadKeymap() {
  let saved = null;
  try { saved = JSON.parse(lsGet(KM_KEY) || 'null'); } catch (e) { saved = null; }
  KM = SC.mergeKeymap(DEFAULTS, saved);
  for (const a of ACTIONS) if (a.fixed) KM[a.id] = DEFAULTS[a.id].slice(); // 固定のキーは変えられない
  rebuildIndex();
}
function rebuildIndex() {
  INDEX = new Map();
  for (const a of ACTIONS) for (const k of KM[a.id]) { const c = SC.normCombo(k); if (!INDEX.has(c)) INDEX.set(c, a.id); }
}
function saveKeymap() { lsSet(KM_KEY, JSON.stringify(SC.diffKeymap(DEFAULTS, KM))); }
const labelOf = id => (KM[id] && KM[id][0]) ? SC.comboLabel(KM[id][0], MAC) : '';
const labelsOf = id => (KM[id] || []).map(k => SC.comboLabel(k, MAC));
window.scKeyLabel = id => labelOf(id);
window.scKeyCap = id => { const k = (KM[id] || [])[0]; if (!k) return ''; const c = SC.comboCaps(k, MAC); return c[c.length - 1]; };
const capsHtml = (combo, cls) => `<span class="kcs${cls ? ' ' + cls : ''}">${SC.comboCaps(combo, MAC).map(c => `<kbd class="kc">${esc2(c)}</kbd>`).join(MAC ? '' : '<i>+</i>')}</span>`;
const keysHtml = id => (KM[id] || []).length ? KM[id].map(k => capsHtml(k)).join('<i class="or">/</i>') : '<span class="nokey">未設定</span>';
const tip = (base, id) => { const l = labelsOf(id); return l.length ? `${base} (${l.join(' / ')})` : base; };
window.scTip = tip;

// ================= キーが押されたとき =================
function execute(a, e, combo) {
  if (a.skip && a.skip()) return false;
  if (a.need) {
    if (!ready()) return false;
    if (a.need === 'sel' && !sel.size) { scToast(a.why || NEED_MSG.sel, {kind: 'info', sub: /^(delete|cut|add-member|duplicate)/.test(a.id) ? 'クリック・範囲ドラッグ・Tab・1〜9 で選べます' : ''}); return true; }
    if (a.need === 'sel2' && sel.size < 2) { scToast(NEED_MSG.sel2, {kind: 'info'}); return true; }
  }
  const r = a.run(e, combo);
  return r !== false;
}
function overlayOpen() { return !!(palEl && palEl.style.display === 'flex') || !!(sheetEl && sheetEl.style.display === 'flex'); }
window.scKey = function (e) {
  if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
  if (SC.isModifierKey(e)) return;
  if (overlayOpen()) return;
  if (document.querySelector('dialog[open]')) return;
  const combo = SC.evCombo(e), id = INDEX.get(combo);
  if (!id) return;
  const a = BYID[id], typing = isTyping();
  if (typing && !a.typing) return; // 入力中は、Esc・保存・コマンド検索のほかは何もしない
  if (!a.always && !R) return;
  if (e.repeat && !a.repeat) { if (!typing) e.preventDefault(); return; }
  if (busy() && !/^(escape|undo|redo|save|palette|shortcuts)$/.test(id) && !a.always) return;
  if (execute(a, e, combo)) { e.preventDefault(); e.stopPropagation(); }
};
window.scRun = (id, e) => { const a = BYID[id]; if (a) { rememberRecent(id); execute(a, e || {}, (KM[id] || [])[0] || ''); } };

// ================= ツールチップ・メニュー =================
const TIPS = [
  ['#undo', '元に戻す', 'undo'], ['#redo', 'やり直す', 'redo'], ['#save', '保存', 'save'],
  ['#tlplay', 'ショー全体を再生', 'play'], ['#dupset', '今のセットを複製（新しいセットのコピー）', 'dup-set'], ['#addset', '今のセットの後ろに追加（全員その場）', 'add-set'],
  ['#zfit', '全体を表示', 'fit'], ['#zin', '拡大', 'zoom-in'], ['#zout', '縮小', 'zoom-out'], ['#selclear', '選択を解除', 'escape'],
  ['#seldel', '選んだ人を削除（その場から抜く。Shift で詰める）', 'delete'], ['#seldup', '選んだ人を複製（隣に同じ人数を追加）', 'duplicate'], ['#seladd', '選んだ人と同じパートに1人追加', 'add-member'],
  ['#flipx', '選んだ人を左右に反転（上手と下手を入れ替え）', 'flip-h'], ['#flipy', '選んだ人を前後に反転（客席側と奥を入れ替え）', 'flip-v'],
  ['#scbtn', 'ショートカット一覧', 'shortcuts'], ['#scpalbtn', 'コマンド検索', 'palette']
];
function decorate() {
  for (const [sel_, base, id] of TIPS) { const el = document.querySelector(sel_); if (el) el.title = tip(base, id); }
    try { renderTools(); } catch (e) { /* 起動前 */ }
  const pb = $('scpalbtn'); if (pb) pb.innerHTML = icon('search', 16) + '<span>検索</span>';
  const kb = $('scbtn'); if (kb) kb.innerHTML = icon('kbd', 17);
}
window.scCtxItems = function () {
  const it = (id, name, danger) => `<button class="mi${danger ? ' dg' : ''}" data-sc="${id}">${icon(BYID[id].icon, 15)}<span>${esc2(name)}</span><span class="ks">${esc2(labelOf(id))}</span></button>`;
  return `<div class="ms"></div>${it('add-member', '同じパートに1人追加')}${it('duplicate', '複製')}${it('copy', '位置をコピー')}${clip ? it('paste', '位置を貼り付け') : ''}<div class="ms"></div>${it('delete', '削除（その場から抜く）', true)}${it('delete-reflow', '削除して詰める', true)}`;
};

// ================= 選んだ人のそばの小さなツールバー =================
let floatEl = null, floatRaf = 0;
function buildFloat() {
  floatEl = document.createElement('div');
  floatEl.id = 'scfloat'; floatEl.setAttribute('role', 'toolbar'); floatEl.setAttribute('aria-label', '選んだ人への操作');
  floatEl.innerHTML = [['add-member', 'adduser', '追加'], ['duplicate', 'dup', '複製'], ['rotate-cw', 'rotcw', ''], ['flip-h', 'fliph', ''], ['arrange', 'arrange', '整列'], ['delete', 'trash', '削除']]
    .map(([id, ic, t]) => `<button type="button" data-fl="${id}" class="${id === 'delete' ? 'dg' : ''}">${icon(ic, 16)}${t ? `<span>${t}</span>` : ''}</button>`).join('');
  floatEl.addEventListener('pointerdown', e => e.stopPropagation());
  floatEl.addEventListener('click', e => {
    const b = e.target.closest('[data-fl]'); if (!b) return;
    const id = b.dataset.fl;
    if (id === 'arrange') { const r = b.getBoundingClientRect(); openCtx({clientX: r.left, clientY: r.bottom + 4}, {type: 'sel'}); ctxView = 'arr'; renderCtx(); return; }
    scRun(id, {shiftKey: e.shiftKey});
  });
  $('canvaswrap').appendChild(floatEl);
}
function floatTips() {
  if (!floatEl) return;
  const base = {'add-member': '同じパートに1人追加', duplicate: '複製', 'rotate-cw': '右に15°回す（Shift+R で左）', 'flip-h': '左右に反転', delete: '削除（その場から抜く。Shift+Delete で詰める）', arrange: '整列（直線・弧・円など）'};
  floatEl.querySelectorAll('[data-fl]').forEach(b => { const id = b.dataset.fl; b.title = id === 'arrange' ? base[id] : tip(base[id], id); });
}
function placeFloat() {
  floatRaf = 0;
  if (!floatEl) return;
  const wrap = $('canvaswrap'), show = sel.size > 0 && R && !isMobileW() && tool === 'select' && playT === null && !playing && !pdrag && !gdrag && !dragging && !band && !draw && dotEls.length && wrap;
  if (!show) { floatEl.style.display = 'none'; return; }
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const i of sel) { const el = dotEls[i]; if (!el) continue; const q = el.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
  if (!isFinite(l)) { floatEl.style.display = 'none'; return; }
  floatEl.style.display = 'flex';
  floatEl.querySelector('[data-fl="flip-h"]').disabled = sel.size < 2;
  floatEl.querySelector('[data-fl="arrange"]').disabled = sel.size < 2;
  const W = wrap.getBoundingClientRect(), w = floatEl.offsetWidth, h = floatEl.offsetHeight, gap = 14;
  // ほかの人（選んでいない丸）をなるべく隠さない場所に置く。上・下・左・右の順に試す
  const others = [];
  dotEls.forEach((el, i) => { if (el && !sel.has(i)) { const q = el.getBoundingClientRect(); others.push([q.left + q.width / 2 - W.left, q.top + q.height / 2 - W.top, q.width / 2]); } });
  const cx = (l + r) / 2 - W.left, cy = (t + b) / 2 - W.top;
  const cands = [[cx - w / 2, t - h - gap - W.top, 'top'], [cx - w / 2, b + gap - W.top, 'bottom'], [l - w - gap - W.left, cy - h / 2, 'left'], [r + gap - W.left, cy - h / 2, 'right']];
  let best = null;
  for (const [x0, y0, side] of cands) {
    const x = Math.max(56, Math.min(W.width - w - 8, x0)), y = Math.max(6, Math.min(W.height - h - 6, y0));
    const hit = others.filter(([ox, oy, or]) => ox + or > x && ox - or < x + w && oy + or > y && oy - or < y + h).length;
    const clipped = Math.abs(x - x0) + Math.abs(y - y0) > 24 ? 1 : 0;
    const score = hit * 10 + clipped * 5;
    if (!best || score < best.score) best = {x, y, score, side};
    if (score === 0) break;
  }
  floatEl.style.left = best.x + 'px'; floatEl.style.top = best.y + 'px'; floatEl.dataset.side = best.side;
}
const scheduleFloat = () => { if (!floatRaf) floatRaf = requestAnimationFrame(placeFloat); };

// ================= 「セクション」タブ: メンバーの一覧 =================
function enhanceSecPane() {
  const pane = $('psec');
  if (!pane || !M || !R) return;
  const D = R.data;
  if (D.sections.length !== M.sections.length) return;
  const old = pane.querySelector('#scmem'); if (old) old.remove();
  const box = document.createElement('div'); box.id = 'scmem';
  const secBlocks = M.sections.map((s, si) => {
    const mem = D.performers.map((p, i) => p.sec === si ? i : -1).filter(i => i >= 0);
    const chips = mem.map(i => { const p = D.performers[i], num = p.id.slice(D.sections[si].id.length); return `<span class="scchip${sel.has(i) ? ' on' : ''}" data-i="${i}" style="--c:${esc2(D.sections[si].color)}"><button type="button" class="n" data-act="pick" title="${esc2(p.id)} を選ぶ（Shift で追加）">${esc2(num)}</button><button type="button" class="x" data-act="rm" title="${esc2(p.id)} を抜く（Shift で詰める）" aria-label="${esc2(p.id)} を抜く">×</button></span>`; }).join('');
    return `<div class="scsec" data-si="${si}"><div class="scsec-h"><span class="dot" style="background:${esc2(D.sections[si].color)}"></span><b>${esc2(s.label)}</b><span class="cnt">${mem.length}人</span><span class="sp"></span>
      <button type="button" data-act="dec" title="最後の1人を抜く（他の人は動きません）" ${mem.length < 2 && D.sections.length < 2 ? 'disabled' : ''}>− 1人</button><button type="button" data-act="inc" title="最後の人の隣に1人増やす（他の人は動きません）">＋ 1人</button><button type="button" data-act="delsec" class="ghost dg" title="このセクションを削除">${icon('trash', 14)}</button></div>
      <div class="scchips">${chips}</div></div>`;
  }).join('');
  box.innerHTML = `<div class="scmem-h"><b>メンバー</b><span class="hint">番号をクリックで選択・×で抜く。抜いても他の人の位置は変わりません。</span></div>
    <label class="scchk"><input type="checkbox" id="screflow" ${reflowPref() ? 'checked' : ''}> 抜けた分を詰める（隊形を作り直す）</label>${secBlocks}`;
  const tbl = pane.querySelector('table.t'); (tbl ? tbl.parentNode : pane).insertBefore(box, tbl ? tbl.nextSibling : null);
  $('screflow').onchange = e => lsSet(REFLOW_KEY, e.target.checked ? '1' : '0');
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const blk = b.closest('.scsec'), si = +blk.dataset.si, chip = b.closest('.scchip'), act = b.dataset.act;
    const mode = e.shiftKey !== reflowPref() ? 'reflow' : 'keep';
    const mem = D.performers.map((p, i) => p.sec === si ? i : -1).filter(i => i >= 0);
    if (act === 'pick') { const i = +chip.dataset.i; if (e.shiftKey || e.ctrlKey || e.metaKey) sel.has(i) ? sel.delete(i) : sel.add(i); else sel = new Set([i]); updateSel(); drawCanvas(); }
    else if (act === 'rm') removeMembers([D.performers[+chip.dataset.i].id], mode);
    else if (act === 'dec') { if (mem.length < 2) { removeSection(si); return; } removeMembers([D.performers[mem[mem.length - 1]].id], mode); }
    else if (act === 'inc') addNear(D.performers[mem[mem.length - 1]].id);
    else if (act === 'delsec') removeSection(si);
  });
  // 人数の ＋/－ と、人数の入力欄も、同じ処理にする（最後の人を抜く／隣に足す。ほかの人は動かない）
  if (!pane._scBound) {
    pane._scBound = true;
    pane.addEventListener('input', e => { if (e.target.matches && e.target.matches('input[data-key="n"]')) e.stopImmediatePropagation(); }, true);
    pane.addEventListener('change', e => { if (e.target.matches && e.target.matches('input[data-key="n"]')) { e.stopImmediatePropagation(); setSectionCount(+e.target.dataset.path.slice(3), e.target.value); } }, true);
  }
  $$('.nstep button', pane).forEach(b => {
    const inp = b.parentNode.querySelector('input[data-key="n"]'), d = /−|-/.test(b.textContent) ? -1 : 1;
    b.onclick = ev => { ev.preventDefault(); ev.stopImmediatePropagation(); const si = +inp.dataset.path.slice(3); setSectionCount(si, R.data.performers.filter(p => p.sec === si).length + d, ev.shiftKey); };
  });
  // 表の ✕（セクション削除）も、同じ処理にする
  $$('[data-delsec]', pane).forEach(b => { b.onclick = ev => { ev.preventDefault(); ev.stopImmediatePropagation(); removeSection(+b.dataset.delsec); }; });
}
// セクションの人数を決めた数にする。減らすときは最後の人から抜き、増やすときは最後の人の隣に足す
async function setSectionCount(si, want, shift) {
  if (!ready()) return;
  const D = R.data, mem = D.performers.filter(p => p.sec === si), n = Math.round(Number(want));
  if (!(n >= 1) || !Number.isFinite(n)) { enhanceSecPane(); const i = $('psec').querySelector(`input[data-path="sec${si}"][data-key="n"]`); if (i) i.value = mem.length; return; }
  if (n === mem.length) return;
  if (n < mem.length) await removeMembers(mem.slice(n).map(p => p.id), shift !== reflowPref() ? 'reflow' : 'keep');
  else await addNear(mem[mem.length - 1].id, n - mem.length);
}
async function addNear(id, count) {
  count = count || 1;
  await guarded(async () => {
    const res = await SC.addMembers(M, Array(count).fill(id), coreOpts('keep'));
    if (!res.ok) { notice(res.error); return; }
    await commit(res.model);
    const idx = res.newIds.map(x => R.data.performers.findIndex(p => p.id === x)).filter(i => i >= 0); sel = new Set(idx); updateSel(); drawCanvas();
    scToast(count === 1 ? `${res.newIds[0]} を追加しました` : `${count}人を追加しました`, {undo: true, sub: 'ほかの人の位置はそのままです', icon: 'adduser'});
  });
}
async function removeSection(si) {
  if (!ready()) return;
  const D = R.data, s = D.sections[si], ids = D.performers.filter(p => p.sec === si).map(p => p.id);
  if (ids.length >= D.performers.length) { notice('最後のセクションは削除できません。'); return; }
  if (SC.sectionHasData(M, s.id, D) && !(await ask(`セクション「${s.label}」には楽譜や個別の指定があります。削除しますか？（元に戻せます）`, '削除する'))) return;
  await removeMembers(ids, reflowPref() ? 'reflow' : 'keep');
}

// ================= コマンドパレット =================
let palEl = null, palItems = [], palSel = 0, palPrev = null;
const recent = () => { try { return JSON.parse(lsGet(RECENT_KEY) || '[]').filter(id => BYID[id]); } catch (e) { return []; } };
function rememberRecent(id) { if (id === 'palette') return; lsSet(RECENT_KEY, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, 6))); }
function enabledOf(a) {
  if (!a.need) return true;
  if (!ready()) return false;
  if (a.need === 'sel') return sel.size > 0;
  if (a.need === 'sel2') return sel.size >= 2;
  return true;
}
function buildPalette() {
  palEl = document.createElement('div');
  palEl.id = 'scpal'; palEl.style.display = 'none';
  palEl.innerHTML = `<div class="scp-box" role="dialog" aria-modal="true" aria-label="コマンド検索"><div class="scp-in">${icon('search', 20)}<input id="scpin" type="text" autocomplete="off" spellcheck="false" placeholder="やりたいことを入力（例: さくじょ / sakujo / 回転 / 保存）" aria-label="コマンドを検索"><kbd class="kc kc-s">Esc</kbd></div><div class="scp-list" id="scplist" role="listbox"></div><div class="scp-foot"><span><kbd class="kc kc-s">↑</kbd><kbd class="kc kc-s">↓</kbd> えらぶ</span><span><kbd class="kc kc-s">Enter</kbd> 実行</span><span class="sp"></span><span>${icon('kbd', 14)} <kbd class="kc kc-s">?</kbd> ショートカット一覧</span></div></div>`;
  document.body.appendChild(palEl);
  palEl.addEventListener('mousedown', e => { if (e.target === palEl) closePalette(true); });
  const inp = palEl.querySelector('#scpin');
  inp.addEventListener('input', () => renderPalette(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return; // 変換中の Enter / 矢印は触らない
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); closePalette(true); }
    else if (e.key === 'Tab') { e.preventDefault(); movePal(e.shiftKey ? -1 : 1); }
  });
  palEl.querySelector('#scplist').addEventListener('click', e => { const r = e.target.closest('[data-pi]'); if (r) runPal(+r.dataset.pi); });
  palEl.querySelector('#scplist').addEventListener('mousemove', e => { const r = e.target.closest('[data-pi]'); if (r && +r.dataset.pi !== palSel) { palSel = +r.dataset.pi; markPal(false); } });
}
function renderPalette(q) {
  const list = palEl.querySelector('#scplist');
  q = (q || '').trim();
  let rows = [];
  if (!q) {
    const rec = recent().map(id => BYID[id]);
    const sug = ['delete', 'add-member', 'duplicate', 'undo', 'play', 'shortcuts'].map(id => BYID[id]).filter(a => !rec.includes(a));
    rows = [{h: rec.length ? '最近使った操作' : 'よく使う操作'}].concat((rec.length ? rec : sug).map(a => ({a})));
    if (rec.length) rows.push({h: 'おすすめ'}, ...sug.map(a => ({a})));
  } else {
    rows = ACTIONS.filter(a => !a.noPal).map(a => ({a, s: SC.fuzzyScore(q, {name: a.name, kw: a.kw, group: GNAME[a.group]})})).filter(x => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 40);
    if (!rows.length) rows = [{none: true}];
  }
  palItems = [];
  list.innerHTML = rows.map(r => {
    if (r.h) return `<div class="scp-h">${r.h}</div>`;
    if (r.none) return `<div class="scp-none">${icon('search', 28)}<b>見つかりませんでした</b><span>「削除」「回転」「保存」「セット」など、短い言葉で試してください。</span></div>`;
    const a = r.a, i = palItems.push(a) - 1, en = enabledOf(a);
    return `<div class="scp-i${en ? '' : ' off'}" role="option" data-pi="${i}" data-id="${a.id}">${icon(a.icon, 19)}<span class="nm">${esc2(a.name)}${en ? '' : `<small>${esc2(a.need === 'sel2' ? '2人以上選ぶと使えます' : a.need === 'sel' ? '人を選ぶと使えます' : 'いまは使えません')}</small>`}</span><span class="gp">${esc2(GNAME[a.group])}</span><span class="ky">${(KM[a.id] || []).slice(0, 2).map(k => capsHtml(k)).join('<i class="or">/</i>')}</span></div>`;
  }).join('');
  palSel = 0; markPal(true);
}
function markPal(scroll) {
  palEl.querySelectorAll('.scp-i').forEach(r => { const on = +r.dataset.pi === palSel; r.classList.toggle('on', on); r.setAttribute('aria-selected', on); if (on && scroll !== false) r.scrollIntoView({block: 'nearest'}); });
}
function movePal(d) { if (!palItems.length) return; palSel = (palSel + d + palItems.length) % palItems.length; markPal(true); }
function runPal(i) {
  const a = palItems[i]; if (!a) return;
  closePalette(false);
  setTimeout(() => { rememberRecent(a.id); execute(a, {}, (KM[a.id] || [])[0] || ''); }, 0);
}
function openPalette() {
  if (document.querySelector('dialog[open]')) return;
  closeSheet();
  if (!palEl) buildPalette();
  palPrev = document.activeElement;
  palEl.style.display = 'flex';
  const inp = palEl.querySelector('#scpin'); inp.value = '';
  renderPalette('');
  setTimeout(() => inp.focus(), 0);
}
function closePalette(restore) {
  if (!palEl || palEl.style.display === 'none') return;
  palEl.style.display = 'none';
  if (restore && palPrev && palPrev.focus && document.body.contains(palPrev)) try { palPrev.focus(); } catch (e) { /* 消えていた */ }
  if (!restore && document.activeElement && document.activeElement.id === 'scpin') document.activeElement.blur();
}
function togglePalette() { if (palEl && palEl.style.display === 'flex') closePalette(true); else openPalette(); }
window.scOpenPalette = openPalette;

// ================= ショートカット一覧（キーの変更もここで） =================
let sheetEl = null, capture = null, sheetQuery = '', pendingConf = null, showUnbound = false;
function buildSheet() {
  sheetEl = document.createElement('div');
  sheetEl.id = 'scsheet'; sheetEl.style.display = 'none';
  sheetEl.innerHTML = `<div class="scs-box" role="dialog" aria-modal="true" aria-label="キーボードショートカット"><div class="scs-head">${icon('kbd', 26)}<div><h2>キーボードショートカット</h2><p>キーの部分をクリックすると、好きなキーに変えられます。変更はこのブラウザに保存されます。</p></div><span class="sp"></span><div class="scs-search">${icon('search', 16)}<input id="scsin" type="text" autocomplete="off" spellcheck="false" placeholder="操作を探す（例: 削除）" aria-label="ショートカットを検索"></div><button type="button" class="ghost x" data-close aria-label="閉じる">✕</button></div><div class="scs-conf" id="scsconf" hidden></div><div class="scs-body" id="scsbody" tabindex="-1"></div><div class="scs-foot"><span class="scs-mac">${MAC ? '⌘ = Command　⌥ = Option　⇧ = Shift' : ''}</span><label class="scs-un"><input type="checkbox" id="scsunb"> キー未設定の操作も表示（コマンド検索 Ctrl+K では、すべて使えます）</label><span class="sp"></span><button type="button" id="scsreset">すべて初期設定に戻す</button><button type="button" class="pri" data-close>閉じる</button></div></div>`;
  document.body.appendChild(sheetEl);
  sheetEl.addEventListener('mousedown', e => { if (e.target === sheetEl) closeSheet(); });
  sheetEl.addEventListener('click', onSheetClick);
  sheetEl.querySelector('#scsin').addEventListener('input', e => { sheetQuery = e.target.value; renderSheet(); });
  sheetEl.querySelector('#scsunb').addEventListener('change', e => { showUnbound = e.target.checked; renderSheet(); });
  sheetEl.addEventListener('keydown', e => {
    if (capture || e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (sheetQuery && document.activeElement.id === 'scsin') { sheetQuery = ''; e.target.value = ''; renderSheet(); } else closeSheet(); }
    else if (e.key === '?' && !isTyping()) { e.preventDefault(); closeSheet(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); closeSheet(); openPalette(); }
  });
}
function renderSheet() {
  const body = sheetEl.querySelector('#scsbody'), q = sheetQuery.trim();
  const dup = duplicates();
  const rows = GROUPS.map(([g, gn]) => {
    let list = ACTIONS.filter(a => a.group === g && !(a.merge && !/-1$/.test(a.id)) && (q || showUnbound || KM[a.id].length || isCustom(a) || (capture && capture.id === a.id)));
    if (q) list = list.filter(a => SC.fuzzyScore(q, {name: a.name, kw: a.kw, group: gn}) > 0);
    if (!list.length) return '';
    const items = list.map(a => {
      const merged = a.merge ? '1 〜 9' : null;
      const name = a.merge ? 'セクション1〜9を選ぶ（Shift で追加）' : a.name;
      const custom = isCustom(a);
      let keys;
      if (a.merge) keys = `<span class="kcs"><kbd class="kc">1</kbd><i>〜</i><kbd class="kc">9</kbd></span><i class="or">/</i><span class="kcs"><kbd class="kc">${MAC ? '⇧' : 'Shift'}</kbd>${MAC ? '' : '<i>+</i>'}<kbd class="kc">1</kbd><i>〜</i><kbd class="kc">9</kbd></span>`;
      else {
        keys = KM[a.id].map((k, ki) => {
          const wait = capture && capture.id === a.id && capture.ki === ki;
          const bad = dup.has(SC.normCombo(k));
          return wait ? `<span class="cap-wait">キーを押してください…</span>` : `<span class="kcw${bad ? ' bad' : ''}"><button type="button" class="kbtn" data-a="edit" data-id="${a.id}" data-ki="${ki}" title="クリックして、別のキーに変える">${capsHtml(k)}</button>${a.fixed ? '' : `<button type="button" class="kx" data-a="drop" data-id="${a.id}" data-ki="${ki}" title="このキーを外す" aria-label="このキーを外す">×</button>`}</span>`;
        }).join('<i class="or">/</i>');
        if (capture && capture.id === a.id && capture.ki === 'add') keys += (keys ? '<i class="or">/</i>' : '') + '<span class="cap-wait">キーを押してください…</span>';
        else if (!KM[a.id].length) keys = `<button type="button" class="kbtn empty" data-a="add" data-id="${a.id}">キーを決める</button>`;
        if (!a.fixed && KM[a.id].length && !(capture && capture.id === a.id)) keys += `<button type="button" class="kplus" data-a="add" data-id="${a.id}" title="キーをもう1つ追加" aria-label="キーを追加">＋</button>`;
      }
      return `<div class="scs-r${custom ? ' cus' : ''}" data-id="${a.id}">${icon(a.icon, 17)}<span class="nm">${esc2(name)}${a.fixed && !a.merge ? `<span class="lk" title="このキーは変えられません">${icon('lock', 12)}</span>` : ''}</span><span class="ky">${keys}</span>${custom && !a.fixed ? `<button type="button" class="kreset" data-a="reset" data-id="${a.id}" title="このキーを初期設定に戻す" aria-label="初期設定に戻す">↺</button>` : '<span class="kreset-sp"></span>'}</div>`;
    }).join('');
    return `<section class="scs-g"><h3>${esc2(gn)}</h3>${GNOTE[g] && !q ? `<p class="scs-note">${esc2(GNOTE[g])}</p>` : ''}${items}</section>`;
  }).join('');
  const mouse = (!q || /マウス|クリック|ドラッグ|mouse|click/i.test(q)) ? `<section class="scs-g"><h3>マウス・タッチ</h3>
    <div class="scs-r info">${icon('mouse', 17)}<span class="nm">人を選ぶ／動かす</span><span class="ky">クリック・ドラッグ</span></div>
    <div class="scs-r info">${icon('selall', 17)}<span class="nm">選びなおす・追加する</span><span class="ky"><span class="kcs"><kbd class="kc">${MAC ? '⇧' : 'Shift'}</kbd><i>+</i>クリック</span><i class="or">/</i><span class="kcs"><kbd class="kc">${MAC ? '⌘' : 'Ctrl'}</kbd><i>+</i>クリック</span></span></div>
    <div class="scs-r info">${icon('selall', 17)}<span class="nm">範囲で選ぶ</span><span class="ky">何もない所をドラッグ</span></div>
    <div class="scs-r info">${icon('arrange', 17)}<span class="nm">メニューを開く</span><span class="ky">右クリック／長押し</span></div></section>` : '';
  body.innerHTML = (rows || '') + mouse || '<div class="scp-none"><b>見つかりませんでした</b></div>';
}
const isCustom = a => KM[a.id].map(SC.normCombo).join('|') !== DEFAULTS[a.id].map(SC.normCombo).join('|');
function duplicates() {
  const seen = new Map(), dup = new Set();
  for (const a of ACTIONS) for (const k of KM[a.id]) { const c = SC.normCombo(k); if (seen.has(c) && seen.get(c) !== a.id) dup.add(c); seen.set(c, a.id); }
  return dup;
}
function onSheetClick(e) {
  if (e.target.closest('[data-close]')) { closeSheet(); return; }
  if (e.target.closest('#scsreset')) { KM = SC.mergeKeymap(DEFAULTS, null); for (const a of ACTIONS) KM[a.id] = DEFAULTS[a.id].slice(); saveKeymap(); rebuildIndex(); decorate(); floatTips(); showConf(null); renderSheet(); scToast('ショートカットを初期設定に戻しました', {kind: 'info', icon: 'kbd'}); return; }
  const c = e.target.closest('[data-conf]');
  if (c) { // 競合の解決
    const p = pendingConf; pendingConf = null; showConf(null);
    if (c.dataset.conf === 'swap' && p) { for (const oid of p.others) KM[oid] = KM[oid].filter(k => SC.normCombo(k) !== p.combo); applyKey(p.id, p.ki, p.combo); }
    renderSheet(); return;
  }
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = b.dataset.id, a = BYID[id], act = b.dataset.a;
  if (!a || a.fixed) return;
  if (act === 'edit') startCapture(id, +b.dataset.ki);
  else if (act === 'add') startCapture(id, 'add');
  else if (act === 'drop') { KM[id].splice(+b.dataset.ki, 1); persistKeys(); renderSheet(); }
  else if (act === 'reset') { KM[id] = DEFAULTS[id].slice(); persistKeys(); renderSheet(); }
}
function persistKeys() { saveKeymap(); rebuildIndex(); decorate(); floatTips(); }
function applyKey(id, ki, combo) {
  const list = KM[id];
  if (ki === 'add') { if (!list.map(SC.normCombo).includes(combo)) list.push(combo); } else list[ki] = combo;
  KM[id] = list.filter((k, i) => list.map(SC.normCombo).indexOf(SC.normCombo(k)) === i);
  persistKeys();
}
function showConf(html) { const c = sheetEl.querySelector('#scsconf'); c.hidden = !html; c.innerHTML = html || ''; }
function startCapture(id, ki) {
  stopCapture(); showConf(null); pendingConf = null;
  capture = {id, ki, fn: ev => {
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    if (SC.isModifierKey(ev) || ev.isComposing) return;
    if (ev.key === 'Escape') { stopCapture(); renderSheet(); return; }
    const combo = SC.evCombo(ev), cap = capture; stopCapture();
    const others = ACTIONS.filter(a => a.id !== cap.id && KM[a.id].some(k => SC.normCombo(k) === combo)).map(a => a.id);
    const fixedHit = others.find(o => BYID[o].fixed);
    if (fixedHit) { showConf(`<span>${capsHtml(combo)} は「${esc2(BYID[fixedHit].name)}」で使われていて、変えられません。別のキーを選んでください。</span>`); renderSheet(); return; }
    if (others.length) {
      pendingConf = {id: cap.id, ki: cap.ki, combo, others};
      showConf(`<span>${capsHtml(combo)} は「${others.map(o => esc2(BYID[o].name)).join('」「')}」で使われています。</span><button type="button" data-conf="swap" class="pri">このキーに付け替える</button><button type="button" data-conf="cancel">やめる</button>`);
      renderSheet(); return;
    }
    applyKey(cap.id, cap.ki, combo); renderSheet();
    scToast(`「${BYID[cap.id].name}」を ${labelOf(cap.id)} にしました`, {kind: 'info', icon: 'kbd', ms: 1800});
  }};
  document.addEventListener('keydown', capture.fn, true);
  renderSheet();
}
function stopCapture() { if (capture) { document.removeEventListener('keydown', capture.fn, true); capture = null; } }
function openSheet() {
  if (document.querySelector('dialog[open]')) return;
  closePalette(false);
  if (!sheetEl) buildSheet();
  sheetEl.querySelector('#scsin').value = ''; sheetQuery = '';
  showConf(null); renderSheet();
  sheetEl.style.display = 'flex';
  setTimeout(() => sheetEl.querySelector('#scsin').focus(), 0);
}
function closeSheet() { if (!sheetEl || sheetEl.style.display === 'none') return; stopCapture(); sheetEl.style.display = 'none'; pendingConf = null; if (document.activeElement && sheetEl.contains(document.activeElement)) document.activeElement.blur(); }
window.scOpenSheet = openSheet;

// ================= 「次にやること」に、一度だけ案内を足す =================
window.scNextHint = function (bar) {
  if (lsGet(HINT_KEY) === '1' || !bar || bar.querySelector('.nb-sc')) return;
  const d = document.createElement('div'); d.className = 'nb-sc';
  d.innerHTML = `${icon('kbd', 16)}<span><kbd class="kc kc-s">?</kbd> でショートカット一覧、${capsHtml('Mod+K', 'kcs-s')} でコマンド検索</span>`;
  bar.appendChild(d);
  lsSet(HINT_KEY, '1');
};

// ================= 起動 =================
function wrapFn(name, after) {
  const orig = window[name]; if (typeof orig !== 'function') return;
  window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.error('sc', name, e); } return r; };
}
function init() {
  loadKeymap();
  buildFloat();
  decorate(); floatTips();
  $('scpalbtn').onclick = () => openPalette();
  $('scbtn').onclick = () => openSheet();
  $('seldel').onclick = e => { deleteSelected(e.shiftKey || reflowPref()); };
  $('seldup').onclick = () => addMembers(true);
  $('seladd').onclick = () => addMembers(false);
  wrapFn('renderSecPane', enhanceSecPane);
  wrapFn('updateSel', () => { scheduleFloat(); $$('#scmem .scchip').forEach(c => c.classList.toggle('on', sel.has(+c.dataset.i))); });
  wrapFn('drawCanvas', scheduleFloat);
  wrapFn('stopPlay', scheduleFloat);
  wrapFn('setTool', scheduleFloat);
  svg.addEventListener('pointerdown', () => { if (floatEl) floatEl.style.display = 'none'; }, true);
  document.addEventListener('pointerup', scheduleFloat, true);
  window.addEventListener('resize', scheduleFloat);
  try { new MutationObserver(scheduleFloat).observe(svg, {attributes: true, attributeFilter: ['viewBox']}); } catch (e) { /* 古いブラウザ */ }
  if (R) { try { enhanceSecPane(); } catch (e) { /* まだ */ } }
}
init();
})();
