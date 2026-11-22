#!/usr/bin/env node
'use strict';
// 人体モデル・楽器・ポーズ・歩行アニメを手続き生成して assets/human.bin / human.json に書き出す。
// 使い方: node tools/gen_human.js    （形式は tools/README.md）
const fs = require('fs');
const path = require('path');
const S = require('./human/skeleton');
const M = require('./human/materials');
const {MeshBuilder} = require('./human/mesh');
const {buildBody} = require('./human/body');
const A = require('./human/anim');
const I = require('./human/instruments');
const ST = require('./human/styles');
const {V, Q, ss} = require('./human/math');
const hws = S.W('head');

const OUT = path.join(__dirname, '..', 'assets');
const blobParts = []; let blobLen = 0;
function put(arr) {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), off = blobLen;
  const pad = (4 - buf.length % 4) % 4;
  blobParts.push(buf, Buffer.alloc(pad)); blobLen += buf.length + pad;
  return off;
}
function packMesh(m) {
  const n = m.pos.length / 3;
  if (n > 65535) throw new Error('頂点数が多すぎます: ' + n);
  return {
    vertices: n, indices: m.idx.length, triangles: m.idx.length / 3,
    pos: put(new Float32Array(m.pos)), nor: put(new Float32Array(m.nor)),
    skinIndex: put(new Uint8Array(m.skin)), skinWeight: put(new Float32Array(m.skinW)),
    mat: put(new Uint8Array(m.mat)), index: put(new Uint16Array(m.idx)),
  };
}

const J = {format: 'JKH1', version: 1, height: 1.7};
J.bones = S.bones.map(b => ({name: b.name, parent: b.parent, pos: b.pos.map(x => +x.toFixed(5))}));
J.materials = M.list.map(([name, color, rough, metal, tint, ill]) => ({name, color, rough, metal, tint, ...((ill || M.ILL[name]) ? {ill: ill || M.ILL[name]} : {})}));

const body = new MeshBuilder();
buildBody(body);
const bm = body.finalize(S.bones.length);
J.body = packMesh(bm);
J.instruments = {};
// ---- イラスト（look illust）: 専用の体（白Tシャツ・色スリーブ）。顔と髪はリアルと共通（face.js / hair.js）----
{
  const IL = require('./human/illust');
  const ib = new MeshBuilder();
  IL.buildIllust(ib);
  J.illust = {body: packMesh(ib.finalize(S.bones.length))};
}
// ---- 顔（テクスチャとパッチ）・髪 ----
{
  const F = require('./human/face'), HR = require('./human/hair');
  const tex = F.bakeFace();
  const fp = F.facePatch(), pos = [], nor = [], uv = [], skin = [], skinW = [], mat = [];
  const hw = (y) => { const t = ss(1.46, 1.50, y); return [[S.id('head'), 0.4 + 0.6 * t], [S.id('neck'), 0.6 * (1 - t)]]; };
  fp.P.forEach((p, i) => {
    const w = hw(p[1]), q = F.headS(p);
    pos.push(...q); nor.push(...fp.N[i]); uv.push(...fp.UV[i]); mat.push(M.SKIN);
    for (let k = 0; k < 4; k++) { skin.push(w[k] ? w[k][0] : 0); skinW.push(w[k] ? w[k][1] : 0); }
  });
  const nv = pos.length / 3;
  J.face = {
    tex: {w: tex.w, h: tex.h, a: put(tex.a), b: put(tex.b)},
    mesh: {vertices: nv, indices: fp.idx.length, triangles: fp.idx.length / 3, pos: put(new Float32Array(pos)), nor: put(new Float32Array(nor)), uv: put(new Float32Array(uv)),
      skinIndex: put(new Uint8Array(skin)), skinWeight: put(new Float32Array(skinW)), mat: put(new Uint8Array(mat)), index: put(new Uint16Array(fp.idx))},
    hairs: {real: [], illust: []},
    // 虹彩の色（目の色）。隊員ごとに添字で選ぶ: 茶・濃い茶・ヘーゼル・青灰・すみれ・琥珀・緑
    eyes: [0x7a4a2a, 0x4a2c1c, 0x8a6a2a, 0x5f7f9f, 0x7a5ab0, 0xc0842a, 0x3f8a5a],
    // 髪の色。hairSlots が出現の重み（ピンク・ラベンダー・シルバーは 1/20 ずつ）
    hairCols: [0x1e1a22, 0x3b2a22, 0x6a3f2c, 0x9a6b44, 0x8c8279, 0x8d4130, 0x2a2024, 0xd2a860, 0x232b45, 0xe79ab8, 0xb9a4dd, 0xcfd3dc],
    hairSlots: [0, 0, 6, 1, 1, 2, 2, 3, 3, 4, 5, 5, 7, 8, 0, 1, 2, 9, 10, 11],
    // 顔の色（sRGB）: 白目・墨・くちびる・口の線・ほお・眉に混ぜる色・ハイライト
    colors: {sclera: 0xf3f1f4, ink: 0x1c1216, lip: 0xdc6e78, line: 0x8c3744, blush: 0xf08c96, brow: 0x3a2a26},
  };
  for (const real of [false, true]) for (const name of HR.NAMES) {
    const hb = new MeshBuilder();
    HR.build(hb, name, real);
    const m = hb.finalize(S.bones.length);
    for (let i = 0; i < m.pos.length; i += 3) { m.pos[i] -= hws[0]; m.pos[i + 1] -= hws[1]; m.pos[i + 2] -= hws[2]; }
    const key = (real ? 'hairr/' : 'hair/') + name;
    J.instruments[key] = {attach: {bone: 'head', pos: [0, 0, 0], quat: [0, 0, 0, 1]}, vertices: m.pos.length / 3, indices: m.idx.length, triangles: m.idx.length / 3,
      pos: put(new Float32Array(m.pos)), nor: put(new Float32Array(m.nor)), mat: put(new Uint8Array(m.mat)), index: put(new Uint16Array(m.idx)), outlineIdx: hb.noOutline * 3};
    (real ? J.face.hairs.real : J.face.hairs.illust).push(key);
  }
}
J.clips = [];
J.strike = {};
J.groups = {lower: A.LOWER, upper: A.UPPER};
// クリップ: 指定ボーンだけの局所変換（位置3 + クォータニオン4）を frames 枚ぶん。counts は1周のカウント数（静止は 0）
function clip(name, boneNames, poses, counts) {
  const idx = boneNames.map(n => S.id(n)), arr = new Float32Array(poses.length * idx.length * 7);
  let o = 0;
  for (const p of poses) for (const i of idx) { arr.set(p[i].p, o); arr.set(p[i].q, o + 3); o += 7; }
  J.clips.push({name, bones: idx, frames: poses.length, counts, off: put(arr)});
}
const log = [];
for (const n of ['attention', 'rest', 'wide', 'cross', 'kneel', 'kneel2', 'lunge', 'crouch', 'toe']) {
  const {pose, info} = A.stance(n); clip('stance/' + n, A.LOWER, [pose], 0);
  log.push(`${n}: thighR ${(info.R.thighAngle * 57.3).toFixed(0)} thighL ${(info.L.thighAngle * 57.3).toFixed(0)} kneeFlex ${(info.R.kneeFlex * 57.3).toFixed(0)}/${(info.L.kneeFlex * 57.3).toFixed(0)}`);
}
J.strides = [0, 0.3, 0.5, 0.75];
for (const type of Object.keys(A.GAITS)) for (const L of J.strides) {
  const {frames, stats} = A.walkCycle(type, type === 'back' ? -L : L); // slideL/slideR は向きを GAITS.lat で決める
  clip(`walk/${type}/${L}`, A.LOWER, frames, 2);
  log.push(`walk/${type}/${L}: maxThigh ${(stats.maxThigh * 57.3).toFixed(0)} clear ${stats.clear.toFixed(3)} minHip ${stats.minHip.toFixed(3)}`);
}
// 上半身: 腕を下ろす（idle）・腰の後ろで組む（behind）
{
  const idle = A.newPose(); clip('idle', A.UPPER, [idle], 0);
  const bp = A.newPose(), mxr = (x, s) => [x * s, 0.93, -0.125];
  for (const sd of [1, -1]) {
    const r = A.solveArm(bp, sd, {wrist: [0.035 * sd, 0.93, -0.12], fd: [-sd * 0.5, -0.3, 0.2], pn: [0, 0.2, -1], pole: [sd * 1, -0.3, -0.5], clav: 0});
    log.push(`behind ${sd}: reach ${r.reach.toFixed(2)}`);
  }
  clip('behind', A.UPPER, [bp], 0);
}

// ---- 楽器: メッシュと構え（hold）・おろし（carry）・振り上げ（up）----
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const PROP = S.W('prop');
function packRigid(mb) {
  const m = mb.finalize(S.bones.length);
  for (let i = 0; i < m.pos.length; i += 3) { m.pos[i] -= PROP[0]; m.pos[i + 1] -= PROP[1]; m.pos[i + 2] -= PROP[2]; }
  const n = m.pos.length / 3;
  if (n > 65535) throw new Error('楽器の頂点数が多すぎます');
  return {vertices: n, indices: m.idx.length, triangles: m.idx.length / 3, pos: put(new Float32Array(m.pos)), nor: put(new Float32Array(m.nor)), mat: put(new Uint8Array(m.mat)), index: put(new Uint16Array(m.idx))};
}
// 構え（grip と小道具の変換 T）から上半身ボーンのポーズを作る。free に入れた側の腕はおろしたまま
//   opt.parts[key]: その手の握りに使う変換（手に付く部品用。無ければ T）／ opt.grip[key]: 握りの向き（fd, pn, pole）の指定
//   opt.G[key]: その手の握りの点（楽器の座標）の指定
function armPose(spec, T, free = [], over = {}, opt = {}) {
  const pose = A.newPose(); A.setProp(pose, T);
  let short = 0;
  for (const side of [1, -1]) {
    const key = side > 0 ? 'L' : 'R', gr = spec[key];
    if (!gr || free.includes(key)) {
      if (over[key]) { const o = over[key]; const r = A.solveArm(pose, side, {wrist: o.wrist, fd: o.fd, pn: o.pn, pole: o.pole || [side * 0.5, -1, -0.2], clav: o.clav || 0}); short += r.short; }
      continue;
    }
    const Ts = opt.parts && opt.parts[key] !== undefined ? opt.parts[key] : T, go = opt.grip && opt.grip[key];
    const gg = {G: A.applyT(Ts, (opt.G && opt.G[key]) || gr.G), fd: go ? go.fd : A.applyTd(Ts, gr.fd), pn: go ? go.pn : A.applyTd(Ts, gr.pn), r: gr.r};
    const w = A.gripToWrist(gg);
    const r = A.solveArm(pose, side, {wrist: w.wrist, fd: w.fd, pn: w.pn, pole: go && go.pole ? go.pole : gr.pole, clav: clamp((gg.G[1] - 1.30) * 0.45, 0, 0.28)});
    short += r.short;
  }
  return {pose, short};
}
// 横に構える楽器（フルート・ピッコロ）は体の前後軸ではなく縦軸まわりに下ろす
const SIDEWAYS = ['flute', 'piccolo'];
// 体につけて抱える・大きい楽器は「おろし」でも構えのまま（手で下げない）
const KEEP = ['snare', 'tenors', 'bass1', 'bass2', 'bass3', 'bass4', 'bass5', 'cymbals_mid', 'euphonium', 'marching_euphonium', 'tuba', 'marching_tuba', 'sousaphone',
  'xylophone', 'glockenspiel', 'bassoon', 'bass_clarinet', 'alto_clarinet', 'tenor_sax', 'baritone_sax'];
function fitT(spec, mode, kind) {
  const gs = ['L', 'R'].filter(k => spec[k]).map(k => spec[k].G);
  const piv = gs.reduce((a, g) => V.add(a, V.mul(g, 1 / gs.length)), [0, 0, 0]);
  let best = null;
  const rots = [];
  if (mode === 'carry') for (let a = 0.4; a <= 1.5; a += 0.1) rots.push(SIDEWAYS.includes(kind) ? A.Qz(a) : A.Qx(a));
  else for (let a = -1.0; a <= -0.2; a += 0.1) rots.push(SIDEWAYS.includes(kind) ? A.Qz(a * -0.8) : A.Qx(a));
  const xs = mode === 'carry' ? [-0.2, -0.15, -0.1, -0.05, 0, 0.05] : [-0.06, -0.03, 0, 0.03, 0.06];
  const ys = mode === 'carry' ? [-0.55, -0.5, -0.45, -0.4, -0.35, -0.3, -0.25, -0.2] : [0.04, 0.08, 0.12, 0.16, 0.2];
  const zs = mode === 'carry' ? [-0.2, -0.15, -0.1, -0.05, 0, 0.05] : [-0.12, -0.08, -0.04, 0, 0.04];
  for (const q of rots) for (const x of xs) for (const y of ys) for (const z of zs) {
    const T = {pivot: piv, q, shift: [x, y, z]}, {short} = armPose(spec, T);
    const gy = gs.reduce((a, g) => a + A.applyT(T, g)[1] / gs.length, 0);
    if (mode === 'carry' && gy > 1.12) continue;
    const ang = Math.abs(Q.rotAngle ? 0 : 0);
    const cost = short * 100 + (mode === 'carry' ? (Math.abs(x + 0.08) + Math.abs(z)) * 0.2 : -(y * 0.6 + Math.abs(q[0] + q[2]) * 0.3));
    if (!best || cost < best.cost) best = {cost, T, short};
  }
  return best;
}
// 手に付く部品のメッシュを手のボーンの局所座標にして詰める。構え（hold）のときの手の姿勢で焼くので、
// 構えのときは今までと同じ位置、ほかの構えでは手にそのまま付いてくる
function packPart(pmb, boneName, holdPose) {
  if (!pmb.T.length) return null;
  const m = pmb.finalize(S.bones.length), w = S.fk(holdPose)[S.id(boneName)], qi = Q.inv(w.q);
  for (let i = 0; i < m.pos.length; i += 3) {
    const p = Q.rot(qi, V.sub([m.pos[i], m.pos[i + 1], m.pos[i + 2]], w.p)), n = Q.rot(qi, [m.nor[i], m.nor[i + 1], m.nor[i + 2]]);
    m.pos[i] = p[0]; m.pos[i + 1] = p[1]; m.pos[i + 2] = p[2]; m.nor[i] = n[0]; m.nor[i + 1] = n[1]; m.nor[i + 2] = n[2];
  }
  const n = m.pos.length / 3;
  if (n > 65535) throw new Error('部品の頂点数が多すぎます');
  return {attach: {bone: boneName, pos: [0, 0, 0], quat: [0, 0, 0, 1]}, vertices: n, indices: m.idx.length, triangles: m.idx.length / 3, pos: put(new Float32Array(m.pos)), nor: put(new Float32Array(m.nor)), mat: put(new Uint8Array(m.mat)), index: put(new Uint16Array(m.idx))};
}
// 打つ動きの記述を書き出す（strike.js / strike.rs が読む）。棒は手のボーンの局所座標（tip = 先端の球の中心、ax = 後端→先端の向き、rh = 球の半径）にする。
// 打面・待機位置は構えのときのモデル座標のまま（実行時に小道具のボーンの変換で動かす）
function packStrike(sp, fk) {
  const r5 = v => v.map(x => +x.toFixed(5)), out = {drums: sp.drums.map(d => ({pad: d.pad, c: r5(d.c), n: r5(d.n), ex: r5(d.ex), ez: r5(d.ez), r: +d.r.toFixed(5), spread: d.spread, ...(d.hand ? {hand: d.hand} : {})})), stick: {}, anchor: {}, click: r5(sp.click)};
  for (const k of ['R', 'L']) {
    const w = fk[S.id('hand' + k)], qi = Q.inv(w.q), st = sp.sticks[k];
    out.stick[k] = {tip: r5(Q.rot(qi, V.sub(st.b, w.p))), ax: r5(V.norm(Q.rot(qi, V.sub(st.b, st.a)))), rh: st.rh};
    out.anchor[k] = r5(sp.anchor[k]);
  }
  return out;
}
// 構え 4 種類（right / left / front / diag）のクリップ
function styleClips(kind, spec, mb, parts) {
  const cfg = ST.CFG[kind], pts = mb.P, r = {};
  let res = null;
  if (cfg) {
    if (cfg.fam === 'long') res = ST.longStyles(kind, spec, cfg, pts, armPose);
    else if (cfg.fam === 'sousa') res = ST.sousaStyles(kind, spec, cfg, pts, armPose);
    else if (cfg.fam === 'compact') res = ST.compactStyles(kind, spec, cfg, pts, armPose);
    else res = ST.keepStyles(kind, spec, cfg, pts, armPose);
  } else if (kind === 'snare' || kind === 'tenors') res = ST.stickStyles(kind, spec, kind === 'tenors' ? {hy: 1.18, hz: 0.26} : {}, {R: parts.R.P, L: parts.L.P}, armPose);
  else if (kind === 'xylophone') res = ST.stickStyles(kind, spec, {hy: 1.16, hz: 0.24, hx: 0.12}, {R: parts.R.P, L: parts.L.P}, armPose);
  else if (kind.startsWith('bass')) res = ST.bassStyles(kind, spec, {R: {bass1: 0.23, bass2: 0.255, bass3: 0.28, bass4: 0.33, bass5: 0.38}[kind]}, {R: parts.R.P, L: parts.L.P}, armPose);
  else if (kind.startsWith('cymbals')) res = ST.cymbalStyles(kind, spec, {}, {R: parts.R.P, L: parts.L.P}, armPose);
  else if (kind === 'glockenspiel') res = ST.glockStyles(kind, spec, {}, pts, {R: parts.R.P, L: parts.L.P}, armPose);
  if (!res) return;
  for (const name of ['right', 'left', 'front', 'diag']) {
    if (!res.out[name]) continue;
    clip(`style/${name}/${kind}`, A.UPPER, [res.out[name].pose], 0);
    if (res.out[name].short > 0.012) instLog.push(`${kind}: style ${name} short ${res.out[name].short.toFixed(3)}`);
  }
  for (const l of res.log) instLog.push(`${kind}: ${l}`);
}
const instLog = [];
for (const [kind, build] of Object.entries(I.KINDS)) {
  const mb = new MeshBuilder(), parts = {R: new MeshBuilder(), L: new MeshBuilder()};
  const spec = build(mb, parts);
  if (mb.T.length) J.instruments[kind] = {attach: {bone: 'prop', pos: [0, 0, 0], quat: [0, 0, 0, 1]}, ...packRigid(mb)};
  if (kind === 'guard') continue; // 旗は下で個別に作る
  const hold = armPose(spec, null);
  if (spec.strike) J.strike[kind] = packStrike(spec.strike, S.fk(hold.pose));
  for (const [k, bone] of [['R', 'handR'], ['L', 'handL']]) { const pk = packPart(parts[k], bone, hold.pose); if (pk) J.instruments[kind + '+' + k] = pk; }
  clip('hold/' + kind, A.UPPER, [hold.pose], 0);
  const keep = KEEP.includes(kind);
  let carry = {pose: hold.pose, short: 0}, up = carry;
  if (spec.carryT) { carry = armPose(spec, spec.carryT); up = carry; instLog.push(`${kind}: carryT short ${carry.short.toFixed(3)}`); }
  else if (!keep) {
    const c = fitT(spec, 'carry', kind), u = fitT(spec, 'up', kind);
    if (c) carry = armPose(spec, c.T); if (u) up = armPose(spec, u.T);
    instLog.push(`${kind}: carry short ${(c ? c.short : -1).toFixed(3)} up short ${(u ? u.short : -1).toFixed(3)}`);
  }
  clip('carry/' + kind, A.UPPER, [carry.pose], 0);
  clip('up/' + kind, A.UPPER, [up.pose], 0);
  styleClips(kind, spec, mb, parts);
  instLog.push(`${kind}: hold short ${hold.short.toFixed(3)} tris ${J.instruments[kind] ? J.instruments[kind].triangles : 0}`);
}
// ---- カラーガード: 構え・おろし・スピン・トス・スイング ----
{
  const spec = I.KINDS.guard(new MeshBuilder()), G = I.FLAG_G;
  const hold = armPose(spec, null);
  clip('guard/hold', A.UPPER, [hold.pose], 0);
  // おろし: ポールの下端が床に着くまで下げ、右手はポールの高いところを持つ
  const specC = {R: {...spec.R, G: V.add(spec.R.G, [0, 0.45, 0])}};
  const Tc = {pivot: G, q: [0, 0, 0, 1], shift: [-0.02, -0.60, -0.02]};
  clip('guard/carry', A.UPPER, [armPose(specC, Tc).pose], 0);
  { const gs = ST.flagStyles(spec, G, armPose); for (const n of ['right', 'left', 'front', 'diag']) clip(`style/${n}/guard`, A.UPPER, [gs.out[n].pose], 0); instLog.push(...gs.log.map(l => 'guard: ' + l)); }
  const freeL = {L: {wrist: [0.40, 1.14, 0.10], fd: [0.15, -1, 0.2], pn: [-1, 0, 0], pole: [1, -0.3, -0.2]}};
  const N = 20, spin = [], swing = [], toss = [];
  const c = I.FLAG_G, mid = [c[0], 1.4, c[2]];
  for (let k = 0; k < N; k++) {
    const ph = k / N;
    spin.push(armPose(spec, {pivot: G, q: A.Qz(2 * Math.PI * ph), shift: [0.0, 0.36, 0.17]}, ['L'], freeL).pose);
    swing.push(armPose(spec, {pivot: G, q: A.Qz(0.95 * Math.sin(2 * Math.PI * ph)), shift: [0.0, 0.22, 0.12]}, ['L'], freeL).pose);
  }
  clip('guard/spin', A.UPPER, spin, 2); clip('guard/swing', A.UPPER, swing, 2);
  const NT = 40, smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  for (let k = 0; k < NT; k++) {
    const u = k / NT; let th = 0, lift = 0;
    if (u > 0.1 && u < 0.8) { const x = (u - 0.1) / 0.7; th = 4 * Math.PI * x; lift = 2.4 * 4 * x * (1 - x); }
    const T = {pivot: mid, q: A.Qz(th), shift: [0, lift, 0]};
    // 手が旗を握っている度合い（飛んでいる間は両手を上に伸ばす）
    const att = 1 - smooth((u - 0.1) / 0.1) * (1 - smooth((u - 0.74) / 0.1));
    const gr = {R: spec.R, L: spec.L};
    const pose = A.newPose(); A.setProp(pose, T);
    for (const side of [1, -1]) {
      const key = side > 0 ? 'L' : 'R', g = gr[key];
      const gw = A.gripToWrist({G: A.applyT(T, g.G), fd: A.applyTd(T, g.fd), pn: A.applyTd(T, g.pn), r: g.r});
      const free = {wrist: [side * 0.2, 1.72, 0.2], fd: [0, 1, 0.1], pn: [-side * 0.3, 0, 1]};
      // 付いているうちは旗の握り、離れたら上に伸ばした手。届かない握りは手前までにする
      const w = att, wr = V.lerp(free.wrist, gw.wrist, w), fd = V.norm(V.lerp(free.fd, gw.fd, w)), pn = V.norm(V.lerp(free.pn, gw.pn, w));
      A.solveArm(pose, side, {wrist: wr, fd, pn, pole: g.pole, clav: 0.2 * (1 - w) + 0.1});
    }
    toss.push(pose);
  }
  clip('guard/toss', A.UPPER, toss, 4);
}

if (process.argv.includes('-v')) console.log(log.concat(instLog).join('\n'));

if (process.argv.includes('--dev')) { fs.writeFileSync('/tmp/body_dev.json', JSON.stringify({pos: bm.pos, nor: bm.nor, mat: bm.mat, idx: bm.idx, skin: bm.skin, w: bm.skinW})); }

const json = Buffer.from(JSON.stringify(J));
const jpad = (4 - json.length % 4) % 4, jb = Buffer.concat([json, Buffer.alloc(jpad, 0x20)]);
const head = Buffer.alloc(8); head.write('JKH1', 0, 'latin1'); head.writeUInt32LE(jb.length, 4);
fs.mkdirSync(OUT, {recursive: true});
fs.writeFileSync(path.join(OUT, 'human.bin'), Buffer.concat([head, jb, ...blobParts]));
fs.writeFileSync(path.join(OUT, 'human.json'), JSON.stringify(J, null, 1));
console.log(`body: ${J.body.vertices} verts, ${J.body.triangles} tris; bin ${(8 + jb.length + blobLen) / 1024 | 0} KB`);
