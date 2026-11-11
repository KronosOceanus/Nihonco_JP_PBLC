/* 录音与音频预处理
 *
 * 按住麦克风/空格说话：getUserMedia → 收集 PCM → 裁静音/归一 → 交给主进程识别。
 * 约束：录音期间不要播放她的语音（会被麦克风收进去），playAudio 里会检查 recording。
 */
/* ------------------------ 录音（按住麦克风说话） ------------------------ */
const micEl = document.getElementById("mic");
let rec = null;
let recording = false;    // 正在录音（这期间不要播放她的语音，否则会被麦克风收进去）
let recPending = false;   // getUserMedia 还没返回
let recAbort = false;     // 拿到流之前就松手/取消了
let spaceHeld = false;    // 空格对讲是否按住中

function float32ToWav(chunks, sampleRate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Int16Array(len);
  let off = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      pcm[off++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

function toBase64(u8) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}

/** 麦克风相关错误统一提示 */
function recError(e) {
  micEl.classList.remove("rec", "busy");
  hud.classList.remove("gone");
  console.log("[rec] 麦克风打不开:", e); hudShow("麦克风打不开", 3000);
}

async function startRec(fromSpace = false, opts = {}) {
  const autoStop = !!opts.autoStop;
  const autoStopMs = Number(opts.autoStopMs) || 1200;
  if (rec || recPending) return;
  if (!window.pet || !window.pet.asr) throw new Error("需要在 Electron 里运行");
  recPending = true;
  recAbort = false;

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    // 等待期间用户已经松手/取消 → 立刻停掉这条流，别让它泄漏
    if (recAbort) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      recPending = false;
      recAbort = false;
      micEl.classList.remove("rec", "busy");
      return false;              // ← 告诉调用方「没真的录上」，别再显示"录音中"
    }

    // 下面任何一步抛错，都要把已经打开的流关掉
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const chunks = [];
    proc.onaudioprocess = (e) => {
      const c = new Float32Array(e.inputBuffer.getChannelData(0));
      chunks.push(c);
      // 实时电平，用于判断「有没有真的录到声音」
      let sum = 0;
      for (let i = 0; i < c.length; i++) sum += c[i] * c[i];
      const rms = Math.sqrt(sum / c.length);
      if (rec) {
        rec.peak = Math.max(rec.peak || 0, rms);
        // 切换式录音的「自动结束」：记住最后一次说话的时间
        if (rms > 0.02) { rec.lastVoice = Date.now(); rec.hasVoice = true; }
      }
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    rec = { stream, ctx, src, proc, chunks, rate: ctx.sampleRate };
    recPending = false;
    recording = true;

    // 自动结束：说了话之后静音 1.2 秒就收尾（切换式录音用；按住空格仍然是松手结束）
    if (autoStop) {
      const timer = setInterval(() => {
        if (!rec || rec.timer !== timer) { clearInterval(timer); return; }
        if (rec.hasVoice && Date.now() - (rec.lastVoice || 0) > autoStopMs) {
          clearInterval(timer);
          finishRec();
        }
      }, 200);
      rec.timer = timer;
    }

    // 记录实际用的输入设备（排除虚拟声卡录到静音的情况）
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const inputs = devs.filter((d) => d.kind === "audioinput").map((d) => d.label || d.deviceId.slice(0, 8));
      const used = stream.getAudioTracks()[0]?.label || "?";
      console.log("[mic] 使用设备:", used, "| 可用:", inputs.join(" / "));
    } catch (e) {}
    return true;                 // 真的在录了
  } catch (e) {
    recPending = false;
    recAbort = false;
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    if (rec && !rec.stream) rec = null;
    throw e;
  }
}

/* 音频预处理：裁掉首尾静音 + 峰值归一化 + tanh 软限幅
 * 目的：Whisper 对「长静音 + 短语音」和「削顶」都极容易陷入复读幻觉 */
function preprocess(chunks, rate) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  if (!len) return null;
  const x = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { x.set(c, o); o += c.length; }

  let peak = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  if (peak < 1e-4) return null;                       // 基本静音

  const th = Math.min(0.02, peak * 0.1);              // 端点阈值
  let st = 0, en = len - 1;
  while (st < len && Math.abs(x[st]) < th) st++;
  while (en > st && Math.abs(x[en]) < th) en--;
  const pad = Math.round(rate * 0.12);                // 前后各留 120ms，别切掉字头
  st = Math.max(0, st - pad);
  en = Math.min(len - 1, en + pad);

  const seg = x.subarray(st, en + 1);
  let p2 = 0;
  for (let i = 0; i < seg.length; i++) { const a = Math.abs(seg[i]); if (a > p2) p2 = a; }
  const gain = p2 > 0 ? Math.min(8, 0.85 / p2) : 1;   // 最多放大 8 倍，避免放大底噪

  const out = new Float32Array(seg.length);
  for (let i = 0; i < seg.length; i++) out[i] = Math.tanh(seg[i] * gain);  // 软限幅

  return { samples: out, dur: out.length / rate, peak, gain };
}

/** 取消当前录音（丢弃，不识别不发送） */
function cancelRec() {
  recording = false;
  if (rec && rec.timer) { try { clearInterval(rec.timer); } catch (e) {} }
  if (!rec) {
    if (recPending) { recAbort = true; micEl.classList.remove("rec", "busy"); }
    return;
  }
  const { stream, ctx, src, proc } = rec;
  rec = null;
  try { proc.disconnect(); src.disconnect(); } catch (e) {}
  try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  try { ctx.close(); } catch (e) {}
  micEl.classList.remove("rec", "busy");
  hud.classList.remove("gone");
  hudShow("已取消", 1200);
}

async function stopRec() {
  recording = false;
  if (!rec) return null;
  const { stream, ctx, src, proc, chunks, rate } = rec;
  const peak = rec.peak || 0;
  rec = null;
  try { proc.disconnect(); src.disconnect(); } catch (e) {}
  stream.getTracks().forEach((t) => t.stop());
  const rawDur = chunks.reduce((n, c) => n + c.length, 0) / rate;
  try { await ctx.close(); } catch (e) {}
  const pp = preprocess(chunks, rate);
  if (!pp) return { wav: null, dur: rawDur, peak };
  const dur = pp.dur;                                  // 裁剪后的有效时长
  console.log('[rec] raw=' + rawDur.toFixed(2) + 's 裁剪后=' + dur.toFixed(2) +
              's gain=' + pp.gain.toFixed(2) + ' 原峰值=' + pp.peak.toFixed(3));
  if (dur < 0.25) return { wav: null, dur, peak };
  return { wav: float32ToWav([pp.samples], rate), dur, peak };
}

/** 给识别请求套一层看门狗：主进程那边有 20s 超时，这里兜底 28s */
function withTimeout(promise, ms, message) {
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function finishRec() {
  // 还在等 getUserMedia 就松手了：标记取消，等 startRec 拿到流后自己释放
  if (recPending && !rec) {
    recAbort = true;
    micEl.classList.remove("rec");
    hud.classList.remove("gone");
    hudShow("太短了\n再说一次", 1500);
    return;
  }
  if (!micEl.classList.contains("rec")) {
    // 已经不在录音状态（等待权限时被 blur / 取消过）：别把"录音中"留在屏幕上
    if (hud.textContent && hud.textContent.indexOf("录音中") === 0) hud.classList.add("gone");
    return;
  }
  micEl.classList.remove("rec");
  micEl.classList.add("busy");
  hud.classList.remove("gone");
  hudShow("识别中…", 0);
  try {
    const peak = rec ? rec.peak : 0;          // 松开前的电平（stopRec 会清 rec，这里提前读）
    const r = await stopRec();
    const wav = r && r.wav;
    if (!wav) {
      hudShow("太短了\n再说一次", 1500);
      return;
    }
    // 静音诊断：几乎没声音时直接提示，而不是把噪声丢给模型（Whisper 会编造内容）
    if (peak < 0.008) {
      hudShow("没录到声音", 3000);
      return;
    }
    if (r.dur < 0.35) {
      hudShow("太短了\n再说一次", 1500);
      return;
    }
    const b64 = toBase64(wav);
    console.log('[rec] dur=' + r.dur.toFixed(2) + 's peak=' + r.peak.toFixed(4) + ' bytes=' + wav.length);
    if (window.pet.saveAudio) window.pet.saveAudio(b64).catch(() => {});
    const { text, ms, lang, guard } = await withTimeout(
      window.pet.asr(b64, ASR_FORCE || asrLang()), 28000, '识别超时（识别服务没响应）');
    if (text && guard && guard.ok === false) {
      showEcho(text, lang, ms);
      hudShow("像中文\n再说一次？", 2600);
      return;
    }
    if (text) {
      // 中国语模式：识别结果一律按中文原文翻译；不拦截日语
      showEcho(text, speakLang === "zh" ? "zh" : lang, ms);
      const short = text.length > 10 ? text.slice(0, 10) + "…" : text;
    hudShow(`${short}\n${ms}ms`, 1400);
      chatSource = "voice";
      sendChat(text);
    } else {
      hudShow("没听清\n再说一次", 1500);
    }
  } catch (e) {
    console.log("[rec] 识别失败:", e);
    const msg = String(e && e.message || "");
    hudShow(/缺 ASR 模型/.test(msg) ? "缺 ASR 模型\n设置 → ASR → 下载模型" : "识别失败", 3000);
  } finally {
    micEl.classList.remove("busy");
    // 录音结束从不抢输入框焦点（不管空格、话筒还是快捷键；手动点输入框才会聚焦）
  }
}

