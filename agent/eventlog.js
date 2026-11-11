/* 追加日志（append-only）：一行一个事件，永不覆盖
 *
 *   data/<prefix>.log.jsonl     每次判定/见到的流水
 *   data/<prefix>.baseline.json 基线（重放起点，轮转时重写）
 *
 * 用途：
 *   - 给快照兜底：快照坏了/被删了，可以从「基线 + 日志」重放还原
 *   - 之后做统计（每天学多少、易错排行）不用再改数据结构
 *
 * 约定：
 *   - 每行独立 JSON；解析失败的行直接跳过（崩溃时最后一行可能写一半）
 *   - 单行 < 4KB 时 POSIX 的 append 是原子的，不需要临时文件
 *   - 超过阈值就归档成 .1（只留一份旧档），并把基线重写成「当前快照 + offset 0」
 *   - 基线用**字节偏移**做水位线，不用时间戳（同毫秒的事件不会被误跳过）
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const MAX_BYTES = Number(process.env.NIHONCO_LOG_ROTATE_BYTES || 5 * 1024 * 1024);

function createLog(prefix) {
  const FILE = path.join(DATA_DIR, `${prefix}.log.jsonl`);
  const ARCHIVE = path.join(DATA_DIR, `${prefix}.log.1.jsonl`);
  const BASELINE = path.join(DATA_DIR, `${prefix}.baseline.json`);
  let onRotate = null;

  function ensureDir() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  }

  function size() {
    try { return fs.statSync(FILE).size; } catch (e) { return 0; }
  }

  function rotateIfNeeded() {
    if (size() < MAX_BYTES) return false;
    try {
      fs.renameSync(FILE, ARCHIVE);          // 旧的 .1 被覆盖，只留一份
      if (onRotate) { try { onRotate(); } catch (e) {} }
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 追加一个事件；自动补时间戳 */
  function append(event) {
    try {
      ensureDir();
      rotateIfNeeded();
      fs.appendFileSync(FILE, JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n", "utf8");
      return true;
    } catch (e) {
      return false;                          // 日志写失败不影响主流程
    }
  }

  /** 读全部事件（坏行跳过） */
  function readAll() {
    return readAllWithOffset().map((x) => x.ev);
  }

  /** 读全部事件，带每行在文件里的字节偏移（给基线做水位线） */
  function readAllWithOffset() {
    let text = "";
    try { text = fs.readFileSync(FILE, "utf8"); } catch (e) { return []; }
    const out = [];
    let offset = 0;
    for (const line of text.split("\n")) {
      const start = offset;
      offset += Buffer.byteLength(line, "utf8") + 1;   // +1 是换行符
      const s = line.trim();
      if (!s) continue;
      try {
        const ev = JSON.parse(s);
        if (ev && typeof ev.e === "string") out.push({ ev, offset: start });
      } catch (e) { /* 半行/坏行跳过 */ }
    }
    return out;
  }

  return {
    FILE, ARCHIVE, BASELINE, MAX_BYTES,
    ensureDir, size, rotateIfNeeded, append, readAll, readAllWithOffset,
    setRotateHook: (fn) => { onRotate = typeof fn === "function" ? fn : null; },
  };
}

module.exports = { createLog, DATA_DIR, MAX_BYTES };
