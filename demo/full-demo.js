(async () => {
  const p = window.__pet;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const input = $("say");
  const idle = async (stableMs = 1800) => {
    let stable = 0;
    for (let i = 0; i < 2400; i++) {
      const busy = p.playing() || p.chatBusy || p.busy || (p.speechBusy && p.speechBusy());
      stable = busy ? 0 : stable + 150;
      if (stable >= stableMs) return;
      await sleep(150);
    }
  };
  const type = async (text) => {
    input.focus(); input.value = "";
    for (const ch of text) {
      input.value += ch;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(110);
    }
    await sleep(400);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };
  const closeLevelMenu = () => document.getElementById("levelMenu").classList.add("gone");
  const waitLevelButton = async (id) => {
    let last = "", stable = 0;
    for (let i = 0; i < 50; i++) {
      const r = document.getElementById(id).getBoundingClientRect();
      if (r.width && r.height && r.left >= 50 && r.top >= 0) {
        const key = `${r.left},${r.top},${r.width}`;
        if (key === last) stable += 1; else { last = key; stable = 0; }
        if (stable >= 2) return;
      }
      await sleep(60);
    }
  };
  const openLevel = async (id) => {
    closeLevelMenu();
    await sleep(120);
    await waitLevelButton(id);
    const btn = document.getElementById(id);
    btn.click();
    // 演示脚本强制按按钮实时坐标校正一次，绕开模式栏重排竞态
    await new Promise((r) => requestAnimationFrame(r));
    const r = btn.getBoundingClientRect();
    const m = document.getElementById("levelMenu");
    m.style.position = "fixed";
    m.style.left = `${Math.round(r.left)}px`;
    m.style.top = `${Math.round(r.bottom + 6)}px`;
    m.style.visibility = "visible";
    await sleep(450);
  };
  const pickLevel = async (lv) => {
    await openLevel("gLevel");
    document.querySelector(`#levelMenu .lv-item[data-lv="${lv}"]`).click();
    await sleep(120);
    closeLevelMenu();
    await idle();
    await sleep(700);
  };
  const pickWordLevel = async (lv) => {
    await openLevel("wordLevel");
    document.querySelector(`#levelMenu .lv-item[data-lv="${lv}"]`).click();
    await sleep(120);
    closeLevelMenu();
    await idle();
    await sleep(700);
  };
  await sleep(700);
  const gate = document.createElement("div");
  gate.id = "demoGate";
  gate.style.cssText = "position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:#fff;text-align:center;";
  gate.innerHTML = '<div><div style="font-size:20px;font-weight:600;margin-bottom:8px">按 Control + Shift + D 开始会话演示</div><div style="font-size:13px;opacity:.85">先开始系统录屏，再按快捷键</div></div>';
  document.body.appendChild(gate);
  await new Promise((resolve) => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && String(e.key).toLowerCase() === "d") {
        window.removeEventListener("keydown", onKey, true);
        resolve();
      }
    };
    window.addEventListener("keydown", onKey, true);
  });
  gate.remove();
  console.log("[conv] hotkey " + Date.now());

  // 快速提示音扫描：检测到开始播放就下一步，不等整句
  const started = async (ms = 2500) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (p.playing() || (p.speechBusy && p.speechBusy())) return;
      await sleep(50);
    }
  };
  const quickLevel = async (lv) => {
    await openLevel("gLevel");
    document.querySelector(`#levelMenu .lv-item[data-lv="${lv}"]`).click();
    await sleep(120);
    closeLevelMenu();
    await started();
  };
  p.setMode("conv");
  await started();
  document.getElementById("mtoggle").click();   // 会话 → 解说
  await started();
  await quickLevel("N4");
  await quickLevel("N5");
  p.setMode("word");
  await started();
  document.getElementById("review").click();
  await started();
  document.getElementById("review").click();
  await started();
  document.getElementById("newbatch").click();
  await started();
  p.setMode("pattern");
  await started();
  document.getElementById("review").click();
  await started();
  document.getElementById("review").click();
  await started();
  document.getElementById("newbatch").click();
  await started();

  // 正式预热：解说提示音开始后停 10 秒
  p.setMode("teach");
  await started();
  await sleep(12000);

  // 会话模式提示音
  p.setMode("conv");
  await idle();
  await sleep(900);

  // 你是谁 / 做什么
  await type("あなたは誰？何をしている人なの？");
  await idle();
  await sleep(700);

  // N3
  await pickLevel("N3");

  // 喜欢吃什么
  await type("好きな食べ物は何ですか？");
  await idle();
  await sleep(700);

  // 回 N5
  await pickLevel("N5");
  await sleep(700);

  // 解说模式：故意说错，等纠错卡和语音
  p.setMode("teach");
  await idle();
  await sleep(700);
  await type("私はリンゴを食べるです。");
  await idle();
  await sleep(2500);

  // 单词模式：答对 → 答错 → 同卡补答对 → 跳过
  p.setMode("word");
  await idle();
  await sleep(700);
  const answerWord = async () => {
    const c = p.card || {};
    await type(c.reading || c.ja || "x");
    await idle();
    await sleep(700);
  };
  await answerWord();                 // 答对
  await type("ちがう");               // 答错
  await idle();
  await sleep(700);
  await answerWord();                 // 同一张卡补答对
  await type("");                     // 空提交跳过
  await idle();
  await sleep(700);

  // 复习：跳过 1 个，再退出
  document.getElementById("review").click();
  await idle();
  await sleep(700);
  await p.dailyNext(true);
  await idle();
  await sleep(700);
  await type("");                     // 复习跳过 1 个
  await idle();
  await sleep(700);
  document.getElementById("review").click(); // 退出复习
  await idle();
  await sleep(700);

  // 单词 N3 → N5 → 新規
  await pickWordLevel("N3");
  await pickWordLevel("N5");
  document.getElementById("newbatch").click();
  await idle();
  await sleep(2500);

  // 例句模式：答对 → 答错 → 同卡补答对 → 跳过
  p.setMode("pattern");
  await idle();
  await sleep(700);
  const answerPattern = async () => {
    const c = p.patternCard || {};
    await type(c.example || (c.probe && c.probe.ja) || c.pattern || "x");
    await idle();
    await sleep(700);
  };
  await answerPattern();              // 答对
  await type("ちがう");               // 答错
  await idle();
  await sleep(700);
  await answerPattern();              // 同一张补答对
  await type("");                     // 空提交跳过
  await idle();
  await sleep(700);

  // 例句复习：跳过 1 个，再退出
  document.getElementById("review").click();
  await idle();
  await sleep(700);
  await p.patternNextCard(true);
  await idle();
  await sleep(700);
  await type("");                     // 复习跳过 1 个
  await idle();
  await sleep(700);
  document.getElementById("review").click(); // 退出复习
  await idle();
  await sleep(700);

  // 例句 N3 → N5 → 新規
  const pickPatternLevel = async (lv) => {
    await openLevel("patternLevel");
    document.querySelector(`#levelMenu .lv-item[data-lv="${lv}"]`).click();
    await sleep(120);
    closeLevelMenu();
    await idle();
    await sleep(700);
  };
  await pickPatternLevel("N3");
  await pickPatternLevel("N5");
  document.getElementById("newbatch").click();
  await idle();
  await sleep(2500);

  // 中文翻译测试：保持例句模式，仅把输入语言切到中国語
  document.getElementById("lang").click();   // 日本語 → 中国語
  await sleep(700);
  await type("翻译测试");

  // 等 pair 返回、回显可展开
  const echo = document.getElementById("echo");
  for (let i = 0; i < 50; i++) {
    if (echo && echo.classList.contains("expandable")) break;
    await sleep(300);
  }
  if (echo) {
    echo.click();                             // 展开回显
    await sleep(700);
    const sayBtn = echo.querySelector(".echo-say");
    if (sayBtn) sayBtn.click();               // 朗读日语译文
    await idle();
    await sleep(2500);
  }

  console.log("[demo] end " + Date.now());
  return "full-formal-translation-done";
})().catch((e) => console.log("[conv] fatal " + (e && e.message || e)));
