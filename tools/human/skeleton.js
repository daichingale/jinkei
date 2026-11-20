'use strict';
// 骨格（静止姿勢。座標は m、Y 上、+Z 前、足の裏 y=0、キャラクターの左 = +X）
const {V, Q} = require('./math');

const SH = [0.19, 1.375, 0];                    // 肩（上腕の付け根）
const dirU = V.norm([0.17, -0.985, 0]);           // 上腕の向き（A ポーズ）
const dirF = V.norm([0.12, -0.976, 0.181]);       // 前腕の向き
const dirH = V.norm([0.05, -0.97, 0.15]);         // 手の向き
const LU = 0.30, LF = 0.26, LH = 0.19;
const ELB = V.madd(SH, dirU, LU), WRI = V.madd(ELB, dirF, LF);
const HIP_Y = 0.93, KNEE_Y = 0.50, ANK_Y = 0.085, LX = 0.095;
const THIGH = HIP_Y - KNEE_Y, SHIN = KNEE_Y - ANK_Y;

// [name, parentName, 世界座標（静止姿勢）]
const side = (n, par, p) => [[n + 'L', par + 'L', p], [n + 'R', par + 'R', [-p[0], p[1], p[2]]]];
const DEF = [
  ['root', null, [0, 0.95, 0]], ['spine', 'root', [0, 1.06, 0]], ['chest', 'spine', [0, 1.22, 0]],
  ['neck', 'chest', [0, 1.42, 0]], ['head', 'neck', [0, 1.51, 0]],
  ...side('clav', 'chest', [0.03, 1.39, 0]).map(([n, , p]) => [n, 'chest', p]),
  ...side('upperArm', 'clav', SH), ...side('foreArm', 'upperArm', ELB), ...side('hand', 'foreArm', WRI),
  ...side('thigh', 'root', [LX, HIP_Y, 0]).map(([n, , p]) => [n, 'root', p]),
  ...side('shin', 'thigh', [LX - 0.002, KNEE_Y, 0.004]), ...side('foot', 'shin', [LX - 0.002, ANK_Y, 0]),
  ...side('toe', 'foot', [LX - 0.002, 0.034, 0.145]),
  ['prop', 'chest', [0, 1.30, 0]],
];
const names = DEF.map(d => d[0]);
const bones = DEF.map(([name, par, world]) => ({name, parent: par === null ? -1 : names.indexOf(par), world}));
bones.forEach(b => { const p = b.parent < 0 ? [0, 0, 0] : bones[b.parent].world; b.pos = V.sub(b.world, p); });
const id = n => names.indexOf(n);
const W = n => bones[id(n)].world;

// 静止姿勢のまま回転だけ与えたときの世界変換を求める（FK）。pose[i] = {p, q} は親から見た局所変換
function fk(pose) {
  const out = [];
  bones.forEach((b, i) => {
    const l = pose[i] || {p: b.pos, q: Q.id()};
    if (b.parent < 0) out.push({p: l.p, q: l.q});
    else { const par = out[b.parent]; out.push({p: V.add(par.p, Q.rot(par.q, l.p)), q: Q.mul(par.q, l.q)}); }
  });
  return out;
}
module.exports = {bones, names, id, W, fk, SH, ELB, WRI, dirU, dirF, dirH, LU, LF, LH, THIGH, SHIN, HIP_Y, KNEE_Y, ANK_Y, LX};
