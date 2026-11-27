// 判断AIの評価（学習ツールとテストの両方が使う）。正解率・値の一致・較正（ECE）・「まちがって実行」率・しきい値の探索。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ---- 固定のショー（手書きの指示セット用）: tp 6人・tb 6人・pc 4人、セット 1〜4、いまは 2 番目
function fixtureCtx(selSpec) {
  const sections = [{id: 'tp', label: 'トランペット', n: 6, instrument: 'trumpet'}, {id: 'tb', label: 'トロンボーン', n: 6, instrument: 'trombone'}, {id: 'pc', label: '打楽器', n: 4}];
  const members = [];
  sections.forEach((s, si) => { for (let i = 1; i <= s.n; i++) members.push({id: s.id + i, sec: si, x: Math.round(((i - 1) * 1.25 - (s.n - 1) * 0.625) * 100) / 100, y: si * 3 - 3}); });
  let sel = [];
  const m = /^@(\w+)$/.exec(selSpec || '');
  if (m) sel = m[1] === 'all' ? members.map(x => x.id) : members.filter(x => x.id.startsWith(m[1])).map(x => x.id);
  return {sections, members, sel, sets: ['1', '2', '3', '4'], curSet: 1, field: {type: 'gym'}, stride: 0.625, beatsPerBar: 4};
}
function loadHand(name) {
  const rows = [];
  for (const line of fs.readFileSync(path.join(ROOT, 'tests/fixtures', name), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const c = line.split('\t');
    rows.push({text: c[0], intent: c[1], args: c[2] ? JSON.parse(c[2]) : null, sel: c[3] || '', ctx: null});
  }
  return rows;
}

// ---- 値の比べ方
const canon = v => JSON.stringify(v, (k, x) => { if (k === 'approx') return undefined; if (x && typeof x === 'object' && !Array.isArray(x)) return Object.keys(x).sort().reduce((o, kk) => { if (x[kk] !== false || kk === 'on' || kk === 'cw') o[kk] = x[kk]; return o; }, {}); return x; });
function argsMatch(got, gold) {
  if (!gold) return true;
  if (Array.isArray(gold)) return true;
  for (const k of Object.keys(gold)) {
    const g = got ? got[k] : undefined;
    if (canon(g == null ? null : g) !== canon(gold[k])) return false;
  }
  return true;
}

// ---- 評価
// items: {text, intent, args, ctx}（compound は steps / args が配列）。C = JKCMD
function evaluate(C, items, o) {
  o = o || {};
  const ctxOf = it => it.ctx || fixtureCtx(it.sel);
  const R = {n: 0, ok: 0, top3: 0, slotN: 0, slotOk: 0, run: 0, runWrongAction: 0, runWrongArgs: 0, conf: [], noneN: 0, noneRun: 0, ask: 0, choose: 0, unknown: 0, confirm: 0, exec: 0, compN: 0, compOk: 0, byIntent: {}, errors: [], ms: [], runCorrect: 0};
  for (const it of items) {
    const ctx = ctxOf(it);
    if (it.intent === 'compound') {
      const goldSteps = it.steps || it.args;
      const u = C.understand(it.text, ctx);
      R.compN++;
      if (u.steps.length === goldSteps.length && u.steps.every((s, i) => s.intent === goldSteps[i].intent && argsMatch(s.args, goldSteps[i].args))) R.compOk++;
      else if (o.errors) R.errors.push({text: it.text, gold: goldSteps.map(s => s.intent).join('>'), got: u.steps.map(s => s.intent).join('>')});
      continue;
    }
    const t0 = process.hrtime.bigint();
    const d = C.decideOne(it.text, ctx);
    R.ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
    R.n++;
    const right = d.intent === it.intent;
    const bi = R.byIntent[it.intent] || (R.byIntent[it.intent] = {n: 0, ok: 0}); bi.n++; if (right) bi.ok++;
    if (right) R.ok++;
    if ([d.alts[0], d.alts[1], d.alts[2]].some(a => a && a.intent === it.intent) || (it.intent === 'none' && d.intent === 'none')) R.top3++;
    R.conf.push([d.conf, right ? 1 : 0]);
    const slotKnown = it.args && !Array.isArray(it.args) && Object.keys(it.args).length > 0;
    let slotOk = true;
    if (right && slotKnown) { R.slotN++; slotOk = argsMatch(d.args, it.args); if (slotOk) R.slotOk++; }
    R[d.status] = (R[d.status] || 0) + 1;
    if (it.intent === 'none') { R.noneN++; if (d.status === 'run' || d.status === 'confirm') R.noneRun++; }
    if (d.status === 'run' || d.status === 'confirm') {
      R.exec++;
      if (!right) R.runWrongAction++; else if (slotKnown && !slotOk) R.runWrongArgs++; else R.runCorrect++;
    }
    if ((d.status === 'run' || d.status === 'confirm') && (!right || (slotKnown && !slotOk)) && o.errors) (R.wrongRuns = R.wrongRuns || []).push({text: it.text, gold: it.intent, got: d.intent, conf: +d.conf.toFixed(3), gargs: JSON.stringify(it.args), args: JSON.stringify(d.args)});
    if (!right && o.errors) R.errors.push({text: it.text, gold: it.intent, got: d.intent, conf: +d.conf.toFixed(2), status: d.status});
    else if (right && slotKnown && !slotOk && o.errors) R.errors.push({text: it.text, gold: it.intent, got: d.intent, slot: JSON.stringify(it.args), have: JSON.stringify(d.args)});
  }
  R.acc = R.ok / R.n; R.top3acc = R.top3 / R.n; R.slotEM = R.slotN ? R.slotOk / R.slotN : 1;
  R.ece = ece(R.conf);
  R.wrongRate = (R.runWrongAction + R.runWrongArgs) / R.n; R.wrongActionRate = R.runWrongAction / R.n; R.wrongOfRun = R.exec ? (R.runWrongAction + R.runWrongArgs) / R.exec : 0;
  R.coverage = R.exec / R.n; R.compAcc = R.compN ? R.compOk / R.compN : null;
  R.msP50 = pct(R.ms, 0.5); R.msP99 = pct(R.ms, 0.99);
  return R;
}
function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function ece(pairs, bins) {
  bins = bins || 15; const B = Array.from({length: bins}, () => ({n: 0, c: 0, a: 0}));
  for (const [c, ok] of pairs) { const b = Math.min(bins - 1, Math.floor(c * bins)); B[b].n++; B[b].c += c; B[b].a += ok; }
  let e = 0; for (const b of B) if (b.n) e += b.n / pairs.length * Math.abs(b.c / b.n - b.a / b.n);
  return e;
}
// しきい値の探索: 与えた例（decideOne を寛容な設定で 1 回だけ計算）に対し、high・margin を動かして「まちがって実行」が上限以下で、実行できる割合が最大のものを選ぶ
function tunePolicy(C, items, maxWrong) {
  const saved = Object.assign({}, C.POLICY);
  Object.assign(C.POLICY, {high: 0, margin: 0, mid: 0});
  const rows = [];
  for (const it of items) {
    if (it.intent === 'compound') continue;
    const ctx = it.ctx || fixtureCtx(it.sel);
    const d = C.decideOne(it.text, ctx);
    const right = d.intent === it.intent, slotKnown = it.args && !Array.isArray(it.args) && Object.keys(it.args).length > 0;
    rows.push({conf: d.conf, p2: d.p2, complete: d.complete, destructive: d.destructive, intent: d.intent, ok: right && (!slotKnown || argsMatch(d.args, it.args))});
  }
  Object.assign(C.POLICY, saved);
  let best = null, fb = null;
  for (let h = 0.5; h <= 0.995; h += 0.01) for (let m = 0; m <= 0.6; m += 0.05) {
    let run = 0, wrong = 0;
    for (const r of rows) { if (r.intent === 'none' || r.conf < 0.3 || !r.complete) continue; if (r.conf >= h && r.conf - r.p2 >= m) { run++; if (!r.ok) wrong++; } }
    const wr = wrong / rows.length;
    const cand = {high: +h.toFixed(2), margin: +m.toFixed(2), run, wrong, wrongRate: wr, coverage: run / rows.length};
    if (wr <= maxWrong && (!best || run > best.run || (run === best.run && h < best.high))) best = cand;
    if (!fb || wr < fb.wrongRate || (wr === fb.wrongRate && run > fb.run)) fb = cand;
  }
  return best || Object.assign(fb, {unmet: true});
}
module.exports = {fixtureCtx, loadHand, argsMatch, evaluate, ece, tunePolicy, canon};
