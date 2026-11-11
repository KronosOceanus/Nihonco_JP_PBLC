/* 模型加载与取景：Live2DModel + 半身取景 + 视线/口型写入点
 *
 * 关键：口型与视线必须写在 internalModel.updateFocus() 里（每帧必调、在 model.update() 之前），
 * 写在 ticker 里会被 loadParameters() 冲掉。方向用 ?fx / ?fy 校正。
 */
async function loadModel() {
  model = await PIXI.live2d.Live2DModel.from(MODEL_URL, { autoHitTest: false, autoFocus: false });
  app.stage.addChild(model);
  model.interactive = false;
  model.eventMode = "none";

  /* 取景：只做半身（头到大腿）。按「画布高度 × f」定缩放，画布顶端贴窗口顶端，
   * 下方裁掉；mx 控制水平位置，my 控制上下略微偏移。 */
  const fit = () => {
    const ih = model.internalModel.originalHeight || model.height;
    const w = window.innerWidth;
    const h = window.innerHeight - 34;
    const F = Number(q.get("f")) || 2.4;
    const iw = model.internalModel.originalWidth || model.width;
    const base = Math.min((w * 0.96) / iw, (h * 0.94) / ih);
    const s = base * F;
    model.anchor.set(0.5, 0);
    model.scale.set(s);
    model.x = w * (Number(q.get("mx")) || 0.5);
    model.y = h * (Number(q.get("my")) || 0);
  };

  fit();
  window.addEventListener("resize", fit);
  hud.classList.add("gone");          // 模型已就绪，撤掉「加载模型中…」

  /* --- 渲染节流：前台活动 60 / 空闲 36 / 失焦可见 36 / 隐藏暂停 --- */
  const FPS_ACTIVE = 60, FPS_IDLE = 36, FPS_UNFOCUSED = 36, IDLE_MS = 3000;
  let focused = true;               // showInactive 下 document.hasFocus() 可能一开始就是 false
  let hidden = !!document.hidden;
  let tickerPaused = false;
  let lastActiveAt = performance.now();
  let motionUntil = 0;

  function audioBusy() {
    try { return typeof isAudioPlaying === "function" && isAudioPlaying(); } catch (e) { return false; }
  }

  function desiredFPS() {
    if (hidden) return 0;
    if (audioBusy() || performance.now() < motionUntil) return FPS_ACTIVE;
    if (!focused) return FPS_UNFOCUSED;
    return performance.now() - lastActiveAt < IDLE_MS ? FPS_ACTIVE : FPS_IDLE;
  }

  function applyFPS() {
    const fps = desiredFPS();
    if (fps === 0) {
      if (!tickerPaused) { app.ticker.stop(); tickerPaused = true; }
      return;
    }
    if (tickerPaused) { app.ticker.start(); tickerPaused = false; }
    if (app.ticker.maxFPS !== fps) app.ticker.maxFPS = fps;
  }

  function wakeActive() {
    lastActiveAt = performance.now();
    applyFPS();
  }

  function activeFor(ms) {
    motionUntil = Math.max(motionUntil, performance.now() + Math.max(0, Number(ms) || 0));
    wakeActive();
  }

  window.addEventListener("pointermove", wakeActive, { passive: true });
  window.addEventListener("pointerdown", wakeActive, { passive: true });
  window.addEventListener("keydown", wakeActive, { passive: true });
  window.addEventListener("focus", () => { focused = true; wakeActive(); });
  window.addEventListener("blur", () => { focused = false; applyFPS(); });
  document.addEventListener("visibilitychange", () => {
    hidden = !!document.hidden;
    if (!hidden) focused = document.hasFocus();
    applyFPS();
  });
  window.addEventListener("nihonco:audio-start", wakeActive);
  window.addEventListener("nihonco:audio-end", applyFPS);
  setInterval(applyFPS, 500);
  app.ticker.maxFPS = FPS_ACTIVE;
  applyFPS();

  /* 有些模型把「水印」做成一个开关参数（默认为 0 = 显示）。
   * 作者说明里写了可以在设置里关掉，所以这里读同目录 水印.exp3.json 的参数 id，
   * 每帧写成 1（即作者定义的「关闭水印」状态）。 */
  let wmIds = [];
  if (q.get("watermark") !== "0") {
    try {
      const dir = MODEL_URL.slice(0, MODEL_URL.lastIndexOf("/"));
      const r = await fetch("/" + dir + "/" + encodeURIComponent("水印") + ".exp3.json");
      if (r.ok) {
        const j = await r.json();
        wmIds = (j.Parameters || []).map((x) => x.Id).filter(Boolean);
      }
    } catch (e) { /* 没有水印文件就跳过 */ }
  }

  /* --- 表情：右键菜单按文件触发；不做语义映射 --- */
  let expression = null;
  async function playExpressionFile(file, holdMs = 3000) {
    try {
      const dir = MODEL_URL.slice(0, MODEL_URL.lastIndexOf("/"));
      const encoded = String(file || "").split("/").map(encodeURIComponent).join("/");
      const r = await fetch("/" + dir + "/" + encoded);
      if (!r.ok) throw new Error(`expression ${file} HTTP ${r.status}`);
      const j = await r.json();
      const params = (j.Parameters || [])
        .map((x) => ({ id: String(x.Id || ""), value: Number(x.Value) || 0, blend: x.Blend || "" }))
        .filter((x) => x.id);
      if (!params.length) throw new Error("expression 没有参数");
      expression = { file, params, start: performance.now(), holdMs, fadeMs: 260 };
      activeFor(holdMs);
      return { ok: true, file, count: params.length };
    } catch (e) {
      expression = null;
      return { ok: false, error: e.message };
    }
  }

  /* --- 视线/口型：唯一可靠的写入点 --- */
  const im = model.internalModel;
  im.updateFocus = function () {
    const cm = this.coreModel;

    gaze.x += (gaze.tx - gaze.x) * 0.12;
    gaze.y += (gaze.ty - gaze.y) * 0.12;
    const ax = FLIP_X * gaze.x;
    const ay = FLIP_Y * gaze.y;

    mouth.value += (mouth.target - mouth.value) * (mouth.target > mouth.value ? 0.55 : 0.25);

    try {
      cm.setParameterValueById("ParamAngleX", ax * 30);
      cm.setParameterValueById("ParamAngleY", ay * 30);
      cm.setParameterValueById("ParamEyeBallX", ax);
      cm.setParameterValueById("ParamEyeBallY", ay);
      cm.setParameterValueById("ParamBodyAngleX", ax * 10);
      cm.setParameterValueById("ParamMouthOpenY", mouth.value);
      for (const id of wmIds) cm.setParameterValueById(id, 1);   // 1 = 去掉水印
      if (expression) {
        const elapsed = performance.now() - expression.start;
        const fadeIn = Math.min(1, elapsed / expression.fadeMs);
        const fadeOut = Math.min(1, Math.max(0, (expression.holdMs - elapsed) / expression.fadeMs));
        const w = Math.min(fadeIn, fadeOut);
        if (w <= 0) expression = null;
        else {
          for (const p of expression.params) {
            try {
              const cur = typeof cm.getParameterValueById === "function" ? cm.getParameterValueById(p.id) : 0;
              let v;
              if (p.blend === "Add") v = cur + p.value * w;
              else if (p.blend === "Multiply") v = cur * (1 + (p.value - 1) * w);
              else v = cur * (1 - w) + p.value * w;
              cm.setParameterValueById(p.id, v);
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  };

  /* --- 交互 --- */
  const updateTarget = (cx, cy) => {
    const nx = (cx / window.innerWidth) * 2 - 1;
    const ny = (cy / window.innerHeight) * 2 - 1;
    const len = Math.hypot(nx, ny) || 1;
    const d = Math.min(1, len);
    gaze.tx = (nx / len) * d;
    gaze.ty = (ny / len) * d;
  };
  window.addEventListener("pointermove", (e) => updateTarget(e.clientX, e.clientY));
  window.addEventListener("pointerleave", () => { gaze.tx = 0; gaze.ty = 0; });
  window.addEventListener("blur", () => { gaze.tx = 0; gaze.ty = 0; });

  function playMotion(group, index = 0) {
    try {
      activeFor(2200);
      im.motionManager.startMotion(String(group), Number(index) || 0, 3);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  window.__playExpressionFile = playExpressionFile;
  window.__playMotion = playMotion;

  app.view.addEventListener("pointerdown", () => {
    try { im.motionManager.startRandomMotion("TapBody"); } catch (e) {}
  });

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (window.pet && window.pet.menu) window.pet.menu();
  });

}
