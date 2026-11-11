import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Windows 侧模型解析：ASR_MODEL 指的是模型名，找不到会回落到目录里任意 .bin。
 * 原来这个回落是静默的，现在要求：findModel 能报出「回落了、为什么」。 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-whisper-"));
fs.mkdirSync(path.join(home, "models"), { recursive: true });
fs.writeFileSync(path.join(home, "models", "ggml-small.bin"), "x");

process.env.WHISPER_HOME = home;
process.env.ASR_MODEL = "medium";           // 目录里没有 medium
delete process.env.ASR_MODEL_FILE;

const mod = await import("../agent/asr-whispercpp.js?resolve-test");

test("指定的模型不存在 → 回落到目录里任意 .bin，并标记 fallback", () => {
  const p = mod.findModel();
  assert.equal(path.basename(p), "ggml-small.bin");
  const info = mod.resolveInfo();
  assert.equal(info.fallback, true);
  assert.match(info.reason, /medium/);
  assert.match(info.reason, /回落/);
});

test("指定的模型存在 → 不标记 fallback", () => {
  process.env.ASR_MODEL = "small";
  const p = mod.findModel();
  assert.equal(path.basename(p), "ggml-small.bin");
  assert.equal(mod.resolveInfo().fallback, false);
});

test("HF 仓库名（带斜杠）当没配置处理 → 用最小的 .bin", () => {
  process.env.ASR_MODEL = "mlx-community/whisper-small-mlx";
  const p = mod.findModel();
  assert.equal(path.basename(p), "ggml-small.bin", "目录里只有一个模型，就是它");
  const info = mod.resolveInfo();
  assert.equal(info.fallback, false, "不是回落失败，是当作未配置");
  assert.equal(info.want, "(未设置)");
  assert.match(info.reason, /未设置|最小/);
});

test("没设置 ASR_MODEL → 选 models 目录里最小的 .bin", () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-whisper2-"));
  fs.mkdirSync(path.join(dir2, "models"), { recursive: true });
  fs.writeFileSync(path.join(dir2, "models", "ggml-small-q5_1.bin"), "x");                 // 最小
  fs.writeFileSync(path.join(dir2, "models", "ggml-large-v3-turbo-q5_0.bin"), "x".repeat(50));
  const prevHome = process.env.WHISPER_HOME;
  const prevModel = process.env.ASR_MODEL;
  process.env.WHISPER_HOME = dir2;
  process.env.ASR_MODEL = "";          // 显式空 = 没配置
  try {
    const p = mod.findModel();
    assert.equal(path.basename(p), "ggml-small-q5_1.bin");
    assert.equal(mod.resolveInfo().fallback, false);
    assert.match(mod.resolveInfo().reason, /最小的/);
  } finally {
    process.env.WHISPER_HOME = prevHome;
    if (prevModel === undefined) delete process.env.ASR_MODEL; else process.env.ASR_MODEL = prevModel;
  }
});
