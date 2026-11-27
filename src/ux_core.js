// 初心者向けUIの「画面に依存しない部分」: 会場・楽器・隊形ひな形・ショー生成・やさしいメッセージ・ヘルプ文・ミニ図。
// ブラウザでは window.JKX、Node では module.exports として使える（tests/ux_core.js で検証）。
(function (root) {
'use strict';
const r1 = v => Math.round(v * 100) / 100, S = v => String(r1(v));

// ================= 会場 =================
const VENUES = [
  {id: 'gym', name: '体育館', desc: '30m四方のフロア。学校の大会や発表会向き', field: {type: 'gym', w: 30, d: 30}},
  {id: 'stage', name: 'ステージ', desc: '舞台と袖。ホールでの発表向き', field: {type: 'stage', w: 16, d: 10, wing: 4}},
  {id: 'football', name: 'フットボール場', desc: '屋外のグラウンド。8to5の歩数で動く', field: {type: 'football', level: 'hs'}},
  {id: 'floor', name: 'フロア（自由）', desc: '広さを決めて使う、平らな室内の床', field: {type: 'floor', w: 24, d: 18}}
];
// 演技に使う範囲（フィールド単位）。xr: 左右の半幅, y0〜y1: 前後（y0 が客席側）
function venueGeom(f) {
  const T = f.type;
  if (T === 'football') return {T, xr: 40, y0: 16, y1: 68, sp: 2.4, rsp: 2.2, unit: '歩'};
  if (T === 'stage') { const w = +f.w || 16, d = +f.d || 10; return {T, xr: Math.max(3, w / 2 - 1.5), y0: 1.8, y1: Math.max(5, d - 1.2), sp: 1.3, rsp: 1.2, unit: 'm'}; }
  if (T === 'floor') { const w = +f.w || 24, d = +f.d || 18; return {T, xr: Math.max(4, w / 2 - 2), y0: 2, y1: Math.max(6, d - 2), sp: 1.4, rsp: 1.3, unit: 'm'}; }
  const w = +f.w || 30, d = +f.d || 30;
  return {T: 'gym', xr: Math.max(4, w / 2 - 3), y0: -(d / 2 - 4), y1: d / 2 - 4, sp: 1.5, rsp: 1.4, unit: 'm'};
}
// 描画用に会場の寸法をそろえる（エンジンのデータ形式でも編集モデルでも可）
function fieldDesc(f) {
  const T = f.type;
  if (T === 'football') return {type: T, bsl: f.bsl || 84, hash: f.hash || 28.4};
  if (T === 'stage') return {type: T, w: +f.w || 16, d: +f.d || 10, wing: f.wing != null ? +f.wing : 4};
  if (T === 'floor') return {type: T, w: +f.w || 24, d: +f.d || 18};
  return {type: 'gym', w: +f.w || 30, d: +f.d || 30};
}

// ================= 楽器 =================
// [id, 日本語名, 記号, 色, グループ]
const INST = [
  ['trumpet', 'トランペット', 'tp', '#ffd23f', '金管'], ['mellophone', 'メロフォン', 'mel', '#ff9f43', '金管'], ['marching_horn', 'マーチングホルン', 'hn', '#f6b93b', '金管'],
  ['horn', 'ホルン', 'hr', '#e58e26', '金管'], ['trombone', 'トロンボーン', 'tb', '#ee5253', '金管'], ['euphonium', 'ユーフォニアム', 'eu', '#ff6b81', '金管'],
  ['tuba', 'チューバ', 'tu', '#c0392b', '金管'], ['marching_tuba', 'マーチングチューバ', 'mtu', '#b33939', '金管'], ['sousaphone', 'スーザフォン', 'sou', '#cd6133', '金管'],
  ['piccolo', 'ピッコロ', 'pic', '#7efff5', '木管'], ['flute', 'フルート', 'fl', '#48dbfb', '木管'], ['oboe', 'オーボエ', 'ob', '#18dcff', '木管'], ['bassoon', 'ファゴット', 'bn', '#17c0eb', '木管'],
  ['eb_clarinet', 'E♭クラリネット', 'ebcl', '#70a1ff', '木管'], ['clarinet', 'クラリネット', 'cl', '#54a0ff', '木管'], ['alto_clarinet', 'アルトクラリネット', 'acl', '#5352ed', '木管'], ['bass_clarinet', 'バスクラリネット', 'bcl', '#3742fa', '木管'],
  ['soprano_sax', 'ソプラノサックス', 'ssax', '#7bed9f', '木管'], ['alto_sax', 'アルトサックス', 'asax', '#2ed573', '木管'], ['tenor_sax', 'テナーサックス', 'tsax', '#1dd1a1', '木管'], ['baritone_sax', 'バリトンサックス', 'bsax', '#10ac84', '木管'],
  ['snare', 'スネアドラム', 'sd', '#c8d6e5', '打楽器'], ['tenors', 'テナードラム', 'tn', '#dfe4ea', '打楽器'], ['bass_drum', 'バスドラム', 'bd', '#a4b0be', '打楽器'],
  ['cymbals_mid', 'シンバル', 'cym', '#ced6e0', '打楽器'], ['cymbals_high', 'シンバル（高）', 'cymh', '#f1f2f6', '打楽器'], ['glockenspiel', 'グロッケン', 'gl', '#ffeaa7', '打楽器'], ['xylophone', 'シロフォン', 'xy', '#fab1a0', '打楽器'],
  ['flag', 'カラーガード', 'cg', '#e056fd', 'その他']
];
const INST_BY = Object.fromEntries(INST.map(r => [r[0], {id: r[0], name: r[1], sid: r[2], color: r[3], group: r[4]}]));
const catOfInst = id => id === 'flag' ? 'G' : /^(snare|tenors|bass_drum|bass[1-5]|cymbals_mid|cymbals_high|glockenspiel|xylophone)$/.test(id) ? 'P' : 'W';

const PRESETS = [
  {id: 'small8', name: '少人数', sub: '8人', pic: 'mascot-wave', counts: {trumpet: 2, clarinet: 2, flute: 1, trombone: 1, snare: 1, bass_drum: 1}},
  {id: 'band30', name: '吹奏楽部', sub: '30人', pic: 'mascot-baton', counts: {flute: 4, clarinet: 5, alto_sax: 3, trumpet: 5, trombone: 3, euphonium: 2, tuba: 2, snare: 2, bass_drum: 2, cymbals_mid: 1, glockenspiel: 1}},
  {id: 'drum', name: 'ドラムライン', sub: '14人', pic: 'mascot-cheer', counts: {snare: 4, tenors: 3, bass_drum: 4, cymbals_mid: 3}},
  {id: 'guard', name: 'カラーガード付き', sub: '21人', pic: 'mascot-point', counts: {trumpet: 4, clarinet: 4, trombone: 2, tuba: 1, snare: 2, bass_drum: 1, cymbals_mid: 1, flag: 6}}
];
const total = counts => Object.values(counts).reduce((a, b) => a + (+b || 0), 0);

// 編成 {楽器id: 人数} → セクション一覧（記号・表示名・色を日本語名から自動で決める）
function sectionsFromCounts(counts) {
  const out = [];
  for (const [id, , sid] of INST) {
    const n = Math.max(0, Math.min(40, Math.floor(+counts[id] || 0)));
    if (!n) continue;
    const b = INST_BY[id];
    out.push({id: sid, label: b.name, n, color: b.color, instrument: id, cat: catOfInst(id)});
  }
  return out;
}

// ================= 隊形ひな形 =================
// [id, 名前, ひとこと, 最初のセットでは使えない]
const FORMS = [
  ['line', '横一列', '客席に向かって一直線に並ぶ、基本の形'],
  ['two-lines', '二列', '前後2列に並ぶ。人数が多いときの定番'],
  ['block', 'ブロック', '四角くまとまる。スタンバイ向き'],
  ['arc', '弧', '客席に向かってふくらむ半円'],
  ['circle', '円', 'まあるく囲む。中央に打楽器が入ります'],
  ['wedge', 'くさび', '先が客席を向いた三角形（矢じり）'],
  ['v', 'V字', '奥が頂点の、客席に向かって開くV字'],
  ['diagonal', '斜め', '左前から右奥へ斜めにのびる列'],
  ['curve', '曲線', 'なだらかなS字のカーブ'],
  ['poly', 'ジグザグ', '折れ線のジグザグ'],
  ['follow', 'ヘビ行進', '先頭について、一列でなぞるように進む', true],
  ['scatter', 'ひろがり', '間隔を広げて、ばらけた並び'],
  ['company-front', 'カンパニーフロント', '全員が会場いっぱいに一直線'],
  ['cross', '十字', '横一列と縦一列で十字をつくる']
].map(([id, name, desc, noFirst]) => ({id, name, desc, noFirst: !!noFirst}));
const FORM_BY = Object.fromEntries(FORMS.map(f => [f.id, f]));

const pt = (x, y) => [S(x), S(y)];
const at = (mem, x, y) => [{mem, shape: {kind: 'at', p: pt(x, y)}}];
const slice = (mem, a, b) => mem.slice(a, b);

function layoutRows(n, V, wide) {
  const perRow = Math.max(1, Math.min(n, Math.floor(2 * V.xr / V.sp) + 1));
  const rows = Math.ceil(n / perRow);
  return {perRow, rows};
}
function tLine(mem, V, yc, wide) {
  const n = mem.length;
  if (n === 1) return at(mem, 0, yc);
  const {rows} = layoutRows(n, V);
  if (rows === 1) {
    const h = wide ? V.xr : (n - 1) * V.sp / 2;
    return [{mem, shape: {kind: 'line', a: pt(-h, yc), b: pt(h, yc)}}];
  }
  const cols = Math.ceil(n / rows);
  const sp = wide ? Math.min(2 * V.xr / Math.max(1, cols - 1), V.sp * 1.8) : V.sp;
  return [{mem, shape: {kind: 'block', c: pt(0, yc), cols: String(cols), spacing: S(sp), rows: S(V.rsp)}}];
}
function tTwoLines(mem, V, yc) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const perRow = layoutRows(n, V).perRow;
  const rows = Math.max(2, Math.ceil(n / perRow));
  return [{mem, shape: {kind: 'block', c: pt(0, yc), cols: String(Math.ceil(n / rows)), spacing: S(V.sp), rows: S(V.rsp)}}];
}
function tBlock(mem, V, yc) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const perRow = layoutRows(n, V).perRow;
  const cols = Math.max(2, Math.min(perRow, Math.ceil(Math.sqrt(n * 1.6))));
  return [{mem, shape: {kind: 'block', c: pt(0, yc), cols: String(cols), spacing: S(V.sp), rows: S(V.rsp)}}];
}
function tArc(mem, V, yc) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const rmax = Math.min(V.xr / 0.94, (V.y1 - V.y0) * 0.95);
  const SPAN = 140 * Math.PI / 180;
  let parts = [mem];
  let r = (n - 1) * V.sp / SPAN;
  if (r > rmax) { const n1 = Math.ceil(n * 0.56); parts = [slice(mem, 0, n1), slice(mem, n1)]; r = Math.min(rmax, (n1 - 1) * V.sp / SPAN); }
  r = Math.max(2.5, r);
  const cy = yc + 0.67 * r;
  return parts.map((p, i) => {
    const ri = i === 0 ? r : Math.max(1.5, r - V.rsp * 1.2);
    return {mem: p, shape: {kind: 'arc', c: pt(0, cy), r: S(ri), a1: '200', a2: '340'}};
  });
}
function tCircle(mem, V, yc) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const rmax = Math.min(V.xr, (V.y1 - V.y0) / 2) * 0.92;
  const need = n * V.sp / (2 * Math.PI);
  if (need <= rmax) return [{mem, shape: {kind: 'circle', c: pt(0, yc), r: S(Math.max(1.6, need)), start: null}}];
  const n1 = Math.round(n * 0.6), r1v = rmax;
  const r2v = Math.max(1.2, Math.min(r1v - V.rsp * 1.2, (n - n1) * V.sp / (2 * Math.PI)));
  return [{mem: slice(mem, 0, n1), shape: {kind: 'circle', c: pt(0, yc), r: S(r1v), start: null}},
    {mem: slice(mem, n1), shape: {kind: 'circle', c: pt(0, yc), r: S(r2v), start: null}}];
}
function tChevron(mem, V, yc, apexFront) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const D = V.y1 - V.y0, k = 0.55;
  let hx = ((n - 1) * V.sp) / (2 * Math.sqrt(1 + k * k));
  hx = Math.min(hx, V.xr);
  let h = Math.min(hx * k, D * 0.42);
  const sgn = apexFront ? 1 : -1; // 頂点が客席側（y が小さい）か、奥か
  const ya = yc + sgn * h * 0.7, yb = yc - sgn * h * 0.7;
  return [{mem, shape: {kind: 'poly', pts: [pt(-hx, ya), pt(0, yb), pt(hx, ya)]}}];
}
function tDiagonal(mem, V, yc) {
  const n = mem.length;
  if (n < 3) return tLine(mem, V, yc);
  const D = V.y1 - V.y0;
  const hx = V.xr * 0.85, hy = D * 0.32;
  const L = 2 * Math.hypot(hx, hy), len = (n - 1) * V.sp;
  const k = Math.max(1, Math.ceil(len / (L * 0.98)));
  const out = [];
  const per = Math.ceil(n / k);
  for (let j = 0; j < k; j++) {
    const m = slice(mem, j * per, (j + 1) * per);
    if (!m.length) continue;
    const half = Math.min(1, ((m.length - 1) * V.sp) / L);
    const dy = (j - (k - 1) / 2) * V.rsp * 1.6;
    out.push({mem: m, shape: m.length === 1 ? {kind: 'at', p: pt(0, yc + dy)} : {kind: 'line', a: pt(-hx * half, yc - hy * half + dy), b: pt(hx * half, yc + hy * half + dy)}});
  }
  return out;
}
function tCurve(mem, V, yc) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const hx = Math.min(V.xr, (n - 1) * V.sp / 2 / 1.12), a = Math.min((V.y1 - V.y0) * 0.16, hx * 0.35);
  return [{mem, shape: {kind: 'curve', pts: [pt(-hx, yc - a), pt(-hx / 3, yc + a), pt(hx / 3, yc - a), pt(hx, yc + a)]}}];
}
function tPoly(mem, V, yc) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const a = Math.min((V.y1 - V.y0) * 0.14, V.xr * 0.3);
  let hx = (n - 1) * V.sp / 2 / Math.sqrt(1 + (4 * a / (V.xr || 1)) ** 2 * 0.25 + 0.0001);
  hx = Math.min(V.xr, Math.max(2, (n - 1) * V.sp / 2 / 1.25));
  return [{mem, shape: {kind: 'poly', pts: [pt(-hx, yc - a), pt(-hx / 2, yc + a), pt(0, yc - a), pt(hx / 2, yc + a), pt(hx, yc - a)]}}];
}
function tFollow(mem, V, yc, ctx) {
  const n = mem.length;
  if (n < 4 || !ctx.idx) return tCurve(mem, V, yc);
  const need = (n - 1) * V.sp * 1.04, xr = V.xr * 0.92;
  const plen = pts => pts.reduce((L, q, i) => i ? L + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0, 0);
  const wave = hx => { const a = Math.min((V.y1 - V.y0) * 0.14, hx * 0.3); return [pt(-hx, yc + a), pt(-hx / 3, yc - a), pt(hx / 3, yc + a), pt(hx, yc - a)]; };
  let pts = null;
  for (let hx = Math.min(xr, 3); hx <= xr + 1e-6; hx += 0.5) { const w = wave(hx); if (plen(w.map(q => [+q[0], +q[1]])) >= need) { pts = w; break; } }
  if (!pts) {
    const lanes = Math.ceil(need / (2 * xr));
    const ls = Math.min(V.rsp * 1.8, (V.y1 - V.y0) * 0.8 / Math.max(1, lanes - 1));
    const y0 = yc - (lanes - 1) * ls / 2;
    pts = [];
    for (let j = 0; j < lanes; j++) { const y = y0 + j * ls, l = j % 2 ? xr : -xr, r = j % 2 ? -xr : xr; pts.push(pt(l, y), pt(r, y)); }
  }
  return [{mem, shape: {kind: 'follow', pts, spacing: S(V.sp)}}];
}
function tScatter(mem, V, yc) {
  const n = mem.length;
  if (n < 4) return tLine(mem, V, yc);
  const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.5)));
  const sp = Math.min(V.sp * 2.4, 2 * V.xr / Math.max(1, cols - 1));
  const rows = Math.ceil(n / cols), rsp = Math.min(V.rsp * 2.2, (V.y1 - V.y0) * 0.8 / Math.max(1, rows - 1));
  return [{mem, shape: {kind: 'block', c: pt(0, yc), cols: String(cols), spacing: S(sp), rows: S(rsp)}}];
}
function tCross(mem, V, yc) {
  const n = mem.length;
  if (n < 6) return tLine(mem, V, yc);
  const nh = Math.ceil(n / 2), rest = n - nh, nu = Math.ceil(rest / 2), nd = rest - nu;
  const h = Math.min(V.xr, (nh - 1) * V.sp / 2);
  const out = [{mem: slice(mem, 0, nh), shape: nh === 1 ? {kind: 'at', p: pt(0, yc)} : {kind: 'line', a: pt(-h, yc), b: pt(h, yc)}}];
  const half = (V.y1 - V.y0) / 2 * 0.92;
  const seg = (m, sgn) => {
    if (!m.length) return;
    const step = Math.min(V.sp, (half - V.sp) / Math.max(1, m.length - 1));
    const y1v = yc + sgn * V.sp, y2v = yc + sgn * (V.sp + (m.length - 1) * step);
    out.push({mem: m, shape: m.length === 1 ? {kind: 'at', p: pt(0, y1v)} : {kind: 'line', a: pt(0, y1v), b: pt(0, y2v)}});
  };
  seg(slice(mem, nh, nh + nu), 1); seg(slice(mem, nh + nu), -1);
  return out;
}
const PRIM = {
  'line': (m, V, y) => tLine(m, V, y, false), 'two-lines': tTwoLines, 'block': tBlock, 'arc': tArc, 'circle': tCircle,
  'wedge': (m, V, y) => tChevron(m, V, y, true), 'v': (m, V, y) => tChevron(m, V, y, false), 'diagonal': tDiagonal, 'curve': tCurve,
  'poly': tPoly, 'follow': tFollow, 'scatter': tScatter, 'company-front': (m, V, y) => tLine(m, V, y, true), 'cross': tCross
};

const mkStmt = (group, shape) => ({group, shape, xf: [], assign: null, skip: [], wait: null, within: null, bend: null, face: null, step: null, action: null, pose: null, carry: null, note: [], tail: null, line: 0});

// 記号つきメンバー一覧 → 隊形の対象（"tp + tb1..tb3" の形）
function groupStr(mem) {
  const out = [];
  let k = 0;
  while (k < mem.length) {
    let j = k;
    while (j + 1 < mem.length && mem[j + 1].s === mem[k].s && mem[j + 1].i === mem[j].i + 1) j++;
    const a = mem[k], b = mem[j];
    if (a.i === 1 && b.i === a.n) out.push(a.s);
    else out.push(j === k ? a.s + a.i : `${a.s}${a.i}..${b.s}${b.i}`);
    k = j + 1;
  }
  return out.join(' + ');
}
// セクション [{id,n,cat}] と形 → 隊形文の配列 [{mem, shape}]（mem は {s,i,n} の並び）
function crowded(parts, V) {
  const clr = V.T === 'football' ? 1.0 : 0.6, lim = clr * 1.08, pts = [];
  parts.forEach((p, pi) => shapePoints(p.shape, p.mem.length).forEach(q => pts.push([q[0], q[1], pi])));
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++)
    if (Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) < lim) return true;
  return false;
}
function formationParts(form, V0, secs, idx, depth) {
  const cats = {W: [], P: [], G: []};
  for (const s of secs) for (let i = 1; i <= s.n; i++) cats[s.cat || 'W'].push({s: s.id, i, n: s.n});
  const present = ['W', 'P', 'G'].filter(c => cats[c].length);
  if (!present.length) return [];
  const prim = present[0], D = V0.y1 - V0.y0;
  const yG = V0.y0 + D * 0.07, yP = V0.y0 + D * 0.92;
  const gap = V0.sp * 1.3;
  // 主役の形は、前（カラーガード）と後ろ（打楽器）のあいだに収める
  const V = Object.assign({}, V0, {
    y0: prim !== 'G' && cats.G.length ? yG + gap : V0.y0,
    y1: prim !== 'P' && cats.P.length ? yP - gap : V0.y1
  });
  if (V.y1 - V.y0 < V0.rsp * 2) { V.y0 = V0.y0; V.y1 = V0.y1; }
  const yPrim = (V.y0 + V.y1) / 2;
  const ctx = {idx};
  const fn = PRIM[depth ? 'line' : form] || PRIM.line;
  let out = [];
  const primMem = cats[prim];
  let pDone = false;
  if (form === 'circle' && !depth && prim === 'W' && cats.P.length) {
    // 円の中心に打楽器を入れる（輪が十分大きいときだけ）
    const parts = fn(primMem, V, yPrim, ctx);
    const rr = Math.min(...parts.filter(p => p.shape.kind === 'circle').map(p => +p.shape.r));
    const pn = cats.P.length, cols = Math.min(3, pn), rows = Math.ceil(pn / cols);
    const rad = Math.hypot((cols - 1) * V0.sp / 2, (rows - 1) * V0.rsp / 2);
    if (isFinite(rr) && rr > rad + V0.sp * 1.4) { out = out.concat(parts); out.push({mem: cats.P, shape: pn === 1 ? {kind: 'at', p: pt(0, yPrim)} : {kind: 'block', c: pt(0, yPrim), cols: String(cols), spacing: S(V0.sp), rows: S(V0.rsp)}}); pDone = true; }
    else out = out.concat(parts);
  } else out = out.concat(fn(primMem, V, yPrim, ctx));
  if (prim !== 'P' && cats.P.length && !pDone) out = out.concat(tLine(cats.P, V0, yP, false));
  if (prim !== 'G' && cats.G.length) out = out.concat(tLine(cats.G, V0, yG, true));
  if (!depth && form !== 'line' && crowded(out, V0)) return formationParts(form, V0, secs, idx, 1);
  return out;
}
function formationStmts(form, V, secs, idx) {
  return formationParts(form, V, secs, idx).map(p => mkStmt(groupStr(p.mem), p.shape));
}

// ---- 形から点を出す（ミニ図用。エンジンとは独立した簡易計算） ----
function polyPts(pts, n) {
  if (n <= 1) return [pts[0]];
  const seg = []; let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  const out = [];
  for (let k = 0; k < n; k++) {
    let t = L * k / (n - 1), i = 0;
    while (i < seg.length - 1 && t > seg[i]) { t -= seg[i]; i++; }
    const f = seg[i] > 0 ? Math.min(1, t / seg[i]) : 0;
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
  }
  return out;
}
function smooth(pts) { // Catmull-Rom → 折れ線
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < 1; t += 0.1) {
      const t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function shapePoints(s, n) {
  const N = v => +v;
  const P = p => [N(p[0]), N(p[1])];
  switch (s.kind) {
    case 'at': return [P(s.p)];
    case 'line': return polyPts([P(s.a), P(s.b)], n);
    case 'poly': case 'follow': return polyPts(s.pts.map(P), n);
    case 'curve': return polyPts(smooth(s.pts.map(P)), n);
    case 'arc': case 'circle': {
      const c = P(s.c), r = N(s.r), full = s.kind === 'circle';
      const a1 = full ? N(s.start || 0) : N(s.a1), a2 = full ? a1 + 360 : N(s.a2);
      const out = [];
      for (let k = 0; k < n; k++) {
        const t = full ? k / n : (n === 1 ? 0.5 : k / (n - 1));
        const a = (a1 + (a2 - a1) * t) * Math.PI / 180;
        out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
      }
      return out;
    }
    case 'block': {
      const c = P(s.c), cols = Math.max(1, N(s.cols)), sp = N(s.spacing) || 1, rs = N(s.rows) || sp, rows = Math.ceil(n / cols), out = [];
      for (let k = 0; k < n; k++) {
        const rr = Math.floor(k / cols), cc = k % cols;
        out.push([c[0] + (cc - (cols - 1) / 2) * sp, c[1] + (rr - (rows - 1) / 2) * rs]);
      }
      return out;
    }
  }
  return [];
}
// ひな形 → [{x,y,color}]
function thumbDots(form, V, secs, idx) {
  const color = Object.fromEntries(secs.map(s => [s.id, s.color || '#ccc']));
  const dots = [];
  for (const p of formationParts(form, V, secs, idx == null ? 1 : idx)) {
    const pts = shapePoints(p.shape, p.mem.length);
    pts.forEach((q, k) => dots.push({x: q[0], y: q[1], color: color[(p.mem[k] || p.mem[0]).s]}));
  }
  return dots;
}

// ================= ショーを組み立てる =================
const FIELD_OF = id => JSON.parse(JSON.stringify((VENUES.find(v => v.id === id) || VENUES[0]).field));
// o: {name, venue, counts:{楽器:人数}, forms:[id], bpm, moveCounts, hold, look}
function buildModel(o) {
  const secs = sectionsFromCounts(o.counts);
  const field = FIELD_OF(o.venue), V = venueGeom(field);
  const forms = (o.forms && o.forms.length ? o.forms : ['line']).slice();
  const sets = forms.map((fid, i) => ({
    name: String(i + 1), counts: i === 0 ? 0 : (o.moveCounts && o.moveCounts[i]) || o.moveCount || 16, hold: i === 0 ? 8 : i === forms.length - 1 ? 8 : 0,
    tempo: null, mark: false, note: [], tail: null, foot: [], stmts: formationStmts(fid, V, secs, i)
  }));
  return {
    name: o.name || '新しいショー', header: ['# 陣形エディタの「かんたん作成」で作りました'], settings_notes: [], foot: [], field, tempo: Math.round(o.bpm || 120),
    clearance: null, maxstep: null, stride: null, look: o.look === 'illust' ? 'illust' : null,
    sections: secs.map(s => ({id: s.id, label: s.label, n: s.n, color: s.color, instrument: s.instrument, note: [], tail: null})), sets, parts: []
  };
}
// 生成したショーを仕上げる: 歩幅が大きすぎないようカウントを自動で伸ばし、ぶつかりを自動修正する。
// それでも残るぶつかりは、その隊形を「ぶつからない別の形」に差しかえる（log.swapped に記録）。
// io: {print(model)->source, compile(source)->結果(await可), fix(source)->結果(await可)}
// ctx: {forms:[id], V, secs}（差しかえに使う）
const countOf = (D, kind) => D.warnings.filter(w => w.kind === kind).length;
async function finalize(m, io, ctx) {
  const log = {counts: [], fixNotes: [], swapped: [], before: 0, after: 0, ok: true, error: ''};
  let r = null, D = null;
  const run = async () => { r = await io.compile(io.print(m)); if (!r.ok) throw new Error((r.error && r.error.msg) || '作成に失敗しました'); D = r.data; return D; };
  let inflate = true;
  const adjustCounts = async () => {
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      D.sets.forEach((s, k) => {
        if (!k) return;
        // 自動修正が「早着き」を入れても歩幅が大きくなりすぎないよう、少し余裕をもたせる
        const need = Math.min(64, Math.ceil((s.min_counts || 0) * (inflate ? 1.35 : 1) / 4) * 4);
        if (need > +m.sets[k].counts) { m.sets[k].counts = need; changed = true; if (!log.counts.includes(k)) log.counts.push(k); }
      });
      if (!changed) break;
      await run();
    }
  };
  const doFix = async () => {
    const f = await io.fix(io.print(m));
    if (f && f.ok && f.notes && f.notes.length) { m.sets = f.model.sets; log.fixNotes.push(...f.notes); await run(); }
  };
  try {
    await run();
    await adjustCounts();
    log.before = countOf(D, '衝突');
    if (log.before > 0) await doFix();
    // まだ残っていれば、問題のセットの形を差しかえてためす
    if (ctx && countOf(D, '衝突') > 0) {
      const bad = [...new Set(D.warnings.filter(w => w.kind === '衝突').map(w => w.set))].sort((a, b) => a - b);
      const colls = set => D.warnings.filter(w => w.kind === '衝突' && (w.set === set || w.set === set + 1)).length;
      for (const k of bad) {
        if (colls(k) === 0 && D.warnings.filter(w => w.kind === '衝突' && w.set === k).length === 0) continue;
        const cur = ctx.forms[k], keep = m.sets[k].stmts;
        const alts = (cur === 'follow' ? ['curve', 'line', 'two-lines', 'block', 'company-front'] : ['line', 'two-lines', 'block', 'company-front', 'arc', 'curve']).filter(f => f !== cur);
        let best = null;
        for (const alt of alts) {
          m.sets[k].stmts = formationStmts(alt, ctx.V, ctx.secs, k);
          await run(); await adjustCounts();
          const c = D.warnings.filter(w => w.kind === '衝突' && (w.set === k || w.set === k + 1)).length;
          if (!best || c < best.c) best = {alt, c, stmts: m.sets[k].stmts};
          if (c === 0) break;
        }
        if (best && best.c < (colls(k) || Infinity)) { m.sets[k].stmts = best.stmts; log.swapped.push({set: k, from: cur, to: best.alt}); ctx.forms[k] = best.alt; }
        else m.sets[k].stmts = keep;
        await run();
      }
      if (countOf(D, '衝突') > 0) await doFix();
    }
    // 自動修正で「早着き」を入れた結果、歩幅が大きくなることがあるので、足りないぶんカウントを伸ばす
    for (let pass = 0; pass < 3; pass++) {
      const big = [...new Set(D.warnings.filter(w => w.kind === '大股' && w.set > 0).map(w => w.set))];
      if (!big.length) break;
      // 「早着き（in）」が原因なので外し、足りなければカウントを伸ばす
      big.forEach(k => { let had = false; m.sets[k].stmts.forEach(st => { if (st.within != null && st.within !== '') { st.within = null; had = true; } }); if (!had) m.sets[k].counts = Math.min(64, +m.sets[k].counts + 8); });
      await run();
    }
    log.after = countOf(D, '衝突');
    log.other = D.warnings.length - log.after;
    log.data = D;
  } catch (e) { log.ok = false; log.error = String(e && e.message || e); }
  return log;
}
// 編集中のモデルの編成から、ひな形を使うための情報を取り出す
function secsOfModel(M, D) {
  return M.sections.map((s, i) => {
    const n = Math.max(1, Math.round(+s.n) || 1);
    const inst = (D && D.sections && D.sections[i] && D.sections[i].instrument) || s.instrument || '';
    return {id: s.id, n, cat: catOfInst(inst), color: s.color || (D && D.sections[i] && D.sections[i].color) || '#ccc'};
  });
}

// ================= ミニ図（真上から見た会場と人） =================
// field: エンジンのデータ形式, dots: [{x,y,color}]
function miniSvg(field, dots, o) {
  o = o || {};
  const f = fieldDesc(field);
  let x0, x1, y0, y1, base = '', sc = 1;
  if (f.type === 'football') {
    x0 = -86; x1 = 86; y0 = -4; y1 = f.bsl + 4; sc = 1.9;
    base = `<rect x="-84" y="0" width="168" height="${f.bsl}" fill="#2e7d32" rx="1.5"/>` + [...Array(21)].map((_, k) => `<line x1="${-80 + k * 8}" x2="${-80 + k * 8}" y1="0" y2="${f.bsl}" stroke="#fff" stroke-opacity="${k === 10 ? .55 : .3}" stroke-width=".5"/>`).join('');
  } else if (f.type === 'gym') {
    const hw = f.w / 2, hd = f.d / 2; x0 = -hw - 1; x1 = hw + 1; y0 = -hd - 1; y1 = hd + 1;
    base = `<rect x="${-hw}" y="${-hd}" width="${f.w}" height="${f.d}" fill="#7b5b3a" rx=".8"/><rect x="-10" y="-10" width="20" height="20" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".25"/><path d="M0 ${-hd}V${hd}M${-hw} 0H${hw}" stroke="#fff" stroke-opacity=".25" stroke-width=".2"/>`;
  } else if (f.type === 'stage') {
    const hw = f.w / 2; x0 = -hw - f.wing - 1; x1 = hw + f.wing + 1; y0 = -1.5; y1 = f.d + 1;
    base = `<rect x="${-hw - f.wing}" y="0" width="${f.wing}" height="${f.d}" fill="#2a2740"/><rect x="${hw}" y="0" width="${f.wing}" height="${f.d}" fill="#2a2740"/><rect x="${-hw}" y="0" width="${f.w}" height="${f.d}" fill="#4a4366" rx=".5"/><path d="M${-hw} 0H${hw}" stroke="#ffd23f" stroke-width=".35"/>`;
  } else {
    const hw = f.w / 2; x0 = -hw - 1; x1 = hw + 1; y0 = -1.5; y1 = f.d + 1;
    base = `<rect x="${-hw}" y="0" width="${f.w}" height="${f.d}" fill="#3b4e63" rx=".6"/><path d="M${-hw} 0H${hw}" stroke="#ffd23f" stroke-width=".35"/>`;
  }
  const W = x1 - x0, H = y1 - y0, rr = Math.max(W, H * 1.3) * (f.type === "football" ? 0.0062 : 0.021) * (o.dot || 1);
  const d = (dots || []).map(p => `<circle cx="${r1(p.x)}" cy="${r1(y1 - p.y + y0)}" r="${r1(rr)}" fill="${p.color || '#ccc'}" stroke="#0007" stroke-width="${r1(rr * 0.25)}"/>`).join('');
  // y は上が奥。SVG は下向きなので反転（y1 - y + y0）
  const flip = f.type === 'football' ? `<g transform="translate(0 ${y1 + y0}) scale(1 -1)">${base}</g>` : `<g transform="translate(0 ${y1 + y0}) scale(1 -1)">${base}</g>`;
  const cls = o.cls ? ` class="${o.cls}"` : '';
  return `<svg${cls} viewBox="${x0} ${y0} ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${o.label || '隊形の図'}">${flip}${d}</svg>`;
}

// ================= やさしい警告文 =================
function whoName(D, i) {
  const p = D.performers[i];
  if (!p) return '？';
  const s = D.sections[p.sec], num = (p.id.match(/(\d+)$/) || [])[1];
  return `${s ? s.label : ''}${num ? num + '番' : ''}`;
}
function friendly(D, w, setName, whoAll) {
  const nm = whoName.bind(null, D), who = w.who || [], a = who[0] != null ? nm(who[0]) : '', b = who[1] != null ? nm(who[1]) : '';
  const many = whoAll && whoAll.length > 1 ? `${nm(whoAll[0])}、${nm(whoAll[1])}${whoAll.length > 2 ? ' など' : ''}（${whoAll.length}人）` : '';
  const sn = setName != null ? setName : (D.sets[w.set] ? D.sets[w.set].name : String(w.set + 1));
  if (w.kind === '衝突') {
    const mv = /（([\d.]+)カウント目）/.exec(w.msg || ''), near = /([\d.]+)(m|歩)\s*(まで接近|しか)/.exec(w.msg || '');
    const moving = /移動中/.test(w.msg || '');
    return {kind: '衝突', icon: 'help-collision', title: 'ぶつかりそうです',
      body: `${moving ? `セット${sn}へ動く途中${mv ? `（${mv[1]}カウント目ごろ）` : ''}` : `セット${sn}に着いたとき`}、${a} と ${b} が近づきすぎています${near ? `（${near[1]}${near[2]}まで接近）` : ''}。`,
      tip: '「自動で直す」を押すと、動き出すタイミングやカーブを自動で調整します。', acts: ['fix', 'select', 'goto']};
  }
  if (w.kind === '大股') {
    return {kind: '大股', icon: 'help-count', title: '歩幅が大きすぎます',
      body: `セット${sn}で、${many || a} が、短いカウントで遠くまで動こうとしています。`,
      tip: 'セットのカウントを増やすか、位置を近づけると歩きやすくなります。', acts: ['more', 'select', 'goto']};
  }
  if (w.kind === '場外') {
    return {kind: '場外', icon: 'help-set', title: '会場の外に出ています',
      body: `セット${sn}で、${many || a} が会場の外にいます。`,
      tip: 'その人たちを選んで、会場の中へドラッグして戻しましょう。', acts: ['select', 'goto']};
  }
  if (w.kind === '拍子') {
    return {kind: '拍子', icon: 'help-score', title: '楽譜の拍がそろっていません',
      body: (w.msg || '').replace(/^セット[^:：]*[:：]\s*/, '') || '楽譜の小節の長さが拍子と合っていません。',
      tip: '楽譜タブで、その小節の音符の数を確かめましょう。', acts: ['score', 'goto']};
  }
  return {kind: w.kind || '注意', icon: 'help-set', title: w.kind || '注意', body: w.msg || '', tip: '', acts: ['goto']};
}

// ================= ヘルプ（ミニガイド・用語集） =================
const GUIDES = [
  {id: 'first', icon: 'help-set', title: 'はじめての隊形', lead: '「隊形」は、ある瞬間にみんなが並んでいる形のことです。まずは1つ作ってみましょう。',
    steps: ['右の「隊形」タブで「＋ 隊形を追加」を押し、直線・弧・円などの形を選びます。', '色つきのラベルで、その形に並ぶセクションを選びます。', '画面の ■ ● をドラッグして、大きさや場所を整えます。', '左のツール（直線・弧・円…）を選んで画面をドラッグしても作れます。'],
    tips: ['おすすめの隊形（V字・くさび・十字など）は、「隊形を追加」の中の「おすすめ」から1回で並べられます。']},
  {id: 'move', icon: 'help-drag', title: '人を動かす', lead: '1人ずつ動かしたり、まとめて動かしたりできます。',
    steps: ['人（ドット）をクリックで選びます。ドラッグで動かせます。', '何もない所をドラッグすると、四角で囲んだ人をまとめて選べます。', 'Shift（または Ctrl）を押しながらクリックすると、選ぶ人を足せます。', '選んだ人は、下に出るバーで向き・姿勢を変えたり、直線・円にきれいに並べたりできます。', '右クリック（スマホ・タブレットは長押し）でメニューが開きます。'],
    tips: ['矢印キーで少しずつ動かせます。Shift を押すと大きく動きます。', '2本指でつまむと拡大・縮小、2本指で動かすと移動できます。']},
  {id: 'sets', icon: 'help-count', title: 'セットとカウント', lead: '「セット」は隊形の写真1枚、「カウント」はセットからセットへ動く時間です。',
    steps: ['下のタイムラインで、セットが順番に並んでいます。クリックで切り替えます。', '「＋ セット」を押すと、次の隊形を足せます。', 'セットの右はしをドラッグすると、移動のカウントを増減できます。', '再生ボタンで、動きを確かめましょう。'],
    tips: ['8カウントは、BPM 120 でちょうど4秒です。', 'その場で止まって見せる時間は「ホールド」で足します。']},
  {id: 'side', icon: 'help-kami-shimo', title: '上手・下手（かみて・しもて）', lead: '客席から舞台を見たとき、右が上手、左が下手です。',
    steps: ['画面の下が客席側です。上が奥（舞台の後ろ）です。', '右側が「上手」、左側が「下手」です。', '向きの指定にも「上手向き」「下手向き」が使えます。'],
    tips: ['ステージの袖（そで）も、上手袖・下手袖と呼びます。', 'フットボール場では、サイド1（左）とサイド2（右）と呼びます。']},
  {id: 'collision', icon: 'help-collision', title: 'ぶつかりを直す', lead: '人どうしが近づきすぎると、「チェック」タブに知らせが出ます。',
    steps: ['「チェック」タブを開くと、ぶつかりそうな場所の一覧が出ます。', '「自動で直す」を押すと、動き出しの時間差やカーブを自動で入れて直します。', '直らないときは、その人を選んで位置をずらすか、カウントを増やしてみましょう。', '直しすぎたら、元に戻す（Ctrl+Z）で戻せます。'],
    tips: ['一覧の「そのセットへ移動」で、場所をすぐ確かめられます。']},
  {id: 'score', icon: 'help-score', title: '楽譜をつける', lead: 'ドラムなどの演奏パートを楽譜で書いて、動画にいっしょに載せられます。',
    steps: ['「楽譜」タブを開き、「パートを追加」を押します。', '音符のボタンを押して、リズムを入力します。', '「試聴」で音を確かめます。', 'MusicXML ファイルを取り込むこともできます。'],
    tips: ['楽譜をつけなくても、隊形だけで動画は作れます。']},
  {id: 'video', icon: 'help-video', title: '3Dで見る・動画にする', lead: '作った隊形を、3Dで動かして確かめたり、動画にしたりできます。',
    steps: ['上の「プレビュー」を押すと、新しいタブで3Dが開きます。', 'カメラの位置は、プレビューの中で切り替えられます。', '「3D動画を書き出す」で、動画ファイルにできます。', '見た目は「ショー」タブで、リアルかイラストを選べます。'],
    tips: ['ブラウザ版では、動画はプレビュー画面の録画ボタンで保存します。']},
  {id: 'save', icon: 'help-save', title: '保存と共有', lead: '作ったショーは .jk ファイルとして保存します。',
    steps: ['右上の「保存」（Ctrl+S）で保存します。', 'ブラウザ版では、ブラウザの下書きにも自動で残ります。', '友だちに渡すときは、.jk ファイルを送るだけです。', '開くときは、画面にファイルをドラッグしても読み込めます。'],
    tips: ['別の端末で続けたいときは「端末間同期」が使えます（詳細モード）。']}
];
const GLOSSARY = [
  ['隊形（たいけい）', '人が並んでいる形。ライン・円・V字など。'],
  ['セット', 'ある瞬間の隊形をうつした「写真」1枚。ドリルはセットの連なりです。'],
  ['カウント', '拍の数え方。1カウント＝1拍。BPM 120 なら1カウントは0.5秒です。'],
  ['BPM（テンポ）', '1分間の拍の数。大きいほど速い。'],
  ['ホールド', '次のセットへ動かず、その場で止まって見せる時間。'],
  ['マークタイム', 'その場で足踏みをしている状態。ホールド中に使えます。'],
  ['上手（かみて）', '客席から見て舞台の右がわ。'],
  ['下手（しもて）', '客席から見て舞台の左がわ。'],
  ['フォロー・ザ・リーダー', '先頭の人が通った道を、後ろの人が順になぞって進む動き。'],
  ['カンパニーフロント', '全員が会場の横いっぱいに、1本の線で並ぶこと。'],
  ['ウェッジ', '先がとがった三角形（くさび形）の隊形。'],
  ['グライド', '足をなめらかに運ぶ、マーチングの基本の歩き方。'],
  ['バックマーチ', '後ろ向きに進むステップ。'],
  ['8 to 5（エイト・トゥ・ファイブ）', '5ヤード（約4.6m）を8歩で歩くこと。フットボール場の基準です。'],
  ['ドットシート', '一人ひとりの位置を書いた表。隊形から自動で作れます。'],
  ['吸着（きゅうちゃく）', 'ドラッグしたとき、マス目にぴたっと合わせる機能。']
];

// セットの表示名（サブセットは 親の名前 + A, B, C…。Rust / web/engine.js の set_display_names と同じ規則）
function displayNames(sets) {
  const letters = n => { let v = ''; for (;;) { v = String.fromCharCode(65 + (n % 26)) + v; if (n < 26) break; n = Math.floor(n / 26) - 1; } return v; };
  const out = []; let parent = '', idx = 0;
  for (const s of sets || []) {
    if (s.sub) { out.push(s.name === '' ? parent + letters(idx) : s.name); idx++; }
    else { parent = s.name; idx = 0; out.push(s.name); }
  }
  return out;
}
// ---- 再生位置の刻み（拍・小節・自由）----
// 小節の長さ（カウント）と開始位置: パートの拍子（n/d）があればそれ、なければ設定の拍数（既定 4）。
function barInfo(parts, beats) {
  const ps = (parts || []).filter(p => p && p.meter);
  if (ps.length) {
    const m = ps[0].meter, n = Array.isArray(m) ? +m[0] : +String(m).split('/')[0], d = Array.isArray(m) ? +m[1] : +String(m).split('/')[1];
    if (n > 0 && d > 0) return {len: n * 4 / d, origin: +ps[0].start || 0, from: 'part', meter: n + '/' + d};
  }
  const b = Math.max(1, Math.min(16, Math.round(+beats) || 4));
  return {len: b, origin: 0, from: 'setting', meter: b + '/4'};
}
// 位置 t を刻みに合わせる（unit: 'beat' | 'bar' | 'free'）
function snapSeek(t, unit, bar, total) {
  let v = t;
  if (unit === 'beat') v = Math.round(t);
  else if (unit === 'bar') v = bar.origin + Math.round((t - bar.origin) / bar.len) * bar.len;
  return Math.max(0, Math.min(total, v));
}
// 1つ前・次の刻みへ（byBar: 小節ごと）。自由のときは 1 カウント。いまの位置が刻みの途中なら、次の刻みの位置まで
function stepSeek(t, dir, unit, bar, total, byBar) {
  const u = byBar ? 'bar' : (unit === 'bar' ? 'bar' : 'beat');
  const len = u === 'bar' ? bar.len : 1, org = u === 'bar' ? bar.origin : 0, eps = 1e-6;
  const q = (t - org) / len;
  let k = dir > 0 ? Math.floor(q + eps) + 1 : Math.ceil(q - eps) - 1;
  return Math.max(0, Math.min(total, org + k * len));
}
// ものさしの目盛り: 拍ごと・小節ごと（小節番号は 1 から）。t が 0..total の範囲
function rulerTicks(total, bar) {
  const out = [];
  for (let t = 0; t <= total + 1e-9; t += 1) {
    const q = (t - bar.origin) / bar.len, isBar = Math.abs(q - Math.round(q)) < 1e-6 && t >= bar.origin - 1e-9;
    out.push({t, bar: isBar ? Math.round(q) + 1 : 0});
  }
  return out;
}

const api = {
  VENUES, venueGeom, fieldDesc, INST, INST_BY, catOfInst, PRESETS, total, sectionsFromCounts, FORMS, FORM_BY,
  displayNames, barInfo, snapSeek, stepSeek, rulerTicks, finalize, formationParts, formationStmts, groupStr, mkStmt, shapePoints, thumbDots, buildModel, secsOfModel, miniSvg, friendly, whoName, GUIDES, GLOSSARY
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.JKX = api;
})(typeof window !== 'undefined' ? window : this);
