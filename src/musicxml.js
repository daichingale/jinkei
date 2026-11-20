// MusicXML（score-partwise）の1パートを、陣形の part 記法に変換する（src/xmlimport.rs と同じ変換）。
// 変換の考え方・打面の対応表は Kanade の musicxml-import.js / percussion.js を参考にした。
// 圧縮 MusicXML（.mxl）の展開は Kanade の musicxml-container.js を移植した（DecompressionStream が使えるブラウザのみ）。
//   jkImportMusicXml(text, partName?) -> {text, meter, notation, name, warnings, parts}
//   jkUnpackMxl(arrayBuffer) -> Promise<string>
const jkImportMusicXml = (function () {
  'use strict';
  const fail = (m) => new Error(m);

  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
      switch (e) {
        case 'amp': return '&'; case 'lt': return '<'; case 'gt': return '>'; case 'quot': return '"'; case 'apos': return "'";
        default: {
          const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          try { return String.fromCodePoint(cp); } catch (x) { return m; }
        }
      }
    });
  }

  // 小さな XML 読み取り: {name, attrs, kids, text}
  function parseXml(src) {
    if (src.includes('<!ENTITY')) throw fail('外部・独自のXML実体を含むファイルには対応していません');
    const stack = [{name: '#root', attrs: {}, kids: [], text: ''}];
    let i = 0;
    const n = src.length;
    while (i < n) {
      if (src[i] !== '<') {
        let j = src.indexOf('<', i);
        if (j < 0) j = n;
        stack[stack.length - 1].text += decode(src.slice(i, j));
        i = j;
        continue;
      }
      if (src.startsWith('<!--', i)) {
        const j = src.indexOf('-->', i);
        if (j < 0) throw fail('XMLの形式が正しくありません（コメントが閉じていません）');
        i = j + 3;
      } else if (src.startsWith('<![CDATA[', i)) {
        const j = src.indexOf(']]>', i);
        if (j < 0) throw fail('XMLの形式が正しくありません（CDATA）');
        stack[stack.length - 1].text += src.slice(i + 9, j);
        i = j + 3;
      } else if (src.startsWith('<?', i)) {
        const j = src.indexOf('?>', i);
        if (j < 0) throw fail('XMLの形式が正しくありません');
        i = j + 2;
      } else if (src.startsWith('<!', i)) {
        let depth = 0;
        while (i < n) {
          const c = src[i];
          if (c === '[') depth++;
          else if (c === ']') depth--;
          else if (c === '>' && depth <= 0) break;
          i++;
        }
        i++;
      } else if (src.startsWith('</', i)) {
        const j = src.indexOf('>', i);
        if (j < 0) throw fail('XMLの形式が正しくありません');
        const name = src.slice(i + 2, j).trim();
        const node = stack.pop();
        if (!stack.length || node.name !== name) throw fail(`XMLの形式が正しくありません（</${name}> が対応していません）`);
        stack[stack.length - 1].kids.push(node);
        i = j + 1;
      } else {
        let j = i + 1, q = null;
        while (j < n) {
          const c = src[j];
          if (q === null && c === '>') break;
          if (q === null && (c === '"' || c === "'")) q = c;
          else if (q !== null && c === q) q = null;
          j++;
        }
        if (j >= n) throw fail('XMLの形式が正しくありません（タグが閉じていません）');
        let body = src.slice(i + 1, j);
        const selfclose = body.endsWith('/');
        if (selfclose) body = body.slice(0, -1);
        body = body.trim();
        const m = body.match(/^(\S+)\s*([\s\S]*)$/);
        const node = {name: m ? m[1] : '', attrs: {}, kids: [], text: ''};
        const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = re.exec(m ? m[2] : '')) !== null) node.attrs[a[1]] = decode(a[3] !== undefined ? a[3] : a[4]);
        if (selfclose) stack[stack.length - 1].kids.push(node); else stack.push(node);
        i = j + 1;
      }
    }
    if (stack.length !== 1) throw fail('XMLの形式が正しくありません（閉じていないタグがあります）');
    if (!stack[0].kids.length) throw fail('XMLの形式が正しくありません');
    return stack[0].kids[0];
  }
  const kid = (n, name) => n.kids.find((k) => k.name === name) || null;
  const kidsNamed = (n, name) => n.kids.filter((k) => k.name === name);
  const val = (n, name) => { const k = kid(n, name); return k ? k.text.trim() : ''; };
  const numOf = (n, name) => { const k = kid(n, name); if (!k) return null; const v = Number(k.text.trim()); return k.text.trim() !== '' && Number.isFinite(v) ? v : null; };
  const find = (n, name) => { for (const k of n.kids) { if (k.name === name) return k; const f = find(k, name); if (f) return f; } return null; };

  const PADS = {
    snare: [1, 2, 3, 1, 1], tenor: [1, 2, 3, 4, 6], bass: [5, 4, 3, 2, 1], cymbal: [2, 3, 1, 4, 1],
  };
  const padOf = (kit, step) => { const i = 'CDEFG'.indexOf(step); return i < 0 || step.length !== 1 ? 0 : PADS[kit][i]; };
  function kitOf(name) {
    const l = name.toLowerCase();
    const has = (w) => w.some((x) => l.includes(x));
    if (has(['tenor', 'quad', 'quint', 'テナー', 'クワッド', 'クイント'])) return 'tenor';
    if (has(['bass', 'バス'])) return 'bass';
    if (has(['cymbal', 'hat', 'シンバル'])) return 'cymbal';
    return 'snare';
  }
  // 1/64音符 = 1 の単位での音価 → [分割, 付点]
  const VALUES = [[64, 1, false], [48, 2, true], [32, 2, false], [24, 4, true], [16, 4, false], [12, 8, true], [8, 8, false], [6, 16, true], [4, 16, false], [3, 32, true], [2, 32, false], [1, 64, false]];
  function pieces(u) {
    const v = [];
    while (u > 0) {
      const x = VALUES.find((e) => e[0] <= u) || [1, 64, false];
      v.push([x[1], x[2]]);
      u -= x[0];
    }
    return v;
  }
  const denOf = (t) => ({whole: 1, half: 2, quarter: 4, eighth: 8, '16th': 16, '32nd': 32, '64th': 64})[t] || 0;
  const sameTup = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  function noteTok(e, kit, st) {
    let h;
    if (e.hand) { st.right = e.hand.toUpperCase() !== 'R'; h = e.hand.toUpperCase(); }
    else { h = st.right ? 'R' : 'L'; st.right = !st.right; }
    const loud = e.accent > 0 || (e.hand && e.hand === e.hand.toUpperCase());
    let s = '';
    if (e.accent === 2) s += '^';
    if (e.click) s += 'x'; else if (e.flam) s += 'f'; else if (e.buzz) s += 'z';
    s += loud ? h : h.toLowerCase();
    if (e.pad > 1 || (e.pad === 1 && (kit === 'tenor' || kit === 'bass'))) s += String(e.pad);
    return s;
  }

  function importXml(src, want) {
    const root = parseXml(src);
    if (root.name !== 'score-partwise') throw fail('パート単位の MusicXML（score-partwise）を選んでください');
    const pl = kid(root, 'part-list');
    const list = pl ? kidsNamed(pl, 'score-part').map((sp) => [sp.attrs.id || '', val(sp, 'part-name')]) : [];
    const parts = kidsNamed(root, 'part');
    if (!parts.length) throw fail('パートが見つかりません');
    const names = parts.map((p, i) => { const f = list.find((x) => x[0] === (p.attrs.id || '')); return f && f[1] ? f[1] : `パート ${i + 1}`; });
    let pi = 0;
    if (typeof want === 'number') {
      if (!(want >= 0 && want < names.length)) throw fail('パートの番号が範囲外です');
      pi = want;
    } else if (want !== undefined && want !== null && want !== '') {
      pi = names.indexOf(want);
      if (pi < 0) pi = names.findIndex((n) => n.toLowerCase().includes(want.toLowerCase()));
      if (pi < 0) throw fail(`パート「${want}」が見つかりません（ある名前: ${names.join(' / ')}）`);
    }
    const part = parts[pi], name = names[pi], kit = kitOf(name);
    const warnings = [];
    const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
    let divisions = 1, time = [4, 4], gotTime = false;
    const fn = find(part, 'note');
    const voice = fn && val(fn, 'voice') ? val(fn, 'voice') : '1';
    const bars = [], barLen = [];
    let flamNext = false;
    for (const m of kidsNamed(part, 'measure')) {
      let cursor = 0, lastEnd = 0;
      const evs = [];
      for (const it of m.kids) {
        if (it.name === 'attributes') {
          const d = numOf(it, 'divisions');
          if (d !== null && d > 0) divisions = d;
          const t = kid(it, 'time');
          if (t) {
            let nn = 0;
            for (const b of kidsNamed(t, 'beats')) for (const x of b.text.split('+')) { const v = parseInt(x.trim(), 10); nn += Number.isNaN(v) ? 0 : v; }
            let dd = parseInt(val(t, 'beat-type'), 10); if (Number.isNaN(dd)) dd = 4;
            const nt = [Math.max(nn, 1), Math.max(dd, 1)];
            if (!gotTime) { time = nt; gotTime = true; } else if (nt[0] !== time[0] || nt[1] !== time[1]) warn('途中の拍子変更は最初の拍子にそろえました');
          }
        } else if (it.name === 'backup' || it.name === 'forward') {
          const d = numOf(it, 'duration') || 0;
          cursor += it.name === 'backup' ? -d : d;
          cursor = Math.max(cursor, 0);
        } else if (it.name === 'note') {
          if (kid(it, 'grace')) { flamNext = true; continue; }
          const dur = numOf(it, 'duration') || 0;
          const v = val(it, 'voice') || '1';
          if (kid(it, 'chord')) { warn('和音は先頭の音だけ読み込みました'); continue; }
          const start = cursor;
          cursor += dur;
          if (v !== voice) continue;
          if (start < lastEnd - 1e-9) continue;
          lastEnd = start + dur;
          const rest = !!kid(it, 'rest');
          const nots = kid(it, 'notations');
          const hasN = (n) => !!nots && !!find(nots, n);
          const tieStop = kidsNamed(it, 'tie').some((t) => t.attrs.type === 'stop') || (!!nots && kidsNamed(nots, 'tied').some((t) => t.attrs.type === 'stop'));
          let tup = null;
          const tm = kid(it, 'time-modification');
          if (tm) {
            const a = Math.trunc(numOf(tm, 'actual-notes') ?? 3), nn = Math.trunc(numOf(tm, 'normal-notes') ?? 2);
            const dn = denOf(val(tm, 'normal-type'));
            tup = [a, nn, dn > 0 ? dn : denOf(val(it, 'type'))];
          }
          let pad = 0;
          const un = kid(it, 'unpitched');
          if (un) pad = padOf(kit, val(un, 'display-step'));
          const ly = kid(it, 'lyric');
          const lyric = ly ? val(ly, 'text') : '';
          const hand = Array.from(lyric).length === 1 && 'RLBrlb'.includes(lyric) ? lyric : null;
          const accent = hasN('strong-accent') ? 2 : hasN('accent') ? 1 : 0;
          evs.push({start, dur, rest, tieStop, accent, click: val(it, 'notehead') === 'x', buzz: hasN('tremolo'), flam: flamNext, hand, pad, tup});
          flamNext = false;
        }
      }
      barLen.push(time[0] * 4 / time[1] * divisions);
      bars.push(evs);
    }
    if (!bars.length) throw fail('小節がありません');
    const o = {toks: [], div: 16, dotted: false};
    const setDiv = (d, dot) => { if (o.div !== d || o.dotted !== dot) { o.toks.push(`${d}${dot ? '.' : ''}:`); o.div = d; o.dotted = dot; } };
    const st = {right: true, prevNote: false};
    bars.forEach((evs, bi) => {
      let pos = 0;
      const u = (x) => Math.round(x / divisions * 16);
      const emit = (ev, units) => {
        pieces(units).forEach(([d, dot], k) => {
          setDiv(d, dot);
          if (ev && !ev.rest) {
            if (k === 0 && !(ev.tieStop && st.prevNote)) { o.toks.push(noteTok(ev, kit, st)); st.prevNote = true; } else o.toks.push('~');
          } else { o.toks.push('-'); st.prevNote = false; }
        });
      };
      let k = 0;
      while (k < evs.length) {
        const e = evs[k];
        if (u(e.start - pos) > 0) emit(null, u(e.start - pos));
        if (e.tup) {
          const [a, n, d] = e.tup;
          const p = isPow2n(a) ? a / 2 : nextPow2(a) / 2;
          if (n !== p || d === 0) warn('対応しない比率の連符は、近い長さの音符に置き換えました');
          const slot = divisions * 4 / d * n / a;
          const group = [];
          let filled = 0, j = k;
          while (j < evs.length && sameTup(evs[j].tup, e.tup) && filled < a) {
            const s = Math.max(Math.round(evs[j].dur / slot), 1);
            group.push([j, s]); filled += s; j++;
          }
          if (filled === a && n === p && d > 0) {
            setDiv(d, false);
            o.toks.push(`${a}[`);
            for (const [gi, s] of group) {
              const ev = evs[gi];
              for (let si = 0; si < s; si++) {
                if (ev.rest) { o.toks.push('-'); st.prevNote = false; }
                else if (si === 0 && !(ev.tieStop && st.prevNote)) { o.toks.push(noteTok(ev, kit, st)); st.prevNote = true; }
                else o.toks.push('~');
              }
            }
            o.toks.push(']');
            pos = evs[j - 1].start + evs[j - 1].dur;
            k = j;
            continue;
          }
        }
        emit(e, Math.max(u(e.dur), 1));
        pos = e.start + e.dur;
        k++;
      }
      if (u(barLen[bi] - pos) > 0) emit(null, u(barLen[bi] - pos));
      o.toks.push('|');
    });
    const lines = [];
    let cur = [], nbar = 0;
    for (const t of o.toks) {
      cur.push(t);
      if (t === '|') { nbar++; if (nbar % 4 === 0) { lines.push(cur.join(' ')); cur = []; } }
    }
    if (cur.length) lines.push(cur.join(' '));
    const meter = `${time[0]}/${time[1]}`;
    const notation = lines.join('\n');
    const text = `part "${name.replace(/"/g, '”')}" for all {\n  meter ${meter}\n` + lines.map((l) => '  ' + l + '\n').join('') + '}\n';
    return {text, meter, notation, name, warnings, parts: names};
  }
  const isPow2n = (a) => a > 0 && (a & (a - 1)) === 0;
  const nextPow2 = (a) => { let p = 1; while (p < a) p *= 2; return p; };
  return importXml;
})();

// 圧縮 MusicXML（.mxl）から本体の XML テキストを取り出す（Kanade の musicxml-container.js を移植）
async function jkUnpackMxl(buffer) {
  const view = new DataView(buffer), size = view.byteLength;
  const u16 = (o) => view.getUint16(o, true), u32 = (o) => view.getUint32(o, true);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const bad = () => new Error('圧縮 MusicXML のファイル構成を確認してください');
  let end = size - 22;
  for (; end >= Math.max(0, size - 65557); end--) if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === size) break;
  if (end < 0 || end < Math.max(0, size - 65557) || u16(end + 4) || u16(end + 6)) throw bad();
  const files = new Map(), count = u16(end + 10), dirSize = u32(end + 12);
  let offset = u32(end + 16);
  if (count > 2048 || offset + dirSize > end) throw bad();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) throw bad();
    const length = u16(offset + 28), next = offset + 46 + length + u16(offset + 30) + u16(offset + 32);
    if (next > end || u16(offset + 34)) throw bad();
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, length));
    files.set(name, {method: u16(offset + 10), flags: u16(offset + 8), compressed: u32(offset + 20), size: u32(offset + 24), offset: u32(offset + 42)});
    offset = next;
  }
  async function read(name, limit) {
    const e = files.get(name);
    if (!e || e.flags & 1 || e.size > limit || e.offset + 30 > end || u32(e.offset) !== 0x04034b50) throw bad();
    const data = e.offset + 30 + u16(e.offset + 26) + u16(e.offset + 28);
    if (data + e.compressed > end) throw bad();
    const bytes = new Uint8Array(buffer, data, e.compressed);
    if (e.method === 0) return decoder.decode(bytes);
    if (e.method !== 8) throw bad();
    let inflate;
    try { inflate = new DecompressionStream('deflate-raw'); } catch (x) { throw new Error('このブラウザでは .mxl を展開できません。非圧縮 MusicXML を開いてください'); }
    const reader = new Blob([bytes]).stream().pipeThrough(inflate).getReader();
    const out = new Uint8Array(e.size);
    let written = 0;
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      if (written + value.length > out.length) throw bad();
      out.set(value, written); written += value.length;
    }
    return decoder.decode(out);
  }
  const manifest = await read('META-INF/container.xml', 65536);
  const m = manifest.match(/full-path\s*=\s*["']([^"']+)["']/);
  if (!m) throw bad();
  return read(m[1], 20 * 1024 * 1024);
}
if (typeof module !== 'undefined' && module.exports) module.exports = {jkImportMusicXml, jkUnpackMxl};
