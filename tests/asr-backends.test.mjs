import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mod = await import("../agent/asr-backends.js");

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-asrbe-"));
  // whisper.cpp 模型目录
  fs.mkdirSync(path.join(root, ".whisper", "models"), { recursive: true });
  fs.writeFileSync(path.join(root, ".whisper", "models", "ggml-small-q5_1.bin"), Buffer.alloc(1024));
  fs.writeFileSync(path.join(root, ".whisper", "models", "ggml-large-v3-turbo-q5_0.bin"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(root, ".whisper", "models", "notes.txt"), "x");   // 非模型文件
  // HF 缓存：一个就绪、一个只有元数据
  const hub = path.join(root, ".hf-cache", "hub");
  const ready = path.join(hub, "models--mlx-community--whisper-small-mlx", "snapshots", "abc");
  fs.mkdirSync(ready, { recursive: true });
  fs.writeFileSync(path.join(ready, "weights.npz"), "x");
  const partial = path.join(hub, "models--mlx-community--whisper-large-v3-turbo", "snapshots", "def");
  fs.mkdirSync(partial, { recursive: true });
  fs.writeFileSync(path.join(partial, "config.json"), "{}");
  return root;
}

test("列出 whisper.cpp 模型：只认 .bin，带体积标签", () => {
  const root = mkRoot();
  const list = mod.wcppModels(root);
  // 按体积由小到大：q5_1(1024B) 在 turbo(2048B) 前面
  assert.deepEqual(list.map((m) => m.value),
    ["ggml-small-q5_1.bin", "ggml-large-v3-turbo-q5_0.bin"]);
  assert.match(list[0].label, /MB/);
  assert.ok(list[0].bytes <= list[1].bytes, "列表要按体积升序");
});

test("列出 mlx 模型：只把有 weights 的标成 ready", () => {
  const root = mkRoot();
  const list = mod.mlxModels(root);
  const small = list.find((m) => m.value.includes("small-mlx"));
  const turbo = list.find((m) => m.value.includes("large-v3-turbo"));
  assert.equal(small.ready, true);
  assert.equal(turbo.ready, false);
  assert.equal(list[0].ready, true, "就绪的排在前面");
  assert.equal(mod.mlxModelReady("mlx-community/whisper-small-mlx", root), true);
  assert.equal(mod.mlxModelReady("mlx-community/whisper-large-v3-turbo", root), false);
});

test("available()：后端必须同时有运行环境和就绪模型", () => {
  const root = mkRoot();
  const av = mod.available(root);
  assert.equal(av.mlx, false, "有 mlx 模型但没有 venv → 不可用");
  assert.equal(av.wcpp, false, "有模型但没二进制 → 不可用");
  assert.equal(av.wcppBin, false);

  // Windows 不支持 mlx：有 venv 也不能变成可用
  const bin = path.join(root, ".venv", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "python"), "x");
  if (process.platform === "win32") {
    assert.equal(mod.available(root).mlx, false, "Windows 上 mlx 永远不可用");
  } else {
    assert.equal(mod.available(root).mlx, true);

    // 只有 venv、模型没就绪 → 仍不可用
    const snap = path.join(root, ".hf-cache", "hub",
      "models--mlx-community--whisper-small-mlx", "snapshots", "abc");
    fs.rmSync(path.join(snap, "weights.npz"));
    assert.equal(mod.available(root).mlx, false, "缺模型时 mlx 不能算可用");
  }
});

test("available()：二进制 + 至少一个模型才算可用", () => {
  const root = mkRoot();
  // 二进制名跟平台走：Windows 上是 whisper-server.exe
  const BIN = process.platform === "win32" ? "whisper-server.exe" : "whisper-server";
  fs.writeFileSync(path.join(root, ".whisper", BIN), "x");
  const av = mod.available(root);
  assert.equal(av.wcppBin, true);
  assert.equal(av.wcppModels, 2);
  assert.equal(av.wcpp, true);

  // 只有二进制、没有模型 → 仍不可用
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-asrbe2-"));
  fs.mkdirSync(path.join(root2, ".whisper"), { recursive: true });
  fs.writeFileSync(path.join(root2, ".whisper", BIN), "x");
  assert.equal(mod.available(root2).wcpp, false);
});

test("后端不可用时带 hint（告诉用户跑哪个命令）", () => {
  const root = mkRoot();
  const i = mod.info(root);
  const cpp = i.backends.find((b) => b.id === "whispercpp");
  assert.equal(cpp.available, false);
  assert.match(cpp.hint, /setup:whisper|models/);
});

test("info()：给每个后端算最小模型作为默认", () => {
  const root = mkRoot();
  const i = mod.info(root);
  assert.equal(i.defaults.whispercpp, "ggml-small-q5_1.bin", "默认选体积最小的");
  assert.equal(i.defaults.mlx, "mlx-community/whisper-small-mlx");
});

test("info()：返回后端列表、隐藏 Windows 专属项之外的清单", () => {
  const root = mkRoot();
  const i = mod.info(root);
  assert.deepEqual(i.backends.map((b) => b.id),
    process.platform === "win32" ? ["whispercpp"] : ["whispercpp", "mlx"]);
  assert.ok(i.wcppModels.length === 2);
  assert.ok(typeof i.backend === "string");
});

test("whispercpp 后端下 HF 仓库名会被规整成最小模型，并标记 misplaced", () => {
  const root = mkRoot();
  const prevB = process.env.ASR_BACKEND, prevM = process.env.ASR_MODEL;
  process.env.ASR_BACKEND = "whispercpp";
  process.env.ASR_MODEL = "mlx-community/whisper-small-mlx";   // 不适用于 whisper.cpp
  try {
    const i = mod.info(root);
    assert.equal(i.model, "ggml-small-q5_1.bin", "显示成最小模型");
    assert.equal(i.rawModel, "mlx-community/whisper-small-mlx");
    assert.equal(i.misplacedModel, true);
  } finally {
    if (prevB === undefined) delete process.env.ASR_BACKEND; else process.env.ASR_BACKEND = prevB;
    if (prevM === undefined) delete process.env.ASR_MODEL; else process.env.ASR_MODEL = prevM;
  }
});

test("whispercpp：.env 指定的模型缺失时回退并标记", () => {
  const root = mkRoot();
  const prevB = process.env.ASR_BACKEND, prevM = process.env.ASR_MODEL;
  process.env.ASR_BACKEND = "whispercpp";
  process.env.ASR_MODEL = "ggml-missing.bin";
  try {
    const i = mod.info(root);
    assert.equal(i.rawModel, "ggml-missing.bin");
    assert.equal(i.missingModel, true);
    assert.notEqual(i.model, "ggml-missing.bin");
  } finally {
    if (prevB === undefined) delete process.env.ASR_BACKEND; else process.env.ASR_BACKEND = prevB;
    if (prevM === undefined) delete process.env.ASR_MODEL; else process.env.ASR_MODEL = prevM;
  }
});
