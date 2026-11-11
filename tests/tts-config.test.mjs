import test from "node:test";
import assert from "node:assert/strict";
import mod from "../agent/tts-config.js";

test("TTS 配置：按 TTS_ENGINE 选引擎，缺省看旧 URL 兼容", () => {
  assert.equal(mod.currentEngine({ TTS_ENGINE: "aivis" }), "aivis");
  assert.equal(mod.currentEngine({ TTS_ENGINE: "voicevox" }), "voicevox");
  assert.equal(mod.currentEngine({ VOICEVOX_URL: "http://127.0.0.1:10101" }), "aivis");
  assert.equal(mod.currentEngine({}), "voicevox");
});

test("TTS 配置：URL 和名字有各自默认值", () => {
  assert.equal(mod.url("voicevox", {}), "http://127.0.0.1:50021");
  assert.equal(mod.url("aivis", {}), "http://127.0.0.1:10101");
  assert.equal(mod.name("voicevox", {}), "小夜");
  assert.equal(mod.name("aivis", {}), "まお");
  assert.equal(mod.pathEnv("aivis"), "AIVIS_ENGINE");
});
