/* GPU 加速版 whisper.cpp（Windows CUDA）——探测、下载、安装、切换
 *
 * 为什么要它：CPU 版识别一句固定 2.7–3.0 s（Whisper 永远补零到 30 秒窗口，
 * 跟句子长短无关）；CUDA 版实测 145–158 ms，快 18 倍。
 *
 * 目录约定（与 agent/asr-whispercpp.js 一致）：
 *   <asrDir>/active.json        {"backend":"cuda-12.4"}
 *   <asrDir>/cuda-12.4/         whisper-server.exe + 全部 dll（约 1.1 GB）
 *   模型不复制：GPU 版共用内置 .whisper/models 里的 .bin
 *
 * 安装流程：探测 GPU → 下载 zip（可续传/可取消）→ bsdtar 解压 → 只拷必需文件 → 写 active.json
 * 任何一步失败都不破坏现有可用状态（CPU 版还在）。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

/* ------------------------------ 常量 ------------------------------ */

// 必需文件：漏一个都可能白装（ggml-cuda.dll 漏了会静默退回 CPU，不报错）
const REQUIRED = [
  "whisper-server.exe",
  "whisper.dll",
  "ggml.dll",
  "ggml-base.dll",
  "ggml-cuda.dll",
  "cudart64_12.dll",
  "cublas64_12.dll",
  "cublasLt64_12.dll",
];
const CPU_DLL_PREFIX = "ggml-cpu-";     // 9 个按指令集分派的后端，全部要

const RELEASES = {
  "cuda-12.4": {
    zip: "whisper-bin-win-cuda-12.4.0-x64.zip",
    approxMB: 653,
    needDriver: 551,                    // NVIDIA 驱动主版本 ≥ 551 才有 CUDA 12.4
  },
  "cuda-11.8": {
    zip: "whisper-bin-win-cuda-11.8.0-x64.zip",
    approxMB: 285,
    needDriver: 452,
  },
};

const GH = "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/";
// 国内网络：gh-proxy 关掉 VPN 时最快；直连放最后（有代理时可用）
const MIRRORS = [
  (f) => "https://gh-proxy.com/" + GH + f,
  (f) => GH + f,
];

/* ------------------------------ 探测 ------------------------------ */

/** nvidia-smi → { found, name, driver, vramMB }；没有 nvidia-smi 就 found:false */
function detectGpu() {
  if (process.platform !== "win32") return { found: false, reason: "非 Windows" };
  const r = spawnSync("nvidia-smi",
    ["--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
    { encoding: "utf8", timeout: 5000, windowsHide: true });
  if (r.status !== 0 || !r.stdout) {
    return { found: false, reason: r.error ? r.error.message : "没有 nvidia-smi（非 N 卡或驱动未装）" };
  }
  const line = String(r.stdout).trim().split(/\r?\n/)[0] || "";
  const parts = line.split(",").map((s) => s.trim());
  const [name, driver, vram] = parts;
  const major = Number(String(driver || "").split(".")[0]);
  return {
    found: true, name, driver,
    driverMajor: Number.isFinite(major) ? major : 0,
    vramMB: Number(String(vram || "").replace(/[^\d]/g, "")) || 0,
  };
}

/** 这颗卡该装哪个版本（装不了返回 null） */
function recommend(gpu) {
  if (!gpu || !gpu.found) return null;
  if (gpu.driverMajor >= RELEASES["cuda-12.4"].needDriver) return "cuda-12.4";
  if (gpu.driverMajor >= RELEASES["cuda-11.8"].needDriver) return "cuda-11.8";
  return null;
}

/* ------------------------------ 安装状态 ------------------------------ */

function readActive(asrDir) {
  try { return String(JSON.parse(fs.readFileSync(path.join(asrDir, "active.json"), "utf8")).backend || "cpu"); }
  catch (e) { return "cpu"; }
}

function writeActive(asrDir, id) {
  fs.mkdirSync(asrDir, { recursive: true });
  fs.writeFileSync(path.join(asrDir, "active.json"),
    JSON.stringify({ backend: id, gpuFailures: 0, gpuFallbackPermanent: false, lastError: "", at: new Date().toISOString() }, null, 2));
}

/** 后端是否装全了（exe + 必需 dll 都在） */
function installed(asrDir, id) {
  const dir = path.join(asrDir, id);
  if (!fs.existsSync(path.join(dir, "whisper-server.exe"))) return false;
  let dlls;
  try { dlls = fs.readdirSync(dir); } catch (e) { return false; }
  if (!REQUIRED.every((f) => dlls.includes(f) || f === "whisper-server.exe")) return false;
  return dlls.some((f) => f.startsWith(CPU_DLL_PREFIX));
}

function dirSizeMB(dir) {
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      try { n += fs.statSync(path.join(dir, f)).size; } catch (e) {}
    }
  } catch (e) {}
  return Math.round(n / 1024 / 1024);
}

/** 给设置窗口用的一份快照 */
function status(asrDir) {
  const gpu = detectGpu();
  const want = recommend(gpu);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(path.join(asrDir, "active.json"), "utf8")) || {}; } catch (e) {}
  return {
    platform: process.platform,
    gpu,
    recommend: want,
    active: readActive(asrDir),
    gpuFailures: Math.max(0, Number(st.gpuFailures) || 0),
    gpuFallbackPermanent: !!st.gpuFallbackPermanent,
    installed: Object.keys(RELEASES).filter((id) => installed(asrDir, id))
      .map((id) => ({ id, mb: dirSizeMB(path.join(asrDir, id)) })),
    options: Object.entries(RELEASES).map(([id, r]) => ({ id, approxMB: r.approxMB, needDriver: r.needDriver })),
    asrDir,
  };
}

/* ------------------------------ 下载 + 解压 ------------------------------ */

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

/** 流式下载到文件；已有部分文件时用 Range 续传；支持取消（AbortSignal）与进度回调 */
async function download(url, dst, { onProgress, signal } = {}) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  let offset = 0;
  try { offset = fs.statSync(dst).size; } catch (e) { offset = 0; }

  const headers = {};
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const res = await fetch(url, { signal, redirect: "follow", headers });

  // 416：本地文件比远端还大（上次下坏了 / 远端换了包）→ 删掉重下
  if (res.status === 416 && offset > 0) {
    rmrf(dst);
    onProgress && onProgress({ phase: "restart", reason: "本地包与远端不一致，重新下载" });
    return download(url, dst, { onProgress, signal });
  }

  // 服务器不支持 Range（回 200）→ 只能从头下，把旧的部分文件丢掉
  let append = false;
  if (offset > 0 && res.status === 206) {
    append = true;
    const cr = String(res.headers.get("content-range") || "");
    const m = cr.match(/\/(\d+)/);
    if (m) onProgress && onProgress({ phase: "resume", have: offset, total: Number(m[1]) });
  } else if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  } else if (offset > 0) {
    onProgress && onProgress({ phase: "restart", reason: "服务器不支持断点续传" });
    offset = 0;
  }

  const len = Number(res.headers.get("content-length") || 0);
  // 206 时 content-length 是"剩余字节"，总大小 = 已有 + 剩余
  const total = append ? offset + len : len;
  const out = fs.createWriteStream(dst, { flags: append ? "a" : "w" });
  let received = offset;
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      onProgress && onProgress({ phase: "download", received, total });
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total && received < total) throw new Error(`下载不完整：${received}/${total}`);
  return { received, total, resumedFrom: append ? offset : 0 };
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10 1803+ 自带 bsdtar，能直接解 zip，比 PowerShell Expand-Archive 快一个数量级
  const r = spawnSync("tar", ["-xf", zip, "-C", dest], { encoding: "utf8", timeout: 10 * 60 * 1000, windowsHide: true });
  if (r.status !== 0) throw new Error(`解压失败：${(r.stderr || r.error && r.error.message || "tar 不可用").trim()}`);
}

/** 用户点「取消」/中途 abort 时抛的错：ipc 靠 cancelled 标记把它当正常结束，不报失败 */
function cancelledError() {
  const e = new Error("已取消");
  e.cancelled = true;
  return e;
}

/** 把解压出来的 Release/* 里必需的文件拷到 dstDir/（每拷一个文件都看一眼是否已取消） */
function copyManifest(srcDir, dstDir, aborted) {
  fs.mkdirSync(dstDir, { recursive: true });
  const files = fs.readdirSync(srcDir);
  const picked = [];
  for (const f of files) {
    if (aborted && aborted()) throw cancelledError();
    const keep = REQUIRED.includes(f) || (f.startsWith(CPU_DLL_PREFIX) && f.endsWith(".dll"));
    if (!keep) continue;
    fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
    picked.push(f);
  }
  const missing = REQUIRED.filter((f) => !picked.includes(f));
  if (missing.length) throw new Error(`压缩包里缺文件：${missing.join(", ")}`);
  return picked;
}

/** 找本机现成的安装包（不联网）。只查固定几处，绝不递归搜盘。
 *  校验：大小接近 + tar 能列出 + 含 whisper-server.exe / ggml-cuda.dll
 *  注意：不查 <asrDir>/_download——install() 每次开工都会清空它 */
function findLocalZip(rel, asrDir) {
  const name = rel.zip;
  const home = process.env.USERPROFILE || "";
  const cands = [
    process.env.NIHONCO_ASR_ZIP || "",                 // 手动指定（推荐，免得猜路径）
    path.join(home, "Downloads", name),
    path.join(home, "Desktop", name),
  ].filter(Boolean);
  for (const p of cands) {
    try {
      if (!fs.existsSync(p)) continue;
      const mb = fs.statSync(p).size / 1024 / 1024;
      if (mb < rel.approxMB * 0.8) continue;              // 太小 → 没下完
      const r = spawnSync("tar", ["-tf", p], { encoding: "utf8", timeout: 60000, windowsHide: true });
      const list = String(r.stdout || "");
      if (r.status === 0 && /whisper-server\.exe/.test(list) && /ggml-cuda\.dll/.test(list)) return p;
    } catch (e) {}
  }
  return null;
}

/**
 * 下载并安装某个后端。
 * 落位策略：先解到 _download/unpacked，再拷到 _download/staging，全部文件到位后才
 *「删旧目录 + 改名」。所以中途取消/失败时已装好的目录原样不动，也不会留下半装目录。
 * @param {{onProgress?:Function, signal?:AbortSignal, beforeCommit?:Function, localZip?:string}} opts
 *   beforeCommit(dst)：落位前调一次（Windows 上先停掉占用 exe/dll 的服务）
 *   localZip：直接指定安装包（测试/手动选包用；不给就自己找）
 * @returns {Promise<{id:string, files:string[]}>}
 */
async function install(asrDir, id, { onProgress, signal, beforeCommit, localZip } = {}) {
  const rel = RELEASES[id];
  if (!rel) throw new Error(`未知后端：${id}`);
  const work = path.join(asrDir, "_download");
  const zipPath = path.join(work, rel.zip);
  const unpack = path.join(work, "unpacked");
  const staging = path.join(work, "staging");
  const dst = path.join(asrDir, id);
  const aborted = () => !!(signal && signal.aborted);
  let done = false;          // 只有真正装好才删压缩包；取消/失败都留着续传
  const checkAbort = () => { if (aborted()) throw cancelledError(); };

  // 先看本机有没有现成的包；没有就走下载（_download 里的半截包要留着续传）
  const cached = localZip || findLocalZip(rel, asrDir);
  const fromNetwork = !cached;
  rmrf(unpack);          // 解压/落位临时目录可以清，下载的半截 zip 不能清
  rmrf(staging);
  try {
    onProgress && onProgress({ phase: "start", id, approxMB: rel.approxMB });
    checkAbort();

    // 有本地包就直接解本地包：不复制、不联网（653 MB 拷一遍也要十几秒）
    let zipSrc = cached || null;
    let lastErr = cached ? null : new Error("需要下载");
    if (cached) onProgress && onProgress({ phase: "local", file: cached });
    for (const mk of (cached ? [] : MIRRORS)) {
      try {
        await download(mk(rel.zip), zipPath, { onProgress, signal });
        zipSrc = zipPath;
        lastErr = null;
        break;
      } catch (e) {
        if (aborted()) throw cancelledError();
        lastErr = e;
        rmrf(zipPath);
        onProgress && onProgress({ phase: "retry", msg: `换源重试（${e.message}）` });
      }
    }
    if (lastErr || !zipSrc) throw lastErr || new Error("拿不到安装包");

    checkAbort();
    onProgress && onProgress({ phase: "extract" });
    try {
      extractZip(zipSrc, unpack);
    } catch (e) {
      // 解压失败说明这个包坏了：删掉，别让它被当成"续传基点"
      if (zipSrc === zipPath) rmrf(zipPath);
      throw e;
    }
    checkAbort();
    onProgress && onProgress({ phase: "copy" });
    // zip 里是 Release/ 一层
    const srcDir = fs.existsSync(path.join(unpack, "Release", "whisper-server.exe"))
      ? path.join(unpack, "Release")
      : unpack;
    const files = copyManifest(srcDir, staging, aborted);   // 先写 staging，不碰已装好的目录
    checkAbort();
    if (beforeCommit) await beforeCommit(dst);              // 停服：Windows 上被占用的文件删不掉
    checkAbort();
    rmrf(dst);
    fs.renameSync(staging, dst);
    writeActive(asrDir, id);
    done = true;
    onProgress && onProgress({ phase: "done", id, files, mb: dirSizeMB(dst) });
    return { id, files };
  } finally {
    rmrf(unpack);
    rmrf(staging);
    // 用本地包 / 装成功 → 整个 _download 清掉；
    // 走网络且没装完（取消、断网、校验失败）→ 保留 _download 里的半截 zip，下次续传
    if (done || !fromNetwork) rmrf(work);
  }
}

/** 卸载某个后端：删目录；如果它正是当前后端，切回 CPU
 *  注意：调用前必须先停掉正在跑这个后端的 whisper-server，否则 exe/dll 被占用、
 *  Windows 删不掉（rmSync 会静默失败，界面看上去"还在"）。 */
function remove(asrDir, id) {
  if (readActive(asrDir) === id) writeActive(asrDir, "cpu");
  const dir = path.join(asrDir, id);
  rmrf(dir);
  const gone = !fs.existsSync(dir);
  if (!gone) {
    let left = [];
    try { left = fs.readdirSync(dir).slice(0, 3); } catch (e) {}
    throw new Error(`删不掉 ${id}（文件被占用？${left.join(", ")}）——先切到 CPU 并重启应用再试`);
  }
  return { active: readActive(asrDir), removed: id };
}

module.exports = {
  RELEASES, REQUIRED, detectGpu, recommend, status, installed,
  install, remove, readActive, writeActive, dirSizeMB,
  download, findLocalZip,   // 供测试用（断点续传 / 本地包发现）
};
