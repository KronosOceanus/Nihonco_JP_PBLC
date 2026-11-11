// 从 @polyglot-bundles/ja-jlpt-syllabi 生成 data/jlpt.json
// 用法：npm run build:jlpt
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.join(root, "node_modules/@polyglot-bundles/ja-jlpt-syllabi/src/generated/jlpt-syllabus.json");

if (!fs.existsSync(src)) {
  console.error("找不到词表源文件，请先 npm install");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(src, "utf8"));
const rows = [];

function walk(n, chapter) {
  if (n.type === "chapter") chapter = n.title;
  if (n.type === "vocabularyItem") {
    const ja = String(n.word || "").trim();
    const kana = String(n.transcription || "").trim();
    if (ja && kana) {
      const lv = /N5|N4/.test(chapter || "") ? "N5–N4" : /N3/.test(chapter) ? "N3" : /N2/.test(chapter) ? "N2" : "N1";
      rows.push({
        level: lv,
        ja,
        kana,
        zh: String(n.translation || "").trim(),
        pos: String(n.partOfSpeech || "").trim(),
        order: parseFloat((n.data && n.data._order) || 0) || 0,
      });
    }
  }
  for (const c of n.children || []) walk(c, chapter);
}

walk(raw, null);

const out = path.join(root, "data/jlpt.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows), "utf8");
console.log(`已生成 ${out}：${rows.length} 词`);
