//! 衝突の自動修正: 時間差（wait）・早着き（in）・カーブ（bend）を試して、警告が最も減る直し方を探す
use crate::analyze::analyze;
use crate::build::build;
use crate::syntax::{fmt_num, Expr, ShowAst};

#[derive(Debug, Clone)]
pub struct FixResult {
    pub ast: ShowAst,
    pub notes: Vec<String>,
    /// (衝突, その他の警告) 修正前
    pub before: (usize, usize),
    pub after: (usize, usize),
}

fn score(ast: &ShowAst) -> Option<(usize, usize, Vec<usize>)> {
    let show = build(ast).ok()?;
    let r = analyze(&show);
    let mut per_set = vec![0; show.sets.len()];
    let mut coll = 0;
    for w in &r.warnings {
        if w.kind == "衝突" {
            coll += 1;
            per_set[w.set] += 1;
        }
    }
    Some((coll, r.warnings.len() - coll, per_set))
}

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
}

pub fn auto_fix(ast: &ShowAst) -> Option<FixResult> {
    let (c0, o0, _) = score(ast)?;
    let mut cur = ast.clone();
    let (mut cc, mut co, mut per_set) = (c0, o0, score(ast)?.2);
    let mut notes = vec![];
    for k in 1..cur.sets.len() {
        let mut tries = 0;
        while per_set.get(k).copied().unwrap_or(0) > 0 && tries < 4 {
            tries += 1;
            let counts = cur.sets[k].counts;
            let mut best: Option<(usize, usize, f64, usize, Edit, ShowAst, Vec<usize>)> = None;
            for si in 0..cur.sets[k].stmts.len() {
                let st = &cur.sets[k].stmts[si];
                if matches!(st.shape, crate::syntax::Shape::Attr) || (matches!(st.shape, crate::syntax::Shape::Same) && st.xf.is_empty()) {
                    continue; // 動かない文
                }
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
                if st.bend.is_none() && !matches!(st.shape, crate::syntax::Shape::Follow { .. }) {
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
                for e in cands {
                    let mut a = cur.clone();
                    let s = &mut a.sets[k].stmts[si];
                    let cost = match e {
                        Edit::WaitBend(w, b) => {
                            s.wait = Some(Expr::Num(w));
                            s.bend = Some(Expr::Num(b));
                            w + b.abs() / 10.0 + 1.0
                        }
                        Edit::Wait(v) => {
                            s.wait = Some(Expr::Num(v));
                            v
                        }
                        Edit::In(v) => {
                            s.within = Some(Expr::Num(v));
                            (counts - v) * 0.8
                        }
                        Edit::Bend(v) => {
                            s.bend = Some(Expr::Num(v));
                            v.abs() / 10.0
                        }
                    };
                    let Some((c, o, ps)) = score(&a) else { continue };
                    // 衝突1件は他の警告（大股など）10件分として比べる
                    let wsum = |c: usize, o: usize| c * 10 + o;
                    if c >= cc || wsum(c, o) >= wsum(cc, co) {
                        continue;
                    }
                    let better = match &best {
                        None => true,
                        Some(b) => wsum(c, o) < wsum(b.0, b.1) || (wsum(c, o) == wsum(b.0, b.1) && cost < b.2),
                    };
                    if better {
                        best = Some((c, o, cost, si, e, a, ps));
                    }
                }
            }
            let Some((c, o, _, si, e, a, ps)) = best else { break };
            let st = &a.sets[k].stmts[si];
            let group = st.group.iter().map(|g| g.to_string()).collect::<Vec<_>>().join(" + ");
            notes.push(format!(
                "セット{}（{}行目）: 「{}」に `{}` を追加 — {}（このセットの衝突 {}件 → {}件{}）",
                a.sets[k].name,
                st.pos.line,
                group,
                e.text(),
                e.explain(),
                per_set[k],
                ps[k],
                if o > co { format!("、ほかの警告 +{}件", o - co) } else { String::new() }
            ));
            cur = a;
            cc = c;
            co = o;
            per_set = ps;
        }
    }
    Some(FixResult { ast: cur, notes, before: (c0, o0), after: (cc, co) })
}
