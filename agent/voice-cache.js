/* 固定短句的语音缓存（模式提示音这类每次都一样的话）
 *
 *   .voice/cache/<sha1>.wav
 *
 * key = 文本 + 当前声线（角色名）+ 参数（语速/音高/语调/音量），
 * 换角色或调参数都会自动生成新缓存，不会拿旧声音凑合。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
// 缓存目录必须和静态服务器能读到的目录一致：
//   主进程会用 NIHONCO_VOICE_CACHE_DIR 指到 <可写目录>/.voice/cache（打包后是 %APPDATA%\Nihonco\.voice\cache）；
//   测试时跟着 NIHONCO_DATA_DIR 走，别往仓库里写文件。
const DIR = process.env.NIHONCO_VOICE_CACHE_DIR
  || (process.env.NIHONCO_DATA_DIR
        ? path.join(process.env.NIHONCO_DATA_DIR, "voice-cache")
        : path.join(ROOT, ".voice", "cache"));
const MAX_FILES = Number(process.env.VOICE_CACHE_MAX || 120);

function paramsKey() {
  try {
    const voice = require("./config").voice();
    let name = "";
    try { name = require("./tts").voiceName() || ""; } catch (e) {}   // 换声线 → 换缓存键
    return JSON.stringify({ n: name, s: voice.speed, p: voice.pitch, i: voice.intonation, v: voice.volume });
  } catch (e) { return "{}"; }
}

function nameOf(text) {
  return crypto.createHash("sha1").update(String(text) + "|" + paramsKey()).digest("hex").slice(0, 16) + ".wav";
}

/** 命中就返回文件路径 */
function get(text) {
  try {
    const f = path.join(DIR, nameOf(text));
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) return f;
  } catch (e) {}
  return null;
}

/** 把刚合成好的 wav 收进缓存 */
function put(text, wavPath) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const dst = path.join(DIR, nameOf(text));
    fs.copyFileSync(wavPath, dst);
    sweep();
    return dst;
  } catch (e) { return null; }
}

/** 只保留最近 MAX_FILES 个 */
function sweep() {
  try {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".wav"))
      .map((f) => ({ f, m: fs.statSync(path.join(DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const x of files.slice(MAX_FILES)) {
      try { fs.unlinkSync(path.join(DIR, x.f)); } catch (e) {}
    }
  } catch (e) {}
}

/** 清空缓存（换声线 / 改语音参数时用，旧声音的文件没必要留着占地方） */
function clear() {
  let n = 0;
  try {
    for (const f of fs.readdirSync(DIR)) {
      if (!f.endsWith(".wav")) continue;
      try { fs.unlinkSync(path.join(DIR, f)); n++; } catch (e) {}
    }
  } catch (e) {}
  return n;
}

/** 缓存目录里有哪些（调试用） */
function list() {
  try { return fs.readdirSync(DIR).filter((f) => f.endsWith(".wav")); } catch (e) { return []; }
}

module.exports = { get, put, clear, list, DIR, nameOf };
