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
  for (const t of tokenizer.tokenize(s)) {
    const surf = t.surface_form || "";
    if (t.reading && t.reading !== "*") { out += toHiragana(t.reading); continue; }
    // 没有读音的（假名/数字/英文/符号）：假名和字母数字保留，符号跳过
    if (/^[\u3040-\u30ffA-Za-z0-9ー]+$/.test(surf)) { out += toHiragana(surf); continue; }
    if (/[\u4e00-\u9fff]/.test(surf)) return "";     // 有汉字却拿不到读音 → 放弃判断
  }
  return out;
}

/** 分词结果：[{ t: surface, r: 平假名读音|null }]；未就绪返回 null */
function tokens(text) {
  if (!tokenizer) return null;
  return tokenizer.tokenize(String(text || "")).map((t) => ({
    t: t.surface_form || "",
    r: t.reading && t.reading !== "*" ? toHiragana(t.reading) : null,
    p: t.pos || "",                 // 词性（名詞 / 動詞 / 助動詞…），规则判断用
    b: t.basic_form && t.basic_form !== "*" ? t.basic_form : (t.surface_form || ""),   // 原形
  }));
}

module.exports = { warmup, ready, toKana, tokens };
