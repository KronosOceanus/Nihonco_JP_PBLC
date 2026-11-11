import test from "node:test";
import assert from "node:assert/strict";
import { topLevelNames } from "../tools/scan-globals.mjs";

test("普通顶层重复能抓到", () => {
  assert.deepEqual(topLevelNames("const a = 1;\nconst a = 2;"), ["a", "a"]);
});

test("正则里的引号不会把后续代码吃掉", () => {
  const src = `const re = /['"]/;\nconst a = 1;\nconst a = 2;`;
  assert.deepEqual(topLevelNames(src), ["re", "a", "a"]);
});

test("正则里的 { } 不会改变深度", () => {
  const src = `const re = /\\{/;\nconst a = 1;\nconst a = 2;`;
  assert.deepEqual(topLevelNames(src), ["re", "a", "a"]);

  const src2 = `const re = /[}]/;\nconst a = 1;\nconst a = 2;`;
  assert.deepEqual(topLevelNames(src2), ["re", "a", "a"]);
});

test("除法不会被误判为正则", () => {
  const src = `const x = 10 / 2;\nconst a = 1;\nconst a = 2;`;
  assert.deepEqual(topLevelNames(src), ["x", "a", "a"]);
});

test("模板字符串/注释里的括号不影响", () => {
  const src = "const t = `${foo({ a: 1 })}`;\n// const fake = 1;\nconst a = 1;\nconst a = 2;";
  assert.deepEqual(topLevelNames(src), ["t", "a", "a"]);
});
