import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTempData, assertIsolated } from "./_env.mjs";

const dir = useTempData();
assertIsolated(dir);        // 这个文件会清空/导入数据，必须确认在临时目录
const backup = await import("../agent/backup.js");

const writeJson = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));

test("info 能统计单词 / 句型的数量与错题", () => {
  writeJson("wordbook.json", { words: { a: { stage: "wrong" }, b: { stage: "ok" } } });
  writeJson("patternbook.json", { words: { p: { stage: "wrong" } } });
  const i = backup.info();
  assert.equal(i.words, 2);
  assert.equal(i.patterns, 1);
  assert.equal(i.wrongWords, 1);
  assert.equal(i.wrongPatterns, 1);
});

test("导出包含五类数据，导入可还原", () => {
  const out = backup.exportAll();
  assert.equal(out.ok, true);
  assert.equal(out.body.kind, "nihonco-export");
  assert.ok(out.body.wordbook);

  writeJson("wordbook.json", { words: {} });      // 模拟清空
  const res = backup.importAll(out.body);
  assert.equal(res.ok, true);
  assert.equal(backup.info().words, 2, "导入后应恢复");
});

test("导入前会自动备份，坏文件被拒绝", () => {
  const before = backup.info().backupCount;
  backup.importAll(backup.exportAll().body);
  assert.ok(backup.info().backupCount > before, "导入应产生备份");

  const bad = backup.importAll({ hello: 1 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是 Nihonco/);
});

test("清空会先备份，并把两本书清成空", () => {
  const res = backup.resetAll();
  assert.equal(res.ok, true);
  const i = backup.info();
  assert.equal(i.words, 0);
  assert.equal(i.patterns, 0);
  assert.ok(res.backup, "应返回备份路径");
  assert.ok(fs.existsSync(res.backup));
});

test("备份只保留最近 7 份", () => {
  for (let i = 0; i < 10; i++) backup.snapshot("test");
  assert.ok(backup.list().length <= 7, `实际 ${backup.list().length} 份`);
});

test("清空当前档位：只删当前档的词，其它档保留", async () => {
  // 造数据：N5 词 2 个、N4 词 1 个
  writeJson("wordbook.json", { words: {} });
  writeJson("patternbook.json", { words: {} });

  const wordbook = await import("../agent/wordbook.js");
  const v = await import("../agent/vocab-daily.js");
  const patterns = await import("../agent/patterns.js");
  const pb = await import("../agent/patternbook.js");

  v.setWordLevel("N5");
  const inN5 = v.wordsOfCurrentLevel().slice(0, 2).map((w) => w.ja);
  v.setWordLevel("N4");
  const inN4 = v.wordsOfCurrentLevel()[0].ja;

  for (const ja of [...inN5, inN4]) wordbook.grade({ ja }, "wrong");
  const pg = patterns.all("N5")[0].id;
  pb.grade(pg, "wrong");

  v.setWordLevel("N5");
  const res = backup.resetLevel();
  assert.equal(res.ok, true);

  const left = Object.keys(wordbook.load().words);
  assert.equal(left.includes(inN5[0]), false, "N5 的词应被清掉");
  assert.equal(left.includes(inN4), true, "N4 的词应保留");
  assert.equal(Object.keys(pb.load().words).includes(pg), false, "N5 句型应被清掉");
});

test("导入会校验结构：畸形内容整体拒绝", () => {
  const cases = [
    { kind: "nihonco-export", wordbook: "我是个字符串" },
    { kind: "nihonco-export", wordbook: { words: [] } },
    { kind: "nihonco-export", vocabDaily: "x" },
    { hello: 1 },
  ];
  for (const c of cases) {
    const r = backup.importAll(c);
    assert.equal(r.ok, false, `应拒绝：${JSON.stringify(c)}`);
  }
});

test("自动备份文件也能导入 / 恢复（没有 kind 也行）", () => {
  writeJson("wordbook.json", { words: { x: { stage: "ok", ok: 2, wrong: 0, skip: 0 } } });
  const snap = backup.snapshot("before-test");
  const body = JSON.parse(fs.readFileSync(snap.file, "utf8"));
  assert.equal(backup.validate(body), null, "备份应通过校验");
  assert.equal(backup.importAll(body).ok, true);

  writeJson("wordbook.json", { words: {} });
  const r = backup.restoreBackup(path.basename(snap.file));
  assert.equal(r.ok, true);
  assert.equal(r.words, 1);
});

test("清空后即使快照损坏，也不会从日志复活", async () => {
  writeJson("wordbook.json", { words: { ghost: { stage: "ok", ok: 2, wrong: 0, skip: 0 } } });
  const wordbook = await import("../agent/wordbook.js");
  const log = (await import("../agent/eventlog.js")).createLog("wordbook");
  log.append({ e: "grade", ja: "ghost", res: "ok" });

  backup.resetAll();
  assert.equal(backup.info().words, 0);

  fs.writeFileSync(path.join(dir, "wordbook.json"), "{ broken");
  const reloaded = wordbook.load();
  assert.equal(Object.keys(reloaded.words).length, 0, "不应从日志复活");
});

test("测试守卫：数据目录必须是临时目录，指向仓库 data/ 直接报错", () => {
  // 正常情况下通过
  assertIsolated(process.env.NIHONCO_DATA_DIR);

  // 人为指向仓库 data/ → 必须抛错
  const repoData = path.resolve("data");
  assert.throws(() => assertIsolated(repoData), /仓库 data/);

  // 指向非临时目录 → 也要抛错
  assert.throws(() => assertIsolated("/tmp"), /不在临时目录|仓库/);
});
