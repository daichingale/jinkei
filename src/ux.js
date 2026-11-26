// 初心者向けUI: ようこそ・かんたん作成・ガイドツアー・ヘルプ・ピッカー・やさしい警告・タッチ操作。
// editor.html の本体スクリプトの後に読み込まれ、そのグローバル（M, R, sel, edited …）を使う。
(function () {
'use strict';
const X = window.JKX;
if (!X) return;
const KEY = 'jk_ux_v1';
const UX = {mode: 'easy', welcomed: false, tourDone: false};
const REDUCED = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- 保存（localStorage は使えない環境もあるので try/catch） ----------------
let hadStore = false;
function uxLoad() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && typeof o === 'object') { Object.assign(UX, o); hadStore = true; } } catch (e) { /* 使えない環境 */ }
}
function uxSave() { try { localStorage.setItem(KEY, JSON.stringify(UX)); } catch (e) { /* 使えない環境 */ } }

// ---------------- アイコン（ライブラリが無い・足りないときは中立のプレースホルダ） ----------------
if (typeof window.jkIcon !== 'function') { window.jkIcon = function () { return ''; }; window.__jkIconStub = true; }
function ic(name, size, cls) {
  size = size || 24;
  let h = '';
  try { h = window.jkIcon(name, size, cls || '') || ''; } catch (e) { h = ''; }
  if (h && String(h).trim()) return h;
  if (/^pose-/.test(name) && typeof poseIcon === 'function') return `<span class="ic fb ${cls || ''}" style="width:${size}px;height:${size}px">${poseIcon(name.slice(5))}</span>`;
  return `<svg class="ic ph ${cls || ''}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" opacity=".14"/><circle cx="12" cy="12" r="3.4" fill="currentColor" opacity=".4"/></svg>`;
}
window.ic = ic;
const illu = (name, size, extra) => `<span class="illu" style="${extra || ''}">${ic(name, size)}</span>`;

// ---------------- トースト ----------------
function uxToast(msg, kind, ms) {
  let box = $('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || 'ok');
  t.innerHTML = `${kind === 'err' ? ic('mascot-oops', 28) : ic(kind === 'info' ? 'mascot-think' : 'mascot-cheer', 28)}<span>${esc(msg)}</span>`;
  const phone = document.documentElement.classList.contains('mp');
  if (phone) { while (box.firstChild) box.firstChild.remove(); }   // スマホは常に1つだけ（上に出す）
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  const life = ms || (phone && /元に戻|取り消/.test(msg) ? 5000 : 3000);
  let gone = false;
  const bye = () => { if (gone) return; gone = true; t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  setTimeout(bye, life);
  if (phone) {   // 横にはらうと消える
    let x0 = null, dx = 0;
    t.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; try { t.setPointerCapture(e.pointerId); } catch (z) { /* 無視 */ } });
    t.addEventListener('pointermove', e => { if (x0 === null) return; dx = e.clientX - x0; t.style.transform = `translateX(${dx}px)`; t.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220)); });
    const end = () => { if (x0 === null) return; x0 = null; if (Math.abs(dx) > 50) { t.style.transform = `translateX(${dx > 0 ? 120 : -120}vw)`; bye(); } else { t.style.transform = ''; t.style.opacity = ''; if (Math.abs(dx) < 6) bye(); } };
    t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
  }
}
window.uxToast = uxToast;
window.uxBusy = on => document.body.style.cursor = on ? 'progress' : '';
window.uxEmpty = (kind, title, text, btn, btnId) => `<div class="empty-state">${ic('empty-' + kind, 120)}<b>${title}</b><p>${esc(text)}</p>${btn ? `<button class="pri bigbtn" id="${btnId}">${btn}</button>` : ''}</div>`;
window.uxQh = topic => `<button type="button" class="qh" data-help="${topic}" title="使い方を見る" aria-label="ヘルプを開く">?</button>`;

// ---------------- ダイアログ ----------------
function mkDialog(id, cls) {
  const old = $(id); if (old) { try { old.close(); } catch (e) { /* 閉じていた */ } old.remove(); }
  const d = document.createElement('dialog');
  d.id = id; d.className = 'uxdlg ' + cls;
  document.body.appendChild(d);
  return d;
}
function openDlg(d) {
  try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
  const f = d.querySelector('[autofocus]') || d.querySelector('.ux-foot .pri') || d.querySelector('.ux-body button') || d.querySelector('button');
  if (f) setTimeout(() => f.focus({preventScroll: true}), 30);
}
const closeBtn = '<button type="button" class="ghost x" data-close aria-label="閉じる">✕</button>';

// ---------------- モード ----------------
function setMode(m) {
  UX.mode = m === 'pro' ? 'pro' : 'easy';
  document.body.classList.toggle('easy', UX.mode === 'easy');
  document.querySelectorAll('#modesw button').forEach(b => { const on = b.dataset.mode === UX.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  if (UX.mode === 'easy' && $('pcode').classList.contains('on')) showTab('pset');
  uxSave();
  uxSides();
  uxNext();
  if (M && R) { try { renderPanels(); } catch (e) { /* 描画中 */ } }
}

// ---------------- 現在の編集内容を差し替える（サンプル・かんたん作成の結果） ----------------
async function uxLoadSource(text, name) {
  if (window.JK_LOCAL) { await loadLocal(text, name || '新しいショー.jk', null); return; }
  stopPlay(); playT = null;
  pushUndo(currentSource());
  clearEditTimers();
  sel.clear(); curSet = 0; curStmt = -1; fieldKey = '';
  svg.replaceChildren();
  $('code').value = text;
  await compile(text, true);
  dirty = text !== savedSrc;
  setStatusFromState();
}
const cj = async s => fetch('/api/compile', {method: 'POST', body: s}).then(r => r.json());
const fj = async s => fetch('/api/fix', {method: 'POST', body: s}).then(r => r.json());

// ======================================================================
// ようこそ画面
// ======================================================================
let welDlg = null;
function uxWelcome() {
  closeAllUx();
  const d = welDlg = mkDialog('uxwelcome', 'welcome');
  const draft = window.JK_PROJECT && window.JK_PROJECT.initial;
  const nm = $('fname').textContent || '';
  const canResume = window.JK_LOCAL ? !!(draft && draft.source) : !!nm;
  const resumeDesc = window.JK_LOCAL
    ? (canResume ? `ブラウザに残っている「${esc(draft.name || nm)}」の続きを編集します。` : 'まだ保存した作業がありません。')
    : `いま開いている「${esc(nm)}」をそのまま編集します。`;
  d.innerHTML = `${closeBtn.replace('class="ghost x"', 'class="ghost x abs"')}
  <div class="ux-body" style="padding-top:18px">
    <div class="welhead">${illu('mascot-wave', 96, 'width:112px;height:112px')}<div class="bubble"><h2>陣形エディタへ ようこそ！</h2><p>マーチングの隊形づくりを、絵を見ながら始めましょう。むずかしい知識はいりません。</p></div></div>
    <div class="wcards" id="welcards">
      <button type="button" class="wcard main" data-go="wizard" autofocus><span class="badge">はじめての方</span>${illu('mascot-baton', 64)}<span><h3>かんたん作成</h3><p>会場・人数・隊形をえらぶだけで、動くショーが自動でできあがります。</p></span></button>
      <button type="button" class="wcard" data-go="samples">${illu('venue-gym', 64)}<span><h3>サンプルから始める</h3><p>できあがったショーを開いて、見ながら自分の形に直せます。</p></span></button>
      <button type="button" class="wcard" data-go="open">${illu('help-save', 64)}<span><h3>ファイルを開く</h3><p>保存した .jk ファイルを読み込みます。画面にドラッグしてもOK。</p></span></button>
      ${typeof window.jkOpenParade === 'function' ? `<button type="button" class="wcard" data-go="parade">${illu('shape-company-front', 64)}<span><h3>パレードを作る</h3><p>行進の隊列移動（パレード）を、コースと隊列から自動で組み立てます。</p></span></button>` : ''}
      <button type="button" class="wcard" data-go="resume" ${canResume ? '' : 'disabled'}>${illu('help-play', 64)}<span><h3>続きから</h3><p>${resumeDesc}</p></span></button>
    </div>
  </div>
  <div class="ux-foot"><span class="sp"></span><button type="button" data-go="tour">${ic('help-select', 20)} ガイドツアーを見る</button><button type="button" data-go="close" class="pri">このまま編集する</button></div>`;
  d.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { welClose(); return; }
    const b = e.target.closest('[data-go]'); if (!b || b.disabled) return;
    const g = b.dataset.go;
    if (g === 'close' || g === 'resume') welClose();
    else if (g === 'wizard') { welClose(); uxWizard(); }
    else if (g === 'samples') uxSamples();
    else if (g === 'tour') { welClose(); setTimeout(() => uxTour(true), 120); }
    else if (g === 'open') { welClose(); uxOpenFile(); }
    else if (g === 'parade') { welClose(); if (typeof window.jkOpenParade === 'function') setTimeout(() => window.jkOpenParade(), 120); }
  });
  d.addEventListener('close', () => { UX.welcomed = true; uxSave(); });
  openDlg(d);
}
function welClose() { if (welDlg) { UX.welcomed = true; uxSave(); try { welDlg.close(); } catch (e) { /* すでに閉じた */ } } }
function closeAllUx() { document.querySelectorAll('dialog.uxdlg[open]').forEach(d => { try { d.close(); } catch (e) { /* 閉じていた */ } }); closeUxPop(); }
function uxOpenFile() {
  if (window.JK_LOCAL) { $('open').click(); return; }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.jk,text/plain';
  inp.onchange = async () => { const f = inp.files[0]; if (f) { await uxLoadSource(await f.text(), f.name); uxToast(`「${f.name}」を開きました`, 'ok'); } };
  inp.click();
}

// ---- サンプルギャラリー ----
const exCache = {};
function dotsOf(D, k) { return D.sets[k].pos.map((p, i) => ({x: p[0], y: p[1], color: D.sections[D.performers[i].sec].color})); }
async function uxSamples() {
  const d = welDlg; if (!d || !d.open) return;
  const list = window.JK_EXAMPLES || [];
  d.querySelector('.ux-body').innerHTML = `<div class="mascot-say">${illu('mascot-point', 56, 'width:64px;height:64px')}<div class="bubble">好きなサンプルをえらんでください。マウスを重ねると、隊形が順に変わるのが見えます。</div></div>
    <div class="exgrid" id="exgrid">${list.map((e, i) => `<button type="button" class="excard" data-i="${i}"><div class="th load">読み込み中…</div><b>${esc(e.file.replace(/\.jk$/, ''))}</b><span>&nbsp;</span></button>`).join('') || '<p>サンプルが見つかりません。</p>'}</div>`;
  d.querySelector('.ux-foot').innerHTML = `<button type="button" data-back>← もどる</button><span class="sp"></span><button type="button" data-go="close">とじる</button>`;
  d.querySelector('[data-back]').onclick = () => { uxWelcome(); };
  d.querySelector('[data-go="close"]').onclick = welClose;
  const grid = d.querySelector('#exgrid');
  grid.addEventListener('click', async e => {
    const b = e.target.closest('.excard'); if (!b) return;
    const ex = list[+b.dataset.i];
    welClose();
    await uxLoadSource(ex.src, ex.file);
    uxToast(`サンプル「${ex.file}」を開きました。自由に動かして試してください`, 'ok', 3800);
    uxNext();
  });
  // 各サンプルを計算して、真上から見たミニ図をつくる
  let touched = false;
  for (let i = 0; i < list.length; i++) {
    const ex = list[i];
    try {
      const r = exCache[ex.file] || (exCache[ex.file] = await cj(ex.src));
      touched = true;
      const card = grid.querySelector(`[data-i="${i}"]`); if (!card) break;
      if (!r.ok) { card.querySelector('.th').textContent = '読み込めません'; continue; }
      const D = r.data, base = Math.min(1, D.sets.length - 1);
      const name = (ex.src.match(/^#\s*陣形 サンプル[:：]\s*(.*)$/m) || [])[1] || '';
      const venue = {gym: '体育館', stage: 'ステージ', football: 'フットボール場', floor: 'フロア'}[D.field.type] || '';
      card.querySelector('.th').className = 'th';
      card.querySelector('.th').innerHTML = X.miniSvg(D.field, dotsOf(D, base), {label: D.name});
      card.querySelector('b').textContent = D.name;
      card.querySelector('span').textContent = `${venue}・${D.performers.length}人・${D.sets.length}セット${name ? '　' + name.replace(/（.*$/, '') : ''}`;
      let k = base, timer = 0;
      const step = () => { k = (k + 1) % D.sets.length; card.querySelector('.th').innerHTML = X.miniSvg(D.field, dotsOf(D, k), {label: D.name}); };
      const stop = () => { clearInterval(timer); timer = 0; k = base; card.querySelector('.th').innerHTML = X.miniSvg(D.field, dotsOf(D, base), {label: D.name}); };
      if (!REDUCED()) { card.addEventListener('mouseenter', () => { if (!timer) timer = setInterval(step, 900); }); card.addEventListener('mouseleave', stop); card.addEventListener('focus', () => { if (!timer) timer = setInterval(step, 900); }); card.addEventListener('blur', stop); }
    } catch (e) { /* この1件だけ飛ばす */ }
  }
  // サーバ版: 最後に計算したソースを元の編集中のものに戻す（プレビューが別のショーにならないように）
  if (touched && !window.JK_LOCAL) { try { await fetch('/api/compile', {method: 'POST', body: currentSource()}); } catch (e) { /* 無視 */ } }
}


// ======================================================================
// 新規: 何から始めるかを選ぶ（白紙・かんたん作成・テンプレート・パレード）
// ======================================================================
let newDlg = null;
const NEW_TPL = [
  {id: 'tpl-small', name: '少人数の基本', desc: '8人・体育館・横一列→ブロック→円', o: {venue: 'gym', preset: 'small8', forms: ['line', 'block', 'circle']}},
  {id: 'tpl-band', name: '吹奏楽部の基本', desc: '30人・体育館・ブロック→アーク→円', o: {venue: 'gym', preset: 'band30', forms: ['block', 'arc', 'circle']}},
  {id: 'tpl-drum', name: 'ドラムライン', desc: '14人・フロア・ライン→ブロック', o: {venue: 'floor', preset: 'drum', forms: ['line', 'block', 'line']}},
  {id: 'tpl-stage', name: 'ステージの基本', desc: '少人数・ステージ・ライン→アーク', o: {venue: 'stage', preset: 'small8', forms: ['line', 'arc', 'block']}},
];
async function newGuard() {
  if (typeof dirty === 'undefined' || !dirty) return true;
  if (newDlg && newDlg.open) { try { newDlg.close(); } catch (e) { /* 閉じていた */ } }   // 確認ダイアログが前に出るように、いったん閉じる
  const v = await modal('', '保存していない変更があります。新しく作る前に、保存しますか？（保存しなくても「下書き履歴」には残ります）', [{label: 'キャンセル', value: false}, {label: '保存せず新規', value: true}, {label: '保存してから新規', value: 'save', cls: 'pri'}]);
  if (v === 'save') { await save(); if (typeof dirty !== 'undefined' && dirty) { uxNewShow(); return false; } return true; }
  if (!v) { uxNewShow(); return false; }
  return true;
}
async function newCreate(text, name) {
  if (!(await newGuard())) return false;
  if (newDlg && newDlg.open) { try { newDlg.close(); } catch (e) { /* 閉じていた */ } }
  await uxLoadSource(text, name);
  showTab('pset');
  uxToast(`新しいショー「${name.replace(/\.jk$/, '')}」を作りました`, 'ok');
  return true;
}
function newBlankText(o) {
  const m = X.buildModel({name: o.name, venue: o.venue, counts: o.counts, forms: ['line'], bpm: 120, moveCount: 16});
  m.sets = [m.sets[0]];   // セットは1つ（全員が横一列に並んだ状態）。あとは自分で並べる
  m.header = ['白紙から始めたショー'];
  return printModel(m);
}
function uxNewShow() {
  closeAllUx();
  const d = newDlg = mkDialog('uxnew', 'newshow');
  const dirtyNow = typeof dirty !== 'undefined' && dirty;
  const home = () => {
    d.innerHTML = `<div class="ux-head"><span>${illu('mascot-point', 56, 'width:64px;height:64px')}</span><div><h2>新しいショーをつくる</h2><p>どれで始めますか？${dirtyNow ? '　（いまの編集内容は、このあとで保存するか選べます）' : ''}</p></div>${closeBtn}</div>
    <div class="ux-body"><div class="wcards" id="newcards">
      <button type="button" class="wcard" data-new="blank">${illu('venue-gym', 64)}<span><h3>白紙から</h3><p>会場と人数だけえらんで、あとは自分で並べます（最初は横一列）。</p></span></button>
      <button type="button" class="wcard main" data-new="wizard"><span class="badge">はじめての方</span>${illu('mascot-baton', 64)}<span><h3>かんたん作成</h3><p>会場・人数・隊形をえらぶだけで、動くショーができます。</p></span></button>
      <button type="button" class="wcard" data-new="tpl">${illu('shape-company-front', 64)}<span><h3>テンプレートから</h3><p>サンプルや基本の編成を、絵を見ながらえらべます。</p></span></button>
      ${typeof window.jkOpenParade === 'function' ? `<button type="button" class="wcard" data-new="parade">${illu('shape-company-front', 64)}<span><h3>パレードを作る</h3><p>行進の隊列移動を、コースとパターンから自動で作ります。</p></span></button>` : ''}
    </div></div><div class="ux-foot"><span class="sp"></span><button type="button" data-close>キャンセル</button></div>`;
  };
  const back = '<button type="button" data-newback>← もどる</button>';
  const blank = () => {
    const B = {venue: 'gym', preset: 'band30', name: '新しいショー'};
    const draw = () => {
      d.querySelector('.ux-body').innerHTML = `<div class="mascot-say">${illu('mascot-think', 56, 'width:64px;height:64px')}<div class="bubble">会場と人数をえらびます。全員が横一列に並んだセット1から始まります。</div></div>
      <h3 class="newh">会場</h3><div class="newrow">${X.VENUES.map(v => `<button type="button" class="newopt ${v.id === B.venue ? 'on' : ''}" data-venue="${v.id}"><b>${v.name}</b><span>${esc(v.desc)}</span></button>`).join('')}</div>
      <h3 class="newh">編成</h3><div class="newrow">${X.PRESETS.map(pr => `<button type="button" class="newopt ${pr.id === B.preset ? 'on' : ''}" data-preset="${pr.id}"><b>${pr.name}</b><span>${pr.sub}</span></button>`).join('')}</div>
      <h3 class="newh">ショーの名前</h3><input id="newname" type="text" value="${esc(B.name)}" maxlength="40" style="width:100%">`;
    };
    d.innerHTML = `<div class="ux-head"><span>${illu('venue-gym', 48, 'width:56px;height:56px')}</span><div><h2>白紙から</h2><p>会場と人数をえらびます</p></div>${closeBtn}</div><div class="ux-body"></div><div class="ux-foot">${back}<span class="sp"></span><button type="button" class="pri" id="newgo">この内容で作る</button></div>`;
    draw();
    d.querySelector('.ux-body').addEventListener('click', e => {
      const v = e.target.closest('[data-venue]'), pr = e.target.closest('[data-preset]');
      if (v) B.venue = v.dataset.venue; else if (pr) B.preset = pr.dataset.preset; else return;
      const nm = d.querySelector('#newname'); if (nm) B.name = nm.value; draw();
    });
    d.querySelector('#newgo').onclick = async () => {
      B.name = (d.querySelector('#newname').value || '').trim() || '新しいショー';
      const pre = X.PRESETS.find(x => x.id === B.preset);
      await newCreate(newBlankText({name: B.name, venue: B.venue, counts: pre.counts}), B.name + '.jk');
    };
  };
  const tpls = async () => {
    const items = (window.JK_EXAMPLES || []).map(e => ({title: e.file.replace(/\.jk$/, ''), src: e.src, file: e.file, kind: 'サンプル'}));
    for (const t of NEW_TPL) {
      const pre = X.PRESETS.find(x => x.id === t.o.preset);
      const m = X.buildModel({name: t.name, venue: t.o.venue, counts: pre.counts, forms: t.o.forms, bpm: 120, moveCount: 16});
      items.push({title: t.name, src: printModel(m), file: t.name + '.jk', kind: '基本の編成', desc: t.desc});
    }
    d.innerHTML = `<div class="ux-head"><span>${illu('mascot-point', 56, 'width:64px;height:64px')}</span><div><h2>テンプレートから</h2><p>えらぶと、新しいショーとして開きます（元のサンプルは変わりません）</p></div>${closeBtn}</div>
    <div class="ux-body"><div class="exgrid" id="newgrid">${items.map((e, i) => `<button type="button" class="excard" data-i="${i}"><div class="th load">読み込み中…</div><b>${esc(e.title)}</b><span>${esc(e.kind)}${e.desc ? '　' + esc(e.desc) : ''}</span></button>`).join('')}</div></div>
    <div class="ux-foot">${back}<span class="sp"></span><button type="button" data-close>キャンセル</button></div>`;
    const grid = d.querySelector('#newgrid');
    grid.addEventListener('click', async e => { const b = e.target.closest('.excard'); if (!b) return; const it = items[+b.dataset.i]; await newCreate(it.src, it.file); });
    let touched = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        const r = exCache[it.file] || (exCache[it.file] = await cj(it.src));
        touched = true;
        const card = grid.querySelector(`[data-i="${i}"]`); if (!card) break;
        if (!r.ok) { card.querySelector('.th').textContent = '読み込めません'; continue; }
        const D = r.data, base = Math.min(1, D.sets.length - 1);
        card.querySelector('.th').className = 'th';
        card.querySelector('.th').innerHTML = X.miniSvg(D.field, dotsOf(D, base), {label: D.name});
        card.querySelector('span').textContent = `${it.kind}・${D.performers.length}人・${D.sets.length}セット`;
      } catch (e) { /* この1件だけ飛ばす */ }
    }
    if (touched && !window.JK_LOCAL) { try { await fetch('/api/compile', {method: 'POST', body: currentSource()}); } catch (e) { /* 無視 */ } }
  };
  home();
  d.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { d.close(); return; }
    if (e.target.closest('[data-newback]')) { home(); return; }
    const b = e.target.closest('[data-new]'); if (!b) return;
    const g = b.dataset.new;
    if (g === 'blank') blank();
    else if (g === 'tpl') tpls();
    else if (g === 'wizard') { if (await newGuard()) { d.close(); uxWizard(); } }
    else if (g === 'parade') { if (await newGuard()) { d.close(); setTimeout(() => window.jkOpenParade(), 120); } }
  });
  openDlg(d);
}
window.uxNewShow = uxNewShow;

// ======================================================================
// かんたん作成ウィザード
// ======================================================================
const WZ_STEPS = ['会場', '編成', '隊形の流れ', 'テンポと長さ', '見た目'];
let W = null, wzDlg = null;
function wzInit() {
  W = {step: 0, venue: 'gym', preset: 'band30', counts: Object.assign({}, X.PRESETS[1].counts), forms: ['block', 'arc', 'circle', 'company-front'], bpm: 120, moveCount: 16, look: 'real', name: 'はじめてのショー', taps: [], err: ''};
}
function uxWizard() {
  closeAllUx(); wzInit();
  const d = wzDlg = mkDialog('uxwizard', 'wizard');
  d.innerHTML = `<div class="ux-head"><span id="wzmascot"></span><div><h2 id="wztitle"></h2><p id="wzsub"></p></div>${closeBtn}</div><div class="ux-body" id="wzbody"></div>
  <div class="ux-foot"><button type="button" id="wzback">← もどる</button><span class="sp"></span><div class="wz-dots" id="wzdots" aria-label="進み具合"></div><span class="wz-steplab" id="wzlab"></span><span class="sp"></span><button type="button" id="wznext" class="pri bigbtn">つぎへ →</button></div>`;
  d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });
  $('wzback').onclick = () => { if (W.step > 0) { W.step--; wzRender(); } else { d.close(); uxWelcome(); } };
  $('wznext').onclick = () => { if (W.step < 4) { if (wzValid()) { W.step++; wzRender(); } } else wzCreate(); };
  openDlg(d);
  wzRender();
}
const wzTotal = () => X.total(W.counts);
function wzValid() {
  if (W.step === 1 && wzTotal() < 1) return false;
  if (W.step === 2 && (W.forms.length < 3 || W.forms.length > 5)) return false;
  return true;
}
function wzRender() {
  const body = $('wzbody'), s = W.step;
  const heads = [
    ['mascot-point', 'どこで演技しますか？', '会場によって、広さや呼び方が変わります（あとから変えられます）'],
    ['mascot-baton', '何人で、どの楽器ですか？', '「おすすめの編成」から始めて、人数を足したり減らしたりできます'],
    ['mascot-think', 'どんな形に変えていきますか？', '3〜5個えらぶと、その順番に隊形が変わっていきます'],
    ['mascot-cheer', 'テンポと長さを決めましょう', '曲の速さ（BPM）と、1回の移動にかけるカウントです'],
    ['mascot-face', 'さいごに、見た目を決めます', 'あとから「ショー」タブでも変えられます']
  ][s];
  $('wzmascot').innerHTML = illu(heads[0], 56, 'width:68px;height:68px');
  $('wztitle').textContent = heads[1]; $('wzsub').textContent = heads[2];
  $('wzdots').innerHTML = WZ_STEPS.map((n, i) => `<i class="${i === s ? 'on' : i < s ? 'done' : ''}" title="${n}"></i>`).join('');
  $('wzlab').textContent = `${s + 1} / ${WZ_STEPS.length}　${WZ_STEPS[s]}`;
  $('wzback').textContent = s === 0 ? 'やめる' : '← もどる';
  $('wznext').textContent = s === 4 ? 'ショーを作る' : 'つぎへ →';
  [wzVenue, wzBand, wzForms, wzTempo, wzLook][s](body);
  wzButtons();
  body.scrollTop = 0;
}
function wzButtons() {
  const n = $('wznext'); if (!n) return;
  n.disabled = !wzValid();
}
// ① 会場
function wzVenue(body) {
  body.innerHTML = `<div class="opts-grid g4" role="radiogroup" aria-label="会場">${X.VENUES.map(v => `<button type="button" class="pick" role="radio" aria-checked="${W.venue === v.id}" data-v="${v.id}"><span class="chk">✓</span>${illu('venue-' + v.id, 96, 'width:100%')}<b>${v.name}</b><span class="d">${v.desc}</span></button>`).join('')}</div>`;
  body.querySelectorAll('.pick').forEach(b => b.onclick = () => { W.venue = b.dataset.v; body.querySelectorAll('.pick').forEach(x => x.setAttribute('aria-checked', x === b)); });
}
// ② 編成
function wzBand(body) {
  const groups = ['金管', '木管', '打楽器', 'その他'];
  body.innerHTML = `<div class="lbl-s">おすすめの編成</div>
  <div class="presets" id="wzpresets">${X.PRESETS.map(p => `<button type="button" class="pick ${W.preset === p.id ? 'on' : ''}" data-p="${p.id}">${illu(p.pic, 32, 'width:44px;height:44px')}<span><b>${p.name}</b><span class="d">${X.total(p.counts)}人</span></span></button>`).join('')}</div>
  ${groups.map(g => `<div class="igroup">${g}</div><div class="igrid">${X.INST.filter(r => r[4] === g).map(r => `<div class="icell" data-i="${r[0]}">${illu('inst-' + r[0], 40)}<span class="nm">${r[1]}</span><div class="stp"><button type="button" data-d="-1" aria-label="${r[1]}を減らす">−</button><output></output><button type="button" data-d="1" aria-label="${r[1]}を増やす">＋</button></div></div>`).join('')}</div>`).join('')}
  <div class="totalbar"><span>合計</span><b id="wztot">0</b><span>人</span><span class="sp" style="flex:1"></span><span id="wzsecs" style="color:var(--mut);font-size:12px"></span></div>`;
  const refresh = () => {
    body.querySelectorAll('.icell').forEach(c => { const n = W.counts[c.dataset.i] || 0; c.classList.toggle('has', n > 0); c.querySelector('output').textContent = n; c.querySelector('[data-d="-1"]').disabled = n <= 0; });
    $('wztot').textContent = wzTotal();
    $('wzsecs').textContent = X.sectionsFromCounts(W.counts).map(s => `${s.label}${s.n}`).join('・');
    body.querySelectorAll('#wzpresets .pick').forEach(b => b.classList.toggle('on', b.dataset.p === W.preset));
    wzButtons();
  };
  body.querySelectorAll('.icell [data-d]').forEach(b => b.onclick = () => {
    const id = b.closest('.icell').dataset.i; const n = Math.max(0, Math.min(40, (W.counts[id] || 0) + +b.dataset.d));
    if (n) W.counts[id] = n; else delete W.counts[id];
    W.preset = ''; refresh();
  });
  body.querySelectorAll('#wzpresets .pick').forEach(b => b.onclick = () => { const p = X.PRESETS.find(x => x.id === b.dataset.p); W.preset = p.id; W.counts = Object.assign({}, p.counts); refresh(); });
  refresh();
}
// ③ 隊形の流れ
function wzGeom() { return {V: X.venueGeom(X.VENUES.find(v => v.id === W.venue).field), field: X.fieldDesc(X.VENUES.find(v => v.id === W.venue).field), secs: X.sectionsFromCounts(W.counts)}; }
const wzThumb = (id, g, idx) => X.miniSvg(g.field, X.thumbDots(id, g.V, g.secs, idx), {label: X.FORM_BY[id].name});
function wzForms(body) {
  const g = wzGeom();
  body.innerHTML = `<div class="lbl-s">あなたの流れ（ドラッグか ◀ ▶ で順番を入れかえ）　<span id="wzcnt" style="color:var(--acc)"></span></div>
  <div class="flowstrip" id="wzstrip" aria-label="えらんだ隊形の順番"></div>
  <div class="lbl-s">隊形をえらぶ（クリックで 追加／はずす）</div>
  <div class="fgrid" id="wzfgrid">${X.FORMS.map(f => `<button type="button" class="fcard" data-f="${f.id}" title="${esc(f.desc)}"><span class="no"></span><div class="th">${wzThumb(f.id, g, 1)}</div><b>${ic('shape-' + f.id, 18)} ${f.name}</b><small>${f.desc}</small></button>`).join('')}</div>
  <div id="wznote" class="mascot-say" style="margin-top:10px"></div>`;
  const strip = $('wzstrip');
  const draw = () => {
    strip.innerHTML = W.forms.length ? W.forms.map((id, i) => `<div class="flowitem" draggable="true" data-i="${i}"><span class="no">${i + 1}</span><div class="th">${wzThumb(id, g, i)}</div><span class="nm">${X.FORM_BY[id].name}</span><span class="mv"><button type="button" data-m="-1" aria-label="${X.FORM_BY[id].name}を前へ" ${i === 0 ? 'disabled' : ''}>◀</button><button type="button" data-m="1" aria-label="${X.FORM_BY[id].name}を後ろへ" ${i === W.forms.length - 1 ? 'disabled' : ''}>▶</button><button type="button" data-m="x" aria-label="${X.FORM_BY[id].name}をはずす">✕</button></span></div>`).join('') : '<span class="empty">下から隊形をえらんでください</span>';
    $('wzcnt').textContent = `${W.forms.length} 個えらびました（3〜5個）`;
    body.querySelectorAll('.fcard').forEach(c => { const k = W.forms.indexOf(c.dataset.f); c.classList.toggle('on', k >= 0); c.querySelector('.no').textContent = k >= 0 ? k + 1 : ''; });
    const first = W.forms[0], ff = X.FORM_BY[first];
    $('wznote').innerHTML = W.forms.length < 3 ? `${illu('mascot-think', 32, 'width:44px;height:44px')}<div class="bubble">あと ${3 - W.forms.length} 個えらぶと、つぎへ進めます。</div>`
      : ff && ff.noFirst ? `${illu('mascot-oops', 32, 'width:44px;height:44px')}<div class="bubble">「ヘビ行進」は2番目以降で使う形です。最初は曲線になります。</div>`
      : `${illu('mascot-cheer', 32, 'width:44px;height:44px')}<div class="bubble">いい流れです！ 最初の隊形は「${ff ? ff.name : ''}」です。</div>`;
    wzButtons();
  };
  strip.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const i = +b.closest('.flowitem').dataset.i, m = b.dataset.m;
    if (m === 'x') W.forms.splice(i, 1);
    else { const j = i + +m; if (j >= 0 && j < W.forms.length) [W.forms[i], W.forms[j]] = [W.forms[j], W.forms[i]]; }
    draw(); const nb = strip.querySelector(`.flowitem[data-i="${m === 'x' ? Math.min(i, W.forms.length - 1) : i + +m}"] [data-m="${m === 'x' ? 'x' : m}"]`); if (nb) nb.focus();
  });
  let dragI = -1;
  strip.addEventListener('dragstart', e => { const it = e.target.closest('.flowitem'); if (!it) return; dragI = +it.dataset.i; it.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragI)); } catch (x) { /* 無視 */ } });
  strip.addEventListener('dragover', e => { const it = e.target.closest('.flowitem'); if (it && dragI >= 0) { e.preventDefault(); strip.querySelectorAll('.over').forEach(x => x.classList.remove('over')); it.classList.add('over'); } });
  strip.addEventListener('drop', e => { const it = e.target.closest('.flowitem'); if (!it || dragI < 0) return; e.preventDefault(); const j = +it.dataset.i; const [m] = W.forms.splice(dragI, 1); W.forms.splice(j, 0, m); dragI = -1; draw(); });
  strip.addEventListener('dragend', () => { dragI = -1; strip.querySelectorAll('.drag,.over').forEach(x => x.classList.remove('drag', 'over')); });
  $('wzfgrid').addEventListener('click', e => {
    const c = e.target.closest('.fcard'); if (!c) return;
    const id = c.dataset.f, k = W.forms.indexOf(id);
    if (k >= 0) W.forms.splice(k, 1);
    else if (W.forms.length >= 5) { uxToast('えらべるのは5個までです。ほかをはずしてください', 'info'); return; }
    else W.forms.push(id);
    draw();
  });
  draw();
}
// ④ テンポと長さ
function wzTempo(body) {
  const secs = c => Math.round(c * 60 / W.bpm * 10) / 10;
  body.innerHTML = `<div class="bpmbox"><div class="bpmnum"><span id="wzbpm">${W.bpm}</span><small>BPM（1分間の拍の数）</small></div>
    <div style="flex:1;min-width:220px"><input type="range" id="wzrange" min="60" max="200" step="1" value="${W.bpm}" aria-label="テンポ BPM"><div style="display:flex;justify-content:space-between;color:var(--mut);font-size:11px"><span>ゆっくり 60</span><span>ふつう 120</span><span>はやい 200</span></div></div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:center"><span class="pulse" id="wzpulse"></span><button type="button" id="wztap" class="bigbtn">${ic('mascot-baton', 22)} タップでテンポ</button><span style="font-size:11px;color:var(--mut)">曲に合わせて数回タップ</span></div></div>
    <div class="lbl-s" style="margin-top:16px">1回の移動にかけるカウント（隊形から隊形へ動く長さ）</div>
    <div class="cntpick" role="radiogroup" aria-label="移動のカウント">${[8, 16, 24, 32].map(c => `<button type="button" class="pick" role="radio" aria-checked="${W.moveCount === c}" data-c="${c}"><b>${c}</b><span class="d">カウント<br>約<span data-s="${c}">${secs(c)}</span>秒</span><span class="d">${{8: 'すばやく', 16: 'ふつう（おすすめ）', 24: 'ゆったり', 32: 'とてもゆっくり'}[c]}</span></button>`).join('')}</div>
    <p class="hint" id="wztotal" style="margin-top:12px;font-size:13px"></p>`;
  const upd = () => {
    $('wzbpm').textContent = W.bpm; $('wzrange').value = W.bpm;
    body.querySelectorAll('[data-s]').forEach(s => s.textContent = secs(+s.dataset.s));
    $('wzpulse').style.setProperty('--bt', (60 / W.bpm / 2) + 's');
    const total = 8 + (W.forms.length - 1) * W.moveCount + 8;
    $('wztotal').textContent = `全体で、約 ${Math.round(total * 60 / W.bpm)} 秒のショーになります（${W.forms.length}個の隊形・${total}カウント）。`;
  };
  $('wzrange').oninput = e => { W.bpm = +e.target.value; upd(); };
  body.querySelectorAll('.cntpick .pick').forEach(b => b.onclick = () => { W.moveCount = +b.dataset.c; body.querySelectorAll('.cntpick .pick').forEach(x => x.setAttribute('aria-checked', x === b)); upd(); });
  $('wztap').onclick = () => {
    const now = performance.now();
    if (W.taps.length && now - W.taps[W.taps.length - 1] > 2200) W.taps = [];
    W.taps.push(now); if (W.taps.length > 8) W.taps.shift();
    if (W.taps.length >= 3) { const iv = (W.taps[W.taps.length - 1] - W.taps[0]) / (W.taps.length - 1); W.bpm = Math.max(60, Math.min(200, Math.round(60000 / iv))); upd(); }
  };
  upd();
}
// ⑤ 見た目
function wzLook(body) {
  const g = wzGeom();
  body.innerHTML = `<div class="opts-grid g2" role="radiogroup" aria-label="見た目" style="max-width:640px">${[['real', 'リアル', '人物が写実的な3D。本番のイメージ確認に'], ['illust', 'イラスト', 'アニメ調のやわらかい見た目。見せるとき向き']].map(([id, n, d]) => `<button type="button" class="pick" role="radio" aria-checked="${W.look === id}" data-l="${id}"><span class="chk">✓</span>${illu('look-' + id, 88, 'width:100%')}<b>${n}</b><span class="d">${d}</span></button>`).join('')}</div>
  <div class="lbl-s" style="margin-top:14px">ショーの名前</div><input class="nameinp" id="wzname" value="${esc(W.name)}" maxlength="40" aria-label="ショーの名前">
  <div class="lbl-s" style="margin-top:14px">できあがり</div>
  <dl class="sumcard"><dt>会場</dt><dd>${X.VENUES.find(v => v.id === W.venue).name}</dd><dt>人数</dt><dd>${wzTotal()}人（${g.secs.map(s => s.label + s.n).join('・')}）</dd><dt>流れ</dt><dd><div class="minis">${W.forms.map((id, i) => `<div class="th">${wzThumb(id, g, i)}</div>`).join('')}</div></dd><dt>テンポ</dt><dd>BPM ${W.bpm}・1回の移動 ${W.moveCount} カウント</dd></dl>
  ${W.err ? `<div class="wzerr">${ic('mascot-oops', 28)} うまくできませんでした: ${esc(W.err)}<br>隊形や人数を変えて、もう一度ためしてください。</div>` : ''}`;
  body.querySelectorAll('.pick').forEach(b => b.onclick = () => { W.look = b.dataset.l; body.querySelectorAll('.pick').forEach(x => x.setAttribute('aria-checked', x === b)); });
  $('wzname').oninput = e => { W.name = e.target.value; };
}
// 作る
async function wzCreate() {
  const d = wzDlg, body = $('wzbody');
  const name = (W.name || '').trim() || 'はじめてのショー';
  $('wznext').disabled = true; $('wzback').disabled = true;
  body.innerHTML = `<div class="working">${ic('mascot-think', 120)}<b style="font-size:16px">ショーをつくっています…</b><span style="color:var(--mut)">隊形を並べて、ぶつからないように調整しています。<br>人数や隊形によっては、少し時間がかかります。</span></div>`;
  const m = X.buildModel({name, venue: W.venue, counts: W.counts, forms: W.forms, bpm: W.bpm, moveCount: W.moveCount, look: W.look});
  const log = await X.finalize(m, {print: printModel, compile: cj, fix: fj});
  if (!log.ok) { W.err = log.error; $('wznext').disabled = false; $('wzback').disabled = false; W.step = 4; wzRender(); return; }
  W.err = '';
  const text = printModel(m);
  d.close();
  await uxLoadSource(text, name + '.jk');
  showTab('pset');
  const n = wzTotal();
  uxToast(log.after ? `「${name}」を作りました（${n}人）。ぶつかりが ${log.after}件 残っています` : `「${name}」を作りました（${n}人・${m.sets.length}セット）。ぶつかりは0件です`, log.after ? 'info' : 'ok', 4500);
  if (!UX.tourDone) setTimeout(() => uxTour(false), 400);
}

// ======================================================================
// ガイドツアー
// ======================================================================
const TOUR = [
  {t: '#canvaswrap', mascot: 'mascot-wave', title: 'ここが会場です', text: '上から見た会場の図です。画面の下がお客さん側（客席）。客席から見て、右が上手（かみて）、左が下手（しもて）です。色のついた丸が、ひとりひとりの人です。', pos: 'inside', before: () => { $('sides').classList.add('on'); }},
  {t: () => { const g = $('Ldots'); const r = g && g.getBoundingClientRect(); return r && r.width > 4 ? g : $('canvaswrap'); }, mascot: 'mascot-point', title: '人を動かしてみよう', text: '丸をクリックで選び、ドラッグで動かせます。何もない所をドラッグすると、まとめて選べます。右クリック（タブレットは長押し）で、向きや並べ方のメニューが出ます。', pos: 'bottom'},
  {t: '#tools', mascot: 'mascot-baton', title: '形をかくツール', text: '直線・弧・円などを選んで画面をドラッグすると、選んだ人がその形に並びます。キーボードの L・A・C などでも切りかえられます。', pos: 'right'},
  {t: '#addstmt', mascot: 'mascot-point', title: '隊形を追加', text: '右のパネルの「＋隊形を追加」を押すと、形のイラストから選べます。V字・くさび・十字などの「おすすめ」は、1クリックで全員が並びます。', pos: 'left', before: () => { showTab('pset'); const a = $('addstmt'); if (a) a.scrollIntoView({block: 'center'}); }},
  {t: '#addset', mascot: 'mascot-think', title: '次のセットを作る', text: 'セットは、隊形の「写真」1枚です。「＋ セット」を押して次の隊形を足すと、人が動いて次の形になります。', pos: 'top'},
  {t: '#tltrack', mascot: 'mascot-point', title: 'カウントを調整', text: '下の帯がセットの並びです。右はしをドラッグすると、動く時間（カウント）を変えられます。ななめの線の部分は「ホールド」（止まって見せる時間）です。', pos: 'top'},
  {t: '#tlplay', mascot: 'mascot-cheer', title: '再生してみよう', text: '▶ を押すと、ショー全体が再生されます。スペースキーでも始まります。動きがおかしいところは、ここで見つけられます。', pos: 'top'},
  {t: ['#scpalbtn', '#scbtn'], mascot: 'mascot-point', title: 'キーボードで、もっとらくに', text: '「?」キーでショートカット一覧、Ctrl+K（Macは ⌘K）でコマンド検索が開きます。人を選んで Delete で抜く、N で増やす、なども使えます。好きなキーに変えることもできます。', pos: 'bottom'},
  {t: '#preview', mascot: 'mascot-baton', title: '3Dで見る', text: '「プレビュー」を押すと、3Dの映像が新しいタブで開きます。リアル風とイラスト風の見た目も切りかえられます。', pos: 'bottom'},
  {t: ['#video', '#save'], mascot: 'mascot-cheer', title: '保存と書き出し', text: '「保存」で .jk ファイルに残せます（Ctrl+S）。「3D動画を書き出す」で動画にもできます。わからなくなったら、いつでも右上の「ヘルプ」へ！', pos: 'bottom'}
];
const isPhone = () => document.documentElement.classList.contains('mp');
// スマホ用のツアー（画面のつくりが違うので、文面と場所を差し替える）
const TOUR_MP = [
  {t: '#canvaswrap', mascot: 'mascot-wave', title: 'ここが会場です', text: '上から見た会場の図です。画面の下がお客さん側（客席）。色のついた丸が、ひとりひとりの人です。', pos: 'inside', before: () => { if (window.jkSheet) jkSheet.set('peek'); }},
  {t: () => { const g = $('Ldots'); const r = g && g.getBoundingClientRect(); return r && r.width > 4 ? g : $('canvaswrap'); }, mascot: 'mascot-point', title: '人を動かしてみよう', text: '丸をタップで選び、ドラッグで動かせます。何もない所を指でなぞると画面が動き、2本指でつまむと拡大します。長押しでメニューが開きます。', pos: 'bottom'},
  {t: '#mblasso', mascot: 'mascot-think', title: 'まとめて選ぶ', text: 'この「範囲選択」を押してから、囲みたい範囲を指でなぞると、まとめて選べます。選ぶと下に操作バー（向き・並べ方・削除…）が出ます。', pos: 'top'},
  {t: '#tools', mascot: 'mascot-baton', title: '形をかくツール', text: '直線・弧・円などを選んで画面をなぞると、選んだ人がその形に並びます。', pos: 'bottom'},
  {t: '#right', mascot: 'mascot-point', title: '下のパネル', text: '「隊形」「セクション」などのタブを押すと、パネルが広がります。つまみを上下に引くと、大きさを変えられます。', pos: 'top', before: () => { if (window.jkSheet) jkSheet.set('peek', true); }},
  {t: '#addset', mascot: 'mascot-think', title: '次のセットを作る', text: 'セットは、隊形の「写真」1枚です。「＋ セット」を押して次の隊形を足すと、人が動いて次の形になります。', pos: 'top', before: () => { if (window.jkSheet) jkSheet.set('peek', true); const a = $('addset'); if (a && a.scrollIntoView) a.scrollIntoView({inline: 'center', block: 'nearest'}); }},
  {t: '#tltrack', mascot: 'mascot-point', title: 'カウントを調整', text: '下の帯がセットの並びです。右はしのつまみをドラッグすると、動く時間（カウント）を変えられます。ブロックを長押しすると、分割・コピー・削除のメニューが出ます。', pos: 'top'},
  {t: '#tlplay', mascot: 'mascot-cheer', title: '再生してみよう', text: '▶ を押すと、ショー全体が再生されます。動きがおかしいところは、ここで見つけられます。', pos: 'top', before: () => { const t = $('tlbar'); if (t) t.scrollLeft = 0; }},
  {t: '#mbmore', mascot: 'mascot-baton', title: '右上の ⋮ メニュー', text: '保存・開く・コマンド検索・3Dプレビュー・動画の書き出しは、ここにまとまっています。わからなくなったら「ヘルプ」へ！', pos: 'bottom'}
];
const TOUR_PC = TOUR.slice();
let tour = null;
function tourRect(t) {
  const list = (Array.isArray(t) ? t : [t]).map(x => typeof x === 'function' ? x() : x).map(x => typeof x === 'string' ? document.querySelector(x) : x).filter(Boolean);
  const rs = list.map(e => e.getBoundingClientRect()).filter(r => r.width || r.height);
  if (!rs.length) return null;
  const l = Math.min(...rs.map(r => r.left)), tp = Math.min(...rs.map(r => r.top)), r = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom));
  return {left: l, top: tp, right: r, bottom: b, width: r - l, height: b - tp};
}
function uxTour(fromHelp) {
  closeAllUx();
  if (!M || !R) return;
  if (tour) tourEnd(false);
  TOUR.splice(0, TOUR.length, ...(isPhone() ? TOUR_MP : TOUR_PC));
  let ov = $('tourov');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'tourov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'ガイドツアー');
    ov.innerHTML = '<div id="tourshield"></div><div id="tourhole"></div><div id="tourbub"></div>';
    document.body.appendChild(ov);
  }
  tour = {i: 0, prevFocus: document.activeElement};
  ov.classList.add('on');
  document.addEventListener('keydown', tourKey, true);
  window.addEventListener('resize', tourPlace);
  tourShow(0);
}
function tourKey(e) {
  if (!tour) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tourEnd(false); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tourGo(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); tourGo(-1); }
  else if (e.key === 'Tab') { // バブル内で完結させる
    const f = [...$('tourbub').querySelectorAll('button')]; if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    e.preventDefault(); e.stopPropagation();
    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  } else if (!(e.ctrlKey || e.metaKey) && !e.altKey && !/^F\d+$/.test(e.key)) e.stopPropagation();
}
function tourGo(d) {
  const n = tour.i + d;
  if (n < 0) return;
  if (n >= TOUR.length) { tourEnd(true); return; }
  tourShow(n);
}
function tourShow(i) {
  tour.i = i;
  const s = TOUR[i];
  if (s.before) s.before();
  const el = [].concat(s.t).map(x => typeof x === 'function' ? x() : x).map(x => typeof x === 'string' ? document.querySelector(x) : x).find(Boolean);
  if (el && el.scrollIntoView) el.scrollIntoView({block: 'nearest', inline: 'nearest'});
  $('tourbub').innerHTML = `<div class="row1">${ic(s.mascot, 56)}<div><h3>${s.title}</h3><p>${s.text}</p></div></div>
    <div class="ctl"><button type="button" class="ghost" data-t="skip">スキップ</button><span class="sp"></span><span class="dots">${TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</span><span class="sp"></span><button type="button" data-t="prev" ${i === 0 ? 'disabled' : ''}>← 前へ</button><button type="button" class="pri" data-t="next">${i === TOUR.length - 1 ? 'はじめる' : '次へ →'}</button></div><span class="arrow" id="tourarrow"></span>`;
  $('tourbub').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; const t = b.dataset.t; if (t === 'skip') tourEnd(false); else tourGo(t === 'next' ? 1 : -1); };
  tourPlace();
  setTimeout(() => { const nb = $('tourbub').querySelector('[data-t="next"]'); if (nb) nb.focus({preventScroll: true}); }, 40);
}
function tourPlace() {
  if (!tour) return;
  const s = TOUR[tour.i], r = tourRect(s.t), hole = $('tourhole'), b = $('tourbub');
  const vw = innerWidth, vh = innerHeight, m = 10, pad = 6;
  if (!r) { hole.style.cssText = 'left:50%;top:50%;width:0;height:0'; b.style.left = Math.max(m, (vw - b.offsetWidth) / 2) + 'px'; b.style.top = Math.max(m, (vh - b.offsetHeight) / 2) + 'px'; $('tourarrow').style.display = 'none'; return; }
  const hl = Math.max(0, r.left - pad), ht = Math.max(0, r.top - pad), hw = Math.min(vw, r.right + pad) - hl, hh = Math.min(vh, r.bottom + pad) - ht;
  hole.style.left = hl + 'px'; hole.style.top = ht + 'px'; hole.style.width = hw + 'px'; hole.style.height = hh + 'px';
  const bw = b.offsetWidth, bh = b.offsetHeight, gap = 16;
  const c = {
    bottom: {x: r.left + r.width / 2 - bw / 2, y: r.bottom + pad + gap},
    top: {x: r.left + r.width / 2 - bw / 2, y: r.top - pad - gap - bh},
    right: {x: r.right + pad + gap, y: r.top + r.height / 2 - bh / 2},
    left: {x: r.left - pad - gap - bw, y: r.top + r.height / 2 - bh / 2}
  };
  const order = [s.pos, 'bottom', 'top', 'right', 'left'].filter(k => c[k]);
  const clampX = v => Math.max(m, Math.min(vw - bw - m, v)), clampY = v => Math.max(m, Math.min(vh - bh - m, v));
  const fit = k => {
    if (k === 'top' || k === 'bottom') return c[k].y >= m - 1 && c[k].y + bh <= vh - m + 1;
    return c[k].x >= m - 1 && c[k].x + bw <= vw - m + 1;
  };
  let side = order.find(fit), x, y;
  if (side) { x = clampX(c[side].x); y = clampY(c[side].y); }
  else { side = 'inside'; x = clampX(r.left + r.width / 2 - bw / 2); y = clampY(Math.min(r.bottom, vh) - bh - 24); }
  b.style.left = x + 'px'; b.style.top = y + 'px';
  const ar = $('tourarrow'); ar.style.display = side === 'inside' ? 'none' : 'block';
  if (side === 'bottom') { ar.style.left = Math.max(16, Math.min(bw - 30, r.left + r.width / 2 - x - 7)) + 'px'; ar.style.top = '-8px'; ar.style.transform = 'rotate(45deg)'; }
  else if (side === 'top') { ar.style.left = Math.max(16, Math.min(bw - 30, r.left + r.width / 2 - x - 7)) + 'px'; ar.style.top = (bh - 7) + 'px'; ar.style.transform = 'rotate(225deg)'; }
  else if (side === 'right') { ar.style.top = Math.max(16, Math.min(bh - 30, r.top + r.height / 2 - y - 7)) + 'px'; ar.style.left = '-8px'; ar.style.transform = 'rotate(-45deg)'; }
  else if (side === 'left') { ar.style.top = Math.max(16, Math.min(bh - 30, r.top + r.height / 2 - y - 7)) + 'px'; ar.style.left = (bw - 7) + 'px'; ar.style.transform = 'rotate(135deg)'; }
}
function tourEnd(done) {
  if (!tour) return;
  document.removeEventListener('keydown', tourKey, true);
  window.removeEventListener('resize', tourPlace);
  $('tourov').classList.remove('on');
  const pf = tour.prevFocus; tour = null; uxSides();
  UX.tourDone = true; uxSave();
  if (pf && pf.focus) try { pf.focus(); } catch (e) { /* 消えていた */ }
  uxToast(done ? 'ツアーはおわりです。「ヘルプ」からいつでも見直せます' : 'ツアーをとじました。「ヘルプ」からもう一度見られます', 'info', 3200);
}

// ======================================================================
// ヘルプ
// ======================================================================
let helpDlg = null;
function uxHelp(topic) {
  closeAllUx();
  const d = helpDlg = mkDialog('uxhelp', 'help');
  const PHONE_GUIDE = {id: 'phone', icon: 'help-select', title: 'スマホでの操作', lead: 'スマホでは、指でふれて操作します。パソコンとのちがいをまとめました。',
    steps: ['丸をタップで選び、ドラッグで動かします。何もない所をタップすると選択をやめます。', '何もない所を1本指でなぞると画面が動きます。2本指でつまむと拡大・縮小、ダブルタップで全体表示にもどります。', 'まとめて選ぶときは、フィールドの左下の「範囲選択」を押してから、囲みたい範囲をなぞります。', '丸や隊形を長押しすると、メニュー（向き・並べ方・削除など）が開きます。', '下のタブ（隊形・セクション・ショー…）を押すとパネルが広がります。つまみを上へ引くと全画面、下へ引くとたたまれます。', '下の帯のセットは横にスクロールできます。右はしのつまみで長さを変え、長押しで分割・コピー・削除ができます。', '保存・開く・コマンド検索・3Dプレビュー・動画の書き出しは、右上の ⋮ メニューにあります。'],
    tips: ['「ホーム画面に追加」すると、アプリのように起動でき、電波がなくても開けます（⋮ メニュー →「ホーム画面に追加」）。', '編集内容はこの端末の下書きとして自動で残ります。大事なショーは ⋮ → 保存 で .jk ファイルにも残してください。']};
  const items = (isPhone() ? [PHONE_GUIDE] : []).concat(X.GUIDES);
  d.innerHTML = `<div class="ux-head">${illu('mascot-face', 40, 'width:52px;height:52px')}<div><h2>ヘルプ</h2><p>やりたいことをえらんでください</p></div>${closeBtn}</div>
  <div class="help-wrap"><nav class="help-nav" aria-label="ヘルプの目次">${items.map(g => `<button type="button" data-g="${g.id}">${illu(g.icon, 28, 'width:40px;height:40px;border-radius:12px')}<span>${g.title}</span></button>`).join('')}<div class="sep">そのほか</div><button type="button" data-g="glossary">${illu('help-hold', 28, 'width:40px;height:40px;border-radius:12px')}<span>用語集</span></button><button type="button" data-g="tour">${illu('mascot-point', 28, 'width:40px;height:40px;border-radius:12px')}<span>ガイドツアー</span></button></nav>
  <div class="help-main" id="helpmain" tabindex="-1"></div></div>`;
  const show = id => {
    d.querySelectorAll('.help-nav button').forEach(b => b.classList.toggle('on', b.dataset.g === id));
    const m = $('helpmain');
    if (id === 'glossary') m.innerHTML = `<div class="help-hero">${illu('help-hold', 72, 'width:96px;height:96px')}<div><h3>用語集</h3><p>マーチングの言葉を、やさしく説明します。</p></div></div><dl class="glos">${X.GLOSSARY.map(([t, e]) => `<dt>${t}</dt><dd>${e}</dd>`).join('')}</dl>`;
    else if (id === 'tour') m.innerHTML = `<div class="help-hero">${illu('mascot-point', 72, 'width:120px;height:120px')}<div><h3>ガイドツアー</h3><p>画面の主な場所を、順番にご案内します（約1分）。</p><p><button type="button" class="pri bigbtn" id="helptour">ツアーを始める</button></p></div></div>`;
    else {
      const g = items.find(x => x.id === id) || items[0];
      m.innerHTML = `<div class="help-hero">${illu(g.icon, 88, 'width:120px;height:120px')}<div><h3>${g.title}</h3><p>${g.lead}</p></div></div><ol>${g.steps.map(s => `<li>${s}</li>`).join('')}</ol>${g.tips.map(t => `<div class="help-tip">ヒント: ${t}</div>`).join('')}${g.id === 'first' ? '<p><button type="button" class="bigbtn" data-act2="wiz">かんたん作成を始める</button></p>' : ''}`;
    }
    m.scrollTop = 0;
    const ht = $('helptour'); if (ht) ht.onclick = () => { d.close(); setTimeout(() => uxTour(true), 100); };
    const w = m.querySelector('[data-act2="wiz"]'); if (w) w.onclick = () => { d.close(); uxWizard(); };
  };
  d.addEventListener('click', e => { if (e.target.closest('[data-close]')) { d.close(); return; } const b = e.target.closest('.help-nav [data-g]'); if (b) show(b.dataset.g); });
  openDlg(d);
  show(topic && (items.some(g => g.id === topic) || topic === 'glossary') ? topic : items[0].id);
  const on = d.querySelector('.help-nav .on'); if (on) on.focus();
}
document.addEventListener('click', e => { const q = e.target.closest && e.target.closest('[data-help]'); if (q) { e.preventDefault(); uxHelp(q.dataset.help); } });

// ======================================================================
// ポップオーバー（隊形パレット・楽器）
// ======================================================================
let uxPop = null, uxPopAnchor = null;
function closeUxPop(restore) {
  if (uxPop) { uxPop.remove(); uxPop = null; document.removeEventListener('pointerdown', popOutside, true); window.removeEventListener('resize', closeUxPop); }
  if (restore && uxPopAnchor && uxPopAnchor.focus) try { uxPopAnchor.focus(); } catch (e) { /* 消えていた */ }
}
function popOutside(e) { if (uxPop && !uxPop.contains(e.target) && !(uxPopAnchor && uxPopAnchor.contains(e.target))) closeUxPop(); }
function uxPopover(anchor, html, w) {
  closeUxPop();
  const p = uxPop = document.createElement('div');
  uxPopAnchor = anchor;
  p.className = 'uxpop'; p.setAttribute('role', 'dialog'); p.innerHTML = html; p.style.width = Math.min(w || 380, innerWidth - 16) + 'px';
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect(), ph = p.offsetHeight, pw = p.offsetWidth;
  let y = r.bottom + 6; if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  let x = Math.min(innerWidth - pw - 8, Math.max(8, r.left)); p.style.left = x + 'px'; p.style.top = y + 'px';
  document.addEventListener('pointerdown', popOutside, true);
  window.addEventListener('resize', closeUxPop);
  p.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeUxPop(true); return; }
    if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    const bs = [...p.querySelectorAll('button:not([disabled])')], cur = document.activeElement, i = bs.indexOf(cur);
    if (i < 0) return;
    e.preventDefault();
    const cr = cur.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best = null, bd = 1e9;
    bs.forEach(b => {
      if (b === cur) return;
      const q = b.getBoundingClientRect(), qx = q.left + q.width / 2, qy = q.top + q.height / 2, dx = qx - cx, dy = qy - cy;
      const ok = e.key === 'ArrowRight' ? dx > 4 && Math.abs(dy) < cr.height * 0.6 : e.key === 'ArrowLeft' ? dx < -4 && Math.abs(dy) < cr.height * 0.6 : e.key === 'ArrowDown' ? dy > 4 : dy < -4;
      if (!ok) return;
      const d = e.key.endsWith('Left') || e.key.endsWith('Right') ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 3;
      if (d < bd) { bd = d; best = b; }
    });
    if (best) best.focus();
  });
  const f = p.querySelector('button'); if (f) f.focus({preventScroll: true});
  return p;
}
window.uxClosePop = closeUxPop;

// ---- 隊形を追加 ----
const SHAPE_KINDS = [['line', '直線', 'shape-line'], ['arc', '弧', 'shape-arc'], ['circle', '円', 'shape-circle'], ['block', 'ブロック', 'shape-block'], ['curve', '曲線', 'shape-curve'], ['poly', '折れ線', 'shape-poly'], ['follow', 'フォロー', 'shape-follow']];
function uxOpenPalette(anchor) {
  if (!M || !R) return;
  anchor = anchor || $('addstmt') || $('pset');
  const D = R.data, secs = X.secsOfModel(M, D), V = X.venueGeom(D.field), fd = X.fieldDesc(D.field);
  const html = `<h4>かたちをえらぶ（選んだ人が、この形に並びます）</h4><div class="pgrid">${SHAPE_KINDS.map(([k, n, icn]) => `<button type="button" class="pbtn" data-kind="${k}" ${k === 'follow' && curSet === 0 ? 'disabled title="最初のセットでは使えません"' : ''}>${ic(icn, 40)}<span>${n}</span></button>`).join('')}${curSet > 0 ? `<button type="button" class="pbtn" data-kind="same">${ic('shape-scatter', 40)}<span>そのまま</span><small>前の位置</small></button>` : ''}</div>
  <h4>おすすめの隊形（全員をまとめて自動で並べます）</h4><div class="pgrid">${X.FORMS.map(f => `<button type="button" class="pbtn" data-form="${f.id}" title="${esc(f.desc)}"><div class="th">${X.miniSvg(D.field, X.thumbDots(f.id, V, secs, curSet), {label: f.name})}</div><span>${f.name}</span></button>`).join('')}</div>`;
  const p = uxPopover(anchor, html, 420);
  p.addEventListener('click', e => {
    const k = e.target.closest('[data-kind]'), f = e.target.closest('[data-form]');
    if (k && !k.disabled) { closeUxPop(); uxAddShape(k.dataset.kind); }
    else if (f) { closeUxPop(); uxApplyTemplate(f.dataset.form); }
  });
}
function uxAddShape(kind) {
  const set = M.sets[curSet];
  const used = new Set(set.stmts.flatMap(st => groupTokens(st.group)));
  const free = M.sections.find(s => !used.has(s.id)) || M.sections[0];
  const st = newStmt(free ? free.id : 'all', defaultShape(kind, null));
  set.stmts.push(st); normalizeAttrs(); curStmt = set.stmts.indexOf(st); edited(true);
  uxToast(`「${kindName(kind)}」を足しました。色のラベルで、並べる人を選べます`, 'info', 3200);
}
async function uxApplyTemplate(form) {
  const set = M.sets[curSet];
  if (set.stmts.some(s => s.shape.kind !== 'attr') && !(await ask(`セット ${set.name} の今の隊形を、「${X.FORM_BY[form].name}」に置きかえますか？（元に戻すは ↶）`, '置きかえる'))) return;
  const D = R.data, secs = X.secsOfModel(M, D), V = X.venueGeom(D.field);
  const stmts = X.formationStmts(form, V, secs, curSet);
  const keep = set.stmts.filter(s => s.shape.kind === 'attr');
  set.stmts = stmts.concat(keep);
  curStmt = -1; sel.clear();
  edited(true);
  uxToast(`全員を「${X.FORM_BY[form].name}」に並べました`, 'ok');
}

// ---- 楽器ピッカー ----
function instName(id) { return (typeof INSTR_NAME !== 'undefined' && INSTR_NAME[id]) || (X.INST_BY[id] && X.INST_BY[id].name) || id; }
function instOf(i) { const s = M && M.sections[i]; return (s && s.instrument) || (R && R.data.sections[i] && R.data.sections[i].instrument) || 'none'; }
function enhanceSecPane() {
  const pane = $('psec');
  pane.querySelectorAll('select[data-key="instrument"]').forEach(sl => {
    const i = +sl.dataset.path.slice(3);
    sl.classList.add('hidsel'); sl.tabIndex = -1; sl.setAttribute('aria-hidden', 'true');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'instbtn'; b.dataset.i = i; b.title = 'クリックで楽器をえらぶ';
    sl.parentNode.insertBefore(b, sl);
    b.onclick = () => openInstPicker(b, i, sl);
  });
  pane.querySelectorAll('input[data-key="n"]').forEach(inp => {
    if (inp.parentNode.querySelector('.nstep')) return;
    const w = document.createElement('span'); w.className = 'nstep';
    const mk = (t, d, lab) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-label', lab); b.onclick = () => { const v = Math.max(1, Math.round(numOf(inp.value) || 1) + d); inp.value = v; inp.dispatchEvent(new Event('input', {bubbles: true})); }; return b; };
    inp.parentNode.insertBefore(w, inp); w.append(mk('−', -1, '人数を減らす'), inp, mk('＋', 1, '人数を増やす'));
    inp.style.width = '40px'; inp.style.textAlign = 'center';
  });
  refreshInstBtns();
}
function refreshInstBtns() {
  document.querySelectorAll('#psec .instbtn').forEach(b => {
    const i = +b.dataset.i, id = instOf(i), auto = !(M.sections[i] && M.sections[i].instrument);
    b.innerHTML = `${ic('inst-' + id, 30)}<span class="nm">${esc(instName(id))}${auto ? '<small style="color:var(--mut)">（自動）</small>' : ''}</span><span class="cv">▾</span>`;
  });
}
function openInstPicker(btn, i, sl) {
  const cur = M.sections[i].instrument || '', auto = instOf(i);
  const grp = INSTR_GROUPS.map(([g, ids]) => `<h4>${g}</h4><div class="pgrid w4">${ids.split(' ').map(id => `<button type="button" class="pbtn ${cur === id ? 'on' : ''}" data-id="${id}" title="${esc(INSTR_NAME[id])}">${ic('inst-' + id, 36)}<span>${esc(INSTR_NAME[id].replace(/（.*$/, ''))}</span></button>`).join('')}</div>`).join('');
  const p = uxPopover(btn, `<button type="button" class="pbtn ${cur === '' ? 'on' : ''}" data-id="" style="flex-direction:row;width:100%;justify-content:center;margin-bottom:6px">${ic('inst-' + auto, 28)}<span>自動（表示名から: ${esc(instName(auto))}）</span></button>${grp}`, 440);
  p.addEventListener('click', e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    sl.value = b.dataset.id; sl.dispatchEvent(new Event('change', {bubbles: true}));
    closeUxPop(true);
    setTimeout(refreshInstBtns, 120);
  });
}

// ---- ショーペイン: 会場・見た目カード ----
function enhanceShowPane() {
  const pane = $('pshow'), sType = pane.querySelector('select[data-key="type"]'), sLook = pane.querySelector('select[data-key="look"]');
  if (!sType) return;
  const cur = M.field.type, look = M.look === 'illust' ? 'illust' : 'real';
  const html = `<div class="lbl-s">会場をえらぶ</div><div class="cardgrid" role="radiogroup" aria-label="会場">${X.VENUES.map(v => `<button type="button" class="pick ${cur === v.id ? 'on' : ''}" role="radio" aria-checked="${cur === v.id}" data-venue="${v.id}" title="${esc(v.desc)}">${ic('venue-' + v.id, 56)}<b>${v.name}</b></button>`).join('')}</div>
   <div class="lbl-s">見た目</div><div class="cardgrid" role="radiogroup" aria-label="見た目">${[['real', 'リアル'], ['illust', 'イラスト']].map(([id, n]) => `<button type="button" class="pick ${look === id ? 'on' : ''}" role="radio" aria-checked="${look === id}" data-look="${id}">${ic('look-' + id, 56)}<b>${n}</b></button>`).join('')}</div>`;
  const wrap = document.createElement('div'); wrap.innerHTML = html;
  pane.insertBefore(wrap, pane.querySelector('.row'));
  wrap.querySelectorAll('[data-venue]').forEach(b => b.onclick = () => { if (b.dataset.venue === sType.value) return; sType.value = b.dataset.venue; sType.dispatchEvent(new Event('change', {bubbles: true})); });
  wrap.querySelectorAll('[data-look]').forEach(b => b.onclick = () => { if (!sLook) return; sLook.value = b.dataset.look === 'illust' ? 'illust' : ''; sLook.dispatchEvent(new Event('change', {bubbles: true})); });
  const rows = pane.querySelectorAll('.row'); // 衝突の距離・歩幅の上限は上級者向け
  rows.forEach(r => { if (r.querySelector('[data-key="clearance"]')) r.setAttribute('data-adv', ''); });
  // 会場の選択は上のカードで行うので、ふつうの選択欄は詳細モードでだけ見せる
  const venueRow = sType.closest('.row'); if (venueRow) { const lab = sType.closest('label'); if (lab) lab.classList.add('advonly'); }
}

// ======================================================================
// 次にやること
// ======================================================================
function uxHint() {
  if (!M) return null;
  if (lastErr) return {cls: 'warn', icon: 'mascot-oops', msg: 'うまく読み込めませんでした。', sub: '直前の正しい状態を表示しています。', btns: [['ひとつ前に戻す', () => undo(), 'pri']]};
  if (!R) return null;
  const D = R.data, nColl = D.warnings.filter(w => w.kind === '衝突').length, nOth = D.warnings.length - nColl;
  const empty = M.sets.every(s => !s.stmts.some(st => st.shape.kind !== 'attr'));
  if (empty) return {cls: '', icon: 'mascot-point', msg: 'まず、隊形を作りましょう。', sub: '形のイラストから選ぶと、人が自動で並びます。', btns: [['＋ 隊形を追加', () => { showTab('pset'); setTimeout(() => uxOpenPalette($('addstmt')), 30); }, 'pri']]};
  if (nColl) return {cls: 'warn', icon: 'mascot-oops', msg: `${nColl}か所で、人がぶつかりそうです。`, sub: '自動で直すと、動き出しのタイミングなどを調整します。', btns: [['自動で直す', () => autoFix(), 'pri'], ['くわしく見る', () => showTab('pwarn')]]};
  if (M.sets.length === 1) return {cls: '', icon: 'mascot-baton', msg: '次のセットを作りましょう。', sub: 'セットを足すと、人が動いて次の隊形になります。', btns: [['次のセットを作る', () => $('addset').click(), 'pri']]};
  if (!M.sets[curSet].stmts.some(st => st.shape.kind !== 'attr') && curSet > 0) return {cls: '', icon: 'mascot-think', msg: `セット ${setLbl(curSet)} は、まだ全員その場です。`, sub: '隊形を足して、動きをつけましょう。', btns: [['＋ 隊形を追加', () => { showTab('pset'); setTimeout(() => uxOpenPalette($('addstmt')), 30); }, 'pri']]};
  if (nOth) return {cls: 'warn', icon: 'mascot-think', msg: `確認したい点が ${nOth}件あります。`, sub: '歩幅が大きすぎる、会場の外に出ているなどです。', btns: [['チェックを見る', () => showTab('pwarn'), 'pri']]};
  return {cls: 'ok', icon: 'mascot-cheer', msg: 'いい感じです！ できあがりを確かめましょう。', sub: '3Dで見たり、動画にしたり、保存したりできます。', btns: [['3Dで見る', () => $('preview').click(), 'pri'], ['動画を書き出す', () => $('video').click()], ['保存', () => save()]]};
}
let lastHintKey = '';
function uxNext() {
  const bar = $('nextbar'); if (!bar) return;
  if (UX.mode !== 'easy') { lastHintKey = ''; return; }
  const h = uxHint();
  if (!h) { bar.innerHTML = ''; lastHintKey = ''; return; }
  const key = h.cls + h.msg + h.btns.map(b => b[0]).join('|');
  if (key === lastHintKey) return;
  lastHintKey = key;
  bar.className = h.cls;
  bar.innerHTML = `<span class="nb-ic">${ic(h.icon, 36)}</span><div class="nb-t"><b>次にやること</b><span class="nb-m">${esc(h.msg)} <span style="color:var(--mut)">${esc(h.sub || '')}</span></span></div><div class="nb-b"></div>`;
  const nb = bar.querySelector('.nb-b');
  if (window.scNextHint) { try { window.scNextHint(bar); } catch (e) { /* 案内は添え物 */ } }
  h.btns.forEach(([label, fn, cls]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.onclick = fn; nb.appendChild(b); });
}

// ======================================================================
// やさしい警告
// ======================================================================
window.uxRenderWarns = function () {
  const D = R.data, pane = $('pwarn');
  const nc = D.warnings.filter(w => w.kind === '衝突').length, n = D.warnings.length;
  const MAXS = 24;
  let h = `<div class="ph"><span class="t">人どうしのぶつかり・歩幅・会場の外を、自動でチェックしています。</span>${uxQh('collision')}</div>`;
  if (nc) h += `<div class="row"><button id="autofix" class="pri bigbtn" title="時間差（wait）・早着き（in）・カーブ（bend）を総当たりで試して、衝突が最も減る直し方を入れます（Ctrl+Z で戻せます）">${ic('help-collision', 22)} ぶつかりを自動で直す</button></div>`;
  if (fixNotes.length) h += `<div class="card" style="border-color:var(--ok)"><div class="note" style="color:var(--ok);font-weight:600">自動で直しました</div>${fixNotes.map(t => `<div class="note">・${esc(t)}</div>`).join('')}</div>`;
  if (!n) h += `<div class="allok">${ic('mascot-cheer', 56)}<div><b>すべてOKです！</b><br>ぶつかり・大股・場外はありません。</div></div>`;
  // 同じセットの「会場の外」「大股」は、1枚のカードにまとめる
  const items = [], gm = new Map();
  D.warnings.forEach(w => {
    if (w.kind === '場外' || w.kind === '大股') {
      const key = w.kind + ':' + w.set; let g = gm.get(key);
      if (!g) { g = {w, who: [], list: []}; gm.set(key, g); items.push(g); }
      g.who.push(...(w.who || [])); g.list.push(w);
    } else items.push({w, who: w.who || [], list: [w]});
  });
  items.slice(0, MAXS).forEach((g, j) => {
    const w = g.w;
    const f = X.friendly(D, w, M.sets[w.set] ? setLbl(w.set) : null, g.who);
    const btn = {fix: '<button data-wa="fix" class="pri">自動で直す</button>', select: `<button data-wa="select">${g.who.length > 1 ? 'その人たちを選ぶ' : 'その人を選ぶ'}</button>`, goto: '<button data-wa="goto">そのセットへ移動</button>', more: '<button data-wa="more">カウントを＋8する</button>', score: '<button data-wa="score">楽譜を開く</button>'};
    h += `<div class="fw t-${f.kind}" data-j="${j}">${ic(f.icon, 40)}<div class="b"><b>${f.title}</b><p>${esc(f.body)}</p>${f.tip ? `<div class="tip">${esc(f.tip)}</div>` : ''}${UX.mode === 'pro' ? `<div class="raw">${esc(w.msg)}</div>` : ''}<div class="acts">${f.acts.map(a => btn[a]).join('')}</div></div></div>`;
  });
  if (items.length > MAXS) h += `<div class="note" style="text-align:center">ほかに ${items.length - MAXS} 件あります。自動で直したあと、もう一度確認してください。</div>`;
  pane.innerHTML = h;
  const af = $('autofix'); if (af) af.onclick = autoFix;
  pane.querySelectorAll('.fw').forEach(card => {
    const g = items[+card.dataset.j], w = g.w;
    card.querySelectorAll('[data-wa]').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const a = b.dataset.wa;
      if (a === 'fix') { autoFix(); return; }
      if (a === 'score') { showTab('pscore'); return; }
      stopPlay(); playT = null; curSet = w.set; curStmt = -1;
      if (a === 'select') sel = new Set(g.who);
      if (a === 'more' && M.sets[w.set] && w.set > 0) { M.sets[w.set].counts = String((numOf(M.sets[w.set].counts) || 16) + 8); edited(true); uxToast(`セット ${setLbl(w.set)} のカウントを増やしました`, 'ok'); return; }
      refresh(true); if (a === 'select') { updateSel(); drawCanvas(); }
      $('info').textContent = w.msg;
    });
  });
  document.querySelector('.tabs [data-p="pwarn"]').textContent = n ? `チェック ⚠${n}` : 'チェック ✓';
};

// ======================================================================
// ペイン見出し・空の状態・フック
// ======================================================================
const PANE_HELP = {
  pset: ['このセットでの、みんなの並び方です。形を足して、人を並べましょう。', 'first'],
  psec: ['セクション（楽器ごとのグループ）の人数・色・楽器を決めます。', 'first'],
  pshow: ['会場・テンポ・見た目など、ショー全体の設定です。', 'side'],
  pscore: ['打楽器などが演奏する楽譜を書けます（なくてもOK）。', 'score']
};
function addPaneHead(id) {
  const pane = $(id), t = PANE_HELP[id]; if (!pane || !t || pane.querySelector(':scope > .ph')) return;
  const d = document.createElement('div'); d.className = 'ph'; d.innerHTML = `<span class="t">${t[0]}</span>${uxQh(t[1])}`;
  pane.insertBefore(d, pane.firstChild);
}
function wrap(name, after) {
  const orig = window[name];
  if (typeof orig !== 'function') return;
  const f = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.error('ux', name, e); } return r; };
  try { window[name] = f; } catch (e) { /* 書き換え不可 */ } // 関数宣言は window の特性なので、代入で差し替わる
}
let firstRun = true;
function uxAfterRefresh() {
  uxSides();
  uxNext();
  if (firstRun && R && M) { firstRun = false; uxFirst(); }
}
function uxFirst() { if (!UX.welcomed) setTimeout(uxWelcome, 250); }
function uxSides() { const sd = $('sides'); if (sd && R) sd.classList.toggle('on', R.data.field.type !== 'football' && (UX.mode === 'easy' || !!tour)); }

// ======================================================================
// タッチ操作（ピンチ・2本指パン・長押し）とズーム
// ======================================================================
let baseVB = null, view = {k: 1};
function applyView(cx, cy, k) {
  if (!baseVB) return;
  const [bx, by, bw, bh] = baseVB;
  k = Math.max(0.5, Math.min(8, k));
  const w = bw / k, h = bh / k;
  cx = Math.max(bx, Math.min(bx + bw, cx)); cy = Math.max(by, Math.min(by + bh, cy));
  if (k <= 1) { cx = bx + bw / 2; cy = by + bh / 2; }
  view = {k, cx, cy};
  svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
  try { window.dispatchEvent(new CustomEvent('jk-view', {detail: {k}})); } catch (e) { /* 無視 */ }
}
function curVB() { const v = svg.getAttribute('viewBox').split(/\s+/).map(Number); return v; }
function toSvg(x, y) { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function zoomAt(sx, sy, factor) {
  if (!baseVB) return;
  const q0 = toSvg(sx, sy), [vx, vy, vw, vh] = curVB();
  const k = Math.max(0.5, Math.min(8, view.k * factor));
  applyView(vx + vw / 2, vy + vh / 2, k);
  const q1 = toSvg(sx, sy);
  const [x2, y2, w2, h2] = curVB();
  applyView(x2 + w2 / 2 + (q0.x - q1.x), y2 + h2 / 2 + (q0.y - q1.y), view.k);
}
function panBy(dx, dy) { // 画面上のピクセル
  const m = svg.getScreenCTM(); if (!m) return;
  const [vx, vy, vw, vh] = curVB();
  applyView(vx + vw / 2 - dx / m.a, vy + vh / 2 - dy / m.d, view.k);
}
function initTouch() {
  const wrapEl = $('canvaswrap'), rect = () => svg.getBoundingClientRect();
  const center = () => { const r = rect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  $('zin').onclick = () => { const [x, y] = center(); zoomAt(x, y, 1.4); };
  $('zout').onclick = () => { const [x, y] = center(); zoomAt(x, y, 1 / 1.4); };
  $('zfit').onclick = () => applyView(0, 0, 1);
  svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, {passive: false});
  const ptrs = new Map();
  let gest = null, lp = null, startSrc = '';
  const abortDrags = () => { dragging = pdrag = gdrag = tdrag = null; band = null; if (draw) cancelDraw(); };
  const lpClear = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
  // window の捕捉段階で受ける: 描画ツールなど、svg 側が先に pointerdown を止める処理より前に2本目の指を拾うため
  window.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (!(e.target instanceof Node && svg.contains(e.target)) && !(ptrs.size && wrapEl.contains(e.target))) return;
    ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (ptrs.size === 1) {
      startSrc = currentSource();
      lpClear();
      const sx = e.clientX, sy = e.clientY, tgt = e.target;
      lp = {x: sx, y: sy, t: setTimeout(() => {
        lp = null;
        if (ptrs.size !== 1 || gest) return;
        abortDrags();
        if (currentSource() !== startSrc) { undo(); }
        // 押した瞬間に点が描き直されて、最初に触れた要素は画面から外れていることがある。その場合は今その位置にあるものへ送る
        const t2 = tgt.isConnected ? tgt : (document.elementsFromPoint(sx, sy).find(n => svg.contains(n)) || svg);
        t2.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 2, view: window}));
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (x) { /* 無視 */ }
      }, 520)};
    } else if (ptrs.size === 2) {
      lpClear();
      e.stopImmediatePropagation(); e.preventDefault();
      abortDrags();
      if (currentSource() !== startSrc) { try { undo(); } catch (x) { /* 無視 */ } } else drawCanvas();
      const [a, b] = [...ptrs.values()];
      gest = {d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2};
    } else if (gest) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  window.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const o = ptrs.get(e.pointerId); o.x = e.clientX; o.y = e.clientY;
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 9) lpClear();
    if (gest && ptrs.size >= 2) {
      e.preventDefault();
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      panBy(cx - gest.cx, cy - gest.cy);
      zoomAt(cx, cy, d / gest.d);
      gest = {d, cx, cy};
    }
  }, {passive: false});
  const up = e => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); lpClear(); if (ptrs.size < 2) gest = null; };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  // ---- 予備の経路（実機のブラウザによっては pointer イベントが途中で cancel されるため）----
  // touch イベント: pointer 側が2本指の操作を始めていないときだけ、こちらで拡大縮小・移動する。ページ全体のピンチ拡大・スクロールは止める
  let tg = null;
  const tpair = e => { const a = e.touches[0], b = e.touches[1]; return {d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2}; };
  wrapEl.addEventListener('touchstart', e => {
    if (e.touches.length >= 2) { e.preventDefault(); if (!gest) { lpClear(); abortDrags(); tg = tpair(e); } }
  }, {passive: false});
  wrapEl.addEventListener('touchmove', e => {
    if (e.touches.length >= 2) {
      e.preventDefault();
      if (tg && !gest) { const n = tpair(e); panBy(n.cx - tg.cx, n.cy - tg.cy); zoomAt(n.cx, n.cy, n.d / tg.d); tg = n; }
    }
  }, {passive: false});
  const tend = e => { if (e.touches.length < 2) tg = null; };
  wrapEl.addEventListener('touchend', tend); wrapEl.addEventListener('touchcancel', tend);
  // Safari のジェスチャーイベント: 上の2つが働かなかったときの最後の手段（scale の変化分だけ拡大する）
  let gs = null;
  document.addEventListener('gesturestart', e => { if (wrapEl.contains(e.target)) { e.preventDefault(); gs = e.scale || 1; } }, {passive: false});
  document.addEventListener('gesturechange', e => {
    if (!wrapEl.contains(e.target)) return;
    e.preventDefault();
    if (gs !== null && !gest && !tg && e.scale) { zoomAt(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2, e.scale / gs); }
    gs = e.scale || gs;
  }, {passive: false});
  document.addEventListener('gestureend', () => { gs = null; });
  window.JKUX_pinching = () => !!(gest || tg);
}

// ======================================================================
// 起動
// ======================================================================
function init() {
  uxLoad();
  // これまでにエディタを使っていた人（下書きが残っている）は、詳細モードのまま・ようこそ画面なしにする
  if (!hadStore && window.JK_PROJECT && window.JK_PROJECT.initial) { UX.mode = 'pro'; UX.welcomed = true; UX.tourDone = true; }
  document.querySelectorAll('#modesw button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('helpbtn').onclick = () => uxHelp();
  $('homebtn').onclick = () => uxWelcome();
  if (window.JK_LOCAL) { const nf = $('newfile'); nf.title = '新しく作る（白紙・かんたん作成・テンプレート・パレードから選ぶ）'; $('homebtn').style.display = 'none'; }
  setMode(UX.mode);

  // 描画のあとに付け足す処理
  wrap('refresh', uxAfterRefresh);
  wrap('renderSetPane', () => {
    addPaneHead('pset');
    const e = $('emptyadd'); if (e) e.onclick = () => uxOpenPalette($('addstmt') || e);
    const a = $('addstmt'); if (a) a.onclick = () => uxOpenPalette(a);
    if (UX.mode === 'easy' && !sel.size && M.sets[curSet] && M.sets[curSet].stmts.length) {
      const t = document.createElement('div'); t.className = 'empty-state'; t.style.padding = '10px';
      t.innerHTML = `${ic('empty-no-selection', 72)}<p style="margin:0">人（丸）をクリックで選ぶと、向きや姿勢・並べ方を変えられます。</p>`;
      $('pset').appendChild(t);
    }
  });
  wrap('renderSecPane', () => { addPaneHead('psec'); enhanceSecPane(); });
  wrap('renderShowPane', () => { enhanceShowPane(); addPaneHead('pshow'); });
  wrap('renderScorePane', () => addPaneHead('pscore'));
  wrap('updateInstrAuto', refreshInstBtns);
  // 選択バーと再生バーに ? ボタン
  const sb = $('selbar'); if (sb && !sb.querySelector('.qh')) sb.insertAdjacentHTML('beforeend', uxQh('move'));
  const tb = $('tlbar'); if (tb && !tb.querySelector('.qh')) tb.insertAdjacentHTML('beforeend', uxQh('sets'));
  // 横幅のせまい画面でも、ヘルプへ行けるように
  initTouch();
  // 会場がつくり直されたときだけ、ズームの基準を取り直す
  let lastFLD = null;
  wrap('ensureField', () => { if (FLD !== lastFLD) { lastFLD = FLD; baseVB = svg.getAttribute('viewBox').split(/\s+/).map(Number); view = {k: 1}; } });
}
// スマホ用の部品（src/mobile.js）から使う入口
window.JKUX = {setMode, wrap, applyView, panBy, zoomAt, getView: () => view, welcome: uxWelcome, wizard: uxWizard, help: uxHelp, closeAll: closeAllUx, toast: uxToast, mode: () => UX.mode};
init();
})();
