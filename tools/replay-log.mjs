#!/usr/bin/env node
/* 从事件日志重建 wordbook.json
 *
 *   node tools/replay-log.mjs            # 只预览（dry-run）
 *   node tools/replay-log.mjs --write    # 真正写回 data/wordbook.json
 *
 * 用在：快照损坏、误删、想回到日志里某个时间点之后的状态。
 */
import fs from "node:fs";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");

const log = await import("../agent/eventlog.js");
const book = await import("../agent/wordbook.js");

const events = log.readAllWithOffset();
if (!events.length) {
  console.log("日志为空，没什么可重建的（", log.FILE, "）");
  process.exit(0);
}

const rebuilt = book.replay(events);
const words = Object.values(rebuilt.words);
const byStage = words.reduce((m, w) => { m[w.stage] = (m[w.stage] || 0) + 1; return m; }, {});

console.log("日志事件:", events.length);
console.log("首条:", events[0].ev.t, "| 末条:", events[events.length - 1].ev.t);
console.log("重放结果:", words.length, "词 |", JSON.stringify(byStage));

if (!write) {
  console.log("\n（预览模式，未写文件；加 --write 才真正重建）");
  process.exit(0);
}

fs.mkdirSync(process.env.NIHONCO_DATA_DIR || "data", { recursive: true });
book.save(rebuilt);
console.log("已写回:", book.FILE);
