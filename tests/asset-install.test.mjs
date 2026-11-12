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

test("打包 asar：ASR 模型改写到 whisperModelsDir", () => {
  const { root, src } = mk();
  const asarRoot = path.join(root, "resources", "app.asar");
  const whisperModelsDir = path.join(root, "userData", ".whisper", "models");
  const file = path.join(src, "ggml-small-q5_1.bin");
  fs.writeFileSync(file, "model");
  const r = mod.install({ kind: "asr", src: file, root: asarRoot, assetsDir: path.join(root, "userData", "assets"), userData: path.join(root, "userData"), whisperModelsDir });
  assert.equal(r.ok, true);
  assert.equal(r.path, path.join(whisperModelsDir, "ggml-small-q5_1.bin"));
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
