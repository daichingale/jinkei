// 縦分割（リール）レイアウトの部品（ブラウザ用。src/reel.rs と同じ式）。
//   jkReel.layout(H, n)                -> 4 段の [上端, 高さ] 配列（上の3D / 楽譜 / 客席側の3D / グリッド）。n = 楽譜の段数（省略時は表示中の段数。1 段 = 従来、2・3 段は楽譜の帯が高くなる）
//   jkReel.pickParts(D)                -> 重ねて出すパートの添字（楽器の種類ごとに最も人数の多いパート。スネア → テナー → バス → シンバル → その他の順で最大 3 段。種類が 1 つだけなら []）
//   jkReel.memberColor(D, i, illust)   -> 隊員 i の色（3D の袖・ピンで共通）
//   jkReel.drawGrid(g, W, H, D, t, il) -> 真上のグリッドに全員のピン（番号・色・向きの矢印）を描く（g は 2D コンテキスト）
//   jkReel.diag(D, t, aspect)          -> {eye, target, fov}  斜め俯瞰（隊形を追う）
//   jkReel.front(D, t, aspect)         -> {eye, target, fov}  客席側（中央ライン上・目線の高さ）
const jkReel = (function () {
  'use strict';
  const SLEEVE_PAL = ['#ff5a5f', '#ff9f1c', '#ffd23f', '#7bd62e', '#2ec4b6', '#3a8dff', '#8f5bff', '#ff5dc8', '#00b8d9', '#ef476f', '#06d6a0', '#f77f00'];

  // 楽譜の帯の高さ。段が増えるぶん、上の3D・客席側の3D から半分ずつ分ける（グリッドの高さは変えない）。src/reel.rs の Layout と同じ式
  function layout(H, n) {
    if (n === undefined) n = shown();
    const ev = (v) => Math.round(v) & ~1;
    const d = H - ev(H * 0.32) - ev(H * 0.135) - ev(H * 0.30);
    const extra = 0.0825 * (Math.max(1, n) - 1);
    const b = ev(H * (0.135 + extra)), c = ev(H * (0.30 - extra * 0.5)), a = H - b - c - d;
    return [[0, a], [a, b], [a + b, c], [a + b + c, d]];
  }
  // 楽器の種類ごとに最も人数の多いパートを選ぶ（同数なら先のもの）
  const KIND_ORDER = ['snare', 'tenor', 'bass', 'cymbal', 'line'];
  function pickParts(D) {
    const best = {};
    (D.parts || []).forEach((p, i) => {
      if (!p.notes || !p.notes.length || p.stack) return;
      const k = typeof jkStaff !== 'undefined' ? jkStaff.instOf(D, p) : 'line';
      if (!(k in best) || p.members.length > D.parts[best[k]].members.length) best[k] = i;
    });
    const out = KIND_ORDER.filter((k) => k in best).map((k) => best[k]).slice(0, 3);
    return out.length >= 2 ? out : [];
  }
  // 今の表示が「全パートを重ねる」なら、その段数（プレビューのパート選択が重ね表示のとき）
  function shownStack() {
    if (typeof D === 'undefined' || !D || !D.parts || typeof document === 'undefined') return null;
    const sel = document.getElementById('partsel'), p = D.parts[(sel && +sel.value) || 0];
    return p && p.stack ? p.stack : null;
  }
  function shown() { const s = shownStack(); return s ? s.length : 1; }

  function memberColor(D, i, ill) {
    const sec = D.sections[D.performers[i].sec];
    return (!ill || sec.color_given) ? sec.color : SLEEVE_PAL[i % SLEEVE_PAL.length];
  }
  function number(D, i) {
    const m = /(\d+)$/.exec(D.performers[i].id);
    return m ? m[1] : String(i + 1);
  }
  function lum(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  }

  // ---- グリッド ----
  function spec(F, pw, ph) {
    if (F.type === 'gym') return {view: [-F.w / 2 - 1.5, F.w / 2 + 1.5, -F.d / 2 - 1.5, F.d / 2 + 1.5], out: [-F.w / 2, F.w / 2, -F.d / 2, F.d / 2], center: [0, 0], minor: 1, major: 5, hashes: [], base: 0};
    if (F.type === 'floor') return {view: [-F.w / 2 - 1.5, F.w / 2 + 1.5, -1.5, F.d + 1.5], out: [-F.w / 2, F.w / 2, 0, F.d], center: [0, F.d / 2], minor: 1, major: 5, hashes: [], base: F.d / 2};
    if (F.type === 'stage') { const ww = F.w / 2 + F.wing; return {view: [-ww - 1, ww + 1, -1.5, F.d + 1.5], out: [-F.w / 2, F.w / 2, 0, F.d], wings: [-ww, ww, 0, F.d], center: [0, F.d / 2], minor: 1, major: 5, hashes: [], base: F.d / 2}; }
    const scale = Math.min(pw / 166, ph / (F.bsl + 6));
    return {view: [-83, 83, -3, F.bsl + 3], out: [-80, 80, 0, F.bsl], center: [0, F.bsl / 2], minor: scale < 6 ? 4 : 2, major: 8, hashes: [F.hash, F.bsl - F.hash], base: 0};
  }
  const BG = '#111318', MINOR = '#2e323c', MAJOR = '#545a68', AXIS = '#969dac';
  let cache = null;
  function mapOf(F, W, H, view) {
    const sp = spec(F, W, H); if (view) sp.view = view;
    const [vx0, vx1, vy0, vy1] = sp.view;
    const scale = Math.min(W / (vx1 - vx0), H / (vy1 - vy0)), vcx = (vx0 + vx1) / 2, vcy = (vy0 + vy1) / 2;
    return {sp, scale, px: (x, y) => [W / 2 + (x - vcx) * scale, H / 2 - (y - vcy) * scale], vcx, vcy};
  }
  // 俯瞰図は「全体を固定」「現在の隊形を追従」から選択。追従は前後4カウントの位置を
  // 合成することで、セット切り替え時に画角が急変するのを防ぐ。
  function viewOf(D, t, opts = {}) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const absorb = p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
    if (opts.mode === 'follow') {
      for (let k = -8; k <= 8; k++) {
        const tt = Math.min(D.total, Math.max(0, t + k * .5));
        for (let i = 0; i < D.performers.length; i++) absorb(jkState(D, i, tt).p);
      }
    } else for (const s of D.sets) for (const p of s.pos) absorb(p);
    if (!Number.isFinite(x0)) return null;
    const zoom = Math.min(2.5, Math.max(.6, Number(opts.zoom) || 1));
    const mg = 2 / D.unit_m, mn = (opts.mode === 'follow' ? 7 : 10) / D.unit_m;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const hw = Math.max((x1 - x0) / 2 + mg, mn / 2) / zoom;
    const hh = Math.max((y1 - y0) / 2 + mg, mn / 2) / zoom;
    return [cx - hw, cx + hw, cy - hh, cy + hh];
  }
  function baseGrid(F, W, H, view) {
    const key = JSON.stringify(F) + W + 'x' + H + JSON.stringify(view);
    if (cache && cache.key === key) return cache;
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), {width: W, height: H});
    const g = cv.getContext('2d'), m = mapOf(F, W, H, view), sp = m.sp, scale = m.scale;
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    const lx0 = m.vcx - W / 2 / scale, lx1 = m.vcx + W / 2 / scale, ly0 = m.vcy - H / 2 / scale, ly1 = m.vcy + H / 2 / scale;
    const isMajor = (v, base) => Math.abs((v - base) / sp.major - Math.round((v - base) / sp.major)) < 1e-6;
    for (let x = Math.floor(lx0 / sp.minor) * sp.minor; x <= lx1; x += sp.minor) {
      const px = m.px(x, 0)[0]; g.fillStyle = isMajor(x, 0) ? MAJOR : MINOR; g.fillRect(px - 0.5, 0, 1, H);
    }
    for (let y = Math.floor((ly0 - sp.base) / sp.minor) * sp.minor + sp.base; y <= ly1; y += sp.minor) {
      const py = m.px(0, y)[1]; g.fillStyle = isMajor(y, sp.base) ? MAJOR : MINOR; g.fillRect(0, py - 0.5, W, 1);
    }
    const [ox0, ox1, oy0, oy1] = sp.out, a = m.px(ox0, oy1), b = m.px(ox1, oy0);
    const wi = sp.wings ? [m.px(sp.wings[0], sp.wings[3]), m.px(sp.wings[1], sp.wings[2])] : [a, b];
    g.fillStyle = 'rgba(17,19,24,.55)';
    g.fillRect(0, 0, W, wi[0][1]); g.fillRect(0, wi[1][1], W, H - wi[1][1]); g.fillRect(0, wi[0][1], wi[0][0], wi[1][1] - wi[0][1]); g.fillRect(wi[1][0], wi[0][1], W - wi[1][0], wi[1][1] - wi[0][1]);
    if (sp.wings) { g.fillStyle = 'rgba(17,19,24,.35)'; g.fillRect(wi[0][0], wi[0][1], a[0] - wi[0][0], wi[1][1] - wi[0][1]); g.fillRect(b[0], wi[0][1], wi[1][0] - b[0], wi[1][1] - wi[0][1]); }
    g.fillStyle = 'rgba(150,157,172,.55)';
    for (const hy of sp.hashes) { const py = m.px(0, hy)[1]; for (let x = a[0]; x < b[0]; x += 9) g.fillRect(x, py - 0.75, Math.min(5, b[0] - x), 1.5); }
    g.strokeStyle = 'rgba(150,157,172,.8)'; g.lineWidth = 1.6; g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    const [cx, cy] = m.px(sp.center[0], sp.center[1]);
    g.fillStyle = 'rgba(150,157,172,.95)'; g.fillRect(cx - 1, 0, 2, H); g.fillRect(0, cy - 1, W, 2);
    if (F.type !== 'football') {
      g.font = '700 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = AXIS;
      for (let v = sp.major; v < Math.max(Math.abs(lx1 - sp.center[0]), Math.abs(sp.center[0] - lx0)); v += sp.major) for (const s of [-1, 1]) {
        const xv = sp.center[0] + s * v, px = m.px(xv, 0)[0];
        if (px > 8 && px < W - 8 && xv > ox0 + 1e-6 && xv < ox1 - 1e-6) g.fillText(String(v), px, cy + 9);
      }
    }
    return cache = {key, cv, m};
  }
  function drawGrid(g, W, H, D, t, ill, opts = {}) {
    const bg = baseGrid(D.field, W, H, viewOf(D, t, opts)), m = bg.m;
    g.drawImage(bg.cv, 0, 0);
    const pinSize = Math.min(1.8, Math.max(.7, Number(opts.pinSize) || 1));
    const r = Math.min(32, Math.max(10, Math.min(19, Math.max(13, m.scale * 0.5)) * pinSize));
    const ps = D.performers.map((p, i) => {
      const st = jkState(D, i, t), [px, py] = m.px(st.p[0], st.p[1]);
      return {i, px, py, y: st.p[1], fa: jkFacing(st) * Math.PI / 180};
    }).sort((a, b) => b.y - a.y);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const q of ps) {
      const col = memberColor(D, q.i, ill), dx = Math.cos(q.fa), dy = -Math.sin(q.fa), nx = -dy, ny = dx, s0 = r + 1.5, s1 = r + 13;
      g.strokeStyle = '#ecedf4'; g.fillStyle = '#ecedf4'; g.lineWidth = 2.8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(q.px + dx * s0, q.py + dy * s0); g.lineTo(q.px + dx * s1, q.py + dy * s1); g.stroke();
      g.beginPath(); g.moveTo(q.px + dx * (s1 + 5), q.py + dy * (s1 + 5)); g.lineTo(q.px + dx * s1 + nx * 5.2, q.py + dy * s1 + ny * 5.2); g.lineTo(q.px + dx * s1 - nx * 5.2, q.py + dy * s1 - ny * 5.2); g.closePath(); g.fill();
      g.fillStyle = '#080a0c'; g.beginPath(); g.arc(q.px, q.py, r + 1.6, 0, 7); g.fill();
      g.fillStyle = col; g.beginPath(); g.arc(q.px, q.py, r, 0, 7); g.fill();
      const num = number(D, q.i);
      g.fillStyle = lum(col) > 0.58 ? '#101216' : '#ffffff';
      g.font = `700 ${Math.round(num.length > 1 ? r * 1.05 : r * 1.25)}px Helvetica,Arial,sans-serif`;
      g.fillText(num, q.px, q.py + 0.5);
    }
  }

  // ---- カメラ ----
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // 前後 2 カウントぶんの全員の位置（ワールド座標 x, z）。カメラがなめらかに動くよう、窓の和をとる
  function formPts(D, t) {
    const U = D.unit_m, pts = [];
    for (let k = -8; k <= 8; k++) {
      const tt = Math.min(D.total, Math.max(0, t + k * 0.5));
      for (let i = 0; i < D.performers.length; i++) { const p = jkState(D, i, tt).p; pts.push([p[0] * U, -p[1] * U]); }
    }
    return pts.length ? pts : [[0, 0]];
  }
  function diag(D, t, aspect, zoom = 1) {
    const pts = formPts(D, t), m = 0.5, az = 28 * Math.PI / 180, el = 31 * Math.PI / 180;
    const dir = [-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)], up = [0, 1, 0], fov = 38;
    const f = mul(dir, -1), r = norm(cross(f, up)), u = cross(r, f);
    const th = Math.tan(fov * Math.PI / 360), tw = th * aspect;
    const ps = [];
    for (const [x, z] of pts) for (const [dx, dz] of [[-m, -m], [m, -m], [-m, m], [m, m]]) { ps.push([x + dx, 0, z + dz]); ps.push([x + dx, 2.1, z + dz]); }
    const c0 = [0, 0.9, 0];
    let r0 = 1e9, r1 = -1e9, u0 = 1e9, u1 = -1e9;
    for (const p of ps) { const v = sub(p, c0), a = dot(v, r), b = dot(v, u); r0 = Math.min(r0, a); r1 = Math.max(r1, a); u0 = Math.min(u0, b); u1 = Math.max(u1, b); }
    const c = add(add(c0, mul(r, (r0 + r1) / 2)), mul(u, (u0 + u1) / 2));
    let d = 6;
    for (const p of ps) { const v = sub(p, c); d = Math.max(d, Math.max(Math.abs(dot(v, r)) / tw, Math.abs(dot(v, u)) / (th * 0.98)) - dot(v, f)); }
    const z = Math.min(1.6, Math.max(.65, Number(zoom) || 1));
    return {eye: add(c, mul(dir, d / z)), target: c, fov};
  }
  function front(D, t, aspect, zoom = 1) {
    const pts = formPts(D, t), fov = 50, tw = Math.tan(fov * Math.PI / 360) * aspect;
    const xs = pts.map(p => p[0]), xc = (Math.min(...xs) + Math.max(...xs)) / 2;
    let zc = -Infinity, zf = -Infinity, zb = Infinity;
    for (const [x, z] of pts) {
      zc = Math.max(zc, z + (Math.abs(x - xc) + 0.8) / (tw * 0.9));
      zf = Math.max(zf, z); zb = Math.min(zb, z);
    }
    zc = Math.max(zc, zf + 2.5);
    const z = Math.min(1.6, Math.max(.65, Number(zoom) || 1));
    const target = [xc, 0.9, (zf + zb) / 2];
    return {eye: [xc, 1.6, target[2] + (zc - target[2]) / z], target, fov};
  }
  // jkStaff に、重ね表示のパート（part.stack = 段になるパートの添字）を描かせる
  if (typeof jkStaff !== 'undefined') {
    const list = (part) => part.stack.map((i) => ({part: D.parts[i], inst: jkStaff.instOf(D, D.parts[i])}));
    jkStaff.stackHook = (part, from, to, W, H, ph, o) => (part.stack ? jkStaff.stack(list(part), W, H, ph !== null && ph !== undefined ? ph : from, o) : null);
    jkStaff.stackGeomHook = (part, W, H, o) => {
      const l = list(part), hs = H / l.length;
      let x0 = 0, g0 = null;
      for (const e of l) { const g = jkStaff.geom(e.part, W, hs, {...o, inst: e.inst}); x0 = Math.max(x0, g.x0); g0 = g0 || g; }
      return {sp: g0.sp, x0, x1: g0.x1};
    };
  }
  return {layout, memberColor, drawGrid, diag, front, number, viewOf, pickParts};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = {jkReel};
