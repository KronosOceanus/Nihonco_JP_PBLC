/* TTS 配置的唯一解释层：引擎、地址、声线名、路径 env。
 * 其它模块不要再直接写 VOICEVOX_URL / AIVIS_URL / *_NAME 的默认值。
 */
const ENGINES = {
  voicevox: {
    id: "voicevox",
    label: "VOICEVOX",
    port: 50021,
    urlEnv: "VOICEVOX_URL",
    defaultUrl: "http://127.0.0.1:50021",
    nameEnv: "VOICEVOX_NAME",
    defaultName: "小夜",
    pathEnv: "VOICEVOX_ENGINE",
    key: "vv",
    procName: "vv-engine",
  },
  aivis: {
    id: "aivis",
    label: "AivisSpeech",
    port: 10101,
    urlEnv: "AIVIS_URL",
    defaultUrl: "http://127.0.0.1:10101",
    nameEnv: "AIVIS_NAME",
    defaultName: "まお",
    pathEnv: "AIVIS_ENGINE",
    key: "aivis",
    procName: "AivisSpeech-Engine",
  },
};

function engine(id) {
  return ENGINES[String(id || "").toLowerCase()] || null;
}

function currentEngine(env = process.env) {
  const forced = String(env.TTS_ENGINE || "").toLowerCase();
  if (ENGINES[forced]) return forced;
  // 兼容旧配置：VOICEVOX_URL 指向 10101 视为 Aivis
  return /10101/.test(env.VOICEVOX_URL || "") ? "aivis" : "voicevox";
}

function url(id, env = process.env) {
  const def = engine(id);
  if (!def) return "";
  return (env[def.urlEnv] || def.defaultUrl).replace(/\/+$/, "");
}

function name(id, env = process.env) {
  const def = engine(id);
  if (!def) return "";
  return env[def.nameEnv] || def.defaultName;
}

function pathEnv(id) {
  return engine(id)?.pathEnv || "";
}

function all() {
  return Object.values(ENGINES);
}

module.exports = { ENGINES, engine, currentEngine, url, name, pathEnv, all };
