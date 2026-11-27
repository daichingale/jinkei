#!/usr/bin/env node
// 自動修正の「判断AI」を学習する（決定的: シード固定、外部ライブラリなし）。
//   node tools/train_fix_ai.js all [--train 2400] [--test 300] [--jobs 2] [--tag t]   データ作り → 学習 → 検証 → モデル書き込み
//   node tools/train_fix_ai.js gen --from A --to B --out f.bin                         （内部）総当たりで候補ごとの特徴量と結果を記録
//   node tools/train_fix_ai.js fit --data a.bin,b.bin --test c.bin                      学習だけやり直す
//   node tools/train_fix_ai.js eval [--seeds 500001-500300]                              保持データで 判断AI版 vs 総当たり の最終結果・時間を比べる
// 学習データ: ランダムなショー（tools/gen_shows.js）に対し、従来の総当たり（exhaustive）が全候補を評価した結果。
//   各候補 = 「ある文に wait / in / bend を足す」。ラベル y = そのセットの衝突がどれだけ減ったか（1 = 全部消えて他は増えない）。
// モデル: 勾配ブースティング木（深さ3・約 40 本）。出力 assets/fix_model.json と web/engine.js の /*FIXMODEL*/ 欄、src/fix_model.json（Rust が include_str!）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn, spawnSync} = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const A = process.argv.slice(2);
const cmd = A[0];
const opt = (n, d) => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : d; };
const NF = 30, REC = 4 + NF;   // 記録 = [gid, idx, y, perfect, ...x]
const MODEL_JSON = path.join(ROOT, 'assets/fix_model.json');

function showFor(sd) { const {genShow} = require('./gen_shows.js'); return genShow(sd, {members: 8 + (sd * 7) % 17, sets: 3 + (sd % 4)}); }

// ------------------------------------------------------------ gen
if (cmd === 'gen') {
  const E = require(path.join(ROOT, 'web/engine.js'));
  const from = +opt('--from', 1), to = +opt('--to', 10);
  const out = [];
  let shows = 0, groups = 0;
  for (let sd = from; sd <= to; sd++) {
    const s = showFor(sd);
    const r = E.jinkeiCompile(s);
    if (!r.ok || !r.data.warnings.some(w => w.kind === '衝突')) continue;
    shows++;
    let g = -1;
    E.jinkeiFixTrace(s, rec => {
      if (rec.idx === 0) { g++; groups++; }
      const row = new Float32Array(REC);
      row[0] = ((sd - 1) % 100000) * 64 + g; /* Float32 で正確に表せる範囲（< 2^24） */ row[1] = rec.idx; row[2] = rec.y; row[3] = rec.perfect ? 1 : 0;
      for (let i = 0; i < NF; i++) row[4 + i] = rec.x[i];
      out.push(row);
    });
    E.jinkeiMemoClear();
  }
  const buf = Buffer.alloc(out.length * REC * 4);
  out.forEach((row, i) => Buffer.from(row.buffer).copy(buf, i * REC * 4));
  fs.writeFileSync(opt('--out'), buf);
  console.log(`gen ${from}-${to}: ショー ${shows} / グループ ${groups} / 候補 ${out.length}`);
  process.exit(0);
}

// ------------------------------------------------------------ 学習
function loadBin(files) {
  const parts = files.map(f => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); });
  const n = parts.reduce((a, p) => a + p.length / REC, 0);
  const all = new Float32Array(n * REC);
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return {n, d: all};
}
function fitGbdt(D, o) {
  const {n, d} = D, X = j => d[j % 1]; // placeholder（使わない）
  const NB = 32;
  // 特徴量ごとの分位点しきい値
  const thr = [], bins = new Uint8Array(n * NF);
  for (let f = 0; f < NF; f++) {
    const vals = new Float32Array(n); for (let i = 0; i < n; i++) vals[i] = d[i * REC + 4 + f];
    const sorted = Float32Array.from(vals).sort();
    const th = [];
    for (let b = 1; b < NB; b++) { const v = sorted[Math.floor(b * n / NB)]; if (th.length === 0 || v > th[th.length - 1]) th.push(v); }
    thr.push(th);
    for (let i = 0; i < n; i++) { const v = vals[i]; let lo = 0, hi = th.length; while (lo < hi) { const m = (lo + hi) >> 1; if (v <= th[m]) hi = m; else lo = m + 1; } bins[i * NF + f] = lo; }
  }
  const y = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) { y[i] = d[i * REC + 2]; w[i] = d[i * REC + 3] ? o.perfectWeight : 1.0; }
  let wsum = 0, ysum = 0; for (let i = 0; i < n; i++) { wsum += w[i]; ysum += w[i] * y[i]; }
  const base = ysum / wsum;
  const pred = new Float64Array(n).fill(base);
  const trees = [];
  for (let ti = 0; ti < o.trees; ti++) {
    const res = new Float64Array(n); for (let i = 0; i < n; i++) res[i] = y[i] - pred[i];
    // 深さ3の木を幅優先で作る
    const nodeOf = new Int32Array(n);   // 各サンプルの現在のノード
    const T = {f: [], t: [], l: [], r: [], v: []};
    const mk = () => { T.f.push(-1); T.t.push(0); T.l.push(0); T.r.push(0); T.v.push(0); return T.f.length - 1; };
    let level = [mk()];
    for (let depth = 0; depth < o.depth; depth++) {
      const next = [];
      const idxOf = new Map(level.map((nd, q) => [nd, q]));
      const L = level.length;
      const sumG = new Float64Array(L * NF * NB), sumW = new Float64Array(L * NF * NB), totG = new Float64Array(L), totW = new Float64Array(L);
      for (let i = 0; i < n; i++) {
        const q = idxOf.get(nodeOf[i]); if (q === undefined) continue;
        const wi = w[i], g = res[i] * wi;
        totG[q] += g; totW[q] += wi;
        const base_ = q * NF * NB;
        for (let f = 0; f < NF; f++) { const k = base_ + f * NB + bins[i * NF + f]; sumG[k] += g; sumW[k] += wi; }
      }
      const split = [];
      for (let q = 0; q < L; q++) {
        let bestGain = 1e-9, bf = -1, bb = -1;
        const lam = o.lambda;
        const parent = totG[q] * totG[q] / (totW[q] + lam);
        for (let f = 0; f < NF; f++) {
          let gl = 0, wl = 0;
          for (let b = 0; b < thr[f].length; b++) {
            gl += sumG[q * NF * NB + f * NB + b]; wl += sumW[q * NF * NB + f * NB + b];
            const gr = totG[q] - gl, wr = totW[q] - wl;
            if (wl < o.minLeaf || wr < o.minLeaf) continue;
            const gain = gl * gl / (wl + lam) + gr * gr / (wr + lam) - parent;
            if (gain > bestGain) { bestGain = gain; bf = f; bb = b; }
          }
        }
        split.push([bf, bb]);
      }
      for (let q = 0; q < L; q++) {
        const nd = level[q], [bf, bb] = split[q];
        if (bf < 0) { T.v[nd] = totG[q] / (totW[q] + o.lambda) * o.lr; continue; }
        T.f[nd] = bf; T.t[nd] = +thr[bf][bb].toFixed(5);
        const lc = mk(), rc = mk(); T.l[nd] = lc; T.r[nd] = rc; next.push(lc, rc);
        split[q].push(lc, rc);
      }
      for (let i = 0; i < n; i++) {
        const q = idxOf.get(nodeOf[i]); if (q === undefined) continue;
        const sp = split[q]; if (sp[0] < 0) { continue; }
        nodeOf[i] = bins[i * NF + sp[0]] <= sp[1] ? sp[2] : sp[3];
      }
      level = next;
    }
    // 葉の値（最後の層）
    {
      const idxOf = new Map(level.map((nd, q) => [nd, q]));
      const sG = new Float64Array(level.length), sW = new Float64Array(level.length);
      for (let i = 0; i < n; i++) { const q = idxOf.get(nodeOf[i]); if (q === undefined) continue; sG[q] += res[i] * w[i]; sW[q] += w[i]; }
      level.forEach((nd, q) => { T.v[nd] = sW[q] > 0 ? sG[q] / (sW[q] + o.lambda) * o.lr : 0; });
    }
    T.v = T.v.map(v => +v.toFixed(4));
    // 予測を更新（しきい値は丸めたものを使って正確に）
    for (let i = 0; i < n; i++) {
      let nd = 0; while (T.f[nd] >= 0) nd = d[i * REC + 4 + T.f[nd]] <= T.t[nd] ? T.l[nd] : T.r[nd];
      pred[i] += T.v[nd];
    }
    trees.push(T);
  }
  return {v: 1, nf: NF, base: +base.toFixed(4), trees};
}
function score(m, d, i) {
  let v = m.base;
  for (const t of m.trees) { let nd = 0; while (t.f[nd] >= 0) nd = d[i * REC + 4 + t.f[nd]] <= t.t[nd] ? t.l[nd] : t.r[nd]; v += t.v[nd]; }
  return v;
}
/** グループごとに「最初の（衝突が全部消える）候補まで何個試すか」を比べる */
function rankEval(m, D) {
  const {n, d} = D;
  const groups = new Map();
  for (let i = 0; i < n; i++) { const g = d[i * REC]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); }
  const res = {groups: 0, withPerfect: 0, cand: 0, model: 0, legacy: 0, cost: 0, top1: 0};
  for (const idxs of groups.values()) {
    res.groups++; res.cand += idxs.length;
    if (!idxs.some(i => d[i * REC + 3])) continue;
    res.withPerfect++;
    const pos = order => order.findIndex(i => d[i * REC + 3]) + 1;
    const byModel = idxs.slice().sort((p, q) => score(m, d, q) - score(m, d, p) || d[p * REC + 1] - d[q * REC + 1]);
    const byLegacy = idxs.slice().sort((p, q) => d[p * REC + 1] - d[q * REC + 1]);
    const byCost = idxs.slice().sort((p, q) => d[p * REC + 4 + 7] - d[q * REC + 4 + 7] || d[p * REC + 1] - d[q * REC + 1]);
    const pm = pos(byModel); res.model += pm; res.legacy += pos(byLegacy); res.cost += pos(byCost); if (pm === 1) res.top1++;
  }
  const wp = Math.max(1, res.withPerfect);
  return {groups: res.groups, withPerfect: res.withPerfect, candidates: res.cand, avgCandPerGroup: +(res.cand / res.groups).toFixed(1),
    evalsToFirstPerfect: {model: +(res.model / wp).toFixed(2), costOrder: +(res.cost / wp).toFixed(2), legacyOrder: +(res.legacy / wp).toFixed(2)}, modelTop1: +(res.top1 / wp).toFixed(3)};
}
function writeModel(m, patchEngine) {
  const js = JSON.stringify(m);
  fs.mkdirSync(path.dirname(MODEL_JSON), {recursive: true});
  fs.writeFileSync(MODEL_JSON, js + '\n');
  fs.writeFileSync(path.join(ROOT, 'src/fix_model.json'), js + '\n');
  if (!patchEngine) { console.log('モデルを書きました（engine.js は更新していません。`apply` で反映）'); return; }
  const ep = path.join(ROOT, 'web/engine.js');
  let src = fs.readFileSync(ep, 'utf8');
  const re = /\/\*FIXMODEL\*\/\nconst FIX_MODEL = [\s\S]*?;\n\/\*ENDFIXMODEL\*\//;
  if (!re.test(src)) throw new Error('web/engine.js に /*FIXMODEL*/ 欄がありません');
  src = src.replace(re, () => `/*FIXMODEL*/\nconst FIX_MODEL = ${js};\n/*ENDFIXMODEL*/`);
  fs.writeFileSync(ep, src);
  console.log(`モデル書き込み: ${js.length} バイト（木 ${m.trees.length} 本）`);
}

if (cmd === 'apply') {   // assets/fix_model.json を engine.js の欄へ書き込む
  writeModel(JSON.parse(fs.readFileSync(MODEL_JSON, 'utf8')), true);
  process.exit(0);
}

if (cmd === 'fit') {
  const tr = loadBin(opt('--data').split(',')), te = loadBin(opt('--test').split(','));
  const m = fitGbdt(tr, {trees: +opt('--trees', 40), depth: 3, lr: 0.2, lambda: 5, minLeaf: 30, perfectWeight: +opt('--pw', 4)});
  console.log('train', JSON.stringify(rankEval(m, tr)));
  console.log('test ', JSON.stringify(rankEval(m, te)));
  if (A.includes('--write')) writeModel(m, !A.includes('--no-engine'));
  process.exit(0);
}

if (cmd === 'all') {
  const nTrain = +opt('--train', 2400), nTest = +opt('--test', 300), jobs = +opt('--jobs', 2), tag = opt('--tag', 'fixai');
  const dir = path.join(os.tmpdir(), tag); fs.mkdirSync(dir, {recursive: true});
  const shards = [];
  const per = Math.ceil(nTrain / jobs);
  for (let j = 0; j < jobs; j++) shards.push([1 + j * per, Math.min(nTrain, (j + 1) * per), path.join(dir, `train${j}.bin`)]);
  const TEST0 = 500001;
  shards.push([TEST0, TEST0 + nTest - 1, path.join(dir, 'test.bin')]);
  let running = 0, done = 0;
  const run = sh => new Promise(ok => {
    const p = spawn(process.execPath, [__filename, 'gen', '--from', sh[0], '--to', sh[1], '--out', sh[2]], {stdio: 'inherit'});
    p.on('exit', () => ok());
  });
  (async () => {
    const q = shards.slice();
    await Promise.all(Array.from({length: jobs}, async () => { while (q.length) await run(q.shift()); }));
    const trainFiles = shards.slice(0, jobs).map(s => s[2]).join(',');
    const r = spawnSync(process.execPath, [__filename, 'fit', '--data', trainFiles, '--test', shards[jobs][2], '--write'].concat(A.includes('--no-engine') ? ['--no-engine'] : []), {stdio: 'inherit'});
    process.exit(r.status);
  })();
}

if (cmd === 'eval') {
  // 判断AI版 vs 総当たり版: 最終結果（衝突・ほかの警告）と時間・評価数を、保持データのショーで比べる
  const E = require(path.join(ROOT, 'web/engine.js'));
  const [a, b] = opt('--seeds', '500001-500200').split('-').map(Number);
  const row = {shows: 0, equal: 0, better: 0, worse: 0, collEx: 0, collAi: 0, othEx: 0, othAi: 0, msEx: 0, msAi: 0, evEx: 0, evAi: 0, fallback: 0, fullyFixedEx: 0, fullyFixedAi: 0, worseList: []};
  for (let sd = a; sd <= b; sd++) {
    const s = showFor(sd);
    const r = E.jinkeiCompile(s);
    if (!r.ok || !r.data.warnings.some(w => w.kind === '衝突')) continue;
    E.jinkeiMemoClear();
    let t = process.hrtime.bigint(); const ex = E.jinkeiFix(s, {exhaustive: true, stats: true}); const msEx = Number(process.hrtime.bigint() - t) / 1e6;
    E.jinkeiMemoClear();
    t = process.hrtime.bigint(); const ai = E.jinkeiFix(s, {stats: true}); const msAi = Number(process.hrtime.bigint() - t) / 1e6;
    E.jinkeiMemoClear();
    t = process.hrtime.bigint(); const un = E.jinkeiFix(s, {stats: true, noVerify: true}); const msUn = Number(process.hrtime.bigint() - t) / 1e6;   // 確認の総当たりを省いた版（参考）
    row.msUnverified = (row.msUnverified || 0) + msUn; row.evUnverified = (row.evUnverified || 0) + un.stat.evals;
    if (un.after * 10 + un.others[1] > ex.after * 10 + ex.others[1]) row.unverifiedWorse = (row.unverifiedWorse || 0) + 1;
    if (un.after * 10 + un.others[1] < ex.after * 10 + ex.others[1]) row.unverifiedBetter = (row.unverifiedBetter || 0) + 1;
    row.shows++;
    const wEx = ex.after * 10 + ex.others[1], wAi = ai.after * 10 + ai.others[1];
    if (wAi === wEx) row.equal++; else if (wAi < wEx) row.better++; else { row.worse++; row.worseList.push(sd); }
    row.collEx += ex.after; row.collAi += ai.after; row.othEx += ex.others[1] - ex.others[0]; row.othAi += ai.others[1] - ai.others[0];
    row.msEx += msEx; row.msAi += msAi; row.evEx += ex.stat.evals; row.evAi += ai.stat.evals + (ai.stat.guidedEvals || 0) + (ai.stat.verifyEvals || 0);
    if (ai.stat.fallback) row.fallback++;
    if (ex.after === 0) row.fullyFixedEx++; if (ai.after === 0) row.fullyFixedAi++;
  }
  for (const k of ['msEx', 'msAi', 'msUnverified']) row[k] = Math.round(row[k] || 0);
  row.unverifiedSpeedup = +(row.msEx / Math.max(1, row.msUnverified)).toFixed(2); row.unverifiedEvalReduction = +(row.evEx / Math.max(1, row.evUnverified || 1)).toFixed(2);
  row.speedup = +(row.msEx / Math.max(1, row.msAi)).toFixed(2); row.evalReduction = +(row.evEx / Math.max(1, row.evAi)).toFixed(2);
  console.log(JSON.stringify(row));
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(row, null, 1));
}
