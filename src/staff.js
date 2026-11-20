// 打楽器譜を SVG 文字列にする（エディタの楽譜タブ・プレビューの楽譜・動画の楽譜ストリップで共用）。
// 音符・旗・休符・アクセント・拍子の記号は Bravura（SMuFL, SIL OFL 1.1）。フォントは src/bravura.js の Base64。
//   jkStaff(part, fromCount, toCount, width, height, playheadCount, opts) -> SVG 文字列
//     part: D.parts[i]（{meter:[n,d], start, end, bars:[], notes:[[t,dur,'R',accent,kind,pad,vel], ...]}）
//     表示範囲 [fromCount, toCount) を width×height に時間比例で並べる。playheadCount が範囲外/null なら再生位置の線は出さない。
//     opts: {fg, mu, hi, header(false で音部記号と拍子を省く), bg,
//            inst: 'line' | 'snare' | 'tenor' | 'bass' | 'cymbal'（楽器。省略時は D があれば楽器から決める。snare/cymbal/line = 1線、tenor/bass = 5線）,
//            paged(true: 縦分割レイアウト用。範囲の頭より前の音符は出さず、頭に前打音の余白をとる), noPlayhead(true で再生位置の線を省く)}
//   jkStaff.page(part, t) -> [from, to]（縦分割レイアウト用: 再生位置の小節を含む 2 小節）
//   jkStaff.geom(part, W, H, opts) -> {sp, x0, x1}（時間 → x の配置。X(t) = x0 + (t-from)/(to-from)*(x1-x0)）
//   jkStaff.instOf(D, part) -> 'snare' | 'tenor' | 'bass' | 'cymbal' | 'line'（先頭メンバーの楽器から）
//   jkStaff.labelOf(inst, part) -> 段の左に出す名前（スネア / テナー / バス / シンバル / パート名）
//   jkStaff.stack([{part, inst}, ...], W, H, t, opts) -> 複数のパートを縦に重ねた SVG（リールの帯。段の左に楽器名）
//   jkStaffFontCss() -> @font-face の CSS（SVG を単体で使うときは <style> に入れる）
//   jkStaffInstall() -> document に1回だけ @font-face を入れる
//
// 記譜の約束（README の凡例も参照）
//   スネア・シンバル・その他 = 1線。テナー = 5線の「間」に ドラム1（いちばん上の間）〜ドラム4（いちばん下の間）、
//   スポック1・2 は五線の上の加線に × 形。バス = 5線の「線」に ドラム1（上の線）〜ドラム5（下の線）、
//   ドラム番号なし（全員で同時）は5本の線すべてに重ねた和音。和音は 1 本の符幹に符頭を重ねる（隣り合う符頭は左右にずらす）。
//   奏法: x = ×の符頭 / o リムショット = 符頭に斜線 / m ミュート = 斜線 + スタッカートの点 /
//         g ゴック = ▲の符頭 / s スクレイプ = 符頭 + 波線（音符の長さぶん）/ k スティッククリック = 丸で囲んだ×（ドラムの位置に関係なく中央）
//   強弱: pp p mp mf f ff は符頭の左上に斜体の文字。cresc / dim は < > の開き線。
const jkStaff = (function () {
  'use strict';
  const G = {head: '', half: '', whole: '', cross: '', f1: '', f2: '', f3: '',
    rW: '', rH: '', rQ: '', r8: '', r16: '', r32: '', acc: '', mar: '', dot: ''};
  const digit = (d) => String.fromCharCode(0xE080 + d);
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

  // 楽器 → 段の形。den = 段の高さが符頭の間隔 sp の何倍か、line = 中央の線の y（sp）、stem = 符幹の先（中央線から）、
  // acc = アクセント記号（中央線から）、hand = 手順の文字（中央線から）、lines = 5線か
  const CFG = {
    line: {den: 11, line: 7, stem: -3.6, acc: -5.5, mar: -5.7, hand: 3.2, pad: 3.8, five: false},
    five: {den: 13, line: 8.2, stem: -4.9, acc: -6.7, mar: -6.9, hand: 4.0, pad: 4.7, five: true},
  };
  const cfgOf = (inst) => (inst === 'tenor' || inst === 'bass' ? CFG.five : CFG.line);

  function instOf(D, part) {
    if (!D || !part || !part.members || !part.members.length || !D.performers) return 'line';
    const pf = D.performers[part.members[0]], sec = pf && D.sections && D.sections[pf.sec];
    const id = sec ? sec.instrument : '';
    if (id === 'snare') return 'snare';
    if (id === 'tenors') return 'tenor';
    if (/^bass([1-5]|_drum)$/.test(id)) return 'bass';
    if (id === 'cymbals_mid' || id === 'cymbals_high') return 'cymbal';
    return 'line';
  }
  const LABELS = {snare: 'スネア', tenor: 'テナー', bass: 'バス', cymbal: 'シンバル'};
  const labelOf = (inst, part) => LABELS[inst] || (part && part.name) || '';
  // 状態がなくても楽器を決められるように、グローバルの D（プレビューのページ）を見る
  const globalD = () => (typeof D !== 'undefined' ? D : null);
  const instFor = (part, o) => (o && o.inst) || instOf(globalD(), part);

  function geom(part, W, H, o) {
    o = o || {};
    if (part.stack && staff.stackGeomHook && !o.inStack) { const g = staff.stackGeomHook(part, W, H, o); if (g) return g; }
    const cfg = cfgOf(instFor(part, o)), sp = H / cfg.den, meter = part.meter || [4, 4];
    const x0 = o.x0 !== undefined ? o.x0 : o.header !== false ? sp * (2.6 + 1.9 * Math.max(String(meter[0]).length, String(meter[1]).length) + (o.paged ? 2.2 : 0.8)) : sp * 0.8;
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

  // 1つの段の中身（<svg> で包まない）
  function body(part, from, to, W, H, ph, o) {
    const inst = instFor(part, o), cfg = cfgOf(inst), five = cfg.five;
    const fg = o.fg || '#e8e9ec', mu = o.mu || '#8a909c', hi = o.hi || '#ffd23f';
    const {sp, x0, x1} = geom(part, W, H, o);
    const lineY = cfg.line * sp, fs = 4 * sp;
    const meter = part.meter || [4, 4];
    const header = o.header !== false;
    const X = (t) => x0 + (t - from) / (to - from) * (x1 - x0);
    const out = [];
    const txt = (x, y, s, size, fill, extra, anchor) => out.push(`<text x="${f2(x)}" y="${f2(y)}" font-size="${f2(size)}" fill="${fill}" text-anchor="${anchor || 'middle'}" ${extra || ''}>${s}</text>`);
    const glyph = (x, y, ch, fill, size) => out.push(`<text x="${f2(x)}" y="${f2(y)}" font-family="Bravura" font-size="${f2(size || fs)}" fill="${fill}" text-anchor="middle">${ch}</text>`);
    const line = (x1_, y1, x2, y2, w, c) => out.push(`<line x1="${f2(x1_)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${c}" stroke-width="${f2(w)}"/>`);
    const poly = (pts, w, c, fill) => out.push(`<polyline points="${pts.map((p) => f2(p[0]) + ',' + f2(p[1])).join(' ')}" fill="${fill || 'none'}" stroke="${c}" stroke-width="${f2(w)}" stroke-linejoin="round"/>`);
    const halfH = five ? 2 : 0;   // 五線の半分の高さ（sp）

    // 五線 / 1線
    if (five) for (let k = -2; k <= 2; k++) out.push(`<line x1="0" y1="${f2(lineY + k * sp)}" x2="${W}" y2="${f2(lineY + k * sp)}" stroke="${fg}" stroke-width="${f2(sp * 0.12)}"/>`);
    else out.push(`<line x1="0" y1="${f2(lineY)}" x2="${W}" y2="${f2(lineY)}" stroke="${fg}" stroke-width="${f2(sp * 0.13)}"/>`);
    if (header) {
      // 打楽器記号（太い2本の縦線）と拍子
      out.push(`<rect x="${f2(sp * 0.6)}" y="${f2(lineY - sp)}" width="${f2(sp * 0.4)}" height="${f2(sp * 2)}" fill="${fg}"/>`);
      out.push(`<rect x="${f2(sp * 1.3)}" y="${f2(lineY - sp)}" width="${f2(sp * 0.4)}" height="${f2(sp * 2)}" fill="${fg}"/>`);
      const dig = (n) => String(n).split('').map((c) => digit(+c)).join('');
      const cx = sp * (2.6 + 0.95 * Math.max(String(meter[0]).length, String(meter[1]).length));
      glyph(cx, lineY - sp, dig(meter[0]), fg);
      glyph(cx, lineY + sp, dig(meter[1]), fg);
    }
    const sortedAll = (part.notes || []).map((n, ni) => ({n, ni})).sort((a, b) => a.n[0] - b.n[0] || a.ni - b.ni);
    const sorted = sortedAll.map((e) => e.n);
    const barsAll = (part.bars || []).slice();
    const barOf = (t) => { let b = part.start || 0; for (const x of barsAll) if (x <= t + EPS) b = x; return b; };
    // 小節線・終止線
    const by0 = lineY - sp * (five ? 2 : 2), by1 = lineY + sp * 2;
    for (const b of barsAll) if (b > from + 1e-6 && b < to) line(X(b), by0, X(b), by1, sp * 0.13, fg);
    if (part.end > from && part.end <= to + 1e-6) {
      line(X(part.end) - sp * 0.5, by0, X(part.end) - sp * 0.5, by1, sp * 0.13, fg);
      line(X(part.end), by0, X(part.end), by1, sp * 0.45, fg);
    }
    // 休符（音符どうしのすき間）
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
    let cursor = part.start || 0;
    for (const n of sorted) { if (n[0] - cursor > 0.1) restAt(cursor, n[0] - cursor); cursor = Math.max(cursor, n[0] + n[1]); }
    if (part.end - cursor > 0.1 && sorted.length) restAt(cursor, part.end - cursor);

    // 音符 → 和音（同じ時刻の音を1つにまとめる）。ドラムの位置は楽器ごと
    const yOf = (pad, ni) => {
      if (inst === 'tenor') {
        const p = pad === 0 ? (ni % 4) + 1 : Math.min(pad, 6);
        return p <= 4 ? lineY + (p - 2.5) * sp : lineY - (p - 2) * sp;   // 1〜4 = 上から順の間、5 = 上の加線、6 = さらに上の加線
      }
      if (inst === 'bass') return lineY + (Math.min(pad, 5) - 3) * sp;     // 1〜5 = 上の線から下の線
      return lineY;
    };
    const items = [];
    for (const {n, ni} of sortedAll) {
      if ((o.paged ? n[0] < from - 1e-6 : n[0] + n[1] < from - 1e-6) || n[0] > to) continue;
      const last = items[items.length - 1];
      const head = {pad: n[5] || 0, hand: n[2], acc: n[3], ni};
      if (last && Math.abs(last.t - n[0]) < 1e-6) { last.heads.push(head); last.acc = Math.max(last.acc, n[3]); continue; }
      const d = n[1];
      items.push({t: n[0], d, acc: n[3], kind: n[4], vel: n.length > 6 ? n[6] : 0.7, heads: [head], x: X(n[0]), f: d >= 2 - 1e-6 ? 0 : flagsOf(d), stem: d < 4 - 1e-6});
    }
    // 各符頭の y と左右のずれ。バスで pad なし = 5 本の線すべて（全員で同時）
    for (const it of items) {
      let hs = it.heads;
      if (inst === 'bass') {
        const out2 = [];
        for (const h of hs) { if (h.pad === 0 && it.kind !== 'stickclick') for (let k = 1; k <= 5; k++) out2.push({...h, pad: k}); else out2.push(h); }
        hs = out2;
      }
      if (it.kind === 'stickclick') hs = [{...hs[0], pad: 0}];
      hs.forEach((h) => { h.y = it.kind === 'stickclick' ? lineY : yOf(h.pad, h.ni); });
      // 同じ y の重複は1つに
      const seen = new Set();
      hs = hs.filter((h) => { const k = f2(h.y); if (seen.has(k)) return false; seen.add(k); return true; });
      hs.sort((a, b) => b.y - a.y);   // 下から上へ
      let prev = null;
      for (const h of hs) { h.off = prev && !prev.off && Math.abs(prev.y - h.y) < sp * 1.05 ? 1 : 0; prev = h; }
      it.heads = hs;
      it.yLow = hs[0].y; it.yHigh = hs[hs.length - 1].y;
    }
    const stemTop = lineY + cfg.stem * sp;
    const hw = sp * 0.59;
    // 連桁
    const groups = [];
    let run = [];
    const flush = () => { if (run.length) groups.push(run); run = []; };
    const win = (meter[1] === 8 && meter[0] % 3 === 0) ? 3 : 1;
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

    // 強弱（pp p mp mf f ff）と cresc / dim の開き線
    const DYN = [[0.25, 'pp'], [0.4, 'p'], [0.55, 'mp'], [0.7, 'mf'], [0.85, 'f'], [1.0, 'ff']];
    const dynName = (v) => { const e = DYN.find((d) => Math.abs(d[0] - v) < 0.0015); return e ? e[1] : null; };
    const dynY = lineY + cfg.acc * sp;
    const dir = (a, b) => (b.vel - a.vel > 0.0015 ? 1 : b.vel - a.vel < -0.0015 ? -1 : 0);
    // 続けて強く（弱く）なる 3 音以上の区間を探す: runs = [開始, 終了, 向き]。区間の途中の音には強弱の文字を出さない
    const runs = [];
    for (let i = 0; i < items.length - 1;) {
      const d0 = dir(items[i], items[i + 1]);
      if (d0 === 0) { i++; continue; }
      let j = i + 1;
      while (items[j + 1] && dir(items[j], items[j + 1]) === d0) j++;
      if (j - i >= 2) runs.push([i, j, d0]);
      i = j;
    }
    items.forEach((it, i) => {
      const prev = items[i - 1];
      const nm = dynName(it.vel);
      const changed = i === 0 ? Math.abs(it.vel - 0.7) > 0.0015 : Math.abs(it.vel - prev.vel) > 0.0015;
      const mid = runs.some((r) => i > r[0] && i < r[1]);
      if (nm && (changed || runs.some((r) => r[0] === i)) && !mid && !(i === 0 && !changed)) txt(it.x - sp * 0.9, dynY + sp * 0.6, nm, sp * 1.9, fg, 'font-style="italic" font-weight="700" font-family="serif"', 'end');
    });
    for (const r of runs) {
      const xa = items[r[0]].x + sp * 0.4, xb = items[r[1]].x + sp * 0.2, y = dynY - sp * 1.0, hh = sp * 0.5;
      if (r[2] > 0) { line(xa, y, xb, y - hh, sp * 0.12, fg); line(xa, y, xb, y + hh, sp * 0.12, fg); }
      else { line(xa, y - hh, xb, y, sp * 0.12, fg); line(xa, y + hh, xb, y, sp * 0.12, fg); }
    }

    for (const it of items) {
      const x = it.x, loud = it.acc > 0, k = it.kind;
      const xs = x + hw;    // 符幹の x
      const wholeLike = it.d >= 4 - 1e-6, halfLike = it.d >= 2 - 1e-6;
      // 加線（五線の外の符頭）
      if (five) {
        for (const h of it.heads) {
          if (h.y < lineY - 2 * sp - 1e-6) for (let ly = lineY - 3 * sp; ly >= h.y - 1e-6; ly -= sp) line(x - sp * 1.0, ly, x + sp * 1.0, ly, sp * 0.12, fg);
        }
      }
      for (const h of it.heads) {
        const hx = x + (h.off ? 2 * hw : 0), hy = h.y;
        const spock = inst === 'tenor' && (h.pad === 5 || h.pad === 6);
        if (k === 'stickclick') {
          glyph(hx, hy, G.cross, fg);
          out.push(`<circle cx="${f2(hx)}" cy="${f2(hy)}" r="${f2(sp * 0.95)}" fill="none" stroke="${fg}" stroke-width="${f2(sp * 0.13)}"/>`);
        } else if (k === 'gock') {
          const pts = [[hx, hy - sp * 0.62], [hx - sp * 0.7, hy + sp * 0.5], [hx + sp * 0.7, hy + sp * 0.5]];
          if (halfLike) poly([...pts, pts[0]], sp * 0.15, fg, 'none'); else poly([...pts, pts[0]], sp * 0.05, fg, fg);
        } else {
          const cross = k === 'click' || spock || inst === 'cymbal';
          glyph(hx, hy, cross ? G.cross : wholeLike ? G.whole : halfLike ? G.half : G.head, fg);
          if (k === 'rimshot' || k === 'mute') {
            // 斜線（符頭の両端から出る）
            line(hx - sp * 0.95, hy + sp * 0.95, hx - sp * 0.5, hy + sp * 0.5, sp * 0.15, fg);
            line(hx + sp * 0.5, hy - sp * 0.5, hx + sp * 0.95, hy - sp * 0.95, sp * 0.15, fg);
          }
          if (k === 'mute') out.push(`<circle cx="${f2(hx)}" cy="${f2(hy - sp * 1.25)}" r="${f2(sp * 0.2)}" fill="${fg}"/>`);
        }
        // 付点（間にある符頭はその間に、線・加線の上の符頭は上の間に）
        if (dotted(it.d)) glyph(hx + sp * 1.2 + (h.off ? 0 : 0), hy + (inst === 'tenor' && h.pad >= 1 && h.pad <= 4 ? 0.1 : -0.5) * sp, G.dot, fg);
      }
      if (it.stem) {
        line(xs, it.yLow - sp * 0.1, xs, stemTop, sp * 0.13, fg);
        if (it.f > 0 && !beamed.has(it)) glyph(xs + sp * 0.07, stemTop, it.f === 1 ? G.f1 : it.f === 2 ? G.f2 : G.f3, fg);
      }
      // スクレイプ（波線）
      if (k === 'scrape') {
        const xa = x + sp * 1.3, xb = Math.max(X(it.t + it.d) - sp * 0.3, xa + sp * 2.4), y = it.yLow;
        const pts = [];
        for (let px = xa; px <= xb; px += sp * 0.2) pts.push([px, y + Math.sin((px - xa) / (sp * 0.45) * Math.PI) * sp * 0.28]);
        poly(pts, sp * 0.13, fg);
      }
      // 装飾: フラム（小さな前打音）・ダブル・バズ（幹の斜線）
      if (k === 'flam') {
        const gx = x - sp * 1.9, gy = it.yHigh;
        glyph(gx, gy, G.head, fg, fs * 0.65);
        line(gx + hw * 0.65, gy - sp * 0.1, gx + hw * 0.65, gy - sp * 2.4, sp * 0.1, fg);
        line(gx - sp * 0.1, gy - sp * 1.9, gx + sp * 0.9, gy - sp * 2.5, sp * 0.1, fg);
      }
      if ((k === 'diddle' || k === 'buzz') && it.stem) {
        const n = k === 'buzz' ? 3 : 2;
        for (let q = 0; q < n; q++) {
          const y = stemTop + sp * (1.2 + q * 0.55);
          line(xs - sp * 0.6, y + sp * 0.35, xs + sp * 0.6, y - sp * 0.35, sp * 0.16, fg);
        }
      }
      if (loud) glyph(x + hw * 0.4, lineY + (it.acc >= 2 ? cfg.mar : cfg.acc) * sp, it.acc >= 2 ? G.mar : G.acc, hi, fs);
      // 手順（強いときは大文字、普通は小文字）。和音で手が分かれるときは上の符頭から順に並べる
      const hands = [];
      for (const h of it.heads.slice().reverse()) if (!hands.includes(h.hand)) hands.push(h.hand);
      const ch = hands.map((h) => (loud ? h : h.toLowerCase())).join('');
      txt(x, lineY + cfg.hand * sp, ch, sp * (hands.length > 1 ? 1.5 : 1.9), loud ? hi : fg, 'font-family="Helvetica,Arial,sans-serif" font-weight="700"');
      // ドラム番号は 1 線の楽器だけ（五線は位置で分かる）
      const pad = it.heads[0].pad;
      if (!five && pad > 0) txt(x + sp * 1.0, lineY + cfg.pad * sp, String(pad), sp * 1.0, mu, 'font-family="Helvetica,Arial,sans-serif"');
    }
    if (!o.noPlayhead && ph !== null && ph !== undefined && ph >= from && ph <= to) line(X(ph), sp * 0.3, X(ph), H - sp * 0.3, sp * 0.22, hi);
    return out.join('');
  }

  function staff(part, from, to, W, H, ph, o) {
    o = o || {};
    install();
    if (o.paged && !o.inStack && staff.stackHook) { const r = staff.stackHook(part, from, to, W, H, ph, o); if (r) return r; }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${o.bg ? 'background:' + o.bg : ''}">${body(part, from, to, W, H, ph, o)}</svg>`;
  }

  // 複数のパートを縦に重ねる。各段は H / 段数 の高さ。段の左上に楽器名。音符を打つ位置（x0）は全段でそろえる
  function stack(list, W, H, t, o) {
    o = o || {};
    install();
    const n = list.length, hs = H / n;
    const fg = o.fg || '#e8e9ec';
    let x0 = 0;
    for (const e of list) x0 = Math.max(x0, geom(e.part, W, hs, {...o, inst: e.inst}).x0);
    const parts = [];
    list.forEach((e, i) => {
      const [from, to] = o.paged === false ? [e.part.start || 0, e.part.end] : page(e.part, t);
      const oo = {...o, inst: e.inst, x0, paged: true, inStack: true, noPlayhead: o.noPlayhead};
      const sp = geom(e.part, W, hs, oo).sp;
      parts.push(`<g transform="translate(0,${f2(i * hs)})">${body(e.part, from, to, W, hs, t >= from && t <= to ? t : null, oo)}</g>`);
      parts.push(`<text x="${f2(sp * 0.3)}" y="${f2(i * hs + sp * 2.1)}" font-size="${f2(sp * 1.9)}" font-weight="800" fill="${fg}" text-anchor="start" font-family="'Hiragino Sans','Noto Sans JP','Noto Sans CJK JP',sans-serif">${labelOf(e.inst, e.part).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${o.bg ? 'background:' + o.bg : ''}">${parts.join('')}</svg>`;
  }
  staff.page = page;
  staff.geom = geom;
  staff.fontCss = fontCss;
  staff.install = install;
  staff.instOf = instOf;
  staff.labelOf = labelOf;
  staff.stack = stack;
  staff.stackHook = null;
  staff.stackGeomHook = null;
  return staff;
})();
const jkStaffFontCss = jkStaff.fontCss, jkStaffInstall = jkStaff.install;
if (typeof module !== 'undefined' && module.exports) module.exports = {jkStaff};
