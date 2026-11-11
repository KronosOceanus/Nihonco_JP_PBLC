import test from "node:test";
import assert from "node:assert/strict";
import { systemPrompt } from "../agent/prompt.js";
import { casualPrompt } from "../agent/persona.js";
import { CONV, forMode } from "../agent/persona-scenes.js";

test("会話 prompt 使用正向人格卡", () => {
  const s = systemPrompt("conv", "N5");
  assert.match(s, /Nihonco/);
  assert.match(s, /ツッコミ/);
  assert.match(s, /落ち込んで/);
  assert.match(s, /next_question_ja/);
  assert.match(s, /無理にほめない/);
});

test("未知 mode 直接抛错，不静默回落到会話", () => {
  assert.throws(() => systemPrompt("word", "N5"), /unknown prompt mode: word/);
  assert.throws(() => systemPrompt("pattern", "N5"), /unknown prompt mode: pattern/);
});

test("记忆只作背景，不能冒充用户原话", () => {
  const s = systemPrompt("conv", "N5");
  assert.match(s, /记忆是背景资料/);
  assert.match(s, /不要生成「你刚才说」/);
});

test("解説 prompt 保留中文讲解和等级", () => {
  const s = systemPrompt("teach", "N4");
  assert.match(s, /中文/);
  assert.match(s, /JLPT N4/);
  assert.match(s, /JSON/);
});

test("会話 few-shot 不带黄卡内容", () => {
  for (const m of CONV.filter((x) => x.role === "assistant")) {
    const j = JSON.parse(m.content);
    assert.deepEqual(j.corrections, []);
    assert.equal(j.explain_zh, "");
    assert.deepEqual(j.words, []);
  }
});

test("few-shot 只保留 3 组高信号样本", () => {
  assert.equal(CONV.length / 2, 3);
  const s = JSON.stringify(forMode("conv"));
  assert.match(s, /寝坊/);
  assert.match(s, /落ち込んで/);
  assert.match(s, /うん/);
});

test("主动搭话也使用同一套人格与边界", () => {
  const s = casualPrompt();
  assert.match(s, /Nihonco/);
  assert.match(s, /説教/);
  assert.match(s, /1 回まで|1 つまで/);
});
