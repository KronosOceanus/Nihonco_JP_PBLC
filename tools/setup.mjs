#!/usr/bin/env node
/* 一次性环境检查 + 初始化：npm run setup
 *
 * 干三件事：
 *   1) 检查 Node / .env / whisper.cpp / VOICEVOX 是否就位
 *   2) 缺 .env 就从 .env.example 复制一份
 *   3) 把「还差什么、去哪儿下、放到哪」打出来
 *
 * 不联网、不装东西、不改系统 —— 只做体检。
 * （例外：macOS 上如果没有 .venv，会把建 Python 环境这件事转交给 tools/setup.sh）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const rel = (p) => path.join(ROOT, p);
const has = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

/* macOS：Python 虚拟环境（mlx-whisper）原来由 tools/setup.sh 负责，
 * 这里直接把它转交过去，免得「合了 Windows 分支之后 mac 上 npm run setup 不再建 venv」。 */
if (process.platform === "darwin" && !has(rel(".venv/bin/python")) && has(rel("tools/setup.sh"))) {
  console.log("\nmacOS 上还没有 .venv —— 转交 tools/setup.sh 建 Python 环境…\n");
  const r = spawnSync("bash", [rel("tools/setup.sh")], { stdio: "inherit" });
  if (r.status !== 0) {
    console.log(`\x1b[31mtools/setup.sh 失败（exit ${r.status}）\x1b[0m`);
    process.exit(1);
  }
  console.log("");
}

let blocking = 0;
let warnings = 0;

console.log("\nNihonco 环境检查\n" + "=".repeat(40));

/* --------------------------- 1. Node --------------------------- */
console.log("\n[1] 运行时");
const major = Number(process.versions.node.split(".")[0]);
if (major >= 18) ok(`Node ${process.version}`);
else { bad(`Node ${process.version} 太旧，需要 >= 18`); blocking++; }
ok(`平台 ${process.platform} ${process.arch}`);

/* --------------------------- 2. 依赖 --------------------------- */
console.log("\n[2] npm 依赖");
if (has(rel("node_modules/electron"))) {
  ok("electron 已安装");
  if (has(rel("node_modules/electron/dist"))) ok("electron 二进制已下载");
  else { bad("electron 二进制缺失 —— 跑：node node_modules/electron/install.js"); blocking++; }
} else { bad("没装依赖 —— 跑：npm install"); blocking++; }

/* --------------------------- 3. .env --------------------------- */
console.log("\n[3] 配置");
const envPath = rel(".env");
if (has(envPath)) {
  const env = fs.readFileSync(envPath, "utf8");
  ok(".env 存在");
  if (/^\s*LLM_API_KEY\s*=\s*(sk-)?[^\s#]+/m.test(env)) ok("LLM_API_KEY 已填");
  else { warn("LLM_API_KEY 还没填（对话会失败；MOCK_LLM=1 可以先用假回复）"); warnings++; }
} else {
  if (has(rel(".env.example"))) {
    fs.copyFileSync(rel(".env.example"), envPath);
    warn("已从 .env.example 生成 .env —— 记得填 LLM_API_KEY");
    warnings++;
  } else { bad("既没有 .env 也没有 .env.example"); blocking++; }
}

/* --------------------------- 4. ASR --------------------------- */
console.log("\n[4] 语音识别");
if (IS_WIN) {
  const home = path.join(ROOT, ".whisper");
  const exe = path.join(home, "whisper-server.exe");
  if (has(exe)) ok("whisper-server.exe 就位");
  else {
    bad("缺 .whisper/whisper-server.exe");
    console.log("      下载：https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip");
    console.log("      解压到 .whisper/（zip 内 Release/ 里的内容摊平到根上）");
    blocking++;
  }
  const modelFiles = has(path.join(home, "models")) ? fs.readdirSync(path.join(home, "models")).filter((f) => f.endsWith(".bin")) : [];
  if (modelFiles.length) ok(`模型：${modelFiles.join(", ")}`);
  else {
    bad("缺模型文件 .whisper/models/ggml-small.bin");
    console.log("      下载：https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin（465 MB）");
    blocking++;
  }
} else {
  const py = rel(".venv/bin/python");
  if (has(py)) ok("mac 路线：.venv/bin/python 就位（mlx-whisper）");
  else { warn("mac 需要 .venv + mlx-whisper，或把 ASR 换成 whisper.cpp"); warnings++; }
}

/* --------------------------- 5. TTS --------------------------- */
console.log("\n[5] 语音合成");
const vvCandidates = process.env.VOICEVOX_ENGINE ? [process.env.VOICEVOX_ENGINE] : (IS_WIN
  ? [path.join(ROOT, ".voicevox", "windows", "VOICEVOX", "vv-engine", "run.exe"),
     path.join(ROOT, ".voicevox", "windows", "vv-engine", "run.exe"),
     path.join(process.env.ProgramFiles || "C:\\Program Files", "VOICEVOX", "vv-engine", "run.exe"),
     path.join(process.env.LOCALAPPDATA || "", "Programs", "VOICEVOX", "vv-engine", "run.exe")]
  : [path.join(ROOT, ".voicevox", "extracted", "VOICEVOX", "VOICEVOX.app",
               "Contents", "Resources", "vv-engine", "run")]);
const vv = vvCandidates.find(has);
if (vv) ok(`VOICEVOX 引擎：${vv}`);
else {
  warn("没找到 VOICEVOX 引擎 —— 日语朗读会退化成系统 TTS（Windows 没有日语声线，效果差）");
  if (IS_WIN) {
    console.log("      推荐下载（2.07 GB）：https://gh-proxy.com/https://github.com/VOICEVOX/voicevox/releases/download/0.26.1/voicevox-windows-cpu-0.26.1.zip");
    console.log("      解压到 .voicevox/windows/（里面应有 VOICEVOX/vv-engine/run.exe）");
    console.log("      或直接装官方版，会落在 C:\\Program Files\\VOICEVOX");
  }
  warnings++;
}

/* --------------------------- 6. 数据 --------------------------- */
console.log("\n[6] 数据文件");
const dataDir = process.env.NIHONCO_DATA_DIR || rel("data");
for (const f of ["jlpt.json", "word-levels.json", "patterns-n5.json"]) {
  if (has(path.join(dataDir, f))) ok(`data/${f}`);
  else { bad(`缺 data/${f}（仓库里应该有）`); blocking++; }
}
if (has(rel("model/Hiyori/Hiyori.model3.json"))) ok("Live2D 模型 Hiyori 就位");
else { warn("model/Hiyori 缺失，桌宠会白屏"); warnings++; }

/* --------------------------- 收尾 --------------------------- */
console.log("\n" + "=".repeat(40));
if (blocking) {
  console.log(`\x1b[31m${blocking} 个必须解决的问题\x1b[0m` + (warnings ? `，${warnings} 个提醒` : ""));
  process.exit(1);
}
console.log(`\x1b[32m可以跑了\x1b[0m` + (warnings ? `（${warnings} 个提醒，见上）` : ""));
console.log("\n下一步：");
console.log("  npm start                 # 开发期直接跑");
console.log("  npm test && npm run scan  # 自检");
console.log("  npm run build:win:dir     # 打包成目录试启动");
console.log("  npm run build:win         # 出 portable + NSIS 安装包");
console.log("");
