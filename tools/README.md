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
- `materials[]`: `{name,color(0xRRGGBB),rough,metal,tint}`。tint=true は部隊ごとの上着色で置換。
- `body`: 頂点数 `vertices`、`indices`、`triangles` と各配列のオフセット。
  pos f32x3 / nor f32x3 / skinIndex u16x4 / skinWeight f32x4 / mat u8 (頂点ごとのmaterial id) / index u32。
  1頂点は1材質のみ (材質境界で頂点分割済み)。
- `instruments{名前}`: 同様の剛体メッシュ + `attach{bone,pos,quat}`。頂点は prop ボーンのローカル空間。
  名前は楽器ID（src/instruments.rs）のうち見た目が異なるもの（bass_drum は bass1〜5 に分かれ、flag は `guard`、none はメッシュなし）。
  ID → メッシュ名の対応表は src/view3d.js の `meshOf` と src/render.rs の `mesh_of`（同じ規則）。
  メッシュは tools/human/instruments.js（金管・打楽器）と winds.js（木管・サックス・ファゴット）。
- `illust`（`look illust` 用）: `{body}`。`body` は `body` と同じ形式の体メッシュ（白T・黒の細身パンツ・スニーカー・袖）。顔と髪はリアルと共通。
  `materials[].ill = {color, tint}` はイラストのときの色・tint の上書き（無ければ通常の値）。イラストの素材色は sRGB を正しく線形化して使い、肌は隊員ごとのパレット、tint（袖）はセクション色か隊員ごとの色に置換する。
- `face`（リアル・イラスト共通の顔と髪。生成は tools/human/face.js と hair.js）:
  - `tex {w,h,a,b}`: 顔テクスチャ。RGBA8 を 2 枚（384x384、v は上が 0）。A = 墨（まつげ・瞳孔・鼻の影）/ 眉 / 白目 / 虹彩、B = 虹彩のグラデーション位置 / ハイライト / ほお / 口（0.5 = くちびる, 1 = 線）。
    色はテクスチャに焼かず、実行時に隊員ごとに決める（虹彩 = `eyes`、眉 = 髪の色、肌）。左右は x の絶対値で描くので対称。
  - `mesh`: 頭の表面から 1.3mm 浮かせた曲面パッチ（顔のスキンメッシュ。`uv` つき。頭と同じ骨・重み）。テクスチャで何も描かれない画素は捨てる。影は落とさない。
  - `hairs {real, illust}`: 髪メッシュの名前（`instruments` の `hairr/*`（シャコー帽の下から見える髪型）と `hair/*`。頭ボーンに付く。7 種類: hime・twin・pony・bob・side・wavy・braid）。
  - `eyes` / `hairCols` / `hairSlots` / `colors`: 目の色の表・髪の色の表・出現の重み（スロット → hairCols の添字）・顔の色（sRGB）。
    隊員 i の選び方（view3d.js と render.rs で同じ）: `h32(i, salt)` = 32bit の整数ハッシュ。髪型 = `h32(i,7) % 7`、髪の色 = `hairCols[hairSlots[h32(i,6) % 20]]`、目の色 = `eyes[h32(i,31) % 7]`。
  - 頭は口の位置を中心に横・奥行き 1.14 倍・高さ 1.05 倍（body.js / illust.js / hair.js が同じ拡大を通す）。吹き口の当たる位置は動かない。
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

## strike（打楽器の打面の表）
`human.json` の `strike[楽器名]`（snare / tenors / bass1..5）: `drums`（打面の中心 c・外向き法線 n・面内の左 ex／前 ez・半径 r・pad 番号・バスは hand）、
`stick.R/L`（手のボーン局所の先端 tip・軸 ax・球の半径 rh）、`anchor`（手首の待機位置）、`click`（stickclick の位置）。構えのモデル座標。
src/strike.js と src/strike.rs が読み、肩〜手首を IK で解いて先端を打面へ合わせる。
