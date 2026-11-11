import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createVoice = require("../main/voice.js");

function mkDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-voice-"));
  const vv = path.join(root, ".voicevox", "extracted", "VOICEVOX", "VOICEVOX.app",
    "Contents", "Resources", "vv-engine", "run");
  const ai = path.join(root, ".aivis", "AivisSpeech.app", "Contents", "Resources", "AivisSpeech-Engine", "run");
  fs.mkdirSync(path.dirname(vv), { recursive: true });
  fs.mkdirSync(path.dirname(ai), { recursive: true });
  fs.writeFileSync(vv, "x");
  fs.writeFileSync(ai, "x");
  return { root, userData: path.join(root, "user-data"), voiceDir: path.join(root, "voice"),
    vv, ai };
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
  kill() { this.exitCode = 0; this.emit("exit", 0); }
}

function mk({ alive = false } = {}) {
  const d = mkDirs();
  const spawned = [];
  const killed = [];
  let aliveNow = alive;
  const tts = {
    alive: async () => aliveNow,
    engineName: () => process.env.TTS_ENGINE || "voicevox",
    isGenie: () => false,
    voiceName: () => "小夜",
    speechKey: (x) => x,
  };
  const platform = {
    IS_WIN: false,
    childPath: () => process.env.PATH || "",
    portOwner: () => [],
    voicevoxEngineCandidates: () => [d.vv],
    aivisEngineCandidates: () => [d.ai],
  };
  let pid = 100;
  const spawnProc = (exe) => {
    const c = new FakeChild(pid++);
    aliveNow = true;
    spawned.push({ exe, child: c });
    return c;
  };
  const voice = createVoice({
    root: d.root, userData: d.userData, voiceDir: d.voiceDir, tts, platform,
    procs: { rememberProc: () => {} },
    voiceCache: { clear: () => 0, get: () => null, put: () => {} },
    spawnProc,
  });
  return { d, voice, tts, spawned, killed };
}

test("引擎管理器：按当前引擎启动，切换时停旧起新", async () => {
  const prev = process.env.TTS_ENGINE;
  process.env.TTS_ENGINE = "voicevox";
  try {
    const { voice, tts, spawned } = mk();
    assert.equal(await voice.ensureTtsEngine(), true);
    assert.equal(spawned.length, 1);
    assert.match(spawned[0].exe, /vv-engine/);

    tts.alive = async () => true;
    const r = await voice.switchEngine("aivis");
    assert.equal(r.engine, "aivis");
    assert.equal(spawned.length, 2);
    assert.match(spawned[1].exe, /AivisSpeech-Engine/);
    assert.equal(voice.getEngineProc().exitCode, null);
  } finally {
    if (prev === undefined) delete process.env.TTS_ENGINE;
    else process.env.TTS_ENGINE = prev;
  }
});

test("引擎管理器：外部已运行的引擎不 spawn，也不强杀", async () => {
  const prev = process.env.TTS_ENGINE;
  process.env.TTS_ENGINE = "aivis";
  try {
    const { voice, spawned } = mk({ alive: true });
    assert.equal(await voice.ensureTtsEngine(), true);
    assert.equal(spawned.length, 0);
    assert.equal(voice.getEngineProc(), null);
    assert.equal(voice.stopEngine(), false);
  } finally {
    if (prev === undefined) delete process.env.TTS_ENGINE;
    else process.env.TTS_ENGINE = prev;
  }
});

test("引擎管理器：并发切换被拒绝", async () => {
  const prev = process.env.TTS_ENGINE;
  process.env.TTS_ENGINE = "voicevox";
  try {
    const { voice } = mk();
    const first = voice.switchEngine("aivis");
    await assert.rejects(() => voice.switchEngine("voicevox"), /正在切换/);
    assert.equal((await first).engine, "aivis");
  } finally {
    if (prev === undefined) delete process.env.TTS_ENGINE;
    else process.env.TTS_ENGINE = prev;
  }
});
