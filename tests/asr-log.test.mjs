import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-asrlog-"));
process.env.NIHONCO_DATA_DIR = dir;
process.env.NIHONCO_ASR_LOG_FILE = path.join(dir, "asr.log");
process.env.ASR_LOG_MAX = "600";
process.env.ASR_LOG = "1";
const log = await import("../agent/asr-log.js");

const read = (f) => fs.readFileSync(f, "utf8");

test("默认开启：写一行带耗时/字节/引擎/文本", () => {
  log.record({ ms: 1834, bytes: 24576, lang: "ja", engine: "whisper.cpp", prompt: 12, text: "今日は寒いですね" });
  const t = read(log.FILE);
  assert.match(t, /1\.83s/);
  assert.match(t, /24576B/);
  assert.match(t, /whisper\.cpp/);
  assert.match(t, /prompt=12/);
  assert.match(t, /今日は寒いですね/);
});

test("ASR_LOG=0 时不写", () => {
  const before = read(log.FILE);
  process.env.ASR_LOG = "0";
  assert.equal(log.enabled(), false);
  assert.equal(log.record({ ms: 1, bytes: 1, text: "x" }), false);
  assert.equal(read(log.FILE), before);
  process.env.ASR_LOG = "1";
});

test("超过上限会轮转到 .1", () => {
  for (let i = 0; i < 12; i++) {
    log.record({ ms: 100 + i, bytes: 1000, text: "填充" + i });
  }
  assert.ok(fs.existsSync(log.FILE + ".1"), "应该生成 asr.log.1");
  assert.ok(fs.statSync(log.FILE).size <= log.MAX_BYTES + 400, "当前日志不应无限增长");
});

test("tail 能拿到最近几行", () => {
  const t = log.tail(3);
  assert.ok(t.split("\n").length <= 3);
});
