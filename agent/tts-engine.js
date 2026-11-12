/* TTS 引擎进程管理：VOICEVOX / AivisSpeech 的发现、启动、停止、切换。
 * 只管理 Nihonco 自己 spawn 的进程；用户手动启动的引擎只连接，不 kill。
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ttsConfig = require("./tts-config");

module.exports = function createTtsEngine({
  root, userData, tts, platform, procs, spawnProc = spawn,
}) {
  const rememberProc = procs.rememberProc;
  const VV_HOME = path.join(userData, ".voicevox", "home");

  const ENGINE_DEFS = Object.fromEntries(ttsConfig.all().map((def) => [def.id, {
    ...def,
    home: def.id === "voicevox" ? VV_HOME : null,
    candidates: () => def.id === "voicevox"
      ? platform.voicevoxEngineCandidates({ root, userData })
      : platform.aivisEngineCandidates({ root, userData }),
    args: def.id === "voicevox"
      ? ["--host", "127.0.0.1", "--port", "50021"]
      : ["--host", "127.0.0.1", "--port", "10101", "--no-use_gpu"],
  }]));

  function currentEngine() {
    const id = tts.engineName ? tts.engineName() : ttsConfig.currentEngine();
    return ENGINE_DEFS[id] ? id : "voicevox";
  }

  function engineDef(id = currentEngine()) {
    return ENGINE_DEFS[id] || null;
  }

  function enginePath(id = currentEngine()) {
    const def = engineDef(id);
    if (!def) return "";
    const list = def.candidates();
    return list.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || "";
  }

  function engineUrl(id = currentEngine()) {
    return ttsConfig.url(id);
  }

  async function pingEngine(id, timeoutMs = 1200) {
    try {
      const r = await fetch(`${engineUrl(id)}/speakers`, { signal: AbortSignal.timeout(timeoutMs) });
      return r.ok;
    } catch (e) { return false; }
  }

  let engineProc = null;
  let engineProcId = "";
  let engineStopping = false;
  let engineRestarts = 0;
  let engineStableTimer = null;
  let switchInFlight = null;
  let switchCancelled = false;
  let enginePhase = "";
  let engineDetail = "";
  let lastEngineId = "";
  let lastPhase = "";
  let lastDetail = "";

  async function waitAlive(ms, cancelled = () => false) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (cancelled()) return false;
      try { if (await tts.alive()) return true; } catch (e) {}
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  async function ensureTtsEngine() {
    try {
      if (await tts.alive()) return true;
    } catch (e) {}
    if (tts.isGenie && tts.isGenie()) return false;
    const id = currentEngine();
    const exe = enginePath(id);
    if (!exe) return waitAlive(10000);
    startEngine(id);
    return waitAlive(id === "aivis" ? 45000 : 15000);
  }

  function startEngine(id = currentEngine()) {
    if (tts.isGenie && tts.isGenie()) return false;
    const def = engineDef(id);
    if (!def) return false;
    const exe = enginePath(id);
    if (!exe) {
      console.log(`[tts] 没找到 ${def.label} 引擎文件，跳过启动`);
      return false;
    }
    try {
      if (platform.portOwner(def.port).length) {
        console.log(`[tts] ${def.label} 端口 ${def.port} 已被占用，连接现有进程`);
        return false;
      }
    } catch (e) {}

    if (engineProc && engineProc.exitCode === null) {
      if (engineProcId === id) return true;
      stopEngine(engineProcId);
    }

    const env = { ...process.env, PATH: platform.childPath() };
    if (def.home) {
      try { fs.mkdirSync(def.home, { recursive: true }); }
      catch (e) { console.log("[tts] 建引擎 HOME 失败（忽略）:", e.message); }
      env.HOME = def.home;
      env.USERPROFILE = def.home;
    }

    let child;
    try {
      child = spawnProc(exe, def.args, {
        cwd: path.dirname(exe), env, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      console.log(`[tts] ${def.label} spawn 失败:`, e.message);
      return false;
    }
    engineProc = child;
    engineProcId = id;
    engineStopping = false;
    enginePhase = "starting";
    engineDetail = "";
    lastEngineId = id;
    lastPhase = enginePhase;
    lastDetail = engineDetail;
    console.log(`[tts] spawn ${def.label}:`, exe);
    rememberProc(def.key, child, def.procName);

    const onLog = (line) => {
      const t = String(line || "");
      if (!t) return;
      if (/Loading BERT|loading bert/i.test(t)) { enginePhase = "bert_loading"; engineDetail = "正在加载 BERT 模型"; }
      else if (/Downloading|GET https?:\/\/|download/i.test(t)) { enginePhase = "bert_downloading"; engineDetail = "正在下载 BERT 模型"; }
      else if (/HTTP Error|Retrying|503|404/i.test(t)) { enginePhase = "bert_retry"; engineDetail = "BERT 模型下载失败，正在重试"; }
      else if (/Scanned .* models|Installed models/i.test(t)) { enginePhase = "models"; engineDetail = "正在扫描声线"; }
      else if (/Application startup complete|Uvicorn running|Using CPU|Using GPU/i.test(t)) { enginePhase = "starting"; engineDetail = "引擎进程已启动"; }
      else if (/ERROR|Traceback|Error/i.test(t)) { enginePhase = "failed"; engineDetail = "AivisSpeech 启动失败：" + t.slice(0, 160); }
      lastPhase = enginePhase;
      lastDetail = engineDetail;
    };
    child.stdout.on("data", (d) => { const t = d.toString(); onLog(t); console.log(`[${def.key}]`, t.trimEnd()); });
    child.stderr.on("data", (d) => { const t = d.toString(); onLog(t); console.log(`[${def.key}:err]`, t.trimEnd().split("\n").pop()); });
    child.on("error", (e) => console.log(`[tts] ${def.label} 进程错误:`, e.message));

    if (engineStableTimer) clearTimeout(engineStableTimer);
    engineStableTimer = setTimeout(() => { engineRestarts = 0; }, 60000);
    if (engineStableTimer.unref) engineStableTimer.unref();

    child.on("exit", (code) => {
      console.log(`[tts] ${def.label} 退出`, code);
      if (engineProc !== child) return;
      engineProc = null;
      engineProcId = "";
      if (!engineStopping) {
        enginePhase = "failed";
        engineDetail = id === "aivis" ? "AivisSpeech 进程已退出，可能是 BERT 模型下载失败" : "引擎进程已退出";
        lastPhase = enginePhase;
        lastDetail = engineDetail;
      }
      if (engineStableTimer) { clearTimeout(engineStableTimer); engineStableTimer = null; }
      if (engineStopping) { engineStopping = false; return; }
      if (code === 0) return;
      if (engineRestarts >= 3) {
        console.log(`[tts] ${def.label} 连续重启失败 3 次，放弃`);
        return;
      }
      engineRestarts += 1;
      const want = id;
      console.log(`[tts] 5 秒后自动重启 ${def.label}（第 ${engineRestarts} 次）`);
      const rt = setTimeout(() => {
        if (currentEngine() === want) startEngine(want);
      }, 5000);
      if (rt.unref) rt.unref();
    });
    return true;
  }

  function stopEngine(id = "") {
    if (!engineProc) return false;
    if (id && engineProcId !== id) return false;
    const p = engineProc;
    const pid = engineProcId;
    engineStopping = true;
    engineProc = null;
    engineProcId = "";
    try { p.kill("SIGTERM"); } catch (e) {}
    const killTimer = setTimeout(() => { try { if (p.exitCode === null) p.kill("SIGKILL"); } catch (e) {} }, 2000);
    if (killTimer.unref) killTimer.unref();
    console.log(`[tts] 已请求停止 ${pid}`);
    return true;
  }

  async function stopEngineAndWait(id, timeoutMs = 3000) {
    const p = engineProc;
    if (!p || (id && engineProcId !== id)) return;
    const done = new Promise((resolve) => {
      if (p.exitCode !== null) return resolve();
      p.once("exit", resolve);
    });
    stopEngine(id);
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  function restoreEnv(backup) {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  async function switchEngineOnce(want) {
    switchCancelled = false;
    const def = engineDef(want);
    if (!def) throw new Error("未知的语音引擎");
    const old = currentEngine();

    if (old === want) {
      if (await ensureTtsEngine()) return { engine: want, path: enginePath(want) };
      throw new Error(`${def.label} 启动失败`);
    }

    const backup = {
      TTS_ENGINE: process.env.TTS_ENGINE,
      VOICEVOX_URL: process.env.VOICEVOX_URL,
      AIVIS_URL: process.env.AIVIS_URL,
    };
    await stopEngineAndWait(old);
    process.env.TTS_ENGINE = want;
    if (want === "voicevox") process.env[def.urlEnv] = def.defaultUrl;

    const exe = enginePath(want);
    if (!exe) {
      if (await waitAlive(2500)) return { engine: want, path: "" };
      restoreEnv(backup);
      if (old) startEngine(old);
      throw new Error(`没找到 ${def.label}，也没有可连接的外部服务`);
    }

    startEngine(want);
    const ready = await waitAlive(want === "aivis" ? 600000 : 15000, () => switchCancelled);
    if (!ready) {
      stopEngine(want);
      restoreEnv(backup);
      if (old) startEngine(old);
      throw new Error(switchCancelled
        ? `已取消 ${def.label} 切换，回滚到 ${engineDef(old)?.label || old}`
        : `${def.label} 启动失败，已回滚到 ${engineDef(old)?.label || old}`);
    }
    return { engine: want, path: exe };
  }

  /** 切换互斥：同一时间只允许一个切换 */
  function switchEngine(want) {
    if (switchInFlight) return Promise.reject(new Error("正在切换引擎，请稍候"));
    const p = switchEngineOnce(want);
    switchInFlight = p;
    return p.finally(() => {
      if (switchInFlight === p) switchInFlight = null;
    });
  }

  function cancelSwitch() {
    if (!switchInFlight) return false;
    switchCancelled = true;
    try { stopEngine("aivis"); } catch (e) {}
    return true;
  }

  async function engineStatus() {
    const out = {};
    for (const id of Object.keys(ENGINE_DEFS)) {
      const p = enginePath(id);
      const active = engineProcId === id;
      const failed = lastEngineId === id && lastPhase === "failed";
      out[id] = { id, path: p, installed: !!p, reachable: await pingEngine(id),
        phase: active ? enginePhase : (failed ? lastPhase : ""),
        detail: active ? engineDetail : (failed ? lastDetail : "") };
    }
    return out;
  }

  function startTtsEngine() { return startEngine(currentEngine()); }
  function getEngineProc() { return engineProc; }

  return {
    currentEngine, engineDef, enginePath, engineUrl, engineStatus,
    ensureTtsEngine, startTtsEngine, startEngine, stopEngine,
    switchEngine, cancelSwitch, getEngineProc,
  };
};
