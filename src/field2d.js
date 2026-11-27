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
if (FB) G = {x0: -96, x1: 96, y0: 0, y1: F.bsl, minor: 1, half: 4, major: 8, eps: 1, mr: {fine: [5, 9], normal: [13, 20]}, hr: [1.5, 3.5], u: '歩', step: 1, n: 8};
else if (F.type === 'gym') G = {x0: -F.w/2, x1: F.w/2, y0: -F.d/2, y1: F.d/2, minor: 1, half: 0, major: 5, eps: 1, mr: {fine: [7, 12], normal: [20, 32]}, hr: [4, 8], u: 'm', step: F.stride_m || 0.625, n: 5 / (F.stride_m || 0.625)};
else if (F.type === 'stage') G = {x0: -F.w/2, x1: F.w/2, y0: 0, y1: F.d, minor: 1, half: 0, major: 5, eps: 1, mr: {fine: [7, 12], normal: [20, 32]}, hr: [4, 8], u: 'm', step: F.stride_m || 0.625, n: 5 / (F.stride_m || 0.625)};
else G = {x0: -F.w/2, x1: F.w/2, y0: 0, y1: F.d, minor: 1, half: 0, major: 5, eps: 1, mr: {fine: [7, 12], normal: [20, 32]}, hr: [4, 8], u: 'm', step: F.stride_m || 0.625, n: 5 / (F.stride_m || 0.625)};
// 線の濃さ（地の色ごとに、弱い順: 細かい < 2.5m < 5m）
const GA = FB ? {minor: 0.07, half: 0.11, major: 0.2} : F.type === 'gym' ? {minor: 0.1, half: 0.15, major: 0.26} : {minor: 0.08, half: 0.12, major: 0.22};
// 歩の格子: 8歩/5m なら 4歩ごと、6歩/5m なら 3歩ごとに、少し強い線
const nInt = Math.abs(G.n - Math.round(G.n)) < 0.01, nR = Math.round(G.n);
G.grp = nInt && nR % 4 === 0 ? 4 : nInt && nR % 3 === 0 ? 3 : 4;
G.thin = G.grp === 3 ? [1, 3, 6, 12, 24] : [1, 2, 4, 8, 16];
const SA = FB ? {step: 0.16, grp: 0.26, major: 0.42} : F.type === 'gym' ? {step: 0.28, grp: 0.42, major: 0.62} : {step: 0.2, grp: 0.32, major: 0.5};
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
  const on = cfg.mode !== 'off', pm = a * G.minor, stepMode = cfg.mode === 'step';
  const tm = ramp(pm, ...G.mr[cfg.mode === 'fine' ? 'fine' : 'normal']);
  const al = stepMode ? {minor: SA.step, half: SA.grp, major: SA.major} : {minor: GA.minor * tm, half: GA.half * ramp(pm, ...G.hr) * (1 - tm), major: GA.major * ramp(a * G.major, 10, 22)};
  const ds = {minor: '', half: '', major: ''};
  if (on && stepMode) {
    // 1歩ごとの線（中心が原点）。歩のあいだが 6.5px より狭いときは、2・4・8…歩おきに間引く（3歩ごとの場合は 3・6・12…）
    const ps = a * G.step, m = G.thin.find(t => ps * t >= 6.5) || G.thin[G.thin.length - 1];
    const axis = (lo, hi, line) => {
      for (let k = Math.ceil(lo / G.step - 1e-9); k <= Math.floor(hi / G.step + 1e-9); k++) {
        const v = k * G.step; if (Math.abs(v / G.major - Math.round(v / G.major)) < 2e-3) continue;         // 5m の線は下で別に描く（歩の格子とずれる歩幅でも5mは必ず描く）
        if (k % m === 0) ds[k % G.grp === 0 ? 'half' : 'minor'] += line(v, 1);
      }
      for (let i = Math.ceil(lo / G.major - 1e-9); i <= Math.floor(hi / G.major + 1e-9); i++) ds.major += line(i * G.major, 1);
    };
    axis(G.x0, G.x1, vline); axis(G.y0, G.y1, hline);
  } else if (on) {
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

// いちばん近い 5m ポイント（football は 8歩ごとの交点）。会場の外には出ない
const nearestPoint = (x, y) => {
  const M = G.major, cl = (v, lo, hi) => Math.max(Math.ceil(lo / M - 1e-9) * M, Math.min(Math.floor(hi / M + 1e-9) * M, Math.round(v / M) * M));
  return [cl(x, G.x0, G.x1), cl(y, G.y0, G.y1)];
};
return {Y, el, text, X0, X1, Y0, Y1, bg, redraw, grid: G, nearestPoint, step: G.step};
}

// ---- グリッドの表示設定（全画面で共通・保存される）----
//   mode: 'step'=1歩ごと（既定） / 'fine'=細かい / 'normal'=普通 / 'off'=オフ   pts: 5m ポイント   labels: 距離の数字
jkField.live = new Set();
jkField.cfg = {mode: 'step', pts: true, labels: true};
try { Object.assign(jkField.cfg, JSON.parse(localStorage.getItem('jk.grid') || '{}')); } catch (e) { /* 無視 */ }
jkField.setGrid = function (o) {
  Object.assign(jkField.cfg, o);
  try { localStorage.setItem('jk.grid', JSON.stringify(jkField.cfg)); } catch (e) { /* 無視 */ }
  for (const f of [...jkField.live]) f();
  try { window.dispatchEvent(new Event('jk-grid')); } catch (e) { /* 無視 */ }
};

// ================= 印刷（A4 縦・横 / 白地・モノクロでも読める） =================
// jkField.print(D, 'sets' | 'members' | 'member', who)  … #print に印刷用のページを作って window.print()
// jkField.printHtml(D, kind, who)                       … ページの HTML だけを返す
// ・白い紙に、1歩の線=薄い灰色(#d0d0d0)・4歩ごと=中間の灰色・5mの線=濃い灰色・20m/30mの枠と中央線=黒の太線
// ・人は「黒ふちの記号（セクションごとに形が違う）＋セクション色＋名前」。色が出ない印刷でも形と名前で区別できる
jkField.PRINT_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'pentagon', 'hexagon'];
jkField.symbol = function (kind, cx, cy, r, attrs) {      // 記号 1 つの SVG（cx,cy は画面座標。y 下向き）
  const a = Object.entries(attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
  const poly = n => { let d = ''; for (let i = 0; i < n; i++) { const t = -Math.PI / 2 + i * 2 * Math.PI / n; d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(t)).toFixed(3)} ${(cy + r * Math.sin(t)).toFixed(3)}`; } return d + 'Z'; };
  switch (kind) {
    case 'square': return `<rect x="${cx - r * 0.88}" y="${cy - r * 0.88}" width="${r * 1.76}" height="${r * 1.76}" ${a}/>`;
    case 'triangle': return `<path d="M${cx} ${cy - r * 1.1}L${cx + r * 1.0} ${cy + r * 0.8}L${cx - r * 1.0} ${cy + r * 0.8}Z" ${a}/>`;
    case 'diamond': return `<path d="M${cx} ${cy - r * 1.15}L${cx + r * 1.15} ${cy}L${cx} ${cy + r * 1.15}L${cx - r * 1.15} ${cy}Z" ${a}/>`;
    case 'cross': { const w = r * 0.42, q = r * 1.05; return `<path d="M${cx - w} ${cy - q}H${cx + w}V${cy - w}H${cx + q}V${cy + w}H${cx + w}V${cy + q}H${cx - w}V${cy + w}H${cx - q}V${cy - w}H${cx - w}Z" ${a}/>`; }
    case 'pentagon': return `<path d="${poly(5)}" ${a}/>`;
    case 'hexagon': return `<path d="${poly(6)}" ${a}/>`;
    default: return `<circle cx="${cx}" cy="${cy}" r="${r}" ${a}/>`;
  }
};
jkField.printSvg = function (D, o) {
  o = o || {};
  const F = D.field, FB = F.type === 'football', esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let ax0, ax1, ay0, ay1, x0, x1, y0, y1;                  // ax*: 描く範囲 / x*: フロア（線の範囲）
  if (FB) { x0 = -96; x1 = 96; y0 = 0; y1 = F.bsl; ax0 = -99; ax1 = 99; ay0 = -5; ay1 = F.bsl + 3; }
  else if (F.type === 'gym') { x0 = -F.w / 2; x1 = F.w / 2; y0 = -F.d / 2; y1 = F.d / 2; ax0 = x0 - 3.6; ax1 = x1 + 3.6; ay0 = y0 - 3; ay1 = y1 + 2.4; }
  else { x0 = -F.w / 2; x1 = F.w / 2; y0 = 0; y1 = F.d; const wg = F.type === 'stage' ? F.wing : 0; ax0 = x0 - wg - 3.6; ax1 = x1 + wg + 3.6; ay0 = -3; ay1 = F.d + 2; }
  const W = ax1 - ax0, H = ay1 - ay0, cssW = o.cssW || Math.min(1000, 640 * W / H), kpx = cssW / W, u = 1 / kpx;   // u = 1 css px（フィールド単位）
  const Yf = y => ay1 - y;
  const step = FB ? 1 : (F.stride_m || 0.625), major = FB ? 8 : 5, n = major / step, nI = Math.abs(n - Math.round(n)) < 0.01, nR = Math.round(n);
  const grp = nI && nR % 4 === 0 ? 4 : nI && nR % 3 === 0 ? 3 : 4, thin = grp === 3 ? [1, 3, 6, 12, 24] : [1, 2, 4, 8, 16];
  const m = thin.find(t => step * kpx * t >= 7) || 24;
  const P = {s: '', g: '', m: '', t: '', c: ''};
  const near = (v, s) => Math.abs(v / s - Math.round(v / s)) < 2e-3;
  const ln = (c, xa, ya, xb, yb) => { P[c] += `M${+xa.toFixed(3)} ${+Yf(ya).toFixed(3)}L${+xb.toFixed(3)} ${+Yf(yb).toFixed(3)}`; };
  // 1歩・4歩・5m の格子（原点は会場の中心 / 舞台・フロアは前端の中央）
  for (let k = Math.ceil(x0 / step - 1e-9); k <= Math.floor(x1 / step + 1e-9); k++) { const v = k * step; if (near(v, major) || k % m) continue; ln(k % grp === 0 ? 'g' : 's', v, y0, v, y1); }
  for (let k = Math.ceil(y0 / step - 1e-9); k <= Math.floor(y1 / step + 1e-9); k++) { const v = k * step; if (near(v, major) || k % m) continue; ln(k % grp === 0 ? 'g' : 's', x0, v, x1, v); }
  for (let i = Math.ceil(x0 / major - 1e-9); i <= Math.floor(x1 / major + 1e-9); i++) ln('m', i * major, y0, i * major, y1);
  for (let j = Math.ceil(y0 / major - 1e-9); j <= Math.floor(y1 / major + 1e-9); j++) ln('m', x0, j * major, x1, j * major);
  // 外枠・中央線・20m の枠（黒）
  const rect = (a, b, c, d) => { ln('t', a, b, c, b); ln('t', c, b, c, d); ln('t', c, d, a, d); ln('t', a, d, a, b); };
  rect(x0, y0, x1, y1);
  if (F.type === 'gym') { if (F.w >= 22 && F.d >= 22) rect(-10, -10, 10, 10); ln('t', 0, y0, 0, y1); ln('t', x0, 0, x1, 0); }
  else if (!FB) ln('c', 0, y0, 0, y1);
  if (FB) { for (let k = -9; k <= 9; k++) ln('c', k * 8, y0, k * 8, y1); }
  // 5m ポイント（football は 8歩ごと）の小さな十字
  let pts = '';
  const ar = 3.2 * u;
  for (let i = Math.ceil(x0 / major - 1e-9); i <= Math.floor(x1 / major + 1e-9); i++) for (let j = Math.ceil(y0 / major - 1e-9); j <= Math.floor(y1 / major + 1e-9); j++) {
    const cx = i * major, cy = Yf(j * major);
    pts += `M${cx - ar} ${cy}H${cx + ar}M${cx} ${cy - ar}V${cy + ar}`;
  }
  const stroke = (d, c, w, extra) => d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" vector-effect="non-scaling-stroke" ${extra || ''}/>` : '';
  let g = `<rect x="${ax0}" y="0" width="${W}" height="${H}" fill="#fff"/>`;
  if (F.type === 'stage') {      // 袖（舞台の左右）はうすい灰色
    g += `<rect x="${x0 - F.wing}" y="${Yf(y1)}" width="${F.w + F.wing * 2}" height="${y1 - y0}" fill="#efefef"/><rect x="${x0}" y="${Yf(y1)}" width="${F.w}" height="${y1 - y0}" fill="#fff"/>`;
    g += `<text x="${x0 - F.wing / 2}" y="${Yf(y1 - 0.9)}" font-size="${10 * u}" font-family="sans-serif" fill="#555" text-anchor="middle">下手袖</text><text x="${x1 + F.wing / 2}" y="${Yf(y1 - 0.9)}" font-size="${10 * u}" font-family="sans-serif" fill="#555" text-anchor="middle">上手袖</text>`;
    g += stroke(`M${x0 - F.wing} ${Yf(y0)}H${x1 + F.wing}M${x0 - F.wing} ${Yf(y1)}H${x1 + F.wing}`, '#555', 1.2);
  }
  g += stroke(P.s, '#d0d0d0', 0.6) + stroke(P.g, '#a3a3a3', 0.7) + stroke(P.m, '#6e6e6e', 1.0) + stroke(P.c, '#000', 1.3) + stroke(pts, '#000', 1.1) + stroke(P.t, '#000', 2.6, 'stroke-linejoin="miter" stroke-linecap="square"');
  // 距離の数字（中心からの m / football は前のラインからの歩数）
  const fs = 10.5 * u, tx = (x, y, s, extra) => `<text x="${x}" y="${y}" font-size="${fs}" font-family="sans-serif" font-weight="700" fill="#000" text-anchor="middle" dominant-baseline="central" ${extra || ''}>${esc(s)}</text>`;
  if (FB) {
    for (let k = -10; k <= 10; k++) { const yl = 50 - Math.abs(k) * 5; if (yl % 10 === 0 && yl > 0) { g += tx(k * 8, Yf(9), String(yl), `font-size="${3.4}" fill="#9a9a9a"`) + tx(k * 8, Yf(F.bsl - 9), String(yl), `font-size="${3.4}" fill="#9a9a9a" transform="rotate(180 ${k * 8} ${Yf(F.bsl - 9)})"`); } }
    for (let j = 0; j * 8 <= F.bsl; j++) g += tx(x1 + 2.6, Yf(j * 8), String(j * 8), `font-size="${fs}"`);
    g += tx(0, Yf(-2.8), '▼ 客席（フロントサイドライン）', `font-size="${fs * 1.1}"`);
  } else {
    const gym = F.type === 'gym';
    for (let i = Math.ceil(x0 / 5 - 1e-9); i <= Math.floor(x1 / 5 + 1e-9); i++) g += tx(i * 5, Yf(y0 - 1.5), String(Math.abs(i * 5)) + (i === 0 && gym ? 'm' : ''));
    for (let j = Math.ceil(y0 / 5 - 1e-9); j <= Math.floor(y1 / 5 + 1e-9); j++) g += tx(x1 + 1.9, Yf(j * 5), String(gym ? Math.abs(j * 5) : j * 5) + (j === 0 && gym ? 'm' : ''));
    g += `<text x="${x0 - 0.4}" y="${Yf(y0 - 1.5)}" font-size="${fs}" font-family="sans-serif" fill="#000" text-anchor="end" dominant-baseline="central">下手</text><text x="${x1 + 0.4}" y="${Yf(y0 - 1.5)}" font-size="${fs}" font-family="sans-serif" fill="#000" text-anchor="start" dominant-baseline="central">上手</text>`;
    g += tx(0, Yf(y0 - 2.5), '▼ 客席', `font-size="${fs * 1.1}"`);
    g += `<text x="${x1 + 1.9}" y="${Yf(y1 + 1.4)}" font-size="${fs}" font-family="sans-serif" fill="#000" text-anchor="middle">奥</text>`;
  }
  // 人
  const r = FB ? 0.95 : 0.36, secOf = p => D.sections[D.performers[p].sec], shapeOf = p => jkField.PRINT_SHAPES[D.performers[p].sec % jkField.PRINT_SHAPES.length];
  const sym = (p, pos, rr, w) => jkField.symbol(shapeOf(p), pos[0], Yf(pos[1]), rr, {fill: secOf(p).color, stroke: '#000', 'stroke-width': w || 1.2, 'vector-effect': 'non-scaling-stroke'});
  const placed = [];
  const lab = (p, pos, size) => {      // 名前は、ほかの名前と重ならない位置（上→下→さらに上・下）に置く
    const id = D.performers[p].id, w = id.length * size * 0.62, h = size * 1.05, cx = pos[0];
    for (const off of [1.55, -1.7, 2.7, -2.8, 3.8, -3.9]) {
      const cy = Yf(pos[1]) - r * off, bx = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
      if (placed.some(q => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue;
      placed.push(bx);
      return `<text x="${cx}" y="${cy}" font-size="${size}" font-family="sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#000" stroke="#fff" stroke-width="2.4" paint-order="stroke" vector-effect="non-scaling-stroke">${esc(id)}</text>`;
    }
    return '';
  };
  if (o.who != null && o.who >= 0) {
    const who = o.who, pp = D.sets.map(s => s.pos[who]);
    for (let p = 0; p < D.performers.length; p++) if (p !== who) g += jkField.symbol(shapeOf(p), D.sets[o.k || 0].pos[p][0], Yf(D.sets[o.k || 0].pos[p][1]), r * 0.62, {fill: '#fff', stroke: '#9a9a9a', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke'});
    g += stroke(pp.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${Yf(q[1])}`).join(''), '#000', 1.6, 'stroke-dasharray="6 4"');
    pp.forEach((q, i) => {
      const nr = jkField.nearest(F, q[0], q[1]);                       // 自分の 5m ポイント: 丸で囲む
      if (nr) g += `<circle cx="${nr[0]}" cy="${Yf(nr[1])}" r="${r * 2.1}" fill="none" stroke="#000" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
    });
    pp.forEach((q, i) => { g += sym(who, q, r * 1.7, 1.8); g += `<text x="${q[0]}" y="${Yf(q[1]) - r * 2.5}" font-size="${12 * u}" font-family="sans-serif" font-weight="800" text-anchor="middle" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke" vector-effect="non-scaling-stroke">${esc(D.sets[i].name)}</text>`; });
  } else {
    const pos = o.pos || D.sets[o.k || 0].pos, size = (FB ? 1.9 : 0.52);
    for (let p = 0; p < pos.length; p++) g += sym(p, pos[p], r);
    if (o.labels !== false) for (let p = 0; p < pos.length; p++) g += lab(p, pos[p], size);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ax0} 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;max-height:${o.maxH || '165mm'}" role="img">${g}</svg>`;
};
jkField.nearest = function (F, x, y) {
  const FB = F.type === 'football', M = FB ? 8 : 5;
  let x0, x1, y0, y1;
  if (FB) { x0 = -96; x1 = 96; y0 = 0; y1 = F.bsl; } else if (F.type === 'gym') { x0 = -F.w / 2; x1 = F.w / 2; y0 = -F.d / 2; y1 = F.d / 2; } else { x0 = -F.w / 2; x1 = F.w / 2; y0 = 0; y1 = F.d; }
  const cl = (v, lo, hi) => Math.max(Math.ceil(lo / M - 1e-9) * M, Math.min(Math.floor(hi / M + 1e-9) * M, Math.round(v / M) * M));
  return [cl(x, x0, x1), cl(y, y0, y1)];
};
jkField.printLegend = function (D) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), FB = D.field.type === 'football';
  const items = D.sections.map((s, i) => {
    const cnt = D.performers.filter(p => p.sec === i).length;
    return `<span class="lg"><svg width="16" height="16" viewBox="0 0 16 16">${jkField.symbol(jkField.PRINT_SHAPES[i % jkField.PRINT_SHAPES.length], 8, 8, 6, {fill: s.color, stroke: '#000', 'stroke-width': 1.2})}</svg>${esc(s.label)}（${cnt}）</span>`;
  }).join('');
  const st = FB ? '1歩 = 22.5インチ（8 to 5）' : `1歩 = ${Math.round((D.field.stride_m || 0.625) * 1000) / 10}cm（5m = ${Math.round(500 / ((D.field.stride_m || 0.625) * 100) * 10) / 10}歩）`;
  return `<div class="lgs">${items}</div><div class="lgn">${st} ／ 線: 薄い灰=1歩　中間の灰=${FB ? '4' : '4'}歩ごと　濃い灰=${FB ? '8歩（5ヤード）' : '5m'}　黒の太線=${FB ? 'サイドライン・エンドライン' : '30m・20mの枠と中央線'} ／ +印=${FB ? '8歩' : '5m'}ポイント</div>`;
};
jkField.printHtml = function (D, kind, who) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), FB = D.field.type === 'football';
  const legend = jkField.printLegend(D);
  const sheet = i => {
    const p = D.performers[i], sec = D.sections[p.sec];
    const rows = D.dots[i].map((d, k) => `<tr><td class="k">${esc(D.sets[k].name)}</td><td>${k ? D.sets[k].counts : '—'}</td><td class="pos">${esc(d.h)}</td><td class="pos">${esc(d.v)}</td><td>${esc(d.face)}</td><td>${esc(d.step)}</td></tr>`).join('');
    return `<section class="pg port"><h3><svg width="22" height="22" viewBox="0 0 22 22" style="vertical-align:-5px">${jkField.symbol(jkField.PRINT_SHAPES[p.sec % jkField.PRINT_SHAPES.length], 11, 11, 8, {fill: sec.color, stroke: '#000', 'stroke-width': 1.4})}</svg> ${esc(p.id)}（${esc(sec.label)}） — ${esc(D.name)}</h3>${jkField.printSvg(D, {who: i, maxH: '118mm', cssW: FB ? 700 : 520})}${legend}<table class="dt"><tr><th>セット</th><th>カウント</th><th>左右（${FB ? 'ヤードライン' : 'センター'}から）</th><th>前後</th><th>向き</th><th>歩幅</th></tr>${rows}</table></section>`;
  };
  const setPage = k => {
    const s = D.sets[k];
    return `<section class="pg land"><h3>${esc(D.name)} ― セット ${esc(s.name)}${k ? `（${s.counts}カウントで移動${s.hold ? '＋ホールド' + s.hold : ''}）` : '（開始位置）'}</h3>${jkField.printSvg(D, {k})}${legend}</section>`;
  };
  if (kind === 'sets') return D.sets.map((_, k) => setPage(k)).join('');
  if (kind === 'member') return sheet(who);
  return D.performers.map((_, i) => sheet(i)).join('');
};
jkField.PRINT_CSS = `@media print{
  @page{margin:9mm}
  html,body{background:#fff!important;color:#000!important}
  body>*:not(#print){display:none!important}
  #print{display:block!important}
  #print *{box-sizing:border-box}
  #print .pg{break-after:page;page-break-after:always;font-family:system-ui,"Hiragino Sans","Noto Sans JP",sans-serif;color:#000}
  #print .pg:last-child{break-after:auto;page-break-after:auto}
  #print .pg.land{page:jkland} #print .pg.port{page:jkport}
  #print h3{margin:0 0 3mm;font-size:13pt}
  #print svg{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  #print .lgs{display:flex;flex-wrap:wrap;gap:1mm 5mm;margin:2.5mm 0 1mm;font-size:9pt}
  #print .lg svg{vertical-align:-3px;margin-right:1mm}
  #print .lgn{font-size:8pt;color:#333;margin-bottom:2mm}
  #print table.dt{border-collapse:collapse;width:100%;font-size:10pt;margin-top:2mm}
  #print table.dt th{background:#eee!important;border:1px solid #000;padding:1.2mm 1.6mm;text-align:left;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  #print table.dt td{border:1px solid #777;padding:1.2mm 1.6mm;vertical-align:top;color:#000}
  #print table.dt td.k{font-weight:800;font-size:12pt}
  #print table.dt td.pos{font-weight:700;font-size:11pt}
}
@page jkland{size:A4 landscape;margin:8mm}
@page jkport{size:A4 portrait;margin:10mm}`;
jkField.print = function (D, kind, who) {
  const box = document.getElementById('print'); if (!box) return;
  let st = document.getElementById('jkprintcss'); if (!st) { st = document.createElement('style'); st.id = 'jkprintcss'; st.textContent = jkField.PRINT_CSS; document.head.appendChild(st); }
  box.innerHTML = jkField.printHtml(D, kind, who);
  const done = () => { box.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
};
