/* 模式流程：会話/解説/単語/例文 的问答与判分
 *
 * 依赖：cards.js（渲染）、rec.js（录音）、speech.js（朗读）、state.js（状态）。
 */
async function sendChat(text, source) {
  const t = String(text || "").trim();
  if (!t) return;

  const src = source === "voice" || source === "text" ? source : chatSource;

  /* 中国语模式 = 翻译模式：所有输入都按中文原文处理，只回显+翻译。
   * 不进入对话/答题，也不改卡片；语音由 rec.js 先回显。 */
  if (speakLang === "zh") {
    hud.classList.add("gone");
    if (src === "text") showEcho(t, "zh", null, "text");
    return;
  }

  // 単語 / 例句模式里说话 = 口头作答（交给对应判定，而不是跑去聊天）
  if (chatMode === "word") { await dailySubmit(t); return; }
  if (chatMode === "pattern") { await patternSubmit(t); return; }
  bargeIn();                            // 用户说话/打字：清掉排队语音
  chatSource = src;                    // 本轮真正的来源（排队出队时也用它，而不是全局最新值）

  if (chatBusy) {
    // 正在出声 → 直接打断，继续处理这条（像真人对话）
    if (audioEl && !audioEl.paused) {
      bargeIn();
    } else {
      // 模型还在想（很快）→ 排队（连来源一起存，避免出队时被"最新来源"覆盖）
      chatQueue.push({ text: t, source: src });
      hud.classList.remove("gone");
      hudShow("稍等一下…", 1200);
      return;
    }
  }
  // 打字也要有"我说的那句"回显（和语音一致），便于对照她的回复
  if (src === "text") showEcho(t, null, null, "text");

  const my = ++turnId;
  if (!window.pet || !window.pet.chat) {
    showReply("", "需要在 Electron 里运行才能对话");
    return;
  }
  chatBusy = true;
  hud.classList.remove("gone");
  hudShow("思考中…", 0);
  try {
    // 不再有隐藏的「翻译模式」：中文/日语都走当前模式，气泡下方固定显示中日两行
    const r = await window.pet.chat({ text: t, mode: chatMode, source: src });
    if (my !== turnId) return;          // 已被更新的一轮取代，别覆盖新结果
    const turn = r.turn || {};
    // 追问单独成字段（next_question_ja），有就接到回复末尾
    const followUp = String(turn.next_question_ja || "").trim();
    const followUpZh = String(turn.next_question_zh || "").trim();
    const normQ = (s) => String(s || "").replace(/[\s。、！？!?…「」]/g, "");
    const nearQ = (a, b) => {
      const x = normQ(a), y = normQ(b);
      if (!x || !y) return false;
      if (x.includes(y) || y.includes(x)) return true;
      const grams = (s) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
      const gx = grams(x), gy = grams(y);
      if (!gx.size || !gy.size) return false;
      let hit = 0;
      for (const g of gx) if (gy.has(g)) hit++;
      return (2 * hit) / (gx.size + gy.size) >= 0.6;   // 近似重复：换个问法也算同一句
    };
    // 模型偶尔把追问也写进 reply_ja：完全相同或近似相同都不再拼一遍
    const dupJa = !!followUp && nearQ(turn.reply_ja, followUp);
    const spoken = followUp && !dupJa ? `${turn.reply_ja} ${followUp}`.trim() : String(turn.reply_ja || "");
    const dupZh = !!followUpZh && nearQ(turn.reply_zh, followUpZh);
    const shownZh = [turn.reply_zh, followUpZh && !dupZh ? followUpZh : ""].filter(Boolean).join(" ");
    // 会話/解説的回复不标振假名（只在卡片/例句上标）
    showReply(spoken, shownZh);
    showNote(turn);
    hud.classList.add("gone");
    if (spoken && my === turnId) {
      try {
        const { url, engine } = await window.pet.speak(spoken);
        lastSpoken = spoken; lastContentSay = spoken; lastConvSay = spoken; syncReplayBtn();
        lastTtsEngine = engine || "say";
        await playAudio(url);
      } catch (e) { /* 语音失败不影响文字 */ }
    }
  } catch (e) {
    showReply("", "对话失败：" + (e && e.message ? e.message : e));
  } finally {
    if (my === turnId) {
      chatBusy = false;
      const next = chatQueue.shift();
      if (next) sendChat(next.text, next.source);
    }
  }
}

/* ------------------------- 単語：每日默写 ------------------------- */

async function preambleSay() {
  if (!pendingModeSay) return;
  const text = pendingModeSay;
  pendingModeSay = null;
  await runSpeech(async () => {
    const ok = await speakNow(text, { replay: false });
    if (ok) {
      sayLog.push(text);
      await new Promise((r) => setTimeout(r, MODE_SAY_GAP_MS));
    }
  });
}

/** 朗读一张卡：词 + 例句（例句若已缓存则一起念） */
async function speakCard(c) {
  if (chatMode !== "word") return;          // 已经切走了，别再念单词卡
  const text = c.example ? `${c.ja}。${c.example}` : c.ja;
  lastCardSay = text;
  await runSpeech(() => speakNow(text, { pauseScale: 2.2 }));
}

/** 取下一张卡：卡片立即显示，例句随后补上 */
/* 注意：dailySeq / dailyBusy 是单词与例文两个模式共用的代际号——
 * 切模式会作废在途的抽卡（这是刻意的：同一时刻只该有一条朗读流程在跑）。
 * 若以后想让两个模式互不影响，这里要拆成两个计数器。 */
async function dailyNext(force = false) {
  if (!window.pet || !window.pet.word) return;
  if (dailyBusy && !force) return;      // 强制换批时可以打断上一次
  const my = ++dailySeq;                // 本次循环的序号
  dailyBusy = true;
  try {
    const r = await window.pet.word({ action: "daily-next" });
    if (my !== dailySeq) return;        // 已被更新的一批取代，丢弃旧结果
    const c = r && r.card;
    if (!c) {
      // 抽不到卡时先确认当前子模式（復習 / 每日），再决定提示与语音
      const inf = await window.pet.word({ action: "daily-info" })
        .then((x) => x && x.info).catch(() => null);
      if (inf) refreshWordUI(inf);
      const reviewing = (inf && inf.mode === "review") || wordMode === "review";
      const justFinished = reviewing && reviewHadWords;   // 刚才还有词，现在清空了
      if (justFinished) {
        reviewHadWords = false;
        try {
          const { url, engine } = await window.pet.speak("ぜんぶ復習おわったよ！すごいね。");
          lastSpoken = "ぜんぶ復習おわったよ！すごいね。";
          lastTtsEngine = engine || "say";
          await playAudio(url);
        } catch (e) {}
        hudShow("復習おわった！", 2500);
        noteShow("ぜんぶ復習おわったよ！\n（错题本已清空）");
      } else {
        hudShow(reviewing ? "错题本是空的" : "没有可用的词", 2000);
        if (!reviewing) noteShow("抽词失败（词表/批次可能为空）");   // 空错题本只提示 HUD，不动卡片
      }
      return;
    }
    renderCard(c);
    if (c.info) refreshWordUI(c.info);
    hud.classList.add("gone");
    // 例句缓存命中时后端已经把例句一起发来了：直接念，少一次往返
    if (c.example) {
      dailyCard = { ...c };
      syncReplayBtn();
      await preambleSay();
      await speakCard(dailyCard);
      return;
    }
    const ex = await window.pet.word({ action: "daily-example", word: c }).catch(() => null);
    if (my !== dailySeq) return;
    if (ex && ex.example && dailyCard && dailyCard.ja === c.ja) {
      dailyCard = { ...dailyCard, ...ex };
      renderCard({ ...dailyCard, stats: c.stats });
    }
    await preambleSay();
    await speakCard(dailyCard || c);
  } finally {
    if (my === dailySeq) dailyBusy = false;   // 旧循环不许解锁新的
  }
}

async function dailySubmit(text) {
  bargeIn();                       // 用户作答：清掉排队中的语音
  if (!dailyCard) { dailyNext(); return; }
  const c = dailyCard;
  const r = await window.pet.word({ action: "daily-check", word: c, text });
  const res = (r && r.result) || {};
  // 答完立刻刷新统计（按单词计数），保证下一张卡的"对/错"是最新的
  window.pet.word({ action: "daily-info" }).then((x) => {
    if (x && x.info) { refreshWordUI(x.info); if (dailyCard) dailyCard = { ...dailyCard, info: x.info }; }
  }).catch(() => {});
  replyEl.classList.remove("gone");
  noteEl.classList.remove("gone");

  // 空提交 = 跳过
  if (res.empty) {
    dailyCard = null;
    hudShow("跳过", 700);
    dailyNext(true);
    return;
  }

  if (res.finishedReview) {
    refreshWordUI({ mode: "daily", pools: { wrong: 0 } });
    try {
      const { url, engine } = await window.pet.speak("ぜんぶ復習おわったよ！すごいね。");
      lastTtsEngine = engine || "say";
      await playAudio(url);
    } catch (e) {}
    hudShow("復習おわった！", 2000);
  }

  if (res.justCompleted) {
    const st = res.stats || {};
    hudShow("今日のぶん\n完了！", 2500);
    noteShow([
      "这一批全部答过了",
      `对 ${st.right || 0} / 错 ${st.wrong || 0} / 跳 ${st.skip || 0}`,
      "点击【新規】下一批，否则当日循环",
    ].join("\n"));
    try {
      const { url, engine } = await window.pet.speak("きょうのぶん、おつかれさま！");
      lastTtsEngine = engine || "say";
      await playAudio(url);
    } catch (e) {}
    dailyCard = null;
    setTimeout(() => dailyNext(true), 300);
    return;
  }

  if (res.ok) {
    setReplyText(`✓ ${c.ja}（${c.kana}）`);
    dailyCard = null;
    // 并行：取夸奖句 + 预取下一张卡（不等例句）
    const [cheerRes, nextRes] = await Promise.all([
      window.pet.word({ action: "cheer" }).catch(() => null),
      window.pet.word({ action: "daily-next" }).catch(() => null),
    ]);
    const line = (cheerRes && cheerRes.line) || "せいかい！";
    noteShowHTML([
      res.stats ? `<span class="lbl">进度</span>对 ${res.stats.right} / 错 ${res.stats.wrong}` : "",
      `<span class="say">${escHtml(line)}</span>`,
    ].filter(Boolean).join("\n"));
    // 先说完夸奖，再换下一张
    try {
      const { url, engine } = await window.pet.speak(line);
      lastSpoken = line; syncReplayBtn();
      lastTtsEngine = engine || "say";
      await playAudio(url);
    } catch (e) {}
    const nc = nextRes && nextRes.card;
    if (nc) {
      renderCard(nc);
      const ex2 = await window.pet.word({ action: "daily-example", word: nc }).catch(() => null);
      if (ex2 && ex2.example && dailyCard && dailyCard.ja === nc.ja) {
        dailyCard = { ...dailyCard, ...ex2 };
        renderCard({ ...dailyCard, stats: nc.stats });
      }
      await speakCard(dailyCard || nc);
    } else {
      dailyNext();
    }
    return;
  }

  // 答错：显示正解 + 键盘拼写，并且用语音鼓励 + 念一遍正确读音
  setReplyText(`✗ 正解：${c.ja}（${c.kana}）`);
  const missRes0 = await window.pet.word({ action: "miss" }).catch(() => null);
  const line0 = (missRes0 && missRes0.line) || "おしい！";
  noteShowHTML([
    // 目标是纯假名、你写的是别的写法（汉字/异体）→ 「也算对」按钮放在「你的」那一行最右
    `<div class="alt-row"><span><span class="lbl">你的</span>${escHtml(text)}</span>${
      res.altCandidate ? `<button class="alt-accept">这个也算对（记住）</button>` : ""
    }</div>`,
    `<span class="lbl">键盘</span><span class="romaji">${escHtml(c.romaji)}</span>`,
    "—— 再打一次（空提交可跳过）",
    `<span class="say">${escHtml(line0)}</span>`,
  ].filter(Boolean).join("\n"));
  const altBtn = noteEl.querySelector(".alt-accept");   // 动态注入的按钮（用 class，scan 只查 #id）
  if (altBtn) {
    altBtn.addEventListener("click", async () => {
      altBtn.disabled = true;
      const r2 = await window.pet.word({ action: "daily-alt", word: c, text }).catch(() => null);
      if (r2 && r2.result && r2.result.ok) {
        await dailySubmit(text);          // 已记住该写法：按答对再走一遍
      } else {
        altBtn.disabled = false;
        hudShow("没记住", 1200);
      }
    });
  }
  try {
    // 「鼓励 + 正确读音」一起念，顺手把发音也教了
    const { url, engine } = await window.pet.speak(`${line0}。${c.kana}。`);
    lastSpoken = `${line0}。${c.kana}。`;
    lastTtsEngine = engine || "say";
    await playAudio(url);
  } catch (e) {}
}

/* ------------------------- 例句（句型）模式 ------------------------- */

/** 例句模式的进度与错题数（和单词模式同一套元素，换数据源） */
async function speakPatternCard(c) {
  if (!c) return;
  if (chatMode !== "pattern") return;       // 已经切走了，别再念例文卡
  const text = (c.probe && c.probe.ja) || c.pattern.replace(/〜/g, "");
  if (!text) return;
  lastCardSay = text;
  await runSpeech(() => speakNow(text, { pauseScale: 1.6 }));
}

async function patternNextCard(force = false) {
  if (!window.pet || !window.pet.pattern) return;
  if (dailyBusy && !force) return;
  const my = ++dailySeq;
  dailyBusy = true;
  try {
    const r = await window.pet.pattern({ action: "next" });
    if (my !== dailySeq) return;
    const c = r && r.card;
    if (!c) {
      const inf = await window.pet.pattern({ action: "info" }).then((x) => x && x.info).catch(() => null);
      if (inf) { patternMode = inf.mode; }
      if (patternMode === "review") {
        // 错题刚被清空 → 自动退回每日，并夸一句（和单词模式一致）
        patternReviewHadWords = false;
        try {
          await window.pet.pattern({ action: "toggle" });      // review → daily
        } catch (e) {}
        patternMode = "daily";
        const rv = document.getElementById("review");
        if (rv) { rv.classList.remove("active"); setReviewLabel("復習"); }
        hudShow("例文復習おわり", 2500);
        noteShow("ぜんぶ復習おわったよ！\n（例文错题本已清空）");
        try {
          const { url, engine } = await window.pet.speak("ぜんぶ復習おわったよ！すごいね。");
          lastSpoken = "ぜんぶ復習おわったよ！すごいね。";
          lastTtsEngine = engine || "say";
          await playAudio(url);
        } catch (e) {}
        await patternNextCard(true);
      } else {
        hudShow("没有可用的句型", 2000);
        noteShow("句型数据为空（data/patterns-n5.json）");
      }
      return;
    }
    renderPatternCard(c);
    window.pet.pattern({ action: "info" })
      .then((x) => { if (x && x.info) refreshPatternUI(x.info); })
      .catch(() => {});
    hud.classList.add("gone");
    await preambleSay();
    speakPatternCard(c);
  } finally {
    if (my === dailySeq) dailyBusy = false;
  }
}

/** 讲评渲染兜底：即使渲染炸了，也不能让卡片卡住 */
async function patternSubmit(text) {
  bargeIn();                       // 用户作答：清掉排队中的语音
  if (!patternCard) { await patternNextCard(); return; }
  const c = patternCard;
  const t = String(text || "").trim();

  if (!t) {
    hudShow("跳过", 700);
    const r = await window.pet.pattern({ action: "check", id: c.id, text: "", task: c.task });
    patternCard = null;
    await patternNextCard(true);
    return;
  }

  const r = await window.pet.pattern({ action: "check", id: c.id, text: t, task: c.task });
  const res = (r && r.result) || {};

  if (res.ok) {
    setReplyText(`✓ ${c.pattern}`);
    const cheerRes = await window.pet.word({ action: "cheer" }).catch(() => null);
    const line = (cheerRes && cheerRes.line) || "せいかい！";
    const rv = res.review || {};
    const n = Math.round(Number(rv.natural));
    const hold = !!((Number.isFinite(n) && n >= 1 && n <= 3) || String(rv.rewrite || "").trim());
    safeReview(t, res, `今日 ${res.total || 5} 句 · 对 ${res.stats ? res.stats.right : 0} / 错 ${res.stats ? res.stats.wrong : 0}`, line, { hold });

    // 一批答完 / 新句型答完 的提示（和单词模式对齐）
    if (res.justCompleted) {
      const hint = document.createElement("div");
      hint.textContent = "—— 今日の5文、全部答えたよ！点「新規」换下一批";
      noteEl.appendChild(hint);
    } else if (res.newQuota && res.newDone === res.newQuota) {
      const hint = document.createElement("div");
      hint.textContent = `—— 今日の新しい文型${res.newQuota}個、全部答えたね！`;
      noteEl.appendChild(hint);
    }

    // 先念完夸奖；大概对/有地道建议时停在讲评卡，等「下一句」
    try {
      const { url, engine } = await window.pet.speak(line);
      lastSpoken = line; syncReplayBtn();
      lastTtsEngine = engine || "say";
      await playAudio(url);
    } catch (e) {}

    if (hold) {
      patternCard = null;
      const next = noteEl.querySelector(".note-next");
      if (next) {
        next.addEventListener("click", () => {
          next.disabled = true;
          patternNextCard(true);
        });
      }
      return;
    }
    patternCard = null;
    await patternNextCard(true);
    return;
  }

  setReplyText(`✗ ${c.pattern}`);
  const missRes = await window.pet.word({ action: "miss" }).catch(() => null);
  const line = (missRes && missRes.line) || "おしい！";
  safeReview(t, res, "再打一次（空提交可跳过）", line);
  try {
    const { url, engine } = await window.pet.speak(line);
    lastSpoken = line; syncReplayBtn();
    lastTtsEngine = engine || "say";
    await playAudio(url);
  } catch (e) {}
}

async function patternToggleReview() {
  bargeIn();                       // 用户点了復習：清空队列
  const want = patternMode === "review" ? "daily" : "review";

  // 进復習前先确认错题本不是空的（和单词模式一样：空就只提示，不切）
  if (want === "review") {
    const info = await window.pet.pattern({ action: "info" })
      .then((x) => x && x.info).catch(() => null);
    patternReviewHadWords = !!(info && info.wrong);
    if (info && !info.wrong) {
      hudShow("例文错题本是空的", 2000);   // 只 HUD，不动黄卡（和单词模式一致）
      return;
    }
  }

  patternMode = want;
  pendingModeSay = want === "review" ? "れいぶん復習モード" : "れいぶんモード";
  const rv = document.getElementById("review");
  const paint = (m) => {
    if (!rv) return;
    rv.classList.toggle("active", m === "review");
    setReviewLabel(m === "review" ? "復習中" : "復習");
  };
  paint(want);
  hudShow(want === "review" ? "例文復習" : "例文\n每日 5 句", 1500);

  const r = await window.pet.pattern({ action: "toggle" });
  patternMode = (r && r.mode) || want;
  paint(patternMode);
  if (patternMode === "review" && r && r.wrongCount != null) {
    hudShow(`例文错题\n${r.wrongCount} 个`, 1500);
  }
  patternCard = null;
  await patternNextCard(true);
}

async function patternNewBatch() {
  bargeIn();                       // 用户点了新規：清空队列
  // 界面先动，别等后端（否则要等一次 IPC + 写盘，按钮才变）
  chatMode = "pattern";
  patternMode = "daily";
  const rv = document.getElementById("review");
  if (rv) {
    rv.classList.remove("active");
    setReviewLabel("復習");
    rv.classList.add("show");
  }
  const nb = document.getElementById("newbatch");
  if (nb) nb.classList.add("show");
  for (const el of modeBar.querySelectorAll(".mode-btn")) {
    el.classList.toggle("active", el.dataset.mode === "pattern");
  }
  patternCard = null;

  // 和单词模式一致：中间隔一屏，先说一句，再出第一题
  replyEl.classList.remove("gone");
  setReplyText("次の5文");
  noteShow("はい、次の5文だよ。");
  hudShow("新しい\n5 文", 1200);

  // 换批提示音必须走语音队列：否则它会和紧接着的卡片朗读并行，
  // playAudio 复用同一个 <audio>，后一句会把前一句直接掐掉（"自己打断自己"）
  const speakP = runSpeech(async () => {
    try {
      const { url, engine } = await window.pet.speak("はい、次の5文だよ。");
      lastSpoken = "はい、次の5文だよ。";
      syncReplayBtn();
      lastTtsEngine = engine || "say";
      await playAudio(url);
      await new Promise((r) => setTimeout(r, 220));   // 留一口气，别和第一张卡贴死
    } catch (e) {}
  });

  const [r] = await Promise.all([window.pet.pattern({ action: "new" }), speakP]);
  if (r && r.info) refreshPatternUI(r.info);
  await patternNextCard(true);
}

async function dailyNewBatch() {
  bargeIn();                       // 用户点了新規：清空队列
  // 界面先动（復習中 → 復習、显示新批提示），再等后端
  chatMode = "word";
  wordMode = "daily";
  const rv = document.getElementById("review");
  if (rv) {
    rv.classList.remove("active");
    setReviewLabel("復習");
    rv.classList.add("show");
  }
  const nb = document.getElementById("newbatch");
  if (nb) nb.classList.add("show");
  for (const el of modeBar.querySelectorAll(".mode-btn")) {
    el.classList.toggle("active", el.dataset.mode === "word");
  }
  dailyCard = null;

  // 中间隔一屏：先说一句，再出第一个词
  replyEl.classList.remove("gone");
  setReplyText("次の20単語");
  noteShow("はい、次の20単語だよ。");
  hudShow("新しい\n20 語", 1200);

  // 同 patternNewBatch：提示音进队列，别被第一张卡的朗读顶掉
  const speakP = runSpeech(async () => {
    try {
      const { url, engine } = await window.pet.speak("はい、次の20単語だよ。");
      lastSpoken = "はい、次の20単語だよ。";
      syncReplayBtn();
      lastTtsEngine = engine || "say";
      await playAudio(url);
      await new Promise((r) => setTimeout(r, 220));   // 留一口气，别和第一张卡贴死
    } catch (e) {}
  });

  await Promise.all([window.pet.word({ action: "daily-new" }), speakP]);
  await dailyNext(true);       // force：允许打断上一次循环（序号会作废旧循环）
}

async function casualSay() {
  if (!window.pet || !window.pet.casual) return;
  if (!isTalkMode(chatMode)) {
    hud.classList.remove("gone");
    hudShow("只有会話/解説\n模式能说话", 1500);
    return;
  }
  const myCasual = ++casualSeq;
  const myTurn = turnId;
  const myTalk = isTalkMode(chatMode);
  hud.classList.remove("gone");
  hudShow("…", 0);
  try {
    const r = await window.pet.casual();
    const line = (r && r.line) || "ねえ、きょうは何してたの？";
    replyEl.classList.remove("gone");
    showReply(line);
    lastSpoken = line; lastContentSay = line; lastConvSay = line;
    syncReplayBtn();
    noteEl.classList.add("gone");
    // 主动搭话也带中文翻译；先显示日语，译文到了再补到下方
    if (window.pet.pair) {
      window.pet.pair(line, "ja").then((p) => {
        if (myCasual !== casualSeq || myTurn !== turnId || myTalk !== isTalkMode(chatMode)) return;   // 已被新搭话/新对话/离开会話解説取代
        if (p && p.zh) showReply(line, p.zh);
      }).catch(() => {});
    }
    hud.classList.add("gone");
    const { url, engine } = await window.pet.speak(line);
    lastTtsEngine = engine || "say";
    await playAudio(url);
  } catch (e) {
    hudShow("说话失败", 1500);
  }
}

/* --------------------------- 语音回显 --------------------------- */
