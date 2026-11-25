const { C, D, n, P, Ci, E, R, NS, T, G, badge, sparkle, arrow, arrowPath, note, txt, wrap } = require('./lib');
const out = {};
const HAIR = '#f29a3c', HAIRD = '#c9701d', HAIRL = '#ffc873', SKIN = '#ffe3cd', JK = '#2f3f86', JKL = '#4458ad', GLV = '#ffffff';
const poly = (pts) => 'M' + pts.map((p) => n(p[0]) + ' ' + n(p[1])).join(' L');
const eyeOpen = (cx, cy, dx = 0, dy = 0, small = false) => {
  const pr = small ? 0.62 : 1;
  return E(cx, cy, 8, 10.4, '#fff', 'stroke-width="1.4"') + E(cx + dx, cy + dy + 1.2, 6.2 * (small ? 0.8 : 1), 8.3 * (small ? 0.85 : 1), '#3a8dff', 'stroke-width="1"') +
    E(cx + dx, cy + dy + 5, 4.4, 3, '#8fe4ff', NS) + E(cx + dx, cy + dy + 0.6, 3.1 * pr + 0.6, 4.9 * pr + 0.4, '#1d2a5c', NS) +
    Ci(cx + dx - 2.2, cy + dy - 3, 2.4, '#fff', NS) + Ci(cx + dx + 2.6, cy + dy + 3.4, 1.2, '#fff', NS) +
    P(`M${n(cx - 8.4)} ${n(cy - 2)} Q${n(cx)} ${n(cy - 14)} ${n(cx + 8.4)} ${n(cy - 2)}`, 'none', `stroke-width="2.8"`) +
    P(`M${n(cx - 8.4)} ${n(cy - 2)} l-1.6 -2.2`, 'none', 'stroke-width="1.6"');
};
const eyeHappy = (cx, cy) => P(`M${cx - 7.5} ${cy + 3} Q${cx} ${cy - 9} ${cx + 7.5} ${cy + 3}`, 'none', 'stroke-width="2.8"');
const mouths = {
  smile: (x, y) => P(`M${x - 6} ${y} Q${x} ${y + 6} ${x + 6} ${y}`, 'none', 'stroke-width="1.8"'),
  open: (x, y) => P(`M${x - 8} ${y - 1} Q${x} ${y + 2} ${x + 8} ${y - 1} Q${x + 7} ${y + 10} ${x} ${y + 10} Q${x - 7} ${y + 10} ${x - 8} ${y - 1} Z`, '#c0394f', 'stroke-width="1.5"') + E(x, y + 7.2, 3.8, 2.2, '#ff8fa3', NS),
  o: (x, y) => E(x, y + 2, 3.2, 4, '#c0394f', 'stroke-width="1.5"'),
  flat: (x, y) => P(`M${x - 4} ${y + 2} Q${x} ${y + 1} ${x + 4} ${y + 3}`, 'none', 'stroke-width="1.8"'),
  wavy: (x, y) => P(`M${x - 8} ${y + 3} q2 -4 4 0 t4 0 t4 0 t4 0`, 'none', 'stroke-width="1.8"'),
  grin: (x, y) => P(`M${x - 7} ${y - 1} Q${x} ${y + 3} ${x + 7} ${y - 1} Q${x + 5} ${y + 8} ${x} ${y + 8} Q${x - 5} ${y + 8} ${x - 7} ${y - 1} Z`, '#c0394f', 'stroke-width="1.5"') + E(x, y + 5.6, 3, 1.8, '#ff8fa3', NS),
};
function head(o = {}) {
  const { eyes = 'open', mouth = 'smile', tails = true, dx = 0, dy = 0, brows = null, tilt = 0 } = o;
  let s = '';
  if (tails) {
    s += P('M30 40 C14 44 8 70 16 96 C20 104 30 100 28 90 C26 76 32 62 36 52 Z', HAIR) + P('M90 40 C106 44 112 70 104 96 C100 104 90 100 92 90 C94 76 88 62 84 52 Z', HAIR) +
      P('M16 96 C14 88 14 80 18 70 M104 96 C106 88 106 80 102 70', 'none', `stroke="${HAIRD}" stroke-width="1.4"`);
    s += R(24, 38, 12, 10, 4, C.RED, 'transform="rotate(-18 30 43)"') + R(84, 38, 12, 10, 4, C.RED, 'transform="rotate(18 90 43)"');
  }
  s += P('M30 28 C30 12 90 12 90 28 L92 52 C94 74 78 84 60 84 C42 84 26 74 28 52 Z', HAIRD, NS);
  s += E(60, 54, 33, 29.5, SKIN);
  // 前髪
  s += P('M26 52 C22 24 42 16 60 16 C78 16 98 24 94 52 C92 46 90 42 87 38 C86 47 80 50 76 42 C73 52 65 50 62 41 C58 52 50 52 48 42 C44 50 38 48 36 38 C32 42 28 46 26 52 Z', HAIR);
  s += P('M33 30 C40 22 50 20 56 20 M70 21 C78 22 86 26 88 32', 'none', `stroke="${HAIRL}" stroke-width="2.4" opacity=".9"`);
  s += P('M26 52 C25 62 27 70 31 76 C33 68 33 60 36 52 Z', HAIR) + P('M94 52 C95 62 93 70 89 76 C87 68 87 60 84 52 Z', HAIR);
  // 目
  const ex1 = 45, ex2 = 75, ey = 58;
  if (eyes === 'open') s += eyeOpen(ex1, ey, dx, dy) + eyeOpen(ex2, ey, dx, dy);
  else if (eyes === 'happy') s += eyeHappy(ex1, ey) + eyeHappy(ex2, ey);
  else if (eyes === 'wink') s += eyeOpen(ex1, ey, dx, dy) + eyeHappy(ex2, ey);
  else if (eyes === 'worry') s += eyeOpen(ex1, ey, 0, 0, true) + eyeOpen(ex2, ey, 0, 0, true);
  if (brows === 'worry') s += P('M36 42 L52 38 M84 42 L68 38', 'none', `stroke="${HAIRD}" stroke-width="2"`);
  if (brows === 'think') s += P('M37 42 Q45 38 53 41 M69 40 Q77 36 84 38', 'none', `stroke="${HAIRD}" stroke-width="2"`);
  s += E(36, 71, 5.4, 3, C.PINK, 'opacity=".75" stroke="none"') + E(84, 71, 5.4, 3, C.PINK, 'opacity=".75" stroke="none"');
  s += (mouths[mouth] || mouths.smile)(60, 70.5);
  // 帽子 (ドラムメジャー風)
  s += `<g transform="rotate(${tilt} 60 20)">` + P('M47 22 L49 2 Q60 -2 71 2 L73 22 Q60 26 47 22 Z', '#fff') + P('M47.4 14 Q60 18 72.6 14 L73 22 Q60 26 47 22 Z', C.YEL) +
    `<path d="M60 4.5 L61.4 8 L65 8.3 L62.3 10.6 L63.2 14 L60 12 L56.8 14 L57.7 10.6 L55 8.3 L58.6 8 Z" fill="${C.RED}" stroke="${D}" stroke-width="0.8"/>` +
    P('M72 4 C84 -4 92 6 88 14 C86 8 80 6 72 8 Z', C.RED) + P('M45 24 Q60 30 75 24', 'none', `stroke="${D}" stroke-width="2.2"`) + `</g>`;
  return s;
}
const arm = (pts, hand = true, glove = true) => T(poly(pts), JK, 7.2) + P(poly(pts.slice(0, 2)), 'none', 'stroke="none"') +
  (hand ? Ci(pts[pts.length - 1][0], pts[pts.length - 1][1], 4.6, GLV, 'stroke-width="1.4"') : '');
function body(o = {}) {
  const { legs = [[52, 117, 52, 130], [68, 117, 68, 130]], lift = 0 } = o;
  let s = E(60, 136.5, 25, 3.6, 'rgba(0,0,0,.2)', NS);
  // 脚
  legs.forEach(([x1, y1, x2, y2]) => { s += T(`M${x1} ${y1} L${x2} ${y2 - 4}`, '#fff', 6.5) + E(x2, y2, 6, 4, C.NAVY, 'stroke-width="1.4"') + R(x2 - 5, y2 - 7, 10, 3.4, 1.5, C.RED, 'stroke-width="1"'); });
  // 胴 + スカート
  s += P('M43 112 L40 124 Q60 130 80 124 L77 112 Z', '#fff') + P('M47 113 L45 124 M53 114 L52 126 M60 114 V127 M67 114 L68 126 M73 113 L75 124', 'none', 'stroke="#c6d0ea" stroke-width="1"') + P('M43 112 H77', 'none', `stroke="${C.RED}" stroke-width="3"`);
  s += P('M46 84 Q60 90 74 84 L79 112 H41 Z', JK) + P('M54 86 L60 112 L66 86 Q60 91 54 86 Z', '#fff', 'stroke-width="1.2"') +
    [94, 101, 108].map((y) => Ci(60, y, 1.6, C.YEL, 'stroke-width="0.8"')).join('') + P('M46 84 Q60 94 74 84', 'none', `stroke="${C.RED}" stroke-width="3.4"`) +
    P('M44 100 L76 92 M44 104 L76 96', 'none', `stroke="${JKL}" stroke-width="1.2"`) + P('M41 106 H79', 'none', `stroke="${C.YEL}" stroke-width="2"`);
  s += P('M45 86 q-6 0 -8 5 q6 2 11 -2 Z', C.YEL, 'stroke-width="1.1"') + P('M75 86 q6 0 8 5 q-6 2 -11 -2 Z', C.YEL, 'stroke-width="1.1"');
  return s;
}
const mascot = (arms, hd = {}, extra = '', bd = {}, armsFront = true, vb = [120, 140]) => {
  const armsS = arms.map((a) => arm(a)).join('');
  return wrap(vb[0], vb[1], (extra.pre || '') + body(bd) + (armsFront ? '' : armsS) + head(hd) + (armsFront ? armsS : '') + (extra.post || (typeof extra === 'string' ? extra : '')));
};
const bubble = (x, y, r, t) => Ci(x, y, r, '#fff', 'stroke-width="1.5"') + txt(x, y + r * 0.38, t, r * 1.3, C.BLUED);
const waveLines = (x, y) => P(`M${x} ${y} q4 -5 8 0 M${x - 2} ${y + 6} q5 -6 10 0`, 'none', `stroke="${C.BLUE}" stroke-width="1.8"`);

out['mascot-wave'] = mascot([[[74, 90], [90, 82], [94, 62]], [[46, 90], [40, 100], [44, 108]]], { eyes: 'open', mouth: 'open', dy: 0 },
  waveLines(98, 50) + sparkle(18, 20, 4) + sparkle(106, 30, 3));
out['mascot-point'] = mascot([[[74, 90], [90, 86], [102, 72]], [[46, 90], [38, 98], [47, 106]]], { eyes: 'wink', mouth: 'grin', dx: 0, tilt: -3 },
  { post: `<g transform="translate(103 71) rotate(-48)">` + R(-1.8, -12, 3.6, 12, 1.8, '#fff', 'stroke-width="1.3"') + `</g>` + sparkle(110, 52, 3.4) + sparkle(16, 28, 3) + P('M98 44 L104 36 M106 50 L114 46', 'none', `stroke="${C.YEL}" stroke-width="2.4"`) });
out['mascot-think'] = mascot([[[74, 90], [84, 96], [67, 82]], [[46, 90], [42, 102], [66, 104]]], { eyes: 'open', mouth: 'flat', dx: 2, dy: -3, brows: 'think' },
  { post: Ci(88, 22, 2.4, '#fff', 'stroke-width="1.2"') + Ci(96, 14, 3.4, '#fff', 'stroke-width="1.2"') + `<g transform="translate(0 0)">` + P('M92 10 a10 8 0 1 1 20 0 a10 8 0 1 1 -20 0Z', '#fff', 'stroke-width="1.5"') + `</g>` + txt(102, 17, '?', 14, C.BLUED) }, {}, true);
out['mascot-cheer'] = mascot([[[74, 90], [92, 74], [100, 48]], [[46, 90], [28, 74], [20, 48]]], { eyes: 'happy', mouth: 'open' },
  sparkle(12, 24, 4.5) + sparkle(108, 22, 4.5) + sparkle(22, 8, 3) + sparkle(100, 6, 3) + P('M8 70 l5 -3 M112 70 l-5 -3', 'none', `stroke="${C.YEL}" stroke-width="2.4"`) + note(102, 90, C.BLUED) + note(14, 96, C.RED),
  { legs: [[52, 117, 49, 128], [68, 117, 71, 128]] });
out['mascot-oops'] = mascot([[[74, 90], [94, 90], [86, 70]], [[46, 90], [26, 90], [34, 70]]], { eyes: 'worry', mouth: 'wavy', brows: 'worry', tilt: 3 },
  { post: P('M96 30 C96 30 91 38 91 42 a5 5 0 0 0 10 0 C101 38 96 30 96 30Z', '#8fe4ff', 'stroke-width="1.3"') + P('M94 40 q1 3 3 3', 'none', 'stroke="#fff" stroke-width="1" opacity=".9"') + P('M14 30 l6 4 M10 38 l7 1 M104 56 l7 -3', 'none', `stroke="${C.BLUE}" stroke-width="2"`) + txt(18, 24, '!', 14, C.RED) }, {}, true);
out['mascot-baton'] = mascot([[[74, 90], [90, 84], [96, 70]], [[46, 90], [36, 98], [46, 106]]], { eyes: 'open', mouth: 'smile', dx: 2, dy: -1, tilt: -3 },
  { pre: '', post: `<g transform="rotate(32 96 70)"><path d="M96 38 V104" stroke="${D}" stroke-width="5.2"/><path d="M96 38 V104" stroke="#fff" stroke-width="2.8"/><path d="M96 40 V52 M96 90 V102" stroke="${C.YEL}" stroke-width="2.8"/><circle cx="96" cy="37" r="3.6" fill="${C.YEL}" stroke="${D}" stroke-width="1.2"/></g>` + Ci(96, 70, 4.6, GLV, 'stroke-width="1.4"') +
    arrowPath('M108 28 C116 40 112 56 104 62', 102, 63.5, 2.4, C.BLUE, 2.2, 5) + sparkle(14, 26, 4) + note(16, 80, C.BLUED) + note(106, 100, C.RED) }, {}, false);
// 顔アイコン
out['mascot-face'] = wrap(64, 64, `<rect x="1.5" y="1.5" width="61" height="61" rx="15" fill="#fde9c9" stroke="#e9c58f" stroke-width="1"/><g transform="translate(-3 8) scale(.58)">` + head({ tails: false, eyes: 'open', mouth: 'smile' }).replace('M30 28 C30 12', 'M30 28 C30 12') + `</g>`);
module.exports = { out };
