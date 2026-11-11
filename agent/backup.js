/* 学习数据的导出 / 导入 / 重置（设置窗口用）
 *
 *   data/backup/<原因>-YYYYMMDD-HHMMSS.json   每次导出/导入/重置前都留一份，保留最近 7 个
 *
 * 打包内容：wordbook / patternbook / vocab-daily / pattern-daily / settings
 */
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./jsonfile");
const schema = require("./schema");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const BACKUP_DIR = path.join(DATA_DIR, "backup");
const KEEP = 7;

const FILES = {
  wordbook: "wordbook.json",
  patternbook: "patternbook.json",
  vocabDaily: "vocab-daily.json",
  patternDaily: "pattern-daily.json",
  settings: "settings.json",
};

/** 备份字段名 → schema 名（两者历史上不一致，这里显式映射） */
const SCHEMA_NAME = {
  wordbook: "wordbook",
  patternbook: "patternbook",
  vocabDaily: "vocab-daily",
  patternDaily: "pattern-daily",
  settings: "settings",
};

/** 导入/恢复前把旧数据迁到当前 schema（没有 version 的旧文件也能直接用） */
function migrateSection(name, value) {
  if (value == null) return value;
  const m = schema.migrate(SCHEMA_NAME[name], value);
  return m.newer ? value : m.data;      // 比程序新就原样写回，不降级
}

function read(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, FILES[name]), "utf8")); } catch (e) { return null; }
}

function write(name, value) {
  if (value == null) return;
  writeJsonAtomic(path.join(DATA_DIR, FILES[name]), value);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  // 带上毫秒：同一秒内连续操作也不会互相覆盖
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${ms}`;
}

function snapshot(reason = "auto") {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const at = new Date().toISOString();
    const body = { version: 1, at, reason };
    for (const k of Object.keys(FILES)) body[k] = read(k);
    const file = path.join(BACKUP_DIR, `${reason}-${stamp()}.json`);
    writeJsonAtomic(file, body);
    prune();
    return { ok: true, file, at };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function list() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const full = path.join(BACKUP_DIR, f);
        const st = fs.statSync(full);
        return { file: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch (e) { return []; }
}

function prune() {
  const files = list();
  for (const f of files.slice(KEEP)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.file)); } catch (e) {}
  }
}

/** 当前进度概况（给设置窗口显示） */
function info() {
  const wb = read("wordbook");
  const pb = read("patternbook");
  const words = wb && wb.words ? Object.keys(wb.words).length : 0;
  const patterns = pb && pb.words ? Object.keys(pb.words).length : 0;
  const backups = list();
  return {
    ok: true,
    dir: DATA_DIR,
    words,
    patterns,
    wrongWords: wb ? Object.values(wb.words || {}).filter((x) => x.stage === "wrong").length : 0,
    wrongPatterns: pb ? Object.values(pb.words || {}).filter((x) => x.stage === "wrong").length : 0,
    backups: backups.slice(0, KEEP),
    backupCount: backups.length,
  };
}

function exportAll() {
  const at = new Date().toISOString();
  const body = { version: 1, at, kind: "nihonco-export" };
  for (const k of Object.keys(FILES)) body[k] = read(k);
  return { ok: true, body, at };
}

/** 校验结构：能接受导出文件，也能接受自动备份文件（备份没有 kind） */
function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "内容不是对象";
  const isExport = body.kind === "nihonco-export";
  const hasBook = body.wordbook || body.patternbook;
  if (!isExport && !hasBook) return "不是 Nihonco 的导出或备份文件";

  for (const k of ["wordbook", "patternbook"]) {
    const v = body[k];
    if (v == null) continue;
    if (typeof v !== "object" || Array.isArray(v) || typeof v.words !== "object" || Array.isArray(v.words)) {
      return `${k} 格式不对（应为 { words: {...} }）`;
    }
  }
  for (const k of ["vocabDaily", "patternDaily", "settings"]) {
    const v = body[k];
    if (v == null) continue;
    if (typeof v !== "object" || Array.isArray(v)) return `${k} 格式不对（应为对象）`;
  }
  return null;
}

/** 导入前先备份当前状态，再写回 */
function importAll(body) {
  const err = validate(body);
  if (err) return { ok: false, error: err };
  const saved = snapshot("before-import");
  for (const k of Object.keys(FILES)) write(k, migrateSection(k, body[k]));
  return { ok: true, backup: saved.file, ...info() };
}

/** 从自动备份文件恢复（设置窗口的「从备份恢复」用） */
function restoreBackup(file) {
  const name = String(file || "").split("/").pop();
  const full = path.join(BACKUP_DIR, name);
  if (!name || !fs.existsSync(full)) return { ok: false, error: "找不到这个备份" };
  try {
    const body = JSON.parse(fs.readFileSync(full, "utf8"));
    const err = validate(body);
    if (err) return { ok: false, error: err };
    const saved = snapshot("before-restore");
    for (const k of Object.keys(FILES)) write(k, migrateSection(k, body[k]));
    return { ok: true, backup: saved.file, restored: name, ...info() };
  } catch (e) {
    return { ok: false, error: "备份文件读不出来：" + e.message };
  }
}

/** 重置后把日志水位线推到当前状态，避免「快照坏了重放又复活」 */
function syncBaselines() {
  try {
    const log = require("./eventlog").createLog("wordbook");
    writeJsonAtomic(log.BASELINE, { words: (read("wordbook") || {}).words || {}, at: new Date().toISOString(), offset: log.size() });
  } catch (e) {}
  try {
    const log = require("./eventlog").createLog("patternbook");
    writeJsonAtomic(log.BASELINE, { words: (read("patternbook") || {}).words || {}, at: new Date().toISOString(), offset: log.size() });
  } catch (e) {}
}

function resetAll() {
  const saved = snapshot("before-reset-all");
  for (const k of ["wordbook", "patternbook"]) write(k, { words: {} });
  for (const k of ["vocabDaily", "patternDaily"]) write(k, {});
  syncBaselines();                       // 日志水位线跟上，否则重放会把清掉的进度又拉回来
  return { ok: true, scope: "all", backup: saved.file, ...info() };
}

/** 只清当前档位：单词按「当前单词档位」的词表、句型按「当前例句档位」 */
function resetLevel() {
  const saved = snapshot("before-reset-level");

  let wordLevel = "N5", patternLevel = "N5", removedWords = 0, removedPatterns = 0;

  try {
    const vocab = require("./vocab-daily");
    const book = require("./wordbook");
    wordLevel = vocab.currentWordLevel();
    const inLevel = new Set(vocab.wordsOfCurrentLevel().map((w) => w.ja));
    const db = book.load();
    for (const ja of Object.keys(db.words || {})) {
      if (inLevel.has(ja)) { delete db.words[ja]; removedWords += 1; }
    }
    book.save(db);
  } catch (e) {}

  try {
    const patterns = require("./patterns");
    const pbook = require("./patternbook");
    const pd = require("./pattern-daily");
    patternLevel = pd.currentLevel();
    const ids = new Set(patterns.all(patternLevel).map((x) => x.id));
    const db = pbook.load();
    for (const id of Object.keys(db.words || {})) {
      if (ids.has(id)) { delete db.words[id]; removedPatterns += 1; }
    }
    pbook.save(db);
  } catch (e) {}

  // 今日批次也一起作废，否则界面还挂着已经清掉的卡
  write("vocabDaily", {});
  write("patternDaily", {});
  syncBaselines();

  return { ok: true, scope: "level", wordLevel, patternLevel, removedWords, removedPatterns, backup: saved.file, ...info() };
}

module.exports = { info, exportAll, importAll, restoreBackup, validate, resetAll, resetLevel, snapshot, list, BACKUP_DIR, KEEP };
