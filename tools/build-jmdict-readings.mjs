#!/usr/bin/env node
/* 从 jmdict-simplified 的 commonOnly JSON 生成紧凑读音表。
 *
 * 用法：
 *   node tools/build-jmdict-readings.mjs /path/to/jmdict-eng-common-3.6.2.json
 *
 * 规则：
 *   - 只收含汉字的 common 词条
 *   - 只收只有一个 common 假名读音的词条
 *   - 同一写法出现多个读音时丢弃（运行时回落到 kuromoji 读音）
 *   - 输出 data/jmdict-readings.json；不提交原始 16MB JSON
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) {
  console.error("用法: node tools/build-jmdict-readings.mjs <jmdict-eng-common.json>");
  process.exit(2);
}

const KANJI = /[\u4e00-\u9fff]/;
const HIRA = /^[\u3040-\u309fー]+$/;
const toHira = (s) => [...s].map((c) => {
  const n = c.codePointAt(0);
  return n >= 0x30a1 && n <= 0x30f6 ? String.fromCodePoint(n - 0x60) : c;
}).join("");

const data = JSON.parse(fs.readFileSync(src, "utf8"));
const words = Array.isArray(data.words) ? data.words : [];
const readings = new Map();

for (const w of words) {
  const kanji = (w.kanji || []).filter((k) => k.common && KANJI.test(k.text || ""));
  const kana = (w.kana || []).filter((k) => k.common);
  if (!kanji.length || kana.length !== 1) continue;
  const r = toHira(kana[0].text || "");
  if (!HIRA.test(r)) continue;
  for (const k of kanji) {
    if (!readings.has(k.text)) readings.set(k.text, new Set());
    readings.get(k.text).add(r);
  }
}

const out = {
  _comment: "JMdict common words compact reading map; generated from jmdict-eng-common; only entries with one common kana reading and no conflicting kanji form.",
  _source: `JMdict (EDRDG) via scriptin/jmdict-simplified ${data.version || ""}; CC BY-SA 4.0`.replace(/\s+;/, ";"),
};
let dropped = 0;
for (const [k, v] of [...readings].sort(([a], [b]) => a.localeCompare(b, "ja"))) {
  if (v.size !== 1) { dropped += 1; continue; }
  out[k] = [...v][0];
}

const dst = path.join(ROOT, "data", "jmdict-readings.json");
fs.writeFileSync(dst, JSON.stringify(out) + "\n");
console.log(`wrote ${dst}: ${Object.keys(out).length - 2} entries, ${dropped} conflicts dropped`);
