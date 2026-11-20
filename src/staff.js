// 1線の打楽器譜を SVG 文字列にする（エディタの楽譜タブと、動画の楽譜ストリップで共用）。
// 音符・旗・休符・アクセント・拍子の記号は Bravura（SMuFL, SIL OFL 1.1）。フォントは src/bravura.js の Base64。
//   jkStaff(part, fromCount, toCount, width, height, playheadCount, opts) -> SVG 文字列
//     part: D.parts[i]（{meter:[n,d], start, end, bars:[], notes:[[t,dur,'R',accent,kind,pad], ...]}）
//     表示範囲 [fromCount, toCount) を width×height に時間比例で並べる。playheadCount が範囲外/null なら再生位置の線は出さない。
//     opts: {fg, mu, hi, header(false で音部記号と拍子を省く), bg,
//            paged(true: 縦分割レイアウト用。範囲の頭より前の音符は出さず、頭に前打音の余白をとる), noPlayhead(true で再生位置の線を省く)}
//   jkStaff.page(part, t) -> [from, to]（縦分割レイアウト用: 再生位置の小節を含む 2 小節）
//   jkStaff.geom(part, W, H, opts) -> {sp, x0, x1}（時間 → x の配置。X(t) = x0 + (t-from)/(to-from)*(x1-x0)）
//   jkStaffFontCss() -> @font-face の CSS（SVG を単体で使うときは <style> に入れる）
//   jkStaffInstall() -> document に1回だけ @font-face を入れる
//   jkStaffLayout(part) -> {end}（全体の長さなど）
const jkStaff = (function () {
  'use strict';
  const G = {head: '', half: '', whole: '', cross: '', f1: '', f2: '', f3: '',
    rW: '', rH: '', rQ: '', r8: '', r16: '', r32: '', acc: '', mar: '', dot: ''};
  const digit = (d) => String.fromCharCode(0xE080 + d);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const f2 = (v) => (Math.round(v * 100) / 100).toString();

  function install() {
    if (typeof document === 'undefined' || document.getElementById('jk-bravura')) return;
    const st = document.createElement('style');
    st.id = 'jk-bravura';
    st.textContent = fontCss();
    document.head.appendChild(st);
  }
  function fontCss() {
    return typeof JK_BRAVURA_B64 === 'undefined' ? '' : `@font-face{font-family:"Bravura";src:url(data:font/woff2;base64,${JK_BRAVURA_B64}) format("woff2")}`;
  }

  // 休符に使える長さ（カウント）と記号
  const RESTS = [[4, G.rW], [2, G.rH], [1, G.rQ], [2 / 3, G.rQ], [0.5, G.r8], [1 / 3, G.r8], [0.25, G.r16], [1 / 6, G.r16], [0.125, G.r32]];
  // JSON の数は小数3桁に丸められているので、少しゆるく比べる
const EPS = 3e-3;
const isPow2 = (x) => x > 0 && Math.abs(x / Math.pow(2, Math.round(Math.log2(x))) - 1) < 0.006;
  const isTrip = (d) => d > 0.01 && !isPow2(d) && isPow2(d * 3);
  const flagsOf = (d) => (d >= 1 - EPS ? 0 : d > 0.25 + EPS ? 1 : d > 0.125 + EPS ? 2 : 3);
  const dotted = (d) => [0.75, 1.5, 3, 0.375, 6].some((x) => Math.abs(d - x) < 1e-6);

  function geom(part, W, H, o) {
    o = o || {};
    const sp = H / 11, meter = part.meter || [4, 4];
    const x0 = o.header !== false ? sp * (2.6 + 1.9 * Math.max(String(meter[0]).length, String(meter[1]).length) + (o.paged ? 2.2 : 0.8)) : sp * 0.8;
    return {sp, x0, x1: W - sp * 1.2};
  }
  // 縦分割レイアウト: 再生位置を含む 2 小節
  function page(part, t) {
    const bl = Math.max(1, (part.meter || [4, 4])[0]), bars = part.bars || [];
    if (!bars.length) { const a = (part.start || 0) + Math.floor(Math.max(0, t - (part.start || 0)) / (2 * bl)) * 2 * bl; return [a, a + 2 * bl]; }
    let bi = 0;
    bars.forEach((b, i) => { if (b <= t + 1e-6) bi = i; });
    const pi = bi - bi % 2;
    return [bars[pi], pi + 2 < bars.length ? bars[pi + 2] : bars[pi] + 2 * bl];
  }

  function staff(part, from, to, W, H, ph, o) {
    o = o || {};
    install();
    const fg = o.fg || '#e8e9ec', mu = o.mu || '#8a909c', hi = o.hi || '#ffd23f';
    const lineY = 7 * (H / 11), fs = 4 * (H / 11);
    const {sp, x0, x1} = geom(part, W, H, o);
    const meter = part.meter || [4, 4];
    const header = o.header !== false;
    const X = (t) => x0 + (t - from) / (to - from) * (x1 - x0);
    const out = [];
    const txt = (x, y, s, size, fill, extra) => out.push(`<text x="${f2(x)}" y="${f2(y)}" font-size="${f2(size)}" fill="${fill}" text-anchor="middle" ${extra || ''}>${s}</text>`);
    const glyph = (x, y, ch, fill, size) => out.push(`<text x="${f2(x)}" y="${f2(y)}" font-family="Bravura" font-size="${f2(size || fs)}" fill="${fill}" text-anchor="middle">${ch}</text>`);
    const line = (x1_, y1, x2, y2, w, c) => out.push(`<line x1="${f2(x1_)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${c}" stroke-width="${f2(w)}"/>`);

    out.push(`<line x1="0" y1="${f2(lineY)}" x2="${W}" y2="${f2(lineY)}" stroke="${fg}" stroke-width="${f2(sp * 0.13)}"/>`);
    if (header) {
      // 打楽器記号（太い2本の縦線）と拍子
      out.push(`<rect x="${f2(sp * 0.6)}" y="${f2(lineY - sp)}" width="${f2(sp * 0.4)}" height="${f2(sp * 2)}" fill="${fg}"/>`);
      out.push(`<rect x="${f2(sp * 1.3)}" y="${f2(lineY - sp)}" width="${f2(sp * 0.4)}" height="${f2(sp * 2)}" fill="${fg}"/>`);
      const dig = (n) => String(n).split('').map((c) => digit(+c)).join('');
      const cx = sp * (2.6 + 0.95 * Math.max(String(meter[0]).length, String(meter[1]).length));
      glyph(cx, lineY - sp, dig(meter[0]), fg);
      glyph(cx, lineY + sp, dig(meter[1]), fg);
    }
    const sorted = (part.notes || []).slice().sort((a, b) => a[0] - b[0]);
    const barsAll = (part.bars || []).slice();
    const barOf = (t) => { let b = part.start || 0; for (const x of barsAll) if (x <= t + EPS) b = x; return b; };
    // 小節線・終止線
    for (const b of barsAll) if (b > from + 1e-6 && b < to) line(X(b), lineY - sp * 2, X(b), lineY + sp * 2, sp * 0.13, fg);
    if (part.end > from && part.end <= to + 1e-6) {
      line(X(part.end) - sp * 0.5, lineY - sp * 2, X(part.end) - sp * 0.5, lineY + sp * 2, sp * 0.13, fg);
      line(X(part.end), lineY - sp * 2, X(part.end), lineY + sp * 2, sp * 0.45, fg);
    }
    // 休符（音符どうしのすき間）
    const win = (meter[1] === 8 && meter[0] % 3 === 0) ? 3 : 1;
    let cursor = part.start || 0;
    const restAt = (t, len) => {
      let left = len;
      let tt = t;
      while (left > 0.1) {
        const r = RESTS.find((x) => x[0] <= left + 1e-6);
        if (!r) break;
        if (tt + r[0] > from && tt < to) glyph(X(tt + Math.min(r[0], 1) / 2), lineY, r[1], mu, fs * 0.9);
        tt += r[0]; left -= r[0];
      }
    };
    for (const n of sorted) { if (n[0] - cursor > 0.1) restAt(cursor, n[0] - cursor); cursor = Math.max(cursor, n[0] + n[1]); }
    if (part.end - cursor > 0.1 && sorted.length) restAt(cursor, part.end - cursor);
    // 音符
    const items = [];
    for (const n of sorted) {
      if ((o.paged ? n[0] < from - 1e-6 : n[0] + n[1] < from - 1e-6) || n[0] > to) continue;
      const d = n[1];
      items.push({t: n[0], d, hand: n[2], acc: n[3], kind: n[4], pad: n[5] || 0, x: X(n[0]), f: d >= 2 - 1e-6 ? 0 : flagsOf(d), stem: d < 4 - 1e-6});
    }
    const stemTop = lineY - sp * 3.6;
    const hw = sp * 0.59;
    // 連桁
    const groups = [];
    let run = [];
    const flush = () => { if (run.length) groups.push(run); run = []; };
    items.forEach((it, i) => {
      const prev = items[i - 1];
      const gid = Math.floor((it.t - barOf(it.t)) / win + EPS);
      const ok = it.f > 0 && prev && run.length && prev.f > 0 && Math.abs(prev.t + prev.d - it.t) < EPS && prev.gid === gid;
      it.gid = gid;
      if (!ok) flush();
      if (it.f > 0) run.push(it); else flush();
    });
    flush();
    const beamed = new Set();
    const bw = sp * 0.5;
    for (const g of groups) {
      if (g.length < 2) continue;
      g.forEach((it) => beamed.add(it));
      for (let lv = 1; lv <= 3; lv++) {
        const y = stemTop + (lv - 1) * sp * 0.75 + bw / 2;
        let i = 0;
        while (i < g.length) {
          if (g[i].f < lv) { i++; continue; }
          let j = i;
          while (j + 1 < g.length && g[j + 1].f >= lv) j++;
          const xa = g[i].x + hw, xb = g[j].x + hw;
          if (j > i) line(xa - sp * 0.06, y, xb + sp * 0.06, y, bw, fg);
          else if (lv > 1) {
            // 1つだけ深い連桁は短い枝にする
            if (i < g.length - 1 || g.length < 2) line(xa, y, xa + sp * 1.3, y, bw, fg);
            else line(xa - sp * 1.3, y, xa, y, bw, fg);
          }
          i = j + 1;
        }
      }
    }
    // 3連符の数字
    const trip = new Map();
    for (const it of items) {
      if (!isTrip(it.d)) continue;
      const key = Math.floor((it.t - barOf(it.t)) / (it.d * 3) + EPS) + ':' + f2(it.d * 1000) + ':' + barOf(it.t);
      const e = trip.get(key) || {a: it.x, b: it.x};
      e.a = Math.min(e.a, it.x); e.b = Math.max(e.b, it.x);
      trip.set(key, e);
    }
    for (const e of trip.values()) txt((e.a + e.b) / 2 + hw, stemTop - sp * 0.7, '3', sp * 1.5, fg, 'font-style="italic" font-family="serif"');
    for (const it of items) {
      const x = it.x, loud = it.acc > 0;
      const head = it.kind === 'click' ? G.cross : it.d >= 4 - 1e-6 ? G.whole : it.d >= 2 - 1e-6 ? G.half : G.head;
      glyph(x, lineY, head, fg);
      if (it.stem) {
        line(x + hw, lineY - sp * 0.1, x + hw, stemTop, sp * 0.13, fg);
        if (it.f > 0 && !beamed.has(it)) glyph(x + hw + sp * 0.07, stemTop, it.f === 1 ? G.f1 : it.f === 2 ? G.f2 : G.f3, fg);
      }
      if (dotted(it.d)) glyph(x + sp * 1.2, lineY - sp * 0.5, G.dot, fg);
      // 装飾: フラム（小さな前打音）・ダブル・バズ（幹の斜線）
      if (it.kind === 'flam') {
        const gx = x - sp * 1.9;
        glyph(gx, lineY, G.head, fg, fs * 0.65);
        line(gx + hw * 0.65, lineY - sp * 0.1, gx + hw * 0.65, lineY - sp * 2.4, sp * 0.1, fg);
        line(gx - sp * 0.1, lineY - sp * 1.9, gx + sp * 0.9, lineY - sp * 2.5, sp * 0.1, fg);
      }
      if ((it.kind === 'diddle' || it.kind === 'buzz') && it.stem) {
        const n = it.kind === 'buzz' ? 3 : 2;
        for (let k = 0; k < n; k++) {
          const y = lineY - sp * (1.3 + k * 0.55);
          line(x + hw - sp * 0.6, y + sp * 0.35, x + hw + sp * 0.6, y - sp * 0.35, sp * 0.16, fg);
        }
      }
      if (loud) glyph(x + hw * 0.4, lineY - sp * (it.acc >= 2 ? 5.7 : 5.5), it.acc >= 2 ? G.mar : G.acc, hi, fs);
      // 手順（強いときは大文字、普通は小文字）
      const h = it.hand;
      const ch = loud ? h : h.toLowerCase();
      txt(x, lineY + sp * 3.2, ch, sp * 1.9, loud ? hi : fg, 'font-family="Helvetica,Arial,sans-serif" font-weight="700"');
      if (it.pad > 0) txt(x + sp * 1.0, lineY + sp * 3.8, String(it.pad), sp * 1.0, mu, 'font-family="Helvetica,Arial,sans-serif"');
    }
    if (!o.noPlayhead && ph !== null && ph !== undefined && ph >= from && ph <= to) line(X(ph), sp * 0.3, X(ph), H - sp * 0.3, sp * 0.22, hi);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${o.bg ? 'background:' + o.bg : ''}">${out.join('')}</svg>`;
  }
  staff.page = page;
  staff.geom = geom;
  staff.fontCss = fontCss;
  staff.install = install;
  return staff;
})();
const jkStaffFontCss = jkStaff.fontCss, jkStaffInstall = jkStaff.install;
if (typeof module !== 'undefined' && module.exports) module.exports = {jkStaff};
