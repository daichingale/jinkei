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
  step: 0, pattern: 'contest', parts: {lap: 1, center: 1, mark: 1}, ccw: true,
  corner: 'pinseq', seq: true, counts: 8,
  files: 0, fileGap: 1.25, rankGap: 1.25, order: [],
  stepKey: 'm5', stepCustom: 0.625,
  dm: 'new', dmTurn: 'U', markCounts: 32, markPivot: 'none',
  startHold: 0, endHold: 8, insert: 'append', cadence: false, cadGroup: '',
  speed: 4, fixed: null, gen: null, comp: null, firstIdx: 0, reqId: 0, raf: 0, t: 0, playing: true, lastTs: 0
};
let dlg = null, timer = 0;

// ---------------- 絵（64x44 に動きを1本の線で） ----------------
const ICONS = {
  contest: '<rect x="8" y="6" width="34" height="24" rx="4" class="pl"/><path d="M20 6h8" class="ar"/><path d="M26 36H58" class="pl" stroke-dasharray="2 3"/><circle cx="46" cy="36" r="2" class="dt"/><circle cx="52" cy="36" r="2" class="dt"/>',
  lap: '<rect x="9" y="8" width="46" height="28" rx="3" class="pl"/><path d="M26 8h8" class="ar"/>',
  center: '<path d="M8 22H46Q56 22 56 26Q56 30 46 30H8" class="pl"/><path d="M24 22h8" class="ar"/>',
  mark: '<path d="M14 10v10M24 10v10M34 10v10M44 10v10M14 20h30" class="pl" opacity=".4"/><circle cx="14" cy="34" r="2.4" class="dt"/><circle cx="24" cy="34" r="2.4" class="dt"/><circle cx="34" cy="34" r="2.4" class="dt"/><circle cx="44" cy="34" r="2.4" class="dt"/><path d="M54 30l-6-6" class="ar" opacity="0"/>',
  free: '<path d="M10 12h14M10 22h24M10 32h34" class="pl"/><circle cx="50" cy="12" r="3" class="dt"/><circle cx="50" cy="22" r="3" class="dt"/><circle cx="50" cy="32" r="3" class="dt"/>',
  pinseq: '<path d="M8 34H34Q50 34 50 18V6" class="pl" opacity=".35"/><path d="M8 28H30Q42 28 42 16V6M8 22H26Q34 22 34 14V6" class="pl"/><path d="M8 34h6" class="ar"/>',
  pinblock: '<rect x="10" y="22" width="20" height="14" class="pl"/><rect x="38" y="6" width="14" height="20" class="pl"/><path d="M34 34Q46 34 46 30" class="ar"/><circle cx="30" cy="22" r="2" class="dt"/>',
  column: '<path d="M8 32H28Q50 32 50 10" class="pl"/><path d="M8 26H26Q42 26 42 10" class="pl" opacity=".6"/><path d="M8 32h6" class="ar"/>'
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
.padlg .pa-right{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding-right:4px}
.padlg .pa-map{flex:none}
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
.padlg .pa-chks{margin-top:6px;display:flex;flex-direction:column;gap:2px;font-size:12.5px}
.padlg .pa-chk.ok b{color:#6fdc8c}
.padlg .pa-chk.ng b{color:#ff8a8a}
`;

// ---------------- 会場の絵 ----------------
function fieldInfo() {
  return window.JKParadeCore.venueOf(M.field || {type: 'gym', w: 30, d: 30}, {clearance: num(M.clearance), maxstep: num(M.maxstep)});
}
function mapBox(V) {
  if (V.type === 'gym') { const m = 3.5; return {x0: V.area.x0 - m, x1: V.area.x1 + m, y0: V.area.y0 - m, y1: V.area.y1 + m}; }
  const m = 2.5; return {x0: V.area.x0 - m, x1: V.area.x1 + m, y0: V.area.y0 - m, y1: V.area.y1 + m};
}
// 20m ライン・センターライン・5m の点（体育館の演技フロア）
function floorLines(V) {
  let fl; try { fl = window.JKParadeCore.floorOf(V); } catch (e) { return ''; }
  const sw = 0.18, c = fl.cx, d = fl.cy;
  let s = `<rect x="${c - fl.ix}" y="${d - fl.iy}" width="${2 * fl.ix}" height="${2 * fl.iy}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="${sw * 1.4}"/>`;
  s += `<path d="M${c - fl.hx} ${d}H${c + fl.hx}M${c} ${d - fl.hy}V${d + fl.hy}" stroke="#fff" stroke-opacity=".6" stroke-width="${sw}"/>`;
  for (let x = -fl.hx; x <= fl.hx + 1e-6; x += 5) for (let y = -fl.hy; y <= fl.hy + 1e-6; y += 5) s += `<circle cx="${c + x}" cy="${d + y}" r=".22" fill="#fff" fill-opacity=".7"/>`;
  return s;
}
function venueSvgBase(V) {
  const a = V.area;
  if (V.type === 'gym') {
    const hw = V.w / 2, hd = V.d / 2, m = 4.5;
    return `<rect x="${-hw - m}" y="${-hd - m}" width="${V.w + 2 * m}" height="${V.d + 2 * m}" fill="#5a4630" rx=".8"/><rect x="${-hw}" y="${-hd}" width="${V.w}" height="${V.d}" fill="#7b5b3a" stroke="#fff" stroke-opacity=".5" stroke-width=".25"/>`;
  }
  return `<rect x="${a.x0}" y="${a.y0}" width="${V.w}" height="${V.d}" fill="#3b4e63" rx=".6"/>`;
}
function mapSvg(V, extra) {
  const b = mapBox(V), W = b.x1 - b.x0, H = b.y1 - b.y0;
  const r = Math.max(W, H) * 0.0095 * 1.05;
  return `<svg viewBox="${b.x0} ${-b.y1} ${W} ${H}" preserveAspectRatio="xMidYMid meet" id="pa-svg"><defs><marker id="paar" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0L4 2L0 4Z" fill="var(--acc)"/></marker></defs>
  <g transform="scale(1 -1)">${venueSvgBase(V)}<g id="pa-course">${extra || ''}</g><g id="pa-trail"></g><g id="pa-ranks"></g><g id="pa-dots" data-r="${r}"></g></g></svg>`;
}

// ---------------- 生成・プレビュー ----------------
function sectionsOf() {
  return (M.sections || []).map(s => ({id: s.id, n: Math.max(0, Math.round(num(s.n) || 0)), label: s.label, instrument: s.instrument}));
}
function ensureOrder() {
  const ids = sectionsOf().map(s => s.id);
  S.order = S.order.filter(i => ids.includes(i)).concat(ids.filter(i => !S.order.includes(i)));
}
const STEPS = {m5: 0.625, '6to5': 0.75, '8to5': 0.5625};
const stepM = () => S.stepKey === 'custom' ? Math.max(0.3, Math.min(1.1, +S.stepCustom || 0.625)) : STEPS[S.stepKey] || 0.625;
const method = () => S.seq ? (S.corner === 'pinblock' ? 'pinseq' : S.corner) : 'pinblock';
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
  const hasDm = secs.some(s => s.id === 'dm' && s.n >= 1);
  let dm = S.dm; if (dm === 'new' && hasDm) dm = 'sec:dm';
  const o = {field: M.field || {type: 'gym', w: 30, d: 30}, sections: secs, order: S.order.slice(), pattern: S.pattern, parts: Object.assign({}, S.parts), ccw: S.ccw,
    corner: method(), cornerCounts: S.counts, stepM: stepM(), style: 'glide', files: S.files || null, fileGap: S.fileGap, rankGap: S.rankGap,
    dm, dmTurn: S.dmTurn, markCounts: S.markCounts, markPivot: S.markPivot, startHold: S.startHold, endHold: S.endHold, clearance: M.clearance, maxstep: M.maxstep};
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
  // ドラムメジャー（新しいセクション）は最後のセクションとして足す。前のセットには出発位置を書き足す
  (g.extraSections || []).forEach(e => {
    const idx = m.sections.length;
    m.sections.push({id: e.id, label: e.label, n: e.n, color: null, instrument: null, note: [], tail: null});
    const slot = g.slotMem.indexOf(g.mem.findIndex(mm => mm.s === e.id));
    const p = g.F[slot];
    if (keep.length) keep[0].stmts.push({idx: [idx], group: e.id, shape: {kind: 'at', p: p.slice()}, xf: [], assign: null, wait: null, within: null, bend: null, face: null, step: null, action: null, pose: null, carry: null, note: [], tail: null});
  });
  const used = new Set(keep.map(s => String(s.name)));
  const newSets = g.sets.map((s, k) => {
    let nm = s.name || String(k + 1), j = 1;
    if (s.sub) nm = '';
    else while (used.has(nm)) nm = `${s.name}-${++j}`;
    used.add(nm);
    return {name: nm, counts: keep.length || k ? s.counts : 0, hold: s.hold, mark: !!s.mark, sub: !!s.sub, tempo: null, note: [], tail: s.tail || null, foot: [], stmts: s.stmts};
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
  mapEl.innerHTML = mapSvg(V, floorLines(V));
  let b;
  try { b = buildModel(); } catch (e) { b = {ok: false, error: '作成中に問題が起きました: ' + (e && e.message || e)}; console.error(e); }
  S.gen = b; S.comp = null;
  if (!b.ok) { st.textContent = ''; wn.innerHTML = `<div class="pa-err">${esc(b.error)}</div>`; setApply(false); cancelAnimationFrame(S.raf); return; }
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
// 規定課題のチェックリスト（parade.js の validate）
function checklistHtml(D, b) {
  let v;
  try { v = P.validate(b.gen, D, jkState, b.firstIdx); } catch (e) { return ''; }
  const label = {ring: '外側の列が 20m ライン上か外側', nostop: '①の間、止まらず行進', return: '出発位置に戻る', uturn: '180°ターンの前後に 2 歩以上の直進', mark: '足踏みが連続 32 歩以上'};
  const rows = v.checks.filter(c => label[c.id]).map(c => `<div class="pa-chk ${c.ok ? 'ok' : 'ng'}"><b>${c.ok ? '✓' : '✗'}</b> ${esc(c.label)}<span class="pa-note"> ${esc(c.detail)}</span></div>`).join('');
  return rows ? `<div class="pa-chks"><div class="pa-note">規定課題のチェック</div>${rows}</div>` : '';
}
function showResult() {
  const D = S.comp, b = S.gen;
  const w = parWarnings(D, b.firstIdx);
  const tempo = D.tempo || 120;
  const counts = b.model.sets.slice(b.firstIdx).reduce((a, s) => a + (+s.counts || 0) + (+s.hold || 0), 0);
  const sec = counts * 60 / tempo, mm = Math.floor(sec / 60), ss = Math.round(sec % 60);
  const nS = b.model.sets.length - b.firstIdx, inf = b.gen.info;
  $q(dlg, '.pa-stat').innerHTML = `<b>${nS}セット</b>・合計 <b>${counts}カウント</b>（テンポ${tempo}で約${mm ? mm + '分' : ''}${ss}秒）・${inf.N}人・横${inf.F}列 × 前後${inf.R}段` +
    (inf.parts && inf.parts.lap ? `<br>角: ${esc(inf.method_name)} ${inf.Neff}拍${inf.Nreq !== inf.Neff ? '（希望 ' + inf.Nreq + '拍）' : ''}` : '') +
    (inf.entryCounts ? `<br>いまの隊形から ${inf.entryCounts}カウントで入り口へ移動します` : '');
  const notes = (b.gen.notes || []).map(n => `<div class="pa-note">${esc(n)}</div>`).join('');
  let h;
  if (!w.length) h = '<div class="pa-ok">ぶつかり・大股・場外は見つかりませんでした</div>';
  else {
    const k = {}; w.forEach(x => { k[x.kind] = (k[x.kind] || 0) + 1; });
    h = `<div class="pa-warn">注意: ${Object.keys(k).map(a => a + ' ' + k[a] + '件').join('・')}<br><span class="pa-note">${esc(w[0].msg)}</span><br><button type="button" id="pa-fix" class="pri" style="margin-top:6px">自動で直す</button></div>`;
  }
  $q(dlg, '.pa-wn').innerHTML = h + checklistHtml(D, b) + notes;
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

// ---------------- アニメーション（段をそろえた線つき） ----------------
function startAnim() {
  cancelAnimationFrame(S.raf);
  const D = S.comp; if (!D || !dlg) return;
  const b = S.gen, V = fieldInfo();
  const t0 = D.sets[Math.min(D.sets.length - 1, Math.max(0, b.firstIdx))].start;
  const t1 = D.total != null ? D.total : D.sets[D.sets.length - 1].start + D.sets[D.sets.length - 1].counts + (D.sets[D.sets.length - 1].hold || 0);
  S.t0 = Math.max(0, t0); S.t1 = t1; S.t = S.t0;
  const rg = $q(dlg, '#pa-seek'); rg.min = S.t0; rg.max = S.t1; rg.step = 0.1; rg.value = S.t0;
  const idx = {}; D.performers.forEach((p, i) => { idx[p.id] = i; });
  const info = b.gen.info, g0 = b.gen;
  // 外側の列（o = 0）の先頭の人の軌跡
  const outer = g0.slotMem.map((mi, slot) => (info.roles[slot].o < 1e-9 && !info.roles[slot].dm && info.roles[slot].k === 0 ? g0.mem[mi].id : null)).filter(Boolean)[0];
  const lead = outer != null && idx[outer] != null ? idx[outer] : 0, pts = [];
  for (let t = S.t0; t <= S.t1; t += 0.5) pts.push(jkState(D, lead, t).p);
  const tr = $q(dlg, '#pa-trail');
  if (tr) tr.innerHTML = `<polyline points="${pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ')}" fill="none" stroke="#ffd23f" stroke-opacity=".8" stroke-width=".22" stroke-dasharray=".7 .5"/>`;
  const g = $q(dlg, '#pa-dots'), r = +g.dataset.r;
  g.innerHTML = D.performers.map((p, i) => `<circle r="${r}" fill="${D.sections[p.sec].color || '#ccc'}" stroke="#0008" stroke-width="${r * .25}"/>`).join('');
  const rk = $q(dlg, '#pa-ranks');
  S.rankIdx = (b.rankIds || []).map(gg => gg.map(id => idx[id]).filter(i => i != null)).filter(gg => gg.length > 1);
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
  if (rk && S.rankIdx) { const pl = rk.children; S.rankIdx.forEach((gg, q) => { if (pl[q]) pl[q].setAttribute('points', gg.map(i => { const p = jkState(D, i, S.t).p; return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' ')); }); }
  const rg = $q(dlg, '#pa-seek'); if (rg && S.playing) rg.value = S.t;
  const k = D.sets[jkSetAt(D, S.t)];
  const lb = $q(dlg, '#pa-lbl'); if (lb) lb.textContent = `セット ${k ? k.name : ''}　${Math.round(S.t - S.t0)} / ${Math.round(S.t1 - S.t0)} カウント`;
}

// ---------------- 画面（各ステップ） ----------------
const seg = (name, opts, cur) => `<span class="pa-seg" data-seg="${name}">${opts.map(o => `<button type="button" data-v="${esc(o[0])}" class="${String(o[0]) === String(cur) ? 'on' : ''}">${esc(o[1])}</button>`).join('')}</span>`;
function pane0() {
  const cur = P.PATTERNS.find(p => p.id === S.pattern) || P.PATTERNS[0];
  const free = S.pattern === 'free';
  return `<h3>やること（規定課題）</h3>
  <div class="pa-cards">${P.PATTERNS.map(p => `<button type="button" class="pa-card ${p.id === S.pattern ? 'on' : ''}" data-pat="${p.id}" title="${esc(p.name)}">${iconSvg(p.icon, 72)}<b>${esc(p.short)}</b></button>`).join('')}</div>
  <div class="pa-desc"><b>${esc(cur.name)}</b><br>${esc(cur.desc)}</div>
  ${free ? `<div class="pa-row"><label><input type="checkbox" data-part="lap" ${S.parts.lap ? 'checked' : ''}> ①外周一周</label><label><input type="checkbox" data-part="center" ${S.parts.center ? 'checked' : ''}> ②センターライン往復</label><label><input type="checkbox" data-part="mark" ${S.parts.mark ? 'checked' : ''}> ③足踏み</label></div>` : ''}
  <h3>向き</h3>
  <div class="pa-row">${seg('ccw', [['1', '反時計回り（左回り）'], ['0', '時計回り（右回り）']], S.ccw ? '1' : '0')}</div>
  <div class="pa-note">①は体育館の演技フロア（20m の四角形ラインの外側）で行います。出発は手前（客席側）の一辺です。</div>`;
}
function pane1() {
  ensureOrder();
  const secs = sectionsOf(), total = secs.reduce((a, s) => a + s.n, 0);
  const col = id => { const s = (M.sections || []).find(x => x.id === id); return (S.comp && S.comp.sections.find(x => x.id === id) || {}).color || (s && s.color) || '#999'; };
  const inf = S.gen && S.gen.ok ? S.gen.gen.info : null;
  const hasDm = secs.some(s => s.id === 'dm' && s.n >= 1);
  return `<h3>隊列（${total}人）</h3>
  <div class="pa-row"><label>横の列の数（3列以上）</label>${seg('files', [['0', '自動'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['8', '8']], S.files)}${inf ? `<span class="pa-note">→ 横${inf.F}列 × 前後${inf.R}段</span>` : ''}</div>
  <div class="pa-row"><label>列の間隔（横） ${seg('fgap', [['1.25', '2歩'], ['1.875', '3歩'], ['2.5', '4歩']], S.fileGap)}</label>
  <label>段の間隔（前後） ${seg('rgap', [['1.25', '2歩'], ['1.875', '3歩'], ['2.5', '4歩']], S.rankGap)}</label></div>
  <h3>歩幅とテンポ</h3>
  <div class="pa-row">${seg('stepKey', [['m5', '62.5cm（8to5・5m=8歩）'], ['6to5', '75cm'], ['custom', 'ほかの値']], S.stepKey)}
  ${S.stepKey === 'custom' ? `<label><input type="number" id="pa-stepc" min="0.3" max="0.78" step="0.025" value="${S.stepCustom}"> m / 1カウント</label>` : ''}</div>
  <div class="pa-note">テンポは曲全体の設定（${esc(M.tempo)}）を使います。62.5cm は 5m ちょうど 8 歩で、位置が 5m の点にそろいます。</div>
  <h3>ドラムメジャー</h3>
  <div class="pa-row">${seg('dm', hasDm ? [['sec:dm', '「ドラムメジャー」セクションを使う'], ['none', 'なし']] : [['new', 'いれる（先頭に1人足す）'], ['none', 'なし']], hasDm && S.dm === 'new' ? 'sec:dm' : S.dm)}
  ${S.dm !== 'none' ? `<label>②のターン ${seg('dmTurn', [['U', 'Uターン'], ['I', 'Iターン（直角）']], S.dmTurn)}</label>` : ''}</div>
  <h3>セクションの並び順（前から）</h3>
  <div class="pa-order">${S.order.map((id, i) => { const s = secs.find(x => x.id === id); return `<div><i style="background:${esc(col(id))}"></i><span>${esc(s.label || id)}（${s.n}人）</span><button type="button" data-up="${i}" ${i ? '' : 'disabled'}>▲</button><button type="button" data-dn="${i}" ${i < S.order.length - 1 ? '' : 'disabled'}>▼</button></div>`; }).join('')}</div>`;
}
function pane2() {
  const parts = S.pattern === 'free' ? S.parts : (P.PATTERN_BY[S.pattern] || {}).parts || {};
  const m = P.METHOD_BY[method()];
  const lapOn = !!parts.lap;
  return `<h3>①の角の曲がり方${lapOn ? '' : '（①を入れないときは使いません）'}</h3>
  <div class="pa-row"><label>順番に回る（段ごとに時間差で） ${seg('seq', [['1', 'ON'], ['0', 'OFF（ブロック全体で回る）']], S.seq ? '1' : '0')}</label></div>
  ${S.seq ? `<div class="pa-cards">${['pinseq', 'column'].map(id => { const q = P.METHOD_BY[id]; return `<button type="button" class="pa-card ${method() === id ? 'on' : ''}" data-cor="${id}">${iconSvg(q.icon, 72)}<b>${esc(q.short)}</b></button>`; }).join('')}</div>` : `<div class="pa-cards"><button type="button" class="pa-card on" data-cor="pinblock">${iconSvg('pinblock', 72)}<b>${esc(P.METHOD_BY.pinblock.short)}</b></button></div>`}
  <div class="pa-desc"><b>${esc(m.name)}</b><br>${esc(m.desc)}</div>
  <div class="pa-row"><label>角の拍数 ${seg('counts', method() === 'column' ? [['0', '最小'], ['4', '4'], ['8', '8'], ['12', '12'], ['16', '16']] : [['4', '4'], ['8', '8'], ['12', '12'], ['16', '16']], S.counts)}</label></div>
  <div class="pa-note">人数や幅が大きくて希望の拍数では回りきれないときは、足りる拍数に自動で増やして、その旨を右に表示します。</div>
  <h3>③の足踏み</h3>
  <div class="pa-row"><label>足踏みの歩数（32 歩以上） <input type="number" id="pa-mk" min="32" max="96" step="4" value="${S.markCounts}"></label>
  <label>足踏みしながら ${seg('pivot', [['none', '向きを変えない'], ['kami', '上手向きに回る'], ['shimo', '下手向きに回る']], S.markPivot)}</label></div>`;
}
function pane3() {
  const secs = sectionsOf();
  const drum = secs.find(s => /snare|tenors|bass|cymbal/.test(s.instrument || '')) || secs[secs.length - 1];
  if (!S.cadGroup && drum) S.cadGroup = drum.id;
  return `<h3>カウント</h3>
  <div class="pa-row"><label>出発前の足踏み <input type="number" id="pa-sh" min="0" max="32" step="4" value="${S.startHold}"> カウント</label>
  <label>①のあとの停止・整列 <input type="number" id="pa-eh" min="0" max="32" step="4" value="${S.endHold}"> カウント</label></div>
  <h3>入れる場所</h3>
  <div class="pa-row">${seg('insert', [['append', 'いまのセットの後ろに足す'], ['replace', 'いまのセットから置きかえる'], ['new', 'ショー全体を置きかえる']], S.insert)}</div>
  <div class="pa-note">${S.insert === 'append' ? '最初に、いまの隊形から出発位置の隊形まで動くセットが入ります。' : S.insert === 'replace' ? '「いまのセット」以降は消えて、パレードに入れ替わります（元に戻せます）。' : 'いまあるセットはすべて消えて、パレードだけのショーになります（元に戻せます）。'}</div>
  <h3>行進のビート（任意）</h3>
  <div class="pa-row"><label><input type="checkbox" id="pa-cad" ${S.cadence ? 'checked' : ''}> ストリートビートを入れる</label>
  <label>演奏する人 <select id="pa-cadg">${secs.map(s => `<option value="${esc(s.id)}" ${s.id === S.cadGroup ? 'selected' : ''}>${esc(s.label || s.id)}</option>`).join('')}</select></label></div>
  <div class="pa-note">スネアなどが、行進のあいだ中、基本の8ビートを叩く楽譜（part）を足します。</div>`;
}
const PANES = [pane0, pane1, pane2, pane3];
const STEP_NAMES = ['① やること', '② 隊列', '③ 角・足踏み', '④ 入れ方'];

function render() {
  if (!dlg) return;
  const pane = $q(dlg, '.pa-pane');
  pane.innerHTML = PANES[S.step]();
  dlg.querySelectorAll('.pa-steps button').forEach((b, i) => b.classList.toggle('on', i === S.step));
  $q(dlg, '#pa-back').disabled = S.step === 0;
  $q(dlg, '#pa-next').style.display = S.step === 3 ? 'none' : '';
}
function changed(redrawPane) { if (redrawPane) render(); clearTimeout(timer); timer = setTimeout(refresh, 120); }

function onClick(e) {
  const t = e.target;
  const sg = t.closest('[data-seg]');
  if (sg && t.closest('button')) {
    const name = sg.dataset.seg, v = t.closest('button').dataset.v;
    if (name === 'ccw') S.ccw = v === '1';
    else if (name === 'files') S.files = +v;
    else if (name === 'fgap') S.fileGap = +v;
    else if (name === 'rgap') S.rankGap = +v;
    else if (name === 'stepKey') S.stepKey = v;
    else if (name === 'dm') S.dm = v;
    else if (name === 'dmTurn') S.dmTurn = v;
    else if (name === 'seq') { S.seq = v === '1'; if (S.seq && S.corner === 'pinblock') S.corner = 'pinseq'; }
    else if (name === 'counts') S.counts = +v;
    else if (name === 'pivot') S.markPivot = v;
    else if (name === 'insert') S.insert = v;
    changed(true); return;
  }
  const up = t.closest('[data-up]'), dn = t.closest('[data-dn]');
  if (up) { const i = +up.dataset.up; [S.order[i - 1], S.order[i]] = [S.order[i], S.order[i - 1]]; changed(true); return; }
  if (dn) { const i = +dn.dataset.dn; [S.order[i + 1], S.order[i]] = [S.order[i], S.order[i + 1]]; changed(true); return; }
  const pc = t.closest('[data-pat]');
  if (pc) { S.pattern = pc.dataset.pat; if (S.pattern === 'free' && !S.parts.lap && !S.parts.center && !S.parts.mark) S.parts = {lap: 1, center: 0, mark: 0}; changed(true); return; }
  const cc = t.closest('[data-cor]');
  if (cc) { S.corner = cc.dataset.cor; changed(true); return; }
}
function onInput(e) {
  const t = e.target, id = t.id;
  if (t.dataset && t.dataset.part) { S.parts[t.dataset.part] = t.checked ? 1 : 0; changed(false); return; }
  if (id === 'pa-stepc') S.stepCustom = +t.value || 0.625;
  else if (id === 'pa-mk') S.markCounts = Math.max(32, Math.round(+t.value || 32));
  else if (id === 'pa-sh') S.startHold = Math.max(0, +t.value || 0);
  else if (id === 'pa-eh') S.endHold = Math.max(0, +t.value || 0);
  else if (id === 'pa-cad') S.cadence = t.checked;
  else if (id === 'pa-cadg') S.cadGroup = t.value;
  else if (id === 'pa-seek') { S.playing = false; S.t = +t.value; $q(dlg, '#pa-play').textContent = '▶'; if (S.comp) paint(S.comp); return; }
  else if (id === 'pa-speed') { S.speed = +t.value; return; }
  else return;
  changed(false);
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
  S.step = 0; S.fixed = null; S.playing = true;
  ensureOrder();
  dlg = document.createElement('dialog'); dlg.className = 'uxdlg padlg';
  dlg.innerHTML = `<div class="ux-head"><div><h2>パレードを自動で作る（マーチングコンテスト規定課題）</h2><p>①四角形ラインを一周 → ②センターラインで180°ターン → ③32歩以上の足踏み。直線にそって、拍を決めて順番に歩きます</p></div><button type="button" class="ghost x" data-close aria-label="閉じる">✕</button></div>
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
    const sb = e.target.closest('[data-step]'); if (sb) { S.step = +sb.dataset.step; render(); return; }
    if (e.target.closest('#pa-back')) { S.step = Math.max(0, S.step - 1); render(); return; }
    if (e.target.closest('#pa-next')) { S.step = Math.min(3, S.step + 1); render(); return; }
    if (e.target.closest('#pa-apply')) { apply(); return; }
    if (e.target.closest('#pa-play')) { S.playing = !S.playing; $q(dlg, '#pa-play').textContent = S.playing ? '❚❚' : '▶'; S.lastTs = 0; return; }
    onClick(e);
  });
  dlg.addEventListener('input', onInput);
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.addEventListener('close', () => { cancelAnimationFrame(S.raf); });
  try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  render();
  refresh();
}

window.jkOpenParade = open;
window.JKParadeUI = {state: S, buildModel, refresh, apply, close};
})();
