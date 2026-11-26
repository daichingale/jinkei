// 陣形 (Jinkei) エンジンの純JavaScript移植。ブラウザ（<script>）でも node（require）でも使える。
// Rust版 src/{syntax,field,geom,build,analyze,fix,model,output,server}.rs の忠実な移植。
//   jinkeiCompile(src) -> POST /api/compile と同じオブジェクト
//   jinkeiFix(src)     -> POST /api/fix と同じオブジェクト
//   jinkeiModel(src)   -> `jinkei model` と同じ編集モデル（解析に失敗したら {ok:false,...}）
(function (root) {
'use strict';

// ============================================================ 数値ユーティリティ（Rust互換）
class JkErr {
  constructor(line, col, msg) { this.line = line; this.col = col; this.msg = msg; }
}
const at_ = (line, col, msg) => new JkErr(line, col, msg);

/** Rust の f64 Display（{}）: 整数は ".0" なし、指数表記にしない */
function fdisp(v) {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (Object.is(v, -0)) return '-0';
  let s = String(v);
  if (s.indexOf('e') < 0) return s;
  const neg = s[0] === '-';
  if (neg) s = s.slice(1);
  const [m, ex] = s.split('e');
  const e = parseInt(ex, 10);
  let [ip, fp = ''] = m.split('.');
  let digits = ip + fp;
  let point = ip.length + e;
  let out;
  if (point <= 0) out = '0.' + '0'.repeat(-point) + digits;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = digits.slice(0, point) + '.' + digits.slice(point);
  return (neg ? '-' : '') + out;
}
/** syntax::fmt_num */
function fmtNum(v) {
  if (Number.isInteger(v)) return v === 0 ? '0' : fdisp(v);
  return fdisp(v);
}
/** Rust f64::round（0.5 は 0 から遠い方へ） */
function rround(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }
/** Rust の {:.N}（正確な10進展開に対する偶数丸め） */
function rfixed(v, d) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : (v < 0 ? '-inf' : 'inf');
  const neg = v < 0 || Object.is(v, -0);
  const a = Math.abs(v);
  let s;
  const p = Math.pow(10, d);
  const x = a * p;
  const fl = Math.floor(x);
  if (x - fl === 0.5 && fl % 2 === 0 && x < 9e15 && a.toFixed(100).slice(-(100 - d)) === '5' + '0'.repeat(99 - d)) {
    s = (fl / p).toFixed(d); // 厳密な同点（2進で正確に表せる）: 偶数側へ
  } else if (a >= 1e21) {
    s = BigInt(a).toString() + (d > 0 ? '.' + '0'.repeat(d) : '');
  } else {
    s = a.toFixed(d);
  }
  return (neg ? '-' : '') + s;
}
/** output::num（小数3桁、末尾の0を削る、-0 → 0） */
function numS(v) {
  let s = rfixed(v, 3);
  s = s.replace(/0+$/, '').replace(/\.+$/, '');
  return s === '-0' ? '0' : s;
}
const N = (v) => Number(numS(v));
const RAD = Math.PI / 180.0;
const DEG = 180.0 / Math.PI;
const toRad = (d) => d * RAD;
const toDeg = (r) => r * DEG;

// ============================================================ 字句解析
const SYM2 = ['..', '->'];
const SYM1 = ['{', '}', '(', ')', ',', ':', '+', '-', '*', '/', ';'];
const reAlpha = /^\p{Alphabetic}$/u;
const reAlnum = /^[\p{Alphabetic}\p{N}]$/u;
const reWs = /^\p{White_Space}$/u;
const isDigit = (c) => c >= '0' && c <= '9';

/** 直前のトークン列が `part 名前 for 対象` の形か（その直後の `{` は本文の始まり） */
function partHeader(out) {
  let j = out.length - 1;
  while (j > 0) {
    j--;
    const t = out[j];
    if (t.t === 'raw' || (t.t === 'sym' && (t.v === '{' || t.v === '}' || t.v === ';'))) return false;
    if (t.t === 'id' && (t.v === 'part' || t.v === 'パート')) {
      const kw = out[j + 2];
      const afterItem = j > 0 && out[j - 1].t === 'id' && (out[j - 1].v === 'set' || out[j - 1].v === 'section');
      return !afterItem && !!kw && kw.t === 'id' && (kw.v === 'for' || kw.v === '対象');
    }
  }
  return false;
}

function lexFull(src) {
  const comments = [];
  const cs = Array.from(src);
  let i = 0, line = 1, col = 1;
  const out = [];
  while (i < cs.length) {
    const c = cs[i];
    if (c === '\n') { i++; line++; col = 1; continue; }
    if (reWs.test(c)) { i++; col++; continue; }
    if (c === '#') {
      const st = i;
      while (i < cs.length && cs[i] !== '\n') i++;
      let txt = cs.slice(st + 1, i).join('');
      if (txt[0] === ' ') txt = txt.slice(1);
      txt = txt.replace(/\p{White_Space}+$/u, '');
      comments.push([line, col, txt]);
      col += i - st;
      continue;
    }
    const sl = line, sc = col;
    const push = (t, v) => out.push({ t, v, line: sl, col: sc });
    if (isDigit(c)) {
      const st = i;
      while (i < cs.length && isDigit(cs[i])) i++;
      if (i + 1 < cs.length && cs[i] === '.' && isDigit(cs[i + 1])) {
        i++;
        while (i < cs.length && isDigit(cs[i])) i++;
      }
      const s = cs.slice(st, i).join('');
      col += i - st;
      push('num', Number(s));
      continue;
    }
    if (c === '"') {
      i++; col++;
      let s = '';
      for (;;) {
        if (i >= cs.length || cs[i] === '\n') throw at_(sl, sc, '文字列が閉じられていません');
        if (cs[i] === '"') { i++; col++; break; }
        s += cs[i]; i++; col++;
      }
      push('str', s);
      continue;
    }
    if (reAlpha.test(c) || c === '_') {
      const st = i;
      while (i < cs.length && (reAlnum.test(cs[i]) || cs[i] === '_')) i++;
      col += i - st;
      push('id', cs.slice(st, i).join(''));
      continue;
    }
    if (i + 1 < cs.length) {
      const two = cs[i] + cs[i + 1];
      if (SYM2.indexOf(two) >= 0) { push('sym', two); i += 2; col += 2; continue; }
    }
    if (SYM1.indexOf(c) >= 0) {
      push('sym', c); i++; col++;
      if (c === '{' && partHeader(out)) {
        // part の本文は記法が違うので、対応する } までを文字列のまま取り出す
        const bl = line, bc = col;
        const st = i;
        let depth = 1;
        while (i < cs.length) {
          const ch = cs[i];
          if (ch === '#' || (ch === '/' && cs[i + 1] === '/')) {
            while (i < cs.length && cs[i] !== '\n') { i++; col++; }
            continue;
          }
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) break; }
          if (ch === '\n') { line++; col = 1; } else col++;
          i++;
        }
        if (depth !== 0) throw at_(bl, Math.max(bc - 1, 1), "part の '{' が '}' で閉じられていません");
        out.push({ t: 'raw', v: cs.slice(st, i).join(''), line: bl, col: bc });
      }
      continue;
    }
    throw at_(sl, sc, `使えない文字です: '${c}'`);
  }
  out.push({ t: 'eof', v: null, line, col });
  return [out, comments];
}

// ============================================================ 楽譜（part）本文の解析（src/score.rs の移植）
const SC_EPS = 1e-6;
const SC_MAX_ITEMS = 200000;
const SC_DEFAULT_VEL = 0.7;
const SC_RAMP_OPEN = 0.25;
const SC_DYN = { pp: 0.25, p: 0.4, mp: 0.55, mf: 0.7, f: 0.85, ff: 1.0 };
const scR3 = (v) => Math.round(v * 1000) / 1000;
const isPow2 = (n) => n !== 0 && (n & (n - 1)) === 0;
const isAlnumC = (c) => reAlnum.test(c);

class Sc {
  constructor(src, line, col) {
    this.cs = Array.from(src); this.i = 0; this.line = line; this.col = col;
    this.div = 16; this.dotted = false; this.den = 4; this.meter = null; this.start = null;
    this.startPos = [line, col]; this.any = false; this.cuts = []; this.tup = null;
  }
  peek() { return this.i < this.cs.length ? this.cs[this.i] : null; }
  peek2() { return this.i + 1 < this.cs.length ? this.cs[this.i + 1] : null; }
  adv() {
    const c = this.cs[this.i++];
    if (c === '\n') { this.line++; this.col = 1; } else this.col++;
    return c;
  }
  err(m) { return at_(this.line, this.col, m); }
  skip() {
    for (;;) {
      const c = this.peek();
      if (c === null) break;
      if (reWs.test(c)) this.adv();
      else if (c === '#' || (c === '/' && this.peek2() === '/')) {
        while (this.peek() !== null && this.peek() !== '\n') this.adv();
      } else break;
    }
  }
  skipInline() { while (this.peek() === ' ' || this.peek() === '\t') this.adv(); }
  digits() {
    let s = '';
    while (this.peek() !== null && isDigit(this.peek())) s += this.adv();
    return s;
  }
  divDur() { return this.den / this.div * (this.dotted ? 1.5 : 1.0); }
  slot() { return this.tup ? this.tup[0] : this.divDur(); }
  tickTup() { if (this.tup) this.tup[1]++; }
  word() {
    let j = this.i, s = '';
    while (j < this.cs.length && reAlpha.test(this.cs[j])) { s += this.cs[j]; j++; }
    return s;
  }
  items(depth) {
    const out = [];
    for (;;) {
      this.skip();
      const c = this.peek();
      if (c === null) {
        if (this.tup) throw this.err("'[' が ']' で閉じられていません");
        if (depth > 0) throw this.err("くり返しの '{' が '}' で閉じられていません");
        break;
      }
      if (out.length > SC_MAX_ITEMS) throw this.err('音符が多すぎます');
      const NOTUP = '連符の中には音符・休符・タイだけを書けます';
      if (c === '|') {
        if (this.tup) throw this.err(NOTUP);
        this.adv(); this.any = true; out.push({ k: 'bar' });
      } else if (c === '}') {
        if (depth > 0 && !this.tup) { this.adv(); break; }
        throw this.err("対応する '{' のない '}' です");
      } else if (c === '{') {
        throw this.err("'{' は repeat N { ... } の形でだけ使えます");
      } else if (c === ']') {
        if (!this.tup) throw this.err("対応する '[' のない ']' です");
        const [, n, need] = this.tup;
        if (n !== need) throw this.err(`${need}[ ] の中は${need}個分の音符・休符が必要です（今は${n}個）`);
        this.adv(); this.tup = null;
      } else if (c === '-') {
        this.adv(); this.any = true; this.tickTup(); out.push({ k: 'rest', dur: this.slot() });
      } else if (c === '~') {
        const l = this.line, cl = this.col;
        this.adv(); this.any = true; this.tickTup(); out.push({ k: 'tie', dur: this.slot(), l, c: cl });
      } else if (isDigit(c)) {
        if (this.tup) throw this.err(NOTUP);
        const l = this.line, cl = this.col;
        const ds = this.digits();
        const n = Number(ds) > 4294967295 ? 4294967295 : Number(ds);
        if (this.peek() === '.' && this.peek2() === ':') {
          this.checkDiv(n, l, cl); this.adv(); this.adv(); this.div = n; this.dotted = true;
        } else if (this.peek() === ':') {
          this.checkDiv(n, l, cl); this.adv(); this.div = n; this.dotted = false;
        } else if (this.peek() === '[') {
          if (!(n >= 2 && n <= 32)) throw at_(l, cl, '連符の数は2〜32にしてください');
          this.adv();
          let p;
          if (isPow2(n)) p = n / 2;
          else { p = 1; while (p * 2 < n) p *= 2; }
          this.tup = [p * this.divDur() / n, 0, n];
          this.any = true;
        } else {
          throw at_(l, cl, `数字「${ds}」の後には ':'（分割の指定。例 16:）か '['（連符。例 3[ r l r ]）が必要です`);
        }
      } else if (reAlpha.test(c)) {
        const w = this.word();
        if (w === 'meter' || w === '拍子' || w === 'start' || w === '開始' || w === 'repeat' || w === 'くり返し') {
          if (this.tup) throw this.err(NOTUP);
          this.keyword(w, depth, out);
        } else if (w === 'cresc' || w === 'decresc' || w === 'dim') {
          for (let q = 0; q < w.length; q++) this.adv();
          out.push({ k: 'ramp', sign: w === 'cresc' ? 1 : -1 });
        } else if (Object.prototype.hasOwnProperty.call(SC_DYN, w)) {
          for (let q = 0; q < w.length; q++) this.adv();
          out.push({ k: 'dyn', v: SC_DYN[w] });
        } else {
          const it = this.note();
          this.any = true; this.tickTup(); out.push(it);
        }
      } else if (c === '>' || c === '^') {
        const it = this.note();
        this.any = true; this.tickTup(); out.push(it);
      } else {
        throw this.err(`使えない文字です: '${c}'`);
      }
    }
    return out;
  }
  checkDiv(n, l, c) {
    if (!isPow2(n) || n > 64) throw at_(l, c, `分割「${n}:」は 1 / 2 / 4 / 8 / 16 / 32 / 64 のどれかにしてください`);
  }
  keyword(w, depth, out) {
    const k0 = this.i, kl = this.line, kc = this.col;
    for (let q = 0; q < Array.from(w).length; q++) this.adv();
    if (w === 'meter' || w === '拍子') {
      if (this.any || depth > 0) throw at_(kl, kc, '拍子（meter）は音符より前に、1回だけ書いてください');
      if (this.meter) throw at_(kl, kc, '拍子（meter）は1回だけ書いてください');
      this.skipInline();
      const l = this.line, c = this.col;
      const a = this.digits();
      if (a === '' || this.peek() !== '/') throw at_(l, c, '拍子は 4/4 や 6/8 の形で書いてください');
      this.adv();
      const b = this.digits();
      const n = a === '' ? 0 : Number(a), d = b === '' ? 0 : Number(b);
      if (n === 0 || n > 64 || !isPow2(d) || d > 32) throw at_(l, c, '拍子の分子は1〜64、分母は 1 / 2 / 4 / 8 / 16 / 32 にしてください');
      this.meter = [n, d]; this.den = d;
      this.cuts.push([k0, this.i]);
    } else if (w === 'start' || w === '開始') {
      if (this.any || depth > 0) throw at_(kl, kc, '開始（start）は音符より前に、1回だけ書いてください');
      if (this.start) throw at_(kl, kc, '開始（start）は1回だけ書いてください');
      this.skipInline();
      const l = this.line, c = this.col;
      this.startPos = [l, c];
      if (this.word() === 'set') {
        for (let q = 0; q < 3; q++) this.adv();
        this.skipInline();
        const nl = this.line, nc = this.col;
        let name;
        if (this.peek() === '"') {
          this.adv();
          name = '';
          for (;;) {
            const ch = this.peek();
            if (ch === null || ch === '\n') throw at_(nl, nc, '文字列が閉じられていません');
            if (ch === '"') { this.adv(); break; }
            name += this.adv();
          }
        } else {
          let s = '';
          for (;;) {
            const ch = this.peek();
            if (ch === null) break;
            if (isAlnumC(ch) || ch === '_' || (ch === '.' && this.peek2() !== null && isDigit(this.peek2()) && /^\d*$/.test(s) && s !== '')) s += this.adv();
            else break;
          }
          if (s === '') throw at_(nl, nc, 'start set の後にはセット名が必要です');
          if (isDigit(s[0]) && /^[\d.]+$/.test(s)) name = fmtNum(Number(s));
          else name = s;
        }
        this.start = { k: 'set', v: name };
      } else {
        let s = this.digits();
        if (s === '') throw at_(l, c, 'start の後にはカウント数か `set セット名` が必要です');
        if (this.peek() === '.' && this.peek2() !== null && isDigit(this.peek2())) { this.adv(); s += '.' + this.digits(); }
        this.start = { k: 'count', v: Number(s) };
      }
      this.cuts.push([k0, this.i]);
    } else {
      this.skip();
      const l = this.line, c = this.col;
      const ds = this.digits();
      const n = ds === '' ? 0 : Number(ds);
      if (ds === '' || !(n >= 1 && n <= 999)) throw at_(l, c, 'くり返しの回数は1〜999の整数にしてください（例: repeat 2 { ... }）');
      this.skip();
      if (this.peek() !== '{') throw this.err("repeat N の後に '{' が必要です");
      this.adv(); this.any = true;
      const body = this.items(depth + 1);
      if (body.length * n > SC_MAX_ITEMS) throw at_(l, c, 'くり返しで音符が多くなりすぎます');
      for (let q = 0; q < n; q++) for (const b of body) out.push(b);
    }
  }
  note() {
    let acc = 0, kind = null, had = false;
    for (;;) {
      const ch = this.peek();
      let k = null;
      if (ch === '>') acc = Math.max(acc, 1);
      else if (ch === '^') acc = 2;
      else if (ch === 'x') k = 'click';
      else if (ch === 'f') k = 'flam';
      else if (ch === 'd') k = 'diddle';
      else if (ch === 'z') k = 'buzz';
      else if (ch === 'o') k = 'rimshot';
      else if (ch === 'm') k = 'mute';
      else if (ch === 'g') k = 'gock';
      else if (ch === 's') k = 'scrape';
      else if (ch === 'k') k = 'stickclick';
      else break;
      if (k !== null) {
        if (kind !== null) throw this.err('奏法の指定（x f d z o m g s k）は1音に1つだけです');
        kind = k;
      }
      had = true;
      this.adv();
    }
    const ch = this.peek();
    let hand;
    if (ch === 'r' || ch === 'l' || ch === 'b') hand = ch.toUpperCase();
    else if (ch === 'R' || ch === 'L' || ch === 'B') { acc = Math.max(acc, 1); hand = ch; }
    else if (ch === null) throw this.err('音符の手（R / L / B）が必要です');
    else throw this.err(had ? '音符の手（R / L / B）が必要です' : `使えない文字です: '${ch}'（音符は R L B r l b。休符 - ・タイ ~）`);
    this.adv();
    let ev = [[hand, 0]];
    if (this.peek() === '[') {
      const l = this.line, c = this.col;
      this.adv();
      const pads = [];
      for (;;) {
        const d = this.peek();
        if (d !== null && isDigit(d) && d !== '0') { pads.push(d.charCodeAt(0) - 48); this.adv(); }
        else if (d === ']') { this.adv(); break; }
        else throw at_(l, c, "和音 [ ] の中はドラム番号（1〜9）を並べて ']' で閉じてください（例: R[135]、B[12]）");
      }
      if (pads.length === 0) throw at_(l, c, '和音 [ ] の中にドラム番号がありません（例: R[135]）');
      if (hand === 'B') {
        if (pads.length === 1) ev = [['B', pads[0]]];
        else if (pads.length === 2) ev = [['R', pads[0]], ['L', pads[1]]];
        else throw at_(l, c, 'B[ ] は1つ（両手で同じドラム）か2つ（右手・左手）のドラム番号を書いてください');
      } else ev = pads.map((p) => [hand, p]);
    } else {
      const d = this.peek();
      if (d !== null && isDigit(d)) { ev[0][1] = d.charCodeAt(0) - 48; this.adv(); }
    }
    return { k: 'note', dur: this.slot(), accent: acc, kind: kind === null ? 'tap' : kind, ev };
  }
}

function normalizeSrc(cs, cuts) {
  let s = '';
  for (let i = 0; i < cs.length; i++) {
    if (cuts.some(([a, b]) => i >= a && i < b)) continue;
    s += cs[i];
  }
  const lines = s.split('\n').map((l) => l.replace(/\p{White_Space}+$/u, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const ind = (l) => { let n = 0; for (const c of Array.from(l)) { if (c === ' ' || c === '\t') n++; else break; } return n; };
  const nz = lines.filter((l) => l !== '').map(ind);
  const m = nz.length ? Math.min(...nz) : 0;
  return lines.map((l) => (l === '' ? '' : Array.from(l).slice(m).join(''))).join('\n');
}

function scoreParseBody(src, line, col) {
  const sc = new Sc(src, line, col);
  const items = sc.items(0);
  const meter = sc.meter || [4, 4];
  const want = meter[0];
  const notes = [], bars = [], issues = [];
  let t = 0, barStart = 0, barNo = 1, has = false, pending = 0, last = null;
  const open = () => { if (pending !== null) { bars.push(pending); pending = null; } };
  let cur = SC_DEFAULT_VEL, ramp = null;
  const settle = (r, t1, v1) => {
    for (let q = r.from; q < notes.length; q++) {
      const n = notes[q];
      const f = t1 - r.t0 > 1e-9 ? Math.min(1, Math.max(0, (n.t - r.t0) / (t1 - r.t0))) : 1;
      n.vel = scR3(r.v0 + (v1 - r.v0) * f);
    }
  };
  for (const it of items) {
    if (it.k === 'note') {
      open();
      const a = notes.length;
      for (const [hand, pad] of it.ev) notes.push({ t, dur: it.dur, hand, accent: it.accent, kind: it.kind, pad, vel: scR3(cur) });
      last = [a, notes.length]; t += it.dur; has = true;
    } else if (it.k === 'dyn') {
      if (ramp) { settle(ramp, t, it.v); ramp = null; }
      cur = it.v;
    } else if (it.k === 'ramp') {
      if (ramp) {
        const v = Math.min(1, Math.max(0.05, ramp.v0 + ramp.sign * SC_RAMP_OPEN));
        settle(ramp, t, v); cur = v;
      }
      ramp = { t0: t, v0: cur, sign: it.sign, from: notes.length };
    } else if (it.k === 'rest') {
      open(); last = null; t += it.dur; has = true;
    } else if (it.k === 'tie') {
      if (last === null) throw at_(it.l, it.c, 'タイ ~ の前に音符がありません（休符や先頭の後には使えません）');
      open(); for (let q = last[0]; q < last[1]; q++) notes[q].dur += it.dur; t += it.dur; has = true;
    } else if (has) {
      if (Math.abs(t - barStart - want) > SC_EPS) issues.push({ bar: barNo, got: t - barStart, want, at: barStart });
      barNo++; barStart = t; has = false; pending = t;
    }
  }
  if (ramp) settle(ramp, t, Math.min(1, Math.max(0.05, ramp.v0 + ramp.sign * SC_RAMP_OPEN)));
  if (has && Math.abs(t - barStart - want) > SC_EPS) issues.push({ bar: barNo, got: t - barStart, want, at: barStart });
  return { meter: sc.meter, start: sc.start, startPos: sc.startPos, notes, bars, len: t, issues, src: normalizeSrc(sc.cs, sc.cuts) };
}

// ============================================================ 構文解析
function describeTok(t) {
  switch (t.t) {
    case 'id': return `「${t.v}」`;
    case 'num': return `数値 ${fdisp(t.v)}`;
    case 'str': return `文字列 "${t.v}"`;
    case 'sym': return `記号 '${t.v}'`;
    case 'raw': return '楽譜';
    default: return '終わり';
  }
}

const FACE_NAMES = {
  front: 'front', '客席': 'front', back: 'back', '奥': 'back', kami: 'kami', '上手': 'kami',
  shimo: 'shimo', '下手': 'shimo', center: 'center', '中心': 'center', out: 'out', '外': 'out',
  travel: 'travel', '進行方向': 'travel',
};
const STEP_NAMES = {
  glide: 'glide', 'グライド': 'glide', back: 'back', 'バック': 'back', slide: 'slide', 'スライド': 'slide',
  jazz: 'jazz', 'ジャズ': 'jazz', high: 'high', 'ハイ': 'high',
};
const ACTION_NAMES = {
  spin: 'spin', 'スピン': 'spin', toss: 'toss', 'トス': 'toss', swing: 'swing', 'スイング': 'swing', rest: 'rest', 'レスト': 'rest',
};
const POSE_NAMES = {
  attention: 'attention', '気をつけ': 'attention', rest: 'rest', '休め': 'rest', wide: 'wide', '足開き': 'wide',
  cross: 'cross', 'クロス': 'cross', kneel: 'kneel', '片膝': 'kneel', kneel2: 'kneel2', '膝つき': 'kneel2',
  lunge: 'lunge', 'ランジ': 'lunge', crouch: 'crouch', 'しゃがみ': 'crouch', toe: 'toe', 'つま先': 'toe',
};
const CARRY_NAMES = {
  play: 'play', '演奏': 'play', right: 'right', '右手': 'right', left: 'left', '左手': 'left',
  front: 'front', '正面': 'front', diag: 'diag', '斜め': 'diag',
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

class Parser {
  constructor(toks, comments) {
    this.toks = toks; this.p = 0; this.comments = comments; this.ci = 0; this.lastLine = 0;
  }
  lead() {
    const l = this.cur().line, c = this.cur().col;
    const v = [];
    while (this.ci < this.comments.length) {
      const [cl, cc, t] = this.comments[this.ci];
      if (cl < l || (cl === l && cc < c)) { v.push(t); this.ci++; } else break;
    }
    return v;
  }
  tail() {
    if (this.ci < this.comments.length && this.comments[this.ci][0] === this.lastLine) {
      const t = this.comments[this.ci][2];
      this.ci++;
      return t;
    }
    return null;
  }
  cur() { return this.toks[this.p]; }
  pos() { return { line: this.cur().line, col: this.cur().col }; }
  bump() {
    const t = this.toks[this.p];
    this.lastLine = t.line;
    if (this.p + 1 < this.toks.length) this.p++;
    return t;
  }
  err(m) {
    const p = this.pos();
    return at_(p.line, p.col, `${m}（ここにあるのは${describeTok(this.cur())}）`);
  }
  isSym(s) { const t = this.cur(); return t.t === 'sym' && t.v === s; }
  eatSym(s) { if (this.isSym(s)) { this.bump(); return true; } return false; }
  expectSym(s) { if (!this.eatSym(s)) throw this.err(`'${s}' が必要です`); }
  isKw(k) { const t = this.cur(); return t.t === 'id' && t.v === k; }
  eatKw(k) { if (this.isKw(k)) { this.bump(); return true; } return false; }
  expectKw(k) { if (!this.eatKw(k)) throw this.err(`'${k}' が必要です`); }
  ident() {
    const p = this.pos();
    const t = this.cur();
    if (t.t === 'id') { this.bump(); return [t.v, p]; }
    throw this.err('名前が必要です');
  }
  name() {
    const t = this.cur();
    if (t.t === 'str' || t.t === 'id') { this.bump(); return t.v; }
    if (t.t === 'num') { this.bump(); return fmtNum(t.v); }
    throw this.err('名前が必要です');
  }
  string() {
    const t = this.cur();
    if (t.t === 'str') { this.bump(); return t.v; }
    throw this.err('文字列が必要です');
  }
  num() {
    const neg = this.eatSym('-');
    const t = this.cur();
    if (t.t === 'num') { this.bump(); return neg ? -t.v : t.v; }
    throw this.err('数値が必要です');
  }

  expr() {
    let l = this.term();
    for (;;) {
      let op;
      if (this.eatSym('+')) op = '+';
      else if (this.eatSym('-')) op = '-';
      else break;
      const r = this.term();
      l = { k: 'bin', op, a: l, b: r };
    }
    return l;
  }
  term() {
    let l = this.unary();
    for (;;) {
      let op;
      if (this.eatSym('*')) op = '*';
      else if (this.eatSym('/')) op = '/';
      else break;
      const r = this.unary();
      l = { k: 'bin', op, a: l, b: r };
    }
    return l;
  }
  unary() {
    if (this.eatSym('-')) return { k: 'neg', a: this.unary() };
    const p = this.pos();
    const t = this.cur();
    if (t.t === 'num') { this.bump(); return { k: 'num', v: t.v }; }
    if (t.t === 'id') {
      this.bump();
      if (this.eatSym('(')) {
        const args = [];
        if (!this.isSym(')')) {
          for (;;) {
            args.push(this.expr());
            if (!this.eatSym(',')) break;
          }
        }
        this.expectSym(')');
        return { k: 'call', n: t.v, args, pos: p };
      }
      return { k: 'name', n: t.v, pos: p };
    }
    if (t.t === 'sym' && t.v === '(') {
      this.bump();
      const e = this.expr();
      this.expectSym(')');
      return e;
    }
    throw this.err('式が必要です');
  }
  point() {
    this.expectSym('(');
    const x = this.expr();
    this.expectSym(',');
    const y = this.expr();
    this.expectSym(')');
    return [x, y];
  }
  points() {
    const v = [this.point()];
    for (;;) {
      this.eatSym('->');
      this.eatSym(',');
      if (this.isSym('(')) v.push(this.point()); else break;
    }
    return v;
  }

  group() {
    const v = [];
    for (;;) {
      if (this.eatKw('all')) v.push({ k: 'all' });
      else {
        const [a, p] = this.ident();
        if (this.eatSym('..')) {
          const [b] = this.ident();
          v.push({ k: 'range', a, b, pos: p });
        } else v.push({ k: 'name', n: a, pos: p });
      }
      if (!this.eatSym('+') && !this.eatSym(',')) break;
    }
    return v;
  }

  shape() {
    const [kw, kp] = this.ident();
    switch (kw) {
      case 'line': {
        const a = this.point();
        if (!this.eatSym('->')) this.expectKw('to');
        const b = this.point();
        return { k: 'line', a, b };
      }
      case 'arc': {
        this.eatKw('center');
        const c = this.point();
        this.expectKw('radius');
        const r = this.expr();
        this.expectKw('from');
        const a1 = this.expr();
        this.expectKw('to');
        const a2 = this.expr();
        return { k: 'arc', c, r, a1, a2 };
      }
      case 'circle': {
        this.eatKw('center');
        const c = this.point();
        this.expectKw('radius');
        const r = this.expr();
        const start = this.eatKw('start') ? this.expr() : null;
        return { k: 'circle', c, r, start };
      }
      case 'block': {
        this.eatKw('center');
        const c = this.point();
        this.expectKw('cols');
        const cols = this.expr();
        let spacing = null, rowsp = null;
        for (;;) {
          if (this.eatKw('spacing')) spacing = this.expr();
          else if (this.eatKw('rows')) rowsp = this.expr();
          else break;
        }
        return { k: 'block', c, cols, spacing, rowsp };
      }
      case 'curve': return { k: 'curve', pts: this.points() };
      case 'poly': return { k: 'poly', pts: this.points() };
      case 'at': return { k: 'at', p: this.point() };
      case 'same': case 'hold': return { k: 'same' };
      case 'follow': {
        const pts = this.points();
        const spacing = this.eatKw('spacing') ? this.expr() : null;
        return { k: 'follow', pts, spacing };
      }
      default:
        throw at_(kp.line, kp.col, `不明な隊形「${kw}」（line / arc / circle / block / curve / poly / follow / at / same が使えます）`);
    }
  }

  named(table, msg) {
    const t = this.cur();
    if (t.t === 'id' && has(table, t.v)) { this.bump(); return table[t.v]; }
    throw this.err(msg);
  }

  face() {
    const t = this.cur();
    if (t.t === 'id') {
      if (has(FACE_NAMES, t.v)) { this.bump(); return { k: 'named', n: FACE_NAMES[t.v] }; }
      if (t.v === 'toward' || t.v === '方へ') { this.bump(); return { k: 'toward', p: this.point() }; }
    }
    if (t.t === 'num' || (t.t === 'sym' && (t.v === '-' || t.v === '('))) return { k: 'deg', e: this.expr() };
    throw this.err('face の後には front / back / kami / shimo / center / out / travel / toward (x, y) / 角度 のどれか');
  }

  stmt() {
    const note = this.lead();
    const pos = this.pos();
    const group = this.group();
    this.expectSym(':');
    // 「:」の直後が pose / carry / face / step / action なら、位置を変えない指定
    const shape = ['pose', 'carry', '構え', 'face', 'step', 'action'].some((k) => this.isKw(k)) ? { k: 'attr' } : this.shape();
    const xf = [];
    let assign = null, skip = [], wait = null, within = null, bend = null, face = null, step = null, action = null, pose = null, carry = null;
    for (;;) {
      if (this.eatKw('carry') || this.eatKw('構え')) {
        carry = this.named(CARRY_NAMES, 'carry（構え）の後には play / right / left / front / diag（演奏・右手・左手・正面・斜め）');
        continue;
      }
      if (this.eatKw('pose')) {
        pose = this.named(POSE_NAMES, 'pose の後には attention / rest / wide / cross / kneel / kneel2 / lunge / crouch / toe（気をつけ・休め・足開き・クロス・片膝・膝つき・ランジ・しゃがみ・つま先）');
        continue;
      }
      if (this.eatKw('step')) {
        step = this.named(STEP_NAMES, 'step の後には glide / back / slide / jazz / high');
        continue;
      }
      if (this.eatKw('action')) {
        action = this.named(ACTION_NAMES, 'action の後には spin / toss / swing / rest');
        continue;
      }
      if (this.eatKw('skip') || this.eatKw('空き')) {
        for (;;) {
          const t = this.cur();
          if (t.t === 'num' && t.v >= 1 && Number.isInteger(t.v) && t.v < 100000) {
            this.bump();
            if (!skip.includes(t.v)) skip.push(t.v);
          } else throw this.err('skip（空き）の後には席の番号（1以上の整数。複数なら 2, 5 のように）');
          if (!this.eatSym(',') && !(this.cur().t === 'num')) break;
        }
        skip.sort((x, y) => x - y);
        continue;
      }
      if (this.eatKw('bend')) { bend = this.expr(); continue; }
      if (this.eatKw('face')) { face = this.face(); continue; }
      if (this.eatKw('wait')) { wait = this.expr(); continue; }
      if (this.eatKw('in')) { within = this.expr(); continue; }
      if (this.eatKw('rotate')) {
        const a = this.expr();
        const about = this.eatKw('about') ? this.point() : null;
        xf.push({ k: 'rotate', a, about });
      } else if (this.eatKw('shift')) {
        xf.push({ k: 'shift', d: this.point() });
      } else if (this.eatKw('scale')) {
        xf.push({ k: 'scale', s: this.expr() });
      } else if (this.eatKw('assign')) {
        if (this.eatKw('auto')) assign = 'auto';
        else if (this.eatKw('keep')) assign = 'keep';
        else throw this.err('assign の後には auto か keep');
      } else break;
    }
    const tail = this.tail();
    if (shape.k === 'attr' && (xf.length || assign !== null || skip.length || wait !== null || within !== null || bend !== null)) {
      throw at_(pos.line, pos.col, '位置を変えない指定（隊形なし）では pose / carry / face / step / action だけが使えます');
    }
    return { group, shape, xf, assign, skip, wait, within, bend, face, step, action, pose, carry, pos, note, tail };
  }

  set(note) {
    const pos = this.pos();
    const name = this.name();
    let counts = 0, hold = 0, tempo = null, mark = false;
    for (;;) {
      if (this.eatKw('counts')) counts = this.num();
      else if (this.eatKw('tempo')) {
        const t = this.num();
        if (t <= 0) throw this.err('tempo は正の数にしてください');
        tempo = t;
      } else if (this.eatKw('mark')) mark = true;
      else if (this.eatKw('hold')) hold = this.num();
      else break;
    }
    if (counts < 0 || hold < 0) throw at_(pos.line, pos.col, 'counts / hold は0以上にしてください');
    this.expectSym('{');
    const tail = this.tail();
    const stmts = [];
    let foot;
    for (;;) {
      if (this.isSym('}')) { foot = this.lead(); this.bump(); break; }
      if (this.eatSym(';')) continue;
      if (this.cur().t === 'eof') throw this.err("'}' で閉じられていません");
      stmts.push(this.stmt());
    }
    return { name, counts, hold, tempo, mark, stmts, pos, note, tail, foot };
  }

  show() {
    const header = this.lead();
    this.expectKw('show');
    const name = this.name();
    this.expectSym('{');
    const s = {
      header, settings_notes: [], foot: [], field_given: false, name,
      field: { k: 'gym', w: 30, d: 30 }, tempo: 120, clearance: null, maxstep: null, look: null, sections: [], sets: [], parts: [],
    };
    const t0 = this.tail();
    if (t0 !== null) s.settings_notes.push(t0);
    for (;;) {
      if (this.isSym('}')) { s.foot = this.lead(); this.bump(); break; }
      if (this.eatSym(';')) continue;
      const note = this.lead();
      const isItem = this.isKw('set') || this.isKw('section') || this.isKw('part') || this.isKw('パート');
      if (!isItem) for (const n of note) s.settings_notes.push(n);
      if (this.cur().t === 'eof') throw this.err("'}' で閉じられていません");
      const [kw, kp] = this.ident();
      switch (kw) {
        case 'field': {
          s.field_given = true;
          if (this.eatKw('football')) {
            let k = 'hs';
            const t = this.cur();
            if (t.t === 'id' && (t.v === 'hs' || t.v === 'college' || t.v === 'nfl')) { this.bump(); k = t.v; }
            s.field = { k: 'football', level: k };
          } else if (this.eatKw('floor')) {
            const w = this.num();
            this.expectKw('x');
            const d = this.num();
            if (w <= 0 || d <= 0) throw at_(kp.line, kp.col, 'フロアの大きさは正の数にしてください');
            s.field = { k: 'floor', w, d };
          } else if (this.eatKw('gym')) {
            let w = 30, d = 30;
            if (this.cur().t === 'num') { w = this.num(); this.expectKw('x'); d = this.num(); }
            if (w <= 0 || d <= 0) throw at_(kp.line, kp.col, '大きさは正の数にしてください');
            s.field = { k: 'gym', w, d };
          } else if (this.eatKw('stage')) {
            let w = 16, d = 10, wing = 4;
            if (this.cur().t === 'num') { w = this.num(); this.expectKw('x'); d = this.num(); }
            if (this.eatKw('wings')) wing = this.num();
            if (w <= 0 || d <= 0 || wing < 0) throw at_(kp.line, kp.col, '大きさは正の数にしてください');
            s.field = { k: 'stage', w, d, wing };
          } else throw this.err('field の後には gym / stage / football / floor');
          break;
        }
        case 'tempo': s.tempo = this.num(); break;
        case 'clearance': s.clearance = this.num(); break;
        case 'maxstep': s.maxstep = this.num(); break;
        case 'look': case '見た目': {
          const lt = this.cur();
          if (lt.t !== 'id' && lt.t !== 'str') throw this.err('look の後には real / illust');
          this.bump();
          const ln = String(lt.v).toLowerCase();
          if (ln === 'real' || ln === 'リアル') s.look = 'real';
          else if (ln === 'illust' || ln === 'イラスト') s.look = 'illust';
          else throw at_(lt.line, lt.col, `見た目「${lt.v}」が分かりません（real / illust）`);
          break;
        }
        case 'section': {
          const [id, p] = this.ident();
          const label = this.cur().t === 'str' ? this.string() : id;
          const n = this.num();
          if (n < 1 || n !== Math.trunc(n)) throw at_(p.line, p.col, '人数は1以上の整数にしてください');
          let color = null;
          let instrument = null;
          for (;;) {
            if (this.eatKw('color')) color = this.string();
            else if (this.eatKw('instrument')) {
              const ip = this.pos();
              const t = this.cur();
              if (t.t !== 'id' && t.t !== 'str') throw this.err('instrument の後には楽器名');
              this.bump();
              const name = t.v;
              const iid = instrumentIsId(name) ? name : detectInstrument(name, '');
              if (iid === 'none' && name !== 'none') {
                throw at_(ip.line, ip.col, `楽器「${name}」が分かりません（使えるもの: ${INSTRUMENTS.map((x) => x[0]).join(', ')}）`);
              }
              instrument = iid;
            } else break;
          }
          const tail = this.tail();
          s.sections.push({ id, label, n, color, instrument, pos: p, note, tail });
          break;
        }
        case 'set': s.sets.push(this.set(note)); break;
        case 'part': case 'パート': {
          const name = this.name();
          if (!(this.eatKw('for') || this.eatKw('対象'))) throw this.err("'for' が必要です（例: part \"名前\" for sn { ... }）");
          const group = this.group();
          this.expectSym('{');
          const rt = this.cur();
          if (rt.t !== 'raw') throw this.err('part の本文が必要です');
          this.bump();
          this.expectSym('}');
          const body = scoreParseBody(rt.v, rt.line, rt.col);
          s.parts.push({ name, group, pos: kp, body, note });
          break;
        }
        default:
          throw at_(kp.line, kp.col, `不明なキーワード「${kw}」（field / tempo / section / set / part / clearance / maxstep / look が使えます）`);
      }
      if (!isItem) {
        const t = this.tail();
        if (t !== null) s.settings_notes.push(t);
      }
    }
    if (this.cur().t !== 'eof') throw this.err('show の後に余分なものがあります');
    return s;
  }
}

function parse(src) {
  const [toks, comments] = lexFull(src);
  return new Parser(toks, comments).show();
}

// ---- Display
function prec(e) {
  switch (e.k) {
    case 'bin': return (e.op === '+' || e.op === '-') ? 1 : 2;
    case 'neg': return 3;
    default: return 4;
  }
}
function exprStr(e) {
  switch (e.k) {
    case 'num': return fmtNum(e.v);
    case 'name': return e.n;
    case 'call': return `${e.n}(${e.args.map(exprStr).join(', ')})`;
    case 'neg': return prec(e.a) < 3 ? `-(${exprStr(e.a)})` : `-${exprStr(e.a)}`;
    default: {
      const p = prec(e);
      let s = prec(e.a) < p ? `(${exprStr(e.a)})` : exprStr(e.a);
      s += ` ${e.op} `;
      if (prec(e.b) < p || (prec(e.b) === p && (e.op === '-' || e.op === '/'))) s += `(${exprStr(e.b)})`;
      else s += exprStr(e.b);
      return s;
    }
  }
}
function groupTermStr(g) {
  switch (g.k) {
    case 'name': return g.n;
    case 'range': return `${g.a}..${g.b}`;
    default: return 'all';
  }
}
function faceStr(f) {
  switch (f.k) {
    case 'named': return f.n;
    case 'toward': return `toward (${exprStr(f.p[0])}, ${exprStr(f.p[1])})`;
    default: return exprStr(f.e);
  }
}

// ============================================================ field
const STEP_M = 0.5715;
const GYM_MARGIN = 5.0;
const BSL = 160.0 * 12.0 / 22.5;

function mkField(a) {
  switch (a.k) {
    case 'football': {
      const level = a.level;
      const inches = level === 'college' ? 60.0 * 12.0 : level === 'nfl' ? 70.0 * 12.0 + 9.0 : 53.0 * 12.0 + 4.0;
      return { kind: 'football', level, hash: inches / 22.5, unit_m: STEP_M };
    }
    case 'floor': return { kind: 'floor', w: a.w, d: a.d, unit_m: 1.0 };
    case 'gym': return { kind: 'gym', w: a.w, d: a.d, unit_m: 1.0 };
    default: return { kind: 'stage', w: a.w, d: a.d, wing: a.wing, unit_m: 1.0 };
  }
}
const isFootball = (f) => f.kind === 'football';
const unitName = (f) => (isFootball(f) ? '歩' : 'm');

/** 定数名 → 値。なければ null */
function fconst(f, name) {
  switch (f.kind) {
    case 'football':
      switch (name) {
        case 'FSL': return 0.0;
        case 'FH': return f.hash;
        case 'BH': return BSL - f.hash;
        case 'BSL': return BSL;
        case 'MID': return BSL / 2.0;
        default: return null;
      }
    case 'floor':
      switch (name) {
        case 'FRONT': return 0.0;
        case 'BACK': return f.d;
        case 'LEFT': case 'SHIMO': return -f.w / 2.0;
        case 'RIGHT': case 'KAMI': return f.w / 2.0;
        case 'MID': return f.d / 2.0;
        default: return null;
      }
    case 'gym':
      switch (name) {
        case 'FRONT': return -f.d / 2.0;
        case 'BACK': return f.d / 2.0;
        case 'LEFT': case 'SHIMO': return -f.w / 2.0;
        case 'RIGHT': case 'KAMI': return f.w / 2.0;
        case 'MID': case 'CENTER': return 0.0;
        case 'FRONT20': return -10.0;
        case 'BACK20': return 10.0;
        case 'SHIMO20': return -10.0;
        case 'KAMI20': return 10.0;
        default: return null;
      }
    default:
      switch (name) {
        case 'FRONT': return 0.0;
        case 'BACK': return f.d;
        case 'LEFT': case 'SHIMO': return -f.w / 2.0;
        case 'RIGHT': case 'KAMI': return f.w / 2.0;
        case 'MID': return f.d / 2.0;
        case 'SHIMOWING': return -f.w / 2.0 - f.wing / 2.0;
        case 'KAMIWING': return f.w / 2.0 + f.wing / 2.0;
        default: return null;
      }
  }
}
function constantNames(f) {
  switch (f.kind) {
    case 'football': return 'FSL, FH, BH, BSL, MID / 関数 s1(ヤード), s2(ヤード), yd(ヤード数), m(メートル)';
    case 'gym': return 'FRONT, BACK, KAMI, SHIMO, MID, FRONT20, BACK20, KAMI20, SHIMO20 / 関数 kami(m), shimo(m), mae(m), oku(m)';
    case 'stage': return 'FRONT, BACK, KAMI, SHIMO, MID, KAMIWING, SHIMOWING / 関数 kami(m), shimo(m)';
    default: return 'FRONT, BACK, LEFT, RIGHT, MID / 関数 kami(m), shimo(m)';
  }
}
function inBounds(f, x, y) {
  const e = 1e-6;
  switch (f.kind) {
    case 'football': return Math.abs(x) <= 96.0 + e && y >= -e && y <= BSL + e;
    case 'floor': return Math.abs(x) <= f.w / 2.0 + e && y >= -e && y <= f.d + e;
    case 'gym': return Math.abs(x) <= f.w / 2.0 + GYM_MARGIN - 0.5 + e && Math.abs(y) <= f.d / 2.0 + GYM_MARGIN - 0.5 + e;
    default: return Math.abs(x) <= f.w / 2.0 + f.wing + e && y >= -e && y <= f.d + e;
  }
}
function describeX(f, x) {
  switch (f.kind) {
    case 'football': {
      if (Math.abs(x) < 0.05) return '50ydライン上';
      const side = x < 0.0 ? 'サイド1' : 'サイド2';
      const ax = Math.abs(x);
      const k = Math.min(rround(ax / 8.0), 10.0);
      const yl = 50.0 - 5.0 * k;
      const line = yl <= 0.0 ? 'ゴールライン' : `${Math.trunc(yl)}ydライン`;
      const off = ax - 8.0 * k;
      if (Math.abs(off) < 0.05) return `${side}: ${line}上`;
      return `${side}: ${line}から${off > 0.0 ? '外' : '内'}へ ${rfixed(Math.abs(off), 2)}歩`;
    }
    case 'floor': case 'gym':
      if (Math.abs(x) < 0.005) return 'センター';
      return `${x < 0.0 ? '下手' : '上手'} ${rfixed(Math.abs(x), 2)}m`;
    default:
      if (Math.abs(x) < 0.005) return 'センター';
      if (Math.abs(x) > f.w / 2.0 + 1e-9) return `${x < 0.0 ? '下手' : '上手'}袖（センターから ${rfixed(Math.abs(x), 2)}m）`;
      return `${x < 0.0 ? '下手' : '上手'} ${rfixed(Math.abs(x), 2)}m`;
  }
}
function describeY(f, y) {
  switch (f.kind) {
    case 'football': {
      const refs = [[0.0, 'フロントサイドライン'], [f.hash, 'フロントハッシュ'], [BSL - f.hash, 'バックハッシュ'], [BSL, 'バックサイドライン']];
      let best = refs[0];
      for (let i = 1; i < refs.length; i++) if (Math.abs(y - refs[i][0]) < Math.abs(y - best[0])) best = refs[i];
      const off = y - best[0];
      if (Math.abs(off) < 0.05) return `${best[1]}上`;
      return `${best[1]}から${off > 0.0 ? '後ろ' : '前'}へ ${rfixed(Math.abs(off), 2)}歩`;
    }
    case 'floor': return `前端から ${rfixed(y, 2)}m`;
    case 'gym':
      if (Math.abs(y) < 0.005) return 'センターライン上';
      return `センターから${y < 0.0 ? '前（客席側）' : '奥'} ${rfixed(Math.abs(y), 2)}m`;
    default:
      if (Math.abs(y) < 0.005) return '舞台前端';
      return `舞台前端から ${rfixed(y, 2)}m`;
  }
}
function describeFace(f, a) {
  if (a === null || a === undefined) return '客席向き（自動）';
  let d = a + 90.0;
  while (d > 180.0) d -= 360.0;
  while (d <= -180.0) d += 360.0;
  const [r, l] = isFootball(f) ? ['サイド2', 'サイド1'] : ['上手', '下手'];
  const near = (x) => Math.abs(d - x) < 0.5;
  if (near(0.0)) return '客席向き';
  if (near(180.0) || near(-180.0)) return '奥向き';
  if (near(90.0)) return `${r}向き`;
  if (near(-90.0)) return `${l}向き`;
  if (Math.abs(d) < 90.0) return `客席から${d > 0.0 ? r : l}側へ ${rfixed(Math.abs(d), 0)}°`;
  return `奥から${d > 0.0 ? r : l}側へ ${rfixed(180.0 - Math.abs(d), 0)}°`;
}
function describeStep(f, perCount) {
  if (perCount < 1e-6) return '静止';
  if (isFootball(f)) return `${rfixed(8.0 / perCount, 1)} to 5`;
  return `歩幅 ${rfixed(perCount * 100.0, 0)}cm`;
}

// ============================================================ geom
const dist = (a, b) => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function gLine(a, b, n) {
  if (n === 1) return [[(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
function gArc(c, r, a1, a2, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = toRad(a1 + (a2 - a1) * t);
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}
function gCircle(c, r, start, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = toRad(start + 360.0 * i / n);
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}
function gBlock(c, cols, sp, rsp, n) {
  cols = Math.max(cols, 1);
  const rows = Math.ceil(n / cols);
  const v = [];
  for (let k = 0; k < rows; k++) {
    const cnt = Math.min(cols, n - k * cols);
    const y = c[1] + (k - (rows - 1) / 2.0) * rsp;
    for (let j = 0; j < cnt; j++) {
      const x = c[0] + (j - (cnt - 1) / 2.0) * sp;
      v.push([x, y]);
    }
  }
  return v;
}
function gResample(pts, n) {
  if (pts.length === 1) { const o = []; for (let i = 0; i < n; i++) o.push(pts[0]); return o; }
  const cum = [0.0];
  for (let i = 0; i + 1 < pts.length; i++) {
    const w0 = pts[i], w1 = pts[i + 1];
    const d = Math.sqrt((w1[0] - w0[0]) * (w1[0] - w0[0]) + (w1[1] - w0[1]) * (w1[1] - w0[1]));
    cum.push(cum[cum.length - 1] + d);
  }
  const total = cum[cum.length - 1];
  const out = [];
  for (let i = 0; i < n; i++) {
    const target = n === 1 ? total / 2.0 : total * i / (n - 1);
    // partition_point(c < target)
    let lo = 0, hi = cum.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
    let j = Math.min(Math.max(lo, 1), pts.length - 1);
    while (j > 1 && cum[j - 1] > target) j--;
    const seg = cum[j] - cum[j - 1];
    const t = seg > 0.0 ? (target - cum[j - 1]) / seg : 0.0;
    const a = pts[j - 1], b = pts[j];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
function gCurve(pts, n) {
  if (pts.length < 3) return gResample(pts, n);
  const m = pts.length;
  const g = (i) => {
    if (i < 0) return [2.0 * pts[0][0] - pts[1][0], 2.0 * pts[0][1] - pts[1][1]];
    if (i >= m) return [2.0 * pts[m - 1][0] - pts[m - 2][0], 2.0 * pts[m - 1][1] - pts[m - 2][1]];
    return pts[i];
  };
  const dense = [];
  const K = 200;
  for (let s = 0; s < m - 1; s++) {
    const p0 = g(s - 1), p1 = g(s), p2 = g(s + 1), p3 = g(s + 2);
    for (let k = 0; k < K; k++) {
      const t = k / K;
      const t2 = t * t, t3 = t * t * t;
      const f = (a, b, c, d) => 0.5 * (2.0 * b + (-a + c) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (-a + 3.0 * b - 3.0 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(pts[m - 1]);
  return gResample(dense, n);
}
function centroid(v) {
  const n = Math.max(v.length, 1);
  let sx = 0, sy = 0;
  for (const p of v) sx += p[0];
  for (const p of v) sy += p[1];
  return [sx / n, sy / n];
}
function rotated(v, deg, about) {
  const r = toRad(deg);
  const s = Math.sin(r), c = Math.cos(r);
  return v.map((p) => {
    const dx = p[0] - about[0], dy = p[1] - about[1];
    return [about[0] + dx * c - dy * s, about[1] + dx * s + dy * c];
  });
}

function hungarian(cost) {
  const n = cost.length;
  const inf = Infinity;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(inf);
    const used = new Array(n + 1).fill(false);
    for (;;) {
      used[j0] = true;
      const i0 = p[j0];
      let delta = inf, j1 = 0;
      const row = cost[i0 - 1];
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = row[j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
      if (p[j0] === 0) break;
    }
    for (;;) {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
      if (j0 === 0) break;
    }
  }
  const ans = new Array(n).fill(0);
  for (let j = 1; j <= n; j++) if (p[j] !== 0) ans[p[j] - 1] = j - 1;
  return ans;
}
function gAssign(from, to) {
  const cost = from.map((a) => to.map((b) => { const d = dist(a, b); return d + 1e-6 * d * d; }));
  return hungarian(cost);
}

function polyLen(r) {
  let s = 0;
  for (let i = 0; i + 1 < r.length; i++) s += dist(r[i], r[i + 1]);
  return s;
}
function polyAt(r, u) {
  const total = polyLen(r);
  if (r.length < 2 || total < 1e-12) return r.length ? r[r.length - 1] : [0.0, 0.0];
  let left = total * clamp(u, 0.0, 1.0);
  for (let i = 0; i + 1 < r.length; i++) {
    const w0 = r[i], w1 = r[i + 1];
    const d = dist(w0, w1);
    if (left <= d) {
      const t = d > 0.0 ? left / d : 0.0;
      return [w0[0] + (w1[0] - w0[0]) * t, w0[1] + (w1[1] - w0[1]) * t];
    }
    left -= d;
  }
  return r[r.length - 1];
}
function polyCut(r, len) {
  const out = [r[0]];
  let left = Math.max(len, 0.0);
  for (let i = 0; i + 1 < r.length; i++) {
    const w0 = r[i], w1 = r[i + 1];
    const d = dist(w0, w1);
    if (left <= d) {
      const t = d > 0.0 ? left / d : 0.0;
      out.push([w0[0] + (w1[0] - w0[0]) * t, w0[1] + (w1[1] - w0[1]) * t]);
      return out;
    }
    out.push(w1);
    left -= d;
  }
  return out;
}
function arcPoint(a, b, bend, u) {
  const d0 = b[0] - a[0], d1 = b[1] - a[1];
  const l = Math.sqrt(d0 * d0 + d1 * d1);
  if (Math.abs(bend) < 1e-6 || l < 1e-9) return [a[0] + d0 * u, a[1] + d1 * u];
  const th = toRad(Math.min(Math.abs(bend), 179.0));
  const s = -Math.sign(bend);
  const dh = [d0 / l, d1 / l];
  const rot = (v, ang) => [v[0] * Math.cos(ang) - v[1] * Math.sin(ang), v[0] * Math.sin(ang) + v[1] * Math.cos(ang)];
  const t0 = rot(dh, -s * th / 2.0);
  const n0 = rot(t0, s * (Math.PI / 2));
  const r = l / (2.0 * Math.sin(th / 2.0));
  const ph = th * u;
  return [a[0] + r * (Math.sin(ph) * t0[0] + (1.0 - Math.cos(ph)) * n0[0]), a[1] + r * (Math.sin(ph) * t0[1] + (1.0 - Math.cos(ph)) * n0[1])];
}
function pathLen(a, b, bend) {
  const l = dist(a, b);
  if (Math.abs(bend) < 1e-6) return l;
  const th = toRad(Math.min(Math.abs(bend), 179.0));
  return l * th / (2.0 * Math.sin(th / 2.0));
}

// Mv = {a, b, w, e, bend, route}
function mvLength(m) { return m.route ? polyLen(m.route) : pathLen(m.a, m.b, m.bend); }
function mvBbox(m) {
  const r = m.route;
  if (r) {
    let x0 = Number.MAX_VALUE, x1 = -Number.MAX_VALUE, y0 = Number.MAX_VALUE, y1 = -Number.MAX_VALUE;
    for (const p of r) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    return [x0, x1, y0, y1];
  }
  const pad = Math.abs(m.bend) >= 1e-6 ? dist(m.a, m.b) * 0.5 * Math.min(Math.abs(Math.tan(toRad(Math.min(Math.abs(m.bend), 179.0)) / 2.0)), 50.0) : 0.0;
  return [Math.min(m.a[0], m.b[0]) - pad, Math.max(m.a[0], m.b[0]) + pad, Math.min(m.a[1], m.b[1]) - pad, Math.max(m.a[1], m.b[1]) + pad];
}
/** 外接矩形が cl 以上離れていれば、最接近距離は cl 以上（警告対象外）なので厳密判定を省ける */
function mvFar(m, o, cl) {
  const a = m.bb || (m.bb = mvBbox(m)), b = o.bb || (o.bb = mvBbox(o));
  return a[1] + cl <= b[0] || b[1] + cl <= a[0] || a[3] + cl <= b[2] || b[3] + cl <= a[2];
}
function mvU(m, t) {
  if (m.e - m.w <= 0.0) return 1.0;
  return clamp((t - m.w) / (m.e - m.w), 0.0, 1.0);
}
/** arcPoint と同じ計算（円弧の定数部分を Mv にキャッシュ） */
function mvAt(m, t) {
  if (m.route) return polyAt(m.route, mvU(m, t));
  let ap = m.ap;
  if (ap === undefined) {
    const a = m.a, b = m.b, bend = m.bend;
    const d0 = b[0] - a[0], d1 = b[1] - a[1];
    const l = Math.sqrt(d0 * d0 + d1 * d1);
    if (Math.abs(bend) < 1e-6 || l < 1e-9) ap = m.ap = null;
    else {
      const th = toRad(Math.min(Math.abs(bend), 179.0));
      const sg = -Math.sign(bend);
      const dh0 = d0 / l, dh1 = d1 / l;
      const ang0 = -sg * th / 2.0;
      const c0 = Math.cos(ang0), s0 = Math.sin(ang0);
      const t00 = dh0 * c0 - dh1 * s0, t01 = dh0 * s0 + dh1 * c0;
      const ang1 = sg * (Math.PI / 2);
      const c1 = Math.cos(ang1), s1 = Math.sin(ang1);
      const n00 = t00 * c1 - t01 * s1, n01 = t00 * s1 + t01 * c1;
      ap = m.ap = { th, t00, t01, n00, n01, r: l / (2.0 * Math.sin(th / 2.0)), d0, d1 };
    }
  }
  const u = mvU(m, t);
  if (ap === null) return [m.a[0] + (m.b[0] - m.a[0]) * u, m.a[1] + (m.b[1] - m.a[1]) * u];
  const ph = ap.th * u;
  const sp = Math.sin(ph), cp = 1.0 - Math.cos(ph);
  return [m.a[0] + ap.r * (sp * ap.t00 + cp * ap.n00), m.a[1] + ap.r * (sp * ap.t01 + cp * ap.n01)];
}
function mvCurved(m) { return !m.route && Math.abs(m.bend) >= 1e-6 && dist(m.a, m.b) > 1e-9; }
function mvTimes(m, out) {
  out.push(m.w);
  out.push(m.e);
  if (m.route) {
    const r = m.route;
    const total = polyLen(r);
    if (total > 1e-12) {
      let acc = 0.0;
      for (let i = 0; i + 1 < r.length; i++) {
        acc += dist(r[i], r[i + 1]);
        out.push(m.w + (m.e - m.w) * acc / total);
      }
    }
  } else if (mvCurved(m)) {
    for (let j = 1; j < 16; j++) out.push(m.w + (m.e - m.w) * j / 16.0);
  }
}
/** 2人の動きの最接近距離と時刻 [距離, 時刻] */
function closest(a, b, c) {
  let cuts = [0.0, Math.max(c, 0.0)];
  mvTimes(a, cuts);
  mvTimes(b, cuts);
  const cm = Math.max(c, 0.0);
  cuts = cuts.filter((t) => t >= 0.0 && t <= cm);
  cuts.sort((x, y) => x - y);
  const dd = [];
  for (const t of cuts) {
    if (dd.length && Math.abs(t - dd[dd.length - 1]) < 1e-12) continue;
    dd.push(t);
  }
  cuts = dd;
  let best = Number.MAX_VALUE, bestT = c;
  if (cuts.length === 1) {
    const pa = mvAt(a, cuts[0]), pb = mvAt(b, cuts[0]);
    return [dist(pa, pb), cuts[0]];
  }
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i], t1 = cuts[i + 1];
    const pa0 = mvAt(a, t0), pb0 = mvAt(b, t0), pa1 = mvAt(a, t1), pb1 = mvAt(b, t1);
    const d0x = pa0[0] - pb0[0], d0y = pa0[1] - pb0[1];
    const d1x = pa1[0] - pb1[0], d1y = pa1[1] - pb1[1];
    const dvx = d1x - d0x, dvy = d1y - d0y;
    const vv = dvx * dvx + dvy * dvy;
    const u = vv < 1e-12 ? 1.0 : clamp(-(d0x * dvx + d0y * dvy) / vv, 0.0, 1.0);
    const ex = d0x + dvx * u, ey = d0y + dvy * u;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best - 1e-12) { best = d; bestT = t0 + (t1 - t0) * u; }
  }
  return [best, bestT];
}
function assignAvoiding(from, to, w, e, bend, others, c, clearance) {
  const obox = others.map(mvBbox);
  const cost = from.map((a) => to.map((b) => {
    const d = dist(a, b);
    let cst = d + 1e-6 * d * d;
    const me = { a, b, w, e, bend, route: null };
    let [minx, maxx, miny, maxy] = mvBbox(me);
    minx -= clearance; maxx += clearance; miny -= clearance; maxy += clearance;
    for (let oi = 0; oi < others.length; oi++) {
      const ob = obox[oi];
      if (ob[1] < minx || ob[0] > maxx || ob[3] < miny || ob[2] > maxy) continue;
      const dd = closest(me, others[oi], c)[0];
      if (dd < clearance) cst += 1000.0 * (1.0 + clearance - dd);
    }
    return cst;
  }));
  return hungarian(cost);
}

// ============================================================ build
const PALETTE = ['#e6194b', '#3cb4ff', '#ffe119', '#f58231', '#a66cff', '#3cd070', '#f032e6', '#bcf60c', '#fabebe', '#ffffff'];

function evalE(field, e) {
  switch (e.k) {
    case 'num': return e.v;
    case 'neg': return -evalE(field, e.a);
    case 'bin': {
      const x = evalE(field, e.a), y = evalE(field, e.b);
      switch (e.op) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        default: return x / y;
      }
    }
    case 'name': {
      const v = fconst(field, e.n);
      if (v === null) throw at_(e.pos.line, e.pos.col, `「${e.n}」はこのフィールドでは使えません（使えるもの: ${constantNames(field)}）`);
      return v;
    }
    default: { // call
      const f = e.n, args = e.args, p = e.pos;
      const need = (k) => { if (args.length !== k) throw at_(p.line, p.col, `${f} の引数は${k}個です`); };
      const fb = isFootball(field);
      if ((f === 's1' || f === 's2') && fb) {
        need(1);
        const y = evalE(field, args[0]);
        if (!(y >= 0.0 && y <= 50.0)) throw at_(p.line, p.col, 'ヤードラインは0〜50で指定してください');
        const x = (50.0 - y) * 1.6;
        return f === 's1' ? -x : x;
      }
      if (f === 'yd' && fb) { need(1); return evalE(field, args[0]) * 1.6; }
      if (f === 'm') { need(1); return evalE(field, args[0]) / field.unit_m; }
      if ((f === 'kami' || f === 'oku') && !fb) { need(1); return evalE(field, args[0]); }
      if ((f === 'shimo' || f === 'mae') && !fb) { need(1); return -evalE(field, args[0]); }
      throw at_(p.line, p.col, `関数「${f}」はこのフィールドでは使えません（使えるもの: ${constantNames(field)}）`);
    }
  }
}
const evalPt = (field, p) => { const x = evalE(field, p[0]); return [x, evalE(field, p[1])]; };

function resolveGroup(terms, performers, secs, ids) {
  const out = [];
  const add = (i) => { if (out.indexOf(i) < 0) out.push(i); };
  for (const t of terms) {
    if (t.k === 'all') {
      for (let i = 0; i < performers.length; i++) add(i);
    } else if (t.k === 'name') {
      if (secs.has(t.n)) {
        const s = secs.get(t.n);
        for (let i = 0; i < performers.length; i++) if (performers[i].section === s) add(i);
      } else if (ids.has(t.n)) add(ids.get(t.n));
      else throw at_(t.pos.line, t.pos.col, `「${t.n}」というセクション・メンバーはいません`);
    } else {
      if (!ids.has(t.a) || !ids.has(t.b)) throw at_(t.pos.line, t.pos.col, `${t.a}..${t.b} のメンバーが見つかりません`);
      const ia = ids.get(t.a), ib = ids.get(t.b);
      if (performers[ia].section !== performers[ib].section || ia > ib) {
        throw at_(t.pos.line, t.pos.col, `${t.a}..${t.b} は同じセクション内で小さい番号から指定してください`);
      }
      for (let i = ia; i <= ib; i++) add(i);
    }
  }
  return out;
}

function mvOf(i, pv, pos, tm) {
  return { a: pv[i], b: pos[i], w: tm.wait[i], e: tm.end[i], bend: tm.bend[i], route: tm.route[i] };
}
function pathCost(i, mvs, c, cl) {
  const me = mvs[i];
  let cost = mvLength(me);
  for (let k = 0; k < mvs.length; k++) {
    if (k === i) continue;
    if (mvFar(me, mvs[k], cl)) continue;
    const d = closest(me, mvs[k], c)[0];
    if (d < cl) cost += 1000.0 * (1.0 + cl - d);
  }
  return cost;
}
function untangle(group, pv, pos, tm, c, cl) {
  const mvs = pos.map((_, i) => mvOf(i, pv, pos, tm));
  const refresh = (i) => { mvs[i] = mvOf(i, pv, pos, tm); };
  for (let it = 0; it < 50; it++) {
    let improved = false;
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        const a = group[x], b = group[y];
        if (mvFar(mvs[a], mvs[b], cl)) continue;
        const d = closest(mvs[a], mvs[b], c)[0];
        if (d >= cl) continue;
        const before = pathCost(a, mvs, c, cl) + pathCost(b, mvs, c, cl);
        let t = pos[a]; pos[a] = pos[b]; pos[b] = t;
        refresh(a); refresh(b);
        const after = pathCost(a, mvs, c, cl) + pathCost(b, mvs, c, cl);
        if (after + 1e-9 < before) improved = true;
        else { t = pos[a]; pos[a] = pos[b]; pos[b] = t; refresh(a); refresh(b); }
      }
    }
    if (!improved) break;
  }
}

// ---------------------------------------------------------------- 楽器（src/instruments.rs）
const INSTRUMENTS = [
  ['trumpet', 'トランペット'], ['mellophone', 'メロフォン'], ['marching_horn', 'マーチングホルン'], ['horn', 'ホルン'],
  ['trombone', 'トロンボーン'], ['euphonium', 'ユーフォニアム'], ['marching_euphonium', 'マーチングユーフォニアム'],
  ['tuba', 'チューバ'], ['marching_tuba', 'マーチングチューバ'], ['sousaphone', 'スーザフォン'],
  ['piccolo', 'ピッコロ'], ['flute', 'フルート'], ['oboe', 'オーボエ'], ['bassoon', 'ファゴット'],
  ['eb_clarinet', 'E♭クラリネット'], ['clarinet', 'クラリネット'], ['alto_clarinet', 'アルトクラリネット'], ['bass_clarinet', 'バスクラリネット'],
  ['soprano_sax', 'ソプラノサックス'], ['alto_sax', 'アルトサックス'], ['tenor_sax', 'テナーサックス'], ['baritone_sax', 'バリトンサックス'],
  ['snare', 'スネアドラム'], ['tenors', 'テナードラム'], ['bass_drum', 'バスドラム（メンバー順に小→大）'],
  ['bass1', 'バスドラム1（最小）'], ['bass2', 'バスドラム2'], ['bass3', 'バスドラム3'], ['bass4', 'バスドラム4'], ['bass5', 'バスドラム5（最大）'],
  ['cymbals_mid', 'シンバル（ミドルポジション）'], ['cymbals_high', 'シンバル（ハイポジション）'],
  ['glockenspiel', 'グロッケン'], ['xylophone', 'シロフォン'], ['flag', 'カラーガード（フラッグ）'], ['none', '楽器なし'],
];
function instrumentIsId(s) { return INSTRUMENTS.some((x) => x[0] === s); }
const ID_INSTR = {
  tp: 'trumpet', tpt: 'trumpet', mel: 'mellophone', mello: 'mellophone', hn: 'horn', hr: 'horn', tb: 'trombone', tbn: 'trombone',
  eu: 'euphonium', euph: 'euphonium', bar: 'euphonium', tu: 'tuba', tuba: 'tuba', sou: 'sousaphone', sz: 'sousaphone',
  fl: 'flute', pic: 'piccolo', ob: 'oboe', fg: 'bassoon', bsn: 'bassoon', cl: 'clarinet', bcl: 'bass_clarinet',
  sx: 'alto_sax', as: 'alto_sax', ts: 'tenor_sax', bs: 'baritone_sax', sn: 'snare', sd: 'snare', td: 'tenors', qd: 'tenors',
  bd: 'bass_drum', cy: 'cymbals_mid', cym: 'cymbals_mid', gl: 'glockenspiel', glk: 'glockenspiel', xy: 'xylophone', xyl: 'xylophone',
  cg: 'flag', gd: 'flag', pc: 'snare', perc: 'snare', ww: 'clarinet',
};
function detectInstrument(label, id) {
  const l = label.toLowerCase();
  const has = (ws) => ws.some((w) => l.includes(w));
  const sax = has(['サックス', 'サクソフォン', 'sax']);
  if (has(['ガード', 'guard', 'フラッグ', 'flag'])) return 'flag';
  if (has(['バスドラ', 'bass drum', 'bassdrum'])) {
    for (const [d, idd] of [['1', 'bass1'], ['2', 'bass2'], ['3', 'bass3'], ['4', 'bass4'], ['5', 'bass5']]) if (l.endsWith(d)) return idd;
    return 'bass_drum';
  }
  if (has(['テナードラム', 'クイント', 'クワッド', 'quad', 'quint', 'tenor drum']) || (has(['テナー', 'tenor']) && !sax)) return 'tenors';
  if (has(['スネア', 'snare'])) return 'snare';
  if (has(['シンバル', 'cymbal'])) return has(['ハイ', 'high']) ? 'cymbals_high' : 'cymbals_mid';
  if (has(['グロッケン', 'ベルリラ', 'glock', 'lyre', '鉄琴'])) return 'glockenspiel';
  if (has(['シロフォン', '木琴', 'xylo', 'マリンバ', 'marimba'])) return 'xylophone';
  if (has(['スーザ', 'sousa'])) return 'sousaphone';
  if (has(['マーチングチューバ', 'marching tuba', '低音'])) return 'marching_tuba';
  if (has(['チューバ', 'テューバ', 'tuba'])) return 'tuba';
  if (has(['マーチングユーフォ', 'マーチングバリトン', 'marching euph', 'marching baritone'])) return 'marching_euphonium';
  if (has(['ユーフォ', 'euph']) || (has(['バリトン', 'baritone']) && !sax)) return 'euphonium';
  if (has(['マーチングホルン', 'marching horn'])) return 'marching_horn';
  if (has(['メロフォン', 'mello'])) return 'mellophone';
  if (has(['ホルン', 'horn'])) return 'horn';
  if (has(['トロンボーン', 'trombone'])) return 'trombone';
  if (has(['トランペット', 'コルネット', 'フリューゲル', 'trumpet', 'cornet', 'flugel'])) return 'trumpet';
  if (has(['ピッコロ', 'piccolo'])) return 'piccolo';
  if (has(['フルート', 'flute'])) return 'flute';
  if (has(['オーボエ', 'oboe'])) return 'oboe';
  if (has(['ファゴット', 'バスーン', 'bassoon', 'fagott'])) return 'bassoon';
  if (sax) {
    if (has(['ソプラノ', 'soprano'])) return 'soprano_sax';
    if (has(['テナー', 'tenor'])) return 'tenor_sax';
    if (has(['バリトン', 'バリサク', 'baritone', 'bari'])) return 'baritone_sax';
    return 'alto_sax';
  }
  if (has(['クラ', 'clarinet'])) {
    if (has(['エスクラ', 'esクラ', 'e♭', 'eb', 'es '])) return 'eb_clarinet';
    if (has(['バスクラ', 'bass clar'])) return 'bass_clarinet';
    if (has(['アルトクラ', 'alto clar'])) return 'alto_clarinet';
    return 'clarinet';
  }
  if (has(['打楽器', 'パーカッション', 'バッテリー', 'ドラム', 'perc', 'drum', 'battery'])) return 'snare';
  if (has(['木管', 'woodwind'])) return 'clarinet';
  if (has(['金管', 'brass'])) return 'trumpet';
  const k = id.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ID_INSTR, k) ? ID_INSTR[k] : 'none';
}

function build(a) {
  const field = mkField(a.field);
  const ev = (e) => evalE(field, e);
  const pt = (p) => evalPt(field, p);
  const sections = [];
  const performers = [];
  const secs = new Map();
  const ids = new Map();
  a.sections.forEach((s, si) => {
    if (secs.has(s.id)) throw at_(s.pos.line, s.pos.col, `セクション「${s.id}」が重複しています`);
    secs.set(s.id, si);
    sections.push({ id: s.id, label: s.label, color: s.color !== null ? s.color : PALETTE[si % PALETTE.length], color_given: s.color !== null, instrument: s.instrument !== null ? s.instrument : detectInstrument(s.label, s.id) });
    for (let k = 1; k <= s.n; k++) {
      const id = `${s.id}${k}`;
      if (ids.has(id)) throw at_(s.pos.line, s.pos.col, `メンバー名「${id}」が重複します（セクション名を変えてください）`);
      ids.set(id, performers.length);
      performers.push({ id, section: si });
    }
  });
  if (performers.length === 0) throw at_(0, 0, 'section がありません');
  if (a.sets.length === 0) throw at_(0, 0, 'set がありません');

  const n = performers.length;
  const sets = [];
  const allHandles = [], allMembers = [], allOwner = [];
  let curTempo = a.tempo;
  let start = 0.0;
  const fb = isFootball(field);
  for (let k = 0; k < a.sets.length; k++) {
    const sa = a.sets[k];
    const prev = sets.length ? sets[sets.length - 1].pos : null;
    const recs = [];
    const setHandles = [], setMembers = [];
    for (const st of sa.stmts) {
      const group = resolveGroup(st.group, performers, secs, ids);
      let tw = 0.0, te = sa.counts;
      let tb = 0.0;
      if (st.bend !== null) {
        const v = ev(st.bend);
        if (Math.abs(v) >= 180.0) throw at_(st.pos.line, st.pos.col, 'bend は -179〜179 度にしてください');
        if (k === 0 && v !== 0.0) throw at_(st.pos.line, st.pos.col, '最初のセットでは bend は使えません');
        tb = v;
      }
      if (st.wait !== null || st.within !== null) {
        if (k === 0) throw at_(st.pos.line, st.pos.col, '最初のセットでは wait / in は使えません');
        const w = st.wait !== null ? ev(st.wait) : 0.0;
        const d = st.within !== null ? ev(st.within) : sa.counts - w;
        if (w < 0.0 || d <= 0.0 || w + d > sa.counts + 1e-9) {
          throw at_(st.pos.line, st.pos.col, `wait ${fdisp(w)} + in ${fdisp(d)} がセットの counts（${fdisp(sa.counts)}）に収まりません`);
        }
        tw = w;
        te = w + d;
      }
      const g = group.length;
      const sh = st.shape;
      const isSame = sh.k === 'same';
      const h = (r, p) => [r, p[0], p[1]];
      let handles;
      switch (sh.k) {
        case 'line': { const a1 = pt(sh.a); const b1 = pt(sh.b); handles = [h('a', a1), h('b', b1)]; break; }
        case 'arc': {
          const c = pt(sh.c); const r = ev(sh.r);
          const atd = (deg) => [c[0] + r * Math.cos(toRad(deg)), c[1] + r * Math.sin(toRad(deg))];
          const p1 = atd(ev(sh.a1)); const p2 = atd(ev(sh.a2));
          handles = [h('c', c), h('a1', p1), h('a2', p2)];
          break;
        }
        case 'circle': {
          const c = pt(sh.c); const r = ev(sh.r);
          const s0 = sh.start !== null ? ev(sh.start) : 270.0;
          handles = [h('c', c), h('r', [c[0] + r * Math.cos(toRad(s0)), c[1] + r * Math.sin(toRad(s0))])];
          break;
        }
        case 'block': handles = [h('c', pt(sh.c))]; break;
        case 'curve': case 'poly': case 'follow': {
          handles = [];
          sh.pts.forEach((p, i) => { const x = ev(p[0]); handles.push([`p${i}`, x, ev(p[1])]); });
          break;
        }
        case 'at': handles = [h('p', pt(sh.p))]; break;
        default: handles = [];
      }
      setHandles.push(handles);
      setMembers.push(group.slice());

      // 空き: 席数 = 人数 + 空きの数。席の並びは変えず、空けた席だけ取り除く
      const skips = st.skip;
      if (skips.length) {
        if (['at', 'same', 'follow', 'attr'].includes(sh.k)) throw at_(st.pos.line, st.pos.col, 'skip（空き）は line / arc / circle / block / curve / poly の隊形で使えます');
        const total = g + skips.length;
        const bad = skips.find((x) => x > total);
        if (bad !== undefined) throw at_(st.pos.line, st.pos.col, `skip（空き）の席 ${bad} が席数（${g}人 + 空き${skips.length} = ${total}）を超えています`);
      }
      const gt = g + skips.length;
      let spots;
      switch (sh.k) {
        case 'line': { const p1 = pt(sh.a); const p2 = pt(sh.b); spots = gLine(p1, p2, gt); break; }
        case 'arc': { const c = pt(sh.c); const r = ev(sh.r); const a1 = ev(sh.a1); const a2 = ev(sh.a2); spots = gArc(c, r, a1, a2, gt); break; }
        case 'circle': {
          const s0 = sh.start !== null ? ev(sh.start) : 270.0;
          const c = pt(sh.c); const r = ev(sh.r);
          spots = gCircle(c, r, s0, gt);
          break;
        }
        case 'block': {
          const cols = ev(sh.cols);
          if (cols < 1.0) throw at_(st.pos.line, st.pos.col, 'cols は1以上にしてください');
          const def = fb ? 2.0 : 1.5;
          const sp = sh.spacing !== null ? ev(sh.spacing) : def;
          const rsp = sh.rowsp !== null ? ev(sh.rowsp) : sp;
          spots = gBlock(pt(sh.c), rround(cols), sp, rsp, gt);
          break;
        }
        case 'curve': spots = gCurve(sh.pts.map(pt), gt); break;
        case 'poly': spots = gResample(sh.pts.map(pt), gt); break;
        case 'at':
          if (g !== 1) throw at_(st.pos.line, st.pos.col, `at は1人用です（${g}人指定されています）`);
          spots = [pt(sh.p)];
          break;
        case 'same':
          if (prev === null) throw at_(st.pos.line, st.pos.col, '最初のセットでは same は使えません');
          spots = group.map((i) => prev[i]);
          break;
        case 'attr': spots = []; break;
        default: spots = sh.pts.map(pt); // follow
      }
      for (const x of st.xf) {
        if (x.k === 'rotate') {
          const c = x.about !== null ? pt(x.about) : centroid(spots);
          spots = rotated(spots, ev(x.a), c);
        } else if (x.k === 'shift') {
          const d = pt(x.d);
          spots = spots.map((p) => [p[0] + d[0], p[1] + d[1]]);
        } else {
          const s = ev(x.s);
          const c = centroid(spots);
          spots = spots.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s]);
        }
      }
      if (spots.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
        throw at_(st.pos.line, st.pos.col, '座標が計算できません（0で割っていませんか）');
      }
      const cenFull = skips.length ? centroid(spots) : null;
      const keep = [];
      for (let i = 0; i < spots.length; i++) if (!skips.includes(i + 1)) keep.push(i);
      if (skips.length) spots = keep.map((i) => spots[i]);
      let routes = null;
      if (sh.k === 'follow') {
        if (prev === null) throw at_(st.pos.line, st.pos.col, '最初のセットでは follow は使えません');
        const r = spots.slice();
        const sp = sh.spacing !== null ? ev(sh.spacing) : (fb ? 2.0 : 1.2);
        let order;
        if (st.assign === 'keep') {
          order = [];
          for (let i = 0; i < g; i++) order.push(i);
        } else {
          const left = [];
          for (let i = 0; i < g; i++) left.push(i);
          order = [];
          let cur = r[0];
          while (left.length) {
            let j = 0;
            let bd = dist(prev[group[left[0]]], cur);
            for (let x = 1; x < left.length; x++) {
              const dx = dist(prev[group[left[x]]], cur);
              if (dx < bd) { bd = dx; j = x; }
            }
            const gi = left.splice(j, 1)[0];
            cur = prev[group[gi]];
            order.push(gi);
          }
        }
        const leadTrail = [prev[group[order[0]]]].concat(r);
        const lLead = polyLen(leadTrail);
        const fin = new Array(g);
        const rts = new Array(g);
        for (let j = 0; j < order.length; j++) {
          const gi = order[j];
          let trail = [];
          for (let q = j; q >= 0; q--) trail.push(prev[group[order[q]]]);
          const chain = polyLen(trail);
          trail = trail.concat(r);
          const path = polyCut(trail, chain + Math.max(lLead - j * sp, 0.0));
          fin[gi] = path[path.length - 1];
          rts[gi] = path;
        }
        spots = fin;
        routes = rts;
      }
      const mode = st.assign !== null ? st.assign : (isSame ? 'keep' : 'auto');
      const isAttr = sh.k === 'attr';
      const auto = prev !== null && mode === 'auto' && routes === null && !isAttr;
      let order;
      if (isAttr) {
        order = [];
      } else if (prev !== null && auto) {
        order = gAssign(group.map((i) => prev[i]), spots);
      } else {
        order = [];
        for (let i = 0; i < g; i++) order.push(i);
      }
      const assigned = [];
      if (!isAttr) for (let gi = 0; gi < g; gi++) assigned.push(spots[order[gi]]);
      const cen = isAttr ? [0, 0] : (skips.length ? cenFull : centroid(spots));
      let face;
      if (st.face === null) {
        face = st.step === 'slide' ? { t: 'angle', v: -90.0 } : { t: 'auto' };
      } else if (st.face.k === 'named') {
        switch (st.face.n) {
          case 'front': face = { t: 'angle', v: -90.0 }; break;
          case 'back': face = { t: 'angle', v: 90.0 }; break;
          case 'kami': face = { t: 'angle', v: 0.0 }; break;
          case 'shimo': face = { t: 'angle', v: 180.0 }; break;
          case 'center': face = { t: 'center', v: cen }; break;
          case 'out': face = { t: 'out', v: cen }; break;
          default: face = { t: 'auto' };
        }
      } else if (st.face.k === 'toward') {
        face = { t: 'toward', v: pt(st.face.p) };
      } else {
        face = { t: 'angle', v: -90.0 + ev(st.face.e) };
      }
      recs.push({ group, spots, auto, assigned, order, keep: skips.length ? keep : spots.map((_, i) => i), w: tw, e: te, bend: tb, face, routes, step: st.step, action: st.action, pose: st.pose, carry: st.carry, attr: isAttr, faceGiven: st.face !== null });
    }
    const owner = new Array(n).fill(null);
    recs.forEach((r, si) => { if (!r.attr) r.group.forEach((i, gi) => { owner[i] = [si, gi]; }); });
    const wait = new Array(n).fill(0.0);
    const end = new Array(n).fill(sa.counts);
    const bend = new Array(n).fill(0.0);
    const route = new Array(n).fill(null);
    const step = new Array(n).fill(null);
    const action = new Array(n).fill(null);
    const pose = new Array(n).fill(null);
    const carry = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (owner[i]) {
        const [si, gi] = owner[i];
        wait[i] = recs[si].w;
        end[i] = recs[si].e;
        bend[i] = recs[si].bend;
        route[i] = recs[si].routes ? recs[si].routes[gi] : null;
        step[i] = recs[si].step;
        action[i] = recs[si].action;
        pose[i] = recs[si].pose;
        carry[i] = recs[si].carry;
      }
    }
    const compose = () => {
      const o = new Array(n);
      for (let i = 0; i < n; i++) o[i] = owner[i] ? recs[owner[i][0]].assigned[owner[i][1]] : null;
      return o;
    };
    let pos0 = compose();
    let pos;
    if (prev !== null) {
      pos = pos0.map((p, i) => (p !== null ? p : prev[i]));
    } else {
      const missing = [];
      pos0.forEach((p, i) => { if (p === null) missing.push(performers[i].id); });
      if (missing.length) throw at_(sa.pos.line, sa.pos.col, `最初のセットで位置が決まっていないメンバーがいます: ${missing.join(', ')}`);
      pos = pos0;
    }
    if (prev !== null) {
      const pv = prev;
      const cl = a.clearance !== null ? a.clearance : (fb ? 1.0 : 0.6);
      for (let it = 0; it < 3; it++) {
        let changed = false;
        for (let si = 0; si < recs.length; si++) {
          if (!recs[si].auto) continue;
          const r = recs[si];
          const inGroup = new Set(r.group);
          const others = [];
          for (let i = 0; i < n; i++) {
            if (inGroup.has(i)) continue;
            others.push({ a: pv[i], b: pos[i], w: wait[i], e: end[i], bend: bend[i], route: route[i] });
          }
          const from = r.group.map((i) => pv[i]);
          const ord = assignAvoiding(from, r.spots, r.w, r.e, r.bend, others, sa.counts, cl);
          const assigned = [];
          for (let gi = 0; gi < r.group.length; gi++) assigned.push(r.spots[ord[gi]]);
          for (let gi = 0; gi < assigned.length; gi++) if (dist(assigned[gi], r.assigned[gi]) > 1e-9) { changed = true; break; }
          recs[si].assigned = assigned;
          recs[si].order = ord;
          const comp = compose();
          for (let i = 0; i < n; i++) if (comp[i] !== null) pos[i] = comp[i];
        }
        if (!changed) break;
      }
      const tm = { wait, end, bend, route };
      recs.forEach((r, si) => {
        if (r.auto) {
          const owned = r.group.filter((i) => owner[i] !== null && owner[i][0] === si);
          untangle(owned, pv, pos, tm, sa.counts, cl);
        }
      });
    }
    const counts = k === 0 ? 0.0 : sa.counts;
    if (k > 0 && counts === 0.0 && prev !== null) {
      for (let i = 0; i < n; i++) {
        if (dist(prev[i], pos[i]) > 1e-6) { throw at_(sa.pos.line, sa.pos.col, `セット${sa.name} は counts が0なのに移動があります`); }
      }
    }
    const angf = (v) => (Math.hypot(v[0], v[1]) < 1e-9 ? -90.0 : toDeg(Math.atan2(v[1], v[0])));
    let faceArr = [];
    for (let i = 0; i < n; i++) {
      if (owner[i] === null) { faceArr.push(null); continue; }
      const p = pos[i];
      const f = recs[owner[i][0]].face;
      switch (f.t) {
        case 'auto': faceArr.push(null); break;
        case 'angle': faceArr.push(f.v); break;
        case 'toward': case 'center': faceArr.push(angf([f.v[0] - p[0], f.v[1] - p[1]])); break;
        default: faceArr.push(angf([p[0] - f.v[0], p[1] - f.v[1]]));
      }
    }
    const lastSet = sets.length ? sets[sets.length - 1] : null;
    const touched = owner.map((o) => o !== null);
    // 位置を変えない指定: 後に書いたものが優先（その人の位置を決めた文より後なら上書き）
    recs.forEach((r, si) => {
      if (!r.attr) return;
      const cen = centroid(r.group.map((i) => pos[i]));
      for (const i of r.group) {
        if (owner[i] !== null && owner[i][0] > si) continue;
        if (!touched[i]) {
          if (lastSet) { faceArr[i] = lastSet.face[i]; pose[i] = lastSet.pose[i]; carry[i] = lastSet.carry[i]; }
          touched[i] = true;
        }
        if (r.faceGiven) {
          const f = r.face;
          const p = pos[i];
          switch (f.t) {
            case 'auto': faceArr[i] = null; break;
            case 'angle': faceArr[i] = f.v; break;
            case 'toward': faceArr[i] = angf([f.v[0] - p[0], f.v[1] - p[1]]); break;
            case 'center': faceArr[i] = angf([cen[0] - p[0], cen[1] - p[1]]); break;
            default: faceArr[i] = angf([p[0] - cen[0], p[1] - cen[1]]);
          }
        }
        if (r.pose !== null) pose[i] = r.pose;
        if (r.carry !== null) carry[i] = r.carry;
        if (r.step !== null) step[i] = r.step;
        if (r.action !== null) action[i] = r.action;
      }
    });
    // このセットで触れなかった人は、向きと姿勢を前のセットから引き継ぐ
    for (let i = 0; i < n; i++) {
      if (!touched[i] && lastSet) { faceArr[i] = lastSet.face[i]; pose[i] = lastSet.pose[i]; carry[i] = lastSet.carry[i]; }
    }
    // エディタ用: 文ごとに、各メンバーがその文の隊形の何番目の席（1始まり。空きを含む）にいるか
    const slots = recs.map((r, si) => {
      if (r.attr) return [];
      return r.group.map((i, gi) => {
        let j = r.order[gi];
        if (owner[i] !== null && owner[i][0] === si && owner[i][1] === gi) {
          const q = r.spots.findIndex((p) => dist(p, pos[i]) < 1e-9);
          if (q >= 0) j = q;
        }
        return r.keep[j] + 1;
      });
    });
    curTempo = sa.tempo !== null ? sa.tempo : curTempo;
    sets.push({
      name: sa.name, counts, hold: sa.hold, start, pos, wait, end, bend, face: faceArr, route, step, action, pose, carry,
      tempo: curTempo, mark: sa.mark, line: sa.pos.line, slots,
    });
    allHandles.push(setHandles);
    allMembers.push(setMembers);
    allOwner.push(owner.map((o) => (o ? o[0] : -1)));
    start += counts + sa.hold;
  }
  // ---- 楽譜パート ----
  const parts = [], partWarnings = [];
  for (const pa of a.parts) {
    const members = resolveGroup(pa.group, performers, secs, ids);
    const b = pa.body;
    let pstart = 0.0;
    if (b.start !== null) {
      if (b.start.k === 'count') pstart = b.start.v;
      else {
        const f = sets.find((x) => x.name === b.start.v);
        if (!f) throw at_(b.startPos[0], b.startPos[1], `start set「${b.start.v}」というセットがありません`);
        pstart = f.start;
      }
    }
    const pi = parts.length;
    for (const is of b.issues) {
      partWarnings.push({ part: pi, msg: `パート「${pa.name}」の${is.bar}小節目が拍子と合いません（${numS(is.got)}/${numS(is.want)}拍）`, at: pstart + is.at });
    }
    parts.push({
      name: pa.name, members, meter: b.meter || [4, 4], start: pstart, end: pstart + b.len,
      notes: b.notes.map((x) => ({ t: pstart + x.t, dur: x.dur, hand: x.hand, accent: x.accent, kind: x.kind, pad: x.pad, vel: x.vel })),
      bars: b.bars.map((x) => pstart + x),
    });
  }
  if (sets.length) {
    const lastSet = sets[sets.length - 1];
    const showEnd = lastSet.start + lastSet.counts + lastSet.hold;
    let partEnd = 0.0;
    for (const p of parts) partEnd = Math.max(partEnd, p.end);
    if (partEnd > showEnd + 1e-6) lastSet.hold += Math.ceil((partEnd - showEnd) * 1000.0) / 1000.0;
  }
  return {
    name: a.name, field, tempo: a.tempo,
    clearance: a.clearance !== null ? a.clearance : (fb ? 1.0 : 0.6),
    maxstep: a.maxstep !== null ? a.maxstep : (fb ? 6.0 : 0.8),
    look: a.look || 'real',
    sections, performers, sets, handles: allHandles, members: allMembers, owner: allOwner, parts, partWarnings,
  };
}

// ============================================================ analyze
const STEP_TXT = { back: '・バックマーチ', slide: '・スライド', jazz: '・ジャズラン', high: '・ハイステップ', glide: '・グライド' };
const POSE_TXT = {
  attention: '・姿勢: 気をつけ', rest: '・姿勢: 休め', wide: '・姿勢: 足開き', cross: '・姿勢: 足クロス', kneel: '・姿勢: 片膝つき',
  kneel2: '・姿勢: 両膝つき', lunge: '・姿勢: ランジ', crouch: '・姿勢: しゃがみ', toe: '・姿勢: つま先立ち',
};
const CARRY_TXT = { play: '・構え: 演奏', right: '・構え: 右手に持つ', left: '・構え: 左手に持つ', front: '・構え: 正面', diag: '・構え: 斜め' };
const ACTION_TXT = { spin: '・動作: スピン', toss: '・動作: トス', swing: '・動作: スイング', rest: '・動作: レスト' };

function analyze(s) {
  const f = s.field;
  const n = s.performers.length;
  const u = unitName(f);
  const warnings = [];
  const dots = [];
  for (let i = 0; i < n; i++) dots.push([]);
  const maxPerCount = [];
  for (let k = 0; k < s.sets.length; k++) {
    const set = s.sets[k];
    let mx = 0.0;
    for (let i = 0; i < n; i++) {
      const p = set.pos[i];
      let moved;
      if (k === 0) moved = 0.0;
      else if (set.route[i]) moved = polyLen(set.route[i]);
      else moved = pathLen(s.sets[k - 1].pos[i], p, set.bend[i]);
      const dur = set.end[i] - set.wait[i];
      const per = dur > 0.0 ? moved / dur : 0.0;
      mx = Math.max(mx, per);
      let stepS;
      if (k === 0) stepS = '—';
      else if ((set.wait[i] > 0.0 || set.end[i] < set.counts) && moved > 1e-9) {
        stepS = `${describeStep(f, per)}（${fmtNum(set.wait[i] + 1.0)}〜${fmtNum(set.end[i])}カウント目で移動）`;
      } else stepS = describeStep(f, per);
      if (set.route[i] && moved > 1e-9) stepS += '・フォロー';
      else if (Math.abs(set.bend[i]) > 1e-6 && moved > 1e-9) stepS += `・カーブ${fmtNum(set.bend[i])}°`;
      stepS += set.step[i] !== null && has(STEP_TXT, set.step[i]) ? STEP_TXT[set.step[i]] : '';
      stepS += set.pose[i] !== null && has(POSE_TXT, set.pose[i]) ? POSE_TXT[set.pose[i]] : '';
      stepS += set.carry[i] !== null && has(CARRY_TXT, set.carry[i]) ? CARRY_TXT[set.carry[i]] : '';
      stepS += set.action[i] !== null && has(ACTION_TXT, set.action[i]) ? ACTION_TXT[set.action[i]] : '';
      dots[i].push({ x: p[0], y: p[1], h: describeX(f, p[0]), v: describeY(f, p[1]), step: stepS, face: describeFace(f, set.face[i]), moved });
      if (k > 0 && per > 1e-9) {
        const tooBig = isFootball(f) ? 8.0 / per < s.maxstep : per > s.maxstep;
        if (tooBig) {
          warnings.push({
            set: k, kind: '大股',
            msg: `セット${set.name}: ${s.performers[i].id} の歩幅が大きすぎます（${describeStep(f, per)}、${rfixed(moved, 1)}${u}を${fmtNum(dur)}カウント）`,
            who: [i], at: set.start,
          });
        }
      }
      if (!inBounds(f, p[0], p[1])) {
        warnings.push({
          set: k, kind: '場外',
          msg: `セット${set.name}: ${s.performers[i].id} がフィールドの外です（${describeX(f, p[0])} / ${describeY(f, p[1])}）`,
          who: [i], at: set.start + set.counts,
        });
      }
    }
    maxPerCount.push(mx);
    const prev = k === 0 ? set.pos : s.sets[k - 1].pos;
    const cl = s.clearance;
    const c = set.counts;
    const mvs = [];
    for (let i = 0; i < n; i++) mvs.push({ a: prev[i], b: set.pos[i], w: set.wait[i], e: set.end[i], bend: set.bend[i], route: set.route[i] });
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (mvFar(mvs[a], mvs[b], cl)) continue;
        const [best, bestT] = closest(mvs[a], mvs[b], c);
        if (best < cl) {
          const moving = k > 0 && bestT < c - 1e-9;
          warnings.push({
            set: k, kind: '衝突',
            msg: moving
              ? `セット${set.name}への移動中（${rfixed(bestT, 1)}カウント目）: ${s.performers[a].id} と ${s.performers[b].id} が ${rfixed(best, 2)}${u} まで接近`
              : `セット${set.name}: ${s.performers[a].id} と ${s.performers[b].id} の間隔が ${rfixed(best, 2)}${u} しかありません（最低 ${fdisp(cl)}${u}）`,
            who: [a, b], at: set.start + (moving ? bestT : c),
          });
        }
      }
    }
  }
  // 楽譜パート: 拍子の合わない小節
  for (const w of s.partWarnings) {
    let k = 0;
    for (let q = s.sets.length - 1; q >= 0; q--) if (s.sets[q].start <= w.at + 1e-9) { k = q; break; }
    warnings.push({ set: k, kind: '拍子', msg: w.msg, who: s.parts[w.part].members.slice(), at: w.at });
  }
  const last = s.sets.length ? s.sets[s.sets.length - 1] : null;
  const totalCounts = last ? last.start + last.counts + last.hold : 0.0;
  return { dots, warnings, max_per_count: maxPerCount, total_counts: totalCounts };
}

// ============================================================ output（データJSON）
function minCounts(s, r, k) {
  if (k === 0) return null;
  const per = isFootball(s.field) ? 8.0 / s.maxstep : s.maxstep;
  let need = 0.0;
  for (let i = 0; i < r.dots.length; i++) {
    const d = r.dots[i];
    const v = d[k].moved > 1e-9 ? s.sets[k].wait[i] + d[k].moved / per : 0.0;
    need = Math.max(need, v);
  }
  return Math.ceil(need - 1e-9);
}

function dataJson(s, r) {
  const f = s.field;
  let field;
  switch (f.kind) {
    case 'football': field = { type: 'football', level: f.level, hash: N(f.hash), bsl: N(BSL) }; break;
    case 'floor': field = { type: 'floor', w: N(f.w), d: N(f.d) }; break;
    case 'gym': field = { type: 'gym', w: N(f.w), d: N(f.d), margin: N(GYM_MARGIN) }; break;
    default: field = { type: 'stage', w: N(f.w), d: N(f.d), wing: N(f.wing) };
  }
  const sets = s.sets.map((set, k) => {
    const mc = minCounts(s, r, k);
    return {
      name: set.name, counts: N(set.counts), hold: N(set.hold), start: N(set.start),
      min_counts: mc === null ? null : N(mc),
      max_step: k === 0 ? '—' : describeStep(f, r.max_per_count[k]),
      wait: set.wait.map(N), end: set.end.map(N), bend: set.bend.map(N),
      face: set.face.map((x) => (x === null ? null : N(x))),
      route: set.route.map((rt) => (rt === null ? null : rt.map((p) => [N(p[0]), N(p[1])]))),
      step: set.step.slice(), action: set.action.slice(), pose: set.pose.slice(), carry: set.carry.slice(),
      tempo: N(set.tempo), mark: set.mark, slots: set.slots.map((r) => r.slice()),
      pos: set.pos.map((p) => [N(p[0]), N(p[1])]),
    };
  });
  return {
    name: s.name, tempo: N(s.tempo), look: s.look, unit: unitName(f), unit_m: N(f.unit_m), clearance: N(s.clearance), field,
    total: N(r.total_counts),
    sections: s.sections.map((x) => ({ id: x.id, label: x.label, color: x.color, color_given: x.color_given, instrument: x.instrument })),
    performers: s.performers.map((p) => ({ id: p.id, sec: p.section })),
    sets,
    dots: r.dots.map((ds) => ds.map((d) => ({ h: d.h, v: d.v, step: d.step, face: d.face, moved: N(d.moved) }))),
    warnings: r.warnings.map((w) => ({ set: w.set, kind: w.kind, msg: w.msg, at: N(w.at), who: w.who.slice() })),
    parts: s.parts.map((p) => ({
      name: p.name, members: p.members.slice(), meter: [p.meter[0], p.meter[1]], start: N(p.start), end: N(p.end),
      bars: p.bars.map(N), notes: p.notes.map((n) => [N(n.t), N(n.dur), n.hand, n.accent, n.kind, n.pad, N(n.vel)]),
    })),
  };
}

// ============================================================ model（エディタ用の編集モデル）
const oe = (e) => (e === null || e === undefined ? null : exprStr(e));
const ptS = (p) => [exprStr(p[0]), exprStr(p[1])];
function shapeModel(s) {
  switch (s.k) {
    case 'line': return { kind: 'line', a: ptS(s.a), b: ptS(s.b) };
    case 'arc': return { kind: 'arc', c: ptS(s.c), r: exprStr(s.r), a1: exprStr(s.a1), a2: exprStr(s.a2) };
    case 'circle': return { kind: 'circle', c: ptS(s.c), r: exprStr(s.r), start: oe(s.start) };
    case 'block': return { kind: 'block', c: ptS(s.c), cols: exprStr(s.cols), spacing: oe(s.spacing), rows: oe(s.rowsp) };
    case 'curve': case 'poly': return { kind: s.k, pts: s.pts.map(ptS) };
    case 'at': return { kind: 'at', p: ptS(s.p) };
    case 'same': return { kind: 'same' };
    case 'attr': return { kind: 'attr' };
    default: return { kind: 'follow', pts: s.pts.map(ptS), spacing: oe(s.spacing) };
  }
}
function stmtModel(st) {
  return {
    group: st.group.map(groupTermStr).join(' + '),
    shape: shapeModel(st.shape),
    xf: st.xf.map((x) => {
      if (x.k === 'rotate') return { kind: 'rotate', a: exprStr(x.a), about: x.about ? ptS(x.about) : null };
      if (x.k === 'shift') return { kind: 'shift', d: ptS(x.d) };
      return { kind: 'scale', k: exprStr(x.s) };
    }),
    assign: st.assign, skip: st.skip.slice(),
    wait: oe(st.wait), within: oe(st.within), bend: oe(st.bend),
    face: st.face ? faceStr(st.face) : null,
    step: st.step, action: st.action, pose: st.pose, carry: st.carry,
    note: st.note.slice(), tail: st.tail, line: st.pos.line,
  };
}
function nameTok(s) {
  const ident = /^[\p{Alphabetic}_][\p{Alphabetic}\p{N}_]*$/u.test(s);
  if (ident || /^\d+(\.\d+)?$/.test(s)) return s;
  return '"' + s.replace(/"/g, '”') + '"';
}
function modelJson(a) {
  const f = a.field;
  let field;
  switch (f.k) {
    case 'football': field = { type: 'football', level: f.level }; break;
    case 'floor': field = { type: 'floor', w: Number(fmtNum(f.w)), d: Number(fmtNum(f.d)) }; break;
    case 'gym': field = { type: 'gym', w: Number(fmtNum(f.w)), d: Number(fmtNum(f.d)) }; break;
    default: field = { type: 'stage', w: Number(fmtNum(f.w)), d: Number(fmtNum(f.d)), wing: Number(fmtNum(f.wing)) };
  }
  return {
    name: a.name, header: a.header.slice(), settings_notes: a.settings_notes.slice(), foot: a.foot.slice(),
    field, field_given: a.field_given, tempo: Number(fmtNum(a.tempo)),
    clearance: a.clearance === null ? null : fmtNum(a.clearance),
    maxstep: a.maxstep === null ? null : fmtNum(a.maxstep),
    look: a.look || null,
    sections: a.sections.map((s) => ({ id: s.id, label: s.label, n: s.n, color: s.color, instrument: s.instrument, note: s.note.slice(), tail: s.tail })),
    sets: a.sets.map((s) => ({
      name: s.name, counts: Number(fmtNum(s.counts)), hold: Number(fmtNum(s.hold)),
      tempo: s.tempo === null ? null : fmtNum(s.tempo), mark: s.mark,
      note: s.note.slice(), tail: s.tail, foot: s.foot.slice(), line: s.pos.line,
      stmts: s.stmts.map(stmtModel),
    })),
    parts: a.parts.map((p) => ({
      name: p.name, group: p.group.map(groupTermStr).join(' + '),
      meter: p.body.meter ? `${p.body.meter[0]}/${p.body.meter[1]}` : null,
      start: p.body.start === null ? null : (p.body.start.k === 'count' ? fmtNum(p.body.start.v) : `set ${nameTok(p.body.start.v)}`),
      src: p.body.src, note: p.note.slice(), line: p.pos.line,
    })),
  };
}

// ============================================================ fix
function fixScore(ast) {
  let show;
  try { show = build(ast); } catch (e) { if (e instanceof JkErr) return null; throw e; }
  const r = analyze(show);
  const perSet = new Array(show.sets.length).fill(0);
  let coll = 0;
  for (const w of r.warnings) if (w.kind === '衝突') { coll++; perSet[w.set]++; }
  return [coll, r.warnings.length - coll, perSet];
}
function editText(e) {
  switch (e.t) {
    case 'wb': return `wait ${fmtNum(e.w)} bend ${fmtNum(e.b)}`;
    case 'wait': return `wait ${fmtNum(e.v)}`;
    case 'in': return `in ${fmtNum(e.v)}`;
    default: return `bend ${fmtNum(e.v)}`;
  }
}
function editExplain(e) {
  switch (e.t) {
    case 'wb': return `${fmtNum(e.w)}カウント待ってから、${e.b > 0.0 ? '左' : '右'}側にふくらむカーブ（${fmtNum(Math.abs(e.b))}°）で進む`;
    case 'wait': return `${fmtNum(e.v)}カウント待ってから出る`;
    case 'in': return `${fmtNum(e.v)}カウントで先に着く`;
    default: return `${e.v > 0.0 ? '左' : '右'}側にふくらむカーブ（${fmtNum(Math.abs(e.v))}°）で進む`;
  }
}
const numE = (v) => ({ k: 'num', v });
/** 文 si だけを差し替えた AST（他は共有） */
function withStmt(ast, k, si, st) {
  const sets = ast.sets.slice();
  const set = Object.assign({}, sets[k]);
  const stmts = set.stmts.slice();
  stmts[si] = st;
  set.stmts = stmts;
  sets[k] = set;
  return Object.assign({}, ast, { sets });
}
function autoFix(ast) {
  const sc0 = fixScore(ast);
  if (sc0 === null) return null;
  const c0 = sc0[0], o0 = sc0[1];
  let cur = ast;
  let cc = c0, co = o0, perSet = sc0[2];
  const notes = [];
  for (let k = 1; k < cur.sets.length; k++) {
    let tries = 0;
    while ((perSet[k] === undefined ? 0 : perSet[k]) > 0 && tries < 4) {
      tries++;
      const counts = cur.sets[k].counts;
      let best = null; // {c,o,cost,si,e,a,ps}
      for (let si = 0; si < cur.sets[k].stmts.length; si++) {
        const st = cur.sets[k].stmts[si];
        if (st.shape.k === 'attr' || (st.shape.k === 'same' && st.xf.length === 0)) continue;
        const cands = [];
        if (st.wait === null && st.within === null) {
          for (const w of [1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0]) if (w <= counts * 0.6) cands.push({ t: 'wait', v: w });
          for (const f of [0.5, 0.625, 0.75]) {
            const d = rround(counts * f);
            if (d >= 2.0 && d < counts) cands.push({ t: 'in', v: d });
          }
        }
        if (st.bend === null && st.shape.k !== 'follow') {
          for (const b of [30.0, -30.0, 60.0, -60.0]) {
            cands.push({ t: 'bend', v: b });
            if (st.wait === null && st.within === null) {
              for (const w of [2.0, 4.0, 8.0]) if (w <= counts * 0.6) cands.push({ t: 'wb', w, b });
            }
          }
        }
        for (const e of cands) {
          const s2 = Object.assign({}, st);
          let cost;
          switch (e.t) {
            case 'wb': s2.wait = numE(e.w); s2.bend = numE(e.b); cost = e.w + Math.abs(e.b) / 10.0 + 1.0; break;
            case 'wait': s2.wait = numE(e.v); cost = e.v; break;
            case 'in': s2.within = numE(e.v); cost = (counts - e.v) * 0.8; break;
            default: s2.bend = numE(e.v); cost = Math.abs(e.v) / 10.0;
          }
          const a = withStmt(cur, k, si, s2);
          const sc = fixScore(a);
          if (sc === null) continue;
          const c = sc[0], o = sc[1], ps = sc[2];
          const wsum = (c_, o_) => c_ * 10 + o_;
          if (c >= cc || wsum(c, o) >= wsum(cc, co)) continue;
          const better = best === null || wsum(c, o) < wsum(best.c, best.o) || (wsum(c, o) === wsum(best.c, best.o) && cost < best.cost);
          if (better) best = { c, o, cost, si, e, a, ps };
        }
      }
      if (best === null) break;
      const st = best.a.sets[k].stmts[best.si];
      const group = st.group.map(groupTermStr).join(' + ');
      notes.push(
        `セット${best.a.sets[k].name}（${st.pos.line}行目）: 「${group}」に \`${editText(best.e)}\` を追加 — ${editExplain(best.e)}（このセットの衝突 ${perSet[k]}件 → ${best.ps[k]}件${best.o > co ? `、ほかの警告 +${best.o - co}件` : ''}）`
      );
      cur = best.a;
      cc = best.c;
      co = best.o;
      perSet = best.ps;
    }
  }
  return { ast: cur, notes, before: [c0, o0], after: [cc, co] };
}

// ============================================================ 公開API
function jinkeiCompile(src) {
  let ast;
  try { ast = parse(src); } catch (e) {
    if (e instanceof JkErr) return { ok: false, stage: 'parse', error: { line: e.line, col: e.col, msg: e.msg } };
    throw e;
  }
  const model = modelJson(ast);
  let show;
  try { show = build(ast); } catch (e) {
    if (e instanceof JkErr) return { ok: false, stage: 'build', error: { line: e.line, col: e.col, msg: e.msg }, model };
    throw e;
  }
  const rep = analyze(show);
  const mins = [];
  for (let k = 0; k < show.sets.length; k++) mins.push(minCounts(show, rep, k));
  return {
    ok: true, model, data: dataJson(show, rep),
    handles: show.handles, members: show.members, owner: show.owner, min_counts: mins,
  };
}
function jinkeiFix(src) {
  let r = null;
  try { const ast = parse(src); r = autoFix(ast); } catch (e) { if (!(e instanceof JkErr)) throw e; }
  if (r === null) return { ok: false, error: 'エラーを直してから実行してください' };
  return { ok: true, model: modelJson(r.ast), notes: r.notes, before: r.before[0], after: r.after[0], others: [r.before[1], r.after[1]] };
}
function jinkeiModel(src) {
  try { return modelJson(parse(src)); } catch (e) {
    if (e instanceof JkErr) return { ok: false, stage: 'parse', error: { line: e.line, col: e.col, msg: e.msg } };
    throw e;
  }
}

const api = { jinkeiCompile, jinkeiFix, jinkeiModel };
root.jinkeiCompile = jinkeiCompile;
root.jinkeiFix = jinkeiFix;
root.jinkeiModel = jinkeiModel;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
