// ブラウザ版（jinkei web）用: エディタが呼ぶ /api/* をブラウザ内のエンジンで処理する。
(function () {
  const TEMPLATE = __JK_TEMPLATE_SHOW__;
  const realFetch = window.fetch.bind(window);
  const saved = window.JK_PROJECT.initial;
  const st = { name: saved?.name || 'show.jk', handle: null };

  const json = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
  const baseName = () => st.name.replace(/\.jk$/i, '') + '.jk';
  const touchOnly = () => { try { return matchMedia('(pointer:coarse)').matches && !matchMedia('(any-pointer:fine)').matches; } catch (e) { return false; } };
  async function save(source) {
    try {
      if (touchOnly()) { /* スマホ・タブレット: 保存ダイアログは使わずダウンロードにする */ }
      else if (st.handle && st.handle.createWritable) {
        const w = await st.handle.createWritable();
        await w.write(source); await w.close();
        return { ok: true, path: st.name };
      }
      else if (window.showSaveFilePicker) {
        st.handle = await window.showSaveFilePicker({ suggestedName: baseName(), types: [{ description: '陣形ファイル', accept: { 'text/plain': ['.jk'] } }] });
        const w = await st.handle.createWritable();
        await w.write(source); await w.close();
        return { ok: true, path: st.name };
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, error: '保存をキャンセルしました' };
      return { ok: false, error: String(e && e.message || e) };
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
    a.download = baseName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return { ok: true, path: baseName() };
  }

  // 重い計算（コンパイル・自動修正）は Web Worker で動かして画面を止めない。使えなければその場で計算する。
  // 組み立ては { 作業ごとに別の Worker（compile / fix）、結果は JSON 文字列で受け取り、呼び出し側の fetch().json() と同じ形 }。
  //  ・進み具合: fix の途中経過（何セット目まで）を JK_LOCAL.onFixProgress(k, n) へ流す
  //  ・取り消し: 同期のループは中断のメッセージを受け取れないので、Worker ごと止めて作り直す（JK_LOCAL.cancelFix()）
  //  ・Worker の中でもエンジンの記憶（セットごとの結果の再利用）が残るので、少しの編集は差分だけの再計算になる
  const POOL = { compile: { w: null, dead: false, wait: new Map() }, fix: { w: null, dead: false, wait: new Map() } };
  let wid = 0;
  const reply = text => ({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(text)), text: () => Promise.resolve(text) });
  const HANDLER = '\nself.onmessage=function(e){var d=e.data,r;try{r=d.op==="fix"?jinkeiFix(d.src,{onProgress:function(k,n,m){self.postMessage({id:d.id,p:[k,n,m]})}}):jinkeiCompile(d.src)}catch(x){r={ok:false,error:String(x&&x.message||x)}}self.postMessage({id:d.id,t:JSON.stringify(r)})};';
  const inline = (op, src) => {
    let r; try { r = op === 'fix' ? jinkeiFix(src) : jinkeiCompile(src); } catch (x) { r = { ok: false, error: String(x && x.message || x) }; }
    return reply(JSON.stringify(r));
  };
  function spawn(op) {
    const P = POOL[op], el = document.getElementById('jk-engine');
    if (P.dead || !el || !window.Worker || !window.Blob || !window.URL) return null;
    if (P.w) return P.w;
    try {
      const w = new Worker(URL.createObjectURL(new Blob([el.textContent + HANDLER], { type: 'text/javascript' })));
      w.onmessage = e => {
        const d = e.data, q = P.wait.get(d.id); if (!q) return;
        if (d.p) { if (op === 'fix' && window.JK_LOCAL && window.JK_LOCAL.onFixProgress) window.JK_LOCAL.onFixProgress(d.p[0], d.p[1], d.p[2]); return; }
        P.wait.delete(d.id); q.resolve(reply(d.t));
      };
      w.onerror = () => { P.dead = true; P.w = null; const ws = [...P.wait.values()]; P.wait.clear(); ws.forEach(q => q.resolve(inline(op, q.src))); };
      return (P.w = w);
    } catch (e) { P.dead = true; P.w = null; return null; }
  }
  function offThread(op, src) {
    const w = spawn(op);
    if (!w) return Promise.resolve(inline(op, src));
    return new Promise(resolve => { const id = ++wid; POOL[op].wait.set(id, { resolve, src }); w.postMessage({ id, op, src }); });
  }
  // 自動修正を途中でやめる: Worker を止めて作り直し、待っていた fix は「中止」として返す
  function cancelFix() {
    const P = POOL.fix; if (!P.w) return false;
    P.w.terminate(); P.w = null;
    const ws = [...P.wait.values()]; P.wait.clear();
    ws.forEach(q => q.resolve(reply(JSON.stringify({ ok: false, cancelled: true, error: '自動修正を中止しました' }))));
    return ws.length > 0;
  }

  window.fetch = function (url, opt) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const body = opt && opt.body;
    if (u === '/api/source') return Promise.resolve(json({ path: '', name: st.name, source: saved && typeof saved.source === 'string' ? saved.source : TEMPLATE }));
    if (u === '/api/compile') return offThread('compile', String(body));
    if (u === '/api/fix') return offThread('fix', String(body));
    if (u === '/api/save') return save(String(body)).then(json);
    return realFetch(url, opt);
  };

  // プレビューのひな形（スクリプト終端タグを退避して埋め込んである）
  let tpl = null;
  function previewHtml(data, title) {
    if (tpl === null) tpl = document.getElementById('jk-preview-tpl').textContent.split(window.JK_ESC).join('<');
    const j = JSON.stringify(data).replace(/</g, '\\u003c');
    const t = String(title == null ? '' : title).replace(/</g, '&lt;');
    return tpl.split('__JK_BASE__').join(document.baseURI).split('__JK_TITLE__').join(t).replace('__JK_DATA__', () => j);
  }
  window.JK_LOCAL = {
    template: TEMPLATE,
    get name() { return st.name; },
    setFile(name, handle) { st.name = name || 'show.jk'; st.handle = handle || null; },
    forget() { st.handle = null; },
    previewHtml,
    cancelFix,
    onFixProgress: null,
    // スマホ: 共有シート（ファイルアプリへ保存・メッセージで送る）。使えなければダウンロード
    async share(source) {
      const file = new File([String(source)], baseName(), { type: 'text/plain' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: baseName() }); return { ok: true, shared: true }; }
      } catch (e) { if (e && e.name === 'AbortError') return { ok: false }; }
      return save(String(source));
    },
  };
})();
