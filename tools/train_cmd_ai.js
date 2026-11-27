#!/usr/bin/env node
// 日本語で指示する「判断AI」（src/cmd_core.js）を学習する。決定的（シード固定）・外部ライブラリなし。
//   node tools/train_cmd_ai.js all [--train 60000] [--dev 8000] [--held 8000] [--epochs 12] [--hidden 48] [--seed 1]
//        合成データを作る → 学習 → int8 にする → 温度で較正 → しきい値を決める → 評価 → モデルを書き込む
//   node tools/train_cmd_ai.js eval            いまのモデルを評価だけする（保持データ＋手書きの指示）
// 出力: assets/cmd_model.json（元）と src/cmd_model.json（Rust が include_str! する同じ内容）。
// 方式: ハッシュ文字 n-gram（1〜3、数・セクション名は記号にして）＋ことば辞書 → 隠れ層（ReLU・int8）→ softmax。
//   データは tools/cmd_corpus.js（テンプレートから作る言い換え）。学習用(train)・較正用(dev)・最終テスト用(held)で、テンプレートも言い回しも別。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/cmd_core.js'));
const {genSet, rngOf} = require('./cmd_corpus.js');
const EV = require('./cmd_eval.js');
const A = process.argv.slice(2), cmd = A[0] || 'all';
const opt = (n, d) => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : d; };
const MODEL_ASSET = path.join(ROOT, 'assets/cmd_model.json'), MODEL_SRC = path.join(ROOT, 'src/cmd_model.json');
const CLASSES = C.INTENTS;   // 'none' を含む 66 前後

function loadFile() { return JSON.parse(fs.readFileSync(MODEL_ASSET, 'utf8')); }
const flat = items => items.filter(x => x.intent !== 'compound');
function dedupe(held, others) {   // held と同じ文（正規化後）が train / dev にあれば除く
  const seen = new Set(others.map(x => C.norm(x.text)));
  return held.filter(x => !seen.has(C.norm(x.text)));
}
// 手書きの指示（dev・test）と同じ文は、学習・較正のデータから外す（手書きの点数を水増ししないため）
function handTexts() { return new Set(EV.loadHand('cmd_hand_dev.tsv').concat(EV.loadHand('cmd_hand_test.tsv')).map(x => C.norm(x.text))); }
function sets(o) {
  const seed = +opt('--seed', 1), hand = handTexts();
  const train0 = flat(genSet('train', seed, o.train, {noneRate: 0.07, compoundRate: 0}));
  const train = train0.filter(x => !hand.has(C.norm(x.text)));
  const dev = genSet('dev', seed, o.dev, {noneRate: 0.06, compoundRate: 0.04}).filter(x => !hand.has(C.norm(x.text)));
  sets.excluded = train0.length - train.length;
  let held = genSet('held', seed, Math.round(o.held * 1.1), {noneRate: 0.06, compoundRate: 0.04});
  held = dedupe(held, train.concat(dev)).slice(0, o.held);
  return {train, dev, held};
}

// ---------------------------------------------------------------- 学習
function fit(train, o, log) {
  const D = C.D_DEFAULT, H = o.hidden, K = CLASSES.length, cid = new Map(CLASSES.map((c, i) => [c, i]));
  const R = rngOf(+opt('--seed', 1) * 99991 + 7);
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const feats = train.map(x => C.featureIds(C.norm(x.text), x.ctx, D));
  const ys = train.map(x => cid.get(x.intent));
  const W1 = new Float32Array(D * H), G1 = new Float32Array(D * H), b1 = new Float32Array(H), Gb1 = new Float32Array(H);
  const W2 = new Float32Array(K * H), G2 = new Float32Array(K * H), b2 = new Float32Array(K), Gb2 = new Float32Array(K);
  for (let i = 0; i < W1.length; i++) W1[i] = gauss() * 0.12;
  for (let i = 0; i < W2.length; i++) W2[i] = gauss() * 0.15;
  const lr1 = 0.08, lr2 = 0.06, eps = 0.04, l2 = 2e-6, drop = 0.12;
  const order = Int32Array.from({length: train.length}, (_, i) => i);
  const h = new Float64Array(H), z = new Float64Array(K), dz = new Float64Array(K), dh = new Float64Array(H);
  const kept = new Int32Array(512), keptV = new Float64Array(512);
  for (let ep = 0; ep < o.epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    let loss = 0, correct = 0;
    const decay = ep < o.epochs - 3 ? 1 : 0.5 ** (ep - (o.epochs - 3) + 1);
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi], f = feats[i], y = ys[i];
      let m = 0;
      for (let k = 0; k < f.ids.length && m < 512; k++) if (R() >= drop) { kept[m] = f.ids[k]; keptV[m] = f.vals[k]; m++; }
      if (!m) continue;
      h.fill(0);
      for (let k = 0; k < m; k++) { const base = kept[k] * H, v = keptV[k]; for (let j = 0; j < H; j++) h[j] += v * W1[base + j]; }
      for (let j = 0; j < H; j++) { const t = h[j] + b1[j]; h[j] = t > 0 ? t : 0; }
      let mx = -Infinity;
      for (let c = 0; c < K; c++) { let s = b2[c]; const base = c * H; for (let j = 0; j < H; j++) s += W2[base + j] * h[j]; z[c] = s; if (s > mx) mx = s; }
      let sum = 0; for (let c = 0; c < K; c++) { z[c] = Math.exp(z[c] - mx); sum += z[c]; }
      let am = 0; for (let c = 0; c < K; c++) { z[c] /= sum; if (z[c] > z[am]) am = c; }
      if (am === y) correct++;
      loss -= Math.log(Math.max(z[y], 1e-12));
      for (let c = 0; c < K; c++) dz[c] = z[c] - (c === y ? 1 - eps : 0) - eps / K;
      dh.fill(0);
      for (let c = 0; c < K; c++) { const d = dz[c], base = c * H; if (Math.abs(d) < 1e-7) continue; for (let j = 0; j < H; j++) { dh[j] += W2[base + j] * d; const g = d * h[j] + l2 * W2[base + j]; G2[base + j] += g * g; W2[base + j] -= lr2 * decay * g / (Math.sqrt(G2[base + j]) + 1e-8); } Gb2[c] += d * d; b2[c] -= lr2 * decay * d / (Math.sqrt(Gb2[c]) + 1e-8); }
      for (let j = 0; j < H; j++) { if (h[j] <= 0) dh[j] = 0; }
      for (let k = 0; k < m; k++) { const base = kept[k] * H, v = keptV[k]; for (let j = 0; j < H; j++) { const d = dh[j]; if (d === 0) continue; const g = d * v + l2 * W1[base + j]; G1[base + j] += g * g; W1[base + j] -= lr1 * decay * g / (Math.sqrt(G1[base + j]) + 1e-8); } }
      for (let j = 0; j < H; j++) if (dh[j] !== 0) { Gb1[j] += dh[j] * dh[j]; b1[j] -= lr1 * decay * dh[j] / (Math.sqrt(Gb1[j]) + 1e-8); }
    }
    log(`  epoch ${ep + 1}/${o.epochs}  loss ${(loss / order.length).toFixed(4)}  train acc ${(correct / order.length * 100).toFixed(2)}%`);
  }
  return {D, H, K, W1, b1, W2, b2};
}
// int8 に（隠れユニットごとに倍率を1つ）。W2 などは小さいので数値のまま（小数 4 桁）
function quantize(m) {
  const {D, H, K, W1, b1, W2, b2} = m;
  const s1 = new Float64Array(H), q = new Int8Array(D * H);
  for (let j = 0; j < H; j++) { let mx = 0; for (let i = 0; i < D; i++) mx = Math.max(mx, Math.abs(W1[i * H + j])); s1[j] = mx / 127 || 1e-9; }
  for (let i = 0; i < D; i++) for (let j = 0; j < H; j++) q[i * H + j] = Math.max(-127, Math.min(127, Math.round(W1[i * H + j] / s1[j])));
  const r = (a, p) => Array.from(a, v => +v.toFixed(p));
  return {v: 1, D, H, classes: CLASSES, w1: Buffer.from(q.buffer).toString('base64'), s1: r(s1, 7), b1: r(b1, 4), w2: r(W2, 4), b2: r(b2, 4), T: 1};
}
function calibrate(model, dev) {   // 温度 T: dev の NLL を最小にする
  C.loadModel(model);
  const z = dev.filter(x => x.intent !== 'compound').map(x => ({z: C.logitsN(C.norm(x.text), x.ctx), y: CLASSES.indexOf(x.intent)}));
  let bestT = 1, bestL = Infinity;
  for (let T = 0.4; T <= 4.001; T += 0.02) {
    let L = 0; for (const e of z) { const p = C.softmaxT(e.z, T); L -= Math.log(Math.max(p[e.y], 1e-12)); }
    if (L < bestL) { bestL = L; bestT = T; }
  }
  return +bestT.toFixed(2);
}

// ---------------------------------------------------------------- 実行
function report(name, r) {
  console.log(`${name.padEnd(14)} n=${String(r.n).padEnd(5)} 意図 ${(r.acc * 100).toFixed(1)}%  上位3 ${(r.top3acc * 100).toFixed(1)}%  値一致 ${(r.slotEM * 100).toFixed(1)}% (${r.slotOk}/${r.slotN})  ECE ${(r.ece * 100).toFixed(1)}%  実行 ${(r.coverage * 100).toFixed(1)}%  まちがい実行 ${(r.wrongRate * 100).toFixed(2)}%（行動 ${(r.wrongActionRate * 100).toFixed(2)}%）  複合 ${r.compAcc == null ? '-' : (r.compAcc * 100).toFixed(1) + '%'}  none誤実行 ${r.noneRun}/${r.noneN}  ${r.msP50.toFixed(2)}ms(p50) ${r.msP99.toFixed(2)}ms(p99)`);
}
function evalAll(S, verbose) {
  const hand = {dev: EV.loadHand('cmd_hand_dev.tsv'), test: EV.loadHand('cmd_hand_test.tsv')};
  const out = {};
  out.held = EV.evaluate(C, S.held, {errors: verbose});
  out.handDev = EV.evaluate(C, hand.dev, {errors: verbose});
  out.handTest = EV.evaluate(C, hand.test, {errors: verbose});
  return out;
}
if (cmd === 'all') {
  const o = {train: +opt('--train', 60000), dev: +opt('--dev', 8000), held: +opt('--held', 8000), epochs: +opt('--epochs', 12), hidden: +opt('--hidden', 48)};
  const t0 = Date.now(), log = s => console.log(s);
  log(`データ作り: train ${o.train} / dev ${o.dev} / held ${o.held}`);
  const S = sets(o);
  const idist = {}; for (const x of S.train) idist[x.intent] = (idist[x.intent] || 0) + 1;
  log(`  意図 ${CLASSES.length} 個、train ${S.train.length} 文（一番少ない意図 ${Math.min(...Object.values(idist))} 文）`);
  const m = fit(S.train, o, log);
  const model = quantize(m);
  model.T = calibrate(model, S.dev);
  C.loadModel(model);
  log(`温度 T = ${model.T}`);
  // しきい値: dev（合成）＋手書き dev で、まちがい実行が 0.5% 以下になる範囲で実行できる割合が最大のもの
  const handDev = EV.loadHand('cmd_hand_dev.tsv');
  const tun = EV.tunePolicy(C, S.dev.concat(handDev), 0.005);
  model.policy = {high: tun.high, margin: tun.margin, mid: 0.30, auto: Math.min(0.99, Math.max(tun.high + 0.08, 0.93))};
  Object.assign(C.POLICY, model.policy);
  log(`しきい値: high=${tun.high} margin=${tun.margin}（dev で まちがい実行 ${(tun.wrongRate * 100).toFixed(2)}%・実行できる割合 ${(tun.coverage * 100).toFixed(1)}%）`);
  C.loadModel(model);
  const R = evalAll(S, false);
  model.info = {seed: +opt('--seed', 1), train: S.train.length, handExcluded: sets.excluded, epochs: o.epochs, hidden: o.hidden, held: {intent: +R.held.acc.toFixed(4), slot: +R.held.slotEM.toFixed(4), ece: +R.held.ece.toFixed(4), wrong: +R.held.wrongRate.toFixed(4)}};
  const js = JSON.stringify(model);
  fs.writeFileSync(MODEL_ASSET, js + '\n'); fs.writeFileSync(MODEL_SRC, js + '\n');
  log(`モデル: ${(js.length / 1024).toFixed(0)} KB（gzip ${(require('zlib').gzipSync(js).length / 1024).toFixed(0)} KB）  学習 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  report('保持(合成)', R.held); report('手書き dev', R.handDev); report('手書き test', R.handTest);
} else if (cmd === 'eval') {
  C.loadModel(loadFile());
  const o = {train: +opt('--train', 60000), dev: +opt('--dev', 8000), held: +opt('--held', 8000)};
  const S = sets({train: o.train, dev: o.dev, held: o.held});
  const R = evalAll(S, A.includes('-v'));
  report('保持(合成)', R.held); report('手書き dev', R.handDev); report('手書き test', R.handTest);
  if (A.includes('-v')) for (const k of ['handDev', 'handTest', 'held']) { console.log('--- ' + k + ' まちがい実行'); (R[k].wrongRuns || []).slice(0, +opt('--show', 60)).forEach(e => console.log('  ' + JSON.stringify(e))); }
  if (A.includes('-v')) for (const k of ['handDev', 'handTest', 'held']) { console.log('--- ' + k + ' の誤り'); R[k].errors.slice(0, +opt('--show', 60)).forEach(e => console.log('  ' + JSON.stringify(e))); }
}
