/* TTS 引擎路径校验：设置页手动选择路径时用，避免把 .app 或错误引擎写进 .env */
const fs = require("fs");
const path = require("path");

const MARKS = {
  voicevox: "vv-engine",
  aivis: "aivisspeech-engine",
};

function validateEnginePath(engine, picked, { platform = process.platform } = {}) {
  const id = String(engine || "").toLowerCase();
  const mark = MARKS[id];
  if (!mark) return { ok: false, error: "未知的语音引擎" };
  const raw = String(picked || "").trim();
  if (!raw) return { ok: false, error: "路径为空" };

  const abs = path.resolve(raw);
  let st;
  try { st = fs.statSync(abs); } catch (e) { return { ok: false, error: "文件不存在" }; }
  if (!st.isFile()) return { ok: false, error: "请选择引擎可执行文件，不要选目录" };

  const base = path.basename(abs).toLowerCase();
  const want = platform === "win32" ? "run.exe" : "run";
  if (base !== want) return { ok: false, error: `文件名应为 ${want}` };

  if (platform !== "win32") {
    try { fs.accessSync(abs, fs.constants.X_OK); }
    catch (e) { return { ok: false, error: "文件没有可执行权限" }; }
  }

  const norm = abs.replace(/\\/g, "/").toLowerCase();
  if (!norm.includes(`/${mark}/`)) {
    return { ok: false, error: `路径不属于 ${id === "aivis" ? "AivisSpeech" : "VOICEVOX"} 引擎` };
  }
  return { ok: true, path: abs };
}

module.exports = { validateEnginePath };
