/* 网络用语 / 假名歧义的对话提示
 *
 * 只把“本轮用户输入里出现的网络用语”注入对话 prompt。
 * 没命中时只保留一条假名输入提示，不带整张词表。
 */

const NET_TERMS = [
  { ja: "雑魚（ざこ）", meaning: "弱者/挑発" },
  { ja: "草 / ｗｗｗ", meaning: "笑い" },
  { ja: "ぴえん", meaning: "泣き" },
  { ja: "エモい", meaning: "感情が動く" },
  { ja: "それな", meaning: "同意" },
  { ja: "りょ", meaning: "了解" },
  { ja: "おけ", meaning: "OK" },
  { ja: "すこ", meaning: "好き" },
  { ja: "うざい", meaning: "うるさい" },
  { ja: "きもい", meaning: "気持ち悪い" },
  { ja: "ワンチャン", meaning: "もしかしたら" },
  { ja: "〜すぎ", meaning: "程度が甚だしい" },
];

function norm(s) {
  return String(s || "").normalize("NFKC").toLowerCase();
}

/** 词条 → 可匹配写法；去掉读音括号和 〜，按 / 拆分支 */
function variants(term) {
  return String(term.ja || "")
    .replace(/（[^）]*）/g, "")
    .replace(/〜/g, "")
    .split("/")
    .map((s) => norm(s.trim()))
    .filter(Boolean);
}

function hits(text) {
  const n = norm(text);
  if (!n) return [];
  return NET_TERMS.filter((term) => variants(term).some((v) => n.includes(v)));
}

function promptBlock(userText = "") {
  const base = `【ネット用語/カナ】
- 音声入力はカナだけのことがある。同音の漢字・スラングで解釈し、分からないふりをしない。`;
  const found = hits(userText);
  if (!found.length) return base;
  const terms = found.map((t) => `${t.ja}=${t.meaning}`).join("、");
  return `${base}
- 主な語：${terms}
- 出たら普通に会話で反応する（解説しない）。`;
}

module.exports = { NET_TERMS, promptBlock, hits };
