// 会場の2D描画（プレビューとエディタで共用）
// 座標: フィールド単位。SVG の y は下向きなので Y(y) で反転する
function jkField(svg, F) {
if (svg.__jkFieldOff) svg.__jkFieldOff();
const FB = F.type === 'football';
let X0, X1, Y0, Y1;
if (FB) { X0 = -100; X1 = 100; Y0 = -7; Y1 = F.bsl + 5; }
else if (F.type === 'gym') { const hw = F.w/2 + F.margin, hd = F.d/2 + F.margin; X0 = -hw - 1; X1 = hw + 1; Y0 = -hd - 2.2; Y1 = hd + 2; }
else if (F.type === 'stage') { X0 = -F.w/2 - F.wing - 0.8; X1 = F.w/2 + F.wing + 0.8; Y0 = -3; Y1 = F.d + 1.8; }
else { X0 = -F.w/2 - 1.5; X1 = F.w/2 + 1.5; Y0 = -2; Y1 = F.d + 1.2; }
svg.setAttribute('viewBox', `${X0} 0 ${X1 - X0} ${Y1 - Y0}`);
const Y = y => Y1 - y;
function el(tag, attrs, parent) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }
function text(x, y, s, size, attrs, parent) { const t = el('text', Object.assign({x, y: Y(y), 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff'}, attrs || {}), parent); t.textContent = s; return t; }

// ---- フィールド ----
const bg = el('g', {});
if (FB) {
  el('rect', {x: -96, y: Y(F.bsl), width: 192, height: F.bsl, fill: '#2e7d32'}, bg);
  el('rect', {x: -96, y: Y(F.bsl), width: 16, height: F.bsl, fill: '#256628'}, bg);
  el('rect', {x: 80, y: Y(F.bsl), width: 16, height: F.bsl, fill: '#256628'}, bg);
  for (let k = -10; k <= 10; k++) {
    const x = k * 8, yl = 50 - Math.abs(k) * 5;
    if (yl % 10 === 0 && yl > 0) {
      text(x, 9, String(yl), 3.4, {opacity: 0.85, 'font-weight': 700}, bg);
      text(x, F.bsl - 9, String(yl), 3.4, {opacity: 0.85, 'font-weight': 700, transform: `rotate(180 ${x} ${Y(F.bsl - 9)})`}, bg);
    }
  }
  text(0, -3.6, '▼ 客席（フロントサイドライン側）', 2.4, {fill: '#9aa0aa'}, bg);
  text(-88, -3.6, 'サイド1', 2.2, {fill: '#9aa0aa'}, bg); text(88, -3.6, 'サイド2', 2.2, {fill: '#9aa0aa'}, bg);
} else if (F.type === 'gym') {
  const hw = F.w/2 + F.margin, hd = F.d/2 + F.margin;
  el('rect', {x: -hw, y: Y(hd), width: hw*2, height: hd*2, fill: '#6f5336'}, bg);
  el('rect', {x: -F.w/2, y: Y(F.d/2), width: F.w, height: F.d, fill: '#94714a'}, bg);
  el('rect', {x: -hw, y: Y(hd), width: hw*2, height: hd*2, fill: 'none', stroke: '#444', 'stroke-width': 0.5}, bg);
  text(0, -hd - 1.1, '▼ 客席', 0.9, {fill: '#9aa0aa'}, bg);
} else if (F.type === 'stage') {
  const ww = F.w/2 + F.wing;
  el('rect', {x: -ww, y: Y(F.d), width: ww*2, height: F.d, fill: '#2a2420'}, bg);
  el('rect', {x: -F.w/2, y: Y(F.d), width: F.w, height: F.d, fill: '#4a3b30'}, bg);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const x = sx * (F.w/2 + 0.2 + k * F.wing / 3);
    el('rect', {x: x - 0.15, y: Y(F.d * (0.25 + 0.25 * k)), width: 0.3, height: F.d * 0.22, fill: '#111', opacity: 0.9}, bg);
  }
  el('path', {d: `M -0.3 ${Y(0)} L 0.3 ${Y(0)} L 0 ${Y(0.45)} Z`, fill: '#ffd23f'}, bg);
  text(-F.w/2 - F.wing/2, F.d + 0.9, '下手袖', 0.6, {fill: '#9aa0aa'}, bg); text(F.w/2 + F.wing/2, F.d + 0.9, '上手袖', 0.6, {fill: '#9aa0aa'}, bg);
  text(0, -1.4, '▼ 客席（舞台前端）', 0.6, {fill: '#9aa0aa'}, bg);
} else {
  el('rect', {x: -F.w/2, y: Y(F.d), width: F.w, height: F.d, fill: '#5b4a3a'}, bg);
  text(0, -1, '▼ 客席', 0.6, {fill: '#9aa0aa'}, bg);
}

// ---- グリッドと白線（ズームのたびに、画面の画素にそろえて描き直す）----
// すべて「会場の中心（または舞台前端の中央）」を原点にした等間隔の格子。1本ずつ画素の位置に丸めるので、どの倍率でも間隔が±1px以内でそろう。
// 細かい 1m(football は 1歩) → 2.5m(4歩) → 5m(8歩) の順に、拡大するほど細かい線が薄く現れる。
const dyn = el('g', {'pointer-events': 'none'}, bg);
const mkP = (shape) => el('path', {fill: 'none', 'vector-effect': 'non-scaling-stroke', 'shape-rendering': shape || 'crispEdges'}, dyn);
const gMinor = mkP(), gHalf = mkP(), gMajor = mkP(), gPts = mkP(), gTapeS = mkP(), gTape = mkP(), gTapeB = mkP();
const lab = el('g', {}, dyn);
let G;
if (FB) G = {x0: -96, x1: 96, y0: 0, y1: F.bsl, minor: 1, half: 4, major: 8, eps: 1, mr: {fine: [5, 9], normal: [13, 20]}, hr: [1.5, 3.5], u: '歩'};
else if (F.type === 'gym') G = {x0: -F.w/2, x1: F.w/2, y0: -F.d/2, y1: F.d/2, minor: 1, half: 0, major: 5, eps: 1, mr: {fine: [7, 12], normal: [20, 32]}, hr: [4, 8], u: 'm'};
else if (F.type === 'stage') G = {x0: -F.w/2, x1: F.w/2, y0: 0, y1: F.d, minor: 1, half: 0, major: 5, eps: 1, mr: {fine: [7, 12], normal: [20, 32]}, hr: [4, 8], u: 'm'};
else G = {x0: -F.w/2, x1: F.w/2, y0: 0, y1: F.d, minor: 1, half: 0, major: 5, eps: 1, mr: {fine: [7, 12], normal: [20, 32]}, hr: [4, 8], u: 'm'};
// 線の濃さ（地の色ごとに、弱い順: 細かい < 2.5m < 5m）
const GA = FB ? {minor: 0.07, half: 0.11, major: 0.2} : F.type === 'gym' ? {minor: 0.1, half: 0.15, major: 0.26} : {minor: 0.08, half: 0.12, major: 0.22};
const isMul = (v, s) => Math.abs(v / s - Math.round(v / s)) < 1e-9;
const ramp = (p, lo, hi) => { const t = Math.max(0, Math.min(1, (p - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
const OVL = ['#sides span', '#tools', '#zoomctl', '#zpct', '#mblasso', '#selbar:not(.none)', '#errbanner'];
function redraw() {
  if (!svg.isConnected) return;
  const m = svg.getScreenCTM(), r = svg.getBoundingClientRect();
  if (!m || !r.width || !r.height || !m.a) return;
  const cfg = jkField.cfg, dpr = window.devicePixelRatio || 1, a = m.a, e = m.e, f = m.f;
  dyn.setAttribute('transform', `matrix(${1 / a} 0 0 ${1 / a} ${-e / a} ${-f / a})`);   // 以降は画面の px 座標で描く
  const toX = x => a * x + e, toY = y => a * (Y1 - y) + f;
  const snap = (c, w) => { const D = c * dpr; return (w % 2 ? Math.floor(D) + 0.5 : Math.round(D)) / dpr; };
  const endp = c => Math.round(c * dpr) / dpr;
  const L = r.left - 2, Rr = r.right + 2, T = r.top - 2, B = r.bottom + 2;
  const tw = Math.max(2, Math.round(1.5 * dpr));    // 白線（テープ）の太さ（画素）
  // 1 本の縦線 / 横線の d 文字列（領域 [x0,x1]×[y0,y1] の中を、画面の外は切って描く）
  const vline = (x, w) => { const X = snap(toX(x), w), y0 = Math.max(endp(toY(G.y1)), T), y1 = Math.min(endp(toY(G.y0)), B); return X < L || X > Rr ? '' : `M${X} ${y0}V${y1}`; };
  const hline = (y, w) => { const Yp = snap(toY(y), w), x0 = Math.max(endp(toX(G.x0)), L), x1 = Math.min(endp(toX(G.x1)), Rr); return Yp < T || Yp > B ? '' : `M${x0} ${Yp}H${x1}`; };
  const set = (p, d, color, op, w) => { p.setAttribute('d', d); p.setAttribute('stroke', color); p.setAttribute('stroke-opacity', op); p.setAttribute('stroke-width', w / dpr); };
  // -- 格子 --
  const on = cfg.mode !== 'off', pm = a * G.minor;
  const tm = ramp(pm, ...G.mr[cfg.mode === 'fine' ? 'fine' : 'normal']);
  const al = {minor: GA.minor * tm, half: GA.half * ramp(pm, ...G.hr) * (1 - tm), major: GA.major * ramp(a * G.major, 10, 22)};
  const ds = {minor: '', half: '', major: ''};
  if (on) {
    // 1本の線が属する段階のうち、いちばん濃いものを使う（段階ごとに線が抜けて間隔が不ぞろいに見えるのを防ぐ）
    const kind = v => { let c = '', best = 0.004; for (const [k, s] of [['major', G.major], ['half', G.half], ['minor', G.minor]]) if (s && isMul(v, s) && al[k] > best) { best = al[k]; c = k; } return c; };
    for (let k = Math.ceil(G.x0 / G.eps - 1e-9); k <= Math.floor(G.x1 / G.eps + 1e-9); k++) { const x = k * G.eps, c = kind(x); if (c) ds[c] += vline(x, 1); }
    for (let k = Math.ceil(G.y0 / G.eps - 1e-9); k <= Math.floor(G.y1 / G.eps + 1e-9); k++) { const y = k * G.eps, c = kind(y); if (c) ds[c] += hline(y, 1); }
  }
  set(gMinor, ds.minor, '#fff', al.minor, 1); set(gHalf, ds.half, '#fff', al.half, 1); set(gMajor, ds.major, '#fff', al.major, 1);
  // -- 5m ポイント（football は 8歩ごと）: 小さな十字 --
  let pd = '';
  if (cfg.pts) {
    const arm = Math.max(3, Math.round(3 * dpr)) / dpr;
    for (let i = Math.ceil(G.x0 / G.major - 1e-9); i <= Math.floor(G.x1 / G.major + 1e-9); i++) for (let j = Math.ceil(G.y0 / G.major - 1e-9); j <= Math.floor(G.y1 / G.major + 1e-9); j++) {
      const cx = snap(toX(i * G.major), 1), cy = snap(toY(j * G.major), 1);
      if (cx < L - 6 || cx > Rr + 6 || cy < T - 6 || cy > B + 6) continue;
      pd += `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}`;
    }
  }
  const PA = FB ? 0.75 : F.type === 'gym' ? 0.9 : 0.7;
  set(gPts, pd, '#fff', PA, 1);
  // -- 白線 --
  const rectD = (x0, y0, x1, y1, w) => { const X0_ = snap(toX(x0), w), X1_ = snap(toX(x1), w), Ya = snap(toY(y1), w), Yb = snap(toY(y0), w); return `M${X0_} ${Ya}H${X1_}V${Yb}H${X0_}Z`; };
  let td = '', ts = '', tb = '';
  if (FB) {
    td += rectD(-96, 0, 96, F.bsl, tw);
    for (let k = -9; k <= 9; k++) { const x = k * 8, s = snap(toX(x), tw); td += `M${s} ${endp(toY(F.bsl))}V${endp(toY(0))}`; }
    // 1ヤード（1.6歩）ごとの目盛り（ハッシュ）: 横位置だけ画素に合わせる
    const len = Math.max(4, a * 0.5);
    for (let k = -50; k <= 50; k++) {
      const x = k * 1.6; if (k % 5 === 0) continue;
      const s = snap(toX(x), 1); if (s < L || s > Rr) continue;
      for (const y of [F.hash, F.bsl - F.hash]) { const c = endp(toY(y)); ts += `M${s} ${c - len}V${c + len}`; }
      for (const y of [0.6, F.bsl - 0.6]) { const c = endp(toY(y)); ts += `M${s} ${c - len}V${c + len}`; }
    }
  } else if (F.type === 'gym') {
    td += rectD(-F.w/2, -F.d/2, F.w/2, F.d/2, tw);
    if (F.w >= 22 && F.d >= 22) td += rectD(-10, -10, 10, 10, tw);
    td += `M${snap(toX(0), tw)} ${endp(toY(F.d/2))}V${endp(toY(-F.d/2))}`;
    td += `M${endp(toX(-F.w/2))} ${snap(toY(0), tw)}H${endp(toX(F.w/2))}`;
  } else if (F.type === 'stage') {
    const ww = F.w / 2 + F.wing;
    td += `M${endp(toX(-ww))} ${snap(toY(0), tw)}H${endp(toX(ww))}`;           // 舞台前端
    ts += `M${endp(toX(-ww))} ${snap(toY(F.d), 1)}H${endp(toX(ww))}`;          // 奥の壁
    tb += `M${snap(toX(0), 1)} ${endp(toY(F.d))}V${endp(toY(0))}`;             // センター
    for (const sx of [-1, 1]) tb += `M${snap(toX(sx * F.w / 2), 1)} ${endp(toY(F.d))}V${endp(toY(0))}`;   // 床の左右の端
  } else {
    td += rectD(-F.w/2, 0, F.w/2, F.d, tw);
    tb += `M${snap(toX(0), 1)} ${endp(toY(F.d))}V${endp(toY(0))}`;
  }
  set(gTape, td, '#fff', FB ? 0.88 : 0.95, tw); set(gTapeS, ts, '#fff', FB ? 0.7 : 0.5, 1); set(gTapeB, tb, '#fff', 0.55, 1);
  // -- 距離のラベル（中心からの m）: 画面の端に張り付いて、ズームしても読める --
  lab.replaceChildren();
  if (!cfg.labels) return;
  const ov = OVL.flatMap(q => [...document.querySelectorAll(q)]).map(n => n.getBoundingClientRect()).filter(q => q.width > 0);
  const lbl = (cx, cy, s) => {
    const w = s.length * 6.6 + 6, h = 14;
    if (cx - w / 2 < r.left + 2 || cx + w / 2 > r.right - 2) return;
    if (ov.some(q => cx + w / 2 > q.left - 2 && cx - w / 2 < q.right + 2 && cy + h / 2 > q.top - 2 && cy - h / 2 < q.bottom + 2)) return;
    const t = el('text', {x: cx, y: cy, 'font-size': 11, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#eef1f6', 'fill-opacity': 0.92, stroke: '#000', 'stroke-opacity': 0.55, 'stroke-width': 3, 'paint-order': 'stroke', 'font-family': 'system-ui,sans-serif', 'font-weight': 600}, lab);
    t.textContent = s;
  };
  const step = a * G.major >= 30 ? 1 : 2;
  const rowY = Math.min(toY(G.y0) + 15, r.bottom - 11), colX = Math.min(toX(F.type === 'stage' ? F.w / 2 + F.wing : G.x1) + 18, r.right - 14);
  if (!FB) {
    const xs = [], ys = [];
    for (let i = Math.ceil(G.x0 / G.major - 1e-9); i <= Math.floor(G.x1 / G.major + 1e-9); i++) xs.push(i * G.major);
    for (let j = Math.ceil(G.y0 / G.major - 1e-9); j <= Math.floor(G.y1 / G.major + 1e-9); j++) ys.push(j * G.major);
    const gym = F.type === 'gym';
    xs.forEach(x => { if (Math.round(x / G.major) % step) return; lbl(toX(x), rowY, String(Math.abs(x)) + (x === 0 ? 'm' : '')); });
    ys.forEach(y => { if (Math.round(y / G.major) % step) return; lbl(colX, toY(y), String(gym ? Math.abs(y) : y) + (y === 0 && gym ? 'm' : '')); });
    if (gym) { lbl(toX(G.x0) - 30, rowY, '下手'); lbl(toX(G.x1) + 32, rowY, '上手'); lbl(colX, toY(G.y1) - 16, '奥'); }
    else lbl(colX, toY(G.y1) - 16, '奥');
  } else {
    for (let j = 0; j * 8 <= F.bsl; j++) { if (j % step) continue; lbl(colX, toY(j * 8), (j * 8) + (j * 8 + 8 * step > F.bsl ? '歩' : '')); }
  }
}
// 画面の大きさ・拡大・移動が変わったら描き直す（描画前に同期で）
let off = [];
if (typeof MutationObserver !== 'undefined') { const mo = new MutationObserver(redraw); mo.observe(svg, {attributes: true, attributeFilter: ['viewBox']}); off.push(() => mo.disconnect()); }
if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(redraw); ro.observe(svg); off.push(() => ro.disconnect()); }
window.addEventListener('resize', redraw); off.push(() => window.removeEventListener('resize', redraw));
jkField.live.add(redraw); off.push(() => jkField.live.delete(redraw));
svg.__jkFieldOff = () => { off.forEach(f => f()); svg.__jkFieldOff = null; };
redraw();

return {Y, el, text, X0, X1, Y0, Y1, bg, redraw, grid: G};
}

// ---- グリッドの表示設定（全画面で共通・保存される）----
//   mode: 'fine'=細かい / 'normal'=普通 / 'off'=オフ   pts: 5m ポイント   labels: 距離の数字
jkField.live = new Set();
jkField.cfg = {mode: 'normal', pts: true, labels: true};
try { Object.assign(jkField.cfg, JSON.parse(localStorage.getItem('jk.grid') || '{}')); } catch (e) { /* 無視 */ }
jkField.setGrid = function (o) {
  Object.assign(jkField.cfg, o);
  try { localStorage.setItem('jk.grid', JSON.stringify(jkField.cfg)); } catch (e) { /* 無視 */ }
  for (const f of [...jkField.live]) f();
};
