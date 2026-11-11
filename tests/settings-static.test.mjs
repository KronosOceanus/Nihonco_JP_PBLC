import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* 设置窗口结构：分区顺序、资源区、脚本加载顺序。
 * 只是静态契约，防止改 HTML 时把顺序/依赖改坏。
 */
const html = fs.readFileSync("settings/index.html", "utf8");

test("设置分区顺序固定", () => {
  const titles = [...html.matchAll(/<h2 class="section-title">([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["资源", "Live2D", "ASR", "LLM", "TTS", "记忆", "快捷键", "应用信息", "数据"]);
});

test("资源区三行与状态 id 都在", () => {
  for (const id of ["dlCore", "dlModel", "dlVoice", "dlAivis", "statCore", "statModel", "statAsr", "statVoice", "statAivis", "openAssets", "dirAssets"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["ttsEngine", "applyEngine", "pickVoicevox", "pickAivis", "voicevoxPath", "aivisPath", "voicePick", "preview", "openData", "dirData"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("设置模块先于 app.js 加载", () => {
  const order = ["core.js", "assets.js", "shortcuts.js", "data.js", "memory.js", "tts.js", "asr.js", "llm.js", "live2d.js", "maintenance.js", "app.js"];
  const pos = order.map((f) => html.indexOf(`src="${f}"`));
  assert.ok(pos.every((p) => p > 0), "设置脚本都要在 settings/index.html 里");
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1], `${order[i]} 顺序不对`);
});
