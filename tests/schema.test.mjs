import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTempData } from "./_env.mjs";
import { CURRENT, MIGRATIONS, migrate, stamp } from "../agent/schema.js";

const dir = useTempData();

test("没有 version 的旧文件：按 0 处理并补上当前版本", () => {
  const m = migrate("wordbook", { words: { 犬: { seen: 1 } } });
  assert.equal(m.from, 0);
  assert.equal(m.to, CURRENT.wordbook);
  assert.equal(m.changed, true);
  assert.equal(m.newer, false);
  assert.equal(m.data.version, CURRENT.wordbook);
  assert.deepEqual(m.data.words, { 犬: { seen: 1 } }, "迁移不能丢数据");
});

test("已是当前版本：不标记变更", () => {
  const m = migrate("settings", { level: "N4", version: CURRENT.settings });
  assert.equal(m.changed, false);
  assert.equal(m.data.level, "N4");
});

test("比程序新的版本：原样返回 + newer 标记（不降级、不改数据）", () => {
  const future = { level: "N3", version: CURRENT.settings + 5, extra: true };
  const m = migrate("settings", future);
  assert.equal(m.newer, true);
  assert.deepEqual(m.data, future);
  assert.equal(m.from, CURRENT.settings + 5);
});

test("损坏的数据（数组/字符串/null）：当成空对象但补上 version", () => {
  for (const bad of [[], "x", null, 42]) {
    const m = migrate("wordbook", bad);
    assert.equal(m.data.version, CURRENT.wordbook);
  }
});

test("未登记的文件名直接报错（防止拼错名字静默跳过迁移）", () => {
  assert.throws(() => migrate("wordbok", {}), /未知的数据文件/);
  assert.throws(() => stamp("nope", {}), /未知的数据文件/);
});

test("迁移链：新增一步后会被依次执行", () => {
  const prev = CURRENT.wordbook;
  const prevSteps = { ...MIGRATIONS.wordbook };
  try {
    CURRENT.wordbook = prev + 1;
    MIGRATIONS.wordbook[prev + 1] = (d) => ({ ...d, added: (d.added || 0) + 1 });
    const m = migrate("wordbook", { words: {} });          // 0 → 2
    assert.equal(m.to, prev + 1);
    assert.equal(m.data.added, 1);
    assert.equal(m.data.words instanceof Object, true);
  } finally {
    CURRENT.wordbook = prev;
    MIGRATIONS.wordbook = prevSteps;
  }
});

test("stamp 只加版本，不改原字段", () => {
  assert.deepEqual(stamp("patternbook", { words: { a: 1 } }),
    { words: { a: 1 }, version: CURRENT.patternbook });
});

test("写盘会带上版本号（wordbook 集成）", async () => {
  const book = await import("../agent/wordbook.js");
  fs.writeFileSync(path.join(dir, "wordbook.json"), JSON.stringify({ words: {} }), "utf8");
  book.grade({ ja: "犬" }, "ok");
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "wordbook.json"), "utf8"));
  assert.equal(saved.version, CURRENT.wordbook, "保存后文件里应有 version");
});

test("旧文件（没有 version）加载后会被补上版本，数据不丢", async () => {
  const book = await import("../agent/wordbook.js");
  fs.writeFileSync(path.join(dir, "wordbook.json"),
    JSON.stringify({ words: { 猫: { seen: 3, ok: 2, wrong: 0, streak: 0, lv: "N5" } } }), "utf8");
  const loaded = book.load();
  assert.ok(loaded.words["猫"], "旧数据要保留");
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "wordbook.json"), "utf8"));
  assert.equal(saved.version, CURRENT.wordbook);
  assert.ok(saved.words["猫"], "回写时不能丢数据");
});

test("导入没有 version 的旧备份：写入时补版本", async () => {
  const backup = await import("../agent/backup.js");
  const r = backup.importAll({
    kind: "nihonco-export",
    wordbook: { words: { 鳥: { seen: 1, ok: 1, wrong: 0, streak: 1, lv: "N5" } } },
  });
  assert.equal(r.ok, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "wordbook.json"), "utf8"));
  assert.equal(saved.version, CURRENT.wordbook);
  assert.ok(saved.words["鳥"]);
});
