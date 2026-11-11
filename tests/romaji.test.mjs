import test from "node:test";
import assert from "node:assert/strict";
import { useTempData } from "./_env.mjs";
useTempData();

const { kanaToRomaji, toHiragana } = await import("../agent/romaji.js");

test("片假名 → 平假名", () => {
  assert.equal(toHiragana("チェック"), "ちぇっく");
  assert.equal(toHiragana("コーヒー"), "こーひー");
});

test("基本假名", () => {
  assert.equal(kanaToRomaji("たべる"), "taberu");
  assert.equal(kanaToRomaji("がっこう"), "gakkou");
  assert.equal(kanaToRomaji("にっき"), "nikki");
  assert.equal(kanaToRomaji("しんいち"), "shinichi");
});

test("外来语的小写元音组合（曾经缺失导致打不出来）", () => {
  assert.equal(kanaToRomaji("チェック"), "chekku");   // 不是 chiekku
  assert.equal(kanaToRomaji("シェア"), "shea");
  assert.equal(kanaToRomaji("ジェット"), "jetto");
  assert.equal(kanaToRomaji("パーティー"), "pa-ti-");
  assert.equal(kanaToRomaji("フォーク"), "fo-ku");
  assert.equal(kanaToRomaji("ウィンドウ"), "windou");
});

test("促音：ch / ts 前写 t", () => {
  assert.equal(kanaToRomaji("まっちゃ"), "matcha");
  assert.equal(kanaToRomaji("マッチ"), "matchi");
  assert.equal(kanaToRomaji("みっつ"), "mittsu");
});

test("を 是 wo（打 o 会出 お）", () => {
  assert.equal(kanaToRomaji("を"), "wo");
});

test("长音在键盘上是连字符", () => {
  assert.equal(kanaToRomaji("コーヒー"), "ko-hi-");
});
