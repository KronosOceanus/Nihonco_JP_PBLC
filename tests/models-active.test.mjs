import test from "node:test";
import assert from "node:assert/strict";

/* 当前模型路径只从 models.activePath() 解析，避免设置面板/打包/窗口各算一套 */

const models = await import("../agent/models.js");

test("默认模型：LIVE2D_MODEL 未设置时用 Hiyori", () => {
  const old = process.env.LIVE2D_MODEL;
  delete process.env.LIVE2D_MODEL;
  try {
    assert.equal(models.activePath(), models.DEFAULT_MODEL);
    assert.equal(models.DEFAULT_MODEL, "model/Hiyori/Hiyori.model3.json");
  } finally {
    if (old === undefined) delete process.env.LIVE2D_MODEL;
    else process.env.LIVE2D_MODEL = old;
  }
});

test("LIVE2D_MODEL 优先", () => {
  const old = process.env.LIVE2D_MODEL;
  process.env.LIVE2D_MODEL = "model/miku/miku.model3.json";
  try {
    assert.equal(models.activePath(), "model/miku/miku.model3.json");
  } finally {
    if (old === undefined) delete process.env.LIVE2D_MODEL;
    else process.env.LIVE2D_MODEL = old;
  }
});
