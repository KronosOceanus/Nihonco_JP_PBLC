import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

/* 汉字→假名读音（kuromoji）：用于「这个也算对」的显示门禁。
 * 读音只是必要条件：箸/橋 同为 はし，所以仍需人工确认。 */

const dir = useTempData();
const reading = await import("../agent/reading.js");
const vocab = await import("../agent/vocab-daily.js");

test("预热后能转读音；未预热时 toKana 返回 null", async () => {
  assert.equal(reading.ready(), false, "测试进程里应该还没预热");
  assert.equal(reading.toKana("出来る"), null);
  await reading.warmup();
  assert.equal(reading.ready(), true);
});

test("关键读音：出来る / 可愛い / 来る / てきる", () => {
  assert.equal(reading.toKana("出来る"), "できる");
  assert.equal(reading.toKana("可愛い"), "かわいい");
  assert.equal(reading.toKana("来る"), "くる");
  assert.equal(reading.toKana("てきる"), "てきる");
});

function seed() {
  fs.writeFileSync(`${dir}/wordbook.json`, JSON.stringify({
    words: {
      "かわいい": { ja: "かわいい", kana: "かわいい", zh: "可爱的", level: "N5",
        stage: "ok", seen: 3, ok: 2, wrong: 0, skip: 0, streak: 2, lastAt: "", lastResult: "ok", alts: [] },
    },
  }));
  fs.writeFileSync(`${dir}/vocab-daily.json`, JSON.stringify({
    date: "", batch: [], last: "", mode: "daily", today: { ok: [], wrong: [], skip: [] },
  }));
}

test("altCandidate：只在该读音一致时出现", () => {
  seed();
  const card = { ja: "かわいい", kana: "かわいい" };
  assert.equal(vocab.check(card, "可愛い").altCandidate, true);
  assert.equal(vocab.check(card, "てきる").altCandidate, false);   // 假名拼错
  assert.equal(vocab.check(card, "来る").altCandidate, false);     // 汉字但读音不同
  assert.equal(vocab.check(card, "カワイイ").altCandidate, false); // 片假名直接判对，不需要按钮
  assert.equal(vocab.check(card, "カワイイ").ok, true);
});

test("振假名：只有含汉字的片段带读音", async () => {
  await reading.warmup();
  const fg = await import("../agent/furigana.js");
  const segs = fg.of("京都は有名な町です。");
  assert.deepEqual(segs[0], { t: "京都", r: "きょうと" });
  assert.deepEqual(segs[1], { t: "は" });
  assert.deepEqual(segs[3], { t: "な" });   // 假名不带 ruby
  assert.ok(segs.some((s) => s.t === "町" && s.r === "まち"));
});

test("复现判分：读音一致就算对（汉字/假名、标点不影响）", async () => {
  await reading.warmup();
  const patterns = await import("../agent/patterns.js");
  assert.equal(patterns.sameSentence("出来る", "できる"), true);
  assert.equal(patterns.sameSentence("京都は、有名な町です", "京都は有名な町です。"), true);
  assert.equal(patterns.sameSentence("来る", "きる"), false);
});

test("altCandidate 扩展到所有卡片：橋 卡片答同音的 箸 也给按钮", async () => {
  await reading.warmup();
  fs.writeFileSync(`${dir}/wordbook.json`, JSON.stringify({
    words: {
      "橋": { ja: "橋", kana: "はし", zh: "桥", level: "N5",
        stage: "ok", seen: 3, ok: 2, wrong: 0, skip: 0, streak: 2, lastAt: "", lastResult: "ok", alts: [] },
    },
  }));
  fs.writeFileSync(`${dir}/vocab-daily.json`, JSON.stringify({
    date: "", batch: [], last: "", mode: "daily", today: { ok: [], wrong: [], skip: [] },
  }));
  const r = vocab.check({ ja: "橋", kana: "はし" }, "箸");
  assert.equal(r.ok, false, "同音异字本身不算对");
  assert.equal(r.altCandidate, true, "但读音一致，给人工确认按钮");
});
