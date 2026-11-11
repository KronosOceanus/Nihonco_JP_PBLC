import test from "node:test";
import assert from "node:assert/strict";

const { parseTurn } = await import("../agent/llm.js");

/* 模型偶尔会输出坏 JSON（裸换行、被截断、夹说明文字）。
 * 约束：绝不把 JSON 原样当回复贴进气泡；能救的字段要救出来。 */

test("正常 JSON", () => {
  const r = parseTurn('{"reply_ja":"はい","reply_zh":"好"}');
  assert.equal(r.reply_ja, "はい");
  assert.equal(r.reply_zh, "好");

  const capped = parseTurn(JSON.stringify({
    reply_ja: "はい",
    corrections: [
      { wrong: "a", right: "b", why_zh: "x" },
      { wrong: "c", right: "d", why_zh: "y" },
    ],
  }));
  assert.equal(capped.corrections.length, 1, "黄卡最多 1 条纠错");
});

test("```json 围栏也能解析", () => {
  const r = parseTurn('```json\n{"reply_ja":"はい","reply_zh":"好"}\n```');
  assert.equal(r.reply_ja, "はい");
});

test("字符串里有裸换行（未转义）→ 清理后仍能解析", () => {
  const r = parseTurn('{"reply_ja":"はい\n元気？","reply_zh":"好"}');
  assert.match(r.reply_ja, /はい/);
  assert.equal(r.reply_zh, "好");
  assert.ok(!r.reply_ja.startsWith("{"), "解析成功时不该是 JSON 原文");
});

test("被截断的 JSON → 抠出已写好的字段，不返回 JSON 原文", () => {
  const r = parseTurn('{"reply_ja":"こんにちは","reply_zh":"你好","words":[{"ja":"x","zh');
  assert.equal(r.reply_ja, "こんにちは");
  assert.equal(r.reply_zh, "你好");
  assert.ok(!r.reply_ja.startsWith("{"), "不能把 JSON 贴给用户");
});

test("JSON 形状但抠不出字段 → 给自然兜底，不是 JSON 原文", () => {
  const r = parseTurn('{"reply_ja": ');
  assert.ok(!r.reply_ja.includes("reply_ja"), "兜底也不能含 JSON 字段名");
  assert.ok(r.reply_ja.length > 0);
});

test("非 JSON 的纯文本 → 当作日语回复", () => {
  const r = parseTurn("こんにちは！");
  assert.equal(r.reply_ja, "こんにちは！");
});
