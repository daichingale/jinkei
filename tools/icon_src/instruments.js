const { C, D, n, P, Ci, E, R, NS, T, G, badge, sparkle } = require('./lib');
const out = {};
const valves = (xs, y, h = 10, col = C.SIL) => xs.map((x) => R(x - 2, y, 4, h, 2, col) + Ci(x, y - 0.5, 2.4, C.SILD, 'stroke-width="1.1"')).join('');
const cone = (x, y, ang, w0, w1, len, col, rim = C.BRD) => `<g transform="translate(${x} ${y}) rotate(${ang})">` + P(`M${-w0} 0 Q${-w0} ${-len * 0.55} ${-w1} ${-len} L${w1} ${-len} Q${w0} ${-len * 0.55} ${w0} 0 Z`, col) + E(0, -len, w1, w1 * 0.3, rim) + '</g>';
const keys = (pts, r = 1.5, col = C.SIL) => pts.map(([x, y]) => Ci(x, y, r, col, 'stroke-width="1"')).join('');

// ---- 金管 ----


out.marching_horn = badge(
  E(30, 33, 22, 22, C.BR) + E(30, 33, 17, 17, C.BRD) + E(30, 33, 11, 11, C.BLK) + E(27, 30, 5, 5, '#5b6088', NS) +
  T('M50 44 Q58 50 52 56 Q46 59 36 55', C.BR, 3.4) + R(26, 51, 5, 10, 2, C.SIL, 'transform="rotate(75 28 56)"') +
  valves([44, 50], 10, 8, C.SIL) + P('M13 22 Q17 14 25 12', 'none', `stroke="${C.HL}" stroke-width="2"`));

out.horn = badge(
  Ci(32, 33, 19, 'none') +
  T('M32 14 C52 14 56 40 40 48 C28 54 14 46 16 34 C18 22 34 20 40 30 C44 38 36 44 30 40', C.BR, 3.2) +
  T('M44 14 L38 14', C.BR, 3.2) + 
  P('M16 34 C10 28 6 22 5 12 L20 18 Z', C.BR) + E(8, 14, 3, 6.5, C.BRD, 'transform="rotate(-30 8 14)"') +
  Ci(46, 12, 3, C.SIL, 'stroke-width="1.1"'));



out.marching_euphonium = badge(
  E(30, 36, 20, 20, C.BR) + E(30, 36, 15, 15, C.BRD) + E(30, 36, 9, 9, C.BLK) +
  T('M48 48 Q56 54 50 58 Q42 61 30 58', C.BR, 3.4) +
  valves([22, 28, 34], 6, 9) + R(15, 6, 24, 3, 1.5, C.SILD, NS) + P('M12 28 Q15 20 22 17', 'none', `stroke="${C.HL}" stroke-width="2"`) +
  T('M12 12 L8 6', C.SILD, 2) + R(4, 3, 6, 4, 2, C.SIL));


out.marching_tuba = badge(
  E(32, 34, 25, 25, C.BRD) + E(32, 34, 20, 20, C.BR) + E(32, 34, 13, 13, C.BLK) + E(28, 30, 6, 6, '#5b6088', NS) +
  T('M8 50 Q12 60 24 60', C.BRD, 3.4) + valves([12, 18], 6, 9) + R(10, 4, 14, 3, 1.5, C.SILD, NS) +
  P('M10 28 Q14 18 24 12', 'none', `stroke="${C.HL}" stroke-width="2"`));


// ---- 木管 ----
out.trumpet = badge(
  T('M15 42 V33 Q15 29 19 29 H42 Q46 29 46 33 V40', C.BR, 3.4) +
  P('M45 36 C52 35 55 29 58 22 Q60.5 19 61 23 V52 Q60.5 56 58 53 C55 46 52 43 45 43 Z', C.BR) + E(59.4, 37.5, 2.4, 15.5, C.BRD, 'stroke-width="1.2"') +
  T('M9 40 H46', C.BR, 3.4) + R(3, 37, 8, 6, 2.5, C.SIL) + valves([23, 29, 35], 17, 15) + P('M47 38 C52 37 55 33 57 28', 'none', `stroke="${C.HL}" stroke-width="1.6"`));
out.mellophone = badge(
  cone(34, 42, 58, 4.5, 11, 22, C.BR) + T('M12 44 Q6 36 14 30 Q24 24 30 34 Q34 42 26 46 Q18 48 16 42', C.BR, 3.4) + T('M12 47 H3', C.BR, 3.4) + R(1, 44.5, 5, 5, 2, C.SIL) +
  valves([20, 26, 32], 18, 12) + T('M31 40 L34 42', C.BR, 3.4));
out.trombone = badge(
  T('M12 38 V28 Q12 21 19 21 H44', C.BR, 3.2) + cone(43, 21, 90, 3.6, 12, 12, C.BR) +
  T('M15 41 H52', C.SIL, 2.2) + T('M15 49 H52', C.SIL, 2.2) + T('M52 41 Q57 41 57 45 Q57 49 52 49', C.BR, 2.6) + R(23, 39, 4.5, 12, 2, C.BR) + R(4, 36.5, 9, 6, 2.5, C.SIL));
out.euphonium = badge(G(
  cone(40, 28, 0, 5, 14, 22, C.BR) + T('M8 44 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0', C.BR, 4.6) + T('M17 44 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0', C.BRD, 3) +
  valves([14, 20, 26], 15, 14) + T('M14 15 L9 8', C.SILD, 2) + R(4, 5, 8, 4, 2, C.SIL), 'translate(3 3) scale(.9)'));
out.tuba = badge(G(
  cone(40, 30, 0, 6, 19, 24, C.BRD, C.BR) + T('M7 45 a19 19 0 1 0 38 0 a19 19 0 1 0 -38 0', C.BRD, 5.4) + T('M18 45 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0', C.BR, 3.2) +
  valves([14, 21, 28], 14, 13) + T('M14 14 L8 8', C.SILD, 2) + R(3, 5, 8, 4, 2, C.SIL), 'translate(5 6) scale(.84)'));
out.sousaphone = badge(G(
  T('M30 20 C13 20 6 34 10 47 C14 59 34 61 41 49 C47 38 42 26 33 23', C.BRD, 4.6) + T('M18 38 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0', C.BR, 3.2) +
  cone(44, 36, 0, 5, 18, 26, C.BR) + valves([22, 28, 34], 14, 8) + T('M22 14 L16 8', C.SILD, 2) + R(10, 5, 8, 4, 2, C.SIL), 'translate(3 5) scale(.88)'));
out.alto_clarinet = badge(
  P('M30 6 H34 L35 12 H29 Z', C.BLK) + R(29, 12, 6, 34, 2, C.BLK) + T('M32 46 Q32 55 39 55', C.SILD, 4) + cone(41, 54, 40, 4, 10, 14, C.SIL, C.SILD) + keys([[32, 20], [32, 28], [32, 36]], 1.6) +
  T('M32 12 Q32 6 26 6', C.SILD, 2.2));
out.bass_clarinet = badge(
  P('M24 8 H28 L29 13 H23 Z', C.BLK) + T('M26 13 Q33 11 33 18', C.SILD, 3) + R(30, 16, 6, 34, 2, C.BLK) + T('M33 50 Q33 58 42 57', C.SILD, 4.4) +
  cone(43, 56, 48, 4.6, 11, 16, C.SIL, C.SILD) + keys([[33, 24], [33, 32], [33, 40]], 1.6));

out.piccolo = badge(
  R(26, 8, 7, 48, 3.5, C.SIL) + keys([[29.5, 20], [29.5, 28], [29.5, 36], [29.5, 44]], 1.8, C.SILD) + R(24, 6, 11, 5, 2.5, C.SILD) +
  Ci(22, 17, 2.2, C.SILD, 'stroke-width="1"') + P('M36 14 L36 30', 'none', 'stroke="#fff" stroke-width="1.4"'));
out.flute = badge(
  G(R(4, 28, 56, 7, 3.5, C.SIL) + R(9, 25, 7, 3, 1.5, C.SILD, 'stroke-width="1"') + keys([[20, 31.5], [27, 31.5], [34, 31.5], [41, 31.5], [48, 31.5]], 1.9, C.SILD) +
  P('M6 29.5 H58', 'none', 'stroke="#fff" stroke-width="1.2"') + Ci(14, 24, 2.2, C.SILD, 'stroke-width="1"') + R(26, 36, 3, 4, 1, C.SILD, 'stroke-width="1"') + R(40, 36, 3, 4, 1, C.SILD, 'stroke-width="1"'), 'rotate(-35 32 32)'));
out.oboe = badge(
  G(P('M30 6 H34 L35 14 H29 Z', C.WOODL) + P('M29.5 14 H34.5 L36 50 H28 Z', C.BLK) + P('M28 50 H36 L40 58 H24 Z', C.BLK) + R(28, 22, 8, 2.2, 1, C.SIL, 'stroke-width="1"') + R(28, 36, 8, 2.2, 1, C.SIL, 'stroke-width="1"') + keys([[32, 29], [32, 43], [32, 17]], 1.7, C.SIL) + Ci(32, 55, 2, C.SILD, 'stroke-width="1"'), 'rotate(-30 32 32)'));
out.bassoon = badge(
  T('M20 8 Q16 8 18 14 Q22 18 22 24', C.SILD, 2.6) + 
  P('M22 18 H34 V52 Q34 58 28 58 Q22 58 22 52 Z', C.WOOD) + P('M34 22 H42 V52 H34', C.WOOD) +
  P('M42 50 L46 14 H52 L50 50 Z', C.WOOD) + keys([[28, 26], [28, 34], [28, 42], [47, 26], [47, 38]], 1.7, C.SIL) + R(40, 8, 14, 7, 3, C.BLK) +
  P('M38 56 H46', 'none', 'stroke-width="2"'));
const clar = (len, bell, col, keyN, extra = '') => {
  const top = 6, bot = top + len;
  return P(`M30 ${top} H34 L35 ${top + 7} H29 Z`, C.BLK) + R(29, top + 7, 6, 4, 1, C.SILD, 'stroke-width="1"') +
    R(29, top + 10, 6, len - 14, 2, col) + P(`M29 ${bot - 4} L${32 - bell} ${bot + 6} H${32 + bell} L35 ${bot - 4} Z`, col) +
    keys(Array.from({ length: keyN }, (_, i) => [32, top + 16 + i * ((len - 26) / Math.max(1, keyN - 1))]), 1.6) + extra;
};
out.eb_clarinet = badge(G(clar(36, 5, C.BLK, 3), 'translate(0 8)'));
out.clarinet = badge(clar(46, 7, C.BLK, 4) );


const sax = (o) => {
  const { bx = 30, top = 12, bot = 44, rad = 12, bell = 8, neck = 'M30 12 Q30 6 22 6', col = C.BR } = o;
  const by = bot;
  return T(neck, col, 3) + R(15, 3, 9, 4.5, 2, C.BLK, 'transform="rotate(-8 20 5)"') +
    T(`M${bx} ${top} V${by - rad} Q${bx} ${by + 2} ${bx + rad} ${by + 2} Q${bx + rad * 2} ${by + 2} ${bx + rad * 2} ${by - rad - 2}`, col, 4.6) +
    cone(bx + rad * 2, by - rad - 2, 0, 3.2, bell + 1, 12, C.BR) +
    keys([[bx, top + 6], [bx, top + 12], [bx, top + 18], [bx, top + 24]].filter((p) => p[1] < by - rad - 2), 1.6);
};
out.soprano_sax = badge(
  T('M31 8 V50', C.BR, 4.2) + R(26, 4, 8, 4, 2, C.BLK) + P('M26 50 L24 59 H38 L36 50 Z', C.BR) + R(24, 56, 14, 3, 1.5, C.BRD) +
  keys([[31, 16], [31, 23], [31, 30], [31, 37]], 1.6) + P('M34 14 V40', 'none', `stroke="${C.HL}" stroke-width="1.4"`));
out.alto_sax = badge(sax({ top: 14, bot: 44, rad: 10, bell: 7, neck: 'M22 14 Q22 8 14 8' , bx: 22 }) );
out.tenor_sax = badge(sax({ top: 16, bot: 46, rad: 12, bell: 8, neck: 'M16 16 Q16 6 28 6', bx: 16 }));
out.baritone_sax = badge(
  sax({ top: 20, bot: 50, rad: 10, bell: 8, neck: 'M16 20 Q16 10 26 10 Q32 10 32 16', bx: 16 }) + Ci(32, 15, 4.5, C.BRD) + R(23, 4, 8, 4.5, 2, C.BLK, 'transform="rotate(-8 20 5)"'));

// ---- 打楽器 ----
const stick = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${D}" stroke-width="4.2" fill="none"/><path d="M${x1} ${y1} L${x2} ${y2}" stroke="${C.WOODL}" stroke-width="2" fill="none"/>` + Ci(x2, y2, 2.1, C.WH, 'stroke-width="1.1"');
out.snare = badge(
  P('M10 30 V46 Q10 54 32 54 Q54 54 54 46 V30', C.BLUE) + E(32, 30, 22, 8, C.WH) + E(32, 30, 17, 5.5, '#e6ecfa', 'stroke-width="1"') +
  P('M16 36 L18 52 M24 38 L25 54 M32 39 V55 M40 38 L39 54 M48 36 L46 52', 'none', 'stroke="#fff" stroke-width="1.2"') + Ci(10, 40, 1.3, C.SIL, 'stroke-width="0.8"') +
  stick(12, 8, 30, 27) + stick(52, 8, 34, 27));
const drumTop = (cx, cy, r, col = C.WH) => E(cx, cy, r, r * 0.8, col) + E(cx, cy, r * 0.65, r * 0.5, '#e6ecfa', 'stroke-width="0.9"');
out.tenors = badge(
  Ci(14, 32, 8.5, C.WH) + Ci(14, 32, 5.5, C.SIL, 'stroke-width="0.9"') + Ci(26, 21, 9, C.WH) + Ci(26, 21, 5.8, C.SIL, 'stroke-width="0.9"') +
  Ci(40, 21, 9, C.WH) + Ci(40, 21, 5.8, C.SIL, 'stroke-width="0.9"') + Ci(52, 32, 8.5, C.WH) + Ci(52, 32, 5.5, C.SIL, 'stroke-width="0.9"') +
  Ci(24, 40, 5, C.RED) + Ci(40, 40, 5, C.RED) + P('M24 45 L22 57 H42 L40 45', C.BLUE) + R(20, 54, 24, 5, 2.5, C.BLUED) + stick(6, 6, 18, 24));
const bassDrum = (num, r) => {
  const cy = 34;
  return E(32, cy, r, r, C.BLUE) + E(32, cy, r - 3.5, r - 3.5, C.WH) + E(32, cy, r - 8.5, r - 8.5, '#e6ecfa', 'stroke-width="0.9"') +
    (r > 12 ? [0, 60, 120, 180, 240, 300].map((a) => Ci(32 + Math.cos(a * Math.PI / 180) * (r - 1.6), cy + Math.sin(a * Math.PI / 180) * (r - 1.6), 1.2, C.SIL, 'stroke-width="0.7"')).join('') : '');
};
out.bass_drum = badge(
  Ci(14, 38, 9, C.BLUE) + Ci(14, 38, 6, C.WH) + Ci(32, 34, 12, C.BLUE) + Ci(32, 34, 8.5, C.WH) + Ci(50, 30, 9, C.BLUE) + Ci(50, 30, 6, C.WH) +
  P('M10 52 H54', 'none', 'stroke-width="1.5"'));
[1, 2, 3, 4, 5].forEach((i) => {
  const r = 8 + i * 3;
  const mallet = `<path d="M54 10 L44 20" stroke="${D}" stroke-width="4" fill="none"/><path d="M54 10 L44 20" stroke="${C.WOODL}" stroke-width="2" fill="none"/>` + Ci(55, 9, 3.5, C.RED);
  out['bass' + i] = badge(bassDrum(i, r) + mallet + `<g stroke="none" fill="${D}"><circle cx="9" cy="54" r="7.5" fill="${D}"/></g>` +
    `<text x="9" y="57.6" font-size="10" font-weight="800" text-anchor="middle" fill="#fff" stroke="none" font-family="sans-serif">${i}</text>`);
});
const cym = (cx, cy, r, ang) => `<g transform="rotate(${ang} ${cx} ${cy})">` + E(cx, cy, r, r * 0.55, C.BR) + E(cx, cy, r * 0.5, r * 0.28, C.HL, 'stroke-width="1"') + Ci(cx, cy, 2, C.BRD, 'stroke-width="1"') + '</g>';
out.cymbals_mid = badge(cym(19, 34, 17, -25) + cym(45, 34, 17, 25) + `<path d="M19 34 L22 52 M45 34 L42 52" stroke="${D}" stroke-width="3" fill="none"/><path d="M19 34 L22 52 M45 34 L42 52" stroke="${C.RED}" stroke-width="1.6" fill="none"/>` + sparkle(32, 28, 3.5));
out.cymbals_high = badge(cym(18, 14, 15, -20) + cym(46, 14, 15, 20) + `<path d="M18 14 L24 46 M46 14 L40 46" stroke="${D}" stroke-width="3" fill="none"/><path d="M18 14 L24 46 M46 14 L40 46" stroke="${C.RED}" stroke-width="1.6" fill="none"/>` + sparkle(32, 8, 3.5) + sparkle(8, 30, 2.5) + sparkle(56, 30, 2.5)
  + R(22, 46, 20, 8, 4, C.BLUE));
const bars = (n_, colA, colB, hasWoodGrain) => {
  let s = '';
  for (let i = 0; i < n_; i++) {
    const w = 6.5, x = 6 + i * 8.6, h = 34 - i * 3.4, y = 46 - h;
    s += R(x, y, w, h, 2, i % 2 ? colB : colA) + R(x + 1.5, y + 3, 1.4, 1.4, 0.7, C.WH, NS);
  }
  return s;
};
out.glockenspiel = badge(
  P('M5 54 H59 L53 12 H11 Z', C.SILD) + bars(6, C.SIL, '#bfe0f5') + stick(8, 8, 22, 26) + stick(56, 8, 42, 26) + R(5, 50, 54, 5, 2, C.BLUED) + sparkle(30, 8, 3));
out.xylophone = badge(
  P('M5 54 H59 L53 12 H11 Z', C.WOOD) + bars(6, C.WOODL, '#f3c995') + stick(8, 8, 22, 26) + stick(56, 8, 42, 26) + R(5, 50, 54, 5, 2, '#7a4a28'));
const flagFigure = (col) => `<path d="M16 6 V58" stroke="${D}" stroke-width="4.8" fill="none"/><path d="M16 6 V58" stroke="${C.SIL}" stroke-width="2.4" fill="none"/>` +
  P('M18 10 C30 4 38 18 56 10 V36 C38 44 30 30 18 36 Z', col) + P('M18 14 C30 8 38 22 56 14', 'none', 'stroke="#fff" stroke-width="1.4" opacity=".7"') + Ci(16, 6, 3, C.YEL);
out.flag = badge(flagFigure(C.RED));
out.none = badge(Ci(32, 32, 17, 'none', `stroke-dasharray="4 4" stroke-width="2"`) + P('M20 44 L44 20', 'none', `stroke="${C.RED}" stroke-width="3.5"`) + sparkle(32, 32, 0.01, 'none'));
module.exports = { out, stick, flagFigure, cym };
