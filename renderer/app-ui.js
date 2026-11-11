/* 应用层 UI：模式切换、档位菜单、按钮对齐
 *
 * 这些逻辑原来在 pet.js 的 main() 里（600 多行的初始化函数），按职责搬出来后：
 *   pet.js 只管「加载模型 + 绑定输入 + 导出 __pet」
 * 注意：本文件在加载时会绑定 resize / 档位按钮等监听（DOM 此时已就绪）。
 */
  /** 新規 / 復習 / 错题数 对齐到当前模式按钮（単語 或 例句）的正下方 */
  function alignBatchButtons() {
    const active = document.getElementById(chatMode === "pattern" ? "modePattern" : "modeWord");
    if (!active) return;
    const modesRect = modeBar.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    const right = Math.max(0, Math.round(modesRect.right - r.right));
    const nb = document.getElementById("newbatch");
    const rv = document.getElementById("review");
    if (nb) nb.style.right = right + "px";
    if (rv) rv.style.right = right + "px";
  }
  window.addEventListener("resize", alignBatchButtons);

  // 四个按钮，点击直接切（不循环）
  /** 按「该模式当前是不是復習中」给提示语 */
  function modePromptFor(id) {
    if (id === "word") return wordMode === "review" ? "たんご復習モード" : "たんごモード";
    if (id === "pattern") return patternMode === "review" ? "れいぶん復習モード" : "れいぶんモード";
    const m = MODES.find((x) => x.id === id);
    return m ? m.say : null;
  }

  alignUI = () => { alignBatchButtons(); alignLevelButtons(); };
  // 页面重载/窗口尺寸变化后再对齐一次（模型改位置走的是 reload）
  window.addEventListener("load", () => { [0, 200, 600].forEach((ms) => setTimeout(alignUI, ms)); });
  window.addEventListener("resize", () => alignUI());
  [200, 800].forEach((ms) => setTimeout(alignUI, ms));

  async function setMode(id) {
    if (typeof dismissWordPop === "function") dismissWordPop();
    const m = MODES.find((x) => x.id === id) || MODES[0];
    const prevMode = chatMode;
    const wasTalk = isTalkMode(prevMode);
    chatMode = m.id;
    // 会話 ↔ 解説 仍属同一类；只有进出「会話/解説」才作废在途搭话
    if (wasTalk !== isTalkMode(m.id)) casualSeq += 1;
    for (const el of modeBar.querySelectorAll(".mode-btn[data-mode]")) {
      el.classList.toggle("active", el.dataset.mode === m.id);
    }
    if (m.id === "conv" || m.id === "teach") convSubMode = m.id;   // 记住会话/解说

    // 从单词/例句切回会话/解説：卡片消失（不恢复旧会话）；回显不在这里动，仍按它自己的规则
    if ((prevMode === "word" || prevMode === "pattern") && (m.id === "conv" || m.id === "teach")) {
      replyEl.classList.add("gone");
      if (replyTextEl) replyTextEl.innerHTML = "";   // 只清正文，别删 #replay 按钮
      noteEl.classList.add("gone");
      noteEl.innerHTML = "";
      lastConvSay = "";
      syncReplayBtn();
    }
    if (mToggle) {
      mToggle.dataset.mode = convSubMode;                 // 进入单词/例文时保持不变
      mToggle.textContent = convSubMode === "teach" ? "解説" : "会話";
      mToggle.classList.toggle("active", m.id === "conv" || m.id === "teach");
    }
    hud.classList.remove("gone");
    hudShow(m.tip, 1800);

    bargeIn();                        // 用户点了按钮：打断当前朗读并清空队列
    dailySeq += 1;                    // 作废在途的抽卡/朗读流程（旧流程不许再出声）

    // 切到单词/例句前先同步一下后端的復習状态，提示语才不会说错
    if (m.id === "word" && window.pet && window.pet.word) {
      try {
        const r = await window.pet.word({ action: "daily-info" });
        if (r && r.info) { wordMode = r.info.mode || wordMode; refreshWordUI(r.info); }
      } catch (e) {}
    } else if (m.id === "pattern" && window.pet && window.pet.pattern) {
      try {
        const r = await window.pet.pattern({ action: "info" });
        if (r && r.info) { patternMode = r.info.mode || patternMode; refreshPatternUI(r.info); }
      } catch (e) {}
    }

    // 从其它模式进入单词/例句时，默认回每日；不要在启动后意外沿用上次的復習
    if ((m.id === "word" || m.id === "pattern") && prevMode !== m.id) {
      try {
        if (m.id === "word") {
          const cur = await window.pet.word({ action: "daily-info" });
          if (cur && cur.info && cur.info.mode === "review") {
            await window.pet.word({ action: "daily-toggle" });
            const now = await window.pet.word({ action: "daily-info" });
            if (now && now.info) { wordMode = now.info.mode || "daily"; refreshWordUI(now.info); }
          }
        } else {
          const cur = await window.pet.pattern({ action: "info" });
          if (cur && cur.info && cur.info.mode === "review") {
            await window.pet.pattern({ action: "toggle" });
            const now = await window.pet.pattern({ action: "info" });
            if (now && now.info) { patternMode = now.info.mode || "daily"; refreshPatternUI(now.info); }
          }
        }
      } catch (e) {}
    }

    // 切换模式时念一句很短的提示（同一模式重复点就不念了）
    // 注意：不在这里等播放，界面先切、卡片先出，提示音在出卡后再念
    pendingModeSay = (m.id !== prevMode) ? modePromptFor(m.id) : null;
    input.placeholder = "按住 🎤 说话，或直接打字回车";
    // 切模式不再清空会话历史：切去练单词再回来，她应该还记得刚才聊的事
    // （想主动开新会话时可调用 window.pet.chatReset()）
    const nb = document.getElementById("newbatch");
    if (nb) nb.dataset.tip = m.id === "pattern" ? "下一批 5 个例文" : "下一批 20 个单词";
    const rvBtnEl = document.getElementById("review");
    if (rvBtnEl) rvBtnEl.dataset.tip = m.id === "pattern" ? "只复习例文错题本" : "只复习单词错题本";
    applyModeUI(m.id);
    syncLevels();
    syncReplayBtn();
    if (m.id === "word") {
      window.pet.word({ action: "daily-info" })
        .then((x) => { if (x && x.info) refreshWordUI(x.info); })
        .catch(() => {});
      dailyNext(true);
    } else if (m.id === "pattern") {
      showPatternButtons(true);
      patternNextCard(true);
    } else {
      // 会話 / 解説 不出卡，提示音就地念（不阻塞界面）
      preambleSay();
    }
  }
  // 会話 / 解説 合并成一个切换按钮
  const mToggle = document.getElementById("mtoggle");
  if (mToggle) {
    mToggle.addEventListener("click", () => {
      if (chatMode === "word" || chatMode === "pattern") {
        setMode(convSubMode);                   // 从单词/例文回来：还原会話 or 解説
      } else {
        setMode(chatMode === "conv" ? "teach" : "conv");
      }
    });
  }
  for (const el of modeBar.querySelectorAll(".mode-btn[data-mode]")) {
    if (el.id === "mtoggle") continue;
    el.addEventListener("click", () => setMode(el.dataset.mode));
  }

  // 设置窗口改了配置 → 桌宠这边立刻跟上（不用重启）
  if (window.pet && window.pet.onConfigChanged) {
    window.pet.onConfigChanged((cfg) => {
      if (cfg && cfg.level) syncLevels();
    });
  }
  if (window.pet && window.pet.onPreviewReady) {
    window.pet.onPreviewReady(async () => {
      try { await playAudio('/.voice/say.wav?t=' + Date.now()); } catch (e) {}
    });
  }

  // 再读一遍：重播她最近说的那句（会话 / 解说 / 单词 都适用）
  const replayBtn = document.getElementById("replay");
  if (replayBtn) {
    replayBtn.addEventListener("mousedown", (e) => e.preventDefault());   // 不抢焦点
    replayBtn.addEventListener("click", async () => {
      const text = replayTarget();
      if (!text) return;
      if (replayBtn.classList.contains("busy")) return;
      replayBtn.classList.add("busy");
      try {
        const { url, engine } = await window.pet.speak(text);
        lastSpoken = text; syncReplayBtn();      // 与其它朗读路径保持一致
        lastTtsEngine = engine || "say";
        await playAudio(url);
      } catch (e) {
        hudShow("重播失败", 1500);
      } finally {
        replayBtn.classList.remove("busy");
      }
    });
  }

  /* ---------------- 右下角拖拽改窗口大小 ---------------- */
  // 两个角都能拖：右下（br）/ 左上（tl）。都保持右下角固定，往该角外侧拖变大。
  const resizeHandles = [...document.querySelectorAll("#resizeHandle, #resizeHandleTL")];
  if (resizeHandles.length && window.pet && window.pet.resize) {
    for (const handle of resizeHandles) {
      const corner = handle.dataset.corner === "tl" ? "tl" : "br";
      let dragging = false;
      let raf = 0;
      let pending = null;
      const flush = () => {
        raf = 0;
        if (!pending) return;
        window.pet.resize(pending.x, pending.y, corner);
        pending = null;
      };
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dragging = true;
        pending = null;
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      });
      handle.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        // 每帧最多发一次 IPC：pointermove 一秒能到 120 次，逐条 setBounds 没必要
        pending = { x: e.screenX, y: e.screenY };
        if (!raf) raf = requestAnimationFrame(flush);
      });
      const stop = () => {
        if (!dragging) return;
        dragging = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        flush();                       // 补最后一帧，避免松手时少一截
        window.pet.resizeEnd();
      };
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    }
  }

  /* ---------------- HUD 宽度：只到模式栏左边，长句换行但不被按钮遮住 ---------------- */
  function fitHud() {
    // #modes 是整条容器（左边贴 window），要取里面第一个按钮的左边界
    const btns = [...document.querySelectorAll("#modes .mode-btn")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);      // 隐藏模式的按钮 rect 是 0，不能算
    const left = btns.length ? Math.min(...btns.map((r) => r.left)) : window.innerWidth * 0.6;
    hud.style.maxWidth = Math.max(72, Math.floor(left - 12)) + "px";
  }
  fitHud();
  // 模式栏是异步渲染的：布局稳定后再量一次，否则会按太窄的宽度算
  requestAnimationFrame(fitHud);
  [0, 300, 1200].forEach((ms) => setTimeout(fitHud, ms));
  window.addEventListener("resize", fitHud);
  window.addEventListener("load", fitHud);
  // 模式栏会随模式切换改宽度（単語/例文带进度数字），跟着重量
  try {
    const modesEl = document.getElementById("modes");
    if (modesEl && window.ResizeObserver) new ResizeObserver(fitHud).observe(modesEl);
  } catch (e) {}

  /* ---------------- 窗口内快捷键（设置里可改） ----------------
   * 只在桌宠窗口聚焦时生效，所以可以只是单个字母；和全局快捷键互不干扰。 */
  let keyMap = {};
  let shortcutsEnabled = true;
  let recAutoStopSec = 1.2;
  const loadShortcuts = async () => {
    try {
      const r = await window.pet.shortcuts();
      keyMap = (r && r.local) || {};
      shortcutsEnabled = !(r && r.enabled === false);
      if (r && Number.isFinite(Number(r.autoStopSec))) recAutoStopSec = Number(r.autoStopSec);
    } catch (e) {}
  };
  loadShortcuts();
  if (window.pet && window.pet.onShortcutsChanged) window.pet.onShortcutsChanged(loadShortcuts);

  /** 全局快捷键：开始 / 结束录音（和「按住空格」等价，但是切换式） */
  async function toggleRec() {
    if (rec) { finishRec(); return; }
    bargeIn();
    micEl.classList.add("rec");
    const ok = await startRec(true, { autoStop: true, autoStopMs: recAutoStopSec * 1000 })
      .catch((err) => { recError(err); return false; });
    if (!ok) { micEl.classList.remove("rec", "busy"); return; }
    hud.classList.remove("gone");
    hudShow(`录音中…\n${recAutoStopSec}秒后发送`, 0);
  }

  const runShortcut = (id) => {
    if (id === "conv") return setMode("conv");
    if (id === "word") return setMode("word");
    if (id === "pattern") return setMode("pattern");
    if (id === "reread") { const b = document.getElementById("replay"); if (b) b.click(); return; }
    if (id === "mute") return toggleSpeechMute();
  };

  window.addEventListener("keydown", (e) => {
    if (!shortcutsEnabled) return;                        // 设置里关掉了
    if (e.ctrlKey || e.metaKey || e.altKey) return;      // 窗口内快捷键不带修饰键
    const tok = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    // 输入框聚焦时只放行「不产生文字」的键（功能键等），否则会抢掉打字
    if (isTyping() && tok.length === 1) return;
    const hit = Object.entries(keyMap).find(([, k]) => k === tok);
    if (!hit) return;
    e.preventDefault();
    runShortcut(hit[0]);
  });

  if (window.pet && window.pet.onRecToggle) window.pet.onRecToggle(toggleRec);
  if (window.pet && window.pet.onMuteToggle) window.pet.onMuteToggle(toggleSpeechMute);

  // 设置按钮：打开设置窗口
  const settingsBtn = document.getElementById("settings");
  if (settingsBtn) {
    settingsBtn.addEventListener("mousedown", (e) => e.preventDefault());
    settingsBtn.addEventListener("click", () => {
      if (window.pet && window.pet.openSettings) window.pet.openSettings();
    });
  }

  // 话筒左侧：语音识别语言切换（日本語 / 中文）
  const langEl = document.getElementById("lang");
  function paintLang() {
    if (!langEl) return;
    langEl.textContent = speakLang === "zh" ? "中国語" : "日本語";
    langEl.classList.toggle("zh", speakLang === "zh");
  }
  paintLang();
  if (langEl) {
    langEl.addEventListener("mousedown", (e) => e.preventDefault());
    langEl.addEventListener("click", () => {
      speakLang = speakLang === "ja" ? "zh" : "ja";
      paintLang();
      hud.classList.remove("gone");
      hudShow(speakLang === "zh" ? "语音识别\n中国語" : "语音识别\n日本語", 1200);
    });
  }

  // 打字时把窗口降到输入法之下（但仍高于其他应用）
  input.addEventListener("focus", () => { if (window.pet.setTyping) window.pet.setTyping(true); });
  input.addEventListener("blur", () => { if (window.pet.setTyping) window.pet.setTyping(false); });

  // 输入法组词期间（打中文/日文时敲拼音、选词）的回车不属于"发送"
  let composing = false;
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { setTimeout(() => { composing = false; }, 0); });

  input.addEventListener("keydown", (e) => {
    // isComposing / keyCode 229 = 输入法正在处理这次按键
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      const v = input.value;
      input.value = "";
      // 翻译模式优先于单词/例句：任何输入都只翻译，不提交答案
      if (speakLang === "zh") {
        chatSource = "text";
        if (v.trim()) { clearEcho(); sendChat(v); }
        return;
      }
      if (chatMode === "word") {
        const t = v.trim();
        if (/^(新規|换一批|new)$/i.test(t)) { dailyNewBatch(); return; }
        dailySubmit(t);          // 空字符串 = 空提交 = 跳过
        return;
      }
      if (chatMode === "pattern") {
        patternSubmit(v.trim());
        return;
      }
      chatSource = "text";
      if (v.trim()) {
        clearEcho();
        sendChat(v);
      }
    } else if (e.key === "Escape") {
      input.blur();
    }
  });

  if (window.pet && window.pet.onFocusInput) window.pet.onFocusInput(() => input.focus());

  /* --- 麦克风：按住说话 --- */
  /* --------------- 麦克风按钮：按住说话，向上划取消 --------------- */
  let micStartX = 0;
  let micStartY = 0;
  let micCancel = false;
  const CANCEL_DIST = 40;     // 任意方向移动超过这个距离就算"划走"

  micEl.addEventListener("pointerdown", async (e) => {
    e.preventDefault();
    if (micEl.classList.contains("busy")) return;
    try { micEl.setPointerCapture(e.pointerId); } catch (_) {}
    micStartX = e.clientX;
    micStartY = e.clientY;
    micCancel = false;
    bargeIn();                       // 她还在说就先打断，避免录进她的声音
    micEl.classList.add("rec");
    try {
      const ok = await startRec();
      // 等权限/开流期间就被松手或切走了：别再补一发"录音中"，否则 HUD 永远停在那一行
      if (!ok) { micEl.classList.remove("rec", "busy"); return; }
      hud.classList.remove("gone");
      hudShow("录音中…\n松手发送", 0);
    } catch (err) {
      micEl.classList.remove("rec");
      console.log("[rec] 麦克风打不开:", err); hudShow("麦克风打不开", 3000);
    }
  });

  // 任意方向划走超过阈值 → 进入"松手取消"；划回来 → 恢复
  micEl.addEventListener("pointermove", (e) => {
    if (!rec) return;
    const dx = e.clientX - micStartX;
    const dy = e.clientY - micStartY;
    const dist = Math.hypot(dx, dy);
    if (!micCancel && dist > CANCEL_DIST) {
      micCancel = true;
      micEl.classList.add("cancel");
      hud.classList.remove("gone");
      hudShow("松手取消", 0);
    } else if (micCancel && dist < CANCEL_DIST * 0.55) {
      micCancel = false;
      micEl.classList.remove("cancel");
      hudShow("录音中…\n松手发送", 0);
    }
  });

  micEl.addEventListener("pointerup", (e) => {
    try { micEl.releasePointerCapture(e.pointerId); } catch (_) {}
    micEl.classList.remove("cancel");
    if (micCancel) { micCancel = false; cancelRec(); }
    else finishRec();
  });

  // 系统打断（来电、切窗口等）
  micEl.addEventListener("pointercancel", () => {
    micCancel = false;
    micEl.classList.remove("cancel");
    cancelRec();
  });

  /* ---------------- 空格键对讲：按住说话，松开发送，Esc 取消 ---------------- */
  const isTyping = () => {
    const el = document.activeElement;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  };

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.repeat) { e.preventDefault(); return; }   // 忽略自动重复
    if (e.code === "Space" && !isTyping()) {
      if (!rec && !spaceHeld) {
        e.preventDefault();
        spaceHeld = true;
        bargeIn();                    // 她还在说就打断（打断即说话），并清空排队语音
        micEl.classList.add("rec");
        startRec(true).then((ok) => {
          if (!ok) { micEl.classList.remove("rec", "busy"); return; }
          hud.classList.remove("gone");
          hudShow("录音中…\n松手发送", 0);
        }).catch((err) => recError(err));
      }
      return;
    }
    if (e.key === "Escape" && rec) {
      e.preventDefault();
      spaceHeld = false;
      cancelRec();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" && spaceHeld) {
      e.preventDefault();
      spaceHeld = false;
      finishRec();   // 没拿到流也会进入，标记 recAbort 由 startRec 收尾
    }
  });

  // 切走窗口时丢弃正在录的内容，避免"按着空格切到别的应用"导致一直录
  window.addEventListener("blur", () => {
    spaceHeld = false;
    if (rec) cancelRec();
    else if (recPending) recAbort = true;   // 还在等 getUserMedia 也要取消
  });

  // 三个档位：全局（会話下面）、单词、例句；都用同一个下拉菜单
  const LEVELS_UI = ["N5", "N4", "N3", "N2", "N1"];
  const gLevelEl = document.getElementById("gLevel");
  const wordLevelEl = document.getElementById("wordLevel");
  const patternLevelEl = document.getElementById("patternLevel");
  const levelMenu = document.getElementById("levelMenu");
  let levelTarget = "global";          // 当前下拉在改谁
  let patternAvailable = ["N5"];       // 例句有数据的档位

  const LEVEL_ORDER_UI = ["N5", "N4", "N3", "N2", "N1"];

  /** 往 N1 方向 = level up，往 N5 方向 = level down */
  function levelSay(from, to) {
    const a = LEVEL_ORDER_UI.indexOf(String(from || "").toUpperCase());
    const b = LEVEL_ORDER_UI.indexOf(String(to || "").toUpperCase());
    if (a < 0 || b < 0 || a === b) return null;
    return b > a ? "レベルアップ" : "レベルダウン";
  }

  function markLevelMenu(cur) {
    if (!levelMenu) return;
    for (const it of levelMenu.querySelectorAll(".lv-item")) {
      const lv = it.dataset.lv;
      it.classList.toggle("active", lv === cur);
      const disabled = levelTarget === "pattern" && !patternAvailable.includes(lv);
      it.classList.toggle("disabled", disabled);
      it.style.opacity = disabled ? ".35" : "";
    }
  }

  function closeLevelMenu() { if (levelMenu) levelMenu.classList.add("gone"); }

  function openLevelMenu(btn, target, cur) {
    if (!levelMenu || !btn) return;
    levelTarget = target;
    markLevelMenu(cur);
    levelMenu.classList.remove("gone");         // 先显示才能量宽度

    const place = () => {
      let r = btn.getBoundingClientRect();
      // 初次启动时按钮可能还没完成定位，拿到 0×0；用同一档位/模式栏兜底
      if (!r.width || !r.height || r.left < 8 || r.top < 0) {
        const anchor = target === "word" ? wordLevelEl : target === "pattern" ? patternLevelEl : gLevelEl;
        const ar = anchor && anchor.getBoundingClientRect();
        if (ar && ar.width && ar.height) r = ar;
        else {
          const mr = modeBar && modeBar.getBoundingClientRect();
          if (mr && mr.width) r = { left: mr.left, bottom: mr.bottom, width: mr.width, height: 0 };
        }
      }
      const w = levelMenu.offsetWidth;
      const margin = 8;
      // 贴右边时改成右对齐，避免被窗口截断
      const left = Math.min(Math.max(margin, r.left || margin), window.innerWidth - w - margin);
      const top = (r.bottom || margin) + 6;
      levelMenu.style.left = `${Math.round(left)}px`;
      levelMenu.style.top = `${Math.round(top)}px`;
      levelMenu.style.bottom = "auto";
    };
    place();
    requestAnimationFrame(place);
  }

  /** 把三个档位按钮 / 进度文字对齐到各自模式按钮下方 */
  let alignRetry = null;
  function alignLevelButtons() {
    const modesRect = modeBar.getBoundingClientRect();
    // 模型换位置会重载页面：按钮还没排好版时量出来是 0，会把 N5 甩到左上角。
    // 量不到就等下一帧再试，绝不拿 0 去定位。
    const conv0 = document.getElementById("mtoggle");
    if (!conv0 || conv0.offsetWidth === 0 || modesRect.width === 0) {
      clearTimeout(alignRetry);
      alignRetry = setTimeout(alignLevelButtons, 120);
      return;
    }
    const rel = (el) => (el ? Math.round(modesRect.right - el.getBoundingClientRect().right) : 0);
    const conv = document.getElementById("mtoggle");
    const word = document.getElementById("modeWord");
    const pat = document.getElementById("modePattern");

    if (gLevelEl && conv) {
      gLevelEl.style.left = `${Math.round(conv.getBoundingClientRect().left - modesRect.left)}px`;
      gLevelEl.style.right = "auto";
      gLevelEl.style.top = "36px";
      gLevelEl.style.width = `${conv.offsetWidth}px`;   // 和「会話」同宽
      gLevelEl.style.visibility = "visible";             // 量准了才显示
    }
    for (const [wrapId, btn] of [["wordLvWrap", word], ["patternLvWrap", pat]]) {
      const wrap = document.getElementById(wrapId);
      if (!wrap || !btn) continue;
      wrap.style.left = "auto";
      wrap.style.right = `${rel(btn)}px`;
      wrap.style.top = "108px";
      const lvBtn = wrap.querySelector(".lv-btn");
      if (lvBtn) lvBtn.style.width = "38px";   // 档位按钮固定窄宽（N5 两个字符够用）
    }
  }
  window.addEventListener("resize", alignLevelButtons);

  /** 初始摆放：档位按钮定位 + 按当前模式显隐 */
  function initLevelUI() {
    applyModeUI();
    syncLevels();
  }

  async function syncLevels() {
    try {
      const r = await window.pet.level({ action: "levels" });
      if (!r) return;
      patternAvailable = r.patternAvailable || ["N5"];
      if (gLevelEl) gLevelEl.textContent = r.global || "N5";
      if (wordLevelEl) wordLevelEl.textContent = r.word || "N5";
      if (patternLevelEl) patternLevelEl.textContent = r.pattern || "N5";
      if (levelElHidden(r)) return;
    } catch (e) {}
  }
  function levelElHidden() { return false; }

  for (const [btn, target] of [[gLevelEl, "global"], [wordLevelEl, "word"], [patternLevelEl, "pattern"]]) {
    if (!btn) continue;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!levelMenu.classList.contains("gone") && levelTarget === target) { closeLevelMenu(); return; }
      openLevelMenu(btn, target, btn.textContent.trim());
    });
  }

  if (levelMenu) {
    levelMenu.addEventListener("click", async (e) => {
      const item = e.target.closest(".lv-item");
      if (!item || item.classList.contains("disabled")) return;
      e.stopPropagation();
      const lv = item.dataset.lv;
      closeLevelMenu();
      try {
        const fromBtn = levelTarget === "word" ? wordLevelEl : levelTarget === "pattern" ? patternLevelEl : gLevelEl;
        const from = fromBtn && fromBtn.textContent.trim();
        bargeIn();                              // 用户操作：先停当前朗读
        dailySeq += 1;                          // 作废在途的抽卡/朗读流程
        const say = levelSay(from, lv);
        if (say) { pendingModeSay = say; preambleSay(); }   // 提示音立刻排上，不等后端

        if (levelTarget === "word") {
          const r = await window.pet.level({ action: "set-word", level: lv });
          hudShow(`单词水平\n${r.word || lv}`, 1200);
          dailyCard = null;
          await syncLevels();
          // 换档 = 退出復習：按钮回到「復習」，后端也切回每日
          const inf = await window.pet.word({ action: "daily-info" }).then((x) => x && x.info).catch(() => null);
          if (inf && inf.mode === "review") {
            await window.pet.word({ action: "daily-toggle" });
          }
          wordMode = "daily";
          const rvEl = document.getElementById("review");
          if (rvEl) { rvEl.classList.remove("active"); setReviewLabel("復習"); }
          await dailyNext(true);
        } else if (levelTarget === "pattern") {
          const r = await window.pet.level({ action: "set-pattern", level: lv });
          if (r && r.ok === false) { hudShow(r.reason || "这档还没有例文", 1800); return; }
          hudShow(`例文水平\n${r.pattern || lv}`, 1200);
          patternCard = null;
          await syncLevels();
          // 换档 = 退出復習
          const inf2 = await window.pet.pattern({ action: "info" }).then((x) => x && x.info).catch(() => null);
          if (inf2 && inf2.mode === "review") {
            await window.pet.pattern({ action: "toggle" });
          }
          patternMode = "daily";
          const rvEl2 = document.getElementById("review");
          if (rvEl2) { rvEl2.classList.remove("active"); setReviewLabel("復習"); }
          await patternNextCard(true);
        } else {
          await window.pet.level({ action: "set", level: lv });
          await syncLevels();
          hudShow(`全局水平\n${lv}`, 1200);
        }
      } catch (err) {}
    });
  }

