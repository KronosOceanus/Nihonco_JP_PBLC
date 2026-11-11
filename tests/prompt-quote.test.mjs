import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* 模型会把用户说的拟声词改写（ふわふわ → ふわはわ），TTS 就照着念错。
 * 这里守住提示词里的「逐字引用」约束，别在后续改动中被删掉。 */
const src = [
  fs.readFileSync(new URL("../agent/prompt.js", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../agent/persona.js", import.meta.url), "utf8"),
].join("\n");

test("提示词要求引用原话时逐字照抄（含假名/拟声词）", () => {
  assert.match(src, /一字一句/);
  assert.match(src, /ふわはわ/);
  assert.match(src, /オノマトペ|拟声词/);
});

test("名字只写 Nihonco：不许因为「避开罗马字」改写成假名", () => {
  assert.match(src, /名前は必ず \*\*「Nihonco」\*\*/);
  assert.doesNotMatch(src, /ローマ字を避けて/, "删掉「可以避开罗马字」的放行条款");
});

test("夸奖口径统一：值得时才具体肯定，不为了给而给", () => {
  assert.match(src, /具体的に/);
  assert.match(src, /無理にほめない|不要硬夸|为了给反馈而给反馈/);
  assert.doesNotMatch(src, /褒め言葉は入れない/);
});
