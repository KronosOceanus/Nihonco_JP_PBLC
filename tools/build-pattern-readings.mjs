#!/usr/bin/env node
/* 给 data/patterns-*.json 的例句补「假名读音」（reading）
 *
 *   node tools/build-pattern-readings.mjs
 *
 * 来源：OpenJLPT grammar JSON 的 furigana 字段（{私|わたし}は{学生|がくせい}です。）
 * 用途：复现判定时，打假名和打汉字算同一句
 */
import fs from "node:fs";

const BASE = "https://cdn.jsdelivr.net/gh/evanclan/OpenJLPT@main/data/json/grammar";
const LEVELS = ["n5", "n4", "n3", "n2", "n1"];

/** {私|わたし}は{学生|がくせい}です。 → わたしはがくせいです。 */
function kanaOf(furigana) {
  return String(furigana || "")
    .replace(/\{([^|}]+)\|([^}]+)\}/g, "$2")
    .replace(/[{}]/g, "");
}

for (const lv of LEVELS) {
  const file = `data/patterns-${lv}.json`;
  if (!fs.existsSync(file)) continue;

  const res = await fetch(`${BASE}/${lv}.json`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) { console.error(`${lv}: 下载失败 ${res.status}`); continue; }
  const src = await res.json();
  const byId = new Map((Array.isArray(src) ? src : src.items || []).map((x) => [x.id, x]));

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let filled = 0, missed = 0;
  for (const item of data.items || []) {
    const s = byId.get(item.id);
    for (const ex of item.examples || []) {
      const found = (s?.examples || []).find((e) => e.ja === ex.ja);
      const reading = kanaOf(found?.furigana || "");
      if (reading) { ex.reading = reading; filled += 1; }
      else { missed += 1; }
    }
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`${lv}: 补读音 ${filled} 条，缺 ${missed} 条`);
}
