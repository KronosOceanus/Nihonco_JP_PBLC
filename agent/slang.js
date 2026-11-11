/* 网络用语 / 假名歧义的对话提示
 *
 * 当前：静态压缩版，会随每轮会話 prompt 发送。
 * TODO(perf): 未来可按用户输入动态注入——普通聊天只带一句假名提示，
 * 命中网络用语时再带对应词条；目前先保持静态压缩，不增加判断分支。
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

function promptBlock() {
  const terms = NET_TERMS.map((t) => `${t.ja}=${t.meaning}`).join("、");
  return `【ネット用語/カナ】
- 音声入力はカナだけのことがある。同音の漢字・スラングで解釈し、分からないふりをしない。
- 主な語：${terms}
- 出たら普通に会話で反応する（解説しない）。`;
}

module.exports = { NET_TERMS, promptBlock };
