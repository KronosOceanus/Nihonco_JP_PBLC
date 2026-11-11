import test from "node:test";
import assert from "node:assert/strict";
import { staleLevel } from "../agent/enrich.js";

test("缓存例句的等级与当前词等级不一致时重生成", () => {
  assert.equal(staleLevel({ level: "N5" }, { level: "N4" }), true);
  assert.equal(staleLevel({ level: "N4" }, { level: "N4" }), false);
});

test("旧缓存没有 level 时保留（不批量重生成）", () => {
  assert.equal(staleLevel({ level: "N4" }, { example: "x" }), false);
  assert.equal(staleLevel({ level: "N4" }, { level: "" }), false);
});
