/* 平台差异集中在这里。
 *
 * 以前 main.js 里 `IS_WIN ? ... : ...` 散落十几处，改一个平台行为要满文件找。
 * 现在：常量 + 行为函数都放这里，main.js 只调用。
 *
 * 约定：解析类函数是纯函数（拿字符串 → 结果），方便测；
 *      系统调用类函数失败时返回空/ false，不抛（与原来的行为一致）。
 */
const { execSync } = require("child_process");
const path = require("path");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";
const ROOT = path.join(__dirname, "..");

/* ------------------------------ 解析（纯函数） ------------------------------ */

/** netstat -ano 的输出 → 监听指定端口的 PID 列表（Windows） */
function parseNetstatListeners(out, port) {
  const pids = [];
  for (const line of String(out || "").split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[1] || "";
    if (!local.endsWith(`:${port}`)) continue;
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(pid) && pid > 0 && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

/** lsof -t 的输出 → PID 列表（mac/linux） */
function parseLsofListeners(out) {
  return String(out || "").trim().split(/\s+/).map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** PowerShell Get-CimInstance 的输出 → 命令行（去掉首尾空白/空行） */
function parsePidCommand(out) {
  return String(out || "").trim();
}

/* ------------------------------ 系统调用 ------------------------------ */

/** 结束进程：Windows 用 taskkill /T（必要时 /F）；其它用信号 */
function killPid(pid, force) {
  try {
    if (IS_WIN) {
      // VV / whisper-server 都是无窗口控制台进程，taskkill 不带 /F 常失败 → 一律带 /T，失败再补 /F
      try {
        execSync(`taskkill /PID ${pid} /T${force ? " /F" : ""}`, { stdio: "ignore", windowsHide: true });
      } catch (e) {
        if (force) throw e;
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore", windowsHide: true });
      }
    } else {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    }
    return true;
  } catch (e) {
    return false;
  }
}

/** 谁在监听这个端口：返回 PID 数组（拿不到就 []） */
function portOwner(port) {
  try {
    if (IS_WIN) {
      const out = execSync("netstat -ano -p TCP", { encoding: "utf8", windowsHide: true });
      return parseNetstatListeners(out, port);
    }
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf8" });
    return parseLsofListeners(out);
  } catch (e) {
    return [];
  }
}

/** 这个 PID 是不是本项目启动的（防止 PID 复用后杀错） */
function isOurs(pid, hint) {
  try {
    const cmd = IS_WIN
      ? execSync(
        `powershell.exe -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\").CommandLine"`,
        { encoding: "utf8", windowsHide: true },
      )
      : execSync(`ps -p ${pid} -o command=`, { encoding: "utf8" });
    const line = parsePidCommand(cmd);
    if (!line) return false;
    return line.includes(ROOT) || !!(hint && line.includes(hint));
  } catch (e) {
    return false;
  }
}

/** 全局快捷键的修饰键：Windows 上 Ctrl+Ctrl 注册不上，用 Ctrl+Alt */
function shortcutMod() {
  return IS_WIN ? "Control+Alt" : "CommandOrControl+Control";
}

/** 用系统文件管理器打开目录 */
function openPath(target, shell) {
  try {
    if (shell && typeof shell.openPath === "function") return shell.openPath(target);
    return null;
  } catch (e) {
    return null;
  }
}

/* ------------------------------ 行为差异 ------------------------------ */

/** 无边框窗口的标题栏样式 */
function titleBarStyle() {
  return IS_WIN ? "default" : "hiddenInset";
}

/** 桌面"所有工作区可见"只有 mac 有 */
function supportsAllWorkspaces() {
  return !IS_WIN;
}

/** VOICEVOX 引擎的候选路径（按优先级；调用方自己 existsSync 挑第一个存在的） */
function voicevoxEngineCandidates({ root, userData, env = process.env }) {
  if (env.VOICEVOX_ENGINE) return [env.VOICEVOX_ENGINE];
  const path = require("path");
  if (IS_WIN) {
    return [
      path.join(root, ".voicevox", "windows", "VOICEVOX", "vv-engine", "run.exe"),
      path.join(root, ".voicevox", "windows", "vv-engine", "run.exe"),
      path.join(userData, ".voicevox", "windows", "VOICEVOX", "vv-engine", "run.exe"),
      path.join(userData, ".voicevox", "windows", "vv-engine", "run.exe"),
      path.join(env.ProgramFiles || "C:\\Program Files", "VOICEVOX", "vv-engine", "run.exe"),
      path.join(env.LOCALAPPDATA || "", "Programs", "VOICEVOX", "vv-engine", "run.exe"),
    ];
  }
  return [
    path.join(root, ".voicevox", "extracted", "VOICEVOX", "VOICEVOX.app",
      "Contents", "Resources", "vv-engine", "run"),
    path.join(env.HOME || "", "Applications", "VOICEVOX.app",
      "Contents", "Resources", "vv-engine", "run"),
    "/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run",
  ];
}

/** AivisSpeech 引擎候选路径（标准和开发版安装位置） */
function aivisEngineCandidates({ root, env = process.env } = {}) {
  if (env.AIVIS_ENGINE) return [env.AIVIS_ENGINE];
  const path = require("path");
  if (IS_WIN) {
    return [
      path.join(root, ".aivis", "AivisSpeech-Engine", "run.exe"),
      path.join(env.ProgramFiles || "C:\\Program Files", "AivisSpeech", "AivisSpeech-Engine", "run.exe"),
      path.join(env.LOCALAPPDATA || "", "Programs", "AivisSpeech", "AivisSpeech-Engine", "run.exe"),
    ];
  }
  return [
    path.join(root, ".aivis", "AivisSpeech.app", "Contents", "Resources", "AivisSpeech-Engine", "run"),
    path.join(env.HOME || "", "Applications", "AivisSpeech.app", "Contents", "Resources", "AivisSpeech-Engine", "run"),
    "/Applications/AivisSpeech.app/Contents/Resources/AivisSpeech-Engine/run",
    path.join(env.HOME || "", "Downloads", "AivisSpeech-dev", "AivisSpeech", "AivisSpeech.app",
      "Contents", "Resources", "AivisSpeech-Engine", "run"),
  ];
}

/** 给子进程用的 PATH：mac 上补 Homebrew（Finder 启动时 PATH 很干净） */
function childPath(env = process.env) {
  const base = env.PATH || "/usr/bin:/bin";
  return IS_WIN ? base : `/opt/homebrew/bin:/usr/local/bin:${base}`;
}

/** 实际生效的识别后端：Windows 恒 whisper.cpp，其它看配置 */
function asrBackendFor(configured) {
  if (IS_WIN) return "whispercpp";
  return String(configured || "").toLowerCase() === "whispercpp" ? "whispercpp" : "mlx";
}

/** 真正用哪个后端：显式配置优先，其次「有 whisper.cpp 就用它」，最后回 mlx */
function resolveAsrBackend({ configured, whisper, mlx } = {}) {
  if (IS_WIN) return "whispercpp";
  const want = String(configured || "").toLowerCase();
  if (want === "whispercpp") return whisper ? "whispercpp" : (mlx ? "mlx" : "whispercpp");
  if (want === "mlx") return mlx ? "mlx" : (whisper ? "whispercpp" : "mlx");
  return whisper ? "whispercpp" : (mlx ? "mlx" : "whispercpp");
}

/** whisper-server 可执行文件名 */
function whisperExeName() {
  return IS_WIN ? "whisper-server.exe" : "whisper-server";
}

/** 识别日志里的引擎标签（按实际后端） */
function asrEngineLabel(backend) {
  return (IS_WIN || String(backend || "").toLowerCase() === "whispercpp") ? "whisper.cpp" : "asr.py";
}

module.exports = {
  IS_WIN, IS_MAC, IS_LINUX, ROOT,
  parseNetstatListeners, parseLsofListeners, parsePidCommand,
  killPid, portOwner, isOurs, openPath, shortcutMod,
  titleBarStyle, supportsAllWorkspaces,
  asrBackendFor, resolveAsrBackend, whisperExeName, asrEngineLabel,
  voicevoxEngineCandidates, aivisEngineCandidates, childPath,
};
