/* 例句（句型）模式的批次与判定
 *
 * 每日一批 5 个句型；「新規」换一批，「復習」只轮错题本。
 * 两种练习方式随机：
 *   reproduce 复现：给出日语例句，照着打
 *   compose   造句：给中文意思 + 句型，自己造一句（先 LLM 判，失败用规则兜底）
 */
const path = require("path");
const drill = require("./drill");
const patterns = require("./patterns");
const pb = require("./patternbook");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "pattern-daily.json");
const SIZE = 5;

const today = drill.today;

const EMPTY_DB = { date: "", level: "N5", ids: [], last: "", mode: "daily", stats: { right: 0, wrong: 0, skip: 0 } };

const store = drill.createStore({
  name: "pattern-daily",
  file: FILE,
  empty: () => ({ ...EMPTY_DB, stats: { ...EMPTY_DB.stats } }),
  normalize: (j) => ({
    ...EMPTY_DB, ...j,
    ids: Array.isArray(j.ids) ? j.ids : [],
    stats: j.stats || { right: 0, wrong: 0, skip: 0 },
  }),
});

const load = store.load;
const save = store.save;
const shuffle = drill.shuffle;

/** 例句模式有自己的一档（和单词的档位互不影响） */
function currentLevel() {
  const db = load();
  if (db.level) return db.level;
  try { return require("./llm").getLevel(); } catch (e) { return "N5"; }
}

const LEVEL_ORDER = ["N5", "N4", "N3", "N2", "N1"];

/** 下一档还有句型数据吗 */
function nextLevelInfo(level) {
  const i = LEVEL_ORDER.indexOf(level);
  if (i < 0 || i >= LEVEL_ORDER.length - 1) return { next: null, has: false };
  const next = LEVEL_ORDER[i + 1];
  return { next, has: patterns.all(next).length > 0 };
}

/** 直接设到某一档（下拉框用） */
function setLevel(level) {
  const lv = String(level || "").toUpperCase();
  if (!LEVEL_ORDER.includes(lv)) return { ok: false, level: currentLevel() };
  if (!patterns.all(lv).length) return { ok: false, level: currentLevel(), reason: `${lv} 的例文还没导入` };
  const db = load();
  const keepMode = db.mode;                 // 换档不该把復習状态清掉
  db.level = lv;
  db.date = "";          // 强制重建今天的批次
  save(db);
  build();
  if (keepMode === "review") { const d2 = load(); d2.mode = "review"; save(d2); }
  return { ok: true, level: lv, mode: keepMode || "daily" };
}

/** 升一档并重建批次；没有更高档数据时返回 false */
function advanceLevel() {
  const db = load();
  const { next, has } = nextLevelInfo(currentLevel());
  if (!next || !has) return { ok: false, level: currentLevel(), reason: next ? `${next} 的例文还没导入` : "已经是最高档" };
  db.level = next;
  save(db);
  build();                       // 按新档重建
  return { ok: true, level: next };
}

/* 一批 5 句，比例 学过/跳过 : 错误 : 新句型 = 0.5/0.5 : 1 : 3
 *   → 每条 5 句：新句型 3 + 错题 1 + （学过 1 / 跳过 1 轮流）
 *   学过与跳过是 0.5 位，用批号奇偶轮换，两批合起来正好 1:1
 */
const QUOTA = { newEach: 3, wrong: 1 };

function build() {
  const db = load();
  const level = currentLevel();
  const list = patterns.all(level);

  const rec = pb.load().words;
  const pools = pb.pools();
  const byId = new Map(list.map((x) => [x.id, x]));
  const inLevel = (r) => byId.has(r.id);   // 换档后旧档的错题/学过题不能继承

  const seq = (db.seq || 0) + 1;
  const rotating = seq % 2 === 0 ? "seen" : "skip";   // 学过 / 跳过 轮流

  const picked = new Set();
  const add = (items) => {
    for (const it of items) {
      if (it && picked.size < SIZE && !picked.has(it.id)) picked.add(it.id);
    }
  };
  const fromPool = (records, n) => records.filter(inLevel).map((r) => byId.get(r.id)).filter(Boolean).slice(0, n);

  // 先放确定的：错题 1 + 新句型 3
  add(fromPool(pools.wrong, QUOTA.wrong));

  const unseen = shuffle(list.filter((x) => !rec[x.id] && !picked.has(x.id)));
  add(unseen.slice(0, QUOTA.newEach));

  // 轮换位：学过 或 跳过（池子为空就顺延给新句型）
  add(fromPool(pools[rotating], 1));

  // 补位：新句型 → 任意
  add(shuffle(list.filter((x) => !rec[x.id] && !picked.has(x.id))));
  add(shuffle(list.filter((x) => !picked.has(x.id))));

  const ids = [...picked].slice(0, SIZE);
  const newIds = ids.filter((id) => !rec[id]);
  save({ date: today(), level, ids, last: "", mode: "daily", seq, rotating,
         answered: [], newIds, stats: { right: 0, wrong: 0, skip: 0 } });
  return load();
}

function ensureToday() {
  const db = load();
  if (drill.needBuild(db, { date: today(), batch: db.ids, currentLevel: currentLevel() })) return build();
  return db;
}

/** 当前档的错题（復習只轮这些） */
function wrongPoolForLevel() {
  const lv = currentLevel();
  const ids = new Set(patterns.all(lv).map((x) => x.id));
  return pb.pools().wrong.filter((r) => ids.has(r.id));
}

/** 抽一张卡：daily 从批次；review 只从错题本 */
function nextCard() {
  const db = ensureToday();
  let pool;
  if (db.mode === "review") {
    pool = wrongPoolForLevel().map((r) => r.id);
    if (!pool.length) return null;
  } else {
    pool = db.ids;
    if (!pool.length) return null;
  }
  const id = drill.pickAvoiding(pool, db.last);
  const card = patterns.card(id);
  if (!card) return null;
  db.last = id;
  db.probe = card.probe;          // 固定这道题的例句（判定时要用同一句）
  db.probeId = id;
  save(db);
  pb.markSeen(id);

  // 随机选一种练法；没有例句就只能造句
  const task = card.probe && Math.random() < 0.5 ? "reproduce" : "compose";
  const rec = pb.load().words[id] || {};
  const tag = db.mode === "review" ? "復習"
    : rec.stage === "wrong" ? "錯題"
    : rec.stage === "skip" ? "跳過" : "";
  return { ...card, task, tag, stats: db.stats, total: db.ids.length, mode: db.mode };
}

function statsOf(db) {
  return { right: db.stats.right || 0, wrong: db.stats.wrong || 0, skip: db.stats.skip || 0 };
}

/** 判定：reproduce 比对例句；compose 先规则，再交给上层 LLM（judge 回调） */
async function check(id, answer, { task = "compose", judge = null } = {}) {
  const db = load();
  const base = patterns.byId(id);
  if (!base) return { ok: false, error: "找不到这个句型" };
  // 用「这道题抽到的那句」；没有记录时固定用第一句，别每次随机
  const pinned = db.probeId === id && db.probe && db.probe.ja ? db.probe : null;
  const probe = pinned || {
    ja: base.examples[0]?.ja || "",
    zh: base.examples[0]?.zh || "",
    reading: base.examples[0]?.reading || "",
  };
  const card = { ...patterns.card(id), probe };
  const text = String(answer || "").trim();

  if (!text) {
    pb.grade(id, "skip");
    db.stats.skip += 1;
    save(db);
    return { ok: false, empty: true, stats: statsOf(db), card };
  }

  let ok = false;
  let hint = "";
  let review = null;        // 造句讲评（模型给的，可能为空）

  if (task === "reproduce" && card.probe) {
    ok = patterns.sameSentence(text, card.probe.ja, card.probe.reading);
    if (!ok) hint = "和例文对不上（汉字写法、全假名或混合写法都算对，标点空格不限）";
  } else {
    ok = patterns.ruleMatch(card.patternRaw || card.pattern, text, { id: card.id });   // 判定用原始句型；id 用来区分「〜な」这类同形句型
    if (!ok) hint = `句型「${card.pattern}」没出现`;
    else if (typeof judge === "function") {
      // 规则通过后再让模型看语义是否成立；模型失败就按规则的结果算
      const r = await judge({ pattern: card.pattern, meaning_zh: card.meaning_zh, sentence: text }).catch(() => null);
      if (r && typeof r.ok === "boolean") {
        ok = r.ok;
        hint = r.hint || "";
        review = {
          natural: r.natural || null,
          issues: Array.isArray(r.issues) ? r.issues : [],
          rewrite: r.rewrite || "",
          rewrite_zh: r.rewrite_zh || "",
        };
      }
    }
  }

  pb.grade(id, ok ? "ok" : "wrong");
  if (ok) db.stats.right += 1; else db.stats.wrong += 1;
  if (!Array.isArray(db.answered)) db.answered = [];
  if (!db.answered.includes(id)) db.answered.push(id);
  save(db);

  const newIds = db.newIds || [];
  const newDone = newIds.filter((x) => db.answered.includes(x)).length;
  const tierDone = db.mode === "daily" && (db.answered || []).length >= (db.ids || []).length;

  // 复现题才有唯一答案：顺带给键盘拼写（造句题不给，否则等于给答案）
  const expected = card.probe
    ? { ...card.probe, ...(task === "reproduce" && card.probe.reading
        ? { romaji: require("./romaji").kanaToRomaji(card.probe.reading) } : {}) }
    : card.probe;

  return {
    ok, hint, review, card, expected, stats: statsOf(db),
    answered: db.answered.length, total: db.ids.length,
    newDone, newQuota: newIds.length, justCompleted: tierDone,
  };
}

function toggleReview() {
  const db = load();
  const r = drill.toggleMode(db, {
    hasWrong: wrongPoolForLevel().length,
    refuseWhenEmpty: true,       // 例句错题本为空时不切（和单词模式不同）
  });
  if (!r.switched) return { mode: db.mode, wrongCount: 0, empty: true };
  if (db.mode === "daily") ensureToday();
  save(db);
  return { mode: db.mode, wrongCount: pb.pools().wrong.length };
}

function newBatch() {
  const db = load();
  if (db.mode === "review") { db.mode = "daily"; save(db); }   // 换批 = 退出復習
  return build();
}

function info() {
  const db = ensureToday();
  const level = currentLevel();
  const list = patterns.all(level);
  const rec = pb.load().words;
  // 只算练过的（至少判定过一次）
  const tierSeen = list.filter((x) => {
    const r = rec[x.id];
    return r && (r.ok > 0 || r.wrong > 0 || r.skip > 0);
  }).length;

  const answered = (db.answered || []);
  const newIds = db.newIds || [];
  return {
    mode: db.mode, total: db.ids.length, level, stats: statsOf(db),
    wrong: wrongPoolForLevel().length, poolStats: pb.stats(),
    tierSeen, tierTotal: list.length,
    answered: answered.length,
    newIds: newIds.length,
    newDone: newIds.filter((id) => answered.includes(id)).length,
    nextLevel: nextLevelInfo(level),
  };
}

module.exports = { nextCard, check, newBatch, toggleReview, info, ensureToday, build, setLevel, advanceLevel, wrongPoolForLevel, nextLevelInfo, currentLevel, today, LEVEL_ORDER, SIZE, FILE };
