/* 语音识别子进程：mlx（asr.py）或 whisper.cpp（agent/asr-whispercpp.js）
 *
 * 状态（asrProc / asrReady）在工厂闭包里；启动失败只影响识别，不影响桌宠。
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const health = require("../agent/health");

module.exports = function createAsr({ root, platform, procs, asrWhisper, asrBackends, log = () => {} }) {
  const rememberProc = procs.rememberProc;
  const killPid = platform.killPid;
  const ROOT = root;

// 本地语音识别：spawn `.venv/bin/python asr.py`，监听 127.0.0.1:8765
let asrProc = null;
let asrReady = null;      // 正在等待就绪的 Promise（避免并发重复 spawn）
// 启动状态：只用于「确定起不来」的判定（spawn 失败 / 异常退出）
let asrState = { startedAt: 0, backend: "", exited: false, lastError: "" };


/** 只停不启：装/换后端文件前要用（Windows 上被占用的 exe/dll 删不掉、盖不上） */
function stopAsr() {
  try { asrWhisper.stop(); } catch (e) {}
  try {
    if (asrProc && asrProc.pid) killPid(asrProc.pid, true);
  } catch (e) {}
  asrProc = null;
  asrReady = null;
  asrState = { startedAt: 0, backend: "", exited: false, lastError: "" };
}

/** 换后端/模型：停掉当前识别服务再按新的 .env 起一遍（端口 8765 不换） */
async function restartAsr() {
  console.log('[asr] 重启识别服务…');
  stopAsr();
  await new Promise((r) => setTimeout(r, 800));
  startAsr();
  return true;
}

function startAsr() {
  // 后端选择：ASR_BACKEND=mlx|whispercpp
  //   默认：mac / Windows 都走 whisper.cpp；mlx 为可选后端（需 Python）
  //   mac 上设 whispercpp 后走同一份 agent/asr-whispercpp.js（Metal，免 Python）
  // 显式配置优先；没配置时「有 whisper.cpp 就用它，否则 mlx」
  let backend = platform.asrBackendFor(process.env.ASR_BACKEND);
  let av = null;
  try {
    av = asrBackends && asrBackends.available ? asrBackends.available(root) : null;
    if (av) backend = platform.resolveAsrBackend({
      configured: process.env.ASR_BACKEND, whisper: av.wcpp, mlx: av.mlx,
    });
  } catch (e) {}
  // 两个后端都没有「运行环境 + 模型」时不要 spawn，直接进入 failed，避免白等 40s
  if (av && !av.mlx && !av.wcpp) {
    asrState = { startedAt: Date.now(), backend: "none", exited: true,
                 lastError: "缺 ASR 模型：请在设置 → ASR 下载模型" };
    console.log("[asr] 缺 ASR 模型，跳过启动");
    return false;
  }
  asrState = { startedAt: Date.now(), backend, exited: false, lastError: "" };
  if (backend === 'whispercpp') {
    asrWhisper.start()
      .then((p) => console.log(`[asr] 后端 whisper.cpp，服务端口 ${p}`))
      .catch((e) => {
        asrState.exited = true; asrState.lastError = e.message;
        console.log('[asr] whisper.cpp 启动失败:', e.message);
      });
    return;
  }
  const py = path.join(ROOT, ".venv", "bin", "python");
  const runner = fs.existsSync(py) ? py : "/usr/bin/python3";
  // JS 的 mlxModelReady 是唯一判断源；把 ready 列表交给 asr.py，避免两边各扫一套缓存
  let mlxReady = null;
  try {
    if (asrBackends && asrBackends.mlxModels) {
      mlxReady = asrBackends.mlxModels(root).filter((m) => m.ready).map((m) => m.value);
    }
  } catch (e) {}
  asrProc = spawn(runner, [path.join(ROOT, "asr.py")], {
    env: { ...process.env,
           // Finder 启动时 PATH 很干净，补上 Homebrew（ffmpeg 等）
           PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin:/bin"}`,
           HF_HOME: path.join(ROOT, ".hf-cache"),
           HF_ENDPOINT: process.env.HF_ENDPOINT || "https://hf-mirror.com", ASR_PORT: "8765",
           ...(mlxReady ? { ASR_MLX_READY: JSON.stringify(mlxReady) } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log("[asr] spawn:", runner, "cwd:", ROOT);
  rememberProc('asr', asrProc, 'asr.py');
  asrProc.on("error", (e) => {
    asrState.exited = true; asrState.lastError = e.message;
    console.log("[asr] spawn error:", e.message);
  });
  asrProc.stdout.on("data", (d) => console.log("[asr]", d.toString().trimEnd()));
  asrProc.stderr.on("data", (d) => console.log("[asr:err]", d.toString().trimEnd()));
  asrProc.on("exit", (code) => {
    console.log("[asr] 子进程退出", code);
    asrState.exited = true;
    if (!asrState.lastError) asrState.lastError = `exit ${code}`;
    asrProc = null;            // 允许下次调用时重新拉起
    asrReady = null;
  });
}

/**
 * 确保语音服务在线：探 /health，挂了就重新 spawn 并轮询等待
 * 「识别失败」最常见的根因就是这个——asr 子进程崩了，但 Electron 还活着
 */
async function ensureAsr(timeoutMs = 40000) {
  const ping = async () => {
    try {
      const r = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(1200) });
      if (!r.ok) return false;
      const j = await r.json();
      // 模型没加载完时 /health 也回 ok:true，必须等 ready 才算就绪
      return !!j.ok && j.ready !== false;
    } catch (e) { return false; }
  };

  if (await ping()) return true;
  if (asrState.backend === "none" && asrState.exited) {
    throw new Error(asrState.lastError || "缺 ASR 模型");
  }
  if (asrReady) return asrReady;

  asrReady = (async () => {
    console.log('[asr] 服务不在线，重新拉起…');
    if (!asrProc) startAsr();
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ping()) { console.log(`[asr] 已就绪（${Date.now() - t0}ms）`); return true; }
      await new Promise((r) => setTimeout(r, 600));
    }
    console.log('[asr] 拉起超时');
    return false;
  })();

  try { return await asrReady; } finally { asrReady = null; }
}


  function getAsrProc() { return asrProc; }

  /** 启动自检：只有「确定起不来」才 failed；端口通了但 ready:false = 加载中
   *  - 先看 /health：能连上且 ready → ready
   *  - 能连上但没 ready → loading（进程还活着）/ failed（进程没了）
   *  - 连不上 → 等 timeoutMs；期间进程退出/spawn 失败 → failed
   */
  async function probeAsr({ timeoutMs = 30000 } = {}) {
    const t0 = Date.now();
    const ping = async () => {
      try {
        const r = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(1200) });
        if (!r.ok) return null;
        return await r.json();
      } catch (e) { return null; }
    };
    const alive = () => {
      if (!asrState.startedAt) return true;   // 还没开始启动：先当活着，别误报
      if (asrState.backend === "whispercpp" && asrWhisper.status) {
        try { return !!asrWhisper.status().running; } catch (e) { return true; }
      }
      return !!(asrProc && asrProc.exitCode === null);
    };
    let j = await ping();
    for (;;) {
      const v = health.asrVerdict({
        reachable: !!j,
        ready: !!(j && j.ready !== false),
        processAlive: alive(),
        spawnError: asrState.exited ? (asrState.lastError || "exited") : "",
        waitedMs: Date.now() - t0,
        timeoutMs,
      });
      if (v.status !== "starting") {
        const out = {
          status: v.status, reason: v.reason || "",
          backend: asrState.backend, model: j && j.model,
          waitedMs: Date.now() - t0, lastError: asrState.lastError,
        };
        console.log(`[health] asr status=${out.status}${out.reason ? " reason=" + out.reason : ""} backend=${out.backend || "-"} waited=${out.waitedMs}ms`);
        return out;
      }
      await new Promise((r) => setTimeout(r, 600));
      j = await ping();
    }
  }

  return { startAsr, restartAsr, stopAsr, ensureAsr, getAsrProc, probeAsr };
};
