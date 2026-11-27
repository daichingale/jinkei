#!/usr/bin/env node
// 決定的（シード固定）なランダムショー生成。ベンチ（tools/bench.js）と学習（tools/train_fix_ai.js）で共有する。
//   genShow(seed, {members, sets, field}) → .jk のソース文字列
// 衝突・大股が起きやすいように、セットの長さを短め・隊形を密めにしてある。
'use strict';
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const VENUES = {
  gym: {decl: '', rx: 13, y0: -13, y1: 13, sp: 1.1},
  gym24: {decl: 'field gym 24 x 20', rx: 11, y0: -9, y1: 9, sp: 1.1},
  floor: {decl: 'field floor 24 x 18', rx: 11, y0: 1, y1: 17, sp: 1.1},
  stage: {decl: 'field stage', rx: 7, y0: 1, y1: 9, sp: 1.0},
  football: {decl: 'field football', rx: 55, y0: 4, y1: 80, sp: 2.0},
};
function genShow(seed, o) {
  o = o || {};
  const R = mulberry(seed * 7919 + 13);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const pick = a => a[Math.floor(R() * a.length)];
  const vname = o.field || pick(['gym', 'gym', 'gym24', 'floor', 'football', 'stage']);
  const V = VENUES[vname];
  const total = o.members || ri(8, 40);
  const nsets = o.sets || ri(3, 8);
  // セクションに分ける
  const nsec = Math.min(Math.max(2, Math.round(total / 8)), 8, total);
  const secs = [];
  let left = total;
  for (let i = 0; i < nsec; i++) { const n = i === nsec - 1 ? left : Math.max(1, Math.min(left - (nsec - i - 1), Math.round(total / nsec + (R() - 0.5) * 4))); secs.push({id: 's' + i, n}); left -= n; }
  const num = v => String(Math.round(v * 4) / 4);
  const X = () => R() * 2 * V.rx - V.rx;
  const Y = () => V.y0 + R() * (V.y1 - V.y0);
  const P = () => `(${num(X())}, ${num(Y())})`;
  const Pn = (cx, cy, r) => `(${num(Math.max(-V.rx, Math.min(V.rx, cx + (R() - 0.5) * r)))}, ${num(Math.max(V.y0, Math.min(V.y1, cy + (R() - 0.5) * r)))})`;
  let out = `show "gen${seed}" {\n` + (V.decl ? `  ${V.decl}\n` : '') + `  tempo 120\n`;
  for (const s of secs) out += `  section ${s.id} "S${s.id}" ${s.n}\n`;
  // 隊形の単位（ショー全体で固定）
  const units = [];
  for (let i = 0; i < secs.length;) {
    const s = secs[i];
    if (i + 1 < secs.length && R() < 0.35) { units.push({g: `${s.id} + ${secs[i + 1].id}`, n: s.n + secs[i + 1].n}); i += 2; }
    else if (s.n >= 4 && R() < 0.3) { const h = ri(1, s.n - 1); units.push({g: `${s.id}1..${s.id}${h}`, n: h}); units.push({g: `${s.id}${h + 1}..${s.id}${s.n}`, n: s.n - h}); i++; }
    else { units.push({g: s.id, n: s.n}); i++; }
  }
  const cols = Math.ceil(Math.sqrt(units.length * (2 * V.rx) / (V.y1 - V.y0))), rows = Math.ceil(units.length / cols);
  const cw = 2 * V.rx / cols, ch = (V.y1 - V.y0) / rows;
  let cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([-V.rx + (c + 0.5) * cw, V.y0 + (r + 0.5) * ch]);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
  for (let k = 0; k < nsets; k++) {
    let swapped = false;
    // ときどき2つの区画を入れ替える（その2ユニットだけが交差して動く）
    if (k > 0 && cells.length > 1 && R() < 0.5) { const i = ri(0, cells.length - 1); let j = ri(0, cells.length - 1); if (j === i) j = (i + 1) % cells.length; const t = cells[i]; cells[i] = cells[j]; cells[j] = t; swapped = true; }
    const counts = k === 0 ? '' : ` counts ${swapped ? pick([12, 16, 24, 32]) : pick([4, 6, 8, 8, 12, 16])}`;
    out += `  set ${k + 1}${counts} {\n`;
    units.forEach((u, ui) => {
      const [cx, cy] = cells[ui];
      const fit = Math.min(cw, ch) * 0.85, diag = Math.hypot(cw, ch) * 0.8;
      const len = Math.max(1, u.n - 1) * V.sp;
      const circR = Math.max(1.5, u.n * V.sp / 6.2);
      const colsB = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(u.n * 1.4))));
      const blockW = (colsB - 1) * V.sp * 1.1, blockH = Math.ceil(u.n / colsB) * V.sp * 1.1;
      const opts = [];
      if (len <= diag) opts.push('line');
      if (len <= diag) opts.push('curve');
      if (len <= diag * 1.2) opts.push('arc');
      if (circR * 2 <= fit * 1.1) opts.push('circle');
      if (blockW <= cw * 0.95 && blockH <= ch * 0.95) opts.push('block');
      if (k > 0) opts.push('same', 'same');
      if (!opts.length) opts.push('block');
      let kind = pick(opts);
      if (k === 0 && kind === 'same') kind = 'block';
      const ang = (R() < 0.6 ? (R() < 0.5 ? 0 : Math.PI / 2) : R() * Math.PI);
      const ax = Math.cos(ang) * len / 2, ay = Math.sin(ang) * len / 2;
      let sh;
      if (kind === 'line') sh = `line (${num(cx - ax)}, ${num(cy - ay)}) -> (${num(cx + ax)}, ${num(cy + ay)})`;
      else if (kind === 'curve') sh = `curve (${num(cx - ax)}, ${num(cy - ay)}) -> (${num(cx + ay * 0.3)}, ${num(cy + ax * 0.3)}) -> (${num(cx + ax)}, ${num(cy + ay)})`;
      else if (kind === 'arc') sh = `arc (${num(cx)}, ${num(cy)}) radius ${num(Math.max(2, len / 2.4))} from ${ri(190, 215)} to ${ri(325, 350)}`;
      else if (kind === 'circle') sh = `circle (${num(cx)}, ${num(cy)}) radius ${num(circR)}`;
      else if (kind === 'block') sh = `block (${num(cx)}, ${num(cy)}) cols ${colsB} spacing ${num(V.sp * 1.1)}`;
      else sh = `same rotate ${pick([30, -30, 45, -45, 20])}`;
      out += `    ${u.g} : ${sh}\n`;
    });
    out += '  }\n';
  }
  return out + '}\n';
}
module.exports = {genShow, mulberry};
if (require.main === module) {
  const seed = +process.argv[2] || 1;
  process.stdout.write(genShow(seed, {members: +process.argv[3] || undefined, sets: +process.argv[4] || undefined}));
}
