/* 用户配置的唯一数据源：data/settings.json
 *
 * 原则：
 *   - 所有窗口只通过主进程的 cfg:get / cfg:set 读写，谁都不许直接写文件
 *   - .env 提供「默认值」，用户改过才落到 settings.json（覆盖 env）
 *   - 写文件用原子写，避免崩溃时配置损坏
 */
const path = require("path");
const fs = require("fs");
const { writeJsonAtomic } = require("./jsonfile");
const schema = require("./schema");
const { loadEnv } = require("./env");
const providers = require("./providers");

// 先加载 .env 并写回 process.env（config 与 tts 都依赖它）
const ENV = loadEnv();
for (const [k, v] of Object.entries(ENV)) if (process.env[k] === undefined) process.env[k] = v;

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "settings.json");
const LEVELS = ["N5", "N4", "N3", "N2", "N1"];

function maskKey(k) {
  const t = String(k || "");
  if (!t) return "";
  if (t.length <= 8) return "••••";
  return t.slice(0, 4) + "…" + t.slice(-4);
}

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function defaults() {
  return {
    level: String(process.env.JP_LEVEL || "N4").toUpperCase(),
    voice: {
      speed: num(process.env.VOICEVOX_SPEED, 1.0),
      pitch: num(process.env.VOICEVOX_PITCH, 0.0),
      intonation: num(process.env.VOICEVOX_INTONE, 1.0),
      volume: num(process.env.VOICEVOX_VOLUME, 1.0),
    },
  };
}

function clampVoice(v) {
  return {
    speed: Math.min(1.5, Math.max(0.5, num(v.speed, 1.0))),   // 与设置窗口滑块保持一致
    pitch: Math.min(0.15, Math.max(-0.15, num(v.pitch, 0.0))),
    intonation: Math.min(2.0, Math.max(0.0, num(v.intonation, 1.0))),
    volume: Math.min(2.0, Math.max(0.0, num(v.volume, 1.0))),
  };
}

function get() {
  const d = defaults();
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch (e) {}
  // 旧 settings.json 没有 version：读时迁移并回写，保证文件带版本
  const m = schema.migrate("settings", raw);
  if (m.newer) console.warn("[settings] 数据版本比程序新（v" + m.from + "），不做迁移");
  raw = m.data;
  if (m.changed && !m.newer) { try { writeJsonAtomic(FILE, raw); } catch (e) {} }

  const level = LEVELS.includes(String(raw.level || "").toUpperCase())
    ? String(raw.level).toUpperCase()
    : d.level;

  return {
    level,
    voice: clampVoice({ ...d.voice, ...(raw.voice || {}) }),
    // 只读展示用（来自 .env，不在界面里改）
    llm: {
      baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
      model: process.env.LLM_MODEL || "deepseek-chat",
      hasKey: !!process.env.LLM_API_KEY,
      keyMasked: maskKey(process.env.LLM_API_KEY),
      // 当前模型是否在目录里（不在 = 自定义）
      known: providers.find(process.env.LLM_MODEL, process.env.LLM_BASE_URL),
      catalog: providers.catalog(),
    },
    asr: {
      lang: process.env.ASR_LANG || "ja",
      backend: process.env.ASR_BACKEND || "whispercpp",
      model: process.env.ASR_MODEL || "ggml-small-q5_1.bin",
      // 日志开关（默认开）；文件路径也回给设置窗口显示
      log: (() => {
        const v = String(process.env.ASR_LOG ?? "1").toLowerCase();
        return v !== "0" && v !== "false" && v !== "off";
      })(),
      logFile: (() => {
        try { return require("./asr-log").FILE; } catch (e) { return ""; }
      })(),
    },
  };
}

function write(raw) {
  writeJsonAtomic(FILE, schema.stamp("settings", raw));
}

/** 只接受白名单字段的补丁 */
function patch(p = {}) {
  const cur = get();
  const raw = { level: cur.level, voice: { ...cur.voice } };

  if (p.level !== undefined) {
    const lv = String(p.level).toUpperCase();
    if (LEVELS.includes(lv)) raw.level = lv;
  }
  if (p.voice && typeof p.voice === "object") {
    raw.voice = clampVoice({ ...raw.voice, ...p.voice });
  }
  write(raw);
  return get();
}

/** TTS 每次合成时读一次，改完立即生效 */
function voice() {
  return get().voice;
}

/* ---------------- API key：改 .env 里的 LLM_API_KEY ---------------- */
// 测试时 ENV_FILE 跟着 NIHONCO_DATA_DIR 走，避免测试改到真实 .env
const ENV_FILE = process.env.NIHONCO_DATA_DIR
  ? path.join(process.env.NIHONCO_DATA_DIR, ".env")
  : path.join(__dirname, "..", ".env");

/** 只替换 LLM_API_KEY 这一行，其余内容原样保留；没有该行就追加 */
function setApiKey(key) {
  const k = String(key || "").trim();
  let text = "";
  try { text = fs.readFileSync(ENV_FILE, "utf8"); } catch (e) { text = ""; }

  const lines = text.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (/^\s*LLM_API_KEY\s*=/.test(line)) { found = true; return `LLM_API_KEY=${k}`; }
    return line;
  });
  if (!found) out.push(`LLM_API_KEY=${k}`);

  // 去掉末尾可能多出来的空行，保持文件干净
  while (out.length && out[out.length - 1] === "" && out.length > 1 && out[out.length - 2] === "") out.pop();

  const tmp = ENV_FILE + ".tmp";
  fs.writeFileSync(tmp, out.join("\n"), { mode: 0o600 });   // .env 里有密钥，只给本人读写
  fs.renameSync(tmp, ENV_FILE);

  process.env.LLM_API_KEY = k;           // 让同进程后续读取立刻生效
  return { hasKey: !!k, keyMasked: maskKey(k) };
}

/** 写回 .env 的单个键（保留其它行） */
function setEnvValue(key, value) {
  const v = String(value ?? "");
  // 值里出现换行可以直接往 .env 里插新变量（比如伪造 LLM_API_KEY），一律拒绝
  if (/[\r\n]/.test(v)) throw new Error("值里不能包含换行");
  let text = "";
  try { text = fs.readFileSync(ENV_FILE, "utf8"); } catch (e) { text = ""; }
  const lines = text.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) { found = true; return `${key}=${v}`; }
    return line;
  });
  if (!found) out.push(`${key}=${v}`);
  while (out.length > 2 && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
  const tmp = ENV_FILE + ".tmp";
  fs.writeFileSync(tmp, out.join("\n"), { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
  process.env[key] = v;
}

/** 选模型 → 顺便定接口地址（目录里没有就要求显式给 base） */
function setProvider({ model, base } = {}) {
  const m = String(model || "").trim();
  if (!m) return { ok: false, error: "模型名为空" };

  const inferred = providers.baseOf(m);
  // 目录里没有的模型：显式给的 base > 当前已配置的地址（自建网关通常只换模型名）
  const current = process.env.LLM_BASE_URL || "";
  const b = String(base || inferred || current || "").trim().replace(/\/+$/, "");
  if (!b) return { ok: false, error: "这个模型不在目录里，需要填写接口地址" };

  setEnvValue("LLM_MODEL", m);
  setEnvValue("LLM_BASE_URL", b);

  // Ollama 走的是另一套变量（没 key 时用它探测），选中时一起同步，避免两处配置打架
  if (/^http:\/\/(127\.0\.0\.1|localhost):11434/.test(b)) {
    setEnvValue("OLLAMA_BASE_URL", b);
    setEnvValue("OLLAMA_MODEL", m);
  }

  return { ok: true, model: m, baseUrl: b };
}

module.exports = { get, patch, voice, defaults, setApiKey, setProvider, setEnvValue, maskKey, LEVELS, FILE, ENV_FILE };
