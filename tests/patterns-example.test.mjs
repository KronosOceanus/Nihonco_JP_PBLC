import test from "node:test";
import assert from "node:assert/strict";
import { useTempData } from "./_env.mjs";

useTempData();
const patterns = await import("../agent/patterns.js");

test("〜な：单字核心用第一句（有「な」）", () => {
  const card = patterns.card("na-na-adjective");
  assert.equal(card.probe.ja, "京都は有名な町です。");
});

test("多字核心：优先包含核心的例句", () => {
  const ex = [
    { ja: "この店は安いです。" },
    { ja: "この店は安くておいしいです。" },
  ];
  const picked = patterns.pickExample({ patternRaw: "〜くて / 〜で", examples: ex });
  assert.equal(picked.ja, "この店は安くておいしいです。");
});

test("没有匹配时退回第一句", () => {
  const ex = [{ ja: "これはペンです。" }, { ja: "あれは本です。" }];
  const picked = patterns.pickExample({ patternRaw: "〜てもいい", examples: ex });
  assert.equal(picked.ja, "これはペンです。");
});
