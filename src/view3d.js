// ---- 3D ビュー（three.js）----
// 座標: X = 上手(+)、Y = 上、Z = 客席方向(+)。単位メートル。
(() => {
  const U = D.unit_m;
  // 見た目: real（既定）/ illust。ショーの look 指定、URL の #look=illust、3D 画面の切り替えで決まる
  let ILL = (new URLSearchParams(location.hash.slice(1)).get('look') || D.look) === 'illust';
  let _grad = null;
  // 3段のトゥーンのランプ（影・中間・明）
  const grad = () => _grad || (_grad = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 140, 140, 140, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; })());
  // イラストの色: 彩度を落として明るくする（背景・会場用）
  const flatC = c => { const k = new THREE.Color(c), h = {}; k.getHSL(h); return k.setHSL(h.h, h.s * 0.55, Math.min(0.92, h.l * 0.8 + 0.2)); };
  const W = (x, y) => [x * U, -y * U];
  const wrap = document.getElementById('glwrap');
  let renderer = null, scene, camera, people = [], ringSel, ringFlag = [], recCanvas = null, recorder = null, chunks = [];
  let camMode = 'audience';
  // 自由カメラ（球面座標）
  const orbit = {theta: 0, phi: 1.0, r: 40, target: new THREE.Vector3()};

  function bounds() {
    if (F.type === 'football') { const d = F.bsl * U; return {cx: 0, cz: -d / 2, hw: 54.9, hd: d / 2}; }
    if (F.type === 'gym') return {cx: 0, cz: 0, hw: F.w / 2 + F.margin, hd: F.d / 2 + F.margin};
    if (F.type === 'stage') return {cx: 0, cz: -F.d / 2, hw: F.w / 2 + F.wing, hd: F.d / 2};
    return {cx: 0, cz: -F.d / 2, hw: F.w / 2, hd: F.d / 2};
  }

  // ---- 楽器の種類: エンジンが決めた楽器ID（D.sections[s].instrument）→ アセットのメッシュ名 ----
  // render.rs の mesh_of と同じ対応表。メッシュ名 = 構え（hold/<名前>）のクリップ名。'none' は楽器なし（手は体の脇）
  const MESHES = ['trumpet', 'mellophone', 'marching_horn', 'horn', 'trombone', 'euphonium', 'marching_euphonium', 'tuba', 'marching_tuba', 'sousaphone',
    'piccolo', 'flute', 'oboe', 'bassoon', 'eb_clarinet', 'clarinet', 'alto_clarinet', 'bass_clarinet', 'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax',
    'snare', 'tenors', 'bass1', 'bass2', 'bass3', 'bass4', 'bass5', 'cymbals_mid', 'cymbals_high', 'glockenspiel', 'xylophone'];
  // id: 楽器ID、i: セクション内の何人目か（0始まり）、n: セクションの人数。バスドラムは小→大の順にサイズ1〜5
  function meshOf(id, i, n) {
    if (id === 'flag') return 'guard';
    if (id === 'bass_drum') return 'bass' + (n <= 5 ? i + 1 : 1 + Math.floor(i * 5 / n));
    return MESHES.includes(id) ? id : 'none';
  }

  const mat = c => ILL ? new THREE.MeshToonMaterial({color: flatC(c), gradientMap: grad()}) : new THREE.MeshStandardMaterial({color: c, roughness: 0.9, metalness: 0, envMapIntensity: 0.3});
  function box(w, h, d, m, x, y, z, parent) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  }
  // 乱数（会場の模様を毎回同じにする）
  const rnd = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();

  // 床の模様は Canvas に描いてテクスチャにする
  function floorTexture(wm, dm, draw) {
    const s = Math.min(48, 4096 / Math.max(wm, dm));
    const c = document.createElement('canvas');
    c.width = Math.round(wm * s); c.height = Math.round(dm * s);
    const g = c.getContext('2d');
    g.scale(s, s);
    draw(g, s);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if ('colorSpace' in t) t.colorSpace = 'srgb'; else t.encoding = THREE.sRGBEncoding;
    return t;
  }
  // 床は反射を抑えて（白飛び防止）、木目や芝の色がそのまま出るようにする
  function floorPlane(x0, z0, x1, z1, y, tex, color, rough) {
    const fm = tex ? (ILL ? new THREE.MeshToonMaterial({map: tex, gradientMap: grad()}) : new THREE.MeshStandardMaterial({map: tex, roughness: rough || 0.7, metalness: 0, envMapIntensity: 0.18})) : mat(color);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), fm);
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m); return m;
  }
  // 板張り（縦割り）。板ごとに明るさを変え、継ぎ目と細い木目を引く
  const planks = (g, x0, z0, wm, dm, pw, base, vary, grain) => {
    let k = 0;
    for (let x = 0; x < wm; x += pw, k++) {
      const t = vary[k % vary.length];
      g.fillStyle = `rgb(${base[0] + t},${base[1] + t * 0.85},${base[2] + t * 0.7})`;
      g.fillRect(x0 + x, z0, pw + 0.01, dm);
      if (grain) {
        g.lineWidth = 0.012; g.strokeStyle = 'rgba(70,40,15,0.16)';
        for (let j = 0; j < 4; j++) { const gx = x0 + x + pw * (0.15 + 0.7 * ((j * 0.37 + k * 0.23) % 1)); g.beginPath(); g.moveTo(gx, z0); g.lineTo(gx + 0.02 * Math.sin(k + j), z0 + dm); g.stroke(); }
        g.strokeStyle = 'rgba(40,22,8,0.45)'; g.lineWidth = 0.014; g.beginPath(); g.moveTo(x0 + x, z0); g.lineTo(x0 + x, z0 + dm); g.stroke();
      }
    }
  };
  // ひだのある布（幅 w・高さ h）。XY 平面に作り、z 方向に正弦波で波打たせる
  function curtain(w, h, color, o = {}) {
    const period = o.period || 0.55, amp = o.amp === undefined ? 0.12 : o.amp, segs = Math.max(8, Math.round(w / period * 8));
    const geo = new THREE.PlaneGeometry(w, h, segs, 6), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), a = (x / period) * Math.PI * 2;
      pos.setZ(i, amp * Math.sin(a) * (1 - 0.3 * (y / h + 0.5)) + 0.03 * Math.sin(a * 2.3 + y * 0.4));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, ILL ? new THREE.MeshToonMaterial({color: flatC(color), gradientMap: grad(), side: THREE.DoubleSide}) : new THREE.MeshStandardMaterial({color, roughness: 0.96, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.15}));
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  // 体育館の壁（ローカル +Z 向きが室内側）。下は濃い腰パネル、上は漆喰、高い位置に採光窓
  function hallWall(len, hgt, name) {
    const g = new THREE.Group(), t = 0.3;
    box(len, hgt, t, mat(ILL ? 0xe4e2d6 : 0xc9c5b8), 0, hgt / 2, -t / 2, g);
    box(len, 2.4, t + 0.1, mat(ILL ? 0x7d8fa6 : 0x262c3a), 0, 1.2, -t / 2 + 0.02, g);
    box(len, 0.12, 0.16, mat(ILL ? 0xf0e3a0 : 0xb7a24a), 0, 2.46, 0.02, g);
    for (let x = -len / 2 + 1.5; x < len / 2 - 1; x += 3) box(0.18, hgt - 2.5, 0.1, mat(ILL ? 0xd2d1c4 : 0xaaa699), x, 2.5 + (hgt - 2.5) / 2, 0.05, g);
    const win = new THREE.MeshBasicMaterial({color: ILL ? 0xcfe6f7 : 0x9fbbd8});
    for (let x = -len / 2 + 2.4; x < len / 2 - 2; x += 3) { const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), win); w.position.set(x, hgt - 1.7, 0.03); g.add(w); }
    scene.add(g); return g;
  }

  function buildVenue() {
    const B = bounds();
    if (F.type === 'gym') {
      const hw = B.hw, hd = B.hd;
      const tex = floorTexture(hw * 2, hd * 2, g => {
        if (ILL) { g.fillStyle = '#a9b8a8'; g.fillRect(0, 0, hw * 2, hd * 2); g.translate(hw, hd); g.fillStyle = '#bccbb9'; g.fillRect(-F.w / 2, -F.d / 2, F.w, F.d); }
        else {
          planks(g, 0, 0, hw * 2, hd * 2, 0.9, [176, 118, 64], [0, 9, -6, 4, -4, 7, -8], true);
          g.fillStyle = 'rgba(40,20,5,0.18)'; g.fillRect(0, 0, hw * 2, hd * 2);
          g.fillStyle = 'rgba(0,0,0,0)';
          g.translate(hw, hd);
          // 演技フロア（少し明るい）
          g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(40,25,10,0.12)'; g.fillRect(-F.w / 2, -F.d / 2, F.w, F.d); g.restore();
        }
        g.strokeStyle = ILL ? '#ffffff' : '#fbfbf6'; g.lineWidth = ILL ? 0.11 : 0.09; g.lineJoin = 'miter';
        g.strokeRect(-F.w / 2, -F.d / 2, F.w, F.d);
        if (F.w >= 25 && F.d >= 25) g.strokeRect(-10, -10, 20, 20);
        g.beginPath(); g.moveTo(0, -F.d / 2); g.lineTo(0, F.d / 2); g.moveTo(-F.w / 2, 0); g.lineTo(F.w / 2, 0); g.stroke();
        g.lineWidth = 0.075;
        for (let x = Math.ceil(-F.w / 10) * 5; x <= F.w / 2; x += 5) for (let z = Math.ceil(-F.d / 10) * 5; z <= F.d / 2; z += 5) {
          g.beginPath(); g.moveTo(x - 0.28, z); g.lineTo(x + 0.28, z); g.moveTo(x, z - 0.28); g.lineTo(x, z + 0.28); g.stroke();
        }
      });
      floorPlane(-hw, -hd, hw, hd, 0, tex, 0, 0.62);
      const wh = 9;
      const back = hallWall(hw * 2 + 0.6, wh); back.position.set(0, 0, -hd);
      const left = hallWall(hd * 2 + 0.6, wh); left.rotation.y = Math.PI / 2; left.position.set(-hw, 0, 0);
      const right = hallWall(hd * 2 + 0.6, wh); right.rotation.y = -Math.PI / 2; right.position.set(hw, 0, 0);
      walls.push(left, right);
      // 奥のステージ（緞帳つき）
      backdrop.push(back, box(14, 1.1, 0.8, mat(0x3a2c26), 0, 0.55, -hd + 0.4, scene));
      const cur = curtain(13.4, 4.2, 0x6a1020, {period: 0.7, amp: 0.16}); cur.position.set(0, 3.2, -hd + 0.12); scene.add(cur);
      const val = curtain(14, 0.9, 0x8a1c2c, {period: 0.5, amp: 0.1}); val.position.set(0, 5.5, -hd + 0.2); scene.add(val);
      backdrop.push(cur, val);
    } else if (F.type === 'stage') {
      const ww = B.hw;
      floorPlane(-ww - 8, 0, ww + 8, 16, -1, null, 0x1e1a19);
      box(ww * 2, 1, F.d, mat(0x2e2420), 0, -0.5, -F.d / 2, scene).receiveShadow = true;
      const tex = floorTexture(ww * 2, F.d, g => {
        if (ILL) { g.fillStyle = '#9d96a3'; g.fillRect(0, 0, ww * 2, F.d); g.fillStyle = '#c8bfb0'; g.fillRect(F.wing, 0, F.w, F.d); }
        else {
          g.fillStyle = '#1b1614'; g.fillRect(0, 0, ww * 2, F.d);
          planks(g, F.wing, 0, F.w, F.d, 0.6, [92, 62, 40], [0, 6, -5, 3], true);
        }
        g.strokeStyle = '#fbfbf6'; g.lineWidth = ILL ? 0.12 : 0.09; g.beginPath(); g.moveTo(0, F.d - 0.04); g.lineTo(ww * 2, F.d - 0.04); g.stroke();
        g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(ww - 0.25, F.d); g.lineTo(ww + 0.25, F.d); g.lineTo(ww, F.d - 0.45); g.fill();
      });
      floorPlane(-ww, -F.d, ww, 0, 0.012, tex, 0, 0.6);
      // 奥の幕（ひだのある深い青）と、ホリゾント下の暗い床
      const back = curtain(ww * 2 + 0.4, 8, 0x22315a, {period: 0.62, amp: 0.2}); back.position.set(0, 4, -F.d - 0.2); scene.add(back); backdrop.push(back);
      for (const s of [-1, 1]) {
        // 袖幕（黒）: 舞台の奥行きに沿って3枚
        for (let k = 0; k < 3; k++) {
          const w = F.d * 0.24, c = curtain(w, 7.4, 0x0d0d10, {period: 0.45, amp: 0.1});
          c.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
          c.position.set(s * (F.w / 2 + 0.3 + k * F.wing / 3), 3.7, -F.d * (0.2 + 0.28 * k)); scene.add(c); backdrop.push(c);
        }
        // プロセニアムの赤い緞帳（左右）
        const pc = curtain(3, 10, 0x6a1519, {period: 0.5, amp: 0.15}); pc.position.set(s * (ww + 1.5), 5, -0.3); scene.add(pc); backdrop.push(pc);
      }
      const val = curtain(ww * 2 + 6, 1.7, 0x7a1a20, {period: 0.55, amp: 0.12}); val.position.set(0, 8.2, -0.3); scene.add(val);
      backdrop.push(val, box(ww * 2 + 6, 0.12, 0.3, mat(0xc9a64a), 0, 7.32, -0.1, scene));
    } else if (F.type === 'football') {
      const d = F.bsl * U, ydm = 0.9144;
      const tex = floorTexture(120, d + 12, g => {
        g.fillStyle = ILL ? '#c98f7c' : '#6a3f33'; g.fillRect(0, 0, 120, d + 12);   // 外側はトラック色
        g.translate(60, 6);
        g.fillStyle = ILL ? '#8fc07a' : '#1f5a28'; g.fillRect(-57.5, -3, 115, d + 6);
        // 芝の刈り模様（5ヤードごとに明暗）
        for (let k = -11; k < 11; k++) { g.fillStyle = ILL ? (k % 2 ? '#8fc07a' : '#9ccb86') : (k % 2 ? '#25652d' : '#2a7133'); g.fillRect(k * 4.572, 0, 4.572, d); }
        g.fillStyle = ILL ? '#82b36f' : '#1c5224'; g.fillRect(-54.86, 0, 9.14, d); g.fillRect(45.72, 0, 9.14, d);
        g.strokeStyle = '#f4f4ee';
        for (let k = -10; k <= 10; k++) { g.lineWidth = k === 0 ? 0.2 : 0.14; g.beginPath(); g.moveTo(k * 4.572, 0); g.lineTo(k * 4.572, d); g.stroke(); }
        g.lineWidth = 0.1;
        for (let x = -45.72; x <= 45.73; x += ydm) for (const z of [d - F.hash * U, F.hash * U]) { g.beginPath(); g.moveTo(x, z - 0.3); g.lineTo(x, z + 0.3); g.stroke(); }
        g.lineWidth = 0.22; g.strokeRect(-54.86, 0, 109.73, d);
        g.fillStyle = 'rgba(255,255,255,.8)'; g.font = 'bold 1.8px sans-serif'; g.textAlign = 'center';
        for (let k = -8; k <= 8; k += 2) { const yl = 50 - Math.abs(k) * 5; g.fillText(String(yl), k * 4.572, d - 8); }
      });
      floorPlane(-60, -d - 6, 60, 6, 0, tex, 0, 0.9);
      // 奥のスタンド（段になった暗い面と、観客のドット）
      const sm = mat(0x2a2d38);
      for (let k = 0; k < 5; k++) backdrop.push(box(130, 1.1, 3.2, sm, 0, 0.55 + k * 1.1, -d - 9 - k * 3.2, scene));
      const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.7, 0.4), new THREE.MeshBasicMaterial({color: 0xffffff}), 900);
      const m4 = new THREE.Matrix4(), cc = new THREE.Color();
      for (let i = 0; i < 900; i++) {
        const k = Math.floor(rnd() * 5);
        m4.makeTranslation((rnd() - 0.5) * 120, 1.45 + k * 1.1, -d - 8.2 - k * 3.2 - rnd() * 1.4); dots.setMatrixAt(i, m4);
        cc.setHSL(rnd(), 0.35, 0.28 + rnd() * 0.12); dots.setColorAt(i, cc);
      }
      scene.add(dots); backdrop.push(dots);
    } else {
      floorPlane(-F.w / 2 - 3, -F.d - 3, F.w / 2 + 3, 3, -0.01, null, 0x3a3a3e);
      floorPlane(-F.w / 2, -F.d, F.w / 2, 0, 0, null, 0x735e4c);
    }
  }
  const walls = [], backdrop = [];
  // ---- 人物（手続き生成の骨格つき人体。assets/human.bin を base64 で埋め込む。形式は tools/README.md）----
  // 全員で形状・マテリアルを共有し、フレームごとの更新は骨の姿勢だけ。
  const H = (() => {
    const b64 = window.JK_HUMAN || '';
    if (b64.length < 100) return null;
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dv = new DataView(bin.buffer);
    if (String.fromCharCode(bin[0], bin[1], bin[2], bin[3]) !== 'JKH1') return null;
    const jl = dv.getUint32(4, true), json = JSON.parse(new TextDecoder().decode(bin.subarray(8, 8 + jl))), base = 8 + jl;
    return {json, buf: bin.buffer, base, f32: (o, n) => new Float32Array(bin.buffer, base + o, n), u8: (o, n) => new Uint8Array(bin.buffer, base + o, n), u16: (o, n) => new Uint16Array(bin.buffer, base + o, n)};
  })();
  const NB = H ? H.json.bones.length : 0, BI = {}, PAR = [];
  if (H) H.json.bones.forEach((b, i) => { BI[b.name] = i; PAR[i] = b.parent; });
  // 小道具ボーンの静止位置（構えのモデル座標 → 実行時の小道具ボーンの変換へ直すのに使う）
  const PROP_REST = [0, 0, 0];
  if (H) for (let k = BI.prop; k >= 0; k = PAR[k]) { const bp = H.json.bones[k].pos; PROP_REST[0] += bp[0]; PROP_REST[1] += bp[1]; PROP_REST[2] += bp[2]; }
  const strikeTbl = kind => (H && H.json.strike && H.json.strike[kind]) || null;

  // 素材: 頂点ごとの素材 ID から色・粗さ・金属感を引く（1つのマテリアル＝1ドローコールで全素材を描く）
  const MATC = [], MATR = [];
  if (H) H.json.materials.forEach(m => {
    const c = new THREE.Color(m.color);
    MATC.push(new THREE.Vector4(c.r, c.g, c.b, m.tint ? 1 : 0)); MATR.push(new THREE.Vector2(m.rough, m.metal));
  });
  // 旗の布の揺れ（頂点シェーダ）: 布の頂点（素材 cloth / cloth2）だけ、ポールからの距離 u に応じて波打たせる。
  // uAct: 0 = 垂れ下がってゆるく揺れる、1 = 回して大きくはためく
  const TIMEU = {value: 0};
  const CLOTH_IDS = H ? new THREE.Vector2(H.json.materials.findIndex(m => m.name === 'cloth'), H.json.materials.findIndex(m => m.name === 'cloth2')) : null;
  const FLAGBOX = new THREE.Vector4(0, 1, 0, 1); // 布の範囲: x の最大（ポール側）・幅・y の最大（上端）・高さ
  // 肌・髪の色の候補（隊員ごとに割り当てる）
  const SKINS = [0xf0c8a4, 0xe2a67e, 0xd2956a, 0xb97a52, 0x8d5a3a].map(c => new THREE.Color(c));
  const HAIRS = [0x2b1d15, 0x15110f, 0x3d2a1c, 0x5a3d25, 0x7a5a38].map(c => new THREE.Color(c));
  const MID = n => H ? H.json.materials.findIndex(m => m.name === n) : -1;
  // イラスト用の素材色・肌・髪（色管理を有効にしたあとで作る＝sRGB の値どおりに出る）。リアルの素材色は従来どおり
  const MATC_I = [], SKINS_I = [], HAIRS_I = [];
  const SLEEVE_PAL = ['#ff5a5f', '#ff9f1c', '#ffd23f', '#7bd62e', '#2ec4b6', '#3a8dff', '#8f5bff', '#ff5dc8', '#00b8d9', '#ef476f', '#06d6a0', '#f77f00'];
  function illTables() {
    if (MATC_I.length || !H) return;
    H.json.materials.forEach(m => { const o = m.ill || {}, c = new THREE.Color(o.color !== undefined ? o.color : m.color), t = o.tint !== undefined ? o.tint : m.tint; MATC_I.push(new THREE.Vector4(c.r, c.g, c.b, t ? 1 : 0)); });
    [0xffe3d0, 0xfcd6bc, 0xf4c6a8, 0xe8b392, 0xcf9672].forEach(c => SKINS_I.push(new THREE.Color(c)));
    [0x2a2430, 0x4a3226, 0x7a4a30, 0xb4693a, 0xe0b36a, 0x2f3f6e, 0x8a3f5c].forEach(c => HAIRS_I.push(new THREE.Color(c)));
  }
  function humanMat(tint, isFlag, skin, hair, ill) {
    const m = ill ? new THREE.MeshToonMaterial({color: 0xffffff, gradientMap: grad()}) : new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0.4});
    const uJ = new THREE.Color(tint), uAct = {value: 0.15}, uSk = skin || SKINS[1], uHr = hair || HAIRS[0];
    m.userData.jacket = uJ; m.userData.act = uAct;
    m.onBeforeCompile = sh => {
      sh.uniforms.uMatC = {value: ill ? MATC_I : MATC}; sh.uniforms.uMatR = {value: MATR}; sh.uniforms.uJacket = {value: uJ};
      sh.uniforms.uSkin = {value: uSk}; sh.uniforms.uHair = {value: uHr}; sh.uniforms.uTime = TIMEU; sh.uniforms.uAct = uAct; sh.uniforms.uFlag = {value: isFlag ? 1 : 0}; sh.uniforms.uClothIds = {value: CLOTH_IDS}; sh.uniforms.uFlagX = {value: FLAGBOX};
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aMat;
varying float vMat;
uniform float uFlag; uniform float uTime; uniform float uAct; uniform vec2 uClothIds; uniform vec4 uFlagX;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vec3 flagD = vec3(0.0);
if (uFlag > 0.5 && (abs(aMat - uClothIds.x) < 0.5 || abs(aMat - uClothIds.y) < 0.5)) {
  float fu = clamp((uFlagX.x - position.x) / uFlagX.y, 0.0, 1.0), fh = clamp((uFlagX.z - position.y) / uFlagX.w, 0.0, 1.0);
  float droop = 1.0 - uAct;
  float ph = fu * 6.5 - uTime * (2.2 + 3.5 * uAct) + fh * 1.8, ph2 = ph * 2.3 + fh * 3.0;
  float amp = (0.03 + 0.12 * uAct) * (0.12 + fu);
  float dz = amp * (sin(ph) + 0.35 * sin(ph2));
  float dzdu = amp * (6.5 * cos(ph) + 0.35 * 2.3 * 6.5 * cos(ph2)), dzdh = amp * (1.8 * cos(ph) + 0.35 * (2.3 * 1.8 + 3.0) * cos(ph2));
  // 垂れ下がり: ポールのほうへ縮み、自由端が下がる
  flagD = vec3(fu * uFlagX.y * 0.5 * droop, -droop * 0.3 * fu * fu * uFlagX.y * (1.0 - 0.5 * fh), dz);
  float s = objectNormal.z < 0.0 ? -1.0 : 1.0;
  objectNormal = normalize(vec3(dzdu / uFlagX.y, dzdh / uFlagX.w, 1.0) * s);
}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += flagD;\nvMat = aMat;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nuniform vec4 uMatC[${MATC.length}];\nuniform vec2 uMatR[${MATC.length}];\nuniform vec3 uJacket;\nuniform vec3 uSkin;\nuniform vec3 uHair;\nvarying float vMat;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
int mi = int(vMat + 0.5);
vec4 mc = uMatC[mi];
diffuseColor.rgb = mc.w > 0.5 ? uJacket : mc.rgb;
if (mi == ${MID('skin')}) diffuseColor.rgb = uSkin; else if (mi == ${MID('hair')}) diffuseColor.rgb = uHair; else if (mi == ${MID('lip')} || mi == ${MID('blush')}) diffuseColor.rgb = mix(uSkin, mc.rgb, 0.5); else if (mi == ${MID('iris')}) diffuseColor.rgb = uJacket * 0.55;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = uMatR[mi].x;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = uMatR[mi].y;')
        .replace('#include <lights_fragment_end>', ill ? '#include <lights_fragment_end>' : '#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= mix(1.0, 2.3, metalnessFactor);');
      // イラスト: やわらかいリムライトと、髪の天使の輪（画面の上向きの面に白い帯）
      if (ill) sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>', `
{
  vec3 vn = normalize(normal);
  float rimv = pow(1.0 - clamp(dot(vn, normalize(vViewPosition)), 0.0, 1.0), 2.6);
  outgoingLight += vec3(1.0, 0.97, 0.92) * rimv * 0.26;
  if (mi == ${MID('hair')}) { float ring = smoothstep(0.50, 0.55, vn.y) * (1.0 - smoothstep(0.64, 0.70, vn.y)); outgoingLight = mix(outgoingLight, vec3(1.0), ring * 0.38); }
}
#include <output_fragment>`);
    };
    m.customProgramCacheKey = () => 'jkhuman' + (ill ? 'T' : 'S');
    return m;
  }
  function geoOf(d, skinned) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(H.f32(d.pos, d.vertices * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(H.f32(d.nor, d.vertices * 3), 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(Float32Array.from(H.u8(d.mat, d.vertices)), 1));
    if (skinned) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(H.u8(d.skinIndex, d.vertices * 4)), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(H.f32(d.skinWeight, d.vertices * 4), 4));
    }
    g.setIndex(new THREE.BufferAttribute(Uint16Array.from(H.u16(d.index, d.indices)), 1));
    g.computeBoundingSphere();
    return g;
  }
  let bodyGeo = null, boneInv = null;
  const instGeos = {};
  // クリップ（ポーズ・歩行）
  const clips = new Map();
  if (H) H.json.clips.forEach(c => { c.data = H.f32(c.off, c.frames * c.bones.length * 7); clips.set(c.name, c); });
  const INST = H ? H.json.instruments : {};
  const _qs = new Float32Array(4);
  // クリップの f フレーム目（小数可）を P / Q へ重み w で混ぜる（w=1 で上書き）
  function sample(c, f, loop, P, Q, w) {
    const n = c.frames, nbn = c.bones.length, st = nbn * 7, d = c.data;
    let i0 = Math.floor(f), t = f - i0, i1 = i0 + 1;
    if (loop) { i0 = ((i0 % n) + n) % n; i1 = ((i1 % n) + n) % n; } else { i0 = Math.min(n - 1, Math.max(0, i0)); i1 = Math.min(n - 1, Math.max(0, i1)); }
    for (let k = 0; k < nbn; k++) {
      const b = c.bones[k], o0 = i0 * st + k * 7, o1 = i1 * st + k * 7;
      for (let j = 0; j < 3; j++) { const v = d[o0 + j] + (d[o1 + j] - d[o0 + j]) * t; P[b * 3 + j] = w >= 1 ? v : P[b * 3 + j] + (v - P[b * 3 + j]) * w; }
      if (w >= 1) THREE.Quaternion.slerpFlat(Q, b * 4, d, o0 + 3, d, o1 + 3, t);
      else { THREE.Quaternion.slerpFlat(_qs, 0, d, o0 + 3, d, o1 + 3, t); THREE.Quaternion.slerpFlat(Q, b * 4, Q, b * 4, _qs, 0, w); }
    }
  }
  const matCache = new Map();
  // 上着の色 × 肌 × 髪 の組み合わせごとに1つ（プログラムは共有されるので軽い）
  function matFor(color, si, hi, ill) {
    const k = color + '|' + si + '|' + hi + (ill ? '|I' : '');
    if (!matCache.has(k)) matCache.set(k, humanMat(color, false, ill ? SKINS_I[si] : SKINS[si], ill ? HAIRS_I[hi] : HAIRS[hi], ill));
    return matCache.get(k);
  }
  // 輪郭線（裏向きの膨らませた殻）。厚みはカメラからの距離に比例させ、画面上でほぼ一定の太さにする
  const olMats = {};
  function outlineMat(k = 1) {
    if (olMats[k]) return olMats[k];
    const m = olMats[k] = new THREE.MeshBasicMaterial({color: 0x1b1520, side: THREE.BackSide});
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
{ float dd = length(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
  transformed += normalize(normal) * clamp(dd * 0.0020, 0.0026, 0.028) * ${k.toFixed(2)}; }`);
    };
    m.customProgramCacheKey = () => 'jkoutline' + k;
    return m;
  }
  let illGeo = null, illOutGeo = null;
  // 輪郭線に使わない面（顔の細かい部品。殻にすると黒くつぶれる）を除いた体の形
  function outlineGeoOf(g) {
    const skip = new Set(['eyew', 'iris', 'eye', 'blush', 'mouth', 'lip'].map(MID)), am = g.getAttribute('aMat'), ix = g.getIndex().array, keep = [];
    for (let i = 0; i < ix.length; i += 3) if (!skip.has(am.array[ix[i]])) keep.push(ix[i], ix[i + 1], ix[i + 2]);
    const og = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'skinIndex', 'skinWeight']) og.setAttribute(n, g.getAttribute(n));
    og.setIndex(new THREE.BufferAttribute(Uint16Array.from(keep), 1)); og.computeBoundingSphere();
    return og;
  }

  function figure(sec, idx, mi, mn) {
    const kind = meshOf(sec.instrument, mi, mn);
    const fam = jkStrikeFam(kind), o = {kind, fam, strk: fam ? jkStrokes(jkNotesFor(D, idx), kind, 60 / D.tempo, strikeTbl(kind)) : null, tbl: strikeTbl(kind), P: new Float32Array(NB * 3), Qa: new Float32Array(NB * 4), tmpP: new Float32Array(NB * 3), tmpQ: new Float32Array(NB * 4), wk: 0, lastT: -1e9, upKey: '', tr: 1, upP: new Float32Array(NB * 3), upQ: new Float32Array(NB * 4)};
    const g = new THREE.Group();
    o.g = g;
    if (!H) { scene.add(g); return o; }
    if (!bodyGeo) {
      bodyGeo = geoOf(H.json.body, true);
      boneInv = H.json.bones.map(b => { const w = new THREE.Vector3(); let k = b; const p = [0, 0, 0]; while (k) { p[0] += k.pos[0]; p[1] += k.pos[1]; p[2] += k.pos[2]; k = k.parent >= 0 ? H.json.bones[k.parent] : null; } return new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]); });
    }
    const ill = ILL && !!H.json.illust;
    if (ill) { illTables(); if (!illGeo) illGeo = geoOf(H.json.illust.body, true); }
    const hs = ((idx * 2654435761) >>> 7) >>> 0, si = hs % 5, hi = ((hs >>> 5) * 7 + idx) % (ill ? 7 : 5);
    // イラスト: 色スリーブは section に color があればその色、なければ隊員ごとに明るい色を割り当てる
    const tintC = ill ? (sec.color_given ? sec.color : SLEEVE_PAL[idx % SLEEVE_PAL.length]) : sec.color;
    const mt = matFor(tintC, si, hi, ill);
    const bones = H.json.bones.map(b => { const bn = new THREE.Bone(); bn.name = b.name; bn.position.set(...b.pos); return bn; });
    H.json.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
    const skel = new THREE.Skeleton(bones, boneInv);
    const mesh = new THREE.SkinnedMesh(ill ? illGeo : bodyGeo, mt);
    mesh.add(bones[0]); mesh.bind(skel, new THREE.Matrix4());
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    g.add(mesh);
    // 輪郭線: 同じ骨格で動く殻 / 剛体メッシュ（髪・楽器・スティック）には同じ形の殻を付ける
    const outline = (geo, parent, k) => { const m = new THREE.Mesh(geo, outlineMat(k)); m.frustumCulled = false; parent.add(m); return m; };
    if (ill) { if (!illOutGeo) illOutGeo = outlineGeoOf(illGeo); const om = new THREE.SkinnedMesh(illOutGeo, outlineMat()); om.bind(skel, new THREE.Matrix4()); om.frustumCulled = false; g.add(om); }
    if (ill && H.json.illust.hairs.length) { // 髪
      const hn = H.json.illust.hairs[(idx * 7 + (hs >>> 11)) % H.json.illust.hairs.length], hin = INST[hn];
      if (!instGeos[hn]) instGeos[hn] = geoOf(hin, false);
      const hm = new THREE.Mesh(instGeos[hn], mt); hm.castShadow = true; hm.receiveShadow = true; hm.frustumCulled = false;
      bones[BI.head].add(hm); outline(instGeos[hn], bones[BI.head], 0.55);
    }
    o.bones = bones; o.mesh = mesh;
    const ins = INST[kind];
    if (ins) {
      if (!instGeos[kind]) {
        instGeos[kind] = geoOf(ins, false);
        if (kind === 'guard') { // 旗の布の範囲を頂点から求める（シェーダの u, h の正規化に使う）
          const pos = H.f32(ins.pos, ins.vertices * 3), mm = H.u8(ins.mat, ins.vertices);
          let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
          for (let i = 0; i < ins.vertices; i++) if (mm[i] === CLOTH_IDS.x || mm[i] === CLOTH_IDS.y) { x0 = Math.min(x0, pos[i * 3]); x1 = Math.max(x1, pos[i * 3]); y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
          FLAGBOX.set(x1, Math.max(0.01, x1 - x0), y1, Math.max(0.01, y1 - y0));
        }
      }
      // 旗は1本ごとに材質を分ける（はためきの強さが旗ごとに違うため。プログラムは共有される）
      if (kind === 'guard') { o.flagMat = humanMat(tintC, true, ill ? SKINS_I[si] : SKINS[si], ill ? HAIRS_I[hi] : HAIRS[hi], ill); }
      const im = new THREE.Mesh(instGeos[kind], o.flagMat || mt);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      im.position.set(...ins.attach.pos); im.quaternion.set(...ins.attach.quat);
      bones[BI[ins.attach.bone]].add(im);
      o.inst = im;
      if (ill && kind !== 'guard') outline(instGeos[kind], bones[BI[ins.attach.bone]]).position.set(...ins.attach.pos);
    }
    // 手に付く部品（スティック・マレット・シンバルの板）: 楽器名 + "+R" / "+L"。手のボーンに付ける
    for (const sfx of ['+R', '+L']) {
      const pi = INST[kind + sfx];
      if (!pi) continue;
      const pk = kind + sfx;
      if (!instGeos[pk]) instGeos[pk] = geoOf(pi, false);
      const pm = new THREE.Mesh(instGeos[pk], mt);
      pm.castShadow = true; pm.receiveShadow = true; pm.frustumCulled = false;
      pm.position.set(...pi.attach.pos); pm.quaternion.set(...pi.attach.quat);
      bones[BI[pi.attach.bone]].add(pm);
      if (ill) outline(instGeos[pk], bones[BI[pi.attach.bone]], 0.6);
    }
    // 体格を少しだけ変える（見た目の単調さを減らす）
    const h = ((idx * 2654435761) >>> 0) / 4294967296, h2 = ((idx * 40503 + 7) * 2246822519 >>> 0) / 4294967296;
    o.sc = 0.95 + 0.1 * h; o.wid = 0.96 + 0.08 * h2;
    g.scale.set(o.sc * o.wid, o.sc, o.sc * o.wid);
    scene.add(g);
    return o;
  }

  // 歩行・姿勢・小道具の保持から、1人ぶんの骨の姿勢を決める
  const STRIDES = H ? H.json.strides : [0];
  const sstep = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  function walkSample(type, speed, phase, P, Q) {
    const nm = a => `walk/${type}/${a}`;
    let s = Math.min(STRIDES[STRIDES.length - 1], Math.max(0, speed)), i = 0;
    while (i < STRIDES.length - 2 && s > STRIDES[i + 1]) i++;
    const a = STRIDES[i], b = STRIDES[i + 1], k = (s - a) / (b - a || 1);
    const ca = clips.get(nm(a)), cb = clips.get(nm(b)), f = (((phase / 2) % 1) + 1) % 1 * ca.frames;
    sample(ca, f, true, P, Q, 1);
    if (k > 0.001) sample(cb, f, true, P, Q, k);
  }
  const qYaw = new THREE.Quaternion(), _qq = new THREE.Quaternion();
  function pose(o, st, t) {
    if (!H) return;
    const P = o.P, Q = o.Qa, dt = Math.abs(t - o.lastT), jump = dt > 1.5;
    o.lastT = t;
    // ---- 下半身（歩き・足踏み・姿勢）----
    const walking = st.moving || st.mark;
    o.wk += ((walking ? 1 : 0) - o.wk) * (jump ? 1 : Math.min(1, dt * 5));
    let type = st.step === 'high' ? 'high' : st.step === 'jazz' ? 'jazz' : st.step === 'back' ? 'back' : 'glide';
    // 体の向きに対する進行方向で脚の動きを選ぶ（体は正面のまま横へ進むなら横歩き、後ろ向きに進むならバック）
    if (st.moving) {
      const fa = jkFacing(st) * Math.PI / 180, fx = Math.cos(fa), fy = Math.sin(fa), dl = Math.hypot(st.dir[0], st.dir[1]) || 1;
      const lf = (st.dir[0] * fx + st.dir[1] * fy) / dl, ll = (-st.dir[0] * fy + st.dir[1] * fx) / dl; // 前方・左方向の成分
      if (Math.abs(ll) > Math.abs(lf) * 0.8) type = ll > 0 ? 'slideL' : 'slideR';
      else if (lf < 0) type = 'back';
      else if (type === 'back') type = 'glide';
    }
    if (!clips.has(`walk/${type}/0`)) type = 'glide'; // 古いアセット（横歩きなし）でも動くように
    sample(clips.get('stance/attention'), 0, false, P, Q, 1);
    if (o.wk > 0.001) {
      const tp = o.tmpP, tq = o.tmpQ;
      const speed = st.moving ? Math.hypot(st.dir[0], st.dir[1]) * U / 0.1 : 0;
      tp.set(P); tq.set(Q);
      walkSample(type, speed, st.phase, tp, tq);
      // 歩行クリップを下半身ボーンにだけ混ぜる
      const c = clips.get('walk/glide/0');
      for (const b of c.bones) {
        for (let j = 0; j < 3; j++) P[b * 3 + j] += (tp[b * 3 + j] - P[b * 3 + j]) * o.wk;
        THREE.Quaternion.slerpFlat(Q, b * 4, Q, b * 4, tq, b * 4, o.wk);
      }
    }
    const pb = Math.min(1, Math.max(0, st.poseBlend || 0));
    if (pb > 0 && st.pose && clips.has('stance/' + st.pose)) sample(clips.get('stance/' + st.pose), 0, false, P, Q, pb);
    // ---- 上半身（楽器を構える・休め・アクション）----
    const kind = o.kind, has = !!(INST[kind] || INST[kind + '+R'] || INST[kind + '+L']);
    if (o.flagMat) { // 旗のはためき: 動作中は強く、レストはほぼ垂れる
      const tg = (st.action === 'spin' || st.action === 'swing' || st.action === 'toss') ? 1 : st.action === 'rest' ? 0.08 : st.moving ? 0.5 : 0.2, a = o.flagMat.userData.act;
      a.value += (tg - a.value) * (jump ? 1 : Math.min(1, dt * 4));
    }
    const holdN = kind === 'guard' ? 'guard/hold' : has ? 'hold/' + kind : 'idle';
    const carryN = kind === 'guard' ? 'guard/carry' : has ? 'carry/' + kind : 'behind';
    let a = holdN, fa = 0, loopA = false, b = null, wb = 0, yaw = 0, key = holdN;
    const act = st.action;
    if (act === 'rest') { a = carryN; key = 'carry'; }
    else if (act && kind === 'guard' && clips.has('guard/' + act)) {
      const c = clips.get('guard/' + act); a = 'guard/' + act; loopA = true; fa = (((t / c.counts) % 1) + 1) % 1 * c.frames; key = a;
    } else if (act === 'toss' && has) {
      const k = Math.max(0, Math.sin(2 * Math.PI * t / 4)); b = 'up/' + kind; wb = k;
    } else if (act === 'spin' && kind !== 'guard') yaw = 0.55 * Math.sin(Math.PI * t);
    else if (act === 'swing' && kind !== 'guard') yaw = 0.5 * Math.sin(Math.PI * t);
    if (!act && st.pose === 'rest' && pb > 0) { b = carryN; wb = pb; }
    // 楽器の構え（右手・左手・正面・斜め）。演奏の構え（hold）のときだけ差し替え、前の構えから carryBlend でなめらかに
    const styleN = c => { const n = 'style/' + (c || 'play') + '/' + (kind === 'guard' ? 'guard' : kind); return c && c !== 'play' && (kind === 'guard' || has) && clips.has(n) ? n : holdN; };
    let styleTo = null;
    if (a === holdN) { a = styleN(st.carryFrom); const to = styleN(st.carry); if (to !== a) styleTo = to; }
    // 上半身ボーンへ書く（切り替え時は前の姿勢からなめらかに）
    if (!clips.has(a)) a = 'idle';
    const cur = o.tmpP, curq = o.tmpQ;
    sample(clips.get(a), fa, loopA, cur, curq, 1);
    if (styleTo) sample(clips.get(styleTo), 0, false, cur, curq, Math.min(1, Math.max(0, st.carryBlend == null ? 1 : st.carryBlend)));
    if (b && clips.has(b)) sample(clips.get(b), 0, false, cur, curq, wb);
    if (key !== o.upKey && !jump) { o.upP.set(o.lastUpP || cur); o.upQ.set(o.lastUpQ || curq); o.tr = 0; }
    o.upKey = key;
    o.tr = jump ? 1 : Math.min(1, o.tr + dt / 0.5);
    const w = sstep(o.tr);
    const ubones = H.json.groups.upper.map(n => BI[n]);
    for (const bI of ubones) {
      for (let j = 0; j < 3; j++) P[bI * 3 + j] = o.tr < 1 ? o.upP[bI * 3 + j] + (cur[bI * 3 + j] - o.upP[bI * 3 + j]) * w : cur[bI * 3 + j];
      if (o.tr < 1) THREE.Quaternion.slerpFlat(Q, bI * 4, o.upQ, bI * 4, curq, bI * 4, w);
      else for (let j = 0; j < 4; j++) Q[bI * 4 + j] = curq[bI * 4 + j];
    }
    o.lastUpP = o.lastUpP || new Float32Array(NB * 3); o.lastUpQ = o.lastUpQ || new Float32Array(NB * 4);
    o.lastUpP.set(P); o.lastUpQ.set(Q);
    // 楽譜どおりに打つ（演奏の構えのときだけ。構えの切り替え中・休めでは弱める）
    if (o.strk && !act) {
      const spc = 60 / jkTempoAt(D, t), tof = c => (c || 'play') === 'play' ? 1 : 0, cb = st.carryBlend == null ? 1 : st.carryBlend;
      const amt = tof(st.carryFrom) + (tof(st.carry) - tof(st.carryFrom)) * cb;
      const sst = jkStrikeState(o.strk, o.fam, t, spc, o.tbl);
      if (o.strk.ik) jkStrikeIK(P, Q, PAR, BI, PROP_REST, o.fam, o.tbl, sst, amt * (1 - pb));
      else jkStrikeApply(Q, PAR, BI, o.fam, sst, amt * (1 - pb));
    }
    if (yaw) { const i = BI.chest * 4; _qq.set(Q[i], Q[i + 1], Q[i + 2], Q[i + 3]); qYaw.setFromAxisAngle(_ay, yaw); qYaw.multiply(_qq); Q[i] = qYaw.x; Q[i + 1] = qYaw.y; Q[i + 2] = qYaw.z; Q[i + 3] = qYaw.w; }
    for (let i = 0; i < NB; i++) { o.bones[i].position.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); o.bones[i].quaternion.set(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]); }
  }
  const _ay = new THREE.Vector3(0, 1, 0);

  // 反射用の環境マップ（グラデーションの空＋ソフトボックスを PMREM にする。RoomEnvironment は UMD 版にないので自前）
  function makeEnv() {
    const es = new THREE.Scene();
    const geo = new THREE.BoxGeometry(80, 40, 80), pos = geo.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 20, k = Math.min(1, Math.max(0, (y + 1) / 2));
      const c = new THREE.Color().setRGB(0.07 + 0.30 * k * k, 0.08 + 0.34 * k * k, 0.10 + 0.44 * k * k);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    es.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide})));
    const panel = (w, h, x, y, z, rx, ry, c) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: new THREE.Color(c, c, c * 0.95), side: THREE.DoubleSide}));
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0); es.add(m);
    };
    panel(30, 14, 0, 19, 0, Math.PI / 2, 0, 6.0);           // 天井の大きな面光源
    panel(14, 5, -26, 12, 18, 0, Math.PI / 2.6, 4.0);        // 斜め前の窓
    panel(10, 4, 28, 9, -8, 0, -Math.PI / 2, 2.5);           // 横のストリップ
    panel(26, 3, 0, 4, -36, 0, 0, 1.6);                      // 奥
    const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(es, 0.03);
    pm.dispose();
    return rt.texture;
  }
  function ring(color) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 28), new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.9}));
    r.rotation.x = -Math.PI / 2; r.position.y = 0.01; r.visible = false; scene.add(r); return r;
  }

  // シーン（会場・照明・人物）を作る。見た目を切り替えたときにも作り直す
  function buildScene() {
    walls.length = 0; backdrop.length = 0; ringFlag = [];
    renderer.toneMapping = ILL ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.72;
    scene = new THREE.Scene();
    const bgc = ILL ? (F.type === 'football' ? 0xdbe9f3 : F.type === 'stage' ? 0xcfd0dc : 0xe2e8ee) : (F.type === 'football' ? 0x1b2438 : F.type === 'stage' ? 0x0c0d12 : 0x15171c);
    scene.background = new THREE.Color(bgc);
    { const Bf = bounds(), R = Math.max(Bf.hw, Bf.hd); scene.fog = new THREE.Fog(ILL ? bgc : F.type === 'football' ? 0x26324c : F.type === 'stage' ? 0x14151c : 0x2a2b31, R * (ILL ? 2.5 : 1.5), R * (ILL ? 7 : 5.5)); }
    scene.environment = ILL ? null : makeEnv();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
    scene.add(ILL ? new THREE.HemisphereLight(0xffffff, 0xd2d6dc, 0.56) : new THREE.HemisphereLight(0xfff2e6, 0x6f5d4a, 0.42));
    const B = bounds();
    const sun = new THREE.DirectionalLight(ILL ? 0xfffaf0 : 0xfff0dc, ILL ? 0.62 : 1.55);
    sun.position.set(B.cx - B.hw * 0.4, 40, B.cz + B.hd * 0.8); sun.target.position.set(B.cx, 0, B.cz);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    const sc = sun.shadow.camera, ext = Math.max(B.hw, B.hd) * 1.15;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 130;
    const fill = new THREE.DirectionalLight(0xe8eeff, ILL ? 0 : 0.45); fill.position.set(B.cx + B.hw * 0.8, 20, B.cz - B.hd * 0.6); fill.target.position.set(B.cx, 0, B.cz);
    scene.add(sun, sun.target, fill, fill.target);
    buildVenue();
    const secN = D.sections.map(() => 0), secCnt = D.sections.map(() => 0);
    D.performers.forEach(p => secN[p.sec]++);
    people = D.performers.map((p, i) => figure(D.sections[p.sec], i, secCnt[p.sec]++, secN[p.sec]));
    window.jk3d = {renderer, scene, sun, fill, camera, people, render: () => render3d()};
    ringSel = ring(0xffd23f);
  }
  function init() {
    if (THREE.ColorManagement) { if ('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false; else THREE.ColorManagement.enabled = true; }
    renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = 'srgb'; else renderer.outputEncoding = THREE.sRGBEncoding;
    wrap.appendChild(renderer.domElement);
    buildScene();
    const B = bounds();
    orbit.target.set(B.cx, 0, B.cz); orbit.r = Math.max(B.hw, B.hd) * 2; orbit.phi = 1.0;
    resize();
    // マウス操作（ドラッグで回転・ホイールで拡大縮小）→ 自由カメラになる
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY}; renderer.domElement.setPointerCapture(e.pointerId); });
    renderer.domElement.addEventListener('pointermove', e => {
      if (!drag || layout === 'reel') return;
      if (camMode !== 'free') { syncOrbitFromCamera(); setCam('free'); }
      orbit.theta -= (e.clientX - drag.x) * 0.006; orbit.phi = Math.min(1.52, Math.max(0.08, orbit.phi - (e.clientY - drag.y) * 0.006));
      drag = {x: e.clientX, y: e.clientY}; render3d();
    });
    renderer.domElement.addEventListener('pointerup', () => drag = null);
    renderer.domElement.addEventListener('wheel', e => {
      e.preventDefault();
      if (layout === 'reel') return;
      if (camMode !== 'free') { syncOrbitFromCamera(); setCam('free'); }
      orbit.r = Math.min(300, Math.max(3, orbit.r * (1 + e.deltaY * 0.001))); render3d();
    }, {passive: false});
    window.addEventListener('resize', () => { if (renderer) { resize(); render3d(); } });
  }
  function syncOrbitFromCamera() {
    const v = camera.position.clone().sub(orbit.target);
    orbit.r = v.length(); orbit.phi = Math.acos(Math.min(1, v.y / orbit.r)); orbit.theta = Math.atan2(v.x, v.z);
  }
  function setCam(m) { camMode = m; document.getElementById('cam3d').value = m; }
  function resize() {
    if (layout === 'reel') { layoutReel(); return; }
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function placeCamera() {
    const B = bounds(), size = Math.max(B.hw * 2, B.hd * 3.2);
    const at = (e, tg, fov) => { camera.position.set(...e); camera.lookAt(...tg); camera.fov = fov; camera.up.set(0, 1, 0); camera.updateProjectionMatrix(); };
    if (camMode === 'audience') {
      if (F.type === 'stage') at([0, 9.5, B.hw * 1.25], [0, 2.2, B.cz * 0.85], 40);
      else if (F.type === 'gym') { const dd = Math.max(F.w, F.d); at([0, dd * 0.45, dd], [0, 0, -dd * 0.06], 46); }
      else at([B.cx, size * 0.42, B.cz + B.hd + size * 0.38], [B.cx, 0, B.cz - B.hd * 0.08], 42);
    } else if (camMode === 'top') {
      camera.up.set(0, 0, -1); camera.position.set(B.cx, size * 1.05, B.cz + 0.001); camera.lookAt(B.cx, 0, B.cz); camera.fov = 45; camera.updateProjectionMatrix();
    } else if (camMode === 'orbit') {
      const a = Math.sin(performance.now() / 1000 * 0.25) * 1.05, r = Math.max(B.hw, B.hd) * 1.7;
      at([B.cx + r * Math.sin(a), r * 0.45, B.cz + r * Math.cos(a)], [B.cx, 0, B.cz], 42);
    } else if (camMode === 'zoom') {
      const o = people[zoom.idx], ang = o.g.rotation.y + zoom.ang * Math.PI / 180, tgt = [o.g.position.x, zoom.h, o.g.position.z];
      at([tgt[0] + zoom.d * Math.sin(ang), zoom.h + zoom.d * zoom.el, tgt[2] + zoom.d * Math.cos(ang)], tgt, zoom.fov);
    } else if (camMode === 'low') {
      at([B.cx, F.type === 'stage' ? 1.0 : 2.2, B.cz + B.hd + (F.type === 'stage' ? 6 : 3)], [B.cx, 1, B.cz], 55);
    } else {
      const o = orbit, s = Math.sin(o.phi);
      at([o.target.x + o.r * s * Math.sin(o.theta), o.target.y + o.r * Math.cos(o.phi), o.target.z + o.r * s * Math.cos(o.theta)], [o.target.x, o.target.y, o.target.z], 42);
    }
    const side = camMode === 'audience' || camMode === 'low';
    walls.forEach(w => w.visible = side);
  }

  function render3d() {
    if (!renderer || !on) return;
    TIMEU.value = t * 0.5;
    for (let i = 0; i < people.length; i++) {
      const st = jkState(D, i, t), [x, z] = W(st.p[0], st.p[1]), o = people[i];
      o.g.position.set(x, 0, z);
      const fa = jkFacing(st) * Math.PI / 180;
      o.g.rotation.y = Math.atan2(Math.cos(fa), -Math.sin(fa));
      pose(o, st, t);
    }
    ringSel.visible = sel >= 0;
    if (sel >= 0) ringSel.position.set(people[sel].g.position.x, 0.012, people[sel].g.position.z);
    while (ringFlag.length < flagged.length) ringFlag.push(ring(0xff5555));
    ringFlag.forEach((r, j) => { r.visible = j < flagged.length; if (r.visible) r.position.set(people[flagged[j]].g.position.x, 0.012, people[flagged[j]].g.position.z); });
    if (layout === 'reel') { renderReel(); if (recorder) drawRecFrame(); return; }
    placeCamera();
    renderer.render(scene, camera);
    if (recorder) drawRecFrame();
  }

  // ---- 縦分割レイアウト（1080×1920 の 9:16 を 4 段に: 斜め俯瞰の3D / パート名と楽譜 / 客席側の3D / 真上のグリッド）----
  // 3D は 1 つのキャンバスに 2 つのビューポートで描き、楽譜（jkStaff）とグリッド（jkReel.drawGrid）は上に重ねる
  let layout = new URLSearchParams(location.hash.slice(1)).get('layout') === 'reel' ? 'reel' : 'single';
  const RW = 1080, RH = 1920;
  const reel = {ui: null, R: null, pr: 0, scoreImages: new Map()};
  const reelZoom = () => +(document.getElementById('reelzoom')?.value || 1);
  const reelGridOpts = () => ({
    mode: document.getElementById('reelgridmode')?.value || 'all',
    pinSize: +(document.getElementById('reelpin')?.value || 1.25),
  });
  const reelPart = () => { const ps = D.parts || []; if (!ps.length) return null; const sel = document.getElementById('partsel'); return ps[(sel && +sel.value) || 0] || ps[0]; };
  const REEL_PAL = {fg: '#14161c', mu: '#80869a', hi: '#e25214'};
  const staffH = () => { const bh = jkReel.layout(RH)[1][1]; return Math.round(bh * 0.68); };
  function reelUI() {
    if (reel.ui) return reel.ui;
    const mk = (tag, css, parent) => { const e = document.createElement(tag); e.style.cssText = 'position:absolute;' + css; (parent || wrap).appendChild(e); return e; };
    const ui = {};
    ui.band = mk('div', 'background:#fff;overflow:hidden;display:none');
    ui.title = mk('div', 'left:0;right:0;text-align:center;font-weight:800;color:#14161c;font-family:"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP",sans-serif;white-space:nowrap;letter-spacing:.04em', ui.band);
    ui.svg = mk('div', 'left:0;right:0', ui.band);
    ui.gridc = mk('canvas', 'display:none');
    ui.gridc.width = RW; ui.gridc.height = jkReel.layout(RH)[3][1];
    ui.sep = [1, 2, 3].map(() => mk('div', 'height:2px;background:#0a0b0e;display:none'));
    return reel.ui = ui;
  }
  // キャンバスの外形（CSS ピクセル）。録画中は 1080×1920 の画素になるよう pixelRatio を合わせる
  function layoutReel(rec) {
    const ui = reelUI(), ww = wrap.clientWidth, wh = wrap.clientHeight;
    const W = Math.floor(Math.min(ww, wh * 9 / 16) / 9) * 9, H = W * 16 / 9, x = Math.round((ww - W) / 2), y = Math.round((wh - H) / 2), sc = W / RW;   // 整数の大きさ・位置に（小数だと合成でにじむ）
    reel.R = {x, y, W, H, sc};
    renderer.setPixelRatio(rec || recorder ? RW / W : Math.min(2, window.devicePixelRatio));
    renderer.setSize(W, H);
    const c = renderer.domElement;
    c.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${W}px;height:${H}px;cursor:default`;
    const L = jkReel.layout(RH);
    const px = (v) => v * sc + 'px';
    Object.assign(ui.band.style, {left: x + 'px', top: y + L[1][0] * sc + 'px', width: W + 'px', height: px(L[1][1]), display: ''});
    ui.title.style.top = px(L[1][1] * 0.15 - 30); ui.title.style.fontSize = px(RH / 36); ui.title.style.lineHeight = px(60);
    ui.svg.style.top = px(L[1][1] * 0.3); ui.svg.style.height = px(staffH());
    Object.assign(ui.gridc.style, {left: x + 'px', top: y + L[3][0] * sc + 'px', width: W + 'px', height: px(L[3][1]), display: ''});
    ui.sep.forEach((e, i) => Object.assign(e.style, {left: x + 'px', width: W + 'px', top: y + L[i + 1][0] * sc - 1 + 'px', display: ''}));
  }
  function setLayout(l) {
    layout = l;
    const sel = document.getElementById('layout3d'); if (sel) sel.value = l;
    wrap.style.background = l === 'reel' ? '#000' : '';
    if (l === 'reel') { if (renderer) { layoutReel(); } }
    else {
      if (reel.ui) { reel.ui.band.style.display = reel.ui.gridc.style.display = 'none'; reel.ui.sep.forEach(e => e.style.display = 'none'); }
      if (renderer) { renderer.domElement.style.cssText = ''; renderer.setPixelRatio(Math.min(2, window.devicePixelRatio)); resize(); }
    }
    const cs = document.getElementById('cam3d'); if (cs) cs.disabled = l === 'reel';
    const rc = document.getElementById('reelcontrols');
    if (rc) rc.style.display = on && l === 'reel' ? 'flex' : 'none';
    if (renderer) render3d();
  }
  function reelCamera(kind, aspect) {
    const c = kind === 'diag' ? jkReel.diag(D, t, aspect, reelZoom()) : jkReel.front(D, t, aspect, reelZoom());
    camera.up.set(0, 1, 0); camera.fov = c.fov; camera.aspect = aspect;
    camera.position.set(...c.eye); camera.lookAt(...c.target); camera.updateProjectionMatrix();
  }
  function renderReel() {
    if (!reel.R) layoutReel();
    const {W, H, sc} = reel.R, L = jkReel.layout(RH);
    renderer.setScissorTest(true);
    for (const [kind, [y0, h0]] of [['diag', L[0]], ['front', L[2]]]) {
      const top = y0 * sc, hp = h0 * sc;
      renderer.setViewport(0, H - top - hp, W, hp); renderer.setScissor(0, H - top - hp, W, hp);
      reelCamera(kind, W / hp);
      const back = kind === 'front';
      walls.forEach(w => w.visible = back); backdrop.forEach(o => o.visible = back);
      renderer.render(scene, camera);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    updateReelUI();
  }
  function updateReelUI() {
    const ui = reelUI(), p = reelPart();
    ui.title.textContent = p ? p.name : D.name;
    if (p) {
      const [from, to] = jkStaff.page(p, t);
      ui.svg.innerHTML = jkStaff(p, from, to, RW, staffH(), t >= from ? t : null, {...REEL_PAL, paged: true}).replace(/^<svg [^>]*>/, m => m.replace(/ (width|height)="[\d.]+"/g, '').replace('<svg ', '<svg style="width:100%;height:100%;display:block" '));
    } else ui.svg.innerHTML = '';
    jkReel.drawGrid(ui.gridc.getContext('2d'), RW, ui.gridc.height, D, t, ILL, reelGridOpts());
    if (p) {
      const [from, to] = jkStaff.page(p, t);
      requestScoreImage(p, from, to);
    }
  }

  // 録画の楽譜ページは独立してキャッシュする。読み込み途中に前の小節を残さない。
  function requestScoreImage(p, from, to) {
    const key = `${D.parts.indexOf(p)}:${from}:${to}`;
    let entry = reel.scoreImages.get(key);
    if (entry) return entry;
    entry = {img: null, ready: null};
    reel.scoreImages.set(key, entry);
    const svg = jkStaff(p, from, to, RW, staffH(), null,
      {...REEL_PAL, paged: true, noPlayhead: true}).replace('>', `><style>${jkStaffFontCss()}</style>`);
    entry.ready = new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { entry.img = im; resolve(true); };
      im.onerror = () => resolve(false);
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    return entry;
  }

  // ---- 録画（WebGLの画面＋テロップを合成して WebM に）----
  function hudText() {
    const k = setAt(t), s = D.sets[k], into = t - s.start;
    let ph;
    if (k === 0) ph = s.hold > 0 ? `ホールド ${Math.min(s.hold, Math.floor(t) + 1)}/${s.hold}` : '開始位置';
    else if (into < s.counts - 1e-9) ph = `移動 ${Math.min(s.counts, Math.floor(into) + 1)}/${s.counts}`;
    else ph = s.hold > 0 ? `ホールド ${Math.min(s.hold, Math.floor(into - s.counts) + 1)}/${s.hold}` : '到着';
    return `セット ${s.name}　${ph}　通算 ${Math.floor(t)}`;
  }
  // 縦分割の録画フレーム: 3D は WebGL の画面、楽譜（SVG を画像にしたもの + 再生位置の線）とグリッドは 2D で重ねる
  function drawReelRec(g) {
    const L = jkReel.layout(RH), p = reelPart();
    g.drawImage(renderer.domElement, 0, 0, RW, RH);
    g.fillStyle = '#fff'; g.fillRect(0, L[1][0], RW, L[1][1]);
    if (p) {
      g.fillStyle = REEL_PAL.fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 ${Math.round(RH / 36)}px "Hiragino Sans","Noto Sans JP","Noto Sans CJK JP",sans-serif`;
      g.fillText(p.name, RW / 2, L[1][0] + L[1][1] * 0.15);
      const [from, to] = jkStaff.page(p, t), sh = staffH(), y0 = L[1][0] + L[1][1] * 0.3;
      const score = requestScoreImage(p, from, to);
      if (score.img) g.drawImage(score.img, 0, y0, RW, sh);
      if (t >= from && t <= to) {
        const {sp, x0, x1} = jkStaff.geom(p, RW, sh, {paged: true}), x = x0 + (t - from) / (to - from) * (x1 - x0);
        g.fillStyle = REEL_PAL.hi; g.fillRect(x - sp * 0.11, y0 + sp * 0.3, sp * 0.22, sh - sp * 0.6);
      }
    }
    g.fillStyle = '#0a0b0e'; for (const i of [1, 2, 3]) g.fillRect(0, L[i][0] - 1, RW, 2);
    // プレビューと全く同じグリッドを使う（二重描画を避け、フレーム生成を軽くする）。
    g.drawImage(reelUI().gridc, 0, L[3][0], RW, L[3][1]);
  }
  function drawRecFrame() {
    const g = recCanvas.getContext('2d'), c = renderer.domElement;
    if (layout === 'reel') { drawReelRec(g); return; }
    g.drawImage(c, 0, 0, recCanvas.width, recCanvas.height);
    const fs = Math.round(recCanvas.height / 30);
    g.font = `600 ${fs}px "Hiragino Sans","Noto Sans JP",sans-serif`;
    const txt = hudText(), title = D.name;
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillRect(fs * 0.6, recCanvas.height - fs * 2.4, g.measureText(txt).width + fs * 1.2, fs * 1.7);
    g.fillRect(fs * 0.6, fs * 0.6, g.measureText(title).width + fs * 1.2, fs * 1.7);
    g.fillStyle = '#ffd23f'; g.fillText(txt, fs * 1.2, recCanvas.height - fs * 1.05);
    g.fillStyle = '#fff'; g.fillText(title, fs * 1.2, fs * 1.85);
  }
  const hasPartsAudio = () => !!(D.parts && D.parts.some(p => p.notes.length)) && typeof jkAudio !== 'undefined';
  let recordPreparing = false;
  async function startRecording() {
    if (recorder || recordPreparing) return;
    recordPreparing = true;
    try {
      // 再生位置・音を0に戻す。途中再生から録画すると映像と音がずれる問題を防ぐ。
      if (playing) { playing = false; document.getElementById('play').textContent = '▶ 再生'; window.jkAudioSync?.(); }
      t = 0;
      if (layout === 'reel') {
        const p = reelPart();
        if (p) { const [from, to] = jkStaff.page(p, 0); await requestScoreImage(p, from, to).ready; }
      }
    const c = renderer.domElement;
    recCanvas = document.createElement('canvas');
    if (layout === 'reel') { recCanvas.width = RW; recCanvas.height = RH; }
    else { recCanvas.width = c.width - (c.width % 2); recCanvas.height = c.height - (c.height % 2); }
    const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x));
    if (!type) { alert('このブラウザは動画の録画に対応していません。コマンドの `jinkei video` を使ってください。'); return; }
    chunks = [];
    // 音（パートの演奏）も録る: WebAudio の出力を MediaStream に分けて、映像のストリームに足す
    const stream = recCanvas.captureStream(30), as = hasPartsAudio() && document.getElementById('snd')?.checked ? jkAudio.captureStream() : null;
    if (as) as.getAudioTracks().forEach(tr => stream.addTrack(tr));
    recorder = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: 8e6, audioBitsPerSecond: 160000});
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, {type: type.split(';')[0]});
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = `${D.name}.${type.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      stream.getVideoTracks().forEach(tr => tr.stop());
      recorder = null; document.getElementById('rec').textContent = '● 動画を保存';
      if (layout === 'reel' && renderer) { layoutReel(); render3d(); }
    };
    if (layout === 'reel') { layoutReel(); }   // 録画中は 1080 画素幅で描く
    render3d(); drawRecFrame(); recorder.start();
    document.getElementById('rec').textContent = '■ 録画中…';
    document.getElementById('play').click();
    } catch (e) {
      alert('録画を開始できませんでした: ' + (e?.message || e));
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } finally { recordPreparing = false; }
  }
  window.addEventListener('jinkei-end', () => { if (recorder && recorder.state === 'recording') setTimeout(() => recorder && recorder.state === 'recording' && recorder.stop(), 600); });

  // ---- 切り替え ----
  let on = false;
  // 個体を近くで見る: #zoom=<id>[&za=向きからの角度&zd=距離&zh=高さ&zf=画角&ze=カメラの高さ/距離]
  const zoom = {idx: -1, ang: 25, d: 2.6, h: 1.2, fov: 40, el: 0.12};
  (() => {
    const q = new URLSearchParams(location.hash.slice(1)), id = q.get('zoom');
    if (id) { zoom.idx = D.performers.findIndex(p => p.id === id); if (zoom.idx < 0 && /^\d+$/.test(id)) zoom.idx = +id; }
    if (q.has('za')) zoom.ang = +q.get('za'); if (q.has('zd')) zoom.d = +q.get('zd'); if (q.has('zh')) zoom.h = +q.get('zh'); if (q.has('zf')) zoom.fov = +q.get('zf'); if (q.has('ze')) zoom.el = +q.get('ze');
  })();
  const btn = document.getElementById('mode3d');
  btn.onclick = () => {
    on = !on;
    btn.textContent = on ? '2D に戻す' : '3D で見る';
    document.getElementById('svgwrap').style.display = on ? 'none' : '';
    wrap.style.display = on ? 'block' : 'none';
    document.querySelectorAll('.only3d').forEach(e => e.style.display = on ? '' : 'none');
    const rc = document.getElementById('reelcontrols'); if (rc) rc.style.display = on && layout === 'reel' ? 'flex' : 'none';
    document.querySelectorAll('.only2d').forEach(e => e.style.display = on ? 'none' : '');
    if (on && !renderer) { init(); if (layout === 'reel') setLayout('reel'); }
    if (on) { resize(); render3d(); }
  };
  const lookSel = document.getElementById('look3d');
  if (lookSel) { lookSel.value = ILL ? 'illust' : 'real'; lookSel.onchange = e => { ILL = e.target.value === 'illust'; if (renderer) { buildScene(); render3d(); } }; }
  const laySel = document.getElementById('layout3d');
  if (laySel) { laySel.value = layout; laySel.onchange = e => setLayout(e.target.value); }
  document.getElementById('reelzoom')?.addEventListener('input', e => {
    document.getElementById('reelzoomvalue').textContent = Math.round(+e.target.value * 100) + '%';
    render3d();
  });
  for (const id of ['reelgridmode', 'reelpin']) document.getElementById(id)?.addEventListener('change', () => render3d());
  document.getElementById('cam3d').onchange = e => { camMode = e.target.value; if (camMode === 'free') syncOrbitFromCamera(); render3d(); };
  document.getElementById('rec').onclick = () => { if (recorder) { recorder.stop(); return; } startRecording(); };
  window.onDraw = () => render3d();
  // 回転カメラは止まっていても動かす
  (function idle() { if (on && camMode === 'orbit' && !playing) render3d(); requestAnimationFrame(idle); })();
  if (new URLSearchParams(location.hash.slice(1)).get('view') === '3d') btn.click();
  const cq = new URLSearchParams(location.hash.slice(1)).get('cam');
  if (cq) { setCam(cq); render3d(); }
  else if (zoom.idx >= 0) { setCam('zoom'); render3d(); }
  // 検証用: 縦分割の録画フレーム（1080×1920）を 1 枚、PNG の dataURL で返す（録画と同じ合成）
  window.jk3dReelFrame = async () => {
    const was = layout; if (was !== 'reel') setLayout('reel');
    recCanvas = document.createElement('canvas'); recCanvas.width = RW; recCanvas.height = RH;
    layoutReel(true); render3d(); drawReelRec(recCanvas.getContext('2d'));
    await new Promise(r => setTimeout(r, 400));   // 楽譜の画像の読み込みを待つ
    render3d(); drawReelRec(recCanvas.getContext('2d'));
    const u = recCanvas.toDataURL('image/png'); recCanvas = null;
    layoutReel(false); render3d(); if (was !== 'reel') setLayout(was);
    return u;
  };
  // 計測用: 現在の時刻で n フレーム描画してミリ秒/フレームを返す
  window.jk3dBench = n => { const s = performance.now(); for (let i = 0; i < n; i++) render3d(); renderer.getContext().finish(); return (performance.now() - s) / n; };
  // ブラウザ版の「3D動画を書き出す」: 3Dが整ったら自動で録画を始める（再生が終わると動画が保存される）
  if (new URLSearchParams(location.hash.slice(1)).get('rec') === '1') setTimeout(() => { if (on) startRecording(); }, 300);
})();
