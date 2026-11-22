//! 人体アセット (assets/human.bin, 形式 "JKH1") の読み込み・ポーズ計算・スキニング。
//! ブラウザの 3D ビュー (src/view3d.js) と同じ規則で、クリップのサンプリング・混ぜ方を行う。
//! 形式は tools/README.md を参照。
use crate::json_mini::{self, J};
use crate::render::{v3, V3};
use crate::strike::{sst, va, vc, vd, vl, vm, vma, vn, vsub};
use std::collections::HashMap;
use std::sync::OnceLock;

static BIN: &[u8] = include_bytes!("../assets/human.bin");

#[derive(Clone, Copy)]
pub struct Mat {
    /// 線形 RGB
    pub color: [f32; 3],
    pub rough: f32,
    pub metal: f32,
    pub tint: bool,
}

#[derive(Default)]
pub struct MeshData {
    pub pos: Vec<[f32; 3]>,
    pub nor: Vec<[f32; 3]>,
    pub mat: Vec<u8>,
    pub idx: Vec<u32>,
    pub skin_i: Vec<[u16; 4]>,
    pub skin_w: Vec<[f32; 4]>,
    /// 顔パッチの UV（無いメッシュは空）
    pub uv: Vec<[f32; 2]>,
}

/// 顔テクスチャ（目・眉・口・ほおを 8 チャンネルに焼いたもの）。ミップマップつき。
/// チャンネル: 0 墨 1 眉 2 白目 3 虹彩 4 虹彩のグラデーション 5 ハイライト 6 ほお 7 口（0.5 = くちびる, 1 = 線）
pub struct FaceTex {
    /// 各レベルの (幅, 高さ, 画素)。0 が最も細かい
    pub lv: Vec<(usize, usize, Vec<[f32; 8]>)>,
}

impl FaceTex {
    /// レベル l（小数可）を双一次補間で引く。UV は [0,1]、v は上が 0
    pub fn sample(&self, u: f32, v: f32, l: f32) -> [f32; 8] {
        let l0 = (l.floor().max(0.0) as usize).min(self.lv.len() - 1);
        let l1 = (l0 + 1).min(self.lv.len() - 1);
        let a = self.bilinear(l0, u, v);
        if l1 == l0 {
            return a;
        }
        let t = (l - l0 as f32).clamp(0.0, 1.0);
        let b = self.bilinear(l1, u, v);
        let mut o = [0.0f32; 8];
        for k in 0..8 {
            o[k] = a[k] + (b[k] - a[k]) * t;
        }
        o
    }
    fn bilinear(&self, l: usize, u: f32, v: f32) -> [f32; 8] {
        let (w, h, px) = &self.lv[l];
        let x = (u * *w as f32 - 0.5).clamp(0.0, *w as f32 - 1.0);
        let y = (v * *h as f32 - 0.5).clamp(0.0, *h as f32 - 1.0);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let mut o = [0.0f32; 8];
        for k in 0..8 {
            let top = px[y0 * w + x0][k] * (1.0 - fx) + px[y0 * w + x1][k] * fx;
            let bot = px[y1 * w + x0][k] * (1.0 - fx) + px[y1 * w + x1][k] * fx;
            o[k] = top * (1.0 - fy) + bot * fy;
        }
        o
    }
}

/// 顔まわりのアセット: パッチのメッシュ・テクスチャ・目の色と髪の色の表・顔の色・髪メッシュの名前
pub struct Face {
    pub mesh: MeshData,
    pub tex: FaceTex,
    /// 目の色・髪の色（0xRRGGBB）、髪の色の出現表（hair_cols への添字）
    pub eyes: Vec<u32>,
    pub hair_cols: Vec<u32>,
    pub hair_slots: Vec<usize>,
    /// 顔の色（0xRRGGBB）: 白目・墨・くちびる・口の線・ほお・眉に混ぜる色
    pub sclera: u32,
    pub ink: u32,
    pub lip: u32,
    pub line: u32,
    pub blush: u32,
    pub brow: u32,
    /// 髪メッシュの名前（insts のキー）。リアル用（帽子の下）とイラスト用
    pub hairs_real: Vec<String>,
    pub hairs_ill: Vec<String>,
}

pub struct Inst {
    pub mesh: MeshData,
    pub bone: usize,
    pub apos: [f32; 3],
    pub aquat: [f32; 4],
    /// 旗の布の範囲 [x の最大（ポール側）, 幅, y の最大（上端）, 高さ]。布の頂点が無ければ None
    pub flag_box: Option<[f32; 4]>,
}

/// 素材 ID（名前から引く。無ければ usize::MAX）
#[derive(Clone, Copy)]
pub struct MatIds {
    pub skin: usize,
    pub hair: usize,
    pub lip: usize,
    pub cloth: usize,
    pub cloth2: usize,
    pub iris: usize,
    pub blush: usize,
}

pub struct Clip {
    pub bones: Vec<usize>,
    pub frames: usize,
    pub counts: f32,
    pub data: Vec<f32>,
}

/// 打面（打楽器の面）。座標は構え（hold）のときのモデル座標
pub struct StrikeDrum {
    pub pad: u8,
    /// 打面の中心・外向きの法線・面内の左向き・面内の前向き
    pub c: [f32; 3],
    pub n: [f32; 3],
    pub ex: [f32; 3],
    pub ez: [f32; 3],
    pub r: f32,
    /// 手ごとに接点を左右へずらす度合い（バスは 0）
    pub spread: f32,
    /// バスドラム: このヘッドを叩く手
    pub hand: Option<char>,
}

/// 手に持つ棒（手のボーンの局所座標）: tip = 先端の球の中心、ax = 後端 → 先端の向き、rh = 球の半径
pub struct StickG {
    pub tip: [f32; 3],
    pub ax: [f32; 3],
    pub rh: f32,
}

/// 打つ動きの記述（アセットの strike[楽器名]）。手の配列は [右, 左]
pub struct StrikeTbl {
    pub drums: Vec<StrikeDrum>,
    pub stick: [StickG; 2],
    pub anchor: [[f32; 3]; 2],
    pub click: [f32; 3],
}

pub struct Human {
    pub nb: usize,
    pub parent: Vec<i32>,
    pub rest: Vec<[f32; 3]>,
    /// 静止状態でのワールド位置（逆バインド行列用）
    pub rest_world: Vec<[f32; 3]>,
    pub mats: Vec<Mat>,
    pub body: MeshData,
    pub insts: HashMap<String, Inst>,
    /// 手に持つ部品（スティック・シンバルの板など）。楽器 kind → 部品の名前（"kind+R" / "kind+L"。手のボーンに付く）
    pub parts: HashMap<String, Vec<String>>,
    pub clips: Vec<Clip>,
    pub clip_ix: HashMap<String, usize>,
    pub upper: Vec<usize>,
    pub strides: Vec<f32>,
    pub chest: usize,
    pub mid: MatIds,
    pub bone_ix: HashMap<String, usize>,
    /// イラスト用の素材色（sRGB を正しく線形化したもの。素材の ill 指定で上書き）
    pub mats_i: Vec<Mat>,
    /// イラスト用の体メッシュと髪メッシュの名前（insts のキー）。アセットに無ければ None / 空
    pub ill_body: Option<MeshData>,
    /// 顔のテクスチャ・髪（アセットに無ければ None）
    pub face: Option<Face>,
    /// 打楽器の打面の表（snare / tenors / bass1..5）
    pub strike: HashMap<String, StrikeTbl>,
}

pub fn srgb_to_lin(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// 素材色。ブラウザ版（view3d.js）は素材色の THREE.Color を、色管理を有効にする前に作る。
/// そのため sRGB の値がそのまま線形として使われる。見た目を合わせるため、ここでも変換しない
fn hex_raw(c: u32) -> [f32; 3] {
    [((c >> 16) & 255) as f32 / 255.0, ((c >> 8) & 255) as f32 / 255.0, (c & 255) as f32 / 255.0]
}

fn rd_f32(b: &[u8], off: usize, n: usize) -> Vec<f32> {
    (0..n).map(|i| f32::from_le_bytes(b[off + i * 4..off + i * 4 + 4].try_into().unwrap())).collect()
}
fn rd_u16(b: &[u8], off: usize, n: usize) -> Vec<u16> {
    (0..n).map(|i| u16::from_le_bytes(b[off + i * 2..off + i * 2 + 2].try_into().unwrap())).collect()
}

fn mesh_of(blob: &[u8], d: &J, skinned: bool) -> MeshData {
    let nv = d.get("vertices").map(|j| j.usize()).unwrap_or(0);
    let ni = d.get("indices").map(|j| j.usize()).unwrap_or(0);
    let off = |k: &str| d.get(k).map(|j| j.usize()).unwrap_or(0);
    let tri3 = |v: Vec<f32>| -> Vec<[f32; 3]> { v.chunks(3).map(|c| [c[0], c[1], c[2]]).collect() };
    let mut m = MeshData {
        pos: tri3(rd_f32(blob, off("pos"), nv * 3)),
        nor: tri3(rd_f32(blob, off("nor"), nv * 3)),
        mat: blob[off("mat")..off("mat") + nv].to_vec(),
        idx: rd_u16(blob, off("index"), ni).into_iter().map(|i| i as u32).collect(),
        ..Default::default()
    };
    if d.get("uv").is_some() {
        m.uv = rd_f32(blob, off("uv"), nv * 2).chunks(2).map(|c| [c[0], c[1]]).collect();
    }
    if skinned {
        m.skin_i = blob[off("skinIndex")..off("skinIndex") + nv * 4].chunks(4).map(|c| [c[0] as u16, c[1] as u16, c[2] as u16, c[3] as u16]).collect();
        m.skin_w = rd_f32(blob, off("skinWeight"), nv * 4).chunks(4).map(|c| [c[0], c[1], c[2], c[3]]).collect();
    }
    m
}

fn load() -> Result<Human, String> {
    if BIN.len() < 8 || &BIN[0..4] != b"JKH1" {
        return Err("人体アセットの形式が不正".into());
    }
    let jl = u32::from_le_bytes(BIN[4..8].try_into().unwrap()) as usize;
    let head = json_mini::parse(std::str::from_utf8(&BIN[8..8 + jl]).map_err(|e| e.to_string())?)?;
    let blob = &BIN[8 + jl..];
    let bones = head.get("bones").map(|j| j.arr()).unwrap_or(&[]);
    let nb = bones.len();
    let mut names = HashMap::new();
    let mut parent = vec![];
    let mut rest = vec![];
    for (i, b) in bones.iter().enumerate() {
        names.insert(b.get("name").map(|j| j.str().to_string()).unwrap_or_default(), i);
        parent.push(b.get("parent").map(|j| j.num() as i32).unwrap_or(-1));
        let p = b.get("pos").map(|j| j.f32s()).unwrap_or_default();
        rest.push([p[0], p[1], p[2]]);
    }
    let mut rest_world = rest.clone();
    for i in 0..nb {
        if parent[i] >= 0 {
            let pw = rest_world[parent[i] as usize];
            for k in 0..3 {
                rest_world[i][k] += pw[k];
            }
        }
    }
    let mat_names: Vec<String> = head.get("materials").map(|j| j.arr()).unwrap_or(&[]).iter().map(|m| m.get("name").map(|j| j.str().to_string()).unwrap_or_default()).collect();
    let find = |n: &str| mat_names.iter().position(|x| x == n).unwrap_or(usize::MAX);
    let mid = MatIds { skin: find("skin"), hair: find("hair"), lip: find("lip"), cloth: find("cloth"), cloth2: find("cloth2"), iris: find("iris"), blush: find("blush") };
    let mats = head
        .get("materials")
        .map(|j| j.arr())
        .unwrap_or(&[])
        .iter()
        .map(|m| Mat {
            color: hex_raw(m.get("color").map(|j| j.num() as u32).unwrap_or(0x808080)),
            rough: m.get("rough").map(|j| j.num() as f32).unwrap_or(0.8),
            metal: m.get("metal").map(|j| j.num() as f32).unwrap_or(0.0),
            tint: m.get("tint").map(|j| j.bool()).unwrap_or(false),
        })
        .collect();
    let mats_i: Vec<Mat> = head
        .get("materials")
        .map(|j| j.arr())
        .unwrap_or(&[])
        .iter()
        .map(|m| {
            let ov = m.get("ill");
            let c = ov.and_then(|o| o.get("color")).or_else(|| m.get("color")).map(|j| j.num() as u32).unwrap_or(0x808080);
            let lin = |v: u32| srgb_to_lin(v as f32 / 255.0);
            Mat {
                color: [lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)],
                rough: m.get("rough").map(|j| j.num() as f32).unwrap_or(0.8),
                metal: m.get("metal").map(|j| j.num() as f32).unwrap_or(0.0),
                tint: ov.and_then(|o| o.get("tint")).or_else(|| m.get("tint")).map(|j| j.bool()).unwrap_or(false),
            }
        })
        .collect();
    let ill_body = head.get("illust").and_then(|i| i.get("body")).map(|d| mesh_of(blob, d, true));
    let body = mesh_of(blob, head.get("body").ok_or("body がありません")?, true);
    let mut insts = HashMap::new();
    for (name, d) in head.get("instruments").map(|j| j.obj()).unwrap_or(&[]) {
        let at = d.get("attach");
        let bone = at.and_then(|a| a.get("bone")).and_then(|b| names.get(b.str()).copied()).unwrap_or(0);
        let ap = at.and_then(|a| a.get("pos")).map(|j| j.f32s()).unwrap_or(vec![0.0; 3]);
        let aq = at.and_then(|a| a.get("quat")).map(|j| j.f32s()).unwrap_or(vec![0.0, 0.0, 0.0, 1.0]);
        let mesh = mesh_of(blob, d, false);
        // 旗の布の範囲を頂点から求める（view3d.js の FLAGBOX と同じ。波の u, h の正規化に使う）
        let (mut x0, mut x1, mut y0, mut y1) = (1e9f32, -1e9f32, 1e9f32, -1e9f32);
        for (v, p) in mesh.pos.iter().enumerate() {
            let m = mesh.mat[v] as usize;
            if m == mid.cloth || m == mid.cloth2 {
                x0 = x0.min(p[0]);
                x1 = x1.max(p[0]);
                y0 = y0.min(p[1]);
                y1 = y1.max(p[1]);
            }
        }
        let flag_box = if name == "guard" && x0 <= x1 { Some([x1, (x1 - x0).max(0.01), y1, (y1 - y0).max(0.01)]) } else { None };
        insts.insert(name.clone(), Inst { mesh, bone, apos: [ap[0], ap[1], ap[2]], aquat: [aq[0], aq[1], aq[2], aq[3]], flag_box });
    }
    let face = head.get("face").map(|f| {
        let t = f.get("tex");
        let (tw, th) = (t.and_then(|x| x.get("w")).map(|j| j.usize()).unwrap_or(1), t.and_then(|x| x.get("h")).map(|j| j.usize()).unwrap_or(1));
        let (oa, ob) = (t.and_then(|x| x.get("a")).map(|j| j.usize()).unwrap_or(0), t.and_then(|x| x.get("b")).map(|j| j.usize()).unwrap_or(0));
        let mut base: Vec<[f32; 8]> = Vec::with_capacity(tw * th);
        for k in 0..tw * th {
            let mut p = [0.0f32; 8];
            for c in 0..4 {
                p[c] = blob[oa + k * 4 + c] as f32 / 255.0;
                p[4 + c] = blob[ob + k * 4 + c] as f32 / 255.0;
            }
            base.push(p);
        }
        // ミップマップ（2x2 の平均）
        let mut lv = vec![(tw, th, base)];
        while lv.last().unwrap().0 > 8 && lv.last().unwrap().1 > 8 {
            let (w, h, src) = lv.last().unwrap();
            let (nw, nh) = (w / 2, h / 2);
            let mut dst = Vec::with_capacity(nw * nh);
            for y in 0..nh {
                for x in 0..nw {
                    let mut o = [0.0f32; 8];
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let p = &src[(2 * y + dy) * w + 2 * x + dx];
                        for k in 0..8 {
                            o[k] += p[k] * 0.25;
                        }
                    }
                    dst.push(o);
                }
            }
            lv.push((nw, nh, dst));
        }
        let col = |k: &str| f.get("colors").and_then(|c| c.get(k)).map(|j| j.num() as u32).unwrap_or(0xffffff);
        let list = |k: &str| -> Vec<u32> { f.get(k).map(|j| j.arr().iter().map(|x| x.num() as u32).collect()).unwrap_or_default() };
        let names = |k: &str| -> Vec<String> { f.get("hairs").and_then(|h| h.get(k)).map(|j| j.arr().iter().map(|x| x.str().to_string()).collect()).unwrap_or_default() };
        Face {
            mesh: mesh_of(blob, f.get("mesh").expect("face.mesh"), true),
            tex: FaceTex { lv },
            eyes: list("eyes"),
            hair_cols: list("hairCols"),
            hair_slots: list("hairSlots").into_iter().map(|x| x as usize).collect(),
            sclera: col("sclera"),
            ink: col("ink"),
            lip: col("lip"),
            line: col("line"),
            blush: col("blush"),
            brow: col("brow"),
            hairs_real: names("real"),
            hairs_ill: names("illust"),
        }
    });
    let mut clips = vec![];
    let mut clip_ix = HashMap::new();
    for c in head.get("clips").map(|j| j.arr()).unwrap_or(&[]) {
        let cb: Vec<usize> = c.get("bones").map(|j| j.arr().iter().map(|b| b.usize()).collect()).unwrap_or_default();
        let frames = c.get("frames").map(|j| j.usize()).unwrap_or(1).max(1);
        let off = c.get("off").map(|j| j.usize()).unwrap_or(0);
        let data = rd_f32(blob, off, frames * cb.len() * 7);
        clip_ix.insert(c.get("name").map(|j| j.str().to_string()).unwrap_or_default(), clips.len());
        clips.push(Clip { bones: cb, frames, counts: c.get("counts").map(|j| j.num() as f32).unwrap_or(0.0), data });
    }
    let upper = head
        .get("groups")
        .and_then(|g| g.get("upper"))
        .map(|j| j.arr().iter().filter_map(|n| names.get(n.str()).copied()).collect())
        .unwrap_or_default();
    let strides = head.get("strides").map(|j| j.f32s()).unwrap_or(vec![0.0]);
    // 親は必ず先に並んでいる前提（FK を1パスで済ませる）
    if (0..nb).any(|i| parent[i] >= i as i32) {
        return Err("ボーンの順序が不正".into());
    }
    // 「楽器+R」「楽器+L」は手に付く部品。本体（楽器そのもの）が無い楽器（シンバル）もある
    let mut parts: HashMap<String, Vec<String>> = HashMap::new();
    for name in insts.keys() {
        if let Some((base, _)) = name.split_once('+') {
            parts.entry(base.to_string()).or_default().push(name.clone());
        }
    }
    for v in parts.values_mut() {
        v.sort();
    }
    let v3 = |j: Option<&J>| -> [f32; 3] {
        let a = j.map(|x| x.f32s()).unwrap_or_default();
        [a.first().copied().unwrap_or(0.0), a.get(1).copied().unwrap_or(0.0), a.get(2).copied().unwrap_or(0.0)]
    };
    let mut strike = HashMap::new();
    for (name, d) in head.get("strike").map(|j| j.obj()).unwrap_or(&[]) {
        let drums: Vec<StrikeDrum> = d
            .get("drums")
            .map(|j| j.arr())
            .unwrap_or(&[])
            .iter()
            .map(|e| StrikeDrum {
                pad: e.get("pad").map(|j| j.usize()).unwrap_or(0) as u8,
                c: v3(e.get("c")),
                n: v3(e.get("n")),
                ex: v3(e.get("ex")),
                ez: v3(e.get("ez")),
                r: e.get("r").map(|j| j.num() as f32).unwrap_or(0.1),
                spread: e.get("spread").map(|j| j.num() as f32).unwrap_or(1.0),
                hand: e.get("hand").and_then(|j| j.str().chars().next()),
            })
            .collect();
        let stick = |k: &str| {
            let s = d.get("stick").and_then(|x| x.get(k));
            StickG { tip: v3(s.and_then(|x| x.get("tip"))), ax: v3(s.and_then(|x| x.get("ax"))), rh: s.and_then(|x| x.get("rh")).map(|j| j.num() as f32).unwrap_or(0.01) }
        };
        let anc = |k: &str| v3(d.get("anchor").and_then(|x| x.get(k)));
        if drums.is_empty() {
            continue;
        }
        strike.insert(name.clone(), StrikeTbl { drums, stick: [stick("R"), stick("L")], anchor: [anc("R"), anc("L")], click: v3(d.get("click")) });
    }
    Ok(Human { nb, parent, rest, rest_world, mats, body, insts, parts, clips, clip_ix, upper, strides, chest: *names.get("chest").unwrap_or(&2), mid, bone_ix: names, mats_i, ill_body, face, strike })
}

/// 埋め込みアセット（読めなければ None）
pub fn human() -> Option<&'static Human> {
    static H: OnceLock<Option<Human>> = OnceLock::new();
    H.get_or_init(|| load().ok()).as_ref()
}

// ================= クォータニオン・クリップ =================

fn slerp(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    if t <= 0.0 {
        return a;
    }
    if t >= 1.0 {
        return b;
    }
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let dir = if cos >= 0.0 { 1.0 } else { -1.0 };
    let sq = 1.0 - cos * cos;
    let (mut s, mut tt) = (1.0 - t, t);
    let lerp = sq <= f32::EPSILON;
    if !lerp {
        let sin = sq.sqrt();
        let len = sin.atan2(cos * dir);
        s = ((1.0 - t) * len).sin() / sin;
        tt = (t * len).sin() / sin;
    }
    let td = tt * dir;
    let mut r = [a[0] * s + b[0] * td, a[1] * s + b[1] * td, a[2] * s + b[2] * td, a[3] * s + b[3] * td];
    if lerp {
        let l = (r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3]).sqrt();
        if l > 0.0 {
            r.iter_mut().for_each(|x| *x /= l);
        }
    }
    r
}

fn qget(q: &[f32], i: usize) -> [f32; 4] {
    [q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]]
}
fn qset(q: &mut [f32], i: usize, v: [f32; 4]) {
    q[i * 4..i * 4 + 4].copy_from_slice(&v);
}

/// ボーンごとの姿勢（位置3 + 回転4）
#[derive(Clone)]
pub struct Pose {
    pub p: Vec<f32>,
    pub q: Vec<f32>,
}

impl Human {
    pub fn rest_pose(&self) -> Pose {
        let mut p = vec![0.0; self.nb * 3];
        let mut q = vec![0.0; self.nb * 4];
        for i in 0..self.nb {
            p[i * 3..i * 3 + 3].copy_from_slice(&self.rest[i]);
            q[i * 4 + 3] = 1.0;
        }
        Pose { p, q }
    }

    fn clip(&self, name: &str) -> Option<&Clip> {
        self.clip_ix.get(name).map(|&i| &self.clips[i])
    }

    /// クリップの f フレーム目（小数可）を po へ重み w で混ぜる（w=1 で上書き）
    fn sample(&self, c: &Clip, f: f32, looped: bool, po: &mut Pose, w: f32) {
        let n = c.frames as i64;
        let nbn = c.bones.len();
        let st = nbn * 7;
        let fl = f.floor();
        let t = f - fl;
        let (mut i0, mut i1) = (fl as i64, fl as i64 + 1);
        if looped {
            i0 = i0.rem_euclid(n);
            i1 = i1.rem_euclid(n);
        } else {
            i0 = i0.clamp(0, n - 1);
            i1 = i1.clamp(0, n - 1);
        }
        for k in 0..nbn {
            let b = c.bones[k];
            let o0 = i0 as usize * st + k * 7;
            let o1 = i1 as usize * st + k * 7;
            for j in 0..3 {
                let v = c.data[o0 + j] + (c.data[o1 + j] - c.data[o0 + j]) * t;
                let d = &mut po.p[b * 3 + j];
                *d = if w >= 1.0 { v } else { *d + (v - *d) * w };
            }
            let q0 = [c.data[o0 + 3], c.data[o0 + 4], c.data[o0 + 5], c.data[o0 + 6]];
            let q1 = [c.data[o1 + 3], c.data[o1 + 4], c.data[o1 + 5], c.data[o1 + 6]];
            let s = slerp(q0, q1, t);
            if w >= 1.0 {
                qset(&mut po.q, b, s);
            } else {
                let cur = qget(&po.q, b);
                qset(&mut po.q, b, slerp(cur, s, w));
            }
        }
    }

    fn walk_sample(&self, ty: &str, speed: f32, phase: f32, po: &mut Pose) {
        let last = *self.strides.last().unwrap_or(&0.0);
        let s = speed.clamp(0.0, last);
        let mut i = 0;
        while i + 2 < self.strides.len() && s > self.strides[i + 1] {
            i += 1;
        }
        let (a, b) = (self.strides[i], *self.strides.get(i + 1).unwrap_or(&self.strides[i]));
        let k = (s - a) / if (b - a).abs() > 1e-9 { b - a } else { 1.0 };
        let nm = |v: f32| format!("walk/{}/{}", ty, v);
        let (Some(ca), cb) = (self.clip(&nm(a)), self.clip(&nm(b))) else { return };
        let f = (((phase / 2.0) % 1.0) + 1.0) % 1.0 * ca.frames as f32;
        self.sample(ca, f, true, po, 1.0);
        if k > 0.001 {
            if let Some(cb) = cb {
                self.sample(cb, f, true, po, k);
            }
        }
    }
}

/// 1人ぶんの動きの入力（render.rs の State と楽器の種類から作る）
pub struct Look<'a> {
    /// 楽器名（"trumpet" など。無ければ "other"）
    pub kind: &'a str,
    pub step: Option<&'a str>,
    pub moving: bool,
    pub mark: bool,
    /// 速度 m/カウント ÷ 0.1（view3d.js の speed と同じ）
    pub speed: f32,
    pub phase: f32,
    pub action: Option<&'a str>,
    pub pose: Option<&'a str>,
    pub pose_blend: f32,
    /// 楽器の構え（play / right / left / front / diag）と、前のセットの構え、切り替えの進み具合 0..1
    pub carry: Option<&'a str>,
    pub carry_from: Option<&'a str>,
    pub carry_blend: f32,
    /// 通算カウント
    pub t: f32,
    /// 体の向き（フィールド座標の角度、度。view3d.js の jkFacing）
    pub face_deg: f32,
    /// 進行方向（フィールド座標）
    pub dir: (f32, f32),
}


fn sstep(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

impl Human {
    /// 下半身（stance / walk と姿勢）。wk = 歩きの混ぜ具合 0..1
    pub fn lower(&self, l: &Look, wk: f32, po: &mut Pose) {
        let mut ty = match l.step {
            Some("high") => "high",
            Some("jazz") => "jazz",
            Some("back") => "back",
            _ => "glide",
        };
        // 体の向きに対する進行方向で脚の動きを選ぶ（正面のまま横へ進むなら横歩き、後ろ向きに進むならバック）
        if l.moving {
            let fa = l.face_deg.to_radians();
            let (fx, fy) = (fa.cos(), fa.sin());
            let dl = l.dir.0.hypot(l.dir.1);
            let dl = if dl > 0.0 { dl } else { 1.0 };
            let lf = (l.dir.0 * fx + l.dir.1 * fy) / dl; // 前方成分
            let ll = (-l.dir.0 * fy + l.dir.1 * fx) / dl; // 左方成分
            if ll.abs() > lf.abs() * 0.8 {
                ty = if ll > 0.0 { "slideL" } else { "slideR" };
            } else if lf < 0.0 {
                ty = "back";
            } else if ty == "back" {
                ty = "glide";
            }
        }
        // 古いアセット（横歩きなし）でも動くように
        if self.clip(&format!("walk/{}/0", ty)).is_none() {
            ty = "glide";
        }
        if let Some(c) = self.clip("stance/attention") {
            self.sample(c, 0.0, false, po, 1.0);
        }
        if wk > 0.001 {
            let mut tmp = po.clone();
            self.walk_sample(ty, if l.moving { l.speed } else { 0.0 }, l.phase, &mut tmp);
            if let Some(c) = self.clip("walk/glide/0") {
                for &b in &c.bones {
                    for j in 0..3 {
                        po.p[b * 3 + j] += (tmp.p[b * 3 + j] - po.p[b * 3 + j]) * wk;
                    }
                    let s = slerp(qget(&po.q, b), qget(&tmp.q, b), wk);
                    qset(&mut po.q, b, s);
                }
            }
        }
        let pb = l.pose_blend.clamp(0.0, 1.0);
        if pb > 0.0 {
            if let Some(c) = l.pose.and_then(|p| self.clip(&format!("stance/{}", p))) {
                self.sample(c, 0.0, false, po, pb);
            }
        }
    }

    /// 上半身（構え・休め・アクション）。上半身ボーンだけ po に書く。戻り値は遷移判定用のキー
    pub fn upper(&self, l: &Look, po: &mut Pose) -> String {
        let has = self.has_inst(l.kind);
        let guard = l.kind == "guard";
        let hold_n = if guard { "guard/hold".to_string() } else if has { format!("hold/{}", l.kind) } else { "idle".into() };
        let carry_n = if guard { "guard/carry".to_string() } else if has { format!("carry/{}", l.kind) } else { "behind".into() };
        let pb = l.pose_blend.clamp(0.0, 1.0);
        let (mut a, mut fa, mut looped, mut b, mut wb, mut yaw, mut key) = (hold_n.clone(), 0.0f32, false, None::<String>, 0.0f32, 0.0f32, hold_n.clone());
        let t = l.t;
        match l.action {
            Some("rest") => {
                a = carry_n.clone();
                key = "carry".into();
            }
            Some(act) if guard && self.clip(&format!("guard/{}", act)).is_some() => {
                let c = self.clip(&format!("guard/{}", act)).unwrap();
                a = format!("guard/{}", act);
                looped = true;
                fa = (((t / c.counts.max(1e-6)) % 1.0) + 1.0) % 1.0 * c.frames as f32;
                key = a.clone();
            }
            Some("toss") if has => {
                b = Some(format!("up/{}", l.kind));
                wb = (2.0 * std::f32::consts::PI * t / 4.0).sin().max(0.0);
            }
            Some("spin") if !guard => yaw = 0.55 * (std::f32::consts::PI * t).sin(),
            Some("swing") if !guard => yaw = 0.5 * (std::f32::consts::PI * t).sin(),
            _ => {}
        }
        if l.action.is_none() && l.pose == Some("rest") && pb > 0.0 {
            b = Some(carry_n.clone());
            wb = pb;
        }
        // 楽器の構え（右手・左手・正面・斜め）。演奏の構えのとき（hold）だけ差し替え、前の構えから carry_blend でなめらかに
        let style_n = |c: Option<&str>| -> String {
            let n = format!("style/{}/{}", c.unwrap_or("play"), if guard { "guard" } else { l.kind });
            if c.is_some() && c != Some("play") && (guard || has) && self.clip(&n).is_some() { n } else { hold_n.clone() }
        };
        let mut style_to: Option<String> = None;
        if a == hold_n {
            a = style_n(l.carry_from);
            let to = style_n(l.carry);
            if to != a {
                style_to = Some(to);
            }
        }
        if self.clip(&a).is_none() {
            a = "idle".into();
        }
        let mut cur = self.rest_pose();
        if let Some(c) = self.clip(&a) {
            self.sample(c, fa, looped, &mut cur, 1.0);
        }
        if let Some(c) = style_to.as_deref().and_then(|n| self.clip(n)) {
            self.sample(c, 0.0, false, &mut cur, l.carry_blend.clamp(0.0, 1.0));
        }
        if let Some(c) = b.as_deref().and_then(|b| self.clip(b)) {
            self.sample(c, 0.0, false, &mut cur, wb);
        }
        for &bi in &self.upper {
            po.p[bi * 3..bi * 3 + 3].copy_from_slice(&cur.p[bi * 3..bi * 3 + 3]);
            qset(&mut po.q, bi, qget(&cur.q, bi));
        }
        if yaw != 0.0 {
            let (s, c) = (yaw / 2.0).sin_cos();
            let qy = [0.0, s, 0.0, c];
            let o = qget(&po.q, self.chest);
            qset(&mut po.q, self.chest, qmul(qy, o));
        }
        key
    }

    /// 上半身を from から to へ w で混ぜる（切り替え時のなめらかな遷移）
    pub fn blend_upper(&self, from: &Pose, to: &mut Pose, w: f32) {
        for &bi in &self.upper {
            for j in 0..3 {
                to.p[bi * 3 + j] = from.p[bi * 3 + j] + (to.p[bi * 3 + j] - from.p[bi * 3 + j]) * w;
            }
            let s = slerp(qget(&from.q, bi), qget(&to.q, bi), w);
            qset(&mut to.q, bi, s);
        }
    }
}

pub fn smoothstep01(x: f32) -> f32 {
    sstep(x)
}

fn qmul(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

// ================= FK・スキニング =================

/// 3x4 アフィン変換（r は行優先の 3x3）
#[derive(Clone, Copy)]
pub struct M34 {
    pub r: [f32; 9],
    pub t: [f32; 3],
}

impl M34 {
    pub fn ident() -> M34 {
        M34 { r: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], t: [0.0; 3] }
    }
    pub fn apply(&self, p: [f32; 3]) -> [f32; 3] {
        let r = &self.r;
        [r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + self.t[0], r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + self.t[1], r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + self.t[2]]
    }
    pub fn rot(&self, p: [f32; 3]) -> [f32; 3] {
        let r = &self.r;
        [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]]
    }
    /// self * o
    pub fn mul(&self, o: &M34) -> M34 {
        let (a, b) = (&self.r, &o.r);
        let mut r = [0.0; 9];
        for i in 0..3 {
            for j in 0..3 {
                r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
            }
        }
        M34 { r, t: self.apply(o.t) }
    }
}

fn quat_mat(q: [f32; 4]) -> [f32; 9] {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let n = (x * x + y * y + z * z + w * w).sqrt().max(1e-12);
    let (x, y, z, w) = (x / n, y / n, z / n, w / n);
    [
        1.0 - 2.0 * (y * y + z * z),
        2.0 * (x * y - z * w),
        2.0 * (x * z + y * w),
        2.0 * (x * y + z * w),
        1.0 - 2.0 * (x * x + z * z),
        2.0 * (y * z - x * w),
        2.0 * (x * z - y * w),
        2.0 * (y * z + x * w),
        1.0 - 2.0 * (x * x + y * y),
    ]
}

/// 人物の配置（足元位置・向き・体格）
pub struct Placement {
    pub x: f32,
    pub z: f32,
    pub yaw: f32,
    pub sx: f32,
    pub sy: f32,
}

/// 1人ぶんのスキニング行列（ボーンごと）と楽器の剛体変換
pub struct Rig {
    /// 位置用: 全ボーン分の (モデル変換 * ワールド * 逆バインド)
    pub skin: Vec<M34>,
    /// 法線用: 回転だけ（体格スケールは無視）
    pub nrm: Vec<M34>,
    /// 楽器の本体と部品ごとの (位置用, 法線用) 変換。順序は part_list と同じ
    pub insts: Vec<(M34, M34)>,
    /// 頭のボーンの (位置用, 法線用) 変換（髪を付ける）
    pub head: (M34, M34),
}

impl Human {
    pub fn rig(&self, po: &Pose, pl: &Placement, kind: &str) -> Rig {
        let nb = self.nb;
        let mut world: Vec<M34> = Vec::with_capacity(nb);
        for i in 0..nb {
            let loc = M34 { r: quat_mat(qget(&po.q, i)), t: [po.p[i * 3], po.p[i * 3 + 1], po.p[i * 3 + 2]] };
            let w = if self.parent[i] >= 0 { world[self.parent[i] as usize].mul(&loc) } else { loc };
            world.push(w);
        }
        // モデル変換 = 平行移動 * Y回転 * スケール
        let (s, c) = pl.yaw.sin_cos();
        let ry = [c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c];
        let mut sm = M34 { r: ry, t: [pl.x, 0.0, pl.z] };
        let scale = M34 { r: [pl.sx, 0.0, 0.0, 0.0, pl.sy, 0.0, 0.0, 0.0, pl.sx], t: [0.0; 3] };
        sm = sm.mul(&scale);
        let rot_only = M34 { r: ry, t: [0.0; 3] };
        let mut skin = Vec::with_capacity(nb);
        let mut nrm = Vec::with_capacity(nb);
        for i in 0..nb {
            let m = sm.mul(&world[i]);
            let rw = self.rest_world[i];
            let rr = m.rot(rw);
            skin.push(M34 { r: m.r, t: [m.t[0] - rr[0], m.t[1] - rr[1], m.t[2] - rr[2]] });
            nrm.push(rot_only.mul(&M34 { r: world[i].r, t: [0.0; 3] }));
        }
        let mut insts = Vec::new();
        for name in self.part_list(kind) {
            if let Some(ins) = self.insts.get(name.as_str()) {
                let at = M34 { r: quat_mat(ins.aquat), t: ins.apos };
                insts.push((
                    sm.mul(&world[ins.bone]).mul(&at),
                    rot_only.mul(&M34 { r: world[ins.bone].r, t: [0.0; 3] }).mul(&M34 { r: at.r, t: [0.0; 3] }),
                ));
            }
        }
        let hb = self.bone_ix.get("head").copied().unwrap_or(0);
        let head = (sm.mul(&world[hb]), rot_only.mul(&M34 { r: world[hb].r, t: [0.0; 3] }));
        Rig { skin, nrm, insts, head }
    }

    /// 楽器を構成するメッシュの名前（本体があれば先頭、続けて手に付く部品）
    pub fn part_list(&self, kind: &str) -> Vec<String> {
        let mut v = vec![];
        if self.insts.contains_key(kind) {
            v.push(kind.to_string());
        }
        if let Some(p) = self.parts.get(kind) {
            v.extend(p.iter().cloned());
        }
        v
    }

    pub fn has_inst(&self, kind: &str) -> bool {
        self.insts.contains_key(kind) || self.parts.contains_key(kind)
    }

    /// 楽器のメッシュ一覧（part_list と同じ順）
    pub fn inst_meshes(&self, kind: &str) -> Vec<&MeshData> {
        self.part_list(kind).iter().filter_map(|n| self.insts.get(n.as_str()).map(|i| &i.mesh)).collect()
    }

    /// 体メッシュを LBS でスキニング（ワールド座標の位置と法線を出力）
    pub fn skin_body(&self, rig: &Rig, out: &mut Vec<(V3, V3)>) {
        self.skin_mesh(&self.body, rig, out)
    }

    /// 髪メッシュ（頭のボーンに付く剛体）をワールド座標へ
    pub fn skin_hair(&self, rig: &Rig, name: &str, out: &mut Vec<(V3, V3)>) {
        out.clear();
        let Some(ins) = self.insts.get(name) else { return };
        let at = M34 { r: quat_mat(ins.aquat), t: ins.apos };
        let mn = rig.head.1.mul(&M34 { r: at.r, t: [0.0; 3] });
        self.skin_one(ins, rig.head.0.mul(&at), mn, None, out);
    }

    pub fn skin_mesh(&self, b: &MeshData, rig: &Rig, out: &mut Vec<(V3, V3)>) {
        out.clear();
        out.reserve(b.pos.len());
        for v in 0..b.pos.len() {
            let (p, n) = (b.pos[v], b.nor[v]);
            let (ix, wt) = (b.skin_i[v], b.skin_w[v]);
            let mut op = [0.0f32; 3];
            let mut on = [0.0f32; 3];
            for k in 0..4 {
                let w = wt[k];
                if w <= 0.0 {
                    continue;
                }
                let bi = ix[k] as usize;
                let q = rig.skin[bi].apply(p);
                let nn = rig.nrm[bi].rot(n);
                for j in 0..3 {
                    op[j] += q[j] * w;
                    on[j] += nn[j] * w;
                }
            }
            out.push((v3(op[0], op[1], op[2]), v3(on[0], on[1], on[2])));
        }
    }

    /// 楽器をワールド座標へ。flag = Some((時間 = 通算カウント × 0.5, 動きの強さ 0..1)) なら旗の布を波打たせる
    pub fn skin_inst(&self, rig: &Rig, kind: &str, flag: Option<(f32, f32)>, out: &mut Vec<(V3, V3)>) {
        out.clear();
        for (name, &(m, mn)) in self.part_list(kind).iter().zip(rig.insts.iter()) {
            let Some(ins) = self.insts.get(name.as_str()) else { continue };
            self.skin_one(ins, m, mn, flag, out);
        }
    }

    fn skin_one(&self, ins: &Inst, m: M34, mn: M34, flag: Option<(f32, f32)>, out: &mut Vec<(V3, V3)>) {
        out.reserve(ins.mesh.pos.len());
        let wave = match (flag, ins.flag_box) {
            (Some((time, act)), Some(fb)) => Some((time, act, fb)),
            _ => None,
        };
        for v in 0..ins.mesh.pos.len() {
            let (mut p, mut nr) = (ins.mesh.pos[v], ins.mesh.nor[v]);
            if let Some((time, act, fb)) = wave {
                let mi = ins.mesh.mat[v] as usize;
                if mi == self.mid.cloth || mi == self.mid.cloth2 {
                    // 布の頂点シェーダ（view3d.js）と同じ式。fu = ポールからの距離、fh = 上端からの距離（0..1）
                    let fu = ((fb[0] - p[0]) / fb[1]).clamp(0.0, 1.0);
                    let fh = ((fb[2] - p[1]) / fb[3]).clamp(0.0, 1.0);
                    let droop = 1.0 - act;
                    let ph = fu * 6.5 - time * (2.2 + 3.5 * act) + fh * 1.8;
                    let ph2 = ph * 2.3 + fh * 3.0;
                    let amp = (0.03 + 0.12 * act) * (0.12 + fu);
                    let (s1, c1, s2, c2) = (ph.sin(), ph.cos(), ph2.sin(), ph2.cos());
                    let dz = amp * (s1 + 0.35 * s2);
                    let dzdu = amp * (6.5 * c1 + 0.35 * 2.3 * 6.5 * c2);
                    let dzdh = amp * (1.8 * c1 + 0.35 * (2.3 * 1.8 + 3.0) * c2);
                    // 垂れ下がり: ポールのほうへ縮み、自由端が下がる
                    p[0] += fu * fb[1] * 0.5 * droop;
                    p[1] += -droop * 0.3 * fu * fu * fb[1] * (1.0 - 0.5 * fh);
                    p[2] += dz;
                    let s = if nr[2] < 0.0 { -1.0 } else { 1.0 };
                    let (nx, ny, nz) = (dzdu / fb[1] * s, dzdh / fb[3] * s, s);
                    let l = (nx * nx + ny * ny + nz * nz).sqrt();
                    nr = [nx / l, ny / l, nz / l];
                }
            }
            let p = m.apply(p);
            let n = mn.rot(nr);
            out.push((v3(p[0], p[1], p[2]), v3(n[0], n[1], n[2])));
        }
    }
}

// ================= 打楽器を叩く動き（strike.rs の状態を前腕・手首へ足す）=================

fn qinv(a: [f32; 4]) -> [f32; 4] {
    [-a[0], -a[1], -a[2], a[3]]
}
fn qx(a: f32) -> [f32; 4] {
    [(a / 2.0).sin(), 0.0, 0.0, (a / 2.0).cos()]
}
fn qy(a: f32) -> [f32; 4] {
    [0.0, (a / 2.0).sin(), 0.0, (a / 2.0).cos()]
}

impl Human {
    /// ボーン b の「モデル座標での回転 rm」を、関節（ボーンの原点）まわりに掛ける
    fn rotate_joint(&self, po: &mut Pose, b: usize, rm: [f32; 4]) {
        let mut chain = vec![];
        let mut k = self.parent[b];
        while k >= 0 {
            chain.push(k as usize);
            k = self.parent[k as usize];
        }
        let mut wp = [0.0, 0.0, 0.0, 1.0];
        for &c in chain.iter().rev() {
            wp = qmul(wp, qget(&po.q, c));
        }
        let n = qmul(qmul(qmul(qinv(wp), rm), wp), qget(&po.q, b));
        qset(&mut po.q, b, n);
    }

    /// 打つ動きを上半身へ足す。amt = 演奏の構えのときの度合い。kind = 楽器のメッシュ名（打面の表を引く）
    pub fn apply_strike(&self, po: &mut Pose, kind: &str, fam: crate::strike::Fam, st: &crate::strike::StrikeSt, amt: f32) {
        use crate::strike::{stick_base, Fam};
        if amt <= 0.001 {
            return;
        }
        if matches!(fam, Fam::Snare | Fam::Tenors | Fam::Bass) {
            if let Some(tbl) = self.strike.get(kind) {
                self.strike_ik(po, tbl, fam, st, amt);
                return;
            }
        }
        for right in [true, false] {
            if fam == Fam::Glock && !right {
                continue;
            }
            let sd = if right { -1.0f32 } else { 1.0 };
            let s = if right { &st.r } else { &st.l };
            let sfx = if right { "R" } else { "L" };
            let (Some(fa), Some(hd)) = (self.bone_ix.get(&format!("foreArm{}", sfx)), self.bone_ix.get(&format!("hand{}", sfx))) else { continue };
            let (fr, hr);
            match fam {
                Fam::Cymbals => {
                    let c = amt * st.w * (1.0 - 1.5 * s.lift);
                    let up = -s.lift * 0.35 * amt;
                    fr = qmul(qy(-sd * c * 0.28), qx(up));
                    hr = qmul(qy(-sd * c * 0.1), qx(up * 0.5));
                }
                _ => {
                    let th = s.lift * amt;
                    let yaw = (((s.x - stick_base(fam, right)) / 0.47).atan() + sd * s.rim * 0.28) * amt;
                    fr = qmul(qy(yaw * 0.7), qx(-th * 0.4));
                    hr = qmul(qy(yaw * 0.3), qx(-th * 0.6));
                }
            }
            self.rotate_joint(po, *fa, fr);
            self.rotate_joint(po, *hd, hr);
        }
    }

    /// 全ボーンのモデル座標の位置・回転
    fn fk_world(&self, po: &Pose) -> (Vec<[f32; 3]>, Vec<[f32; 4]>) {
        let mut wp: Vec<[f32; 3]> = Vec::with_capacity(self.nb);
        let mut wq: Vec<[f32; 4]> = Vec::with_capacity(self.nb);
        for i in 0..self.nb {
            let lp = [po.p[i * 3], po.p[i * 3 + 1], po.p[i * 3 + 2]];
            let lq = qget(&po.q, i);
            if self.parent[i] < 0 {
                wp.push(lp);
                wq.push(lq);
            } else {
                let pa = self.parent[i] as usize;
                wp.push(va(wp[pa], qrot(wq[pa], lp)));
                wq.push(qmul(wq[pa], lq));
            }
        }
        (wp, wq)
    }

    /// スネア・テナー・バス: 打面の接点へスティックの先が着くように、肩 → 肘 → 手首を IK で解く（strike.js の jkStrikeIK と同じ式）
    fn strike_ik(&self, po: &mut Pose, tbl: &StrikeTbl, fam: crate::strike::Fam, st: &crate::strike::StrikeSt, amt: f32) {
        use crate::strike::Fam;
        if !(st.r.has || st.l.has) {
            return;
        }
        let ix = |n: &str| self.bone_ix.get(n).copied().unwrap_or(0);
        let (chest, neck, prop) = (ix("chest"), ix("neck"), ix("prop"));
        let pr = self.rest_world[prop];
        // 胴体のひねり（テナー。楽器の位置は変えない）
        let th = if fam == Fam::Tenors && st.r.has && st.l.has {
            let ar = ((st.r.p[0] - 0.02).max(0.0) / 0.40).min(1.0);
            let al = ((-st.l.p[0] - 0.02).max(0.0) / 0.40).min(1.0);
            0.34 * (sst(ar) - sst(al)) * amt
        } else {
            0.0
        };
        if th.abs() > 1e-4 {
            let (wp0, wq0) = self.fk_world(po);
            let (pw, pq) = (wp0[prop], wq0[prop]);
            self.rotate_joint(po, chest, qy(th));
            self.rotate_joint(po, neck, qy(-0.65 * th));
            let (wp1, wq1) = self.fk_world(po);
            let ci = qinv(wq1[chest]);
            let pl = qrot(ci, vsub(pw, wp1[chest]));
            let ql = qmul(ci, pq);
            po.p[prop * 3..prop * 3 + 3].copy_from_slice(&pl);
            qset(&mut po.q, prop, ql);
        }
        let (wp, wq) = self.fk_world(po);
        // 越える腕
        let (mut c_r, mut c_l) = (0.0f32, 0.0f32);
        if fam == Fam::Tenors && st.r.has && st.l.has {
            let (xr, xl) = (st.r.p[0], st.l.p[0]);
            let (a_r, a_l) = (xr, -xl);
            let c = sst((xr - xl + 0.08) / 0.16) * sst(a_r.max(a_l) / 0.12);
            let k = sst(0.5 + (a_r - a_l) / 0.1);
            c_r = c * k;
            c_l = c * (1.0 - k);
        }
        for (right, s, cross) in [(true, &st.r, c_r), (false, &st.l, c_l)] {
            if !s.has {
                continue;
            }
            let sfx = if right { "R" } else { "L" };
            let sd = if right { -1.0f32 } else { 1.0 };
            let sk = &tbl.stick[if right { 0 } else { 1 }];
            let (ua, fa, hb, cl) = (ix(&format!("upperArm{}", sfx)), ix(&format!("foreArm{}", sfx)), ix(&format!("hand{}", sfx)), ix(&format!("clav{}", sfx)));
            let (tl, al) = (sk.tip, sk.ax);
            let ell = vl(tl);
            let (ht, cap, rise, upk) = match fam {
                Fam::Bass => (0.80f32, 0.62f32, 0.12f32, 0.16f32),
                _ => (0.30, 0.42, 0.07, 0.0),
            };
            let pm = |p: [f32; 3]| va(wp[prop], qrot(wq[prop], vsub(p, pr)));
            // 構えのモデル座標で、手首を支点に棒が振れるとして先端の位置と向きを決める
            let hh = (s.lift * ht + s.arc).min(cap);
            let w = rise * s.lift.min(1.3);
            let sb0 = s.b0.sin();
            let sb = (sb0 - (hh - w) / ell).clamp(-0.96, 0.95);
            let (cb0, cb) = (s.b0.cos(), (1.0 - sb * sb).sqrt());
            let d0 = vsub(vm(s.f, cb0), vm(s.n, sb0));
            let d = vsub(vm(s.f, cb), vm(s.n, sb));
            let wc = vsub(vma(s.p, s.n, sk.rh), vm(d0, ell));
            let wh = va(vma(wc, s.n, w), [0.0, upk * s.lift.min(1.3), 0.0]);
            let tip = va(wh, vm(d, ell));
            let t = pm(tip);
            let dm = qrot(wq[prop], d);
            // 手の向き: クリップの手の向きから、棒の軸を dm へ回す最短の回転
            let qh = wq[hb];
            let mut rh = qmul(qarc(qrot(qh, al), dm), qh);
            let mut wr = vsub(t, qrot(rh, tl));
            if cross > 0.0 {
                let w2 = va(wr, [0.0, 0.085 * cross, 0.035 * cross]);
                let u = vm(vn(vsub(t, w2)), ell);
                rh = qmul(qarc(qrot(rh, tl), u), rh);
                wr = vsub(t, u);
            }
            // 2 関節 IK（肩 → 肘 → 手首）
            let sh = wp[ua];
            let (lf, lh) = ([po.p[fa * 3], po.p[fa * 3 + 1], po.p[fa * 3 + 2]], [po.p[hb * 3], po.p[hb * 3 + 1], po.p[hb * 3 + 2]]);
            let (a, b) = (vl(lf), vl(lh));
            let dv = vsub(wr, sh);
            let dist0 = vl(dv);
            let dn = vm(dv, 1.0 / dist0);
            let dist = dist0.min((a + b) * 0.9995);
            let aa = (a * a - b * b + dist * dist) / (2.0 * dist);
            let h2 = (a * a - aa * aa).max(0.0).sqrt();
            let pole = if fam == Fam::Bass { [sd * 0.9, -0.5 + 0.9 * cross, -0.2] } else { [sd * 0.6, -1.0 + 1.3 * cross, -0.35] };
            let pv = vn(vsub(pole, vm(dn, vd(pole, dn))));
            let elbow = va(vma(sh, dn, aa), vm(pv, h2));
            let wrist = vma(sh, dn, dist);
            let q_u0 = wq[ua];
            let (u_loc, f_loc) = (vn(lf), vn(lh));
            let q_u = qmul(qarc(qrot(q_u0, u_loc), vsub(elbow, sh)), q_u0);
            let q_f0 = qmul(q_u, qget(&po.q, fa));
            let q_f = qmul(qarc(qrot(q_f0, f_loc), vsub(wrist, elbow)), q_f0);
            let n_u = qmul(qinv(wq[cl]), q_u);
            let n_f = qmul(qinv(q_u), q_f);
            let n_h = qmul(qinv(q_f), rh);
            for (bn, nq) in [(ua, n_u), (fa, n_f), (hb, n_h)] {
                let o = qget(&po.q, bn);
                qset(&mut po.q, bn, slerp(o, nq, amt));
            }
        }
    }
}

fn qrot(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let t = vm(vc([q[0], q[1], q[2]], v), 2.0);
    va(va(v, vm(t, q[3])), vc([q[0], q[1], q[2]], t))
}

/// a を b へ回す最短の回転
fn qarc(a: [f32; 3], b: [f32; 3]) -> [f32; 4] {
    let (a, b) = (vn(a), vn(b));
    let d = vd(a, b);
    if d < -0.999999 {
        let mut ax = vc([1.0, 0.0, 0.0], a);
        if vl(ax) < 1e-3 {
            ax = vc([0.0, 1.0, 0.0], a);
        }
        let ax = vn(ax);
        return [ax[0], ax[1], ax[2], 0.0];
    }
    let c = vc(a, b);
    let l = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2] + (1.0 + d) * (1.0 + d)).sqrt();
    [c[0] / l, c[1] / l, c[2] / l, (1.0 + d) / l]
}

#[cfg(test)]
mod strike_tests {
    use super::*;
    use crate::build::Note;
    use crate::strike;

    fn nt(t: f64, dur: f64, hand: char, accent: u8, kind: &'static str, pad: u8, vel: f32) -> Note {
        Note { t, dur, hand, accent, kind, pad, vel }
    }
    pub fn demo_notes() -> Vec<Note> {
        vec![
            nt(0.0, 0.5, 'R', 1, "tap", 1, 0.7),
            nt(0.5, 0.5, 'L', 0, "tap", 2, 0.4),
            nt(1.0, 0.5, 'R', 2, "tap", 4, 1.0),
            nt(1.5, 0.5, 'L', 0, "tap", 2, 0.7),
            nt(2.0, 1.0, 'R', 0, "scrape", 1, 0.7),
            nt(3.5, 0.5, 'B', 0, "rimshot", 3, 0.7),
            nt(4.5, 0.5, 'R', 0, "flam", 2, 0.7),
            nt(5.0, 0.5, 'R', 0, "gock", 2, 0.7),
            nt(6.0, 0.5, 'B', 0, "stickclick", 0, 0.7),
            nt(7.0, 2.0, 'L', 0, "mute", 6, 0.5),
            nt(9.5, 1.0, 'R', 0, "buzz", 0, 0.7),
            nt(11.0, 0.5, 'L', 1, "diddle", 5, 0.9),
        ]
    }
    pub const TS: [f32; 16] = [0.0, 0.25, 0.5, 0.9, 1.0, 1.2, 2.4, 3.0, 3.5, 4.4, 5.0, 6.0, 7.5, 9.6, 10.5, 11.0];

    /// IK の結果が有限で、全ケースで先端の位置が出ること（JS との一致は手元で比較済み）
    #[test]
    fn ik_hits_targets() {
        let h = human().expect("asset");
        let mut out = String::new();
        for kind in ["tenors", "bass3", "snare"] {
            let notes = demo_notes();
            let refs: Vec<&Note> = notes.iter().collect();
            let spc = 0.6f32;
            let sk = strike::strokes(&refs, kind, spc).unwrap();
            let tbl = h.strike.get(kind).unwrap();
            for &t in TS.iter() {
                let st = strike::state(&sk, t + 1e-4, spc, Some(tbl));
                let mut po = h.rest_pose();
                for cn in ["stance/attention".to_string(), format!("hold/{}", kind)] {
                    let c = &h.clips[h.clip_ix[&cn]];
                    h.sample(c, 0.0, false, &mut po, 1.0);
                }
                h.apply_strike(&mut po, kind, sk.fam, &st, 1.0);
                let (wp, wq) = h.fk_world(&po);
                out += &format!("{} {:.3}", kind, t);
                for (right, s) in [(true, &st.r), (false, &st.l)] {
                    let sk_g = &tbl.stick[if right { 0 } else { 1 }];
                    let hb = h.bone_ix[if right { "handR" } else { "handL" }];
                    let tip = va(wp[hb], qrot(wq[hb], sk_g.tip));
                    out += &format!(" {:.4} {:.4} {:.4}", tip[0], tip[1], tip[2]);
                    let _ = s;
                }
                out += "\n";
            }
        }
        assert!(out.lines().count() == 48 && !out.contains("NaN"));
    }
}
