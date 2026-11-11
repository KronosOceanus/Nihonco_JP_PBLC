/* 单词例句校验：例句必须包含目标词本身、读音，或它的活用形。
 * 纯本地：kuromoji + 字符串匹配，不调模型。
 */
const reading = require("./reading");

function norm(s) {
  return String(s || "").normalize("NFKC").trim();
}

/** 去掉 〜 / ～ / [ ] 读音标记，得到可用于匹配的核心 */
function clean(s) {
  return norm(s)
    .replace(/[〜～~]/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "");
}

function targetsOf(word) {
  const ja = norm(word && word.ja);
  const kana = norm(word && word.kana);
  const out = [];
  const add = (value, loose) => {
    if (value && !out.some((x) => x.value === value)) out.push({ value, loose });
  };
  add(ja, /[〜～~]/.test(ja));
  add(kana, false);
  add(clean(ja), /[〜～~]/.test(ja) || /\[[^\]]*\]/.test(ja));
  add(clean(kana), false);
  return out;
}

/** 例句是否包含目标词（允许活用/复合词/读音） */
function exampleMatches(word, example) {
  const ex = norm(example);
  if (!ex) return false;
  const targets = targetsOf(word);
  if (!targets.length) return false;

  // 直接包含：多字目标，或带 〜 / [读音] 的标记词（如 〜人 → 日本人）
  for (const t of targets) {
    if ((t.loose || t.value.length >= 2) && ex.includes(t.value)) return true;
  }

  // 分词原形/读音匹配：終わります → 終わる；いや → 嫌
  if (!reading.ready()) return false;
  const toks = reading.tokens(ex) || [];
  for (const tk of toks) {
    for (const t of targets) {
      if (tk.t === t.value || tk.b === t.value || tk.r === t.value) return true;
    }
  }
  return false;
}

module.exports = { exampleMatches };
