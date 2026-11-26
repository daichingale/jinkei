//! エディタ用: AST を「編集しやすいJSON」にする。式は文字列のまま渡す。
use crate::output::js;
use crate::score::PartStart;
use crate::syntax::{fmt_num, name_tok, Assign, FieldAst, PointE, Shape, ShowAst, Stmt, Xf};

fn strs(v: &[String]) -> String {
    format!("[{}]", v.iter().map(|x| js(x)).collect::<Vec<_>>().join(","))
}
fn opt(v: &Option<String>) -> String {
    v.as_ref().map(|x| js(x)).unwrap_or_else(|| "null".into())
}
fn pt(p: &PointE) -> String {
    format!("[{},{}]", js(&p.0.to_string()), js(&p.1.to_string()))
}
fn oe(e: &Option<crate::syntax::Expr>) -> String {
    e.as_ref().map(|x| js(&x.to_string())).unwrap_or_else(|| "null".into())
}

fn shape(s: &Shape) -> String {
    match s {
        Shape::Line(a, b) => format!("{{\"kind\":\"line\",\"a\":{},\"b\":{}}}", pt(a), pt(b)),
        Shape::Arc { c, r, a1, a2 } => format!(
            "{{\"kind\":\"arc\",\"c\":{},\"r\":{},\"a1\":{},\"a2\":{}}}",
            pt(c),
            js(&r.to_string()),
            js(&a1.to_string()),
            js(&a2.to_string())
        ),
        Shape::Circle { c, r, start } => {
            format!("{{\"kind\":\"circle\",\"c\":{},\"r\":{},\"start\":{}}}", pt(c), js(&r.to_string()), oe(start))
        }
        Shape::Block { c, cols, spacing, rowsp } => format!(
            "{{\"kind\":\"block\",\"c\":{},\"cols\":{},\"spacing\":{},\"rows\":{}}}",
            pt(c),
            js(&cols.to_string()),
            oe(spacing),
            oe(rowsp)
        ),
        Shape::Curve(ps) | Shape::Poly(ps) => format!(
            "{{\"kind\":\"{}\",\"pts\":[{}]}}",
            if matches!(s, Shape::Curve(_)) { "curve" } else { "poly" },
            ps.iter().map(pt).collect::<Vec<_>>().join(",")
        ),
        Shape::At(p) => format!("{{\"kind\":\"at\",\"p\":{}}}", pt(p)),
        Shape::Same => "{\"kind\":\"same\"}".into(),
        Shape::Attr => "{\"kind\":\"attr\"}".into(),
        Shape::Follow { pts, spacing } => format!(
            "{{\"kind\":\"follow\",\"pts\":[{}],\"spacing\":{}}}",
            pts.iter().map(pt).collect::<Vec<_>>().join(","),
            oe(spacing)
        ),
    }
}

fn stmt(st: &Stmt) -> String {
    let group = st.group.iter().map(|g| g.to_string()).collect::<Vec<_>>().join(" + ");
    let xf = st
        .xf
        .iter()
        .map(|x| match x {
            Xf::Rotate(a, about) => format!(
                "{{\"kind\":\"rotate\",\"a\":{},\"about\":{}}}",
                js(&a.to_string()),
                about.as_ref().map(pt).unwrap_or_else(|| "null".into())
            ),
            Xf::Shift(d) => format!("{{\"kind\":\"shift\",\"d\":{}}}", pt(d)),
            Xf::Scale(k) => format!("{{\"kind\":\"scale\",\"k\":{}}}", js(&k.to_string())),
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"group\":{},\"shape\":{},\"xf\":[{}],\"assign\":{},\"skip\":[{}],\"wait\":{},\"within\":{},\"bend\":{},\"face\":{},\"step\":{},\"action\":{},\"pose\":{},\"carry\":{},\"note\":{},\"tail\":{},\"line\":{}}}",
        js(&group),
        shape(&st.shape),
        xf,
        match st.assign {
            Some(Assign::Auto) => "\"auto\"",
            Some(Assign::Keep) => "\"keep\"",
            None => "null",
        },
        st.skip.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","),
        oe(&st.wait),
        oe(&st.within),
        oe(&st.bend),
        st.face.as_ref().map(|f| js(&f.to_string())).unwrap_or_else(|| "null".into()),
        opt(&st.step),
        opt(&st.action),
        opt(&st.pose),
        opt(&st.carry),
        strs(&st.note),
        opt(&st.tail),
        st.pos.line
    )
}

pub fn model_json(a: &ShowAst) -> String {
    let field = match &a.field {
        FieldAst::Football(k) => format!("{{\"type\":\"football\",\"level\":{}}}", js(k)),
        FieldAst::Floor { w, d } => format!("{{\"type\":\"floor\",\"w\":{},\"d\":{}}}", fmt_num(*w), fmt_num(*d)),
        FieldAst::Gym { w, d } => format!("{{\"type\":\"gym\",\"w\":{},\"d\":{}}}", fmt_num(*w), fmt_num(*d)),
        FieldAst::Stage { w, d, wing } => {
            format!("{{\"type\":\"stage\",\"w\":{},\"d\":{},\"wing\":{}}}", fmt_num(*w), fmt_num(*d), fmt_num(*wing))
        }
    };
    let sections = a
        .sections
        .iter()
        .map(|s| {
            format!(
                "{{\"id\":{},\"label\":{},\"n\":{},\"color\":{},\"instrument\":{},\"note\":{},\"tail\":{}}}",
                js(&s.id),
                js(&s.label),
                s.n,
                opt(&s.color),
                opt(&s.instrument),
                strs(&s.note),
                opt(&s.tail)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let sets = a
        .sets
        .iter()
        .map(|s| {
            format!(
                "{{\"name\":{},\"counts\":{},\"hold\":{},\"tempo\":{},\"mark\":{},\"sub\":{},\"note\":{},\"tail\":{},\"foot\":{},\"line\":{},\"stmts\":[{}]}}",
                js(&s.name),
                fmt_num(s.counts),
                fmt_num(s.hold),
                s.tempo.map(|t| js(&fmt_num(t))).unwrap_or_else(|| "null".into()),
                s.mark,
                s.sub,
                strs(&s.note),
                opt(&s.tail),
                strs(&s.foot),
                s.pos.line,
                s.stmts.iter().map(stmt).collect::<Vec<_>>().join(",")
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let parts = a
        .parts
        .iter()
        .map(|p| {
            let b = &p.body;
            format!(
                "{{\"name\":{},\"group\":{},\"meter\":{},\"start\":{},\"src\":{},\"note\":{},\"line\":{}}}",
                js(&p.name),
                js(&p.group.iter().map(|g| g.to_string()).collect::<Vec<_>>().join(" + ")),
                b.meter.map(|(n, d)| js(&format!("{}/{}", n, d))).unwrap_or_else(|| "null".into()),
                match &b.start {
                    None => "null".to_string(),
                    Some(PartStart::Count(v)) => js(&fmt_num(*v)),
                    Some(PartStart::Set(n)) => js(&format!("set {}", name_tok(n))),
                },
                js(&b.src),
                strs(&p.note),
                p.pos.line
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"name\":{},\"header\":{},\"settings_notes\":{},\"foot\":{},\"field\":{},\"field_given\":{},\"tempo\":{},\"clearance\":{},\"maxstep\":{},\"look\":{},\"sections\":[{}],\"sets\":[{}],\"parts\":[{}]}}",
        js(&a.name),
        strs(&a.header),
        strs(&a.settings_notes),
        strs(&a.foot),
        field,
        a.field_given,
        fmt_num(a.tempo),
        a.clearance.map(fmt_num).map(|x| js(&x)).unwrap_or_else(|| "null".into()),
        a.maxstep.map(fmt_num).map(|x| js(&x)).unwrap_or_else(|| "null".into()),
        opt(&a.look),
        sections,
        sets,
        parts
    )
}
