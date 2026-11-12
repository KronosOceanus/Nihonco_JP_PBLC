/* TTS 适配层：VOICEVOX 优先，失败回落系统 say
 *
 * GENIE_TTS_URL 是实验路径（未完整测试，默认不启用）；
 * 设置后走本地 Genie，设置前仍走 VOICEVOX。
 *
 * VOICEVOX Engine 的接口（本地 HTTP）：
 *   GET  /speakers                                    → 角色与 style 列表
 *   POST /audio_query?text=...&speaker=<styleId>      → 查询参数（语速/音高等）
 *   POST /synthesis?speaker=<styleId>  body=query     → 返回 WAV
 *
 * 为什么这么做：
 *   - 小夜/SAYO 的声线比系统 `say` 自然得多，且能调语速
 *   - 返回 WAV，现有「按音量驱动口型」的逻辑完全不用改
 */

const fs = require("fs");
const path = require("path");

const config = require("./config");       // 先加载 .env，再读 GENIE_TTS_URL
const ttsConfig = require("./tts-config");
const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const GENIE_URL = (process.env.GENIE_TTS_URL || "").replace(/\/+$/, "");
const NAME = ttsConfig.name(engineName());       // 按名字找角色
const SPEED = Number(process.env.VOICEVOX_SPEED || 1.0); // 默认语速（界面改过就以 settings.json 为准）
const PITCH = Number(process.env.VOICEVOX_PITCH || 0);   // 音高 ±0.15 以内
const INTONE = Number(process.env.VOICEVOX_INTONE || 1.0);
const VOLUME = Number(process.env.VOICEVOX_VOLUME || 1.0);
// 专有名词的表记 → 朗读读音（显示保留原名，读出来是假名）
const speechText = require("./speech-text");

/** 朗读前规范化（详见 agent/speech-text.js）：只影响读出来的内容 */
function userNameReading() {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "persona.json"), "utf8"));
    const pr = p.profile || {};
    const name = String(pr.nickname || "").trim();
    const reading = String(pr.nickname_reading || "").trim();
    return /^[\u3040-\u309fー]+$/.test(reading) ? { name, reading } : { name: "", reading: "" };
  } catch (e) {
    return { name: "", reading: "" };
  }
}

function forSpeech(text, engine = "voicevox") {
  const u = userNameReading();
  return speechText.prepare(text, { engine, userName: u.name, userReading: u.reading });
}

/** 规则版本：参与 TTS 缓存键，改规则后旧缓存自动失效 */
function rulesVersion() {
  return speechText.RULES_VERSION;
}

/** 当前 TTS 引擎。运行时读 env，设置窗口切换后无需重启。 */
function engineName() {
  if (GENIE_URL) return "genie";
  return ttsConfig.currentEngine();
}

/** 当前引擎的 HTTP 基址 */
function baseUrl() {
  return ttsConfig.url(engineName());
}

/** TTS 缓存键：预热与实时合成都必须用这一个（否则写的读不到） */
function speechKey(text) {
  // 不同引擎的缓存分开；VoiceVox 保持原前缀，旧缓存不失效
  const engine = GENIE_URL ? "genie|" : (engineName() === "voicevox" ? "" : `${engineName()}|`);
  return `v${rulesVersion()}|${engine}${forSpeech(text, "voicevox")}`;
}

const PEAK_TARGET = Number(process.env.VOICEVOX_PEAK || 1.0);   // 1.0 = 不处理（回滚默认）；<1 才做峰值归一   // 音量倍率（1.0 为原始）

let cachedSpeaker = null;   // { styleId, name, styleName }
let currentName = NAME;     // 当前选中的角色（可在设置窗口里改，不用重启）

/** 是否走 Genie 本地 TTS（GENIE_TTS_URL） */
function isGenie() { return !!GENIE_URL; }

/** 当前选中的角色名（voice-cache 用它区分缓存） */
function voiceName() {
  return currentName;
}

/** 切换角色：清掉缓存，下一次合成时重新按名字找 */
function setName(name) {
  currentName = String(name || "").trim() || NAME;
  cachedSpeaker = null;
  return currentName;
}

/** 当前引擎里的角色与风格列表（给设置窗口的声线下拉用） */
async function listSpeakers() {
  if (GENIE_URL) {
    return { current: currentName, speakers: [{ name: "Genie", styles: [{ name: "mika", id: 0 }] }] };
  }
  const res = await fetch(`${baseUrl()}/speakers`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`引擎 /speakers HTTP ${res.status}`);
  const list = await res.json();
  return {
    current: currentName,
    speakers: (list || []).map((sp) => ({
      name: sp.name,
      styles: (sp.styles || []).map((st) => ({ name: st.name, id: st.id })),
    })),
  };
}

async function alive() {
  if (GENIE_URL) {
    try {
      const r = await fetch(`${GENIE_URL}/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch (e) { return false; }
  }
  try {
    const r = await fetch(`${baseUrl()}/speakers`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch (e) {
    return false;
  }
}

/** 在 /speakers 里找匹配名字的角色（取第一个 style，通常是「ノーマル」） */
async function findSpeaker() {
  if (GENIE_URL) return { styleId: 0, name: "Genie", styleName: "mika" };
  if (cachedSpeaker) return cachedSpeaker;
  const res = await fetch(`${baseUrl()}/speakers`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`VOICEVOX /speakers HTTP ${res.status}`);
  const list = await res.json();
  const hit = list.find((s) => s.name.includes(currentName))
    || list.find((s) => s.name.includes(ttsConfig.name(engineName())))
    || list[0];
  if (!hit) throw new Error("引擎没有任何角色");
  const style = (hit.styles || []).find((s) => /ノーマル|normal/i.test(s.name)) || hit.styles[0];
  cachedSpeaker = { styleId: style.id, name: hit.name, styleName: style.name };
  return cachedSpeaker;
}

/**
 * 峰值归一化：把最大振幅拉到 target（默认 0.92），保证不削峰
 * 最后再 tanh 软限幅兜底 —— 即使有瞬时尖峰也不会爆音
 */
function normalizeWav(buf, target = 0.92) {
  try {
    if (!(target > 0) || target >= 0.999) return buf;   // 关闭
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return buf;
    // 找 data chunk
    let off = 12, dataOff = -1, dataLen = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === 'data') { dataOff = off + 8; dataLen = Math.min(size, buf.length - dataOff); break; }
      off += 8 + size + (size % 2);
    }
    if (dataOff < 0 || dataLen < 2) return buf;
    const n = Math.floor(dataLen / 2);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf.readInt16LE(dataOff + i * 2)) / 32768;
      if (v > peak) peak = v;
    }
    if (peak <= 0.001) return buf;
    const gain = Math.min(4, target / peak);          // 最多放大 4 倍，避免抬底噪
    const changed = Buffer.from(buf);
    let maxOut = 0;
    for (let i = 0; i < n; i++) {
      let y = (buf.readInt16LE(dataOff + i * 2) / 32768) * gain;
      // gain 是按峰值算的，正常情况下不会超；这里只做兜底，防止浮点误差削顶
      if (y > 0.99) y = 0.99; else if (y < -0.99) y = -0.99;
      if (Math.abs(y) > maxOut) maxOut = Math.abs(y);
      changed.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y * 32767))), dataOff + i * 2);
    }
    console.log(`[tts] 归一化 峰值 ${peak.toFixed(2)} → ${maxOut.toFixed(2)}（增益 ${gain.toFixed(2)}x）`);
    return changed;
  } catch (e) {
    return buf;
  }
}

/** 合成：返回 { wav: Buffer, speaker } */
async function synthesize(text, opts = {}) {
  if (GENIE_URL) {
    const r = await fetch(`${GENIE_URL}/say`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: forSpeech(text, "voicevox").slice(0, 300) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Genie /say HTTP ${r.status}`);
    const wav = Buffer.from(await r.arrayBuffer());
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") {
      throw new Error("Genie /say 没有返回 WAV");
    }
    return { wav: normalizeWav(wav, PEAK_TARGET), speaker: { name: "Genie", styleName: "mika" } };
  }
  const spk = await findSpeaker();
  const q = new URLSearchParams({ text: forSpeech(text, "voicevox").slice(0, 300), speaker: String(spk.styleId) });
  const qr = await fetch(`${baseUrl()}/audio_query?${q}`, { method: "POST", signal: AbortSignal.timeout(8000) });
  if (!qr.ok) throw new Error(`audio_query HTTP ${qr.status}`);
  const query = await qr.json();

  // 教学场景：稍微放慢、音高别飘
  // 每次合成读一次配置，这样设置窗口改完立刻生效
  const v = config.voice();
  query.speedScale = v.speed ?? SPEED;
  query.pitchScale = v.pitch ?? PITCH;
  query.intonationScale = v.intonation ?? INTONE;
  query.volumeScale = v.volume ?? VOLUME;
  // 停顿倍率：教学时把「词」和「例句」之间的空隙拉长
  if (opts.pauseScale) query.pauseLengthScale = Number(opts.pauseScale);
  query.outputSamplingRate = 24000;   // 换来文件更小，口型够用

  const sr = await fetch(`${baseUrl()}/synthesis?speaker=${spk.styleId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(20000),
  });
  if (!sr.ok) throw new Error(`synthesis HTTP ${sr.status}`);
  const raw = Buffer.from(await sr.arrayBuffer());
  return { wav: normalizeWav(raw, PEAK_TARGET), speaker: spk };
}

module.exports = { alive, findSpeaker, listSpeakers, setName, voiceName, rulesVersion, speechKey, synthesize, normalizeWav, forSpeech, baseUrl, GENIE_URL, isGenie, engineName, NAME };
