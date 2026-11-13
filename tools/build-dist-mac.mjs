#!/usr/bin/env node
/* 组装 mac 分发包：node tools/build-dist-mac.mjs [--out=dist-mac] [--verify] [--no-tar]
 *
 * 为什么要它：mac 的 build:app:lite 只产出 Nihonco.app 这个「壳」，它必须和项目目录
 * 待在一起才能跑。要发给别人就得把「壳 + 代码 + 运行时依赖 + .whisper」拼成一个文件夹——
 * 手工拼过一次，漏了 main.js，包起不来而且没有任何报错。所以这里用固定清单去拷：
 *   缺一样就报错停下，不留半成品。
 *
 * 不打进包的东西：
 *   model/  lib/             Live2D 模型与 Core（许可禁止再分发）
 *   .env                     用户的 API key
 *   data/ 里的个人进度        只拷种子数据表
 *   node_modules 里的构建依赖   electron / electron-builder 一族（约 259MB，运行时用不到）
 *
 * 产物：<out>/Nihonco-mac-arm64-<版本>.tgz + .sha256
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256File } from "./fetch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.join(ROOT, p);
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const args = process.argv.slice(2);
const get = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const OUT_DIR = path.resolve(ROOT, get("out", "dist-mac"));
const VERIFY = args.includes("--verify");
const NO_TAR = args.includes("--no-tar");

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  · ${m}`);

/* ---------------- 清单：少一样就失败 ---------------- */

// 运行时直接从项目根 require 的东西（漏了 main.js 就是这次踩的坑）
const FILES = [
  "main.js", "pet.html", "pet.js", "ui.css",
  "preload.js", "preload-settings.js", "package.json", "asr.py",
  "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
];

const DIRS = ["main", "agent", "renderer", "settings"];

// 只拷种子数据表；个人进度、设置、日志一律不带
const SEED_DATA = [
  "jlpt.json", "word-levels.json", "kanji-stems.json", "pattern-gloss-zh.json",
  "patterns-n1.json", "patterns-n2.json", "patterns-n3.json", "patterns-n4.json",
  "patterns-n5.json", "enrich-cache.seed.json",
];

// 构建期才用得到的包，运行时不需要（electron 那 259MB 是最大头）
const EXCLUDE_MODULES = new Set([
  "electron", "electron-builder", "app-builder-lib", "dmg-builder",
  "builder-util", "builder-util-runtime", "electron-builder-squirrel-windows",
]);

// 运行时自己会重建，不能带进包
const RUNTIME_JUNK = [".electron-data", ".voice", "data/logs", "data/settings.json", "data/.env"];

/* ---------------- 1. 前置检查 ---------------- */
function preflight() {
  const missing = [];
  if (!exists("Nihonco.app")) missing.push("Nihonco.app（先跑 npm run build:app:lite）");
  if (!exists("node_modules")) missing.push("node_modules（先跑 npm ci）");
  if (!exists(".whisper/whisper-server")) missing.push(".whisper/whisper-server（先跑 build:app:lite）");
  const model = ".whisper/models/ggml-small-q5_1.bin";
  if (!exists(model)) missing.push(`${model}（先跑 build:app:lite）`);
  for (const f of FILES) if (!exists(f)) missing.push(f);
  for (const d of DIRS) if (!exists(d)) missing.push(`${d}/`);
  for (const f of SEED_DATA) if (!exists(path.join("data", f))) missing.push(`data/${f}`);
  if (missing.length) {
    bad("缺少必要文件，先修好再打包：");
    for (const m of missing) console.log(`     - ${m}`);
    process.exit(1);
  }
  ok(`清单齐全：${FILES.length} 个文件 / ${DIRS.length} 个目录 / ${SEED_DATA.length} 张数据表`);
}

/* ---------------- 2. 拷贝 ---------------- */
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(rel(src), dst);
}

function copyNodeModules(dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(rel("node_modules"), { withFileTypes: true });
  let kept = 0;
  for (const e of entries) {
    if (EXCLUDE_MODULES.has(e.name)) continue;
    fs.cpSync(path.join(rel("node_modules"), e.name), path.join(dst, e.name), { recursive: true, verbatimSymlinks: true });
    kept += 1;
  }
  return { kept, skipped: entries.length - kept };
}

function assemble(stage) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  // 壳：用 ditto 保住签名与扩展属性
  const ditto = spawnSync("ditto", [rel("Nihonco.app"), path.join(stage, "Nihonco.app")], { encoding: "utf8" });
  if (ditto.status !== 0) throw new Error(`ditto 失败：${(ditto.stderr || "").trim()}`);
  ok("Nihonco.app");

  for (const f of FILES) copyFile(f, path.join(stage, f));
  ok(`${FILES.length} 个文件`);

  for (const d of DIRS) fs.cpSync(rel(d), path.join(stage, d), { recursive: true });
  ok(`${DIRS.length} 个目录`);

  fs.mkdirSync(path.join(stage, "data"), { recursive: true });
  for (const f of SEED_DATA) copyFile(path.join("data", f), path.join(stage, "data", f));
  ok(`${SEED_DATA.length} 张数据表`);

  fs.mkdirSync(path.join(stage, ".whisper", "models"), { recursive: true });
  copyFile(".whisper/whisper-server", path.join(stage, ".whisper", "whisper-server"));
  fs.chmodSync(path.join(stage, ".whisper", "whisper-server"), 0o755);
  copyFile(".whisper/models/ggml-small-q5_1.bin", path.join(stage, ".whisper", "models", "ggml-small-q5_1.bin"));
  ok("whisper-server + 模型");

  const nm = copyNodeModules(path.join(stage, "node_modules"));
  ok(`node_modules：保留 ${nm.kept} 个包，跳过 ${nm.skipped} 个构建期包`);
}

/* ---------------- 3. 使用说明 ---------------- */
const NOTES = `Nihonco · macOS 版（Apple Silicon）

要求：Apple Silicon（M1 及以上）+ macOS 13 以上。Intel Mac 跑不了。

一、怎么启动
  1. 整个文件夹放在任意位置
  2. 双击 Nihonco.app
  3. 第一次会被系统拦（未签名），右键 → 打开 → 仍要打开

  ！Nihonco.app 不能单独拖到「应用程序」：它启动时会去同一文件夹里找 main.js
     和 node_modules，只拷 app 是跑不起来的。要移动就整个文件夹一起移动。

二、还缺三样（许可原因不能随包分发）
  1) 角色模型
     Live2D 官方示例模型 Hiyori 放到： ./model/Hiyori/
     live2dcubismcore.min.js 放到：    ./lib/
     官方示例：https://www.live2d.com/en/learn/sample/
     没放的话窗口里只有 HUD 提示「缺少 Live2D 资源」。

  2) 日语语音合成
     装 VOICEVOX（推荐）或 AivisSpeech 并启动它。
     不装也能用，只是没有声音（macOS 没有可用的日语音色兜底）。

  3) 大模型 key
     桌宠「設定」→ LLM，填自己的 OpenAI 兼容 key（默认 DeepSeek）。
     保存在本文件夹 data/.env，不会上传。

三、已经内置的
  语音识别：whisper.cpp（CPU）+ ggml-small-q5_1 模型，在 .whisper/ 里，
  开箱即用；首次说话要等模型加载 5 秒左右。

四、数据放在哪
  data/            学习进度、词表、设置、日志
  .electron-data/  浏览器内核缓存（可删）
  .voice/          录音和语音缓存（可删）
  清空进度：删 data/ 里的 wordbook.json / vocab-daily.json / pattern-daily.json。

五、卡住时
  data/logs/app.log                     应用日志
  ./Nihonco.app/Contents/MacOS/Electron 终端里跑，能看到启动过程
`;

/* ---------------- 4. 校验启动（可选） ---------------- */
function verify(stage) {
  const bin = path.join(stage, "Nihonco.app", "Contents", "MacOS", "Electron");
  if (!exists(bin)) { bad("找不到可执行文件，跳过校验"); return false; }
  info("启动一次，确认能跑起 main.js（约 15 秒）…");
  const r = spawnSync(bin, [], {
    cwd: stage,
    encoding: "utf8",
    timeout: 90000,
    env: {
      ...process.env,
      PET_EVAL: "1",
      PET_EVAL_DELAY: "8000",
      PET_EVAL_EXIT: "1",
    },
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (/已有实例在运行/.test(out)) { bad("已有另一个 Nihonco 在跑，先退出再校验"); return false; }
  if (!/\[app\] 启动/.test(out)) {
    bad("启动校验失败：没有看到 [app] 启动");
    console.log(out.split("\n").slice(0, 20).join("\n"));
    return false;
  }
  ok("启动校验通过");
  return true;
}

function cleanRuntime(stage) {
  for (const p of RUNTIME_JUNK) fs.rmSync(path.join(stage, p), { recursive: true, force: true });
}

/* ---------------- 5. 打包 ---------------- */
function makeTar(stage, base) {
  const tgz = path.join(OUT_DIR, `${base}.tgz`);
  fs.rmSync(tgz, { force: true });
  const r = spawnSync("tar", ["--no-mac-metadata", "-czf", tgz, "-C", OUT_DIR, base], {
    encoding: "utf8",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (r.status !== 0) throw new Error(`tar 失败：${(r.stderr || "").trim()}`);
  const size = fs.statSync(tgz).size;
  const sha = sha256File(tgz);
  fs.writeFileSync(`${tgz}.sha256`, `${sha}  ${path.basename(tgz)}\n`);
  return { tgz, size, sha };
}

/* ---------------- run ---------------- */
const pkg = JSON.parse(fs.readFileSync(rel("package.json"), "utf8"));
const BASE = `Nihonco-mac-arm64-${pkg.version}`;
const STAGE = path.join(OUT_DIR, BASE);

console.log(`\nNihonco mac 分发包\n${"=".repeat(34)}`);
console.log(`版本 ${pkg.version} · 平台 darwin ${process.arch}`);

preflight();
fs.mkdirSync(OUT_DIR, { recursive: true });
assemble(STAGE);
fs.writeFileSync(path.join(STAGE, "使用说明.txt"), NOTES);
ok("使用说明.txt");

if (VERIFY) {
  const good = verify(STAGE);
  cleanRuntime(STAGE);
  if (!good) { bad("校验没过，不产出 tgz（阶段目录保留：${STAGE}）"); process.exit(1); }
} else if (os.platform() === "darwin") {
  info("跳过了启动校验（加 --verify 才会真的开一次）");
}

const du = (() => {
  const r = spawnSync("du", ["-sh", STAGE], { encoding: "utf8" });
  return (r.stdout || "").split("\t")[0] || "?";
})();
ok(`目录就绪：${STAGE}（${du}）`);

if (NO_TAR) {
  console.log("\n--no-tar：只出目录");
  process.exit(0);
}

const { tgz, size, sha } = makeTar(STAGE, BASE);
ok(`tgz：${tgz}（${(size / 1024 / 1024).toFixed(0)}MB）`);
ok(`sha256：${sha}`);
console.log(`\n完成：${tgz}\n`);
