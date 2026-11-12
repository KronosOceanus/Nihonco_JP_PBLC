import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mod = require("../agent/asset-install.js");

function mkZip(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-zip-"));
  const file = path.join(dir, "asset.zip");
  const z = new AdmZip();
  for (const [name, data] of Object.entries(files)) z.addFile(name, Buffer.from(data));
  z.writeZip(file);
  return { dir, file };
}
function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-zip-root-"));
}

test("zip：Live2D 模型安装到 model/<目录名>", () => {
  const { file } = mkZip({ "Hiyori/Hiyori.model3.json": "{}", "Hiyori/Hiyori.moc3": "x" });
  const root = mkRoot();
  const r = mod.install({ kind: "model", src: file, root, app: null });
  assert.equal(r.ok, true);
  assert.equal(r.path, path.join(root, "model", "Hiyori"));
  assert.ok(fs.existsSync(path.join(r.path, "Hiyori.model3.json")));
});

test("zip：VOICEVOX 安装到 .voicevox/extracted/VOICEVOX", () => {
  const { file } = mkZip({ "VOICEVOX/VOICEVOX.app/Contents/Resources/vv-engine/run": "x" });
  const root = mkRoot();
  const r = mod.install({ kind: "tts", src: file, root, app: null, platform: "darwin" });
  assert.equal(r.kind, "voicevox");
  assert.ok(fs.existsSync(path.join(root, ".voicevox/extracted/VOICEVOX/VOICEVOX.app/Contents/Resources/vv-engine/run")));
});

test("zip：AivisSpeech 保留 .app 目录层级", () => {
  const { file } = mkZip({ "AivisSpeech/AivisSpeech.app/Contents/Resources/AivisSpeech-Engine/run": "x" });
  const root = mkRoot();
  const r = mod.install({ kind: "tts", src: file, root, app: null, platform: "darwin" });
  assert.equal(r.kind, "aivis");
  assert.ok(fs.existsSync(path.join(root, ".aivis/AivisSpeech.app/Contents/Resources/AivisSpeech-Engine/run")));
});

test("zip：拒绝 Windows 盘符绝对路径", () => {
  const { file } = mkZip({ "C:/evil.txt": "x" });
  assert.throws(() => mod.install({ kind: "model", src: file, root: mkRoot(), app: null }), /非法路径/);
});

test("zip：模型 zip 没有 model3.json 时拒绝", () => {
  const { file } = mkZip({ "foo/readme.txt": "x" });
  assert.throws(() => mod.install({ kind: "model", src: file, root: mkRoot(), app: null }), /model3\.json/);
});

test("Windows：VOICEVOX 安装到 .voicevox/windows/VOICEVOX", () => {
  const { file } = mkZip({ "VOICEVOX/vv-engine/run.exe": "x" });
  const root = mkRoot();
  const r = mod.install({ kind: "tts", src: file, root, app: null, platform: "win32" });
  assert.equal(r.kind, "voicevox");
  assert.ok(fs.existsSync(path.join(root, ".voicevox/windows/VOICEVOX/vv-engine/run.exe")));
});

test("打包 asar：模型改写到 assetsDir；TTS 改写到 userData", () => {
  const root = mkRoot();
  const asarRoot = path.join(root, "resources", "app.asar");
  const userData = path.join(root, "userData");
  const assetsDir = path.join(userData, "assets");
  const { file: modelZip } = mkZip({ "Hiyori/Hiyori.model3.json": "{}" });
  const model = mod.install({ kind: "model", src: modelZip, root: asarRoot, assetsDir, userData });
  assert.equal(model.path, path.join(assetsDir, "model", "Hiyori"));
  const { file: ttsZip } = mkZip({ "VOICEVOX/vv-engine/run.exe": "x" });
  const tts = mod.install({ kind: "tts", src: ttsZip, root: asarRoot, assetsDir, userData, platform: "win32" });
  assert.equal(tts.kind, "voicevox");
  assert.ok(tts.path.startsWith(path.join(userData, ".voicevox")));
  assert.ok(!tts.path.includes("app.asar"));
});

test("Windows：Aivis 安装到 .aivis/AivisSpeech-Engine", () => {
  const { file } = mkZip({ "AivisSpeech-Engine/run.exe": "x" });
  const root = mkRoot();
  const r = mod.install({ kind: "tts", src: file, root, app: null, platform: "win32" });
  assert.equal(r.kind, "aivis");
  assert.ok(fs.existsSync(path.join(root, ".aivis/AivisSpeech-Engine/run.exe")));
});

test("Windows：Aivis 声线使用 appData 路径", () => {
  const dir = mkRoot();
  const src = path.join(dir, "mao.aivmx");
  fs.writeFileSync(src, "x");
  const root = mkRoot();
  const app = { getPath: (k) => k === "appData" ? path.join(dir, "AppData") : dir };
  const r = mod.install({ kind: "aivis-voice", src, root, app, platform: "win32" });
  assert.ok(fs.existsSync(path.join(dir, "AppData/AivisSpeech-Engine/Models/mao.aivmx")));
});

test("预览：Live2D zip 拖到 TTS 区域会被拒绝", () => {
  const { file } = mkZip({ "Hiyori/Hiyori.model3.json": "{}" });
  const r = mod.preview({ kind: "tts", src: file, root: mkRoot(), app: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /Live2D 模型/);
});

test("预览：TTS zip 识别实际引擎类型", () => {
  const { file } = mkZip({ "AivisSpeech-Engine/run.exe": "x" });
  const r = mod.preview({ kind: "tts", src: file, root: mkRoot(), app: null, platform: "win32" });
  assert.equal(r.ok, true);
  assert.match(r.label, /AivisSpeech/);
  assert.match(r.target, /AivisSpeech-Engine/);
});

