/* 回复整理：模型偶尔把「追问」同时写进 reply_ja 和 next_question_ja，
 * 界面拼接后会出现同一句问两遍（中/日都会）。这里做主进程侧的防御性清理。
 * 归一化只去掉空白和常见标点，不改变内容。
 */
const norm = (s) => String(s || "").replace(/[\s。、，．,.!！?？「」『』（）()・…]/g, "");

function normalizeFollowUp(turn) {
  if (!turn) return turn;
  const q = String(turn.next_question_ja || "").trim();
  if (q && norm(turn.reply_ja).includes(norm(q))) {
    turn.next_question_ja = "";
    turn.next_question_zh = "";
    return turn;
  }
  const qz = String(turn.next_question_zh || "").trim();
  if (qz && norm(turn.reply_zh).includes(norm(qz))) turn.next_question_zh = "";
  return turn;
}

/** 黄卡只属于「解説 + 日语输入」（含假名） */
function cardAllowed(mode, lang) {
  return mode === "teach" && lang === "ja";
}

/** 其它组合一律清空纠错/讲解/单词（黄卡自然不出现） */
function applyCardPolicy(turn, mode, lang) {
  if (!turn) return turn;
  if (!cardAllowed(mode, lang)) {
    turn.corrections = [];
    turn.explain_zh = "";
    turn.words = [];
  }
  return turn;
}

/** 「也可以」按随意程度排序：casual → neutral → polite；缺 tone 时按场景文字猜 */
function orderAlternatives(list) {
  const rank = (a) => {
    const t = String(a && a.tone || "").toLowerCase();
    if (t === "casual") return 0;
    if (t === "neutral") return 1;
    if (t === "polite" || t === "formal") return 2;
    const s = String((a && a.scene_zh) || "");
    if (/随意|口语|朋友|随便|轻松/.test(s)) return 0;
    if (/礼貌|正式|长辈|上司|敬语/.test(s)) return 2;
    return 1;
  };
  return (Array.isArray(list) ? list : [])
    .map((a, i) => ({ a, i, r: rank(a) }))
    .sort((x, y) => (x.r - y.r) || (x.i - y.i))
    .map((x) => x.a);
}

/** 模型偶尔把网络笑声写成单独的 w/ｗ；显示层统一成（笑），不要念成字母。 */
function normalizeLaugh(s) {
  return String(s || "")
    .replace(
      /(?<=[\u3040-\u30ff\u4e00-\u9fff」』）)。、！？!?…\s])[wｗ]{1,}(?=[\s。、！？!?…」』（(]|$)/gi,
      "（笑）",
    )
    .replace(/^[wｗ]{1,}(?=[\s。、！？!?…」』（(]|$)/gi, "（笑）");
}

/** 主流程收口：先去掉重复追问，再按模式/语言决定黄卡字段 */
function finalizeTurn(turn, mode, lang) {
  if (turn && typeof turn.reply_ja === "string") turn.reply_ja = normalizeLaugh(turn.reply_ja);
  if (turn && typeof turn.next_question_ja === "string") turn.next_question_ja = normalizeLaugh(turn.next_question_ja);
  normalizeFollowUp(turn);
  return applyCardPolicy(turn, mode, lang);
}

module.exports = { normalizeFollowUp, normalizeLaugh, orderAlternatives, cardAllowed, applyCardPolicy, finalizeTurn };
