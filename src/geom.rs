//! 隊形図形 → 座標、変形、自動割り当て（ハンガリアン法）

pub type P = (f64, f64);

pub fn line(a: P, b: P, n: usize) -> Vec<P> {
    if n == 1 {
        return vec![((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0)];
    }
    (0..n)
        .map(|i| {
            let t = i as f64 / (n - 1) as f64;
            (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
        })
        .collect()
}

/// 角度は度。0°=+x（サイド2方向）、90°=+y（奥）、反時計回り
pub fn arc(c: P, r: f64, a1: f64, a2: f64, n: usize) -> Vec<P> {
    (0..n)
        .map(|i| {
            let t = if n == 1 { 0.5 } else { i as f64 / (n - 1) as f64 };
            let a = (a1 + (a2 - a1) * t).to_radians();
            (c.0 + r * a.cos(), c.1 + r * a.sin())
        })
        .collect()
}

pub fn circle(c: P, r: f64, start: f64, n: usize) -> Vec<P> {
    (0..n)
        .map(|i| {
            let a = (start + 360.0 * i as f64 / n as f64).to_radians();
            (c.0 + r * a.cos(), c.1 + r * a.sin())
        })
        .collect()
}

/// 前列（客席側）の左から順に詰める。端数の列は中央寄せ
pub fn block(c: P, cols: usize, sp: f64, rsp: f64, n: usize) -> Vec<P> {
    let cols = cols.max(1);
    let rows = n.div_ceil(cols);
    let mut v = Vec::with_capacity(n);
    for k in 0..rows {
        let cnt = cols.min(n - k * cols);
        let y = c.1 + (k as f64 - (rows - 1) as f64 / 2.0) * rsp;
        for j in 0..cnt {
            let x = c.0 + (j as f64 - (cnt - 1) as f64 / 2.0) * sp;
            v.push((x, y));
        }
    }
    v
}

/// 折れ線上に等間隔で n 点（両端を含む）
pub fn resample(pts: &[P], n: usize) -> Vec<P> {
    if pts.len() == 1 {
        return vec![pts[0]; n];
    }
    let mut cum = vec![0.0];
    for w in pts.windows(2) {
        let d = ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt();
        cum.push(cum.last().unwrap() + d);
    }
    let total = *cum.last().unwrap();
    (0..n)
        .map(|i| {
            let target = if n == 1 { total / 2.0 } else { total * i as f64 / (n - 1) as f64 };
            let mut j = cum.partition_point(|&c| c < target).max(1).min(pts.len() - 1);
            while j > 1 && cum[j - 1] > target {
                j -= 1;
            }
            let seg = cum[j] - cum[j - 1];
            let t = if seg > 0.0 { (target - cum[j - 1]) / seg } else { 0.0 };
            let (a, b) = (pts[j - 1], pts[j]);
            (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
        })
        .collect()
}

/// 通過点を滑らかに結ぶ曲線（Catmull-Rom）上に等間隔で n 点
pub fn curve(pts: &[P], n: usize) -> Vec<P> {
    if pts.len() < 3 {
        return resample(pts, n);
    }
    let m = pts.len();
    let g = |i: isize| -> P {
        if i < 0 {
            (2.0 * pts[0].0 - pts[1].0, 2.0 * pts[0].1 - pts[1].1)
        } else if i as usize >= m {
            (2.0 * pts[m - 1].0 - pts[m - 2].0, 2.0 * pts[m - 1].1 - pts[m - 2].1)
        } else {
            pts[i as usize]
        }
    };
    let mut dense = vec![];
    const K: usize = 200;
    for s in 0..m - 1 {
        let (p0, p1, p2, p3) = (g(s as isize - 1), g(s as isize), g(s as isize + 1), g(s as isize + 2));
        for k in 0..K {
            let t = k as f64 / K as f64;
            let (t2, t3) = (t * t, t * t * t);
            let f = |a: f64, b: f64, c: f64, d: f64| {
                0.5 * (2.0 * b + (-a + c) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (-a + 3.0 * b - 3.0 * c + d) * t3)
            };
            dense.push((f(p0.0, p1.0, p2.0, p3.0), f(p0.1, p1.1, p2.1, p3.1)));
        }
    }
    dense.push(pts[m - 1]);
    resample(&dense, n)
}

pub fn centroid(v: &[P]) -> P {
    let n = v.len().max(1) as f64;
    (v.iter().map(|p| p.0).sum::<f64>() / n, v.iter().map(|p| p.1).sum::<f64>() / n)
}

pub fn rotate(v: &mut [P], deg: f64, about: P) {
    let (s, c) = deg.to_radians().sin_cos();
    for p in v.iter_mut() {
        let (dx, dy) = (p.0 - about.0, p.1 - about.1);
        *p = (about.0 + dx * c - dy * s, about.1 + dx * s + dy * c);
    }
}

pub fn dist(a: P, b: P) -> f64 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

/// 最小コスト完全マッチング（n×n）。戻り値 r[i] = 行 i に割り当てた列
pub fn hungarian(cost: &[Vec<f64>]) -> Vec<usize> {
    let n = cost.len();
    let inf = f64::INFINITY;
    let mut u = vec![0.0; n + 1];
    let mut v = vec![0.0; n + 1];
    let mut p = vec![0usize; n + 1];
    let mut way = vec![0usize; n + 1];
    for i in 1..=n {
        p[0] = i;
        let mut j0 = 0usize;
        let mut minv = vec![inf; n + 1];
        let mut used = vec![false; n + 1];
        loop {
            used[j0] = true;
            let i0 = p[j0];
            let mut delta = inf;
            let mut j1 = 0;
            for j in 1..=n {
                if !used[j] {
                    let cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if cur < minv[j] {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if minv[j] < delta {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }
            for j in 0..=n {
                if used[j] {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
            if p[j0] == 0 {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }
    let mut ans = vec![0; n];
    for j in 1..=n {
        if p[j] != 0 {
            ans[p[j] - 1] = j - 1;
        }
    }
    ans
}

/// 移動距離の合計が最小になる割り当て（直線経路が交差しない）。
/// 同点のときは移動の大きい人が出ないほうを選ぶ。
pub fn assign(from: &[P], to: &[P]) -> Vec<usize> {
    let cost: Vec<Vec<f64>> = from
        .iter()
        .map(|a| {
            to.iter()
                .map(|b| {
                    let d = dist(*a, *b);
                    d + 1e-6 * d * d
                })
                .collect()
        })
        .collect();
    hungarian(&cost)
}

/// 1人分の動き: 区間 [w, e]（セット内のカウント）で a → b へ。bend ≠ 0 なら円弧の経路
/// bend（度）: 正 = 進行方向の左側にふくらむ、負 = 右側にふくらむ
#[derive(Clone, Copy, Debug)]
pub struct Mv<'a> {
    pub a: P,
    pub b: P,
    pub w: f64,
    pub e: f64,
    pub bend: f64,
    /// 折れ線の経路（フォロー・ザ・リーダーなど）。始点 a・終点 b を含む。あれば bend より優先
    pub route: Option<&'a [P]>,
}

/// 折れ線の長さ
pub fn poly_len(r: &[P]) -> f64 {
    r.windows(2).map(|w| dist(w[0], w[1])).sum()
}

/// 折れ線上を割合 u（0〜1、長さ基準）だけ進んだ位置
pub fn poly_at(r: &[P], u: f64) -> P {
    let total = poly_len(r);
    if r.len() < 2 || total < 1e-12 {
        return *r.last().unwrap_or(&(0.0, 0.0));
    }
    let mut left = total * u.clamp(0.0, 1.0);
    for w in r.windows(2) {
        let d = dist(w[0], w[1]);
        if left <= d {
            let t = if d > 0.0 { left / d } else { 0.0 };
            return (w[0].0 + (w[1].0 - w[0].0) * t, w[0].1 + (w[1].1 - w[0].1) * t);
        }
        left -= d;
    }
    *r.last().unwrap()
}

/// 折れ線を始点から長さ len の所で切る
pub fn poly_cut(r: &[P], len: f64) -> Vec<P> {
    let mut out = vec![r[0]];
    let mut left = len.max(0.0);
    for w in r.windows(2) {
        let d = dist(w[0], w[1]);
        if left <= d {
            let t = if d > 0.0 { left / d } else { 0.0 };
            out.push((w[0].0 + (w[1].0 - w[0].0) * t, w[0].1 + (w[1].1 - w[0].1) * t));
            return out;
        }
        out.push(w[1]);
        left -= d;
    }
    out
}

/// a→b を曲がり角 bend 度の円弧でたどったときの、割合 u（0〜1）の位置
pub fn arc_point(a: P, b: P, bend: f64, u: f64) -> P {
    let d = (b.0 - a.0, b.1 - a.1);
    let l = (d.0 * d.0 + d.1 * d.1).sqrt();
    if bend.abs() < 1e-6 || l < 1e-9 {
        return (a.0 + d.0 * u, a.1 + d.1 * u);
    }
    let th = bend.abs().min(179.0).to_radians();
    let s = -bend.signum(); // 左にふくらむ = 時計回りに曲がる
    let dh = (d.0 / l, d.1 / l);
    let rot = |v: P, ang: f64| (v.0 * ang.cos() - v.1 * ang.sin(), v.0 * ang.sin() + v.1 * ang.cos());
    let t0 = rot(dh, -s * th / 2.0);
    let n0 = rot(t0, s * std::f64::consts::FRAC_PI_2);
    let r = l / (2.0 * (th / 2.0).sin());
    let ph = th * u;
    (a.0 + r * (ph.sin() * t0.0 + (1.0 - ph.cos()) * n0.0), a.1 + r * (ph.sin() * t0.1 + (1.0 - ph.cos()) * n0.1))
}

/// 円弧経路の長さ
pub fn path_len(a: P, b: P, bend: f64) -> f64 {
    let l = dist(a, b);
    if bend.abs() < 1e-6 {
        return l;
    }
    let th = bend.abs().min(179.0).to_radians();
    l * th / (2.0 * (th / 2.0).sin())
}

impl<'a> Mv<'a> {
    pub fn lin(a: P, b: P, w: f64, e: f64) -> Mv<'a> {
        Mv { a, b, w, e, bend: 0.0, route: None }
    }
    /// 経路の長さ
    pub fn length(&self) -> f64 {
        match self.route {
            Some(r) => poly_len(r),
            None => path_len(self.a, self.b, self.bend),
        }
    }
    /// 経路の外接矩形 (minx, maxx, miny, maxy)
    pub fn bbox(&self) -> (f64, f64, f64, f64) {
        if let Some(r) = self.route {
            let xs = r.iter().map(|p| p.0);
            let ys = r.iter().map(|p| p.1);
            return (xs.clone().fold(f64::MAX, f64::min), xs.fold(f64::MIN, f64::max), ys.clone().fold(f64::MAX, f64::min), ys.fold(f64::MIN, f64::max));
        }
        let pad = if self.bend.abs() >= 1e-6 { dist(self.a, self.b) * 0.5 * (self.bend.abs().min(179.0).to_radians() / 2.0).tan().abs().min(50.0) } else { 0.0 };
        (self.a.0.min(self.b.0) - pad, self.a.0.max(self.b.0) + pad, self.a.1.min(self.b.1) - pad, self.a.1.max(self.b.1) + pad)
    }
    pub fn u(&self, t: f64) -> f64 {
        if self.e - self.w <= 0.0 {
            1.0
        } else {
            ((t - self.w) / (self.e - self.w)).clamp(0.0, 1.0)
        }
    }
    pub fn at(&self, t: f64) -> P {
        match self.route {
            Some(r) => poly_at(r, self.u(t)),
            None => arc_point(self.a, self.b, self.bend, self.u(t)),
        }
    }
    pub fn curved(&self) -> bool {
        self.route.is_none() && self.bend.abs() >= 1e-6 && dist(self.a, self.b) > 1e-9
    }
    /// 折れ線近似の区切り時刻（曲線は16分割）
    fn times(&self, out: &mut Vec<f64>) {
        out.push(self.w);
        out.push(self.e);
        if let Some(r) = self.route {
            // 折れ線の頂点を通過する時刻
            let total = poly_len(r);
            if total > 1e-12 {
                let mut acc = 0.0;
                for w in r.windows(2) {
                    acc += dist(w[0], w[1]);
                    out.push(self.w + (self.e - self.w) * acc / total);
                }
            }
        } else if self.curved() {
            for j in 1..16 {
                out.push(self.w + (self.e - self.w) * j as f64 / 16.0);
            }
        }
    }
}

/// 区間 [w, e] だけ a0→a1 へ等速で動く点の、時刻 t での位置
#[inline]
pub fn moving(a0: P, a1: P, w: f64, e: f64, t: f64) -> P {
    Mv::lin(a0, a1, w, e).at(t)
}

/// 2人の動きの最接近距離と時刻（0..c）。直線は厳密、曲線は16分割の折れ線で計算
pub fn closest(a: &Mv<'_>, b: &Mv<'_>, c: f64) -> (f64, f64) {
    let mut cuts = vec![0.0, c.max(0.0)];
    a.times(&mut cuts);
    b.times(&mut cuts);
    cuts.retain(|t| *t >= 0.0 && *t <= c.max(0.0));
    cuts.sort_by(|x, y| x.partial_cmp(y).unwrap());
    cuts.dedup_by(|x, y| (*x - *y).abs() < 1e-12);
    // 区間内で一次式になるよう、曲線の位置は区切り点どうしを直線で結んだ値を使う
    let (mut best, mut best_t) = (f64::MAX, c);
    if cuts.len() == 1 {
        let (pa, pb) = (a.at(cuts[0]), b.at(cuts[0]));
        return (dist(pa, pb), cuts[0]);
    }
    for w in cuts.windows(2) {
        let (t0, t1) = (w[0], w[1]);
        let (pa0, pb0, pa1, pb1) = (a.at(t0), b.at(t0), a.at(t1), b.at(t1));
        let d0 = (pa0.0 - pb0.0, pa0.1 - pb0.1);
        let d1 = (pa1.0 - pb1.0, pa1.1 - pb1.1);
        let dv = (d1.0 - d0.0, d1.1 - d0.1);
        let vv = dv.0 * dv.0 + dv.1 * dv.1;
        let u = if vv < 1e-12 { 1.0 } else { (-(d0.0 * dv.0 + d0.1 * dv.1) / vv).clamp(0.0, 1.0) };
        let d = ((d0.0 + dv.0 * u).powi(2) + (d0.1 + dv.1 * u).powi(2)).sqrt();
        if d < best - 1e-12 {
            best = d;
            best_t = t0 + (t1 - t0) * u;
        }
    }
    (best, best_t)
}

/// 他のメンバーの動きとぶつかる経路にペナルティを付けた割り当て
pub fn assign_avoiding(from: &[P], to: &[P], w: f64, e: f64, bend: f64, others: &[Mv<'_>], c: f64, clearance: f64) -> Vec<usize> {
    let cost: Vec<Vec<f64>> = from
        .iter()
        .map(|a| {
            to.iter()
                .map(|b| {
                    let d = dist(*a, *b);
                    let mut cost = d + 1e-6 * d * d;
                    let me = Mv { a: *a, b: *b, w, e, bend, route: None };
                    // 経路の外接矩形で粗く絞り込んでから厳密判定
                    let (minx, maxx, miny, maxy) = me.bbox();
                    let (minx, maxx, miny, maxy) = (minx - clearance, maxx + clearance, miny - clearance, maxy + clearance);
                    for o in others {
                        let (ominx, omaxx, ominy, omaxy) = o.bbox();
                        if omaxx < minx || ominx > maxx || omaxy < miny || ominy > maxy {
                            continue;
                        }
                        let (dd, _) = closest(&me, o, c);
                        if dd < clearance {
                            cost += 1000.0 * (1.0 + clearance - dd);
                        }
                    }
                    cost
                })
                .collect()
        })
        .collect();
    hungarian(&cost)
}
