// assets/ui/*.svg から src/ui_icons.js を生成する。 実行: node tools/build_icons.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'assets', 'ui');
const INST = {
  trumpet: 'トランペット', mellophone: 'メロフォン', marching_horn: 'マーチングホルン', horn: 'ホルン', trombone: 'トロンボーン', euphonium: 'ユーフォニアム',
  marching_euphonium: 'マーチングユーフォ', tuba: 'チューバ', marching_tuba: 'マーチングチューバ', sousaphone: 'スーザフォン', piccolo: 'ピッコロ', flute: 'フルート',
  oboe: 'オーボエ', bassoon: 'ファゴット', eb_clarinet: 'E♭クラリネット', clarinet: 'クラリネット', alto_clarinet: 'アルトクラリネット', bass_clarinet: 'バスクラリネット',
  soprano_sax: 'ソプラノサックス', alto_sax: 'アルトサックス', tenor_sax: 'テナーサックス', baritone_sax: 'バリトンサックス', snare: 'スネアドラム', tenors: 'テナードラム',
  bass_drum: 'バスドラム', bass1: 'バスドラム1', bass2: 'バスドラム2', bass3: 'バスドラム3', bass4: 'バスドラム4', bass5: 'バスドラム5', cymbals_mid: 'シンバル(ミドル)',
  cymbals_high: 'シンバル(ハイ)', glockenspiel: 'グロッケン', xylophone: 'シロフォン', flag: 'フラッグ', none: '楽器なし',
};
const L = {
  'venue-gym': '体育館', 'venue-stage': 'ステージ', 'venue-football': 'フットボール場', 'venue-floor': 'フロア',
  'shape-line': '一列', 'shape-two-lines': '二列', 'shape-block': 'ブロック', 'shape-arc': '弧', 'shape-circle': '円', 'shape-wedge': 'くさび', 'shape-diagonal': '斜め',
  'shape-curve': 'カーブ', 'shape-poly': '多角形', 'shape-follow': 'あとをついていく', 'shape-scatter': 'ばらばら', 'shape-company-front': 'カンパニーフロント', 'shape-v': 'V字', 'shape-cross': '十字',
  'pose-attention': '気をつけ', 'pose-rest': '休め', 'pose-wide': 'ワイド', 'pose-cross': 'クロス', 'pose-kneel': '片ひざ', 'pose-kneel2': '両ひざ', 'pose-lunge': 'ランジ', 'pose-crouch': 'しゃがむ', 'pose-toe': 'つま先立ち',
  'step-glide': 'グライド', 'step-back': 'バック', 'step-slide': 'スライド', 'step-jazz': 'ジャズラン', 'step-high': 'ハイステップ', 'step-mark': '足踏み(マークタイム)',
  'carry-play': '演奏', 'carry-right': '右に構える', 'carry-left': '左に構える', 'carry-front': '前に構える', 'carry-diag': '斜めに構える',
  'face-front': '正面(客席向き)', 'face-back': '後ろ向き', 'face-kami': '上手向き', 'face-shimo': '下手向き', 'face-center': '中央向き', 'face-out': '外向き', 'face-travel': '進行方向',
  'action-spin': 'スピン', 'action-toss': 'トス', 'action-swing': 'スウィング', 'action-rest': '休め(フラッグ)',
  'look-real': 'リアル', 'look-illust': 'イラスト', 'layout-single': '1画面', 'layout-reel': 'リール(連続)',
  'help-set': 'セット(隊形A→B)', 'help-count': 'カウント', 'help-hold': 'ホールド(止まる)', 'help-transition': '移動(トランジション)', 'help-collision': 'ぶつかり警告',
  'help-kami-shimo': '上手・下手', 'help-select': '範囲選択', 'help-drag': 'ドラッグ', 'help-play': '再生', 'help-video': '動画', 'help-score': 'スコア(譜面)', 'help-save': '保存',
  'mascot-wave': 'こんにちは', 'mascot-point': 'ここだよ', 'mascot-think': 'うーん', 'mascot-cheer': 'やったね', 'mascot-oops': 'あれれ', 'mascot-baton': 'バトン', 'mascot-face': 'ガイド',
  'empty-no-sets': 'セットがありません', 'empty-no-parts': 'パートがありません', 'empty-no-selection': '選択されていません',
};
for (const [k, v] of Object.entries(INST)) L['inst-' + k] = v;
const icons = {}, labels = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()) {
  const name = f.slice(0, -4);
  icons[name] = fs.readFileSync(path.join(dir, f), 'utf8').trim();
  labels[name] = L[name] || name;
}
const missing = Object.keys(L).filter((k) => !icons[k]);
if (missing.length) { console.error('missing svg: ' + missing.join(', ')); process.exit(1); }
const js = `// 自動生成: node tools/build_icons.js （元データは assets/ui/*.svg）
(function () {
  var ICONS = ${JSON.stringify(icons)};
  var LABELS = ${JSON.stringify(labels)};
  var seq = 0;
  window.JK_ICONS = ICONS;
  window.JK_ICON_LABELS = LABELS;
  // jkIcon(name, size=32, extraClass='') -> HTML文字列。size は高さ(px)基準ではなく「長辺」。ID衝突を避けるため id を連番で付け替える。
  window.jkIcon = function (name, size, extraClass) {
    var svg = ICONS[name];
    if (!svg) return '';
    size = size || 32;
    var m = /viewBox="0 0 ([\\d.]+) ([\\d.]+)"/.exec(svg) || [0, 64, 64];
    var vw = +m[1], vh = +m[2], k = size / Math.max(vw, vh);
    var w = Math.round(vw * k * 100) / 100, h = Math.round(vh * k * 100) / 100;
    var u = 'i' + (++seq) + '_';
    var body = svg.replace(/id="([^"]+)"/g, 'id="' + u + '$1"').replace(/url\\(#([^)]+)\\)/g, 'url(#' + u + '$1)');
    var label = String(LABELS[name] || name).replace(/"/g, '&quot;');
    return body.replace('<svg ', '<svg class="jk-icon' + (extraClass ? ' ' + extraClass : '') + '" width="' + w + '" height="' + h + '" role="img" aria-label="' + label + '" focusable="false" ');
  };
})();
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'ui_icons.js'), js);
console.log(Object.keys(icons).length + ' icons, ' + Math.round(js.length / 1024) + ' KB -> src/ui_icons.js');
