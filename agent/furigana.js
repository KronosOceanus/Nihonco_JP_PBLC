/* 振假名：把日语文本切成 [{ t, r? }]，renderer 拼成 <ruby>
 *
 * 只有「含汉字 + 有读音 + 读音和写法不同」的片段才带 r；
 * 假名/数字/标点原样输出。未预热好时返回 null（renderer 退回纯文本）。
 */
const reading = require("./reading");

function of(text) {
  if (!reading.ready()) return null;
  const toks = reading.tokens(text);
  if (!toks) return null;
  const out = [];
  for (const { t, r } of toks) {
    if (!t) continue;
    const hasKanji = /[\u4e00-\u9fff]/.test(t);
    out.push(hasKanji && r ? { t, r } : { t });
  }
  return out;
}

module.exports = { of };
