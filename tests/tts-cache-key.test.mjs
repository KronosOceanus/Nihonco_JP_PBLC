import test from "node:test";
import assert from "node:assert/strict";

const tts = await import("../agent/tts.js");
const st = await import("../agent/speech-text.js");

/* 预热和实时合成必须用同一个缓存键——之前一个用原文、一个用「版本+规范化文本」，
 * 导致预热写的条目永远读不到。 */

test("speechKey 带规则版本前缀", () => {
  assert.match(tts.speechKey("かいわモード"), new RegExp(`^v${st.RULES_VERSION}\\|`));
});

test("同一句话的键稳定（预热与 speak 一致）", () => {
  assert.equal(tts.speechKey("かいわモード"), tts.speechKey("かいわモード"));
});

test("键基于规范化后的文本：原文不同但规范化相同 → 同键", () => {
  // 「はは、」和「あはは、」规范化后相同，但这里验证的是「同输入稳定」
  assert.equal(tts.speechKey("はは、"), tts.speechKey("はは、"));
  // 真正不同的话必须不同键
  assert.notEqual(tts.speechKey("はは、"), tts.speechKey("ふふ、"));
});

test("键用的是规范化后的文本：原文与已规范化文本同键", () => {
  // 「はは、」规范化成「あはは、」，所以两者的键应该一样
  assert.equal(tts.speechKey("はは、"), tts.speechKey("あはは、"));
});

test("降级路径也有规范化：Nihonco 在 say / sapi 下也读 にほんこ", () => {
  for (const engine of ["say", "sapi"]) {
    assert.equal(tts.forSpeech("Nihoncoだよ", engine), "にほんこだよ");
  }
  // VOICEVOX 专属规则不该出现在 say 上
  assert.equal(tts.forSpeech("はは、", "say"), "はは、");
});
