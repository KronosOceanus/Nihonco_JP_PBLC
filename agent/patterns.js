/* 句型（文型）数据：来自 OpenJLPT（CC BY-SA 4.0），已附中文
 *
 * 文件：data/patterns-n5.json（tools/build-patterns.mjs 生成；n4 及以后按需追加）
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const LEVELS = ["n5", "n4", "n3", "n2", "n1"];

let _cache = null;
let _gloss = null;

/** 括号里的英文说明 → 中文（OpenJLPT 用它区分同一助词的不同用法） */
function glossMap() {
  if (_gloss) return _gloss;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "pattern-gloss-zh.json"), "utf8"));
    delete j._comment;
    _gloss = j;
  } catch (e) { _gloss = {}; }
  return _gloss;
}

/** 把「〜から（from）」变成「〜から（起点）」；查不到就保留原文 */
function displayPattern(raw) {
  const text = String(raw || "");
  return text.replace(/（([^）]*)）/g, (whole, gloss) => {
    if (!/[A-Za-z]/.test(gloss)) return whole;          // 已经是中文，不动
    const zh = glossMap()[gloss.toLowerCase()];
    return zh ? `（${zh}）` : "";                        // 查不到就把英文去掉
  });
}

function loadAll() {
  if (_cache) return _cache;
  const items = [];
  for (const lv of LEVELS) {
    const f = path.join(DATA_DIR, `patterns-${lv}.json`);
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const it of j.items || []) items.push({ ...it, level: (it.level || lv.toUpperCase()) });
    } catch (e) { /* 没有就跳过 */ }
  }
  _cache = items;
  return _cache;
}

function reload() { _cache = null; return loadAll(); }

function all(level) {
  const items = loadAll();
  if (!level) return items;
  const lv = String(level).toUpperCase();
  return items.filter((x) => x.level === lv);
}

function byId(id) {
  return loadAll().find((x) => x.id === id) || null;
}

/** 从句型里取核心：去掉（英文注释）、〜、空格，按 / 拆 */
function patternCores(raw) {
  return String(raw || "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .split("/")
    .map((x) => x.replace(/[〜～~\s]/g, "").trim())
    .filter(Boolean);
}

/** 例句选择：多字核心优先匹配；单字核心/无匹配用第一句（数据里最典型） */
function pickExample(item) {
  const ex = (item && item.examples) || [];
  if (!ex.length) return null;
  const cores = patternCores(item.patternRaw || item.pattern);
  const long = cores.filter((c) => c.length >= 2);
  if (long.length) {
    const hit = ex.filter((e) => long.some((c) => String(e.ja || "").includes(c)));
    if (hit.length) return hit[Math.floor(Math.random() * hit.length)];
  }
  return ex[0];
}

/** 给界面用的卡片（带一条例句） */
function card(id) {
  const it = byId(id);
  if (!it) return null;
  const ex = pickExample(it);
  return {
    id: it.id,
    pattern: displayPattern(it.pattern),
    patternRaw: it.pattern,
    reading: it.reading || "",
    level: it.level,
    meaning_zh: it.meaning_zh || "",
    formation_zh: it.formation_zh || "",
    notes_zh: it.notes_zh || "",
    probe: ex ? { ja: ex.ja, zh: ex.zh || "", reading: ex.reading || "" } : null,
  };
}

/** 复现模式的宽松比对：全角半角、空格、标点差异都放过 */
function normalize(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[\s、。，．,.!！?？「」『』（）()・…]/g, "")
    .trim()
    .toLowerCase();
}

/** 复现比对：
 *   1) 和例句的汉字写法一致
 *   2) 和例句读音一致（全假名）
 *   3) 汉字+假名混合写法，转成假名后和读音一致
 */
function sameSentence(a, b, readingOfB = "") {
  const x = normalize(a);
  if (!x) return false;
  if (x === normalize(b)) return true;

  // 读音比较（kuromoji）：出来る ↔ できる、汉字/假名混写都算对
  try {
    const rd = require("./reading");
    if (rd.ready()) {
      const a2 = rd.toKana(a);
      const b2 = rd.toKana(b);
      if (a2 && b2 && normalize(a2) === normalize(b2)) return true;
    }
  } catch (e) {}

  if (!readingOfB) return false;

  const want = normalize(readingOfB);
  if (x === want) return true;

  try {
    const k2k = require("./kanji2kana");
    const conv = k2k.convert(x);
    if (k2k.hasUnknownKanji(conv)) return false;   // 表外汉字转不出来 → 不硬凑
    return normalize(conv) === want;
  } catch (e) {
    return false;
  }
}

// 助词：两侧都要有内容，不能靠句尾判定
const PARTICLES = new Set(["は", "が", "を", "に", "で", "へ", "と", "も", "の", "や", "ね", "よ", "か"]);

// 像一句「说完的话」的结尾（です／ます／だ／た／る／い／か／ね／よ…）
const SENTENCE_END = /(です|ます|ました|ません|でした|ください|たい|ほしい|だ|た|る|い|か|ね|よ|な|の|ある|いる|く|す|つ|ぬ|ぶ|む|ぐ|う)$/;

/** 造句的规则兜底：
 *   - 「〜た」「〜て」这种后缀型：允许出现在句尾（前面要有内容）
 *   - 「〜は」这种助词型：两侧都要有内容，并且像个句子
 *   - 「X〜Y」中间型：按顺序都要出现
 *   - 多分支（A / B）命中任一分支即可
 */
/** な形容词：な 后面跟名词（kuromoji 词性判断）；没预热时退回「な 后面还有字」 */
function naBeforeNoun(sentence) {
  try {
    const rd = require("./reading");
    if (rd.ready()) {
      const toks = rd.tokens(sentence) || [];
      for (let i = 0; i < toks.length - 1; i++) {
        if (toks[i].t === "な" && /^名詞/.test(toks[i + 1].p || "")) return true;
      }
      return false;
    }
  } catch (e) {}
  const s = normalize(sentence);
  return /な./.test(s) && s.indexOf("な") > 0;
}

/** 短后缀是否作为一个独立语法词出现（kuromoji 词性）；没预热时退回旧规则 */
function shortSuffixOk(lit, sentence, s) {
  try {
    const rd = require("./reading");
    if (rd.ready()) {
      const toks = rd.tokens(sentence) || [];
      return toks.some((t) => t.t === lit && /^(助詞|助動詞|接尾|名詞)/.test(t.p || ""));
    }
  } catch (e) {}
  return s.endsWith(lit) || new RegExp(`${lit}[よねわぞか]$`).test(s);
}

/** 造句规则用：礼貌否定 → 普通否定，避免「わかりません」找不到字面「ない」 */
function normalizeNegative(s) {
  return String(s || "")
    .replace(/ありませんでした/g, "なかった")
    .replace(/ませんでした/g, "なかった")
    .replace(/じゃありません/g, "じゃない")
    .replace(/ではありません/g, "じゃない")
    .replace(/ありません/g, "ない")
    .replace(/ません/g, "ない");
}

function ruleMatch(pattern, sentence, opts = {}) {
  const raw = normalize(sentence);
  const s = /ない/.test(String(pattern || "")) ? normalizeNegative(raw) : raw;
  if (!s) return false;

  // 两条句型去掉括号后都是「〜な」，必须靠 id 区分（这是唯一能分清的地方）
  if (opts.id === "na-na-adjective") return naBeforeNoun(sentence);
  if (opts.id === "na-prohibition") return s.endsWith("な");

  const branches = String(pattern || "")
    .replace(/（[^）]*）/g, "")
    .split("/")
    .map((b) => b.trim())
    .filter(Boolean);

  for (const br of branches) {
    const startsTilde = br.startsWith("〜");
    const endsTilde = br.endsWith("〜");
    const parts = br.split("〜").map(normalize).filter(Boolean);
    if (!parts.length) continue;

    const litLen = parts.join("").length;
    if (s.length < litLen + 2) continue;        // 太短，肯定不是一句完整的话

    if (!startsTilde && !endsTilde) {           // X〜Y：按顺序出现
      let at = -1;
      let ok = true;
      for (const p of parts) {
        at = s.indexOf(p, at + 1);
        if (at < 0) { ok = false; break; }
      }
      if (ok) return true;
      continue;
    }

    if (startsTilde) {                          // 〜X：后缀或助词
      const lit = parts[0];
      const at = s.lastIndexOf(lit);
      if (at <= 0) continue;                    // 前面必须有内容

      if (parts.length === 1 && PARTICLES.has(lit)) {
        // 助词：两侧都要有内容，且要像个句子
        if (at >= s.length - 1) continue;
        if (!SENTENCE_END.test(s)) continue;
        return true;
      }

      if (parts.length === 1 && lit.length <= 2) {
        // 短后缀（〜た / 〜て / 〜ば / 〜さ）：作为独立语法词出现即可，不要求句尾
        // 有分词器时按词性判断（た=助動詞、ば/て=助詞、さ=名詞/接尾），避免「たたみ」这种误命中
        if (shortSuffixOk(lit, sentence, s) && SENTENCE_END.test(s)) return true;
        continue;
      }

      return true;
    }

    // X〜：前缀型，后面要有内容
    const at = s.indexOf(parts[0]);
    if (at >= 0 && s.length - (at + parts[0].length) >= 1) return true;
  }
  return false;
}

module.exports = { all, byId, card, pickExample, patternCores, normalize, sameSentence, ruleMatch, displayPattern, reload, LEVELS };
