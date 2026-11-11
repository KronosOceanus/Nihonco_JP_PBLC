#!/usr/bin/env node
/* 生成 data/word-levels.json：把 jlpt.json 里合并的「N5–N4」拆回 N5 / N4
 *
 *   node tools/build-word-levels.mjs
 *
 * 来源：OpenJLPT 的分级词表（CC BY-SA 4.0），按「词形」优先、其次「读音」匹配。
 * 匹配不到的（多为数字、月份等）不写进表里，界面上仍按区间统计。
 */
import fs from "node:fs";

const BASE = "https://cdn.jsdelivr.net/gh/evanclan/OpenJLPT@main/data/json/vocab";
const LEVELS = ["n5", "n4", "n3", "n2", "n1"];

const arr = (x) => (Array.isArray(x) ? x : x.items || []);

const jlpt = JSON.parse(fs.readFileSync("data/jlpt.json", "utf8"));
const band = jlpt.filter((w) => w.level === "N5–N4");

const byJa = new Map();
const byKana = new Map();
for (const lv of LEVELS) {
  const res = await fetch(`${BASE}/${lv}.json`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) { console.error(`下载 ${lv} 失败: ${res.status}`); continue; }
  for (const w of arr(await res.json())) {
    if (!byJa.has(w.word)) byJa.set(w.word, w.level);
    if (w.reading && !byKana.has(w.reading)) byKana.set(w.reading, w.level);
  }
}

const out = {};
let hit = 0;
for (const w of band) {
  const lv = byJa.get(w.ja) || byKana.get(w.kana);
  if (lv === "N5" || lv === "N4") { out[w.ja] = lv; hit += 1; }
}

fs.writeFileSync("data/word-levels.json", JSON.stringify({
  source: "OpenJLPT (CC BY-SA 4.0)",
  count: hit,
  levels: out,
}, null, 0));
console.log(`拆出 ${hit} / ${band.length} 个词的档位，写入 data/word-levels.json`);
const c = { N5: 0, N4: 0 };
for (const lv of Object.values(out)) c[lv] += 1;
console.log("分布:", JSON.stringify(c));
