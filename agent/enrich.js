/* 例句缓存 + 批量补例句
 *   data/enrich-cache.seed.json  公共例句，进仓库
 *   data/enrich-cache.json       本地新增，不进仓库
 * 读取本地优先；写回只写「种子之外」的条目。
 */
const fs = require("fs");
const path = require("path");
const { enrichPrompt } = require("./prompt");
const { exampleMatches } = require("./example-check");
const reading = require("./reading");
const { writeJsonAtomic } = require("./jsonfile");

const SEED = path.join(__dirname, "..", "data", "enrich-cache.seed.json");
const LOCAL = path.join(__dirname, "..", "data", "enrich-cache.json");

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return {}; }
}

let _seed = null, _merged = null;
function seedCache() { if (!_seed) _seed = readJson(SEED); return _seed; }

function ecache() {
  if (_merged) return _merged;
  _merged = { ...seedCache(), ...readJson(LOCAL) };
  return _merged;
}

function ecacheSave() {
  try {
    const seed = seedCache();
    const out = {};
    for (const [k, v] of Object.entries(_merged || {})) {
      // 种子没有的键，或种子例句被新例句覆盖，都要落本地
      if (!seed[k] || JSON.stringify(seed[k]) !== JSON.stringify(v)) out[k] = v;
    }
    writeJsonAtomic(LOCAL, out, 0);
  } catch (e) {}
}

/** 例句按词等级生成；词表重分档后旧例句要重生成（旧缓存没有 level 则保留） */
function staleLevel(word, hit) {
  return !!(hit && hit.level && word && word.level && hit.level !== word.level);
}

/** 同步查缓存里的例句（命中就不用再走 IPC） */
function cachedExample(word) {
  if (!word || !word.ja) return null;
  const cache = ecache();
  const hit = cache[word.ja];
  if (!hit || !hit.example) return null;
  if (staleLevel(word, hit)) {
    delete cache[word.ja];        // 词等级变了：旧例句按旧等级生成，重生成
    return null;
  }
  if (reading.ready() && !exampleMatches(word, hit.example)) {
    delete cache[word.ja];        // 坏例句不显示；后续 enrichOne 会重新生成
    return null;
  }
  return { example: hit.example, example_zh: hit.example_zh || "", note: hit.note || "" };
}

/** 给一批词补例句（callJson 由 llm.js 注入） */
async function enrichBatch(items, callJson) {
  if (!items || !items.length) return [];
  const j = await callJson([
    { role: "system", content: enrichPrompt(items) },
    { role: "user", content: "开始" },
  ], 0.5);
  return Array.isArray(j.items) ? j.items : [];
}

/** 给单个词补例句（走缓存，命中就不调模型） */
async function enrichOne(w, callJson) {
  const cache = ecache();
  const hit = cache[w.ja];
  if (hit && hit.example) {
    if (!staleLevel(w, hit) && (!reading.ready() || exampleMatches(w, hit.example))) {
      return { ...w, example: hit.example, example_zh: hit.example_zh || "", note: hit.note || "" };
    }
    // 坏例句，或词等级变了：丢弃，走下面的重生成
    delete cache[w.ja];
  }

  // 最多生成 2 次；第二次仍不合格就不显示例句（不写缓存）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const more = await enrichBatch([w], callJson);
      const e = more.find((m) => m && Number(m.i) === 1);
      if (e && e.example && (!reading.ready() || exampleMatches(w, e.example))) {
        cache[w.ja] = { example: e.example, example_zh: e.example_zh || "", note: e.note || "", level: w.level || "" };
        ecacheSave();
        return { ...w, example: e.example, example_zh: e.example_zh || "", note: e.note || "" };
      }
    } catch (e) {}
  }
  return w;
}

module.exports = { cachedExample, enrichBatch, enrichOne, staleLevel };
