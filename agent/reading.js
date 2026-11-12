/* 汉字 → 假名读音（kuromoji 分词器 + 词典）
 *
 * 用途：单词判分的「这个也算对」只在**读音完全一致**时出现
 *   出来る → できる ✅（和卡片假名一致）
 *   来る   → くる   ❌（卡片是 きる，读音不同）
 *
 * 两条使用路径的严格程度不同：
 *   · 单词「这个也算对」：读音一致只是**必要条件**——箸/橋 都是 はし，
 *     所以按钮出现后仍要人工点一下，不自动判对
 *   · 例句复现（patterns.sameSentence）：句子级读音一致就直接判对，没有按钮
 *     （目标是"照着例句打"，读音对上就说明会读这句）
 *
 * 代价：预热后常驻约 350MB RSS（磁盘词典 17MB）；初始化约 200ms，启动后预热。
 * 没就绪时 toKana 返回 null（严格不猜）。
 */
const path = require("path");
const { toHiragana } = require("./romaji");

let tokenizer = null;
let building = null;
let jmdict = null;
let merged = null;

function loadMap(file) {
  try {
    const j = require(path.join(__dirname, "..", "data", file));
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (!k.startsWith("_") && k && typeof v === "string") out[k] = v;
    }
    return out;
  } catch (e) { return {}; }
}

function loadReadings() {
  if (merged) return merged;
  if (!jmdict) jmdict = loadMap("jmdict-readings.json");
  merged = jmdict;
  return merged;
}

function dicPath() {
  return path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");
}

/** 后台预热；重复调用安全 */
function warmup() {
  if (tokenizer) return Promise.resolve(tokenizer);
  if (building) return building;
  const kuromoji = require("kuromoji");
  building = new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dicPath() }).build((err, tok) => {
      if (err) { building = null; reject(err); return; }
      tokenizer = tok;
      resolve(tok);
    });
  });
  return building;
}

function ready() { return !!tokenizer; }

/** 汉字混写的文本 → 平假名读音；未就绪返回 null；含无法判读的片段返回 "" */
function toKana(text) {
  if (!tokenizer) return null;
  const s = String(text || "");
  if (!s) return "";
  let out = "";
  for (const t of mergedTokens(s)) {
    const surf = t.surface_form || "";
    if (t.reading && t.reading !== "*") { out += toHiragana(t.reading); continue; }
    if (/^[\u3040-\u30ffA-Za-z0-9ー]+$/.test(surf)) { out += toHiragana(surf); continue; }
    if (/[\u4e00-\u9fff]/.test(surf)) return "";
  }
  return out;
}

/** 在 kuromoji 结果上合并「四人」这类整体读音词 */
function mergedTokens(text) {
  const raw = tokenizer.tokenize(String(text || ""));
  const map = loadReadings();
  const out = [];
  for (let i = 0; i < raw.length;) {
    let best = null;
    let surface = "";
    for (let n = 1; n <= 3 && i + n <= raw.length; n++) {
      surface += raw[i + n - 1].surface_form || "";
      if (map[surface]) best = { n, reading: map[surface], surface };
    }
    // 单 token 已由 kuromoji 给出原形/读音，不能覆盖 basic_form；
    // 只有跨 token 的复合词才用读音表合并。
    if (best && best.n > 1) {
      out.push({ surface_form: best.surface, reading: best.reading, pos: "名詞", basic_form: best.surface });
      i += best.n;
    } else {
      out.push(raw[i]);
      i += 1;
    }
  }
  return out;
}

/** 分词结果：[{ t, r, p, b }]；未就绪返回 null */
function tokens(text) {
  if (!tokenizer) return null;
  return mergedTokens(text).map((t) => ({
    t: t.surface_form || "",
    r: t.reading && t.reading !== "*" ? toHiragana(t.reading) : null,
    p: t.pos || "",
    b: t.basic_form && t.basic_form !== "*" ? t.basic_form : (t.surface_form || ""),
  }));
}

module.exports = { warmup, ready, toKana, tokens };
