import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFollowUp } from "../agent/turn.js";

test("追问已包含在 reply_ja 里 → 清掉 next_question", () => {
  const t = normalizeFollowUp({
    reply_ja: "うん、解説モードね。映画は何の話だった？",
    reply_zh: "嗯，讲解模式啊。电影是什么故事？",
    next_question_ja: "映画は何の話だった？",
    next_question_zh: "电影是什么故事？",
  });
  assert.equal(t.next_question_ja, "");
  assert.equal(t.next_question_zh, "");
});

test("标点/空白不同也能认出重复", () => {
  const t = normalizeFollowUp({
    reply_ja: "そうだね。週末は 何する？",
    reply_zh: "是呢。周末做什么？",
    next_question_ja: "週末は何する",
    next_question_zh: "周末做什么",
  });
  assert.equal(t.next_question_ja, "");
  assert.equal(t.next_question_zh, "");
});

test("追问不同 → 保留", () => {
  const t = normalizeFollowUp({
    reply_ja: "いいね、それで？",
    reply_zh: "不错，然后呢？",
    next_question_ja: "週末は何する？",
    next_question_zh: "周末做什么？",
  });
  assert.equal(t.next_question_ja, "週末は何する？");
  assert.equal(t.next_question_zh, "周末做什么？");
});

test("只有中文重复 → 只清 next_question_zh", () => {
  const t = normalizeFollowUp({
    reply_ja: "はい。",
    reply_zh: "电影是什么故事？",
    next_question_ja: "映画は？",
    next_question_zh: "电影是什么故事？",
  });
  assert.equal(t.next_question_ja, "映画は？");
  assert.equal(t.next_question_zh, "");
});

test("黄卡只属于 解説 + 日语输入", async () => {
  const { cardAllowed, applyCardPolicy } = await import("../agent/turn.js");
  assert.equal(cardAllowed("teach", "ja"), true);
  assert.equal(cardAllowed("teach", "zh"), false);
  assert.equal(cardAllowed("conv", "ja"), false);
  assert.equal(cardAllowed("conv", "zh"), false);

  const base = () => ({ corrections: [{ wrong: "a", right: "b", why_zh: "c" }], explain_zh: "d", words: [{ ja: "e" }] });
  const keep = applyCardPolicy(base(), "teach", "ja");
  assert.equal(keep.corrections.length, 1);
  assert.equal(keep.explain_zh, "d");
  assert.equal(keep.words.length, 1);

  for (const [mode, lang] of [["teach", "zh"], ["conv", "ja"], ["conv", "zh"]]) {
    const t = applyCardPolicy(base(), mode, lang);
    assert.deepEqual(t.corrections, []);
    assert.equal(t.explain_zh, "");
    assert.deepEqual(t.words, []);
  }
});

test("finalizeTurn：追问去重 + 黄卡规则一起生效", async () => {
  const { finalizeTurn } = await import("../agent/turn.js");
  const dup = () => ({
    reply_ja: "うん。映画は何の話だった？",
    reply_zh: "嗯。电影是什么故事？",
    next_question_ja: "映画は何の話だった？",
    next_question_zh: "电影是什么故事？",
    corrections: [{ wrong: "a", right: "b", why_zh: "c" }],
    explain_zh: "d",
    words: [{ ja: "e" }],
  });

  const teach = finalizeTurn(dup(), "teach", "ja");
  assert.equal(teach.next_question_ja, "");
  assert.equal(teach.next_question_zh, "");
  assert.equal(teach.corrections.length, 1, "解説+日语保留黄卡");

  const conv = finalizeTurn(dup(), "conv", "zh");
  assert.equal(conv.next_question_ja, "", "追问仍然去重");
  assert.deepEqual(conv.corrections, []);
  assert.equal(conv.explain_zh, "");
  assert.deepEqual(conv.words, [], "非 解説+日语 清空黄卡");
});
