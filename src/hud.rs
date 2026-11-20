//! 動画・静止画の日本語テロップ（ASS 字幕を作って ffmpeg の subtitles フィルタで焼き込む）
use crate::build::Show;
use crate::render::seconds_at;
use std::sync::OnceLock;

/// ffmpeg に subtitles フィルタ（libass）があるか
pub fn available() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| {
        std::process::Command::new("ffmpeg")
            .args(["-hide_banner", "-filters"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(" subtitles "))
            .unwrap_or(false)
    })
}

/// 字幕ファイル。消えるときに一時ファイルも消す
pub struct AssFile {
    pub path: String,
}

impl AssFile {
    pub fn write(content: &str) -> Result<AssFile, String> {
        let p = std::env::temp_dir().join(format!("jinkei_hud_{}_{}.ass", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0)));
        std::fs::write(&p, content).map_err(|e| format!("字幕ファイルを書けません: {}", e))?;
        Ok(AssFile { path: p.to_string_lossy().into_owned() })
    }
    /// ffmpeg の -vf に渡す文字列（パスの特殊文字をエスケープ）
    pub fn filter(&self) -> String {
        let mut s = String::new();
        for ch in self.path.replace('\\', "/").chars() {
            if matches!(ch, ':' | '\'' | ',' | '[' | ']' | ';') {
                s.push('\\');
            }
            s.push(ch);
        }
        format!("subtitles=filename={}", s)
    }
}

impl Drop for AssFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn clean(s: &str) -> String {
    s.chars().filter(|c| !matches!(c, '{' | '}' | '\\' | '\n' | '\r')).collect()
}

fn ts(sec: f64) -> String {
    let cs = (sec.max(0.0) * 100.0).round() as u64;
    format!("{}:{:02}:{:02}.{:02}", cs / 360000, cs / 6000 % 60, cs / 100 % 60, cs % 100)
}

fn num(x: f64) -> String {
    if (x - x.round()).abs() < 1e-9 {
        format!("{}", x.round() as i64)
    } else {
        format!("{}", x)
    }
}

fn header(w: usize, h: usize) -> String {
    let fs = (h as f64 / 24.0).round().max(10.0) as usize;
    let tfs = (h as f64 / 13.0).round().max(14.0) as usize;
    let m = (h as f64 / 40.0).round().max(6.0) as usize;
    format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n\
[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
Style: Default,Noto Sans CJK JP,{fs},&H003FD2FF,&H000000FF,&H90000000,&H90000000,-1,0,0,0,100,100,0,0,3,{ol},0,1,{m},{m},{m},1\n\
Style: Reel,Noto Sans CJK JP,{rfs},&H00201A18,&H000000FF,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,8,{m},{m},{m},1\n\
Style: Title,Noto Sans CJK JP,{tfs},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{tol},{tol},8,{m},{m},{m},1\n\n\
[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        w = w,
        h = h,
        fs = fs,
        tfs = tfs,
        rfs = (h as f64 / 36.0).round().max(14.0),
        m = m,
        ol = (fs as f64 * 0.25).round().max(3.0),
        tol = (tfs as f64 / 14.0).round().max(2.0),
    )
}

/// ある時刻の1行テロップ（例: セット 3　移動 5/16カウント　♩=120）
pub fn line_at(show: &Show, t: f64) -> String {
    let k = crate::render::set_at(show, t);
    let s = &show.sets[k];
    let into = t - s.start;
    let ph = if k == 0 && s.counts <= 0.0 {
        if s.hold > 0.0 { format!("スタート {}/{}カウント", ((into.floor() as i64) + 1).min(s.hold as i64).max(1), num(s.hold)) } else { "スタート".into() }
    } else if into < s.counts - 1e-9 {
        format!("移動 {}/{}カウント", ((into.floor() as i64) + 1).min(s.counts.ceil() as i64).max(1), num(s.counts))
    } else if s.hold > 0.0 {
        format!("ホールド {}/{}カウント", (((into - s.counts).floor() as i64) + 1).min(s.hold.ceil() as i64).max(1), num(s.hold))
    } else {
        "到着".into()
    };
    clean(&format!("セット {}　{}　♩={}", s.name, ph, num(s.tempo.round())))
}

/// 動画全体の字幕（1カウントごとに1イベント、先頭3秒はショー名のタイトルも出す）
pub fn video_ass(show: &Show, w: usize, h: usize, speed: f64) -> String {
    let mut out = header(w, h);
    out.push_str(&events(show, speed));
    out
}

fn events(show: &Show, speed: f64) -> String {
    let mut out = String::new();
    let at = |t: f64| seconds_at(show, t) / speed;
    let total = show.sets.last().map(|s| s.start + s.counts + s.hold).unwrap_or(0.0);
    let end_all = at(total) + 1.0;
    if !show.name.is_empty() {
        out.push_str(&format!("Dialogue: 1,{},{},Title,,0,0,0,,{}\n", ts(0.0), ts(3.0f64.min(end_all)), clean(&show.name)));
    }
    for (k, s) in show.sets.iter().enumerate() {
        let segs = [(s.start, s.counts, k > 0), (s.start + s.counts, s.hold, true)];
        for (a, len, on) in segs {
            if !on || len <= 1e-9 {
                continue;
            }
            let n = len.ceil() as usize;
            for c in 0..n {
                let t0 = a + c as f64;
                let t1 = (a + c as f64 + 1.0).min(a + len);
                let last = k + 1 == show.sets.len() && c + 1 == n && a + len >= total - 1e-9;
                let e = if last { end_all } else { at(t1) };
                out.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", ts(at(t0)), ts(e), line_at(show, t0 + 1e-6)));
            }
        }
    }
    out
}

/// 静止画用（時刻 t の1行だけ）
pub fn still_ass(show: &Show, t: f64, w: usize, h: usize) -> String {
    let mut out = header(w, h);
    out.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", ts(0.0), ts(10.0), line_at(show, t)));
    out
}

fn reel_title(w: usize, band_y: usize, band_h: usize, title: &str, secs: f64) -> String {
    // 楽譜の帯の上部（約 30%）の中央に、太字のパート名
    format!("Dialogue: 2,{},{},Reel,,0,0,0,,{{\\an5\\pos({},{})}}{}\n", ts(0.0), ts(secs), w / 2, band_y + (band_h as f64 * 0.15).round() as usize, clean(title))
}

/// 楽譜の段の左上に出す楽器名（複数の段を重ねるとき）: (名前, x, y, 文字の大きさ)。x, y は左上の画素位置
fn reel_labels(labels: &[(String, f32, f32, f32)], secs: f64) -> String {
    labels
        .iter()
        .map(|(name, x, y, fs)| format!("Dialogue: 2,{},{},Reel,,0,0,0,,{{\\an7\\pos({:.0},{:.0})\\fs{:.0}}}{}\n", ts(0.0), ts(secs), x, y, fs, clean(name)))
        .collect()
}

/// 縦動画（リール）用の字幕: 楽譜の帯にパート名。hud なら下にカウント表示も
#[allow(clippy::too_many_arguments)]
pub fn reel_ass(show: &Show, w: usize, h: usize, speed: f64, title: &str, labels: &[(String, f32, f32, f32)], band_y: usize, band_h: usize, secs: f64, hud: bool) -> String {
    let mut out = header(w, h);
    out.push_str(&reel_title(w, band_y, band_h, title, secs + 1.0));
    out.push_str(&reel_labels(labels, secs + 1.0));
    if hud {
        out.push_str(&events(show, speed));
    }
    out
}

#[allow(clippy::too_many_arguments)]
pub fn reel_still_ass(show: &Show, w: usize, h: usize, title: &str, labels: &[(String, f32, f32, f32)], band_y: usize, band_h: usize, t: f64, hud: bool) -> String {
    let mut out = header(w, h);
    out.push_str(&reel_title(w, band_y, band_h, title, 10.0));
    out.push_str(&reel_labels(labels, 10.0));
    if hud {
        out.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", ts(0.0), ts(10.0), line_at(show, t)));
    }
    out
}
