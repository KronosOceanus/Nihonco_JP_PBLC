/* 卡片与讲评渲染：回复气泡、黄卡、单词卡、例句卡、讲评
 *
 * 只负责"把数据渲染成 DOM"；流程（下一题、判分、切模式）在 modes.js。
 */
const escHtml = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 新内容出现时，旧的点词浮层必须收起（它锚定的是上一段文字） */
function dismissWordPop() {
  try { if (typeof hideWordPop === "function") hideWordPop(); } catch (e) {}
}

/** 卡片正文支持高亮：用 innerHTML（所有插值都先 escHtml） */
function noteShowHTML(html) {
  dismissWordPop();
  noteEl.classList.remove("gone");
  noteEl.innerHTML = html;
  try { enhanceJapanese(noteEl, { only: ".jp" }); } catch (e) {}
}

/** 振假名片段 → ruby HTML；没有片段就退回纯文本 */
function rubyHTML(segments, plain) {
  if (!segments || !segments.length) return escHtml(plain);
  return segments.map((s) => (s.r
    ? `<ruby>${escHtml(s.t)}<rt>${escHtml(s.r)}</rt></ruby>`
    : escHtml(s.t))).join("");
}

/** 顶部一行也支持高亮 */
function setReplyHTML(html) {
  dismissWordPop();
  replyEl.classList.remove("gone");
  if (replyTextEl) replyTextEl.innerHTML = html || "…";
}

function setReplyText(text) {
  dismissWordPop();
  replyEl.classList.remove("gone");
  if (replyTextEl) replyTextEl.textContent = text || "…";
}

/** 「再读一遍」只在有内容可重播时出现 */
/** 「再读一遍」的唯一目标算法：卡片模式读卡片，会話/解説只读内容 */
function replayTarget() {
  const cardMode = chatMode === "word" || chatMode === "pattern";
  return cardMode ? (lastCardSay || lastContentSay) : lastConvSay;
}

function syncReplayBtn() {
  const btn = document.getElementById("replay");
  if (!btn) return;
  btn.style.display = replayTarget() ? "" : "none";
}

function showReply(ja, zh, furigana) {
  if (furigana && furigana.length) setReplyHTML(rubyHTML(furigana, ja));
  else setReplyText(ja);
  if (zh && replyTextEl) {
    const d = document.createElement("div");
    d.className = "zh";
    d.textContent = zh;
    replyTextEl.appendChild(d);
  }
  try { enhanceJapanese(replyTextEl); } catch (e) {}
}

/** 两段中文是否在说同一件事：去标点后包含，或 bigram 重合度 ≥ 0.6 */
function overlaps(a, b) {
  const norm = (s) => String(s || "").replace(/[\s。、，．,.!！?？「」『』（）()・…]/g, "");
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = grams(x), B = grams(y);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size) >= 0.6;
}

function showNote(turn) {
  const lines = [];
  const explain = turn.explain_zh || "";
  for (const c of turn.corrections || []) {
    lines.push(`<span class="lbl">纠错</span>${escHtml(c.wrong)} → ${escHtml(c.right)}`);
    // 有讲解且两者在说同一件事时，只留讲解（why_zh 是更短的那份）
    if (c.why_zh && !(explain && overlaps(explain, c.why_zh))) {
      lines.push(`<span class="lbl"></span>${escHtml(c.why_zh)}`);
    }
  }
  if (turn.explain_zh) lines.push(`<span class="lbl">讲解</span>${escHtml(turn.explain_zh)}`);
  if (turn.words && turn.words.length) {
    lines.push(`<span class="lbl">生词</span>${turn.words.map((w) =>
      escHtml(`${w.ja}(${w.kana})${w.zh}`)).join("、")}`);
  }
  if (!lines.length) { noteEl.classList.add("gone"); noteEl.textContent = ""; return; }
  noteShowHTML(lines.join("\n"));
}

function renderCard(c) {
  if (chatMode !== "word") return;         // 切到例句后，旧的单词卡结果不要再画
  replyEl.classList.remove("gone");
  const tag = c.source === "review" ? "復習 · " : c.source === "wrong" ? "錯題 · "
            : c.source === "skip" ? "跳過 · " : c.source === "seen" ? "復習 · " : "";
  setReplyHTML(`${tag}【${escHtml(c.level)}】<span class="hl">${escHtml(c.ja)}</span>（${escHtml(c.kana)}）`);
  noteEl.classList.remove("gone");
  const lines = [`<span class="lbl">意思</span>${escHtml(c.zh)}${c.pos ? "　" + escHtml(c.pos) : ""}`];
  if (c.example) {
    lines.push(`<span class="lbl">例句</span><span class="hl jp">${rubyHTML(c.example_furigana, c.example)}</span>`);
    if (c.example_zh) lines.push(`<span class="lbl"></span>${escHtml(c.example_zh)}`);
  }
  lines.push("—— 用日语打出这个词（汉字或假名都行），回车提交");
  const st = c.stats || (c.info && c.info.stats) || null;
  if (st) {
    const extra = st.skip ? ` / 跳 ${st.skip}` : "";
    const total = (c.info && c.info.total) || st.total || 20;
    lines.push(`<span class="lbl">进度</span>今日 ${total} 词 · 对 ${st.right || 0} / 错 ${st.wrong || 0}${extra}`);
  }
  noteShowHTML(lines.join("\n"));
  dailyCard = c;
}

/* ---------------------------------------------------------------
 * 每种模式下哪些界面元素该出现 —— 这是唯一的显隐来源。
 * 以前这些判断散在 setMode / refreshWordUI / refreshPatternUI / initLevelUI 四处，
 * 谁最后跑谁生效，出过「会話模式残留错题数」之类的 bug。
 * ------------------------------------------------------------- */
const MODE_UI = {
  conv:    { gLevel: true,  batch: false, review: false, wrong: false, wordLv: false, patternLv: false },
  teach:   { gLevel: true,  batch: false, review: false, wrong: false, wordLv: false, patternLv: false },
  word:    { gLevel: false, batch: true,  review: true,  wrong: true,  wordLv: true,  patternLv: false },
  pattern: { gLevel: false, batch: true,  review: true,  wrong: true,  wordLv: false, patternLv: true },
};

function refreshWordUI(info) {
  if (!info) return;
  if (chatMode !== "word") return;      // 切到例句后，旧的单词 info 不要动界面
  if (info.mode) wordMode = info.mode;
  if (typeof info.newDone === "number" && typeof info.newTotal === "number") {
    if (info.newTotal > 0 && info.newDone >= info.newTotal && lastNewDone < info.newTotal) {
      hud.classList.remove("gone");
      hudShow("新単語おわり", 1800);
    }
    lastNewDone = info.newDone;
  }
  const wcount = (info.pools && info.pools.wrong) || 0;
  if (info.mode === "review" && wcount > 0) reviewHadWords = true;
  if (info.mode !== "review") reviewHadWords = false;
  setCount("wordSeen", info.tierSeen, info.tierTotal);   // 常驻在「単語」按钮里
  const wc = document.getElementById("wrongCount");
  if (wc) {
    const n = (info.pools && info.pools.wrong) || 0;
    wc.textContent = n > 0 ? String(n) : "";     // 有无数字只看这里，显隐由 applyModeUI 决定
  }
  const active = info.mode === "review" && wcount > 0;
  const rv = document.getElementById("review");
  if (rv) rv.classList.toggle("active", active);
  setReviewLabel(active ? "復習中" : "復習");
  applyModeUI();
}

function refreshPatternUI(info) {
  if (!info) return;
  if (chatMode !== "pattern") return;   // 切到单词后，旧的例句 info 不要动界面
  const stat = document.getElementById("patternSeen");
  if (stat) {
    setCount("patternSeen", info.tierSeen || 0, info.tierTotal || 0);   // 常驻在「例文」按钮里
  }
  const wc = document.getElementById("wrongCount");
  if (wc) {
    const n = info.wrong || 0;
    wc.textContent = n > 0 ? String(n) : "";
  }
  const rv = document.getElementById("review");
  if (rv) {
    rv.classList.toggle("active", info.mode === "review");
    rv.dataset.tip = "只复习例文错题本";
  }
  setReviewLabel(info.mode === "review" ? "復習中" : "復習");
  applyModeUI();
}

function showPatternButtons() {
  const rv = document.getElementById("review");
  if (rv) rv.dataset.tip = "只复习例文错题本";
  applyModeUI();          // 显隐统一交给状态表
}

function renderPatternCard(c) {
  if (chatMode !== "pattern") return;      // 切走了就别画（避免和单词卡互相覆盖）
  patternCard = c;
  const tag = c.tag ? `${c.tag} · ` : "";
  setReplyText(`${tag}【${c.level}】${c.pattern}`);
  const lines = [];
  if (c.meaning_zh) lines.push(`<span class="lbl">意思</span>${escHtml(c.meaning_zh)}`);
  if (c.formation_zh) lines.push(`<span class="lbl">接续</span>${escHtml(c.formation_zh)}`);
  if (c.probe) {
    lines.push(`<span class="lbl">例句</span><span class="hl jp">${rubyHTML(c.probe.furigana, c.probe.ja)}</span>`);
    if (c.probe.zh) lines.push(`<span class="lbl"></span>${escHtml(c.probe.zh)}`);
    // 例句已经带振假名，单独的「读音」行删掉（重复信息）
  }
  if (c.notes_zh) lines.push(`<span class="lbl">备注</span>${escHtml(c.notes_zh)}`);
  lines.push(c.task === "reproduce"
    ? "—— 照着例文打（读音一致就算对，汉字/假名都行）"
    : "—— 用这个句型造一句日语（回车提交）");
  const st = c.stats;
  if (st) lines.push(`<span class="lbl">进度</span>今日 ${c.total || 5} 句 · 对 ${st.right || 0} / 错 ${st.wrong || 0}`);
  noteShowHTML(lines.filter(Boolean).join("\n"));
}

/** 朗读一张例句卡：先念例句（没有例句就念句型） */
function safeReview(typed, res, footer, line, opts = {}) {
  try {
    noteShowHTML(renderComposeReview(typed, res, footer, line, opts));
  } catch (e) {
    console.warn("[review] 渲染失败", e && e.message);
    noteShowHTML([
      `<span class="lbl">你的</span>${escHtml(typed)}`,
      footer ? `—— ${escHtml(footer)}` : "",
      line ? `<span class="say">${escHtml(line)}</span>` : "",
    ].filter(Boolean).join("\n"));
  }
}

/** 造句讲评：按「你的 → 判定 → 参考 → 自然 → 台词」排，进度只出现在答对时 */
function renderComposeReview(typed, res, footer, line, opts = {}) {
  const rv = res.review || {};
  const lines = [];
  const nextBtn = opts.hold ? `<button class="note-next" type="button">下一句</button>` : "";
  lines.push(`<div class="note-first"><span class="lbl">你的</span><span class="note-text">${escHtml(typed)}</span>${nextBtn}</div>`);

  if (res.ok) {
    const rw = (rv.rewrite || "").trim();
    if (rw && rw !== typed.trim()) {
      lines.push(`<span class="lbl">地道</span><span class="hl">${escHtml(rw)}</span>`);
      if (rv.rewrite_zh) lines.push(`<span class="lbl"></span>${escHtml(rv.rewrite_zh)}`);
    }
    // 大概是“能懂但不地道”时，成功卡也给自然度，避免只有一句“对”
    const nOk = Math.round(Number(rv.natural));
    if (Number.isFinite(nOk) && nOk >= 1 && nOk <= 3) {
      lines.push(`<span class="lbl">自然</span>${"●".repeat(nOk)}${"○".repeat(5 - nOk)}（${nOk}/5）`);
    }
    if (footer) lines.push(`<span class="lbl">进度</span>${escHtml(footer)}`);
  } else {
    if (res.hint) lines.push(`<span class="lbl">点评</span>${escHtml(res.hint)}`);
    for (const it of (rv.issues || []).slice(0, 2)) {
      const head = [it.type, it.text].filter(Boolean).join("：");
      if (head) lines.push(`<span class="lbl">问题</span>${escHtml(head)}`);
      if (it.why) lines.push(`<span class="lbl"></span>${escHtml(it.why)}`);
    }
    if (rv.rewrite) {
      lines.push(`<span class="lbl">改</span><span class="hl">${escHtml(rv.rewrite)}</span>`);
      if (rv.rewrite_zh) lines.push(`<span class="lbl"></span>${escHtml(rv.rewrite_zh)}`);
    } else if (res.expected) {
      lines.push(`<span class="lbl">例句</span>${escHtml(res.expected.ja)}`);
      if (res.expected.zh) lines.push(`<span class="lbl"></span>${escHtml(res.expected.zh)}`);
    }
    if (res.expected && res.expected.romaji) {
      lines.push(`<span class="lbl">键盘</span><span class="romaji">${escHtml(res.expected.romaji)}</span>`);
    }
    const n = Math.round(Number(rv.natural));
    if (Number.isFinite(n) && n >= 1 && n <= 5) {        // 模型偶尔给 6/7/0，先钳制再画
      lines.push(`<span class="lbl">自然</span>${"●".repeat(n)}${"○".repeat(5 - n)}（${n}/5）`);
    }
    if (footer) lines.push(`—— ${escHtml(footer)}`);
  }

  if (line) lines.push(`<span class="say">${escHtml(line)}</span>`);
  return lines.filter(Boolean).join("\n");
}

