/* 点词查询：kuromoji 分词 + 词表（JLPT 10k）
 * 只返回词表里有释义的词（ok:true）；词表外的词前端不标记、不可点。
 * 匹配优先原形（見た → 見る），其次表层。
 */
const reading = require("./reading");
const curriculum = require("./curriculum");

let dict = null;

function dictionary() {
  if (dict) return dict;
  dict = new Map();
  for (const w of curriculum.words()) {
    if (w && w.ja) dict.set(w.ja, w);
  }
  return dict;
}

/** @returns {Array<{t,r,b,kana,zh,level,pos,ok}>|null} 未预热时返回 null */
function lookup(text) {
  if (!reading.ready()) return null;
  const d = dictionary();
  const toks = reading.tokens(String(text || "").slice(0, 2000));
  if (!toks) return null;
  return toks.map((tk) => {
    const base = tk.b || tk.t;
    const hit = d.get(base) || d.get(tk.t) || null;
    return {
      t: tk.t,
      r: tk.r || (hit && hit.kana) || "",
      b: hit && hit.ja ? hit.ja : base,
      kana: hit ? hit.kana || "" : "",
      zh: hit ? hit.zh || "" : "",
      level: hit ? hit.level || "" : "",
      pos: hit ? hit.pos || "" : "",
      ok: !!(hit && hit.zh),
    };
  });
}

module.exports = { lookup };
