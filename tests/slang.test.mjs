import test from "node:test";
import assert from "node:assert/strict";
import { NET_TERMS, promptBlock } from "../agent/slang.js";
import { systemPrompt } from "../agent/prompt.js";

test("网络用语只注入命中的词条；没命中只保留假名提示", () => {
  const none = promptBlock("今日は何を食べた？");
  assert.ok(none.includes("カナだけ"));
  assert.ok(!none.includes("雑魚"));
  assert.ok(!none.includes("ぴえん"));

  const text = promptBlock("草とぴえんだよ、それは雑魚");
  for (const term of ["雑魚", "ざこ", "草", "ぴえん"]) {
    assert.ok(text.includes(term), `缺少 ${term}`);
  }
  assert.ok(!text.includes("エモい"), "没命中的词不应该注入");
  assert.ok(text.includes("カナだけ"));
  assert.ok(text.length < 250, `slang 块过长：${text.length} 字符`);
});

test("会話 prompt 使用 slang；解説 prompt 不发送俚语表", () => {
  const conv = systemPrompt("conv", "N5", "草");
  const teach = systemPrompt("teach", "N5", "草");
  assert.ok(conv.includes(promptBlock("草")));
  assert.ok(!conv.includes("issues.log"));
  assert.ok(!teach.includes(promptBlock("草")));
});

test("词条结构完整", () => {
  for (const t of NET_TERMS) {
    assert.ok(t.ja && t.meaning);
  }
});
