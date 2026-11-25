// イラスト用の小さな描画ヘルパー（SVG文字列を返す）
const D = '#2b2d42';
const C = {
  D, BR: '#f5b83d', BRD: '#d98e1f', HL: '#ffe08a', SIL: '#d3dbea', SILD: '#9aa7c2', BLK: '#3b3f5c',
  WOOD: '#c27a45', WOODL: '#e6b07a', RED: '#e5484d', BLUE: '#4c8bf5', BLUED: '#2f5fc4', TEAL: '#2ec4b6',
  WH: '#ffffff', SKIN: '#ffdcc0', BG: '#e9edf7', PINK: '#ff9fb2', YEL: '#ffd23f', GRN: '#4fbf74', NAVY: '#26335f',
  LAV: '#8d86e8',
};
const n = (v) => (Math.round(v * 100) / 100).toString();
const P = (d, fill = 'none', ex = '') => `<path d="${d}" fill="${fill}" ${ex}/>`;
const Ci = (cx, cy, r, fill = C.BLUE, ex = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" ${ex}/>`;
const E = (cx, cy, rx, ry, fill, ex = '') => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${ex}/>`;
const R = (x, y, w, h, r, fill, ex = '') => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${fill}" ${ex}/>`;
const NS = 'stroke="none"';
// 輪郭つきの管（外側に暗い太線、内側に色線）
const T = (d, col, w = 4, ex = '') =>
  `<path d="${d}" fill="none" stroke="${D}" stroke-width="${n(w + 3)}" ${ex}/><path d="${d}" fill="none" stroke="${col}" stroke-width="${n(w)}" ${ex}/>`;
const G = (inner, tf = '') => `<g${tf ? ` transform="${tf}"` : ''}>${inner}</g>`;
const dot = (x, y, r = 3.1, fill = C.BLUE) => Ci(x, y, r, fill, 'stroke-width="1.25"');
const txt = (x, y, s, size = 8, fill = D, ex = '') =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-weight="700" text-anchor="middle" fill="${fill}" stroke="none" font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',Meiryo,sans-serif" ${ex}>${s}</text>`;
const arrow = (x1, y1, x2, y2, col = C.RED, w = 2.4, head = 5) => {
  const a = Math.atan2(y2 - y1, x2 - x1), c = Math.cos(a), s = Math.sin(a);
  const bx = x2 - c * head, by = y2 - s * head;
  return `<path d="M${n(x1)} ${n(y1)} L${n(bx)} ${n(by)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>` +
    `<path d="M${n(x2)} ${n(y2)} L${n(bx - s * head * 0.75)} ${n(by + c * head * 0.75)} L${n(bx + s * head * 0.75)} ${n(by - c * head * 0.75)} Z" fill="${col}" stroke="${col}" stroke-width="1" stroke-linejoin="round"/>`;
};
// 曲線矢印（SVGパス d の終点に三角）
const arrowPath = (d, ex, ey, ang, col = C.RED, w = 2.4, head = 5) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const bx = ex - c * head, by = ey - s * head;
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>` +
    `<path d="M${n(ex)} ${n(ey)} L${n(bx - s * head * 0.75)} ${n(by + c * head * 0.75)} L${n(bx + s * head * 0.75)} ${n(by - c * head * 0.75)} Z" fill="${col}" stroke="${col}" stroke-width="1" stroke-linejoin="round"/>`;
};
const wrap = (vw, vh, inner, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" fill="none" stroke="${D}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;
const badge = (inner, bg = C.BG) =>
  wrap(64, 64, `<rect x="1.5" y="1.5" width="61" height="61" rx="15" fill="${bg}" stroke="#c3cce3" stroke-width="1"/>${inner}`);
const sparkle = (x, y, s = 3, col = C.YEL) =>
  `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="${col}" stroke="${D}" stroke-width="0.9"/>`;
const note = (x, y, col = D) => `<g stroke="none" fill="${col}"><ellipse cx="${x}" cy="${y}" rx="2.6" ry="2" transform="rotate(-20 ${x} ${y})"/><rect x="${x + 1.6}" y="${y - 9}" width="1.3" height="9"/><path d="M${x + 2.9} ${y - 9} q3 1 3 4.5 q-1.5 -2 -3 -2z"/></g>`;
module.exports = { C, D, n, P, Ci, E, R, NS, T, G, dot, txt, arrow, arrowPath, wrap, badge, sparkle, note };
