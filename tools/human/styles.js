'use strict';
// 楽器の構え（carry）: 演奏（hold）以外の 4 種類 right（右手）・left（左手）・front（正面）・diag（斜め）の上半身ポーズを作る。
// 構えごとに「楽器（小道具ボーン）の変換 T」と「手の握り」を決め、armPose（gen_human.js）で腕を解く。
//   T = {pivot, q, shift}: 世界点 p → pivot + q*(p - pivot) + shift（anim.js の applyT）
//   手に付く部品（スティック・マレット・シンバルの板）は手のボーンに付いているので、手の姿勢にそのままついてくる。
//   部品がある楽器は、部品ごとの変換を opt.parts に渡して握りの位置・向きを決める。
// 座標は構えたときの体の座標系（足の裏 y=0、+Z が前、左 = +X）。右手側は -X。
const {V, Q} = require('./math');
const A = require('./anim');

const nrm = V.norm;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sideOf = key => (key === 'L' ? 1 : -1);
const other = key => (key === 'L' ? 'R' : 'L');
const Tof = (pin, q, target) => ({pivot: pin, q, shift: V.sub(target, pin)});
const Id = Q.id();

// 腕を下ろしたときの手の位置（握りの軸上の点 G をここへ置く）
const HANG = {R: [-0.25, 0.80, 0.07], L: [0.25, 0.80, 0.07]};
// 下ろした手で棒状のものを握る形: 指は前（やや下）、手のひらは体の内側
const hangGrip = key => ({fd: nrm([0, -0.35, 1]), pn: [-sideOf(key), 0, 0], pole: [sideOf(key) * 0.45, -1, -0.45]});

const centroid = ps => ps.reduce((a, p) => V.add(a, V.mul(p, 1 / ps.length)), [0, 0, 0]);
const maxBy = (pts, f) => pts.reduce((m, p) => Math.max(m, f(p)), -1e9);
const minBy = (pts, f) => pts.reduce((m, p) => Math.min(m, f(p)), 1e9);

// ---- 楽器ごとの設定 ----
// fam: 'long' 細長い楽器（ax = 吹き口 → 先端の向き。bellUp なら正面・斜めで先端（ベル）を上にする）
//      'compact' 軸を持たない・まとまった楽器（回転は rot で指定）
//      'keep' 体に載せて抱える楽器（楽器は動かさず、腕だけ変える）
//      'parts' 手に持つ部品（スティック・板）がある楽器
const CFG = {
  trumpet: {fam: 'long', ax: [0, 0, 1], bellUp: true},
  mellophone: {fam: 'long', ax: [0, 0, 1], bellUp: true},
  marching_horn: {fam: 'long', ax: [0, 0, 1], bellUp: true},
  trombone: {fam: 'long', ax: [0, 0, 1], bellUp: false, grip: {L: 'R', R: 'R'}},
  piccolo: {fam: 'long', bellUp: false},
  flute: {fam: 'long', bellUp: false},
  oboe: {fam: 'long', bellUp: false},
  eb_clarinet: {fam: 'long', bellUp: false},
  clarinet: {fam: 'long', bellUp: false},
  alto_clarinet: {fam: 'long', bellUp: false},
  bass_clarinet: {fam: 'long', bellUp: false},
  soprano_sax: {fam: 'long', bellUp: false},
  bassoon: {fam: 'long', bellUp: true, carryUp: true, front: {top: 1.42}, diag: {top: 1.46}, tilt: 0.45},
  alto_sax: {fam: 'compact', rot: {front: Id, diag: Q.axis([0, 0, 1], -0.62)}, front: {top: 1.36}, diag: {top: 1.40}},
  tenor_sax: {fam: 'compact', rot: {front: Id, diag: Q.axis([0, 0, 1], -0.62)}, front: {top: 1.34}, diag: {top: 1.40}},
  baritone_sax: {fam: 'compact', rot: {front: Id, diag: Q.axis([0, 0, 1], -0.55)}, front: {top: 1.34}, diag: {top: 1.40}, hand: {x: 0.27}},
  horn: {fam: 'compact', rot: {front: Id, diag: Q.axis([0, 0, 1], 0.5)}, front: {top: 1.36}, diag: {top: 1.42}},
  euphonium: {fam: 'compact', rot: {front: Q.axis([1, 0, 0], 0.7), diag: Q.axis([0, 0, 1], -0.5)}, front: {top: 1.42}, diag: {top: 1.50}, hand: {x: 0.40, z: 0.14, y: 0.90}, pin: {R: [0, 1.36, 0.30], L: [0, 1.36, 0.30]}},
  tuba: {fam: 'compact', rot: {front: Q.axis([1, 0, 0], 0.8), diag: Q.axis([0, 0, 1], -0.5)}, front: {top: 1.50}, diag: {top: 1.56}, hand: {x: 0.44, z: 0.14, y: 0.88}, pin: {R: [0, 1.45, 0.34], L: [0, 1.45, 0.34]}},
  marching_euphonium: {fam: 'long', ax: [0, 0, 1], bellUp: true, front: {top: 1.30}, diag: {top: 1.36}, hang: {x: 0.30, y: 0.84, z: 0.10}},
  marching_tuba: {fam: 'long', ax: [0, 0, 1], bellUp: true, zs: [0.36, 0.30, 0.42, 0.24], front: {top: 1.46}, diag: {top: 1.62}, hang: {x: 0.34, y: 0.84, z: 0.12}},
  sousaphone: {fam: 'sousa'},
};


// 両手で体の前に持つ: 最も高い点が top になるよう置き、両手の握りに腕が届かなければ少しずつ上げる（届く最初の高さ）
function twoHand(spec, pts, q, top, arm, o = {}) {
  const gs = ['L', 'R'].filter(k => spec[k]).map(k => spec[k].G), piv = centroid(gs);
  const rp = pts.map(p => V.add(piv, Q.rot(q, V.sub(p, piv)))), my = maxBy(rp, p => p[1]);
  let best = null;
  for (let dt = 0; dt <= 0.5; dt += 0.02) {
    for (const zc of o.zs || [0.27, 0.23, 0.31]) {
      const Tm = {pivot: piv, q, shift: [-piv[0] + (o.x || 0), top + dt - my, zc - piv[2]]};
      const r = arm(spec, Tm);
      if (!best || r.short + dt * 0.02 < best.r.short + best.dt * 0.02 - 1e-9) best = {r, dt, zc};
      if (r.short < 0.004) return {r, dt, zc};
    }
  }
  return best;
}

// ---- 細長い楽器 ----
function longStyles(kind, spec, cfg, pts, arm) {
  const ax = nrm(cfg.ax || spec.ax), out = {}, log = [];
  const up = !!cfg.bellUp;
  // 片手で下げる: 先端を下に向け、手の位置に握りの点を置く。床に着かない最小の傾きを探す
  for (const key of ['R', 'L']) {
    const pinKey = (cfg.grip && cfg.grip[key]) || key, pin = spec[pinKey].G;
    let best = null;
    for (let tilt = cfg.tilt || 0.25; tilt < 1.3; tilt += 0.08) {
      // 先端を下へ（bassoon のように上向きに持つ楽器は上へ）。傾きは前へ倒す
      const dir = nrm(cfg.carryUp ? [0, Math.cos(tilt), Math.sin(tilt)] : [0, -Math.cos(tilt), Math.sin(tilt)]);
      const hg = cfg.hang ? [sideOf(key) * cfg.hang.x, cfg.hang.y, cfg.hang.z] : HANG[key];
      const Tm = Tof(pin, Q.arc(ax, dir), hg);
      const mn = minBy(pts, p => A.applyT(Tm, p)[1]);
      if (mn >= 0.05 || tilt > 1.2) { best = {Tm, mn}; break; }
    }
    const r = arm(spec, best.Tm, [other(key)], {}, {grip: {[key]: hangGrip(key)}, G: {[key]: pin}});
    out[key === 'R' ? 'right' : 'left'] = r;
    log.push(`${key} short ${r.short.toFixed(3)} minY ${best.mn.toFixed(2)}`);
  }
  // 両手で体の前に: front は縦、diag は右下 → 左上へ斜め
  for (const [name, dirBase, top] of [['front', up ? [0, 1, 0.12] : [0, -1, 0.12], (cfg.front && cfg.front.top) || 1.36], ['diag', up ? [0.55, 0.75, 0.3] : [-0.55, -0.75, 0.3], (cfg.diag && cfg.diag.top) || 1.40]]) {
    const q = Q.arc(ax, nrm(dirBase)), b = twoHand(spec, pts, q, top, arm, {x: cfg.x, zs: cfg.zs});
    out[name] = b.r;
    log.push(`${name} short ${b.r.short.toFixed(3)} (+${b.dt.toFixed(2)} z ${b.zc})`);
  }
  return {out, log};
}

// ---- まとまった（軸の無い）楽器: サックス・ホルン・ユーフォニアム・チューバ ----
function compactStyles(kind, spec, cfg, pts, arm) {
  const out = {}, log = [], h = cfg.hand || {};
  for (const key of ['R', 'L']) {
    const pin = (cfg.pin && cfg.pin[key]) || spec[key].G, s = sideOf(key);
    // 下げる: 向きは変えず、握りの点を手の位置へ（大きい楽器は体から離して脇に抱える）
    const tgt = [s * (h.x || 0.25), h.y || 0.80, h.z === undefined ? 0.07 : h.z];
    const Tm = Tof(pin, Id, tgt);
    const r = arm(spec, Tm, [other(key)], {}, {grip: {[key]: hangGrip(key)}, G: {[key]: pin}});
    out[key === 'R' ? 'right' : 'left'] = r;
    log.push(`${key} short ${r.short.toFixed(3)}`);
  }
  for (const name of ['front', 'diag']) {
    const b = twoHand(spec, pts, cfg.rot[name], cfg[name].top, arm);
    out[name] = b.r;
    log.push(`${name} short ${b.r.short.toFixed(3)} (+${b.dt.toFixed(2)} z ${b.zc})`);
  }
  return {out, log};
}

// ---- 体に載せて抱える楽器: 楽器はそのまま、腕だけ変える ----
function keepStyles(kind, spec, cfg, pts, arm) {
  const out = {right: arm(spec, null, ['L']), left: arm(spec, null, ['R']), front: arm(spec, null), diag: arm(spec, null, ['L', 'R'])};
  return {out, log: []};
}

// ---- スーザフォン: 体に掛けたまま。吹き口だけ口から離す（楽器全体を少し前へ倒す）。右手はバルブから離して楽器の上に添える ----
function sousaStyles(kind, spec, cfg, pts, arm) {
  const piv = [0, 1.2, -0.05], mp = [0, 1.512, 0.135];
  let T = null, best = null;
  for (let a = 0.2; a < 0.9; a += 0.05) {
    const t = {pivot: piv, q: Q.axis([1, 0, 0], a), shift: [0, 0, 0.02]};
    const m = A.applyT(t, mp), d = Math.hypot(m[1] - mp[1], m[2] - mp[2]);
    if (d >= 0.13) { T = t; best = d; break; }
  }
  const g = {R: cfg.restR || [-0.20, 1.02, 0.40]};
  const r = arm(spec, T, [], {}, {G: {R: g.R}, grip: {R: {fd: nrm([0, -0.2, 1]), pn: [0, 1, 0], pole: [-0.6, -1, 0.2]}}});
  const out = {right: r, left: r, front: r, diag: r};
  return {out, log: [`sousa short ${r.short.toFixed(3)} mouthpiece moved ${best && best.toFixed(3)}`]};
}

// ---- スティック・マレットの向きを決める変換 ----
// 部品の頂点 pp、握りの点 G、世界での手の位置 hand、先端の向き dir。先端 = 握りから見て指の向き fd へ最も遠い点
function stickDir(pp, G, fd) {
  let best = null, bd = -1e9;
  for (const p of pp) { const d = V.dot(V.sub(p, G), nrm(fd)); if (d > bd) { bd = d; best = p; } }
  return nrm(V.sub(best, G));
}
const stickT = (G, sd, hand, dir) => Tof(G, Q.arc(sd, nrm(dir)), hand);

// ---- 打楽器（スティック・マレット）----
// スティックは手の部品。腕を下ろせば先は下を向き（指の向き）、前・斜めでは手の位置と先の向きを決める
function stickStyles(kind, spec, cfg, parts, arm) {
  const out = {}, log = [];
  const g = {R: spec.R.G, L: spec.L.G};
  const sd = {R: stickDir(parts.R, g.R, spec.R.fd), L: stickDir(parts.L, g.L, spec.L.fd)};
  // 両腕を下ろす（右・左どちらも）
  const down = arm(spec, null, ['L', 'R']);
  out.right = down; out.left = down;
  const hy = cfg.hy || 1.18, hz = cfg.hz || 0.24, hx = cfg.hx || 0.10;
  // 正面: スティックを2本そろえて前に立てる
  {
    const TR = stickT(g.R, sd.R, [-hx * 0.6, hy, hz], [-0.02, 1, 0.45]), TL = stickT(g.L, sd.L, [hx * 0.6, hy, hz], [0.02, 1, 0.45]);
    const r = arm(spec, null, [], {}, {parts: {R: TR, L: TL}});
    out.front = r; log.push(`front short ${r.short.toFixed(3)}`);
  }
  // 斜め: スティックを体の前で交差させる（右手は右下から左上へ、左手は左下から右上へ）
  {
    const TR = stickT(g.R, sd.R, [-hx, hy - 0.05, hz], [0.75, 0.5, 0.55]), TL = stickT(g.L, sd.L, [hx, hy - 0.05, hz], [-0.75, 0.5, 0.55]);
    const r = arm(spec, null, [], {}, {parts: {R: TR, L: TL}});
    out.diag = r; log.push(`diag short ${r.short.toFixed(3)}`);
  }
  return {out, log};
}

// ---- バスドラム: 胴は前に付いたまま。マレットを両脇に下ろす / 立てる / 交差させる ----
function bassStyles(kind, spec, cfg, parts, arm) {
  const out = {}, log = [];
  const g = {R: spec.R.G, L: spec.L.G};
  const sd = {R: stickDir(parts.R, g.R, spec.R.fd), L: stickDir(parts.L, g.L, spec.L.fd)};
  const down = arm(spec, null, ['L', 'R']);
  out.right = down; out.left = down;
  const R = cfg.R;
  // 正面: マレットを胴の脇で立てる
  {
    const TR = stickT(g.R, sd.R, [g.R[0], g.R[1] + 0.02, g.R[2]], [0.1, 1, 0.25]), TL = stickT(g.L, sd.L, [g.L[0], g.L[1] + 0.02, g.L[2]], [-0.1, 1, 0.25]);
    const r = arm(spec, null, [], {}, {parts: {R: TR, L: TL}});
    out.front = r; log.push(`front short ${r.short.toFixed(3)}`);
  }
  // 斜め: 胴の上の前でマレットを交差
  {
    const y = 0.66 + 2 * R + 0.10;
    const TR = stickT(g.R, sd.R, [-0.09, y, 0.36], [0.8, 0.35, 0.6]), TL = stickT(g.L, sd.L, [0.09, y, 0.36], [-0.8, 0.35, 0.6]);
    const r = arm(spec, null, [], {}, {parts: {R: TR, L: TL}});
    out.diag = r; log.push(`diag short ${r.short.toFixed(3)}`);
  }
  return {out, log};
}

// ---- シンバル: 板は手の部品。右・左 = 両手を下ろす、正面 = 板を合わせて胸の前、斜め = 合わせて斜め ----
function cymbalStyles(kind, spec, cfg, parts, arm) {
  const out = {}, log = [];
  const down = arm(spec, null, ['L', 'R']);
  out.right = down; out.left = down;
  const cy = cfg.cy || 1.18, cz = cfg.cz || 0.30;
  for (const [name, q] of [['front', Id], ['diag', Q.mul(Q.axis([0, 1, 0], 0.5), Q.axis([0, 0, 1], -0.55))]]) {
    const Ts = {};
    for (const key of ['L', 'R']) {
      const s = sideOf(key), c = V.add(spec[key].G, [-s * 0.046, 0, 0]);          // 板の中心
      const d = [-c[0] + s * 0.012, cy - c[1], cz - c[2]];                         // 板を中央へ寄せる
      const C = [0, cy, cz];
      Ts[key] = {pivot: V.sub(C, d), q, shift: d};
    }
    const r = arm(spec, null, [], {}, {parts: Ts});
    out[name] = r; log.push(`${name} short ${r.short.toFixed(3)}`);
  }
  return {out, log};
}

// ---- グロッケン: 左手でリラ（本体）の柄を持ち、右手にマレット ----
function glockStyles(kind, spec, cfg, pts, parts, arm) {
  const out = {}, log = [];
  const gL = spec.L.G, gR = spec.R.G, sdR = stickDir(parts.R, gR, spec.R.fd);
  const upL = nrm([0, 1, 0.58]);
  for (const key of ['R', 'L']) {
    const s = sideOf(key), tgt = HANG[key];
    const Tm = Tof(gL, Q.arc(upL, nrm([0, 1, 0.12])), tgt);
    if (key === 'L') {
      // 左手でリラ、右手は下ろす（マレットは指の向き）
      out.left = arm(spec, Tm, ['R'], {}, {grip: {L: hangGrip('L')}});
    } else {
      // 右手でリラとマレットを一緒に
      out.right = arm(spec, Tm, ['L'], {}, {grip: {R: hangGrip('R')}, G: {R: gL}});
    }
    void s;
  }
  // 正面: リラを胸の前に立て、右手のマレットを横に立てる
  {
    const Tm = Tof(gL, Q.arc(upL, nrm([0, 1, 0.1])), [0.03, 1.0, 0.30]);
    const TR = stickT(gR, sdR, [-0.17, 1.13, 0.30], [0.02, 1, 0.2]);
    const r = arm(spec, Tm, [], {}, {parts: {R: TR}});
    out.front = r; log.push(`front short ${r.short.toFixed(3)}`);
  }
  // 斜め: リラを斜めに、マレットも斜めに
  {
    const Tm = Tof(gL, Q.arc(upL, nrm([0.55, 0.8, 0.25])), [0.03, 1.0, 0.30]);
    const TR = stickT(gR, sdR, [-0.14, 1.10, 0.30], [0.7, 0.7, 0.2]);
    const r = arm(spec, Tm, [], {}, {parts: {R: TR}});
    out.diag = r; log.push(`diag short ${r.short.toFixed(3)}`);
  }
  return {out, log};
}

// ---- シロフォン: 台は動かさない。マレットは stickStyles と同じ ----

// ---- 旗（ポール）----
function flagStyles(spec, G, arm, V_) {
  const out = {}, log = [];
  // 握りを高めに（ポールの下端が床に近くなるように）
  const hi = d => ({R: {...spec.R, G: V.add(spec.R.G, [0, d, 0])}, L: {...spec.L, G: V.add(spec.L.G, [0, d, 0])}});
  const hold = {fd: nrm([0, -0.2, 1]), pole: [0, -1, -0.45]};
  // 右手: ポールを右脇に垂直に立てて持つ（旗は外側へ）
  {
    const sp = {R: {...spec.R, G: V.add(spec.R.G, [0, 0.45, 0])}};
    const Tm = {pivot: sp.R.G, q: Id, shift: [0.04, -0.60, -0.08]};
    const r = arm(sp, Tm, [], {}, {grip: {R: {...hold, pn: [1, 0, 0]}}});
    out.right = r; log.push(`right short ${r.short.toFixed(3)}`);
  }
  // 左手: 旗が外（左）へ流れるよう、ポールのまわりに 180° 回して左脇に立てる
  {
    const sp = {L: {...spec.R, G: V.add(spec.R.G, [0, 0.45, 0])}};
    const Tm = {pivot: sp.L.G, q: Q.axis([0, 1, 0], Math.PI), shift: [0.56, -0.60, -0.08]};
    const r = arm(sp, Tm, [], {}, {grip: {L: {...hold, pn: [-1, 0, 0]}}});
    out.left = r; log.push(`left short ${r.short.toFixed(3)}`);
  }
  // 正面: 両手でポールを体の前に垂直に（右手は下、左手は上）
  {
    const sp = hi(0.50), piv = sp.R.G;
    const Tm = {pivot: piv, q: Id, shift: [0.30, -0.58, 0.10]};
    const r = arm(sp, Tm, [], {}, {grip: {R: {fd: nrm([0, 0, 1]), pn: [1, 0, 0], pole: [-0.5, -1, -0.4]}}});
    out.front = r; log.push(`front short ${r.short.toFixed(3)}`);
  }
  // 斜め: 両手でポールを斜めに（ポート）。右下 → 左上
  {
    const sp = hi(0.30), piv = sp.R.G, q = Q.axis([0, 0, 1], -0.62);
    const Tm = {pivot: piv, q, shift: [0.20, -0.35, 0.10]};
    const r = arm(sp, Tm, [], {}, {grip: {R: {fd: nrm([0, 0, 1]), pn: [1, 0, 0], pole: [-0.5, -1, -0.4]}}});
    out.diag = r; log.push(`diag short ${r.short.toFixed(3)}`);
  }
  return {out, log};
}

module.exports = {CFG, sousaStyles, longStyles, compactStyles, keepStyles, stickStyles, bassStyles, cymbalStyles, glockStyles, flagStyles, HANG, hangGrip};
