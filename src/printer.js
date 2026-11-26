// モデル（編集用JSON）→ 陣形ソース。エディタと往復テストで共用
const qs = s => '"' + String(s).replace(/"/g, '”') + '"';
const nameTok = s => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(s) || /^\d+(\.\d+)?$/.test(s)) ? s : qs(s);
const P = p => `(${p[0]}, ${p[1]})`;
function shapeSrc(s) {
  switch (s.kind) {
    case 'line': return `line ${P(s.a)} -> ${P(s.b)}`;
    case 'arc': return `arc ${P(s.c)} radius ${s.r} from ${s.a1} to ${s.a2}`;
    case 'circle': return `circle ${P(s.c)} radius ${s.r}` + (s.start != null && s.start !== '' ? ` start ${s.start}` : '');
    case 'block': return `block ${P(s.c)} cols ${s.cols}` + (s.spacing ? ` spacing ${s.spacing}` : '') + (s.rows ? ` rows ${s.rows}` : '');
    case 'curve': case 'poly': return `${s.kind} ` + s.pts.map(P).join(' -> ');
    case 'at': return `at ${P(s.p)}`;
    case 'follow': return 'follow ' + s.pts.map(P).join(' -> ') + (s.spacing ? ` spacing ${s.spacing}` : '');
    case 'attr': return '';
    default: return 'same';
  }
}
function stmtSrc(st) {
  let s = shapeSrc(st.shape);
  for (const x of st.xf) {
    if (x.kind === 'rotate') s += ` rotate ${x.a}` + (x.about ? ` about ${P(x.about)}` : '');
    else if (x.kind === 'shift') s += ` shift ${P(x.d)}`;
    else s += ` scale ${x.k}`;
  }
  if (st.assign) s += ` assign ${st.assign}`;
  if (st.skip && st.skip.length) s += ` skip ${[...st.skip].sort((a, b) => a - b).join(', ')}`;
  if (st.wait != null && st.wait !== '') s += ` wait ${st.wait}`;
  if (st.within != null && st.within !== '') s += ` in ${st.within}`;
  if (st.bend != null && st.bend !== '' && +st.bend !== 0) s += ` bend ${st.bend}`;
  if (st.face != null && st.face !== '') s += ` face ${st.face}`;
  if (st.step) s += ` step ${st.step}`;
  if (st.action) s += ` action ${st.action}`;
  if (st.pose) s += ` pose ${st.pose}`;
  if (st.carry) s += ` carry ${st.carry}`;
  if (st.shape.kind === 'attr') s = s.trim();
  return s;
}
function fieldSrc(f) {
  if (f.type === 'gym') return (+f.w === 30 && +f.d === 30) ? 'field gym' : `field gym ${f.w} x ${f.d}`;
  if (f.type === 'stage') return (+f.w === 16 && +f.d === 10 && +f.wing === 4) ? 'field stage' : `field stage ${f.w} x ${f.d} wings ${f.wing}`;
  if (f.type === 'football') return `field football ${f.level || 'hs'}`;
  return `field floor ${f.w} x ${f.d}`;
}
function printModel(m) {
  const L = [];
  const notes = (arr, ind) => (arr || []).forEach(n => L.push(ind + '#' + (n ? ' ' + n : '')));
  const tail = t => t ? '   # ' + t : '';
  notes(m.header, '');
  L.push(`show ${qs(m.name)} {`);
  notes(m.settings_notes, '  ');
  L.push('  ' + fieldSrc(m.field));
  L.push(`  tempo ${m.tempo}`);
  if (m.clearance != null && m.clearance !== '') L.push(`  clearance ${m.clearance}`);
  if (m.maxstep != null && m.maxstep !== '') L.push(`  maxstep ${m.maxstep}`);
  if (m.look) L.push(`  look ${m.look}`);
  L.push('');
  const idw = Math.max(...m.sections.map(s => s.id.length), 2);
  for (const s of m.sections) {
    notes(s.note, '  ');
    L.push(`  section ${s.id.padEnd(idw)} ${qs(s.label)} ${s.n}` + (s.instrument ? ` instrument ${s.instrument}` : '') + (s.color ? ` color ${qs(s.color)}` : '') + tail(s.tail));
  }
  for (const set of m.sets) {
    L.push('');
    notes(set.note, '  ');
    L.push(`  set ${nameTok(set.name)}` + (+set.counts ? ` counts ${set.counts}` : '') + (set.tempo != null && set.tempo !== '' ? ` tempo ${set.tempo}` : '') + (+set.hold ? ` hold ${set.hold}` : '') + (set.mark ? ' mark' : '') + ' {' + tail(set.tail));
    const gw = Math.max(0, ...set.stmts.map(st => st.group.length));
    for (const st of set.stmts) {
      notes(st.note, '    ');
      L.push(`    ${st.group.padEnd(gw)} : ${stmtSrc(st)}` + tail(st.tail));
    }
    notes(set.foot, '    ');
    L.push('  }');
  }
  for (const p of m.parts || []) {
    L.push('');
    notes(p.note, '  ');
    L.push(`  part ${qs(p.name)} for ${p.group} {`);
    if (p.meter) L.push(`    meter ${p.meter}`);
    if (p.start) L.push(`    start ${p.start}`);
    if (p.src) for (const ln of String(p.src).split('\n')) L.push(ln === '' ? '' : '    ' + ln);
    L.push('  }');
  }
  notes(m.foot, '  ');
  L.push('}');
  return L.join('\n') + '\n';
}


if (typeof module !== 'undefined') module.exports = {printModel};
