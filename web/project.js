// Browser drafts and opt-in synchronization. .jk remains the exchange format.
(() => {
  const draftKey = 'jinkei-autosave';
  const historyKey = 'jinkei-draft-history';
  function read(storage, key) {
    try { return JSON.parse(window[storage].getItem(key)); }
    catch { return null; }
  }
  const isDraft = value => typeof value?.name === 'string' && typeof value.source === 'string';
  const same = (a, b) => a.name === b.name && a.source === b.source;
  const initial = [read('sessionStorage', draftKey), read('localStorage', draftKey)].find(isDraft);
  let draft, apply, ui, conflict, activeRequest, connectPending, editTimer, retryTimer;
  let localSaved = false, retries = 0, lastCheckpoint = Date.now(), cloudMessage = '';

  function status() {
    if (!ui) return;
    ui.local.textContent = localSaved ? '下書き保存済み' : '下書きを端末に保存できません';
    ui.cloud.textContent = cloudMessage || (draft.cloud ? '同期を確認中' : 'クラウド未接続');
    ui.sync.textContent = conflict ? '変更の競合を確認' : '端末間同期';
  }
  function persist() {
    const data = JSON.stringify(draft);
    localSaved = false;
    try { localStorage.setItem(draftKey, data); localSaved = true; }
    catch { /* Keep an unsaved draft in memory for .jk export. */ }
    try { sessionStorage.setItem(draftKey, data); }
    catch { /* The persistent copy can still be used on the next launch. */ }
    status();
  }
  function history() {
    const list = read('localStorage', historyKey);
    return Array.isArray(list) ? list.filter(isDraft) : [];
  }
  function checkpoint(item = draft) {
    const previous = history();
    if (previous[0] && same(previous[0], item)) {
      lastCheckpoint = Date.now();
      return true;
    }
    const list = [{ name: item.name, source: item.source, time: Date.now() }, ...previous].slice(0, 8);
    while (list.length) {
      try {
        localStorage.setItem(historyKey, JSON.stringify(list));
        lastCheckpoint = Date.now();
        return true;
      } catch { list.pop(); }
    }
    return false;
  }
  function replace(name, source, cloud = null) {
    draft = { name, source, cloud };
    conflict = null;
    retries = 0;
    cloudMessage = cloud ? 'クラウド同期済み' : '';
    clearTimeout(editTimer);
    clearTimeout(retryTimer);
    persist();
  }
  function queueSync() {
    clearTimeout(editTimer);
    editTimer = setTimeout(sync, 900);
  }
  function edit(name, source) {
    if (same(draft, { name, source })) return;
    if (Date.now() - lastCheckpoint > 60000) checkpoint();
    draft.name = name;
    draft.source = source;
    if (draft.cloud) {
      draft.cloud.pending = true;
      if (!conflict) cloudMessage = '同期待ち';
      queueSync();
    }
    persist();
  }
  function endpoint(value) {
    let url;
    try { url = new URL(value.trim()); }
    catch { throw new Error('同期サーバーの URL を確認してください'); }
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.hash || url.search) {
      throw new Error('同期サーバーの HTTPS URL を入力してください');
    }
    return url.href.replace(/\/$/, '');
  }
  function parseCode(value) {
    const [url, token, extra] = value.trim().split(/\s+/);
    if (!/^[a-f0-9]{64}$/.test(token || '') || extra) throw new Error('同期コードを確認してください');
    return { endpoint: endpoint(url), token };
  }
  function randomKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  }
  async function request(cloud, method, payload, creationKey) {
    const url = new URL(cloud.endpoint + '/project');
    if (method === 'GET' && cloud.revision != null) url.searchParams.set('after', cloud.revision);
    const headers = { Authorization: 'Bearer ' + cloud.token };
    if (payload) headers['Content-Type'] = 'application/json';
    if (creationKey) headers['X-Jinkei-Create'] = creationKey;
    const response = await fetch(url, {
      method, headers, body: payload && JSON.stringify(payload), signal: AbortSignal.timeout(12000),
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (response.status === 204 && method === 'GET') return null;
    if (response.status === 403) throw new Error('作成キーが違います');
    if (response.status === 404) throw new Error('同期プロジェクトが見つかりません');
    const collision = method === 'PUT' && response.status === 409;
    if (!response.ok && !collision) throw new Error('同期サーバーが応答しました（HTTP ' + response.status + '）');
    const remote = await response.json();
    if (!isDraft(remote) || !Number.isSafeInteger(remote.revision) || remote.revision < 1) {
      throw new Error('同期サーバーの応答を読み取れません');
    }
    return { remote, collision };
  }
  function acknowledge(cloud, remote) {
    cloud.revision = remote.revision;
    cloud.pending = !same(draft, remote);
    conflict = null;
    cloudMessage = cloud.pending ? '同期待ち' : 'クラウド同期済み';
    persist();
  }
  async function adoptRemote(cloud, remote) {
    draft.name = remote.name;
    draft.source = remote.source;
    acknowledge(cloud, remote);
    await apply(remote.name, remote.source, null);
  }
  async function receive(cloud, remote, manual) {
    if (same(draft, remote)) { acknowledge(cloud, remote); return; }
    if (!cloud.pending && !ui.canReplace(manual)) return;
    if (cloud.pending || !checkpoint()) {
      conflict = remote;
      cloudMessage = '別端末に変更あり';
      status();
      return;
    }
    await adoptRemote(cloud, remote);
  }
  async function sync(manual = false) {
    const cloud = draft?.cloud;
    if (!cloud || activeRequest || conflict || (document.hidden && !manual)) return;
    if (navigator.onLine === false) {
      cloudMessage = 'オフライン・端末で編集中';
      status();
      return;
    }
    const outgoing = cloud.pending;
    const snapshot = {name: draft.name, source: draft.source, revision: cloud.revision};
    let succeeded = false;
    activeRequest = true;
    try {
      const result = await request(cloud, outgoing ? 'PUT' : 'GET', outgoing ? snapshot : undefined);
      if (draft.cloud !== cloud) return;
      retries = 0;
      clearTimeout(retryTimer);
      if (result && outgoing && !result.collision) acknowledge(cloud, result.remote);
      else if (result) await receive(cloud, result.remote, manual);
      else {
        cloudMessage = cloud.pending ? '同期待ち' : 'クラウド同期済み';
        status();
      }
      succeeded = true;
    } catch (error) {
      if (draft.cloud !== cloud) return;
      cloudMessage = error instanceof TypeError || error.name === 'TimeoutError' ?
        '同期に接続できません・再試行します' : error.message;
      status();
      clearTimeout(retryTimer);
      retryTimer = setTimeout(sync, Math.min(60000, 3000 * 2 ** Math.min(retries++, 5)));
    } finally {
      activeRequest = false;
      if (succeeded && draft.cloud?.pending && !conflict) queueSync();
    }
  }
  const get = id => ui.dialog.querySelector('#' + id);
  const message = (node, text) => { node.querySelector('output').textContent = text; };
  function openSync() {
    get('syncsetup').hidden = !!draft.cloud;
    get('syncactive').hidden = !draft.cloud;
    get('syncconflict').hidden = !conflict;
    get('synccode').value = draft.cloud ? draft.cloud.endpoint + ' ' + draft.cloud.token : '';
    get('syncjoincode').value = '';
    get('synccreatekey').value = '';
    ui.dialog.querySelectorAll('output').forEach(output => { output.textContent = ''; });
    if (!ui.dialog.open) ui.dialog.showModal();
  }
  async function connect(event, create) {
    event.preventDefault();
    if (connectPending) return;
    const form = event.currentTarget;
    const button = form.querySelector('button');
    connectPending = button.disabled = true;
    const startingDraft = draft;
    try {
      const snapshot = {name: draft.name, source: draft.source, revision: 0};
      const cloud = create ? {endpoint: endpoint(get('syncurl').value), token: randomKey()}
        : parseCode(get('syncjoincode').value);
      if (!create && (!ui.canReplace(true) || !checkpoint())) throw new Error('現在の下書きを退避できません');
      const result = await request(cloud, create ? 'POST' : 'GET', create ? snapshot : undefined,
        create ? get('synccreatekey').value : undefined);
      if (!result || draft !== startingDraft || !same(draft, snapshot) || draft.cloud ||
          (!create && !ui.canReplace(true))) {
        throw new Error('編集中の内容を確認してから、もう一度お試しください');
      }
      const remote = result.remote;
      replace(remote.name, remote.source, { ...cloud, revision: remote.revision, pending: false });
      if (!create) await apply(remote.name, remote.source, null);
      if (ui.dialog.open) openSync();
    } catch (error) {
      message(form, error instanceof TypeError ? '同期サーバーに接続できません' : error.message);
    } finally { connectPending = button.disabled = false; }
  }
  function openHistory() {
    const list = ui.history.querySelector('ul');
    list.replaceChildren();
    history().forEach(item => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = item.name + ' · ' + new Date(item.time).toLocaleString('ja-JP');
      button.onclick = async () => {
        if (!ui.canReplace(true) || !checkpoint()) {
          message(ui.history, '現在の下書きを退避できません');
          return;
        }
        ui.history.close();
        replace(item.name, item.source);
        await apply(item.name, item.source, null);
      };
      li.append(button);
      list.append(li);
    });
    message(ui.history, list.children.length ? '' : '復元できる履歴はまだありません');
    ui.history.showModal();
  }
  function bind(controls) {
    ui = controls;
    ui.sync.onclick = openSync;
    ui.historyButton.onclick = openHistory;
    get('synccreate').onsubmit = event => connect(event, true);
    get('syncjoin').onsubmit = event => connect(event, false);
    get('synccopy').onclick = async () => {
      const input = get('synccode');
      try { await navigator.clipboard.writeText(input.value); message(get('syncactive'), 'コピーしました'); }
      catch { input.focus(); input.select(); }
    };
    get('syncnow').onclick = async () => { await sync(true); if (ui.dialog.open) openSync(); };
    get('syncdisconnect').onclick = () => { replace(draft.name, draft.source); ui.dialog.close(); };
    get('syncusemine').onclick = async () => {
      if (!conflict || !draft.cloud || activeRequest) return;
      if (!checkpoint(conflict)) { message(get('syncconflict'), 'クラウド版を下書き履歴に退避できません'); return; }
      draft.cloud.revision = conflict.revision;
      draft.cloud.pending = true;
      conflict = null;
      persist();
      await sync(true);
      if (ui.dialog.open) openSync();
    };
    get('syncuseremote').onclick = async () => {
      if (!conflict || !draft.cloud || activeRequest) return;
      if (!ui.canReplace(true) || !checkpoint()) { message(get('syncconflict'), '現在の下書きを退避できません'); return; }
      await adoptRemote(draft.cloud, conflict);
      ui.dialog.close();
    };
    window.addEventListener('online', () => sync());
    window.addEventListener('offline', () => sync());
    window.addEventListener('focus', () => sync());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    setInterval(() => { if (!retries) sync(); }, 15000);
    status();
    sync();
  }
  window.JK_PROJECT = {
    initial, bind, edit, replace, checkpoint,
    start(name, source, load) {
      draft = { name, source, cloud: initial?.cloud || null };
      apply = load;
      persist();
    },
    get saved() { return localSaved; },
  };
})();
