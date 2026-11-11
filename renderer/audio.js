/* 音频与口型：WebAudio 输出链 + RMS 包络驱动 ParamMouthOpenY
 *
 * 输出链：audioEl(src) → analyser → gainNode → destination
 * 注意：不要再把 analyser 直连 destination（双路叠加会让增益失效）。
 */
/* ---------------------------- 音频口型 ---------------------------- */
let audioCtx = null;
let analyser = null;
let buf = null;
let meterRaf = 0;
let audioEl = null;
let mediaSrc = null;   // 复用同一个音频源节点

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.4;
  buf = new Uint8Array(analyser.fftSize);

  // 复用同一个 <audio> 元素和一个 MediaElementSource
  // （每次 new Audio() 都会留下一个无法回收的源节点，长时间挂机会越积越多）
  audioEl = new Audio();
  audioEl.preload = "auto";
  mediaSrc = audioCtx.createMediaElementSource(audioEl);   // 一个元素只能建一次
  mediaSrc.connect(analyser);
}

function meterLoop() {
  if (!analyser) return;
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  const raw = rms > mouth.floor ? Math.pow(rms * mouth.gain, 0.7) : 0;
  mouth.target = Math.min(mouth.max, raw);
  meterRaf = requestAnimationFrame(meterLoop);
}

function startMeter() { if (!meterRaf) meterRaf = requestAnimationFrame(meterLoop); }
function stopMeter() {
  if (meterRaf) cancelAnimationFrame(meterRaf);
  meterRaf = 0;
  mouth.target = 0;
}

// 播放增益：VOICEVOX 原始输出偏小（峰值约 0.32），这里再补一档
const PLAY_GAIN = 1.0;   // VOICEVOX 增益（输出链只有一条，1.0 = 原始音量）
let lastTtsEngine = "say";
let gainNode = null;
let pendingResolve = null;   // 当前正在播放的音频的 resolve（打断时需兑现）
let pendingTimer = null;

function isAudioPlaying() {
  return !!(audioEl && !audioEl.paused && !audioEl.ended);
}

function playAudio(url) {
  // 录音中播放会把她的声音录进去 → 直接跳过（Promise 仍要兑现，不能卡住调用方）
  if (recording) {
    console.log("[audio] 录音中，跳过播放");
    return Promise.resolve();
  }
  ensureAudio();
  if (!gainNode) {
    // 唯一的输出链：analyser → gainNode → destination
    // （不要再给 analyser 直连 destination，那会让信号双路叠加、增益失效）
    gainNode = audioCtx.createGain();
    analyser.disconnect();
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  }
  // 小夜的输出偏小（峰值 ~0.6），系统 say 接近满幅，只给 VOICEVOX 补增益
  gainNode.gain.value = lastTtsEngine === "voicevox" ? PLAY_GAIN : 1.0;
  if (audioCtx.state === "suspended") audioCtx.resume();

  // 打断上一段：必须把它的 Promise 兑现，否则 await 它的调用方会永久挂住
  // （之前就是这里没 resolve，导致 dailyBusy 卡死，点完「再听一遍」后无法继续）
  if (audioEl) {
    try { audioEl.pause(); } catch (e) {}
    if (pendingResolve) { const r = pendingResolve; pendingResolve = null; try { clearTimeout(pendingTimer); } catch (e) {} r(); }
  }

  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    // 兜底：45 秒还没结束就强制兑现，避免任何情况下卡死
    pendingTimer = setTimeout(() => {
      if (pendingResolve === resolve) { pendingResolve = null; try { audioEl.pause(); } catch (e) {} resolve(); }
    }, 45000);

    // 复用同一个元素：只换 src。输出链固定为 src → analyser → gainNode → destination
    audioEl.onended = () => {
      if (pendingResolve === resolve) pendingResolve = null;
      clearTimeout(pendingTimer); stopMeter(); resolve();
      try { window.dispatchEvent(new Event("nihonco:audio-end")); } catch (e) {}
    };
    audioEl.onerror = () => {
      if (pendingResolve === resolve) pendingResolve = null;
      clearTimeout(pendingTimer); stopMeter(); reject(new Error("音频播放失败"));
    };
    try {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.src = url;
    } catch (e) {}
    audioEl.play().then(() => {
      startMeter();
      try { window.dispatchEvent(new Event("nihonco:audio-start")); } catch (e) {}
    }).catch((e) => { clearTimeout(pendingTimer); reject(e); });
  });
}


/** 立刻停下正在播放的语音（供"打断"用） */
