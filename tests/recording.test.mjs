import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* 渲染层的录音/播放互斥逻辑在 pet.js 与 renderer/*.js 里，浏览器 API 依赖较多，
 * 这里只做「源码级守卫」断言：确保关键约束不会被后续改动删掉。
 * 真机行为靠 PET_EVAL 冒烟（见 README「调试钩子」）。
 *
 * 拆分后（P2-2）约束会落在不同文件，所以把 pet.js + renderer/ 拼起来再匹配。
 */
const ROOT = new URL("..", import.meta.url);
const petDir = new URL("../renderer/", import.meta.url);
const src = [
  fs.readFileSync(new URL("../pet.js", import.meta.url), "utf8"),
  ...fs.readdirSync(petDir).filter((f) => f.endsWith(".js")).sort()
    .map((f) => fs.readFileSync(new URL(f, petDir), "utf8")),
].join("\n/* ---- file ---- */\n");

test("录音中禁止播放（否则她的声音会被麦克风收进去）", () => {
  assert.match(src, /if \(recording\) \{[^}]*跳过播放/);
});

test("startRec 成功后置位 recording", () => {
  assert.match(src, /rec = \{ stream[\s\S]{0,200}recording = true;/);
});

test("stopRec / cancelRec 都会复位 recording", () => {
  assert.match(src, /async function stopRec\(\) \{\n  recording = false;/);
  assert.match(src, /function cancelRec\(\) \{\n  recording = false;/);
});

test("麦克风按钮按下时先打断她的朗读", () => {
  assert.match(src, /micEl\.addEventListener\("pointerdown"[\s\S]{0,400}bargeIn\(\)/);
});

test("空格对讲同样先打断", () => {
  assert.match(src, /e\.code === "Space"[\s\S]{0,300}bargeIn\(\)/);
});

test("点復習按钮也要先打断当前朗读", () => {
  assert.match(src, /rvBtn\.addEventListener\("click", async \(\) => \{\s*bargeIn\(\)/);
  assert.match(src, /async function patternToggleReview\(\) \{\s*bargeIn\(\)/);
});
