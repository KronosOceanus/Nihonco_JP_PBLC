import test from "node:test";
import assert from "node:assert/strict";
import { enrichPrompt } from "../agent/prompt.js";

test("例句 prompt 带上目标词等级与难度约束", () => {
  const p = enrichPrompt([{ ja: "洋服", kana: "ようふく", zh: "衣服", pos: "名", level: "N5–N4" }]);
  assert.match(p, /洋服（ようふく）衣服 名 N5–N4/);
  assert.match(p, /语法和词汇不要超过目标词的等级/);
});

test("没有等级的条目不会拼出多余空格", () => {
  const p = enrichPrompt([{ ja: "猫", kana: "ねこ", zh: "猫", pos: "名" }]);
  assert.match(p, /猫（ねこ）猫 名\n/);
});
