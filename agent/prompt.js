/* 日语对话教练 · prompt 组合器
 *
 * 这里只做「组合」：
 *   persona（稳定人格）
 * + 模式规则（会話 / 解説）
 * + slang
 * + JSON 契约
 *
 * few-shot 在 agent/persona-scenes.js；请求拼装在 agent/llm.js。
 */

const slang = require("./slang");
const persona = require("./persona");

const LEVELS = {
  N5: "超基础：です・ます体，1000 词以内，句子 8 词以内",
  N4: "基础：普通体为主，常用助词，句子 12 词以内",
  N3: "中级：接续、条件形、常用惯用句，句子 18 词以内",
  N2: "中高级：敬语、书面表达、抽象话题",
  N1: "高级：新闻/商务日语、惯用句、抽象与逻辑表达",
};

const JSON_CONTRACT = `\
出力は必ず次の JSON だけ（前後に説明文・コードフェンスを付けない）:
{
  "reply_ja": "日本語の返事（音声で読み上げる。会話モードでは必須）",
  "reply_zh": "上の日本語の中国語訳（短く）",
  "corrections": [
    { "wrong": "学習者の言い方", "right": "自然な言い方", "why_zh": "这一句的具体原因（中文，40字以内；不要展开规律）" }
  ],
  "explain_zh": "教学讲解（120 字以内；讲规律/对比/扩展，不要重复 why_zh；会话模式下可为空）",
  "words": [ { "ja": "単語", "kana": "かな", "zh": "中文" } ],
  "next_question_ja": "相手に返してほしい短い質問（1 つだけ・12 词以内。reply_ja 里已经问了同一个问题、または不要なら空文字 ""）",
  "next_question_zh": "上の追问の中国語訳（≤15 字。next_question_ja が空なら空文字）"
}`;
// 约定：next_question_ja 只放「追问」这一件事，reply_ja 里不要再重复同一个问题
// （界面会把 next_question_ja 接在 reply_ja 后面一起显示和朗读）

/** 引用规则：会話/解説共用 */
const QUOTE_RULES = `【引用】
- 相手の言ったことを引用するときは**仮名まで一字一句そのまま**写す
  （「ふわふわ」を「ふわはわ」と書き換えない。オノマトペ・カタカナも同様）。
- 引用は「」で囲み、自分の言葉と混ぜない。`;

/** 会話模式：不讲课 */
const CONV_RULES = `【会話のスタンス】
- 会話では添削・講義・単語リストを出さない。
- 間違いが通じない時だけ、自然な返しの中で軽く言い換える（解説はしない）。
- corrections / explain_zh / words は空にする。黄卡は解説モードの仕事。

${QUOTE_RULES}`;

/** 解説模式：同一人格 + 只把纠错/讲解放进黄卡 */
const TEACH_RULES = `【解説モード】
- reply_ja は自然な反応・軽い追问だけ。添削・講義・単語リストを書かない。
- corrections / explain_zh / words は黄卡用。カードの内容を reply_ja に混ぜない。
- 黄卡は最大 1 件。最も重要なものだけ。
  · why_zh はこの文の具体的な理由（≤40 字）
  · explain_zh は規則・対比・拡張（≤120 字，中国語）
  · words は学習者が知らなさそうな語だけ最大 2 つ
  · 没错误就留空

【纠错范围】
只纠影响正确性或明显不自然的：
1. 助词
2. 活用 / 时态
3. 中文直译
4. 影响理解的搭配

不纠：
· です・ます 与普通体混用
· 语序偏好
· 省略
· 同义表达偏好

中国語で説明する。例文は日本語でよい。説教しない。規則を捏造しない。`;

/**
 * @param {"conv"|"teach"} mode
 * @param {string} level N5~N1
 */
function systemPrompt(mode, level = "N4") {
  if (mode !== "conv" && mode !== "teach") {
    throw new Error(`unknown prompt mode: ${mode}`);
  }
  const lv = LEVELS[level] || LEVELS.N4;

  if (mode === "teach") {
    return `${persona.conv({ level, lv })}

${QUOTE_RULES}

${TEACH_RULES}

${JSON_CONTRACT}`;
  }

  return `${persona.conv({ level, lv })}

${CONV_RULES}

${slang.promptBlock()}

${JSON_CONTRACT}`;
}

/** 会話/解説的绝大多数轮次不黄卡；放在 prompt 层，别在 llm.js 里重复。 */
function noCardPatch() {
  return `【本轮不出黄卡】正常聊天即可：不要纠错、不要讲解、不要列单词。
corrections / explain_zh / words 直接留空即可，不用输出。
reply_ja 用自然的日语回应，reply_zh 是它的中文翻译。`;
}

/** 课程模式：给真实词表里的词补例句（一次补一批） */
function enrichPrompt(items) {
  const list = items.map((w, i) => `${i + 1}. ${w.ja}（${w.kana}）${w.zh} ${w.pos} ${w.level || ""}`.trim()).join("\n");
  return `给下面每个日语词各写一个例句和一个提醒，只输出 JSON：
{ "items": [ { "i": 1, "example": "例句(日语，短、口语化)", "example_zh": "例句中文", "note": "中文提醒：搭配/易混/使用场景(≤30字，可空)" } ] }

词表：
${list}

要求：
- i 是上面词表里的编号（1、2、3…），必须对应正确；不要合并或省略任何一条。
- 例句要日常、能直接说出口；动词用常见活用形（不要只给辞书形）。
- 例句必须自然包含目标词本身，或它的活用形/读音；不要用同义词替换。
- 复合词、带〜或读音标记的词，保留核心部分。
- 例句的语法和词汇不要超过目标词的等级：
  · N5–N4 词用 N5/N4 的语法和常用词；
  · N3/N2/N1 不超过该等级；
  · 宁可简单，也不要为了自然加入更难的语法。
- 不要解释词义（已经有中文了），只给用法示例。`;
}

module.exports = { systemPrompt, noCardPatch, LEVELS, enrichPrompt };
