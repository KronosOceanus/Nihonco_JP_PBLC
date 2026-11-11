import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* 会話记忆的几条硬约束（源码级守卫）：
 *  - 历史保留 16 轮（32 条），不是以前的 8 条
 *  - assistant 历史存 JSON（开了 response_format=json_object，纯文本会让模型返回空）
 *  - 切模式不再清空历史
 */

const ipc = fs.readFileSync(new URL("../main/ipc.js", import.meta.url), "utf8")
  + fs.readFileSync(new URL("../main/ipc/pet.js", import.meta.url), "utf8");
const llm = fs.readFileSync(new URL("../agent/llm.js", import.meta.url), "utf8");
const appUi = fs.readFileSync(new URL("../renderer/app-ui.js", import.meta.url), "utf8")
  .replace(/\/\/[^\n]*/g, "");   // 去掉注释，避免注释里提到 chatReset 造成误判

test("历史保留 32 条消息（16 轮）", () => {
  assert.match(ipc, /chatHistory\.length > 32/);
  assert.match(ipc, /chatHistory\.slice\(-32\)/);
});

test("assistant 历史存 JSON 形状（不能是纯文本）", () => {
  assert.match(ipc, /JSON\.stringify\(brief\)/);
  assert.match(ipc, /reply_ja:\s*t0\.reply_ja/);
});

test("切模式不再调用 chatReset", () => {
  const setModeBlock = appUi.slice(appUi.indexOf("async function setMode"), appUi.indexOf("async function setMode") + 4000);
  assert.doesNotMatch(setModeBlock, /chatReset\s*\(/);
});

test("发给模型的历史是最近 16 条消息", () => {
  assert.match(llm, /history\.slice\(-16\)/);
});
