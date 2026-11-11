/* 长期词库：每个词的累计状态 + 三个池子（错题 / 跳过 / 学过）
 *
 * 状态机（stage）：
 *   new   → 从未见过（不在词库里）
 *   skip  → 跳过过（空提交），还没有连续答对
 *   wrong → 答错过，streak < 2
 *   ok    → 连续答对 ≥ 2 次，已"毕业"
 *
 * 池子：
 *   wrongPool : stage === "wrong"
 *   skipPool  : stage === "skip"
 *   seenPool  : stage === "ok"
 */

const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./jsonfile");
const schema = require("./schema");
const log = require("./eventlog").createLog("wordbook");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "wordbook.json");
/** 间隔复习的步长（天）：答对升级，答错归零 */
const REVIEW_STEPS = [1, 3, 7, 14, 30, 60];
const GRADUATE_STREAK = 2;   // 连续答对几次算掌握

/** 第一次启用日志时，把现有快照存成基线（否则重放会丢掉历史） */
function maybeSeedBaseline(words) {
  try {
    if (fs.existsSync(log.BASELINE)) return;
    if (!words || !Object.keys(words).length) return;
    writeJsonAtomic(log.BASELINE, { words, at: new Date().toISOString(), offset: log.size() });
    console.log("[wordbook] 已写入日志基线:", Object.keys(words).length, "词");
  } catch (e) {}
}

/** 从事件日志重放，重建词库（快照损坏/丢失时用）
 *  接受两种输入：纯事件数组，或 eventlog.readAllWithOffset() 的 { ev, offset }
 */
function replay(entries) {
  // 基线：开启日志时的历史状态（没有就从空开始）
  let words = {};
  let baseOffset = -1;      // 字节水位线：偏移小于它的行已包含在基线里
  try {
    const base = JSON.parse(fs.readFileSync(log.BASELINE, "utf8"));
    if (base && base.words && typeof base.words === "object") words = JSON.parse(JSON.stringify(base.words));
    baseOffset = Number.isFinite(base && base.offset) ? base.offset : -1;
  } catch (e) {}

  for (const item of entries) {
    const ev = item && item.ev ? item.ev : item;
    const offset = item && typeof item.offset === "number" ? item.offset : Infinity;
    if (!ev || typeof ev.e !== "string") continue;
    if (baseOffset >= 0 && offset < baseOffset) continue;   // 已在基线里，别重复计数

    const ja = String(ev.ja || "").trim();
    if (!ja) continue;

    // 只见过的词（出现在批次里但没判定过）：建一条 new 记录，不动阶段
    if (ev.e === "seen") {
      const rec0 = words[ja] || {
        ja, kana: ev.kana || "", zh: "", pos: "", level: "",
        seen: 0, ok: 0, wrong: 0, skip: 0, streak: 0, lastAt: "", lastResult: "", stage: "new",
      };
      rec0.seen += 1;
      rec0.kana = rec0.kana || ev.kana || "";
      words[ja] = rec0;
      continue;
    }

    const result = ev.e === "skip" ? "skip" : ev.res;
    if (!["ok", "wrong", "skip"].includes(result)) continue;

    const rec = words[ja] || {
      ja, kana: ev.kana || "", zh: "", pos: "", level: "",
      seen: 0, ok: 0, wrong: 0, skip: 0, streak: 0, lastAt: "", lastResult: "", stage: "new",
    };
    rec.kana = rec.kana || ev.kana || "";
    applyResult(rec, result);
    rec.lastAt = ev.t || rec.lastAt;
    words[ja] = rec;
  }
  return { words };
}

// 日志轮转时，把基线重写成「当前快照 + offset 0」，否则新偏移会低于旧水位线
log.setRotateHook(() => {
  try {
    const cur = load();
    writeJsonAtomic(log.BASELINE, { words: cur.words, at: new Date().toISOString(), offset: 0 });
    console.log("[wordbook] 日志已轮转，基线已重写");
  } catch (e) {}
});

/** 基线水位线比日志文件还大 → 说明日志被轮转/替换过，重置水位线 */
function healBaselineIfStale(words) {
  try {
    const base = JSON.parse(fs.readFileSync(log.BASELINE, "utf8"));
    const off = Number(base && base.offset);
    if (Number.isFinite(off) && off > log.size()) {
      writeJsonAtomic(log.BASELINE, { words, at: new Date().toISOString(), offset: 0 });
      console.log("[wordbook] 基线水位线失效，已重置");
    }
  } catch (e) {}
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const m = schema.migrate("wordbook", j);
    if (m.newer) console.warn("[wordbook] 数据版本比程序新（v" + m.from + "），不做迁移");
    if (m.changed && !m.newer) {
      try { writeJsonAtomic(FILE, m.data); } catch (_) {}     // 补上 version，失败也无所谓
    }
    const words = m.data && typeof m.data.words === "object" && !Array.isArray(m.data.words) ? m.data.words : {};
    maybeSeedBaseline(words);
    healBaselineIfStale(words);
    return { words };
  } catch (e) {
    // 快照不存在或损坏 → 用「基线 + 日志」重放（哪怕日志为空，基线也能救回来）
    const events = log.readAllWithOffset();
    const hasBaseline = fs.existsSync(log.BASELINE);
    if (events.length || hasBaseline) {
      const rebuilt = replay(events);
      try { writeJsonAtomic(FILE, rebuilt); } catch (_) {}
      console.log("[wordbook] 快照损坏，已从事件日志重放:", Object.keys(rebuilt.words).length, "词");
      return rebuilt;
    }
    return { words: {} };
  }
}

function save(db) {
  writeJsonAtomic(FILE, schema.stamp("wordbook", db));   // 原子写，并带上 schema 版本
}

function touch(db, w) {
  const key = String(w.ja || "").trim();
  if (!key) return null;
  const rec = db.words[key] || {
    ja: key, kana: w.kana || "", zh: w.zh || "", pos: w.pos || "", level: w.level || "",
    seen: 0, ok: 0, wrong: 0, skip: 0, streak: 0, lastAt: "", lastResult: "", stage: "new",
    srsLevel: 0, dueAt: "",
  };
  // 补齐展示字段；读音必须是纯假名（早期数据里出现过 kana=汉字 的脏数据）
  const kanaOk = (v) => !!v && /[\u3040-\u30ff]/.test(v) && !/[\u4e00-\u9fff]/.test(v);
  if (kanaOk(w.kana)) rec.kana = w.kana;
  else rec.kana = rec.kana || "";
  rec.zh = rec.zh || w.zh || "";
  rec.pos = rec.pos || w.pos || "";
  rec.level = rec.level || w.level || "";
  rec.alts = Array.isArray(rec.alts) ? rec.alts : [];     // 用户确认过的其它写法
  if (Array.isArray(w.alts) && w.alts.length) {
    for (const a of w.alts) if (a && !rec.alts.includes(a)) rec.alts.push(a);
  }
  db.words[key] = rec;
  return rec;
}

/** alts 归一化：NFKC + 去空白 + 小写，用来比较 */
function normAlt(v) {
  return String(v || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** 列出所有带 alts 的词（设置窗口的「也算对记录」用） */
function listAlts() {
  const db = load();
  const out = [];
  for (const rec of Object.values(db.words || {})) {
    if (!Array.isArray(rec.alts) || !rec.alts.length) continue;
    out.push({ ja: rec.ja, kana: rec.kana || "", zh: rec.zh || "", alts: [...rec.alts] });
  }
  return out.sort((a, b) => a.ja.localeCompare(b.ja, "ja"));
}

/** 删掉某词的一条 alts（误点「这个也算对」后在这里清理） */
function removeAlt(ja, alt) {
  const db = load();
  const rec = db.words[String(ja || "").trim()];
  if (!rec) return { ok: false, error: "没有这个词" };
  const want = normAlt(alt);
  const before = Array.isArray(rec.alts) ? rec.alts : [];
  rec.alts = before.filter((x) => normAlt(x) !== want);
  if (rec.alts.length === before.length) return { ok: false, error: "没有这条写法" };
  log.append({ e: "alt-del", ja: rec.ja, alt: String(alt || "") });
  save(db);
  return { ok: true, alts: rec.alts };
}

/** 整体覆盖某词的 alts（用于管理界面的「添加/编辑」） */
function setAlts(ja, alts) {
  const db = load();
  const rec = db.words[String(ja || "").trim()];
  if (!rec) return { ok: false, error: "没有这个词" };
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(alts) ? alts : []) {
    const v = String(raw || "").trim();
    const n = normAlt(v);
    if (!v || !n) continue;
    if (n === normAlt(rec.ja) || n === normAlt(rec.kana)) continue;   // ja/kana 本来就对
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(v);
  }
  rec.alts = out;
  log.append({ e: "alt-set", ja: rec.ja, n: out.length });
  save(db);
  return { ok: true, alts: rec.alts };
}

/** 记住「这个也算对」：把用户写的其它写法加进该词的 alts */
function addAlt(ja, alt) {
  const db = load();
  const rec = db.words[String(ja || "").trim()];
  if (!rec) return null;
  const a = String(alt || "").trim();
  if (!a) return null;
  const norm = (v) => String(v || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (norm(a) === norm(rec.ja) || norm(a) === norm(rec.kana)) return rec.alts || [];
  rec.alts = Array.isArray(rec.alts) ? rec.alts : [];
  if (!rec.alts.some((x) => norm(x) === norm(a))) {
    rec.alts.push(a);
    log.append({ e: "alt", ja: rec.ja, alt: a });
    save(db);
  }
  return rec.alts;
}

/** 教过（进入批次就算见过） */
function markSeen(w) {
  const db = load();
  const rec = touch(db, w);
  if (rec) {
    rec.seen += 1;
    log.append({ e: "seen", ja: rec.ja, kana: rec.kana });
  }
  save(db);
  return rec;
}

/** 纯状态转移：grade() 与「日志重放」共用同一套规则 */
function applyResult(rec, result) {
  rec.lastResult = result;
  if (result === "ok") {
    rec.ok += 1;
    rec.streak += 1;
    // 连续答对 2 次才算掌握；只对 1 次仍留在原池子（跳过池/错题本）
    if (rec.streak >= GRADUATE_STREAK) rec.stage = "ok";
  } else if (result === "wrong") {
    rec.wrong += 1;
    rec.streak = 0;
    rec.stage = "wrong";
  } else {
    rec.skip += 1;
    rec.streak = 0;
    if (rec.stage !== "wrong") rec.stage = "skip";
  }
  return rec;
}

/** 安排下一次复习：
 *   ok   → srsLevel+1，按 1/3/7/14/30/60 天递进
 *   skip → 只顺延到明天，**不降级**（跳过是"这次没答"，不能当"不会"）
 *   wrong→ 归零，明天（真不会才惩罚）
 */
function scheduleReview(rec, result, now = new Date()) {
  const tomorrow = new Date(now.getTime() + 86400000).toISOString();
  if (result === "ok") {
    rec.srsLevel = Math.min((rec.srsLevel || 0) + 1, REVIEW_STEPS.length);
    const days = REVIEW_STEPS[rec.srsLevel - 1];
    rec.dueAt = new Date(now.getTime() + days * 86400000).toISOString();
  } else if (result === "skip") {
    rec.dueAt = tomorrow;                 // 保留等级，只推后一天
  } else {
    rec.srsLevel = 0;
    rec.dueAt = tomorrow;
  }
  return rec;
}

/** 判定结果写回 */
function grade(w, result) {   // result: "ok" | "wrong" | "skip"
  const db = load();
  const rec = touch(db, w);
  if (!rec) return null;
  rec.lastAt = new Date().toISOString();
  applyResult(rec, result);
  scheduleReview(rec, result);

  // 先记流水（append-only），再写快照
  log.append({ e: result === "skip" ? "skip" : "grade", ja: rec.ja, kana: rec.kana, res: result });
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
  // 错题按「错得多 + 久未练」优先
  wrong.sort((a, b) => (b.wrong - a.wrong) || String(a.lastAt).localeCompare(String(b.lastAt)));
  skip.sort((a, b) => (b.skip - a.skip) || String(a.lastAt).localeCompare(String(b.lastAt)));
  seen.sort((a, b) => String(a.lastAt).localeCompare(String(b.lastAt)));
  return { wrong, skip, seen };
}

function stats() {
  const p = pools();
  const total = Object.keys(load().words).length;
  return { total, wrong: p.wrong.length, skip: p.skip.length, seen: p.seen.length };
}

function has(ja) {
  return !!load().words[String(ja || "").trim()];
}

module.exports = { addAlt, listAlts, removeAlt, setAlts, REVIEW_STEPS, scheduleReview, markSeen, grade, applyResult, replay, pools, stats, has, load, save, GRADUATE_STREAK, FILE };
