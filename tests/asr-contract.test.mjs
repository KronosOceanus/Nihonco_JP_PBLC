import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* ASR 有两套实现，必须守同一份 HTTP 契约（测试基准见 tests/fixtures/asr-contract.json）：
 *
 *   GET  /health   → { ok, model, requested, fallback, ready, engine? }
 *   POST /asr?lang=&prompt=  → { text, ms, lang, dur, lp? }
 *
 * 两类检查：
 *   ① 源码级：两个实现都要有相同字段与参数名（任何平台都跑，不再按平台二选一）
 *   ② 运行时：本机 8765 有服务在跑时，直接打 /health 与 /asr 验证真实返回（没有就 skip）
 */

const ROOT = new URL("..", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), "utf8");
const spec = JSON.parse(read("tests/fixtures/asr-contract.json"));
const PY = read("asr.py");
const JS = read("agent/asr-whispercpp.js");

/** 在 anchor 附近（前后 span 字符）找字段是否存在 */
function regionHas(src, anchor, field, span = 1200) {
  const i = src.indexOf(anchor);
  if (i < 0) return false;
  const body = src.slice(Math.max(0, i - span / 2), i + span);
  // 兼容两种写法：`field:` 与简写 `field,`（对象里 ready, 这种）
  return new RegExp(`["']?${field}["']?\\s*[:},]`).test(body);
}

/* ---------------- ① 源码级契约 ---------------- */

test("asr.py：/health 返回契约要求的全部字段", () => {
  for (const k of spec.health.required) {
    assert.ok(regionHas(PY, 'self.path.startswith("/health")', k), `asr.py /health 缺 ${k}`);
  }
});

test("asr-whispercpp.js：/health 返回契约要求的全部字段", () => {
  for (const k of spec.health.required) {
    assert.ok(regionHas(JS, "engine: 'whisper.cpp'", k), `whisper.cpp /health 缺 ${k}`);
  }
});

test("asr.py：/asr 返回 {text, ms, lang, dur} 且读 prompt/lang", () => {
  for (const k of spec.asr.required) {
    assert.ok(regionHas(PY, 'self._json(200, {"text"', k, 400), `asr.py /asr 缺 ${k}`);
  }
  assert.match(PY, /q\.get\("prompt"\)/, "asr.py 要从 query 读 prompt");
  assert.match(PY, /q\.get\("lang"\)/, "asr.py 要从 query 读 lang");
});

test("asr-whispercpp.js：/asr 返回 {text, ms, lang, dur} 且透传 prompt", () => {
  for (const k of spec.asr.required) {
    assert.match(JS, new RegExp(`\\b${k}\\b`), `whisper.cpp 返回里缺 ${k}`);
  }
  assert.match(JS, /searchParams\.get\('prompt'\)|searchParams\.get\("prompt"\)/, "要从 query 读 prompt");
  assert.match(JS, /prompt:\s*prompt/, "prompt 要作为表单字段发给 whisper-server");
  assert.match(JS, /text,\s*ms,\s*lang:\s*detected/, "返回字段要齐");
});

test("两个实现都监听契约里的默认端口", () => {
  const port = String(spec.ports.default);
  assert.match(PY, new RegExp(`ASR_PORT[^\\n]*${port}`), "asr.py 默认端口");
  assert.match(JS, new RegExp(`ASR_PORT \\|\\| ${port}`), "whisper.cpp 默认端口");
});

test("两个实现都把 ready 与 ok 分开（模型加载中 = ok:true + ready:false）", () => {
  assert.match(PY, /"ready":\s*_model_ready/);
  assert.match(JS, /\bready\b/);
});

/* ---------------- ② 运行时契约（本机有服务才跑） ---------------- */

/** 0.2 秒静音 WAV（16k / mono / 16bit）：只验证返回结构，不验证内容 */
function tinyWav() {
  const rate = 16000;
  const n = Math.floor(rate * 0.2);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

async function health() {
  try {
    const r = await fetch(`http://127.0.0.1:${spec.ports.default}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

test("运行时：/health 字段与类型符合契约（服务没在跑就 skip）", async (t) => {
  const h = await health();
  if (!h) return t.skip("8765 没有服务在跑");
  for (const k of spec.health.required) assert.ok(k in h, `/health 缺 ${k}`);
  for (const [k, type] of Object.entries(spec.health.types)) {
    assert.equal(typeof h[k], type, `/health.${k} 应为 ${type}，实际 ${typeof h[k]}`);
  }
});

test("运行时：/asr 返回字段符合契约（服务没在跑就 skip）", async (t) => {
  const h = await health();
  if (!h) return t.skip("8765 没有服务在跑");
  if (h.ready === false) return t.skip("模型还在加载");
  const r = await fetch(`http://127.0.0.1:${spec.ports.default}/asr?lang=ja`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: tinyWav(),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(r.status, 200, `/asr HTTP ${r.status}`);
  const j = await r.json();
  for (const k of spec.asr.required) assert.ok(k in j, `/asr 缺 ${k}`);
  assert.equal(typeof j.text, "string");
  assert.equal(typeof j.ms, "number");
  assert.equal(typeof j.lang, "string");
});
