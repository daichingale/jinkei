const { C, D, n, P, Ci, E, R, NS, T, G, badge, sparkle, arrow, arrowPath, note, txt } = require('./lib');
const out = {};
const poly = (pts) => 'M' + pts.map((p) => n(p[0]) + ' ' + n(p[1])).join(' L');
const limb = (pts, col, w) => T(poly(pts), col, w);
// 人物 (かわいい小さな人形)。arms/legs は点列。
function fig(o) {
  const head = o.head || [32, 14], neck = o.neck || [32, 22], hip = o.hip || [32, 38];
  const side = o.side || 0; // -1 左向き 1 右向き 0 正面
  let s = o.behind || '';
  (o.backArms || []).forEach((a) => { s += limb(a, C.BLUED, 3.6) + (o.noHand ? '' : Ci(a[a.length - 1][0], a[a.length - 1][1], 2.2, C.SKIN, 'stroke-width="1.2"')); });
  (o.legs || []).forEach((l) => {
    const p = l.p || l, f = l.f === undefined ? 0 : l.f, e = p[p.length - 1];
    s += limb(p, C.WH, 4.2);
    s += E(e[0] + f, e[1] + (l.up ? -0.5 : 1), l.sv ? 2.2 : 3.8, l.sv ? 3.8 : 2.4, C.BLK, 'stroke-width="1.2"');
  });
  s += T(poly([neck, hip]), C.BLUE, o.tw || 9);
  s += P(`M${n(hip[0] - 4.2)} ${n(hip[1] - 2)} L${n(hip[0] + 4.2)} ${n(hip[1] - 2)}`, 'none', `stroke="${C.YEL}" stroke-width="2"`);
  s += Ci((neck[0] + hip[0]) / 2, (neck[1] + hip[1]) / 2 - 1, 1, C.YEL, 'stroke-width="0.6"');
  (o.arms || []).forEach((a) => { s += limb(a, C.BLUE, 3.6) + Ci(a[a.length - 1][0], a[a.length - 1][1], 2.3, C.SKIN, 'stroke-width="1.2"'); });
  s += o.mid || '';
  const [hx, hy] = head;
  s += Ci(hx, hy, 6.6, C.SKIN);
  // 帽子 (しゃこー) と羽根
  s += R(hx - 6.8 + side * 0.6, hy - 11, 13.6, 7, 2.6, C.NAVY) + P(`M${n(hx - 7)} ${n(hy - 4.4)} H${n(hx + 7)}`, 'none', `stroke-width="1.5"`) +
    R(hx - 6.8 + side * 0.6, hy - 6.6, 13.6, 1.8, 0.9, C.YEL, NS) + E(hx + side * 1.4, hy - 13, 2.1, 3.2, C.RED, 'stroke-width="1.1"');
  const ex = side * 3.4;
  if (side === 0) s += `<g stroke="none" fill="${D}"><circle cx="${n(hx - 2.7)}" cy="${n(hy + 0.3)}" r="1"/><circle cx="${n(hx + 2.7)}" cy="${n(hy + 0.3)}" r="1"/></g>` + P(`M${n(hx - 1.4)} ${n(hy + 2.8)} Q${n(hx)} ${n(hy + 4)} ${n(hx + 1.4)} ${n(hy + 2.8)}`, 'none', 'stroke-width="1"');
  else s += `<g stroke="none" fill="${D}"><circle cx="${n(hx + ex)}" cy="${n(hy + 0.3)}" r="1"/></g>` + P(`M${n(hx + ex - 0.6 * side)} ${n(hy + 3)} q${n(side * 1.2)} 1 ${n(side * 2)} 0`, 'none', 'stroke-width="1"');
  s += `<ellipse cx="${n(hx + (side === 0 ? -4.4 : side * 1))}" cy="${n(hy + 2.2)}" rx="1.4" ry="0.9" fill="${C.PINK}" stroke="none" opacity=".8"/>`;
  s += o.front || '';
  return s;
}
const ground = (y = 59, x1 = 8, x2 = 56) => P(`M${x1} ${y} H${x2}`, 'none', `stroke="#b3bdd6" stroke-width="2"`);
const B = (inner) => badge(ground() + inner);
const mirror = (pts) => pts.map(([x, y]) => [64 - x, y]);

// ---------- 姿勢 ----------
const armsDown = [[[26.5, 24], [24.5, 32], [25.5, 40]], [[37.5, 24], [39.5, 32], [38.5, 40]]];
out['pose-attention'] = B(fig({ arms: armsDown, legs: [{ p: [[29.5, 38], [29.5, 49], [29.5, 57]], f: -1.2 }, { p: [[34.5, 38], [34.5, 49], [34.5, 57]], f: 1.2 }] }));
out['pose-rest'] = B(fig({ backArms: [[[26.5, 24], [21, 32], [28, 39]], [[37.5, 24], [43, 32], [36, 39]]], noHand: true,
  legs: [{ p: [[29, 38], [24, 48], [20, 57]], f: -1.6 }, { p: [[35, 38], [40, 48], [44, 57]], f: 1.6 }] }));
out['pose-wide'] = B(fig({ hip: [32, 39], arms: [[[26.5, 24], [18.5, 30], [26, 38]], [[37.5, 24], [45.5, 30], [38, 38]]],
  legs: [{ p: [[28.5, 39], [18, 47], [11, 57]], f: -2 }, { p: [[35.5, 39], [46, 47], [53, 57]], f: 2 }] }));
out['pose-cross'] = B(fig({ arms: [], legs: [{ p: [[30, 38], [32.5, 48], [37, 57]], f: 1.4 }, { p: [[34, 38], [31.5, 48], [27, 57]], f: -1.4 }],
  front: T('M26 28 L38 26', C.BLUE, 3.6) + T('M38 28 L26 26', C.BLUED, 3.6) + Ci(26, 27.2, 2.2, C.SKIN, 'stroke-width="1.2"') + Ci(38, 27.2, 2.2, C.SKIN, 'stroke-width="1.2"') }));
out['pose-kneel'] = B(fig({ head: [31, 21], neck: [30, 29], hip: [29, 43], side: 1,
  arms: [[[31, 31], [37, 38], [42, 44]]],
  legs: [{ p: [[29, 43], [20, 56], [8, 57]], f: -1, sv: false }, { p: [[29, 43], [42, 45], [42, 57]], f: 2 }] }));
out['pose-kneel2'] = B(fig({ head: [32, 22], neck: [32, 30], hip: [32, 44], tw: 9,
  arms: [[[26.5, 32], [25, 40], [28, 47]], [[37.5, 32], [39, 40], [36, 47]]],
  legs: [{ p: [[29, 44], [27, 56]], f: 0, up: true }, { p: [[35, 44], [37, 56]], f: 0, up: true }],
  behind: E(23, 57, 3.2, 1.8, C.BLK, 'stroke-width="1.1"') + E(41, 57, 3.2, 1.8, C.BLK, 'stroke-width="1.1"') }));
out['pose-lunge'] = B(fig({ head: [31, 15], neck: [30, 23], hip: [27, 38], side: 1,
  arms: [[[31, 25], [38, 27], [44, 24]]], backArms: [[[29, 25], [22, 28], [16, 25]]],
  legs: [{ p: [[27, 38], [41, 44], [43, 57]], f: 2.2 }, { p: [[27, 38], [17, 48], [8, 57]], f: -1.5 }] }));
out['pose-crouch'] = B(fig({ head: [32, 25], neck: [32, 32], hip: [32, 46], 
  arms: [[[27, 34], [21, 42], [22, 50]], [[37, 34], [43, 42], [42, 50]]],
  legs: [{ p: [[29, 46], [20, 48], [23, 57]], f: -1.4 }, { p: [[35, 46], [44, 48], [41, 57]], f: 1.4 }] }));
out['pose-toe'] = B(fig({ head: [32, 11], neck: [32, 19], hip: [32, 35], arms: [[[26.5, 21], [20, 24], [17, 17]], [[37.5, 21], [44, 24], [47, 17]]],
  legs: [{ p: [[29.5, 35], [29.5, 46], [30, 55]], sv: true, f: 0 }, { p: [[34.5, 35], [34.5, 46], [34, 55]], sv: true, f: 0 }] }) +
  arrow(14, 52, 14, 44, C.RED, 2, 4) + arrow(50, 52, 50, 44, C.RED, 2, 4) + sparkle(50, 12, 3));

// ---------- 足の運び ----------
const lines = (x1, x2, ys, col = '#8c97b8') => ys.map((y, i) => P(`M${x1 + (i % 2) * 3} ${y} H${x2}`, 'none', `stroke="${col}" stroke-width="2"`)).join('');
out['step-glide'] = B(lines(4, 15, [24, 32, 40]) + fig({ head: [37, 15], neck: [36, 23], hip: [33, 38], side: 1,
  arms: [[[36, 25], [40, 32], [44, 36]]], backArms: [[[34, 25], [30, 31], [27, 37]]],
  legs: [{ p: [[33, 38], [42, 47], [50, 55]], f: 2.5 }, { p: [[33, 38], [26, 48], [20, 55]], f: -2 }] }));
out['step-back'] = B(fig({ head: [30, 15], neck: [30, 23], hip: [30, 38], side: 1,
  arms: [[[31, 25], [34, 32], [36, 38]]], backArms: [[[29, 25], [26, 32], [24, 38]]],
  legs: [{ p: [[30, 38], [34, 48], [37, 57]], f: 2 }, { p: [[30, 38], [25, 47], [19, 54]], f: -2 }] }) +
  arrowPath('M50 46 C50 56 40 58 28 54', 24, 53, Math.PI * 0.98, C.RED, 2.6, 5.5) + P('M46 30 H58 M46 38 H56', 'none', 'stroke="#8c97b8" stroke-width="2"'));
out['step-slide'] = B(fig({ arms: armsDown, legs: [{ p: [[29.5, 38], [27, 48], [24, 57]], f: -1 }, { p: [[34.5, 38], [43, 46], [50, 57]], f: 2 }] }) +
  arrow(8, 33, 22, 33, C.RED, 2.6, 5) + lines(4, 14, [42, 50]) + sparkle(54, 20, 2.5));
out['step-jazz'] = B(fig({ head: [32, 12], neck: [32, 20], hip: [32, 36], arms: [[[26.5, 22], [18, 20], [14, 12]], [[37.5, 22], [46, 20], [50, 12]]],
  legs: [{ p: [[29.5, 36], [27, 47], [29, 56]], f: -1 }, { p: [[34.5, 36], [43, 41], [44, 50]], f: 2 }] }) +
  sparkle(10, 8, 3.5) + sparkle(54, 8, 3.5) + sparkle(52, 36, 2.6) + sparkle(12, 30, 2.6));
out['step-high'] = B(fig({ head: [31, 14], neck: [30, 22], hip: [30, 38], side: 1, arms: [[[31, 24], [37, 28], [40, 24]]], backArms: [[[29, 24], [24, 29], [24, 35]]],
  legs: [{ p: [[30, 38], [43, 38], [43, 49]], f: 2 }, { p: [[30, 38], [29, 48], [28, 57]], f: 1.5 }] }) + arrow(52, 46, 52, 30, C.RED, 2.6, 5) + sparkle(14, 18, 3));
out['step-mark'] = B(fig({ arms: armsDown, legs: [{ p: [[29.5, 38], [29.5, 49], [29.5, 57]], f: -1.2 }, { p: [[34.5, 38], [38, 46], [38, 53]], f: 1.2 }] }) +
  arrow(51, 56, 51, 44, C.RED, 2, 4) + arrow(12, 44, 12, 56, C.BLUE, 2, 4) + txt(14, 30, '1', 9, C.BLUED) + txt(50, 30, '2', 9, C.RED));

// ---------- 楽器の構え (トランペット) ----------
const trp = (x, y, ang, sc = 1) => `<g transform="translate(${x} ${y}) rotate(${ang}) scale(${sc})">` +
  T('M0 0 H20', C.BR, 3) + P('M18 -3 L28 -8 V8 L18 3 Z', C.BR) + R(-3, -2, 4, 4, 1.5, C.SIL, 'stroke-width="1"') + P('M5 -7 V0 M9 -7 V0 M13 -7 V0', 'none', `stroke-width="2.4"`) + '</g>';
const trpFill = (x, y, ang, sc) => trp(x, y, ang, sc);
out['carry-play'] = B(fig({ head: [31, 14], neck: [31, 22], hip: [31, 38], side: 1,
  legs: [{ p: [[29, 38], [29, 49], [29, 57]], f: 1.5 }, { p: [[34, 38], [34, 49], [34, 57]], f: 1.5 }],
  arms: [[[34, 24], [40, 28], [42, 19]]], backArms: [[[28, 24], [24, 30], [32, 22]]],
  mid: '', front: trp(35.5, 18, -2, 1.05) }));
out['carry-right'] = B(fig({ arms: [[[26.5, 24], [24.5, 32], [25.5, 40]], [[37.5, 24], [43, 30], [44, 38]]], legs: [{ p: [[29.5, 38], [29.5, 49], [29.5, 57]], f: -1.2 }, { p: [[34.5, 38], [34.5, 49], [34.5, 57]], f: 1.2 }],
  front: trp(45, 41, -90, 0.95) + Ci(44.4, 38.2, 2.3, C.SKIN, 'stroke-width="1.2"') }));
out['carry-left'] = B(fig({ arms: [[[26.5, 24], [21, 30], [20, 38]], [[37.5, 24], [39.5, 32], [38.5, 40]]], legs: [{ p: [[29.5, 38], [29.5, 49], [29.5, 57]], f: -1.2 }, { p: [[34.5, 38], [34.5, 49], [34.5, 57]], f: 1.2 }],
  front: trp(19, 41, -90, 0.95) + Ci(19.6, 38.2, 2.3, C.SKIN, 'stroke-width="1.2"') }));
out['carry-front'] = B(fig({ arms: [[[26.5, 24], [22, 32], [30, 33]], [[37.5, 24], [42, 32], [36, 33]]], legs: [{ p: [[29.5, 38], [29.5, 49], [29.5, 57]], f: -1.2 }, { p: [[34.5, 38], [34.5, 49], [34.5, 57]], f: 1.2 }],
  front: trp(15, 31, 0, 1.25) + Ci(30, 32, 2.3, C.SKIN, 'stroke-width="1.2"') + Ci(37, 32, 2.3, C.SKIN, 'stroke-width="1.2"') }));
out['carry-diag'] = B(fig({ arms: [[[26.5, 24], [24, 32], [30, 34]], [[37.5, 24], [42, 32], [36, 34]]], legs: [{ p: [[29.5, 38], [29.5, 49], [29.5, 57]], f: -1.2 }, { p: [[34.5, 38], [34.5, 49], [34.5, 57]], f: 1.2 }],
  front: trp(26, 42, -50, 1.1) + Ci(30, 34, 2.3, C.SKIN, 'stroke-width="1.2"') + Ci(36, 34, 2.3, C.SKIN, 'stroke-width="1.2"') }));

// ---------- 体の向き (真上から) ----------
const stageTop = (inner) => badge(
  R(7, 6, 50, 40, 6, '#f3e3c8', `stroke="#c9ad82" stroke-width="1.2"`) +
  [14, 24, 34, 44, 54].map((x) => E(x, 54, 3.4, 3.4, '#aab4cf', 'stroke-width="1"')).join('') + P('M10 52 H54', 'none', 'stroke="none"') + inner);
// 真上から見た人。ang: 0=右 90=下
const top = (x, y, ang) => `<g transform="translate(${x} ${y}) rotate(${ang})">` +
  E(0, 0, 5, 10.4, C.BLUE) + R(-1, -3.4, 5, 6.8, 2.5, C.SKIN, 'transform="translate(4 0)" stroke-width="1.1"') + Ci(-0.4, 0, 5.2, C.NAVY) + Ci(-0.4, 0, 2.2, C.RED, 'stroke-width="1"') + '</g>';
const dirArrow = (x, y, ang, len = 12) => { const a = ang * Math.PI / 180; return arrow(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, C.RED, 2.6, 5.5); };
out['face-front'] = stageTop(top(32, 18, 90) + dirArrow(32, 29, 90, 13));
out['face-back'] = stageTop(top(32, 32, -90) + dirArrow(32, 21, -90, 13));
out['face-kami'] = stageTop(top(22, 26, 0) + dirArrow(31, 26, 0, 17) + txt(46, 39, '上手', 8, C.BLUED));
out['face-shimo'] = stageTop(top(42, 26, 180) + dirArrow(33, 26, 180, 17) + txt(18, 39, '下手', 8, C.BLUED));
const star = `<path d="M32 22 L34 26 L38.5 26.5 L35 29.5 L36 34 L32 31.8 L28 34 L29 29.5 L25.5 26.5 L30 26 Z" fill="${C.YEL}" stroke="${D}" stroke-width="1.1"/>`;
out['face-center'] = stageTop(star + top(12, 26, 0) + top(52, 26, 180) + dirArrow(19, 26, 0, 7) + dirArrow(45, 26, 180, 7));
out['face-out'] = stageTop(star + top(22, 26, 180) + top(42, 26, 0) + dirArrow(15, 26, 180, 8) + dirArrow(49, 26, 0, 8));
out['face-travel'] = stageTop(`<path d="M10 40 C16 22 30 16 40 24" stroke="#b3bdd6" stroke-width="2.2" stroke-dasharray="3.5 3.5" fill="none"/>` + top(40, 24, 40) + arrowPath('M44 28 L50 33', 51, 34, 0.7, C.RED, 2.6, 5.5));

// ---------- カラーガードの動き ----------
const fpole = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${D}" stroke-width="4.4" fill="none"/><path d="M${x1} ${y1} L${x2} ${y2}" stroke="${C.SIL}" stroke-width="2.2" fill="none"/>`;
out['action-spin'] = badge(
  `<g transform="rotate(-24 32 32)">` + fpole(32, 8, 32, 56) + P('M34 10 C42 6 48 16 58 12 V30 C48 34 42 24 34 28 Z', C.RED) + `</g>` +
  arrowPath('M12 22 C8 34 14 46 26 50', 28, 51, 0.5, C.BLUE, 2.8, 6) + arrowPath('M54 44 C58 32 52 20 42 16', 40, 15, -2.6, C.BLUE, 2.8, 6) + sparkle(54, 56, 2.6) + sparkle(8, 10, 2.6));
out['action-toss'] = badge(
  `<g transform="rotate(20 32 20)">` + fpole(32, 4, 32, 36) + P('M34 6 C42 2 46 10 54 7 V21 C46 24 42 17 34 20 Z', C.RED) + `</g>` +
  P('M10 52 Q10 20 24 14', 'none', `stroke="#8c97b8" stroke-width="2" stroke-dasharray="3 3"`) + Ci(16, 52, 3.2, C.SKIN) + R(8, 52, 16, 6, 3, C.BLUE) + arrow(52, 50, 52, 36, C.BLUED, 2.6, 5.5) + sparkle(56, 28, 2.8));
const swingPole = (ang, ghost) => `<g transform="rotate(${ang} 16 54)"${ghost ? ' opacity=".35"' : ''}>` + fpole(16, 54, 16, 20) + (ghost ? '' : P('M18 22 C24 18 28 26 36 22 V36 C28 40 24 32 18 36 Z', C.RED)) + '</g>';
out['action-swing'] = badge(swingPole(-8, true) + swingPole(28, true) + swingPole(62, false) +
  arrowPath('M20 12 Q42 6 56 22', 58, 25, 1.0, C.BLUE, 2.8, 6) + R(10, 52, 12, 8, 4, C.BLUE) + Ci(16, 52, 3.2, C.SKIN));
out['action-rest'] = badge(
  P('M10 58 H54', 'none', `stroke="#b3bdd6" stroke-width="2"`) + fpole(26, 8, 26, 56) + P('M26 12 C28 22 28 34 26 44 H46 C48 34 48 22 46 12 Z', C.RED, '') + P('M26 12 H46', 'none', `stroke="${C.YEL}" stroke-width="2"`) +
  txt(46, 22, 'z', 10, C.BLUED) + txt(52, 14, 'Z', 8, C.BLUED) + R(22, 54, 8, 4, 2, C.BLK));

// ---------- 見た目 / レイアウト ----------
const shade = (inner) => inner + `<g stroke="none"><path d="M32 4 H48 V60 H32 Z" fill="#1b2a5a" opacity=".16"/></g>`;
out['look-real'] = badge(
  P('M4 58 L16 42 H48 L60 58 Z', '#cfd7ea', 'stroke-width="1"') + P('M10 50 H54 M22 42 L14 58 M32 42 V58 M42 42 L50 58', 'none', 'stroke="#aab4cf" stroke-width="1"') +
  `<g transform="translate(6.4 0) scale(.8)">` + (fig({ head: [32, 14], neck: [32, 22], hip: [32, 38], arms: armsDown, legs: [{ p: [[29.5, 38], [29.5, 49], [29.5, 57]], f: -1.2 }, { p: [[34.5, 38], [34.5, 49], [34.5, 57]], f: 1.2 }] })) + `</g>` +
  R(40, 6, 18, 10, 5, C.NAVY, NS) + txt(49, 14, '3D', 8, '#fff'));
out['look-illust'] = badge(
  E(32, 57, 15, 3.2, '#aab4cf', 'stroke="none" opacity=".7"') + Ci(32, 18, 10, C.SKIN) + R(22, 6, 20, 9, 4, C.NAVY) + E(32, 4, 2.6, 3.8, C.RED, 'stroke-width="1.1"') +
  P('M24 30 Q32 27 40 30 L43 46 H21 Z', C.BLUE) + P('M26 46 V56 M38 46 V56', 'none', `stroke="${D}" stroke-width="7.5"`) + P('M26 46 V56 M38 46 V56', 'none', `stroke="${C.WH}" stroke-width="4.5"`) +
  `<circle cx="28" cy="19" r="1.4" fill="${D}" stroke="none"/><circle cx="36" cy="19" r="1.4" fill="${D}" stroke="none"/>` + P('M29.5 23.5 Q32 25.5 34.5 23.5', 'none', 'stroke-width="1.2"') + sparkle(54, 14, 3.4) + sparkle(9, 34, 2.8) + `<circle cx="20" cy="38" r="3" fill="${C.SKIN}"/><circle cx="44" cy="38" r="3" fill="${C.SKIN}"/>`);
out['layout-single'] = badge(R(8, 12, 48, 40, 5, C.WH) + R(11, 15, 42, 34, 3, '#d9e3f8', 'stroke-width="1"') + Ci(32, 28, 5, C.SKIN) + R(25, 34, 14, 12, 4, C.BLUE) + R(8, 12, 48, 40, 5, 'none'));
out['layout-reel'] = badge(
  R(5, 14, 54, 36, 4, C.NAVY, 'stroke-width="1.5"') + [0, 1, 2].map((i) => R(8 + i * 17, 20, 14, 24, 2, i === 1 ? C.WH : '#bcd0f5', 'stroke-width="1"') + Ci(15 + i * 17, 28, 3, C.SKIN, 'stroke-width="1"') + R(11.5 + i * 17, 33, 7, 8, 2.5, C.BLUE, 'stroke-width="1"')).join('') +
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => R(7 + i * 6.6, 15.5, 3, 2.6, 1, C.WH, NS) + R(7 + i * 6.6, 45.8, 3, 2.6, 1, C.WH, NS)).join(''));
module.exports = { out, fig, limb, B, ground, top, stageTop, fpole, trp };
