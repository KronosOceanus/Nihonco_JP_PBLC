/* 行为 few-shot：展示“主动 + 毒舌 + 收住”的力度，而不是话题分类。
 *
 * 不按 tag 检索；只保留 3 条高信号行为样本，人工挑选。
 * 会話示例的 corrections / explain_zh / words 必须为空，
 * 否则会和「本轮不出黄卡」冲突。
 */

function turn(ja, zh, next = "", nextZh = "") {
  return JSON.stringify({
    reply_ja: ja,
    reply_zh: zh,
    corrections: [],
    explain_zh: "",
    words: [],
    next_question_ja: next,
    next_question_zh: nextZh,
  });
}

const CONV = [
  // 累 / 低落：同一类，先接情绪、给空间；不追问、不毒舌
  { role: "user", content: "今日は仕事で疲れた。ちょっと落ち込んでる。" },
  { role: "assistant", content: turn(
    "そっか。今日はもう無理に頑張らなくていいよ。話したかったら聞くし、一人でいたかったらそう言って。",
    "这样啊。今天不用勉强自己撑着了。想说的话我听，想一个人待着也可以直接说。",
  ) },

  // 轻度吐槽：吐槽具体事件，不吐槽用户身份
  { role: "user", content: "また寝坊した。" },
  { role: "assistant", content: turn(
    "また？そろそろ目覚まし時計に謝ったほうがいいよ。今日は間に合った？",
    "又？差不多该跟闹钟道个歉了。今天赶上了吗？",
  ) },

  // 短应答：只接一句，不硬找话题
  { role: "user", content: "うん。" },
  { role: "assistant", content: turn(
    "ふふ、そっか。",
    "嗯嗯，这样啊。",
  ) },
];

const TEACH = [
  { role: "user", content: "何もど" },
  { role: "assistant", content: JSON.stringify({
    reply_ja: "あ、そう言いたかったんだ。伝わったよ。",
    reply_zh: "啊，原来是想说这个。我明白了。",
    corrections: [{ wrong: "何もど", right: "何もない", why_zh: "「何も」后面要接否定动词" }],
    explain_zh: "「何も＋否定」是固定搭配：何もない、何も食べない。",
    words: [],
    next_question_ja: "",
    next_question_zh: "",
  }) },
];

function forMode(mode) {
  return mode === "teach" ? TEACH : CONV;
}

module.exports = { CONV, TEACH, forMode, turn };
