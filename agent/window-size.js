/* 挂件窗口尺寸：读写 data/window.json + 夹取范围
 *
 * 只做纯逻辑（不依赖 electron），方便测试；实际 setBounds 在 main/window.js。
 */
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./jsonfile");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "window.json");

const MIN_W = 240;
const MIN_H = 320;
const DEFAULT = { w: 380, h: 560 };

/** 夹到 [MIN_*, 上限]；上限由调用方按工作区算（默认给个宽松值） */
function clampSize(w, h, { maxW = 4000, maxH = 4000 } = {}) {
  const n = (v, def) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : def);
  return {
    w: Math.min(Math.max(n(w, MIN_W), MIN_W), Math.max(MIN_W, Math.round(maxW))),
    h: Math.min(Math.max(n(h, MIN_H), MIN_H), Math.max(MIN_H, Math.round(maxH))),
  };
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const s = clampSize(j.w, j.h);
    return { w: s.w, h: s.h };
  } catch (e) {
    return null;
  }
}

function save({ w, h }) {
  const s = clampSize(w, h);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJsonAtomic(FILE, s);
  return s;
}

module.exports = { clampSize, load, save, DEFAULT, MIN_W, MIN_H, FILE };
