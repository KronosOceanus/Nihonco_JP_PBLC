import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../agent/memory.js";
import { buildPrompt, normalizePatches, extract } from "../agent/memory-extract.js";

function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-extract-"));
  return { dir, m: new MemoryStore({ dataDir: dir }) };
}

test("提取 prompt 只带最近用户发言和当前记忆", () => {
  const msgs = buildPrompt({
    recent: ["我喜欢电影", "最近在准备考试"],
    snapshot: { profile: { interests: ["动画"] }, episodes: [] },
  });
  assert.match(msgs[1].content, /我喜欢电影/);
  assert.match(msgs[1].content, /最近在准备考试/);
  assert.match(msgs[1].content, /动画/);
});

test("过滤低置信度、未知 profile key、空摘要", () => {
  const patches = normalizePatches({
    patches: [
      { op: "add", type: "profile", key: "interests", value: "电影", confidence: 0.9 },
      { op: "add", type: "profile", key: "password", value: "x", confidence: 0.9 },
      { op: "add", type: "episode", data: { summary: "下周考试", tags: ["考试"] }, confidence: 0.8 },
      { op: "add", type: "episode", data: { summary: "" }, confidence: 0.9 },
      { op: "delete", type: "profile", key: "goals", value: "x", confidence: 0.1 },
    ],
  });
  assert.equal(patches.length, 2);
  assert.equal(patches[0].value, "电影");
  assert.equal(patches[1].data.summary, "下周考试");
});

test("称呼读音单独提取；年龄和非法等级被丢弃", () => {
  const patches = normalizePatches({
    patches: [
      { op: "update", type: "profile", key: "nickname", value: "山田", confidence: 0.9 },
      { op: "update", type: "profile", key: "nickname_reading", value: "やまだ", confidence: 0.9 },
      { op: "update", type: "profile", key: "level", value: "27岁", confidence: 0.9 },
      { op: "add", type: "profile", key: "interests", value: "27岁", confidence: 0.9 },
    ],
  });
  assert.equal(patches.length, 2);
  assert.deepEqual(patches.map((p) => [p.key, p.value]), [
    ["nickname", "山田"],
    ["nickname_reading", "やまだ"],
  ]);
});

test("extract 通过 callJson 应用 patch，不直接信任模型写文件", async () => {
  const { m } = temp();
  const fake = async () => ({
    patches: [
      { op: "add", type: "profile", key: "nickname", value: "阿林", confidence: 0.95 },
      { op: "add", type: "episode", data: { topic: "考试", summary: "下周要考 N3", tags: ["考试", "試験"] }, confidence: 0.9 },
    ],
  });
  const r = await extract({
    recent: ["叫我阿林", "下周要考 N3"],
    snapshot: m.snapshot(),
    memory: m,
    callJson: fake,
  });
  assert.equal(r.ok, true);
  assert.equal(r.patches.length, 2);
  assert.equal(m.snapshot().profile.nickname, "阿林");
  assert.equal(m.snapshot().episodes.length, 1);
});

test("提取失败不抛到聊天主流程", async () => {
  const { m } = temp();
  const r = await extract({
    recent: ["测试"],
    snapshot: m.snapshot(),
    memory: m,
    callJson: async () => { throw new Error("offline"); },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /offline/);
});
