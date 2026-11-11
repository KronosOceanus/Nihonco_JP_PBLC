/* 课程：真实 JLPT 词表驱动（data/jlpt.json，原始 10,169 条 / 去重后 10,109 词）
 *
 * 数据来源：@polyglot-bundles/ja-jlpt-syllabi（egg rolls JLPT 10k v3）
 * 分级（原始）：N5–N4（1568）/ N3（1588）/ N2（2931）/ N1（4082）
 *      注意：原始数据把 N5 与 N4 合并了，无法再拆，这里如实标成「N5–N4」。
 * 去重：原始数据里有 60 条重复词（同一 ja 出现多次，N5–N4 档占 20 条），
 *      加载时按 ja 去重（保留第一条），否则同一天可能抽到同一个词两次。
 *      去重后：N5–N4（1548）/ N3（1573）/ N2（2921）/ N1（4067）。
 *
 * 状态文件 data/curriculum.json：{ levelIndex, offset, taught: [] }
 */

const fs = require("fs");
const path = require("path");
const book = require("./wordbook");
const { writeJsonAtomic } = require("./jsonfile");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "curriculum.json");
const JLPT = path.join(DATA_DIR, "jlpt.json");

const LEVELS = ["N5–N4", "N3", "N2", "N1"];

let _words = null;
function words() {
  if (_words) return _words;
  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(JLPT, "utf8"));
  } catch (e) {
    raw = [];
  }
  // 原始数据有重复词：按 ja 去重（保留第一次出现的顺序），
  // 否则抽词会抽到同一个词、计数也会偏高
  const seen = new Set();
  _words = [];
  for (const w of raw) {
    const ja = w && w.ja;
    if (!ja || seen.has(ja)) continue;
    seen.add(ja);
    _words.push(w);
  }
  return _words;
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      levelIndex: Number.isInteger(j.levelIndex) ? j.levelIndex : 0,
      offset: Number.isInteger(j.offset) ? j.offset : 0,
      taught: Array.isArray(j.taught) ? j.taught : [],
    };
  } catch (e) {
    return { levelIndex: 0, offset: 0, taught: [] };
  }
}

function save(db) {
  writeJsonAtomic(FILE, db);
}

function levelList(levelIndex) {
  const level = LEVELS[levelIndex];
  return words().filter((w) => w.level === level).sort((a, b) => a.order - b.order);
}

function stats() {
  const db = load();
  const level = LEVELS[db.levelIndex];
  const total = levelList(db.levelIndex).length;
  return {
    level,
    levelIndex: db.levelIndex + 1,
    totalLevels: LEVELS.length,
    levelTotal: total,
    levelDone: Math.min(db.offset, total),
    taught: db.taught.length,
    allWords: words().length,
    wordbook: book.stats(),
  };
}

/**
 * 取下一课
 * @param {(items:Array)=>Promise<Array>} enrich 由外部提供：给词条补例句/提醒
 * @param {number} n 几个词
 */
module.exports = { stats, load, save, LEVELS, words, levelList, FILE, JLPT };
