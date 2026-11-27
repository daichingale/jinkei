//! フィールドの寸法と、座標を「ヤードライン/ハッシュ基準」の言葉に直す処理
//!
//! 座標系（フィールド単位）:
//!   football: 単位 = 8to5 の1歩 (22.5インチ = 0.5715m)。x=0 が50ydライン、+x がサイド2（客席から見て右）、
//!             y=0 がフロントサイドライン、+y が奥（バックフィールド）。
//!   floor:    単位 = メートル。x=0 がフロア中央、y=0 が客席側の端。
//!   gym:      単位 = メートル。原点 = 演技フロアの中心（十字ラインの交点）、+x = 上手（客席から見て右）、+y = 奥。
//!   stage:    単位 = メートル。原点 = 舞台前端の中央、+x = 上手、+y = 奥（上手奥へ）。

pub const STEP_M: f64 = 0.5715;

#[derive(Debug, Clone)]
pub enum FieldKind {
    Football { level: String, hash: f64 },
    Floor { w: f64, d: f64 },
    /// 体育館: 演技フロア w×d（既定 30m×30m、20m×20mライン・十字ライン・5mポイント付き）。原点はフロア中心
    Gym { w: f64, d: f64 },
    /// ステージ: 間口 w × 奥行 d、両袖 wing。原点は舞台前端の中央
    Stage { w: f64, d: f64, wing: f64 },
}

/// 体育館の、演技フロアの外側の余白（壁まで）
pub const GYM_MARGIN: f64 = 5.0;

#[derive(Debug, Clone)]
pub struct Field {
    pub kind: FieldKind,
    pub unit_m: f64,
    /// 1歩の長さ（m）。既定 0.625m = 5m を 8 歩（吹奏楽コンクールの 5m ポイントと同じ）。football は 1 歩 = unit_m
    pub stride_m: f64,
}

/// 既定の 1 歩（cm）
pub const DEFAULT_STRIDE_CM: f64 = 62.5;

pub const BSL: f64 = 160.0 * 12.0 / 22.5; // 85.333 歩

impl Field {
    pub fn football(level: &str) -> Field {
        let inches = match level {
            "college" => 60.0 * 12.0,
            "nfl" => 70.0 * 12.0 + 9.0,
            _ => 53.0 * 12.0 + 4.0,
        };
        Field { kind: FieldKind::Football { level: level.into(), hash: inches / 22.5 }, unit_m: STEP_M, stride_m: STEP_M }
    }
    pub fn floor(w: f64, d: f64) -> Field {
        Field { kind: FieldKind::Floor { w, d }, unit_m: 1.0, stride_m: DEFAULT_STRIDE_CM / 100.0 }
    }
    pub fn gym(w: f64, d: f64) -> Field {
        Field { kind: FieldKind::Gym { w, d }, unit_m: 1.0, stride_m: DEFAULT_STRIDE_CM / 100.0 }
    }
    pub fn stage(w: f64, d: f64, wing: f64) -> Field {
        Field { kind: FieldKind::Stage { w, d, wing }, unit_m: 1.0, stride_m: DEFAULT_STRIDE_CM / 100.0 }
    }
    pub fn is_football(&self) -> bool {
        matches!(self.kind, FieldKind::Football { .. })
    }
    pub fn unit_name(&self) -> &'static str {
        if self.is_football() {
            "歩"
        } else {
            "m"
        }
    }

    /// 定数名 → 値（フィールド単位）
    pub fn constant(&self, name: &str) -> Option<f64> {
        match &self.kind {
            FieldKind::Football { hash, .. } => match name {
                "FSL" => Some(0.0),
                "FH" => Some(*hash),
                "BH" => Some(BSL - hash),
                "BSL" => Some(BSL),
                "MID" => Some(BSL / 2.0),
                _ => None,
            },
            FieldKind::Floor { w, d } => match name {
                "FRONT" => Some(0.0),
                "BACK" => Some(*d),
                "LEFT" | "SHIMO" => Some(-w / 2.0),
                "RIGHT" | "KAMI" => Some(w / 2.0),
                "MID" => Some(d / 2.0),
                _ => None,
            },
            FieldKind::Gym { w, d } => match name {
                "FRONT" => Some(-d / 2.0),
                "BACK" => Some(d / 2.0),
                "LEFT" | "SHIMO" => Some(-w / 2.0),
                "RIGHT" | "KAMI" => Some(w / 2.0),
                "MID" | "CENTER" => Some(0.0),
                "FRONT20" => Some(-10.0),
                "BACK20" => Some(10.0),
                "SHIMO20" => Some(-10.0),
                "KAMI20" => Some(10.0),
                _ => None,
            },
            FieldKind::Stage { w, d, wing } => match name {
                "FRONT" => Some(0.0),
                "BACK" => Some(*d),
                "LEFT" | "SHIMO" => Some(-w / 2.0),
                "RIGHT" | "KAMI" => Some(w / 2.0),
                "MID" => Some(d / 2.0),
                "SHIMOWING" => Some(-w / 2.0 - wing / 2.0),
                "KAMIWING" => Some(w / 2.0 + wing / 2.0),
                _ => None,
            },
        }
    }
    pub fn constant_names(&self) -> &'static str {
        match self.kind {
            FieldKind::Football { .. } => "FSL, FH, BH, BSL, MID / 関数 s1(ヤード), s2(ヤード), yd(ヤード数), m(メートル)",
            FieldKind::Gym { .. } => "FRONT, BACK, KAMI, SHIMO, MID, FRONT20, BACK20, KAMI20, SHIMO20 / 関数 kami(m), shimo(m), mae(m), oku(m)",
            FieldKind::Stage { .. } => "FRONT, BACK, KAMI, SHIMO, MID, KAMIWING, SHIMOWING / 関数 kami(m), shimo(m)",
            FieldKind::Floor { .. } => "FRONT, BACK, LEFT, RIGHT, MID / 関数 kami(m), shimo(m)",
        }
    }

    /// 場外判定
    pub fn in_bounds(&self, x: f64, y: f64) -> bool {
        let e = 1e-6;
        match &self.kind {
            FieldKind::Football { .. } => x.abs() <= 96.0 + e && y >= -e && y <= BSL + e,
            FieldKind::Floor { w, d } => x.abs() <= w / 2.0 + e && y >= -e && y <= d + e,
            // 30mラインを越えても失格ではないので、体育館の壁際までを範囲とする
            FieldKind::Gym { w, d } => {
                x.abs() <= w / 2.0 + GYM_MARGIN - 0.5 + e && y.abs() <= d / 2.0 + GYM_MARGIN - 0.5 + e
            }
            // 袖は可。舞台前端より前は転落
            FieldKind::Stage { w, d, wing } => x.abs() <= w / 2.0 + wing + e && y >= -e && y <= d + e,
        }
    }

    /// 5m ポイントと歩で表した長さ（a は m。例: 8.75m → "1ポイント+6歩"）
    pub fn point_steps(&self, a: f64) -> String {
        let st = self.stride_m;
        let n = 5.0 / st;
        let mut p = (a / 5.0 + 1e-9).floor();
        let mut s = ((a - p * 5.0) / st * 10.0).round() / 10.0;
        if s >= n - 0.05 {
            p += 1.0;
            s = 0.0;
        }
        let num = |v: f64| {
            let t = (v * 10.0).round() as i64;
            if t % 10 == 0 { format!("{}", t / 10) } else { format!("{}.{}", t / 10, t % 10) }
        };
        let mut parts = vec![];
        if p > 0.0 {
            parts.push(format!("{}ポイント", p as i64));
        }
        if s > 0.0 {
            parts.push(format!("{}歩", num(s)));
        }
        if parts.is_empty() {
            "0歩".into()
        } else {
            parts.join("+")
        }
    }

    /// 左右方向の言い方
    pub fn describe_x(&self, x: f64) -> String {
        match &self.kind {
            FieldKind::Football { .. } => {
                if x.abs() < 0.05 {
                    return "50ydライン上".into();
                }
                let side = if x < 0.0 { "サイド1" } else { "サイド2" };
                let ax = x.abs();
                let k = (ax / 8.0).round().min(10.0);
                let yl = 50.0 - 5.0 * k;
                let line = if yl <= 0.0 { "ゴールライン".to_string() } else { format!("{}ydライン", yl as i64) };
                let off = ax - 8.0 * k;
                if off.abs() < 0.05 {
                    format!("{}: {}上", side, line)
                } else {
                    format!("{}: {}から{}へ {:.2}歩", side, line, if off > 0.0 { "外" } else { "内" }, off.abs())
                }
            }
            FieldKind::Floor { .. } | FieldKind::Gym { .. } => {
                if x.abs() < 0.005 {
                    "センター".into()
                } else {
                    format!("センターから{}へ {}（{:.2}m）", if x < 0.0 { "下手" } else { "上手" }, self.point_steps(x.abs()), x.abs())
                }
            }
            FieldKind::Stage { w, .. } => {
                if x.abs() < 0.005 {
                    "センター".into()
                } else if x.abs() > w / 2.0 + 1e-9 {
                    format!("{}袖（センターから{}へ {}（{:.2}m））", if x < 0.0 { "下手" } else { "上手" }, if x < 0.0 { "下手" } else { "上手" }, self.point_steps(x.abs()), x.abs())
                } else {
                    format!("センターから{}へ {}（{:.2}m）", if x < 0.0 { "下手" } else { "上手" }, self.point_steps(x.abs()), x.abs())
                }
            }
        }
    }

    /// 前後方向の言い方
    pub fn describe_y(&self, y: f64) -> String {
        match &self.kind {
            FieldKind::Football { hash, .. } => {
                let refs = [
                    (0.0, "フロントサイドライン"),
                    (*hash, "フロントハッシュ"),
                    (BSL - hash, "バックハッシュ"),
                    (BSL, "バックサイドライン"),
                ];
                let (r, name) = refs
                    .iter()
                    .min_by(|a, b| (y - a.0).abs().partial_cmp(&(y - b.0).abs()).unwrap())
                    .unwrap();
                let off = y - r;
                if off.abs() < 0.05 {
                    format!("{}上", name)
                } else {
                    format!("{}から{}へ {:.2}歩", name, if off > 0.0 { "後ろ" } else { "前" }, off.abs())
                }
            }
            FieldKind::Floor { .. } => {
                if y.abs() < 0.005 {
                    "前端（客席側の端）".into()
                } else {
                    format!("前端から奥へ {}（{:.2}m）", self.point_steps(y.abs()), y)
                }
            }
            FieldKind::Gym { .. } => {
                if y.abs() < 0.005 {
                    "センターライン上".into()
                } else {
                    format!("センターから{}へ {}（{:.2}m）", if y < 0.0 { "客席側" } else { "奥" }, self.point_steps(y.abs()), y.abs())
                }
            }
            FieldKind::Stage { .. } => {
                if y.abs() < 0.005 {
                    "舞台前端".into()
                } else {
                    format!("舞台前端から奥へ {}（{:.2}m）", self.point_steps(y.abs()), y)
                }
            }
        }
    }

    /// 体の向きの言い方（None = 自動: 止まっているときは客席向き）
    pub fn describe_face(&self, a: Option<f64>) -> String {
        let Some(a) = a else { return "客席向き（自動）".into() };
        let mut d = a + 90.0; // 0 = 客席向き、+ = 上手側へ回る
        while d > 180.0 {
            d -= 360.0;
        }
        while d <= -180.0 {
            d += 360.0;
        }
        let (r, l) = if self.is_football() { ("サイド2", "サイド1") } else { ("上手", "下手") };
        let near = |x: f64| (d - x).abs() < 0.5;
        if near(0.0) {
            "客席向き".into()
        } else if near(180.0) || near(-180.0) {
            "奥向き".into()
        } else if near(90.0) {
            format!("{}向き", r)
        } else if near(-90.0) {
            format!("{}向き", l)
        } else if d.abs() < 90.0 {
            format!("客席から{}側へ {:.0}°", if d > 0.0 { r } else { l }, d.abs())
        } else {
            format!("奥から{}側へ {:.0}°", if d > 0.0 { r } else { l }, 180.0 - d.abs())
        }
    }

    /// 1カウントあたりの移動量（フィールド単位）→ 歩幅の言い方と、大股警告の判定値
    pub fn describe_step(&self, per_count: f64) -> String {
        if per_count < 1e-6 {
            return "静止".into();
        }
        if self.is_football() {
            format!("{:.1} to 5", 8.0 / per_count)
        } else {
            format!("歩幅 {:.0}cm", per_count * 100.0)
        }
    }
}
