// パート（楽譜）の音の合成と再生（ブラウザ・node 共用）。src/audio.rs と同じ式。
// 打楽器（スネア・テナー・バス・シンバル）の合成は Kanade の打楽器合成を移植したもの。
//   jkAudio.render(D, sr)       -> Float32Array（ショー全体のモノラル波形。-0.9〜0.9）
//   jkAudio.play(D, startCount, rate) -> WebAudio で startCount から再生（rate = 再生速度。省略可）
//   jkAudio.stop()
//   jkAudio.captureStream()     -> MediaStream（再生中の音を録画に混ぜるため。play の前に呼ぶ。使えなければ null）
//   jkAudio.playing             -> 再生中か
const jkAudio = (function () {
  'use strict';
  const TAU = Math.PI * 2;

  function family(instr, mi) {
    switch (instr) {
      case 'snare': return {f: 'snare'};
      case 'tenors': return {f: 'tenor'};
      case 'bass1': case 'bass2': case 'bass3': case 'bass4': case 'bass5': return {f: 'bass', k: +instr.slice(4)};
      case 'bass_drum': return {f: 'bass', k: Math.min(mi, 4) + 1};
      case 'cymbals_mid': case 'cymbals_high': return {f: 'cymbal'};
      case 'xylophone': return {f: 'xylo'};
      case 'glockenspiel': return {f: 'glock'};
      case 'none': case 'flag': return {f: 'silent'};
      case 'piccolo': return {f: 'wind', hz: 1568.0};
      case 'flute': return {f: 'wind', hz: 880.0};
      case 'oboe': case 'eb_clarinet': case 'soprano_sax': return {f: 'wind', hz: 698.5};
      case 'trumpet': case 'clarinet': case 'alto_sax': return {f: 'wind', hz: 466.2};
      case 'mellophone': case 'marching_horn': case 'horn': case 'tenor_sax': case 'alto_clarinet': return {f: 'wind', hz: 293.7};
      case 'trombone': case 'euphonium': case 'marching_euphonium': case 'bassoon': case 'bass_clarinet': case 'baritone_sax': return {f: 'wind', hz: 196.0};
      default: return {f: 'wind', hz: 110.0};
    }
  }

  function secAt(D, t) {
    let sec = 0;
    for (const s of D.sets) {
      const len = s.counts + s.hold, a = s.start;
      if (t <= a) break;
      sec += (Math.min(t, a + len) - a) * 60 / s.tempo;
    }
    return sec;
  }

  class Synth {
    constructor(sr) {
      this.sr = sr; this.hits = 0;
      const n = sr * 2;
      this.noise = new Float32Array(n);
      let x = 0x9E3779B9 | 0;
      for (let i = 0; i < n; i++) {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        this.noise[i] = (x >>> 0) / 4294967296 * 2 - 1;
      }
    }
    // バンドパスをかけたノイズ。包絡線は 0.0001 → vol（2ms）→ 0.0001（dur）の指数減衰
    noiseHit(dur, freq, q, vol) {
      this.hits++;
      const sr = this.sr, n = Math.floor(dur * sr);
      const off = (this.hits * 7919) % Math.floor(this.noise.length / 2);
      const w0 = TAU * freq / sr, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
      const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      vol = Math.max(vol, 0.0002);
      const o = new Float32Array(n);
      // 指数減衰は1サンプルごとに一定の倍率をかけて求める（累乗を毎回計算しない）
      const step = Math.pow(0.0001 / vol, 1 / ((dur - 0.002) * sr));
      let ge = -1;
      for (let i = 0; i < n; i++) {
        const tau = i / sr;
        let g;
        if (tau < 0.002) g = vol * tau / 0.002;
        else { ge = ge < 0 ? vol * Math.pow(0.0001 / vol, (tau - 0.002) / (dur - 0.002)) : ge * step; g = ge; }
        const x = this.noise[(off + i) % this.noise.length];
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        o[i] = y * g;
      }
      return o;
    }
    // 音程が bend 倍まで下がる正弦波/三角波
    body(f, dur, vol, tri, bend) {
      const sr = this.sr, n = Math.floor(dur * sr), tb = Math.min(dur, 0.06);
      vol = Math.max(vol, 0.0002);
      let ph = 0;
      const o = new Float32Array(n);
      const step = Math.pow(0.0001 / vol, 1 / ((dur - 0.001) * sr));
      let ge = -1;
      for (let i = 0; i < n; i++) {
        const tau = i / sr;
        const fr = f * Math.pow(bend, Math.min(tau / tb, 1));
        let g;
        if (tau < 0.001) g = vol * tau / 0.001;
        else { ge = ge < 0 ? vol * Math.pow(0.0001 / vol, (tau - 0.001) / (dur - 0.001)) : ge * step; g = ge; }
        const s = Math.sin(TAU * ph);
        o[i] = (tri ? 2 / Math.PI * Math.asin(s) : s) * g;
        ph += fr / sr; ph -= Math.floor(ph);
      }
      return o;
    }
    // 時間とともに中心周波数が f0 → f1 に動くノイズ（スティックを面にこする音）
    sweepNoise(dur, f0, f1, q, vol) {
      this.hits++;
      const sr = this.sr, n = Math.floor(dur * sr);
      const off = (this.hits * 7919) % Math.floor(this.noise.length / 2);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const tau = i / sr, k = tau / dur, freq = f0 + (f1 - f0) * k;
        const w0 = TAU * freq / sr, alpha = Math.sin(w0) / (2 * q), a0 = 1 + alpha;
        const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
        // 立ち上がり 15ms、終わりに向けて弱まり、スティックの凹凸でゆらぐ
        const g = vol * Math.min(tau / 0.015, 1) * (1 - 0.7 * k * k) * (0.72 + 0.28 * Math.sin(TAU * 19 * tau));
        const x = this.noise[(off + i) % this.noise.length];
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        o[i] = y * g;
      }
      return o;
    }
    // 打楽器1打（src/audio.rs の Synth::drum と同じ）。tenor の idx 0..5 = ドラム1..4・スポック1・2。
    // br = 明るさ（強弱・アクセントで変わる。既定 1）、kind = rimshot / mute / gock / scrape / stickclick（他は通常）、dsec = 音符の長さ（秒）
    drum(fam, idx, level, br, kind, dsec) {
      const o = [];
      const add = (b) => o.push(b);
      const isDrum = fam === 'snare' || fam === 'tenor' || fam === 'bass';
      const fin = () => {
        let len = 0;
        for (const b of o) len = Math.max(len, b.length);
        const r = new Float32Array(len);
        for (const b of o) for (let i = 0; i < b.length; i++) r[i] += b[i];
        return r;
      };
      if (kind === 'stickclick') {
        add(this.body(2400, 0.02, level * 0.5, true, 0.97));
        add(this.body(3300, 0.012, level * 0.3, true, 0.98));
        add(this.noiseHit(0.016, 4000 * br, 1.5, level * 0.6));
        return fin();
      }
      if (kind === 'gock' && isDrum) {
        const f = fam === 'snare' ? 760 : fam === 'tenor' ? [900, 780, 680, 600, 1300, 1450][Math.min(idx, 5)] : [520, 600, 690, 800, 920][Math.min(idx, 4)];
        add(this.body(f, 0.05, level * 0.9, true, 0.9));
        add(this.body(f * 2.3, 0.025, level * 0.3, true, 0.95));
        add(this.noiseHit(0.03, f * 3 * br, 2.5, level * 0.5));
        return fin();
      }
      if (kind === 'scrape' && isDrum) {
        const d = Math.min(Math.max(dsec, 0.08), 0.95);
        const [f0, f1] = fam === 'snare' ? [4200, 2200] : fam === 'tenor' ? [3200, 1800] : [900, 400];
        add(this.sweepNoise(d, f0 * br, f1 * br, 1.0, level * 1.6));
        return fin();
      }
      // 通常・リムショット・ミュート（ds は鳴りの長さの倍率）
      const ds = kind === 'mute' ? 0.3 : 1.0;
      const crack = (f, vol, d) => {
        add(this.body(f, d, level * vol, false, 0.9));
        add(this.noiseHit(d * 0.8, 4800 * br, 0.8, level * vol * 1.3));
      };
      if (fam === 'snare') {
        if (idx === 2) { add(this.body(1800, 0.045, level * 0.65, true, 0.92)); add(this.noiseHit(0.035, 3500 * br, 1, level * 0.3)); }
        else {
          add(this.body(idx === 1 ? 650 : 390, Math.max(0.13 * ds, 0.03), level * 0.8, true, 0.72));
          add(this.noiseHit(Math.max((idx === 1 ? 0.15 : 0.22) * ds, 0.035), 2600 * br, 0.65, level * 1.8));
          if (idx === 1) add(this.body(1850, 0.065 * Math.max(ds, 0.5), level * 0.5, false, 0.9));
        }
        if (kind === 'rimshot') crack(2100, 0.55, 0.07);
        else if (kind === 'mute') add(this.body(1850, 0.02, level * 0.35, false, 0.9));
      } else if (fam === 'tenor') {
        const f = [300, 225, 168, 126, 560, 700][Math.min(idx, 5)];
        const spock = idx >= 4;
        const [d1, d2, dn] = spock ? [0.1, 0.05, 0.03] : [0.28, 0.13, 0.035];
        add(this.body(f * 1.35, Math.max(d1 * ds, 0.03), level * (spock ? 0.85 : 1.0), false, spock ? 0.9 : 0.72));
        add(this.body(f * 2.12, Math.max(d2 * ds, 0.02), level * 0.25 * br * br, true, 0.86));
        add(this.noiseHit(Math.max(dn, 0.03), (spock ? 3800 : 2400) * br, 1, level * (spock ? 0.9 : 0.4)));
        if (kind === 'rimshot') crack(f * 3.4, 0.5, 0.06);
        else if (kind === 'mute') add(this.body(f * 3.4, 0.02, level * 0.3, false, 0.9));
      } else if (fam === 'bass') {
        const f = [55, 68, 82, 100, 125][Math.min(idx, 4)];
        add(this.body(f * 1.6, Math.max(0.48 * ds, 0.09), level * 1.6, false, 0.65));
        add(this.body(f * 2.1, Math.max(0.2 * ds, 0.05), level * 0.18, false, 0.8));
        add(this.noiseHit(0.045, 1200 * br, 0.8, level * 0.5));
        if (kind === 'rimshot') crack(1100, 0.45, 0.05);
      } else {
        const i = Math.min(idx, 3), dur = [0.07, 0.55, 1.2, 0.055][i];
        add(this.noiseHit(dur, i < 2 ? 8500 : 6500, i < 2 ? 0.7 : 0.45, level * (i === 3 ? 0.65 : 1.3)));
        for (const f of [2190, 3070, 4310, 5870]) add(this.body(f, dur * 0.8, level * (i < 2 ? 0.045 : 0.09), true, 0.998));
      }
      return fin();
    }
    // 部分音の和（鍵盤）
    tone(parts, dur, attack, vol) {
      const sr = this.sr, n = Math.floor(dur * sr);
      vol = Math.max(vol, 0.0002);
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const tau = i / sr;
        let s = 0;
        for (const [f, a, d] of parts) s += a * Math.sin(TAU * f * tau) * Math.exp(-6.9 * tau / d);
        o[i] = s * (tau < attack ? vol * tau / attack : vol);
      }
      return o;
    }
  }

  function jitter(a, b, c) {
    let x = Math.imul(a, 0x9E3779B1) ^ Math.imul(b, 0x85EBCA6B) ^ Math.imul(c, 0xC2B2AE35) ^ 0x27D4EB2F;
    for (let i = 0; i < 3; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; }
    return ((x >>> 0) % 1000) / 1000 * 0.003;
  }

  function playMember(D, syn, part, pi, member, mi, out) {
    const sr = syn.sr;
    const instr = D.sections[D.performers[member].sec].instrument;
    const fam = family(instr, mi);
    if (fam.f === 'silent') return;
    const strokes = [];
    const drumLike = fam.f === 'snare' || fam.f === 'tenor' || fam.f === 'bass' || fam.f === 'cymbal';
    part.notes.forEach((n, ni) => {
      const [nt, nd, hand, accent, kind, pad] = n;
      const vel = n.length > 6 ? n[6] : 0.7;
      const t0 = secAt(D, nt) + jitter(pi, member, ni);
      const dsec = Math.max(secAt(D, nt + nd) - secAt(D, nt), 0.02);
      // 強弱（mf = 0.7 を 1 とする）とアクセントで音量と明るさが変わる
      const base = [0.5, 0.8, 1.0][Math.min(accent, 2)] * (hand === 'B' ? 1.15 : 1.0) * Math.pow(vel / 0.7, 1.2);
      const br = Math.min(Math.max(1.0 + 0.6 * (vel - 0.7) + 0.12 * Math.min(accent, 2), 0.6), 1.4);
      let idx = 0, cym = null;
      if (fam.f === 'snare') idx = kind === 'click' ? 2 : kind === 'rimshot' ? 1 : (pad === 2 ? 1 : pad === 3 ? 2 : 0);
      // テナー: 1〜4 = 主ドラム（1 が最高音）、5・6 = スポック。0 は主ドラムを順に回す
      else if (fam.f === 'tenor') idx = pad === 0 ? ni % 4 : Math.min(pad - 1, 5);
      else if (fam.f === 'bass') { if (kind !== 'stickclick' && pad !== 0 && pad !== fam.k) return; idx = 5 - fam.k; }
      else if (fam.f === 'cymbal') { idx = pad === 2 ? 0 : pad === 3 ? 1 : pad === 4 ? 3 : 2; cym = idx; }
      let hits;
      if (kind === 'flam') hits = [[-0.03, base * 0.45], [0, base]];
      else if (kind === 'diddle') hits = [[0, base * 0.85], [dsec / 2, base * 0.85]];
      else if (kind === 'buzz' && drumLike && fam.f !== 'cymbal') {
        const k = Math.max(Math.floor(dsec / 0.014), 2);
        hits = [];
        for (let j = 0; j < k; j++) hits.push([j * 0.014, base * (0.9 - 0.55 * (j / k)) * (j === 0 ? 1 : 0.6)]);
      } else hits = [[0, base]];
      for (const [off, lv] of hits) {
        const at = Math.floor(Math.max(t0 + off, 0) * sr);
        let buf;
        if (drumLike) buf = syn.drum(fam.f, idx, lv * 0.3, br, fam.f === 'cymbal' && kind !== 'stickclick' ? 'tap' : kind, dsec);
        else if (fam.f === 'xylo') {
          const f = [523.25, 587.33, 659.25, 783.99, 880.0][ni % 5];
          buf = syn.tone([[f, 1.0, 0.35], [f * 3.9, 0.35, 0.12]], 0.5, 0.001, lv * 0.35);
        } else if (fam.f === 'glock') {
          const f = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0][ni % 5];
          buf = syn.tone([[f, 1.0, 1.2], [f * 2.76, 0.3, 0.6], [f * 5.4, 0.15, 0.3]], 1.4, 0.001, lv * 0.25);
        } else {
          const f = fam.hz, d = Math.min(Math.max(dsec, 0.08), 1.5), nn = Math.floor(d * sr), rel = Math.min(0.06, d / 3);
          buf = new Float32Array(nn);
          for (let i = 0; i < nn; i++) {
            const tau = i / sr;
            const env = Math.min(tau / 0.02, 1) * Math.min(Math.max((d - tau) / rel, 0), 1);
            const w = Math.sin(TAU * f * tau) + 0.3 * Math.sin(TAU * 2 * f * tau) + 0.15 * Math.sin(TAU * 3 * f * tau);
            buf[i] = w * env * lv * 0.12;
          }
        }
        if (cym !== null && (cym === 0 || cym === 3)) {
          for (const s of strokes) {
            if (s.cym !== null && s.at < at && (cym === 3 || s.cym === 1)) {
              const from = at - s.at;
              const len = Math.min(from + Math.floor(0.04 * sr), s.buf.length);
              for (let k = Math.min(from, len); k < len; k++) s.buf[k] *= Math.exp(-(k - from) / (0.006 * sr));
              s.buf = s.buf.subarray(0, len);
            }
          }
        }
        strokes.push({at, buf, cym});
      }
    });
    const gain = 1 / Math.sqrt(Math.max(part.members.length, 1));
    for (const s of strokes) {
      const need = s.at + s.buf.length;
      if (out.a.length < need) { const b = new Float32Array(need); b.set(out.a); out.a = b; }
      for (let i = 0; i < s.buf.length; i++) out.a[s.at + i] += s.buf[i] * gain;
    }
  }

  const cache = new WeakMap();
  function render(D, sr) {
    sr = sr || 32000;
    const c = cache.get(D);
    if (c && c.sr === sr) return c.a;
    const last = D.sets[D.sets.length - 1];
    const total = last ? last.start + last.counts + last.hold : 0;
    const out = {a: new Float32Array(Math.floor((secAt(D, total) + 1) * sr))};
    const syn = new Synth(sr);
    (D.parts || []).forEach((part, pi) => {
      for (const m of part.members) {
        let mi = 0;
        for (let q = 0; q < m; q++) if (D.performers[q].sec === D.performers[m].sec) mi++;
        playMember(D, syn, part, pi, m, mi, out);
      }
    });
    let peak = 0;
    for (let i = 0; i < out.a.length; i++) peak = Math.max(peak, Math.abs(out.a[i]));
    if (peak > 0) { const k = 0.9 / peak; for (let i = 0; i < out.a.length; i++) out.a[i] *= k; }
    cache.set(D, {sr, a: out.a});
    return out.a;
  }

  // 秒 → 通算カウント（secAt の逆。最後のセットの後ろは最後のテンポで進める）
  function countAt(D, sec) {
    let left = sec;
    for (const s of D.sets) {
      const dur = (s.counts + s.hold) * 60 / s.tempo;
      if (left <= dur) return s.start + left * s.tempo / 60;
      left -= dur;
    }
    const l = D.sets[D.sets.length - 1];
    return l ? l.start + l.counts + l.hold : 0;
  }
  const st = {ctx: null, src: null};
  const api = {
    render, secAt, countAt,
    get playing() { return !!st.src; },
    hasParts(D) { return !!(D.parts && D.parts.some(p => p.notes.length)); },
    play(D, startCount, rate) {
      api.stop();
      if (!api.hasParts(D)) return false;
      const AC = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!AC) return false;
      if (!st.ctx) st.ctx = new AC();
      const ctx = st.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const sr = 32000, data = render(D, sr);
      const buf = ctx.createBuffer(1, data.length, sr);
      buf.copyToChannel(data, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate || 1;
      src.connect(ctx.destination);
      if (st.dest) src.connect(st.dest);
      const from = secAt(D, startCount || 0);
      if (from >= buf.duration) return false;
      src.onended = () => { if (st.src === src) st.src = null; };
      src.start(0, from);
      st.src = src;
      return true;
    },
    captureStream() {
      const AC = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!AC) return null;
      if (!st.ctx) st.ctx = new AC();
      if (!st.dest && st.ctx.createMediaStreamDestination) st.dest = st.ctx.createMediaStreamDestination();
      return st.dest ? st.dest.stream : null;
    },
    // iOS Safari: ユーザーの操作の中で一度鳴らしておかないと、あとから音が出ない
    unlock() {
      try {
        const AC = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
        if (!AC) return false;
        if (!st.ctx) st.ctx = new AC();
        if (typeof navigator !== 'undefined' && navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) { /* 非対応 */ } }
        if (st.ctx.state === 'suspended') st.ctx.resume();
        if (!st.unlocked) {
          const b = st.ctx.createBuffer(1, 1, 22050), s = st.ctx.createBufferSource();
          s.buffer = b; s.connect(st.ctx.destination); s.start(0); st.unlocked = true;
        }
        return true;
      } catch (e) { return false; }
    },
    stop() {
      if (st.src) { const s = st.src; st.src = null; try { s.stop(); } catch (e) { /* 既に止まっている */ } }
    },
  };
  return api;
})();
if (typeof module !== 'undefined' && module.exports) module.exports = {jkAudio};
