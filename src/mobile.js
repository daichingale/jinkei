// ===== スマホ対応（html.mp のときだけ働く）=====
// 見た目は src/mobile.css。ここは、スマホ用の部品（アプリバー・⋮メニュー・ボトムシート・範囲選択・タイムラインの長押しなど）を足す。
// PC・タブレット（html.mp なし）では、何も表示せず何もしない。
(function () {
  'use strict';
  const html = document.documentElement, body = document.body;
  const UXA = window.JKUX || {};
  const wrap = (name, after) => {   // グローバル関数のあとに処理を足す（ux.js の wrap と同じ）
    const orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.error('mobile', name, e); } return r; };
  };
  const mp = () => html.classList.contains('mp');
  const land = () => html.classList.contains('mp-land');
  const hap = ms => { try { if (mp() && navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* 使えない端末 */ } };
  window.jkHaptic = hap;
  const el = (tag, cls, h) => { const e = document.createElement(tag); if (cls) e.className = cls; if (h != null) e.innerHTML = h; return e; };
  const ICON = {
    more: '<circle cx="12" cy="5.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/>',
    easy: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    pro: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    open: '<path d="M3.5 7.5A1.5 1.5 0 015 6h4l2 2.2h8A1.5 1.5 0 0120.5 9.7V17a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 17z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    history: '<path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7L4 9"/><path d="M4 4v5h5M12 8v4.5l3 2"/>',
    sync: '<path d="M4 12a8 8 0 0113.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 015 .9c0 1.7-2.5 2-2.5 3.6M12 17.2h.01"/>',
    home: '<path d="M4 11l8-7 8 7v8.5a1 1 0 01-1 1h-4.5v-6h-5v6H5a1 1 0 01-1-1z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"/>',
    dl: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19.5h14"/>',
    lasso: '<rect x="4" y="5" width="16" height="14" rx="2" stroke-dasharray="3 2.6"/><circle cx="9" cy="10" r="1.3"/><circle cx="14.5" cy="9" r="1.3"/><circle cx="12" cy="14.5" r="1.3"/>',
    prev: '<path d="M5 12a7 7 0 107-7"/><path d="M5 5v4h4"/>',
    names: '<path d="M5 18l5.5-12h1L17 18M7.2 13.5h7.6"/>',
    cam: '<rect x="3" y="7" width="18" height="12" rx="2.5"/><circle cx="12" cy="13" r="3.2"/><path d="M8.5 7l1.2-2h4.6l1.2 2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    panel: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M14.5 5v14"/>'
  };
  const svgI = (n, extra) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra || ''}>${ICON[n] || ''}</svg>`;

  // ---------- 入力のズーム対策などの共通処理 ----------
  document.addEventListener('gesturestart', e => { if (mp()) e.preventDefault(); }, {passive: false});   // iOS: ページ全体のピンチ拡大を止める（フィールドは自前のピンチ）

  // ---------- ボトムシート（縦: peek / half / full、横: side / hide） ----------
  const right = $('right'), center = $('center'), mainEl = document.querySelector('main');
  const grab = el('div'); grab.id = 'mbgrab'; grab.setAttribute('role', 'button'); grab.setAttribute('aria-label', '下のパネルを広げる・たたむ');
  const setbar = el('div'); setbar.id = 'mbsetbar';
  setbar.innerHTML = '<button type="button" id="mbprev" aria-label="前のセット">‹</button><div class="mbst" id="mbst"></div><button type="button" id="mbnext" aria-label="次のセット">›</button><button type="button" class="ghost mbhide" id="mbhide">閉じる</button>';
  right.insertBefore(setbar, right.firstChild); right.insertBefore(grab, right.firstChild);
  let state = 'peek', curH = 0;
  const probe = el('div'); probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
  body.appendChild(probe);
  const M0 = () => {
    const H = mainEl.clientHeight, sab = probe.offsetHeight || 0;
    return {peek: 76 + sab, half: Math.round(Math.max(260, H * 0.52)), full: H, side: Math.round(Math.min(380, Math.max(300, innerWidth * 0.44)))};
  };
  function applyHeights(h, anim) {
    const m = M0();
    right.classList.toggle('anim', !!anim);
    html.style.setProperty('--mb-h', h + 'px');
    html.style.setProperty('--mb-inset', Math.min(h, state === 'full' ? m.half : Math.max(m.peek, Math.min(h, m.half))) + 'px');
    curH = h;
  }
  function setSheet(s, anim) {
    if (!mp()) return;
    const m = M0();
    if (land()) {
      if (s !== 'hide') s = 'side';
      state = s; html.dataset.sheet = s;
      html.style.setProperty('--mb-side', m.side + 'px');
      html.style.removeProperty('--mb-h'); html.style.removeProperty('--mb-inset');
      return;
    }
    if (s !== 'peek' && s !== 'half' && s !== 'full') s = 'peek';
    state = s; html.dataset.sheet = s;
    html.style.removeProperty('--mb-side');
    applyHeights(m[s], anim);
    if (s !== 'peek') setTimeout(() => { try { right.querySelector('.pane.on').scrollTop = 0; } catch (e) { /* なし */ } }, 0);
  }
  window.jkSheet = {set: setSheet, get state() { return state; }};
  function syncMode() {
    if (!mp()) {
      ['--mb-h', '--mb-inset', '--mb-side'].forEach(k => html.style.removeProperty(k));
      delete html.dataset.sheet; window.JK_DOT_SCALE = 1; window.JK_TL_MIN = 0; return;
    }
    window.JK_DOT_SCALE = 1.35; window.JK_TL_MIN = 13;
    const prev = state;
    if (land()) setSheet(prev === 'hide' ? 'hide' : 'side'); else setSheet(prev === 'side' || prev === 'hide' ? 'peek' : prev);
    if (typeof M !== 'undefined' && M) { try { renderTimeline(); if (R) drawCanvas(); } catch (e) { /* 描画前 */ } }
  }
  // 縦の高さの変更・回転に追従
  let rz = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (mp() && !sheetDrag) setSheet(state); }); });
  new MutationObserver(() => syncMode()).observe(html, {attributes: true, attributeFilter: ['class']});
  const order = ['peek', 'half', 'full'];
  let sheetDrag = null;
  function bindDrag(node, thr) {
    node.addEventListener('pointerdown', e => {
      if (!mp() || land() || e.button > 0) return;
      sheetDrag = {id: e.pointerId, x0: e.clientX, y0: e.clientY, h0: curH, t: performance.now(), y: e.clientY, v: 0, on: false, node};
    });
    node.addEventListener('pointermove', e => {
      const d = sheetDrag; if (!d || d.id !== e.pointerId) return;
      const dy = e.clientY - d.y0, dx = e.clientX - d.x0;
      if (!d.on) {
        if (Math.abs(dy) < thr || Math.abs(dy) < Math.abs(dx)) return;
        d.on = true; d.node.setPointerCapture(e.pointerId); right.classList.remove('anim');
      }
      const m = M0(), h = Math.max(m.peek, Math.min(m.full, d.h0 - dy));
      const now = performance.now(); d.v = (d.y - e.clientY) / Math.max(1, now - d.t) * 0.6 + d.v * 0.4; d.y = e.clientY; d.t = now;
      applyHeights(h, false);
    });
    const end = e => {
      const d = sheetDrag; if (!d || d.id !== e.pointerId) return;
      sheetDrag = null;
      if (!d.on) { if (d.node === grab) setSheet(state === 'peek' ? 'half' : 'peek', true); return; }
      const m = M0(), stops = [m.peek, m.half, m.full];
      let to = stops.reduce((b, v, i) => Math.abs(v - curH) < Math.abs(stops[b] - curH) ? i : b, 0);
      if (Math.abs(d.v) > 0.45) { const from = stops.reduce((b, v, i) => Math.abs(v - d.h0) < Math.abs(stops[b] - d.h0) ? i : b, 0); to = Math.max(0, Math.min(2, from + (d.v > 0 ? 1 : -1))); }
      setSheet(order[to], true); hap(6);
    };
    node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end);
    node.addEventListener('lostpointercapture', e => { if (sheetDrag && sheetDrag.id === e.pointerId && sheetDrag.on) end(e); });
  }
  bindDrag(grab, 3); bindDrag(setbar.querySelector('#mbst'), 8); bindDrag(right.querySelector('.tabs'), 10);
  // タブ: 押すとシートが開く。開いている状態で同じタブをもう一度押すとたたむ
  right.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    if (!mp()) return;
    hap(5);
    if (land()) return;
    if (state === 'peek') setSheet('half', true);
    else if (b.dataset.sameTab === '1') setSheet('peek', true);
  }, true));
  right.querySelectorAll('.tabs button').forEach(b => b.addEventListener('pointerdown', () => { b.dataset.sameTab = b.classList.contains('on') && state === 'half' ? '1' : ''; }, true));
  $('mbhide').onclick = () => { if (land()) { setSheet('hide'); } else setSheet('peek', true); };
  $('mbprev').onclick = () => { if (typeof curSet !== 'undefined' && curSet > 0) { selectSet(curSet - 1); hap(6); } };
  $('mbnext').onclick = () => { if (M && curSet < M.sets.length - 1) { selectSet(curSet + 1); hap(6); } };
  // コード欄は広く使いたいので、触ったら全画面に
  $('code').addEventListener('focus', () => { if (mp() && !land()) setSheet('full', true); });
  const origShowTab = window.showTab;
  if (typeof origShowTab === 'function') window.showTab = function (id) { const r = origShowTab.apply(this, arguments); if (mp() && !land() && id === 'pcode' && state === 'peek') setSheet('half', true); return r; };

  // 横向き: ヘッダーのボタンでパネルを出し入れ
  const header = document.querySelector('header');
  const panelBtn = el('button', '', svgI('panel') + '<small>パネル</small>'); panelBtn.id = 'mbpanelbtn'; panelBtn.type = 'button'; panelBtn.setAttribute('aria-label', '右のパネルを出す・隠す');
  panelBtn.onclick = () => setSheet(state === 'hide' ? 'side' : 'hide');

  // ---------- アプリバー: かんたん／詳細のトグル、⋮ ----------
  const modeBtn = el('button'); modeBtn.id = 'mbmode'; modeBtn.type = 'button';
  const moreBtn = el('button', '', svgI('more')); moreBtn.id = 'mbmore'; moreBtn.type = 'button'; moreBtn.setAttribute('aria-label', 'メニュー'); moreBtn.setAttribute('aria-haspopup', 'true');
  const paintMode = () => {
    const easy = body.classList.contains('easy');
    modeBtn.className = easy ? 'easy' : 'pro';
    modeBtn.innerHTML = svgI(easy ? 'easy' : 'pro') + `<small>${easy ? 'かんたん' : '詳細'}</small>`;
    modeBtn.setAttribute('aria-label', easy ? 'いまは かんたんモード。押すと詳細モードにします' : 'いまは 詳細モード。押すと かんたんモードにします');
    modeBtn.title = easy ? '詳細モードにする' : 'かんたんモードにする';
  };
  modeBtn.onclick = () => { if (UXA.setMode) UXA.setMode(body.classList.contains('easy') ? 'pro' : 'easy'); paintMode(); hap(8); if (window.uxToast) uxToast(body.classList.contains('easy') ? 'かんたんモード: むずかしい項目をかくします' : '詳細モード: すべての機能を表示します', 'info'); };
  new MutationObserver(paintMode).observe(body, {attributes: true, attributeFilter: ['class']});
  const spEl = header.querySelector('.sp');
  header.insertBefore(modeBtn, header.querySelector('#undo')); paintMode();
  header.appendChild(panelBtn); header.appendChild(moreBtn);
  void spEl;
  const paintDirty = () => { const s = $('status'); moreBtn.classList.toggle('dirty', s.classList.contains('dirty') || s.classList.contains('err') || (window.JK_PROJECT && typeof dirty !== 'undefined' && dirty)); moreBtn.classList.toggle('err', s.classList.contains('err')); };
  new MutationObserver(paintDirty).observe($('status'), {attributes: true, childList: true, characterData: true, subtree: true});

  // ---------- ⋮ メニュー ----------
  const scrim = el('div'); scrim.id = 'mbscrim'; body.appendChild(scrim);
  const menu = el('div'); menu.id = 'mbmenu'; menu.setAttribute('role', 'menu'); body.appendChild(menu);
  let menuOn = false, deferredPrompt = null;
  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
  const canShareFiles = () => { try { return !!(navigator.canShare && navigator.share && navigator.canShare({files: [new File(['x'], 'x.jk', {type: 'text/plain'})]})); } catch (e) { return false; } };
  const canVideo = () => !!(window.MediaRecorder);
  function closeMenu() { menuOn = false; menu.classList.remove('on'); scrim.classList.remove('on'); scrim.dataset.for = ''; moreBtn.setAttribute('aria-expanded', 'false'); }
  function item(icon, label, sub, fn, cls, dis) {
    const b = el('button', 'mi ' + (cls || ''), svgI(icon) + `<span class="tx">${label}${sub ? `<small>${sub}</small>` : ''}</span>`); b.type = 'button'; b.setAttribute('role', 'menuitem');
    if (dis) b.disabled = true;
    b.onclick = () => { closeMenu(); setTimeout(fn, 30); };
    return b;
  }
  const clickId = id => () => { const b = $(id); if (b) b.click(); };
  function buildMenu() {
    menu.innerHTML = '';
    menu.appendChild(el('div', 'gr'));
    const st = el('div', 'st');
    const fname = $('fname').textContent || '無題';
    const stt = $('status').textContent, cls = $('status').className;
    st.innerHTML = `<b>${String(fname).replace(/</g, '&lt;')}</b>` + (stt ? `<span class="${cls}">${stt.replace(/</g, '&lt;')}</span>` : '') + (typeof M !== 'undefined' && M && R ? `<span>${R.data.performers.length}人・${R.data.sets.length}セット</span>` : '');
    menu.appendChild(st);
    const local = !!window.JK_LOCAL;
    menu.appendChild(el('h3', '', 'ファイル'));
    menu.appendChild(item('save', '保存', local ? '.jk ファイルとして端末に保存' : '', clickId('save'), 'pri'));
    if (local && canShareFiles()) menu.appendChild(item('share', '共有・ファイルアプリへ保存…', '共有シートから「ファイルに保存」やメッセージ送信ができます', () => { if (window.JK_LOCAL.share) window.JK_LOCAL.share(currentSource()).then(r => { if (r && r.shared && window.uxToast) uxToast('共有しました', 'ok'); }); }));
    if (local) menu.appendChild(item('open', '開く', '.jk ファイルを選ぶ', clickId('open')));
    if (local) menu.appendChild(item('plus', '新規', 'ひな形・かんたん作成から新しく作る', clickId('newfile')));
    if (local) menu.appendChild(item('history', '下書き履歴', 'この端末に自動で残した下書き', clickId('drafthistory')));
    if (local) menu.appendChild(item('sync', '端末間同期', '別の端末と同じショーを開く', clickId('projectsync')));
    menu.appendChild(el('div', 'sep'));
    menu.appendChild(el('h3', '', 'つくる・見る'));
    menu.appendChild(item('search', '検索（コマンド）', '機能を名前で探して実行', clickId('scpalbtn')));
    menu.appendChild(item('cube', 'プレビュー（3D）', '新しいタブで2D/3Dを再生', clickId('preview')));
    const vb = item('video', '3D動画を書き出す', canVideo() ? 'プレビュー画面で録画して保存します' : 'このブラウザは録画に対応していません', () => {
      if (!canVideo()) { if (window.uxToast) uxToast('この端末のブラウザは動画の録画に対応していません。Android の Chrome か、パソコンで書き出してください', 'err'); return; }
      $('video').click();
    });
    menu.appendChild(vb);
    const camRow = el('div', 'row', svgI('cam') + '<span>動画のカメラ</span>');
    const sel = el('select'); sel.setAttribute('aria-label', '動画のカメラ'); sel.innerHTML = $('vcam').innerHTML; sel.value = $('vcam').value;
    sel.onchange = () => { $('vcam').value = sel.value; };
    camRow.appendChild(sel); menu.appendChild(camRow);
    menu.appendChild(el('div', 'sep'));
    menu.appendChild(el('h3', '', '表示と操作'));
    const tg = (icon, text, sub, id) => {
      const t = $(id), b = el('button', 'mi tgl', svgI(icon) + `<span class="tx">${text}<small>${sub}</small></span><span class="sw${t.checked ? ' on' : ''}" aria-hidden="true"></span>`);
      b.type = 'button'; b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(t.checked));
      b.onclick = () => { t.checked = !t.checked; t.dispatchEvent(new Event('change', {bubbles: true})); b.setAttribute('aria-checked', String(t.checked)); b.querySelector('.sw').classList.toggle('on', t.checked); hap(5); };
      menu.appendChild(b);
    };
    tg('prev', '前のセットを薄く表示', 'ひとつ前の位置と動きの線を重ねます', 'showprev');
    tg('names', '名前を表示', '点の上に人の名前を出します', 'shownames');
    const sn = el('div', 'row', svgI('lasso') + '<span>吸着（ドラッグのマス目）</span>');
    const ss = el('select'); ss.setAttribute('aria-label', '吸着'); ss.innerHTML = $('snap').innerHTML; ss.value = $('snap').value;
    ss.onchange = () => { $('snap').value = ss.value; $('snap').dispatchEvent(new Event('change', {bubbles: true})); };
    sn.appendChild(ss); menu.appendChild(sn);
    menu.appendChild(el('div', 'sep'));
    menu.appendChild(el('h3', '', 'そのほか'));
    menu.appendChild(item('home', 'はじめに', 'かんたん作成・サンプル', clickId('homebtn')));
    menu.appendChild(item('help', 'ヘルプ', '使い方ガイドと用語集', clickId('helpbtn')));
    if (!isStandalone() && /^https?:/.test(location.protocol)) menu.appendChild(item('plus', 'ホーム画面に追加', 'アプリのように起動・オフラインでも使えます', installHint));
    const close = item('close', '閉じる', '', () => {}); close.classList.add('cl'); menu.appendChild(close);
  }
  function openMenu() { buildMenu(); menuOn = true; menu.classList.add('on'); scrim.classList.add('on'); scrim.dataset.for = 'menu'; moreBtn.setAttribute('aria-expanded', 'true'); hap(6); menu.scrollTop = 0; }
  moreBtn.onclick = () => { if (menuOn) closeMenu(); else openMenu(); };
  scrim.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (scrim.dataset.for === 'menu') closeMenu();
    else { try { hidePops(); } catch (x) { /* なし */ } ['qspop', 'qsedit', 'pastepop'].forEach(id => { const n = $(id); if (n) n.remove(); }); scrim.classList.remove('on'); }
  });
  window.jkMenu = {open: openMenu, close: closeMenu, get isOpen() { return menuOn; }};
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOn) { closeMenu(); e.stopPropagation(); } }, true);

  // ---------- ホーム画面に追加の案内 ----------
  const card = el('div'); card.id = 'mbinstall'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'ホーム画面に追加');
  body.appendChild(card);
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* なし */ } return null; };
  function installHint() {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.finally(() => { deferredPrompt = null; card.classList.remove('on'); }); return; }
    const t = isIOS() ? 'Safari の下の「共有」ボタン（□に↑）→「ホーム画面に追加」を選ぶと、アプリのように起動でき、電波がなくても開けます。' : 'ブラウザのメニュー（⋮）→「ホーム画面に追加」または「アプリをインストール」を選びます。';
    if (typeof notice === 'function') notice('ホーム画面に追加\n\n' + t);
  }
  function maybeShowInstall() {
    if (!mp() || land() || isStandalone() || !/^https?:/.test(location.protocol) || ls('jk_a2hs') || card.classList.contains('on')) return;
    if (document.querySelector('dialog[open]') || menuOn) { setTimeout(maybeShowInstall, 8000); return; }
    const logo = document.querySelector('link[rel=apple-touch-icon]');
    card.innerHTML = (logo ? `<img src="${logo.href}" alt="">` : '') +
      `<div class="tx"><b>ホーム画面に追加</b>${isIOS() && !deferredPrompt ? '「共有」ボタン →「ホーム画面に追加」で、アプリのように使えます（オフラインでもOK）。' : 'アプリのように起動でき、電波がなくても開けます。'}</div>` +
      (deferredPrompt ? '<button type="button" class="go">追加</button>' : '') + '<button type="button" class="no" aria-label="閉じる">✕</button>';
    card.classList.add('on');
    const no = card.querySelector('.no'); no.onclick = () => { card.classList.remove('on'); ls('jk_a2hs', String(Date.now())); };
    const go = card.querySelector('.go'); if (go) go.onclick = () => { installHint(); ls('jk_a2hs', String(Date.now())); };
  }
  setTimeout(maybeShowInstall, 30000);
  window.jkInstallHint = installHint;

  // ---------- フィールド: ツール列・範囲選択・表示切替 ----------
  const cw = $('canvaswrap');
  const bar = el('div'); bar.id = 'mbbar';
  cw.insertBefore(bar, cw.firstChild);
  bar.appendChild($('tools'));
  let lasso = false, lassoStarted = false;
  const lassoBtn = el('button', '', svgI('lasso') + '<span>範囲選択中</span>'); lassoBtn.type = 'button'; lassoBtn.id = 'mblasso'; lassoBtn.setAttribute('aria-pressed', 'false'); lassoBtn.setAttribute('aria-label', '範囲選択（指でなぞって囲んだ人をまとめて選ぶ）');
  lassoBtn.title = '範囲選択: 指でなぞって囲んだ人をまとめて選ぶ（1回使うと自動で切れます）';
  function setLasso(on) {
    lasso = !!on; lassoBtn.classList.toggle('on', lasso); lassoBtn.setAttribute('aria-pressed', String(lasso));
    if (lasso) info('範囲選択: 囲みたい範囲を指でなぞってください'); hap(8);
  }
  lassoBtn.onclick = () => setLasso(!lasso);
  cw.appendChild(lassoBtn);
  const infoPill = el('div'); infoPill.id = 'mbinfo'; infoPill.setAttribute('role', 'status'); cw.appendChild(infoPill);
  let infoT = 0;
  function info(text) {
    if (!mp() || !text) return;
    text = String(text).replace(/（[^）]*(Ctrl|Shift|Alt|Delete|Esc)[^）]*）/g, '').trim();
    if (!text) return;
    infoPill.textContent = text; infoPill.classList.add('on'); clearTimeout(infoT); infoT = setTimeout(() => infoPill.classList.remove('on'), 2600);
  }
  new MutationObserver(() => info($('info').textContent)).observe($('info'), {childList: true, characterData: true, subtree: true});

  // ---------- フィールド: 指の操作 ----------
  // ・タップで選択／空きをタップで解除 ・ドラッグで人を動かす ・空きを1本指ドラッグ: ふだんは移動（パン）、「範囲選択」オン中は囲んで選ぶ
  // ・2本指: 拡大縮小・移動（ux.js）・長押し: メニュー（ux.js）・ダブルタップ: 全体表示／拡大
  // 点が小さいので、指がすこしズレても近くの点（ハンドル）を拾う
  const touches = new Set();
  window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') touches.add(e.pointerId); }, true);
  const rel = e => { if (e.pointerType === 'touch') touches.delete(e.pointerId); };
  window.addEventListener('pointerup', rel, true); window.addEventListener('pointercancel', rel, true);
  const svgEl = $('svg');
  let pan = null, lastTap = null;
  function nearest(x, y, nodes, max) {
    let best = null, bd = max;
    for (const n of nodes) {
      if (!n || !n.getBoundingClientRect) continue;
      const r = n.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  svgEl.addEventListener('pointerdown', e => {
    if (!mp() || e.pointerType !== 'touch' || !e.isPrimary || touches.size > 1) return;
    if (typeof tool === 'undefined' || tool !== 'select' || !R) return;
    pan = null;
    const t = e.target;
    if (t.closest && t.closest('[data-i],[data-si],[data-g]')) { hap(6); return; }   // 点・ハンドルを直接つかんだ
    const cands = [...dotEls.filter(Boolean), ...svgEl.querySelectorAll('#Lhandles [data-si]')];
    const hit = nearest(e.clientX, e.clientY, cands, 24);
    if (hit) {
      e.stopImmediatePropagation(); e.preventDefault();
      hit.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1}));
      hap(6); return;
    }
    if (lasso) { lassoStarted = true; return; }   // 範囲選択（既存の処理がそのまま働く）
    // 空きを1本指でドラッグ = パン、ちょん = 解除、ちょんちょん = ズーム
    e.stopImmediatePropagation(); e.preventDefault();
    pan = {id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false};
  }, true);
  window.addEventListener('pointermove', e => {
    if (!pan || e.pointerId !== pan.id) return;
    if (touches.size > 1 || (window.JKUX_pinching && window.JKUX_pinching())) { pan = null; return; }
    if (!pan.moved && Math.hypot(e.clientX - pan.x0, e.clientY - pan.y0) < 8) return;
    pan.moved = true;
    if (UXA.panBy) UXA.panBy(e.clientX - pan.x, e.clientY - pan.y);
    pan.x = e.clientX; pan.y = e.clientY;
  }, {passive: true});
  window.addEventListener('pointerup', e => {
    if (!pan || e.pointerId !== pan.id) return;
    const p = pan; pan = null;
    if (p.moved) return;
    const now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 30) {
      lastTap = null;
      if (UXA.getView && UXA.getView().k > 1.05) UXA.applyView(0, 0, 1); else if (UXA.zoomAt) UXA.zoomAt(e.clientX, e.clientY, 2.4);
      hap(10); return;
    }
    lastTap = {t: now, x: e.clientX, y: e.clientY};
    if (sel.size || curStmt >= 0) { sel.clear(); curStmt = -1; updateSel(); markCards(); drawCanvas(); }
  });
  window.addEventListener('pointercancel', e => { if (pan && e.pointerId === pan.id) pan = null; });
  svgEl.addEventListener('pointerup', () => {
    if (lassoStarted) { lassoStarted = false; if (lasso) setTimeout(() => { if (sel.size) { setLasso(false); info(`${sel.size}人を選びました`); } }, 0); }
  });
  // 長押しメニューは、タッチ端末によっては OS も contextmenu を出す。短い間隔の2回目は捨てる
  let lastCtx = 0;
  document.addEventListener('contextmenu', e => {
    if (!mp()) return;
    const now = performance.now();
    if (now - lastCtx < 900) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    lastCtx = now;
  }, true);
  // 長押しで出たメニューは、まだ押している指の下に開くことがある。指を離した瞬間に項目が押されてしまわないよう、開いた直後のタップは捨てる
  let popAt = 0;
  ['ctx', 'pop'].forEach(id => { const n = $(id); let was = false; if (n) new MutationObserver(() => { const on = n.style.display === 'block'; if (on && !was) popAt = performance.now(); was = on; }).observe(n, {attributes: true, attributeFilter: ['style']}); });
  document.addEventListener('click', e => { if (mp() && performance.now() - popAt < 450 && e.target.closest && e.target.closest('#ctx,#pop')) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  // ポップアップが出ているあいだは背景を暗くする（すき間タップで閉じる）
  const popIds = ['ctx', 'pop', 'qspop', 'qsedit', 'pastepop'];
  function popVisible() { return popIds.some(id => { const n = $(id); return n && n.style.display !== 'none' && (id === 'ctx' || id === 'pop' ? n.style.display === 'block' : true) && n.isConnected; }); }
  function syncScrim() { if (!mp() || menuOn) return; scrim.dataset.for = 'pop'; scrim.classList.toggle('on', popVisible()); }
  new MutationObserver(syncScrim).observe(body, {childList: true, subtree: false});
  ['ctx', 'pop'].forEach(id => { const n = $(id); if (n) new MutationObserver(syncScrim).observe(n, {attributes: true, attributeFilter: ['style']}); });
  new MutationObserver(() => { if (popIds.every(id => !$(id) || $(id).style.display === 'none')) scrim.classList.remove('on'); }).observe(body, {childList: true});

  // ---------- タイムライン: 横スクロール・現在位置へ・長押しでセットのメニュー ----------
  const tltrack = $('tltrack');
  function revealCur(smooth) {
    if (!mp()) return;
    const b = tltrack.querySelector('.tlb.cur'); if (!b) return;
    const l = b.offsetLeft, r = l + b.offsetWidth, vw = tltrack.clientWidth, sl = tltrack.scrollLeft;
    if (l < sl + 8 || r > sl + vw - 8) tltrack.scrollTo({left: Math.max(0, l - Math.max(8, (vw - b.offsetWidth) / 2)), behavior: smooth ? 'smooth' : 'auto'});
  }
  function followPlayhead() {
    if (!mp()) return;
    const ph = $('playhead'); if (!ph) return;
    const x = parseFloat(ph.style.left) || 0, vw = tltrack.clientWidth, sl = tltrack.scrollLeft;
    if (x < sl + 16 || x > sl + vw - 40) tltrack.scrollLeft = Math.max(0, x - vw * 0.3);
  }
  if (typeof renderTimeline === 'function') {
    const o = window.renderTimeline;
    window.renderTimeline = function () { const sl = tltrack.scrollLeft; const r = o.apply(this, arguments); if (mp()) { tltrack.scrollLeft = sl; revealCur(false); } return r; };
  }
  if (typeof updatePlayhead === 'function') {
    const o = window.updatePlayhead;
    window.updatePlayhead = function () {
      const r = o.apply(this, arguments);
      if (mp()) {
        const tt = $('tltime'), m = /^(セット [^｜]*)｜(.*)$/.exec(tt.textContent);
        if (m) tt.innerHTML = `<b>${m[1].replace(/</g, '&lt;')}</b><span>${m[2].replace(/</g, '&lt;')}</span>`;
        if (typeof playing !== 'undefined' && playing) followPlayhead();
      }
      return r;
    };
  }
  const paintSetbar = () => {
    if (typeof M === 'undefined' || !M || !M.sets[curSet]) return;
    const s = M.sets[curSet];
    $('mbst').innerHTML = `<b>セット ${String(s.name).replace(/</g, '&lt;')}</b><small>${curSet + 1} / ${M.sets.length}${curSet ? '・' + (s.counts || 0) + 'カウント' : '・開始'}</small>`;
    $('mbprev').disabled = curSet <= 0; $('mbnext').disabled = curSet >= M.sets.length - 1;
  };
  {
    wrap('renderTimeline', paintSetbar);
    wrap('refresh', paintSetbar);
    wrap('updateSel', () => { if (sel.size) html.dataset.hasSel = '1'; else delete html.dataset.hasSel; });
  }
  // 長押し → セットのメニュー（iOS は長押しの contextmenu が来ないので自前で出す）
  let tlp = null;
  tltrack.addEventListener('pointerdown', e => {
    if (!mp() || e.pointerType !== 'touch') return;
    const blk = e.target.closest('.tlb'); if (!blk || e.target.closest('.edge')) return;
    if (tlp) clearTimeout(tlp.t);
    const x = e.clientX, y = e.clientY;
    tlp = {x, y, t: setTimeout(() => {
      tlp = null;
      if (typeof tdrag !== 'undefined') tdrag = null;
      tltrack.classList.remove('dragging');
      const swallow = ev => { ev.stopImmediatePropagation(); tltrack.removeEventListener('pointerup', swallow, true); };
      tltrack.addEventListener('pointerup', swallow, true);
      hap(14);
      blk.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, view: window}));
    }, 480)};
  }, true);
  tltrack.addEventListener('pointermove', e => { if (tlp && Math.hypot(e.clientX - tlp.x, e.clientY - tlp.y) > 9) { clearTimeout(tlp.t); tlp = null; } });
  const tlpEnd = () => { if (tlp) { clearTimeout(tlp.t); tlp = null; } };
  tltrack.addEventListener('pointerup', tlpEnd); tltrack.addEventListener('pointercancel', tlpEnd); tltrack.addEventListener('scroll', tlpEnd, {passive: true});
  // つまみの端をつかんだら、スクロールではなくドラッグに（edge は touch-action:none）。長さが変わるたびに軽く振動
  let lastTip = '';
  new MutationObserver(() => { const t = $('tltip'); if (t && t.style.display === 'block' && t.textContent !== lastTip) { lastTip = t.textContent; hap(4); } }).observe(body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style']});

  paintSetbar();
  // コマンド検索の「Esc」の札は、スマホでは閉じるボタンにする
  document.addEventListener('click', e => { const k = e.target.closest && e.target.closest('.scp-in .kc'); if (k && mp()) { const i = k.parentNode.querySelector('input') || document.activeElement; (i || document).dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); } }, true);
  // ---------- 読み込み画面を閉じる ----------
  function bootDone() { if (window.jkBoot && window.jkBoot.done) window.jkBoot.done(); }
  wrap('refresh', () => { if (R || lastErr) bootDone(); });
  setTimeout(() => { if (typeof R !== 'undefined' && (R || lastErr)) bootDone(); }, 600);
  setTimeout(bootDone, 15000);

  // ---------- 最初の1回のタッチで音を使えるように（iOS は操作の中でしか音を出せない） ----------
  const unlock = () => { try { if (window.jkAudio && jkAudio.unlock) jkAudio.unlock(); } catch (e) { /* なし */ } };
  ['pointerdown', 'touchend', 'click'].forEach(t => document.addEventListener(t, function f() { unlock(); document.removeEventListener(t, f, true); }, true));

  // ---------- 開始 ----------
  syncMode();
  if (mp()) { setSheet(land() ? 'side' : 'peek'); }
  paintDirty();
  // 横向き: 選択バーはタイムラインの上に重ねる。タイムラインの高さを CSS 変数で渡す
  { const tl = $('timeline'); if (tl && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--mb-tl', tl.offsetHeight + 'px')).observe(tl); }
  // 次にやること: ×で閉じる（内容が変わるとまた出る）
  { const nb = $('nextbar'); let closedFor = '';
    if (nb) {
      const sync = () => {
        if (!mp()) return;
        const key = (nb.querySelector('.nb-m') || nb).textContent.trim();
        nb.classList.toggle('nbx', !!key && key === closedFor);
        if (key && !nb.querySelector('.nb-x') && key !== closedFor) {
          const x = el('button', 'nb-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '閉じる');
          x.onclick = () => { closedFor = key; nb.classList.add('nbx'); };
          mo.disconnect(); nb.appendChild(x); mo.observe(nb, {childList: true, subtree: true, characterData: true});
        }
      };
      const mo = new MutationObserver(sync); mo.observe(nb, {childList: true, subtree: true, characterData: true}); sync();
    } }
  // 拡大率の表示（タップで全体表示に戻る）
  { const zc = $('zoomctl'), zf = $('zfit');
    if (zc && zf) {
      const z = el('button', '', '100%'); z.id = 'zpct'; z.type = 'button'; z.title = '拡大率（タップで全体表示）'; z.setAttribute('aria-label', '拡大率。タップで全体表示に戻す');
      zc.insertBefore(z, zf);
      z.onclick = () => { if (UXA.applyView) UXA.applyView(0, 0, 1); hap(8); };
      window.addEventListener('jk-view', e => { const k = e.detail && e.detail.k || 1; z.textContent = Math.round(k * 100) + '%'; z.classList.toggle('on', Math.abs(k - 1) > 0.02); });
    } }
})();
