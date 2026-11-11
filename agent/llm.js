/* 日语对话教练 · LLM 适配层
 *
 * 三层降级：
 *   1) 环境变量 / .env 里的 OpenAI 兼容接口（DeepSeek、OpenAI、通义、自建网关）
 *   2) 本地 Ollama（http://127.0.0.1:11434/v1）
 *   3) 都没有 → 返回结构化提示（前端展示「怎么配 key」），不抛异常打断对话
 *
 * 只做一件事：把 messages 变成「结构化的 teaching turn」。
 */

const fs = require("fs");
const path = require("path");
const { systemPrompt, noCardPatch, enrichPrompt } = require("./prompt");
const persona = require("./persona");
const scenes = require("./persona-scenes");
const targets = require("./targets");
const { createMemory } = require("./memory");
const memoryExtract = require("./memory-extract");
const { finalizeTurn, orderAlternatives } = require("./turn");
const curriculum = require("./curriculum");
const vocab = require("./vocab-daily");
const patternDaily = require("./pattern-daily");
const book = require("./wordbook");

/* ------------------------------ 配置 ------------------------------ */
const { loadEnv } = require("./env");
const config = require("./config");

const env = loadEnv();

const CONF = {
  base: (env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, ""),
  key: env.LLM_API_KEY || "",
  model: env.LLM_MODEL || "deepseek-chat",
  level: env.JP_LEVEL || "N4",
  ollama: (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/+$/, ""),
  ollamaModel: env.OLLAMA_MODEL || "qwen2.5:7b",
  timeout: Number(env.LLM_TIMEOUT_MS || 30000),
};

/* --------------------------- 学习水平 --------------------------- */
const LEVELS_ALL = ["N5", "N4", "N3", "N2", "N1"];
// 和其他 agent 模块保持同一口径：数据目录可以被 NIHONCO_DATA_DIR 覆盖。
// （打包后 __dirname/../data 在 asar 里是只读的，硬编码会导致档位存不进去）
const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch (e) { return {}; }
}

// 启动时用上次选择的水平覆盖 .env
(function initLevel() {
  const saved = loadSettings().level;
  if (LEVELS_ALL.includes(saved)) CONF.level = saved;
})();

/** 发一次最小的 chat/completions，把 HTTP 状态码翻译成人话（云端与 Ollama 共用） */
async function probeChat(base, key, model) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key && key !== "ollama" ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const msg = e && e.name === "TimeoutError" ? "超时（8 秒）" : (e && e.message) || "网络错误";
    return { ok: false, error: `连不上 ${base}：${msg}`, ms: Date.now() - t0 };
  }

  const ms = Date.now() - t0;
  if (res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: true, model: j.model || model, ms };
  }

  const text = await res.text().catch(() => "");
  let hint = "";
  if (res.status === 401 || res.status === 403) hint = "key 无效或没有权限";
  else if (res.status === 404) hint = "接口地址或模型名不对";
  else if (res.status === 429) hint = "被限流（稍后再试）";
  else if (res.status >= 500) hint = "服务端错误";
  const detail = text.slice(0, 120).replace(/\s+/g, " ");
  return { ok: false, status: res.status, error: `${res.status} ${hint || ""} ${detail}`.trim(), ms };
}

/**
 * 真·连通性测试：
 *   有 key → 测云端
 *   没 key → 走和对话一样的回退逻辑（本地 Ollama）
 */
async function testConnection() {
  if (CONF.key) return probeChat(CONF.base, CONF.key, CONF.model);

  const p = await pickProvider();      // 没 key 时它会探测 Ollama
  if (p.kind === "ollama") {
    const r = await probeChat(p.base, "", p.model);
    return { ...r, provider: "ollama" };
  }
  return { ok: false, error: "还没有配置 API key，也没检测到本地 Ollama" };
}

/** 设置窗口换了模型/地址后，让运行中的 CONF 立刻用上（不用重启） */
function applyProvider({ model, baseUrl } = {}) {
  if (model) CONF.model = String(model);
  if (baseUrl) CONF.base = String(baseUrl).replace(/\/+$/, "");
  return { ok: true, model: CONF.model, base: CONF.base };
}

/** 设置窗口改了 key 后，让运行中的 CONF 立刻用上 */
function applyApiKey(key) {
  CONF.key = String(key || "");
  return { ok: true, hasKey: !!CONF.key };
}

function getLevel() { return CONF.level; }

/** 三个档位：全局 / 单词 / 例句；单词与例句相同则全局跟随 */
function availableLevels() {
  const pats = require("./patterns");
  return {
    word: vocab.LV_ORDER,
    pattern: pats.LEVELS.map((x) => x.toUpperCase()).filter((lv) => pats.all(lv).length > 0),
  };
}

function levels() {
  const avail = availableLevels();
  return {
    ok: true,
    global: getLevel(),
    word: vocab.currentWordLevel(),
    pattern: patternDaily.currentLevel(),
    wordAvailable: avail.word,
    patternAvailable: avail.pattern,
  };
}

/** 单词 / 例句 档位一样时，全局自动跟随 */
function syncGlobalLevel() {
  const w = vocab.currentWordLevel();
  const p = patternDaily.currentLevel();
  if (w === p && getLevel() !== w) setLevel(w);
  return levels();
}

function setWordLevel(level) {
  const r = vocab.setWordLevel(level);
  if (!r.ok) return { ok: false, ...levels() };
  return { ok: true, ...syncGlobalLevel() };
}

function setPatternLevel(level) {
  const r = patternDaily.setLevel(level);
  if (!r.ok) return { ok: false, reason: r.reason, pattern: patternDaily.currentLevel(), ...levels() };
  return { ok: true, ...syncGlobalLevel() };
}

function setLevel(level) {
  const lv = String(level || "").toUpperCase();
  if (!LEVELS_ALL.includes(lv)) return { ok: false, level: CONF.level };
  CONF.level = lv;
  config.patch({ level: lv });     // 统一由 config 落盘（原子写）
  return { ok: true, level: lv };
}

/** 词表分档：N5/N4 共用一档（词表本身合并了） */
function levelToPool(lv = CONF.level) {
  if (lv === "N5" || lv === "N4") return 0;
  if (lv === "N3") return 1;
  if (lv === "N2") return 2;
  return 3; // N1
}

/* --------------------------- 提供方探测 --------------------------- */
async function pickProvider() {
  if (env.MOCK_LLM === "1") return { kind: "mock", base: "", key: "", model: "mock" };
  if (CONF.key) return { kind: "cloud", base: CONF.base, key: CONF.key, model: CONF.model };
  try {
    const r = await fetch(`${CONF.ollama}/models`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const has = (j.data || []).length > 0;
      if (has) return { kind: "ollama", base: CONF.ollama, key: "ollama", model: CONF.ollamaModel };
    }
  } catch (e) { /* 没有 ollama 就往下走 */ }
  return { kind: "none" };
}

/* ---------------------------- JSON 解析 ---------------------------- */
function parseTurn(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  // 去掉 ```json 围栏
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const sanitize = (v) => String(v)
    // JSON 里不能出现裸控制字符（模型偶尔在字符串里换行/写 tab）
    .replace(/[\u0000-\u001F]/g, " ");
  const tryParse = (s) => {
    try { return JSON.parse(s); } catch (e) { return null; }
    // 第二次：清理控制字符后再试一次
  };
  const tryParse2 = (s) => tryParse(s) || tryParse(sanitize(s));

  let obj = tryParse2(text);
  if (!obj) {
    // 容错：抓第一个 { ... } 块
    const m = text.match(/\{[\s\S]*\}/);
    if (m) obj = tryParse2(m[0]);
  }
  if (!obj) {
    console.log('[llm] JSON 解析失败，原文前 200 字：', text.slice(0, 200));
    // ① 半截 JSON（被 max_tokens 截断 / 网络断流）：直接抠出已写好的字段，
    //    至少不要把这坨 JSON 原样贴到气泡里
    const pick = (key) => {
      const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      if (!m) return "";
      try { return JSON.parse(`"${m[1]}"`); } catch (e) { return m[1]; }
    };
    const ja = pick("reply_ja");
    if (ja) {
      return {
        reply_ja: ja, reply_zh: pick("reply_zh"), corrections: [],
        explain_zh: pick("explain_zh"), words: [],
        next_question_ja: pick("next_question_ja"), next_question_zh: pick("next_question_zh"),
      };
    }
    // ② 看起来是 JSON 但抠不出字段：别把 JSON 原样贴进气泡，给一句自然的兜底
    if (/^\s*\{/.test(text) || text.includes('"reply_ja"')) {
      return {
        reply_ja: "ごめん、うまく言えなかった。もう一回いい？",
        reply_zh: "（这次回复格式坏了，能再说一次吗？）",
        corrections: [], explain_zh: "", words: [],
        next_question_ja: "", next_question_zh: "",
      };
    }
    // ③ 完全不是 JSON：把原文当日语（至少能读出来）
    return {
      reply_ja: text.slice(0, 200), reply_zh: "", corrections: [],
      explain_zh: "", words: [], next_question_ja: "", next_question_zh: "",
    };
  }
  return {
    reply_ja: String(obj.reply_ja || ""),
    reply_zh: String(obj.reply_zh || ""),
    corrections: Array.isArray(obj.corrections) ? obj.corrections.slice(0, 1) : [],
    explain_zh: String(obj.explain_zh || ""),
    words: Array.isArray(obj.words) ? obj.words.slice(0, 3) : [],
    next_question_ja: String(obj.next_question_ja || ""),
    next_question_zh: String(obj.next_question_zh || ""),
  };
}

/* --------------------------- 单词课程 --------------------------- */
async function callJson(messages, temperature = 0.3) {
  const provider = await pickProvider();
  if (provider.kind === "none") throw new Error("没有可用的模型");
  const body = {
    model: provider.model, messages, temperature, max_tokens: 1200,
    response_format: { type: "json_object" },
  };
  const res = await fetch(`${provider.base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONF.timeout),
  });
  const j = await res.json();
  let raw = j.choices?.[0]?.message?.content || "{}";
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(raw); } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

const enrich = require("./enrich");
const cachedExample = enrich.cachedExample;
async function enrichBatch(items) { return enrich.enrichBatch(items, callJson); }
async function enrichOne(w) { return enrich.enrichOne(w, callJson); }

/** 単語模式：抽下一张卡（daily 批次 / review 错题本） */
async function dailyNext() {
  const c = vocab.nextCard();
  if (!c) return null;
  return { ...c, info: vocab.info() };
}

/** 例句单独取（有缓存就直接命中） */
async function dailyExample(word) {
  if (!word || !word.ja) return {};
  const e = await enrichOne(word);
  return { example: e.example || "", example_zh: e.example_zh || "", note: e.note || "" };
}

/** 点菜单「说话…」：随便来一句日语寒暄/搭话 */
const CASUAL_FALLBACK = [
  "ねえ、きょうは何してたの？",
  "ひさしぶり！元気だった？",
  "ちょっと休憩する？",
  "きょうはいい天気だね。",
  "なんか話そうよ〜。",
];
async function casual() {
  try {
    const j = await callJson([
      { role: "system", content: persona.casualPrompt() },
      { role: "user", content: "说点什么" },
    ], 0.95);
    const line = String(j.line || "").trim();
    if (line) return line.slice(0, 40);
  } catch (e) {}
  return CASUAL_FALLBACK[Math.floor(Math.random() * CASUAL_FALLBACK.length)];
}

/** 每 6 轮后台提取长期记忆；不阻塞聊天。 */
async function extractMemory(history = []) {
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === "user")
    .map((m) => String(m.content || ""))
    .filter(Boolean)
    .slice(-6);
  if (!recent.length) return { ok: true, patches: [], applied: [] };
  const mem = createMemory();
  mem.load();
  return memoryExtract.extract({
    recent,
    snapshot: mem.snapshot(),
    memory: mem,
    callJson,
  });
}

/** 把学习者这句话配成双语：{ ja, zh }（哪边是原文都行，另一边是翻译） */
async function pair(text, lang = "") {
  const t = String(text || "").trim().slice(0, 200);
  if (!t) return { ja: "", zh: "", ja_alternatives: [] };
  const src = lang === "ja" || lang === "zh" ? lang : (/[\u3040-\u30ff]/.test(t) ? "ja" : "zh");
  try {
    const j = await callJson([
      src === "zh"
        ? { role: "system", content: `原文是中文。不要改写中文；给出日语说法：
- ja：最自然、日常的日语说法（口语）
- alternatives：1–2 个不同说法，按「随意 → 礼貌/正式」排序；每条给：
  · ja：说法
  · tone：casual | neutral | polite
  · scene_zh：≤12 字中文说明场景
只输出 JSON：{ "ja": "…", "alternatives": [ { "ja": "…", "tone": "casual", "scene_zh": "…" } ] }` }
        : { role: "system", content: `原文是日语。不要改写日语；只给简短中文意思。
只输出 JSON：{ "zh": "…" }` },
      { role: "user", content: t },
    ], 0.3);
    const ja = String(j.ja || "").trim();
    const zh = String(j.zh || "").trim();
    const fg = require("./furigana");
    const ruby = (v) => { try { return v ? fg.of(v) : null; } catch (e) { return null; } };
    const alts = Array.isArray(j.alternatives) ? j.alternatives.slice(0, 2) : [];
    const ja_alternatives = src === "zh" ? alts
      .map((a) => ({ ja: String((a && a.ja) || "").trim(), tone: String((a && a.tone) || "").trim(), scene_zh: String((a && a.scene_zh) || "").trim() }))
      .filter((a) => a.ja && a.ja !== ja) : [];
    const ordered = orderAlternatives(ja_alternatives).map((a) => ({ ...a, furigana: ruby(a.ja) }));
    return { ja, zh, ja_furigana: src === "zh" ? ruby(ja) : null, ja_alternatives: src === "zh" ? ordered : [] };
  } catch (e) {
    return { ja: "", zh: "", ja_alternatives: [] };
  }
}

const MISS_FALLBACK = ["おしい！", "ざんねん、もういちど！", "あとちょっと！"];
async function miss() {
  const line = vocab.pickPoolLine("miss");
  return (line || MISS_FALLBACK[Math.floor(Math.random() * MISS_FALLBACK.length)]).slice(0, 40);
}

const CHEER_FALLBACK = ["せいかい！", "ぴったり！", "その調子！", "正解だよ！"];
async function cheer() {
  const line = vocab.pickPoolLine("cheer");
  return (line || CHEER_FALLBACK[Math.floor(Math.random() * CHEER_FALLBACK.length)]).slice(0, 40);
}

/** 判定默写 */
function dailyCheck(word, answer) { return vocab.check(word, answer); }
function dailyAcceptAlt(word, answer) { return vocab.acceptAlt(word, answer); }
function dailyNew() { vocab.newBatch(); return vocab.info(); }
function dailyInfo() { return vocab.info(); }
function dailyToggle() { return vocab.toggleReview(); }

/** 今日热词：送给 ASR 当 initial_prompt，减少同音误判 */
function asrHotwords(limit = 60) {
  const words = [];
  try {
    const info = vocab.info();
    for (const w of (info.batch || [])) {          // info().batch 是「日语词」字符串数组
      const ja = typeof w === "string" ? w : (w && w.ja);
      if (ja) words.push(ja);
    }
  } catch (e) {}
  try {
    for (const r of (book.pools().wrong || [])) words.push(r.ja);
  } catch (e) {}
  // 只留词表里真有的词（避免把识别噪声当成热词喂回去）
  let known = null;
  try {
    known = new Set(curriculum.words().map((w) => w.ja));
  } catch (e) {}
  const uniq = [...new Set(words)].filter((w) => !known || known.has(w));
  // 按「词」累加长度，避免把最后一个词切成半个喂给 Whisper
  const out = [];
  let len = 0;
  for (const w of uniq) {
    const add = out.length ? w.length + 1 : w.length;   // +1 是「、」
    if (len + add > limit) break;
    out.push(w);
    len += add;
  }
  return out.join("、");
}

/* ------------------------- 例句（句型）模式 ------------------------- */
function patternNext() { return patternDaily.nextCard(); }
function patternNew() { patternDaily.newBatch(); return patternDaily.info(); }
function patternToggle() { return patternDaily.toggleReview(); }
function patternInfo() { return patternDaily.info(); }
function patternAdvance() { return patternDaily.advanceLevel(); }

/** 造句判定：先由 pattern-daily 做规则校验，再让模型看语义是否成立 */
async function judgePattern({ pattern, meaning_zh, sentence }) {
  try {
    const j = await callJson([
      { role: "system", content: `你是日语老师，点评学生用指定句型造的句子。只输出 JSON：

{
  "ok": true/false,                 // 语法正确且意思讲得通
  "natural": 1-5,                   // 5=母语者也不会改；3=能懂但别扭；1=不通
  "issues": [ { "type": "助词|活用|语序|用词|礼貌体", "text": "错在哪（≤20字，可写 学校で→学校に）", "why": "一句中文解释（≤30字）" } ],
  "rewrite": "更自然的日语说法（若原句已经很好就留空字符串）",
  "rewrite_zh": "rewrite 的中文翻译（rewrite 为空时留空）",
  "hint": "一句话中文提示（≤30字，ok 时可为空）"
}

句型：${pattern}（${meaning_zh}）

判定与点评标准：
- 用上这个句型、助词与活用正确、意思讲得通 → ok=true
- 能听懂、只是不够地道 → ok=true，但可在 rewrite 给出更自然的说法
- **能听懂就不算错**；只有语法错误或意思不通才 ok=false
- issues 最多 2 条，按严重度排序；没有明显问题就空数组
- rewrite 不要强行给：原句已经很自然就留空，别为了给建议而改
- 全部用中文解释，只有 rewrite 是日语` },
      { role: "user", content: sentence },
    ], 0.2);

    const arr = Array.isArray(j.issues) ? j.issues : [];
    const issues = arr.slice(0, 2).map((x) => ({
      type: String((x && x.type) || "").slice(0, 8),
      text: String((x && x.text) || "").slice(0, 30),
      why: String((x && x.why) || "").slice(0, 40),
    })).filter((x) => x.text || x.why);

    const n = Number(j.natural);
    return {
      ok: !!j.ok,
      hint: String(j.hint || "").slice(0, 40),
      natural: Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : null,
      issues,
      rewrite: String(j.rewrite || "").trim().slice(0, 80),
      rewrite_zh: String(j.rewrite_zh || "").trim().slice(0, 80),
    };
  } catch (e) {
    return null;      // 交给规则结果
  }
}

async function patternCheck(id, answer, task) {
  return patternDaily.check(id, answer, {
    task,
    judge: (ctx) => judgePattern(ctx),
  });
}

/** 升到下一档（N5→N4→N3→N2→N1），并重建今日批次 */
function dailyAdvanceLevel() {
  const info = vocab.info();
  if (!info.canAdvance) return { ok: false, info };
  const r = setLevel(info.nextLevel);
  vocab.buildBatch();
  return { ok: true, level: r.level, info: vocab.info() };
}

/** 随机一个词（简单模式：不记进度、不进词本） */
/* ------------------------------ 主入口 ------------------------------ */
/**
 * @param {Array<{role:string,content:string}>} history 最近若干轮（不含 system）
 * @param {string} userText 本轮学习者输入
 * @param {"conv"|"teach"} mode
 */
async function chat(history, userText, mode = "conv", source = "text") {
  const provider = await pickProvider();

  if (provider.kind === "none") {
    return {
      ok: false,
      provider: "none",
      turn: {
        reply_ja: "",
        reply_zh: "",
        corrections: [],
        explain_zh:
          "还没有可用的语言模型：在项目根目录建一个 .env，写入\n" +
          "LLM_BASE_URL=https://api.deepseek.com/v1\nLLM_API_KEY=sk-...\nLLM_MODEL=deepseek-chat\n" +
          "（或用本地 Ollama：装好并 ollama pull qwen2.5:7b 即可自动识别）",
        words: [],
        next_question_ja: "",
      },
    };
  }

  if (provider.kind === "mock") {
    const conv = mode === "conv";
    return {
      ok: true, provider: "mock", model: "mock",
      turn: {
        reply_ja: conv ? "いいね、それで？" : "「は」は話題、「が」は新情報に焦点があります。",
        reply_zh: conv ? "不错啊，然后呢？" : "",
        corrections: [{ wrong: "私は学生です。", right: "私は学生。", why_zh: "口语里普通体更自然，です・ます留给正式场合" }],
        explain_zh: conv ? "" : "「は」提示已知话题，「が」强调新信息或主语。问「谁做的」用が，说「关于这个」用は。",
        words: [{ ja: "話題", kana: "わだい", zh: "话题" }],
        next_question_ja: conv ? "週末は何をした？" : "",
      },
    };
  }

  // 会話模式：从学过的词里挑 1–2 个，让模型自然带进回复（放不进去就跳过）
  let vocabTargets = [];
  if (mode === "conv") {
    try {
      vocabTargets = targets.pick({ level: CONF.level });
    } catch (e) {
      console.log("[targets] pick 失败:", e.message);   // 别静默：之前少 require 一直空跑
      vocabTargets = [];
    }
  }
  let memText = "";
  try {
    const mem = createMemory();
    mem.load();
    memText = mem.context(userText);
  } catch (e) { /* 记忆坏了不影响聊天 */ }
  const sys = systemPrompt(mode, CONF.level)
    + (memText ? "\n\n" + memText : "")
    + (vocabTargets.length ? "\n\n" + targets.block(vocabTargets) : "");
  const msgs = [{ role: "system", content: sys }];
  // 模式决定语言：进入 agent.chat 的都是日本語模式；解説一律可出黄卡
  const inputLang = "ja";
  if (mode !== "teach") {
    msgs.push({ role: "system", content: noCardPatch() });
  }
  const messages = [
    ...msgs,
    ...scenes.forMode(mode),
    ...history.slice(-16),   // 最近 8 轮（更早的靠 conv-memory / 摘要，见 P2 计划）
    { role: "user", content: userText },
  ];

  const body = {
    model: provider.model,
    messages,
    temperature: mode === "teach" ? 0.3 : 0.8,
    max_tokens: 700,
    response_format: { type: "json_object" },
  };

  try {
    const res = await fetch(`${provider.base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONF.timeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    if (j.usage) console.log('[usage]', JSON.stringify(j.usage));
    const finish = j.choices?.[0]?.finish_reason;
    if (finish && finish !== 'stop') console.log('[llm] finish_reason =', finish);
    const raw = j.choices?.[0]?.message?.content || "";
    const turn = finalizeTurn(parseTurn(raw), mode, inputLang);
    let used = [];
    if (vocabTargets.length) {
      try { used = targets.noteReply([turn.reply_ja, turn.next_question_ja].filter(Boolean).join(" "), vocabTargets); } catch (e) {}
      console.log("[targets] picked=" + vocabTargets.map((w) => w.ja).join("/") + " used=" + (used.join("/") || "-"));
    }
    return {
      ok: true, provider: provider.kind, model: provider.model, turn,
      targets: { picked: vocabTargets.map((w) => w.ja), used },
    };
  } catch (e) {
    // 有些兼容接口不支持 response_format，去掉重试一次
    try {
      delete body.response_format;
      const res2 = await fetch(`${provider.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONF.timeout),
      });
      const j2 = await res2.json();
      const raw2 = j2.choices?.[0]?.message?.content || "";
      return { ok: true, provider: provider.kind, model: provider.model, turn: finalizeTurn(parseTurn(raw2), mode, inputLang) };
    } catch (e2) {
      return {
        ok: false,
        provider: provider.kind,
        error: String(e2.message || e.message),
        turn: {
          reply_ja: "", reply_zh: "", corrections: [],
          explain_zh: "调用模型失败：" + String(e2.message || e.message).slice(0, 160),
          words: [], next_question_ja: "",
        },
      };
    }
  }
}

async function status() {
  const p = await pickProvider();
  return { ok: p.kind !== "none", provider: p.kind, model: p.model || null, level: CONF.level };
}

module.exports = { chat, extractMemory, status, parseTurn, testConnection, asrHotwords, cachedExample, levels, setWordLevel, setPatternLevel, syncGlobalLevel, availableLevels, patternNext, patternCheck, patternNew, patternToggle, patternInfo, patternAdvance, judgePattern, applyApiKey, applyProvider, CONF, getLevel, setLevel, levelToPool, LEVELS_ALL, book, curriculum, enrichBatch, dailyNext, dailyCheck, dailyAcceptAlt, dailyNew, dailyInfo, dailyToggle, dailyAdvanceLevel, dailyExample, cheer, miss, pair, casual };
