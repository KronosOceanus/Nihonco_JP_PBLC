import test from "node:test";
import assert from "node:assert/strict";
import { useTempData } from "./_env.mjs";

/* 点词查询：kuromoji 分词 + 词表匹配；词表外不标记 */
useTempData();
const reading = await import("../agent/reading.js");
const { lookup } = await import("../agent/lookup.js");

test("词表内的词：读音/原形/释义", async () => {
  await reading.warmup();
  const toks = lookup("映画を見た");
  const movie = toks.find((x) => x.t === "映画");
  assert.equal(movie.ok, true);
  assert.equal(movie.zh, "电影");
  assert.equal(movie.r, "えいが");
  assert.equal(movie.kana, "えいが");

  const mi = toks.find((x) => x.b === "見る");
  assert.equal(mi.ok, true);
  assert.equal(mi.zh, "看");
  assert.equal(mi.kana, "みる");
});

test("助词 / 词表外的词不标记可点", async () => {
  await reading.warmup();
  const toks = lookup("をは、ほげほげぴよぴよ");
  assert.ok(toks.length > 0);
  assert.ok(toks.every((x) => !x.ok));
});

test("每个 ok 的词必须有释义", async () => {
  await reading.warmup();
  for (const t of lookup("今日は洋服で映画を見た")) {
    if (t.ok) assert.ok(t.zh, `${t.t} 缺释义`);
  }
});
