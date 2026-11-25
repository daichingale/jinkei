const { C, D, n, P, Ci, E, R, NS, T, G, badge, sparkle, arrow, arrowPath, note, txt, dot, wrap } = require('./lib');
const { stick, flagFigure } = require('./instruments');
const { fig, fpole, top } = require('./figures');
const out = {};
// ---------- 隊形 ----------
const guide = (d) => P(d, 'none', 'stroke="#aeb9d6" stroke-width="1.6" stroke-dasharray="2.5 3"');
const row = (n_, x1, y1, x2, y2, f) => Array.from({ length: n_ }, (_, i) => { const t = n_ === 1 ? 0 : i / (n_ - 1); return dot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 3.1, f ? f(i) : undefined); }).join('');
const lead = (i) => (i === 0 ? C.YEL : C.BLUE);
out['shape-line'] = badge(guide('M8 32 H56') + row(7, 11, 32, 53, 32, lead));
out['shape-two-lines'] = badge(guide('M8 22 H56 M8 42 H56') + row(6, 12, 22, 52, 22, lead) + row(6, 12, 42, 52, 42));
out['shape-block'] = badge([0, 1, 2, 3].map((r) => row(5, 14, 14 + r * 12, 50, 14 + r * 12, (i) => (r === 0 && i === 0 ? C.YEL : C.BLUE))).join(''));
const arcPts = (cx, cy, r, a0, a1, k) => Array.from({ length: k }, (_, i) => { const a = (a0 + (a1 - a0) * i / (k - 1)) * Math.PI / 180; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
out['shape-arc'] = badge(guide('M10 46 A24 24 0 0 1 54 46') + arcPts(32, 56, 28, 208, 332, 7).map(([x, y], i) => dot(x, y - 0, 3.1, lead(i))).join(''));
out['shape-circle'] = badge(guide('M32 11 a21 21 0 1 0 0.01 0') + arcPts(32, 32, 21, -90, 270 - 36, 10).map(([x, y], i) => dot(x, y, 3.1, lead(i))).join(''));
out['shape-wedge'] = badge([1, 2, 3, 4].map((k) => row(k, 32 - (k - 1) * 7.5, 12 + (k - 1) * 13, 32 + (k - 1) * 7.5, 12 + (k - 1) * 13, (i) => (k === 1 ? C.YEL : C.BLUE))).join('') + guide('M32 8 L58 56 H6 Z'));
out['shape-diagonal'] = badge(guide('M10 54 L54 10') + row(7, 12, 52, 52, 12, lead));
const sc = Array.from({ length: 9 }, (_, i) => { const t = i / 8; return [10 + t * 44, 32 + Math.sin(t * Math.PI * 2) * 15]; });
out['shape-curve'] = badge(guide('M10 32 C 21 4 21 4 32 32 S 43 60 54 32') + sc.map(([x, y], i) => dot(x, y, 3.1, lead(i))).join(''));
const pent = Array.from({ length: 5 }, (_, i) => { const a = (-90 + i * 72) * Math.PI / 180; return [32 + Math.cos(a) * 22, 33 + Math.sin(a) * 22]; });
out['shape-poly'] = badge(P('M' + pent.map((p) => p.join(' ')).join(' L') + ' Z', 'none', 'stroke="#aeb9d6" stroke-width="1.8"') +
  pent.map((p, i) => { const q = pent[(i + 1) % 5]; return dot((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 2.4); }).join('') + pent.map(([x, y], i) => dot(x, y, 3.6, i === 0 ? C.YEL : C.BLUE)).join(''));
out['shape-follow'] = badge(P('M8 48 C 18 48 20 24 32 24 S 46 44 52 18', 'none', 'stroke="#aeb9d6" stroke-width="1.8" stroke-dasharray="2.5 3"') +
  [[10, 48], [19, 45], [25, 33], [33, 24], [40, 30], [45, 38]].map(([x, y], i) => dot(x, y, 3.1, i === 5 ? C.YEL : C.BLUE)).join('') + arrowPath('M47 34 L51 24', 52.5, 20, -1.2, C.RED, 2.4, 5.5));
const scat = [[14, 16], [30, 10], [49, 18], [22, 30], [41, 31], [10, 44], [30, 46], [52, 42], [44, 54], [18, 56]];
out['shape-scatter'] = badge(scat.map(([x, y], i) => dot(x, y, 3.1, i === 3 ? C.YEL : C.BLUE)).join('') + sparkle(57, 8, 2.4) + sparkle(7, 29, 2.4));
out['shape-company-front'] = badge([0, 1, 2].map((r) => row(8, 8, 12 + r * 8.5, 56, 12 + r * 8.5, (i) => (r === 0 && i === 0 ? C.YEL : C.BLUE))).map((s) => s.replace(/r="3.1"/g, 'r="2.5"')).join('') +
  P('M8 40 H56', 'none', 'stroke="#aeb9d6" stroke-width="1.2"') + arrow(32, 44, 32, 58, C.RED, 2.8, 6));
out['shape-v'] = badge(guide('M8 12 L32 54 L56 12') + [0, 1, 2, 3, 4, 5, 6].map((i) => { const t = i / 6; const x = t < 0.5 ? 10 + t * 2 * 22 : 32 + (t - 0.5) * 2 * 22; const y = t < 0.5 ? 14 + t * 2 * 38 : 52 - (t - 0.5) * 2 * 38; return dot(x, y, 3.1, i === 3 ? C.YEL : C.BLUE); }).join(''));
out['shape-cross'] = badge(guide('M32 8 V56 M8 32 H56') + row(5, 32, 12, 32, 52, (i) => (i === 2 ? C.YEL : C.BLUE)) + [[14, 32], [23, 32], [41, 32], [50, 32]].map(([x, y]) => dot(x, y)).join(''));

// ---------- 会場 (160x100) ----------
const plank = (x1, y1, x2, y2, col) => P(`M${x1} ${y1} L${x2} ${y2}`, 'none', `stroke="${col}" stroke-width="1" opacity=".5"`);
out['venue-gym'] = wrap(160, 100,
  `<defs><clipPath id="gc"><rect x="1" y="1" width="158" height="98" rx="10"/></clipPath></defs><g clip-path="url(#gc)">` +
  R(0, 0, 160, 100, 0, '#efe5cf', NS) + R(0, 0, 160, 8, 0, '#d9cdb0', NS) +
  [8, 38, 98, 128].map((x) => R(x, 10, 22, 12, 2, '#bfe3f7', 'stroke-width="1.2"') + P(`M${x + 11} 10 V22 M${x} 16 H${x + 22}`, 'none', 'stroke-width="1"')).join('') +
  R(30, 16, 100, 8, 0, '#fff', 'stroke-width="1.2"') +
  Array.from({ length: 10 }, (_, i) => R(30 + i * 10, 16, 10, 8, 0, i % 2 ? '#fff' : '#d63a3a', 'stroke-width="0.8"')).join('') +
  R(24, 24, 112, 7, 1, '#a5703f') + R(24, 31, 112, 5, 0, '#7e5230') + R(36, 24, 88, 7, 0, 'none', NS) +
  P('M0 36 H160 V100 H0 Z', '#e8b877', NS) + P('M0 36 L10 100 H0Z M160 36 L150 100 H160Z', '#d3a463', NS) +
  Array.from({ length: 8 }, (_, i) => P(`M${80 + (i - 3.5) * 8} 36 L${80 + (i - 3.5) * 26} 100`, 'none', 'stroke="#c99a5c" stroke-width="1"')).join('') +
  [46, 62, 80].map((y) => P(`M0 ${y} H160`, 'none', 'stroke="#d3a463" stroke-width="1"')).join('') +
  P('M38 44 H122 L146 94 H14 Z', 'none', 'stroke="#fff" stroke-width="2.4"') + P('M80 44 V94', 'none', 'stroke="#fff" stroke-width="2.4"') + E(80, 69, 20, 9, 'none', 'stroke="#fff" stroke-width="2.4"') +
  P('M58 44 L52 94 M102 44 L108 94', 'none', 'stroke="#4c8bf5" stroke-width="2"') + 
  [[44, 56], [70, 56], [90, 56], [116, 56]].map(([x, y]) => Ci(x, y, 0.1, 'none', NS)).join('') +
  P('M0 36 H160', 'none', 'stroke-width="1.5"') + `</g><rect x="1" y="1" width="158" height="98" rx="10" fill="none"/>`);
out['venue-stage'] = wrap(160, 100,
  `<defs><clipPath id="sc"><rect x="1" y="1" width="158" height="98" rx="10"/></clipPath><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></linearGradient></defs><g clip-path="url(#sc)">` +
  R(0, 0, 160, 100, 0, '#2a3566', NS) + R(24, 10, 112, 50, 0, '#3a4a8c', 'stroke-width="1"') + P('M24 10 H136', 'none', 'stroke="#ffd23f" stroke-width="3"') +
  P('M44 8 L28 62 H64 Z M80 8 L64 62 H100 Z M116 8 L100 62 H136 Z', 'url(#sg)', NS) + 
  P('M0 0 H34 Q22 20 28 60 L0 64Z M160 0 H126 Q138 20 132 60 L160 64Z', C.RED) + P('M8 0 Q14 30 8 64 M20 0 Q26 28 22 62 M152 0 Q146 30 152 64 M140 0 Q134 28 138 62', 'none', 'stroke="#b52d3a" stroke-width="1.4"') +
  P('M0 0 H160 V10 Q120 18 80 10 Q40 18 0 10 Z', '#c23545') + P('M0 56 H160 V100 H0Z', '#c8955c', NS) + P('M0 56 H160', 'none') +
  Array.from({ length: 9 }, (_, i) => P(`M${80 + (i - 4) * 9} 56 L${80 + (i - 4) * 24} 100`, 'none', 'stroke="#a97742" stroke-width="1"')).join('') +
  [20, 40, 62, 82, 100, 122, 140].map((x, i) => Ci(x, 96 + (i % 2) * 2, 8, '#181c33', NS)).join('') + [30, 52, 72, 92, 112, 132].map((x) => Ci(x, 100, 8, '#12152a', NS)).join('') +
  `</g><rect x="1" y="1" width="158" height="98" rx="10" fill="none"/>`);
out['venue-football'] = wrap(160, 100,
  `<defs><clipPath id="fc"><rect x="1" y="1" width="158" height="98" rx="10"/></clipPath><linearGradient id="fk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#d7efff"/></linearGradient></defs><g clip-path="url(#fc)">` +
  R(0, 0, 160, 38, 0, 'url(#fk)', NS) + E(30, 16, 14, 5, '#fff', NS) + E(40, 13, 10, 5, '#fff', NS) + E(120, 22, 14, 5, '#fff', NS) +
  P('M0 30 H160 V40 H0Z', '#8d97b5') + Array.from({ length: 40 }, (_, i) => Ci(2 + i * 4, 34 + (i % 3), 1.5, ['#e5484d', '#f5b83d', '#4c8bf5', '#fff'][i % 4], NS)).join('') +
  P('M0 40 H160 V100 H0Z', '#4fbf74', NS) + [0, 1, 2, 3, 4, 5].map((i) => P(`M0 ${40 + i * 10} H160 V${50 + i * 10} H0Z`, i % 2 ? '#43b068' : '#58c97f', NS)).join('') +
  [0, 1, 2, 3, 4, 5].map((i) => P(`M0 ${40 + i * 10} H160`, 'none', 'stroke="#fff" stroke-width="2" opacity=".9"')).join('') +
  P('M70 40 V20 M90 40 V20 M70 28 H90', 'none', `stroke="#f5b83d" stroke-width="3"`) + P('M70 40 V20 M90 40 V20 M70 28 H90', 'none', 'stroke="none"') +
  P('M80 40 V100', 'none', 'stroke="#fff" stroke-width="1.5" opacity=".7"') + E(80, 72, 16, 10, 'none', 'stroke="#fff" stroke-width="2"') + Ci(80, 72, 1.5, '#fff', NS) +
  `</g><rect x="1" y="1" width="158" height="98" rx="10" fill="none"/>`);
out['venue-floor'] = wrap(160, 100,
  `<defs><clipPath id="oc"><rect x="1" y="1" width="158" height="98" rx="10"/></clipPath></defs><g clip-path="url(#oc)">` +
  R(0, 0, 160, 100, 0, '#d9e2f2', NS) + R(12, 10, 136, 80, 6, '#f7efe0', 'stroke-width="1.5"') +
  Array.from({ length: 13 }, (_, i) => P(`M${12 + (i + 1) * 9.7} 10 V90`, 'none', 'stroke="#d9c9a8" stroke-width="1"')).join('') + Array.from({ length: 7 }, (_, i) => P(`M12 ${10 + (i + 1) * 8.9} H148`, 'none', 'stroke="#d9c9a8" stroke-width="1"')).join('') +
  P('M80 10 V90 M12 50 H148', 'none', 'stroke="#4c8bf5" stroke-width="2"') + Ci(80, 50, 14, 'none', 'stroke="#4c8bf5" stroke-width="2"') + Ci(80, 50, 2.6, C.RED, 'stroke-width="1"') +
  [[12, 10], [148, 10], [12, 90], [148, 90]].map(([x, y]) => Ci(x, y, 3, C.YEL, 'stroke-width="1.2"')).join('') +
  `</g><rect x="1" y="1" width="158" height="98" rx="10" fill="none"/>`);

// ---------- 空の状態 (240x160) ----------
const ebg = (inner) => wrap(240, 160, R(2, 2, 236, 156, 18, '#eef1fa', 'stroke="#c3cce3" stroke-width="1.2"') + inner);
out['empty-no-sets'] = ebg(
  R(40, 26, 160, 92, 10, '#f7efe0', 'stroke-width="1.5"') + P('M40 72 H200 M120 26 V118', 'none', 'stroke="#d9c9a8" stroke-width="1.2"') +
  [[66, 50], [86, 50], [106, 50], [146, 94], [166, 94], [186, 94]].map(([x, y]) => Ci(x, y, 5, 'none', `stroke="${C.SILD}" stroke-width="1.6" stroke-dasharray="3 3"`)).join('') +
  Ci(120, 72, 24, C.BLUE) + P('M120 60 V84 M108 72 H132', 'none', 'stroke="#fff" stroke-width="5"') + R(60, 128, 120, 14, 7, '#dfe6f7', 'stroke-width="1.2"') + [92, 110, 128, 146].map((x) => Ci(x, 135, 3, '#c3cce3', 'stroke-width="1"')).join('') + sparkle(30, 28, 5) + sparkle(212, 38, 4) + sparkle(204, 118, 3));
const ghost = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" opacity=".95">` + Ci(0, 0, 9, 'none', `stroke="${C.SILD}" stroke-width="2" stroke-dasharray="4 3"`) + P('M-14 28 Q-14 11 0 11 Q14 11 14 28 Z', 'none', `stroke="${C.SILD}" stroke-width="2" stroke-dasharray="4 3"`) + '</g>';
out['empty-no-parts'] = ebg(
  ghost(76, 56) + ghost(120, 50, 1.15) + ghost(164, 56) + Ci(168, 106, 18, C.BLUE) + P('M168 96 V116 M158 106 H178', 'none', 'stroke="#fff" stroke-width="4.5"') +
  R(40, 98, 78, 36, 8, '#fff', 'stroke-width="1.5"') + P('M52 112 H106 M52 122 H88', 'none', `stroke="${C.SILD}" stroke-width="3"`) + E(52, 38, 5, 5, C.BR, NS) + note(200, 52, C.BLUED) + sparkle(36, 56, 4));
out['empty-no-selection'] = ebg(
  R(36, 24, 168, 100, 10, '#f7efe0', 'stroke-width="1.5"') +
  [[70, 48], [100, 40], [130, 54], [160, 44], [84, 84], [118, 90], [150, 80], [180, 96]].map(([x, y], i) => Ci(x, y, 6, i < 4 ? C.BLUE : C.SILD, 'stroke-width="1.4"')).join('') +
  R(56, 28, 118, 36, 6, 'rgba(76,139,245,.12)', `stroke="${C.BLUE}" stroke-width="2" stroke-dasharray="5 4"`) +
  `<g transform="translate(158 74)"><path d="M0 0 L0 30 L8 23 L14 36 L20 33 L14 21 L25 21 Z" fill="#fff" stroke="${D}" stroke-width="1.6"/></g>` + R(70, 132, 100, 12, 6, '#dfe6f7', 'stroke-width="1.2"') + sparkle(26, 30, 4) + sparkle(214, 50, 4));

// ---------- ヘルプ (96x64) ----------
const hb = (inner) => wrap(96, 64, `<rect x="1.5" y="1.5" width="93" height="61" rx="15" fill="${C.BG}" stroke="#c3cce3" stroke-width="1"/>${inner}`);
const mini = (x, y, w, h, inner, lab) => R(x, y, w, h, 5, '#f7efe0', 'stroke-width="1.3"') + inner + (lab ? Ci(x + 6, y + 6, 6, C.NAVY, NS) + txt(x + 6, y + 9.2, lab, 8, '#fff') : '');
const sm = (x, y, f = C.BLUE) => dot(x, y, 2.5, f);
out['help-set'] = hb(
  mini(6, 12, 34, 40, [0, 1, 2, 3].map((i) => sm(12 + i * 7, 40)).join('') + [0, 1, 2, 3].map((i) => sm(12 + i * 7, 32)).join(''), 'A') +
  mini(56, 12, 34, 40, arcPts(73, 36, 10, 0, 330, 8).map(([x, y]) => sm(x, y)).join(''), 'B') + arrow(42, 32, 54, 32, C.RED, 3, 6));
out['help-count'] = hb(
  P('M20 54 L26 12 H34 L40 54 Z', C.BR) + R(22, 50, 20, 6, 3, C.BRD) + P('M31 48 L40 16', 'none', `stroke="${D}" stroke-width="2.4"`) + Ci(38, 22, 3.6, C.RED, 'stroke-width="1.2"') + Ci(30, 38, 2, C.WH, 'stroke-width="1"') +
  [0, 1, 2, 3].map((i) => Ci(55 + i * 10, 40 - (i === 0 ? 0 : 0), 4, i === 0 ? C.RED : C.BLUE, 'stroke-width="1.3"') + txt(55 + i * 10, 28, String(i + 1), 8.5, C.NAVY)).join(''));
out['help-hold'] = hb(
  Ci(30, 32, 18, C.WH, 'stroke-width="1.5"') + Ci(30, 32, 18, 'none', `stroke="${C.SILD}" stroke-width="2" stroke-dasharray="3 3" transform="scale(1)"`) + R(22, 24, 5.5, 16, 2, C.BLUE) + R(33, 24, 5.5, 16, 2, C.BLUE) +
  [0, 1, 2].map((i) => dot(60 + i * 11, 32, 4, C.BLUE)).join('') + P('M54 44 H82', 'none', `stroke="${C.SILD}" stroke-width="2" stroke-dasharray="3 3"`) + P('M54 20 H82', 'none', `stroke="${C.SILD}" stroke-width="2" stroke-dasharray="3 3"`));
out['help-transition'] = hb(
  [[10, 44], [10, 32], [10, 20]].map(([x, y]) => Ci(x + 4, y, 3.4, 'none', `stroke="${C.SILD}" stroke-width="1.6" stroke-dasharray="2 2"`)).join('') +
  [['M14 44 C34 44 46 52 70 50', 70, 50], ['M14 32 C40 32 52 32 76 32', 76, 32], ['M14 20 C34 20 46 12 70 14', 70, 14]].map(([d, x, y]) => P(d, 'none', `stroke="${C.RED}" stroke-width="2" stroke-dasharray="3 3"`) + dot(x + 6, y, 3.6)).join('') +
  [0, 1, 2].map((i) => arrow(70 + i * 0.1, [50, 32, 14][i], 80, [50, 32, 14][i], C.RED, 2.2, 4.5)).join('') + dot(40, 47.5, 3.2, C.YEL) + dot(44, 32, 3.2, C.YEL) + dot(40, 16.5, 3.2, C.YEL));
out['help-collision'] = hb(
  dot(30, 38, 8, C.BLUE) + dot(46, 38, 8, C.BLUE) + `<path d="M38 28 L40 33 L45 31 L42 36 L47 38 L42 40 L44 45 L39 42 L36 47 L36 41 L30 41 L35 37 L31 32 L37 34 Z" fill="${C.YEL}" stroke="${D}" stroke-width="1.2" transform="translate(0 -2)"/>` +
  P('M72 12 L90 44 H54 Z', C.RED, '') + P('M72 12 L90 44 H54 Z', C.YEL) + R(70.5, 22, 3, 12, 1.5, D, NS) + Ci(72, 38.5, 1.8, D, NS) + arrow(14, 38, 20, 38, C.RED, 2, 4) + arrow(62, 38, 56, 38, C.RED, 0.1, 0.1));
out['help-kami-shimo'] = hb(
  R(8, 8, 80, 30, 5, '#f3e3c8', 'stroke-width="1.3"') + P('M8 14 H88', 'none', `stroke="${C.RED}" stroke-width="2.4"`) +
  txt(18, 31, '下手', 9, C.BLUED) + txt(78, 31, '上手', 9, C.RED) + txt(48, 27, 'ステージ', 8, '#7a4a28') +
  [14, 26, 38, 50, 62, 74, 82].map((x) => E(x, 51, 4, 4, '#aab4cf', 'stroke-width="1"') + E(x, 58, 6, 4, '#aab4cf', 'stroke-width="1"')).join('') +
  txt(48, 44, '▲ 客席から見て', 7, D, 'stroke="none"') );
out['help-select'] = hb(
  [[22, 20], [60, 18], [76, 44], [20, 48], [38, 52]].map(([x, y]) => dot(x, y, 4, C.SILD)).join('') +
  P('M26 24 C20 34 34 48 52 46 C70 44 72 28 56 24 C44 20 34 14 26 24 Z', 'rgba(76,139,245,.15)', `stroke="${C.BLUE}" stroke-width="2.2" stroke-dasharray="4 3"`) +
  [[40, 34], [50, 36], [34, 26]].map(([x, y]) => Ci(x, y, 4, C.BLUE, 'stroke-width="1.3"') + Ci(x, y, 6.5, 'none', `stroke="${C.YEL}" stroke-width="1.6"`)).join('') +
  `<g transform="translate(64 40)"><path d="M0 0 L0 20 L5 15 L9 24 L13 22 L9 14 L16 14 Z" fill="#fff" stroke="${D}" stroke-width="1.4"/></g>`);
out['help-drag'] = hb(
  Ci(24, 40, 7, 'none', `stroke="${C.SILD}" stroke-width="2" stroke-dasharray="3 3"`) + arrowPath('M30 36 C40 20 54 20 62 28', 66, 33, 0.9, C.RED, 2.6, 6) + dot(70, 40, 7, C.BLUE) +
  `<g transform="translate(66 38)"><path d="M0 0 L0 20 L5 15 L9 24 L13 22 L9 14 L16 14 Z" fill="#fff" stroke="${D}" stroke-width="1.4"/></g>` + sparkle(24, 14, 3));
out['help-play'] = hb(
  Ci(30, 32, 20, C.BLUE) + P('M24 21 L42 32 L24 43 Z', '#fff', 'stroke-width="1.5"') + [0, 1, 2].map((i) => dot(62 + i * 9, 24 + i * 8, 3.4, i === 2 ? C.YEL : C.BLUE)).join('') + P('M58 20 L80 52', 'none', `stroke="${C.SILD}" stroke-width="2" stroke-dasharray="3 3"`));
out['help-video'] = hb(
  R(12, 20, 72, 34, 5, C.NAVY) + R(18, 25, 60, 24, 3, '#9ec4ff', 'stroke-width="1"') + P('M42 30 L58 37 L42 44 Z', '#fff', 'stroke-width="1.3"') +
  P('M12 20 L18 10 H88 L84 20 Z', C.BR) + [0, 1, 2, 3, 4].map((i) => P(`M${22 + i * 14} 10 L${16 + i * 14} 20 H${24 + i * 14} L${30 + i * 14} 10 Z`, C.NAVY, 'stroke="none"')).join('') + P('M12 20 L18 10 H88 L84 20 Z', 'none'));
out['help-score'] = hb(
  [0, 1, 2, 3, 4].map((i) => P(`M8 ${20 + i * 6} H88`, 'none', 'stroke-width="1.2"')).join('') + R(12, 20, 3.4, 24, 0.5, D, NS) + R(18, 20, 3.4, 24, 0.5, D, NS) +
  [[32, 32], [44, 32], [54, 32], [66, 32], [78, 32]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="2.6" transform="rotate(-18 ${x} ${y})" fill="${D}" stroke="none"/><path d="M${x + 3} ${y - 1} V${y - 16}" stroke="${D}" stroke-width="1.4"/>`).join('') +
  P('M34.4 16 H46.4 M54.4 16 H68.4', 'none', `stroke="${D}" stroke-width="3"`) + txt(79, 14, '>', 8, C.RED) + R(14, 48, 26, 8, 4, '#fff', 'stroke-width="1"') + sparkle(84, 54, 3));
out['help-save'] = hb(
  P('M26 10 H62 L72 20 V54 H26 Z', C.BLUE) + R(34, 10, 24, 14, 2, C.WH, 'stroke-width="1.2"') + R(50, 12, 5, 9, 1, C.SILD, 'stroke-width="1"') + R(32, 32, 34, 22, 3, C.WH, 'stroke-width="1.2"') + P('M37 38 H61 M37 44 H55', 'none', `stroke="${C.SILD}" stroke-width="2"`) +
  Ci(72, 48, 10, C.GRN) + P('M67 48 L71 52 L78 43', 'none', 'stroke="#fff" stroke-width="3"'));
module.exports = { out };
