/* 可用 Live2D 模型清单 + 每个模型的取景参数（缩放/左右/上下）
 * 清单来自 model 目录下的 *.model3.json；取景存 data/live2d-models.json（本地）。
 */
const fs = require("fs");
const path = require("path");
const assets = require("./assets");
const { writeJsonAtomic } = require("./jsonfile");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(ROOT, "data");
const FILE = () => path.join(DATA_DIR, "live2d-models.json");

// 默认取景：半身（头到大腿），新模型不用调也能用
const DEFAULT_FIT = { mx: 0.5, my: 0, f: 2.4 };   // 只做半身取景；f 是「倍数」
const DEFAULT_MODEL = "model/Hiyori/Hiyori.model3.json";

/** 当前生效的模型路径（唯一来源：LIVE2D_MODEL 或默认 Hiyori） */
function activePath() {
  return process.env.LIVE2D_MODEL || DEFAULT_MODEL;
}

// 调好的模型取景（按模型路径）。data/live2d-models.json 里的值会覆盖这里。
const BUILTIN_FITS = {
  'model/miku/miku.model3.json':        { mx: 0.10, my: 0.15, f: 2.4 },
  'model/樱花miku/樱花miku.model3.json':  { mx: 0.10, my: 0.15, f: 2.4 },
  'model/重音/重音.model3.json':          { mx: 0.50, my: 0.15, f: 2.4 },
  'model/Hiyori/Hiyori.model3.json':    { mx: 0.50, my: 0.00, f: 2.4 },
};

function readFits() {
  try { return JSON.parse(fs.readFileSync(FILE(), "utf8")) || {}; } catch (e) { return {}; }
}

function writeFits(all) {
  try { writeJsonAtomic(FILE(), all); } catch (e) { /* 写失败不致命，下次保存再试 */ }
}

/** 扫 model/ 下所有 *.model3.json */
function list() {
  const out = [];
  const seen = new Set();
  for (const base of assets.modelDirs()) {
    let dirs = [];
    try { dirs = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      let files = [];
      try { files = fs.readdirSync(path.join(base, d.name)); } catch (e) { continue; }
      for (const f of files) {
        if (!f.endsWith(".model3.json")) continue;
        const rel = `model/${d.name}/${f}`;
        if (seen.has(rel)) continue;
        seen.add(rel);
        out.push({ label: d.name, path: rel });
      }
    }
  }
  return out;
}

function fits() { return readFits(); }

function fitOf(modelPath) {
  const all = readFits();
  return { ...DEFAULT_FIT, ...(BUILTIN_FITS[modelPath] || {}), ...(all[modelPath] || {}) };
}

function setFit(modelPath, fit) {
  const all = readFits();
  all[modelPath] = { ...DEFAULT_FIT, ...(all[modelPath] || {}), ...(fit || {}) };
  writeFits(all);
  return all[modelPath];
}

module.exports = { list, fits, fitOf, setFit, DEFAULT_FIT, DEFAULT_MODEL, activePath };
