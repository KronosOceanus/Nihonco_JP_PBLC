#!/usr/bin/env node
/* 准备 whisper.cpp 后端（Metal）：npm run setup:whisper [--check] [--force]
 *
 * 做什么：
 *   1. 找 cmake（系统 / .venv 里的 pip 版 / 可自动装进 .venv）
 *   2. 下 whisper.cpp 源码包（gh-proxy，约 9.8MB）
 *   3. 编译 whisper-server（Metal）
 *   4. 复制到 .whisper/whisper-server
 *   5. 缺模型就下 ggml-small-q5_1.bin（约 181MB）
 *
 * 幂等：已有的二进制/模型默认跳过；--force 强制重编/重下。
 * Intel Mac 同样适用（只是编译和运行都慢一些）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mirrorOrder, parseMirrorMode, pickUrls, downloadFrom } from "./fetch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.join(ROOT, p);
const has = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };
const CHECK = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  · ${m}`);

// 版本钉死，避免上游改 CMake 选项/目标名导致编译失败（Windows 那边 pin 的是 b5454）
const WC_TAG = process.env.WHISPER_CPP_TAG || "v1.9.5";
// 源顺序仿 Go 的 GOPROXY：镜像优先、官方兜底（--mirror=auto|cn|official）
const MIRROR = parseMirrorMode(process.argv);
const SRC_URLS = pickUrls({
  cn: [`https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WC_TAG}.tar.gz`],
  official: [`https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WC_TAG}.tar.gz`],
}, mirrorOrder(MIRROR));
// 固定版本 + 固定哈希：升级 whisper.cpp 或替换模型时两处一起改。
const SRC_SHA256 = process.env.WHISPER_CPP_SHA256 || "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720";
const MODEL_SHA256 = process.env.WHISPER_MODEL_SHA256 || "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";
const MODEL_URLS = pickUrls({
  cn: ["https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"],
  official: ["https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"],
}, mirrorOrder(MIRROR));
const MODEL_NAME = "ggml-small-q5_1.bin";
// 完整文件约 181MB；阈值卡在 170MB，避免把「下了一半」当成已完成
const MODEL_MIN_BYTES = 170 * 1024 * 1024;
const modelReady = (p) => has(p) && fs.statSync(p).size >= MODEL_MIN_BYTES;

function sha256(file) {
  const h = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** 校验文件；--check 只报告，不删除 */
function verifyFile(file, expected, label) {
  if (!has(file)) { bad(`${label} 不存在`); return false; }
  const actual = sha256(file);
  if (actual === expected) { ok(`${label} sha256 校验通过`); return true; }
  bad(`${label} sha256 不匹配`);
  console.log(`      期望 ${expected}`);
  console.log(`      实际 ${actual}`);
  if (!CHECK) {
    try { fs.unlinkSync(file); } catch (e) {}
    info(`已删除损坏的 ${label}，稍后重新下载`);
  }
  return false;
}

const BIN = rel(IS_WIN ? ".whisper/whisper-server.exe" : ".whisper/whisper-server");
const MODELS = rel(".whisper/models");
const BUILD = rel(".whisper/build");

if (IS_WIN) {
  // Windows 不代编（没有 cmake/MSVC 环境）：二进制手动解压，但**模型照下**，
  // 因为打包白名单只收 ggml-small-q5_1.bin，缺了安装包就没有识别能力。
  let bad1 = false;
  if (!has(BIN)) {
    console.log("\nWindows 需要预编译包（脚本不代下）：");
    console.log("  https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip");
    console.log("  解压到 .whisper/（Release/ 里的内容摊平，tt 要带上 ggml-*.dll）\n");
    process.exit(1);
  }
  ok("二进制已存在：.whisper/whisper-server.exe");
  // whisper-server.exe 是动态链接的，光有 exe 起不来
  const dlls = fs.readdirSync(rel(".whisper")).filter((f) => f.endsWith(".dll"));
  if (!dlls.length) { bad("缺 ggml-*.dll / whisper.dll：whisper-server.exe 起不来，请重新解压预编译包"); bad1 = true; }
  else ok(`${dlls.length} 个 DLL`);
  const modelOk = ensureModel();
  process.exit(modelOk && !bad1 ? 0 : 1);
}

/* ---------------- 1. cmake ---------------- */
function findCmake() {
  const cands = [
    process.env.CMAKE,
    rel(".venv/bin/cmake"),
    "/opt/homebrew/bin/cmake",
    "/usr/local/bin/cmake",
    "cmake",
  ].filter(Boolean);
  for (const c of cands) {
    if (c.includes("/") && !has(c)) continue;
    const r = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

function brewCmake() {
  if (!IS_MAC) return null;
  const b = spawnSync("brew", ["--version"], { encoding: "utf8" });
  if (b.status !== 0) return null;
  if (CHECK) { warn("缺 cmake：会执行 brew install cmake"); return null; }
  console.log("\n  · 没有 cmake，使用 Homebrew 安装（brew install cmake）…");
  const r = spawnSync("brew", ["install", "cmake"], { stdio: "inherit" });
  return r.status === 0 ? findCmake() : null;
}

function ensureCmake() {
  let cmake = findCmake();
  if (cmake) { ok(`cmake: ${cmake}`); return cmake; }

  // 有 .venv：优先 pip 装到 venv，不碰系统
  const py = has(rel(".venv/bin/python")) ? rel(".venv/bin/python") : null;
  if (py && !CHECK) {
    console.log("\n  · 没有 cmake，装一个到 .venv（不动系统）…");
    const r = spawnSync(py, ["-m", "pip", "install", "-q", "cmake",
      "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"], { stdio: "inherit" });
    cmake = r.status === 0 ? findCmake() : null;
    if (cmake) { ok(`cmake: ${cmake}`); return cmake; }
  }

  // 没有 .venv：macOS 用 Homebrew；Windows 不代装
  cmake = brewCmake();
  if (cmake) { ok(`cmake: ${cmake}`); return cmake; }
  if (py && CHECK) warn("缺 cmake：会执行 .venv/bin/python -m pip install cmake");
  else bad("没有 cmake；请先 brew install cmake（macOS）或安装 CMake");
  return null;
}

/* ---------------- 2-3. 下载源码 + 编译 ---------------- */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd || ROOT, ...opts });
  return r.status === 0;
}

function buildServer(cmake) {
  fs.mkdirSync(BUILD, { recursive: true });
  if (!has(path.join(BUILD, "CMakeLists.txt"))) {
    const tgz = path.join(BUILD, "src.tgz");
    if (CHECK) { warn(`缺源码：会下载 whisper.cpp ${WC_TAG}（约 9.8MB，源 ${MIRROR}）`); return false; }
    // 源码包只有 9.8MB，每次重下：避免续传一个坏掉的半截包
    try { fs.unlinkSync(tgz); } catch (e) {}
    console.log("\n  · 下载 whisper.cpp 源码…");
    const got = downloadFrom({
      urls: SRC_URLS, dst: tgz, minBytes: 1024 * 1024, sha256: SRC_SHA256,
      label: ` whisper.cpp 源码（${WC_TAG}）`, maxTime: 300, log: info,
    });
    if (!got.ok) { bad("源码下载失败：所有源都没成（--mirror=official 可强制走官方）"); return false; }
    ok(`源码下载完成（${got.url}）`);
    if (!run("tar", ["xzf", tgz, "-C", BUILD, "--strip-components=1"])) { bad("解压失败"); return false; }
    ok("源码就绪");
  } else {
    ok("源码已存在（--force 只重编）");
  }

  const args = ["-B", "build", "-DGGML_METAL=ON", "-DWHISPER_BUILD_TESTS=OFF",
                "-DWHISPER_BUILD_EXAMPLES=ON", "-DCMAKE_POLICY_VERSION_MINIMUM=3.5"];
  console.log("\n  · 配置（Metal）…");
  if (!run(cmake, args, { cwd: BUILD })) { bad("cmake 配置失败"); return false; }
  console.log("\n  · 编译 whisper-server（几分钟，取决于 CPU）…");
  const jobs = String(Math.max(2, os.cpus().length - 2));
  if (!run(cmake, ["--build", "build", "-j", jobs, "--target", "whisper-server"], { cwd: BUILD })) {
    bad("编译失败（看上面的报错）");
    return false;
  }
  const built = path.join(BUILD, "build", "bin", "whisper-server");
  if (!has(built)) { bad("编译完成但没找到 build/bin/whisper-server"); return false; }
  fs.mkdirSync(rel(".whisper"), { recursive: true });
  fs.copyFileSync(built, BIN);
  fs.chmodSync(BIN, 0o755);
  ok(`已安装 ${path.relative(ROOT, BIN)}`);
  return true;
}

/* ---------------- 5. 模型 ---------------- */
function ensureModel() {
  fs.mkdirSync(MODELS, { recursive: true });
  const dst = path.join(MODELS, MODEL_NAME);
  if (modelReady(dst)) {
    if (!verifyFile(dst, MODEL_SHA256, MODEL_NAME)) {
      if (CHECK) return false;
    } else {
      const mb = Math.round(fs.statSync(dst).size / 1024 / 1024);
      ok(`模型已存在：${MODEL_NAME}（${mb}MB）`);
      return true;
    }
  }
  if (CHECK) { warn(`缺模型：会下载 ${MODEL_NAME}（约 181MB，源 ${MIRROR}）并校验`); return false; }
  console.log(`\n  · 下载模型 ${MODEL_NAME}（约 181MB，支持断点续传）…`);
  // 两轮：同一个源中途断了还能续，第一轮全失败才彻底放弃
  for (let round = 1; round <= 2; round++) {
    const got = downloadFrom({
      urls: MODEL_URLS, dst, minBytes: MODEL_MIN_BYTES, sha256: MODEL_SHA256,
      label: `模型 ${MODEL_NAME}`, maxTime: 600, log: info,
    });
    if (got.ok && verifyFile(dst, MODEL_SHA256, MODEL_NAME)) {
      ok(`模型就绪：${MODEL_NAME}（${Math.round(fs.statSync(dst).size / 1024 / 1024)}MB）`);
      return true;
    }
    if (round < 2) warn("第一轮没成，重试（会从断点续传）…");
  }
  bad("模型下载失败：可以手动放到 .whisper/models/，或用 --mirror=official 再试");
  return false;
}

/* ---------------- run ---------------- */
console.log("\nNihonco whisper.cpp 准备（macOS / Metal）\n" + "=".repeat(44));
console.log(`平台 ${process.platform} ${process.arch}${CHECK ? " · --check 只看计划" : ""}`);
console.log(`源码 whisper.cpp ${WC_TAG}（sha256 校验）`);
console.log(`下载源模式 ${MIRROR}：${mirrorOrder(MIRROR).join(" → ")}`);

let code = 0;
const exeOk = has(BIN) && !FORCE;
if (exeOk) {
  ok(`whisper-server 已存在（${Math.round(fs.statSync(BIN).size / 1024)}KB），跳过编译`);
} else {
  const cmake = ensureCmake();
  if (!cmake) code = 1;
  else if (CHECK) warn("会重新编译 whisper-server");
  else if (!buildServer(cmake)) code = 1;
}

if (!ensureModel()) code = 1;

if (!code) {
  console.log("\n下一步：设置窗口 → 应用信息 → 语音识别 → 后端选 whisper.cpp、模型选最小那个");
  console.log("（或 .env：ASR_BACKEND=whispercpp / ASR_MODEL=small-q5_1）\n");
} else {
  console.log("\n有步骤没完成，修好上面的报错后重跑：npm run setup:whisper\n");
}
process.exit(code);
