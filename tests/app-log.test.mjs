import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* 应用日志：把 console 输出与未捕获异常写到 data/logs/app.log，2MB 轮转。
 * 这里只测写入/轮转/开关，不去触发真实异常。 */

// 子进程里 require 的必须是真实文件路径：Windows 上 URL.pathname 是 "/D:/..."，require 会失败
const APP_LOG_PATH = fileURLToPath(new URL("../agent/app-log.js", import.meta.url));

process.env.APP_LOG_MAX = String(20 * 1024);          // 小上限，方便测轮转
const appLog = await import("../agent/app-log.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-applog-"));

test("install 后 console.log 会落盘", () => {
  const dir = tmp();
  const info = appLog.install({ dir });
  assert.equal(info.file, path.join(dir, "app.log"));
  console.log("hello 应用日志");
  const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
  assert.match(text, /hello 应用日志/);
  assert.match(text, /\[info\]/);
});

test("write() 带时间戳与级别；Error 会写 stack", () => {
  const dir = tmp();
  appLog.install({ dir });       // 已安装过就幂等
  appLog.write("error", ["出错了", new Error("boom")]);
  const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
  assert.match(text, /\[error\] 出错了/);
  assert.match(text, /boom/);
});

test("超过上限会轮转成 app.log.1", () => {
  const dir = tmp();
  appLog.install({ dir });      // 重新指向这个临时目录
  for (let i = 0; i < 400; i++) appLog.write("info", [`line ${i} ${"x".repeat(120)}`]);
  const f = path.join(dir, "app.log");
  assert.ok(fs.existsSync(f + ".1"), "应该有 .1 归档");
  assert.ok(fs.statSync(f).size <= 20 * 1024 + 400, `当前文件不该无限增长（${fs.statSync(f).size}）`);
});

test("APP_LOG=0 时不启用", () => {
  const prev = process.env.APP_LOG;
  process.env.APP_LOG = "0";
  try { assert.equal(appLog.enabled(), false); }
  finally { process.env.APP_LOG = prev; }
});

test("致命错误：写 fatal，并把收场交给 exit 回调（打包版 = 退出）", () => {
  const dir = tmp();
  const script = `
    process.env.APP_LOG_MAX = '20480';
    const log = require(${JSON.stringify(APP_LOG_PATH)});
    log.install({ dir: ${JSON.stringify(dir)}, exit: (code) => process.exit(code || 1) });
    throw new Error("kaboom");
  `;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.notEqual(r.status, 0, "传了 exit 回调就不该继续跑");
  const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
  assert.match(text, /\[fatal\] uncaughtException/);
  assert.match(text, /kaboom/);
});

test("致命错误：没传 exit 回调时只记日志（开发模式保留进程）", () => {
  const dir = tmp();
  const script = `
    process.env.APP_LOG_MAX = '20480';
    const fs = require('fs');
    const log = require(${JSON.stringify(APP_LOG_PATH)});
    log.install({ dir: ${JSON.stringify(dir)}, exit: null });
    Promise.reject(new Error("rejected"));
    setTimeout(() => process.exit(0), 200);
  `;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, "没有 exit 回调时进程应继续跑完");
  const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
  assert.match(text, /\[fatal\] unhandledRejection/);
});
