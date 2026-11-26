// パレード自動作成のダイアログ。ロジックは parade.js（window.JKParade）。
// エディタのグローバル（M, R, edited, pushUndo, currentSource, printModel, curSet, numOf, notice, uxToast）をそのまま使う。
// 公開: window.jkOpenParade()
(function () {
'use strict';
const P = window.JKParade;
if (!P) return;
const $q = (r, s) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const num = v => { const n = typeof numOf === 'function' ? numOf(v) : parseFloat(v); return isFinite(n) ? n : NaN; };
const toast = (m, k) => { if (window.uxToast) window.uxToast(m, k || 'ok'); };

// ---------------- 状態 ----------------
const S = {
  step: 0,
  course: 'perimeter', margin: 0, pts: [], ccw: false, laps: 1, start: 'front',
  files: 0, fileGap: 1.2, rankGap: 2, order: [],
  pattern: 'wheel',
  stepKey: '6to5', stepCustom: 0.75, startHold: 8, halt: 16, endHold: 8, insert: 'append',
  cadence: false, cadGroup: '',
  speed: 4, fixed: null, gen: null, comp: null, firstIdx: 0, reqId: 0, raf: 0, t: 0, playing: true, lastTs: 0
};
let dlg = null, timer = 0;

// ---------------- パターンの絵 ----------------
// 64x44 の中に、動きを1本の線で描く。矢印つき
const ICONS = {
  wheel: '<rect x="9" y="8" width="46" height="28" rx="12" class="pl"/><path d="M26 8h8" class="ar"/>',
  gate: '<path d="M10 8H48Q56 8 56 16V36H16Q8 36 8 28Z" class="pl" opacity="0"/><path d="M12 8H52V36H12Z" class="pl"/><path d="M26 8h8" class="ar"/><circle cx="52" cy="8" r="2" class="dt"/>',
  flank: '<path d="M10 8H54V36H10Z" class="pl"/><path d="M28 8h8" class="ar"/><path d="M54 8l-4 4M54 36l-4-4M10 36l4-4M10 8l4 4" class="pl" opacity=".5"/>',
  counter: '<path d="M8 15H48Q56 15 56 22Q56 29 48 29H8" class="pl"/><path d="M30 15h8" class="ar"/>',
  serpentine: '<path d="M8 9H50Q57 9 57 16Q57 22 50 22H14Q7 22 7 29Q7 36 14 36H56" class="pl"/><path d="M26 9h8" class="ar"/>',
  eight: '<path d="M32 22C32 8 52 6 52 16C52 28 32 20 32 22C32 24 12 16 12 28C12 38 32 36 32 22Z" class="pl" opacity="0"/><path d="M32 22C42 10 56 12 56 22C56 32 42 34 32 22C22 10 8 12 8 22C8 32 22 34 32 22Z" class="pl"/><path d="M45 14h6" class="ar"/>',
  spiral: '<path d="M32 22m0 0a3 3 0 1 1 3 3a7 7 0 1 1-7-7a11 11 0 1 1 11 11a15 15 0 1 1-15-15" class="pl" transform="translate(0 0)"/>',
  review: '<path d="M8 36H56" class="pl" stroke-dasharray="2 3"/><path d="M14 8v14M24 8v14M34 8v14M44 8v14" class="pl" opacity=".35"/><circle cx="14" cy="36" r="2" class="dt"/><circle cx="24" cy="36" r="2" class="dt"/><circle cx="34" cy="36" r="2" class="dt"/><circle cx="44" cy="36" r="2" class="dt"/><circle cx="54" cy="36" r="2" class="dt"/><path d="M32 6v18" class="ar"/>',
  split: '<circle cx="19" cy="22" r="11" class="pl"/><circle cx="45" cy="22" r="11" class="pl"/><path d="M19 11h5M45 33h-5" class="ar"/>',
  company: '<path d="M6 34H58" class="pl" stroke-width="3"/><path d="M12 30V10M52 30V10M32 30V10" class="pl" opacity=".35"/><path d="M32 14V8" class="ar"/>',
  wedge: '<path d="M32 8L50 36H14Z" class="pl"/><path d="M32 8l2 5h-4Z" class="ar"/>',
  follow: '<path d="M8 14H48Q56 14 56 22Q56 30 48 30H12" class="pl" stroke-dasharray="1 4" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="30" r="2.2" class="dt"/><path d="M28 30h-6" class="ar"/>'
};
const iconSvg = (id, w) => `<svg viewBox="0 0 64 44" width="${w || 64}" height="${Math.round((w || 64) * 44 / 64)}" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(ICONS[id] || '').replace(/class="dt"/g, 'fill="currentColor" stroke="none"').replace(/class="ar"/g, 'stroke="var(--acc)" stroke-width="3.2" marker-end="url(#paar)"').replace(/class="pl"/g, '')}</g></svg>`;

const CSS = `
dialog.padlg{width:min(1080px,calc(100vw - 20px));height:min(740px,calc(100vh - 20px))}
.padlg .pa-main{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:16px;flex:1;min-height:0;padding:6px 22px 8px}
.padlg .pa-left{display:flex;flex-direction:column;min-height:0}
.padlg .pa-steps{display:flex;gap:6px;margin:4px 0 10px}
.padlg .pa-steps button{flex:1;border-radius:999px;padding:6px 8px;background:var(--panel2);color:var(--mut)}
.padlg .pa-steps button.on{background:var(--blue);border-color:var(--blue);color:#fff}
.padlg .pa-pane{flex:1;overflow:auto;min-height:0;padding-right:6px}
.padlg h3{margin:10px 0 6px;font-size:14px}
.padlg h3:first-child{margin-top:0}
.padlg .pa-row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:6px 0}
.padlg .pa-row label{display:flex;align-items:center;gap:6px}
.padlg .pa-row input[type=number]{width:72px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:3px 6px}
.padlg .pa-seg{display:inline-flex;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.padlg .pa-seg button{border:0;border-radius:0;background:var(--panel2);padding:5px 12px}
.padlg .pa-seg button.on{background:var(--blue);color:#fff}
.padlg .pa-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.padlg .pa-card{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:10px;background:var(--panel2);text-align:center;white-space:normal;line-height:1.25}
.padlg .pa-card svg{color:#aab6d0}
.padlg .pa-card.on{border-color:var(--acc);background:#2b2a1d}
.padlg .pa-card.on svg{color:var(--acc)}
.padlg .pa-card b{font-size:12px}
.padlg .pa-desc{margin-top:8px;padding:8px 10px;background:#1a1d23;border:1px solid var(--line);border-radius:8px;color:#cfd5df}
.padlg .pa-mut{color:var(--mut);font-size:12px}
.padlg .pa-order{display:flex;flex-direction:column;gap:4px;max-width:340px}
.padlg .pa-order div{display:flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:3px 6px}
.padlg .pa-order i{width:12px;height:12px;border-radius:50%;display:inline-block}
.padlg .pa-order span{flex:1}
.padlg .pa-order button{padding:0 8px}
.padlg .pa-right{display:flex;flex-direction:column;gap:8px;min-height:0}
.padlg .pa-map{background:#101319;border:1px solid var(--line);border-radius:10px;aspect-ratio:1/1;max-height:360px;width:100%}
.padlg .pa-map svg{width:100%;height:100%;display:block}
.padlg .pa-bar{display:flex;align-items:center;gap:8px}
.padlg .pa-bar input[type=range]{flex:1}
.padlg .pa-stat{font-size:12.5px;color:#d7dce6}
.padlg .pa-warn{font-size:12px;border-radius:8px;padding:6px 9px;background:#4a2a30;color:#ffd6d6}
.padlg .pa-ok{font-size:12px;border-radius:8px;padding:6px 9px;background:#1f3a2a;color:#cdf5d8}
.padlg .pa-err{font-size:12.5px;border-radius:8px;padding:8px 10px;background:#4a2a30;color:#ffd6d6}
.padlg .pa-note{font-size:12px;color:var(--mut)}
.padlg .pa-hint{font-size:12px;color:var(--acc);margin:4px 0}
.padlg .pa-map.pick{cursor:crosshair}
`;

// ---------------- 会場の絵 ----------------
function fieldInfo() {
  return window.JKParadeCore.venueOf(M.field || {type: 'gym', w: 30, d: 30}, {clearance: num(M.clearance), maxstep: num(M.maxstep)});
}
function mapBox(V) {
  if (V.type === 'football') return {x0: -90, x1: 90, y0: -6, y1: V.area.y1 + 6};
  if (V.type === 'gym') { const m = 3.5; return {x0: V.area.x0 - m, x1: V.area.x1 + m, y0: V.area.y0 - m, y1: V.area.y1 + m}; }
  const m = 2.5, wing = V.wing || 0; return {x0: V.area.x0 - wing - m, x1: V.area.x1 + wing + m, y0: V.area.y0 - m, y1: V.area.y1 + m};
}
function venueSvgBase(V) {
  const a = V.area;
  if (V.type === 'football') {
    let s = `<rect x="-84" y="0" width="168" height="${a.y1}" fill="#2e7d32" rx="1.5"/>`;
    for (let k = 0; k < 21; k++) s += `<line x1="${-80 + k * 8}" x2="${-80 + k * 8}" y1="0" y2="${a.y1}" stroke="#fff" stroke-opacity="${k % 5 === 0 ? .55 : .2}" stroke-width=".5"/>`;
    return s;
  }
  if (V.type === 'gym') {
    const hw = V.w / 2, hd = V.d / 2, m = 4.5;
    return `<rect x="${-hw - m}" y="${-hd - m}" width="${V.w + 2 * m}" height="${V.d + 2 * m}" fill="#5a4630" rx=".8"/><rect x="${-hw}" y="${-hd}" width="${V.w}" height="${V.d}" fill="#7b5b3a" stroke="#fff" stroke-opacity=".5" stroke-width=".25"/>`;
  }
  if (V.type === 'stage') {
    return `<rect x="${a.x0 - V.wing}" y="0" width="${V.w + 2 * V.wing}" height="${V.d}" fill="#2a2740"/><rect x="${a.x0}" y="0" width="${V.w}" height="${V.d}" fill="#3a3560"/>`;
  }
  return `<rect x="${a.x0}" y="0" width="${V.w}" height="${V.d}" fill="#3b4e63" rx=".6"/>`;
}
// 画面の絵（y は上が奥なので反転）。dots があれば動いている人を描く
function mapSvg(V, extra) {
  const b = mapBox(V), W = b.x1 - b.x0, H = b.y1 - b.y0;
  const r = Math.max(W, H) * (V.type === 'football' ? 0.0085 : 0.0095) * 1.05;
  return `<svg viewBox="${b.x0} ${-b.y1} ${W} ${H}" preserveAspectRatio="xMidYMid meet" id="pa-svg"><defs><marker id="paar" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0L4 2L0 4Z" fill="var(--acc)"/></marker></defs>
  <g transform="scale(1 -1)">${venueSvgBase(V)}<g id="pa-course">${extra || ''}</g><g id="pa-trail"></g><g id="pa-ranks"></g><g id="pa-dots" data-r="${r}"></g></g></svg>`;
}
// コースの目安線
function courseOverlay(V) {
  const marg = (S.margin || 0) / V.mpu, a = V.area, inset = V.inset + marg + 0.5;
  const x0 = a.x0 + inset, x1 = a.x1 - inset, y0 = a.y0 + inset, y1 = a.y1 - inset;
  const sw = (V.type === 'football' ? 1 : 0.35);
  let s = '';
  if (S.course === 'custom') {
    if (S.pts.length) s += `<polyline points="${S.pts.map(p => p.join(',')).join(' ')}${S.pts.length >= 3 ? ' ' + S.pts[0].join(',') : ''}" fill="none" stroke="#ffd23f" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}"/>` +
      S.pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${sw * 2.2}" fill="${i ? '#fff' : '#6fdc8c'}" stroke="#000" stroke-width="${sw * .4}"/>`).join('');
  } else if (S.course === 'oval') {
    const half = Math.min(x1 - x0, y1 - y0) / 2;
    s += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${half}" fill="none" stroke="#ffd23f" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}"/>`;
  } else if (S.course === 'straight') {
    const my = (y0 + y1) / 2;
    s += `<path d="M${x0} ${my - (y1 - y0) * .12}H${x1}M${x0} ${my + (y1 - y0) * .12}H${x1}" stroke="#ffd23f" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}"/>`;
  } else {
    s += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${V.type === 'football' ? 8 : 2}" fill="none" stroke="#ffd23f" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 2}"/>`;
  }
  if (S.course !== 'custom' && S.course !== 'straight') {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const st = {front: [mx, y0], back: [mx, y1], left: [x0, my], right: [x1, my]}[S.start] || [mx, y0];
    s += `<circle cx="${st[0]}" cy="${st[1]}" r="${sw * 2.6}" fill="#6fdc8c" stroke="#000" stroke-width="${sw * .4}"/>`;
  }
  return s;
}

// ---------------- 生成・プレビュー ----------------
function sectionsOf() {
  return (M.sections || []).map(s => ({id: s.id, n: Math.max(0, Math.round(num(s.n) || 0)), label: s.label, instrument: s.instrument}));
}
function ensureOrder() {
  const ids = sectionsOf().map(s => s.id);
  S.order = S.order.filter(i => ids.includes(i)).concat(ids.filter(i => !S.order.includes(i)));
}
const stepM = () => S.stepKey === '8to5' ? 0.5625 : S.stepKey === '6to5' ? 0.75 : Math.max(0.2, Math.min(1.2, +S.stepCustom || 0.75));
// いまのモデルのセットごとの位置（コンパイル結果）。追加位置の直前
function curBaseIdx() { return Math.max(0, Math.min(M.sets.length - 1, typeof curSet === 'number' ? curSet : 0)); }
function curPositions(secs) {
  const D = (typeof R !== 'undefined' && R) ? R.data : null; if (!D || !D.sets[curBaseIdx()]) return null;
  const pos = D.sets[curBaseIdx()].pos, off = {}; let o = 0;
  secs.forEach(s => { off[s.id] = o; o += s.n; });
  if (pos.length !== o) return null;
  const out = [];
  S.order.forEach(id => { const s = secs.find(x => x.id === id); if (s) for (let i = 0; i < s.n; i++) out.push(pos[off[id] + i]); });
  return out;
}
function genOpts() {
  const secs = sectionsOf();
  const o = {field: M.field || {type: 'gym', w: 30, d: 30}, sections: secs, order: S.order.slice(), pattern: S.pattern, ccw: S.ccw, stepM: stepM(), style: 'glide',
    laps: S.laps, files: S.files || null, fileGap: S.fileGap, rankGap: S.rankGap, halt: S.halt, endHold: S.endHold,
    course: {type: S.course === 'straight' ? 'perimeter' : S.course, margin: S.margin, pts: S.pts.map(p => p.slice())},
    start: S.course === 'custom' && S.pts.length ? {pt: S.pts[0].slice()} : {side: S.start},
    clearance: M.clearance, maxstep: M.maxstep};
  if (S.insert === 'append' && M.sets.length) { const cp = curPositions(secs); if (cp) { o.entry = 'near'; o.curPos = cp; } }
  return o;
}
// 結果のモデル（M の写しにセットを入れたもの）と、入れたセットの先頭番号
function buildModel() {
  ensureOrder();
  const o = genOpts();
  if (!sectionsOf().reduce((a, s) => a + s.n, 0)) return {ok: false, error: 'メンバーが0人です。先にセクションと人数を決めてください。'};
  const g = P.generate(o);
  if (!g.ok) return {ok: false, error: g.error};
  const m = JSON.parse(JSON.stringify(M));
  const base = curBaseIdx();
  let keep;
  if (S.insert === 'append' && m.sets.length) keep = m.sets.slice(0, base + 1);
  else if (S.insert === 'replace' && base > 0) keep = m.sets.slice(0, base);
  else keep = [];
  // セット名は生成した名前（「入場」「直進1」「角1」…）。すでにある名前とぶつかるときだけ枝番をつける
  const used = new Set(keep.map(s => String(s.name)));
  const newSets = g.sets.map((s, k) => {
    let nm = s.name || String(k + 1), j = 1;
    while (used.has(nm)) nm = `${s.name}-${++j}`;
    used.add(nm);
    const hold = k === 0 && S.startHold > s.hold ? S.startHold : s.hold;
    return {name: nm, counts: keep.length || k ? s.counts : 0, hold, mark: !!s.mark, tempo: null, note: [], tail: s.label && s.label !== s.name ? s.label : null, foot: [], stmts: s.stmts};
  });
  if (!keep.length) newSets[0].counts = 0; else if (!(+newSets[0].counts)) newSets[0].counts = 16;
  m.sets = keep.concat(newSets);
  const firstIdx = keep.length;
  if (S.cadence && S.cadGroup) {
    const startAt = keep.reduce((a, s) => a + (+s.counts || 0) + (+s.hold || 0), 0);
    const total = newSets.reduce((a, s) => a + (+s.counts || 0) + (+s.hold || 0), 0);
    const bars = Math.max(1, Math.ceil(total / 8));
    m.parts = (m.parts || []).filter(p => p.name !== 'パレードのビート');
    m.parts.push({name: 'パレードのビート', group: S.cadGroup, meter: '4/4', start: String(startAt), note: [],
      src: `repeat ${bars} {\n  8: R l r l R l r l |\n  8: R l r r L r l l |\n}`});
  }
  return {ok: true, model: m, firstIdx, gen: g, total: g.info.total, o, rankIds: g.rankIds};
}

async function refresh() {
  if (!dlg) return;
  const id = ++S.reqId;
  S.fixed = null;
  const V = fieldInfo();
  const mapEl = $q(dlg, '.pa-map');
  const st = $q(dlg, '.pa-stat'), wn = $q(dlg, '.pa-wn');
  mapEl.innerHTML = mapSvg(V, courseOverlay(V));
  mapEl.classList.toggle('pick', S.course === 'custom' && S.step === 0);
  let b;
  try { b = buildModel(); } catch (e) { b = {ok: false, error: '作成中に問題が起きました: ' + (e && e.message || e)}; console.error(e); }
  S.gen = b; S.comp = null;
  if (!b.ok) { st.textContent = ''; wn.innerHTML = `<div class="pa-err">${esc(b.error)}</div>`; setApply(false); return; }
  wn.innerHTML = '<div class="pa-note">計算しています…</div>';
  let r;
  try { r = await fetch('/api/compile', {method: 'POST', body: printModel(b.model)}).then(x => x.json()); } catch (e) { r = {ok: false, error: {msg: 'エンジンに接続できません'}}; }
  if (id !== S.reqId || !dlg) return;
  if (!r.ok) { wn.innerHTML = `<div class="pa-err">作成した内容を読み込めませんでした: ${esc(r.error && r.error.msg)}</div>`; setApply(false); return; }
  S.comp = r.data;
  showResult();
  startAnim();
  if (parWarnings(S.comp, b.firstIdx).length) autoFixPreview(true);
}
function parWarnings(D, firstIdx) {
  return (D.warnings || []).filter(w => ['衝突', '大股', '場外'].includes(w.kind) && w.set >= Math.max(0, firstIdx - 0));
}
function showResult() {
  const D = S.comp, b = S.gen, V = fieldInfo();
  const w = parWarnings(D, b.firstIdx);
  const tempo = D.tempo || 120;
  const counts = b.model.sets.slice(b.firstIdx).reduce((a, s) => a + (+s.counts || 0) + (+s.hold || 0), 0);
  const sec = counts * 60 / tempo, mm = Math.floor(sec / 60), ss = Math.round(sec % 60);
  const nS = b.model.sets.length - b.firstIdx;
  $q(dlg, '.pa-stat').innerHTML = `<b>${nS}セット</b>・合計 <b>${counts}カウント</b>（テンポ${tempo}で約${mm ? mm + '分' : ''}${ss}秒）・${b.gen.info.N}人${b.gen.info.follow ? '・1列縦隊' : b.gen.info.ranks && b.gen.info.F ? `・横${b.gen.info.F}人 × 前後${b.gen.info.ranks}列` : ''}` +
    (b.gen.info.entryCounts ? `<br>いまの隊形から ${b.gen.info.entryCounts}カウントで入り口へ移動します` : '');
  const notes = (b.gen.notes || []).map(n => `<div class="pa-note">${esc(n)}</div>`).join('');
  let h;
  if (!w.length) h = '<div class="pa-ok">ぶつかり・大股・場外は見つかりませんでした</div>';
  else {
    const k = {}; w.forEach(x => { k[x.kind] = (k[x.kind] || 0) + 1; });
    h = `<div class="pa-warn">注意: ${Object.keys(k).map(a => a + ' ' + k[a] + '件').join('・')}<br><span class="pa-note">${esc(w[0].msg)}</span><br><button type="button" id="pa-fix" class="pri" style="margin-top:6px">自動で直す</button></div>`;
  }
  $q(dlg, '.pa-wn').innerHTML = h + notes;
  const fx = $q(dlg, '#pa-fix'); if (fx) fx.onclick = () => autoFixPreview(false);
  setApply(true);
}
async function autoFixPreview(auto) {
  const b = S.gen, fx = $q(dlg, '#pa-fix'); if (!b || !b.ok) return;
  const id0 = S.reqId;
  if (fx) { fx.disabled = true; fx.textContent = '探しています…'; }
  else $q(dlg, '.pa-wn').insertAdjacentHTML('afterbegin', '<div class="pa-note" id="pa-fixing">ぶつかりを自動で直しています…</div>');
  let r; try { r = await fetch('/api/fix', {method: 'POST', body: printModel(b.model)}).then(x => x.json()); } catch (e) { r = {ok: false, error: '自動修正に失敗しました'}; }
  if (!dlg || id0 !== S.reqId) return;
  const fixing = $q(dlg, '#pa-fixing'); if (fixing) fixing.remove();
  if (!r.ok || !r.notes || !r.notes.length || r.after >= r.before) {
    if (fx) { fx.disabled = false; fx.textContent = '自動で直す'; }
    if (!auto) toast(r.ok ? '自動で直せる組み合わせは見つかりませんでした' : String(r.error || '自動修正に失敗しました'), 'info');
    return;
  }
  const id = ++S.reqId;
  let c; try { c = await fetch('/api/compile', {method: 'POST', body: printModel(r.model)}).then(x => x.json()); } catch (e) { c = {ok: false}; }
  if (id !== S.reqId || !c.ok) return;
  S.fixed = r.model; S.comp = c.data; S.gen = Object.assign({}, b, {model: r.model});
  showResult();
  $q(dlg, '.pa-wn').insertAdjacentHTML('afterbegin', `<div class="pa-ok">ぶつかりを自動で直しました（衝突 ${r.before}件 → ${r.after}件）。この結果を入れます</div>`);
  startAnim();
}
function setApply(on) { const a = $q(dlg, '#pa-apply'); if (a) a.disabled = !on; }

// ---------------- アニメーション ----------------
function startAnim() {
  cancelAnimationFrame(S.raf);
  const D = S.comp; if (!D || !dlg) return;
  const b = S.gen, V = fieldInfo();
  const t0 = D.sets[Math.min(D.sets.length - 1, Math.max(0, b.firstIdx))].start;
  const t1 = D.total != null ? D.total : D.sets[D.sets.length - 1].start + D.sets[D.sets.length - 1].counts + (D.sets[D.sets.length - 1].hold || 0);
  S.t0 = Math.max(0, t0); S.t1 = t1; S.t = S.t0;
  const rg = $q(dlg, '#pa-seek'); rg.min = S.t0; rg.max = S.t1; rg.step = 0.1; rg.value = S.t0;
  // 先頭の人の軌跡
  const lead = 0, pts = [];
  for (let t = S.t0; t <= S.t1; t += 0.5) pts.push(jkState(D, lead, t).p);
  const sw = V.type === 'football' ? 0.9 : 0.3;
  const tr = $q(dlg, '#pa-trail');
  if (tr) tr.innerHTML = `<polyline points="${pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ')}" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="${sw}"/>`;
  const g = $q(dlg, '#pa-dots'), r = +g.dataset.r;
  g.innerHTML = D.performers.map((p, i) => `<circle r="${r}" fill="${D.sections[p.sec].color || '#ccc'}" stroke="#0008" stroke-width="${r * .25}"/>`).join('');
  // 隊列の横列を、うすい線で結ぶ（パレードの隊形として読めるように）
  const rk = $q(dlg, '#pa-ranks'), idx = {}; D.performers.forEach((p, i) => { idx[p.id] = i; });
  S.rankIdx = (b.rankIds || []).map(g => g.map(id => idx[id]).filter(i => i != null)).filter(g => g.length > 1);
  if (rk) rk.innerHTML = S.rankIdx.map(() => `<polyline fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="${r * 0.55}" stroke-linejoin="round"/>`).join('');
  S.lastTs = 0;
  const frame = ts => {
    if (!dlg || !dlg.open) return;
    if (S.playing) {
      if (S.lastTs) S.t += (ts - S.lastTs) / 1000 * (D.tempo / 60) * S.speed;
      if (S.t > S.t1) S.t = S.t0;
    }
    S.lastTs = ts;
    paint(D);
    S.raf = requestAnimationFrame(frame);
  };
  S.raf = requestAnimationFrame(frame);
  paint(D);
}
function paint(D) {
  const g = $q(dlg, '#pa-dots'); if (!g) return;
  const cs = g.children;
  for (let i = 0; i < cs.length; i++) { const p = jkState(D, i, S.t).p; cs[i].setAttribute('cx', p[0].toFixed(3)); cs[i].setAttribute('cy', p[1].toFixed(3)); }
  const rk = $q(dlg, '#pa-ranks');
  if (rk && S.rankIdx) { const pl = rk.children; S.rankIdx.forEach((g, q) => { if (pl[q]) pl[q].setAttribute('points', g.map(i => { const p = jkState(D, i, S.t).p; return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ')); }); }
  const rg = $q(dlg, '#pa-seek'); if (rg && S.playing) rg.value = S.t;
  const k = D.sets[jkSetAt(D, S.t)];
  const lb = $q(dlg, '#pa-lbl'); if (lb) lb.textContent = `セット ${k ? k.name : ''}　${Math.round(S.t - S.t0)} / ${Math.round(S.t1 - S.t0)} カウント`;
}

// ---------------- 画面（各ステップ） ----------------
const seg = (name, opts, cur) => `<span class="pa-seg" data-seg="${name}">${opts.map(o => `<button type="button" data-v="${esc(o[0])}" class="${String(o[0]) === String(cur) ? 'on' : ''}">${esc(o[1])}</button>`).join('')}</span>`;
function pane0() {
  const V = fieldInfo();
  const hint = S.course === 'custom' ? `<div class="pa-hint">右の会場図を順にクリックして、通りたい道の角を打ちます（${S.pts.length}点）。最初の点が出発点です。<button type="button" id="pa-undo" style="margin-left:6px">1点戻す</button><button type="button" id="pa-clear" style="margin-left:4px">消す</button></div>` : '';
  return `<h3>コース</h3>
  <div class="pa-row">${seg('course', [['perimeter', '会場の外周'], ['oval', '楕円トラック'], ['straight', '直線の往復'], ['custom', '自分で描く']], S.course)}</div>
  ${hint}
  ${S.course === 'perimeter' || S.course === 'oval' ? `<div class="pa-row"><label>外周の内側に ${'<input type="number" id="pa-margin" min="0" max="30" step="0.5" value="' + S.margin + '">'} ${V.unit === '歩' ? '歩' : 'm'} あける</label></div>` : ''}
  ${S.course === 'straight' ? '<div class="pa-note">会場の端から端まで行って、向きを変えずに（カウンターマーチで）戻ります。パターンは「折り返し」になります。</div>' : ''}
  <h3>出発と向き</h3>
  <div class="pa-row">${seg('ccw', [['0', '時計回り'], ['1', '反時計回り']], S.ccw ? '1' : '0')}
  ${S.course !== 'custom' ? seg('start', [['front', '手前（客席側）'], ['left', '左'], ['back', '奥'], ['right', '右']], S.start) : '<span class="pa-note">出発点 = 最初にクリックした点</span>'}</div>
  <div class="pa-row"><label>周回数 ${seg('laps', [['1', '1周'], ['2', '2周'], ['3', '3周']], S.laps)}</label></div>
  <div class="pa-note">「次へ」で隊列・パターンを決めます。右の図は、いまの設定でできあがる動きのプレビューです。</div>`;
}
function pane1() {
  ensureOrder();
  const secs = sectionsOf(), total = secs.reduce((a, s) => a + s.n, 0);
  const col = id => { const s = (M.sections || []).find(x => x.id === id); return (S.comp && S.comp.sections.find(x => x.id === id) || {}).color || (s && s.color) || '#999'; };
  return `<h3>隊列（${total}人）</h3>
  <div class="pa-row"><label>横に並ぶ人数（列の幅）</label>${seg('files', [['0', '自動'], ['4', '4'], ['5', '5'], ['6', '6'], ['8', '8']], S.files)}</div>
  <div class="pa-row"><label>横の間隔 <input type="number" id="pa-fgap" min="0.6" max="4" step="0.1" value="${S.fileGap}"> m</label>
  <label>前後の間隔 <input type="number" id="pa-rgap" min="0.8" max="6" step="0.1" value="${S.rankGap}"> m</label></div>
  <h3>セクションの並び順（前から）</h3>
  <div class="pa-order">${S.order.map((id, i) => { const s = secs.find(x => x.id === id); return `<div><i style="background:${esc(col(id))}"></i><span>${esc(s.label || id)}（${s.n}人）</span><button type="button" data-up="${i}" ${i ? '' : 'disabled'}>▲</button><button type="button" data-dn="${i}" ${i < S.order.length - 1 ? '' : 'disabled'}>▼</button></div>`; }).join('')}</div>
  <div class="pa-note" style="margin-top:6px">先頭に並べたセクションが行進の先頭になります（旗やトランペットを前に、打楽器を後ろに、など）。</div>`;
}
function pane2() {
  const cur = P.PATTERNS.find(p => p.id === S.pattern) || P.PATTERNS[0];
  return `<h3>パターン（${P.PATTERNS.length}種類）</h3>
  <div class="pa-cards">${P.PATTERNS.map(p => `<button type="button" class="pa-card ${p.id === S.pattern ? 'on' : ''}" data-pat="${p.id}" title="${esc(p.name)}">${iconSvg(p.icon, 72)}<b>${esc(p.short)}</b></button>`).join('')}</div>
  <div class="pa-desc"><b>${esc(cur.name)}</b><br>${esc(cur.desc)}</div>`;
}
function pane3() {
  const secs = sectionsOf();
  const drum = secs.find(s => /snare|tenors|bass|cymbal/.test(s.instrument || '')) || secs[secs.length - 1];
  if (!S.cadGroup && drum) S.cadGroup = drum.id;
  return `<h3>テンポと歩幅</h3>
  <div class="pa-row">${seg('stepKey', [['8to5', '8to5（0.56m）'], ['6to5', '6to5（0.75m）'], ['custom', 'ほかの値']], S.stepKey)}
  ${S.stepKey === 'custom' ? `<label><input type="number" id="pa-stepc" min="0.3" max="1.1" step="0.05" value="${S.stepCustom}"> m / 1カウント</label>` : ''}</div>
  <div class="pa-note">テンポは曲全体の設定（${esc(M.tempo)}）を使います。歩幅は1カウントで進む距離です。</div>
  <h3>カウント</h3>
  <div class="pa-row"><label>出発前の足踏み <input type="number" id="pa-sh" min="0" max="32" step="4" value="${S.startHold}"> カウント</label>
  <label>停止・整列のカウント <input type="number" id="pa-halt" min="4" max="64" step="4" value="${S.halt}"></label>
  <label>おわりの足踏み <input type="number" id="pa-eh" min="0" max="32" step="4" value="${S.endHold}"></label></div>
  <h3>入れる場所</h3>
  <div class="pa-row">${seg('insert', [['append', 'いまのセットの後ろに足す'], ['replace', 'いまのセットから置きかえる'], ['new', 'ショー全体を置きかえる']], S.insert)}</div>
  <div class="pa-note">${S.insert === 'append' ? '最初に、いまの隊形から入り口の隊形まで動くセットが入ります。' : S.insert === 'replace' ? '「いまのセット」以降は消えて、パレードに入れ替わります（元に戻せます）。' : 'いまあるセットはすべて消えて、パレードだけのショーになります（元に戻せます）。'}</div>
  <h3>行進のビート（任意）</h3>
  <div class="pa-row"><label><input type="checkbox" id="pa-cad" ${S.cadence ? 'checked' : ''}> ストリートビートを入れる</label>
  <label>演奏する人 <select id="pa-cadg">${secs.map(s => `<option value="${esc(s.id)}" ${s.id === S.cadGroup ? 'selected' : ''}>${esc(s.label || s.id)}</option>`).join('')}</select></label></div>
  <div class="pa-note">スネアなどが、行進のあいだ中、基本の8ビートを叩く楽譜（part）を足します。</div>`;
}
const PANES = [pane0, pane1, pane2, pane3];
const STEP_NAMES = ['① コース', '② 隊列', '③ パターン', '④ 歩幅・入れ方'];

function render() {
  if (!dlg) return;
  const pane = $q(dlg, '.pa-pane');
  pane.innerHTML = PANES[S.step]();
  dlg.querySelectorAll('.pa-steps button').forEach((b, i) => b.classList.toggle('on', i === S.step));
  $q(dlg, '#pa-back').disabled = S.step === 0;
  $q(dlg, '#pa-next').style.display = S.step === 3 ? 'none' : '';
  $q(dlg, '#pa-map').classList.toggle('pick', S.course === 'custom' && S.step === 0);
}
function changed(redrawPane) { if (redrawPane) render(); clearTimeout(timer); timer = setTimeout(refresh, 120); }

function onClick(e) {
  const t = e.target;
  const sg = t.closest('[data-seg]');
  if (sg && t.closest('button')) {
    const name = sg.dataset.seg, v = t.closest('button').dataset.v;
    if (name === 'course') { S.course = v; if (v === 'straight') S.pattern = 'counter'; else if (S.pattern === 'counter' && S.course !== 'straight') S.pattern = 'wheel'; }
    else if (name === 'ccw') S.ccw = v === '1';
    else if (name === 'start') S.start = v;
    else if (name === 'laps') S.laps = +v;
    else if (name === 'files') S.files = +v;
    else if (name === 'stepKey') { S.stepKey = v; S.touchedStep = true; }
    else if (name === 'insert') S.insert = v;
    changed(true); return;
  }
  const up = t.closest('[data-up]'), dn = t.closest('[data-dn]');
  if (up) { const i = +up.dataset.up; [S.order[i - 1], S.order[i]] = [S.order[i], S.order[i - 1]]; changed(true); return; }
  if (dn) { const i = +dn.dataset.dn; [S.order[i + 1], S.order[i]] = [S.order[i], S.order[i + 1]]; changed(true); return; }
  const pc = t.closest('[data-pat]');
  if (pc) { S.pattern = pc.dataset.pat; if (S.pattern !== 'counter' && S.course === 'straight') S.course = 'perimeter'; changed(true); return; }
  if (t.closest('#pa-undo')) { S.pts.pop(); changed(true); return; }
  if (t.closest('#pa-clear')) { S.pts = []; changed(true); return; }
}
function onInput(e) {
  const t = e.target, id = t.id;
  if (id === 'pa-margin') S.margin = Math.max(0, +t.value || 0);
  else if (id === 'pa-fgap') S.fileGap = Math.max(0.6, +t.value || 1.2);
  else if (id === 'pa-rgap') S.rankGap = Math.max(0.8, +t.value || 2);
  else if (id === 'pa-stepc') S.stepCustom = +t.value || 0.75;
  else if (id === 'pa-sh') S.startHold = Math.max(0, +t.value || 0);
  else if (id === 'pa-halt') S.halt = Math.max(4, +t.value || 16);
  else if (id === 'pa-eh') S.endHold = Math.max(0, +t.value || 0);
  else if (id === 'pa-cad') S.cadence = t.checked;
  else if (id === 'pa-cadg') S.cadGroup = t.value;
  else if (id === 'pa-seek') { S.playing = false; S.t = +t.value; $q(dlg, '#pa-play').textContent = '▶'; if (S.comp) paint(S.comp); return; }
  else if (id === 'pa-speed') { S.speed = +t.value; return; }
  else return;
  changed(false);
}
function onMapClick(e) {
  if (S.course !== 'custom' || S.step !== 0) return;
  const svg = $q(dlg, '#pa-svg'); if (!svg) return;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(svg.getScreenCTM().inverse());
  const V = fieldInfo(), snap = V.type === 'football' ? 2 : 0.5;
  let x = Math.round(q.x / snap) * snap, y = Math.round(-q.y / snap) * snap;
  const a = V.area, ins = V.inset + 0.5;
  x = Math.max(a.x0 + ins, Math.min(a.x1 - ins, x)); y = Math.max(a.y0 + ins, Math.min(a.y1 - ins, y));
  S.pts.push([x, y]);
  changed(true);
}

// ---------------- 反映 ----------------
function apply() {
  const b = S.gen; if (!b || !b.ok || !S.comp) return;
  const m = S.fixed || b.model;
  pushUndo(currentSource());
  M = m; // 以前の M を丸ごと置きかえ（1回の操作として元に戻せる）
  curSet = Math.max(0, Math.min(M.sets.length - 1, b.firstIdx));
  if (typeof curStmt !== 'undefined') curStmt = -1;
  edited(true);
  const n = M.sets.length - b.firstIdx;
  close();
  toast(`パレードを ${n}セット入れました（元に戻すで取り消せます）`, 'ok');
}

function close() {
  cancelAnimationFrame(S.raf); clearTimeout(timer); S.reqId++;
  if (dlg) { try { dlg.close(); } catch (e) { /* 閉じていた */ } dlg.remove(); dlg = null; }
}

function open() {
  if (typeof M === 'undefined' || !M) { if (typeof notice === 'function') notice('先にショー（陣形ファイル）を開くか、新しく作ってください'); return; }
  if (dlg) close();
  if (!document.getElementById('pa-css')) { const st = document.createElement('style'); st.id = 'pa-css'; st.textContent = CSS; document.head.appendChild(st); }
  S.step = 0; S.fixed = null; S.pts = []; S.playing = true;
  if (S.course === 'custom') S.course = 'perimeter';
  ensureOrder();
  const defaultStep = (M.field && M.field.type === 'football') ? '8to5' : '6to5';
  if (!S.touchedStep) S.stepKey = defaultStep;
  dlg = document.createElement('dialog'); dlg.className = 'uxdlg padlg';
  dlg.innerHTML = `<div class="ux-head"><div><h2>パレードを自動で作る</h2><p>コースと隊列とパターンを選ぶだけで、一周ぶんのセットとカウントを作ります</p></div><button type="button" class="ghost x" data-close aria-label="閉じる">✕</button></div>
  <div class="pa-main">
    <div class="pa-left"><div class="pa-steps">${STEP_NAMES.map((n, i) => `<button type="button" data-step="${i}">${n}</button>`).join('')}</div><div class="pa-pane"></div></div>
    <div class="pa-right">
      <div class="pa-map" id="pa-map"></div>
      <div class="pa-bar"><button type="button" id="pa-play" aria-label="再生・停止">❚❚</button><input type="range" id="pa-seek" min="0" max="1" value="0"><select id="pa-speed"><option value="1">×1</option><option value="2">×2</option><option value="4" selected>×4</option><option value="8">×8</option></select></div>
      <div class="pa-note" id="pa-lbl"></div>
      <div class="pa-stat"></div>
      <div class="pa-wn"></div>
    </div>
  </div>
  <div class="ux-foot"><button type="button" id="pa-back">← 戻る</button><button type="button" id="pa-next" class="pri">次へ →</button><span class="sp"></span><button type="button" data-close>やめる</button><button type="button" id="pa-apply" class="pri" disabled>ショーに入れる</button></div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { close(); return; }
    const sb = e.target.closest('[data-step]'); if (sb) { S.step = +sb.dataset.step; render(); refreshMapOnly(); return; }
    if (e.target.closest('#pa-back')) { S.step = Math.max(0, S.step - 1); render(); refreshMapOnly(); return; }
    if (e.target.closest('#pa-next')) { S.step = Math.min(3, S.step + 1); render(); refreshMapOnly(); return; }
    if (e.target.closest('#pa-apply')) { apply(); return; }
    if (e.target.closest('#pa-play')) { S.playing = !S.playing; $q(dlg, '#pa-play').textContent = S.playing ? '❚❚' : '▶'; S.lastTs = 0; return; }
    if (e.target.closest('#pa-svg') && S.course === 'custom' && S.step === 0) { onMapClick(e); return; }
    onClick(e);
  });
  dlg.addEventListener('input', onInput);
  dlg.addEventListener('change', e => { if (e.target.id === 'pa-stepc') S.touchedStep = true; });
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('close', () => { cancelAnimationFrame(S.raf); });
  try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  render();
  refresh();
}
function refreshMapOnly() { const m = $q(dlg, '#pa-map'); if (m) m.classList.toggle('pick', S.course === 'custom' && S.step === 0); }

window.jkOpenParade = open;
window.JKParadeUI = {state: S, buildModel, refresh, apply, close};
})();
