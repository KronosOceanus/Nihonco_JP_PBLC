import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/* 读音快照测试（可选）：引擎在跑且有小夜(46)时才比较，否则整组跳过。
 * 快照用 npm run snapshot:readings 生成。 */

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "speech-readings.json");
const { prepare } = await import("../agent/speech-text.js");

async function engineInfo() {
  try {
    const r = await fetch("http://127.0.0.1:50021/version", { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

async function mora(text) {
  const q = new URLSearchParams({ speaker: "46", text });
  const r = await fetch(`http://127.0.0.1:50021/audio_query?${q}`, { method: "POST", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`audio_query ${r.status}`);
  const d = await r.json();
  return (d.accent_phrases || []).map((ap) => (ap.moras || []).map((m) => m.text || "").join("")).join(" / ");
}

const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, "utf8")) : null;

test("读音快照：规范化后的文本读法符合基线", async (t) => {
  if (!fixture || !fixture.cases || !fixture.cases.length) return t.skip("没有快照基线");
  const engine = await engineInfo();
  if (!engine) return t.skip("VOICEVOX 没在跑");
  for (const c of fixture.cases) {
    const prepared = prepare(c.src, { engine: "voicevox" });
    assert.equal(prepared, c.prepared, `规范化结果变了：${c.src}`);
    assert.equal(await mora(prepared), c.mora, `读法变了：${c.src}`);
  }
});
