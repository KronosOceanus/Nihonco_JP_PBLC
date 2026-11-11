import test from "node:test";
import assert from "node:assert/strict";
import { checkJapanese, kanaRatio } from "../agent/lang-guard.js";

test("简体中文会被拦", () => {
  const r = checkJapanese("这个式子是全然わからない");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "simplified-chars");
  assert.ok(r.hits.includes("这"));
});

test("繁体中文短语也会被拦", () => {
  const r = checkJapanese("中文輸入測試");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "chinese-markers");
  assert.ok(r.markers.includes("測試"));
});

test("日语全汉字放行", () => {
  for (const s of ["日本語", "東京駅", "輸入", "学生", "今日"]) {
    assert.equal(checkJapanese(s).ok, true, s);
  }
});

test("日语假名句子放行", () => {
  const r = checkJapanese("学生は学校に行きます");
  assert.equal(r.ok, true);
  assert.ok(r.kanaRatio > 0);
});

test("纯噪声/空文本不被误判为中文", () => {
  assert.equal(checkJapanese("包括、死鼓猟").ok, true);
  assert.equal(checkJapanese("").reason, "empty");
});

test("假名比例只统计汉字+假名", () => {
  assert.equal(kanaRatio("日本語のテスト"), 4 / 7);
  assert.equal(kanaRatio("abc 123"), 0);
});
