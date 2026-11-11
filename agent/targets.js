/* 会话里「自然用出学过的词」
 *
 * 只做被动带词：每轮从 wordbook 里挑 1–2 个已经掌握（stage=ok）的词，
 * 让模型自然地用在回复里；放不进去就跳过。
 *
 * 数据：
 *   data/usage.json  { "ミルクパン": { "at": "ISO", "count": 3 } }
 *   —— 不和 wordbook 混，避免动它的 schema；只用来算「多久没用了」
 */
const fs = require("fs");
const path = require("path");
const book = require("./wordbook");
const { writeJsonAtomic } = require("./jsonfile");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "usage.json");

const COOLDOWN_DAYS = 7;      // 同一个词 7 天内不重复
const MAX_PER_TURN = 2;
const LEVEL_ORDER = ["N5", "N4", "N3", "N2", "N1"];

function norm(s) {
  return String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function rank(level) {
  const i = LEVEL_ORDER.indexOf(String(level || "").toUpperCase());
  return i < 0 ? 0 : i;               // 未知档位按最低算
}

function loadUsage() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch (e) { return {}; }
}

function saveUsage(u) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeJsonAtomic(FILE, u);
  } catch (e) { /* 用量记录失败不影响对话 */ }
}

/** 挑本轮要用的词：已掌握 + 档位不高于当前 + 冷却期外；最久没用的优先 */
function pick({ level = "N5", max = MAX_PER_TURN, now = Date.now() } = {}) {
  const usage = loadUsage();
  const db = book.load();
  const cur = rank(level);
  const cool = COOLDOWN_DAYS * 24 * 3600 * 1000;
  const cands = [];
  for (const rec of Object.values(db.words || {})) {
    if (rec.stage !== "ok") continue;                    // 只挑「连续答对毕业」的
    if (!rec.ja) continue;
    if (rec.level && rank(rec.level) > cur) continue;     // 不用比当前档更难的
    const u = usage[rec.ja];
    const last = u && u.at ? Date.parse(u.at) : 0;
    if (last && now - last < cool) continue;              // 冷却中
    cands.push({ rec, last: last || 0 });
  }
  if (!cands.length) return [];
  // 最久没用过的优先；同等新旧时随机，避免每次都是同一个词
  cands.sort((a, b) => (a.last - b.last) || (Math.random() - 0.5));
  return cands.slice(0, Math.max(0, Math.min(MAX_PER_TURN, max))).map(({ rec }) => ({
    ja: rec.ja, kana: rec.kana || "", zh: rec.zh || "", level: rec.level || "",
  }));
}

/** 拼进 system prompt 的一段（日语说明 + 词表） */
function block(list) {
  if (!list || !list.length) return "";
  const lines = list.map((w) => `- ${w.ja}${w.kana ? `（${w.kana}）` : ""}${w.zh ? `＝${w.zh}` : ""}`);
  return [
    "【今回の語彙】以下は学習者がもう覚えた単語。会話に自然に使えたら 1〜2 個だけ使う。",
    "無理に詰め込まない・並べない・復習問題にしない。合わなければ使わなくてよい。",
    ...lines,
  ].join("\n");
}

/** 回复生成后：看哪些词真的用上了，记 last_used */
function noteReply(text, list) {
  const t = norm(text);
  const used = [];
  for (const w of list || []) {
    const keys = [w.ja, w.kana].filter(Boolean).map(norm);
    if (keys.some((k) => k && t.includes(k))) used.push(w.ja);
  }
  if (used.length) {
    const usage = loadUsage();
    const at = new Date().toISOString();
    for (const ja of used) {
      const u = usage[ja] || { at: "", count: 0 };
      usage[ja] = { at, count: (u.count || 0) + 1 };
    }
    saveUsage(usage);
  }
  return used;
}

module.exports = { pick, block, noteReply, COOLDOWN_DAYS, MAX_PER_TURN, FILE };
