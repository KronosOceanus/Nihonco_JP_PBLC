import test from "node:test";
import assert from "node:assert/strict";
import { NET_TERMS, promptBlock } from "../agent/slang.js";
import { systemPrompt } from "../agent/prompt.js";

test("网络用语表包含关键梗与假名提示", () => {
  const text = promptBlock();
  for (const term of ["雑魚", "ざこ", "草", "ぴえん", "エモい", "それな", "りょ", "ワンチャン", "〜すぎ"]) {
    assert.ok(text.includes(term), `缺少 ${term}`);
  }
  assert.ok(text.includes("カナだけ"));
  assert.ok(text.length < 250, `slang 块过长：${text.length} 字符`);
});

test("会話 prompt 使用 slang；解説 prompt 不发送俚语表", () => {
  const conv = systemPrompt("conv", "N5");
  const teach = systemPrompt("teach", "N5");
  assert.ok(conv.includes(promptBlock()));
  assert.ok(!conv.includes("issues.log"));
  assert.ok(!teach.includes(promptBlock()));
});

test("词条结构完整", () => {
  for (const t of NET_TERMS) {
    assert.ok(t.ja && t.meaning);
  }
});
