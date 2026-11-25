//! エディタに埋め込むアセットを用意する（イラスト集 src/ui_icons.js が無くても動く）。
use std::{env, fs, path::Path};

fn js_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '"' => o.push_str("\\\""),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            '<' => o.push_str("\\u003c"),
            '\u{2028}' => o.push_str("\\u2028"),
            '\u{2029}' => o.push_str("\\u2029"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn main() {
    let out = env::var("OUT_DIR").expect("OUT_DIR");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/ui_icons.js");
    println!("cargo:rerun-if-changed=examples");
    let icons = fs::read_to_string("src/ui_icons.js").unwrap_or_default();
    fs::write(Path::new(&out).join("ui_icons.js"), icons).expect("write ui_icons.js");

    let mut files: Vec<_> = fs::read_dir("examples")
        .map(|d| d.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map_or(false, |x| x == "jk")).collect())
        .unwrap_or_default();
    files.sort();
    let items: Vec<String> = files
        .iter()
        .filter_map(|p| {
            let name = p.file_name()?.to_string_lossy().to_string();
            let src = fs::read_to_string(p).ok()?;
            Some(format!("{{\"file\":{},\"src\":{}}}", js_str(&name), js_str(&src)))
        })
        .collect();
    fs::write(Path::new(&out).join("examples.js"), format!("window.JK_EXAMPLES=[{}];", items.join(","))).expect("write examples.js");
}
