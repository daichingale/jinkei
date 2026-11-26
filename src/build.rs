//! AST → 各セットでの全員の位置
use crate::field::Field;
use crate::geom::{self, P};
use crate::syntax::{Assign, Expr, FieldAst, GroupTerm, PointE, Pos, Shape, ShowAst, Xf};
use crate::{Error, Result};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Section {
    pub id: String,
    pub label: String,
    pub color: String,
    /// color を書いたか（イラストの見た目では、書かなければ隊員ごとに色を変える）
    pub color_given: bool,
    /// 楽器（instruments.rs の ID）
    pub instrument: String,
}

#[derive(Debug, Clone)]
pub struct Performer {
    pub id: String,
    pub section: usize,
}

#[derive(Debug, Clone)]
pub struct Set {
    pub name: String,
    pub counts: f64,
    pub hold: f64,
    /// このセットの開始カウント（通算、移動開始時点）
    pub start: f64,
    /// 各メンバーの位置（フィールド単位）
    pub pos: Vec<P>,
    /// 各メンバーが動き出すまで待つカウント数（0 = すぐ動く）
    pub wait: Vec<f64>,
    /// 各メンバーが移動を終えるカウント（既定 = counts）
    pub end: Vec<f64>,
    /// 経路の曲がり（度）。0 = まっすぐ
    pub bend: Vec<f64>,
    /// 体の向き（フィールド座標の角度、度。0 = 上手、90 = 奥、-90 = 客席）。None = 自動（移動中は進行方向、止まると客席）
    pub face: Vec<Option<f64>>,
    /// 折れ線の経路（フォロー・ザ・リーダー）。None = 直線か円弧
    pub route: Vec<Option<Vec<P>>>,
    /// ステップの種類（glide / back / slide / jazz / high）
    pub step: Vec<Option<String>>,
    /// 手具・動作（spin / toss / swing / rest）
    pub action: Vec<Option<String>>,
    /// 姿勢（到着後〜ホールド中）。触れられなければ前のセットを引き継ぐ
    pub pose: Vec<Option<String>>,
    /// 楽器の構え（play / right / left / front / diag）。触れられなければ前のセットを引き継ぐ
    pub carry: Vec<Option<String>>,
    /// このセットのテンポ
    pub tempo: f64,
    /// ホールド中にマークタイム
    pub mark: bool,
    /// サブセット（直前の本セットの下位）。name は表示名（3A など）
    pub sub: bool,
    pub line: usize,
    /// エディタ用: [文][メンバー] → その文の隊形での席番号（1始まり）
    pub slots: Vec<Vec<usize>>,
}

/// パートの1音（t は通算カウント）
#[derive(Debug, Clone, Copy)]
pub struct Note {
    pub t: f64,
    pub dur: f64,
    /// 'R' | 'L' | 'B'
    pub hand: char,
    /// 0 = 通常, 1 = アクセント, 2 = 強いアクセント
    pub accent: u8,
    /// "tap" | "click" | "flam" | "diddle" | "buzz" | "rimshot" | "mute" | "gock" | "scrape" | "stickclick"
    pub kind: &'static str,
    /// 打面・ドラム番号（0 = 指定なし）。テナーは 1〜4 = 主ドラム（1 が最高音）、5・6 = スポック。バスは 1 = 最小 … 5 = 最大
    pub pad: u8,
    /// 強弱 0..1（既定 mf = 0.7。アクセントとは別）
    pub vel: f32,
}

/// 楽譜パート（演奏するメンバーと音符）
#[derive(Debug, Clone)]
pub struct Part {
    pub name: String,
    /// 演奏するメンバー（performers の添字）
    pub members: Vec<usize>,
    pub meter: (u32, u32),
    pub start: f64,
    pub end: f64,
    pub notes: Vec<Note>,
    /// 各小節の頭の通算カウント
    pub bars: Vec<f64>,
}

/// 拍子が合わない小節などの注意（analyze が警告にする）
#[derive(Debug, Clone)]
pub struct PartWarn {
    pub part: usize,
    pub msg: String,
    pub at: f64,
}

#[derive(Debug, Clone)]
pub struct Show {
    pub name: String,
    pub field: Field,
    pub tempo: f64,
    pub clearance: f64,
    pub maxstep: f64,
    /// 見た目: "real"（既定）/ "illust"
    pub look: String,
    pub sections: Vec<Section>,
    pub performers: Vec<Performer>,
    pub sets: Vec<Set>,
    /// エディタ用: [セット][文] → ドラッグできる点（役割, x, y）
    pub handles: Vec<Vec<Vec<(String, f64, f64)>>>,
    /// エディタ用: [セット][文] → 対象メンバー
    pub members: Vec<Vec<Vec<usize>>>,
    /// エディタ用: [セット][メンバー] → そのメンバーの位置を最終的に決めた文（-1 = 前のセットのまま）
    pub owner: Vec<Vec<i64>>,
    pub parts: Vec<Part>,
    pub part_warnings: Vec<PartWarn>,
}

const PALETTE: [&str; 10] =
    ["#e6194b", "#3cb4ff", "#ffe119", "#f58231", "#a66cff", "#3cd070", "#f032e6", "#bcf60c", "#fabebe", "#ffffff"];

struct Ctx<'a> {
    field: &'a Field,
}

impl Ctx<'_> {
    fn eval(&self, e: &Expr) -> Result<f64> {
        Ok(match e {
            Expr::Num(v) => *v,
            Expr::Neg(a) => -self.eval(a)?,
            Expr::Bin(op, a, b) => {
                let (x, y) = (self.eval(a)?, self.eval(b)?);
                match op {
                    '+' => x + y,
                    '-' => x - y,
                    '*' => x * y,
                    _ => x / y,
                }
            }
            Expr::Name(n, p) => self.field.constant(n).ok_or_else(|| {
                Error::at(p.line, p.col, format!("「{}」はこのフィールドでは使えません（使えるもの: {}）", n, self.field.constant_names()))
            })?,
            Expr::Call(f, args, p) => {
                let need = |k: usize| -> Result<()> {
                    if args.len() != k {
                        Err(Error::at(p.line, p.col, format!("{} の引数は{}個です", f, k)))
                    } else {
                        Ok(())
                    }
                };
                let fb = self.field.is_football();
                match f.as_str() {
                    "s1" | "s2" if fb => {
                        need(1)?;
                        let y = self.eval(&args[0])?;
                        if !(0.0..=50.0).contains(&y) {
                            return Err(Error::at(p.line, p.col, "ヤードラインは0〜50で指定してください"));
                        }
                        let x = (50.0 - y) * 1.6;
                        if f == "s1" {
                            -x
                        } else {
                            x
                        }
                    }
                    "yd" if fb => {
                        need(1)?;
                        self.eval(&args[0])? * 1.6
                    }
                    "m" => {
                        need(1)?;
                        self.eval(&args[0])? / self.field.unit_m
                    }
                    "kami" | "oku" if !fb => {
                        need(1)?;
                        self.eval(&args[0])?
                    }
                    "shimo" | "mae" if !fb => {
                        need(1)?;
                        -self.eval(&args[0])?
                    }
                    _ => {
                        return Err(Error::at(
                            p.line,
                            p.col,
                            format!("関数「{}」はこのフィールドでは使えません（使えるもの: {}）", f, self.field.constant_names()),
                        ))
                    }
                }
            }
        })
    }
    fn pt(&self, p: &PointE) -> Result<P> {
        Ok((self.eval(&p.0)?, self.eval(&p.1)?))
    }
}

fn resolve_group(terms: &[GroupTerm], show: &[Performer], secs: &HashMap<String, usize>, ids: &HashMap<String, usize>) -> Result<Vec<usize>> {
    let mut out: Vec<usize> = vec![];
    let add = |i: usize, out: &mut Vec<usize>| {
        if !out.contains(&i) {
            out.push(i)
        }
    };
    for t in terms {
        match t {
            GroupTerm::All => (0..show.len()).for_each(|i| add(i, &mut out)),
            GroupTerm::Name(n, p) => {
                if let Some(&s) = secs.get(n) {
                    for (i, pf) in show.iter().enumerate() {
                        if pf.section == s {
                            add(i, &mut out);
                        }
                    }
                } else if let Some(&i) = ids.get(n) {
                    add(i, &mut out);
                } else {
                    return Err(Error::at(p.line, p.col, format!("「{}」というセクション・メンバーはいません", n)));
                }
            }
            GroupTerm::Range(a, b, p) => {
                let (Some(&ia), Some(&ib)) = (ids.get(a), ids.get(b)) else {
                    return Err(Error::at(p.line, p.col, format!("{}..{} のメンバーが見つかりません", a, b)));
                };
                if show[ia].section != show[ib].section || ia > ib {
                    return Err(Error::at(p.line, p.col, format!("{}..{} は同じセクション内で小さい番号から指定してください", a, b)));
                }
                (ia..=ib).for_each(|i| add(i, &mut out));
            }
        }
    }
    Ok(out)
}

fn err(p: Pos, m: impl Into<String>) -> Error {
    Error::at(p.line, p.col, m)
}

/// 1セット分の各人の動き方（時間差・カーブ）
struct Timing<'a> {
    wait: &'a [f64],
    end: &'a [f64],
    bend: &'a [f64],
    route: &'a [Option<Vec<P>>],
}

fn mv<'a>(i: usize, pv: &[P], pos: &[P], tm: &'a Timing) -> geom::Mv<'a> {
    geom::Mv { a: pv[i], b: pos[i], w: tm.wait[i], e: tm.end[i], bend: tm.bend[i], route: tm.route[i].as_deref() }
}

/// i の経路が他の全員とぶつかる度合い（距離 + 衝突ペナルティ）
fn path_cost(i: usize, pv: &[P], pos: &[P], tm: &Timing, c: f64, cl: f64) -> f64 {
    let mut cost = mv(i, pv, pos, tm).length();
    let me = mv(i, pv, pos, tm);
    for k in 0..pos.len() {
        if k == i {
            continue;
        }
        let (d, _) = geom::closest(&me, &mv(k, pv, pos, tm), c);
        if d < cl {
            cost += 1000.0 * (1.0 + cl - d);
        }
    }
    cost
}

fn untangle(group: &[usize], pv: &[P], pos: &mut [P], tm: &Timing, c: f64, cl: f64) {
    for _ in 0..50 {
        let mut improved = false;
        for x in 0..group.len() {
            for y in x + 1..group.len() {
                let (a, b) = (group[x], group[y]);
                let (d, _) = geom::closest(&mv(a, pv, pos, tm), &mv(b, pv, pos, tm), c);
                if d >= cl {
                    continue;
                }
                let before = path_cost(a, pv, pos, tm, c, cl) + path_cost(b, pv, pos, tm, c, cl);
                pos.swap(a, b);
                let after = path_cost(a, pv, pos, tm, c, cl) + path_cost(b, pv, pos, tm, c, cl);
                if after + 1e-9 < before {
                    improved = true;
                } else {
                    pos.swap(a, b);
                }
            }
        }
        if !improved {
            break;
        }
    }
}

/// 向きの指定（セット内で解決するための中間形）
#[derive(Clone, Copy)]
enum FaceSpec {
    Auto,
    Angle(f64),
    Toward(P),
    Center(P),
    Out(P),
}

pub fn build(a: &ShowAst) -> Result<Show> {
    let field = match &a.field {
        FieldAst::Football(k) => Field::football(k),
        FieldAst::Floor { w, d } => Field::floor(*w, *d),
        FieldAst::Gym { w, d } => Field::gym(*w, *d),
        FieldAst::Stage { w, d, wing } => Field::stage(*w, *d, *wing),
    };
    let ctx = Ctx { field: &field };
    let mut sections = vec![];
    let mut performers = vec![];
    let mut secs = HashMap::new();
    let mut ids = HashMap::new();
    for (si, s) in a.sections.iter().enumerate() {
        if secs.insert(s.id.clone(), si).is_some() {
            return Err(err(s.pos, format!("セクション「{}」が重複しています", s.id)));
        }
        sections.push(Section {
            id: s.id.clone(),
            label: s.label.clone(),
            color: s.color.clone().unwrap_or_else(|| PALETTE[si % PALETTE.len()].into()),
            color_given: s.color.is_some(),
            instrument: s.instrument.clone().unwrap_or_else(|| crate::instruments::detect(&s.label, &s.id).to_string()),
        });
        for k in 1..=s.n {
            let id = format!("{}{}", s.id, k);
            if ids.insert(id.clone(), performers.len()).is_some() {
                return Err(err(s.pos, format!("メンバー名「{}」が重複します（セクション名を変えてください）", id)));
            }
            performers.push(Performer { id, section: si });
        }
    }
    if performers.is_empty() {
        return Err(Error::at(0, 0, "section がありません"));
    }
    if a.sets.is_empty() {
        return Err(Error::at(0, 0, "set がありません"));
    }

    let n = performers.len();
    let mut sets: Vec<Set> = vec![];
    let mut all_handles = vec![];
    let mut all_members = vec![];
    let mut all_owner = vec![];
    let mut cur_tempo = a.tempo;
    let mut start = 0.0;
    let set_names = crate::syntax::set_display_names(&a.sets);
    for (k, sa) in a.sets.iter().enumerate() {
        if sa.sub && k == 0 {
            return Err(err(sa.pos, "最初のセットはサブセットにできません（前の本セットがありません）"));
        }
        let prev: Option<Vec<P>> = sets.last().map(|s: &Set| s.pos.clone());
        // 文ごとの結果。同じ人を後の文でもう一度指定したら、後の文が優先（その人だけ上書き）
        struct Rec {
            group: Vec<usize>,
            spots: Vec<P>,
            auto: bool,
            assigned: Vec<P>,
            order: Vec<usize>,
            keep: Vec<usize>,
            w: f64,
            e: f64,
            bend: f64,
            face: FaceSpec,
            routes: Option<Vec<Vec<P>>>,
            step: Option<String>,
            action: Option<String>,
            pose: Option<String>,
            carry: Option<String>,
            /// 位置を変えない指定（向き・姿勢などだけ）
            attr: bool,
            face_given: bool,
        }
        let mut recs: Vec<Rec> = vec![];
        let mut set_handles = vec![];
        let mut set_members = vec![];
        for st in &sa.stmts {
            let group = resolve_group(&st.group, &performers, &secs, &ids)?;
            let (mut tw, mut te) = (0.0, sa.counts);
            let tb = match &st.bend {
                Some(e) => {
                    let v = ctx.eval(e)?;
                    if v.abs() >= 180.0 {
                        return Err(err(st.pos, "bend は -179〜179 度にしてください"));
                    }
                    if k == 0 && v != 0.0 {
                        return Err(err(st.pos, "最初のセットでは bend は使えません"));
                    }
                    v
                }
                None => 0.0,
            };
            if st.wait.is_some() || st.within.is_some() {
                if k == 0 {
                    return Err(err(st.pos, "最初のセットでは wait / in は使えません"));
                }
                let w = match &st.wait {
                    Some(e) => ctx.eval(e)?,
                    None => 0.0,
                };
                let d = match &st.within {
                    Some(e) => ctx.eval(e)?,
                    None => sa.counts - w,
                };
                if w < 0.0 || d <= 0.0 || w + d > sa.counts + 1e-9 {
                    return Err(err(
                        st.pos,
                        format!("wait {} + in {} がセットの counts（{}）に収まりません", w, d, sa.counts),
                    ));
                }
                tw = w;
                te = w + d;
            }
            let g = group.len();
            let is_same = matches!(st.shape, Shape::Same);
            let h = |r: &str, p: P| (r.to_string(), p.0, p.1);
            let handles: Vec<(String, f64, f64)> = match &st.shape {
                Shape::Line(a, b) => vec![h("a", ctx.pt(a)?), h("b", ctx.pt(b)?)],
                Shape::Arc { c, r, a1, a2 } => {
                    let (c, r) = (ctx.pt(c)?, ctx.eval(r)?);
                    let at = |deg: f64| (c.0 + r * deg.to_radians().cos(), c.1 + r * deg.to_radians().sin());
                    vec![h("c", c), h("a1", at(ctx.eval(a1)?)), h("a2", at(ctx.eval(a2)?))]
                }
                Shape::Circle { c, r, start } => {
                    let (c, r) = (ctx.pt(c)?, ctx.eval(r)?);
                    let s0 = match start {
                        Some(e) => ctx.eval(e)?,
                        None => 270.0,
                    };
                    vec![h("c", c), h("r", (c.0 + r * s0.to_radians().cos(), c.1 + r * s0.to_radians().sin()))]
                }
                Shape::Block { c, .. } => vec![h("c", ctx.pt(c)?)],
                Shape::Curve(ps) | Shape::Poly(ps) => {
                    let mut v = vec![];
                    for (k, p) in ps.iter().enumerate() {
                        v.push((format!("p{}", k), ctx.eval(&p.0)?, ctx.eval(&p.1)?));
                    }
                    v
                }
                Shape::At(p) => vec![h("p", ctx.pt(p)?)],
                Shape::Same | Shape::Attr => vec![],
                Shape::Follow { pts, .. } => {
                    let mut v = vec![];
                    for (k, p) in pts.iter().enumerate() {
                        v.push((format!("p{}", k), ctx.eval(&p.0)?, ctx.eval(&p.1)?));
                    }
                    v
                }
            };
            set_handles.push(handles);
            set_members.push(group.clone());
            // 空き: 席数 = 人数 + 空きの数。席の並びは変えず、空けた席だけ取り除く
            let skips: Vec<usize> = st.skip.clone();
            if !skips.is_empty() {
                if matches!(st.shape, Shape::At(_) | Shape::Same | Shape::Follow { .. } | Shape::Attr) {
                    return Err(err(st.pos, "skip（空き）は line / arc / circle / block / curve / poly の隊形で使えます"));
                }
                let total = g + skips.len();
                if let Some(bad) = skips.iter().find(|&&x| x > total) {
                    return Err(err(st.pos, format!("skip（空き）の席 {} が席数（{}人 + 空き{} = {}）を超えています", bad, g, skips.len(), total)));
                }
            }
            let gt = g + skips.len();
            let mut spots: Vec<P> = match &st.shape {
                Shape::Line(p1, p2) => geom::line(ctx.pt(p1)?, ctx.pt(p2)?, gt),
                Shape::Arc { c, r, a1, a2 } => geom::arc(ctx.pt(c)?, ctx.eval(r)?, ctx.eval(a1)?, ctx.eval(a2)?, gt),
                Shape::Circle { c, r, start } => {
                    let s0 = match start {
                        Some(e) => ctx.eval(e)?,
                        None => 270.0,
                    };
                    geom::circle(ctx.pt(c)?, ctx.eval(r)?, s0, gt)
                }
                Shape::Block { c, cols, spacing, rowsp } => {
                    let cols = ctx.eval(cols)?;
                    if cols < 1.0 {
                        return Err(err(st.pos, "cols は1以上にしてください"));
                    }
                    let def = if field.is_football() { 2.0 } else { 1.5 };
                    let sp = match spacing {
                        Some(e) => ctx.eval(e)?,
                        None => def,
                    };
                    let rsp = match rowsp {
                        Some(e) => ctx.eval(e)?,
                        None => sp,
                    };
                    geom::block(ctx.pt(c)?, cols.round() as usize, sp, rsp, gt)
                }
                Shape::Curve(ps) => geom::curve(&ps.iter().map(|p| ctx.pt(p)).collect::<Result<Vec<_>>>()?, gt),
                Shape::Poly(ps) => geom::resample(&ps.iter().map(|p| ctx.pt(p)).collect::<Result<Vec<_>>>()?, gt),
                Shape::At(p) => {
                    if g != 1 {
                        return Err(err(st.pos, format!("at は1人用です（{}人指定されています）", g)));
                    }
                    vec![ctx.pt(p)?]
                }
                Shape::Same => match &prev {
                    Some(pv) => group.iter().map(|&i| pv[i]).collect(),
                    None => return Err(err(st.pos, "最初のセットでは same は使えません")),
                },
                // いったん経路の通過点を入れておき、変形のあとで各人の経路と到着点を計算する
                Shape::Follow { pts, .. } => pts.iter().map(|p| ctx.pt(p)).collect::<Result<Vec<_>>>()?,
                Shape::Attr => vec![],
            };
            for x in &st.xf {
                match x {
                    Xf::Rotate(a, about) => {
                        let c = match about {
                            Some(p) => ctx.pt(p)?,
                            None => geom::centroid(&spots),
                        };
                        geom::rotate(&mut spots, ctx.eval(a)?, c);
                    }
                    Xf::Shift(d) => {
                        let (dx, dy) = ctx.pt(d)?;
                        spots.iter_mut().for_each(|p| *p = (p.0 + dx, p.1 + dy));
                    }
                    Xf::Scale(s) => {
                        let s = ctx.eval(s)?;
                        let c = geom::centroid(&spots);
                        spots.iter_mut().for_each(|p| *p = (c.0 + (p.0 - c.0) * s, c.1 + (p.1 - c.1) * s));
                    }
                }
            }
            if spots.iter().any(|p| !p.0.is_finite() || !p.1.is_finite()) {
                return Err(err(st.pos, "座標が計算できません（0で割っていませんか）"));
            }
            // 向きの基準（center / out）は、空きを含めた隊形全体の中心
            let cen_full = geom::centroid(&spots);
            let keep: Vec<usize> = (0..spots.len()).filter(|i| !skips.contains(&(i + 1))).collect();
            if !skips.is_empty() {
                spots = keep.iter().map(|&i| spots[i]).collect();
            }
            let mut routes: Option<Vec<Vec<P>>> = None;
            if let Shape::Follow { spacing, .. } = &st.shape {
                let Some(pv) = &prev else { return Err(err(st.pos, "最初のセットでは follow は使えません")) };
                let r = spots.clone();
                let sp = match spacing {
                    Some(e) => ctx.eval(e)?,
                    None => {
                        if field.is_football() {
                            2.0
                        } else {
                            1.2
                        }
                    }
                };
                // 並び順: assign keep なら書いた順。既定は経路の始点に近い人を先頭に、近い人を順にたどる
                let order: Vec<usize> = if st.assign == Some(Assign::Keep) {
                    (0..g).collect()
                } else {
                    let mut left: Vec<usize> = (0..g).collect();
                    let mut ord = vec![];
                    let mut cur = r[0];
                    while !left.is_empty() {
                        let j = (0..left.len())
                            .min_by(|&x, &y| geom::dist(pv[group[left[x]]], cur).partial_cmp(&geom::dist(pv[group[left[y]]], cur)).unwrap())
                            .unwrap();
                        let gi = left.remove(j);
                        cur = pv[group[gi]];
                        ord.push(gi);
                    }
                    ord
                };
                let mut lead_trail = vec![pv[group[order[0]]]];
                lead_trail.extend(r.iter().copied());
                let l_lead = geom::poly_len(&lead_trail);
                let mut fin = vec![(0.0, 0.0); g];
                let mut rts = vec![vec![]; g];
                for (j, &gi) in order.iter().enumerate() {
                    // j 番目の人: 自分の位置 → 前の人たちの位置 → 先頭の位置 → 経路
                    let mut trail: Vec<P> = (0..=j).rev().map(|q| pv[group[order[q]]]).collect();
                    let chain = geom::poly_len(&trail);
                    trail.extend(r.iter().copied());
                    let path = geom::poly_cut(&trail, chain + (l_lead - j as f64 * sp).max(0.0));
                    fin[gi] = *path.last().unwrap();
                    rts[gi] = path;
                }
                spots = fin;
                routes = Some(rts);
            }
            let mode = st.assign.unwrap_or(if is_same { Assign::Keep } else { Assign::Auto });
            let is_attr = matches!(st.shape, Shape::Attr);
            let auto = prev.is_some() && mode == Assign::Auto && routes.is_none() && !is_attr;
            let order: Vec<usize> = match &prev {
                _ if is_attr => vec![],
                Some(pv) if auto => {
                    let from: Vec<P> = group.iter().map(|&i| pv[i]).collect();
                    geom::assign(&from, &spots)
                }
                _ => (0..g).collect(),
            };
            let assigned = if is_attr { vec![] } else { (0..g).map(|gi| spots[order[gi]]).collect() };
            let cen = if skips.is_empty() { geom::centroid(&spots) } else { cen_full };
            let face = match &st.face {
                None if st.step.as_deref() == Some("slide") => FaceSpec::Angle(-90.0),
                None => FaceSpec::Auto,
                Some(crate::syntax::FaceAst::Named(n)) => match n.as_str() {
                    "front" => FaceSpec::Angle(-90.0),
                    "back" => FaceSpec::Angle(90.0),
                    "kami" => FaceSpec::Angle(0.0),
                    "shimo" => FaceSpec::Angle(180.0),
                    "center" => FaceSpec::Center(cen),
                    "out" => FaceSpec::Out(cen),
                    _ => FaceSpec::Auto,
                },
                Some(crate::syntax::FaceAst::Toward(p)) => FaceSpec::Toward(ctx.pt(p)?),
                Some(crate::syntax::FaceAst::Deg(e)) => FaceSpec::Angle(-90.0 + ctx.eval(e)?),
            };
            let spots_len = spots.len();
            recs.push(Rec {
                group,
                spots,
                auto,
                assigned,
                order,
                keep: if skips.is_empty() { (0..spots_len).collect() } else { keep },
                w: tw,
                e: te,
                bend: tb,
                face,
                routes,
                step: st.step.clone(),
                action: st.action.clone(),
                pose: st.pose.clone(),
                carry: st.carry.clone(),
                attr: is_attr,
                face_given: st.face.is_some(),
            });
        }
        // 各メンバーを最後に指定した文（なければ前のセットのまま）
        let mut owner: Vec<Option<(usize, usize)>> = vec![None; n];
        for (si, r) in recs.iter().enumerate() {
            if r.attr {
                continue;
            }
            for (gi, &i) in r.group.iter().enumerate() {
                owner[i] = Some((si, gi));
            }
        }
        let mut wait = vec![0.0; n];
        let mut end = vec![sa.counts; n];
        let mut bend = vec![0.0; n];
        let mut route: Vec<Option<Vec<P>>> = vec![None; n];
        let mut step: Vec<Option<String>> = vec![None; n];
        let mut action: Vec<Option<String>> = vec![None; n];
        let mut pose: Vec<Option<String>> = vec![None; n];
        let mut carry: Vec<Option<String>> = vec![None; n];
        for i in 0..n {
            if let Some((si, gi)) = owner[i] {
                wait[i] = recs[si].w;
                end[i] = recs[si].e;
                bend[i] = recs[si].bend;
                route[i] = recs[si].routes.as_ref().map(|r| r[gi].clone());
                step[i] = recs[si].step.clone();
                action[i] = recs[si].action.clone();
                pose[i] = recs[si].pose.clone();
                carry[i] = recs[si].carry.clone();
            }
        }
        let compose = |recs: &Vec<Rec>| -> Vec<Option<P>> {
            (0..n).map(|i| owner[i].map(|(si, gi)| recs[si].assigned[gi])).collect()
        };
        let pos = compose(&recs);
        let pos: Vec<P> = match &prev {
            Some(pv) => pos.iter().enumerate().map(|(i, p)| p.unwrap_or(pv[i])).collect(),
            None => {
                let missing: Vec<&str> =
                    pos.iter().enumerate().filter(|(_, p)| p.is_none()).map(|(i, _)| performers[i].id.as_str()).collect();
                if !missing.is_empty() {
                    return Err(err(
                        sa.pos,
                        format!("最初のセットで位置が決まっていないメンバーがいます: {}", missing.join(", ")),
                    ));
                }
                pos.into_iter().map(|p| p.unwrap()).collect()
            }
        };
        // 他のメンバーの動きを避けるように自動割り当てをやり直す（数回反復）
        let mut pos = pos;
        if let Some(pv) = &prev {
            let cl = a.clearance.unwrap_or(if field.is_football() { 1.0 } else { 0.6 });
            for _ in 0..3 {
                let mut changed = false;
                for si in 0..recs.len() {
                    if !recs[si].auto {
                        continue;
                    }
                    let r = &recs[si];
                    let others: Vec<geom::Mv> = (0..n)
                        .filter(|i| !r.group.contains(i))
                        .map(|i| geom::Mv { a: pv[i], b: pos[i], w: wait[i], e: end[i], bend: bend[i], route: route[i].as_deref() })
                        .collect();
                    let from: Vec<P> = r.group.iter().map(|&i| pv[i]).collect();
                    let order = geom::assign_avoiding(&from, &r.spots, r.w, r.e, r.bend, &others, sa.counts, cl);
                    let assigned: Vec<P> = (0..r.group.len()).map(|gi| r.spots[order[gi]]).collect();
                    if assigned.iter().zip(&r.assigned).any(|(a, b)| geom::dist(*a, *b) > 1e-9) {
                        changed = true;
                    }
                    recs[si].assigned = assigned;
                    recs[si].order = order;
                    for (i, p) in compose(&recs).into_iter().enumerate() {
                        if let Some(p) = p {
                            pos[i] = p;
                        }
                    }
                }
                if !changed {
                    break;
                }
            }
            // グループ内の衝突（同じ線上での追い越しなど）は、2人の行き先を入れ替えて解消を試みる
            for (si, r) in recs.iter().enumerate() {
                if r.auto {
                    let owned: Vec<usize> = r.group.iter().copied().filter(|&i| owner[i].map(|o| o.0) == Some(si)).collect();
                    untangle(&owned, pv, &mut pos, &Timing { wait: &wait, end: &end, bend: &bend, route: &route }, sa.counts, cl);
                }
            }
        }
        let counts = if k == 0 { 0.0 } else { sa.counts };
        if k > 0 && counts == 0.0 {
            if let Some(pv) = &prev {
                if pv.iter().zip(&pos).any(|(a, b)| geom::dist(*a, *b) > 1e-6) {
                    return Err(err(sa.pos, format!("セット{} は counts が0なのに移動があります", set_names[k])));
                }
            }
        }
        // 向き（最終位置が決まってから）
        let ang = |v: P| if v.0.hypot(v.1) < 1e-9 { -90.0 } else { v.1.atan2(v.0).to_degrees() };
        let resolve = |spec: FaceSpec, p: P| -> Option<f64> {
            match spec {
                FaceSpec::Auto => None,
                FaceSpec::Angle(a) => Some(a),
                FaceSpec::Toward(q) | FaceSpec::Center(q) => Some(ang((q.0 - p.0, q.1 - p.1))),
                FaceSpec::Out(q) => Some(ang((p.0 - q.0, p.1 - q.1))),
            }
        };
        let mut face: Vec<Option<f64>> = (0..n).map(|i| owner[i].and_then(|(si, _)| resolve(recs[si].face, pos[i]))).collect();
        let mut touched: Vec<bool> = owner.iter().map(|o| o.is_some()).collect();
        // 位置を変えない指定: 後に書いたものが優先（その人の位置を決めた文より後なら上書き）
        for (si, r) in recs.iter().enumerate() {
            if !r.attr {
                continue;
            }
            let cen = geom::centroid(&r.group.iter().map(|&i| pos[i]).collect::<Vec<_>>());
            for &i in &r.group {
                if owner[i].map(|o| o.0 > si).unwrap_or(false) {
                    continue;
                }
                if !touched[i] {
                    // 位置は前のセットのまま。属性は前のセットから引き継いでから上書き
                    if let Some(ps) = sets.last() {
                        face[i] = ps.face[i];
                        pose[i] = ps.pose[i].clone();
                        carry[i] = ps.carry[i].clone();
                    }
                    touched[i] = true;
                }
                if r.face_given {
                    let spec = match r.face {
                        FaceSpec::Center(_) => FaceSpec::Center(cen),
                        FaceSpec::Out(_) => FaceSpec::Out(cen),
                        f => f,
                    };
                    face[i] = resolve(spec, pos[i]);
                }
                if r.pose.is_some() {
                    pose[i] = r.pose.clone();
                }
                if r.carry.is_some() {
                    carry[i] = r.carry.clone();
                }
                if r.step.is_some() {
                    step[i] = r.step.clone();
                }
                if r.action.is_some() {
                    action[i] = r.action.clone();
                }
            }
        }
        // このセットで触れなかった人は、向きと姿勢を前のセットから引き継ぐ
        for i in 0..n {
            if !touched[i] {
                if let Some(ps) = sets.last() {
                    face[i] = ps.face[i];
                    pose[i] = ps.pose[i].clone();
                    carry[i] = ps.carry[i].clone();
                }
            }
        }
        cur_tempo = sa.tempo.unwrap_or(cur_tempo);
        // エディタ用: 文ごとに、各メンバーがその文の隊形の何番目の席（1始まり。空きを含む）にいるか
        let slots: Vec<Vec<usize>> = recs
            .iter()
            .enumerate()
            .map(|(si, r)| {
                if r.attr {
                    return vec![];
                }
                (0..r.group.len())
                    .map(|gi| {
                        let i = r.group[gi];
                        let mut j = r.order[gi];
                        if owner[i] == Some((si, gi)) {
                            if let Some(q) = r.spots.iter().position(|p| geom::dist(*p, pos[i]) < 1e-9) {
                                j = q;
                            }
                        }
                        r.keep[j] + 1
                    })
                    .collect()
            })
            .collect();
        sets.push(Set {
            name: set_names[k].clone(),
            counts,
            hold: sa.hold,
            start,
            pos,
            wait,
            end,
            bend,
            face,
            route,
            step,
            action,
            pose,
            carry,
            tempo: cur_tempo,
            mark: sa.mark,
            sub: sa.sub,
            line: sa.pos.line,
            slots,
        });
        all_handles.push(set_handles);
        all_members.push(set_members);
        all_owner.push(owner.iter().map(|o| o.map(|x| x.0 as i64).unwrap_or(-1)).collect());
        start += counts + sa.hold;
    }

    // ---- 楽譜パート ----
    let mut parts = vec![];
    let mut part_warnings = vec![];
    for pa in &a.parts {
        let members = resolve_group(&pa.group, &performers, &secs, &ids)?;
        let b = &pa.body;
        let start = match &b.start {
            None => 0.0,
            Some(crate::score::PartStart::Count(v)) => *v,
            Some(crate::score::PartStart::Set(n)) => match sets.iter().find(|s| s.name == *n) {
                Some(s) => s.start,
                None => return Err(Error::at(b.start_pos.0, b.start_pos.1, format!("start set「{}」というセットがありません", n))),
            },
        };
        let pi = parts.len();
        for is in &b.issues {
            part_warnings.push(PartWarn {
                part: pi,
                msg: format!(
                    "パート「{}」の{}小節目が拍子と合いません（{}/{}拍）",
                    pa.name,
                    is.bar,
                    crate::output::num(is.got),
                    crate::output::num(is.want)
                ),
                at: start + is.at,
            });
        }
        parts.push(Part {
            name: pa.name.clone(),
            members,
            meter: b.meter.unwrap_or((4, 4)),
            start,
            end: start + b.len,
            notes: b.notes.iter().map(|n| Note { t: start + n.t, dur: n.dur, hand: n.hand, accent: n.accent, kind: n.kind, pad: n.pad, vel: n.vel }).collect(),
            bars: b.bars.iter().map(|x| start + x).collect(),
        });
    }
    // パートが最後のセットより長ければ、最後のセットのホールドを延ばして全体の長さを合わせる
    if let Some(last) = sets.last_mut() {
        let show_end = last.start + last.counts + last.hold;
        let part_end = parts.iter().map(|p| p.end).fold(0.0, f64::max);
        if part_end > show_end + 1e-6 {
            last.hold += ((part_end - show_end) * 1000.0).ceil() / 1000.0;
        }
    }

    let fb = field.is_football();
    Ok(Show {
        name: a.name.clone(),
        tempo: a.tempo,
        clearance: a.clearance.unwrap_or(if fb { 1.0 } else { 0.6 }),
        maxstep: a.maxstep.unwrap_or(if fb { 6.0 } else { 0.8 }),
        look: a.look.clone().unwrap_or_else(|| "real".into()),
        field,
        sections,
        performers,
        sets,
        handles: all_handles,
        members: all_members,
        owner: all_owner,
        parts,
        part_warnings,
    })
}
