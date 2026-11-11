import test from "node:test";
import assert from "node:assert/strict";
import { ttsVerdict, asrVerdict } from "../agent/health.js";

test("TTS：只看当前引擎是否就绪", () => {
  assert.deepEqual(ttsVerdict({ hasEngine: true, engine: true }),
    { usable: true, reason: "engine" });
  assert.deepEqual(ttsVerdict({ hasEngine: false, engine: false }),
    { usable: false, reason: "no-engine" });
  assert.deepEqual(ttsVerdict({ hasEngine: true, engine: false }),
    { usable: false, reason: "engine-timeout" });
});

test("ASR：ready 才算就绪；loading 不算失败", () => {
  assert.equal(asrVerdict({ reachable: true, ready: true, processAlive: true, waitedMs: 9999, timeoutMs: 30000 }).status, "ready");
  assert.equal(asrVerdict({ reachable: true, ready: false, processAlive: true, waitedMs: 9999, timeoutMs: 30000 }).status, "loading");
});

test("ASR：只有确定起不来才 failed", () => {
  assert.deepEqual(asrVerdict({ reachable: false, ready: false, processAlive: false, spawnError: "ENOENT", waitedMs: 0, timeoutMs: 30000 }),
    { status: "failed", reason: "spawn" });
  assert.deepEqual(asrVerdict({ reachable: true, ready: false, processAlive: false, waitedMs: 0, timeoutMs: 30000 }),
    { status: "failed", reason: "child-exit" });
  assert.deepEqual(asrVerdict({ reachable: false, ready: false, processAlive: false, waitedMs: 0, timeoutMs: 30000 }),
    { status: "failed", reason: "exited" });
  assert.deepEqual(asrVerdict({ reachable: false, ready: false, processAlive: true, waitedMs: 30000, timeoutMs: 30000 }),
    { status: "failed", reason: "timeout" });
});

test("ASR：进程活着、还没到超时 → starting（不报）", () => {
  assert.equal(asrVerdict({ reachable: false, ready: false, processAlive: true, waitedMs: 1000, timeoutMs: 30000 }).status, "starting");
});
