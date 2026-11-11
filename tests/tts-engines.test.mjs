import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mod = await import("../agent/tts-engines.js");

function mkEngine(name, exe = "run") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-tts-"));
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, exe);
  fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
  return file;
}

test("引擎路径：只接受对应引擎的 run", () => {
  const EXE = process.platform === "win32" ? "run.exe" : "run";
  const vv = mkEngine("vv-engine", EXE);
  const ai = mkEngine("AivisSpeech-Engine", EXE);
  assert.equal(mod.validateEnginePath("voicevox", vv).ok, true);
  assert.equal(mod.validateEnginePath("aivis", ai).ok, true);
  assert.equal(mod.validateEnginePath("voicevox", ai).ok, false);
  assert.equal(mod.validateEnginePath("aivis", vv).ok, false);
});

test("引擎路径：拒绝目录、错误文件名和不可执行文件", () => {
  const EXE = process.platform === "win32" ? "run.exe" : "run";
  const dir = path.dirname(mkEngine("vv-engine", EXE));
  assert.equal(mod.validateEnginePath("voicevox", dir).ok, false);
  const wrong = path.join(dir, "not-run");
  fs.writeFileSync(wrong, "x");
  assert.equal(mod.validateEnginePath("voicevox", wrong).ok, false);
  if (process.platform !== "win32") {
    const noExec = path.join(dir, EXE);
    fs.chmodSync(noExec, 0o644);
    assert.equal(mod.validateEnginePath("voicevox", noExec).ok, false);
  }
});

test("引擎路径：Windows 接受 run.exe", () => {
  const exe = mkEngine("vv-engine", "run.exe");
  assert.equal(mod.validateEnginePath("voicevox", exe, { platform: "win32" }).ok, true);
});
