import test from "node:test";
import assert from "node:assert/strict";
import { useTempData } from "./_env.mjs";
useTempData();

const book = await import("../agent/wordbook.js");

const W = (ja) => ({ ja, kana: "", zh: "" });

test("新词：答错进错题本", () => {
  book.grade(W("あ"), "wrong");
  const rec = book.load().words["あ"];
  assert.equal(rec.stage, "wrong");
  assert.equal(rec.wrong, 1);
  assert.equal(rec.streak, 0);
});

test("错题：只对 1 次不能毕业", () => {
  book.grade(W("い"), "wrong");
  book.grade(W("い"), "ok");
  assert.equal(book.load().words["い"].stage, "wrong");
  assert.equal(book.load().words["い"].streak, 1);
});

test("错题：连续对 2 次毕业", () => {
  book.grade(W("う"), "wrong");
  book.grade(W("う"), "ok");
  book.grade(W("う"), "ok");
  const rec = book.load().words["う"];
  assert.equal(rec.stage, "ok");
  assert.equal(rec.streak, 2);
});

test("毕业后再答错：打回错题本", () => {
  book.grade(W("え"), "wrong");
  book.grade(W("え"), "ok");
  book.grade(W("え"), "ok");
  assert.equal(book.load().words["え"].stage, "ok");
  book.grade(W("え"), "wrong");
  assert.equal(book.load().words["え"].stage, "wrong");
  assert.equal(book.load().words["え"].streak, 0);
});

test("跳过：进跳过池；再答错要升级成错题本", () => {
  book.grade(W("お"), "skip");
  assert.equal(book.load().words["お"].stage, "skip");
  book.grade(W("お"), "wrong");
  assert.equal(book.load().words["お"].stage, "wrong");
});

test("跳过：连续对 2 次也能毕业", () => {
  book.grade(W("か"), "skip");
  book.grade(W("か"), "ok");
  assert.equal(book.load().words["か"].stage, "skip");
  book.grade(W("か"), "ok");
  assert.equal(book.load().words["か"].stage, "ok");
});

test("三个池子互斥", () => {
  const p = book.pools();
  const all = [...p.wrong, ...p.skip, ...p.seen].map((r) => r.ja);
  assert.equal(new Set(all).size, all.length, "同一个词不应同时出现在两个池子里");
});

test("见到但不作答，不算任何池", () => {
  book.markSeen(W("き"));
  assert.equal(book.load().words["き"].stage, "new");
});
