#!/usr/bin/env node
/* 把 OpenJLPT 的语法点导入成项目数据（含中文翻译）
 *
 *   node tools/build-patterns.mjs          # 默认导入 N5
 *   node tools/build-patterns.mjs n4       # 也可以指定级别
 *
 * 数据来源：OpenJLPT（CC BY-SA 4.0），字段 pattern / formation / examples / notes 原样保留，
 * 额外补中文（meaning_zh / formation_zh / notes_zh / examples[].zh）
 * 和例句假名读音（examples[].reading，来自 furigana）——重跑本脚本不会丢读音。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Windows 上 URL.pathname 会给出 "/D:/path/..."，path.resolve 后变成 "D:\D:\path\..."
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const level = (process.argv[2] || "n5").toLowerCase();
const URL_SRC = `https://cdn.jsdelivr.net/gh/evanclan/OpenJLPT@main/data/json/grammar/${level}.json`;
const OUT = path.join(ROOT, "data", `patterns-${level}.json`);

// 读 .env 里的 key
function env() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {}
  return out;
}

/** {私|わたし}は{学生|がくせい}です。 → わたしはがくせいです。 */
function kanaOf(furigana) {
  return String(furigana || "")
    .replace(/\{([^|}]+)\|([^}]+)\}/g, "$2")
    .replace(/[{}]/g, "");
}

const E = env();
const BASE = (E.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
const KEY = E.LLM_API_KEY || "";
const MODEL = E.LLM_MODEL || "deepseek-chat";

async function translate(items) {
  const payload = items.map((it, i) => ({
    i: i + 1,
    pattern: it.pattern,
    meaning: it.meaning,
    formation: it.formation || "",
    notes: it.notes || "",
    examples: (it.examples || []).map((e) => ({ ja: e.ja, en: e.en || "" })),
  }));

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: `你是日语教学资料的译者。把给定的语法点条目翻成**简体中文**，只输出 JSON：
{ "items": [ { "i": 1, "meaning_zh": "语法含义（≤20字）", "formation_zh": "接续（≤20字）", "notes_zh": "用法提醒（≤40字，可空）", "examples_zh": ["例1中文", "例2中文"] } ] }
要求：
- i 必须与输入编号对应，不能漏项
- 中文要符合中文母语者说话习惯，不要直译腔
- 例句译文与日语逐句对应，examples_zh 顺序与 examples 一致
- 不要添加解释、不要输出 markdown` },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content || "{}";
  const json = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  return json.items || [];
}

const list = await fetch(URL_SRC, { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
console.log(`下载 ${level.toUpperCase()}: ${list.length} 条`);

const out = [];
const CHUNK = 10;
for (let i = 0; i < list.length; i += CHUNK) {
  const part = list.slice(i, i + CHUNK);
  process.stdout.write(`  翻译 ${i + 1}-${i + part.length}…`);
  const tr = await translate(part);
  const byIdx = new Map(tr.map((t) => [t.i, t]));
  part.forEach((it, k) => {
    const t = byIdx.get(k + 1) || {};
    out.push({
      id: it.id,
      pattern: it.pattern,
      reading: it.reading || "",
      romaji: it.romaji || "",
      level: it.level,
      meaning_zh: t.meaning_zh || "",
      formation_zh: t.formation_zh || "",
      notes_zh: t.notes_zh || "",
      examples: (it.examples || []).map((e, idx) => ({
        ja: e.ja,
        zh: (t.examples_zh || [])[idx] || "",
        reading: kanaOf(e.furigana),          // 复现判定用：打假名也算对
      })),
      tags: it.tags || [],
    });
  });
  console.log(" ok");
}

fs.writeFileSync(OUT, JSON.stringify({
  source: "OpenJLPT (CC BY-SA 4.0) https://github.com/evanclan/OpenJLPT",
  level: level.toUpperCase(),
  count: out.length,
  items: out,
}, null, 2));
console.log("写入", OUT, out.length, "条");
