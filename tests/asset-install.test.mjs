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

test("资源安装：拒绝错误文件类型", () => {
  const { root, src } = mk();
  const file = path.join(src, "wrong.txt");
  fs.writeFileSync(file, "x");
  assert.throws(() => mod.install({ kind: "core", src: file, root, app: null }), /live2dcubismcore/);
  assert.throws(() => mod.install({ kind: "asr", src: file, root, app: null }), /ggml/);
});
