// 日本語で指示する「判断AI」の、画面に依存しない部分（ブラウザでは window.JKCMD、Node では module.exports）。
//   文字の正規化 → ハッシュ文字n-gram（1〜3）＋ことば辞書の特徴 → 小さなニューラルネット（assets/cmd_model.json）で
//   「やりたいこと（意図）」を選び、数・方向・対象（セクション名・番号・列）などの値は決まった規則（正規表現）で取り出す。
//   結果は {action, args, confidence, alternatives[上位3つ]} の「型のある判断」。自由な文章は作らない。
//   考え方は「System One」型のモデル（選択肢から型つきの判断を返す小さく速いモデル。例: TypeSafe の Jev）にならった。提携・流用はない。
// 学習は tools/train_cmd_ai.js（決定的）。テストは tests/cmd_ai.js。
(function (root) {
'use strict';

// ===================================================================== 正規化
const PROTECT = [['一緒', 'いっしょ'], ['一旦', 'いったん'], ['一般', 'いっぱん'], ['一部', 'いちぶ'], ['一応', 'いちおう'], ['一方', 'いっぽう'], ['一斉', 'いっせい'],
  ['一直線', 'いっちょくせん'], ['一気', 'いっき'], ['同一', 'どういつ'], ['三角', 'さんかく'], ['四角', 'しかく'], ['十字', 'じゅうじ'], ['千鳥', 'ちどり'], ['万一', 'まんいち'], ['唯一', 'ゆいいつ'], ['二重', 'にじゅう']];
const KNUM = {'〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9};
function kanjiToNum(s) {
  let total = 0, cur = 0, any = false;
  for (const ch of s) {
    if (ch in KNUM) { cur = cur * 10 + KNUM[ch]; any = true; }
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; any = true; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; any = true; }
    else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; any = true; }
  }
  return any ? total + cur : null;
}
const COUNTERS = [['ひとり', '1人'], ['ふたり', '2人'], ['ひとつ', '1つ'], ['ふたつ', '2つ'], ['みっつ', '3つ'], ['よっつ', '4つ'], ['いつつ', '5つ'], ['むっつ', '6つ'], ['ななつ', '7つ'], ['やっつ', '8つ']];
// 全角→半角（NFKC）・カタカナ→ひらがな・漢数字→数字・小文字。ことばの辞書もこれを通すので、表記ゆれに強い
function norm(s) {
  s = String(s == null ? '' : s).normalize('NFKC').toLowerCase();
  for (const [a, b] of PROTECT) s = s.split(a).join(b);
  s = s.replace(/[〇零一二三四五六七八九十百千]+/g, m => { const v = kanjiToNum(m); return v == null ? m : String(v); });
  s = s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (const [a, b] of COUNTERS) s = s.split(a).join(b);
  return s.replace(/[ \t　]+/g, ' ').trim();
}

// ===================================================================== 楽器の呼び名（src/instruments.rs の楽器IDと、よくある略称・通称）
const INSTR = {
  trumpet: ['トランペット', 'ペット', 'tp', 'tpt', 'ラッパ', 'コルネット'], mellophone: ['メロフォン', 'メロ', 'mel', 'mello'],
  horn: ['ホルン', 'hn', 'hr'], marching_horn: ['マーチングホルン'], trombone: ['トロンボーン', 'ボーン', 'tb', 'tbn'],
  euphonium: ['ユーフォニアム', 'ユーフォニウム', 'ユーフォ', 'euph', 'eu'], marching_euphonium: ['マーチングユーフォ'],
  tuba: ['チューバ', 'チュ', 'tu', 'tuba'], marching_tuba: ['マーチングチューバ'], sousaphone: ['スーザフォン', 'スーザ', 'sou'],
  piccolo: ['ピッコロ', 'ピッコ', 'pic'], flute: ['フルート', 'fl'], oboe: ['オーボエ', 'ob'], bassoon: ['ファゴット', 'ファゴ', 'バスーン', 'fg'],
  eb_clarinet: ['エスクラ', 'e♭クラ'], clarinet: ['クラリネット', 'クラ', 'cl'], alto_clarinet: ['アルトクラリネット', 'アルトクラ'], bass_clarinet: ['バスクラリネット', 'バスクラ', 'bcl'],
  soprano_sax: ['ソプラノサックス', 'ソプラノサクス'], alto_sax: ['アルトサックス', 'アルトサクス', 'アルサク', 'as'], tenor_sax: ['テナーサックス', 'テナーサクス', 'テナサク', 'ts'],
  baritone_sax: ['バリトンサックス', 'バリサク', 'bs'], snare: ['スネアドラム', 'スネア', 'sn'], tenors: ['テナードラム', 'クワッド', 'クイント', 'quad', 'td'],
  bass_drum: ['バスドラム', 'バスドラ', 'bd'], cymbals_mid: ['シンバル', 'cy', 'cym'], glockenspiel: ['グロッケンシュピール', 'グロッケン', 'ベルリラ', 'glock', 'gl'],
  xylophone: ['シロフォン', '木琴', 'マリンバ', 'xylo', 'xy'], flag: ['カラーガード', 'ガード', 'フラッグ', '旗', 'cg', 'gd']
};
const FAMILY = {  // 総称 → 楽器ID
  '金管': ['trumpet', 'mellophone', 'horn', 'marching_horn', 'trombone', 'euphonium', 'marching_euphonium', 'tuba', 'marching_tuba', 'sousaphone'],
  '木管': ['piccolo', 'flute', 'oboe', 'bassoon', 'eb_clarinet', 'clarinet', 'alto_clarinet', 'bass_clarinet', 'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax'],
  '打楽器': ['snare', 'tenors', 'bass_drum', 'cymbals_mid', 'glockenspiel', 'xylophone'], 'パーカッション': ['snare', 'tenors', 'bass_drum', 'cymbals_mid', 'glockenspiel', 'xylophone'],
  'パーカス': ['snare', 'tenors', 'bass_drum', 'cymbals_mid', 'glockenspiel', 'xylophone'], 'バッテリー': ['snare', 'tenors', 'bass_drum', 'cymbals_mid'],
  'サックス': ['soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax'], 'クラリネット': ['eb_clarinet', 'clarinet', 'alto_clarinet', 'bass_clarinet'],
  '低音': ['tuba', 'marching_tuba', 'sousaphone', 'euphonium', 'bass_clarinet', 'baritone_sax', 'bassoon'], 'ドラム': ['snare', 'tenors', 'bass_drum']
};
// 楽器ID → このショーでの呼び名のリスト（ひらがな正規化済み）
const INSTR_N = {}; for (const k in INSTR) INSTR_N[k] = INSTR[k].map(norm);
const FAMILY_N = {}; for (const k in FAMILY) FAMILY_N[norm(k)] = FAMILY[k];
const FAMGRP = {}; for (const [g, ws] of [['perc', ['打楽器', 'パーカッション', 'パーカス']], ['batt', ['バッテリー']], ['brass', ['金管']], ['wood', ['木管']]]) for (const w of ws) FAMGRP[norm(w)] = g;
const labelInFamily = (label, fam) => { const l = norm(label || ''), g = FAMGRP[fam]; return l.includes(fam) || (!!g && Object.keys(FAMGRP).some(w => FAMGRP[w] === g && l.includes(w))); };
function guessInstrument(label, id) {
  const l = norm(label || '');
  let best = null, bl = 0;
  for (const k in INSTR_N) for (const a of INSTR_N[k]) if (a.length > bl && (a.length > 2 || /[^\x00-\x7f]/.test(a) ? l.includes(a) : new RegExp('(^|[^a-z])' + a + '($|[^a-z])').test(l))) { best = k; bl = a.length; }
  if (best) return best;
  const i = norm(id || '');
  for (const k in INSTR_N) if (INSTR_N[k].includes(i)) return k;
  return null;
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// セクション一覧 → 呼び名の表（長い順）。ctx ごとにキャッシュ
function aliasTable(ctx) {
  const secs = (ctx && ctx.sections) || [];
  if (ctx && ctx._alias && ctx._aliasKey === secs.length) return ctx._alias;
  const rows = [];   // {a: 呼び名, si: セクション番号 or -1, fam: 総称か}
  secs.forEach((s, si) => {
    const ins = s.instrument || guessInstrument(s.label, s.id);
    s._ins = ins;
    const names = new Set([norm(s.label), norm(s.id)]);
    for (const a of (ins ? INSTR_N[ins] : [])) names.add(a);
    for (const a of names) if (a) rows.push({a, si, fam: false});
  });
  for (const f in FAMILY_N) rows.push({a: f, si: -1, fam: f});
  rows.push({a: norm('ぜんぶの楽器'), si: -9, fam: false}); rows.pop();
  rows.sort((x, y) => y.a.length - x.a.length);
  const out = {rows};
  if (ctx) { ctx._alias = out; ctx._aliasKey = secs.length; }
  return out;
}
// 呼び名の位置を全部探す（重なりは長いものを優先）→ [{i, len, si, fam, num}]
function findSections(n, ctx) {
  const hits = [], used = new Array(n.length).fill(false);
  const rows = aliasTable(ctx).rows;
  // 楽器の呼び名は、ショーに無くても番号つきの参照（tp3）として扱えるよう、ショーのセクションを優先
  for (const r of rows) {
    const ascii = /^[\x00-\x7f]+$/.test(r.a);
    let from = 0, k;
    while ((k = n.indexOf(r.a, from)) >= 0) {
      from = k + 1;
      const e = k + r.a.length;
      if (used.slice(k, e).some(Boolean)) continue;
      if (ascii) { const pre = n[k - 1] || '', post = n[e] || ''; if (/[a-z]/.test(pre) || /[a-z]/.test(post)) continue; }
      if (r.a.length === 1 && !/^[a-z]/.test(r.a)) continue;
      for (let j = k; j < e; j++) used[j] = true;
      hits.push({i: k, len: r.a.length, si: r.si, fam: r.fam});
    }
  }
  hits.sort((x, y) => x.i - y.i);
  return hits;
}

// ===================================================================== ことば辞書（特徴にも値の取り出しにも使う）
const UNIT = '歩|ほ|m|cm|めーとる|ぽいんと|はく|拍|かうんと|count|しょうせつ|小節|度|°|ばい|倍|%|ぱーせんと|わり|割|人|にん|名|番|ばん|列|れつ|つ|個|こ|せっと|set|回|かい|段|行|ぎょう|びーと';
const LEX_SRC = [
  // ---- やりたいこと（動詞）
  ['v_select', '選|えらん|えらび|えらぶ|せんたく|指定|ピック|つかむ|囲|ハイライト|選択'],
  ['v_move', '動か|うごか|動い|うごい|動く|移動|いどう|ずら|ずれ|進め|すすめ|出し|だし|出て|でて|寄せ|よせ|行か|いかせ|運ん|はこん|移し|うつし|歩か|あるか|歩い|あるい|ずらし|ずっと前'],
  ['v_rotate', '回|まわ|回転|かいてん|ローテ|rotate|ひねっ|ねじ|向きを変え'],
  ['v_expand', '広げ|ひろげ|広く|ひろく|拡大|拡げ|ひらい|開い|ひらき|あけ|開け|空け|大きく|おおきく|ばらけ|ばらば|ゆったり|ゆるく|散ら|もっと間隔|間隔を(?:あけ|空け)|ひろが|広が'],
  ['v_shrink', '狭|せま|縮|ちぢ|しゅくしょう|つめ|詰め|小さく|ちいさく|せばめ|しぼ|絞|締|しめ|密|みつ|ぎゅっ|くっつけ|寄せ集|詰ま'],
  ['v_flip', '反転|はんてん|ひっくり|ミラー|裏返|うらがえ|左右逆|さゆうぎゃく|逆|ぎゃく|あべこべ|反対にして'],
  ['v_swap', '入れ替|いれか|入替|交換|こうかん|スワップ|チェンジ|入れ換|取り替|とりか|替え|場所を替|場所を入れ|位置を替|位置を入れ'],
  ['v_delete', '削除|さくじょ|消|けし|けす|けせ|除|のぞ|抜い|ぬい|抜く|ぬく|外し|はずし|はずす|いらない|不要|ふよう|なくし|なくす|減ら|へら|削る|どけ|いなく|クビ|帰らせ|休ませ|休んで'],
  ['v_add', '追加|ついか|増や|ふやし|足し|たし|足す|加え|くわえ|増え|ふえ|新しく|あたらしく|もう(?:1人|ひとり)|入れて|入れる|いれて|いれる|参加|さんか'],
  ['v_dup', '複製|ふくせい|同じ人|おなじひと|クローン|分身'],
  ['v_copy', 'コピ|写し|写して'],
  ['v_paste', '貼|ペースト|ぺた|はりつけ'],
  ['v_cut', '切り取|きりと|カット|かっと|切って|きって|切る'],
  ['v_split', '分割|ぶんかつ|分け|わけ|割|スプリット|二つに|2つに|ふたつに'],
  ['v_play', '再生|さいせい|流し|ながし|流れ|ながれ|プレイ|スタート|始め|はじめ|見せ|みせ|見たい|みたい|動かしてみ|通し|とおし|再開|さいかい|聞か|きか'],
  ['v_stop', '止め|とめ|止まれ|とまれ|停止|ていし|ストップ|やめ|中断|ちゅうだん|ポーズ|一時停止|ストップ'],
  ['v_undo', '元に戻|もとにもど|取り消|とりけし|取消|アンドゥ|undo|もどし|戻し|戻して|戻す|戻れ|やっぱ|ひとつ前に|1つ前に|キャンセル|なかったこと|なかった事|ミス|まちが|間違|ひとつ戻|1つ戻|さっきのなし|無し|なしで'],
  ['v_redo', 'やり直|やりなお|リドゥ|redo|やりかえ|もう一度やっ|取り消しを取り消|やっぱり戻さな'],
  ['v_save', '保存|ほぞん|セーブ|save|とっておい|残し|のこし|ダウンロード'],
  ['v_print', '印刷|いんさつ|プリント|print|紙に|刷'],
  ['v_video', '動画|どうが|ビデオ|mp4|録画|ろくが|撮影|さつえい|書き出|かきだ|エクスポート'],
  ['v_3d', '3d|3でぃー|さんでぃー|立体|りったい|3次元|横から|俯瞰|ふかん|ぐるぐる|3Ｄ|リアル'],
  ['v_help', 'ヘルプ|help|使い方|つかいかた|教えて|おしえて|わからない|分からない|わかんない|どうやって|どうすれば|どうしたら|説明|せつめい|やり方|やりかた|方法|ほうほう|何ができ|なにができ|できること|使えるコマンド|コマンド一覧|例を|れいを'],
  ['v_fix', '自動で直|自動修正|自動で|じどう|直して|なおして|なおす|直す|修正|しゅうせい|ぶつかり|衝突|しょうとつ|かぶり|重なり|かさなり|ぶつから|ぶつかる|解消|かいしょう|ととのえ|整えて|おかしい|大丈夫'],
  ['v_parade', 'パレード|行進|こうしん|parade|道順|みちじゅん|練り歩|ねりあるき|入場|にゅうじょう|退場|たいじょう|ぐるっと一周|ぱれーど'],
  ['v_face', '向き|むき|向い|むい|向か|むか|向け|むけ|顔|かお|正対|せいたい|体の向き|見て|見る|目線|めせん|フェイス|face|むく|向く'],
  ['v_pose', '姿勢|しせい|ポーズ|気をつけ|きをつけ|休め|やすめ|足開き|あしひらき|足を開|クロス|片膝|かたひざ|膝|ひざ|ランジ|しゃがみ|しゃがん|しゃがむ|つま先|つまさき|爪先|直立|ちょくりつ'],
  ['v_carry', '構え|かまえ|持ち方|もちかた|担|かつぎ|楽器を持|楽器の持|右手|左手|みぎて|ひだりて|carry|楽器の向き|ホルン構え|吹く'],
  ['v_stepstyle', 'ステップ|歩き方|あるきかた|歩幅|ほはば|グライド|バックマーチ|スライド|ジャズラン|ハイステップ|歩きかた|ローリング|rolling|足の運び|あしのはこび|歩き'],
  ['v_action', '動作|どうさ|スピン|トス|スイング|レスト|旗を|はたを|投げ|なげ|アクション|くるくる|ぶんぶん|フラッグ'],
  ['v_tempo', 'テンポ|bpm|はやさ|速さ|速く|はやく|遅く|おそく|ゆっくり|早く|はやめ|速め|おそめ|遅め|スピード|曲の速|bpmを'],
  ['v_hold', 'ホールド|hold|その場で|そのばで|止まっ|とまっ|待機|たいき|待つ|待って|静止|せいし|足踏み|あしぶみ|マークタイム|stay|動かない|うごかない|動かず'],
  ['v_counts', 'カウント|かうんと|拍|はく|長さ|ながさ|尺|長く|ながく|短く|みじかく|のばし|伸ばし|延ばし|縮め|ちぢめ|増やして|減らして'],
  ['v_grid', 'グリッド|方眼|ほうがん|目盛|めもり|マス目|ますめ|格子|こうし|grid|ポイント表示|5mポイント|十字|目安線|補助線'],
  ['v_snap', '吸着|きゅうちゃく|スナップ|snap|吸い付|すいつ|刻み|きざみ|ぴったり合わせ'],
  ['v_zoom', 'ズーム|zoom|拡大表示|縮小表示|画面を(?:大|小)|全体を?(?:表示|見)|ぜんたい(?:ひょうじ|みせ)|フィット|引き|引いて|寄って|アップ|全体図|ぜんたいず|見やすく|大きく表示|小さく表示'],
  ['v_names', '名前|なまえ|ラベル|番号表示|ばんごう|id表示|表記|ひょうき|名札|なふだ|番号を(?:出|消|表)|数字を(?:出|消|表)'],
  ['v_tool', 'ツール|tool|ペン|描|えがい|書き込|ドロー|お絵|おえ'],
  ['v_set', 'セット|set|場面|ばめん|ページ|フォーメーション|次の隊形|隊形を(?:追加|増)|新しい隊形'],
  ['v_goto', '行って|いって|行く|いく|行こ|いこ|移る|うつる|飛ぶ|とぶ|ジャンプ|進む|すすむ|戻る|もどる|開い|ひらい|切り替|きりかえ|次|つぎ|ネクスト|前の|ひとつ前|1つ前'],
  ['v_mirror', 'ミラー|鏡|かがみ|左右対称|さゆうたいしょう|左右反転して貼'],
  ['v_unpin', '解除|かいじょ|リセット|クリア|もとに|元に|固定を|こていを|個別(?:の位置)?(?:を)?(?:解除|はずす|外す)'],
  ['v_gather', '集ま|あつま|集め|あつめ|中心に|センターに|真ん中に|まんなかに|中央に|ちゅうおうに'],
  // ---- 形
  ['s_arc', '弧|アーク|円弧|えんこ|半円|はんえん|扇|おうぎ|アーチ|三日月|みかづき|かまぼこ'],
  ['s_circle', '円|えん|丸|まる|サークル|輪|わっか|リング|ぐるっと|円形|えんけい|輪っか|まあるく|まぁるく'],
  ['s_line', '直線|ちょくせん|いっちょくせん|まっすぐ|真っ直ぐ|真直|1列|いちれつ|横1列|縦1列|横に並|縦に並|列に|れつに|ライン|横列|縦列|ずらっと|一本'],
  ['s_curve', '曲線|きょくせん|カーブ|ゆるやか|波|なみ|えすじ|s字|うねうね|くねくね|ジグザグ|じぐざぐ'],
  ['s_block', 'ブロック|しかく|長方形|ちょうほうけい|方形|ほうけい|正方形|せいほうけい|かたまり|固め|かため|碁盤|ごばん|矩形|スクエア|整列|せいれつ|格子状|マス状|行列|ぎょうれつ|ボックス|塊|四角形|碁盤の目'],
  ['s_wedge', 'くさび|楔|v字|ぶいじ|ブイ|さんかく|矢じり|やじり|矢印|やじるし|ウェッジ|wedge|トライアングル|ピラミッド|山型|やまがた|雁行|がんこう|vの字'],
  ['s_diag', '斜め|ななめ|対角|たいかく|ダイアゴナル|diagonal|斜線|しゃせん'],
  ['s_follow', 'フォロー|follow|ついて|付いて|つづいて|追いかけ|おいかけ|へび|蛇|数珠|じゅず|連なっ|つらなっ|あとに続|後に続|なぞ'],
  // ---- 方向
  ['d_front', '前|まえ|客席|きゃくせき|手前|てまえ|お客|観客|フロント|front|前方|ぜんぽう'],
  ['d_back', '後ろ|うしろ|奥|おく|後方|こうほう|バック|back|裏|うら'],
  ['d_kami', '上手|かみて|右|みぎ|ライト'],
  ['d_shimo', '下手|しもて|左|ひだり|レフト'],
  ['d_cw', '時計回り|とけいまわり|右回り|みぎまわり|時計方向|cw|clockwise|時計'],
  ['d_ccw', '反時計|はんとけい|左回り|ひだりまわり|ccw|逆時計'],
  // ---- 単位
  ['u_step', '歩|ほ(?![ーあ-ん])'], ['u_m', '(?:^|[0-9 ])m(?![a-z0-9])|めーとる|cm|せんち'], ['u_point', 'ポイント'], ['u_count', '拍|はく|カウント|count|ビート'], ['u_bar', '小節|しょうせつ|bar'],
  ['u_deg', '度|°|でぐりー|deg|直角|ちょっかく|半回転|1回転|反対向き|真逆|まぎゃく|逆向き'], ['u_x', '倍|ばい|×'], ['u_pct', '%|ぱーせんと'], ['u_wari', '割|わり'],
  ['u_person', '人|にん|名'], ['u_row', '列|れつ|行|ぎょう'], ['u_ban', '番|ばん'],
  // ---- 対象
  ['t_all', '全員|ぜんいん|みんな|全部|ぜんぶ|全体|ぜんたい|皆|みな|全て|すべて|全メンバー|総員|オール|all|全パート|全隊|全セクション'],
  ['t_sel', 'それ|さっき|選んだ|選択中|選択した|今選んでる|いま選んで|この人|この子|その人|その子|その人たち|この人たち|いまの人|現在選択|えらんだ|選んでる|選んである|今の人'],
  ['t_none', '解除|選択を外|選択を消|選択をやめ|選ばない|何も選ばない|選択なし|選択をクリア'],
  ['t_invert', '反転|逆|入れ替|ひっくり返|残り|のこり|それ以外|以外|いがい'],
  ['t_region', '列|れつ|半分|はんぶん|真ん中|まんなか|中央|端|はし|はじ|最前|最後列|先頭|奇数|偶数|前列|後列'],
  ['t_member', '番|ばん|番目|人目'],
  // ---- ON/OFF・位置・程度
  ['m_on', '表示|ひょうじ|出して|だして|出す|つけ|付け|オン|on|有効|ゆうこう|見せ'],
  ['m_off', '隠|かく|消して|消す|けして|オフ|off|無効|むこう|なし|非表示|ひひょうじ|やめ'],
  ['m_little', '少し|すこし|ちょっと|ちょい|ほんの|わずか|軽く|かるく|微|びみょう'],
  ['m_much', 'かなり|大きく|おおきく|思い切|おもいきっ|ぐっと|たくさん|うんと|大幅|おおはば|ずっと|めっちゃ|すごく'],
  ['m_half', '半分|はんぶん|半歩|半拍|半'],
  ['m_first', '最初|さいしょ|はじめ|先頭|頭|最初の'], ['m_last', '最後|さいご|終わり|おわり|ラスト|最終|さいしゅう|末尾'],
  ['m_next', '次|つぎ|ネクスト|あと|後の|うしろの|進'], ['m_prev', '前の|まえの|ひとつ前|1つ前|直前|ちょくぜん|さっきの|戻'],
  ['m_here', 'ここ|今|いま|この位置|いまの位置|再生ヘッド|さいせいへっど|現在|げんざい|このセット|今のセット'],
  ['m_each', 'ずつ|ごとに|おきに|毎|まい|それぞれ'],
  ['m_polite', 'ください|下さい|お願い|おねがい|ほしい|欲しい|ね$|よ$|かな|です|ます'],
  ['m_question', '[?？]|かな|でしょうか|ですか|ますか|できる|できます|何|なに|どう'],
  ['m_neg', 'ない$|ないで|せず|やめて|ダメ|だめ|しないで'],
  // ---- 値（向き・姿勢・構え・ステップ・動作）
  ['a_front', '客席|正面|前を|きゃくせき|お客'], ['a_back', '後ろ|奥|うしろ|背中|せなか'], ['a_kami', '上手|かみて'], ['a_shimo', '下手|しもて'],
  ['a_center', '中心|ちゅうしん|真ん中|まんなか|センター|内側|うちがわ|内向き'], ['a_out', '外|そと|外側|そとがわ|外向き'], ['a_travel', '進行方向|しんこうほうこう|進む方向|進行'],
  ['p_attention', '気をつけ|きをつけ|直立|ちょくりつ|attention'], ['p_rest', '休め|やすめ'], ['p_wide', '足開き|足を開|あしひらき|肩幅|かたはば'], ['p_cross', 'クロス|交差|こうさ'],
  ['p_kneel', '片膝|かたひざ'], ['p_kneel2', '膝つき|ひざつき|両膝|りょうひざ|(?:^|[^片かた])膝をつ|(?:^|[^片かた])ひざをつ|正座|せいざ'], ['p_lunge', 'ランジ|弓立|ゆみだち'], ['p_crouch', 'しゃがみ|しゃがん|しゃがむ|低く|ひくく'], ['p_toe', 'つま先|つまさき|爪先|背伸|せのび'],
  ['c_play', '演奏|えんそう|吹く|ふく|プレイ(?:ング)?|吹きの'], ['c_right', '右手|みぎて|右肩|みぎかた'], ['c_left', '左手|ひだりて|左肩|ひだりかた'], ['c_front', '正面|しょうめん|前に構|まえに構|前持ち'], ['c_diag', '斜め|ななめ|斜め構|ななめ構'],
  ['t_glide', 'グライド|ぐらいど|滑るよう|なめらか'], ['t_backmarch', 'バックマーチ|後ろ歩き|うしろあるき|後退|こうたい|バック歩'], ['t_slide', 'スライド|すらいど|横歩き|よこあるき'], ['t_jazz', 'ジャズラン|じゃずらん|ジャズ'], ['t_high', 'ハイステップ|はいすてっぷ|ハイ|高く上げ|たかくあげ|足を上げ'],
  ['x_spin', 'スピン|すぴん|回す|まわす|くるくる'], ['x_toss', 'トス|とす|投げ|なげ|放'], ['x_swing', 'スイング|すいんぐ|振|ふり|ふる'], ['x_rest', 'レスト|れすと|休|やす']
].map(([k, src]) => [k, new RegExp(norm(src))]);
const LEX = LEX_SRC;
function conceptsOf(n) { const o = []; for (const [k, re] of LEX) if (re.test(n)) o.push(k); return o; }

// ===================================================================== 特徴（ハッシュ文字 n-gram 1〜3 ＋ 辞書）
const D_DEFAULT = 4096;
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
// 数・セクション名・番号を記号に置き換えた文字列（値によらず、言い回しだけを見せる）
function maskText(n, ctx) {
  let t = n;
  const hits = findSections(t, ctx);
  if (hits.length) {
    let out = '', p = 0;
    for (const h of hits) {
      if (h.i < p) continue;
      out += t.slice(p, h.i) + '@'; p = h.i + h.len;
      const m = /^\d+/.exec(t.slice(p)); if (m) p += m[0].length;   // tp3 の 3 も含めて 1 つの記号に
    }
    t = out + t.slice(p);
  }
  t = t.replace(/\d+(?:\.\d+)?/g, '#').replace(/[a-z]{1,4}#/g, '@');
  return t.replace(/ +/g, ' ').trim();
}
function featureIds(n, ctx, D) {
  D = D || D_DEFAULT;
  const t = '^' + maskText(n, ctx).replace(/[、,。．.!！?？;；「」『』（）()~〜"'’”]/g, '').replace(/ /g, '') + '$';
  const set = new Map();
  for (let g = 1; g <= 3; g++) for (let i = 0; i + g <= t.length; i++) { const id = fnv('g' + t.substr(i, g)) % D; set.set(id, 1); }
  const cs = conceptsOf(n);
  for (const c of cs) set.set(fnv('c' + c) % D, 2);
  const nn = (n.match(/\d+(?:\.\d+)?/g) || []).length;
  set.set(fnv('n' + Math.min(nn, 4)) % D, 1.5);
  let ss = 0; for (const v of set.values()) ss += v * v;
  const inv = 1 / Math.sqrt(ss || 1);
  const ids = [], vals = [];
  for (const [k, v] of set) { ids.push(k); vals.push(v * inv); }
  return {ids, vals};
}

// ===================================================================== モデル（int8 の埋め込み → ReLU → softmax）
function b64ToInt8(s) {
  const T = new Uint8Array(128); const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; for (let i = 0; i < 64; i++) T[A.charCodeAt(i)] = i;
  let len = s.length; while (len > 0 && s[len - 1] === '=') len--;
  const out = new Int8Array(Math.floor(len * 3 / 4));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = T[s.charCodeAt(i)], b = T[s.charCodeAt(i + 1)], c = i + 2 < len ? T[s.charCodeAt(i + 2)] : 0, d = i + 3 < len ? T[s.charCodeAt(i + 3)] : 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
let MODEL = null;
function loadModel(m) {
  if (typeof m === 'string') m = JSON.parse(m);
  const w1 = b64ToInt8(m.w1);
  if (m.policy) Object.assign(POLICY, m.policy);
  MODEL = {D: m.D, H: m.H, C: m.classes.length, classes: m.classes, w1, s1: Float64Array.from(m.s1), b1: Float64Array.from(m.b1), w2: Float64Array.from(m.w2), b2: Float64Array.from(m.b2), T: m.T || 1, info: m.info || {}};
  return MODEL;
}
function modelReady() { return !!MODEL; }
function logitsN(n, ctx) {
  if (!MODEL) throw new Error('モデルが読み込まれていません');
  const {D, H, C, w1, s1, b1, w2, b2} = MODEL;
  const f = featureIds(n, ctx, D);
  const h = new Float64Array(H);
  for (let k = 0; k < f.ids.length; k++) { const base = f.ids[k] * H, v = f.vals[k]; for (let j = 0; j < H; j++) h[j] += v * w1[base + j] * s1[j]; }
  for (let j = 0; j < H; j++) { const z = h[j] + b1[j]; h[j] = z > 0 ? z : 0; }
  const z = new Float64Array(C);
  for (let c = 0; c < C; c++) { let s = b2[c]; const base = c * H; for (let j = 0; j < H; j++) s += w2[base + j] * h[j]; z[c] = s; }
  return z;
}
function softmaxT(z0, T) {
  const C = z0.length, z = new Float64Array(C);
  for (let c = 0; c < C; c++) z[c] = z0[c] / T;
  let mx = -Infinity; for (let c = 0; c < C; c++) if (z[c] > mx) mx = z[c];
  let sum = 0; for (let c = 0; c < C; c++) { z[c] = Math.exp(z[c] - mx); sum += z[c]; }
  for (let c = 0; c < C; c++) z[c] /= sum;
  return z;
}
// n: 正規化済みの文 → 確率の配列（温度で較正済み）
function classifyN(n, ctx) { return softmaxT(logitsN(n, ctx), MODEL.T); }
function rank(probs) { return Array.from(probs, (p, i) => ({id: MODEL.classes[i], p})).sort((a, b) => b.p - a.p); }

// ===================================================================== 方向・数・対象の取り出し
const DIRJA = {front: '客席側', back: '奥', kami: '上手（画面の右）', shimo: '下手（画面の左）'};
const DIRVEC = {front: [0, -1], back: [0, 1], kami: [1, 0], shimo: [-1, 0]};
const RE = (s) => new RegExp(norm(s));
const R_SEL = RE('それ(?!以外|から|で|じゃ|では|なら)|さっき(?:の|選んだ)|選んだ|選択中|選択した(?!い)|今選んでる|いま選んで|えらんだ|選んでる|この人|この子|その人|その子|その人たち|この人たち|いまの人|今の人|現在選択|その(?:まま|子たち)|選んである');
const R_ALL = RE('全員|ぜんいん|みんな|全部|ぜんぶ|全体|ぜんたい|皆|みな|全て|すべて|全メンバー|総員|オール|^all|全パート|全隊|全セクション|全員の|全ての');
const REGIONS = [
  ['front-row', RE('最前列|さいぜんれつ|1番(?:前|まえ)|(?:前|まえ)の(?:列|れつ)|(?:前|まえ)1(?:列|れつ)|先頭|せんとう|前列|ぜんれつ|いちばん手前|1番手前|最前|(?:客席|手前|前)に(?:いる|近い)人|前にいる|1列目|一列目|いちれつめ|最前線')],
  ['back-row', RE('最後列|さいこうれつ|1番(?:後ろ|うしろ|奥)|(?:後ろ|うしろ|奥|おく)の(?:列|れつ)|後列|こうれつ|最後尾|さいこうび|いちばん奥|最終列|最後の列|後ろにいる|奥にいる')],
  ['left-half', RE('(?:左|ひだり|下手|しもて)(?:半分|はんぶん|半|(?:側|がわ)(?=の(?:人|ひと|メンバー|子|ほう半)|を|は|が|だけ|$)|の(?:ほう|方)(?=を|は|が)|のひと|の人|チーム|グループ)')],
  ['right-half', RE('(?:右|みぎ|上手|かみて)(?:半分|はんぶん|半|(?:側|がわ)(?=の(?:人|ひと|メンバー|子|ほう半)|を|は|が|だけ|$)|の(?:ほう|方)(?=を|は|が)|のひと|の人|チーム|グループ)')],
  ['front-half', RE('(?:前|まえ|客席|手前)(?:半分|はんぶん|半|側半|のほう半)')],
  ['back-half', RE('(?:後ろ|うしろ|奥|おく)(?:半分|はんぶん|半|側半)')],
  ['left-end', RE('(?:左|ひだり|下手|しもて)(?:端|はし|はじ)|1番(?:左|ひだり)|(?:左|ひだり)の1番')],
  ['right-end', RE('(?:右|みぎ|上手|かみて)(?:端|はし|はじ)|1番(?:右|みぎ)|(?:右|みぎ)の1番')],
  ['center', RE('真ん中|まんなか|中央|ちゅうおう|中心の|ちゅうしんの|中ほど|真中|中心付近|センター付近|センターの人|センターにいる')]
];
const REGION_JA = {'front-row': '前の列', 'back-row': '後ろの列', 'left-half': '左半分', 'right-half': '右半分', 'front-half': '前半分', 'back-half': '後ろ半分', 'left-end': '左端', 'right-end': '右端', center: '真ん中'};
const R_ODD = RE('奇数|きすう'), R_EVEN = RE('偶数|ぐうすう');
const NUMRE = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + norm(UNIT) + ')?', 'g');
const UNITMAP = {'歩': 'step', 'ほ': 'step', m: 'm', cm: 'cm', めーとる: 'm', ぽいんと: 'point', 'はく': 'count', '拍': 'count', かうんと: 'count', count: 'count', びーと: 'count', しょうせつ: 'bar', '小節': 'bar', '度': 'deg', '°': 'deg', ばい: 'x', '倍': 'x', '%': 'pct', ぱーせんと: 'pct', わり: 'wari', '割': 'wari', '人': 'person', にん: 'person', '名': 'person', '番': 'ban', ばん: 'ban', '列': 'row', れつ: 'row', 'つ': 'tsu', '個': 'tsu', こ: 'tsu', せっと: 'set', set: 'set', '回': 'kai', かい: 'kai', '段': 'row', '行': 'row', ぎょう: 'row'};
function numsOf(w) {
  const out = []; let m; NUMRE.lastIndex = 0;
  while ((m = NUMRE.exec(w)) !== null) { if (m[0] === '') { NUMRE.lastIndex++; continue; } out.push({v: parseFloat(m[1]), u: m[2] ? UNITMAP[m[2]] || null : null, at: m.index, len: m[0].length}); }
  return out;
}
const SHAPES = [['arc', 's_arc'], ['circle', 's_circle'], ['wedge', 's_wedge'], ['diag', 's_diag'], ['follow', 's_follow'], ['block', 's_block'], ['curve', 's_curve'], ['line', 's_line']];
const POSE_IDS = ['attention', 'rest', 'wide', 'cross', 'kneel', 'kneel2', 'lunge', 'crouch', 'toe'];
const STEP_IDS = [['backmarch', 'back'], ['glide', 'glide'], ['slide', 'slide'], ['jazz', 'jazz'], ['high', 'high']];
const ACT_IDS = ['spin', 'toss', 'swing', 'rest'];
const CARRY_IDS = ['right', 'left', 'diag', 'front', 'play'];
const lexHas = (k, n) => { const e = LEX.find(x => x[0] === k); return e ? e[1].test(n) : false; };

// 文 → 値の束
function parseSlots(text, ctx) {
  const n = norm(text), P = {n, secs: [], ids: [], nth: [], all: false, sel: false, region: null, parity: null, nums: [], dirs: [], setRef: null};
  let w = n;   // 取り出した所を空白に置き換えていく作業用の文字列
  const blank = (i, len) => { w = w.slice(0, i) + ' '.repeat(len) + w.slice(i + len); };
  // 1) セクション名・番号つきの呼び名（tp3 / トランペット3番 / トランペットの3番）
  const sections = (ctx && ctx.sections) || [];
  const hits = findSections(n, ctx);
  const famHits = [];
  for (const h of hits) {
    let end = h.i + h.len, num = null;
    const rest = n.slice(end);
    const m = /^(?:の)?(\d+)(番|ばん|人目|にんめ)?(?!\d)/.exec(rest);
    if (m) {
      const after = rest.slice(m[0].length);
      if (m[2] || !new RegExp('^\\s*(?:' + norm(UNIT) + ')').test(after)) { num = parseInt(m[1], 10); end += m[0].length; }
    }
    if (h.si >= 0) {
      const sec = sections[h.si];
      if (num != null) {
        // 範囲（tp3から5 / tp3〜5 / tp3-5）
        const rg = /^\s*(?:から|〜|~|-|\.\.)\s*(?:tp|[a-z]*)?(\d+)/.exec(n.slice(end));
        if (rg && parseInt(rg[1], 10) >= num) { for (let q = num; q <= parseInt(rg[1], 10) && q < num + 60; q++) P.ids.push(sec.id + q); end += rg[0].length; }
        else P.ids.push(sec.id + num);
      } else if (!P.secs.includes(h.si)) P.secs.push(h.si);
    } else if (h.fam) {
      famHits.push(h.fam);
      sections.forEach((s, si) => { const ins = s._ins || s.instrument || guessInstrument(s.label, s.id); if (((ins && FAMILY_N[h.fam].includes(ins)) || labelInFamily(s.label, h.fam)) && !P.secs.includes(si)) P.secs.push(si); });
    }
    blank(h.i, end - h.i);
  }
  P.famHits = famHits;
  // 2) 全員・選んだ人
  if (R_ALL.test(n)) P.all = true;
  if (R_SEL.test(n)) P.sel = true;
  // 3) 列・半分など
  for (const [name, re] of REGIONS) if (re.test(n)) { P.region = name; break; }
  if (R_ODD.test(n)) P.parity = 'odd'; else if (R_EVEN.test(n)) P.parity = 'even';
  // 4) セット（セット3 / 3セット目 / 3番目のセット / 3A / 最初・最後・次・前）
  {
    let m;
    const names = ((ctx && ctx.sets) || []).map(norm);
    if ((m = /(?:せっと|set)\s*(\d+[a-z]?)/.exec(w))) { P.setRef = {name: m[1]}; blank(m.index, m[0].length); }
    else if ((m = /(\d+)\s*(?:せっと|set)\s*(?:め|目)/.exec(w))) { P.setRef = {index: parseInt(m[1], 10) - 1}; blank(m.index, m[0].length); }
    else if ((m = /(\d+)\s*(?:番目|ばんめ)の?\s*(?:せっと|set|場面|ばめん)/.exec(w))) { P.setRef = {index: parseInt(m[1], 10) - 1}; blank(m.index, m[0].length); }
    else if ((m = /(?:^|[^0-9a-z])(\d+[a-z])(?![a-z0-9])/.exec(w)) && /^\d+[a-z]$/.test(m[1]) && (!names.length || names.includes(m[1]))) { P.setRef = {name: m[1]}; blank(m.index + (m[0].length - m[1].length), m[1].length); }
    else for (const nm of names) if (nm && !/^\d+$/.test(nm) && nm.length >= 2 && n.includes(nm)) { P.setRef = {name: nm}; break; }
    P.setFirst = /最初のせっと|1番目のせっと|最初の隊形|はじめのせっと|頭のせっと|先頭のせっと|最初(?:へ|に|の)|^最初|さいしょ(?:へ|に|の)/.test(n) || (lexHas('m_first', n) && !P.setRef && /せっと|隊形|場面|最初|はじめ/.test(n));
    P.setLast = /最後のせっと|最終せっと|最終の隊形|最後の隊形|らすとのせっと|終わりのせっと/.test(n) || (lexHas('m_last', n) && !P.setRef && /せっと|隊形|場面|最後|さいご|らすと|終わり/.test(n));
    P.setNext = /次の|つぎの|次へ|つぎへ|次に(?:行|い|進|すす|移|うつ)|ねくすと|ひとつ後|1つ後|後ろのせっと|うしろのせっと|先へ|先に(?:進|行)/.test(n) || /次(?:いこ|行こ|いく|行く|いって|行って)/.test(n);
    P.setPrev = /前の(?:せっと|隊形|場面)|まえの(?:せっと|隊形)|前へ戻|ひとつ前|1つ前|直前|1個前|ひとつまえ|前のに|前に戻|手前のせっと|前のやつ/.test(n);
  }
  // 5) ほかの番号（3番 など。区切りのない 「3人」「3歩」 は数として扱う）
  {
    let m; const re = /(\d+)\s*(?:番|ばん|人目|にんめ)(?!め?の?\s*(?:せっと|set))(?!前|まえ|後|うしろ|奥)/g;
    while ((m = re.exec(w)) !== null) { P.nth.push(parseInt(m[1], 10)); blank(m.index, m[0].length); re.lastIndex = m.index; }
  }
  // 6) 数
  P.nums = numsOf(w);
  const hasHalf = /半歩|半拍|半m/.test(n);
  if (/(\d+)歩半/.test(n)) { const mm = /(\d+)歩半/.exec(n); const f = P.nums.find(q => q.u === 'step'); if (f) f.v = parseInt(mm[1], 10) + 0.5; }
  if (hasHalf && !P.nums.length) P.nums.push({v: 0.5, u: /歩/.test(n) ? 'step' : /拍/.test(n) ? 'count' : 'm', at: 0, len: 2});
  // 7) 方向
  const dirs = [];
  const add = d => { if (!dirs.includes(d)) dirs.push(d); };
  const dn = n.replace(/(?:前|まえ)の(?:列|れつ|せっと|隊形|ひと|人|ほう|方)|(?:前|まえ)(?:半分|列)|(?:後ろ|うしろ|奥)の(?:列|れつ)|(?:右|左|ひだり|みぎ)(?:半分|はんぶん)|(?:右|左|ひだり|みぎ)(?:端|はし)|右手|左手|右回り|左回り|反時計|時計/g, ' ');
  const re4 = [
    ['front', /(?:客席|きゃくせき|手前|てまえ|お客さん?|観客|フロント|前方|ぜんぽう|前|まえ)(?![かが]ら)|下(?=へ|に)|した(?=へ|に)/g],
    ['back', /(?:後ろ|うしろ|後方|こうほう|バック|奥|おく|裏|うら)|後(?=へ|に|ろ)|上(?=へ|に)|うえ(?=へ|に)/g],
    ['kami', /(?:上手|かみて|右|みぎ|ライト)/g], ['shimo', /(?:下手|しもて|左|ひだり|レフト)/g]];
  const found = [];
  for (const [d, rg] of re4) { let m; rg.lastIndex = 0; while ((m = rg.exec(dn)) !== null) { found.push([m.index, d]); } }
  found.sort((a, b) => a[0] - b[0]); for (const [, d] of found) add(d);
  P.dirs = dirs;
  // 8) 回転
  P.cw = /時計回り|とけいまわり|(?:右|みぎ)(?:回り|まわり)|時計方向|cw|clockwise|右に|みぎに|右へ|右$|右の/.test(n) && !/反時計|はんとけい|(?:左|ひだり)(?:回り|まわり)/.test(n);
  P.cw = /時計回り|とけいまわり|(?:右|みぎ)(?:回り|まわり)|時計方向|cw|clockwise|右に|みぎに|右へ|右$|右の/.test(n) && !/反時計|はんとけい|(?:左|ひだり)(?:回り|まわり)/.test(n);
  P.ccw = /反時計|はんとけい|(?:左|ひだり)(?:回り|まわり)|ccw|逆時計|左に|ひだりに|左へ/.test(n);
  if (/反時計|はんとけい|(?:左|ひだり)(?:回り|まわり)|ccw|逆時計/.test(n)) { P.cw = false; P.ccw = true; }
  if (/直角|ちょっかく/.test(n)) P.deg = 90;
  else if (/半回転|反対向き|真逆|まぎゃく|逆向き|ぎゃくむき|うしろ向き|後ろ向き|はんたいむき/.test(n)) P.deg = 180;
  else if (/(?:1|いっ)回転|いっかいてん|ぐるっと1周/.test(n)) P.deg = 360;
  else { const d = P.nums.find(q => q.u === 'deg'); if (d) P.deg = d.v; }
  // 9) 形
  for (const [nm, k] of SHAPES) { if (lexHas(k, n)) { P.shape = nm; break; } }
  P.orient = /横|よこ|水平|すいへい|左右に/.test(n) ? 'h' : /縦|たて|垂直|すいちょく|前後に/.test(n) ? 'v' : null;
  // 10) 向き・姿勢・構え・ステップ・動作の値
  P.clear = /解除|かいじょ|なしにして|なしに|りせっと|くりあ|もとに戻|元に戻|自動に|じどうに|でふぉると|ふつうに|普通に/.test(n);
  { // 向き
    if (/進行方向|しんこうほうこう|進む方向/.test(n)) P.face = 'travel';
    else if (/(?:中心|ちゅうしん|内側|うちがわ|内向き|うちむき|真ん中|まんなか|せんたー)(?:を|へ|に|側)?(?:向|むい|むか|むけ|むき)/.test(n) || /内向き|うちむき/.test(n)) P.face = 'center';
    else if (/(?:外|そと|外側|そとがわ)(?:を|へ|に)?(?:向|むい|むか|むけ|むき)/.test(n) || /外向き|そとむき/.test(n)) P.face = 'out';
    else if (/(?:客席|きゃくせき|正面|しょうめん|お客さん?|前|まえ)(?:を|へ|に|側)?(?:向|むい|むか|むけ|むき)/.test(n) || /客席向き|正面向き|前向き|まえむき/.test(n)) P.face = 'front';
    else if (/(?:奥|おく|後ろ|うしろ|背中|せなか)(?:を|へ|に|側)?(?:向|むい|むか|むけ|むき)/.test(n) || /後ろ向き|うしろむき|奥向き|おくむき/.test(n)) P.face = 'back';
    else if (/(?:上手|かみて)(?:を|へ|に|側)?(?:向|むい|むか|むけ|むき)/.test(n) || /上手向き|かみてむき/.test(n)) P.face = 'kami';
    else if (/(?:下手|しもて)(?:を|へ|に|側)?(?:向|むい|むか|むけ|むき)/.test(n) || /下手向き|しもてむき/.test(n)) P.face = 'shimo';
    else if (/(?:右|みぎ)(?:を|へ|に)?(?:向|むい|むか|むけ|むき)/.test(n)) P.face = 'kami';
    else if (/(?:左|ひだり)(?:を|へ|に)?(?:向|むい|むか|むけ|むき)/.test(n)) P.face = 'shimo';
    else { const d = P.nums.find(q => q.u === 'deg'); if (d && /向|むき|むい|むか|むけ|顔/.test(n)) P.face = String(d.v); }
  }
  for (const id of POSE_IDS) if (lexHas('p_' + id, n)) { P.pose = id; break; }
  for (const id of CARRY_IDS) { if (id === 'play' ? /(?:演奏|えんそう)(?:の)?(?:構え|かまえ|ぽーず|姿勢|状態)|吹く構え|吹き構え|構え.{0,3}演奏|構えを(?:演奏|吹)/.test(n) : lexHas('c_' + id, n) && /構え|かまえ|持|担|かつ/.test(n)) { P.carry = id; break; } }
  if (!P.carry) { if (/右手|みぎて|右肩/.test(n) && /持|構え|かまえ|担|かつ/.test(n)) P.carry = 'right'; else if (/左手|ひだりて|左肩/.test(n) && /持|構え|かまえ|担|かつ/.test(n)) P.carry = 'left'; }
  for (const [id, k] of STEP_IDS) if (lexHas('t_' + k, n)) { P.stepStyle = id === 'backmarch' ? 'back' : id; break; }
  for (const id of ACT_IDS) if (lexHas('x_' + id, n)) { P.action = id; break; }
  // 11) 表示まわり
  P.gridMode = /1歩ごと|いっぽごと|歩ごと|歩単位|歩(?:の|で)|すてっぷ(?:の)?ぐりっど/.test(n) ? 'step' : /細かい|こまかい|1m|めーとる|細かく|こまかく|fine/.test(n) ? 'fine' : /標準|ふつう|普通|のーまる|normal|粗い|あらい|大きい|5m(?!ぽいんと)|おおまか/.test(n) ? 'normal' : null;
  P.onoff = /(?:消|けし|けす|隠|かく(?!に)|おふ|off|なし|非表示|やめ|外し|はずし|いらない)/.test(n) ? 'off' : /(?:表示|出し|だし|出す|つけ|付け|おん|on|見せ|入れ|いれ|有効)/.test(n) ? 'on' : null;
  P.zoom = /縮小|ちいさく表示|小さく表示|引い|ひい|ずーむあうと|ずーむあうと|離れ|はなれ/.test(n) ? 'out' : /全体|ぜんたい|ふぃっと|ふぃっと|収ま|おさま|ぴったり表示/.test(n) ? 'fit' : /拡大|かくだい|大きく|おおきく|寄|あっぷ|ずーむいん|ずーむいん/.test(n) ? 'in' : null;
  P.tool = /直線|ちょくせん|らいん|line/.test(n) ? 'line' : /曲線|きょくせん|かーぶ/.test(n) ? 'curve' : /円弧|えんこ|弧|あーく/.test(n) ? 'arc' : /円|えん|さーくる/.test(n) ? 'circle' : /ふぉろー|follow/.test(n) ? 'follow' : /ぶろっく|四角/.test(n) ? 'block' : /選択|せんたく|矢印|やじるし|かーそる|普通の|ふつうの/.test(n) ? 'select' : null;
  // 12) 程度のことば
  P.little = /少し|すこし|ちょっと|ちょい|ほんの|わずか|軽く|かるく|ちょこっと|ちょびっと/.test(n);
  P.much = /かなり|思い切|おもいきっ|ぐっと|たくさん|うんと|大幅|おおはば|めっちゃ|すごく|もっと大きく|ばっと/.test(n);
  P.half = /半分|はんぶん/.test(n);
  P.plus = /長く|ながく|のばし|伸ばし|延ばし|増や|ふや|足し|たし|上げ|あげ|あっぷ|速く|はやく|早く|はやめ|速め|多く|おおく|大きく|おおきく/.test(n);
  P.minus = /短く|みじかく|縮め|ちぢめ|減ら|へら|下げ|さげ|だうん|遅く|おそく|ゆっくり|遅め|おそめ|少なく|すくなく|小さく|ちいさく/.test(n);
  // 13) 数の並び（8 8 16）
  {
    const list = [], re = /(\d+(?:\.\d+)?)(?:\s*(?:拍|はく|かうんと|count|びーと))?/g; let m;
    const spans = []; while ((m = re.exec(w)) !== null) spans.push({v: parseFloat(m[1]), i: m.index, e: m.index + m[0].length});
    // 区切り（空白・、・,・と・→）だけでつながった連続を探す
    let best = []; let cur = [];
    for (let i = 0; i < spans.length; i++) {
      if (cur.length && /^[\s、,と→\-・]*$/.test(w.slice(cur[cur.length - 1].e, spans[i].i))) cur.push(spans[i]); else cur = [spans[i]];
      if (cur.length > best.length) best = cur.slice();
    }
    for (const s of best) list.push(s.v);
    P.numList = list.length >= 2 ? list : null;
    const rep = /(\d+(?:\.\d+)?)\s*(?:拍|はく|かうんと|count)?\s*(?:の|を|で)?\s*(?:せっと)?\s*(?:を)?\s*(\d+)\s*(?:つ|個|こ|せっと)/.exec(w);
    P.repeat = rep ? {counts: parseFloat(rep[1]), times: parseInt(rep[2], 10)} : null;
  }
  return P;
}

// ===================================================================== 対象 → メンバー
function targetOf(P) {
  const t = {};
  if (P.ids.length) t.ids = P.ids.slice();
  if (P.secs.length) t.secs = P.secs.slice();
  if (P.nth.length) t.nth = P.nth.slice();
  const explicit = P.ids.length || P.secs.length;
  if (P.all && !explicit) t.all = true;
  if (P.sel && !explicit) t.sel = true;
  if (P.region) t.region = P.region;
  if (P.parity) t.parity = P.parity;
  return Object.keys(t).length ? t : null;
}
const memNum = (m, ctx) => { const sid = ((ctx.sections || [])[m.sec] || {}).id || ''; const k = parseInt(String(m.id).slice(sid.length), 10); return Number.isFinite(k) ? k : NaN; };
function rowsOf(ms) {   // y が近い人をひとまとまり（列）にする。前（y が小さい）から順
  const ys = ms.map(m => m.y).sort((a, b) => a - b);
  if (!ys.length) return [];
  const gaps = []; for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
  const pos = gaps.filter(g => g > 0.05).sort((a, b) => a - b);
  const tol = pos.length ? Math.max(0.35, Math.min(pos[Math.floor(pos.length / 2)] * 0.5, 1.2)) : 0.35;
  const sorted = ms.slice().sort((a, b) => a.y - b.y), rows = [];
  for (const m of sorted) { const r = rows[rows.length - 1]; if (r && m.y - r[r.length - 1].y <= tol) r.push(m); else rows.push([m]); }
  return rows;
}
function resolveTarget(t, ctx) {
  const all = ctx.members || [];
  const byId = new Map(all.map(m => [m.id, m]));
  const sel = (ctx.sel || []).map(id => byId.get(id)).filter(Boolean);
  let base;
  if (!t) base = sel.slice();
  else {
    if (t.ids) base = t.ids.map(id => byId.get(id)).filter(Boolean);
    else if (t.secs) base = all.filter(m => t.secs.includes(m.sec));
    else if (t.all) base = all.slice();
    else if (t.nth && !t.ids) base = null;
    else if (t.sel || t.region || t.parity) base = sel.length ? sel.slice() : (t.region || t.parity ? all.slice() : []);
    else base = sel.slice();
    if (t.nth && t.nth.length) {   // 3番 → 対象のセクション（選択中・指定・唯一）の 3 番
      const secs = t.secs ? t.secs : base && base.length ? [...new Set(base.map(m => m.sec))] : sel.length ? [...new Set(sel.map(m => m.sec))] : ((ctx.sections || []).length === 1 ? [0] : []);
      const pool = (t.ids ? [] : all.filter(m => secs.includes(m.sec)));
      base = pool.filter(m => t.nth.includes(memNum(m, ctx)));
    }
    if (base && t.parity) base = base.filter(m => { const k = memNum(m, ctx); return Number.isFinite(k) && (t.parity === 'odd' ? k % 2 === 1 : k % 2 === 0); });
    if (base && t.region) {
      const ms = base; if (!ms.length) base = [];
      else if (t.region === 'front-row') base = rowsOf(ms)[0] || [];
      else if (t.region === 'back-row') { const r = rowsOf(ms); base = r[r.length - 1] || []; }
      else {
        const byX = ms.slice().sort((a, b) => a.x - b.x || a.y - b.y), byY = ms.slice().sort((a, b) => a.y - b.y || a.x - b.x), half = Math.ceil(ms.length / 2);
        if (t.region === 'left-half') base = byX.slice(0, half); else if (t.region === 'right-half') base = byX.slice(ms.length - half);
        else if (t.region === 'front-half') base = byY.slice(0, half); else if (t.region === 'back-half') base = byY.slice(ms.length - half);
        else if (t.region === 'left-end') { const x0 = byX[0].x; base = ms.filter(m => Math.abs(m.x - x0) < 0.35); }
        else if (t.region === 'right-end') { const x0 = byX[byX.length - 1].x; base = ms.filter(m => Math.abs(m.x - x0) < 0.35); }
        else if (t.region === 'center') { const cx = ms.reduce((s, m) => s + m.x, 0) / ms.length, cy = ms.reduce((s, m) => s + m.y, 0) / ms.length; base = ms.slice().sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, Math.max(1, Math.ceil(ms.length / 3))); }
      }
    }
  }
  return (base || []).map(m => m.id);
}
function describeTarget(t, ctx, ids) {
  ids = ids || resolveTarget(t, ctx);
  const n = ids.length, secs = ctx.sections || [];
  const cnt = `（${n}人）`;
  if (!t) return n ? `選んだ人${cnt}` : '選んだ人';
  let name;
  if (t.region && !t.secs && !t.ids) name = (t.sel ? '選んだ人の' : t.all ? '全員の' : '') + REGION_JA[t.region];
  else if (t.ids) name = t.ids.length > 4 ? `${t.ids[0]}〜${t.ids[t.ids.length - 1]}` : t.ids.join('・');
  else if (t.nth && !t.secs) name = t.nth.map(k => k + '番').join('・');
  else if (t.secs) name = t.secs.map(i => (secs[i] || {}).label || '?').join('・') + (t.nth ? t.nth.map(k => k + '番').join('・') : '') + (t.region ? 'の' + REGION_JA[t.region] : '');
  else if (t.all) name = '全員';
  else name = '選んだ人';
  if (t.parity) name += t.parity === 'odd' ? '（奇数番）' : '（偶数番）';
  return name + cnt;
}

// ===================================================================== 意図の一覧（型つきの行動）
// args: 値の名前。req: 必須。destructive: 確認が要る。ex: 例文。grp: 例の見出し
const CAT = {
  select_all: {ja: '全員を選ぶ', grp: '選ぶ', req: [], ex: '全員を選んで'},
  select: {ja: 'セクション・番号・列を選ぶ', grp: '選ぶ', req: ['target'], ex: 'トランペットを選んで'},
  select_none: {ja: '選択を解除', grp: '選ぶ', req: [], ex: '選択を解除'},
  select_invert: {ja: '選択を反転（残りを選ぶ）', grp: '選ぶ', req: [], ex: '残りの人を選んで'},
  move: {ja: '動かす', grp: '動かす', req: ['target', 'dirs', 'amount'], ex: 'トランペットを前に3歩動かして'},
  move_to: {ja: 'センターに集める', grp: '動かす', req: ['target'], ex: '全員センターに寄せて'},
  rotate: {ja: '回転', grp: '動かす', req: ['target', 'deg'], ex: '時計回りに90度回して'},
  scale: {ja: '広げる・狭める', grp: '動かす', req: ['target', 'factor'], ex: '少し広げて'},
  spacing: {ja: '間隔を決める', grp: '動かす', req: ['target', 'value'], ex: '間隔を2歩にして'},
  flip: {ja: '反転', grp: '動かす', req: ['target', 'axis'], ex: '左右反転して'},
  swap: {ja: '入れ替え', grp: '動かす', req: ['a', 'b'], ex: 'トランペットとトロンボーンを入れ替えて'},
  arrange_line: {ja: '直線に並べる', grp: '並べる', req: ['target'], ex: '横一列に並べて'},
  arrange_curve: {ja: '曲線に並べる', grp: '並べる', req: ['target'], ex: 'ゆるやかな曲線にして'},
  arrange_arc: {ja: '弧に並べる', grp: '並べる', req: ['target'], ex: '弧にして'},
  arrange_circle: {ja: '円に並べる', grp: '並べる', req: ['target'], ex: '円にして'},
  arrange_block: {ja: 'ブロックに並べる', grp: '並べる', req: ['target'], ex: '4列のブロックにして'},
  arrange_wedge: {ja: 'くさび（V字）に並べる', grp: '並べる', req: ['target'], ex: 'くさび形にして'},
  arrange_diag: {ja: '斜めに並べる', grp: '並べる', req: ['target'], ex: '斜めに並べて'},
  arrange_follow: {ja: 'フォローにする', grp: '並べる', req: ['target'], ex: 'フォローにして'},
  unpin: {ja: '個別の位置を解除', grp: '並べる', req: ['target'], ex: '個別の位置を解除して'},
  delete_members: {ja: '人を削除', grp: '人を増やす・減らす', req: ['target'], destructive: true, ex: 'tp3を削除して'},
  add_members: {ja: '人を追加', grp: '人を増やす・減らす', req: ['target', 'count'], ex: 'トランペットを2人増やして'},
  duplicate_members: {ja: '複製', grp: '人を増やす・減らす', req: ['target'], ex: '選んだ人を複製して'},
  copy_members: {ja: '位置をコピー', grp: '人を増やす・減らす', req: ['target'], ex: '位置をコピーして'},
  paste_members: {ja: '位置を貼り付け', grp: '人を増やす・減らす', req: [], ex: '位置を貼り付けて'},
  cut_members: {ja: '切り取り', grp: '人を増やす・減らす', req: ['target'], destructive: true, ex: '選んだ人を切り取って'},
  set_add: {ja: 'セットを追加', grp: 'セット', req: [], ex: 'セットを8拍で追加'},
  set_bulk: {ja: 'セットをまとめて作る', grp: 'セット', req: ['counts'], ex: '8 8 16でセットを作って'},
  set_split: {ja: 'セットを分割', grp: 'セット', req: ['at'], ex: '8カウントで分割して'},
  set_cut: {ja: 'セットをカット', grp: 'セット', req: ['at'], ex: '8カウントでカットして'},
  set_copy: {ja: 'セットをコピー', grp: 'セット', req: [], ex: 'このセットをコピー'},
  set_paste: {ja: 'セットを貼り付け', grp: 'セット', req: [], ex: 'セットを貼り付けて'},
  set_dup: {ja: 'セットを複製', grp: 'セット', req: [], ex: 'このセットを複製して'},
  set_delete: {ja: 'セットを削除', grp: 'セット', req: [], destructive: true, ex: 'このセットを削除して'},
  set_next: {ja: '次のセットへ', grp: 'セット', req: [], ex: '次のセットへ'},
  set_prev: {ja: '前のセットへ', grp: 'セット', req: [], ex: '前のセットへ'},
  set_goto: {ja: 'セットへ移動', grp: 'セット', req: ['to'], ex: 'セット3へ移動'},
  set_move: {ja: 'セットを前後に動かす', grp: 'セット', req: ['dir'], ex: 'このセットを後ろへ動かして'},
  set_mirror: {ja: 'セットを左右反転', grp: 'セット', req: [], ex: 'このセットを左右反転して'},
  set_counts: {ja: 'セットの長さ（カウント）', grp: '時間', req: ['value'], ex: 'このセットを16拍にして'},
  set_hold: {ja: 'ホールド（その場で止まる）', grp: '時間', req: ['value'], ex: 'ホールドを8拍にして'},
  tempo: {ja: 'テンポ', grp: '時間', req: ['value'], ex: 'テンポを120にして'},
  face: {ja: '向き', grp: '向き・姿勢', req: ['target', 'value'], ex: '全員客席を向いて'},
  pose: {ja: '姿勢', grp: '向き・姿勢', req: ['target', 'value'], ex: '気をつけにして'},
  carry: {ja: '楽器の構え', grp: '向き・姿勢', req: ['target', 'value'], ex: '演奏の構えにして'},
  step_style: {ja: 'ステップ（歩き方）', grp: '向き・姿勢', req: ['target', 'value'], ex: 'グライドで歩いて'},
  action: {ja: '動作（スピン・トスなど）', grp: '向き・姿勢', req: ['target', 'value'], ex: 'スピンにして'},
  auto_fix: {ja: '自動で直す', grp: '自動', req: [], ex: 'ぶつかりを自動で直して'},
  parade: {ja: 'パレードを作る', grp: '自動', req: [], ex: 'パレードを作りたい'},
  play: {ja: '再生', grp: '再生・出力', req: [], ex: '再生して'},
  stop: {ja: '停止', grp: '再生・出力', req: [], ex: '止めて'},
  view_3d: {ja: '3Dで見る', grp: '再生・出力', req: [], ex: '3Dで見せて'},
  export_video: {ja: '動画を書き出す', grp: '再生・出力', req: [], ex: '動画を書き出して'},
  print: {ja: '印刷', grp: '再生・出力', req: [], ex: '印刷したい'},
  save: {ja: '保存', grp: '再生・出力', req: [], ex: '保存して'},
  undo: {ja: '元に戻す', grp: '再生・出力', req: [], ex: '元に戻して'},
  redo: {ja: 'やり直す', grp: '再生・出力', req: [], ex: 'やり直して'},
  grid: {ja: 'グリッドの細かさ', grp: '表示', req: ['mode'], ex: 'グリッドを細かくして'},
  grid_points: {ja: '5mポイントの表示', grp: '表示', req: ['on'], ex: '5mポイントを出して'},
  snap: {ja: '吸着の刻み', grp: '表示', req: ['value'], ex: '吸着を1mにして'},
  zoom: {ja: '拡大・縮小・全体表示', grp: '表示', req: ['dir'], ex: '全体を表示して'},
  names: {ja: '名前の表示', grp: '表示', req: ['on'], ex: '名前を出して'},
  tool: {ja: 'ツールを選ぶ', grp: '表示', req: ['tool'], ex: '直線ツールにして'},
  help: {ja: '使い方・検索', grp: 'ヘルプ', req: [], ex: '使い方を教えて'},
  none: {ja: 'わからない', grp: '', req: [], ex: ''}
};
const INTENTS = Object.keys(CAT);

// ===================================================================== 意図ごとの値の決め方（値が足りなければ missing に質問を入れる）
const lastOf = a => a[a.length - 1];
function secChoices(ctx, key, prefix) {
  const out = [{label: '全員', patch: {[key]: {all: true}}}];
  (ctx.sections || []).slice(0, 5).forEach((s, i) => out.push({label: s.label, patch: {[key]: {secs: [i]}}}));
  return out.slice(0, 6).map(c => (prefix ? Object.assign({}, c, {label: prefix + c.label}) : c));
}
function needTarget(P, ctx, out, key, q) {
  key = key || 'target';
  const t = targetOf(P);
  out.args[key] = t;
  const ids = resolveTarget(t, ctx);
  if (t && t.nth && !t.secs && !t.ids && !ids.length) {   // 3番 だけで、どのセクションか決まらない
    const secs = ctx.sections || [];
    if (secs.length > 1) { out.missing.push({slot: key, q: 'どのセクションの' + t.nth.map(k => k + '番').join('・') + 'ですか？', choices: secs.slice(0, 6).map((s, i) => ({label: s.label, patch: {[key]: {secs: [i], nth: t.nth}}}))}); return false; }
  }
  if (!t && !(ctx.sel || []).length) { out.missing.push({slot: key, q: q || 'だれに行いますか？', choices: secChoices(ctx, key)}); return false; }
  if (t && !ids.length && !(t.sel && !(ctx.sel || []).length)) { out.missing.push({slot: key, q: '対象の人が見つかりません。だれに行いますか？', choices: secChoices(ctx, key)}); return false; }
  if (t && t.sel && !ids.length) { out.missing.push({slot: key, q: '選んでいる人がいません。だれに行いますか？', choices: secChoices(ctx, key)}); return false; }
  return true;
}
const unitToLen = (v, unit, ctx) => {   // 歩・m・ポイント → 画面の長さの単位（体育館などは m、フットボールは歩）
  const st = ctx.stride || 0.625, fb = ctx.field && ctx.field.type === 'football';
  const m = unit === 'step' ? v * st : unit === 'point' ? v * 5 : unit === 'cm' ? v / 100 : v;
  return fb ? m / st : m;
};
const STEPS_N = v => Math.round(v * 100) / 100;
function amountOf(P, ctx) {   // 歩・m・ポイントの量
  const q = P.nums.find(x => x.u === 'step' || x.u === 'm' || x.u === 'cm' || x.u === 'point');
  if (q) return {v: q.v, unit: q.u};
  if (/半歩/.test(P.n)) return {v: 0.5, unit: 'step'};
  const b = P.nums.find(x => x.u == null);
  if (b) return {v: b.v, unit: 'step'};
  if (P.little) return {v: 1, unit: 'step', approx: true};
  if (P.much) return {v: 5, unit: 'step', approx: true};
  return null;
}
function setRefOf(P, ctx) {
  if (P.setRef) {
    const names = (ctx.sets || []).map(norm), i = names.indexOf(P.setRef.name != null ? norm(P.setRef.name) : '');
    if (P.setRef.name != null) { if (i >= 0) return {index: i}; const n = parseInt(P.setRef.name, 10); if (/^\d+$/.test(P.setRef.name) && n >= 1) return {index: n - 1}; return {name: P.setRef.name}; }
    return {index: P.setRef.index};
  }
  if (P.setFirst) return {first: true};
  if (P.setLast) return {last: true};
  return null;
}
const FACE_JA = {front: '客席', back: '奥', kami: '上手', shimo: '下手', center: '中心', out: '外側', travel: '進行方向'};
const POSE_JA = {attention: '気をつけ', rest: '休め', wide: '足開き', cross: 'クロス', kneel: '片膝', kneel2: '膝つき', lunge: 'ランジ', crouch: 'しゃがみ', toe: 'つま先'};
const CARRY_JA = {play: '演奏', right: '右手', left: '左手', front: '正面', diag: '斜め'};
const STEP_JA = {glide: 'グライド', back: 'バックマーチ', slide: 'スライド', jazz: 'ジャズラン', high: 'ハイステップ'};
const ACT_JA = {spin: 'スピン', toss: 'トス', swing: 'スイング', rest: 'レスト'};
const TOOL_JA = {select: '選択', line: '直線', arc: '弧', circle: '円', curve: '曲線', follow: 'フォロー', block: 'ブロック'};
const GRID_JA = {step: '1歩ごと', fine: '細かい（1m）', normal: '標準'};
const ARR_KIND = {arrange_line: 'line', arrange_curve: 'curve', arrange_arc: 'arc', arrange_circle: 'circle', arrange_block: 'block', arrange_wedge: 'wedge', arrange_diag: 'diag', arrange_follow: 'follow'};

const RESOLVE = {
  select_all: () => ({}),
  select_none: () => ({}),
  select_invert: () => ({}),
  select(P, ctx, o) {
    const t = targetOf(P); o.args.target = t;
    if (!t || !(t.secs || t.ids || t.all || t.nth || t.region || t.parity)) { o.missing.push({slot: 'target', q: 'だれを選びますか？（セクション・番号・前の列など）', choices: secChoices(ctx, 'target')}); return; }
    needTarget(P, ctx, o);
  },
  move(P, ctx, o) {
    needTarget(P, ctx, o);
    o.args.dirs = P.dirs.slice(0, 2);
    if (!P.dirs.length) o.missing.push({slot: 'dirs', q: 'どちらへ動かしますか？', choices: ['front', 'back', 'kami', 'shimo'].map(d => ({label: DIRJA[d], patch: {dirs: [d]}}))});
    const a = amountOf(P, ctx); o.args.amount = a;
    if (!a) o.missing.push({slot: 'amount', q: 'どれだけ動かしますか？', choices: [1, 2, 4, 8].map(v => ({label: v + '歩', patch: {amount: {v, unit: 'step'}}}))});
  },
  move_to(P, ctx, o) { if (P.region === 'center') P.region = null; needTarget(P, ctx, o); o.args.dest = 'center'; },
  rotate(P, ctx, o) {
    needTarget(P, ctx, o);
    let deg = P.deg;
    if (deg == null) { const q = P.nums.find(x => x.u == null); if (q) deg = q.v; else if (P.little) deg = 15; else if (P.half) deg = 180; }
    o.args.cw = !(P.ccw && !P.cw);
    if (deg == null) o.missing.push({slot: 'deg', q: '何度回しますか？', choices: [15, 45, 90, 180].map(v => ({label: v + '度', patch: {deg: v}}))}); else o.args.deg = deg;
  },
  scale(P, ctx, o) {
    needTarget(P, ctx, o);
    const shrink = lexHas('v_shrink', P.n) && !lexHas('v_expand', P.n) || (P.minus && !P.plus && !lexHas('v_expand', P.n));
    let f = null;
    const x = P.nums.find(q => q.u === 'x'), wr = P.nums.find(q => q.u === 'wari'), pc = P.nums.find(q => q.u === 'pct');
    if (P.half && !x) f = 0.5;
    else if (x) f = x.v;
    else if (wr) f = shrink ? 1 - wr.v / 10 : 1 + wr.v / 10;
    else if (pc) f = pc.v > 5 ? pc.v / 100 : shrink ? 1 - pc.v / 100 : 1 + pc.v / 100;
    else if (P.little) f = shrink ? 1 / 1.1 : 1.1;
    else if (P.much) f = shrink ? 0.6 : 1.6;
    else f = shrink ? 1 / 1.25 : 1.25;
    f = Math.round(f * 1000) / 1000;
    if (!(f > 0.05 && f < 20)) { o.missing.push({slot: 'factor', q: 'どれくらい変えますか？', choices: [{label: '少し広げる', patch: {factor: 1.1}}, {label: '広げる', patch: {factor: 1.25}}, {label: '少し狭める', patch: {factor: 1 / 1.1}}, {label: '狭める', patch: {factor: 0.8}}]}); return; }
    o.args.factor = f;
  },
  spacing(P, ctx, o) {
    needTarget(P, ctx, o);
    const a = amountOf(P, ctx);
    if (!a) o.missing.push({slot: 'value', q: '間隔を何歩にしますか？', choices: [1, 2, 3, 4].map(v => ({label: v + '歩', patch: {value: {v, unit: 'step'}}}))}); else o.args.value = a;
  },
  flip(P, ctx, o) {
    needTarget(P, ctx, o);
    const ud = /前後|ぜんご|上下|じょうげ|奥と手前|客席と奥|縦(?:に)?(?:反転|ひっくり)|縦反転|たてはんてん/.test(P.n), lr = /左右|さゆう|上手と下手|横(?:に)?(?:反転|ひっくり)|横反転|みらー|よこはんてん/.test(P.n);
    o.args.axis = ud && !lr ? 'y' : lr && !ud ? 'x' : null;
    if (!o.args.axis) o.missing.push({slot: 'axis', q: 'どちら向きに反転しますか？', choices: [{label: '左右に反転', patch: {axis: 'x'}}, {label: '前後に反転', patch: {axis: 'y'}}]});
  },
  swap(P, ctx, o) {
    const groups = [];
    if (P.ids.length >= 2) P.ids.forEach(id => groups.push({ids: [id]}));
    else if (P.secs.length >= 2) P.secs.slice(0, 2).forEach(si => groups.push({secs: [si]}));
    else if (P.ids.length === 1 && P.secs.length === 1) { groups.push({ids: [P.ids[0]]}); groups.push({secs: [P.secs[0]]}); }
    if (groups.length < 2 && P.nth.length >= 2) { const sels = [...new Set((ctx.sel || []).map(id => (ctx.members.find(m => m.id === id) || {}).sec))]; const si = P.secs.length ? P.secs[0] : sels.length === 1 ? sels[0] : (ctx.sections || []).length === 1 ? 0 : null; if (si != null) P.nth.slice(0, 2).forEach(k => groups.push({ids: [ctx.sections[si].id + k]})); }
    if (groups.length < 2) { o.missing.push({slot: 'a', q: '入れ替える2つ（人・セクション）をもう一度教えてください', choices: ((ctx.sections || []).length > 1 ? [{label: `${ctx.sections[0].label}と${ctx.sections[1].label}`, patch: {a: {secs: [0]}, b: {secs: [1]}}}] : [])}); return; }
    o.args.a = groups[0]; o.args.b = groups[1];
    const na = resolveTarget(o.args.a, ctx).length, nb = resolveTarget(o.args.b, ctx).length;
    if (!na || !nb) o.missing.push({slot: 'a', q: '入れ替える人が見つかりません', choices: []});
    else if (na !== nb) o.missing.push({slot: 'b', q: `人数が違います（${na}人と${nb}人）。同じ人数のどうしで入れ替えられます`, choices: []});
  },
  arrange(P, ctx, o, kind) {
    const t = targetOf(P); o.args.target = t;
    const ids = resolveTarget(t, ctx);
    if (!t && !(ctx.sel || []).length) o.missing.push({slot: 'target', q: 'だれを並べますか？', choices: secChoices(ctx, 'target')});
    else if (ids.length < 2 && kind !== 'follow') o.missing.push({slot: 'target', q: '2人以上の対象が必要です。だれを並べますか？', choices: secChoices(ctx, 'target')});
    o.args.kind = kind;
    const a = P.nums.find(x => x.u === 'step' || x.u === 'm' || x.u === 'point');
    if (a && /間隔|かんかく|ずつ|おき/.test(P.n)) o.args.spacing = {v: a.v, unit: a.u};
    if (kind === 'block') { const c = P.nums.find(x => x.u === 'row') || null; if (c) o.args.cols = c.v; if (c && /行|ぎょう|段|だん/.test(P.n) && !/列|れつ/.test(P.n)) { delete o.args.cols; o.args.rows = c.v; } }
    if (kind === 'line' && P.orient) o.args.orient = P.orient;
  },
  unpin(P, ctx, o) { needTarget(P, ctx, o); },
  delete_members(P, ctx, o) { needTarget(P, ctx, o, 'target', 'だれを削除しますか？'); const t = o.args.target; if (t && t.all && !(t.secs || t.ids)) o.missing.push({slot: 'target', q: '全員は削除できません。だれを削除しますか？', choices: secChoices(ctx, 'target').slice(1)}); },
  add_members(P, ctx, o) {
    const c = P.nums.find(x => x.u === 'person' || x.u === 'tsu') || P.nums.find(x => x.u == null);
    o.args.count = c ? Math.max(1, Math.round(c.v)) : 1;
    const t = targetOf(P); o.args.target = t;
    if (!t && !(ctx.sel || []).length) o.missing.push({slot: 'target', q: 'どのセクションを増やしますか？', choices: (ctx.sections || []).slice(0, 6).map((s, i) => ({label: s.label, patch: {target: {secs: [i]}}}))});
    else if (t && t.all && !t.secs) o.missing.push({slot: 'target', q: 'どのセクションを増やしますか？', choices: (ctx.sections || []).slice(0, 6).map((s, i) => ({label: s.label, patch: {target: {secs: [i]}}}))});
    else if (t && !resolveTarget(t, ctx).length) o.missing.push({slot: 'target', q: '対象が見つかりません。どのセクションを増やしますか？', choices: (ctx.sections || []).slice(0, 6).map((s, i) => ({label: s.label, patch: {target: {secs: [i]}}}))});
  },
  duplicate_members(P, ctx, o) { needTarget(P, ctx, o); },
  copy_members(P, ctx, o) { needTarget(P, ctx, o, 'target', 'だれの位置をコピーしますか？'); },
  paste_members() { return {}; },
  cut_members(P, ctx, o) { needTarget(P, ctx, o, 'target', 'だれを切り取りますか？'); },
  set_add(P, ctx, o) {
    const q = P.nums.find(x => x.u === 'count' || x.u === 'bar' || x.u == null);
    if (q) o.args.counts = q.u === 'bar' ? q.v * (ctx.beatsPerBar || 4) : q.v;
    o.args.where = /最後|さいご|終わり|おわり|末尾|らすと/.test(P.n) ? 'end' : null;
    o.args.hold = /その場|そのば|ほーるど|止まった|動かない|同じ(?:まま|隊形)/.test(P.n) ? 'hold' : null;
  },
  set_bulk(P, ctx, o) {
    if (P.numList) o.args.counts = P.numList.map(v => v);
    else if (P.repeat) o.args.counts = Array(Math.min(P.repeat.times, 64)).fill(P.repeat.counts);
    else { const t = P.nums.find(x => x.u === 'set' || x.u === 'tsu'); const c = P.nums.find(x => x.u === 'count'); if (t && c) o.args.counts = Array(Math.min(t.v, 64)).fill(c.v); }
    if (!o.args.counts) o.missing.push({slot: 'counts', q: '何カウントのセットを作りますか？（例: 8 8 16）', choices: [{label: '8 8 8 8', patch: {counts: [8, 8, 8, 8]}}, {label: '8 8 16', patch: {counts: [8, 8, 16]}}, {label: '16 16', patch: {counts: [16, 16]}}]});
    else if (o.args.counts.some(v => !(v > 0 && v <= 999))) { o.missing.push({slot: 'counts', q: 'カウントは 1〜999 で教えてください', choices: []}); }
  },
  set_split(P, ctx, o) { atCount(P, ctx, o, '分割'); },
  set_cut(P, ctx, o) { atCount(P, ctx, o, 'カット'); },
  set_copy() { return {}; }, set_paste() { return {}; }, set_dup() { return {}; }, set_delete() { return {}; }, set_next() { return {}; }, set_prev() { return {}; }, set_mirror() { return {}; },
  set_goto(P, ctx, o) {
    const r = setRefOf(P, ctx);
    if (r) { o.args.to = r; if (r.index != null && (r.index < 0 || r.index >= (ctx.sets || []).length)) { o.missing.push({slot: 'to', q: `セット ${r.index + 1} はありません（全部で ${(ctx.sets || []).length} セット）`, choices: []}); } else if (r.name != null) o.missing.push({slot: 'to', q: `セット「${r.name}」は見つかりません`, choices: []}); return; }
    const q = P.nums.find(x => x.u == null || x.u === 'set' || x.u === 'ban');
    if (q) { o.args.to = {index: q.v - 1}; if (q.v < 1 || q.v > (ctx.sets || []).length) o.missing.push({slot: 'to', q: `セット ${q.v} はありません（全部で ${(ctx.sets || []).length} セット）`, choices: []}); return; }
    o.missing.push({slot: 'to', q: 'どのセットへ移りますか？', choices: [{label: '最初', patch: {to: {first: true}}}, {label: '最後', patch: {to: {last: true}}}, {label: '次', patch: {to: {rel: 1}}}, {label: '前', patch: {to: {rel: -1}}}]});
  },
  set_move(P, ctx, o) { const back = /後ろ|うしろ|次|つぎ|右|みぎ|あと/.test(P.n), fwd = /前|まえ|左|ひだり|先/.test(P.n); if (back === fwd) o.missing.push({slot: 'dir', q: '前へ動かしますか？後ろへ動かしますか？', choices: [{label: '前へ', patch: {dir: 'prev'}}, {label: '後ろへ', patch: {dir: 'next'}}]}); else o.args.dir = back ? 'next' : 'prev'; },
  set_counts(P, ctx, o) {
    const q = P.nums.find(x => x.u === 'count' || x.u === 'bar') || P.nums.find(x => x.u == null);
    const val = q ? (q.u === 'bar' ? q.v * (ctx.beatsPerBar || 4) : q.v) : null;
    if (val != null && (P.plus || P.minus) && /(?:長く|ながく|のばし|伸ばし|延ばし|増や|ふや|足し|短く|みじかく|縮め|ちぢめ|減ら|へら)/.test(P.n) && !/(?:に|へ)して|にする|にしたい|にな/.test(P.n)) o.args.value = {rel: P.minus && !P.plus ? -val : val};
    else if (val != null) o.args.value = {abs: val};
    else if (P.plus && !P.minus) o.args.value = {rel: 4}; else if (P.minus && !P.plus) o.args.value = {rel: -4};
    else o.missing.push({slot: 'value', q: '何カウントにしますか？', choices: [4, 8, 16, 32].map(v => ({label: v + 'カウント', patch: {value: {abs: v}}}))});
  },
  set_hold(P, ctx, o) {
    const q = P.nums.find(x => x.u === 'count' || x.u === 'bar') || P.nums.find(x => x.u == null);
    if (q) o.args.value = {abs: q.u === 'bar' ? q.v * (ctx.beatsPerBar || 4) : q.v};
    else if (P.minus || /なし|無し|なく|ぜろ|0/.test(P.n)) o.args.value = {abs: 0};
    else o.missing.push({slot: 'value', q: '何カウント止まりますか？', choices: [0, 4, 8, 16].map(v => ({label: v === 0 ? 'なし' : v + 'カウント', patch: {value: {abs: v}}}))});
  },
  tempo(P, ctx, o) {
    const q = P.nums.find(x => x.u == null || x.u === 'x') || null;
    if (q && q.u === 'x') { o.args.value = {mul: q.v}; return; }
    if (q && q.v >= 30 && q.v <= 300) { o.args.value = {abs: q.v}; return; }
    if (P.plus && !P.minus) o.args.value = {rel: P.little ? 5 : 10}; else if (P.minus && !P.plus) o.args.value = {rel: P.little ? -5 : -10};
    else o.missing.push({slot: 'value', q: 'テンポをいくつにしますか？', choices: [{label: '少し速く', patch: {value: {rel: 5}}}, {label: '少し遅く', patch: {value: {rel: -5}}}, {label: '120', patch: {value: {abs: 120}}}, {label: '140', patch: {value: {abs: 140}}}]});
  },
  face(P, ctx, o) {
    needTarget(P, ctx, o);
    if (P.face != null) o.args.value = P.face;
    else if (P.clear) o.args.value = '';
    else o.missing.push({slot: 'value', q: 'どちらを向きますか？', choices: ['front', 'back', 'kami', 'shimo', 'center', 'out'].map(v => ({label: FACE_JA[v], patch: {value: v}}))});
  },
  pose(P, ctx, o) { needTarget(P, ctx, o); if (P.pose) o.args.value = P.pose; else if (P.clear) o.args.value = ''; else o.missing.push({slot: 'value', q: 'どの姿勢にしますか？', choices: POSE_IDS.slice(0, 6).map(v => ({label: POSE_JA[v], patch: {value: v}}))}); },
  carry(P, ctx, o) { needTarget(P, ctx, o); if (P.carry) o.args.value = P.carry; else if (P.clear) o.args.value = ''; else o.missing.push({slot: 'value', q: 'どの構えにしますか？', choices: Object.keys(CARRY_JA).map(v => ({label: CARRY_JA[v], patch: {value: v}}))}); },
  step_style(P, ctx, o) { needTarget(P, ctx, o); if (P.stepStyle) o.args.value = P.stepStyle; else if (P.clear) o.args.value = ''; else o.missing.push({slot: 'value', q: 'どのステップにしますか？', choices: Object.keys(STEP_JA).map(v => ({label: STEP_JA[v], patch: {value: v}}))}); },
  action(P, ctx, o) { needTarget(P, ctx, o); if (P.action) o.args.value = P.action; else if (P.clear) o.args.value = ''; else o.missing.push({slot: 'value', q: 'どの動作にしますか？', choices: Object.keys(ACT_JA).map(v => ({label: ACT_JA[v], patch: {value: v}}))}); },
  auto_fix() { return {}; },
  parade(P, ctx, o) {
    if (/規定|きてい|こんてすと|大会/.test(P.n)) o.args.pattern = 'contest';
    else if (/1周|一周|いっしゅう|ぐるっと|周回|周る|まわる|回る/.test(P.n)) o.args.pattern = 'lap';
    else if (/せんたー|真ん中|まんなか|中央/.test(P.n)) o.args.pattern = 'center';
    else if (/足踏み|あしぶみ|まーくたいむ|その場/.test(P.n)) o.args.pattern = 'mark';
    const q = P.nums.find(x => x.u === 'count'); if (q) o.args.counts = q.v;
  },
  play(P, ctx, o) { if (/ここから|今から|いまから|このせっとから|今のせっとから|このせっとから|いまのせっとから/.test(P.n)) o.args.from = 'set'; },
  stop() { return {}; }, view_3d() { return {}; }, export_video() { return {}; }, print() { return {}; }, save() { return {}; }, undo() { return {}; }, redo() { return {}; },
  grid(P, ctx, o) { if (P.gridMode) o.args.mode = P.gridMode; else o.missing.push({slot: 'mode', q: 'グリッドはどれにしますか？', choices: ['step', 'fine', 'normal'].map(v => ({label: GRID_JA[v], patch: {mode: v}}))}); },
  grid_points(P, ctx, o) { o.args.on = P.onoff !== 'off'; },
  snap(P, ctx, o) {
    if (/なし|無し|おふ|off|やめ|切|きって|外/.test(P.n) && !P.nums.length) { o.args.value = {off: true}; return; }
    const a = amountOf(P, ctx);
    if (a) o.args.value = a; else o.missing.push({slot: 'value', q: '吸着の刻みはどれにしますか？', choices: [{label: '半歩', patch: {value: {v: 0.5, unit: 'step'}}}, {label: '1歩', patch: {value: {v: 1, unit: 'step'}}}, {label: '1m', patch: {value: {v: 1, unit: 'm'}}}, {label: 'なし', patch: {value: {off: true}}}]});
  },
  zoom(P, ctx, o) { o.args.dir = P.zoom || 'fit'; },
  names(P, ctx, o) { o.args.on = P.onoff !== 'off'; },
  tool(P, ctx, o) { if (P.tool) o.args.tool = P.tool; else o.missing.push({slot: 'tool', q: 'どのツールにしますか？', choices: ['select', 'line', 'arc', 'circle'].map(v => ({label: TOOL_JA[v] + 'ツール', patch: {tool: v}}))}); },
  help(P, ctx, o) { o.args.query = P.n; },
  none() { return {}; }
};
for (const k of Object.keys(ARR_KIND)) RESOLVE[k] = (P, ctx, o) => RESOLVE.arrange(P, ctx, o, ARR_KIND[k]);
function atCount(P, ctx, o, nm) {
  const q = P.nums.find(x => x.u === 'count' || x.u === 'bar') || P.nums.find(x => x.u == null);
  if (q) o.args.at = {c: q.u === 'bar' ? q.v * (ctx.beatsPerBar || 4) : q.v};
  else if (/半分|はんぶん|真ん中|まんなか|中間|ちゅうかん|2つに|ふたつに|二つに|半々/.test(P.n)) o.args.at = {half: true};
  else if (P.n.length && /ここ|今|いま|再生へっど|この位置/.test(P.n)) o.args.at = {here: true};
  else o.missing.push({slot: 'at', q: `どのカウントで${nm}しますか？`, choices: [{label: '真ん中', patch: {at: {half: true}}}, {label: '4カウント', patch: {at: {c: 4}}}, {label: '8カウント', patch: {at: {c: 8}}}, {label: '今の再生位置', patch: {at: {here: true}}}]});
}

// ===================================================================== 一行の説明
const U_JA = {step: '歩', m: 'm', cm: 'cm', point: 'ポイント'};
const amtJa = a => a ? `${STEPS_N(a.v)}${U_JA[a.unit] || '歩'}` : '';
function describe(intent, args, ctx) {
  const T = (key) => describeTarget(args[key || 'target'], ctx);
  switch (intent) {
    case 'select_all': return '全員を選ぶ';
    case 'select': return `${T()}を選ぶ`;
    case 'select_none': return '選択を解除する';
    case 'select_invert': return '選んでいない人を選ぶ（選択を反転）';
    case 'move': return `${T()}を${(args.dirs || []).map(d => DIRJA[d]).join('・') || '？'}へ${amtJa(args.amount) || '？'}動かす`;
    case 'move_to': return `${T()}をセンターに集める`;
    case 'rotate': return `${T()}を${args.cw ? '時計回り' : '反時計回り'}に${args.deg == null ? '？' : STEPS_N(args.deg)}度回す`;
    case 'scale': return `${T()}を${args.factor >= 1 ? '広げる' : '狭める'}（${STEPS_N(args.factor)}倍）`;
    case 'spacing': return `${T()}の間隔を${amtJa(args.value) || '？'}にする`;
    case 'flip': return `${T()}を${args.axis === 'y' ? '前後' : '左右'}に反転する`;
    case 'swap': return `${describeTarget(args.a, ctx)}と${describeTarget(args.b, ctx)}を入れ替える`;
    case 'unpin': return `${T()}の個別の位置を解除する`;
    case 'delete_members': return `${T()}を削除する`;
    case 'add_members': return `${describeTarget(args.target, ctx).replace(/（\d+人）$/, '')}を${args.count}人増やす`;
    case 'duplicate_members': return `${T()}を複製する`;
    case 'copy_members': return `${T()}の位置をコピーする`;
    case 'paste_members': return '位置を貼り付ける';
    case 'cut_members': return `${T()}を切り取る`;
    case 'set_add': return `新しいセットを${args.counts ? STEPS_N(args.counts) + 'カウントで' : ''}${args.where === 'end' ? '最後に' : ''}${args.hold ? '（その場）' : ''}追加する`;
    case 'set_bulk': return `セットを${(args.counts || []).join('・')}カウントでまとめて作る`;
    case 'set_split': return `今のセットを${atJa(args.at)}で分割する`;
    case 'set_cut': return `今のセットを${atJa(args.at)}でカットする`;
    case 'set_copy': return '今のセットをコピーする';
    case 'set_paste': return 'セットを貼り付ける';
    case 'set_dup': return '今のセットを複製する';
    case 'set_delete': return '今のセットを削除する';
    case 'set_next': return '次のセットへ進む';
    case 'set_prev': return '前のセットへ戻る';
    case 'set_goto': return `${toJa(args.to, ctx)}へ移る`;
    case 'set_move': return `今のセットを${args.dir === 'next' ? '後ろ' : '前'}へ動かす`;
    case 'set_mirror': return '今のセットを左右反転する';
    case 'set_counts': return args.value && args.value.rel != null ? `今のセットを${STEPS_N(Math.abs(args.value.rel))}カウント${args.value.rel > 0 ? '長く' : '短く'}する` : `今のセットを${valJa(args.value, 'カウント', true)}`;
    case 'set_hold': return args.value && args.value.rel != null ? `ホールドを${STEPS_N(Math.abs(args.value.rel))}カウント${args.value.rel > 0 ? '長く' : '短く'}する` : `ホールドを${valJa(args.value, 'カウント')}`;
    case 'tempo': return args.value && args.value.rel != null ? `テンポを${STEPS_N(Math.abs(args.value.rel))}${args.value.rel > 0 ? '上げる' : '下げる'}` : `テンポを${args.value && args.value.mul ? args.value.mul + '倍' : valJa(args.value, '', true)}`;
    case 'face': return `${T()}の向きを${args.value === '' ? '自動' : FACE_JA[args.value] || args.value + '度'}にする`;
    case 'pose': return `${T()}の姿勢を${args.value === '' ? 'なし' : POSE_JA[args.value] || '？'}にする`;
    case 'carry': return `${T()}の楽器の構えを${args.value === '' ? 'なし' : CARRY_JA[args.value] || '？'}にする`;
    case 'step_style': return `${T()}のステップを${args.value === '' ? '自動' : STEP_JA[args.value] || '？'}にする`;
    case 'action': return `${T()}の動作を${args.value === '' ? 'なし' : ACT_JA[args.value] || '？'}にする`;
    case 'auto_fix': return 'ぶつかりを自動で直す';
    case 'parade': return `パレードを作る画面を開く${args.pattern ? '（' + ({contest: '規定課題', lap: '1周', center: 'センター', mark: '足踏み'}[args.pattern]) + '）' : ''}`;
    case 'play': return args.from === 'set' ? '今のセットから再生する' : '再生する（もう一度で停止）';
    case 'stop': return '停止する';
    case 'view_3d': return '3Dで見る';
    case 'export_video': return '3D動画を書き出す';
    case 'print': return '印刷メニューを開く';
    case 'save': return '保存する';
    case 'undo': return '1つ元に戻す';
    case 'redo': return 'やり直す';
    case 'grid': return `グリッドを「${GRID_JA[args.mode] || '？'}」にする`;
    case 'grid_points': return `5mポイントを${args.on ? '表示' : '隠'}する`;
    case 'snap': return args.value && args.value.off ? '吸着をなしにする' : `吸着を${amtJa(args.value) || '？'}にする`;
    case 'zoom': return {in: '拡大表示する', out: '縮小表示する', fit: '全体を表示する'}[args.dir] || '全体を表示する';
    case 'names': return `名前を${args.on ? '表示' : '隠'}する`;
    case 'tool': return `${TOOL_JA[args.tool] || '？'}ツールにする`;
    case 'help': return '使い方・コマンド検索を開く';
    default:
      if (ARR_KIND[intent]) return `${T()}を${{line: '直線', curve: '曲線', arc: '弧', circle: '円', block: 'ブロック', wedge: 'くさび形', diag: '斜め', follow: 'フォロー'}[ARR_KIND[intent]]}に並べる${args.spacing ? '（間隔' + amtJa(args.spacing) + '）' : ''}${args.cols ? '（' + args.cols + '列）' : ''}`;
      return '';
  }
}
function atJa(a) { return !a ? '？' : a.half ? '真ん中' : a.here ? '今の再生位置' : `${STEPS_N(a.c)}カウント目`; }
function toJa(t, ctx) { if (!t) return '？'; if (t.first) return '最初のセット'; if (t.last) return '最後のセット'; if (t.rel) return t.rel > 0 ? '次のセット' : '前のセット'; if (t.index != null) return `セット${((ctx.sets || [])[t.index]) || t.index + 1}`; return `セット${t.name}`; }
function valJa(v, unit, withNi) { if (!v) return '？'; if (v.abs != null) return STEPS_N(v.abs) + unit + (withNi ? 'にする' : 'にする'); if (v.rel != null) return (v.rel > 0 ? '+' : '') + STEPS_N(v.rel) + unit + 'する'; return '？'; }

// ===================================================================== 判断（Jev 型: 型のある決定 ＋ 較正した確信度 ＋ 上位3つ）
const POLICY = {high: 0.80, margin: 0.20, mid: 0.30, auto: 0.93};
function resolveIntent(intent, P, ctx) {
  const o = {args: {}, missing: []};
  const f = RESOLVE[intent];
  if (f) { const r = f(P, ctx, o); if (r && typeof r === 'object') Object.assign(o.args, r); }
  const ok = o.missing.length === 0;
  const cat = CAT[intent] || {};
  return {intent, args: o.args, missing: o.missing, complete: ok, destructive: !!cat.destructive, label: cat.ja || intent, preview: ok || intent !== 'none' ? safeDescribe(intent, o.args, ctx) : ''};
}
function safeDescribe(intent, args, ctx) { try { return describe(intent, args, ctx); } catch (e) { return ''; } }
// 確信度・2位との差・値の揃い具合から、どう扱うかを決める
//   run: 一行の説明を出して Enter で実行 / confirm: 削除など、もう一度の確認が要る / choose: 上位3つから選ばせる / ask: 足りない値を質問 / unknown: わからない
function statusOf(intent, p1, p2, complete, destructive) {
  let status;
  if (intent === 'none' || p1 < POLICY.mid) status = 'unknown';
  else if (!complete) status = p1 >= 0.5 ? 'ask' : 'choose';
  else if (p1 >= POLICY.high && p1 - p2 >= POLICY.margin) status = destructive ? 'confirm' : 'run';
  else status = 'choose';
  return status;
}
function decideOne(text, ctx) {
  const t0 = Date.now();
  const P = parseSlots(text, ctx), n = P.n;
  if (!n) return {text, status: 'unknown', conf: 0, intent: 'none', args: {}, missing: [], alts: [], ms: 0};
  const probs = classifyN(n, ctx), rk = rank(probs);
  const top = rk[0];
  const alts = rk.filter(r => r.id !== 'none').slice(0, 3).map(r => Object.assign({p: r.p}, resolveIntent(r.id, P, ctx)));
  const best = rk[0].id === 'none' ? null : alts[0];
  const p2 = (rk.find((r, i) => i > 0 && r.id !== 'none') || {p: 0}).p;
  const status = statusOf(top.id, top.p, p2, best && best.complete, best && best.destructive);
  return {text, n, status, p2, conf: top.p, intent: top.id, args: best ? best.args : {}, missing: best ? best.missing : [], preview: best ? best.preview : '', destructive: best ? best.destructive : false, complete: best ? best.complete : false, alts, ms: Date.now() - t0, auto: status === 'run' && top.p >= POLICY.auto};
}

// ---- 複合命令の分割（「選んで前に3歩、それから円にして」）
const TE_SPLIT = /(選んで|えらんで|選択して|選び|指定して|にして|並べて|動かして|回して|広げて|縮めて|狭めて|削除して|消して|戻して|増やして|足して|変えて|向けて|向いて|揃えて|そろえて|反転して|入れ替えて|移動して|ずらして|してから|したあと|コピーして|貼り付けて|解除して|追加して|作って|つくって)(?=[^、。,\s])/g;
const NOSPLIT_NEXT = /^(?:間隔|かんかく|ずつ|から|ください|下さい|くれ|ほしい|欲しい|もらえ|もらう|みて|みせ|みたい|おいて|も|は|ね|よ|くださ|あげ|しまう|ちゃう|じゃ|ない|ほうが|もいい|もよい|い[いけ]|ほしく|ます|ました|たい|て|でき|もらっ|くれる|おく|ばいい|ほしい|欲)/;
const ACTION_CUE = new RegExp('(' + ['v_select', 'v_move', 'v_rotate', 'v_expand', 'v_shrink', 'v_flip', 'v_swap', 'v_delete', 'v_add', 'v_play', 'v_stop', 'v_undo', 'v_face', 'v_pose', 'v_fix', 'v_save', 'v_goto', 'v_set', 'v_split', 'v_copy', 'v_paste', 'v_tempo', 'v_hold', 'v_counts', 'v_unpin', 'v_gather', 's_arc', 's_circle', 's_line', 's_block', 's_wedge', 's_diag', 's_curve', 's_follow'].map(k => LEX.find(x => x[0] === k)[1].source).join('|') + ')');
function splitClauses(text) {
  let s = String(text == null ? '' : text).normalize('NFKC');
  s = s.replace(/→|=>|＞|>>/g, '、');
  let parts = [];
  // まず区切り記号と接続のことばで切る
  const first = s.split(/[、,。．.!！?？;；\n]+/).map(x => x.trim()).filter(Boolean);
  for (const f of first) {
    let rest = f;
    const sub = [];
    for (;;) {
      const mm = /(それから|そのあとで?|その後で?|そして|つぎに|次に|続けて|つづけて|さらに|あとは|そのうえ|その上|ついでに|したら|してから|てから|のあとで?|あとで)/.exec(rest);
      if (!mm) break;
      const i = mm.index, e = i + mm[0].length, keepTe = /^(したら|してから|てから)$/.test(mm[0]);
      const left = rest.slice(0, i) + (keepTe ? (mm[0] === 'したら' ? 'した' : mm[0] === 'してから' ? 'して' : 'て') : ''), right = rest.slice(e);
      if (left.trim()) sub.push(left.trim());
      rest = right.trim();
      if (!rest) break;
    }
    if (rest) sub.push(rest);
    parts.push(...sub);
  }
  // 「〜して」のあとに続きがあれば切る（「円にしてください」のような助動詞は切らない）
  const out = [];
  for (const p of parts) {
    let last = 0, m; const acc = []; TE_SPLIT.lastIndex = 0;
    while ((m = TE_SPLIT.exec(p)) !== null) {
      const end = m.index + m[0].length, nextc = p.slice(end);
      if (NOSPLIT_NEXT.test(nextc)) continue;
      acc.push(p.slice(last, end)); last = end;
    }
    acc.push(p.slice(last));
    out.push(...acc.filter(x => x.trim()));
  }
  // 動きの手がかりがない断片（「8」「トロンボーンを」）は、前（なければ後ろ）につなげる
  const merged = [];
  const cue = x => ACTION_CUE.test(norm(x)) || /\d\s*(?:歩|拍|カウント|度|m|倍|人)/.test(norm(x));
  out.forEach((p, i) => {
    if (!cue(p) && merged.length) merged[merged.length - 1] += '、' + p;
    else if (!cue(p) && i + 1 < out.length) out[i + 1] = p + '、' + out[i + 1];
    else merged.push(p);
  });
  return merged.length ? merged : [String(text || '').trim()].filter(Boolean);
}
// ctx を進める（選ぶ命令のあとは、そのメンバーが「選んだ人」）
function withSel(ctx, ids) { return Object.assign({}, ctx, {sel: ids}); }
function understand(text, ctx) {
  const t0 = Date.now();
  ctx = ctx || {};
  const clauses = splitClauses(text);
  const steps = [];
  let cur = ctx;
  for (const c of clauses) {
    const d = decideOne(c, cur);
    steps.push(d);
    // 次の文のために、選ぶ命令・動かす命令のあとの「選んだ人」を更新する
    const t = d.args && d.args.target;
    if (d.complete && /^(select|move|rotate|scale|spacing|flip|arrange_|face|pose|carry|step_style|action|unpin|duplicate)/.test(d.intent)) {
      if (t || d.intent === 'select_all') { const ids = d.intent === 'select_all' ? (cur.members || []).map(m => m.id) : resolveTarget(t, cur); if (ids.length) cur = withSel(cur, ids); }
    }
    if (d.intent === 'select_none') cur = withSel(cur, []);
  }
  // 全体の状態: いちばん弱い文に合わせる
  const order = ['unknown', 'ask', 'choose', 'confirm', 'run'];
  let status = 'run';
  for (const s of steps) if (order.indexOf(s.status) < order.indexOf(status)) status = s.status;
  const conf = Math.min(...steps.map(s => s.conf));
  const destructive = steps.some(s => s.destructive && s.complete);
  if (destructive && status === 'run') status = 'confirm';
  const first = steps.find(s => s.status !== 'run' && s.status !== 'confirm') || steps[0];
  return {text, steps, status, conf, destructive, preview: steps.map(s => s.preview).filter(Boolean).join(' → '), problem: status === 'run' || status === 'confirm' ? null : first, auto: status === 'run' && steps.every(s => s.auto), ms: Date.now() - t0};
}
// 質問への答え（choices の patch）を入れた判断を作り直す
function applyPatch(step, patch, ctx) {
  const args = Object.assign({}, step.args, patch);
  const P = null; void P;
  const missing = (step.missing || []).filter(m => !(m.slot in patch));
  const cat = CAT[step.intent] || {};
  const miss2 = []; const ctx2 = ctx;
  // 必須の値が揃っているか確かめる
  for (const k of cat.req || []) if (args[k] == null || (Array.isArray(args[k]) && !args[k].length)) { if (!miss2.find(m => m.slot === k)) { const old = missing.find(m => m.slot === k); if (old) miss2.push(old); } }
  return Object.assign({}, step, {args, missing: miss2, complete: miss2.length === 0, status: miss2.length ? 'ask' : (cat.destructive ? 'confirm' : 'run'), preview: safeDescribe(step.intent, args, ctx2), conf: Math.max(step.conf, 0.9)});
}

// Jev のような「型のある決定」: {action, args, confidence, alternatives[上位3]} ＋ どう扱うか（status）。
// 複合の指示は action = 'compound'、args.steps に1文ずつの決定が入る。
function asDecision(d) {
  return {action: d.intent, args: d.args, confidence: +d.conf.toFixed(4), status: d.status, preview: d.preview || '', missing: d.missing || [],
    alternatives: (d.alts || []).slice(0, 3).map(a => ({action: a.intent, args: a.args, confidence: +a.p.toFixed(4), complete: a.complete}))};
}
function decide(text, ctx) {
  ctx = ctx || {};
  const u = understand(text, ctx);
  if (u.steps.length === 1) { const d = asDecision(u.steps[0]); d.text = text; d.ms = u.ms; return d; }
  return {text, action: 'compound', args: {steps: u.steps.map(asDecision)}, confidence: +u.conf.toFixed(4), status: u.status, preview: u.preview, missing: u.problem ? u.problem.missing : [], alternatives: u.problem ? asDecision(u.problem).alternatives : [], ms: u.ms};
}

const EXAMPLES = [
  'トランペットを選んで前に3歩動かして', '全員を円にして', '左半分を右に5歩', 'トロンボーンを4列のブロックにして', '時計回りに90度回して', '少し広げて',
  'トランペットとトロンボーンを入れ替えて', 'セットを8拍で追加', '8 8 16でセットを作って', 'テンポを140にして', '全員客席を向いて', '気をつけにして', 'ぶつかりを自動で直して', '再生して', '元に戻して'
];
const API = {norm, loadModel, modelReady, classifyN, logitsN, softmaxT, featureIds, maskText, conceptsOf, parseSlots, targetOf, resolveTarget, describeTarget, describe, resolveIntent, decideOne, understand, decide, applyPatch, splitClauses,
  guessInstrument, findSections, statusOf, CAT, INTENTS, POLICY, EXAMPLES, DIRVEC, DIRJA, FACE_JA, POSE_JA, CARRY_JA, STEP_JA, ACT_JA, GRID_JA, TOOL_JA, REGION_JA, D_DEFAULT, INSTR, FAMILY, unitToLen, rank, rowsOf, ARR_KIND, atJa, setRefOf, amountOf};
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.JKCMD = API;
})(typeof window !== 'undefined' ? window : globalThis);
