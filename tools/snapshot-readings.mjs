#!/usr/bin/env node
/* 生成「朗读读音快照」：npm run snapshot:readings
 *
 * 对 agent/speech-text.js 里的每个样例，先做规范化，再问 VOICEVOX 的 audio_query
 * 拿实际 mora 读法，写进 tests/fixtures/speech-readings.json。
 * 之后 tests/speech-reading.test.mjs 会在引擎可用时对比这份快照（引擎不在就跳过）。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "tests", "fixtures", "speech-readings.json");
const { prepare } = await import(path.join(ROOT, "agent", "speech-text.js"));
const SPEAKER = 46;   // 小夜/SAYO(ノーマル)

const SAMPLES = [
  "はは、笑ったね。",
  "ははは",
  "ははっ",
  "www すごい",
  "AI と OK",
  "Live2D のモデル",
  "2026年に会った",
  "……そうだね🎤",
  "Nihoncoだよ",
];

async function mora(text) {
  const q = new URLSearchParams({ speaker: String(SPEAKER), text });
  const r = await fetch(`http://127.0.0.1:50021/audio_query?${q}`, { method: "POST", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`audio_query HTTP ${r.status}`);
  const d = await r.json();
  return (d.accent_phrases || []).map((ap) => (ap.moras || []).map((m) => m.text || "").join("")).join(" / ");
}

const engine = await fetch("http://127.0.0.1:50021/version", { signal: AbortSignal.timeout(2000) })
  .then((r) => r.json()).catch(() => null);
if (!engine) {
  console.log("VOICEVOX 没在跑，先启动引擎再生成快照");
  process.exit(1);
}

const out = { engine, speaker: SPEAKER, at: new Date().toISOString(), cases: [] };
for (const src of SAMPLES) {
  const prepared = prepare(src, { engine: "voicevox" });
  out.cases.push({ src, prepared, mora: await mora(prepared) });
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`已写 ${path.relative(ROOT, OUT)}（${out.cases.length} 条，engine ${engine}）`);
