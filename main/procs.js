/* 子进程登记：只清理"自己启动的"进程，避免误杀用户另装的 VOICEVOX / ASR
 *
 * 登记文件放在 .voice/procs.json；killStaleProcs 会先校验命令行里有没有本项目路径
 * （PID 可能被系统复用，不能盲杀）。
 */
const fs = require("fs");
const path = require("path");
const platform = require("../agent/platform");

module.exports = function createProcs({ file, log = () => {} }) {
  function readProcs() {
    try { return JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch (e) { return {}; }
  }
  function writeProcs(obj) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
    } catch (e) {}
  }
  function rememberProc(name, child, cmd) {
    const reg = readProcs();
    reg[name] = { pid: child && child.pid, cmd: cmd || "", at: Date.now() };
    writeProcs(reg);
  }

  /** 只清理上次自己启动、没退干净的进程；别人占着端口只提示，不动 */
  function killStaleProcs() {
    const reg = readProcs();
    for (const [name, info] of Object.entries(reg)) {
      const pid = info && info.pid;
      if (!pid) continue;
      const needle = name === "asr"
        ? "whisper-server"
        : (name === "aivis" ? "AivisSpeech-Engine" : "vv-engine");
      if (!platform.isOurs(pid, needle)) {
        log("[cleanup] 跳过（不是本项目的进程）", name, pid);
        continue;
      }
      try {
        platform.killPid(pid);
        log("[cleanup] 停止上次残留", name, pid);
      } catch (e) {}
    }
    writeProcs({});

    // 端口被别的程序占着：只提示，绝不 kill
    for (const port of [8765, 50021, 10101]) {
      const pids = platform.portOwner(port);
      if (pids.length) {
        log(`[cleanup] 端口 ${port} 已被占用（PID ${pids.join(",")}），不是本应用启动的，不去动它`);
      }
    }
  }

  return { readProcs, writeProcs, rememberProc, killStaleProcs };
};
