#!/usr/bin/env node
/* 读取 demo/full-demo.js，作为 PET_EVAL 注入应用；只启动演示，不录屏 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fs.readFileSync(path.join(ROOT, "demo", "full-demo.js"), "utf8");
const electron = path.join(ROOT, "node_modules", "electron", "cli.js");
const child = spawn(process.execPath, [electron, "main.js", "--no-sandbox"], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    VOICE_PREWARM_DELAY: "999999",
    PET_DEBUG: "1",
    PET_EVAL: script,
    PET_EVAL_DELAY: "6000",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
