import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");
const mod = await import("../agent/asset-install.js");

function mk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-asset-"));
  const src = path.join(root, "src");
  fs.mkdirSync(src);
  return { root, src };
}

test("资产根：普通项目用 root，asar 包用 assetsDir", () => {
  assert.equal(mod.assetBase({ root: "/tmp/Nihonco", assetsDir: "/tmp/assets" }), "/tmp/Nihonco");
  assert.equal(mod.assetBase({ root: "/tmp/Nihonco/resources/app.asar", assetsDir: "/tmp/assets" }), "/tmp/assets");
});

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

test("CPU 包：识别并安装到 asr/cpu", () => {
  const { root, src } = mk();
  const zip = new AdmZip();
  for (const f of ["whisper-server.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu-avx2.dll"]) {
    zip.addFile("Release/" + f, Buffer.from("x"));
  }
  const file = path.join(src, "whisper-bin-x64.zip");
  zip.writeZip(file);
  assert.deepEqual(mod.cpuInfo(file), { kind: "whisper-cpu" });
  assert.equal(mod.classify(file, "win32"), "whisper-cpu");
  const asrDir = path.join(root, "asr");
  const p = mod.preview({ src: file, root, asrDir, platform: "win32" });
  assert.equal(p.kind, "whisper-cpu");
  assert.equal(p.target, path.join(asrDir, "cpu"));
  const r = mod.installWhisperCpu({ src: file, asrDir });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(r.path, "whisper-server.exe")));
});

test("platform 传模块对象时直接报错", () => {
  const { root, src } = mk();
  const file = path.join(src, "live2dcubismcore.min.js");
  fs.writeFileSync(file, "core");
  assert.throws(
    () => mod.preview({ src: file, root, platform: { IS_WIN: true } }),
    /platform 必须是/
  );
});

test("CUDA 包：按内容识别版本，只在 Windows 识别", () => {
  const { root, src } = mk();
  const zip = new AdmZip();
  zip.addFile("Release/whisper-server.exe", Buffer.from("exe"));
  zip.addFile("Release/ggml-cuda.dll", Buffer.from("gpu"));
  zip.addFile("Release/cudart64_12.dll", Buffer.from("cuda"));
  zip.addFile("Release/cublas64_12.dll", Buffer.from("cublas"));
  const file = path.join(src, "whisper-bin-win-cuda-12.4.0-x64.zip");
  zip.writeZip(file);
  assert.deepEqual(mod.cudaInfo(file), { id: "cuda-12.4" });
  assert.equal(mod.classify(file, "win32"), "cuda");
  assert.equal(mod.classify(file, "win32"), "cuda");
  assert.equal(mod.classify(file, "darwin"), "unknown");
  const p = mod.preview({ src: file, root, asrDir: path.join(root, "asr"), platform: "win32" });
  assert.equal(p.ok, true);
  assert.equal(p.kind, "cuda");
  assert.equal(p.target, path.join(root, "asr", "cuda-12.4"));
});

test("资源安装：拒绝错误文件类型", () => {
  const { root, src } = mk();
  const file = path.join(src, "wrong.txt");
  fs.writeFileSync(file, "x");
  assert.throws(() => mod.install({ kind: "core", src: file, root, app: null }), /live2dcubismcore/);
  assert.throws(() => mod.install({ kind: "asr", src: file, root, app: null }), /ggml/);
});
