import test from "node:test";
import assert from "node:assert/strict";
import { useTempData } from "./_env.mjs";

useTempData();
const reading = await import("../agent/reading.js");
const { exampleMatches } = await import("../agent/example-check.js");

test.before(async () => { await reading.warmup(); });

test("原词 / 读音 / 活用形 / 复合词都算命中", () => {
  assert.equal(exampleMatches({ ja: "終わる", kana: "おわる" }, "授業は3時に終わります。"), true);
  assert.equal(exampleMatches({ ja: "朝ご飯", kana: "あさごはん" }, "朝ご飯はもう食べた？"), true);
  assert.equal(exampleMatches({ ja: "映画館", kana: "えいがかん" }, "週末、映画館で新作を観た。"), true);
  assert.equal(exampleMatches({ ja: "燭[しょく]台", kana: "しょくだい" }, "テーブルの上に燭台を置いた。"), true);
  assert.equal(exampleMatches({ ja: "〜人", kana: "じん" }, "彼は日本人です。"), true);
  assert.equal(exampleMatches({ ja: "嫌", kana: "いや" }, "いや、それは無理だよ。"), true);
});

test("完全无关的例句不命中", () => {
  assert.equal(exampleMatches({ ja: "猫", kana: "ねこ" }, "犬が好きです。"), false);
  assert.equal(exampleMatches({ ja: "手", kana: "て" }, "上手ですね。"), false);
  assert.equal(exampleMatches({ ja: "手", kana: "て" }, "手を洗ってください。"), true);
});
