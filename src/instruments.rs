//! 楽器の種類。セクションごとにエンジンが1回だけ決め、3D（ブラウザ・動画）はこの結果を使う。

/// (ID, 日本語名)
pub const INSTRUMENTS: &[(&str, &str)] = &[
    ("trumpet", "トランペット"),
    ("mellophone", "メロフォン"),
    ("marching_horn", "マーチングホルン"),
    ("horn", "ホルン"),
    ("trombone", "トロンボーン"),
    ("euphonium", "ユーフォニアム"),
    ("marching_euphonium", "マーチングユーフォニアム"),
    ("tuba", "チューバ"),
    ("marching_tuba", "マーチングチューバ"),
    ("sousaphone", "スーザフォン"),
    ("piccolo", "ピッコロ"),
    ("flute", "フルート"),
    ("oboe", "オーボエ"),
    ("bassoon", "ファゴット"),
    ("eb_clarinet", "E♭クラリネット"),
    ("clarinet", "クラリネット"),
    ("alto_clarinet", "アルトクラリネット"),
    ("bass_clarinet", "バスクラリネット"),
    ("soprano_sax", "ソプラノサックス"),
    ("alto_sax", "アルトサックス"),
    ("tenor_sax", "テナーサックス"),
    ("baritone_sax", "バリトンサックス"),
    ("snare", "スネアドラム"),
    ("tenors", "テナードラム"),
    ("bass_drum", "バスドラム（メンバー順に小→大）"),
    ("bass1", "バスドラム1（最小）"),
    ("bass2", "バスドラム2"),
    ("bass3", "バスドラム3"),
    ("bass4", "バスドラム4"),
    ("bass5", "バスドラム5（最大）"),
    ("cymbals_mid", "シンバル（ミドルポジション）"),
    ("cymbals_high", "シンバル（ハイポジション）"),
    ("glockenspiel", "グロッケン"),
    ("xylophone", "シロフォン"),
    ("flag", "カラーガード（フラッグ）"),
    ("none", "楽器なし"),
];

pub fn is_id(s: &str) -> bool {
    INSTRUMENTS.iter().any(|(id, _)| *id == s)
}

/// セクションの表示名と記号から楽器を推定する（上から順に最初に当てはまったもの）
pub fn detect(label: &str, id: &str) -> &'static str {
    let l = label.to_lowercase();
    let has = |ws: &[&str]| ws.iter().any(|w| l.contains(w));
    let sax = has(&["サックス", "サクソフォン", "sax"]);
    if has(&["ガード", "guard", "フラッグ", "flag"]) {
        return "flag";
    }
    if has(&["バスドラ", "bass drum", "bassdrum"]) {
        for (d, idd) in [("1", "bass1"), ("2", "bass2"), ("3", "bass3"), ("4", "bass4"), ("5", "bass5")] {
            if l.ends_with(d) {
                return idd;
            }
        }
        return "bass_drum";
    }
    if has(&["テナードラム", "クイント", "クワッド", "quad", "quint", "tenor drum"]) || (has(&["テナー", "tenor"]) && !sax) {
        return "tenors";
    }
    if has(&["スネア", "snare"]) {
        return "snare";
    }
    if has(&["シンバル", "cymbal"]) {
        return if has(&["ハイ", "high"]) { "cymbals_high" } else { "cymbals_mid" };
    }
    if has(&["グロッケン", "ベルリラ", "glock", "lyre", "鉄琴"]) {
        return "glockenspiel";
    }
    if has(&["シロフォン", "木琴", "xylo", "マリンバ", "marimba"]) {
        return "xylophone";
    }
    if has(&["スーザ", "sousa"]) {
        return "sousaphone";
    }
    if has(&["マーチングチューバ", "marching tuba", "低音"]) {
        return "marching_tuba";
    }
    if has(&["チューバ", "テューバ", "tuba"]) {
        return "tuba";
    }
    if has(&["マーチングユーフォ", "マーチングバリトン", "marching euph", "marching baritone"]) {
        return "marching_euphonium";
    }
    if has(&["ユーフォ", "euph"]) || (has(&["バリトン", "baritone"]) && !sax) {
        return "euphonium";
    }
    if has(&["マーチングホルン", "marching horn"]) {
        return "marching_horn";
    }
    if has(&["メロフォン", "mello"]) {
        return "mellophone";
    }
    if has(&["ホルン", "horn"]) {
        return "horn";
    }
    if has(&["トロンボーン", "trombone"]) {
        return "trombone";
    }
    if has(&["トランペット", "コルネット", "フリューゲル", "trumpet", "cornet", "flugel"]) {
        return "trumpet";
    }
    if has(&["ピッコロ", "piccolo"]) {
        return "piccolo";
    }
    if has(&["フルート", "flute"]) {
        return "flute";
    }
    if has(&["オーボエ", "oboe"]) {
        return "oboe";
    }
    if has(&["ファゴット", "バスーン", "bassoon", "fagott"]) {
        return "bassoon";
    }
    if sax {
        return if has(&["ソプラノ", "soprano"]) {
            "soprano_sax"
        } else if has(&["テナー", "tenor"]) {
            "tenor_sax"
        } else if has(&["バリトン", "バリサク", "baritone", "bari"]) {
            "baritone_sax"
        } else {
            "alto_sax"
        };
    }
    if has(&["クラ", "clarinet"]) {
        return if has(&["エスクラ", "esクラ", "e♭", "eb", "es "]) {
            "eb_clarinet"
        } else if has(&["バスクラ", "bass clar"]) {
            "bass_clarinet"
        } else if has(&["アルトクラ", "alto clar"]) {
            "alto_clarinet"
        } else {
            "clarinet"
        };
    }
    if has(&["打楽器", "パーカッション", "バッテリー", "ドラム", "perc", "drum", "battery"]) {
        return "snare";
    }
    if has(&["木管", "woodwind"]) {
        return "clarinet";
    }
    if has(&["金管", "brass"]) {
        return "trumpet";
    }
    // 記号だけで判断（完全一致）
    match id.to_lowercase().as_str() {
        "tp" | "tpt" => "trumpet",
        "mel" | "mello" => "mellophone",
        "hn" | "hr" => "horn",
        "tb" | "tbn" => "trombone",
        "eu" | "euph" | "bar" => "euphonium",
        "tu" | "tuba" => "tuba",
        "sou" | "sz" => "sousaphone",
        "fl" => "flute",
        "pic" => "piccolo",
        "ob" => "oboe",
        "fg" | "bsn" => "bassoon",
        "cl" => "clarinet",
        "bcl" => "bass_clarinet",
        "sx" | "as" => "alto_sax",
        "ts" => "tenor_sax",
        "bs" => "baritone_sax",
        "sn" | "sd" => "snare",
        "td" | "qd" => "tenors",
        "bd" => "bass_drum",
        "cy" | "cym" => "cymbals_mid",
        "gl" | "glk" => "glockenspiel",
        "xy" | "xyl" => "xylophone",
        "cg" | "gd" => "flag",
        "pc" | "perc" => "snare",
        "ww" => "clarinet",
        _ => "none",
    }
}
