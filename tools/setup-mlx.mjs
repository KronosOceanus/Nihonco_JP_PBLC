#!/usr/bin/env node
/* 准备 macOS mlx-whisper：.venv + requirements + 预下载/预热模型
 *   npm run setup:mlx
 *   ASR_MODEL=mlx-community/whisper-large-v3-turbo npm run setup:mlx
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const asrBackends = require("../agent/asr-backends.js");
const VENV = path.join(ROOT, ".venv");
const PY = path.join(VENV, "bin", "python");
const CHECK = process.argv.includes("--check");
const has = (p) => { try { return fs.existsSync(p); } catch { return false; } };

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

function fail(msg) {
  bad(msg);
  console.log("\n有步骤没完成，修好上面的报错后重跑：npm run setup:mlx\n");
  process.exit(1);
}

/** 返回 { ok, error }，不把可预期失败变成异常 */
function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.error) return { ok: false, error: `${cmd} 启动失败：${r.error.message}` };
  if (r.status !== 0) {
    const why = r.signal ? `被信号 ${r.signal} 终止` : `退出码 ${r.status}`;
    return { ok: false, error: `${cmd} ${why}` };
  }
  return { ok: true };
}


function check() {
  console.log("\nNihonco mlx 检查（--check，只读）\n" + "=".repeat(40));
  let code = 0;
  console.log(`\n[1] .venv`);
  if (has(PY)) ok(path.relative(ROOT, VENV));
  else { bad("缺 .venv；正式运行会创建"); code = 1; }

  console.log("\n[2] mlx-whisper");
  if (has(PY)) {
    const r = run(PY, ["-c", "import mlx_whisper; print(mlx_whisper.__file__)"], { stdio: "ignore" });
    if (r.ok) ok("已安装"); else { bad("未安装；正式运行会 pip install"); code = 1; }
  } else { bad("缺 .venv，无法检查"); code = 1; }

  const model = process.env.ASR_MODEL || "mlx-community/whisper-small-mlx";
  console.log("\n[3] 模型");
  if (asrBackends.mlxModelReady(model, ROOT)) ok(model);
  else { bad(`缺 ${model}；正式运行会下载`); code = 1; }

  console.log(code ? "\n有步骤没就绪；运行 npm run setup:mlx 补齐。\n" : "\n全部就绪。\n");
  process.exit(code);
}

function main() {
  if (process.platform !== "darwin") {
    fail("mlx-whisper 只支持 macOS（Apple Silicon）");
  }
  if (CHECK) check();

  if (!has(PY)) {
    console.log("== 建 .venv");
    const r = run("python3", ["-m", "venv", VENV]);
    if (!r.ok) fail(`没建成 .venv：${r.error}\n请先安装 python3`);
    ok(`.venv：${path.relative(ROOT, VENV)}`);
  }

  console.log("== 安装 mlx-whisper 依赖");
  const deps = run(PY, ["-m", "pip", "install", "-q", "-r", path.join(ROOT, "requirements.txt")]);
  if (!deps.ok) fail(`安装 mlx-whisper 依赖失败：${deps.error}`);
  ok("mlx-whisper 依赖已安装");

  const model = process.env.ASR_MODEL || "mlx-community/whisper-small-mlx";
  console.log(`== 预热 mlx 模型：${model}（首次会下载）`);
  const warm = run(PY, ["-c", `
import os, numpy as np, mlx_whisper
name = os.environ.get("ASR_MODEL") or "mlx-community/whisper-small-mlx"
mlx_whisper.transcribe(np.zeros(8000, dtype=np.float32), path_or_hf_repo=name, language="ja", verbose=False)
print("[mlx] ready:", name)
`], { env: { ...process.env, ASR_MODEL: model,
    HF_HOME: path.join(ROOT, ".hf-cache"),
    HF_ENDPOINT: process.env.HF_ENDPOINT || "https://hf-mirror.com",
  } });
  if (!warm.ok) {
    fail(`下载/预热 mlx 模型失败：${warm.error}\n检查网络，或换一个 ASR_MODEL（默认 whisper-small-mlx）`);
  }
  ok(`mlx 模型就绪：${model}`);

  console.log("\n下一步：设置 → ASR → 引擎选 mlx-whisper，模型选对应项\n");
}

try {
  main();
} catch (e) {
  // 真正意外的错误：给一句话；DEBUG=1 才看堆栈
  bad(e && e.message ? e.message : String(e));
  if (process.env.DEBUG) console.error(e && e.stack || e);
  process.exit(1);
}
