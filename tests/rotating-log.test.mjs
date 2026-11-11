import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const log = await import("../agent/rotating-log.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-log-"));
const line = (i) => JSON.stringify({ at: new Date().toISOString(), i, pad: "x".repeat(200) });

test("追加会自动补换行并创建目录", () => {
  const dir = tmp();
  const file = path.join(dir, "a.log");
  log.append(file, line(1));
  log.append(file, line(2));
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.trimEnd().split("\n").length, 2);
  assert.ok(text.endsWith("\n"));
});

test("超过上限会轮转成 .1，且只保留一份", () => {
  const dir = tmp();
  const file = path.join(dir, "a.log");
  for (let i = 0; i < 40; i++) log.append(file, line(i), { maxBytes: 1024 });
  assert.ok(fs.existsSync(file + ".1"), "应该生成 .1");
  assert.ok(log.size(file) <= 1024 + 400, `当前文件不该无限增长（${log.size(file)}）`);
  for (let i = 0; i < 20; i++) log.append(file, line(100 + i), { maxBytes: 1024 });
  assert.ok(fs.existsSync(file + ".1"));
  assert.ok(!fs.existsSync(file + ".2"), "只留一份归档");
});

test("tail 返回最后几行", () => {
  const dir = tmp();
  const file = path.join(dir, "a.log");
  for (let i = 0; i < 5; i++) log.append(file, `line-${i}`);
  assert.equal(log.tail(file, 2), "line-3\nline-4");
});

test("文件不存在时 size/tail 不抛", () => {
  const dir = tmp();
  assert.equal(log.size(path.join(dir, "nope.log")), 0);
  assert.equal(log.tail(path.join(dir, "nope.log")), "");
});

test("rotateIfNeeded：未达上限不动", () => {
  const dir = tmp();
  const file = path.join(dir, "a.log");
  log.append(file, "small");
  assert.equal(log.rotateIfNeeded(file, 1024), false);
  assert.ok(!fs.existsSync(file + ".1"));
});
