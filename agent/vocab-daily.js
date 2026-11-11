/* 毎日の 20 詞 + 復習モード
 *
 * 每日配额（固定，不做补偿 - 池子不够就少几个）：
 *   新词 10 / 错题本 6 / 跳过池 2 / 学过 2
 *
 * 復習模式：只轮错题本，连续答对 2 次移出。
 */

const fs = require("fs");
const path = require("path");
const curriculum = require("./curriculum");
const book = require("./wordbook");
const { kanaToRomaji, toHiragana } = require("./romaji");
const { writeJsonAtomic } = require("./jsonfile");
const schema = require("./schema");
const drill = require("./drill");
const log = require("./eventlog").createLog("wordbook");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "vocab-daily.json");

const TOTAL = 20;
const QUOTA = { news: 10, wrong: 6, skip: 2, seen: 2 };

const KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/;
const today = drill.today;   // 本地日期（drill 统一实现）

const isKanaOnly = (v) => {
  const t = String(v || "").trim();
  return !!t && /[\u3040-\u30ff]/.test(t) && !/[A-Za-z\u4e00-\u9fff]/.test(t);
};

function readingOf(w) {
  const kana = String(w.kana || "").trim();
  if (isKanaOnly(kana)) return kana;
  const ja = String(w.ja || "").trim();
  if (ja && KANA_RE.test(ja)) return toHiragana(ja);
  return kana || ja;
}

/** 词库记录可能缺字段（早期数据），用词表补齐 */
function enrich(w) {
  const full = curriculum.words().find((x) => x.ja === w.ja);
  if (!full) return w;
  return { ...full, ...w, kana: w.kana || full.kana, zh: w.zh || full.zh, pos: w.pos || full.pos, level: w.level || full.level };
}

function toCard(w, source) {
  w = enrich(w);
  const full = curriculum.words().find((x) => x.ja === w.ja);
  const kana = isKanaOnly(full && full.kana) ? full.kana : readingOf(w);
  return {
    ja: w.ja,
    kana,
    zh: w.zh || "",
    pos: w.pos || "",
    level: w.level || "",
    romaji: kanaToRomaji(kana),
    source,                       // new / wrong / skip / seen
  };
}

function emptyDb() {
  return { date: "", batch: [], last: "", mode: "daily", today: { ok: [], wrong: [], skip: [] } };
}

const LV_ORDER = ["N5", "N4", "N3", "N2", "N1"];

// N5–N4 在词表里是合并的；用 OpenJLPT 的分级表把它拆开（见 tools/build-word-levels.mjs）
let _wordLevels = null;
function wordLevels() {
  if (_wordLevels) return _wordLevels;
  try {
    const f = path.join(DATA_DIR, "word-levels.json");
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    _wordLevels = j.levels || {};
  } catch (e) { _wordLevels = {}; }
  return _wordLevels;
}

/** 单词模式自己的档位（和句型、全局互不影响） */
function currentWordLevel() {
  const db = load();
  if (db.level) return db.level;
  try { return require("./llm").getLevel(); } catch (e) { return "N5"; }
}

/** 设置单词档位并重建批次 */
function setWordLevel(level) {
  const lv = String(level || "").toUpperCase();
  if (!LV_ORDER.includes(lv)) return { ok: false, level: currentWordLevel() };
  const db = load();
  db.level = lv;
  db.date = "";          // 强制重建今天的批次
  save(db);
  buildBatch(true);
  return { ok: true, level: currentWordLevel() };
}

const store = drill.createStore({
  name: "vocab-daily",
  file: FILE,
  empty: emptyDb,
  normalize: (j) => ({
    ...j,
    date: j.date || "",
    batch: Array.isArray(j.batch) ? j.batch : [],
    last: j.last || "",
    mode: j.mode === "review" ? "review" : "daily",
    today: j.today || { ok: [], wrong: [], skip: [] },
  }),
});

const load = store.load;
const save = store.save;
const shuffle = drill.shuffle;
const sample = drill.sample;

function tierOf() {
  // 用「单词自己的档位」，不要用全局档位
  try { return require("./llm").levelToPool(currentWordLevel()); } catch (e) { return 0; }
}

/** 当前单词档位的词表（拆分表 + 兜底）；进度分母和抽词都用它 */
function wordsOfCurrentLevel() {
  const tierList = curriculum.levelList(tierOf());
  const split = wordLevels();
  if (!Object.keys(split).length) return tierList;

  const lv = currentWordLevel();
  if (lv !== "N5" && lv !== "N4") return tierList;

  // N5 / N4 用拆分表；表里没有的（多为数字、月份）统一兜底到 N4，
  // 保证去重后的 1548 个词一个都不丢、也不重复计数
  return tierList.filter((w) => {
    const mapped = split[w.ja];
    if (mapped) return mapped === lv;
    return lv === "N4";
  });
}

/** 当前档的词（用于错题本按档筛选） */
function currentLevelSet() {
  return new Set(wordsOfCurrentLevel().map((w) => w.ja));
}

/** 当前档的错题（復習只轮这些） */
function wrongPoolForLevel() {
  const set = currentLevelSet();
  return book.pools().wrong.filter((w) => set.has(w.ja));
}

/** 该档还没学过的新词 */
function freshPool() {
  const taught = book.load().words;
  return wordsOfCurrentLevel().filter((w) => !taught[w.ja]);
}

/** 到期复习：没有 dueAt 的旧数据视为到期（升级后第一次会补一轮） */
function isDue(rec, now = Date.now()) {
  if (!rec || !rec.dueAt) return true;
  const t = Date.parse(rec.dueAt);
  return !Number.isFinite(t) || t <= now;
}

/** 组今日批次 */
function buildBatch(keepMode = false) {
  const db = load();
  const prevMode = db.mode;
  const p = book.pools();
  const level = currentWordLevel();
  const levelSet = currentLevelSet();
  // 老记录没有 level 字段：保留；
  // N5–N4 是合并档，必须按当前档词集合判断，不能字符串比较。
  const inLevel = (w) => {
    if (!w.level) return true;
    if (levelSet.has(w.ja)) return true;
    return String(w.level).toUpperCase() === level;
  };
  const seenLevel = p.seen.filter(inLevel);
  const wrongLevel = p.wrong.filter(inLevel);
  const skipLevel = p.skip.filter(inLevel);
  const fresh = freshPool();

  // 学过池：到期的排前面（到期多时多给 2 个复习位，从新词配额里匀）
  const now = Date.now();
  const seenSorted = [...seenLevel].sort((a, b) => {
    const da = isDue(a, now) ? 0 : 1;
    const dbb = isDue(b, now) ? 0 : 1;
    if (da !== dbb) return da - dbb;
    return String(a.dueAt || "").localeCompare(String(b.dueAt || ""));
  });
  const dueCount = seenSorted.filter((r) => isDue(r, now)).length;
  const seenQuota = QUOTA.seen + (dueCount >= 2 ? 2 : 0);
  const newsQuota = Math.max(0, QUOTA.news - (seenQuota - QUOTA.seen));

  const news = sample(fresh, Math.min(newsQuota, fresh.length)).map((w) => toCard(w, "new"));
  let left = TOTAL - news.length;

  const picked = new Set(news.map((w) => w.ja));
  const takeFrom = (list, cap) => {
    const out = [];
    for (const w of list) {
      if (out.length >= cap || left <= 0) break;
      if (picked.has(w.ja)) continue;
      out.push(toCard(w, ""));
      picked.add(w.ja);
      left -= 1;
    }
    return out;
  };

  let wrong, skip, seen;
  if (fresh.length < QUOTA.news) {
    // 新词不够了：按「错题 → 空题(跳过) → 其他见过的词」顺序补满 20 个
    wrong = takeFrom(wrongLevel, left);
    skip = takeFrom(skipLevel, left);
    seen = takeFrom(seenSorted, left);
  } else {
    // 正常情况：固定配额，缺了不补
    wrong = wrongLevel.slice(0, QUOTA.wrong).map((w) => toCard(w, "wrong"));
    skip = skipLevel.slice(0, QUOTA.skip).map((w) => toCard(w, "skip"));
    seen = seenSorted.slice(0, seenQuota).map((w) => toCard(w, "seen"));
  }
  wrong.forEach((w) => (w.source = "wrong"));
  skip.forEach((w) => (w.source = "skip"));
  seen.forEach((w) => (w.source = "seen"));

  const batch = shuffle([...news, ...wrong, ...skip, ...seen]);
  // 新词标记为"教过"
  for (const w of news) book.markSeen(w);
  // 已毕业的词如果这轮又出现，重新计入
  for (const w of [...wrong, ...skip, ...seen]) book.markSeen(w);

  db.date = today();
  db.batch = batch;
  db.last = "";
  db.mode = keepMode ? prevMode : "daily";
  db.announced = false;
  db.today = { ok: [], wrong: [], skip: [] };   // 按单词统计，不是按次数
  save(db);
  log.append({ e: "batch", date: db.date, n: db.batch.length });
  return db;
}

function ensureToday() {
  const db = load();
  if (drill.needBuild(db, { date: today(), batch: db.batch })) return buildBatch(true);   // 保留 daily/review
  return db;
}

function newBatch() { return buildBatch(); }

/** 抽一张卡：daily 从批次里抽；review 只从错题本抽 */
function nextCard() {
  const db = ensureToday();
  let pool;
  if (db.mode === "review") {
    pool = wrongPoolForLevel();
    if (!pool.length) return null;
  } else {
    pool = db.batch;
    if (!pool.length) return null;
  }
  const w = drill.pickAvoiding(pool, db.last, (x) => x.ja);
  if (!w) return null;
  db.last = w.ja;
  save(db);
  const card = toCard(w, db.mode === "review" ? "review" : (w.source || "new"));
  // 例句缓存命中就一起发出去：卡片一次渲染到位，不用再补一次
  try {
    const ex = require("./llm").cachedExample(card);
    if (ex) Object.assign(card, ex);
  } catch (e) {}
  return { ...card, stats: db.stats };
}

function norm(s) {
  return String(s || "")
    .normalize("NFKC")
    // 和 patterns.normalize 用同一套：标点/空白都不算错（语音输入常带顿号）
    .replace(/[\s、。，．,.!！?？「」『』（）()・…]/g, "")
    .trim()
    .toLowerCase();
}

/** 判定 + 写回词库 */
function check(word, answer) {
  const reading = readingOf(word || {});
  const a = norm(answer);
  const db = load();

  db.today = db.today || { ok: [], wrong: [], skip: [] };
  const markToday = (ja, kind) => {
    for (const k of ["ok", "wrong", "skip"]) db.today[k] = db.today[k].filter((x) => x !== ja);
    if (kind) db.today[kind].push(ja);
  };

  if (a === "") {
    book.grade(word, "skip");
    markToday(word.ja, "skip");
    save(db);
    return { ok: false, empty: true, expected: { ...word, kana: reading, romaji: kanaToRomaji(reading) } };
  }

  const normJa = (v) => norm(toHiragana(String(v || "")));
  const rec = book.load().words[word.ja] || {};
  const accepted = [word.ja, word.kana, reading, ...(rec.alts || []), ...(word.alts || [])]
    .map(normJa).filter(Boolean);
  const ok = accepted.includes(normJa(answer));

  // 「这个也算对」：答案含汉字、且读音完全一致时出现（不限于纯假名卡片）
  // 典型场景：ASR 把「橋」听成「箸」、或你写了同一词的另一种汉字写法。
  // 读音靠 kuromoji（agent/reading.js）；没预热好就不出现（不猜）。
  let altCandidate = false;
  if (!ok && /[\u4e00-\u9fff]/.test(String(answer || ""))) {
    try {
      const reading = require("./reading");
      if (reading.ready()) {
        const rk = reading.toKana(answer);
        altCandidate = !!rk && normJa(rk) === normJa(readingOf(word));
      }
    } catch (e) { altCandidate = false; }
  }

  const wrongBefore = book.pools().wrong.length;
  book.grade(word, ok ? "ok" : "wrong");
  const wrongAfter = book.pools().wrong.length;
  // 復習模式下把最后一个错题做掉 → 自动回到每日
  const finishedReview = db.mode === "review" && wrongBefore > 0 && wrongAfter === 0;
  if (finishedReview) db.mode = "daily";
  // 最终答对就算对：从 wrong 里移出，计入 ok
  markToday(word.ja, ok ? "ok" : "wrong");

  // 这一批是不是全答过了（用于"今日总结"）
  const answered = new Set([...db.today.ok, ...db.today.wrong, ...db.today.skip]);
  const allDone = db.batch.length > 0 && db.batch.every((w) => answered.has(w.ja));
  const justCompleted = allDone && !db.announced;
  if (justCompleted) db.announced = true;
  save(db);
  return {
    ok, empty: false,
    expected: { ...word, kana: reading, romaji: kanaToRomaji(reading) },
    stats: todayStatsOf(db),
    justCompleted,
    finishedReview,
    altCandidate,
    graduated: ok ? book.load().words[word.ja]?.stage === "ok" : false,
  };
}

/** 「这个也算对（记住）」：把用户写法记进 alts，然后按同一答案重新判一次 */
function acceptAlt(word, answer) {
  const alt = String(answer || "").trim();
  if (!alt || !word || !word.ja) return { ok: false, error: '空答案' };
  book.addAlt(word.ja, alt);
  return check(word, answer);
}

/** 切换復習模式 */
function toggleReview() {
  const db = load();
  drill.toggleMode(db, { onSwitch: (d) => log.append({ e: "review", on: d.mode === "review" }) });
  if (db.mode === "daily") ensureToday();
  save(db);
  return { mode: db.mode, wrongCount: book.pools().wrong.length };
}

function info() {
  const db = load();
  const p = book.pools();
  const fresh = freshPool().length;

  // 当前档位：见过多少个词 / 该档总词数
  const tier = tierOf();
  const tierList = curriculum.levelList(tier);
  const taught = book.load().words;
  let level = "N5";
  try { level = currentWordLevel(); } catch (e) {}

  // 进度按「选中的那一档」统计，和抽词同一个口径
  const counted = wordsOfCurrentLevel();
  // 只算「练过」的词（至少判定过一次），单纯组批出现不算，否则一清空就跳 10
  let tierSeen = 0;
  for (const w of counted) {
    const r = taught[w.ja];
    if (r && (r.ok > 0 || r.wrong > 0 || r.skip > 0)) tierSeen += 1;
  }
  const answered = new Set([...(db.today?.ok || []), ...(db.today?.wrong || []), ...(db.today?.skip || [])]);
  const newWords = db.batch.filter((w) => w.source === "new");
  const newDone = newWords.filter((w) => answered.has(w.ja)).length;
  const prog = drill.batchProgress(db.batch.map((w) => w.ja), answered);
  const batchDone = prog.done;
  const allDone = prog.allDone;

  const todayStats = {
    right: (db.today?.ok || []).length,
    wrong: (db.today?.wrong || []).length,
    skip: (db.today?.skip || []).length,
  };
  return {
    mode: db.mode, total: db.batch.length, stats: todayStats,
    batch: db.batch.map((w) => w.ja),          // 当天批次的词（ASR 热词要用）
    tierSeen, tierTotal: counted.length,
    newDone, newTotal: newWords.length, batchDone, batchTotal: db.batch.length,
    allDone, announced: !!db.announced,
    pools: {
      wrong: wrongPoolForLevel().length,     // 只算当前档的错题
      skip: p.skip.length,
      seen: p.seen.length,
    },
    fresh, level, nextLevel: LV_ORDER[Math.min(LV_ORDER.indexOf(level) + 1, LV_ORDER.length - 1)],
    canAdvance: fresh < QUOTA.news && level !== "N1",
  };
}

function todayStatsOf(db) {
  return {
    right: (db.today?.ok || []).length,
    wrong: (db.today?.wrong || []).length,
    skip: (db.today?.skip || []).length,
  };
}

/* 夸奖 / 鼓励台词池：内置 15 条，取「最近 10 句没说过」的，短期不重复
 * （之前这套被词库重构时删掉了，导致 cheer/miss 调 pickPoolLine 直接抛错，
 *   界面一直退回写死的兜底句） */
const BUILTIN = {
  cheer: [
    "せいかい！すごいね", "その調子！", "ぴったりだよ", "やったね！", "バッチリ！",
    "よくできました", "うん、正解！", "さすがだね", "いいね、その調子", "完璧だよ",
    "おみごと！", "すばらしい！", "うまい！", "そのとおり！", "よく覚えてたね",
  ],
  miss: [
    "おしい！", "あとちょっと！", "ざんねん、もう一回！", "ドンマイ！", "ちがうけど、いい感じ",
    "もういちどやってみよう", "だいじょうぶ、ゆっくりで", "おしいね、でも近いよ", "こんどはできるよ",
    "ゆっくり書いてみて", "あせらないで、もう一回", "もう一度トライ！", "よく見て、もう一回",
    "ここがポイントだよ", "だんだん合ってるよ",
  ],
};

/** 取一句没人说过的台词（最近 10 句避开） */
function pickPoolLine(kind) {
  const db = load();
  db.usedLines = db.usedLines || { cheer: [], miss: [] };
  const used = db.usedLines[kind] || [];

  const pool = BUILTIN[kind] || [];
  if (!pool.length) return "";
  const recent = new Set(used.slice(0, Math.min(10, pool.length - 1)));
  let candidates = pool.filter((l) => !recent.has(l));
  if (!candidates.length) candidates = pool.slice();

  const line = candidates[Math.floor(Math.random() * candidates.length)];
  // 只改内存，等下一次 check()/nextCard() 的 save 一起落盘
  // （一轮答题原本是 check + pickPoolLine 两次原子写，现在合成一次）
  db.usedLines[kind] = [line, ...used].slice(0, 20);
  return line;
}

module.exports = { nextCard, check, acceptAlt, newBatch, toggleReview, info, ensureToday, buildBatch, today, pickPoolLine, currentWordLevel, setWordLevel, wordsOfCurrentLevel, wrongPoolForLevel, currentLevelSet, LV_ORDER, BUILTIN, TOTAL, QUOTA, FILE };
