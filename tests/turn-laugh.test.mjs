import test from "node:test";
import assert from "node:assert/strict";
import { finalizeTurn, normalizeLaugh } from "../agent/turn.js";
import { CONV } from "../agent/persona-scenes.js";

test("单独的 w/ｗ 在显示前变成（笑）", () => {
  assert.equal(normalizeLaugh("天才さんｗ で"), "天才さん（笑） で");
  assert.equal(normalizeLaugh("天才さんw で"), "天才さん（笑） で");
  assert.equal(normalizeLaugh("www すごい"), "（笑） すごい");
  assert.equal(normalizeLaugh("Webを開く"), "Webを開く");
});

test("finalizeTurn 归一化 reply_ja 与追问", () => {
  const t = finalizeTurn({
    reply_ja: "はいはいｗ",
    next_question_ja: "で、何するｗ",
    corrections: [], explain_zh: "", words: [],
  }, "conv", "ja");
  assert.equal(t.reply_ja, "はいはい（笑）");
  assert.equal(t.next_question_ja, "で、何する（笑）");
});

test("few-shot 不再示范 w", () => {
  const replies = CONV.filter((x) => x.role === "assistant").map((x) => JSON.parse(x.content).reply_ja);
  for (const s of replies) assert.doesNotMatch(s, /天才さん[ｗw]/);
});
