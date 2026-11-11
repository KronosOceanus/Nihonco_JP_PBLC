#!/usr/bin/env node
/* 跨平台、跨 Node 版本的测试跑法：npm test
 *
 * 为什么不直接在 package.json 里写 `node --test "tests/*.test.mjs"`：
 *   - Node 20 不支持 glob（会报 Could not find '.../*.test.mjs'）
 *   - Node 22 把目录参数当文件（`node --test tests/` 报 MODULE_NOT_FOUND）
 *   - Windows 的 cmd 不展开 glob
 * 所以这里自己列文件，再交给 node --test。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "tests");
const WATCH = process.argv.includes("--watch");

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => path.join("tests", f));

if (!files.length) {
  console.error("tests/ 下没有 *.test.mjs");
  process.exit(1);
}

const args = ["--test", ...(WATCH ? ["--watch"] : []), ...files];
const r = spawnSync(process.execPath, args, { stdio: "inherit", cwd: ROOT });
process.exit(r.status === null ? 1 : r.status);
