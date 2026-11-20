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

  window.fetch = function (url, opt) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const body = opt && opt.body;
    if (u === '/api/source') return Promise.resolve(json({ path: '', name: st.name, source: saved && typeof saved.source === 'string' ? saved.source : TEMPLATE }));
    if (u === '/api/compile') return Promise.resolve(json(jinkeiCompile(String(body))));
    if (u === '/api/fix') return Promise.resolve(json(jinkeiFix(String(body))));
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
