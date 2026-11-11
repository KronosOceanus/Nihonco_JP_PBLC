/* 汉字 → 假名（只用于复现判定，不做正经形态素分析）
 *
 *   data/kanji-stems.json：汉字词干 → 假名（tools/build-kanji-stems.mjs 生成）
 *
 * 做法：最长匹配 + 送り仮名原样保留
 *   週末は家で映画を見た → しゅうまつはいえでえいがをみた
 *   食べた             → たべた（词干 食 → た，べた 原样）
 *
 * 表外的汉字没法转 → 保留原字；比对时自然对不上，会退回「精确比对」
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "kanji-stems.json");

let _table = null;      // Map<词干, 假名>
let _maxLen = 0;

function table() {
  if (_table) return _table;
  _table = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [k, v] of Object.entries(raw)) {
      _table.set(k, v);
      if (k.length > _maxLen) _maxLen = k.length;
    }
  } catch (e) { /* 没有表就什么都不转 */ }
  return _table;
}

const isKanji = (ch) => /[\u4e00-\u9fff]/.test(ch);
const isKana = (ch) => /[ぁ-んァ-ヶー]/.test(ch);

/**
 * 把汉字部分换成假名（假名/英文/数字/符号原样保留）
 * @returns {string} 转换结果；表外汉字保持原样
 */
function convert(text) {
  const t = String(text || "");
  const map = table();
  if (!map.size) return t;

  let out = "";
  let i = 0;
  while (i < t.length) {
    if (!isKanji(t[i])) { out += t[i]; i += 1; continue; }

    // 最长匹配：从当前位置往前找表里最长的词干
    let hit = null;
    for (let len = Math.min(_maxLen, t.length - i); len >= 1; len--) {
      const key = t.slice(i, i + len);
      if (map.has(key)) { hit = key; break; }
    }
    if (hit) { out += map.get(hit); i += hit.length; }
    else { out += t[i]; i += 1; }          // 表外汉字原样留着
  }
  return out;
}

/** 转换后是否还有没转掉的汉字（有就说明超出词表） */
function hasUnknownKanji(converted) {
  return [...String(converted || "")].some(isKanji);
}

function reload() { _table = null; _maxLen = 0; return table(); }

module.exports = { convert, hasUnknownKanji, reload, FILE };
