/* 句型的状态记录（独立于单词词库，复習互不干扰）
 *
 *   data/patternbook.json: { words: { "<patternId>": { ...seen/ok/wrong/skip/streak/stage } } }
 *
 * 状态机复用 wordbook.applyResult：连对 2 次毕业、答错清零。
 */
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./jsonfile");
const schema = require("./schema");
const { applyResult, GRADUATE_STREAK } = require("./wordbook");
const patterns = require("./patterns");
const log = require("./eventlog").createLog("patternbook");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "patternbook.json");

/** 第一次启用日志时，把现有快照存成基线 */
function maybeSeedBaseline(words) {
  try {
    if (fs.existsSync(log.BASELINE)) return;
    if (!words || !Object.keys(words).length) return;
    writeJsonAtomic(log.BASELINE, { words, at: new Date().toISOString(), offset: log.size() });
  } catch (e) {}
}

/** 从「基线 + 日志」重放 */
function replay(entries) {
  let words = {};
  let baseOffset = -1;
  try {
    const base = JSON.parse(fs.readFileSync(log.BASELINE, "utf8"));
    if (base && base.words) words = JSON.parse(JSON.stringify(base.words));
    baseOffset = Number.isFinite(base && base.offset) ? base.offset : -1;
  } catch (e) {}

  for (const item of entries) {
    const ev = item && item.ev ? item.ev : item;
    const offset = item && typeof item.offset === "number" ? item.offset : Infinity;
    if (!ev || (baseOffset >= 0 && offset < baseOffset)) continue;
    const id = String(ev.id || "").trim();
    if (!id) continue;

    const it = patterns.byId(id);
    const rec = words[id] || (it ? {
      id, pattern: it.pattern, level: it.level,
      seen: 0, ok: 0, wrong: 0, skip: 0, streak: 0, lastAt: "", lastResult: "", stage: "new",
    } : null);
    if (!rec) continue;

    if (ev.e === "seen") { rec.seen += 1; words[id] = rec; continue; }
    const result = ev.e === "skip" ? "skip" : ev.res;
    if (!["ok", "wrong", "skip"].includes(result)) continue;
    applyResult(rec, result);
    rec.lastAt = ev.t || rec.lastAt;
    words[id] = rec;
  }
  return { words };
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const m = schema.migrate("patternbook", j);
    if (m.newer) console.warn("[patternbook] 数据版本比程序新（v" + m.from + "），不做迁移");
    if (m.changed && !m.newer) { try { writeJsonAtomic(FILE, m.data); } catch (_) {} }
    const words = m.data && typeof m.data.words === "object" && !Array.isArray(m.data.words) ? m.data.words : {};
    maybeSeedBaseline(words);
    return { words };
  } catch (e) {
    // 快照坏了 → 用日志重放（有基线就不用清零）
    const entries = log.readAllWithOffset();
    if (entries.length || fs.existsSync(log.BASELINE)) {
      const rebuilt = replay(entries);
      try { writeJsonAtomic(FILE, rebuilt); } catch (_) {}
      return rebuilt;
    }
    return { words: {} };
  }
}

function save(db) { writeJsonAtomic(FILE, schema.stamp("patternbook", db)); }

function touch(db, id) {
  if (!db.words[id]) {
    const it = patterns.byId(id);
    if (!it) return null;
    db.words[id] = {
      id, pattern: it.pattern, level: it.level,
      seen: 0, ok: 0, wrong: 0, skip: 0, streak: 0,
      lastAt: "", lastResult: "", stage: "new",
    };
  }
  return db.words[id];
}

function markSeen(id) {
  const db = load();
  const rec = touch(db, id);
  if (rec) {
    rec.seen += 1;
    log.append({ e: "seen", id });
  }
  save(db);
  return rec;
}

function grade(id, result) {
  const db = load();
  const rec = touch(db, id);
  if (!rec) return null;
  rec.lastAt = new Date().toISOString();
  applyResult(rec, result);
  log.append({ e: result === "skip" ? "skip" : "grade", id, res: result });
  save(db);
  return rec;
}

function pools() {
  const db = load();
  const wrong = [], skip = [], seen = [];
  for (const rec of Object.values(db.words)) {
    if (rec.stage === "wrong") wrong.push(rec);
    else if (rec.stage === "skip") skip.push(rec);
    else if (rec.stage === "ok") seen.push(rec);
  }
  wrong.sort((a, b) => (b.wrong - a.wrong) || String(a.lastAt).localeCompare(String(b.lastAt)));
  skip.sort((a, b) => (b.skip - a.skip) || String(a.lastAt).localeCompare(String(b.lastAt)));
  seen.sort((a, b) => String(a.lastAt).localeCompare(String(b.lastAt)));
  return { wrong, skip, seen };
}

function stats() {
  const p = pools();
  return { total: Object.keys(load().words).length, wrong: p.wrong.length, skip: p.skip.length, seen: p.seen.length };
}

log.setRotateHook(() => {
  try {
    const cur = load();
    writeJsonAtomic(log.BASELINE, { words: cur.words, at: new Date().toISOString(), offset: 0 });
  } catch (e) {}
});

module.exports = { markSeen, grade, replay, pools, stats, load, save, GRADUATE_STREAK, FILE };
