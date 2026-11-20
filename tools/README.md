# 人体アセット生成 (tools/gen_human.js)

実行: `node tools/gen_human.js [-v] [--dev]`  (依存なし)
出力: `assets/human.bin` / `assets/human.json`。`src/output.rs` が `include_bytes!` で埋め込み、
プレビューHTMLにはbase64 (`window.JK_HUMAN`) として入る。

## フォーマット "JKH1"
- 先頭4byte `JKH1`、続いて u32 LE の JSON 長、JSON (4byte境界までスペース埋め)、その後ろにリトルエンディアンのblob。
- JSON内の `pos`/`nor`/`off` などのオフセットは全て blob 先頭からのバイト位置。
- 単位はメートル、Y上、+Z正面、足裏 y=0、身長 約1.70m。

## JSON
- `bones[22]`: `{name,parent,pos}` 親相対の静止位置 (回転は単位)。`prop` ボーンは chest の子で楽器用。
- `materials[24]`: `{name,color(0xRRGGBB),rough,metal,tint}`。tint=true は部隊ごとの上着色で置換。
- `body`: 頂点数 `vertices`、`indices`、`triangles` と各配列のオフセット。
  pos f32x3 / nor f32x3 / skinIndex u16x4 / skinWeight f32x4 / mat u8 (頂点ごとのmaterial id) / index u32。
  1頂点は1材質のみ (材質境界で頂点分割済み)。
- `instruments{名前}`: 同様の剛体メッシュ + `attach{bone,pos,quat}`。頂点は prop ボーンのローカル空間。
  名前は楽器ID（src/instruments.rs）のうち見た目が異なるもの（bass_drum は bass1〜5 に分かれ、flag は `guard`、none はメッシュなし）。
  ID → メッシュ名の対応表は src/view3d.js の `meshOf` と src/render.rs の `mesh_of`（同じ規則）。
  メッシュは tools/human/instruments.js（金管・打楽器）と winds.js（木管・サックス・ファゴット）。
- `illust`（`look illust` 用）: `{body, hairs[]}`。`body` は `body` と同じ形式の体メッシュ（アニメ顔・白T・黒の細身パンツ・スニーカー・袖）、`hairs` は髪メッシュの名前（`instruments` の `hair/*`。頭ボーンに付く）。
  `materials[].ill = {color, tint}` はイラストのときの色・tint の上書き（無ければ通常の値）。イラストの素材色は sRGB を正しく線形化して使い、肌・髪は隊員ごとのパレット、tint（袖・iris）はセクション色か隊員ごとの色に置換する。
- `clips[74]`: `{name,bones[],frames,counts,off}`。blobの `off` から frames x bones x 7 float (pos3 + quat xyzw)。
  `counts` は周期のカウント数 (歩行は 2カウント=20フレーム)。
  名前: `stance/*` (attention rest wide cross kneel kneel2 lunge crouch toe), `walk/{glide,jazz,high,back}/{stride}`,
  `hold|carry|up/{楽器}`, `idle`, `behind`, `guard/*`。
- 構え（carry）: `style/{right,left,front,diag}/{楽器}`（旗は `guard`）。上半身クリップ。生成は tools/human/styles.js。
- 手に付く部品: `instruments` の `楽器+R` / `楽器+L`（スティック・マレット・シンバルの板）は `attach.bone` が handR/handL で、頂点は手のボーンの局所座標。シンバルのように本体メッシュが無い楽器もある。
- `groups.lower` / `groups.upper`: 下半身 (root,脊柱,首,頭,脚) と上半身 (鎖骨,腕,手,prop) のボーン集合。
- `strides`: [0,0.3,0.5,0.75] 歩幅違いの焼き込み。back歩きは負のストライド。

## ランタイム規約
- 下半身は stance か walk クリップ、上半身は hold/carry/up/guard クリップから別々に取り、スキニング前にボーン毎へ合成する。
- 歩行: speed=|dir|*unit_m/0.1 から最寄り2つのstrideを選び slerp でブレンド。位相は count 由来で足が接地する。
- ポーズ間の遷移は pos 線形 + quat slerp。

## Rust移植メモ
- ヘッダを読み、blob を `bytemuck` 等で f32/u16/u32 スライスに直接キャストできる。
- スキニングは4ウェイト線形 (LBS)。bindは単位行列、inverse bind はボーン静止位置の累積から算出。
- 材質は `mat` を引いて color/rough/metal を取り、tint は部隊色に置換する。
