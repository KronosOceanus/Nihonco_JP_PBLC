#!/usr/bin/env node
/* 统一构建入口
 *
 *   node tools/build-app.mjs --target=mac --mode=lite
 *   node tools/build-app.mjs --target=mac --mode=lite --with-mlx
 *   node tools/build-app.mjs --target=win --mode=lite
 *   node tools/build-app.mjs --target=win --mode=lite --dir
 *
 * 只支持 lite：只要求 ASR；Live2D/VOICEVOX 外置。
 * --with-mlx: macOS 额外准备 mlx 环境并预下载模型
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const get = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`) || process.env[name.toUpperCase().replace(/-/g, "_")] === "1";
const target = get("target", process.platform === "darwin" ? "mac" : "win");
const mode = get("mode", "lite");
if (mode !== "lite") throw new Error("只支持 lite 构建");
const dir = has("dir");
const format = get("format", "");
const withMlx = has("with-mlx");
const isMac = target === "mac";
const isWin = target === "win";

if (!["mac", "win"].includes(target)) throw new Error("--target 只能是 mac 或 win");

if (withMlx && !isMac) throw new Error("--with-mlx 只支持 macOS");
if (dir && !isWin) throw new Error("--dir 只支持 Windows");
if (format && !["nsis", "portable"].includes(format)) throw new Error("--format 只能是 nsis 或 portable");

function run(cmd, argv, opts = {}) {
  console.log(`\n$ ${cmd} ${argv.join(" ")}`);
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: "inherit", ...opts });
  // Windows 上直接 spawn .cmd/.bat 会得到 status=null + error=EINVAL；
  // 先看 r.error，避免把 EINVAL 误报成“退出码 null”。
  if (r.error) throw new Error(`${cmd} 启动失败：${r.error.code || r.error.message}`);
  if (r.status !== 0) {
    const signal = r.signal ? `，signal=${r.signal}` : "";
    throw new Error(`${cmd} 退出码 ${r.status}${signal}`);
  }
}

function exists(rel) { try { return fs.existsSync(path.join(ROOT, rel)); } catch { return false; } }
function ensureMlx() {
  // 和 npm run setup:mlx 共用同一份逻辑，避免两个脚本各维护一套模型判断
  run(process.execPath, [path.join(ROOT, "tools/setup-mlx.mjs")]);
}

function checkNode() {
  if (!exists("node_modules/electron")) throw new Error("没有 node_modules/electron：先 npm ci");
  if (!exists("node_modules/electron/dist")) throw new Error("Electron 二进制没下载：node node_modules/electron/install.js");
  if (!exists("node_modules/electron-builder/cli.js")) throw new Error("没有 electron-builder：先 npm ci");
}

function buildMac() {
  run(process.execPath, [path.join(ROOT, "tools/check-assets.mjs"), "--lite"]);
  run(process.execPath, [path.join(ROOT, "tools/setup-whisper.mjs")]);
  if (withMlx) ensureMlx();
  run("bash", [path.join(ROOT, "tools", "build-app.sh")]);
}

function buildWin() {
  run(process.execPath, [path.join(ROOT, "tools/check-assets.mjs"), "--lite"]);
  run(process.execPath, [path.join(ROOT, "tools/setup-whisper.mjs")]);
  const targetArgs = dir
    ? ["--win", "--x64", "--dir"]
    : ["--win", ...(format ? [format] : []), "--x64"];
  // Windows 上不能直接 spawn npx.cmd（CVE-2024-27980 后 EINVAL）；
  // 用 node + 本地 cli.js，跨平台、不经过 shell，也固定 electron-builder 版本。
  const cli = path.join(ROOT, "node_modules", "electron-builder", "cli.js");
  run(process.execPath, [cli, ...targetArgs]);
}

console.log(`== 构建 ${target} / lite${withMlx ? " / mlx" : ""}${dir ? " / dir" : ""}`);
checkNode();
if (isMac) buildMac(); else buildWin();
console.log("\n✅ 构建完成");
