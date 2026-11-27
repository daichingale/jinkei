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
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6"/>',
  bulk: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/><path d="M8 4v4M14 10v4M11 16v4"/>',
  tap: '<circle cx="12" cy="14" r="7"/><path d="M12 14V10M9.5 3h5M12 3v4"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  counts: '<path d="M3 12h18M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3M12 6v12"/>',
  parade: '<circle cx="5" cy="8" r="1.7"/><circle cx="10" cy="8" r="1.7"/><circle cx="15" cy="8" r="1.7"/><circle cx="5" cy="16" r="1.7"/><circle cx="10" cy="16" r="1.7"/><circle cx="15" cy="16" r="1.7"/><path d="M18 9l3.5 3-3.5 3"/>',
  split: '<path d="M12 3v18" stroke-dasharray="2 2.2"/><rect x="3" y="7" width="6" height="10" rx="1"/><rect x="15" y="7" width="6" height="10" rx="1"/>',
  trimend: '<rect x="3" y="7" width="12" height="10" rx="1"/><path d="M18 5v14M21 9l-3 3 3 3"/>',
  cutafter: '<rect x="3" y="7" width="9" height="10" rx="1"/><path d="M15 7l6 10M21 7l-6 10"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M9 21h6"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4l9 16H3zM12 10v4.5M12 17.5h.01"/>'
};
const icon = (n, s) => `<svg class="sci" width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.gen}</svg>`;
window.scIcon = icon;
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
  if (window.JK_TOAST_MUTE && !o.force) { (window.JK_TOAST_LOG = window.JK_TOAST_LOG || []).push({msg, sub: o.sub || '', kind: o.kind || 'ok'}); return; }   // 日本語の指示を実行している間は、中の操作のトーストを出さず記録だけする（最後に1つだけ出す）
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
  if (o.action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sct-undo sct-act'; b.textContent = o.action.label;
    b.onclick = () => { close(); o.action.run(); };
    t.appendChild(b);
  }
  const ph = document.documentElement.classList.contains('mp');
  if (ph) { while (box.firstChild) box.firstChild.remove(); }   // スマホは常に1つだけ
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  timer = setTimeout(close, o.ms || (ph ? (o.undo || o.action ? 5000 : 3000) : (o.undo || o.action ? 8000 : 2600)));
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
    const sub = [mode === 'reflow' ? '抜けた分を詰めて、隊形を作り直しました' : (res.skipped ? 'その席を空けて、ほかの人は動いていません（「空きを詰める」で隊形を作り直せます）' : (res.pinned ? 'ほかの人の位置はそのままです' : 'ほかの人は動いていません'))];
    if (res.droppedParts.length) sub.push(`楽譜「${res.droppedParts.join('」「')}」は対象がいなくなったので外しました`);
    if (res.droppedSections.length) sub.push(`セクション「${res.droppedSections.join('」「')}」も削除しました`);
    if (!res.exact && mode === 'keep') sub.push('一部の位置がずれた可能性があります（チェックしてください）');
    // 真ん中の人を抜くと、番号が詰まって隊形の割り当てが全員ずれる。そのずれを打ち消す「個別の位置」が増えすぎる場合は、詰める方法を案内する
    const many = mode === 'keep' && res.pinned > 12;
    if (many) sub.push(`位置を保つために、個別の位置を${res.pinned}件つくりました`);
    scToast(nm, {undo: true, sub: sub.join('。'), icon: 'trash', action: many ? {label: '詰めて作り直す', run: async () => { const r0 = R; undo(); for (let i = 0; i < 80 && R === r0; i++) await new Promise(r => setTimeout(r, 50)); await removeMembers(ids, 'reflow'); }} : null});
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
  clip = {set: setLbl(curSet), items: selIdx().map(i => ({id: R.data.performers[i].id, p: pos[i].slice()}))};
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
    scToast(`${t.pairs.length}人の位置を貼り付けました`, {undo: true, sub: t.mode === 'order' ? '選んだ人に、並び順で当てはめました' : `セット ${setLbl(curSet)} に反映しました`, icon: 'paste'});
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
function stepCount(d, byBar) {   // 刻みの単位（拍・小節）で動かす。byBar: 小節ごと
  if (!ready() || R.data.sets.length !== M.sets.length) return;
  stopPlay();
  const lay = tlLayout();
  drawAt(JKX.stepSeek(playheadT(), d, SEEK.unit, seekBar(), lay.total, !!byBar));
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
  if (pp) { ppClose(); return; }
  if (draw || pendingDraw) { cancelDraw(); return; }
  if (tlFocus || setSel.size) { clearSetFocus(); return; }
  if (tool !== 'select') { setTool('select'); return; }
  exitScrub(); sel.clear(); curStmt = -1; updateSel(); markCards(); drawCanvas();
}

// ================= 操作の表 =================
const GROUPS = [['gen', '基本'], ['mem', '人を増やす・減らす'], ['sel', '選ぶ'], ['mov', '動かす・整える'], ['tool', 'ツール'], ['set', 'セット・再生'], ['view', '表示'], ['pane', '画面・パネル']];
const GNOTE = {set: 'タイムラインのセットのブロックをクリックすると、Ctrl+C / X / V / Delete はセットが対象になります（Shift・Ctrl クリックで複数選択、ドラッグで並べ替え、右クリックで分割・カット・左右反転して貼り付け）。人を選んでいるときは、これまでどおり人の位置が対象です。分割は、再生ヘッドの位置（タイムラインをクリック、, . キー）で行います。セットを作った直後（1.5秒以内）に数字キーを打つと、そのセットのカウント数になります（例: Ctrl+Shift+N → 1 → 2 で 12 カウント）。タイムラインでは、右端をドラッグ（Shift: 0.5刻み）・ダブルクリックで数字入力・Alt+ホイールでも変えられます。', mov: '矢印キー: Shift で5倍、Alt で細かく動かせます。何も選んでいないときは、← → でセットを送ります。', mem: 'Delete は「その場から抜く」（ほかの人は動きません）。Shift+Delete は抜けた分を詰めて隊形を作り直します。'};
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
def('delete', '削除（その場から抜く）', 'mem', ['Delete', 'Backspace'], {icon: 'trash', kw: 'さくじょ けす のぞく ぬく delete remove del めんばー ひと じょがい', need: 'sel', alt: () => setFocusOn(), run: () => { if (setFocusOn()) return deleteSetsOp(); deleteSelected(false); }});
def('delete-reflow', '削除して詰める（隊形を作り直す）', 'mem', ['Shift+Delete', 'Shift+Backspace'], {icon: 'trash2', kw: 'さくじょ つめる けす delete reflow つめて さいこうせい かたをつめる', need: 'sel', run: () => { deleteSelected(true); }});
// 空きを詰める: 削除で空けた席（skip）を外して、いる人だけで隊形を作り直す（位置が動く）
async function closeGaps(all) {
  if (!ready()) { scToast('エラーを直してから操作してください', {kind: 'info'}); return; }
  await guarded(async () => {
    const mems = k => (R.members && R.members[k]) || [];
    const res = SC.closeSkips(M, (k, si) => (all || k === curSet) && (all || !sel.size || (mems(k)[si] || []).some(i => sel.has(i))));
    if (!res.closed) { scToast('空きはありません', {kind: 'info', sub: all ? 'どのセットにも空きがありません' : 'このセットには空き（抜けた人の席）がありません。「全セット」でも探せます'}); return; }
    await commit(res.model);
    updateSel(); drawCanvas();
    scToast(`空き${res.closed}席を詰めました`, {undo: true, sub: '隊形を、いる人だけで作り直しました（位置が動きます）', icon: 'trash2'});
  });
}
def('close-gaps', '空きを詰める（このセット。隊形を作り直す）', 'mem', [], {icon: 'trash2', kw: 'あき つめる すきま 空き 詰める skip gap close さいこうせい', run: () => { closeGaps(false); }});
def('close-gaps-all', '空きを詰める（全セット）', 'mem', [], {icon: 'trash2', kw: 'あき つめる すきま 空き 全セット skip gap close all', run: () => { closeGaps(true); }});
def('add-member', '同じパートに1人追加', 'mem', ['n'], {icon: 'adduser', kw: 'ついか ふやす ひとり あたらしい add new member ふやす にんずう', need: 'sel', run: () => { addMembers(false); }});
def('duplicate', '選んだ人を複製', 'mem', ['Mod+D'], {icon: 'dup', kw: 'ふくせい こぴー おなじ duplicate clone ふやす', need: 'sel', run: () => { addMembers(true); }});
def('copy', 'コピー（人の位置／タイムラインで選んだセット）', 'mem', ['Mod+C'], {icon: 'dup', kw: 'こぴー ぴー copy いち せっと', need: 'sel', alt: () => setFocusOn(), skip: hasTextSel, run: () => { if (setFocusOn()) return copySets(); return copySel(); }});
def('cut', '切り取り（人／選んだセット。コピーして削除）', 'mem', ['Mod+X'], {icon: 'cut', kw: 'きりとり かっと cut せっと', need: 'sel', alt: () => setFocusOn(), skip: hasTextSel, run: () => { if (setFocusOn()) return cutSetsOp(); cutSel(); }});
def('paste', '貼り付け（人の位置／セット）', 'mem', ['Mod+V'], {icon: 'paste', kw: 'はりつけ ぺーすと paste いち せっと', need: 'show', skip: hasTextSel, run: () => pasteSmart()});
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
def('step-back', '1つ戻る（拍／小節）', 'set', [','], {icon: 'stepb', kw: 'かうんと もどる step back たいむらいん 1かうんと はく しょうせつ', repeat: true, run: () => { stepCount(-1); }});
def('step-fwd', '1つ進む（拍／小節）', 'set', ['.'], {icon: 'stepf', kw: 'かうんと すすむ step forward たいむらいん 1かうんと はく しょうせつ', repeat: true, run: () => { stepCount(1); }});
def('bar-back', '1小節戻る（Shift+,）', 'set', ['<'], {icon: 'stepb', kw: 'しょうせつ もどる bar back たいむらいん', repeat: true, run: () => { stepCount(-1, true); }});
def('bar-fwd', '1小節進む（Shift+.）', 'set', ['>'], {icon: 'stepf', kw: 'しょうせつ すすむ bar forward たいむらいん', repeat: true, run: () => { stepCount(1, true); }});
def('dup-set', '新しいセット（直前の長さ・今の隊形のコピー）', 'set', ['Mod+Shift+N'], {icon: 'newset', kw: 'あたらしい せっと ふくせい copy new set つくる ついか かうんと', run: () => { qsNewSet(); }});
def('add-set', '新しいセット（全員その場）', 'set', [], {icon: 'newset', kw: 'あたらしい せっと ついか add new set からの そのば', run: () => { qsNewSet(null, 'hold'); }});
def('sets-bulk', 'セットをまとめて作る…', 'set', ['Shift+N'], {icon: 'bulk', kw: 'まとめて せっと いっぱい 一括 いっかつ bulk many sets 8 8 16 かうんと しょうせつ', need: 'show', run: () => { openBulk('counts'); }});
def('sets-song', '曲に合わせてセットを区切る…', 'set', [], {icon: 'music', kw: 'きょく あわせる しょうせつ しょうせつせん りはーさる ばんごう song bar rehearsal がくふ ぱーと くぎる', need: 'show', run: () => { openBulk('song'); }});
def('tap-split', 'タップでセットを区切る…', 'set', [], {icon: 'tap', kw: 'たっぷ たっぷして くぎる せっと tap split さいせい えすきー めとろのーむ', need: 'show', run: () => { openTap(); }});
def('tap-mark', 'タップ画面で「ここで区切る」', 'set', ['s'], {icon: 'tap', kw: 'たっぷ くぎる tap mark', need: null, noPal: true, run: () => { if (typeof tap !== 'undefined' && tap && tap.running) { tap.mark(); return; } return false; }});
def('set-counts', '今のセットのカウント数を数字で決める', 'set', ['F2'], {icon: 'counts', kw: 'かうんと ながさ すうじ にゅうりょく counts length edit ほーるど てんぽ', need: 'show', run: () => { qsEditSet(curSet, document.querySelector('#tltrack .tlb.cur')); }});
def('set-longer', '今のセットを長くする（Shift で 0.5）', 'set', ['Mod+ArrowRight', 'Mod+Shift+ArrowRight'], {icon: 'right', kw: 'ながく かうんと ふやす longer counts +', need: 'show', repeat: true, noPal: true, run: (e, combo) => { qsBump(curSet, curSet === 0 ? 'h' : 'c', /Shift/.test(combo || '') ? 0.5 : 1, /Shift/.test(combo || '')); }});
def('set-shorter', '今のセットを短くする（Shift で 0.5）', 'set', ['Mod+ArrowLeft', 'Mod+Shift+ArrowLeft'], {icon: 'left', kw: 'みじかく かうんと へらす shorter counts -', need: 'show', repeat: true, noPal: true, run: (e, combo) => { qsBump(curSet, curSet === 0 ? 'h' : 'c', /Shift/.test(combo || '') ? -0.5 : -1, /Shift/.test(combo || '')); }});
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
def('parade', 'パレードを作る…（行進の隊列移動を自動で）', 'set', [], {icon: 'parade', kw: 'ぱれーど parade ぎょうしん こうしん みちじゅん ぱれーどをつくる', need: 'show', if: () => hasParade(), run: () => { if (hasParade()) window.jkOpenParade(); }});
def('autofix', 'ぶつかりを自動で直す', 'pane', [], {icon: 'wand', kw: 'じどう なおす しゅうせい しょうとつ ぶつかり fix auto autofix', run: () => { autoFix(); }});

// ================= セットの分割・カット・コピー・貼り付け・並べ替え =================
// タイムラインのセットのブロックをクリックすると「セットが対象」になり、Ctrl+C / X / V / Delete はセットに効く。
// フィールドで人を選んでいるときは、これまでどおり人の位置が対象。
const SETCLIP_KEY = 'jk_setclip_v1', SETCLIP_TAG = '# jinkei-sets ';
let setClip = null;
const setFocusOn = () => tlFocus && setSel.size > 0 && !!M;
const setKs = () => [...setSel].filter(k => M.sets[k]).sort((a, b) => a - b);
const setNames = ks => ks.map(k => setLbl(k)).join('・');
// 再生ヘッド → (セット番号, セット内のカウント)
function playPoint() {
  const D = R.data, t = playheadT(), k = jkSetAt(D, t);
  return {k, c: SC.qsRound(t - D.sets[k].start), t, scrubbed: playT !== null};
}
function canSplitAt(pt) {
  if (!pt || !R || !M.sets[pt.k]) return false;
  const S = R.data.sets[pt.k]; if (!S) return false;
  if (pt.k === 0) return pt.c > 0 && pt.c < S.hold - 1e-9 + 0;
  return pt.c > 0 && (pt.c < S.counts - 1e-9 || pt.c < S.counts + S.hold - 1e-9 && pt.c > S.counts + 1e-9);
}
async function splitOp(mode, pt, sub) {
  if (!ready()) { scToast('エラーを直してから操作してください', {kind: 'info'}); return; }
  if (!pt) {
    pt = playPoint();
    if (!pt.scrubbed) { scToast('分けたい位置に、再生ヘッドを置いてください', {kind: 'info', sub: 'タイムラインをクリック、または , . キーで1カウントずつ動かせます。セットを右クリックして、その位置で分けることもできます'}); return; }
  }
  await guarded(async () => {
    const res = await SC.splitSet(M, pt.k, pt.c, Object.assign(coreOpts(mode), {sub: !!sub}));
    if (!res.ok) { scToast(mode === 'split' ? '分けられませんでした' : 'カットできませんでした', {kind: 'info', sub: res.error}); return; }
    const A = setLbl(pt.k);
    await commit(res.model);
    selectSet(pt.k);
    const SB = JKX.displayNames(res.model.sets), B = SB[res.kB >= 0 ? res.kB : pt.k];
    if (mode === 'split' && sub) scToast(`サブセット ${SB[pt.k]} を ${fmt(pt.c)} カウントの位置に作りました`, {undo: true, icon: 'split', sub: `「${SB[pt.k]}」→「${B}」の順に並びます。名前は自動で付きます`});
    else if (mode === 'split') scToast(`セット ${A} を ${fmt(pt.c)} カウントで2つに分けました`, {undo: true, icon: 'split', sub: res.approx ? `「${A}」と「${B}」。フォローの動き（${res.approx}人）は、途中から直線で近似しました` : `「${A}」と「${B}」。動きは分ける前とまったく同じです`});
    else if (mode === 'cut') scToast(`セット ${A} を ${fmt(pt.c)} カウントで切りました`, {undo: true, icon: 'trimend', sub: res.trimmed ? 'ホールドを短くしました' : 'その位置で終わり、後ろの動きは捨てました。次のセットはそこから始まります'});
    else scToast(`${fmt(pt.c)} カウントから後ろを削除しました`, {undo: true, icon: 'cutafter', sub: `セット ${A} までが残ります`});
  });
}
// ---- コピー・切り取り・貼り付け・複製・削除 ----
function copySets(quiet) {
  if (!ready() || !setKs().length) { if (!quiet) scToast('先に、コピーしたいセットをタイムラインで選んでください', {kind: 'info'}); return false; }
  const ks = setKs(), payload = SC.setsPayload(M, ks);
  let jk = '';
  try { jk = printModel(Object.assign({}, M, {sets: payload.sets, parts: []})); } catch (e) { jk = ''; }
  setClip = payload;
  lsSet(SETCLIP_KEY, JSON.stringify(payload));
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(SETCLIP_TAG + JSON.stringify(payload) + '\n' + jk).catch(() => {}); } catch (e) { /* 使えない環境 */ }
  if (!quiet) scToast(`セット ${setNames(ks)} をコピーしました（${ks.length}セット）`, {kind: 'info', icon: 'dup', sub: 'Ctrl+V で、選んでいるセットの後ろに貼り付けます。別のショーにも貼れます（右クリックで「左右反転して貼り付け」も）'});
  return true;
}
function parseSetClipText(text) {
  const i = text.indexOf(SETCLIP_TAG);
  if (i >= 0) { try { const p = JSON.parse(text.slice(i + SETCLIP_TAG.length).split('\n')[0]); if (SC.validPayload(p)) return Promise.resolve(p); } catch (e) { /* ふつうの文字 */ } }
  if (/^\s*(#.*\n\s*)*show\b/.test(text)) {
    return coreOpts('keep').compile(text).then(r => r && r.model && r.model.sets && r.model.sets.length ? {format: 'jinkei-sets', v: 1, sections: r.model.sections.map(s => ({id: s.id, n: s.n})), sets: r.model.sets} : null).catch(() => null);
  }
  return Promise.resolve(null);
}
async function readSetClip() {
  let text = null;
  try { if (navigator.clipboard && navigator.clipboard.readText) text = await Promise.race([navigator.clipboard.readText(), new Promise(r => setTimeout(() => r(null), 500))]); } catch (e) { text = null; }
  if (text) { const p = await parseSetClipText(text); if (p) return p; }
  if (setClip) return setClip;
  try { const p = JSON.parse(lsGet(SETCLIP_KEY) || 'null'); if (SC.validPayload(p)) return p; } catch (e) { /* なし */ }
  return null;
}
async function pasteSetsOp(mirror) {
  if (!ready()) return false;
  const payload = await readSetClip();
  if (!payload) { scToast('貼り付けるセットがありません', {kind: 'info', sub: 'タイムラインでセットをクリックして Ctrl+C でコピーしてください'}); return true; }
  const ks = setKs(), after = ks.length ? Math.max(...ks) : curSet;
  await guarded(async () => {
    const res = SC.pasteSets(M, after, payload, {mirror});
    if (!res.ok) { scToast('貼り付けられませんでした', {kind: 'info', sub: res.error}); return; }
    await commit(res.model);
    sel = new Set(); setSel.clear(); for (let i = 0; i < res.count; i++) setSel.add(res.at + i); setAnchor = res.at; tlFocus = true;
    selectSet(res.at); updateSel();
    const sub = [`セット ${setLbl(after)} の後ろに入れました`];
    if (mirror) sub.push('左右を反転しました');
    if (res.skipped) sub.push(`このショーにいない人の指定 ${res.skipped} 件は外しました`);
    scToast(`${res.count === 1 ? 'セット' : res.count + 'セット'} ${res.names.join('・')} を貼り付けました`, {undo: true, icon: 'paste', sub: sub.join('。')});
  });
  return true;
}
async function cutSetsOp() {
  if (!copySets(true)) { scToast('先に、切り取りたいセットをタイムラインで選んでください', {kind: 'info'}); return; }
  const nm = setNames(setKs());
  await deleteSetsOp(`セット ${nm} を切り取りました`, 'Ctrl+V で別の場所に貼り付けられます');
}
async function deleteSetsOp(title, sub0) {
  if (!ready()) return;
  const ks = setKs().filter(k => k > 0);
  if (!ks.length) { scToast('最初のセットは削除できません', {kind: 'info'}); return; }
  await guarded(async () => {
    const res = SC.deleteSets(M, ks);
    if (!res.ok) { scToast('削除できませんでした', {kind: 'info', sub: res.error}); return; }
    const nm = setNames(ks), at = Math.max(0, ks[0] - 1);
    await commit(res.model);
    setSel.clear(); tlFocus = false; sel = new Set(); selectSet(Math.min(at, res.model.sets.length - 1));
    scToast(title || `セット ${nm} を削除しました`, {undo: true, icon: 'trash', sub: sub0 || ''});
  });
}
async function dupSetsOp() {
  if (!ready() || !setKs().length) { scToast('先に、複製したいセットをタイムラインで選んでください', {kind: 'info'}); return; }
  const ks = setKs(), payload = SC.setsPayload(M, ks);
  await guarded(async () => {
    const res = SC.pasteSets(M, Math.max(...ks), payload);
    if (!res.ok) { scToast('複製できませんでした', {kind: 'info', sub: res.error}); return; }
    await commit(res.model);
    sel = new Set(); setSel.clear(); for (let i = 0; i < res.count; i++) setSel.add(res.at + i); setAnchor = res.at; tlFocus = true;
    selectSet(res.at); updateSel();
    scToast(`セット ${setNames(ks)} を複製しました`, {undo: true, icon: 'dup', sub: `新しいセット: ${res.names.join('・')}`});
  });
}
async function mirrorSetsOp() {
  if (!ready() || !setKs().length) { scToast('先に、反転したいセットをタイムラインで選んでください', {kind: 'info'}); return; }
  const ks = setKs();
  await guarded(async () => { await commit(SC.mirrorSets(M, ks)); scToast(`セット ${setNames(ks)} を左右反転しました`, {undo: true, icon: 'fliph', sub: '隊形の位置・回転・カーブを左右逆にしました'}); });
}
window.scMoveSets = function (ks, to) {
  if (!ready()) return;
  guarded(async () => {
    const res = SC.moveSets(M, ks, to);
    if (!res.ok) { scToast('動かせませんでした', {kind: 'info', sub: res.error}); return; }
    const nm = setNames(ks);
    await commit(res.model);
    sel = new Set(); setSel.clear(); for (let i = 0; i < res.count; i++) setSel.add(res.at + i); setAnchor = res.at; tlFocus = true;
    selectSet(res.at); updateSel();
    scToast(`セット ${nm} を動かしました`, {undo: true, icon: 'setnext', sub: 'タイムラインでドラッグして並べ替えられます'});
  });
};
// ---- セットのブロックの右クリックメニュー ----
window.scSetCtx = function (x, y, k, c) {
  const m = $('ctx'), pt = {k, c}, ks = setKs(), multi = ks.length > 1, hasClip = !!(setClip || lsGet(SETCLIP_KEY));
  const ok = canSplitAt(pt), inHold = ok && k > 0 && c > R.data.sets[k].counts - 1e-9;
  const it = (act, ic, name, o) => `<button class="mi${o && o.dg ? ' dg' : ''}" data-set="${act}" ${o && o.off ? 'disabled' : ''}>${icon(ic, 15)}<span>${esc2(name)}</span>${o && o.key ? `<span class="ks">${esc2(o.key)}</span>` : ''}</button>`;
  m.innerHTML = `<div class="mh">${multi ? `セット ${esc2(setNames(ks))}（${ks.length}）` : `セット ${esc2(setLbl(k))}｜${fmt(c)} カウント${inHold ? '（ホールド）' : ''}`}</div>`
    + (multi ? '' : it('split', 'split', 'ここで分割', {off: !ok, key: labelOf('split-here')}) + it('splitsub', 'split', 'サブセットとして分割', {off: !ok}) + it('cut', 'trimend', inHold ? 'ここでホールドを切る' : 'ここでカット（後ろを捨てる）', {off: !ok}) + it('after', 'cutafter', 'ここから後ろを削除', {off: !ok}) + '<div class="ms"></div>')
    + it('togglesub', 'setnext', ks.length && ks.every(q => M.sets[q] && M.sets[q].sub) ? 'メインのセットに戻す' : 'サブセットにする', {off: !ks.some(q => q > 0)})
    + it('copy', 'dup', multi ? `${ks.length}セットをコピー` : 'セットをコピー', {key: labelOf('copy')}) + it('cut2', 'cut', '切り取り', {off: !ks.some(q => q > 0), key: labelOf('cut')}) + it('paste', 'paste', 'セットの後ろに貼り付け', {off: !hasClip, key: labelOf('paste')}) + it('pastem', 'fliph', '左右反転して貼り付け', {off: !hasClip, key: labelOf('paste-sets-mirror')}) + it('dup', 'newset', '複製') + it('mirror', 'fliph', 'このセットを左右反転')
    + '<div class="ms"></div>' + it('del', 'trash', multi ? `${ks.length}セットを削除` : 'セットを削除', {dg: true, off: !ks.some(q => q > 0), key: labelOf('delete')});
  m.dataset.x = x; m.dataset.y = y; m.style.display = 'block';
  m.querySelectorAll('[data-set]').forEach(b => b.onclick = () => {
    hidePops(); const a = b.dataset.set;
    if (a === 'split') splitOp('split', pt); else if (a === 'splitsub') splitOp('split', pt, true); else if (a === 'togglesub') toggleSubOp(); else if (a === 'cut') splitOp('cut', pt); else if (a === 'after') splitOp('cutafter', pt);
    else if (a === 'copy') copySets(); else if (a === 'cut2') cutSetsOp(); else if (a === 'paste') pasteSetsOp(false); else if (a === 'pastem') pasteSetsOp(true);
    else if (a === 'dup') dupSetsOp(); else if (a === 'mirror') mirrorSetsOp(); else if (a === 'del') deleteSetsOp();
  });
  ctxPlace();
};
// 選んだセットを サブセット ⇄ メイン に切り替える（先頭のセットは対象外）
async function toggleSubOp() {
  if (!ready()) return;
  const ks = setKs().filter(k => k > 0); if (!ks.length) { scToast('先頭のセットはサブセットにできません', {kind: 'info'}); return; }
  const toSub = !ks.every(k => M.sets[k].sub);
  await guarded(async () => {
    const m = JSON.parse(JSON.stringify(M));
    for (const k of ks) {
      const st = m.sets[k];
      if (toSub) { st.sub = true; if (/^\d+$/.test(String(st.name))) st.name = ''; }
      else {
        st.sub = false;
        if (st.name === '') { const used = new Set(m.sets.map(x => String(x.name))); let n = 1; for (const x of m.sets) if (!x.sub && /^\d+$/.test(String(x.name))) n = Math.max(n, +x.name + 1); while (used.has(String(n))) n++; st.name = String(n); }
      }
    }
    const names = JKX.displayNames(m.sets);
    await commit(m);
    scToast(toSub ? `セット ${ks.map(k => names[k]).join('・')} をサブセットにしました` : `セット ${ks.map(k => names[k]).join('・')} をメインのセットに戻しました`, {undo: true, icon: 'setnext', sub: toSub ? '直前のメインのセットの下に、3A のように表示されます' : ''});
  });
}
window.scToggleSub = toggleSubOp;
function splitMenu() {
  const b = $('splitmenu').getBoundingClientRect(), pt = ready() ? playPoint() : {k: curSet, c: 0};
  if (!setSel.size) { setSel.add(pt.k); setAnchor = pt.k; }
  sel = new Set(); tlFocus = true; updateSel(); renderTimeline();
  window.scSetCtx(b.left, b.top - 200, pt.k, pt.c);
  const m = $('ctx'); m.style.top = Math.max(4, b.top - m.offsetHeight - 6) + 'px';
}

// ---- 人の位置の貼り付け（貼り方を選べる・貼る前に影で確認） ----
let pp = null;
const ppIds = () => selIds();
function ppPlan() {
  if (!clip || !pp) return {pairs: [], skipped: 0, mode: 'same'};
  return SC.pastePlan(clip.items, sel.size ? ppIds() : [], allIds(), {mode: pp.mode, flipX: pp.flipX, flipY: pp.flipY, field: R.data.field, place: pp.place});
}
function ppTargets() {
  if (pp.scope === 'rest') return Array.from({length: M.sets.length - curSet}, (_, i) => curSet + i);
  if (pp.scope === 'sel' && setSel.size) return setKs();
  return [curSet];
}
function ppGhost(pairs) {
  if (!FLD) return;
  let g = svg.querySelector('#pghost');
  if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.id = 'pghost'; g.style.pointerEvents = 'none'; svg.appendChild(g); }
  g.innerHTML = '';
  if (!pairs) return;
  const {el, Y} = FLD, idx = new Map(R.data.performers.map((p, i) => [p.id, i])), pos = R.data.sets[curSet].pos;
  for (const x of pairs) {
    const i = idx.get(x.id); if (i == null) continue;
    const a = pos[i];
    if (Math.hypot(a[0] - x.p[0], a[1] - x.p[1]) > 0.05) el('line', {x1: a[0], y1: Y(a[1]), x2: x.p[0], y2: Y(x.p[1]), stroke: '#ffd23f', 'stroke-width': DOT() * 0.14, 'stroke-dasharray': `${DOT() * 0.5} ${DOT() * 0.35}`, opacity: 0.7}, g);
    el('circle', {cx: x.p[0], cy: Y(x.p[1]), r: DOT() * 1.05, fill: secColor(i), 'fill-opacity': 0.45, stroke: '#ffd23f', 'stroke-width': DOT() * 0.28, 'stroke-dasharray': `${DOT() * 0.6} ${DOT() * 0.4}`}, g);
  }
}
function ppClose() {
  const p = $('pastepop'); if (p) p.remove();
  pp = null; ppGhost(null); svg.classList.remove('placing');
  document.removeEventListener('pointerdown', ppOutside, true);
}
function ppOutside(e) { if (!e.target.closest('#pastepop,#selpaste') && !(pp && pp.placing && e.target.closest('#svg'))) ppClose(); }
function ppRefresh() {
  const p = $('pastepop'); if (!p || !pp) return;
  const plan = ppPlan(), ks = ppTargets(), n = plan.pairs.length;
  ppGhost(plan.pairs);
  const note = p.querySelector('#ppnote');
  note.textContent = !n ? (pp.mode === 'order' ? '貼り付け先の人を選んでください' : '貼り付けられる人がいません') : `${n}人の位置を、セット ${ks.map(k => setLbl(k)).join('・')} に貼り付けます` + (plan.skipped ? `（${plan.skipped}人は対象外）` : '') + (plan.extra ? `（選んだ人のうち ${plan.extra}人は余ります）` : '');
  p.querySelector('#ppok').disabled = !n;
}
function openPastePop() {
  if (!ready()) return;
  if (!clip) { scToast('先に、人を選んで位置をコピーしてください', {kind: 'info', sub: '人を選んで Ctrl+C（右クリックの「位置をコピー」でも）'}); return; }
  ppClose();
  pp = {mode: sel.size && !clip.items.every(c => sel.has(R.data.performers.findIndex(p => p.id === c.id))) ? 'order' : 'same', flipX: false, flipY: false, scope: 'one', place: null, placing: false};
  const p = document.createElement('div'); p.id = 'pastepop'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', '位置の貼り付け');
  const nSel = setSel.size > 1;
  p.innerHTML = `<div class="ph">${icon('paste', 16)}位置を貼り付け<small>${clip.items.length}人（セット ${esc2(clip.set)} から）</small></div>
    <div class="pr"><span class="pl">貼る先</span><label><input type="radio" name="ppm" value="same"> 同じ人へ</label><label class="l2"><input type="radio" name="ppm" value="order"> 選んでいる人へ（並び順で）</label></div>
    <div class="pr"><span class="pl">反転</span><label><input type="checkbox" id="ppfx"> 左右反転</label><label><input type="checkbox" id="ppfy"> 前後反転</label></div>
    <div class="pr"><span class="pl">セット</span><select id="ppsc"><option value="one">このセットだけ</option><option value="rest">ここから最後まですべて</option>${nSel ? '<option value="sel">タイムラインで選んだセット</option>' : ''}</select></div>
    <div class="pr"><button type="button" id="ppshape" class="ghost">${icon('select', 15)}形として貼り付け（クリックで置く）</button></div>
    <div id="ppnote" class="pn"></div>
    <div class="pbt"><button type="button" id="ppcancel">やめる</button><button type="button" class="pri" id="ppok">貼り付ける</button></div>`;
  document.body.appendChild(p);
  p.querySelector(`[name=ppm][value=${pp.mode}]`).checked = true;
  const upd = () => { pp.mode = p.querySelector('[name=ppm]:checked').value; pp.flipX = p.querySelector('#ppfx').checked; pp.flipY = p.querySelector('#ppfy').checked; pp.scope = p.querySelector('#ppsc').value; if (pp.placing) { pp.placing = false; pp.place = null; svg.classList.remove('placing'); p.querySelector('#ppshape').classList.remove('on'); } ppRefresh(); };
  p.querySelectorAll('input,select').forEach(i => i.addEventListener('change', upd));
  p.querySelector('#ppcancel').onclick = ppClose;
  p.querySelector('#ppok').onclick = () => ppCommit();
  p.querySelector('#ppshape').onclick = () => { pp.placing = !pp.placing; pp.place = null; svg.classList.toggle('placing', pp.placing); p.querySelector('#ppshape').classList.toggle('on', pp.placing); p.querySelector('#ppnote').textContent = pp.placing ? 'フィールドの置きたい場所にマウスを動かして、クリックで貼り付け（Esc でやめる）' : ''; if (!pp.placing) ppRefresh(); };
  p.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ppClose(); } else if (e.key === 'Enter' && !e.target.closest('button:not(#ppok)')) { e.preventDefault(); ppCommit(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); e.stopPropagation(); ppCommit(); } });
  const a = $('selpaste') && $('selpaste').getBoundingClientRect(), vis = a && a.width > 0 && a.top > 0;
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = Math.max(6, innerWidth - w - 12) + 'px'; // 右の欄の上に出す（フィールドの影の確認をじゃましない）
  p.style.top = Math.max(6, vis ? a.top - h - 8 : innerHeight - h - 90) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', ppOutside, true), 0);
  ppRefresh();
  p.querySelector('#ppok').focus();
}
async function ppCommit() {
  if (!pp) return;
  const plan = ppPlan(), ks = ppTargets();
  if (!plan.pairs.length) return;
  const mode = pp.mode, placed = !!pp.place;
  ppClose();
  await guarded(async () => {
    const res = await SC.applyPasteSeq(M, ks, plan.pairs, coreOpts('keep'));
    if (!res.ok) { notice(res.error); return; }
    if (!res.touched) { scToast('すでに同じ位置です', {kind: 'info', sub: '別のセットに移るか、貼り方（反転・形として置く）を変えてください'}); return; }
    await commit(res.model);
    const idx = new Map(R.data.performers.map((p, i) => [p.id, i]));
    sel = new Set(plan.pairs.map(x => idx.get(x.id)).filter(i => i != null)); updateSel(); drawCanvas();
    const sub = [mode === 'order' ? '選んだ人に、並び順で当てはめました' : `セット ${ks.map(k => setLbl(k)).join('・')} に反映しました`];
    sub.push(res.shapes ? '形がそろっているので、1つの隊形として書きました' : res.pins ? `個別の位置は${res.pins}件です` : '');
    scToast(`${plan.pairs.length}人の位置を貼り付けました${placed ? '（形として）' : ''}`, {undo: true, sub: sub.filter(Boolean).join('。'), icon: 'paste'});
  });
}
svg.addEventListener('pointermove', e => {
  if (!pp || !pp.placing || !R) return;
  const q = toField(e); pp.place = [Math.round(q[0] * 20) / 20, Math.round(q[1] * 20) / 20];
  ppGhost(ppPlan().pairs);
});
svg.addEventListener('pointerdown', e => {
  if (!pp || !pp.placing || e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  const q = toField(e); pp.place = [Math.round(q[0] * 20) / 20, Math.round(q[1] * 20) / 20];
  ppCommit();
}, true);
window.scOpenPastePop = openPastePop;
window.scCopyMembers = () => copySel();
window.scClipCount = () => clip ? clip.items.length : 0;
function pasteSmart() {
  if (setFocusOn()) { pasteSetsOp(false); return true; }
  if (clip) { openPastePop(); return true; }
  pasteSetsOp(false); return true;
}

// ---- 操作の登録 ----
def('toggle-sub', 'セットをサブセットにする／メインに戻す', 'set', [], {icon: 'setnext', kw: 'さぶせっと サブセット めいん もどす subset toggle', need: 'show', run: () => { toggleSubOp(); }});
def('split-sub', 'ここでサブセットとして分割（3A のように親の名前＋A）', 'set', [], {icon: 'split', kw: 'さぶせっと さぶ ぶんかつ わける サブセット subset 3a split here', need: 'show', run: () => { splitOp('split', null, true); }});
def('split-here', 'ここで分割（再生ヘッドの位置でセットを2つに）', 'set', ['Mod+Shift+K', '\\'], {icon: 'split', kw: 'ぶんかつ わける さいせい へっど ここで わる split divide きる せっと', need: 'show', run: () => { splitOp('split'); }});
def('cut-here', 'ここでカット（後ろの動きを捨てる）', 'set', [], {icon: 'trimend', kw: 'かっと きる みじかく うしろ すてる cut trim ここで ほーるど', need: 'show', run: () => { splitOp('cut'); }});
def('delete-after', 'ここから後ろを削除', 'set', [], {icon: 'cutafter', kw: 'うしろ ぜんぶ さくじょ けす ここから delete after truncate', need: 'show', run: () => { splitOp('cutafter'); }});
def('copy-sets', 'セットをコピー（選んだセットのブロック）', 'set', [], {icon: 'dup', kw: 'せっと こぴー copy sets ぶろっく', need: 'show', run: () => { copySets(); }});
def('cut-sets', 'セットを切り取り', 'set', [], {icon: 'cut', kw: 'せっと きりとり かっと cut sets', need: 'show', run: () => { cutSetsOp(); }});
def('paste-sets', 'セットを貼り付け（選んでいるセットの後ろ）', 'set', [], {icon: 'paste', kw: 'せっと はりつけ ぺーすと paste sets', need: 'show', run: () => { pasteSetsOp(false); }});
def('paste-sets-mirror', '左右反転してセットを貼り付け', 'set', ['Mod+Shift+V'], {icon: 'fliph', kw: 'せっと はんてん さゆう みらー はりつけ mirror flip paste sets', need: 'show', run: () => { pasteSetsOp(true); }});
def('dup-sets', 'セットを複製（選んだセットの後ろに）', 'set', [], {icon: 'newset', kw: 'せっと ふくせい ぶろっく duplicate sets', need: 'show', run: () => { dupSetsOp(); }});
def('mirror-sets', 'セットを左右反転', 'set', [], {icon: 'fliph', kw: 'せっと はんてん さゆう みらー flip mirror sets', need: 'show', run: () => { mirrorSetsOp(); }});
def('paste-options', '位置の貼り付けオプション…（反転・複数セット・形として）', 'mem', ['Mod+Alt+V'], {icon: 'paste', kw: 'いち はりつけ おぷしょん はんてん ぜんご さゆう かたち かたちとして ふくすう いっかつ paste options shape', need: 'show', run: () => { openPastePop(); }});

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
    if (a.need === 'sel' && !sel.size && !(a.alt && a.alt())) { scToast(a.why || NEED_MSG.sel, {kind: 'info', sub: /^(delete|cut|add-member|duplicate)/.test(a.id) ? 'クリック・範囲ドラッグ・Tab・1〜9 で選べます' : ''}); return true; }
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
  if (qsDigit(e)) { e.preventDefault(); e.stopPropagation(); return; }
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
  ['#tlplay', 'ショー全体を再生', 'play'], ['#dupset', '今のセットを複製（長さもそのまま）', null], ['#addset', '新しいセットを足す（直前の長さ・今の隊形のコピー）', 'dup-set'], ['#addsetmenu', '長さを選ぶ・まとめて作る・曲に合わせる・タップで区切る', 'sets-bulk'],
  ['#zfit', '全体を表示', 'fit'], ['#zin', '拡大', 'zoom-in'], ['#zout', '縮小', 'zoom-out'], ['#selclear', '選択を解除', 'escape'],
  ['#seldel', '選んだ人を削除（その場から抜く。Shift で詰める）', 'delete'], ['#seldup', '選んだ人を複製（隣に同じ人数を追加）', 'duplicate'], ['#seladd', '選んだ人と同じパートに1人追加', 'add-member'],
  ['#flipx', '選んだ人を左右に反転（上手と下手を入れ替え）', 'flip-h'], ['#flipy', '選んだ人を前後に反転（客席側と奥を入れ替え）', 'flip-v'],
  ['#splitbtn', '再生ヘッドの位置で、今のセットを2つに分ける（先にタイムラインで位置を選ぶ）', 'split-here'], ['#splitmenu', '分割・カット・コピー・貼り付けのメニュー', null], ['#selcopy', '選んだ人の位置をコピー（人を選んでいるとき Ctrl+C）', null], ['#selpaste', '位置を貼り付け（貼り方を選べます。ずらさず確認してから貼れます）', 'paste-options'], ['#scbtn', 'ショートカット一覧', 'shortcuts'], ['#scpalbtn', 'コマンド検索', 'palette']
];
function decorate() {
  for (const [sel_, base, id] of TIPS) { const el = document.querySelector(sel_); if (el) { el.title = tip(base, id); if (el.classList.contains('ib')) el.setAttribute('aria-label', base); } }
    try { renderTools(); } catch (e) { /* 起動前 */ }
  const pb = $('scpalbtn'); if (pb) pb.innerHTML = icon('search', 16) + '<span>検索</span>';
  const kb = $('scbtn'); if (kb) kb.innerHTML = icon('kbd', 17);
}
const hasSkip = () => { try { return !!(M && M.sets[curSet] && M.sets[curSet].stmts.some(s => s.skip && s.skip.length)); } catch (e) { return false; } };
window.scCtxItems = function () {
  const it = (id, name, danger, off) => `<button class="mi${danger ? ' dg' : ''}" data-sc="${id}" ${off ? 'disabled' : ''}>${icon(BYID[id].icon, 15)}<span>${esc2(name)}</span><span class="ks">${esc2(labelOf(id))}</span></button>`;
  return `<div class="ms"></div>${it('add-member', '同じパートに1人追加')}${it('duplicate', '複製')}${it('copy', '位置をコピー')}${it('paste', clip ? '位置を貼り付け…（貼り方を選ぶ）' : '位置を貼り付け（先にコピー）', false, !clip)}<div class="ms"></div>${it('delete', '削除（その場から抜く）', true)}${it('delete-reflow', '削除して詰める', true)}${hasSkip() ? it('close-gaps', '空きを詰める') : ''}`;
};

// ================= 選んだ人のそばの小さなピル（任意） =================
// 主な操作は、フィールドの外の「選択バー」（#selbar）にある。ここは、あると便利な人向けの小さなピル。
//  - 初期設定: 詳細モードでは出さない／かんたんモードでは出す（設定でいつでも切り替えられる）
//  - 選んでから少し待って（0.7秒）出る。ドラッグ・範囲選択・再生中、マウスが人の丸の上にあるときは隠れる
//  - 選んだ人の外側に置き、フィールドの縁にははみ出さない
const FLOAT_KEY = 'jk_float_v1', FLOAT_DELAY = 700;
let floatEl = null, floatRaf = 0, floatArmed = false, floatTimer = 0, floatHover = false;
const isEasy = () => document.body.classList.contains('easy');
function floatEnabled() { const v = lsGet(FLOAT_KEY); return v === 'on' ? true : v === 'off' ? false : isEasy(); }
function setFloat(on) { lsSet(FLOAT_KEY, on ? 'on' : 'off'); syncFloatChk(); armFloat(); scheduleFloat(); }
function syncFloatChk() { const c = $('scfloatchk'); if (c) c.checked = floatEnabled(); }
function armFloat() {
  floatArmed = false; clearTimeout(floatTimer);
  if (floatEl) floatEl.style.display = 'none';
  floatTimer = setTimeout(() => { floatArmed = true; scheduleFloat(); }, FLOAT_DELAY);
}
function buildFloat() {
  floatEl = document.createElement('div');
  floatEl.id = 'scfloat'; floatEl.setAttribute('role', 'toolbar'); floatEl.setAttribute('aria-label', '選んだ人への操作（ミニバー）');
  floatEl.innerHTML = [['add-member', 'adduser'], ['duplicate', 'dup'], ['rotate-cw', 'rotcw'], ['flip-h', 'fliph'], ['arrange', 'arrange'], ['delete', 'trash']]
    .map(([id, ic]) => `<button type="button" data-fl="${id}" class="${id === 'delete' ? 'dg' : ''}">${icon(ic, 16)}</button>`).join('');
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
  floatEl.querySelectorAll('[data-fl]').forEach(b => { const id = b.dataset.fl; b.title = id === 'arrange' ? base[id] : tip(base[id], id); b.setAttribute('aria-label', base[id]); });
}
function placeFloat() {
  floatRaf = 0;
  if (!floatEl) return;
  const wrap = $('canvaswrap'), show = floatEnabled() && floatArmed && !floatHover && sel.size > 0 && R && !isMobileW() && tool === 'select' && playT === null && !playing && !pdrag && !gdrag && !dragging && !band && !draw && dotEls.length && wrap;
  if (!show) { floatEl.style.display = 'none'; return; }
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const i of sel) { const el = dotEls[i]; if (!el) continue; const q = el.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
  if (!isFinite(l)) { floatEl.style.display = 'none'; return; }
  floatEl.style.display = 'flex';
  floatEl.querySelector('[data-fl="flip-h"]').disabled = sel.size < 2;
  floatEl.querySelector('[data-fl="arrange"]').disabled = sel.size < 2;
  const W = wrap.getBoundingClientRect(), w = floatEl.offsetWidth, h = floatEl.offsetHeight, gap = 12, M0 = 10;
  // 人の丸（選んでいない人も、選んだ人も）をなるべく隠さない場所に置く。選んだ範囲の外側で、上・下・左・右の順に試す
  const dots = [];
  dotEls.forEach((el, i) => { if (el) { const q = el.getBoundingClientRect(); dots.push([q.left + q.width / 2 - W.left, q.top + q.height / 2 - W.top, q.width / 2 + 2]); } });
  const cx = (l + r) / 2 - W.left, cy = (t + b) / 2 - W.top;
  const cands = [[cx - w / 2, t - h - gap - W.top, 'top'], [cx - w / 2, b + gap - W.top, 'bottom'], [l - w - gap - W.left, cy - h / 2, 'left'], [r + gap - W.left, cy - h / 2, 'right']];
  let best = null;
  for (const [x0, y0, side] of cands) {
    const x = Math.max(M0, Math.min(W.width - w - M0, x0)), y = Math.max(M0, Math.min(W.height - h - M0, y0));
    const hit = dots.filter(([ox, oy, or]) => ox + or > x && ox - or < x + w && oy + or > y && oy - or < y + h).length;
    const inSel = x + w > l - W.left && x < r - W.left && y + h > t - W.top && y < b - W.top ? 50 : 0; // 選んだ範囲に重なる置き方は避ける
    const clipped = Math.abs(x - x0) + Math.abs(y - y0) > 24 ? 5 : 0;
    const score = hit * 10 + inSel + clipped;
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
  if (a.need === 'sel') return sel.size > 0 || !!(a.alt && a.alt());
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
  if (window.JKCMDUI) JKCMDUI.palMount(palEl, {render: renderPalette, close: closePalette});
  inp.addEventListener('input', () => renderPalette(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return; // 変換中の Enter / 矢印は触らない
    if (window.JKCMDUI && JKCMDUI.palKey(e)) return;   // 「AIに頼む」の表示中は、そちらが矢印・Enter を扱う
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
  if (window.JKCMDUI) { if (JKCMDUI.palActive()) { JKCMDUI.palRender(q); return; } JKCMDUI.palHide(); }
  let rows = [];
  if (!q) {
    const rec = recent().map(id => BYID[id]);
    const sug = ['delete', 'add-member', 'duplicate', 'undo', 'play', 'shortcuts'].map(id => BYID[id]).filter(a => !rec.includes(a));
    rows = [{h: rec.length ? '最近使った操作' : 'よく使う操作'}].concat((rec.length ? rec : sug).map(a => ({a})));
    if (rec.length) rows.push({h: 'おすすめ'}, ...sug.map(a => ({a})));
    if (window.JKCMDUI && JKCMDUI.ready()) rows.push({h: '日本語で指示する'}, {ai: ''});
  } else {
    rows = ACTIONS.filter(a => !a.noPal && (!a.if || a.if())).map(a => ({a, s: SC.fuzzyScore(q, {name: a.name, kw: a.kw, group: GNAME[a.group]})})).filter(x => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 40);
    if (!rows.length && window.JKCMDUI && JKCMDUI.ready()) { JKCMDUI.palAuto(q); return; }   // メニューに無いことばは、そのまま日本語の指示として読む
    if (!rows.length) rows = [{none: true}];
    else if (window.JKCMDUI && JKCMDUI.ready() && q.length >= 2) rows.push({ai: q});
  }
  palItems = [];
  list.innerHTML = rows.map(r => {
    if (r.h) return `<div class="scp-h">${r.h}</div>`;
    if (typeof r.ai === 'string') { const i = palItems.push({ai: r.ai}) - 1; return `<div class="scp-i scp-ai" role="option" data-pi="${i}">${icon('wand', 19)}<span class="nm">${r.ai ? `AIに頼む「${esc2(r.ai)}」` : '日本語でそのまま頼む'}<small>${r.ai ? '日本語の指示として、確認してから実行します' : '例: トランペットを前に3歩動かして／全員を円にして'}</small></span><span class="gp">AI</span><span class="ky"></span></div>`; }
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
  if (a.ai) { JKCMDUI.palStart(a.ai); return; }
  closePalette(false);
  setTimeout(() => { rememberRecent(a.id); execute(a, {}, (KM[a.id] || [])[0] || ''); }, 0);
}
function openPalette(opt) {
  if (document.querySelector('dialog[open]')) return;
  closeSheet();
  if (!palEl) buildPalette();
  palPrev = document.activeElement;
  palEl.style.display = 'flex';
  const inp = palEl.querySelector('#scpin'); inp.value = '';
  if (window.JKCMDUI) JKCMDUI.palReset(opt);
  renderPalette(inp.value);
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
window.scClosePalette = closePalette;

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
    let list = ACTIONS.filter(a => a.group === g && (!a.if || a.if()) && !(a.merge && !/-1$/.test(a.id)) && (q || showUnbound || KM[a.id].length || isCustom(a) || (capture && capture.id === a.id)));
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
  const mouse = (!q || /マウス|クリック|ドラッグ|ホイール|カウント|長さ|mouse|click|wheel/i.test(q)) ? `<section class="scs-g"><h3>マウス・タッチ</h3>
    <div class="scs-r info">${icon('mouse', 17)}<span class="nm">人を選ぶ／動かす</span><span class="ky">クリック・ドラッグ</span></div>
    <div class="scs-r info">${icon('selall', 17)}<span class="nm">選びなおす・追加する</span><span class="ky"><span class="kcs"><kbd class="kc">${MAC ? '⇧' : 'Shift'}</kbd><i>+</i>クリック</span><i class="or">/</i><span class="kcs"><kbd class="kc">${MAC ? '⌘' : 'Ctrl'}</kbd><i>+</i>クリック</span></span></div>
    <div class="scs-r info">${icon('selall', 17)}<span class="nm">範囲で選ぶ</span><span class="ky">何もない所をドラッグ</span></div>
    <div class="scs-r info">${icon('arrange', 17)}<span class="nm">メニューを開く</span><span class="ky">右クリック／長押し</span></div>
    <div class="scs-r info">${icon('counts', 17)}<span class="nm">セットの長さを変える</span><span class="ky">タイムラインの右端をドラッグ（<span class="kcs"><kbd class="kc">${MAC ? '⇧' : 'Shift'}</kbd></span> で0.5刻み）</span></div>
    <div class="scs-r info">${icon('counts', 17)}<span class="nm">セットの長さを数字で入れる</span><span class="ky">セットをダブルクリック</span></div>
    <div class="scs-r info">${icon('counts', 17)}<span class="nm">セットの長さを1ずつ変える</span><span class="ky"><span class="kcs"><kbd class="kc">${MAC ? '⌥' : 'Alt'}</kbd><i>+</i>ホイール</span>（<span class="kcs"><kbd class="kc">${MAC ? '⌘' : 'Ctrl'}</kbd></span> も押すとホールド）</span></div></section>` : '';
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

// ================= セットをすばやく作る（長さの選択・まとめて作る・曲に合わせる・タップで区切る） =================
const QS_KEY = 'jk_qs_dlg_v1';
const qsCall = (fn, ...a) => (typeof window[fn] === 'function' ? window[fn](...a) : null);
const QS_DEF = {tab: 'counts', seq: '8 8 16 4 12', bars: '4 4 2x2 8', meter: '4/4', names: 'num', copy: 'prev', where: 'after', every: 4, part: '-1', gridBars: 32, tapTempo: '', countIn: true, tapSrc: 'auto'};
function qsPrefs() { let o = null; try { o = JSON.parse(lsGet(QS_KEY) || 'null'); } catch (e) { o = null; } return Object.assign({}, QS_DEF, o && typeof o === 'object' ? o : {}); }
function qsSavePrefs(p) { lsSet(QS_KEY, JSON.stringify(p)); }
const qsCopyPref = () => lsGet('jk_qs_copy') === 'hold' ? 'hold' : 'prev';
const hasParade = () => typeof window.jkOpenParade === 'function';
const qsSecText = sec => { sec = Math.round(sec); return sec >= 60 ? `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒` : `${sec}秒`; };
function qsTempoAt(after) { const D = R && R.data; if (!D) return 120; const s = D.sets[Math.min(after, D.sets.length - 1)]; return (s && s.tempo) || D.tempo || 120; }
function qsEndCount() { const t = SC.setTimes(M); return t[t.length - 1].t1; }
function qsAfterIdx(where) { return where === 'end' ? M.sets.length - 1 : curSet; }
function qsOrigin(after) { return SC.setTimes(M)[after].t1; }
const qsBarNo = (bars, t) => { let n = 0; for (let i = 0; i < bars.length - 1; i++) if (bars[i] <= t + 1e-6) n = i + 1; return Math.max(1, n); };

// ---- 「＋ セット」の横の ▾: 長さのチップ・隊形の写し方・まとめて作る ----
let qsPopEl = null;
function closeQsPop() { if (qsPopEl) { qsPopEl.remove(); qsPopEl = null; document.removeEventListener('pointerdown', qsPopOutside, true); const b = $('addsetmenu'); if (b) b.setAttribute('aria-expanded', 'false'); } }
function qsPopOutside(e) { if (qsPopEl && !qsPopEl.contains(e.target) && !e.target.closest('#addsetmenu')) closeQsPop(); }
function openQsPop() {
  if (!ready()) return;
  if (qsPopEl) { closeQsPop(); return; }
  const last = qsCall('qsLast') || 8, copy = qsCopyPref();
  const pop = qsPopEl = document.createElement('div');
  pop.id = 'qspop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '新しいセットの長さ');
  pop.innerHTML = `<div class="qs-h">新しいセットの長さ<small>（カウント）</small></div>
    <div class="qs-chips">${[2, 4, 6, 8, 12, 16, 24, 32].map(n => `<button type="button" data-n="${n}" class="${n === last ? 'last' : ''}">${n}</button>`).join('')}</div>
    <div class="qs-cust"><input id="qspopn" type="text" inputmode="decimal" autocomplete="off" placeholder="好きな数（例 10・7.5）" aria-label="好きなカウント数"><button type="button" class="pri" id="qspopgo">作る</button></div>
    <div class="qs-rad" role="radiogroup" aria-label="新しいセットの隊形"><label><input type="radio" name="qspc" value="prev" ${copy === 'prev' ? 'checked' : ''}> 今の隊形をコピー</label><label><input type="radio" name="qspc" value="hold" ${copy === 'hold' ? 'checked' : ''}> 全員その場（空のセット）</label></div>
    <div class="qs-sep"></div>
    <button type="button" class="qs-i" data-qs="sub">${icon('newset', 16)}<span>サブセットを追加（3A のような中間の隊形）</span></button>
    <button type="button" class="qs-i" data-qs="bulk">${icon('bulk', 16)}<span>まとめて作る…</span><span class="ks">${esc2(labelOf('sets-bulk'))}</span></button>
    <button type="button" class="qs-i" data-qs="song">${icon('music', 16)}<span>曲に合わせて区切る…</span><span class="ks">${esc2(labelOf('sets-song'))}</span></button>
    <button type="button" class="qs-i" data-qs="tap">${icon('tap', 16)}<span>タップで区切る…</span><span class="ks">${esc2(labelOf('tap-split'))}</span></button>
    ${hasParade() ? `<button type="button" class="qs-i" data-qs="parade">${icon('parade', 16)}<span>パレードを作る…</span></button>` : ''}`;
  document.body.appendChild(pop);
  const br = $('addsetmenu').getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, br.right - pw)) + 'px';
  pop.style.top = (br.top - ph - 6 >= 6 ? br.top - ph - 6 : Math.min(innerHeight - ph - 6, br.bottom + 6)) + 'px';
  $('addsetmenu').setAttribute('aria-expanded', 'true');
  const copyNow = () => pop.querySelector('input[name="qspc"]:checked').value;
  pop.querySelector('.qs-rad').addEventListener('change', () => lsSet('jk_qs_copy', copyNow()));
  const make = n => { if (!(n >= 0.5 && n <= 999)) { const i = $('qspopn'); i.classList.add('bad'); i.focus(); return; } closeQsPop(); lsSet('jk_qs_copy', copyNow()); const o = qsCall('qsNewSet', JKSC_round(n), copyNow()); void o; };
  pop.querySelectorAll('.qs-chips [data-n]').forEach(b => b.onclick = () => make(+b.dataset.n));
  $('qspopgo').onclick = () => make(parseNum($('qspopn').value));
  $('qspopn').addEventListener('input', e => e.target.classList.remove('bad'));
  $('qspopn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); make(parseNum($('qspopn').value)); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQsPop(); $('addsetmenu').focus(); } });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeQsPop(); $('addsetmenu').focus(); } });
  pop.querySelectorAll('[data-qs]').forEach(b => b.onclick = () => { const k = b.dataset.qs; closeQsPop(); if (k === 'sub') { qsCall('qsNewSet', JKSC_round(qsCall('qsLast') || 4), copyNow(), {sub: true}); } else if (k === 'bulk') openBulk('counts'); else if (k === 'song') openBulk('song'); else if (k === 'tap') openTap(); else if (k === 'parade' && hasParade()) window.jkOpenParade(); });
  setTimeout(() => document.addEventListener('pointerdown', qsPopOutside, true), 0);
  const f = pop.querySelector('.qs-chips .last') || pop.querySelector('.qs-chips button'); if (f) f.focus();
}
const JKSC_round = v => SC.qsRound(v, 0.5);
function parseNum(v) { const s = String(v || '').normalize('NFKC').trim(); return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN; }
// 新しいセットを作ったあとの案内（数字キーで長さを決められる）
let hintEl = null, hintT = 0;
function showHint(html, ms) {
  if (!hintEl) { hintEl = document.createElement('div'); hintEl.id = 'qshint'; hintEl.setAttribute('role', 'status'); document.body.appendChild(hintEl); }
  hintEl.innerHTML = html; hintEl.classList.add('on');
  const tl = $('timeline').getBoundingClientRect();
  hintEl.style.left = Math.max(8, Math.min(innerWidth - hintEl.offsetWidth - 8, tl.left + 12)) + 'px'; hintEl.style.top = Math.max(8, tl.top - hintEl.offsetHeight - 8) + 'px';
  clearTimeout(hintT); hintT = setTimeout(() => hintEl && hintEl.classList.remove('on'), ms || 2200);
}
function afterNewSet() {
  const k = curSet, nm = M.sets[k] ? M.sets[k].name : '', c = M.sets[k] ? M.sets[k].counts : '';
  showHint(`${icon('counts', 15)}<b>セット ${esc2(nm)}</b>（${esc2(c)}カウント）を作りました　<span class="kcs-s">数字キーで長さを変えられます（例 <kbd class="kc kc-s">1</kbd><kbd class="kc kc-s">2</kbd> → 12）</span>`, 2600);
}
// ---- 作った直後の数字キー（1.5秒以内）で、そのセットのカウント数を決める ----
const DIGIT_MS = 1500;
function qsDigit(e) {
  const f = typeof qsFresh !== 'undefined' ? qsFresh : null;
  if (!f || Date.now() - f.t > DIGIT_MS || f.k !== curSet || !M.sets[curSet]) return false;
  if (e.ctrlKey || e.metaKey || e.altKey || !/^[0-9]$/.test(e.key)) return false;
  if (isTyping() || document.querySelector('dialog[open]') || overlayOpen()) return false;
  let buf = f.buf + e.key;
  if (buf.length > 3) buf = e.key;
  const v = parseInt(buf, 10);
  if (!(v >= 1)) { f.buf = buf; f.t = Date.now(); return true; } // 0 だけのあいだは待つ
  f.buf = buf; f.t = Date.now();
  const set = M.sets[curSet];
  if (String(set.counts) !== String(v)) { holdUndo = true; set.counts = String(v); edited(false); renderTimeline(); holdUndo = false; }
  qsCall('qsSetLast', v);
  showHint(`${icon('counts', 15)}<b>セット ${esc2(setLbl(curSet))}</b>　${v} カウント　<span class="kcs-s">続けて数字で桁を足せます</span>`, 1800);
  return true;
}
window.scAfterNewSet = afterNewSet;

// ---- まとめて作る／曲に合わせる のダイアログ ----
let bulkDlg = null;
const BULK_METERS = ['4/4', '3/4', '2/4', '2/2', '5/4', '6/8', '7/8', '9/8', '12/8'];
function mkDlg(id, cls) {
  const old = $(id); if (old) { try { old.close(); } catch (e) { /* 閉じていた */ } old.remove(); }
  const d = document.createElement('dialog'); d.id = id; d.className = 'uxdlg qsdlg ' + cls; document.body.appendChild(d); return d;
}
function showDlg(d) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
function openBulk(initTab) {
  if (!ready()) { scToast('エラーを直してから操作してください', {kind: 'info'}); return; }
  const P = qsPrefs(); if (initTab) P.tab = initTab;
  const D = R.data, hasParts = D.parts && D.parts.length > 0;
  const d = bulkDlg = mkDlg('qsbulk', 'qsbulk');
  const partOpts = hasParts ? `<option value="-1">すべてのパート</option>` + D.parts.map((p, i) => `<option value="${i}">${esc2(p.name)}（${p.meter[0]}/${p.meter[1]}・${SC.qsFmt(p.bars.length)}小節）</option>`).join('') : '';
  const tempoLines = [`${SC.qsFmt(D.tempo)} BPM（ショー全体）`].concat(D.sets.filter((s, k) => M.sets[k] && M.sets[k].tempo != null && M.sets[k].tempo !== '').map(s => `セット ${esc2(s.name)} から ${SC.qsFmt(s.tempo)} BPM`));
  d.innerHTML = `<button type="button" class="ghost x abs" data-close aria-label="閉じる">✕</button>
  <div class="ux-body qs-body">
    <h2 class="qs-t">${icon('bulk', 22)} セットをまとめて作る</h2>
    <div class="qs-tabs" role="tablist">
      <button type="button" role="tab" data-tab="counts">カウントで</button><button type="button" role="tab" data-tab="bars">小節で</button><button type="button" role="tab" data-tab="song">曲に合わせる</button>
    </div>
    <div class="qs-pane" data-pane="counts">
      <label class="qs-f">カウントのならび<input id="qssq" type="text" autocomplete="off" spellcheck="false" placeholder="8 8 16 4 12" aria-describedby="qshc"></label>
      <div class="qs-help" id="qshc">スペースで区切って、セットごとのカウント数を書きます。<code>8x4</code> は「8を4回」、<code>(8 4)x2</code> は「8 4 を2回」。<code>7.5</code> のように 0.5 刻みも使えます。</div>
      <div class="qs-ex">例:<button type="button" data-ex="8 8 16 4 12">8 8 16 4 12</button><button type="button" data-ex="8x4 16 6">8x4 16 6</button><button type="button" data-ex="16x8">16x8</button><button type="button" data-ex="(8 4)x4">(8 4)x4</button></div>
    </div>
    <div class="qs-pane" data-pane="bars">
      <div class="qs-row"><label class="qs-f s">拍子<select id="qsmt">${BULK_METERS.map(m => `<option>${m}</option>`).join('')}</select></label>
      <label class="qs-f g">セットごとの小節数<input id="qsbq" type="text" autocomplete="off" spellcheck="false" placeholder="4 4 2x2 8"></label></div>
      <div class="qs-help">1セットが何小節かを、スペースで区切って書きます（<code>4x6</code> は「4小節を6セット」）。カウントは拍子から自動で計算します（4/4 は1小節=4カウント、3/4 は3カウント、6/8 は3カウント）。</div>
    </div>
    <div class="qs-pane" data-pane="song">
      ${hasParts ? `<div class="qs-row"><label class="qs-f g">区切りに使う小節線<select id="qspt">${partOpts}</select></label><label class="qs-f s">小節ごと<input id="qsev" type="number" min="1" max="64" step="1"></label></div>
      <div class="qs-help">楽譜（パート）の小節線に合わせて、N 小節ごとにセットを区切ります。<b>「セット名を小節番号に」</b>を選ぶと、各セットの頭の小節番号（リハーサル番号）が名前になります。</div>` :
      `<div class="qs-row"><label class="qs-f s">拍子<select id="qsmt2">${BULK_METERS.map(m => `<option>${m}</option>`).join('')}</select></label><label class="qs-f s">全部で（小節）<input id="qsgb" type="number" min="1" max="999" step="1"></label><label class="qs-f s">小節ごと<input id="qsev" type="number" min="1" max="64" step="1"></label></div>
      <div class="qs-help">このショーにはまだ楽譜（パート）がないので、拍子と小節数から区切ります。楽譜を入れると、その小節線にぴったり合わせられます。</div>`}
      <div class="qs-tempo">テンポ: ${tempoLines.map(esc2).join(' ／ ')}</div>
    </div>
    <div class="qs-opts">
      <div class="qs-og"><span>セットの名前</span><label><input type="radio" name="qsnm" value="num"> 1, 2, 3…</label><label><input type="radio" name="qsnm" value="alpha"> A, B, C…</label><label class="songonly"><input type="radio" name="qsnm" value="bar"> 小節番号（m9 のように）</label></div>
      <div class="qs-og"><span>隊形</span><label><input type="radio" name="qscp" value="prev"> 直前のセットをコピー</label><label><input type="radio" name="qscp" value="hold"> 全員その場</label></div>
      <div class="qs-og"><span>入れる場所</span><label><input type="radio" name="qswh" value="after"> 今のセット（<b id="qsnow"></b>）の後ろ</label><label><input type="radio" name="qswh" value="end"> いちばん最後</label></div>
    </div>
    <div class="qs-prev"><div class="qs-strip" id="qsstrip" aria-label="作られるセットのプレビュー"></div><div class="qs-sum" id="qssum" role="status"></div><div class="qs-err" id="qserr" role="alert"></div></div>
  </div>
  <div class="ux-foot"><span class="sp"></span><button type="button" data-close>やめる</button><button type="button" class="pri" id="qsgo">作る</button></div>`;
  const q = id => $(id) || d.querySelector('#' + id);
  const setRadio = (name, v) => { const r = d.querySelector(`input[name="${name}"][value="${v}"]`); if (r) r.checked = true; };
  const getRadio = name => { const r = d.querySelector(`input[name="${name}"]:checked`); return r ? r.value : ''; };
  d.querySelector('#qssq').value = P.seq; d.querySelector('#qsbq').value = P.bars; d.querySelector('#qsmt').value = P.meter;
  const mt2 = d.querySelector('#qsmt2'); if (mt2) mt2.value = P.meter;
  const ev = d.querySelector('#qsev'); if (ev) ev.value = P.every;
  const gb = d.querySelector('#qsgb'); if (gb) gb.value = P.gridBars;
  const pt = d.querySelector('#qspt'); if (pt) pt.value = [...pt.options].some(o => o.value === P.part) ? P.part : '-1';
  setRadio('qsnm', P.names === 'bar' && P.tab !== 'song' ? 'num' : P.names); setRadio('qscp', P.copy); setRadio('qswh', P.where);
  d.querySelector('#qsnow').textContent = 'セット ' + setLbl(curSet);
  let tab = P.tab;
  const showTab_ = t => {
    tab = t;
    d.querySelectorAll('.qs-tabs button').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    d.querySelectorAll('.qs-pane').forEach(p => { p.hidden = p.dataset.pane !== t; });
    d.querySelectorAll('.songonly').forEach(l => { l.hidden = t !== 'song'; });
    if (t !== 'song' && getRadio('qsnm') === 'bar') setRadio('qsnm', 'num');
    if (t === 'song' && getRadio('qsnm') === 'num') setRadio('qsnm', 'bar');
    recompute();
    const f = d.querySelector(`.qs-pane[data-pane="${t}"] input[type=text],.qs-pane[data-pane="${t}"] input[type=number]`); if (f) f.focus();
  };
  let cur = null;
  function compute() {
    const where = getRadio('qswh'), after = qsAfterIdx(where), origin = qsOrigin(after);
    let res = {counts: [], errors: [], nameList: null};
    if (tab === 'counts') { const r = SC.parseCountSeq(d.querySelector('#qssq').value); res = {counts: r.counts, errors: r.errors.map(e => e.msg), nameList: null, ok: r.ok}; }
    else if (tab === 'bars') { const r = SC.parseBarSeq(d.querySelector('#qsbq').value, d.querySelector('#qsmt').value); res = {counts: r.counts, errors: r.errors.map(e => e.msg), nameList: null, ok: r.ok, bars: r.bars, perBar: r.perBar}; }
    else {
      const n = Math.max(1, Math.round(+d.querySelector('#qsev').value || 1));
      let bars, label, barBase = 0;
      if (hasParts) { bars = SC.barTimes(D, +d.querySelector('#qspt').value); label = '曲の終わり'; }
      else {
        const mtr = SC.parseMeter(d.querySelector('#qsmt2').value), total = Math.max(1, Math.round(+d.querySelector('#qsgb').value || 1));
        bars = []; for (let i = 0; i <= total; i++) bars.push(origin + i * mtr.perBar); label = `${total}小節め`; // 拍子だけのときは、今の位置を1小節めの頭として数える
        barBase = Math.floor(origin / mtr.perBar + 1e-9);
      }
      const bb = SC.barBoundaries(bars, n, origin), end = bars.length ? bars[bars.length - 1] : 0;
      if (end <= origin + 1e-6) res = {counts: [], errors: [`${label}（${SC.qsFmt(end)}カウント）は、ここ（${SC.qsFmt(origin)}カウント）より前です。入れる場所を変えるか、小節数を増やしてください`], ok: false};
      else {
        const bc = SC.boundsToCounts(origin, bb.points.map(p => p.t), end);
        res = {counts: bc.counts, errors: bc.counts.length ? [] : ['区切れるセットがありません'], ok: bc.counts.length > 0, nameList: bc.from.map(t => 'm' + (qsBarNo(bars, t) + barBase))};
      }
    }
    cur = Object.assign(res, {after, origin});
    return cur;
  }
  function recompute() {
    const r = compute(), errEl = d.querySelector('#qserr'), strip = d.querySelector('#qsstrip'), sum = d.querySelector('#qssum'), go = d.querySelector('#qsgo');
    errEl.innerHTML = r.errors.map(esc2).join('<br>');
    const total = r.counts.reduce((a, b) => a + b, 0), names = SC.makeNames(M.sets.map(s => s.name), r.counts.length, getRadio('qsnm') === 'bar' && r.nameList ? 'list' : getRadio('qsnm'), r.nameList);
    strip.innerHTML = r.counts.length ? r.counts.slice(0, 120).map((c, i) => `<div class="b" style="flex:${c} 1 0" title="セット ${esc2(names[i])}: ${SC.qsFmt(c)}カウント"><b>${esc2(names[i])}</b><span>${SC.qsFmt(c)}</span></div>`).join('') + (r.counts.length > 120 ? '<div class="b more">…</div>' : '') : '<div class="b empty">ここにプレビューが出ます</div>';
    const tempo = qsTempoAt(r.after);
    sum.textContent = r.counts.length ? `${r.counts.length}セット・合計 ${SC.qsFmt(total)} カウント（約 ${qsSecText(total * 60 / tempo)}）｜${SC.seqSummary(r.counts)}` : '';
    go.disabled = !r.counts.length || !!r.errors.length;
    go.textContent = r.counts.length ? `${r.counts.length}セットを作る` : '作る';
    r.names = names;
  }
  d.addEventListener('input', e => { if (e.target.closest('.qs-pane, .qs-opts')) recompute(); });
  d.addEventListener('change', e => { if (e.target.closest('.qs-opts, select')) recompute(); });
  d.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { d.close(); return; }
    const tb = e.target.closest('.qs-tabs [data-tab]'); if (tb) { showTab_(tb.dataset.tab); return; }
    const ex = e.target.closest('[data-ex]'); if (ex) { d.querySelector('#qssq').value = ex.dataset.ex; recompute(); d.querySelector('#qssq').focus(); return; }
    if (e.target.closest('#qsgo')) apply();
  });
  d.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && /^(INPUT|SELECT)$/.test(e.target.tagName) && e.target.type !== 'radio') { e.preventDefault(); apply(); } });
  d.addEventListener('close', () => { remember(); d.remove(); if (bulkDlg === d) bulkDlg = null; });
  function remember() {
    const p = qsPrefs();
    Object.assign(p, {tab, seq: d.querySelector('#qssq').value, bars: d.querySelector('#qsbq').value, meter: tab === 'song' && d.querySelector('#qsmt2') ? d.querySelector('#qsmt2').value : d.querySelector('#qsmt').value,
      names: getRadio('qsnm'), copy: getRadio('qscp'), where: getRadio('qswh'), every: ev ? +ev.value || 4 : p.every, part: pt ? pt.value : p.part, gridBars: gb ? +gb.value || 32 : p.gridBars});
    qsSavePrefs(p); lsSet('jk_qs_copy', p.copy);
  }
  function apply() {
    const r = compute(); recompute();
    if (!r.counts.length || r.errors.length) return;
    const style = getRadio('qsnm'), copy = getRadio('qscp');
    remember();
    d.close();
    const ok = qsInsertSets(r.counts, {after: r.after, copy, names: style === 'bar' && r.nameList ? 'list' : style, nameList: r.nameList});
    if (ok) scToast(`${r.counts.length}セットを作りました`, {undo: true, sub: `${SC.seqSummary(r.counts)}（合計 ${SC.qsFmt(r.counts.reduce((a, b) => a + b, 0))} カウント）。元に戻すのは1回です`, icon: 'bulk'});
  }
  showDlg(d);
  showTab_(P.tab);
}

// ---- タップで区切る: 再生しながら、新しいセットを始めたい瞬間に S キー ----
let tapDlg = null, tap = null;
function qsClick(ac, accent) {
  try {
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.frequency.value = accent ? 1560 : 1040; o.type = 'square';
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.09, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.06);
  } catch (e) { /* 音が出せない環境 */ }
}
function openTap() {
  if (!ready()) { scToast('エラーを直してから操作してください', {kind: 'info'}); return; }
  const P = qsPrefs(), D = R.data, hasParts = D.parts && D.parts.length > 0;
  const where = P.where === 'end' ? 'end' : 'after', after = qsAfterIdx(where), origin = qsOrigin(after), tempo0 = qsTempoAt(after);
  const d = tapDlg = mkDlg('qstap', 'qstap');
  d.innerHTML = `<button type="button" class="ghost x abs" data-close aria-label="閉じる">✕</button>
  <div class="ux-body qs-body">
    <h2 class="qs-t">${icon('tap', 22)} タップでセットを区切る</h2>
    <div class="qs-help">再生しながら、<b>新しいセットを始めたい瞬間</b>に <kbd class="kc">S</kbd> キー（または下の大きなボタン）を押します。終わったら <kbd class="kc">Enter</kbd> か「止める」。押した場所は 0.5 カウント単位に丸めて、セットにします。</div>
    <div class="qs-row">
      <label class="qs-f g">合図<select id="qstsrc"><option value="click">メトロノーム（クリック）</option>${hasParts ? '<option value="song">曲の音（楽譜のパート）</option>' : ''}</select></label>
      <label class="qs-f s" id="qstempolbl">テンポ<input id="qstempo" type="number" min="20" max="300" step="1"></label>
      <label class="qs-chk"><input type="checkbox" id="qscin"> カウントイン（4拍）</label>
    </div>
    <div class="qs-tapstage">
      <div class="qs-cnt"><span id="qstc">0</span><small>カウント</small></div>
      <button type="button" id="qstapbtn" class="qs-big" disabled>${icon('tap', 26)}<span>ここで区切る</span><kbd class="kc">S</kbd></button>
      <div class="qs-tbtns"><button type="button" class="pri" id="qstgo">${icon('play', 16)} はじめる</button><button type="button" id="qststop" disabled>${icon('stop', 16)} 止める</button><button type="button" id="qstreset" class="ghost" disabled>やり直す</button></div>
    </div>
    <div class="qs-prev"><div class="qs-strip" id="qstline" aria-label="区切りのプレビュー"></div><div class="qs-taps" id="qstaps"></div><div class="qs-sum" id="qstsum" role="status"></div></div>
    <div class="qs-opts"><div class="qs-og"><span>セットの名前</span><label><input type="radio" name="qstnm" value="num"> 1, 2, 3…</label><label><input type="radio" name="qstnm" value="alpha"> A, B, C…</label></div>
      <div class="qs-og"><span>隊形</span><label><input type="radio" name="qstcp" value="prev"> 直前のセットをコピー</label><label><input type="radio" name="qstcp" value="hold"> 全員その場</label></div></div>
  </div>
  <div class="ux-foot"><span class="sp"></span><button type="button" data-close>やめる</button><button type="button" class="pri" id="qstmake" disabled>この区切りでセットを作る</button></div>`;
  const $d = sel_ => d.querySelector(sel_);
  const radio = (n, v) => { const r = d.querySelector(`input[name="${n}"][value="${v}"]`); if (r) r.checked = true; };
  const getR = n => { const r = d.querySelector(`input[name="${n}"]:checked`); return r ? r.value : ''; };
  $d('#qstsrc').value = hasParts && P.tapSrc === 'song' ? 'song' : 'click';
  $d('#qstempo').value = P.tapTempo || tempo0; $d('#qscin').checked = !!P.countIn;
  radio('qstnm', P.names === 'alpha' ? 'alpha' : 'num'); radio('qstcp', P.copy);
  const T = tap = {origin, after, taps: [], end: null, running: false, count: 0, raf: 0, ac: null, lastBeat: -99, timers: []};
  const songEnd = () => (hasParts ? Math.max(...D.parts.map(p => p.end)) - origin : Infinity);
  const syncSrc = () => { $d('#qstempolbl').style.display = $d('#qstsrc').value === 'song' ? 'none' : ''; };
  syncSrc();
  function result() { if (T.end == null) return {counts: [], from: []}; return SC.tapsToCounts(T.taps, T.end); }
  function render() {
    const r = result(), names = SC.makeNames(M.sets.map(s => s.name), r.counts.length, getR('qstnm'));
    $d('#qstaps').innerHTML = T.taps.map((t, i) => `<span class="qs-tapchip">${SC.qsFmt(SC.qsRound(t))}<button type="button" data-rm="${i}" aria-label="この区切りを消す" title="この区切りを消す">×</button></span>`).join('') || '<span class="qs-none">まだ区切りがありません</span>';
    $d('#qstline').innerHTML = r.counts.length ? r.counts.map((c, i) => `<div class="b" style="flex:${c} 1 0" title="セット ${esc2(names[i])}: ${SC.qsFmt(c)}カウント"><b>${esc2(names[i])}</b><span>${SC.qsFmt(c)}</span></div>`).join('') : '<div class="b empty">止めると、ここに区切りが出ます</div>';
    $d('#qstsum').textContent = r.counts.length ? `${r.counts.length}セット・合計 ${SC.qsFmt(r.total)} カウント｜${SC.seqSummary(r.counts)}` : '';
    $d('#qstmake').disabled = !r.counts.length || T.running;
    $d('#qstmake').textContent = r.counts.length ? `この区切りで${r.counts.length}セットを作る` : 'この区切りでセットを作る';
    $d('#qstreset').disabled = T.running || (!T.taps.length && T.end == null);
  }
  function stopAll() {
    T.running = false; cancelAnimationFrame(T.raf); T.timers.forEach(clearTimeout); T.timers = [];
    try { jkAudio.stop(); } catch (e) { /* 鳴っていない */ }
    $d('#qstapbtn').disabled = true; $d('#qststop').disabled = true; $d('#qstgo').disabled = false; $d('#qstsrc').disabled = false; $d('#qstempo').disabled = false;
  }
  function finish(auto) {
    if (!T.running) return;
    const end = Math.max(0, T.count); T.end = Math.min(end, songEnd());
    stopAll(); render();
    if (!SC.tapsToCounts(T.taps, T.end).counts.length) scToast('区切る場所がありません', {kind: 'info', sub: '最初から終わりまでが短すぎます。もう一度やり直してください'});
  }
  function start() {
    if (T.running) return;
    T.taps = []; T.end = null; T.count = 0; T.lastBeat = -99;
    const song = $d('#qstsrc').value === 'song', bpm = Math.max(20, Math.min(300, +$d('#qstempo').value || tempo0)), cin = $d('#qscin').checked ? 4 : 0;
    try { T.ac = T.ac || new (window.AudioContext || window.webkitAudioContext)(); if (T.ac.state === 'suspended') T.ac.resume(); } catch (e) { T.ac = null; }
    stopPlay(); playT = null;
    T.running = true; $d('#qstapbtn').disabled = false; $d('#qststop').disabled = false; $d('#qstgo').disabled = true; $d('#qstsrc').disabled = true; $d('#qstempo').disabled = true;
    $d('#qstapbtn').focus();
    let last = performance.now(), c = -cin, audioOn = false;
    const tempoNow = () => song ? ((SC.setTimes(M)[after] && jkTempoAt(D, origin + Math.max(0, c))) || bpm) : bpm;
    const step = now => {
      if (!T.running) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      c += dt * tempoNow() / 60;
      if (song && c >= 0 && !audioOn) { audioOn = true; try { jkAudio.play(D, origin + Math.max(0, c)); } catch (e) { /* 音なし */ } }
      const beat = Math.floor(c + 1e-9);
      if (!song && T.ac && beat !== T.lastBeat) { qsClick(T.ac, ((beat % 4) + 4) % 4 === 0); T.lastBeat = beat; }
      else if (song && c < 0 && T.ac && beat !== T.lastBeat) { qsClick(T.ac, beat === -4); T.lastBeat = beat; }
      T.count = c;
      $d('#qstc').textContent = c < 0 ? 'カウントイン ' + Math.ceil(-c) : SC.qsFmt(Math.round(c * 10) / 10);
      $d('#qstc').parentNode.classList.toggle('cin', c < 0);
      if (c >= songEnd()) { T.count = songEnd(); finish(true); return; }
      T.raf = requestAnimationFrame(step);
    };
    T.raf = requestAnimationFrame(step);
    render();
  }
  function mark() {
    if (!T.running || T.count < 0.25) return false;
    T.taps.push(T.count);
    const b = $d('#qstapbtn'); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
    $d('#qstaps').innerHTML = T.taps.map(t => `<span class="qs-tapchip">${SC.qsFmt(SC.qsRound(t))}</span>`).join('');
    return true;
  }
  T.mark = mark;
  d.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { d.close(); return; }
    if (e.target.closest('#qstgo')) { start(); return; }
    if (e.target.closest('#qststop')) { finish(false); return; }
    if (e.target.closest('#qstapbtn')) { mark(); return; }
    if (e.target.closest('#qstreset')) { T.taps = []; T.end = null; $d('#qstc').textContent = '0'; render(); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { T.taps.splice(+rm.dataset.rm, 1); render(); return; }
    if (e.target.closest('#qstmake')) apply();
  });
  d.addEventListener('change', e => { if (e.target.id === 'qstsrc') syncSrc(); render(); });
  d.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const combo = SC.evCombo(e);
    if (INDEX.get(combo) === 'tap-mark' || (e.code === 'Space' && T.running)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) mark(); return; }
    if (e.key === 'Enter' && T.running) { e.preventDefault(); finish(false); return; }
    if (e.key === 'Escape' && T.running) { e.preventDefault(); e.stopPropagation(); T.taps = []; T.end = null; stopAll(); $d('#qstc').textContent = '0'; render(); }
  }, true);
  d.addEventListener('close', () => {
    stopAll(); const p = qsPrefs(); Object.assign(p, {tapSrc: $d('#qstsrc').value, tapTempo: +$d('#qstempo').value || '', countIn: $d('#qscin').checked, names: getR('qstnm'), copy: getR('qstcp')}); qsSavePrefs(p);
    try { if (T.ac) T.ac.close(); } catch (e) { /* 閉じられない */ }
    d.remove(); if (tapDlg === d) { tapDlg = null; tap = null; }
  });
  function apply() {
    const r = result(); if (!r.counts.length) return;
    const style = getR('qstnm'), copy = getR('qstcp');
    lsSet('jk_qs_copy', copy); d.close();
    if (qsInsertSets(r.counts, {after, copy, names: style})) scToast(`${r.counts.length}セットを作りました`, {undo: true, sub: `${SC.seqSummary(r.counts)}（タップで区切りました）。元に戻すのは1回です`, icon: 'tap'});
  }
  showDlg(d); render();
  $d('#qstgo').focus();
}
// ---- パレード（別機能）への入口 ----
function paradeRow() {
  if (!hasParade()) return '';
  return `<div class="qs-parade"><button type="button" data-parade>${icon('parade', 18)}<span><b>パレードを作る</b><small>行進の隊列移動を自動で組み立てます</small></span></button></div>`;
}
function addParadeRows() {
  for (const id of ['pset', 'pshow']) {
    const pane = $(id); if (!pane) continue;
    const old = pane.querySelector('.qs-parade'); if (old) old.remove();
    const h = paradeRow(); if (!h) continue;
    pane.insertAdjacentHTML('afterbegin', h);
  }
  const b = $('paradebtn');
  if (b) { b.hidden = !hasParade(); if (!b.hidden && !b.firstChild) b.innerHTML = icon('parade', 15) + '<span>パレードを作る</span>'; }
}

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
  $('selcopy').onclick = () => copySel();
  $('selpaste').onclick = () => openPastePop();
  $('splitbtn').onclick = () => splitOp('split');
  { const sb = $('splitbtn'), db = $('dupset'); if (sb) sb.innerHTML = icon('split', 15) + '<span class="tx">分割</span>'; if (db) db.innerHTML = icon('dup', 15) + '<span class="tx">複製</span>'; }
  $('splitmenu').onclick = () => splitMenu();
  $('seladd').onclick = () => addMembers(false);
  // 選択バーの 向き・姿勢… は、絵のアイコンにする（絵が無いときは線画のまま）
  if (typeof window.ic === 'function' && !window.__jkIconStub) {
    for (const [id, nm] of [['selface', 'face-front'], ['selpose', 'pose-attention'], ['selcarry', 'carry-play'], ['selstep', 'step-glide'], ['selaction', 'action-spin']]) {
      const b = $(id), svg0 = b && b.querySelector('svg'); if (b && svg0) { const h = window.ic(nm, 22); if (h && !/ph\b/.test(h)) svg0.outerHTML = h; }
    }
  }
  // ミニバー（選んだ人のそばのピル）の入り切り
  const cb = $('cbar');
  if (cb && !$('scfloatchk')) {
    const lab = document.createElement('label'); lab.title = '選んだ人のそばに、小さなツールバーを少し遅れて出します（人の丸の上にマウスがあるときやドラッグ中は隠れます）';
    lab.innerHTML = '<input type="checkbox" id="scfloatchk"> ミニバー';
    cb.insertBefore(lab, $('info'));
    $('scfloatchk').onchange = e => setFloat(e.target.checked);
    syncFloatChk();
    new MutationObserver(syncFloatChk).observe(document.body, {attributes: true, attributeFilter: ['class']});
  }
  // 「＋ セット」の ▾ とパレードの入口
  $('addsetmenu').onclick = e => { e.stopPropagation(); openQsPop(); };
  $('addsetmenu').setAttribute('aria-expanded', 'false');
  $('paradebtn').onclick = () => { if (hasParade()) window.jkOpenParade(); };
  document.addEventListener('click', e => { if (e.target.closest('[data-parade]') && hasParade()) window.jkOpenParade(); });
  wrapFn('renderSetPane', addParadeRows); wrapFn('renderShowPane', addParadeRows);
  addParadeRows(); window.addEventListener('load', addParadeRows); setTimeout(addParadeRows, 600); setTimeout(addParadeRows, 2000);
  window.scRefreshParade = addParadeRows;
  wrapFn('renderSecPane', enhanceSecPane);
  wrapFn('updateSel', () => { armFloat(); $$('#scmem .scchip').forEach(c => c.classList.toggle('on', sel.has(+c.dataset.i))); });
  wrapFn('drawCanvas', scheduleFloat);
  wrapFn('stopPlay', scheduleFloat);
  wrapFn('setTool', scheduleFloat);
  svg.addEventListener('pointerdown', () => { floatHover = false; clearTimeout(floatTimer); floatArmed = false; if (floatEl) floatEl.style.display = 'none'; }, true);
  svg.addEventListener('pointermove', e => { const on = !!(e.target.closest && e.target.closest('[data-i]')); if (on !== floatHover) { floatHover = on; if (on) { if (floatEl) floatEl.style.display = 'none'; } else armFloat(); } }, {passive: true});
  svg.addEventListener('pointerleave', () => { if (floatHover) { floatHover = false; armFloat(); } });
  document.addEventListener('pointerup', () => { if (sel.size) armFloat(); }, true);
  window.addEventListener('resize', scheduleFloat);
  try { new MutationObserver(scheduleFloat).observe(svg, {attributes: true, attributeFilter: ['viewBox']}); } catch (e) { /* 古いブラウザ */ }
  if (R) { try { enhanceSecPane(); } catch (e) { /* まだ */ } }
  // 「日本語で指示する」（src/cmd_ui.js）が、ここの部品を使う。操作そのものは、手でやるときと同じ部品を通る
  window.JKSCAPI = {SC, scToast, icon, esc2, ready, selIdx, selIds, allIds, commit, coreOpts, guarded, copySel, pasteSel, removeMembers, rotateSel, scaleSel, transformSel, selCenter, gotoSet, playFromSet, splitOp, playPoint, canSplitAt, copySets, pasteSetsOp, dupSetsOp, mirrorSetsOp, deleteSetsOp, setKs, BYID, execute, openPalette, closePalette, isMobileW, lsGet, lsSet, isTyping, MAC,
    labelOf: id => labelOf(id), runAction: id => { const a = BYID[id]; if (a && a.run) { a.run({}, ''); return true; } return false; }};
  if (window.JKCMDUI) JKCMDUI.init();
}
init();
})();
