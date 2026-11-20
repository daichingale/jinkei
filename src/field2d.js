// 会場の2D描画（プレビューとエディタで共用）
// 座標: フィールド単位。SVG の y は下向きなので Y(y) で反転する
function jkField(svg, F) {
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
    const x = k * 8;
    el('line', {x1: x, x2: x, y1: Y(0), y2: Y(F.bsl), stroke: '#fff', 'stroke-width': k === 0 ? 0.45 : 0.25, opacity: 0.9}, bg);
    const yl = 50 - Math.abs(k) * 5;
    if (yl % 10 === 0 && yl > 0) {
      text(x, 9, String(yl), 3.4, {opacity: 0.85, 'font-weight': 700}, bg);
      text(x, F.bsl - 9, String(yl), 3.4, {opacity: 0.85, 'font-weight': 700, transform: `rotate(180 ${x} ${Y(F.bsl - 9)})`}, bg);
    }
  }
  for (let x = -80; x <= 80.001; x += 1.6) {
    for (const y of [F.hash, F.bsl - F.hash]) el('line', {x1: x, x2: x, y1: Y(y - 0.5), y2: Y(y + 0.5), stroke: '#fff', 'stroke-width': 0.18, opacity: 0.8}, bg);
    for (const y of [0.6, F.bsl - 0.6]) el('line', {x1: x, x2: x, y1: Y(y - 0.6), y2: Y(y + 0.6), stroke: '#fff', 'stroke-width': 0.18, opacity: 0.6}, bg);
  }
  const grid = el('g', {id: 'grid', opacity: 0.12}, bg);
  for (let x = -80; x <= 80; x += 4) el('line', {x1: x, x2: x, y1: Y(0), y2: Y(F.bsl), stroke: '#fff', 'stroke-width': 0.1}, grid);
  for (let y = 0; y <= F.bsl; y += 4) el('line', {x1: -80, x2: 80, y1: Y(y), y2: Y(y), stroke: '#fff', 'stroke-width': 0.1}, grid);
  el('rect', {x: -96, y: Y(F.bsl), width: 192, height: F.bsl, fill: 'none', stroke: '#fff', 'stroke-width': 0.5}, bg);
  text(0, -3.6, '▼ 客席（フロントサイドライン側）', 2.4, {fill: '#9aa0aa'}, bg);
  text(-88, -3.6, 'サイド1', 2.2, {fill: '#9aa0aa'}, bg); text(88, -3.6, 'サイド2', 2.2, {fill: '#9aa0aa'}, bg);
} else if (F.type === 'gym') {
  const hw = F.w/2 + F.margin, hd = F.d/2 + F.margin;
  el('rect', {x: -hw, y: Y(hd), width: hw*2, height: hd*2, fill: '#c89a62'}, bg);
  for (let x = -hw; x < hw; x += 0.9) el('line', {x1: x, x2: x, y1: Y(-hd), y2: Y(hd), stroke: '#a97f4c', 'stroke-width': 0.03, opacity: 0.5}, bg);
  el('rect', {x: -hw, y: Y(hd), width: hw*2, height: hd*2, fill: 'none', stroke: '#555', 'stroke-width': 0.5}, bg);
  const grid = el('g', {opacity: 0.15}, bg);
  for (let x = Math.ceil(-F.w/2); x <= F.w/2; x++) el('line', {x1: x, x2: x, y1: Y(-F.d/2), y2: Y(F.d/2), stroke: '#000', 'stroke-width': 0.02}, grid);
  for (let y = Math.ceil(-F.d/2); y <= F.d/2; y++) el('line', {x1: -F.w/2, x2: F.w/2, y1: Y(y), y2: Y(y), stroke: '#000', 'stroke-width': 0.02}, grid);
  const tape = {fill: 'none', stroke: '#fff', 'stroke-width': 0.08};
  el('rect', Object.assign({x: -F.w/2, y: Y(F.d/2), width: F.w, height: F.d}, tape), bg);
  if (F.w >= 25 && F.d >= 25) el('rect', Object.assign({x: -10, y: Y(10), width: 20, height: 20}, tape), bg);
  el('line', Object.assign({x1: 0, x2: 0, y1: Y(-F.d/2), y2: Y(F.d/2)}, tape), bg);
  el('line', Object.assign({x1: -F.w/2, x2: F.w/2, y1: Y(0), y2: Y(0)}, tape), bg);
  for (let x = Math.ceil(-F.w/10) * 5; x <= F.w/2; x += 5) for (let y = Math.ceil(-F.d/10) * 5; y <= F.d/2; y += 5) {
    el('line', {x1: x - 0.25, x2: x + 0.25, y1: Y(y), y2: Y(y), stroke: '#fff', 'stroke-width': 0.08}, bg);
    el('line', {x1: x, x2: x, y1: Y(y - 0.25), y2: Y(y + 0.25), stroke: '#fff', 'stroke-width': 0.08}, bg);
  }
  text(0, -hd - 1.1, '▼ 客席', 0.9, {fill: '#9aa0aa'}, bg);
  text(-hw + 1.5, -hd - 1.1, '下手', 0.9, {fill: '#9aa0aa'}, bg); text(hw - 1.5, -hd - 1.1, '上手', 0.9, {fill: '#9aa0aa'}, bg);
} else if (F.type === 'stage') {
  const ww = F.w/2 + F.wing;
  el('rect', {x: -ww, y: Y(F.d), width: ww*2, height: F.d, fill: '#2a2420'}, bg);
  el('rect', {x: -F.w/2, y: Y(F.d), width: F.w, height: F.d, fill: '#4a3b30'}, bg);
  for (let x = -F.w/2; x < F.w/2; x += 0.6) el('line', {x1: x, x2: x, y1: Y(0), y2: Y(F.d), stroke: '#3b2f27', 'stroke-width': 0.03}, bg);
  const grid = el('g', {opacity: 0.18}, bg);
  for (let x = Math.ceil(-F.w/2); x <= F.w/2; x++) el('line', {x1: x, x2: x, y1: Y(0), y2: Y(F.d), stroke: '#fff', 'stroke-width': 0.02}, grid);
  for (let y = 1; y <= F.d; y++) el('line', {x1: -F.w/2, x2: F.w/2, y1: Y(y), y2: Y(y), stroke: '#fff', 'stroke-width': 0.02}, grid);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const x = sx * (F.w/2 + 0.2 + k * F.wing / 3);
    el('rect', {x: x - 0.15, y: Y(F.d * (0.25 + 0.25 * k)), width: 0.3, height: F.d * 0.22, fill: '#111', opacity: 0.9}, bg);
  }
  el('line', {x1: -ww, x2: ww, y1: Y(0), y2: Y(0), stroke: '#fff', 'stroke-width': 0.1}, bg);
  el('line', {x1: -ww, x2: ww, y1: Y(F.d), y2: Y(F.d), stroke: '#666', 'stroke-width': 0.15}, bg);
  el('path', {d: `M -0.3 ${Y(0)} L 0.3 ${Y(0)} L 0 ${Y(0.45)} Z`, fill: '#ffd23f'}, bg);
  text(-F.w/2 - F.wing/2, F.d + 0.9, '下手袖', 0.6, {fill: '#9aa0aa'}, bg); text(F.w/2 + F.wing/2, F.d + 0.9, '上手袖', 0.6, {fill: '#9aa0aa'}, bg);
  text(0, -1.4, '▼ 客席（舞台前端）', 0.6, {fill: '#9aa0aa'}, bg);
} else {
  el('rect', {x: -F.w/2, y: Y(F.d), width: F.w, height: F.d, fill: '#5b4a3a'}, bg);
  for (let x = Math.ceil(-F.w/2); x <= F.w/2; x++) el('line', {x1: x, x2: x, y1: Y(0), y2: Y(F.d), stroke: '#fff', 'stroke-width': x === 0 ? 0.06 : 0.02, opacity: x === 0 ? 0.6 : 0.25}, bg);
  for (let y = 0; y <= F.d; y++) el('line', {x1: -F.w/2, x2: F.w/2, y1: Y(y), y2: Y(y), stroke: '#fff', 'stroke-width': 0.02, opacity: 0.25}, bg);
  el('rect', {x: -F.w/2, y: Y(F.d), width: F.w, height: F.d, fill: 'none', stroke: '#fff', 'stroke-width': 0.08}, bg);
  text(0, -1, '▼ 客席', 0.6, {fill: '#9aa0aa'}, bg);
}

return {Y, el, text, X0, X1, Y0, Y1, bg};
}
