/* 汉字 → 假名读音（仅 kuromoji）
 *
 * 用途：单词判分的「这个也算对」、振假名。
 * 这里只使用 kuromoji 的分词和 token 读音，不做词典覆盖、不做跨 token 合并。
 * 代价：预热后常驻约 350MB RSS；初始化约 200ms，启动后预热。
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
    if (/^[\u3040-\u30ffA-Za-z0-9ー]+$/.test(surf)) { out += toHiragana(surf); continue; }
    if (/[\u4e00-\u9fff]/.test(surf)) return "";
  }
  return out;
}

/** 分词结果：[{ t, r, p, b }]；未就绪返回 null */
function tokens(text) {
  if (!tokenizer) return null;
  return tokenizer.tokenize(String(text || "")).map((t) => ({
    t: t.surface_form || "",
    r: t.reading && t.reading !== "*" ? toHiragana(t.reading) : null,
    p: t.pos || "",
    b: t.basic_form && t.basic_form !== "*" ? t.basic_form : (t.surface_form || ""),
  }));
}

module.exports = { warmup, ready, toKana, tokens };
