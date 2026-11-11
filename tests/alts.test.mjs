import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

/* 单词判分：同一词的其它写法（alts）+ 片假名等价
 * 「かわいい」卡片答「可愛い」：先判错，用户点「这也算对」后记住并判对。 */

const dir = useTempData();
const vocab = await import("../agent/vocab-daily.js");
const book = await import("../agent/wordbook.js");

const seed = (extra = {}) => {
  fs.writeFileSync(`${dir}/wordbook.json`, JSON.stringify({
    words: {
      "かわいい": { ja: "かわいい", kana: "かわいい", zh: "可爱的", level: "N5",
        stage: "ok", seen: 3, ok: 2, wrong: 0, skip: 0, streak: 2, lastAt: "", lastResult: "ok", alts: [], ...extra },
    },
  }));
  fs.writeFileSync(`${dir}/vocab-daily.json`, JSON.stringify({
    date: "", batch: [], last: "", mode: "daily", today: { ok: [], wrong: [], skip: [] },
  }));
};

test("未知汉字写法先判错（没有 alts 时）", () => {
  seed();
  const r = vocab.check({ ja: "かわいい", kana: "かわいい" }, "可愛い");
  assert.equal(r.ok, false);
});

test("acceptAlt：记住写法后按答对处理，并写进 wordbook.alts", () => {
  seed();
  const r = vocab.acceptAlt({ ja: "かわいい", kana: "かわいい" }, "可愛い");
  assert.equal(r.ok, true);
  assert.ok(book.load().words["かわいい"].alts.includes("可愛い"));
  // 之后直接答同一写法也算对
  const r2 = vocab.check({ ja: "かわいい", kana: "かわいい" }, "可愛い");
  assert.equal(r2.ok, true);
});

test("片假名等价：カワイイ 算对", () => {
  seed();
  const r = vocab.check({ ja: "かわいい", kana: "かわいい" }, "カワイイ");
  assert.equal(r.ok, true);
});

test("addAlt 去重：同一个写法只记一次", () => {
  seed();
  book.addAlt("かわいい", "可愛い");
  book.addAlt("かわいい", "可愛い");
  const alts = book.load().words["かわいい"].alts;
  assert.equal(alts.filter((x) => x === "可愛い").length, 1);
});
