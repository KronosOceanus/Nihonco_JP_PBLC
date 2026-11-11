import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

const dir = useTempData();
const log = (await import("../agent/eventlog.js")).createLog("wordbook");
const book = await import("../agent/wordbook.js");

test("追加与读取：一行一事件", () => {
  log.append({ e: "grade", ja: "あ", res: "ok" });
  log.append({ e: "skip", ja: "い" });
  const all = log.readAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].ja, "あ");
  assert.ok(all[0].t, "应自动补时间戳");
});

test("坏行被跳过，不影响其它事件", () => {
  fs.appendFileSync(log.FILE, "{ 半行\n");
  log.append({ e: "grade", ja: "う", res: "wrong" });
  const all = log.readAll();
  assert.equal(all.filter((x) => x.e === "grade" || x.e === "skip").length, 3);
});

test("重放能还原状态机（连对 2 次毕业、答错清零）", () => {
  const events = [
    { e: "grade", ja: "A", res: "wrong" },
    { e: "grade", ja: "A", res: "ok" },
    { e: "grade", ja: "A", res: "ok" },
    { e: "skip", ja: "B" },
    { e: "grade", ja: "B", res: "wrong" },
  ];
  const db = book.replay(events);
  assert.equal(db.words.A.stage, "ok");
  assert.equal(db.words.A.streak, 2);
  assert.equal(db.words.B.stage, "wrong", "跳过后再答错要变成错题");
});

test("快照损坏时自动从日志重建（不清零）", () => {
  // 先往日志里写 A 的完整过程：错 → 对 → 对（毕业）
  log.append({ e: "grade", ja: "A", res: "wrong" });
  log.append({ e: "grade", ja: "A", res: "ok" });
  log.append({ e: "grade", ja: "A", res: "ok" });

  const f = `${dir}/wordbook.json`;
  fs.writeFileSync(f, "{ 这不是合法 JSON");

  const db = book.load();
  assert.ok(Object.keys(db.words).length > 0, "应从日志重放而不是返回空");
  assert.equal(db.words.A.stage, "ok");
  assert.equal(db.words.A.streak, 2);
  // 重建后快照应被写回
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, "utf8")));
});

test("快照不存在时也用日志重建", () => {
  const f = `${dir}/wordbook.json`;
  try { fs.unlinkSync(f); } catch (e) {}
  const db = book.load();
  assert.ok(Object.keys(db.words).length > 0);
});

test("基线之后的事件才重放（不重复计数）", () => {
  const fs2 = fs;
  const f = `${dir}/wordbook.json`;
  // 造一个快照并触发基线写入
  fs2.writeFileSync(f, JSON.stringify({ words: { X: { ja: "X", stage: "skip", streak: 0, ok: 0, wrong: 0, skip: 1, seen: 1 } } }));
  book.load();
  const base = JSON.parse(fs2.readFileSync(`${dir}/wordbook.baseline.json`, "utf8"));
  assert.ok(base.at, "基线应带时间戳");
  assert.ok(base.words.X);

  // 基线之后的新事件要生效
  log.append({ e: "grade", ja: "X", res: "ok" });
  log.append({ e: "grade", ja: "X", res: "ok" });
  const rebuilt = book.replay(log.readAll());
  assert.equal(rebuilt.words.X.stage, "ok", "基线后连对 2 次应毕业");
});

test("日志轮转后重放依然正确（基线水位线自愈）", async () => {
  const fs3 = fs;
  const dir3 = fs3.mkdtempSync((await import("node:os")).tmpdir() + "/rot-");
  // 用子进程隔离：轮转阈值要换，模块缓存不能复用
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  // Windows 上 URL.pathname 是 "/D:/..."，require 会找不到模块 → 必须转成真实路径
  const bookPath = fileURLToPath(new URL("../agent/wordbook.js", import.meta.url));
  const logPath = fileURLToPath(new URL("../agent/eventlog.js", import.meta.url));
  const script = `
    const fs=require("fs"), path=require("path"), os=require("os");
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"rot-"));
    process.env.NIHONCO_DATA_DIR=dir;
    process.env.NIHONCO_LOG_ROTATE_BYTES="200";
    const book=require(${JSON.stringify(bookPath)});
    const log=require(${JSON.stringify(logPath)}).createLog("wordbook");
    book.grade({ja:"A"},"wrong");
    log.append({e:"grade",ja:"pad",res:"ok"});
    log.append({e:"grade",ja:"pad",res:"ok"});
    book.grade({ja:"A"},"ok");
    book.grade({ja:"A"},"ok");
    const rotated = fs.existsSync(log.ARCHIVE);
    const rebuilt = book.replay(log.readAllWithOffset());
    console.log(JSON.stringify({rotated, stage:rebuilt.words.A.stage, streak:rebuilt.words.A.streak}));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim().split("\n").pop());
  assert.equal(out.rotated, true, "应该发生过轮转");
  assert.equal(out.stage, "ok", "轮转后重放不能丢事件");
  assert.equal(out.streak, 2);
});

test("见过的词也入日志，重放后不会消失", async () => {
  const book2 = await import("../agent/wordbook.js");
  const log2 = (await import("../agent/eventlog.js")).createLog("wordbook");
  book2.markSeen({ ja: "見ただけ", kana: "みただけ" });
  const rebuilt = book2.replay(log2.readAllWithOffset());
  assert.ok(rebuilt.words["見ただけ"], "只在批次里出现过的词也应能被还原");
  assert.equal(rebuilt.words["見ただけ"].stage, "new");
  assert.ok(rebuilt.words["見ただけ"].seen >= 1);
});
