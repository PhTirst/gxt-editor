use serde::{Deserialize, Serialize};

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

const MAGIC_TKEY: &[u8; 4] = b"TKEY";
const MAGIC_TDAT: &[u8; 4] = b"TDAT";

// 你的“特殊区间”
const SPECIAL_MIN: u16 = 0x0080;
const SPECIAL_MAX: u16 = 0x009F;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GxtEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GxtDocument {
    /// None 表示“新文件/未保存过”
    pub file_path: Option<String>,
    pub entries: Vec<GxtEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    pub file_path: Option<String>,
}

/// 只负责按路径加载（前端 open dialog 选完路径后调用；文件关联/命令行启动也调用它）
#[tauri::command]
pub async fn gxt_load(path: String) -> Result<GxtDocument, String> {
    let path_buf = PathBuf::from(&path);

    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(&path_buf))
        .await
        .map_err(|e| format!("Join error: {e}"))?
        .map_err(|e| format!("Read file failed: {e}"))?;

    let entries = parse_gxt_bytes(&bytes)?;
    Ok(GxtDocument {
        file_path: Some(path),
        entries,
    })
}

/// 保存：写入 doc.file_path 指定的路径（Ctrl+S / SaveAs 都走这一个）
/// - Ctrl+S：前端会传当前 file_path
/// - SaveAs：前端会先弹 save dialog，然后把选中的路径写进 doc.file_path 再调用本函数
#[tauri::command]
pub async fn gxt_save(doc: GxtDocument) -> Result<SaveResult, String> {
    validate_entries(&doc.entries)?;

    let path = doc
        .file_path
        .clone()
        .ok_or_else(|| "No file_path in doc. Use Save As to choose a path first.".to_string())?;

    let bytes = build_gxt_bytes(&doc.entries)?;
    let path_buf = PathBuf::from(&path);

    tauri::async_runtime::spawn_blocking(move || fs::write(path_buf, bytes))
        .await
        .map_err(|e| format!("Join error: {e}"))?
        .map_err(|e| format!("Write file failed: {e}"))?;

    Ok(SaveResult {
        file_path: Some(path),
    })
}

/// 供前端启动时询问：如果是双击 .gxt 启动，Windows 通常会把路径放在 argv[1]
#[tauri::command]
pub fn gxt_startup_path() -> Option<String> {
    let mut it = std::env::args().skip(1);
    let p = it.next()?;
    if p.to_lowercase().ends_with(".gxt") {
        Some(p)
    } else {
        None
    }
}

// -------------------- Core: parse/build --------------------

fn parse_gxt_bytes(bytes: &[u8]) -> Result<Vec<GxtEntry>, String> {
    let mut cur = 0usize;

    // TKEY
    require_magic(bytes, &mut cur, MAGIC_TKEY)?;

    // key_field_size
    let key_field_size = read_u32_le(bytes, &mut cur)? as usize;
    if key_field_size % 12 != 0 {
        return Err(format!("Invalid key_field_size: {key_field_size} (not divisible by 12)"));
    }

    let entry_count = key_field_size / 12;
    let mut keys: Vec<(String, u32)> = Vec::with_capacity(entry_count);
    let mut seen = HashSet::with_capacity(entry_count);

    for _ in 0..entry_count {
        let idx = read_u32_le(bytes, &mut cur)?;
        let key_raw = read_bytes(bytes, &mut cur, 8)?;
        let key = decode_key_8bytes(key_raw)?;

        if !seen.insert(key.clone()) {
            return Err(format!("Duplicate key in file: {key}"));
        }
        keys.push((key, idx));
    }

    // TDAT
    require_magic(bytes, &mut cur, MAGIC_TDAT)?;

    let val_field_size = read_u32_le(bytes, &mut cur)? as usize;
    let val_field = read_bytes(bytes, &mut cur, val_field_size)?;

    let mut entries = Vec::with_capacity(keys.len());
    for (key, idx) in keys {
        let idx_usize = idx as usize;
        if idx_usize >= val_field.len() {
            return Err(format!("Value offset out of range for key {key}: idx={idx}"));
        }
        if idx_usize % 2 != 0 {
            return Err(format!(
                "Value offset is not aligned (must be even) for key {key}: idx={idx}"
            ));
        }

        let value = decode_utf16z_with_escapes(val_field, idx_usize)?;
        entries.push(GxtEntry { key, value });
    }

    Ok(entries)
}

fn build_gxt_bytes(entries: &[GxtEntry]) -> Result<Vec<u8>, String> {
    validate_entries(entries)?;

    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(MAGIC_TKEY);

    let key_field_size: u32 = (entries.len() as u32) * 12;
    out.extend_from_slice(&key_field_size.to_le_bytes());

    let mut val_field: Vec<u8> = Vec::new();
    let mut offset: u32 = 0;

    for e in entries {
        out.extend_from_slice(&offset.to_le_bytes());

        let key8 = encode_key_8bytes(&e.key)?;
        out.extend_from_slice(&key8);

        let written = encode_utf16z_with_escapes(&e.value, &mut val_field)?;
        offset = offset
            .checked_add(written)
            .ok_or("TDAT size overflow (too large)")?;
    }

    out.extend_from_slice(MAGIC_TDAT);
    out.extend_from_slice(&(val_field.len() as u32).to_le_bytes());
    out.extend_from_slice(&val_field);

    Ok(out)
}

// -------------------- Validation --------------------

fn validate_entries(entries: &[GxtEntry]) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(entries.len());
    for e in entries {
        validate_key(&e.key)?;
        if !seen.insert(e.key.clone()) {
            return Err(format!("Duplicate key: {}", e.key));
        }
    }
    Ok(())
}

/// KEY：1..=8，且只允许 A-Z / 0-9
/// KEY：1..=8 bytes，允许 ASCII 可见字符：0x20(' ')..0x7E('~')
fn validate_key(key: &str) -> Result<(), String> {
    let len = key.len(); // 对 ASCII 来说 len = 字节数
    if len == 0 || len > 8 {
        return Err(format!("Invalid KEY length (must be 1..=8 bytes): {key:?}"));
    }
    if !key.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
        return Err(format!(
            "Invalid KEY chars (printable ASCII 0x20..0x7E only): {key:?}"
        ));
    }
    Ok(())
}

// -------------------- Key encoding/decoding --------------------

fn decode_key_8bytes(raw: &[u8]) -> Result<String, String> {
    if raw.len() != 8 {
        return Err("Key raw size must be 8".into());
    }
    let trimmed = raw
        .iter()
        .copied()
        .take_while(|&b| b != 0)
        .collect::<Vec<u8>>();

    let s = String::from_utf8(trimmed).map_err(|e| format!("Key is not valid UTF-8: {e}"))?;
    Ok(s)
}

fn encode_key_8bytes(key: &str) -> Result<[u8; 8], String> {
    validate_key(key)?;
    let bytes = key.as_bytes();
    let mut out = [0u8; 8];
    out[..bytes.len()].copy_from_slice(bytes);
    Ok(out)
}

// -------------------- UTF-16Z decode/encode with escapes --------------------

fn decode_utf16z_with_escapes(val_field: &[u8], start: usize) -> Result<String, String> {
    let mut units: Vec<u16> = Vec::new();
    let mut p = start;

    while p + 1 < val_field.len() {
        let u = u16::from_le_bytes([val_field[p], val_field[p + 1]]);
        p += 2;
        if u == 0 {
            break;
        }
        units.push(u);
    }

    if p > val_field.len() {
        return Err("Unexpected EOF while reading UTF-16Z".into());
    }

    Ok(units_to_string_with_escapes(&units))
}

fn units_to_string_with_escapes(units: &[u16]) -> String {
    let mut out = String::new();
    let mut i = 0;

    while i < units.len() {
        let u = units[i];

        // surrogate pair -> Unicode
        if (0xD800..=0xDBFF).contains(&u) && i + 1 < units.len() {
            let lo = units[i + 1];
            if (0xDC00..=0xDFFF).contains(&lo) {
                let hi = (u as u32) - 0xD800;
                let lo = (lo as u32) - 0xDC00;
                let cp = 0x10000 + ((hi << 10) | lo);
                if let Some(ch) = char::from_u32(cp) {
                    out.push(ch);
                    i += 2;
                    continue;
                }
            }
        }

        // 特殊区间 + 不成对 surrogate：输出可逆转义
        if (SPECIAL_MIN..=SPECIAL_MAX).contains(&u) || (0xD800..=0xDFFF).contains(&u) {
            out.push_str(&format!("\\u{{{:04X}}}", u));
            i += 1;
            continue;
        }

        // 普通 BMP
        if let Some(ch) = char::from_u32(u as u32) {
            out.push(ch);
        } else {
            out.push_str(&format!("\\u{{{:04X}}}", u));
        }
        i += 1;
    }

    out
}

fn encode_utf16z_with_escapes(s: &str, out: &mut Vec<u8>) -> Result<u32, String> {
    let start_len = out.len();
    let bytes = s.as_bytes();
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] == b'\\' {
            // \\ => literal '\'
            if i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                push_u16_le(out, b'\\' as u16);
                i += 2;
                continue;
            }

            // \xNNNN
            if i + 5 < bytes.len() && bytes[i + 1] == b'x' {
                if let Some(u) = parse_fixed_4hex(&bytes[(i + 2)..(i + 6)]) {
                    push_u16_le(out, u);
                    i += 6;
                    continue;
                }
            }

            // \uNNNN
            if i + 5 < bytes.len() && bytes[i + 1] == b'u' && bytes[i + 2] != b'{' {
                if let Some(u) = parse_fixed_4hex(&bytes[(i + 2)..(i + 6)]) {
                    push_u16_le(out, u);
                    i += 6;
                    continue;
                }
            }

            // \u{...}
            if i + 3 < bytes.len() && bytes[i + 1] == b'u' && bytes[i + 2] == b'{' {
                if let Some((cp, consumed)) = parse_braced_hex(&bytes[(i + 3)..]) {
                    if cp <= 0x10FFFF {
                        if cp <= 0xFFFF {
                            push_u16_le(out, cp as u16);
                        } else {
                            let cp2 = cp - 0x10000;
                            let hi = 0xD800 | ((cp2 >> 10) as u16);
                            let lo = 0xDC00 | ((cp2 & 0x3FF) as u16);
                            push_u16_le(out, hi);
                            push_u16_le(out, lo);
                        }
                        i += 3 + consumed; // "\" "u" "{" + ... "}"
                        continue;
                    } else {
                        return Err(format!("Invalid codepoint in \\u{{...}}: {cp:X}"));
                    }
                }
            }

            // fallback: treat '\' as normal char
            push_u16_le(out, b'\\' as u16);
            i += 1;
            continue;
        }

        let ch = match s[i..].chars().next() {
            Some(c) => c,
            None => break,
        };
        let mut buf = [0u16; 2];
        let encoded = ch.encode_utf16(&mut buf);
        for &u in encoded.iter() {
            push_u16_le(out, u);
        }
        i += ch.len_utf8();
    }

    // 0 terminator
    push_u16_le(out, 0);

    let written = out.len() - start_len;
    Ok(u32::try_from(written).map_err(|_| "TDAT chunk too large".to_string())?)
}

fn push_u16_le(out: &mut Vec<u8>, u: u16) {
    out.extend_from_slice(&u.to_le_bytes());
}

fn parse_fixed_4hex(hex4: &[u8]) -> Option<u16> {
    if hex4.len() != 4 || !hex4.iter().all(|b| is_hex(*b)) {
        return None;
    }
    let s = std::str::from_utf8(hex4).ok()?;
    u16::from_str_radix(s, 16).ok()
}

fn parse_braced_hex(input: &[u8]) -> Option<(u32, usize)> {
    let mut j = 0usize;
    while j < input.len() && input[j] != b'}' {
        j += 1;
    }
    if j == 0 || j >= input.len() {
        return None;
    }
    let hex = &input[..j];
    if !hex.iter().all(|b| is_hex(*b)) {
        return None;
    }
    let s = std::str::from_utf8(hex).ok()?;
    let cp = u32::from_str_radix(s, 16).ok()?;
    Some((cp, j + 1))
}

fn is_hex(b: u8) -> bool {
    matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F')
}

// -------------------- Low-level readers --------------------

fn require_magic(bytes: &[u8], cur: &mut usize, magic: &[u8; 4]) -> Result<(), String> {
    let got = read_bytes(bytes, cur, 4)?;
    if got != magic {
        return Err(format!(
            "Magic mismatch at {:#X}: expected {:?}, got {:?}",
            *cur - 4,
            magic,
            got
        ));
    }
    Ok(())
}

fn read_u32_le(bytes: &[u8], cur: &mut usize) -> Result<u32, String> {
    let b = read_bytes(bytes, cur, 4)?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn read_bytes<'a>(bytes: &'a [u8], cur: &mut usize, n: usize) -> Result<&'a [u8], String> {
    if *cur + n > bytes.len() {
        return Err("Unexpected EOF".into());
    }
    let s = &bytes[*cur..*cur + n];
    *cur += n;
    Ok(s)
}
