//! 衝突の自動修正: 時間差（wait）・早着き（in）・カーブ（bend）を試して、警告が最も減る直し方を探す
//!
//! 候補は「ある文に wait / in / bend を足す」。候補ごとに、変えたセットから先だけを組み立て直して警告を数える
//! （前のセットまでは使い回し。あとのセットは、受け取る状態が元と同じになった所で打ち切る）。
//! さらに「判断AI」（小さな勾配ブースティング木。src/fix_model.json）で候補を直せそうな順に並べ、
//! そのセットの衝突が全部消える候補が見つかった時点で打ち切る。見つからなければ全部試す（総当たりと同じ）。
use crate::analyze::set_counts;
use crate::build::{build, build_set, build_setup, BuildCx, Set, SetOut};
use crate::geom;
use crate::json_mini::{parse as json_parse, J};
use crate::syntax::{fmt_num, Expr, SetAst, Shape, ShowAst, Stmt};
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct FixResult {
    pub ast: ShowAst,
    pub notes: Vec<String>,
    /// (衝突, その他の警告) 修正前
    pub before: (usize, usize),
    pub after: (usize, usize),
    /// 候補を評価した回数（判断AIの効果を測る用）
    pub evals: usize,
    /// 判断AIの並び順で打ち切った回数
    pub early: usize,
    /// 打ち切り版の結果が総当たりより悪かったので総当たりの結果を返した
    pub fallback: bool,
}

// ---------------------------------------------------------------- 判断AI（候補の並べ替え）
const NF: usize = 30;
struct Tree {
    f: Vec<i64>,
    t: Vec<f64>,
    l: Vec<usize>,
    r: Vec<usize>,
    v: Vec<f64>,
}
struct Model {
    base: f64,
    trees: Vec<Tree>,
}
fn model() -> &'static Model {
    static M: OnceLock<Model> = OnceLock::new();
    M.get_or_init(|| {
        let j = json_parse(include_str!("fix_model.json")).expect("fix_model.json");
        let nums = |x: &J| -> Vec<f64> { x.arr().iter().map(|v| v.num()).collect() };
        Model {
            base: j.get("base").map(|b| b.num()).unwrap_or(0.0),
            trees: j
                .get("trees")
                .map(|t| t.arr().to_vec())
                .unwrap_or_default()
                .iter()
                .map(|t| Tree {
                    f: nums(t.get("f").unwrap()).iter().map(|v| *v as i64).collect(),
                    t: nums(t.get("t").unwrap()),
                    l: nums(t.get("l").unwrap()).iter().map(|v| *v as usize).collect(),
                    r: nums(t.get("r").unwrap()).iter().map(|v| *v as usize).collect(),
                    v: nums(t.get("v").unwrap()),
                })
                .collect(),
        }
    })
}
fn model_score(m: &Model, x: &[f64]) -> f64 {
    let mut v = m.base;
    for t in &m.trees {
        let mut i = 0;
        while t.f[i] >= 0 {
            i = if x[t.f[i] as usize] <= t.t[i] { t.l[i] } else { t.r[i] };
        }
        v += t.v[i];
    }
    v
}
/// JavaScript の Math.round(x * 1e6) / 1e6 と同じ丸め（半分は +∞ 側）
fn q6(x: f64) -> f64 {
    (x * 1e6 + 0.5).floor() / 1e6
}

// ---------------------------------------------------------------- 編集の候補
#[derive(Clone, Copy)]
enum Edit {
    WaitBend(f64, f64),
    Wait(f64),
    In(f64),
    Bend(f64),
}

impl Edit {
    fn text(&self) -> String {
        match self {
            Edit::WaitBend(w, b) => format!("wait {} bend {}", fmt_num(*w), fmt_num(*b)),
            Edit::Wait(v) => format!("wait {}", fmt_num(*v)),
            Edit::In(v) => format!("in {}", fmt_num(*v)),
            Edit::Bend(v) => format!("bend {}", fmt_num(*v)),
        }
    }
    fn explain(&self) -> String {
        match self {
            Edit::WaitBend(w, b) => format!("{}カウント待ってから、{}側にふくらむカーブ（{}°）で進む", fmt_num(*w), if *b > 0.0 { "左" } else { "右" }, fmt_num(b.abs())),
            Edit::Wait(v) => format!("{}カウント待ってから出る", fmt_num(*v)),
            Edit::In(v) => format!("{}カウントで先に着く", fmt_num(*v)),
            Edit::Bend(v) => format!("{}側にふくらむカーブ（{}°）で進む", if *v > 0.0 { "左" } else { "右" }, fmt_num(v.abs())),
        }
    }
    fn cost(&self, counts: f64) -> f64 {
        match *self {
            Edit::WaitBend(w, b) => w + b.abs() / 10.0 + 1.0,
            Edit::Wait(v) => v,
            Edit::In(v) => (counts - v) * 0.8,
            Edit::Bend(v) => v.abs() / 10.0,
        }
    }
    fn apply(&self, st: &mut Stmt) {
        match *self {
            Edit::WaitBend(w, b) => {
                st.wait = Some(Expr::Num(w));
                st.bend = Some(Expr::Num(b));
            }
            Edit::Wait(v) => st.wait = Some(Expr::Num(v)),
            Edit::In(v) => st.within = Some(Expr::Num(v)),
            Edit::Bend(v) => st.bend = Some(Expr::Num(v)),
        }
    }
}

fn cands_of(st: &Stmt, counts: f64) -> Vec<Edit> {
    let mut cands = vec![];
    if st.wait.is_none() && st.within.is_none() {
        for w in [1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0] {
            if w <= counts * 0.6 {
                cands.push(Edit::Wait(w));
            }
        }
        for f in [0.5, 0.625, 0.75] {
            let d = (counts * f).round();
            if d >= 2.0 && d < counts {
                cands.push(Edit::In(d));
            }
        }
    }
    if st.bend.is_none() && !matches!(st.shape, Shape::Follow { .. }) {
        for b in [30.0, -30.0, 60.0, -60.0] {
            cands.push(Edit::Bend(b));
            if st.wait.is_none() && st.within.is_none() {
                for w in [2.0, 4.0, 8.0] {
                    if w <= counts * 0.6 {
                        cands.push(Edit::WaitBend(w, b));
                    }
                }
            }
        }
    }
    cands
}

// ---------------------------------------------------------------- 組み立て結果（セットごと）と警告の数
struct State {
    outs: Vec<SetOut>,
    cnt: Vec<(usize, usize)>,
}
impl State {
    fn totals(&self, part_n: usize) -> (usize, usize) {
        (self.cnt.iter().map(|c| c.0).sum(), self.cnt.iter().map(|c| c.1).sum::<usize>() + part_n)
    }
}
struct Env<'a> {
    bx: &'a BuildCx,
    cl: f64,
    maxstep: f64,
}
impl Env<'_> {
    fn counts_of(&self, set: &Set, prev: Option<&Set>) -> (usize, usize) {
        set_counts(&self.bx.field, self.cl, self.maxstep, set, prev)
    }
}
/// 受け取る側（次のセット）の組み立てに影響する中身が同じか
fn same_in(p: &Set, q: &Set) -> bool {
    p.tempo == q.tempo && p.start == q.start && p.counts == q.counts && p.hold == q.hold && p.pos == q.pos && p.face == q.face && p.pose == q.pose && p.carry == q.carry
}
fn build_all(env: &Env, ast: &ShowAst) -> Option<State> {
    let mut outs: Vec<SetOut> = vec![];
    let mut cnt = vec![];
    for k in 0..ast.sets.len() {
        let o = build_set(env.bx, ast, &ast.sets[k], k, outs.last().map(|o| &o.set)).ok()?;
        cnt.push(env.counts_of(&o.set, outs.last().map(|o| &o.set)));
        outs.push(o);
    }
    Some(State { outs, cnt })
}
/// セット k の文を差し替えた候補を、k から先だけ組み立て直す（元と同じ状態になったら打ち切る）
fn eval_cand(env: &Env, ast: &ShowAst, base: &State, k: usize, sa_new: &SetAst) -> Option<(Vec<SetOut>, Vec<(usize, usize)>)> {
    let mut outs: Vec<SetOut> = vec![];
    let mut cnt = vec![];
    for j in k..ast.sets.len() {
        let sa = if j == k { sa_new } else { &ast.sets[j] };
        let prev: &Set = if j == k { &base.outs[k - 1].set } else { &outs[j - k - 1].set };
        let o = build_set(env.bx, ast, sa, j, Some(prev)).ok()?;
        cnt.push(env.counts_of(&o.set, Some(prev)));
        let conv = same_in(&o.set, &base.outs[j].set);
        outs.push(o);
        if conv {
            break;
        }
    }
    Some((outs, cnt))
}

// ---------------------------------------------------------------- 特徴量（src/web/engine.js の fixContext / fixFeatures と同じ式）
struct Cx<'a> {
    set: &'a Set,
    n: usize,
    cl: f64,
    c: f64,
    lim: f64,
    owner: &'a [i64],
    moved: Vec<f64>,
    pairs: Vec<(usize, usize, f64, f64)>,
    stmts: Vec<Vec<usize>>,
    moving_stmts: usize,
}
fn fix_context<'a>(env: &Env, base: &'a State, k: usize, nstmts: usize) -> Cx<'a> {
    let set = &base.outs[k].set;
    let prev = &base.outs[k - 1].set.pos;
    let n = set.pos.len();
    let lim = if env.bx.field.is_football() { 8.0 / env.maxstep } else { env.maxstep };
    let owner: &[i64] = &base.outs[k].owner;
    let moved: Vec<f64> = (0..n)
        .map(|i| match &set.route[i] {
            Some(r) => geom::poly_len(r),
            None => geom::path_len(prev[i], set.pos[i], set.bend[i]),
        })
        .collect();
    let mvs: Vec<geom::Mv> = (0..n).map(|i| geom::Mv { a: prev[i], b: set.pos[i], w: set.wait[i], e: set.end[i], bend: set.bend[i], route: set.route[i].as_deref() }).collect();
    let bbs: Vec<_> = mvs.iter().map(|m| m.bbox()).collect();
    let mut pairs = vec![];
    for (a, b) in geom::near_pairs(&bbs, env.cl) {
        let (d, t) = geom::closest(&mvs[a], &mvs[b], set.counts);
        if d < env.cl {
            pairs.push((a, b, d, t));
        }
    }
    let stmts: Vec<Vec<usize>> = (0..nstmts).map(|si| (0..n).filter(|&i| owner[i] == si as i64).collect()).collect();
    let moving_stmts = stmts.iter().filter(|o| o.iter().any(|&i| moved[i] > 1e-9)).count();
    Cx { set, n, cl: env.cl, c: set.counts, lim, owner, moved, pairs, stmts, moving_stmts }
}
fn bend_factor(b: f64) -> f64 {
    let th = b.abs().min(179.0).to_radians();
    th / (2.0 * (th / 2.0).sin())
}
fn features(cx: &Cx, si: usize, st: &Stmt, e: &Edit, cost: f64) -> [f64; NF] {
    let (c, cl) = (cx.c, cx.cl);
    let own = &cx.stmts[si];
    let mut f = [0.0f64; NF];
    f[match e {
        Edit::Wait(_) => 0,
        Edit::In(_) => 1,
        Edit::Bend(_) => 2,
        Edit::WaitBend(..) => 3,
    }] = 1.0;
    let w = match *e {
        Edit::Wait(v) => v,
        Edit::WaitBend(w, _) => w,
        _ => 0.0,
    };
    let d = if let Edit::In(v) = *e { v } else { c - w };
    let bnd = match *e {
        Edit::Bend(v) => v,
        Edit::WaitBend(_, b) => b,
        _ => 0.0,
    };
    let has_bend = matches!(e, Edit::Bend(_) | Edit::WaitBend(..));
    f[4] = w / c;
    f[5] = if let Edit::In(v) = *e { v / c } else { 0.0 };
    f[6] = bnd.abs() / 60.0;
    f[7] = cost / 12.0;
    f[8] = c.max(1.0).log2() / 5.0;
    f[9] = (1.0 + cx.pairs.len() as f64).ln() / 3.0;
    let (mut n_s, mut n_both, mut n_one) = (0usize, 0usize, 0usize);
    let (mut min_d, mut sum_t, mut min_t, mut partner_mov) = (1.0f64, 0.0f64, 1.0f64, 0.0f64);
    for &(a, b, dd, t) in &cx.pairs {
        let ia = cx.owner[a] == si as i64;
        let ib = cx.owner[b] == si as i64;
        if !ia && !ib {
            continue;
        }
        n_s += 1;
        if ia && ib {
            n_both += 1;
        } else {
            n_one += 1;
            partner_mov += if cx.moved[if ia { b } else { a }] > 1e-9 { 1.0 } else { 0.0 };
        }
        min_d = min_d.min(dd / cl);
        let tt = t / c;
        sum_t += tt;
        min_t = min_t.min(tt);
    }
    let np = cx.pairs.len().max(1) as f64;
    f[10] = n_s as f64 / np;
    f[11] = n_both as f64 / np;
    f[12] = n_one as f64 / np;
    f[13] = min_d;
    f[14] = if n_s > 0 { sum_t / n_s as f64 } else { 0.5 };
    f[15] = if n_s > 0 { min_t } else { 0.5 };
    f[16] = own.len() as f64 / cx.n as f64;
    f[17] = (1.0 + own.len() as f64).ln() / 5.0;
    f[18] = cx.moving_stmts as f64 / 8.0;
    let (mut r0, mut r1, mut mv) = (0.0f64, 0.0f64, 0.0f64);
    for &i in own {
        let dur = cx.set.end[i] - cx.set.wait[i];
        r0 = r0.max(if dur > 0.0 { cx.moved[i] / dur / cx.lim } else { 0.0 });
        let m1 = cx.moved[i] * if has_bend { bend_factor(bnd) } else { 1.0 };
        r1 = r1.max(if d > 0.0 { m1 / d / cx.lim } else { 0.0 });
        mv += cx.moved[i];
    }
    f[19] = r0.min(4.0) / 2.0;
    f[20] = r1.min(4.0) / 2.0;
    f[21] = if r1 > 1.0 { 1.0 } else { 0.0 };
    f[match st.shape {
        Shape::Same => 22,
        Shape::Line(..) => 23,
        Shape::Arc { .. } | Shape::Circle { .. } => 24,
        Shape::Block { .. } => 25,
        _ => 26,
    }] = 1.0;
    f[27] = (if own.is_empty() { 0.0 } else { mv / own.len() as f64 / cl }).min(60.0) / 30.0;
    f[28] = if n_one > 0 { partner_mov / n_one as f64 } else { 0.0 };
    let tm = match *e {
        Edit::Wait(_) | Edit::WaitBend(..) => w,
        Edit::In(v) => v,
        _ => 0.0,
    };
    f[29] = if n_s > 0 { tm / c - sum_t / n_s as f64 } else { 0.0 };
    for v in f.iter_mut() {
        *v = q6(*v);
    }
    f
}

// ---------------------------------------------------------------- 探索
struct Cand {
    si: usize,
    e: Edit,
    cost: f64,
    idx: usize,
    sc: f64,
}
fn wsum(c: usize, o: usize) -> i64 {
    c as i64 * 10 + o as i64
}

fn run(ast: &ShowAst, guided: bool) -> Option<FixResult> {
    let bx = build_setup(ast).ok()?;
    let fb = bx.field.is_football();
    let env = Env { bx: &bx, cl: ast.clearance.unwrap_or(if fb { 1.0 } else { 0.6 }), maxstep: ast.maxstep.unwrap_or(if fb { 6.0 } else { 0.8 }) };
    let full = build(ast).ok()?;
    let part_n = full.part_warnings.len();
    let mut st = build_all(&env, ast)?;
    let (c0, o0) = st.totals(part_n);
    let mut cur = ast.clone();
    let (mut cc, mut co) = (c0, o0);
    let mut notes = vec![];
    let (mut evals, mut early) = (0usize, 0usize);
    let nsets = cur.sets.len();
    for k in 1..nsets {
        let mut tries = 0;
        while st.cnt[k].0 > 0 && tries < 4 {
            tries += 1;
            let counts = cur.sets[k].counts;
            let per_k = st.cnt[k].0;
            let cx = fix_context(&env, &st, k, cur.sets[k].stmts.len());
            let mut all: Vec<Cand> = vec![];
            for si in 0..cur.sets[k].stmts.len() {
                let s = &cur.sets[k].stmts[si];
                if matches!(s.shape, Shape::Attr) || (matches!(s.shape, Shape::Same) && s.xf.is_empty()) {
                    continue; // 動かない文
                }
                for e in cands_of(s, counts) {
                    let idx = all.len();
                    all.push(Cand { si, e, cost: e.cost(counts), idx, sc: 0.0 });
                }
            }
            let mut order: Vec<usize> = (0..all.len()).collect();
            if guided && !all.is_empty() && !model().trees.is_empty() {
                let m = model();
                for cd in all.iter_mut() {
                    cd.sc = model_score(m, &features(&cx, cd.si, &cur.sets[k].stmts[cd.si], &cd.e, cd.cost));
                }
                order.sort_by(|&p, &q| all[q].sc.partial_cmp(&all[p].sc).unwrap_or(std::cmp::Ordering::Equal).then(p.cmp(&q)));
            }
            let floor = wsum(cc - per_k, co);
            // best = (c, o, cost, idx, si, edit, 差し替えたセットの AST, 組み立て結果, 件数)
            let mut best: Option<(usize, usize, f64, usize, usize, Edit, SetAst, Vec<SetOut>, Vec<(usize, usize)>)> = None;
            let mut tried = 0;
            for &ci in &order {
                let cd = &all[ci];
                let mut sa = cur.sets[k].clone();
                cd.e.apply(&mut sa.stmts[cd.si]);
                tried += 1;
                let Some((outs, cnt)) = eval_cand(&env, &cur, &st, k, &sa) else { continue };
                let j = k + outs.len();
                let c: usize = st.cnt.iter().map(|x| x.0).sum::<usize>() - st.cnt[k..j].iter().map(|x| x.0).sum::<usize>() + cnt.iter().map(|x| x.0).sum::<usize>();
                let o: usize = st.cnt.iter().map(|x| x.1).sum::<usize>() + part_n - st.cnt[k..j].iter().map(|x| x.1).sum::<usize>() + cnt.iter().map(|x| x.1).sum::<usize>();
                if c >= cc || wsum(c, o) >= wsum(cc, co) {
                    continue;
                }
                let better = match &best {
                    None => true,
                    Some(b) => wsum(c, o) < wsum(b.0, b.1) || (wsum(c, o) == wsum(b.0, b.1) && (cd.cost < b.2 || (cd.cost == b.2 && cd.idx < b.3))),
                };
                if better {
                    best = Some((c, o, cd.cost, cd.idx, cd.si, cd.e, sa, outs, cnt));
                }
                if guided && wsum(c, o) <= floor {
                    break;
                }
            }
            evals += tried;
            if guided && best.is_some() && tried < order.len() {
                early += 1;
            }
            let Some((c, o, _, _, si, e, sa, outs, cnt)) = best else { break };
            let s = &sa.stmts[si];
            let group = s.group.iter().map(|g| g.to_string()).collect::<Vec<_>>().join(" + ");
            let j = k + outs.len();
            let new_k = cnt[0].0;
            notes.push(format!(
                "セット{}（{}行目）: 「{}」に `{}` を追加 — {}（このセットの衝突 {}件 → {}件{}）",
                crate::syntax::set_display_names(&cur.sets)[k],
                s.pos.line,
                group,
                e.text(),
                e.explain(),
                per_k,
                new_k,
                if o > co { format!("、ほかの警告 +{}件", o - co) } else { String::new() }
            ));
            cur.sets[k] = sa;
            for (q, (out, cn)) in outs.into_iter().zip(cnt.into_iter()).enumerate() {
                st.outs[k + q] = out;
                st.cnt[k + q] = cn;
            }
            let _ = j;
            cc = c;
            co = o;
        }
    }
    Some(FixResult { ast: cur, notes, before: (c0, o0), after: (cc, co), evals, early, fallback: false })
}

/// 自動修正。既定は判断AIで並べて早く終わる版。打ち切りで衝突が残った／ほかの警告が増えたときは、総当たりもやって良いほうを返す
pub fn auto_fix(ast: &ShowAst) -> Option<FixResult> {
    if model().trees.is_empty() {
        return run(ast, false);
    }
    let g = run(ast, true)?;
    if g.early > 0 && (g.after.0 > 0 || g.after.1 > g.before.1) {
        if let Some(mut x) = run(ast, false) {
            if wsum(x.after.0, x.after.1) < wsum(g.after.0, g.after.1) {
                x.fallback = true;
                x.evals += g.evals;
                return Some(x);
            }
            // 結果は同じだった（確認のための総当たりで使った評価数も数える）
            let mut g = g;
            g.evals += x.evals;
            return Some(g);
        }
    }
    Some(g)
}

/// 総当たり（従来どおり。判断AIを使わない）
pub fn auto_fix_exhaustive(ast: &ShowAst) -> Option<FixResult> {
    run(ast, false)
}
