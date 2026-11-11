/* 语音队列：桌宠发起的语音一律排队，避免"自己打断自己"
 *
 * 用户操作（说话/点按钮/打字）调用 bargeIn() 才会清空队列。
 * 依赖：renderer/audio.js 的 playAudio，renderer/ui.js 的 hudShow。
 */
/* 语音队列：桌宠发起的语音一律排队，避免"自己打断自己"
 * 用户操作（说话/点按钮/打字）调用 bargeIn() 才会清空队列 */
let speechChain = Promise.resolve();
let speechGen = 0;
let speechBusy = 0;

function runSpeech(task) {
  const gen = speechGen;
  speechBusy += 1;
  speechChain = speechChain
    .then(async () => { if (gen !== speechGen) return; await task(); })
    .catch(() => {})
    .finally(() => { speechBusy = Math.max(0, speechBusy - 1); });
  return speechChain;
}

/** 没有日语语音模型时的统一提示（Windows 上宁可不出声，也别用中文声线念日文） */
function ttsMissingHint(msg) {
  hud.classList.remove("gone");
  hudShow(msg || "缺日语语音引擎", 8000);
}

/** 启动自检：只报「确定起不来」；没有 TTS 引擎时提示缺引擎。
 *  两条检查并行，谁先有结论谁先入队；HUD 依次显示（两个都失败时轮流） */
let hintChain = Promise.resolve();
function queueHint(text, ms = 6000) {
  hintChain = hintChain.then(async () => {
    hud.classList.remove("gone");
    hudShow(text, ms);
    await new Promise((r) => setTimeout(r, ms + 500));
  });
}

async function checkServicesOnBoot() {
  const ttsP = window.pet.ttsHealth ? window.pet.ttsHealth().catch(() => null) : Promise.resolve(null);
  const asrP = window.pet.asrHealth ? window.pet.asrHealth().catch(() => null) : Promise.resolve(null);

  const h = await ttsP;
  if (h) {
    if (!h.usable) {
      console.log("[tts] 启动自检不可用:", h.reason, `(等了 ${h.waitedMs || 0}ms)`);
      queueHint("缺日语语音引擎\n（VOICEVOX / Aivis）\n暂时没法出声");
    }
  }

  const a = await asrP;
  if (a && a.status === "failed") {
    console.log("[asr] 启动自检失败:", a.reason, a.lastError || "", `(等了 ${a.waitedMs || 0}ms)`);
    if (/缺 ASR 模型/.test(a.lastError || "")) {
      queueHint("缺 ASR 模型\n设置 → ASR → 下载模型", 8000);
    } else {
      queueHint("语音识别没起来\n看设置 → ASR");
    }
  }
}

/** 合成完再查一次代际：合成期间被用户打断就丢弃，不播、也不覆盖 lastSpoken */
async function speakNow(text, opts) {
  if (!text) return false;
  const gen = speechGen;
  let res = null;
  try { res = await window.pet.speak(text, opts); }
  catch (e) {
    // 主进程在 Windows 上找不到 VOICEVOX 时会抛这条：别静默失败，告诉用户缺什么
    if (String(e && e.message).includes("VOICEVOX")) ttsMissingHint();
    return false;
  }
  if (gen !== speechGen) return false;
  if (!res || !res.url) return false;
  lastSpoken = text;
  if (!opts || opts.replay !== false) lastContentSay = text;   // 模式提示音（replay:false）不作为重播目标
  syncReplayBtn();
  lastTtsEngine = res.engine || "voicevox";
  await playAudio(res.url);
  return true;
}

/** 用户打断：清空队列（之后再排的语音才有效） */
function bargeIn() {
  speechGen += 1;
  stopSpeech();
}

function stopSpeech() {
  try {
    if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
  } catch (e) {}
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    try { clearTimeout(pendingTimer); } catch (e) {}
    r();                      // 让 await playAudio() 的调用链继续往下走
  }
  mouth.target = 0;
  stopMeter();
}

/* ------------------------------ 静音 ------------------------------ */
/** 切换朗读静音：静音时立刻停掉当前语音，之后只显示文字 */
function toggleSpeechMute() {
  speechMuted = !speechMuted;
  if (speechMuted) stopSpeech();
  hud.classList.remove("gone");
  hudShow(speechMuted ? "已静音\n再按恢复" : "恢复朗读", 1500);
  return speechMuted;
}

/* ------------------------------ 说话 ------------------------------ */
let sayGen = 0;

async function say(text, opts = {}) {
  const t = String(text || "").trim();
  if (!t) return;
  if (speechMuted) { hudShow("已静音\n按 F5 恢复", 1500); return; }
  if (speaking && !opts.interrupt) return;   // 普通调用不抢话；「朗读」会打断（见下）
  if (speaking) bargeIn();                    // 停掉正在播的；旧调用会在 await 后自行放弃
  if (!window.pet || !window.pet.speak) {
    hud.classList.remove("gone");
    hudShow("语音合成不可用", 2500);
    return;
  }
  const my = ++sayGen;
  speaking = true;
  try {
    hud.classList.remove("gone");
    hudShow("合成中…", 0);
    const { url, engine } = await window.pet.speak(t);
    if (my !== sayGen) return;             // 已被更新的一次朗读取代
    lastSpoken = t;
    if (opts.replay !== false) { lastContentSay = t; lastConvSay = t; }   // 回显朗读不算会话内容
    syncReplayBtn();
    lastTtsEngine = engine || "voicevox";
    hud.classList.add("gone");
    await playAudio(url);
  } catch (e) {
    if (my === sayGen) {
      hud.classList.remove("gone");
      console.log("[tts] 合成失败:", e); hudShow("语音出错", 2500);
    }
  } finally {
    if (my === sayGen) { speaking = false; mouth.target = 0; }
  }
}


const echoEl = document.getElementById("echo");

/** 语音识别结果单独显示（不碰打字框） */
let echoTimer = null;

let echoData = null;       // { text, other, srcLang, icon, ms, furigana, alternatives }
let echoExpanded = false;
let echoSeq = 0;           // 每次回显自增：pair 返回时序号不一致就丢弃（防止旧句子译文贴到新回显上）

/** 重新开始（或设置）回显的自动消失倒计时 */
function scheduleEchoHide(ms = 10000) {
  if (echoTimer) clearTimeout(echoTimer);
  echoTimer = setTimeout(() => {
    if (echoData && echoEl && echoEl.textContent.includes(echoData.text)) clearEcho();
  }, ms);
}

const echoEsc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function echoCollapsedHTML(d) {
  const tag = d.ms ? ` (${d.ms}ms)` : "";
  return `${d.icon} ${echoEsc(d.text)}${d.other ? `\n　 ${echoEsc(d.other)}` : ""}${tag}`;
}

function echoRuby(segs, plain) {
  if (!Array.isArray(segs) || !segs.length) return echoEsc(plain);
  return segs.map((x) => (x.r
    ? `<ruby>${echoEsc(x.t)}<rt>${echoEsc(x.r)}</rt></ruby>`
    : echoEsc(x.t))).join("");
}

function echoExpandedHTML(d) {
  const tag = d.ms ? `<span class="echo-ms">${d.ms}ms</span>` : "";
  const actions = `<span class="echo-actions">
      <button class="echo-copy">复制</button>
      <button class="echo-say">朗读</button>
    </span>`;
  const rows = [
    `<div class="echo-row"><span class="echo-k">原文</span><span class="echo-body">${echoEsc(d.text)}</span>${tag}</div>`,
  ];
  if (d.other) {
    rows.push(`<div class="echo-row"><span class="echo-k">翻译</span><span class="echo-body">${echoRuby(d.furigana, d.other)}</span>${actions}</div>`);
    for (const a of (d.alternatives || [])) {
      rows.push(`<div class="echo-row echo-alt"><span class="echo-k">也可以</span><span class="echo-body">${echoRuby(a.furigana, a.ja)}</span>${
        a.scene_zh ? `<span class="echo-scene">${echoEsc(a.scene_zh)}</span>` : ""}</div>`);
    }
  }
  return rows.join("");
}

function paintEcho() {
  if (!echoData || !echoEl) return;
  echoExpanded ? (echoEl.innerHTML = echoExpandedHTML(echoData)) : (echoEl.innerHTML = echoCollapsedHTML(echoData));
  if (echoExpanded) {
    const copy = echoEl.querySelector(".echo-copy");
    if (copy) copy.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = echoData && echoData.other;
      if (!t) return;
      navigator.clipboard.writeText(t).then(() => hudShow("已复制", 900)).catch(() => hudShow("复制失败", 1200));
    });
    const sayBtn = echoEl.querySelector(".echo-say");
    if (sayBtn) sayBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (echoData && echoData.other) say(echoData.other, { replay: false, interrupt: true });
    });
  }
  syncEchoHeight();
}

function showEcho(text, lang, ms, source = "voice") {
  if (!echoEl) return;
  const seq = ++echoSeq;
  echoEl.classList.remove("gone");
  // 译文还没到时的兜底（pair 失败也能清掉）；译文到达后会重新计时
  scheduleEchoHide(10000);
  const icon = source === "text" ? "✏️" : "🎤";
  // 原文永远保持原样：上原文 / 下译文
  // 模式是唯一语言来源：日本語按日语、中国語按中文
  const srcLang = speakLang === "zh" ? "zh" : "ja";
  echoData = { text, other: "", srcLang, icon, ms, furigana: null };
  echoExpanded = false;
  echoEl.classList.remove("expandable");
  echoEl.onclick = () => {
    // 只有「中文→日语」才可展开（日语→中文不需要）
    if (!echoData || !echoData.other || echoData.srcLang !== "zh") return;
    echoExpanded = !echoExpanded;
    paintEcho();
    // 展开时暂停倒计时；收起后重新给 10 秒
    if (echoExpanded) { if (echoTimer) { clearTimeout(echoTimer); echoTimer = null; } }
    else scheduleEchoHide(10000);
  };
  echoEl.innerHTML = echoCollapsedHTML(echoData);
  document.body.classList.add("echo-on");
  syncEchoHeight();

  if (!window.pet || !window.pet.pair) return;
  window.pet.pair(text, srcLang).then((p) => {
    if (!p) return;
    const other = srcLang === "ja" ? p.zh : p.ja;   // 只取缺失的那一侧
    if (seq !== echoSeq) return;   // 已经换成别的句子了（用序号判断，避免"包含"误判）
    if (!other) return;
    echoData.other = other;
    echoData.furigana = srcLang === "zh" ? p.ja_furigana : null;
    echoData.alternatives = srcLang === "zh" && Array.isArray(p.ja_alternatives) ? p.ja_alternatives : [];
    if (srcLang === "zh") {
      echoEl.classList.add("expandable");
      echoEl.title = "点击展开（也可以怎么说）";
    }
    echoExpanded = false;
    echoEl.innerHTML = echoCollapsedHTML(echoData);
    scheduleEchoHide(10000);                        // 从译文到达开始算 10 秒
    syncEchoHeight();
  }).catch(() => {});
}

/** 把回显的实际高度写进 CSS 变量，让模式栏/面板跟着上移 */
function syncEchoHeight() {
  if (!echoEl) return;
  const h = echoEl.offsetHeight || 30;
  document.body.style.setProperty("--echo-h", `${h + 6}px`);
}

function clearEcho() {
  if (echoTimer) { clearTimeout(echoTimer); echoTimer = null; }
  if (!echoEl) return;
  echoEl.textContent = "";
  echoEl.classList.add("gone");
  echoEl.classList.remove("expandable");
  echoEl.title = "";
  echoData = null;
  echoExpanded = false;
  echoSeq += 1;             // 让在途的 pair 作废
  document.body.classList.remove("echo-on");
  document.body.style.removeProperty("--echo-h");
}

/* ------------------------------ 模型 ------------------------------ */
