/* Live2D 桌面挂件 · 渲染层（pixi 7 + pixi-live2d-display-lipsyncpatch）
 *
 * 干四件事：
 *   1) 渲染模型（透明背景，贴窗口底部，支持 zoom 取景）
 *   2) 播放 TTS 音频，用 WebAudio 的 RMS 包络驱动 ParamMouthOpenY —— 口型同步
 *   3) 鼠标跟随视线（接管 updateFocus，方向可用 ?fx ?fy 校正）
 *   4) 右键菜单 / 回车说话
 *
 * 关键教训（别改回去）：
 *   - 口型和视线都必须写在 internalModel.updateFocus() 里：它每帧必调、且在 model.update() 之前。
 *   - 写在 app.ticker 或帧外的 setParameterValueById 会被 loadParameters() 冲掉。
 *   - 不能直接调 model.focus(x,y)：它要世界坐标像素，且会把方向归一化成长度 1（永远打满）。
 *   - 本模型 ParamAngleX/Y 与屏幕方向可能需要取负，用 ?fx= / ?fy= 现场试。
 */
const app = new PIXI.Application({
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  resizeTo: window,
});
document.getElementById("stage").appendChild(app.view);

/* ------------------------------ 状态 ------------------------------ */
const gaze = { tx: 0, ty: 0, x: 0, y: 0 };
const mouth = { target: 0, value: 0, max: 0.85, gain: 4.6, floor: 0.012 };

let model = null;

/* ------------------------------ 启动 ------------------------------ */
async function main() {
  // 各部分都在 renderer/*.js；这里只负责加载模型并把界面/输入串起来
  if (typeof Live2DCubismCore === "undefined") {
    const e = new Error("missing Live2D Cubism Core");
    e.assetMissing = true;
    throw e;
  }
  try {
    await loadModel();
  } catch (e) {
    e.assetMissing = true;
    throw e;
  }
  // 启动自检：TTS / ASR 只在确定起不来时提示（mac 用 say 兜底会提示一句）
  checkServicesOnBoot();

  // 復習：只轮错题本（再点一次回每日）
  const rvBtn = document.getElementById("review");
  if (rvBtn) {
    rvBtn.addEventListener("click", async () => {
      bargeIn();                               // 用户点了復習：先停当前朗读
      if (chatMode === "pattern") { await patternToggleReview(); return; }
      // 先看错题本是否为空：空就只提示，不切换模式
      const pre = await window.pet.word({ action: "daily-info" }).then((x) => x && x.info).catch(() => null);
      if (pre && pre.pools && pre.pools.wrong === 0) {
        hud.classList.remove("gone");
        hudShow("错题本是空的", 1600);
        return;                                 // 不切换模式、不动卡片
      }

      const r = await window.pet.word({ action: "daily-toggle" });
      pendingModeSay = r.mode === "review" ? "たんご復習モード" : "たんごモード";
      if (pendingModeSay) preambleSay();
      const inf = await window.pet.word({ action: "daily-info" });
      refreshWordUI(inf && inf.info);
      hud.classList.remove("gone");
      hudShow(r.mode === "review" ? `復習：错题 ${r.wrongCount} 个` : "每日 20 词", 1500);
      dailyCard = null;
      await dailyNext(true);
    });
  }

  const nbBtn = document.getElementById("newbatch");
  if (nbBtn) nbBtn.addEventListener("click", () => {
    if (chatMode === "pattern") patternNewBatch();
    else dailyNewBatch();
  });

  initLevelUI();
  requestAnimationFrame(() => { alignLevelButtons(); alignBatchButtons(); });

  // 两个计数是常驻的，开机就把两组数据都拉一次，别等切模式
  if (window.pet && window.pet.word) {
    window.pet.word({ action: "daily-info" })
      .then((r) => { const i = r && r.info; if (i) setCount("wordSeen", i.tierSeen || 0, i.tierTotal || 0); })
      .catch(() => {});
  }
  if (window.pet && window.pet.pattern) {
    window.pet.pattern({ action: "info" })
      .then((r) => { const i = r && r.info; if (i) setCount("patternSeen", i.tierSeen || 0, i.tierTotal || 0); })
      .catch(() => {});
  }

  // 自检接口（排障/自动测试用）
  window.__pet = {
    model, sendChat,
    playExpressionFile: (file, holdMs) => (window.__playExpressionFile ? window.__playExpressionFile(file, holdMs) : Promise.resolve({ ok: false, error: "模型未就绪" })),
    playMotion: (group, index) => (window.__playMotion ? window.__playMotion(group, index) : Promise.resolve({ ok: false, error: "模型未就绪" })),
    dailyNext, dailySubmit, dailyNewBatch, patternNextCard, patternSubmit, patternNewBatch, patternToggleReview, refreshWordUI, showEcho, clearEcho, casualSay, setMode: (m) => setMode(m),
    get mode() { return chatMode; },
    get lastSay() { return { card: lastCardSay, spoken: lastSpoken }; },
    get convSubMode() { return convSubMode; },
    get card() { return dailyCard; },
    get patternCard() { return patternCard; },
    renderComposeReview: (t, r, footer, line) => renderComposeReview(t, r, footer, line),
    get busy() { return dailyBusy; },
    get chatBusy() { return chatBusy; },
    get queue() { return chatQueue.slice(); },
    get source() { return chatSource; },
    stopSpeech: () => stopSpeech(),
    bargeIn: () => bargeIn(),
    speakNow: (t) => runSpeech(() => speakNow(t)),
    get lastSpoken() { return lastSpoken; },
    get sayLog() { return sayLog.slice(); },
    get modeSay() { return pendingModeSay; },
    hudShow: (t, ms) => hudShow(t, ms),
    noteShow: (t) => noteShow(t),
    playing: () => !!(audioEl && !audioEl.paused),
    speechBusy: () => speechBusy,
    setMouth: (v) => { mouth.target = Math.max(0, Math.min(1, Number(v) || 0)); },
    pos: () => (audioEl ? audioEl.currentTime : 0),
    playAudio: (u) => playAudio(u),
    get hasAudio() { return !!audioEl; },
    recState: () => ({
      pending: recPending,
      active: !!rec,
      micOn: micEl.classList.contains("rec"),
      tracks: rec ? rec.stream.getAudioTracks().map((t) => t.readyState) : [],
    }),
    say: (t) => say(t),
    recTest: async (ms = 1500) => {
      await startRec(true);
      await new Promise((r) => setTimeout(r, ms));
      await finishRec();
      return "ok";
    },
    startRec: (f) => startRec(f),
    finishRec: () => finishRec(),
    cancelRec: () => cancelRec(),
  };


}

main().catch((e) => {
  const h = document.getElementById("hud");
  if (h) {
    h.classList.remove("gone");
    const assetHint = /Windows/i.test(navigator.userAgent)
      ? "%APPDATA%\\Nihonco\\assets"
      : "docs/ASSETS.md";
    h.textContent = e && e.assetMissing
      ? "缺少 Live2D 资源\n" + assetHint
      : "启动失败：" + (e && e.message ? e.message : e);
  }
  console.error("[main] 失败", e);
});
