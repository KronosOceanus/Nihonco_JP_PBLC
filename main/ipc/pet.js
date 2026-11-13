/* 桌宠窗口 IPC：等级 / 对话 / 模式 / ASR / TTS / 窗口菜单 */
const fs = require("fs");
const path = require("path");
const langGuard = require("../../agent/lang-guard");

module.exports = function registerPetIpc({
  petHandle, petOn, app, agent, tts, voiceCache, asrSvc, voiceSvc, asrLog, platform,
  ensureAsr, restartAsr, speakToWav, getWin, getLevelIdle, getAlwaysOnTop, menus, setPassThrough,
  openSettings, petResize, petResizeEnd, VOICE_DIR, asrBackends, ROOT,
}) {
  // 学习水平：读取/切换（持久化到 data/settings.json）
  petHandle('pet:level', ({ action, level } = {}) => {
    if (action === 'set') return { ...agent.setLevel(level), ...agent.levels() };
    if (action === 'levels') return agent.levels();
    if (action === 'set-word') return agent.setWordLevel(level);
    if (action === 'set-pattern') return agent.setPatternLevel(level);
    return { ok: true, ...agent.levels() };
  });

  petOn('pet:resize', (x, y, corner) => { petResize(Number(x), Number(y), corner === 'tl' ? 'tl' : 'br'); });
  petOn('pet:resize-end', () => { petResizeEnd(); });

  // 桌宠窗口的「設定」按钮（只接受桌宠窗口）
  petOn('pet:open-settings', () => openSettings());

  // 打字时让位给输入法候选框；始终置顶时保持在 floating，不因输入框失焦掉下去
  petHandle('pet:typing', (typing) => {
    try {
      const w = getWin();
      const on = getAlwaysOnTop ? !!getAlwaysOnTop() : false;
      if (!w) return true;
      if (on || typing) w.setAlwaysOnTop(true, 'floating');
      else w.setAlwaysOnTop(!!w.isFocused(), getLevelIdle());
    } catch (e) {}
    return true;
  });


  // 点词查询：返回分词 + 词表命中（词表外的词 ok:false，前端不标记）
  petHandle('pet:lookup', async (text) => {
    try {
      return { ok: true, tokens: require('../../agent/lookup').lookup(text) };
    } catch (e) {
      return { ok: false, error: e.message, tokens: null };
    }
  });

  petHandle('pet:casual', async () => agent.casual());

  petHandle('pet:pair', async (text, lang) => agent.pair(text, lang));

  petHandle('pet:speak', async (text, opts) => {
    const t = String(text || '').slice(0, 300).trim();
    if (!t) throw new Error('空文本');

    // 固定短句走缓存：模式提示音这类每次都一样，省掉 1 秒多的合成
    // 缓存键与预热共用 tts.speechKey()：规则版本 + 规范化文本
    const speakKey = tts.speechKey(t);
    const hit = voiceCache.get(speakKey);
    if (hit) {
      const st = fs.statSync(hit);
      return { url: `/.voice/cache/${path.basename(hit)}?t=${st.mtimeMs}`, bytes: st.size, engine: 'cache' };
    }

    const file = await speakToWav(t, opts || {});
    const st = fs.statSync(file);
    const engine = tts.engineName ? tts.engineName() : 'voicevox';
    // 短句才缓存（长句基本不重复，别把磁盘塞满）
    if (speakKey.length <= 24) voiceCache.put(speakKey, file);
    return {
      url: `/.voice/say.wav?t=${Date.now()}`,
      bytes: st.size,
      engine,
    };
  });

  // 例句（句型）模式
  petHandle('pet:pattern', async ({ action, id, text, task } = {}) => {
    try {
      if (action === 'next') {
        const card = agent.patternNext();
        if (card && card.probe && card.probe.ja) {
          try { card.probe.furigana = require('../../agent/furigana').of(card.probe.ja); } catch (e) {}
        }
        return { ok: true, card };
      }
      if (action === 'check') {
        const result = await agent.patternCheck(id, text, task);
        try {
          const fg = require('../../agent/furigana');
          if (result.card && result.card.probe && result.card.probe.ja) result.card.probe.furigana = fg.of(result.card.probe.ja);
          if (result.expected && result.expected.ja) result.expected.furigana = fg.of(result.expected.ja);
        } catch (e) {}
        return { ok: true, result };
      }
      if (action === 'new') return { ok: true, info: agent.patternNew() };
      if (action === 'toggle') return { ok: true, ...agent.patternToggle() };
      if (action === 'info') return { ok: true, info: agent.patternInfo() };
      if (action === 'advance') return { ok: true, ...agent.patternAdvance() };
      return { ok: false, error: 'unknown action' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 语音识别：把渲染层录的 wav 转给本地 ASR 服务
  // 语音服务可能中途挂掉（内存/崩溃），调用前先探活，起来再发
  petHandle('pet:asr', async ({ wavBase64, lang } = {}) => {
    const buf = Buffer.from(String(wavBase64 || ''), 'base64');
    if (!buf.length) throw new Error('空音频');

    const post = async () => {
      let hot = '';
      try { hot = agent.asrHotwords() || ''; } catch (e) {}
      const qs = `lang=${encodeURIComponent(lang || 'ja')}` +
                 (hot ? `&prompt=${encodeURIComponent(hot)}` : '');
      const res = await fetch(
        `http://127.0.0.1:8765/asr?${qs}`,
        {
          method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: buf,
          // 识别服务理论上 0.3–2 秒；20 秒还没回说明卡死了，别让界面永远「识别中…」
          // 服务端的等锁上限是 15s（先回 503「识别忙」），这里留 5s 余量
          signal: AbortSignal.timeout(20000),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `ASR HTTP ${res.status}`);
      return j;
    };

    // 服务挂了 → 拉起后重试一次
    await ensureAsr(45000);   // 等模型就绪（新机器首次还要下载）
    const t0 = Date.now();
    let retried = false;
    let hotLen = 0;
    try { hotLen = (agent.asrHotwords() || "").length; } catch (e) {}
    const finish = (r) => {
      const requested = lang || "ja";
      if (r && r.text && requested === "ja") {
        const guard = langGuard.checkJapanese(r.text);
        if (!guard.ok) r = { ...r, guard };
      }
      asrLog.record({
        ms: Date.now() - t0, bytes: buf.length, lang: requested,
        engine: platform.asrEngineLabel(process.env.ASR_BACKEND),
        prompt: hotLen, retried, text: r && r.text,
      });
      return r;
    };
    try {
      const _r = await post();
      console.log(`[t] asr ${_r.ms}ms`);
      return finish(_r);
    } catch (e) {
      console.log('[asr] 首次识别失败：', e.message, '→ 重启后重试');
      retried = true;
      // 超时/连接失败才重启服务；HTTP 4xx/5xx 是业务错误，重启也没用
      if (/timeout|aborted|fetch failed|ECONNREFUSED|socket/i.test(String(e.message))) {
        await restartAsr();
      } else {
        await ensureAsr();
      }
      return finish(await post());
    }
  });

  let chatHistory = [];
  let memoryTurns = 0;
  let memoryBusy = false;
  let memoryPending = [];              // 已发生、还没送进提取器的用户发言
  let memoryIdleTimer = null;
  const MEMORY_IDLE_MS = Math.max(60 * 1000, Number(process.env.MEMORY_IDLE_MS) || 10 * 60 * 1000);

  function scheduleMemoryIdle() {
    if (memoryIdleTimer) clearTimeout(memoryIdleTimer);
    memoryIdleTimer = setTimeout(() => {
      memoryIdleTimer = null;
      runMemoryExtract("idle");
    }, MEMORY_IDLE_MS);
    if (typeof memoryIdleTimer.unref === "function") memoryIdleTimer.unref();
  }

  function runMemoryExtract(reason = "turns") {
    if (memoryBusy || !memoryPending.length) return;
    const batch = memoryPending.slice(0, 6);
    memoryBusy = true;
    let success = false;
    agent.extractMemory(batch)
      .then((x) => {
        success = !!x.ok;
        if (success && x.patches && x.patches.length) {
          memoryPending.splice(0, batch.length);
          console.log(`[memory] extract(${reason}) patches=${x.patches.length}`);
        } else {
          console.log(`[memory] extract(${reason}) ok=${x.ok} patches=0`);
        }
      })
      .catch((e) => console.log("[memory] extract failed:", e.message))
      .finally(() => {
        memoryBusy = false;
        if (success && memoryPending.length >= 6) runMemoryExtract("pending");
        else if (memoryPending.length) scheduleMemoryIdle();
      });
  }

  petHandle('pet:chat', async ({ text, mode, source } = {}) => {
    const t = String(text || '').slice(0, 500).trim();
    if (!t) throw new Error('空文本');
    const m = ['conv', 'teach', 'word'].includes(mode) ? mode : 'conv';
    const _t0 = Date.now();
    const r = await agent.chat(chatHistory, t, m, source === 'voice' ? 'voice' : 'text');
    console.log(`[t] chat(${m}) ${Date.now() - _t0}ms  ok=${r.ok}`);
    if (r.ok && r.turn && r.turn.reply_ja) {
      const guard = langGuard.checkJapanese(r.turn.reply_ja);
      if (!guard.ok) {
        console.log(`[lang-guard] reply_ja 可疑：${guard.reason} ${JSON.stringify(guard.hits || guard.markers || [])}`);
        r.turn = {
          reply_ja: "ごめん、今ちょっとうまく言えなかった。もう一回いい？",
          reply_zh: "抱歉，刚才没组织好。能再说一次吗？",
          corrections: [], explain_zh: "", words: [],
          next_question_ja: "", next_question_zh: "",
        };
        r.guard = guard;
      }
    }
    if (r.ok) {
      // 会話/解説的回复不标振假名（省一次分词；卡片/例句仍由各自 IPC 补）
      chatHistory.push({ role: 'user', content: t });
      // 历史里 assistant 必须是「JSON 形状」：本轮请求开了 response_format=json_object，
      // 如果历史是纯文本，DeepSeek 会跟着纯文本走，返回空 content（实测 completion_tokens=13 但无内容）
      const t0 = r.turn || {};
      const brief = {
        reply_ja: t0.reply_ja || "",
        reply_zh: t0.reply_zh || "",
        next_question_ja: t0.next_question_ja || "",
      };
      if (brief.reply_ja) chatHistory.push({ role: 'assistant', content: JSON.stringify(brief) });
      // 保留 16 轮（32 条消息）——之前只有 8 条，聊到第 5 轮就忘了开头
      if (chatHistory.length > 32) chatHistory = chatHistory.slice(-32);

      // 每 6 条会話用户消息提取一次；不足 6 条时，空闲 10 分钟补提取
      if (m === "conv") {
        memoryTurns += 1;
        memoryPending.push({ role: "user", content: t });
        if (memoryTurns % 6 === 0) runMemoryExtract("turns");
        scheduleMemoryIdle();
      }
    }
    return { ...r, historyLen: chatHistory.length };
  });

  // 诊断用：把最近一次录音存下来（.voice/last-rec.wav）
  petHandle('pet:save-audio', async (wavBase64) => {
    const buf = Buffer.from(String(wavBase64 || ''), 'base64');
    if (!buf.length) return { ok: false };
    fs.mkdirSync(VOICE_DIR, { recursive: true });
    // 逐次保留，方便对比（rec-1.wav, rec-2.wav…），另外总是更新 last-rec.wav
    const n = fs.readdirSync(VOICE_DIR).filter((f) => /^rec-\d+\.wav$/.test(f)).length + 1;
    const out = path.join(VOICE_DIR, `rec-${n}.wav`);
    fs.writeFileSync(out, buf);
    fs.writeFileSync(path.join(VOICE_DIR, 'last-rec.wav'), buf);
    console.log('[rec] 已保存', out, buf.length, 'bytes');
    return { ok: true, path: out, bytes: buf.length, index: n };
  });

  // 单词模式：下一课 / 复习出题 / 判分
  // 单词卡例句的振假名（例句是纯字符串，渲染层用 rubyHTML 拼）
  const withExampleFurigana = (obj) => {
    if (obj && obj.example) {
      try { obj.example_furigana = require('../../agent/furigana').of(obj.example); } catch (e) {}
    }
    return obj;
  };

  petHandle('pet:word', async ({ action, n, text, word } = {}) => {
    try {
      if (action === 'daily-next') return { ok: true, card: withExampleFurigana(await agent.dailyNext()) };
      if (action === 'daily-check') {
        return { ok: true, result: agent.dailyCheck(word || {}, text) };
      }
      if (action === 'daily-alt') return { ok: true, result: agent.dailyAcceptAlt(word || {}, text) };
      if (action === 'daily-example') return { ok: true, ...withExampleFurigana(await agent.dailyExample(word)) };
      if (action === 'cheer') return { ok: true, line: await agent.cheer() };
      if (action === 'miss') return { ok: true, line: await agent.miss() };
      if (action === 'daily-new') return { ok: true, info: agent.dailyNew() };
      if (action === 'daily-info') return { ok: true, info: agent.dailyInfo() };
      if (action === 'daily-toggle') return { ok: true, ...agent.dailyToggle() };
      if (action === 'daily-advance') return agent.dailyAdvanceLevel();
      return { ok: false, error: 'unknown action' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  petHandle('pet:shortcuts', () => {
    const sc = require('../../agent/shortcuts');
    const db = sc.load();
    return { ok: true, enabled: db.enabled !== false, autoStopSec: db.autoStopSec, local: db.local };
  });

  petHandle('pet:chat-status', async () => agent.status());
  petHandle('pet:chat-reset', async () => {
    chatHistory = [];
    memoryTurns = 0;
    memoryPending = [];
    if (memoryIdleTimer) { clearTimeout(memoryIdleTimer); memoryIdleTimer = null; }
    return { ok: true };
  });

  // 语音合成可用性：没有 TTS 引擎就彻底不发音。
  // 渲染层启动时问一次，缺什么直接写在 HUD 上。
  //
  // 注意「还在启动」≠「没装」：启动瞬间引擎（uvicorn + core）通常还没就绪，
  // 只判一次 alive() 会在每次启动都误报。所以：
  //   · 引擎文件不存在 → 立刻 answered:false（真没装，秒回）
  //   · 文件在但还没响应 → 等它起来，最多等引擎就绪（ensureTtsEngine）
  petHandle('pet:tts-health', async () => {
    return voiceSvc.bootCheckTts({ timeoutMs: 12000 });
  });

  // 缺哪些 Whisper 资产（Windows lite 不内置）：首启 HUD 用它给出「去哪拖」的提示
  petHandle('pet:asr-assets', () => {
    try {
      const info = asrBackends.info(ROOT);
      return { missing: info.wcpp ? null : (info.wcppBin ? 'model' : 'engine'), isWin: !!info.isWin };
    } catch (e) {
      return { missing: null, isWin: false };
    }
  });

  // 语音识别启动自检：只有「确定起不来」才 status=failed；加载中返回 loading
  petHandle('pet:asr-health', async () => {
    try {
      return { ok: true, ...(await asrSvc.probeAsr({ timeoutMs: 30000 })) };
    } catch (e) {
      return { ok: false, status: 'failed', reason: 'probe-error', lastError: e.message };
    }
  });

  petOn('pet:menu', () => {
    menus.buildMenu().popup({ window: getWin() });
  });
  petOn('pet:quit', () => app.quit());
  petOn('pet:mouse', (on) => setPassThrough(!!on));

}
