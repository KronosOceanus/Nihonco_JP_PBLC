import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

/* 挂件窗口尺寸：夹取 + 持久化（纯逻辑，不依赖 electron） */
const dir = useTempData();
const ws = await import("../agent/window-size.js");

const reset = () => { try { fs.unlinkSync(`${dir}/window.json`); } catch (e) {} };

test("clampSize：最小 240×320，上限按工作区给", () => {
  assert.deepEqual(ws.clampSize(100, 100), { w: 240, h: 320 });
  assert.deepEqual(ws.clampSize(380, 560), { w: 380, h: 560 });
  assert.deepEqual(ws.clampSize(5000, 5000, { maxW: 1200, maxH: 900 }), { w: 1200, h: 900 });
  assert.deepEqual(ws.clampSize("abc", undefined), { w: 240, h: 320 });
});

test("save / load：能读回，坏文件返回 null", () => {
  reset();
  assert.equal(ws.load(), null);
  ws.save({ w: 420, h: 600 });
  assert.deepEqual(ws.load(), { w: 420, h: 600 });
  fs.writeFileSync(`${dir}/window.json`, "{broken");
  assert.equal(ws.load(), null);
});

test("保存时会夹取一次（手改坏的值不会让窗口变负数）", () => {
  reset();
  ws.save({ w: 10, h: 99999 });
  const got = ws.load();
  assert.equal(got.w, 240);
  assert.ok(got.h >= 320);
});
