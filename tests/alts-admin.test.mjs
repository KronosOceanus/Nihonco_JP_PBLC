import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

/* 「也算对」记录的管理：列表 / 删除 / 覆盖（设置窗口的 alts 面板用） */

const dir = useTempData();
const book = await import("../agent/wordbook.js");

const seed = (words) => fs.writeFileSync(`${dir}/wordbook.json`, JSON.stringify({ words }));

test("listAlts：只列出有 alts 的词，按词排序", () => {
  seed({
    "かわいい": { ja: "かわいい", kana: "かわいい", alts: ["可愛い"] },
    "予約": { ja: "予約", kana: "よやく", alts: [] },
    "できる": { ja: "できる", kana: "できる", alts: ["出来る", "デキル？"] },
  });
  const list = book.listAlts();
  assert.deepEqual(list.map((x) => x.ja), ["かわいい", "できる"]);   // 日本語排序：か < で
  assert.deepEqual(list[0].alts, ["可愛い"]);
});

test("removeAlt：删掉匹配的写法（忽略空白/全半角）；不存在时返回失败", () => {
  seed({ "かわいい": { ja: "かわいい", kana: "かわいい", alts: ["可愛い", "カワイイ？"] } });
  const r = book.removeAlt("かわいい", "カワイイ ？");
  assert.equal(r.ok, true);
  assert.deepEqual(r.alts, ["可愛い"]);
  assert.deepEqual(book.load().words["かわいい"].alts, ["可愛い"]);

  const bad = book.removeAlt("かわいい", "存在しない");
  assert.equal(bad.ok, false);
});

test("setAlts：去重、去空白、排除和 ja/kana 相同的写法", () => {
  seed({ "予約": { ja: "予約", kana: "よやく", alts: [] } });
  const r = book.setAlts("予約", ["  余約 ", "余約", "予約", "よやく", "ヨヤク"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.alts, ["余約", "ヨヤク"]);
});
