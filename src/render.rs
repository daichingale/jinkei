//! 3D ソフトウェアレンダラ（外部依存なし）。ffmpeg に生のフレームを流して MP4 を作る。
//!
//! ワールド座標（メートル）: X = 上手(+)、Y = 上、Z = 客席方向(+)。
use crate::build::Show;
use crate::field::{FieldKind, BSL};
use std::io::Write;

// ================= ベクトル =================

#[derive(Clone, Copy, Debug)]
pub struct V3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

pub const fn v3(x: f32, y: f32, z: f32) -> V3 {
    V3 { x, y, z }
}

impl V3 {
    fn add(self, o: V3) -> V3 {
        v3(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    fn sub(self, o: V3) -> V3 {
        v3(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    fn mul(self, k: f32) -> V3 {
        v3(self.x * k, self.y * k, self.z * k)
    }
    fn dot(self, o: V3) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    fn cross(self, o: V3) -> V3 {
        v3(self.y * o.z - self.z * o.y, self.z * o.x - self.x * o.z, self.x * o.y - self.y * o.x)
    }
    fn norm(self) -> V3 {
        let l = self.dot(self).sqrt();
        if l > 0.0 {
            self.mul(1.0 / l)
        } else {
            self
        }
    }
}

pub type Rgb = [f32; 3];

pub fn hex(s: &str) -> Rgb {
    let s = s.trim_start_matches('#');
    let p = |i: usize| u8::from_str_radix(s.get(i..i + 2).unwrap_or("80"), 16).unwrap_or(128) as f32 / 255.0;
    if s.len() >= 6 {
        [p(0), p(2), p(4)]
    } else {
        [0.5, 0.5, 0.5]
    }
}

/// 面の材質（会場用）。c は sRGB の表示色
#[derive(Clone, Copy)]
pub struct Mt {
    pub c: Rgb,
    pub rough: f32,
    /// envMapIntensity
    pub env: f32,
    /// ライティングしない（MeshBasicMaterial）
    pub unlit: bool,
    /// 太陽の影を落とす（castShadow）
    pub cast: bool,
}

fn hex_u32(c: u32) -> Rgb {
    [((c >> 16) & 255) as f32 / 255.0, ((c >> 8) & 255) as f32 / 255.0, (c & 255) as f32 / 255.0]
}

thread_local! {
    /// 会場を作っている間だけ立つ: イラストの見た目（色の彩度を落として明るくする）
    static ILL_V: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn ill_v() -> bool {
    ILL_V.with(|c| c.get())
}

/// イラストの色: 彩度を 0.55 倍にして明るくする（view3d.js の flatC）
fn flat_c(c: u32) -> Rgb {
    let [r, g, b] = hex_u32(c);
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let l = (mx + mn) / 2.0;
    let d = mx - mn;
    let (mut h, mut s) = (0.0f32, 0.0f32);
    if d > 1e-6 {
        s = if l <= 0.5 { d / (mx + mn) } else { d / (2.0 - mx - mn) };
        h = if mx == r {
            ((g - b) / d + if g < b { 6.0 } else { 0.0 }) / 6.0
        } else if mx == g {
            ((b - r) / d + 2.0) / 6.0
        } else {
            ((r - g) / d + 4.0) / 6.0
        };
    }
    hsl_rgb(h, s * 0.55, (l * 0.8 + 0.2).min(0.92))
}

/// view3d.js の mat()（粗さ 0.9・envMapIntensity 0.3）
fn mat(c: u32) -> Mt {
    Mt { c: if ill_v() { flat_c(c) } else { hex_u32(c) }, rough: 0.9, env: 0.3, unlit: false, cast: true }
}

#[derive(Clone)]
pub struct Tri {
    pub p: [V3; 3],
    pub mt: Mt,
    /// 頂点法線（無ければ面法線）
    pub n: Option<[V3; 3]>,
}

/// 床の模様（view3d.js が Canvas に描くテクスチャを、画素ごとの式で再現する）
#[derive(Clone)]
pub enum Pat {
    Plain,
    /// 体育館: 床の半幅・半奥行き、演技フロアの幅・奥行き
    Gym { hw: f32, hd: f32, fw: f32, fd: f32, ill: bool },
    /// 舞台: 袖込みの半幅、奥行き、袖の幅、舞台の幅
    Stage { ww: f32, d: f32, wing: f32, fw: f32, ill: bool },
    /// フットボール場: 奥行き、ハッシュ位置（ユニット）、1ユニットのメートル数
    Football { d: f32, hash: f32, u: f32, ill: bool },
}

/// 水平な床（矩形）
#[derive(Clone)]
pub struct Floor {
    x0: f32,
    z0: f32,
    x1: f32,
    z1: f32,
    y: f32,
    pat: Pat,
    mt: Mt,
}

#[derive(Default, Clone)]
pub struct Mesh {
    pub tris: Vec<Tri>,
    pub floors: Vec<Floor>,
    /// 会場どうしの影（壁や幕が床に落とす影）。venue() が作る
    shadow: Option<std::sync::Arc<ShadowMap>>,
    /// 影を落とす面の三角形
    casters: std::sync::Arc<Vec<[V3; 3]>>,
}

/// Y 軸回りの回転と平行移動（three.js の rotation.y と position）
#[derive(Clone, Copy)]
struct Xf {
    ry: f32,
    t: V3,
}

impl Xf {
    fn at(x: f32, y: f32, z: f32) -> Xf {
        Xf { ry: 0.0, t: v3(x, y, z) }
    }
    fn rot(&self, v: V3) -> V3 {
        let (s, c) = self.ry.sin_cos();
        v3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
    }
    fn p(&self, v: V3) -> V3 {
        self.rot(v).add(self.t)
    }
}

impl Mesh {
    fn tri(&mut self, a: V3, b: V3, c: V3, mt: Mt) {
        self.tris.push(Tri { p: [a, b, c], mt, n: None });
    }
    fn quad(&mut self, a: V3, b: V3, c: V3, d: V3, mt: Mt) {
        self.tri(a, b, c, mt);
        self.tri(a, c, d, mt);
    }
    /// 変換付きの箱（ローカル座標の lo..hi を xf で変換）
    fn boxt(&mut self, xf: &Xf, lo: V3, hi: V3, mt: Mt) {
        let c = |x: f32, y: f32, z: f32| xf.p(v3(x, y, z));
        let (x0, y0, z0, x1, y1, z1) = (lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
        let v = [c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0), c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)];
        for f in [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]] {
            self.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], mt);
        }
    }
    /// 中心 (x,y,z)・幅 w・高さ h の箱（view3d.js の box()）
    fn bx(&mut self, xf: &Xf, w: f32, h: f32, d: f32, mt: Mt, x: f32, y: f32, z: f32) {
        self.boxt(xf, v3(x - w / 2.0, y - h / 2.0, z - d / 2.0), v3(x + w / 2.0, y + h / 2.0, z + d / 2.0), mt);
    }
    fn floor(&mut self, x0: f32, z0: f32, x1: f32, z1: f32, y: f32, pat: Pat, mt: Mt) {
        self.floors.push(Floor { x0, z0, x1, z1, y, pat, mt });
    }
    /// ひだのある布（view3d.js の curtain()）。XY 平面に作って z 方向に正弦波で波打たせ、頂点法線を持たせる
    fn curtain(&mut self, xf: &Xf, w: f32, h: f32, col: u32, period: f32, amp: f32) {
        let segs = ((w / period * 8.0).round() as usize).max(8);
        let rows = 6usize;
        let mt = Mt { c: if ill_v() { flat_c(col) } else { hex_u32(col) }, rough: 0.96, env: 0.15, unlit: false, cast: true };
        let tau = 2.0 * PI;
        let vtx = |i: usize, j: usize| -> (V3, V3) {
            let x = -w / 2.0 + w * i as f32 / segs as f32;
            let y = h / 2.0 - h * j as f32 / rows as f32;
            let a = x / period * tau;
            let k = 1.0 - 0.3 * (y / h + 0.5);
            let z = amp * a.sin() * k + 0.03 * (a * 2.3 + y * 0.4).sin();
            let dzdx = amp * a.cos() * (tau / period) * k + 0.03 * (a * 2.3 + y * 0.4).cos() * 2.3 * (tau / period);
            let dzdy = amp * a.sin() * (-0.3 / h) + 0.03 * (a * 2.3 + y * 0.4).cos() * 0.4;
            (xf.p(v3(x, y, z)), xf.rot(v3(-dzdx, -dzdy, 1.0).norm()))
        };
        for i in 0..segs {
            for j in 0..rows {
                let (a, b, c, d) = (vtx(i, j), vtx(i + 1, j), vtx(i + 1, j + 1), vtx(i, j + 1));
                self.tris.push(Tri { p: [a.0, b.0, c.0], mt, n: Some([a.1, b.1, c.1]) });
                self.tris.push(Tri { p: [a.0, c.0, d.0], mt, n: Some([a.1, c.1, d.1]) });
            }
        }
    }
}

// ================= 床の模様（sRGB 0..255 で計算）=================

/// 幅 2*half の細い線（中心からの距離 d）を、画素の大きさ fp で平均したときの被覆率
fn cov(d: f32, half: f32, fp: f32) -> f32 {
    let fp = fp.max(1e-4);
    let (lo, hi) = ((d - fp * 0.5).max(-half), (d + fp * 0.5).min(half));
    ((hi - lo) / fp).clamp(0.0, 1.0)
}

/// 区間 [a0, a1] の被覆率
fn cov_range(x: f32, a0: f32, a1: f32, fp: f32) -> f32 {
    let fp = fp.max(1e-4);
    let (lo, hi) = ((x - fp * 0.5).max(a0), (x + fp * 0.5).min(a1));
    ((hi - lo) / fp).clamp(0.0, 1.0)
}

fn over(c: [f32; 3], o: [f32; 3], a: f32) -> [f32; 3] {
    [c[0] + (o[0] - c[0]) * a, c[1] + (o[1] - c[1]) * a, c[2] + (o[2] - c[2]) * a]
}

/// 板張り（縦割り）。u = 板の並びの左端からの距離。板ごとに明るさを変え、継ぎ目と細い木目を引く
fn planks(u: f32, fx: f32, pw: f32, base: [f32; 3], vary: &[f32], grain: bool) -> [f32; 3] {
    let k = (u / pw).floor();
    let ki = k as i32;
    let mut t = vary[ki.rem_euclid(vary.len() as i32) as usize];
    // 画素が板より大きいときは明るさの違いをならす
    let mean = vary.iter().sum::<f32>() / vary.len() as f32;
    t += (mean - t) * ((fx - 0.15) / 0.6).clamp(0.0, 1.0);
    let mut c = [base[0] + t, base[1] + t * 0.85, base[2] + t * 0.7];
    if grain {
        let r = u - k * pw;
        for j in 0..4 {
            let gx = pw * (0.15 + 0.7 * ((j as f32 * 0.37 + k * 0.23) % 1.0)) + 0.01 * (k + j as f32).sin();
            c = over(c, [70.0, 40.0, 15.0], 0.16 * cov(r - gx, 0.006, fx));
        }
        c = over(c, [40.0, 22.0, 8.0], 0.45 * cov(r.min(pw - r), 0.007, fx));
    }
    c
}

const TAPE: [f32; 3] = [251.0, 251.0, 246.0];

fn gym_color(hw: f32, hd: f32, fw: f32, fd: f32, ill: bool, x: f32, z: f32, fx: f32, fz: f32) -> [f32; 3] {
    let _ = hd;
    let inside = cov_range(x, -fw / 2.0, fw / 2.0, fx) * cov_range(z, -fd / 2.0, fd / 2.0, fz);
    let mut c;
    if ill {
        // イラスト: うすい灰緑の床に、演技フロアだけ少し明るく
        c = over([169.0, 184.0, 168.0], [188.0, 203.0, 185.0], inside);
    } else {
        c = planks(x + hw, fx, 0.9, [176.0, 118.0, 64.0], &[0.0, 9.0, -6.0, 4.0, -4.0, 7.0, -8.0], true);
        c = over(c, [40.0, 20.0, 5.0], 0.18);
    }
    if x.abs() > fw / 2.0 + 1.0 || z.abs() > fd / 2.0 + 1.0 {
        return c;
    }
    if !ill {
        // 演技フロア（少し明るい: 加算合成）
        for (k, a) in [40.0f32, 25.0, 10.0].iter().enumerate() {
            c[k] = (c[k] + a * 0.12 * inside).min(255.0);
        }
    }
    // 白テープ: 外枠・内側 20m 枠・十字
    let hl = if ill { 0.055 } else { 0.045 };
    let rect = |a: f32, b: f32| -> f32 {
        let eh = cov_range(x, -a - hl, a + hl, fx) * cov(z.abs() - b, hl, fz);
        let ev = cov(x.abs() - a, hl, fx) * cov_range(z, -b - hl, b + hl, fz);
        eh.max(ev)
    };
    let mut l = rect(fw / 2.0, fd / 2.0);
    if fw >= 25.0 && fd >= 25.0 {
        l = l.max(rect(10.0, 10.0));
    }
    l = l.max(cov(x, hl, fx) * cov_range(z, -fd / 2.0, fd / 2.0, fz));
    l = l.max(cov(z, hl, fz) * cov_range(x, -fw / 2.0, fw / 2.0, fx));
    // 5m ごとの十字マーク（最も近い格子点だけ見る）
    let (gx, gz) = ((x / 5.0).round() * 5.0, (z / 5.0).round() * 5.0);
    if gx >= (-fw / 10.0).ceil() * 5.0 - 1e-3 && gx <= fw / 2.0 + 1e-3 && gz >= (-fd / 10.0).ceil() * 5.0 - 1e-3 && gz <= fd / 2.0 + 1e-3 {
        let h = 0.0375;
        let m1 = cov(z - gz, h, fz) * cov_range(x, gx - 0.28, gx + 0.28, fx);
        let m2 = cov(x - gx, h, fx) * cov_range(z, gz - 0.28, gz + 0.28, fz);
        l = l.max(m1.max(m2));
    }
    over(c, if ill { [255.0; 3] } else { TAPE }, l)
}

fn stage_color(ww: f32, d: f32, wing: f32, fw: f32, ill: bool, x: f32, z: f32, fx: f32, fz: f32) -> [f32; 3] {
    let u = x + ww;
    let dark = if ill { [157.0, 150.0, 163.0] } else { [27.0, 22.0, 20.0] };
    let inside = cov_range(u, wing, wing + fw, fx);
    let mut c = dark;
    if inside > 0.0 {
        let p = if ill { [200.0, 191.0, 176.0] } else { planks(u - wing, fx, 0.6, [92.0, 62.0, 40.0], &[0.0, 6.0, -5.0, 3.0], true) };
        c = over(dark, p, inside);
    }
    let _ = d;
    // 舞台前端の白線と、センターの黄色い三角
    c = over(c, if ill { [255.0; 3] } else { TAPE }, cov(z + 0.04, if ill { 0.06 } else { 0.045 }, fz));
    let lim = 0.25 * (1.0 + z / 0.45);
    if lim > 0.0 {
        c = over(c, [255.0, 210.0, 63.0], cov_range(x, -lim, lim, fx) * cov_range(z, -0.45, 0.0, fz));
    }
    c
}

fn football_color(d: f32, hash: f32, u: f32, ill: bool, x: f32, z: f32, fx: f32, fz: f32) -> [f32; 3] {
    let ly = z + d;
    let pal = if ill {
        // イラスト: やわらかい色の芝（トラック・芝・刈り模様の2色・エンドゾーン）
        [[201.0, 143.0, 124.0], [143.0, 192.0, 122.0], [143.0, 192.0, 122.0], [156.0, 203.0, 134.0], [130.0, 179.0, 111.0]]
    } else {
        [[106.0, 63.0, 51.0], [31.0, 90.0, 40.0], [37.0, 101.0, 45.0], [42.0, 113.0, 51.0], [28.0, 82.0, 36.0]]
    };
    let mut c = pal[0]; // 外側はトラック色
    if x.abs() <= 57.5 && ly >= -3.0 && ly <= d + 3.0 {
        c = pal[1];
    }
    if ly >= 0.0 && ly <= d {
        // 芝の刈り模様（5ヤードごとに明暗）とエンドゾーン
        let k = (x / 4.572).floor() as i32;
        if (-11..11).contains(&k) {
            c = if k % 2 != 0 { pal[2] } else { pal[3] };
        }
        if (-54.86..-45.72).contains(&x) || (45.72..54.86).contains(&x) {
            c = pal[4];
        }
    }
    if x.abs() > 56.0 || ly < -1.0 || ly > d + 1.0 {
        return c;
    }
    let line = [244.0, 244.0, 238.0];
    let mut l = 0.0f32;
    // ヤードライン
    let k = (x / 4.572).round().clamp(-10.0, 10.0);
    let hl = if k == 0.0 { 0.1 } else { 0.07 };
    l = l.max(cov(x - k * 4.572, hl, fx) * cov_range(ly, 0.0, d, fz));
    // ハッシュ（0.9144 m ごと、左右の 2 列）
    let j = ((x + 45.72) / 0.9144).round().clamp(0.0, 100.0);
    let xj = -45.72 + j * 0.9144;
    for zr in [d - hash * u, hash * u] {
        l = l.max(cov(x - xj, 0.05, fx) * cov_range(ly, zr - 0.3, zr + 0.3, fz));
    }
    // 外枠
    let eh = cov_range(x, -54.865 - 0.11, 54.865 + 0.11, fx) * cov((ly - d / 2.0).abs() - d / 2.0, 0.11, fz);
    let ev = cov(x.abs() - 54.865, 0.11, fx) * cov_range(ly, -0.11, d + 0.11, fz);
    l = l.max(eh.max(ev));
    c = over(c, line, l);
    // ヤード数字（5x7 のビットマップを拡大。アルファ 0.8 の白）
    let (gh, top) = (1.3f32, d - 8.0 - 1.3);
    if ly >= top && ly < top + gh {
        let kk = ((x / 4.572) / 2.0).round() * 2.0;
        if kk.abs() <= 8.0 {
            let yl = (50.0 - kk.abs() * 5.0) as i32;
            let txt = format!("{}", yl);
            let (cw, adv) = (0.8f32, 1.0f32);
            let x0 = kk * 4.572 - adv * txt.len() as f32 / 2.0 + (adv - cw) / 2.0;
            let rel = x - x0;
            if rel >= 0.0 {
                let ci = (rel / adv) as usize;
                let inx = rel - ci as f32 * adv;
                if ci < txt.len() && inx < cw {
                    let g = glyph(txt.as_bytes()[ci] as char);
                    let (col, row) = ((inx / cw * 5.0) as usize, ((ly - top) / gh * 7.0) as usize);
                    if row < 7 && col < 5 && (g[row] >> (4 - col)) & 1 == 1 {
                        c = over(c, [255.0, 255.0, 255.0], 0.8);
                    }
                }
            }
        }
    }
    c
}

impl Pat {
    /// ワールド座標 (x,z) の床の色（sRGB 0..1）。fx, fz は画素が x, z 方向に覆う長さ（m）
    fn color(&self, base: Rgb, x: f32, z: f32, fx: f32, fz: f32) -> Rgb {
        let c = match *self {
            Pat::Plain => return base,
            Pat::Gym { hw, hd, fw, fd, ill } => gym_color(hw, hd, fw, fd, ill, x, z, fx, fz),
            Pat::Stage { ww, d, wing, fw, ill } => stage_color(ww, d, wing, fw, ill, x, z, fx, fz),
            Pat::Football { d, hash, u, ill } => football_color(d, hash, u, ill, x, z, fx, fz),
        };
        [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0]
    }
}

// ================= 会場 =================

/// 会場の中心と半幅（ワールド座標）
pub struct Bounds {
    pub cx: f32,
    pub cz: f32,
    pub hw: f32,
    pub hd: f32,
}

pub fn world(show: &Show, x: f64, y: f64) -> (f32, f32) {
    let u = show.field.unit_m;
    ((x * u) as f32, (-y * u) as f32)
}

pub fn bounds(show: &Show) -> Bounds {
    match &show.field.kind {
        FieldKind::Football { .. } => {
            let d = (BSL * show.field.unit_m) as f32;
            Bounds { cx: 0.0, cz: -d / 2.0, hw: 54.9, hd: d / 2.0 }
        }
        FieldKind::Gym { w, d } => Bounds { cx: 0.0, cz: 0.0, hw: *w as f32 / 2.0 + 5.0, hd: *d as f32 / 2.0 + 5.0 },
        FieldKind::Stage { w, d, wing } => Bounds { cx: 0.0, cz: -*d as f32 / 2.0, hw: (*w + 2.0 * wing) as f32 / 2.0, hd: *d as f32 / 2.0 },
        FieldKind::Floor { w, d } => Bounds { cx: 0.0, cz: -*d as f32 / 2.0, hw: *w as f32 / 2.0, hd: *d as f32 / 2.0 },
    }
}

/// 体育館の壁（ローカル +Z 向きが室内側）。下は濃い腰パネル、上は漆喰、高い位置に採光窓
fn hall_wall(m: &mut Mesh, xf: &Xf, len: f32, hgt: f32) {
    let t = 0.3;
    let il = ill_v();
    let pick = |a: u32, b: u32| if il { b } else { a };
    m.bx(xf, len, hgt, t, mat(pick(0xc9c5b8, 0xe4e2d6)), 0.0, hgt / 2.0, -t / 2.0);
    m.bx(xf, len, 2.4, t + 0.1, mat(pick(0x262c3a, 0x7d8fa6)), 0.0, 1.2, -t / 2.0 + 0.02);
    m.bx(xf, len, 0.12, 0.16, mat(pick(0xb7a24a, 0xf0e3a0)), 0.0, 2.46, 0.02);
    let mut x = -len / 2.0 + 1.5;
    while x < len / 2.0 - 1.0 {
        m.bx(xf, 0.18, hgt - 2.5, 0.1, mat(pick(0xaaa699, 0xd2d1c4)), x, 2.5 + (hgt - 2.5) / 2.0, 0.05);
        x += 3.0;
    }
    let win = Mt { c: hex_u32(pick(0x9fbbd8, 0xcfe6f7)), rough: 1.0, env: 0.0, unlit: true, cast: false };
    let mut x = -len / 2.0 + 2.4;
    while x < len / 2.0 - 2.0 {
        let (y, z) = (hgt - 1.7, 0.03);
        m.quad(xf.p(v3(x - 1.1, y - 0.65, z)), xf.p(v3(x + 1.1, y - 0.65, z)), xf.p(v3(x + 1.1, y + 0.65, z)), xf.p(v3(x - 1.1, y + 0.65, z)), win);
        x += 3.0;
    }
}

/// 簡易な乱数（view3d.js の rnd と同じ線形合同法。会場の模様を毎回同じにする）
struct Rnd(u32);

impl Rnd {
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        self.0 as f32 / 4294967296.0
    }
}

fn hsl_rgb(h: f32, s: f32, l: f32) -> Rgb {
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let f = |mut t: f32| {
        t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * 6.0 * (2.0 / 3.0 - t)
        } else {
            p
        }
    };
    [f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0)]
}

pub fn venue(show: &Show, mode: CamMode) -> Mesh {
    let side_walls = !matches!(mode, CamMode::Orbit | CamMode::Top | CamMode::Diag);
    // 斜め俯瞰（Diag）は会場の後ろ側から見るので、奥の壁・幕・スタンドは出さない
    let open = mode == CamMode::Diag;
    ILL_V.with(|c| c.set(show.look == "illust"));
    let mut m = Mesh::default();
    let id = Xf::at(0.0, 0.0, 0.0);
    match &show.field.kind {
        FieldKind::Gym { w, d } => {
            let (w, d) = (*w as f32, *d as f32);
            let (hw, hd) = (w / 2.0 + 5.0, d / 2.0 + 5.0);
            // 板張りの床に白テープ（床の模様は画素ごとの式）
            m.floor(-hw, -hd, hw, hd, 0.0, Pat::Gym { hw, hd, fw: w, fd: d, ill: ill_v() }, Mt { c: [0.5; 3], rough: 0.62, env: 0.18, unlit: false, cast: false });
            // 壁（奥と左右）
            let wh = 9.0;
            if !open {
                hall_wall(&mut m, &Xf::at(0.0, 0.0, -hd), hw * 2.0 + 0.6, wh);
            }
            if side_walls {
                hall_wall(&mut m, &Xf { ry: PI / 2.0, t: v3(-hw, 0.0, 0.0) }, hd * 2.0 + 0.6, wh);
                hall_wall(&mut m, &Xf { ry: -PI / 2.0, t: v3(hw, 0.0, 0.0) }, hd * 2.0 + 0.6, wh);
            }
            // 奥のステージ（緞帳つき）
            if !open {
                m.bx(&id, 14.0, 1.1, 0.8, mat(0x3a2c26), 0.0, 0.55, -hd + 0.4);
                m.curtain(&Xf::at(0.0, 3.2, -hd + 0.12), 13.4, 4.2, 0x6a1020, 0.7, 0.16);
                m.curtain(&Xf::at(0.0, 5.5, -hd + 0.2), 14.0, 0.9, 0x8a1c2c, 0.5, 0.1);
            }
        }
        FieldKind::Stage { w, d, wing } => {
            let (w, d, wing) = (*w as f32, *d as f32, *wing as f32);
            let ww = w / 2.0 + wing;
            // 客席側の床（1m 下）と舞台
            m.floor(-ww - 8.0, 0.0, ww + 8.0, 16.0, -1.0, Pat::Plain, mat(0x1e1a19));
            m.bx(&id, ww * 2.0, 1.0, d, mat(0x2e2420), 0.0, -0.5, -d / 2.0);
            m.floor(-ww, -d, ww, 0.0, 0.012, Pat::Stage { ww, d, wing, fw: w, ill: ill_v() }, Mt { c: [0.5; 3], rough: 0.6, env: 0.18, unlit: false, cast: false });
            // 奥の幕（ひだのある深い青）
            if !open {
                m.curtain(&Xf::at(0.0, 4.0, -d - 0.2), ww * 2.0 + 0.4, 8.0, 0x22315a, 0.62, 0.2);
            }
            for s in [-1.0f32, 1.0] {
                if open {
                    break;
                }
                // 袖幕（黒）: 舞台の奥行きに沿って 3 枚
                for k in 0..3 {
                    let xf = Xf { ry: if s > 0.0 { -PI / 2.0 } else { PI / 2.0 }, t: v3(s * (w / 2.0 + 0.3 + k as f32 * wing / 3.0), 3.7, -d * (0.2 + 0.28 * k as f32)) };
                    m.curtain(&xf, d * 0.24, 7.4, 0x0d0d10, 0.45, 0.1);
                }
                // プロセニアムの赤い緞帳（左右）
                m.curtain(&Xf::at(s * (ww + 1.5), 5.0, -0.3), 3.0, 10.0, 0x6a1519, 0.5, 0.15);
            }
            if !open {
                m.curtain(&Xf::at(0.0, 8.2, -0.3), ww * 2.0 + 6.0, 1.7, 0x7a1a20, 0.55, 0.12);
                m.bx(&id, ww * 2.0 + 6.0, 0.12, 0.3, mat(0xc9a64a), 0.0, 7.32, -0.1);
            }
        }
        FieldKind::Football { hash, .. } => {
            let u = show.field.unit_m as f32;
            let d = BSL as f32 * u;
            m.floor(-60.0, -d - 6.0, 60.0, 6.0, 0.0, Pat::Football { d, hash: *hash as f32, u, ill: ill_v() }, Mt { c: [0.5; 3], rough: 0.9, env: 0.18, unlit: false, cast: false });
            // 奥のスタンド（段になった暗い面と、観客のドット）
            let sm = mat(0x2a2d38);
            for k in 0..(if open { 0 } else { 5 }) {
                m.bx(&id, 130.0, 1.1, 3.2, sm, 0.0, 0.55 + k as f32 * 1.1, -d - 9.0 - k as f32 * 3.2);
            }
            let mut r = Rnd(12345);
            for _ in 0..(if open { 0 } else { 900 }) {
                let k = (r.next() * 5.0).floor();
                let x = (r.next() - 0.5) * 120.0;
                let z = -d - 8.2 - k * 3.2 - r.next() * 1.4;
                let y = 1.45 + k * 1.1;
                let h = r.next();
                let l = 0.28 + r.next() * 0.12;
                // インスタンス色は線形の作業空間の値。表示色（sRGB）にして持つ
                let lc = hsl_rgb(h, 0.35, l);
                let mt = Mt { c: [to_srgb(lc[0]), to_srgb(lc[1]), to_srgb(lc[2])], rough: 1.0, env: 0.0, unlit: true, cast: false };
                m.bx(&id, 0.5, 0.7, 0.4, mt, x, y, z);
            }
        }
        FieldKind::Floor { w, d } => {
            let (w, d) = (*w as f32, *d as f32);
            m.floor(-w / 2.0 - 3.0, -d - 3.0, w / 2.0 + 3.0, 3.0, -0.01, Pat::Plain, mat(0x3a3a3e));
            m.floor(-w / 2.0, -d, w / 2.0, 0.0, 0.0, Pat::Plain, mat(0x735e4c));
        }
    }
    m.casters = std::sync::Arc::new(m.tris.iter().filter(|t| t.mt.cast).map(|t| t.p).collect());
    m.shadow = venue_shadow(show, &m).map(std::sync::Arc::new);
    ILL_V.with(|c| c.set(false));
    m
}

/// 太陽の向き（view3d.js: sun.position - target）
fn sun_dir(show: &Show) -> V3 {
    let b = bounds(show);
    v3(-0.4 * b.hw, 40.0, 0.8 * b.hd).norm()
}

/// 影カメラの中心と半幅（view3d.js: target と ext = max(hw, hd) * 1.15）
fn sun_frustum(show: &Show) -> (V3, f32) {
    let b = bounds(show);
    (v3(b.cx, 0.0, b.cz), b.hw.max(b.hd) * 1.15)
}

/// 影を落とす会場の面（壁・箱・幕）を太陽方向のシャドウマップに書く
fn venue_shadow(show: &Show, m: &Mesh) -> Option<ShadowMap> {
    let (mut x0, mut x1, mut z0, mut z1, mut yt) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN, 1.0f32);
    for t in m.tris.iter().filter(|t| t.mt.cast) {
        for p in &t.p {
            x0 = x0.min(p.x);
            x1 = x1.max(p.x);
            z0 = z0.min(p.z);
            z1 = z1.max(p.z);
            yt = yt.max(p.y);
        }
    }
    if x0 > x1 {
        return None;
    }
    let mut sm = ShadowMap::new(sun_dir(show), x0 - 0.5, x1 + 0.5, z0 - 0.5, z1 + 0.5, yt + 0.5);
    for t in m.tris.iter().filter(|t| t.mt.cast) {
        let (a, b, c) = (sm.to_tex(t.p[0]), sm.to_tex(t.p[1]), sm.to_tex(t.p[2]));
        sm.tri_impl(a, b, c, true);
    }
    let (target, ext) = sun_frustum(show);
    sm.limit(target, ext);
    Some(sm)
}

// ================= 人物 =================

/// アセット内のメッシュ名（構えのクリップ名 hold/<名前> にも使う）。view3d.js の MESHES / meshOf と同じ対応表
pub type Kind = &'static str;

const MESHES: &[&str] = &[
    "trumpet", "mellophone", "marching_horn", "horn", "trombone", "euphonium", "marching_euphonium", "tuba", "marching_tuba", "sousaphone",
    "piccolo", "flute", "oboe", "bassoon", "eb_clarinet", "clarinet", "alto_clarinet", "bass_clarinet", "soprano_sax", "alto_sax", "tenor_sax", "baritone_sax",
    "snare", "tenors", "bass1", "bass2", "bass3", "bass4", "bass5", "cymbals_mid", "cymbals_high", "glockenspiel", "xylophone",
];

/// エンジンが決めた楽器ID → メッシュ名。i: セクション内の何人目か（0始まり）、n: セクションの人数。
/// バスドラムは小→大の順にサイズ1〜5（6人以上は等分）。楽器なし・未知のIDは "none"
pub fn mesh_of(id: &str, i: usize, n: usize) -> Kind {
    match id {
        "flag" => "guard",
        "bass_drum" => {
            let k = if n <= 5 { i + 1 } else { 1 + i * 5 / n };
            ["bass1", "bass2", "bass3", "bass4", "bass5"][k.clamp(1, 5) - 1]
        }
        _ => MESHES.iter().find(|m| **m == id).copied().unwrap_or("none"),
    }
}

// ================= 動き =================

pub struct State {
    pub x: f64,
    pub y: f64,
    pub moving: bool,
    /// 進行方向（フィールド座標）
    pub dir: (f64, f64),
    /// 歩き始めからのカウント（脚の振り用）
    pub phase: f64,
    /// 指定された向き（フィールド座標の角度、度）
    pub face: Option<f64>,
    /// マークタイム中
    pub mark: bool,
    /// ステップの種類（glide / back / slide / jazz / high）
    pub step: Option<String>,
    /// 手具・動作（spin / toss / swing / rest）
    pub action: Option<String>,
    /// 姿勢（attention / rest / wide / cross / kneel / kneel2 / lunge / crouch / toe）
    pub pose: Option<String>,
    /// 姿勢の度合い 0..1（1 = 完全に姿勢中。出入りは 0.5 カウントでなめらかに）
    pub pose_blend: f32,
    /// 楽器の構え（play / right / left / front / diag。None は play と同じ）
    pub carry: Option<String>,
    /// 前のセットの構え（セットの頭から 1 カウントで carry へ移る）
    pub carry_from: Option<String>,
    /// 構えの切り替えの進み具合 0..1（1 = 完全に carry）
    pub carry_blend: f32,
}

pub fn set_at(show: &Show, t: f64) -> usize {
    let mut k = 0;
    for (j, s) in show.sets.iter().enumerate() {
        if s.start <= t + 1e-9 {
            k = j;
        }
    }
    k
}

fn sstep01_f64(x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

pub fn state_at(show: &Show, i: usize, t: f64) -> State {
    let k = set_at(show, t);
    let s = &show.sets[k];
    let tt = t - s.start;
    if k == 0 || s.counts <= 0.0 {
        let p = s.pos[i];
        return State { x: p.0, y: p.1, moving: false, dir: (0.0, 0.0), phase: tt, face: s.face[i], mark: s.mark, step: s.step[i].clone(), action: s.action[i].clone(), pose: s.pose[i].clone(), pose_blend: if s.pose[i].is_some() { 1.0 } else { 0.0 }, carry: s.carry[i].clone(), carry_from: s.carry[i].clone(), carry_blend: 1.0 };
    }
    let m = crate::geom::Mv { a: show.sets[k - 1].pos[i], b: s.pos[i], w: s.wait[i], e: s.end[i], bend: s.bend[i], route: s.route[i].as_deref() };
    let p = m.at(tt);
    let moved = crate::geom::dist(m.a, m.b) > 1e-6;
    let moving = moved && tt > m.w && tt < m.e;
    let (p0, p1) = (m.at(tt - 0.05), m.at(tt + 0.05));
    let dir = if moving { (p1.0 - p0.0, p1.1 - p0.1) } else { (m.b.0 - m.a.0, m.b.1 - m.a.1) };
    // 動き出す前の待ち時間・到着後のホールドでマークタイム
    let mark = s.mark && !moving && (tt >= s.counts || (moved && tt < m.w) || tt >= m.e);
    // 姿勢は動いていない間だけ。出発の 0.5 カウント前から解き、到着後 0.5 カウントで取る
    let pose_blend = if s.pose[i].is_none() {
        0.0
    } else if !moved {
        1.0
    } else {
        let ss = |x: f64| {
            let x = x.clamp(0.0, 1.0);
            x * x * (3.0 - 2.0 * x)
        };
        if tt <= m.w {
            1.0 - ss((tt - (m.w - 0.5)) / 0.5)
        } else if tt >= m.e {
            ss((tt - m.e) / 0.5)
        } else {
            0.0
        }
    } as f32;
    // 構えの切り替えは、セットの頭から 1 カウントでなめらかに
    let carry_from = show.sets[k - 1].carry[i].clone();
    let same_carry = s.carry[i].as_deref().unwrap_or("play") == carry_from.as_deref().unwrap_or("play");
    let carry_blend = if same_carry { 1.0 } else { sstep01_f64(tt) } as f32;
    State { x: p.0, y: p.1, moving, dir, phase: tt - m.w, face: s.face[i], mark, step: s.step[i].clone(), action: s.action[i].clone(), pose: s.pose[i].clone(), pose_blend, carry: s.carry[i].clone(), carry_from, carry_blend }
}

/// 通算カウント → 秒（セットごとのテンポを反映）
pub fn seconds_at(show: &Show, t: f64) -> f64 {
    let mut sec = 0.0;
    for s in &show.sets {
        let len = s.counts + s.hold;
        let a = s.start;
        if t <= a {
            break;
        }
        sec += (t.min(a + len) - a) * 60.0 / s.tempo;
    }
    sec
}

/// 秒 → 通算カウント
pub fn counts_at(show: &Show, sec: f64) -> f64 {
    let mut left = sec;
    for s in &show.sets {
        let len = s.counts + s.hold;
        let dur = len * 60.0 / s.tempo;
        if left <= dur {
            return s.start + left * s.tempo / 60.0;
        }
        left -= dur;
    }
    show.sets.last().map(|s| s.start + s.counts + s.hold).unwrap_or(0.0)
}

// ================= カメラとラスタライザ =================

pub struct Cam {
    pub eye: V3,
    pub target: V3,
    pub up: V3,
    pub fov_deg: f32,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum CamMode {
    Audience,
    Top,
    Orbit,
    Low,
    /// 斜め俯瞰（会場の後ろ側・上手寄りの高い位置から、隊形の外接矩形を追いかける）。リール動画の上段
    Diag,
    /// 客席の最前列・目線の高さ（中央ライン上）から、隊形の横幅いっぱいに映す。リール動画の下段
    Front,
}

pub fn camera(show: &Show, mode: CamMode, frac: f32) -> Cam {
    camera_t(show, mode, frac, 0.0, 16.0 / 9.0)
}

/// 時刻 t の前後 2 カウントぶんの全員の位置（ワールド座標 x, z）。カメラがなめらかに動くよう、窓の和をとる
pub fn formation_pts(show: &Show, t: f64) -> Vec<(f32, f32)> {
    let total = show.sets.last().map(|s| s.start + s.counts + s.hold).unwrap_or(0.0);
    let mut v = vec![];
    for k in -8..=8 {
        let tt = (t + k as f64 * 0.5).clamp(0.0, total);
        for i in 0..show.performers.len() {
            let st = state_at(show, i, tt);
            v.push(world(show, st.x, st.y));
        }
    }
    if v.is_empty() {
        v.push((0.0, 0.0));
    }
    v
}

/// 時刻と画面の縦横比も使うカメラ（Diag は隊形を追いかける）
pub fn camera_t(show: &Show, mode: CamMode, frac: f32, t: f64, aspect: f32) -> Cam {
    let b = bounds(show);
    let size = (b.hw * 2.0).max(b.hd * 2.0 * 1.6);
    let c = v3(b.cx, 0.0, b.cz);
    let stage = matches!(show.field.kind, FieldKind::Stage { .. });
    match mode {
        CamMode::Audience => {
            if stage {
                // ホール2階席あたりから
                Cam { eye: v3(0.0, 9.5, b.hw * 1.25), target: v3(0.0, 2.2, b.cz * 0.85), up: v3(0.0, 1.0, 0.0), fov_deg: 40.0 }
            } else if let FieldKind::Gym { w, d } = &show.field.kind {
                // 体育館のギャラリー（2階）から
                let dd = (*w).max(*d) as f32;
                Cam { eye: v3(0.0, dd * 0.45, dd * 0.5 + dd * 0.5), target: v3(0.0, 0.0, -dd * 0.06), up: v3(0.0, 1.0, 0.0), fov_deg: 46.0 }
            } else {
                Cam { eye: v3(b.cx, size * 0.42, b.cz + b.hd + size * 0.38), target: v3(b.cx, 0.0, b.cz - b.hd * 0.08), up: v3(0.0, 1.0, 0.0), fov_deg: 42.0 }
            }
        }
        CamMode::Top => Cam { eye: v3(b.cx, size * 1.05, b.cz + 0.001), target: c, up: v3(0.0, 0.0, -1.0), fov_deg: 45.0 },
        CamMode::Orbit => {
            // 客席側を左右にゆっくり往復（-60°〜+60°）
            let a = (frac * std::f32::consts::TAU).sin() * 1.05;
            let r = b.hw.max(b.hd) * 1.7;
            Cam { eye: v3(b.cx + r * a.sin(), r * 0.45, b.cz + r * a.cos()), target: c, up: v3(0.0, 1.0, 0.0), fov_deg: 42.0 }
        }
        CamMode::Diag => {
            let pts = formation_pts(show, t);
            let m = 0.5;
            let (az, el) = (28.0f32.to_radians(), 31.0f32.to_radians());
            // 会場の後ろ（客席と反対側）で下手寄り（-x）から、隊形を見下ろす
            let dir = v3(-az.sin() * el.cos(), el.sin(), -az.cos() * el.cos());
            let up = v3(0.0, 1.0, 0.0);
            let fov = 38.0f32;
            let f = dir.mul(-1.0);
            let r = f.cross(up).norm();
            let u = r.cross(f);
            let th = (fov.to_radians() / 2.0).tan();
            let tw = th * aspect;
            // 人の周り（足元〜頭上、前後左右 m）の点
            let mut ps: Vec<V3> = vec![];
            for &(x, z) in &pts {
                for (dx, dz) in [(-m, -m), (m, -m), (-m, m), (m, m)] {
                    ps.push(v3(x + dx, 0.0, z + dz));
                    ps.push(v3(x + dx, 2.1, z + dz));
                }
            }
            // まず画面上の中心を合わせる（r・u 方向の範囲の中央を狙う）
            let c0 = v3(0.0, 0.9, 0.0);
            let (mut r0, mut r1, mut u0, mut u1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
            for p in &ps {
                let (a, b) = (p.sub(c0).dot(r), p.sub(c0).dot(u));
                r0 = r0.min(a);
                r1 = r1.max(a);
                u0 = u0.min(b);
                u1 = u1.max(b);
            }
            let c = c0.add(r.mul((r0 + r1) / 2.0)).add(u.mul((u0 + u1) / 2.0));
            let mut d = 6.0f32;
            for p in &ps {
                let v = p.sub(c);
                d = d.max((v.dot(r).abs() / (tw * 1.0)).max(v.dot(u).abs() / (th * 0.98)) - v.dot(f));
            }
            Cam { eye: c.add(dir.mul(d)), target: c, up, fov_deg: fov }
        }
        CamMode::Front => {
            // 中央の線（x = 0）の真正面。目線の高さ 1.9m から、全員が横幅に収まる距離まで下がる
            let pts = formation_pts(show, t);
            let fov = 50.0f32;
            let tw = (fov.to_radians() / 2.0).tan() * aspect;
            // 隊形全体の中心を追う。x=0 固定だと隊形が横に移動した際に小さく映る。
            let (xmin, xmax) = pts.iter().fold((f32::MAX, f32::MIN), |(a, b), (x, _)| (a.min(*x), b.max(*x)));
            let xc = (xmin + xmax) / 2.0;
            let (mut zc, mut zf, mut zb) = (f32::MIN, f32::MIN, f32::MAX);
            for &(x, z) in &pts {
                zc = zc.max(z + ((x - xc).abs() + 0.8) / (tw * 0.9));
                zf = zf.max(z);
                zb = zb.min(z);
            }
            let zc = zc.max(zf + 2.5);
            let eye_y = 1.6;
            Cam { eye: v3(xc, eye_y, zc), target: v3(xc, 0.9, (zf + zb) / 2.0), up: v3(0.0, 1.0, 0.0), fov_deg: fov }
        }
        CamMode::Low => Cam {
            eye: v3(b.cx, if stage { 1.0 } else { 2.2 }, b.cz + b.hd + if stage { 6.0 } else { 3.0 }),
            target: v3(b.cx, 1.0, b.cz),
            up: v3(0.0, 1.0, 0.0),
            fov_deg: 55.0,
        },
    }
}

// ================= ライティング（ブラウザの three.js ビューに合わせる）=================

const PI: f32 = std::f32::consts::PI;

fn lin(c: Rgb) -> Rgb {
    [crate::human::srgb_to_lin(c[0]), crate::human::srgb_to_lin(c[1]), crate::human::srgb_to_lin(c[2])]
}

/// sRGB → 線形（1 成分、テーブル引き）
fn lin_fast(c: f32) -> f32 {
    static T: std::sync::OnceLock<Vec<f32>> = std::sync::OnceLock::new();
    let t = T.get_or_init(|| (0..=4096).map(|i| crate::human::srgb_to_lin(i as f32 / 4096.0)).collect());
    t[(c.clamp(0.0, 1.0) * 4096.0 + 0.5) as usize]
}

/// 線形 → sRGB（1 成分）
fn to_srgb(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

fn lin_hex(c: u32) -> Rgb {
    lin([((c >> 16) & 255) as f32 / 255.0, ((c >> 8) & 255) as f32 / 255.0, (c & 255) as f32 / 255.0])
}

fn mix3(a: Rgb, b: Rgb, t: f32) -> Rgb {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/// ACES filmic（three.js の ACESFilmicToneMapping と同じ式）。入力は線形、出力は線形の 0..1
fn aces(c: Rgb, exposure: f32) -> Rgb {
    let k = exposure / 0.6;
    let (r, g, b) = (c[0] * k, c[1] * k, c[2] * k);
    let a = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b];
    let f = |v: f32| {
        let a = v * (v + 0.0245786) - 0.000090537;
        let b = v * (0.983729 * v + 0.4329510) + 0.238081;
        a / b
    };
    let (x, y, z) = (f(a[0]), f(a[1]), f(a[2]));
    [
        (1.60475 * x - 0.53108 * y - 0.07367 * z).clamp(0.0, 1.0),
        (-0.10208 * x + 1.10813 * y - 0.00605 * z).clamp(0.0, 1.0),
        (-0.00327 * x - 0.07276 * y + 1.07602 * z).clamp(0.0, 1.0),
    ]
}

// ---- 環境マップ（view3d.js の makeEnv と同じ空＋面光源。粗さごとにぼかした緯度経度テーブル）----

const EW: usize = 96;
const EH: usize = 48;
/// 環境光の拡散成分の補正（three.js の PMREM の見た目に合わせた経験値）
const ENV_DIFF: f32 = 1.0;
/// 鏡面反射の環境光の粗さの縮め率（同上）
const ENV_RMAP: f32 = 0.6;
const ENV_R: [f32; 5] = [0.16, 0.3, 0.5, 0.75, 1.0];

struct Panel {
    c: V3,
    ax: V3,
    ay: V3,
    n: V3,
    hw: f32,
    hh: f32,
    col: Rgb,
}

fn panels() -> [Panel; 4] {
    let mk = |w: f32, h: f32, p: [f32; 3], rx: f32, ry: f32, c: f32| {
        // three.js の Euler XYZ（回転 = Rx * Ry）
        let rot = |v: V3| {
            let (sy, cy) = ry.sin_cos();
            let (x1, z1) = (v.x * cy + v.z * sy, -v.x * sy + v.z * cy);
            let (sx, cx) = rx.sin_cos();
            v3(x1, v.y * cx - z1 * sx, v.y * sx + z1 * cx)
        };
        Panel { c: v3(p[0], p[1], p[2]), ax: rot(v3(1.0, 0.0, 0.0)), ay: rot(v3(0.0, 1.0, 0.0)), n: rot(v3(0.0, 0.0, 1.0)), hw: w / 2.0, hh: h / 2.0, col: [c, c, c * 0.95] }
    };
    [
        mk(30.0, 14.0, [0.0, 19.0, 0.0], PI / 2.0, 0.0, 6.0),
        mk(14.0, 5.0, [-26.0, 12.0, 18.0], 0.0, PI / 2.6, 4.0),
        mk(10.0, 4.0, [28.0, 9.0, -8.0], 0.0, -PI / 2.0, 2.5),
        mk(26.0, 3.0, [0.0, 4.0, -36.0], 0.0, 0.0, 1.6),
    ]
}

fn env_raw(d: V3, ps: &[Panel; 4]) -> Rgb {
    let big = 1e9f32;
    let tx = if d.x.abs() > 1e-6 { 40.0 / d.x.abs() } else { big };
    let ty = if d.y.abs() > 1e-6 { 20.0 / d.y.abs() } else { big };
    let tz = if d.z.abs() > 1e-6 { 40.0 / d.z.abs() } else { big };
    let t = tx.min(ty).min(tz);
    let k = ((t * d.y / 20.0 + 1.0) / 2.0).clamp(0.0, 1.0);
    let mut col = [0.07 + 0.30 * k, 0.08 + 0.34 * k, 0.10 + 0.44 * k];
    let mut best = t;
    for p in ps {
        let dn = d.dot(p.n);
        if dn.abs() < 1e-6 {
            continue;
        }
        let tp = p.c.dot(p.n) / dn;
        if tp <= 0.0 || tp >= best {
            continue;
        }
        let h = d.mul(tp).sub(p.c);
        if h.dot(p.ax).abs() <= p.hw && h.dot(p.ay).abs() <= p.hh {
            best = tp;
            col = p.col;
        }
    }
    col
}

struct EnvMaps {
    lv: Vec<Vec<Rgb>>,
}

fn texel_dir(i: usize, j: usize) -> V3 {
    let phi = ((i as f32 + 0.5) / EW as f32 - 0.5) * 2.0 * PI;
    let th = (j as f32 + 0.5) / EH as f32 * PI;
    v3(th.sin() * phi.cos(), th.cos(), th.sin() * phi.sin())
}

fn env_maps() -> &'static EnvMaps {
    static E: std::sync::OnceLock<EnvMaps> = std::sync::OnceLock::new();
    E.get_or_init(|| {
        let ps = panels();
        // 元の環境を細かい緯度経度グリッドに展開（方向・立体角つき）
        let (sw, sh) = (128usize, 64usize);
        let mut src: Vec<(V3, f32, Rgb)> = Vec::with_capacity(sw * sh);
        for j in 0..sh {
            let th = (j as f32 + 0.5) / sh as f32 * PI;
            let dw = th.sin() * (PI / sh as f32) * (2.0 * PI / sw as f32);
            for i in 0..sw {
                let phi = ((i as f32 + 0.5) / sw as f32 - 0.5) * 2.0 * PI;
                let d = v3(th.sin() * phi.cos(), th.cos(), th.sin() * phi.sin());
                src.push((d, dw, env_raw(d, &ps)));
            }
        }
        // 粗さごとに GGX ローブで畳み込む（N=V=R の近似）。レベルごとに別スレッド
        let src = &src;
        let lv: Vec<Vec<Rgb>> = std::thread::scope(|sc| {
            let hs: Vec<_> = ENV_R
                .iter()
                .map(|&r| {
                    sc.spawn(move || {
                        let a2 = r.powi(4);
                        let mut m = vec![[0.0f32; 3]; EW * EH];
                        for j in 0..EH {
                            for i in 0..EW {
                                let n = texel_dir(i, j);
                                let (mut acc, mut ws) = ([0.0f32; 3], 0.0f32);
                                for (l, dw, e) in src.iter() {
                                    let nl = n.dot(*l);
                                    if nl <= 0.0 {
                                        continue;
                                    }
                                    let nh = (nl + 1.0) / (2.0 + 2.0 * nl).sqrt();
                                    let den = nh * nh * (a2 - 1.0) + 1.0;
                                    let w = a2 / (den * den) * nl * dw;
                                    acc[0] += e[0] * w;
                                    acc[1] += e[1] * w;
                                    acc[2] += e[2] * w;
                                    ws += w;
                                }
                                let k = 1.0 / ws.max(1e-9);
                                m[j * EW + i] = [acc[0] * k, acc[1] * k, acc[2] * k];
                            }
                        }
                        m
                    })
                })
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        EnvMaps { lv }
    })
}

/// 高速な atan2（最大誤差 約 0.0005 rad）
#[inline]
fn fast_atan2(y: f32, x: f32) -> f32 {
    let (ax, ay) = (x.abs(), y.abs());
    let (mn, mx) = (ax.min(ay), ax.max(ay));
    if mx < 1e-20 {
        return 0.0;
    }
    let a = mn / mx;
    let s = a * a;
    let mut r = ((-0.046496474 * s + 0.15931422) * s - 0.32762277) * s * a + a;
    if ay > ax {
        r = std::f32::consts::FRAC_PI_2 - r;
    }
    if x < 0.0 {
        r = PI - r;
    }
    if y < 0.0 {
        -r
    } else {
        r
    }
}

/// 高速な acos（最大誤差 約 0.0001 rad）
#[inline]
fn fast_acos(x: f32) -> f32 {
    let a = x.abs().min(1.0);
    let r = (1.0 - a).sqrt() * (1.5707288 + a * (-0.2121144 + a * (0.0742610 - a * 0.0187293)));
    if x < 0.0 {
        PI - r
    } else {
        r
    }
}

impl EnvMaps {
    /// 方向 → 緯度経度テクセル座標 (fx, fy)
    #[inline]
    fn coords(d: V3) -> (f32, f32) {
        ((fast_atan2(d.z, d.x) / (2.0 * PI) + 0.5) * EW as f32 - 0.5, (fast_acos(d.y.clamp(-1.0, 1.0)) / PI) * EH as f32 - 0.5)
    }
    #[inline]
    fn bilinear(&self, l: usize, fx: f32, fy: f32) -> Rgb {
        let (x0, y0) = (fx.floor(), fy.floor());
        let (tx, ty) = (fx - x0, fy - y0);
        let xi = |x: f32| (x as i32).rem_euclid(EW as i32) as usize;
        let yi = |y: f32| (y as i32).clamp(0, EH as i32 - 1) as usize;
        let (xa, xb, ya, yb) = (xi(x0), xi(x0 + 1.0), yi(y0), yi(y0 + 1.0));
        let m = &self.lv[l];
        let (c00, c10, c01, c11) = (m[ya * EW + xa], m[ya * EW + xb], m[yb * EW + xa], m[yb * EW + xb]);
        let mut o = [0.0; 3];
        for k in 0..3 {
            o[k] = (c00[k] * (1.0 - tx) + c10[k] * tx) * (1.0 - ty) + (c01[k] * (1.0 - tx) + c11[k] * tx) * ty;
        }
        o
    }
    /// 鏡面反射用: 方向 d・粗さ r の環境光（three.js の PMREM は GGX よりぼかしが弱いので粗さを縮めて引く）
    fn look_spec(&self, d: V3, r: f32) -> Rgb {
        self.look(d, r * ENV_RMAP)
    }
    /// 方向 d・粗さ r の環境光
    fn look(&self, d: V3, r: f32) -> Rgb {
        let (fx, fy) = Self::coords(d);
        let r = r.clamp(ENV_R[0], 1.0);
        let mut i = 0;
        while i + 2 < ENV_R.len() && r > ENV_R[i + 1] {
            i += 1;
        }
        let t = ((r - ENV_R[i]) / (ENV_R[i + 1] - ENV_R[i])).clamp(0.0, 1.0);
        mix3(self.bilinear(i, fx, fy), self.bilinear(i + 1, fx, fy), t)
    }
}

/// 面の材質（線形色・粗さ・金属感）
#[derive(Clone, Copy)]
struct Surf {
    albedo: Rgb,
    rough: f32,
    metal: f32,
    /// 髪（イラストの天使の輪）
    hair: bool,
}

/// 光源・環境の設定（venue ごとに固定）
pub struct Lit {
    sun: V3,
    sun_i: Rgb,
    fill: V3,
    fill_i: Rgb,
    sky: Rgb,
    ground: Rgb,
    exposure: f32,
    env: &'static EnvMaps,
    /// 背景色（線形）
    bg: Rgb,
    /// フォグ（three.js の Fog: 視線方向の奥行きで smoothstep。色は表示（sRGB）空間で混ぜる）
    fog_near: f32,
    fog_far: f32,
    fog_col: Rgb,
    /// イラスト: 3段のトゥーン（トーンマップなし・環境光なし）
    toon: bool,
}

impl Lit {
    fn new(show: &Show) -> Lit {
        let b = bounds(show);
        let sun = sun_dir(show);
        let fill = v3(0.8 * b.hw, 20.0, -0.6 * b.hd).norm();
        // three.js(r147, 旧ライト) は光の強さに π が掛かり、拡散反射の 1/π と相殺する
        let sc = |c: Rgb, k: f32| [c[0] * k, c[1] * k, c[2] * k];
        // 背景・フォグの色は view3d.js の init() と同じ
        let (bg, fog) = match &show.field.kind {
            FieldKind::Football { .. } => (0x1b2438, 0x26324c),
            FieldKind::Stage { .. } => (0x0c0d12, 0x14151c),
            _ => (0x15171c, 0x2a2b31),
        };
        let r = b.hw.max(b.hd);
        if show.look == "illust" {
            // view3d.js のイラスト: 背景色 = フォグ色、太陽 0.62・半球 0.56、補助光・環境光なし
            let bgc = match &show.field.kind {
                FieldKind::Football { .. } => 0xdbe9f3,
                FieldKind::Stage { .. } => 0xcfd0dc,
                _ => 0xe2e8ee,
            };
            return Lit {
                sun,
                sun_i: sc(lin_hex(0xfffaf0), 0.62),
                fill,
                fill_i: [0.0; 3],
                sky: sc(lin_hex(0xffffff), 0.56),
                ground: sc(lin_hex(0xd2d6dc), 0.56),
                exposure: 1.0,
                env: env_maps(),
                bg: lin_hex(bgc),
                fog_near: r * 2.5,
                fog_far: r * 7.0,
                fog_col: hex_u32(bgc),
                toon: true,
                };
        }
        Lit {
            sun,
            sun_i: sc(lin_hex(0xfff0dc), 1.55),
            fill,
            fill_i: sc(lin_hex(0xe8eeff), 0.45),
            sky: sc(lin_hex(0xfff2e6), 0.42),
            ground: sc(lin_hex(0x6f5d4a), 0.42),
            exposure: 0.72,
            env: env_maps(),
            bg: lin_hex(bg),
            fog_near: r * 1.5,
            fog_far: r * 5.5,
            fog_col: hex_u32(fog),
            toon: false,
        }
    }

    /// 拡散のみの簡易ライティング（床の影の濃さの見積もり用）。影なし、トーンマップ前
    fn diffuse_only(&self, albedo: Rgb, n: V3, env_int: f32) -> Rgb {
        let hemi = mix3(self.ground, self.sky, 0.5 * n.y + 0.5);
        let (ns, nf) = (n.dot(self.sun).max(0.0), n.dot(self.fill).max(0.0));
        let env = self.env.look(n, 1.0);
        let mut o = [0.0; 3];
        let env = [env[0] * ENV_DIFF * env_int, env[1] * ENV_DIFF * env_int, env[2] * ENV_DIFF * env_int];
        for k in 0..3 {
            o[k] = albedo[k] * (hemi[k] + self.sun_i[k] * ns + self.fill_i[k] * nf + env[k]);
        }
        o
    }

    /// フォグ（トーンマップ・sRGB 変換の後に表示空間で混ぜる、three.js と同じ順序）。c は線形、z は視線方向の奥行き
    #[inline]
    fn fog(&self, c: Rgb, z: f32) -> Rgb {
        if z <= self.fog_near {
            return c;
        }
        let t = ((z - self.fog_near) / (self.fog_far - self.fog_near)).clamp(0.0, 1.0);
        let f = t * t * (3.0 - 2.0 * t);
        let o = |k: usize| crate::human::srgb_to_lin(to_srgb(c[k]) * (1.0 - f) + self.fog_col[k] * f);
        [o(0), o(1), o(2)]
    }

    /// イラストのシェーディング: 太陽は 3 段のランプ（nl < -1/3: 0、< 1/3: 0.55、それ以上: 1）、半球光は連続。
    /// person なら画面の縁にやわらかいリムライトを足す
    fn toon_shade(&self, albedo: Rgb, n: V3, v: V3, vis: f32, person: bool) -> Rgb {
        let nl = n.dot(self.sun);
        let ramp = if nl < -1.0 / 3.0 {
            0.0
        } else if nl < 1.0 / 3.0 {
            140.0 / 255.0
        } else {
            1.0
        };
        let hemi = mix3(self.ground, self.sky, 0.5 * n.y + 0.5);
        let mut o = [0.0; 3];
        for k in 0..3 {
            o[k] = albedo[k] * (hemi[k] + self.sun_i[k] * ramp * vis);
        }
        if person {
            let rim = (1.0 - n.dot(v).clamp(0.0, 1.0)).powf(2.6) * 0.26;
            o[0] += rim;
            o[1] += rim * 0.97;
            o[2] += rim * 0.92;
        }
        o
    }

    /// 物理ベースのシェーディング。vis = 太陽の可視率（影）。戻り値はトーンマップ後の線形色
    fn pbr(&self, s: &Surf, n: V3, v: V3, vis: f32, env_int: f32) -> Rgb {
        if self.toon {
            return self.toon_shade(s.albedo, n, v, vis, false);
        }
        let nv = n.dot(v).max(1e-3);
        let rough = s.rough.clamp(0.0525, 1.0);
        let r = n.mul(2.0 * n.dot(v)).sub(v);
        let spec_env = self.env.look_spec(r, rough);
        let dif_env = self.env.look(n, 1.0);
        self.pbr_core(s, n, v, nv, vis, env_int, spec_env, dif_env)
    }

    /// pbr の本体。環境光（鏡面・拡散）の引き当て結果を渡せる（床は画素ごとに引かず補間・使い回しする）
    #[allow(clippy::too_many_arguments)]
    fn pbr_core(&self, s: &Surf, n: V3, v: V3, nv: f32, vis: f32, env_int: f32, spec_env: Rgb, dif_env: Rgb) -> Rgb {
        if self.toon {
            return self.toon_shade(s.albedo, n, v, vis, false);
        }
        let rough = s.rough.clamp(0.0525, 1.0);
        let a2 = rough.powi(4);
        let f0 = [0.04 + (s.albedo[0] - 0.04) * s.metal, 0.04 + (s.albedo[1] - 0.04) * s.metal, 0.04 + (s.albedo[2] - 0.04) * s.metal];
        let dif = [s.albedo[0] * (1.0 - s.metal), s.albedo[1] * (1.0 - s.metal), s.albedo[2] * (1.0 - s.metal)];
        let mut out = [0.0f32; 3];
        for (l, li, k) in [(self.sun, self.sun_i, vis), (self.fill, self.fill_i, 1.0)] {
            let nl = n.dot(l);
            if nl <= 0.0 || k <= 0.0 {
                continue;
            }
            let h = l.add(v).norm();
            let (nh, vh) = (n.dot(h).max(0.0), v.dot(h).max(0.0));
            let den = nh * nh * (a2 - 1.0) + 1.0;
            let d = a2 / (den * den);
            let vis_t = 0.5 / (nl * (a2 + (1.0 - a2) * nv * nv).sqrt() + nv * (a2 + (1.0 - a2) * nl * nl).sqrt());
            let fw = (1.0 - vh).powi(5);
            for c in 0..3 {
                let f = f0[c] + (1.0 - f0[c]) * fw;
                out[c] += li[c] * k * nl * (dif[c] + f * vis_t * d);
            }
        }
        // 半球ライトと環境光（拡散・鏡面）
        let hemi = mix3(self.ground, self.sky, 0.5 * n.y + 0.5);
        let ab = env_brdf(nv, rough);
        let ab = [ab.0, ab.1];
        let boost = 1.0 + 1.3 * s.metal;
        for c in 0..3 {
            let ss = f0[c] * ab[0] + ab[1];
            out[c] += dif[c] * hemi[c];
            out[c] += dif[c] * (1.0 - ss) * dif_env[c] * env_int * ENV_DIFF;
            out[c] += spec_env[c] * ss * env_int * boost;
        }
        aces(out, self.exposure)
    }
}

// ================= 影（太陽方向の平行投影シャドウマップ）=================

pub struct ShadowMap {
    w: usize,
    h: usize,
    d: Vec<f32>,
    lx: V3,
    ly: V3,
    lz: V3,
    u0: f32,
    v0: f32,
    inv: f32,
}

const SHADOW_BIAS: f32 = 0.018;

impl ShadowMap {
    /// 演者の動く範囲 [x0,x1]x[z0,z1]、高さ 0..ytop を覆う解像度（最大 2048）で作る
    fn new(sun: V3, x0: f32, x1: f32, z0: f32, z1: f32, ytop: f32) -> ShadowMap {
        let lz = sun;
        let lx = v3(0.0, 1.0, 0.0).cross(lz).norm();
        let ly = lz.cross(lx);
        let (mut umin, mut umax, mut vmin, mut vmax) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
        for &x in &[x0, x1] {
            for &z in &[z0, z1] {
                for &y in &[0.0, ytop] {
                    let p = v3(x, y, z);
                    let (u, v) = (p.dot(lx), p.dot(ly));
                    umin = umin.min(u);
                    umax = umax.max(u);
                    vmin = vmin.min(v);
                    vmax = vmax.max(v);
                }
            }
        }
        let texel = ((umax - umin).max(vmax - vmin) / 2048.0).max(0.012);
        let w = (((umax - umin) / texel).ceil() as usize + 2).max(4);
        let h = (((vmax - vmin) / texel).ceil() as usize + 2).max(4);
        ShadowMap { w, h, d: vec![f32::MIN; w * h], lx, ly, lz, u0: umin - texel, v0: vmin - texel, inv: 1.0 / texel }
    }

    fn clear(&mut self) {
        self.d.iter_mut().for_each(|d| *d = f32::MIN);
    }

    /// three.js の影カメラは target まわりの ±ext の範囲しか写さない。範囲の外の遮蔽物は消す
    fn limit(&mut self, target: V3, ext: f32) {
        let (uc, vc) = (target.dot(self.lx), target.dot(self.ly));
        for y in 0..self.h {
            let v = self.v0 + y as f32 / self.inv;
            for x in 0..self.w {
                let u = self.u0 + x as f32 / self.inv;
                if (u - uc).abs() > ext || (v - vc).abs() > ext {
                    self.d[y * self.w + x] = f32::MIN;
                }
            }
        }
    }

    #[inline]
    fn to_tex(&self, p: V3) -> [f32; 3] {
        [(p.dot(self.lx) - self.u0) * self.inv, (p.dot(self.ly) - self.v0) * self.inv, p.dot(self.lz)]
    }

    /// 光から見て裏向きの三角形だけを書く（three.js の shadowSide と同じ）
    fn tri(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3]) {
        self.tri_impl(a, b, c, false);
    }

    /// both = true なら表裏どちらも書く（幕や壁など、会場の面用）
    fn tri_impl(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3], both: bool) {
        let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if !(area < 0.0) && !(both && area > 0.0) {
            return;
        }
        let minx = a[0].min(b[0]).min(c[0]).floor().max(0.0) as usize;
        let maxx = (a[0].max(b[0]).max(c[0]).ceil().max(0.0) as usize).min(self.w - 1);
        let miny = a[1].min(b[1]).min(c[1]).floor().max(0.0) as usize;
        let maxy = (a[1].max(b[1]).max(c[1]).ceil().max(0.0) as usize).min(self.h - 1);
        if minx > maxx || miny > maxy {
            return;
        }
        let inv = 1.0 / area;
        for y in miny..=maxy {
            let py = y as f32 + 0.5;
            for x in minx..=maxx {
                let px = x as f32 + 0.5;
                let w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * inv;
                let w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * inv;
                let w2 = 1.0 - w0 - w1;
                if w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4 {
                    continue;
                }
                let d = w0 * a[2] + w1 * b[2] + w2 * c[2];
                let i = y * self.w + x;
                if d > self.d[i] {
                    self.d[i] = d;
                }
            }
        }
    }

    /// 点 p が太陽に照らされている割合 0..1（3x3 の PCF）
    #[inline]
    fn lit(&self, p: V3) -> f32 {
        let t = self.to_tex(p);
        let (ix, iy) = (t[0].floor() as i32, t[1].floor() as i32);
        if ix < 1 || iy < 1 || ix >= self.w as i32 - 1 || iy >= self.h as i32 - 1 {
            return 1.0;
        }
        let c = iy as usize * self.w + ix as usize;
        // 周囲に遮蔽物が何も書かれていなければ照らされている
        if self.d[c] == f32::MIN && self.d[c - 1] == f32::MIN && self.d[c + 1] == f32::MIN && self.d[c - self.w] == f32::MIN && self.d[c + self.w] == f32::MIN {
            return 1.0;
        }
        let thr = t[2] + SHADOW_BIAS;
        let mut s = 0;
        for dy in -1..=1i32 {
            let row = ((iy + dy) as usize) * self.w + ix as usize;
            for dx in -1..=1i32 {
                if self.d[(row as i32 + dx) as usize] <= thr {
                    s += 1;
                }
            }
        }
        s as f32 / 9.0
    }
}

/// 環境BRDFの近似（Karis）。(スケール, バイアス)
fn env_brdf(nv: f32, rough: f32) -> (f32, f32) {
    let (c0, c1) = ([-1.0f32, -0.0275, -0.572, 0.022], [1.0f32, 0.0425, 1.04, -0.04]);
    let rr = [rough * c0[0] + c1[0], rough * c0[1] + c1[1], rough * c0[2] + c1[2], rough * c0[3] + c1[3]];
    let a004 = (rr[0] * rr[0]).min((-9.28 * nv).exp2()) * rr[0] + rr[1];
    (-1.04 * a004 + rr[2], 1.04 * a004 + rr[3])
}

/// 床の鏡面反射（粗い床に映る環境光）。画面を 8 画素ごとに計算して補間する
struct FloorSpec {
    rough: f32,
    gw: usize,
    gh: usize,
    v: Vec<Rgb>,
}

const FS_BLOCK: f32 = 8.0;

impl FloorSpec {
    fn new(cx: &Cx, lit: &Lit, rough: f32) -> FloorSpec {
        let gw = (cx.hw * 2.0 / FS_BLOCK) as usize + 2;
        let gh = (cx.hh * 2.0 / FS_BLOCK) as usize + 2;
        let mut v = vec![[0.0; 3]; gw * gh];
        for by in 0..gh {
            for bx in 0..gw {
                let (dx, dy) = ((bx as f32 * FS_BLOCK - cx.hw) / cx.focal, -(by as f32 * FS_BLOCK - cx.hh) / cx.focal);
                let d = cx.f.add(cx.r.mul(dx)).add(cx.u.mul(dy)).norm();
                if d.y >= -1e-3 {
                    continue;
                }
                v[by * gw + bx] = lit.env.look_spec(v3(d.x, -d.y, d.z), rough);
            }
        }
        FloorSpec { rough, gw, gh, v }
    }
    #[inline]
    fn at(&self, px: f32, py: f32) -> Rgb {
        let (fx, fy) = (px / FS_BLOCK, py / FS_BLOCK);
        let (x0, y0) = ((fx as usize).min(self.gw - 2), (fy as usize).min(self.gh - 2));
        let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
        let (a, b, c, d) = (self.v[y0 * self.gw + x0], self.v[y0 * self.gw + x0 + 1], self.v[(y0 + 1) * self.gw + x0], self.v[(y0 + 1) * self.gw + x0 + 1]);
        let mut o = [0.0; 3];
        for k in 0..3 {
            o[k] = (a[k] * (1.0 - tx) + b[k] * tx) * (1.0 - ty) + (c[k] * (1.0 - tx) + d[k] * tx) * ty;
        }
        o
    }
}

// ================= カメラ・フレームバッファ =================

/// 射影に必要な値をまとめたもの
#[derive(Clone, Copy)]
pub struct Cx {
    eye: V3,
    f: V3,
    r: V3,
    u: V3,
    focal: f32,
    hw: f32,
    hh: f32,
}

impl Cx {
    fn new(cam: &Cam, w: usize, h: usize) -> Cx {
        let f = cam.target.sub(cam.eye).norm();
        let r = f.cross(cam.up).norm();
        let u = r.cross(f);
        Cx { eye: cam.eye, f, r, u, focal: (h as f32 / 2.0) / (cam.fov_deg.to_radians() / 2.0).tan(), hw: w as f32 / 2.0, hh: h as f32 / 2.0 }
    }
    /// ワールド点 → (画面x, 画面y, 1/z)。手前クリップより後ろは iz = -1
    #[inline]
    fn project(&self, p: V3) -> (f32, f32, f32) {
        let d = p.sub(self.eye);
        let z = d.dot(self.f);
        if z < NEAR {
            return (0.0, 0.0, -1.0);
        }
        let iz = 1.0 / z;
        (self.hw + d.dot(self.r) * iz * self.focal, self.hh - d.dot(self.u) * iz * self.focal, iz)
    }
    /// 画素 (px,py) の奥行き z に対するワールド座標
    #[inline]
    fn unproject(&self, px: f32, py: f32, z: f32) -> V3 {
        let (dx, dy) = ((px - self.hw) / self.focal, -(py - self.hh) / self.focal);
        self.eye.add(self.f.add(self.r.mul(dx)).add(self.u.mul(dy)).mul(z))
    }
}

pub struct Frame {
    pub w: usize,
    pub h: usize,
    col: Vec<[f32; 3]>,
    z: Vec<f32>,
    /// 画素を描いた人物の番号（0 = 会場）。輪郭線の判定に使う
    oid: Vec<u16>,
    /// 描いている人物の番号
    cur_id: u16,
    /// 内容が変わらない下地を見分けるための通し番号
    id: u64,
    /// 会場の影を落とす面（人物への影の計算用）
    casters: std::sync::Arc<Vec<[V3; 3]>>,
}

const NEAR: f32 = 0.1;

impl Frame {
    pub fn new(w: usize, h: usize) -> Frame {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        Frame { w, h, col: vec![[0.0; 3]; w * h], z: vec![0.0; w * h], oid: vec![0; w * h], cur_id: 0, id: NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed), casters: Default::default() }
    }
    pub fn clear(&mut self, c: Rgb) {
        self.col.iter_mut().for_each(|p| *p = c);
        self.z.iter_mut().for_each(|z| *z = 0.0);
        self.oid.iter_mut().for_each(|z| *z = 0);
    }
    fn copy_from(&mut self, o: &Frame) {
        self.col.copy_from_slice(&o.col);
        self.z.copy_from_slice(&o.z);
        self.oid.iter_mut().for_each(|z| *z = 0);
    }

    /// 会場を描く。床は画素ごとの模様とライティング、面は面ごと（布は頂点ごと）のライティング。フォグは画素ごと
    fn draw_venue(&mut self, cx: &Cx, lit: &Lit, mesh: &Mesh) {
        self.casters = mesh.casters.clone();
        let up = v3(0.0, 1.0, 0.0);
        let dif_up = lit.env.look(up, 1.0);
        let mut specs: Vec<FloorSpec> = Vec::new();
        // 会場の影の可視率（three.js の normalBias / bias に相当するずらしを入れる）
        let sm = mesh.shadow.as_deref();
        let vis_at = |p: V3, n: V3| -> f32 {
            match sm {
                Some(sm) => sm.lit(p.add(n.mul(0.03)).add(lit.sun.mul(0.034))),
                None => 1.0,
            }
        };
        for fl in &mesh.floors {
            let si = match specs.iter().position(|s| s.rough == fl.mt.rough) {
                Some(i) => i,
                None => {
                    specs.push(FloorSpec::new(cx, lit, fl.mt.rough));
                    specs.len() - 1
                }
            };
            let spec = &specs[si];
            let hy = fl.y - cx.eye.y;
            // 画素 → 床の点 (x, z, 奥行き)
            let plane = |px: f32, py: f32| -> (f32, f32, f32) {
                let (dx, dy) = ((px - cx.hw) / cx.focal, -(py - cx.hh) / cx.focal);
                let dir = cx.f.add(cx.r.mul(dx)).add(cx.u.mul(dy));
                let t = if dir.y.abs() > 1e-6 { hy / dir.y } else { 0.0 };
                (cx.eye.x + dir.x * t, cx.eye.z + dir.z * t, t)
            };
            let plain = matches!(fl.pat, Pat::Plain);
            let plain_alb = lin(fl.mt.c);
            let corners = [v3(fl.x0, fl.y, fl.z0), v3(fl.x1, fl.y, fl.z0), v3(fl.x1, fl.y, fl.z1), v3(fl.x0, fl.y, fl.z1)];
            let shade = |px: f32, py: f32, _z: f32, _c: Rgb| -> Rgb {
                let (x, z, t) = plane(px, py);
                let albedo = if plain {
                    plain_alb
                } else {
                    let (x1, z1, _) = plane(px + 1.0, py);
                    let (x2, z2, _) = plane(px, py + 1.0);
                    let fx = ((x1 - x).abs() + (x2 - x).abs()).min(8.0);
                    let fz = ((z1 - z).abs() + (z2 - z).abs()).min(8.0);
                    let c = fl.pat.color(fl.mt.c, x, z, fx, fz);
                    [lin_fast(c[0]), lin_fast(c[1]), lin_fast(c[2])]
                };
                let v = cx.eye.sub(v3(x, fl.y, z)).norm();
                let sf = Surf { albedo, rough: fl.mt.rough, metal: 0.0, hair: false };
                let c = lit.pbr_core(&sf, up, v, v.y.max(1e-3), vis_at(v3(x, fl.y, z), up), fl.mt.env, spec.at(px, py), dif_up);
                lit.fog(c, t)
            };
            let z3 = [[0.0f32; 3]; 3];
            self.clip_raster(cx, [corners[0], corners[1], corners[2]], z3, &shade);
            self.clip_raster(cx, [corners[0], corners[2], corners[3]], z3, &shade);
        }
        for t in &mesh.tris {
            let cen = t.p[0].add(t.p[1]).add(t.p[2]).mul(1.0 / 3.0);
            let to_eye = cx.eye.sub(cen);
            let z3 = [[0.0f32; 3]; 3];
            if t.mt.unlit {
                let col = if lit.toon { lin(t.mt.c) } else { aces(lin(t.mt.c), lit.exposure) };
                self.clip_raster(cx, t.p, z3, |_, _, z, _| lit.fog(col, z));
                continue;
            }
            let sf = Surf { albedo: lin(t.mt.c), rough: t.mt.rough, metal: 0.0, hair: false };
            match &t.n {
                None => {
                    let mut n = t.p[1].sub(t.p[0]).cross(t.p[2].sub(t.p[0])).norm();
                    if n.dot(to_eye) < 0.0 {
                        n = n.mul(-1.0);
                    }
                    // 大きな平面は代表点の影が全体に広がってしまうので、影は床と幕にだけ受けさせる
                    let col = lit.pbr(&sf, n, to_eye.norm(), 1.0, t.mt.env);
                    self.clip_raster(cx, t.p, z3, |_, _, z, _| lit.fog(col, z));
                }
                Some(ns) => {
                    // 両面の布: 裏から見るときは法線を反転する
                    let flip = if ns[0].add(ns[1]).add(ns[2]).dot(to_eye) < 0.0 { -1.0 } else { 1.0 };
                    let mut vc = z3;
                    for i in 0..3 {
                        let n = ns[i].mul(flip);
                        vc[i] = lit.pbr(&sf, n, cx.eye.sub(t.p[i]).norm(), vis_at(t.p[i], n), t.mt.env);
                    }
                    self.clip_raster(cx, t.p, vc, |_, _, z, c| lit.fog(c, z));
                }
            }
        }
    }

    /// 手前クリップをして三角形を描く。頂点ごとの色 vc は透視補正して補間し、col(px, py, 奥行き, 補間色) で画素の色を決める
    fn clip_raster<F: Fn(f32, f32, f32, Rgb) -> Rgb>(&mut self, cx: &Cx, p: [V3; 3], vc: [Rgb; 3], col: F) {
        let cs: [V3; 3] = [0, 1, 2].map(|i| {
            let d = p[i].sub(cx.eye);
            v3(d.dot(cx.r), d.dot(cx.u), d.dot(cx.f))
        });
        let mut poly: Vec<(V3, Rgb)> = Vec::with_capacity(4);
        for i in 0..3 {
            let j = (i + 1) % 3;
            let (a, b) = (cs[i], cs[j]);
            let (ina, inb) = (a.z >= NEAR, b.z >= NEAR);
            if ina {
                poly.push((a, vc[i]));
            }
            if ina != inb {
                let s = (NEAR - a.z) / (b.z - a.z);
                poly.push((a.add(b.sub(a).mul(s)), mix3(vc[i], vc[j], s)));
            }
        }
        if poly.len() < 3 {
            return;
        }
        let sp: Vec<((f32, f32, f32), Rgb)> = poly.iter().map(|(p, c)| ((cx.hw + p.x / p.z * cx.focal, cx.hh - p.y / p.z * cx.focal, 1.0 / p.z), *c)).collect();
        for k in 1..sp.len() - 1 {
            self.raster(sp[0].0, sp[k].0, sp[k + 1].0, [sp[0].1, sp[k].1, sp[k + 1].1], &col);
        }
    }

    /// 三角形（色は画素位置・奥行き・補間した頂点色から決める関数）
    fn raster<F: Fn(f32, f32, f32, Rgb) -> Rgb>(&mut self, a: (f32, f32, f32), b: (f32, f32, f32), c: (f32, f32, f32), vc: [Rgb; 3], col: &F) {
        let area = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
        if area.abs() < 1e-9 {
            return;
        }
        let minx = a.0.min(b.0).min(c.0).floor().max(0.0) as i32;
        let maxx = a.0.max(b.0).max(c.0).ceil().min(self.w as f32 - 1.0) as i32;
        let miny = a.1.min(b.1).min(c.1).floor().max(0.0) as i32;
        let maxy = a.1.max(b.1).max(c.1).ceil().min(self.h as f32 - 1.0) as i32;
        if minx > maxx || miny > maxy {
            return;
        }
        let inv = 1.0 / area;
        let (a0, a1) = ((b.1 - c.1) * inv, (c.1 - a.1) * inv);
        let a2 = -(a0 + a1);
        for y in miny..=maxy {
            let py = y as f32 + 0.5;
            let b0 = (b.0 * (c.1 - py) - (b.1 - py) * c.0) * inv;
            let b1 = (c.0 * (a.1 - py) - (c.1 - py) * a.0) * inv;
            let b2 = 1.0 - b0 - b1;
            // この行で3つの重みがすべて0以上になる x の範囲を求める
            let (mut lo, mut hi) = (minx as f32 + 0.5, maxx as f32 + 0.5);
            let mut empty = false;
            for (ak, bk) in [(a0, b0), (a1, b1), (a2, b2)] {
                if ak.abs() < 1e-12 {
                    if bk < -1e-6 {
                        empty = true;
                    }
                } else {
                    let r = -bk / ak;
                    if ak > 0.0 {
                        lo = lo.max(r);
                    } else {
                        hi = hi.min(r);
                    }
                }
            }
            if empty || lo > hi {
                continue;
            }
            let xs = ((lo - 0.5).ceil() as i32).max(minx);
            let xe = ((hi - 0.5).floor() as i32).min(maxx);
            let row = y as usize * self.w;
            for x in xs..=xe {
                let px = x as f32 + 0.5;
                let w0 = a0 * px + b0;
                let w1 = a1 * px + b1;
                let w2 = 1.0 - w0 - w1;
                if w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5 {
                    continue;
                }
                let iz = w0 * a.2 + w1 * b.2 + w2 * c.2;
                let idx = row + x as usize;
                if iz <= self.z[idx] {
                    continue;
                }
                self.z[idx] = iz;
                let z = 1.0 / iz;
                let (q0, q1, q2) = (w0 * a.2 * z, w1 * b.2 * z, w2 * c.2 * z);
                let ci = [vc[0][0] * q0 + vc[1][0] * q1 + vc[2][0] * q2, vc[0][1] * q0 + vc[1][1] * q1 + vc[2][1] * q2, vc[0][2] * q0 + vc[1][2] * q1 + vc[2][2] * q2];
                self.col[idx] = col(px, py, z, ci);
            }
        }
    }

    /// 人物の三角形の1画素: 深度テストに通れば、法線を補間してライティング・影を計算して書く
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    fn emit(&mut self, cx: &Cx, lit: &Lit, sm: (&ShadowMap, &ShadowMap), a: (f32, f32, f32), b: (f32, f32, f32), c: (f32, f32, f32), nrm: &[&V3; 3], sf: &Surf, idx: usize, px: f32, py: f32, w0: f32, w1: f32, w2: f32) {
        let iz = w0 * a.2 + w1 * b.2 + w2 * c.2;
        if iz <= self.z[idx] {
            return;
        }
        // 遠近補正した重み
        let z = 1.0 / iz;
        let (p0, p1, p2) = (w0 * a.2 * z, w1 * b.2 * z, w2 * c.2 * z);
        let n = v3(
            nrm[0].x * p0 + nrm[1].x * p1 + nrm[2].x * p2,
            nrm[0].y * p0 + nrm[1].y * p1 + nrm[2].y * p2,
            nrm[0].z * p0 + nrm[1].z * p1 + nrm[2].z * p2,
        )
        .norm();
        let wp = cx.unproject(px, py, z);
        let v = cx.eye.sub(wp).norm();
        // 人物どうしの影と、会場（幕など）が人物に落とす影
        let q = wp.add(n.mul(0.01));
        let vis = sm.0.lit(q).min(sm.1.lit(q));
        self.z[idx] = iz;
        self.oid[idx] = self.cur_id;
        let c = if lit.toon {
            let mut c = lit.toon_shade(sf.albedo, n, v, vis, true);
            if sf.hair {
                // 髪の天使の輪: 画面の上向きの面に白い帯
                let ny = n.dot(cx.u);
                let ring = ((ny - 0.50) / 0.05).clamp(0.0, 1.0) * (1.0 - ((ny - 0.64) / 0.06).clamp(0.0, 1.0));
                for k in 0..3 {
                    c[k] += (1.0 - c[k]) * ring * 0.38;
                }
            }
            c
        } else {
            lit.pbr(sf, n, v, vis, 0.4)
        };
        self.col[idx] = lit.fog(c, z);
    }

    /// 人物の三角形（画面で時計回りの面だけを渡す）
    #[allow(clippy::too_many_arguments)]
    fn raster_shaded(&mut self, cx: &Cx, lit: &Lit, sm: (&ShadowMap, &ShadowMap), a: (f32, f32, f32), b: (f32, f32, f32), c: (f32, f32, f32), nrm: [&V3; 3], sf: &Surf) {
        let area = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
        if area.abs() < 1e-9 {
            return;
        }
        let minx = a.0.min(b.0).min(c.0).floor().max(0.0) as i32;
        let maxx = a.0.max(b.0).max(c.0).ceil().min(self.w as f32 - 1.0) as i32;
        let miny = a.1.min(b.1).min(c.1).floor().max(0.0) as i32;
        let maxy = a.1.max(b.1).max(c.1).ceil().min(self.h as f32 - 1.0) as i32;
        if minx > maxx || miny > maxy {
            return;
        }
        let inv = 1.0 / area;
        // 小さい三角形（ほとんど）は範囲内の画素を直接判定する
        if maxx - minx <= 3 && maxy - miny <= 3 {
            for y in miny..=maxy {
                let py = y as f32 + 0.5;
                let row = y as usize * self.w;
                for x in minx..=maxx {
                    let px = x as f32 + 0.5;
                    let w0 = ((b.0 - px) * (c.1 - py) - (b.1 - py) * (c.0 - px)) * inv;
                    let w1 = ((c.0 - px) * (a.1 - py) - (c.1 - py) * (a.0 - px)) * inv;
                    let w2 = 1.0 - w0 - w1;
                    if w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5 {
                        continue;
                    }
                    self.emit(cx, lit, sm, a, b, c, &nrm, sf, row + x as usize, px, py, w0, w1, w2);
                }
            }
            return;
        }
        let (a0, a1) = ((b.1 - c.1) * inv, (c.1 - a.1) * inv);
        let a2 = -(a0 + a1);
        for y in miny..=maxy {
            let py = y as f32 + 0.5;
            let b0 = (b.0 * (c.1 - py) - (b.1 - py) * c.0) * inv;
            let b1 = (c.0 * (a.1 - py) - (c.1 - py) * a.0) * inv;
            let b2 = 1.0 - b0 - b1;
            let (mut lo, mut hi) = (minx as f32 + 0.5, maxx as f32 + 0.5);
            let mut empty = false;
            for (ak, bk) in [(a0, b0), (a1, b1), (a2, b2)] {
                if ak.abs() < 1e-12 {
                    if bk < -1e-6 {
                        empty = true;
                    }
                } else {
                    let r = -bk / ak;
                    if ak > 0.0 {
                        lo = lo.max(r);
                    } else {
                        hi = hi.min(r);
                    }
                }
            }
            if empty || lo > hi {
                continue;
            }
            let xs = ((lo - 0.5).ceil() as i32).max(minx);
            let xe = ((hi - 0.5).floor() as i32).min(maxx);
            let row = y as usize * self.w;
            for x in xs..=xe {
                let px = x as f32 + 0.5;
                let w0 = a0 * px + b0;
                let w1 = a1 * px + b1;
                let w2 = 1.0 - w0 - w1;
                if w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5 {
                    continue;
                }
                self.emit(cx, lit, sm, a, b, c, &nrm, sf, row + x as usize, px, py, w0, w1, w2);
            }
        }
    }

    /// 輪郭線: 矩形内の各画素について、半径 r の周囲に「手前にある人物の画素」があれば、その画素を線の色にする。
    /// 別の人物・会場との境目はそのまま、同じ人物の中では奥行きが 2% 以上手前に飛ぶところだけ
    fn outline(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, r: f32, oc: Rgb) {
        let (w, h) = (self.w as i32, self.h as i32);
        let (x0, y0, x1, y1) = (x0.max(0), y0.max(0), x1.min(w - 1), y1.min(h - 1));
        let d = r.round().max(1.0) as i32;
        let dd = (r * 0.7).round().max(1.0) as i32;
        let dirs = [(d, 0), (-d, 0), (0, d), (0, -d), (dd, dd), (-dd, dd), (dd, -dd), (-dd, -dd)];
        for y in y0..=y1 {
            for x in x0..=x1 {
                let i = (y * w + x) as usize;
                let (iz, id) = (self.z[i], self.oid[i]);
                let mut hit = false;
                for &(ox, oy) in &dirs {
                    let (qx, qy) = (x + ox, y + oy);
                    if qx < 0 || qy < 0 || qx >= w || qy >= h {
                        continue;
                    }
                    let q = (qy * w + qx) as usize;
                    let qid = self.oid[q];
                    if qid == 0 {
                        continue;
                    }
                    let qz = self.z[q];
                    if if qid == id { qz > iz * 1.02 } else { qz > iz * 1.002 } {
                        hit = true;
                        break;
                    }
                }
                if hit {
                    self.col[i] = oc;
                }
            }
        }
    }

    /// ss×ss の画素を平均して縮小し、8bit RGB（sRGB）で返す
    pub fn downsample(&self, ss: usize) -> Vec<u8> {
        let (ow, oh) = (self.w / ss, self.h / ss);
        let mut out = vec![0u8; ow * oh * 3];
        self.downsample_rect(ss, 0, 0, ow, oh, &mut out);
        out
    }

    /// 出力座標の矩形 [x0,x1) x [y0,y1) だけを縮小して out（幅 w/ss）に書く
    fn downsample_rect(&self, ss: usize, x0: usize, y0: usize, x1: usize, y1: usize, out: &mut [u8]) {
        let ow = self.w / ss;
        let n = (ss * ss) as f32;
        static LUT: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
        let lut = LUT.get_or_init(|| {
            (0..=4096)
                .map(|i| {
                    let c = i as f32 / 4096.0;
                    let s = if c <= 0.0031308 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
                    (s * 255.0 + 0.5) as u8
                })
                .collect()
        });
        for y in y0..y1 {
            for x in x0..x1 {
                let mut acc = [0.0f32; 3];
                for dy in 0..ss {
                    let row = (y * ss + dy) * self.w + x * ss;
                    for dx in 0..ss {
                        let c = self.col[row + dx];
                        acc[0] += c[0];
                        acc[1] += c[1];
                        acc[2] += c[2];
                    }
                }
                let o = (y * ow + x) * 3;
                for k in 0..3 {
                    out[o + k] = lut[((acc[k] / n).clamp(0.0, 1.0) * 4096.0) as usize];
                }
            }
        }
    }
}

// ================= 文字（HUD用 5x7 ビットマップ） =================

fn glyph(c: char) -> [u8; 7] {
    let rows: [&str; 7] = match c {
        '0' => ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
        '1' => ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
        '2' => ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
        '3' => ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
        '4' => ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
        '5' => ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
        '6' => ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
        '7' => ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
        '8' => ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
        '9' => ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
        'A' => ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
        'B' => ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
        'C' => ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
        'D' => ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
        'E' => ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
        'F' => ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
        'G' => ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
        'H' => ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
        'I' => ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
        'J' => ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
        'K' => ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
        'L' => ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
        'M' => ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
        'N' => ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
        'O' => ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        'P' => ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
        'Q' => ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
        'R' => ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
        'S' => ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
        'T' => ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
        'U' => ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
        'V' => ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
        'W' => ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
        'X' => ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
        'Y' => ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
        'Z' => ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
        '/' => ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
        ':' => ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
        '.' => ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
        '-' => ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
        '+' => ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
        '(' => ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
        ')' => ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
        '=' => ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
        _ => ["00000"; 7],
    };
    let mut g = [0u8; 7];
    for (i, r) in rows.iter().enumerate() {
        g[i] = u8::from_str_radix(r, 2).unwrap_or(0);
    }
    g
}

pub fn draw_text(img: &mut [u8], w: usize, h: usize, x0: usize, y0: usize, scale: usize, text: &str, col: [u8; 3]) {
    let mut cx = x0;
    for ch in text.to_uppercase().chars() {
        let g = glyph(ch);
        for (ry, row) in g.iter().enumerate() {
            for rx in 0..5 {
                if row >> (4 - rx) & 1 == 1 {
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let (px, py) = (cx + rx * scale + dx, y0 + ry * scale + dy);
                            if px < w && py < h {
                                let i = (py * w + px) * 3;
                                img[i..i + 3].copy_from_slice(&col);
                            }
                        }
                    }
                }
            }
        }
        cx += 6 * scale;
    }
}

fn shade_box(img: &mut [u8], w: usize, h: usize, x0: usize, y0: usize, bw: usize, bh: usize) {
    for y in y0..(y0 + bh).min(h) {
        for x in x0..(x0 + bw).min(w) {
            let i = (y * w + x) * 3;
            for k in 0..3 {
                img[i + k] = (img[i + k] as f32 * 0.35) as u8;
            }
        }
    }
}

// ================= 人物の描画 =================

/// 1人ぶんのスキニング済み頂点の位置
struct Prep {
    /// 肌・髪の色（線形）
    skin: Rgb,
    hair: Rgb,
    kind: &'static str,
    body: usize,
    inst: usize,
    jacket: Rgb,
    x: f32,
    z: f32,
    /// イラスト: 髪メッシュの名前と頂点の先頭
    hair_mesh: Option<&'static str>,
    hair_off: usize,
    /// イラストの体メッシュを使っている
    ill: bool,
}

/// 会場・照明まわりの、ショー全体で共通の設定
pub struct Ctx {
    lit: Lit,
    /// 人ごとの楽器メッシュ名
    kinds: Vec<Kind>,
    /// 人ごとの打楽器のストローク列（叩かない楽器・パート無しは None）
    strokes: Vec<Option<crate::strike::Strokes>>,
    jackets: Vec<Rgb>,
    /// イラスト: 袖の色（セクションに color があればその色、なければ隊員ごとの明るい色）
    sleeves: Vec<Rgb>,
    ill: bool,
    /// 演者が動く範囲（ワールド x0, x1, z0, z1）
    region: [f32; 4],
    /// 床の影の濃さ（トーンマップ後の乗数）
    shadow_mul: f32,
}

impl Ctx {
    pub fn new(show: &Show) -> Ctx {
        let lit = Lit::new(show);
        let (mut x0, mut x1, mut z0, mut z1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
        for s in &show.sets {
            for p in &s.pos {
                let (x, z) = world(show, p.0, p.1);
                x0 = x0.min(x);
                x1 = x1.max(x);
                z0 = z0.min(z);
                z1 = z1.max(z);
            }
        }
        if x0 > x1 {
            (x0, x1, z0, z1) = (-1.0, 1.0, -1.0, 1.0);
        }
        let m = 3.0;
        let up = v3(0.0, 1.0, 0.0);
        // 床の envMapIntensity（板・芝の床は 0.18、単色の床は 0.3）
        let floor_env = if matches!(show.field.kind, FieldKind::Floor { .. }) { 0.3 } else { 0.18 };
        let full = if lit.toon { lit.toon_shade([1.0; 3], up, up, 1.0, false) } else { lit.diffuse_only([1.0; 3], up, floor_env) };
        let ns = if lit.toon { 1.0 } else { up.dot(lit.sun).max(0.0) };
        let sh = (full[1] - lit.sun_i[1] * ns) / full[1].max(1e-6);
        let kinds: Vec<Kind> = {
            let mut cnt = vec![0usize; show.sections.len()];
            let mut tot = vec![0usize; show.sections.len()];
            for p in &show.performers {
                tot[p.section] += 1;
            }
            show.performers
                .iter()
                .map(|p| {
                    let i = cnt[p.section];
                    cnt[p.section] += 1;
                    mesh_of(&show.sections[p.section].instrument, i, tot[p.section])
                })
                .collect()
        };
        let strokes = (0..show.performers.len())
            .map(|i| {
                let mut notes: Vec<&crate::build::Note> = show.parts.iter().filter(|p| p.members.contains(&i)).flat_map(|p| p.notes.iter()).collect();
                notes.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
                crate::strike::strokes(&notes, kinds[i], (60.0 / show.tempo) as f32)
            })
            .collect();
        Ctx {
            strokes,
            kinds,
            jackets: show.sections.iter().map(|s| lin(hex(&s.color))).collect(),
            sleeves: (0..show.performers.len()).map(|i| lin_h(member_color(show, i))).collect(),
            ill: show.look == "illust",
            region: [x0 - m, x1 + m, z0 - m, z1 + m],
            shadow_mul: if lit.toon { sh.clamp(0.1, 1.0) } else { sh.clamp(0.1, 1.0).powf(0.8) },
            lit,
        }
    }
}

/// フレームごとに使い回す作業領域（スレッドごとに1つ）。
/// 下地が変わらない間は、前のフレームで描き換えたタイルだけを戻して描き直す。
pub struct Scratch {
    fr: Frame,
    sm: Option<ShadowMap>,
    /// 会場の幕・壁が落とす影（人物の影と同じ範囲・向きで、最初に1度だけ作る）
    vm: Option<ShadowMap>,
    verts: Vec<(V3, V3)>,
    tmp: Vec<(V3, V3)>,
    sv: Vec<(f32, f32, f32)>,
    lv: Vec<[f32; 3]>,
    preps: Vec<Prep>,
    /// fr が写している下地の通し番号（0 = なし）
    base_id: u64,
    /// 下地だけを縮小した画像
    base_img: Vec<u8>,
    ss: usize,
    tiles_w: usize,
    dirty: Vec<bool>,
    dirty_list: Vec<usize>,
    prev_list: Vec<usize>,
}

/// タイルの一辺（出力画素）
const TILE: usize = 16;

impl Scratch {
    pub fn new() -> Scratch {
        Scratch { fr: Frame::new(0, 0), sm: None, vm: None, verts: vec![], tmp: vec![], sv: vec![], lv: vec![], preps: vec![], base_id: 0, base_img: vec![], ss: 1, tiles_w: 0, dirty: vec![], dirty_list: vec![], prev_list: vec![] }
    }

    /// ss 解像度の画素矩形（両端含む）を触ったタイルとして記録
    fn mark(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        let ts = (TILE * self.ss) as i32;
        let (w, h) = (self.fr.w as i32, self.fr.h as i32);
        let (x0, y0, x1, y1) = (x0.max(0), y0.max(0), x1.min(w - 1), y1.min(h - 1));
        if x0 > x1 || y0 > y1 {
            return;
        }
        for ty in y0 / ts..=y1 / ts {
            for tx in x0 / ts..=x1 / ts {
                let i = ty as usize * self.tiles_w + tx as usize;
                if !self.dirty[i] {
                    self.dirty[i] = true;
                    self.dirty_list.push(i);
                }
            }
        }
    }

    /// 下地を用意する。同じ下地なら前フレームで触ったタイルだけ戻す。cache=false なら毎回全面コピー
    fn start(&mut self, base: &Frame, ss: usize, cache: bool) {
        let ts = TILE * ss;
        let same = cache && self.base_id == base.id && self.fr.w == base.w && self.fr.h == base.h && self.ss == ss;
        if same {
            let w = base.w;
            for &t in &self.prev_list {
                let (tx, ty) = (t % self.tiles_w, t / self.tiles_w);
                let (x0, x1) = (tx * ts, ((tx + 1) * ts).min(w));
                let (y0, y1) = (ty * ts, ((ty + 1) * ts).min(base.h));
                for y in y0..y1 {
                    self.fr.col[y * w + x0..y * w + x1].copy_from_slice(&base.col[y * w + x0..y * w + x1]);
                    self.fr.z[y * w + x0..y * w + x1].copy_from_slice(&base.z[y * w + x0..y * w + x1]);
                    self.fr.oid[y * w + x0..y * w + x1].fill(0);
                }
            }
        } else {
            if self.fr.w != base.w || self.fr.h != base.h {
                self.fr = Frame::new(base.w, base.h);
            }
            self.fr.copy_from(base);
            self.base_id = if cache { base.id } else { 0 };
            self.ss = ss;
            if cache {
                self.base_img = base.downsample(ss);
            }
            self.tiles_w = (base.w / ss).div_ceil(TILE);
            let th = (base.h / ss).div_ceil(TILE);
            self.dirty = vec![false; self.tiles_w * th];
            self.dirty_list.clear();
        }
        self.prev_list.clear();
        self.dirty_list.clear();
        self.dirty.iter_mut().for_each(|d| *d = false);
    }

    /// 描き終えたフレームを縮小して返す
    fn finish(&mut self, cache: bool) -> Vec<u8> {
        let ss = self.ss;
        if !cache || self.base_id == 0 {
            return self.fr.downsample(ss);
        }
        let mut out = self.base_img.clone();
        let (ow, oh) = (self.fr.w / ss, self.fr.h / ss);
        for &t in &self.dirty_list {
            let (tx, ty) = (t % self.tiles_w, t / self.tiles_w);
            self.fr.downsample_rect(ss, tx * TILE, ty * TILE, ((tx + 1) * TILE).min(ow), ((ty + 1) * TILE).min(oh), &mut out);
        }
        std::mem::swap(&mut self.prev_list, &mut self.dirty_list);
        out
    }
}

impl Default for Scratch {
    fn default() -> Self {
        Self::new()
    }
}

/// 体の向き（フィールド座標の角度、度。0 = 上手、90 = 奥）。view3d.js の jkFacing と同じ
pub fn face_deg(st: &State) -> f64 {
    match st.face {
        Some(a) => a,
        None if st.moving && st.dir.0.hypot(st.dir.1) > 1e-9 => st.dir.1.atan2(st.dir.0).to_degrees() + if st.step.as_deref() == Some("back") { 180.0 } else { 0.0 },
        None => -90.0,
    }
}

/// 向き（ラジアン、0 = 客席向き）。view3d.js の jkFacing と同じ
fn yaw_of(show: &Show, st: &State) -> f32 {
    let fa = match st.face {
        Some(a) => a,
        None if st.moving && st.dir.0.hypot(st.dir.1) > 1e-9 => st.dir.1.atan2(st.dir.0).to_degrees() + if st.step.as_deref() == Some("back") { 180.0 } else { 0.0 },
        None => -90.0,
    };
    let _ = show;
    let fa = fa.to_radians();
    (fa.cos() as f32).atan2(-(fa.sin() as f32))
}

/// 肌・髪の色の候補（view3d.js の SKINS / HAIRS）。ブラウザ版は色管理を有効にする前に作るので、sRGB の値がそのまま線形として使われる
const SKINS: [u32; 5] = [0xf0c8a4, 0xe2a67e, 0xd2956a, 0xb97a52, 0x8d5a3a];
const HAIRS: [u32; 5] = [0x2b1d15, 0x15110f, 0x3d2a1c, 0x5a3d25, 0x7a5a38];

/// 隊員 idx の肌・髪の選び方（view3d.js の figure() と同じ）
fn skin_hair(idx: usize) -> (Rgb, Rgb) {
    let hs = ((idx as u64).wrapping_mul(2654435761) & 0xffff_ffff) >> 7;
    let si = (hs % 5) as usize;
    let hi = (((hs >> 5) * 7 + idx as u64) % 5) as usize;
    (hex_u32(SKINS[si]), hex_u32(HAIRS[hi]))
}

/// イラスト用の肌・髪の色と、隊員ごとの袖の色（view3d.js の SKINS_I / HAIRS_I / SLEEVE_PAL）。sRGB を正しく線形化して使う
const SKINS_I: [u32; 5] = [0xffe3d0, 0xfcd6bc, 0xf4c6a8, 0xe8b392, 0xcf9672];
const HAIRS_I: [u32; 7] = [0x2a2430, 0x4a3226, 0x7a4a30, 0xb4693a, 0xe0b36a, 0x2f3f6e, 0x8a3f5c];
const SLEEVE_PAL: [u32; 12] = [0xff5a5f, 0xff9f1c, 0xffd23f, 0x7bd62e, 0x2ec4b6, 0x3a8dff, 0x8f5bff, 0xff5dc8, 0x00b8d9, 0xef476f, 0x06d6a0, 0xf77f00];

/// 隊員 i の色（0xRRGGBB）。イラストの袖の色と、リール動画のピンの色で共通。
/// イラストでは section に color があればその色、なければ隊員ごとのパレット。リアルでは制服（セクション）の色
pub fn member_color(show: &Show, i: usize) -> u32 {
    let sec = &show.sections[show.performers[i].section];
    if show.look != "illust" || sec.color_given {
        let h = hex(&sec.color);
        let q = |v: f32| (v * 255.0).round().clamp(0.0, 255.0) as u32;
        q(h[0]) << 16 | q(h[1]) << 8 | q(h[2])
    } else {
        SLEEVE_PAL[i % SLEEVE_PAL.len()]
    }
}

fn lin_h(c: u32) -> Rgb {
    let h = hex_u32(c);
    [crate::human::srgb_to_lin(h[0]), crate::human::srgb_to_lin(h[1]), crate::human::srgb_to_lin(h[2])]
}

/// イラストの隊員 idx: (肌, 髪, 髪メッシュの番号)。選び方は view3d.js の figure() と同じ
fn skin_hair_ill(idx: usize, nhair: usize) -> (Rgb, Rgb, usize) {
    let hs = ((idx as u64).wrapping_mul(2654435761) & 0xffff_ffff) >> 7;
    let si = (hs % 5) as usize;
    let hi = (((hs >> 5) * 7 + idx as u64) % 7) as usize;
    let hn = if nhair > 0 { ((idx as u64 * 7 + (hs >> 11)) % nhair as u64) as usize } else { 0 };
    (lin_h(SKINS_I[si]), lin_h(HAIRS_I[hi]), hn)
}

/// 旗のはためき具合 0..1（view3d.js は毎フレーム a += (目標 - a) * min(1, dt*4) で追従する。過去 1.5 カウントを同じ式でたどる）
fn flag_act(show: &Show, i: usize, t: f64) -> f32 {
    let target = |tc: f64| -> f32 {
        let s = state_at(show, i, tc.max(0.0));
        match s.action.as_deref() {
            Some("spin") | Some("swing") | Some("toss") => 1.0,
            Some("rest") => 0.08,
            _ => {
                if s.moving {
                    0.5
                } else {
                    0.2
                }
            }
        }
    };
    let (steps, h) = (12usize, 0.125f64);
    let mut a = target(t - steps as f64 * h);
    for j in (0..steps).rev() {
        a += (target(t - j as f64 * h) - a) * (1.0 - (-4.0 * h).exp()) as f32;
    }
    a
}

fn look_of<'a>(show: &Show, kind: Kind, st: &'a State, t: f64) -> crate::human::Look<'a> {
    // 体の向き（view3d.js の jkFacing）
    let face_deg = match st.face {
        Some(a) => a,
        None if st.moving && st.dir.0.hypot(st.dir.1) > 1e-9 => st.dir.1.atan2(st.dir.0).to_degrees() + if st.step.as_deref() == Some("back") { 180.0 } else { 0.0 },
        None => -90.0,
    };
    crate::human::Look {
        face_deg: face_deg as f32,
        dir: (st.dir.0 as f32, st.dir.1 as f32),
        kind,
        step: st.step.as_deref(),
        moving: st.moving,
        mark: st.mark,
        speed: (st.dir.0.hypot(st.dir.1) * show.field.unit_m / 0.1) as f32,
        phase: st.phase as f32,
        action: st.action.as_deref(),
        pose: st.pose.as_deref(),
        pose_blend: st.pose_blend,
        carry: st.carry.as_deref(),
        carry_from: st.carry_from.as_deref(),
        carry_blend: st.carry_blend,
        t: t as f32,
    }
}

impl Scratch {
    /// 全員の姿勢を計算してスキニングし、影 → 床の影 → 人物の順に描く（self.fr は会場の下地が入っている）
    fn draw_people(&mut self, show: &Show, ctx: &Ctx, cx: &Cx, base: &Frame, t: f64) {
        use crate::human::{human, smoothstep01, Placement};
        let Some(hm) = human() else { return };
        self.preps.clear();
        self.verts.clear();
        let k = set_at(show, t);
        let tempo = show.sets[k].tempo.max(1.0);
        let dtc = 0.1 * tempo / 60.0;
        let (tanx, tany) = (cx.hw / cx.focal, cx.hh / cx.focal);
        for (i, p) in show.performers.iter().enumerate() {
            let st = state_at(show, i, t);
            let (x, z) = world(show, st.x, st.y);
            // 視錐台カリング（影・旗の投げ上げを見込んで半径 5m の球）
            let c = v3(x, 1.0, z).sub(cx.eye);
            let (cz, cxx, cyy) = (c.dot(cx.f), c.dot(cx.r), c.dot(cx.u));
            const R: f32 = 5.0;
            if cz < -R || (cxx.abs() - tanx * cz) / (1.0 + tanx * tanx).sqrt() > R || (cyy.abs() - tany * cz) / (1.0 + tany * tany).sqrt() > R {
                continue;
            }
            let kind = ctx.kinds[i];
            let look = look_of(show, kind, &st, t);
            // 歩きの混ぜ具合: view3d.js は毎フレーム時間で追従するので、過去 0.6 秒を同じ式でたどる
            let walking = |tc: f64| {
                let s = state_at(show, i, tc);
                s.moving || s.mark
            };
            let hist: Vec<bool> = (0..=6).map(|j| walking(t - j as f64 * dtc)).collect();
            let mut wk = hist[6] as u8 as f32;
            if hist.iter().any(|&b| b != hist[6]) {
                for j in (0..=5).rev() {
                    wk += (hist[j] as u8 as f32 - wk) * 0.5;
                }
            } else {
                wk = hist[0] as u8 as f32;
            }
            let mut pose = hm.rest_pose();
            hm.lower(&look, wk, &mut pose);
            let key = hm.upper(&look, &mut pose);
            // 構えが切り替わった直後は前の姿勢から 0.5 秒でなめらかに
            let s = &show.sets[k];
            let sec_in = (t - s.start) * 60.0 / tempo;
            if k > 0 && sec_in < 0.5 {
                let tp = s.start - 1e-6;
                let sp = state_at(show, i, tp);
                let lp = look_of(show, kind, &sp, tp);
                let mut prev = hm.rest_pose();
                let key_p = hm.upper(&lp, &mut prev);
                if key_p != key {
                    hm.blend_upper(&prev, &mut pose, smoothstep01(sec_in as f32 / 0.5));
                }
            }
            // 楽譜どおりに打つ（演奏の構えのときだけ。構えの切り替え中・休めでは弱める）
            if let (Some(sk), None) = (&ctx.strokes[i], &look.action) {
                let spc = 60.0 / tempo as f32;
                let tof = |c: Option<&str>| if c.unwrap_or("play") == "play" { 1.0f32 } else { 0.0 };
                let (a0, a1) = (tof(st.carry_from.as_deref()), tof(st.carry.as_deref()));
                let amt = (a0 + (a1 - a0) * st.carry_blend) * (1.0 - look.pose_blend.clamp(0.0, 1.0));
                hm.apply_strike(&mut pose, sk.fam, &crate::strike::state(sk, t as f32, spc), amt);
            }
            // 体格を少しだけ変える（view3d.js と同じ乱数）
            let h1 = ((i as u64).wrapping_mul(2654435761) & 0xffff_ffff) as f32 / 4294967296.0;
            let h2 = (((i as u64 * 40503 + 7).wrapping_mul(2246822519)) & 0xffff_ffff) as f32 / 4294967296.0;
            let (sc, wid) = (0.95 + 0.1 * h1, 0.96 + 0.08 * h2);
            let rig = hm.rig(&pose, &Placement { x, z, yaw: yaw_of(show, &st), sx: sc * wid, sy: sc }, kind);
            let body = self.verts.len();
            let ill_body = if ctx.ill { hm.ill_body.as_ref() } else { None };
            hm.skin_mesh(ill_body.unwrap_or(&hm.body), &rig, &mut self.tmp);
            self.verts.extend_from_slice(&self.tmp);
            let inst = self.verts.len();
            let flag = if kind == "guard" { Some((t as f32 * 0.5, flag_act(show, i, t))) } else { None };
            hm.skin_inst(&rig, kind, flag, &mut self.tmp);
            self.verts.extend_from_slice(&self.tmp);
            let (mut skin, mut hair) = skin_hair(i);
            let mut jacket = ctx.jackets[p.section];
            let (mut hair_mesh, mut hair_off) = (None, 0);
            if ill_body.is_some() {
                let (sk, hr, hn) = skin_hair_ill(i, hm.hairs.len());
                (skin, hair, jacket) = (sk, hr, ctx.sleeves[i]);
                if let Some(name) = hm.hairs.get(hn) {
                    hair_off = self.verts.len();
                    hm.skin_hair(&rig, name, &mut self.tmp);
                    self.verts.extend_from_slice(&self.tmp);
                    hair_mesh = Some(name.as_str());
                }
            }
            self.preps.push(Prep { skin, hair, kind, body, inst, jacket, x, z, hair_mesh, hair_off, ill: ill_body.is_some() });
        }
        if self.preps.is_empty() {
            return;
        }
        let mut marks: Vec<(i32, i32, i32, i32)> = Vec::with_capacity(self.preps.len() * 3);
        let Scratch { fr, sm, vm, verts, sv, lv, preps, ss: self_ss, .. } = self;
        let self_ss = *self_ss;
        let [rx0, rx1, rz0, rz1] = ctx.region;
        let sm = sm.get_or_insert_with(|| ShadowMap::new(ctx.lit.sun, rx0, rx1, rz0, rz1, 4.6));
        sm.clear();
        let vm = vm.get_or_insert_with(|| {
            let mut m = ShadowMap::new(ctx.lit.sun, rx0, rx1, rz0, rz1, 4.6);
            for t in base.casters.iter() {
                let (a, b, c) = (m.to_tex(t[0]), m.to_tex(t[1]), m.to_tex(t[2]));
                m.tri_impl(a, b, c, true);
            }
            let (target, ext) = sun_frustum(show);
            m.limit(target, ext);
            m
        });
        lv.clear();
        lv.extend(verts.iter().map(|v| sm.to_tex(v.0)));
        let meshes = |kind: &str| hm.inst_meshes(kind);
        // ---- 影（光から見て裏向きの三角形だけ）----
        let body_of = |pr: &Prep| -> &crate::human::MeshData { if pr.ill { hm.ill_body.as_ref().unwrap_or(&hm.body) } else { &hm.body } };
        for pr in preps.iter() {
            for tri in body_of(pr).idx.chunks_exact(3) {
                sm.tri(lv[pr.body + tri[0] as usize], lv[pr.body + tri[1] as usize], lv[pr.body + tri[2] as usize]);
            }
            if let Some(hn) = pr.hair_mesh {
                for tri in hm.insts[hn].mesh.idx.chunks_exact(3) {
                    sm.tri(lv[pr.hair_off + tri[0] as usize], lv[pr.hair_off + tri[1] as usize], lv[pr.hair_off + tri[2] as usize]);
                }
            }
            let mut off = pr.inst;
            for m in meshes(pr.kind) {
                for tri in m.idx.chunks_exact(3) {
                    sm.tri(lv[off + tri[0] as usize], lv[off + tri[1] as usize], lv[off + tri[2] as usize]);
                }
                off += m.pos.len();
            }
        }
        // ---- 床の影（演者の足元まわりの画素だけ、下地の色を暗くする）----
        let (fw, fh) = (fr.w as i32, fr.h as i32);
        let corners_bbox = |x0: f32, x1: f32, z0: f32, z1: f32| -> (i32, i32, i32, i32) {
            let (mut a, mut b, mut c, mut d) = (i32::MAX, i32::MIN, i32::MAX, i32::MIN);
            for &(x, z) in &[(x0, z0), (x1, z0), (x1, z1), (x0, z1)] {
                let (sx, sy, iz) = cx.project(v3(x, 0.0, z));
                if iz <= 0.0 {
                    return (0, fw - 1, 0, fh - 1);
                }
                a = a.min(sx.floor() as i32);
                b = b.max(sx.ceil() as i32);
                c = c.min(sy.floor() as i32);
                d = d.max(sy.ceil() as i32);
            }
            (a.max(0), b.min(fw - 1), c.max(0), d.min(fh - 1))
        };
        let sun = ctx.lit.sun;
        for pr in preps.iter() {
            // 影の長さは背の高さ次第（旗は投げ上げるので長い）
            let ht = if pr.kind == "guard" { 4.8 } else { 2.7 };
            let off = v3(-sun.x / sun.y * ht, 0.0, -sun.z / sun.y * ht);
            let (bx0, bx1, by0, by1) = corners_bbox(pr.x - 0.85 + off.x.min(0.0), pr.x + 0.85 + off.x.max(0.0), pr.z - 0.85 + off.z.min(0.0), pr.z + 0.85 + off.z.max(0.0));
            marks.push((bx0, by0, bx1, by1));
            for y in by0..=by1 {
                for x in bx0..=bx1 {
                    let idx = y as usize * fr.w + x as usize;
                    let iz = base.z[idx];
                    if iz <= 0.0 {
                        continue;
                    }
                    let wp = cx.unproject(x as f32 + 0.5, y as f32 + 0.5, 1.0 / iz);
                    if wp.y < -0.02 || wp.y > 0.05 {
                        continue;
                    }
                    let l = sm.lit(wp);
                    if l < 1.0 {
                        let f = 1.0 - (1.0 - ctx.shadow_mul) * (1.0 - l);
                        let b = base.col[idx];
                        fr.col[idx] = [b[0] * f, b[1] * f, b[2] * f];
                    }
                }
            }
        }
        // 足元のやわらかい接地影（イラストでは付けない）
        for pr in preps.iter().filter(|_| !ctx.ill) {
            let (bx0, bx1, by0, by1) = corners_bbox(pr.x - 0.55, pr.x + 0.55, pr.z - 0.55, pr.z + 0.55);
            marks.push((bx0, by0, bx1, by1));
            for y in by0..=by1 {
                for x in bx0..=bx1 {
                    let idx = y as usize * fr.w + x as usize;
                    let iz = base.z[idx];
                    if iz <= 0.0 {
                        continue;
                    }
                    let wp = cx.unproject(x as f32 + 0.5, y as f32 + 0.5, 1.0 / iz);
                    if wp.y < -0.02 || wp.y > 0.05 {
                        continue;
                    }
                    let d = (wp.x - pr.x).hypot(wp.z - pr.z);
                    let s = ((d - 0.12) / 0.4).clamp(0.0, 1.0);
                    let ao = 1.0 - 0.32 * (1.0 - s * s * (3.0 - 2.0 * s));
                    let c = &mut fr.col[idx];
                    *c = [c[0] * ao, c[1] * ao, c[2] * ao];
                }
            }
        }
        // ---- 人物本体 ----
        sv.clear();
        sv.extend(verts.iter().map(|v| cx.project(v.0)));
        let lit = &ctx.lit;
        let mut rects: Vec<(i32, i32, i32, i32, f32)> = vec![];
        for (pi, pr) in preps.iter().enumerate() {
            fr.cur_id = (pi + 1) as u16;
            let n_body = body_of(pr).pos.len();
            let n_inst = meshes(pr.kind).iter().map(|m| m.pos.len()).sum::<usize>();
            // 画面上の範囲（タイルの更新対象）
            let (mut a, mut b, mut c, mut d) = (i32::MAX, i32::MIN, i32::MAX, i32::MIN);
            for q in &sv[pr.body..pr.body + n_body] {
                if q.2 > 0.0 {
                    a = a.min(q.0 as i32);
                    b = b.max(q.0 as i32 + 1);
                    c = c.min(q.1 as i32);
                    d = d.max(q.1 as i32 + 1);
                }
            }
            for q in &sv[pr.inst..pr.inst + n_inst] {
                if q.2 > 0.0 {
                    a = a.min(q.0 as i32);
                    b = b.max(q.0 as i32 + 1);
                    c = c.min(q.1 as i32);
                    d = d.max(q.1 as i32 + 1);
                }
            }
            if let Some(hn) = pr.hair_mesh {
                for q in &sv[pr.hair_off..pr.hair_off + hm.insts[hn].mesh.pos.len()] {
                    if q.2 > 0.0 {
                        a = a.min(q.0 as i32);
                        b = b.max(q.0 as i32 + 1);
                        c = c.min(q.1 as i32);
                        d = d.max(q.1 as i32 + 1);
                    }
                }
            }
            if ctx.ill {
                // 輪郭線の太さ（画面上の画素）は距離に反比例させ、一定の範囲に収める
                let zc = v3(pr.x, 1.0, pr.z).sub(cx.eye).dot(cx.f).max(0.5);
                let ssf = self_ss as f32;
                let r = (0.010 * cx.focal / zc).clamp(0.9 * ssf, 2.5 * ssf);
                let m = r.ceil() as i32 + 1;
                rects.push((a - m, c - m, b + m, d + m, r));
                marks.push((a - m, c - m, b + m, d + m));
            } else {
                marks.push((a, c, b, d));
            }
            let mats = if pr.ill { &hm.mats_i } else { &hm.mats };
            let draw_mesh = |fr: &mut Frame, m: &crate::human::MeshData, off: usize| {
                for tri in m.idx.chunks_exact(3) {
                    let (i0, i1, i2) = (off + tri[0] as usize, off + tri[1] as usize, off + tri[2] as usize);
                    let (a, b, c) = (sv[i0], sv[i1], sv[i2]);
                    if a.2 <= 0.0 || b.2 <= 0.0 || c.2 <= 0.0 {
                        continue;
                    }
                    let area = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
                    if area >= 0.0 {
                        continue;
                    }
                    let mn = a.0.min(b.0).min(c.0);
                    let mx = a.0.max(b.0).max(c.0);
                    let my = a.1.min(b.1).min(c.1);
                    let mz = a.1.max(b.1).max(c.1);
                    if mx < 0.0 || mn > fw as f32 || mz < 0.0 || my > fh as f32 {
                        continue;
                    }
                    let mt = &mats[m.mat[tri[0] as usize] as usize];
                    let mi = m.mat[tri[0] as usize] as usize;
                    // 肌・髪は隊員ごとの色、唇は肌と素材色の中間
                    let albedo = if mi == hm.mid.skin {
                        pr.skin
                    } else if mi == hm.mid.hair {
                        pr.hair
                    } else if mi == hm.mid.lip || mi == hm.mid.blush {
                        mix3(pr.skin, mt.color, 0.5)
                    } else if mi == hm.mid.iris {
                        [pr.jacket[0] * 0.55, pr.jacket[1] * 0.55, pr.jacket[2] * 0.55]
                    } else if mt.tint {
                        pr.jacket
                    } else {
                        mt.color
                    };
                    let sf = Surf { albedo, rough: mt.rough, metal: mt.metal, hair: mi == hm.mid.hair };
                    fr.raster_shaded(cx, lit, (&*sm, &*vm), a, b, c, [&verts[i0].1, &verts[i1].1, &verts[i2].1], &sf);
                }
            };
            draw_mesh(fr, body_of(pr), pr.body);
            let mut off = pr.inst;
            for m in meshes(pr.kind) {
                draw_mesh(fr, m, off);
                off += m.pos.len();
            }
            if let Some(hn) = pr.hair_mesh {
                draw_mesh(fr, &hm.insts[hn].mesh, pr.hair_off);
            }
        }
        // ---- イラスト: 輪郭線（奥行きの段差と人物の境目を検出して、奥側の画素を暗い線にする）----
        if ctx.ill {
            let oc = lin_hex(0x1b1520);
            for &(x0, y0, x1, y1, r) in &rects {
                fr.outline(x0, y0, x1, y1, r, oc);
            }
        }
        for (x0, y0, x1, y1) in marks {
            self.mark(x0, y0, x1, y1);
        }
    }
}

// ================= 1フレーム描画 =================

pub struct RenderOpts {
    pub width: usize,
    pub height: usize,
    pub ss: usize,
    pub mode: CamMode,
    pub hud: bool,
}

/// 会場だけを描いた下地（カメラが動かないときは全フレームで使い回す）
pub fn base_frame(show: &Show, venue: &Mesh, opts: &RenderOpts, frac: f32) -> Frame {
    base_frame_t(show, venue, opts, frac, 0.0)
}

/// 時刻 t のカメラ（Diag のように隊形を追う場合）で会場だけを描いた下地
pub fn base_frame_t(show: &Show, venue: &Mesh, opts: &RenderOpts, frac: f32, t: f64) -> Frame {
    let mut fr = Frame::new(opts.width * opts.ss, opts.height * opts.ss);
    let cam = camera_t(show, opts.mode, frac, t, opts.width as f32 / opts.height as f32);
    let cx = Cx::new(&cam, fr.w, fr.h);
    let lit = Lit::new(show);
    fr.clear(lit.bg);
    fr.draw_venue(&cx, &lit, venue);
    fr
}

pub fn render_frame(show: &Show, venue: &Mesh, t: f64, opts: &RenderOpts, frac: f32) -> Vec<u8> {
    let base = base_frame(show, venue, opts, frac);
    render_on(show, &base, t, opts, frac)
}

pub fn render_on(show: &Show, base: &Frame, t: f64, opts: &RenderOpts, frac: f32) -> Vec<u8> {
    render_with(show, &Ctx::new(show), &mut Scratch::new(), base, false, t, opts, frac)
}

/// 作業領域を使い回して1フレーム描く。fixed = base が全フレームで同じ（変化したタイルだけ更新できる）
#[allow(clippy::too_many_arguments)]
pub fn render_with(show: &Show, ctx: &Ctx, sc: &mut Scratch, base: &Frame, fixed: bool, t: f64, opts: &RenderOpts, frac: f32) -> Vec<u8> {
    sc.start(base, opts.ss, fixed);
    let cam = camera_t(show, opts.mode, frac, t, opts.width as f32 / opts.height as f32);
    let cx = Cx::new(&cam, base.w, base.h);
    sc.draw_people(show, ctx, &cx, base, t);
    let mut img = sc.finish(fixed);
    if opts.hud {
        let (w, h) = (opts.width, opts.height);
        let sc = (h / 260).max(2);
        let k = set_at(show, t);
        let s = &show.sets[k];
        let into = t - s.start;
        let name = if s.name.is_ascii() { s.name.clone() } else { format!("{}", k + 1) };
        let phase = if k == 0 {
            if s.hold > 0.0 { format!("HOLD {}/{}", (t.floor() as i64 + 1).min(s.hold as i64), s.hold) } else { "START".into() }
        } else if into < s.counts - 1e-9 {
            format!("MOVE {}/{}", (into.floor() as i64 + 1).min(s.counts as i64), s.counts)
        } else if s.hold > 0.0 {
            format!("HOLD {}/{}", ((into - s.counts).floor() as i64 + 1).min(s.hold as i64), s.hold)
        } else {
            "ARRIVED".into()
        };
        let line = format!("SET {}  {}  COUNT {}  TEMPO {}", name, phase, t.floor() as i64, s.tempo.round() as i64);
        let tw = line.len() * 6 * sc + 2 * sc * 4;
        shade_box(&mut img, w, h, sc * 4, h - sc * 16, tw, sc * 12);
        draw_text(&mut img, w, h, sc * 8, h - sc * 13, sc, &line, [255, 210, 63]);
    }
    img
}

/// 音声の入力（2つめの -i）。映像の入力（-i -）のすぐ後、出力オプション（-vf など）より前に足す
pub fn mux_input(cmd: &mut std::process::Command, track: Option<&(crate::audio::TempWav, String)>) {
    if let Some((w, _)) = track {
        cmd.args(["-i", &w.path]);
    }
}

/// AAC の出力設定（出力ファイルの直前に足す）
pub fn mux_output<'a>(cmd: &'a mut std::process::Command, track: Option<&(crate::audio::TempWav, String)>) -> &'a mut std::process::Command {
    if let Some((_, af)) = track {
        cmd.args(["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "160k", "-af", af, "-shortest"]);
    }
    cmd
}

/// ffmpeg で MP4 を書き出す。進捗はコールバックで返す
pub fn render_video(
    show: &Show,
    path: &str,
    opts: &RenderOpts,
    fps: f64,
    speed: f64,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<(), String> {
    render_video_with(show, path, opts, fps, speed, true, progress)
}

/// audio = true なら part の音（audio::render_wav）を AAC で混ぜる
pub fn render_video_with(
    show: &Show,
    path: &str,
    opts: &RenderOpts,
    fps: f64,
    speed: f64,
    audio: bool,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<(), String> {
    let total_counts = show.sets.last().map(|s| s.start + s.counts + s.hold).unwrap_or(0.0);
    let secs = seconds_at(show, total_counts) / speed;
    let nframes = ((secs * fps).ceil() as usize).max(1) + (fps as usize); // 最後に1秒止める
    // 日本語テロップ: ffmpeg に subtitles フィルタがあれば ASS 字幕を焼き込み、なければ ASCII のビットマップ HUD
    let ass = if opts.hud && crate::hud::available() {
        crate::hud::AssFile::write(&crate::hud::video_ass(show, opts.width, opts.height, speed)).ok()
    } else {
        None
    };
    let inner = RenderOpts { width: opts.width, height: opts.height, ss: opts.ss, mode: opts.mode, hud: opts.hud && ass.is_none() };
    let opts = &inner;
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args(["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", &format!("{}x{}", opts.width, opts.height), "-r", &format!("{}", fps), "-i", "-"]);
    let track = if audio { crate::audio::mux_track(show, speed) } else { None };
    mux_input(&mut cmd, track.as_ref());
    if let Some(a) = &ass {
        cmd.args(["-vf", &a.filter()]);
    }
    let mut child = mux_output(&mut cmd, track.as_ref())
        .args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg を起動できません（インストールしてください: macOS なら `brew install ffmpeg`）: {}", e))?;
    let venue = venue(show, opts.mode);
    let ctx = Ctx::new(show);
    let fixed = if matches!(opts.mode, CamMode::Orbit | CamMode::Diag | CamMode::Front) { None } else { Some(base_frame(show, &venue, opts, 0.0)) };
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(16);
    let mut stdin = child.stdin.take().unwrap();
    // ワーカーがフレームを取り合って描き、メインスレッドが番号順に ffmpeg へ流す
    let next = std::sync::atomic::AtomicUsize::new(0);
    let written = std::sync::atomic::AtomicUsize::new(0);
    let window = threads * 3;
    let (tx, rx) = std::sync::mpsc::channel::<(usize, Vec<u8>)>();
    let mut result: Result<(), String> = Ok(());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            let (venue, fixed, ctx, tx, next, written) = (&venue, &fixed, &ctx, tx.clone(), &next, &written);
            scope.spawn(move || {
                let mut sc = Scratch::new();
                loop {
                    let fi = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if fi >= nframes {
                        break;
                    }
                    // 書き出しが遅れているときは先走らない（メモリを抑える）
                    while fi >= written.load(std::sync::atomic::Ordering::SeqCst) + window {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    let t = counts_at(show, fi as f64 / fps * speed).min(total_counts);
                    let frac = fi as f32 / nframes as f32;
                    let img = match fixed {
                        Some(b) => render_with(show, ctx, &mut sc, b, true, t, opts, frac),
                        None => {
                            let b = base_frame_t(show, venue, opts, frac, t);
                            render_with(show, ctx, &mut sc, &b, false, t, opts, frac)
                        }
                    };
                    if tx.send((fi, img)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);
        let mut pending: std::collections::BTreeMap<usize, Vec<u8>> = std::collections::BTreeMap::new();
        let mut done = 0;
        for (fi, img) in rx {
            pending.insert(fi, img);
            while let Some(img) = pending.remove(&done) {
                if result.is_ok() {
                    if let Err(e) = stdin.write_all(&img) {
                        result = Err(format!("ffmpeg への書き込みに失敗: {}", e));
                        // 書けないので、ワーカーを止める
                        next.store(nframes, std::sync::atomic::Ordering::SeqCst);
                    }
                }
                done += 1;
                written.store(done, std::sync::atomic::Ordering::SeqCst);
                if done % (threads * 2) == 0 || done == nframes {
                    progress(done, nframes);
                }
            }
        }
    });
    result?;
    drop(stdin);
    let st = child.wait().map_err(|e| e.to_string())?;
    if !st.success() {
        return Err("ffmpeg がエラーで終了しました".into());
    }
    Ok(())
}

/// 静止画（PNG）。ffmpeg で変換
pub fn render_still(show: &Show, path: &str, t: f64, opts: &RenderOpts) -> Result<(), String> {
    let ass = if opts.hud && crate::hud::available() {
        crate::hud::AssFile::write(&crate::hud::still_ass(show, t, opts.width, opts.height)).ok()
    } else {
        None
    };
    let inner = RenderOpts { width: opts.width, height: opts.height, ss: opts.ss, mode: opts.mode, hud: opts.hud && ass.is_none() };
    let img = render_frame(show, &venue(show, opts.mode), t, &inner, 0.3);
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args(["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", &format!("{}x{}", opts.width, opts.height), "-i", "-"]);
    if let Some(a) = &ass {
        cmd.args(["-vf", &a.filter()]);
    }
    let mut child = cmd
        .args(["-frames:v", "1", path])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg を起動できません: {}", e))?;
    child.stdin.take().unwrap().write_all(&img).map_err(|e| e.to_string())?;
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}
