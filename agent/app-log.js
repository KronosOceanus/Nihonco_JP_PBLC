/* 应用日志落盘：把主进程的 console 输出 + 未捕获异常写进 data/logs/app.log
 *
 * 为什么需要：打包后的 app 看不到 stdout，出问题（启动崩溃 / IPC 报错）时没有线索。
 *
 * 约定：
 *   · 只写主进程（渲染层有 DevTools；需要时自己看）
 *   · 2MB 轮转，只留一份 .1（复用 agent/rotating-log.js）
 *   · APP_LOG=0 可关闭；写日志失败绝不抛（不能因为日志把应用搞挂）
 *   · 不 hook console 的那些库（Electron 内部 stderr 管不着），只包我们自己的调用
 */
const path = require("path");
const rotatingLog = require("./rotating-log");

const MAX_BYTES = Number(process.env.APP_LOG_MAX || 2 * 1024 * 1024);

let installed = false;
let file = "";
let exitFn = null;      // 致命错误时怎么收场（打包版传 app.exit）
const originals = {};

function enabled() {
  const v = String(process.env.APP_LOG ?? "1").toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmt(args) {
  return args.map((a) => {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(" ");
}

/** 写一行；任何异常都吞掉 */
function write(level, args) {
  if (!file) return;
  try {
    const line = `${stamp()} [${level}] ${fmt(args)}`;
    rotatingLog.append(file, line, { maxBytes: MAX_BYTES });
  } catch (e) {}
}

/** 安装：劫持 console.log/info/warn/error（保留原输出），并记录未捕获异常 */
function install({ dir, exit } = {}) {
  if (dir) file = path.join(dir, "app.log");      // 允许重新指向（测试/自检会用到）
  if (typeof exit === "function") exitFn = exit;
  if (installed) return { file, enabled: enabled() };
  installed = true;

  for (const level of ["log", "info", "warn", "error"]) {
    originals[level] = console[level].bind(console);
    console[level] = (...args) => {
      try { originals[level](...args); } catch (e) {}
      write(level === "log" ? "info" : level, args);
    };
  }

  // 注意：加监听器后 Node 不再因为未捕获异常退出。
  // 打包版交给 exitFn（app.exit(1)）——宁可重启，也别带病继续跑；
  // 开发模式保留进程，方便在终端里看堆栈。
  const fatal = (kind, err) => {
    write("fatal", [kind, err]);
    try { originals.error(`[fatal] ${kind}`, err); } catch (e) {}
    if (exitFn) { try { exitFn(1); } catch (e) {} }
  };
  process.on("uncaughtException", (err) => fatal("uncaughtException", err));
  process.on("unhandledRejection", (reason) => fatal("unhandledRejection", reason));

  write("info", [`应用日志启动，文件 ${file}`]);
  return { file, enabled: enabled() };
}

module.exports = { install, write, enabled, get file() { return file; }, MAX_BYTES };
