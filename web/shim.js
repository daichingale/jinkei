// ブラウザ版（jinkei web）用: エディタが呼ぶ /api/* をブラウザ内のエンジンで処理する。
(function () {
  const TEMPLATE = __JK_TEMPLATE_SHOW__;
  const realFetch = window.fetch.bind(window);
  const saved = window.JK_PROJECT.initial;
  const st = { name: saved?.name || 'show.jk', handle: null };

  const json = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
  const baseName = () => st.name.replace(/\.jk$/i, '') + '.jk';
  async function save(source) {
    try {
      if (st.handle && st.handle.createWritable) {
        const w = await st.handle.createWritable();
        await w.write(source); await w.close();
        return { ok: true, path: st.name };
      }
      if (window.showSaveFilePicker) {
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

  // 自動修正は重いので、可能なら Web Worker で動かして画面を止めない（使えなければその場で計算）
  let worker = null, workerDead = false, wid = 0;
  const waiting = new Map();
  function fixOffThread(src) {
    const el = document.getElementById('jk-engine');
    if (!workerDead && el && window.Worker && window.Blob && window.URL) {
      try {
        if (!worker) {
          const code = el.textContent + '\nself.onmessage=function(e){var r;try{r=jinkeiFix(e.data.src)}catch(x){r={ok:false,error:String(x&&x.message||x)}}self.postMessage({id:e.data.id,r:r})};';
          worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
          worker.onmessage = e => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w.resolve(e.data.r); } };
          worker.onerror = () => { workerDead = true; worker = null; waiting.forEach(w => { try { w.resolve(jinkeiFix(w.src)); } catch (x) { w.resolve({ ok: false, error: String(x) }); } }); waiting.clear(); };
        }
        return new Promise(resolve => { const id = ++wid; waiting.set(id, { resolve, src }); worker.postMessage({ id, src }); });
      } catch (e) { workerDead = true; worker = null; }
    }
    return Promise.resolve(jinkeiFix(src));
  }

  window.fetch = function (url, opt) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const body = opt && opt.body;
    if (u === '/api/source') return Promise.resolve(json({ path: '', name: st.name, source: saved && typeof saved.source === 'string' ? saved.source : TEMPLATE }));
    if (u === '/api/compile') return Promise.resolve(json(jinkeiCompile(String(body))));
    if (u === '/api/fix') return fixOffThread(String(body)).then(json);
    if (u === '/api/save') return save(String(body)).then(json);
    return realFetch(url, opt);
  };

  // プレビューのひな形（スクリプト終端タグを退避して埋め込んである）
  let tpl = null;
  function previewHtml(data, title) {
    if (tpl === null) tpl = document.getElementById('jk-preview-tpl').textContent.split(window.JK_ESC).join('<');
    const j = JSON.stringify(data).replace(/</g, '\\u003c');
    const t = String(title == null ? '' : title).replace(/</g, '&lt;');
    return tpl.split('__JK_TITLE__').join(t).replace('__JK_DATA__', () => j);
  }
  window.JK_LOCAL = {
    template: TEMPLATE,
    get name() { return st.name; },
    setFile(name, handle) { st.name = name || 'show.jk'; st.handle = handle || null; },
    forget() { st.handle = null; },
    previewHtml,
  };
})();
