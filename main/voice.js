/* TTS 合成层：语音、缓存、预热、启动自检。
 * 引擎进程的生命周期在 agent/tts-engine.js；这里不 spawn 引擎。
 */
const fs = require("fs");
const path = require("path");
const health = require("../agent/health");
const createTtsEngine = require("../agent/tts-engine");


/** 给 PCM16 WAV 首尾加 10ms 淡入/淡出，避免起止处的咔哒声。 */
function fadeWav(buf, ms = 10) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 44) return buf;
    if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return buf;
    let off = 12, fmt = null, data = null;
    while (off + 8 <= buf.length) {
      const id = buf.toString("ascii", off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      const p = off + 8;
      if (id === "fmt ") fmt = { p, size };
      if (id === "data") { data = { p, size }; break; }
      off = p + size + (size & 1);
    }
    if (!fmt || !data || fmt.size < 16) return buf;
    const channels = buf.readUInt16LE(fmt.p + 2);
    const rate = buf.readUInt32LE(fmt.p + 4);
    const bits = buf.readUInt16LE(fmt.p + 14);
    if (bits !== 16 || !channels || !rate) return buf;
    const frame = channels * 2;
    const frames = Math.floor(data.size / frame);
    const n = Math.min(frames, Math.max(1, Math.round(rate * ms / 1000)));
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const start = data.p + i * frame;
      const end = data.p + (frames - 1 - i) * frame;
      for (let c = 0; c < channels; c++) {
        const s0 = buf.readInt16LE(start + c * 2);
        const s1 = buf.readInt16LE(end + c * 2);
        buf.writeInt16LE(Math.round(s0 * a), start + c * 2);
        buf.writeInt16LE(Math.round(s1 * a), end + c * 2);
      }
    }
    return buf;
  } catch (e) { return buf; }
}

module.exports = function createVoice({ root, userData, voiceDir, tts, platform, procs, voiceCache, spawnProc }) {
  const engine = createTtsEngine({ root, userData, tts, platform, procs, spawnProc });
  const {
    enginePath, ensureTtsEngine, startTtsEngine, switchEngine, stopEngine, cancelSwitch,
    engineStatus, getEngineProc,
  } = engine;

  function ttsNoEngineError() {
    const err = new Error("缺日语语音引擎（VOICEVOX / AivisSpeech）：请安装后在设置 → TTS 选择");
    err.code = "TTS_NO_JA_VOICE";
    return err;
  }

  async function speakToWav(text, opts = {}) {
    const _t = Date.now();
    if (!(await tts.alive())) throw ttsNoEngineError();
    const { wav, speaker } = await tts.synthesize(text, opts);
    const outWav = fadeWav(Buffer.from(wav));
    fs.mkdirSync(voiceDir, { recursive: true });
    const out = path.join(voiceDir, "say.wav");
    fs.writeFileSync(out, outWav);
    const capDir = process.env.NIHONCO_TTS_CAPTURE_DIR;
    if (capDir) {
      try {
        fs.mkdirSync(capDir, { recursive: true });
        const n = String((global.__ttsCapSeq = (global.__ttsCapSeq || 0) + 1)).padStart(3, "0");
        fs.copyFileSync(out, path.join(capDir, `tts-${n}.wav`));
        fs.appendFileSync(path.join(capDir, "transcript.txt"), `${n}\t${text}\n`);
      } catch (e) { console.log("[tts] capture failed", e.message); }
    }
    const eng = tts.engineName ? tts.engineName() : "voicevox";
    console.log(`[tts] ${eng} ${speaker.name}(${speaker.styleName}) ${wav.length}B`);
    console.log(`[t] tts ${eng} ${Date.now() - _t}ms`);
    return out;
  }

  /** 预热固定短句（模式提示音），让切换时几乎立刻出声。 */
  const PREWARM = ['かいわモード', 'かいせつモード', 'たんごモード', 'れいぶんモード',
                   'たんご復習モード', 'れいぶん復習モード', 'レベルアップ', 'レベルダウン'];
  let prewarming = false;
  async function prewarmPrompts() {
    if (prewarming) return;
    prewarming = true;
    try {
      if (!(await ensureTtsEngine())) {
        console.log("[tts] 预热跳过：TTS 引擎没就绪（模式提示音改为实时合成）");
        return;
      }
      let n = 0;
      for (const text of PREWARM) {
        if (voiceCache.get(tts.speechKey(text))) continue;
        try {
          const file = await speakToWav(text, {});
          if (!(await tts.alive())) continue;
          voiceCache.put(tts.speechKey(text), file);
          n++;
        } catch (e) { /* 预热失败就算了 */ }
      }
      if (n) console.log(`[tts] 预热完成 ${n}/${PREWARM.length} 条提示音（${tts.voiceName()}）`);
    } finally {
      prewarming = false;
    }
  }

  /** 启动自检：只看当前引擎；没有 say 回落。 */
  let bootTtsCache = null;
  let bootTtsAt = 0;
  async function bootCheckTts({ timeoutMs = 12000 } = {}) {
    if (bootTtsCache && Date.now() - bootTtsAt < 15000) return bootTtsCache;
    const t0 = Date.now();
    let hasEngine = false;
    try {
      hasEngine = (tts.isGenie && tts.isGenie()) || !!enginePath();
      if (!hasEngine) hasEngine = await tts.alive();
    } catch (e) {}
    let engineReady = false;
    if (hasEngine) { try { engineReady = await ensureTtsEngine(); } catch (e) {} }
    const v = health.ttsVerdict({ hasEngine, engine: engineReady });
    const out = {
      ok: v.usable, usable: v.usable, reason: v.reason,
      engine: engineReady, hasEngine, waitedMs: Date.now() - t0, hint: "",
    };
    bootTtsCache = out; bootTtsAt = Date.now();
    console.log(`[health] tts usable=${v.usable} reason=${v.reason} engine=${engineReady} waited=${out.waitedMs}ms`);
    return out;
  }

  function refreshVoiceCache() {
    const n = voiceCache.clear();
    console.log(`[tts] 声线变化，清掉 ${n} 个缓存文件，重新预热…`);
    setTimeout(() => { prewarmPrompts(); }, 300);
  }

  return {
    ensureTtsEngine, startTtsEngine, speakToWav,
    prewarmPrompts, refreshVoiceCache, bootCheckTts,
    switchEngine, cancelSwitch, stopEngine, enginePath, engineStatus, getEngineProc,
  };
};
