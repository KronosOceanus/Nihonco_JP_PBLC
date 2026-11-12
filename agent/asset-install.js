/* 资源安装：单文件 + Live2D 模型 zip + TTS 引擎 zip。
 * 解压只进临时 staging，校验后再原子替换；不允许 zip 绝对路径/..。
 */
const nodeFs = require("fs");
const fs = (() => {
  try { return require("original-fs"); } catch (e) { return nodeFs; }
})();
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");

function entries(zip) {
  return new AdmZip(zip).getEntries();
}

const MAX_ZIP_ENTRIES = 20000;
const MAX_ZIP_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_ZIP_FILE = 2 * 1024 * 1024 * 1024;

function assertZipSafe(zip) {
  if (!/\.zip$/i.test(zip)) throw new Error("只支持 .zip");
  const list = entries(zip);
  if (list.length > MAX_ZIP_ENTRIES) throw new Error(`zip 文件数超过 ${MAX_ZIP_ENTRIES}`);
  let total = 0;
  for (const ent of list) {
    const size = Number(ent.header && ent.header.size) || 0;
    if (size > MAX_ZIP_FILE) throw new Error("zip 单文件超过 2GB");
    total += size;
    if (total > MAX_ZIP_BYTES) throw new Error("zip 解压后超过 4GB");
  }
  for (const ent of list) {
    const p = String(ent.entryName || "").replace(/\\/g, "/");
    if (!p) continue;
    if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) {
      throw new Error("zip 包含非法路径");
    }
  }
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const z = new AdmZip(zip);
  for (const ent of z.getEntries()) {
    const rel = String(ent.entryName || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.endsWith("/")) { fs.mkdirSync(path.join(dest, rel), { recursive: true }); continue; }
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const attr = Number(ent.attr) >>> 16;
    const isSymlink = (attr & 0o170000) === 0o120000;
    if (isSymlink) {
      const target = ent.getData().toString();
      if (!target || path.isAbsolute(target) || target.replace(/\\/g, "/").split("/").includes("..")) {
        throw new Error("zip 包含非法符号链接");
      }
      try { fs.symlinkSync(target, out); } catch (e) { fs.writeFileSync(out, target); }
      continue;
    }
    fs.writeFileSync(out, ent.getData());
    const mode = attr & 0o777;
    if (mode) { try { fs.chmodSync(out, mode); } catch (e) {} }
  }
  // 引擎入口必须可执行；部分 zip 不保存 Unix mode
  for (const f of walk(dest).filter((x) => /(^|\/)(run|run\.exe)$/.test(x.replace(/\\/g, "/")))) {
    try { fs.chmodSync(f, 0o755); } catch (e) {}
  }
}

function isWin(platform) { return platform === "win32"; }

/** 落位根目录：
 *  · asset   —— Live2D Core / 模型（打包后在 userData/assets）
 *  · engine  —— TTS 引擎（userData）
 *  · whisper —— 用户拖进来的 ggml 模型；打包后 .whisper 在 app.asar.unpacked（只读），
 *               所以必须写到可写的用户目录，主进程用 NIHONCO_WHISPER_MODELS 指过来 */
function bases({ root, assetsDir, userData }) {
  const inAsar = /[\\/]app\.asar([\\/]|$)/.test(String(root || ""));
  const whisper = process.env.NIHONCO_WHISPER_MODELS
    || (userData ? path.join(userData, "whisper", "models") : path.join(root || "", ".whisper", "models"));
  if (!inAsar) return { asset: root, engine: root, whisper };
  return {
    asset: assetsDir || path.join(userData || root, "assets"),
    engine: userData || root,
    whisper,
  };
}

function stashDir(target) {
  if (!fs.existsSync(target)) return null;
  cleanupBackups(target);
  const backup = target + ".bak-" + Date.now();
  fs.renameSync(target, backup);
  return backup;
}

function rollback({ path: target, backup } = {}) {
  if (!target) return { ok: false, error: "没有目标路径" };
  try {
    if (backup && fs.existsSync(backup)) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(backup, target);
      return { ok: true, restored: backup };
    }
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, removed: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function cleanupBackups(target) {
  const dir = path.dirname(target);
  const prefix = path.basename(target) + ".bak-";
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(prefix)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  } catch (e) {}
}



function findDir(dir, pred) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (!ent.isDirectory()) continue;
    if (pred(p)) return p;
    const hit = findDir(p, pred);
    if (hit) return hit;
  }
  return "";
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function findOne(dir, pred) {
  const hit = walk(dir).find(pred);
  return hit || "";
}
function baseNameWithoutZip(file) {
  return path.basename(file).replace(/\.zip$/i, "");
}

function install({ kind, src, root, assetsDir, userData, app, platform = process.platform }) {
  if (!src) throw new Error("没有文件路径");
  const actual = classify(src);
  const dirs = bases({ root, assetsDir, userData });
  const expected = kind === "tts" ? (actual === "voicevox" || actual === "aivis" ? "tts" : actual) : actual;
  if (actual !== "unknown" && expected !== kind) throw new Error("资源类型与拖放区域不匹配");
  const st = fs.statSync(src);
  if (kind === "model" || kind === "tts") {
    if (!st.isFile() || !/\.zip$/i.test(src)) throw new Error("这一项需要 .zip");
    assertZipSafe(src);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-asset-"));
    try {
      extractZip(src, tmp);
      if (kind === "model") {
        const modelJson = findOne(tmp, (p) => /\.model3\.json$/i.test(p));
        if (!modelJson) throw new Error("zip 里没有 .model3.json");
        const srcDir = path.dirname(modelJson);
        const name = path.basename(srcDir) || baseNameWithoutZip(src);
        const dst = path.join(dirs.asset, "model", name);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const backup = stashDir(dst);
        fs.renameSync(srcDir, dst);
        return { ok: true, kind, path: dst, backup };
      }
      const vv = findOne(tmp, (p) => /\/vv-engine\/run(\.exe)?$/.test(p.replace(/\\/g, "/")));
      const ai = findOne(tmp, (p) => /\/AivisSpeech-Engine\/run(\.exe)?$/.test(p.replace(/\\/g, "/")));
      if (vv) {
        if (isWin(platform)) {
          const home = path.join(dirs.engine, ".voicevox", "windows");
          fs.mkdirSync(home, { recursive: true });
          const dst = path.join(home, "VOICEVOX");
          const backup = stashDir(dst);
          const vvDir = findDir(tmp, (p) => /(^|\/)vv-engine$/.test(p.replace(/\\/g, "/")));
          if (!vvDir) throw new Error("找不到 vv-engine 目录");
          fs.mkdirSync(dst, { recursive: true });
          fs.renameSync(vvDir, path.join(dst, "vv-engine"));
          return { ok: true, kind: "voicevox", path: dst, backup };
        }
        const home = path.join(dirs.engine, ".voicevox", "extracted");
        fs.mkdirSync(home, { recursive: true });
        const dst = path.join(home, "VOICEVOX");
        const backup = stashDir(dst);
        fs.renameSync(path.join(tmp, "VOICEVOX"), dst);
        return { ok: true, kind: "voicevox", path: dst, backup };
      }
      if (ai) {
        if (isWin(platform)) {
          const home = path.join(dirs.engine, ".aivis");
          fs.mkdirSync(home, { recursive: true });
          const dst = path.join(home, "AivisSpeech-Engine");
          const backup = stashDir(dst);
          const engineDir = findDir(tmp, (p) => /(^|\/)AivisSpeech-Engine$/.test(p.replace(/\\/g, "/")));
          if (!engineDir) throw new Error("找不到 AivisSpeech-Engine 目录");
          fs.renameSync(engineDir, dst);
          return { ok: true, kind: "aivis", path: dst, backup };
        }
        let appDir = path.dirname(ai);
        while (appDir && appDir !== path.dirname(appDir) && !/AivisSpeech\.app$/.test(appDir)) {
          appDir = path.dirname(appDir);
        }
        if (!/AivisSpeech\.app$/.test(appDir)) throw new Error("找不到 AivisSpeech.app");
        const home = path.join(dirs.engine, ".aivis");
        fs.mkdirSync(home, { recursive: true });
        const dst = path.join(home, "AivisSpeech.app");
        const backup = stashDir(dst);
        fs.renameSync(appDir, dst);
        return { ok: true, kind: "aivis", path: dst, backup };
      }
      throw new Error("zip 里没找到 vv-engine/run 或 AivisSpeech-Engine/run");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (!st.isFile()) throw new Error("第一版只支持单文件");
  const base = path.basename(src);
  let dst;
  if (kind === "core") {
    if (base !== "live2dcubismcore.min.js") throw new Error("请拖入 live2dcubismcore.min.js");
    dst = path.join(dirs.asset, "lib", base);
  } else if (kind === "asr") {
    if (!/\.bin$/i.test(base)) throw new Error("请拖入 ggml-*.bin 模型");
    dst = path.join(dirs.whisper, base);
  } else if (kind === "aivis-voice") {
    if (!/\.aivmx$/i.test(base)) throw new Error("请拖入 .aivmx 声线");
    if (isWin(platform)) {
      dst = path.join(app.getPath("appData"), "AivisSpeech-Engine", "Models", base);
    } else {
      const home = app.getPath("home");
      dst = path.join(home, "Library", "Application Support", "AivisSpeech-Engine", "Models", base);
    }
  } else throw new Error("暂不支持这种资源");
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = dst + ".tmp-" + process.pid;
  fs.copyFileSync(src, tmp);
  try { fs.chmodSync(tmp, st.mode); } catch (e) {}
  const backup = fs.existsSync(dst) ? dst + ".bak" : null;
  if (backup) fs.copyFileSync(dst, backup);
  fs.renameSync(tmp, dst);
  return { ok: true, kind, path: dst, backup };
}

function classify(src) {
  const base = path.basename(src).toLowerCase();
  if (base === "live2dcubismcore.min.js") return "core";
  if (/\.bin$/.test(base)) return "asr";
  if (/\.aivmx$/.test(base)) return "aivis-voice";
  if (!/\.zip$/.test(base)) return "unknown";
  let names = [];
  try { names = entries(src).map((e) => String(e.entryName).replace(/\\/g, "/")); } catch (e) { return "unknown"; }
  if (names.some((n) => /\.model3\.json$/i.test(n))) return "model";
  if (names.some((n) => /AivisSpeech-Engine\/run(\.exe)?$/.test(n))) return "aivis";
  if (names.some((n) => /\/vv-engine\/run(\.exe)?$/.test(n))) return "voicevox";
  return "unknown";
}

const LABELS = {
  core: "Live2D Core",
  asr: "ASR 模型",
  "aivis-voice": "Aivis 声线",
  model: "Live2D 模型",
  tts: "TTS 引擎",
};

function pick(kind, src, { root, assetsDir, userData, app, platform = process.platform }) {
  const dirs = bases({ root, assetsDir, userData });
  const base = path.basename(src);
  if (kind === "core") {
    if (base !== "live2dcubismcore.min.js") throw new Error("请拖入 live2dcubismcore.min.js");
    return path.join(dirs.asset, "lib", base);
  }
  if (kind === "asr") {
    if (!/\.bin$/i.test(base)) throw new Error("请拖入 ggml-*.bin 模型");
    return path.join(dirs.whisper, base);
  }
  if (kind === "aivis-voice") {
    if (!/\.aivmx$/i.test(base)) throw new Error("请拖入 .aivmx 声线");
    return isWin(platform)
      ? path.join(app.getPath("appData"), "AivisSpeech-Engine", "Models", base)
      : path.join(app.getPath("home"), "Library", "Application Support", "AivisSpeech-Engine", "Models", base);
  }
  throw new Error("暂不支持这种资源");
}

function preview({ kind, src, root, assetsDir, userData, app, platform = process.platform }) {
  const dirs = bases({ root, assetsDir, userData });
  if (!src) throw new Error("没有文件路径");
  const actual = classify(src);
  const actualKind = actual === "voicevox" || actual === "aivis" ? "tts" : actual;
  if (actual === "unknown") return { ok: false, error: "识别不出资源类型" };
  if (kind && actualKind !== kind) {
    const label = { core: "Live2D Core", model: "Live2D 模型", asr: "ASR 模型", "aivis-voice": "Aivis 声线", tts: "TTS 引擎" }[actual] || "其它资源";
    return { ok: false, error: `识别为「${label}」，请拖到对应区域` };
  }
  kind = actualKind;
  const base = path.basename(src);
  let target;
  if (actual === "core" || actual === "asr" || actual === "aivis-voice") {
    target = pick(actual, src, { root, assetsDir, userData, app });
  } else if (actual === "model") {
    let name = path.basename(base, path.extname(base)).replace(/-model$/i, "");
    try {
      const hit = entries(src).find((e) => /\.model3\.json$/i.test(e.entryName));
      if (hit) name = path.basename(path.dirname(hit.entryName));
    } catch (e) {}
    target = path.join(dirs.asset, "model", name);
  } else if (actual === "voicevox" || actual === "aivis") {
    const aivis = actual === "aivis";
    target = aivis
      ? (isWin(platform) ? path.join(dirs.engine, ".aivis", "AivisSpeech-Engine") : path.join(dirs.engine, ".aivis", "AivisSpeech.app"))
      : (isWin(platform) ? path.join(dirs.engine, ".voicevox", "windows", "VOICEVOX") : path.join(dirs.engine, ".voicevox", "extracted", "VOICEVOX"));
    return { ok: true, kind: "tts", label: aivis ? "AivisSpeech 引擎" : "VOICEVOX 引擎", target, exists: fs.existsSync(target) };
  } else throw new Error("暂不支持这种资源");
  return { ok: true, kind, label: LABELS[kind] || kind, target, exists: fs.existsSync(target) };
}

module.exports = { install, preview, rollback };
