/* 每日练习的通用状态机（单词 / 例句共用）
 *
 * 两个模块原先各写了一份同样的机械逻辑：本地日期、shuffle/sample、文件缓存读写、
 * 抽卡避开上一张、复习开关、批次完成度。这里收拢成一份，**不碰数据格式**：
 * 每个模块自己的 JSON（vocab-daily.json / pattern-daily.json）与 schema 迁移留在各自模块里，
 * 通过 createStore 的 empty/normalize 钩子注入。
 */
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./jsonfile");
const schema = require("./schema");

/** 本地日期（toISOString 是 UTC，在 UTC+8 会导致早上 8 点才换天） */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample(arr, n) {
  if (!arr.length) return [];
  return shuffle(arr.slice()).slice(0, Math.min(n, arr.length));
}

/** 从池子里抽一个，尽量避开上一张（keyOf 默认取元素本身） */
function pickAvoiding(pool, last, keyOf = (x) => x) {
  if (!pool || !pool.length) return null;
  const list = pool.filter((x) => keyOf(x) !== last);
  const from = list.length ? list : pool;
  return from[Math.floor(Math.random() * from.length)];
}

/**
 * 带文件戳缓存的 JSON 存储（文件被外部改动/删除时自动失效）
 * @param {{name:string, file:string, empty:()=>object, normalize?:(j:object)=>object}} opts
 */
function createStore({ name, file, empty, normalize }) {
  let db = null;
  let stamp = null;

  const fileStamp = () => {
    try {
      const st = fs.statSync(file);
      return `${st.mtimeMs}:${st.size}`;
    } catch (e) { return "missing"; }
  };

  function load() {
    const cur = fileStamp();
    if (db && cur === stamp) return db;
    if (cur === "missing") {
      db = empty();
      stamp = cur;
      return db;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const m = schema.migrate(name, raw);
      if (m.newer) console.warn(`[${name}] 数据版本比程序新（v${m.from}），不做迁移`);
      if (m.changed && !m.newer) { try { writeJsonAtomic(file, m.data); } catch (_) {} }
      db = normalize ? normalize(m.data) : m.data;
      stamp = cur;
      return db;
    } catch (e) {
      db = empty();
      stamp = cur;
      return db;
    }
  }

  function save(next) {
    writeJsonAtomic(file, schema.stamp(name, next));   // 先落盘：失败时缓存不先行污染
    db = next;
    stamp = fileStamp();
  }

  return { load, save, file, name };
}

/** 每日批次是否该重建：日期变了 / 批次空了 / 档位换了 */
function needBuild(db, { date, batch, currentLevel }) {
  if (!db) return true;
  if (db.date !== date) return true;
  if (!batch || (Array.isArray(batch) && !batch.length)) return true;
  if (currentLevel && db.level !== currentLevel) return true;
  return false;
}

/** 批次完成度：ids 里已答对/错/跳过的（answered 是数组或 Set） */
function batchProgress(ids, answered) {
  const set = answered instanceof Set ? answered : new Set(answered || []);
  const list = Array.isArray(ids) ? ids : [];
  const done = list.filter((x) => set.has(x)).length;
  return { done, total: list.length, allDone: list.length > 0 && done === list.length };
}

/**
 * 切换每日/复习。
 * refuseWhenEmpty=true 时（例句模式）错题本为空就不切，返回 { switched:false, empty:true }。
 */
function toggleMode(db, { hasWrong = true, refuseWhenEmpty = false, onSwitch = null } = {}) {
  if (refuseWhenEmpty && db.mode !== "review" && hasWrong === 0) {
    return { mode: db.mode, switched: false, empty: true };
  }
  db.mode = db.mode === "review" ? "daily" : "review";
  // 不重置 last：退出復習后的第一张每日卡也要避开刚才复习的那张
  if (onSwitch) onSwitch(db);
  return { mode: db.mode, switched: true, empty: false };
}

module.exports = { today, shuffle, sample, pickAvoiding, createStore, needBuild, batchProgress, toggleMode };
