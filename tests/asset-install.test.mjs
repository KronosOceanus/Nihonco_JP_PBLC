import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mod = await import("../agent/asset-install.js");

function mk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-asset-"));
  const src = path.join(root, "src");
  fs.mkdirSync(src);
  return { root, src };
}

test("资源安装：Core 复制到 lib/", () => {
  const { root, src } = mk();
  const file = path.join(src, "live2dcubismcore.min.js");
  fs.writeFileSync(file, "core");
  const r = mod.install({ kind: "core", src: file, root, app: null });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(root, "lib/live2dcubismcore.min.js"), "utf8"), "core");
});

test("资源安装：ASR .bin 复制到 .whisper/models/", () => {
  const { root, src } = mk();
  const file = path.join(src, "ggml-small-q5_1.bin");
  fs.writeFileSync(file, "model");
  const r = mod.install({ kind: "asr", src: file, root, app: null });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(root, ".whisper/models/ggml-small-q5_1.bin"), "utf8"), "model");
});

test("打包 asar：ASR .bin 落到 userData/whisper/models，不写 app.asar（.whisper 只读）", () => {
  const { root, src } = mk();
  const asarRoot = path.join(root, "resources", "app.asar");
  const userData = path.join(root, "userData");
  const file = path.join(src, "ggml-medium-q5_0.bin");
  fs.writeFileSync(file, "model");
  const target = path.join(userData, "whisper", "models", "ggml-medium-q5_0.bin");

  const prevEnv = process.env.NIHONCO_WHISPER_MODELS;
  delete process.env.NIHONCO_WHISPER_MODELS;          // 用 userData 推导，别被跑测试的 shell 影响
  try {
    const pv = mod.preview({ kind: "asr", src: file, root: asarRoot, userData });
    assert.equal(pv.target, target);

    const r = mod.install({ kind: "asr", src: file, root: asarRoot, userData });
    assert.equal(r.ok, true);
    assert.equal(r.path, target);
    assert.ok(fs.existsSync(target));
    assert.ok(!r.path.includes("app.asar"));
  } finally {
    if (prevEnv !== undefined) process.env.NIHONCO_WHISPER_MODELS = prevEnv;
  }
});

test("打包 asar：Core 改写到 assetsDir，不写 app.asar", () => {
  const { root, src } = mk();
  const asarRoot = path.join(root, "resources", "app.asar");
  const assetsDir = path.join(root, "userData", "assets");
  const file = path.join(src, "live2dcubismcore.min.js");
  fs.writeFileSync(file, "core");
  const r = mod.install({ kind: "core", src: file, root: asarRoot, assetsDir, userData: path.join(root, "userData") });
  assert.equal(r.ok, true);
  assert.equal(r.path, path.join(assetsDir, "lib", "live2dcubismcore.min.js"));
  assert.ok(fs.existsSync(r.path));
  assert.ok(!r.path.includes("app.asar"));
});

test("打包 asar：预览 Core 也显示 assetsDir", () => {
  const { root, src } = mk();
  const asarRoot = path.join(root, "resources", "app.asar");
  const assetsDir = path.join(root, "userData", "assets");
  const file = path.join(src, "live2dcubismcore.min.js");
  fs.writeFileSync(file, "core");
  const r = mod.preview({ kind: "core", src: file, root: asarRoot, assetsDir, userData: path.join(root, "userData") });
  assert.equal(r.target, path.join(assetsDir, "lib", "live2dcubismcore.min.js"));
  assert.ok(!r.target.includes("app.asar"));
});

test("资源安装：拒绝错误文件类型", () => {
  const { root, src } = mk();
  const file = path.join(src, "wrong.txt");
  fs.writeFileSync(file, "x");
  assert.throws(() => mod.install({ kind: "core", src: file, root, app: null }), /live2dcubismcore/);
  assert.throws(() => mod.install({ kind: "asr", src: file, root, app: null }), /ggml/);
});
