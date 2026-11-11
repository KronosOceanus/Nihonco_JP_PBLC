import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTempData } from "./_env.mjs";

const dir = useTempData();
const cache = await import("../agent/voice-cache.js");

test("同一个文本 → 同一个缓存文件名", () => {
  assert.equal(cache.nameOf("たんごモード"), cache.nameOf("たんごモード"));
  assert.notEqual(cache.nameOf("たんごモード"), cache.nameOf("れいぶんモード"));
});

test("put 之后能 get 到；太小的文件不算命中", () => {
  const tmp = path.join(dir, "fake.wav");
  fs.writeFileSync(tmp, Buffer.alloc(5000, 1));
  const saved = cache.put("テスト用の文", tmp);
  assert.ok(saved && fs.existsSync(saved));
  assert.ok(saved.startsWith(dir), "缓存必须写在临时数据目录里");
  assert.equal(cache.get("テスト用の文"), saved);

  const tiny = path.join(dir, "tiny.wav");
  fs.writeFileSync(tiny, Buffer.alloc(10, 1));
  cache.put("みじかい", tiny);
  assert.equal(cache.get("みじかい"), null, "过小的文件应视为无效缓存");
});

test("缓存键跟着声线走：换角色 / 改参数都会换键", async () => {
  const tts = await import("../agent/tts.js");
  const config = await import("../agent/config.js");
  const vc = await import("../agent/voice-cache.js");

  const text = "かいわモード";
  tts.setName("小夜");
  const a = vc.nameOf(text);
  tts.setName("ずんだもん");
  const b = vc.nameOf(text);
  assert.notEqual(a, b, "换声线后缓存键必须不同（否则提示音还是旧声音）");
  tts.setName("小夜");
  assert.equal(vc.nameOf(text), a, "换回原声线应复用原键");

  const before = vc.nameOf(text);
  const cur = config.get();
  config.patch({ voice: { ...cur.voice, speed: cur.voice.speed === 1 ? 1.2 : 1 } });
  assert.notEqual(vc.nameOf(text), before, "改语速后缓存键必须不同");
  config.patch({ voice: cur.voice });     // 还原
});
