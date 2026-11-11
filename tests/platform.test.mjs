import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const p = await import("../agent/platform.js");

/* 平台差异集中到 agent/platform.js 后，这里固定解析函数与行为函数的口径。 */

const NETSTAT = `
  TCP    127.0.0.1:8765         0.0.0.0:0              LISTENING       4321
  TCP    127.0.0.1:8765         127.0.0.1:5555         ESTABLISHED     9999
  TCP    [::1]:8765             [::]:0                 LISTENING       4321
  TCP    0.0.0.0:50021          0.0.0.0:0              LISTENING       777
  TCP    127.0.0.1:18765        0.0.0.0:0              LISTENING       1234
`;

test("parseNetstatListeners：只认 LISTENING、去重、端口精确匹配", () => {
  assert.deepEqual(p.parseNetstatListeners(NETSTAT, 8765), [4321]);
  assert.deepEqual(p.parseNetstatListeners(NETSTAT, 50021), [777]);
  assert.deepEqual(p.parseNetstatListeners(NETSTAT, 9999), [], "ESTABLISHED 不算");
  assert.deepEqual(p.parseNetstatListeners("", 8765), []);
});

test("parseLsofListeners：多 PID / 空输出", () => {
  assert.deepEqual(p.parseLsofListeners("123\n456\n"), [123, 456]);
  assert.deepEqual(p.parseLsofListeners(""), []);
  assert.deepEqual(p.parseLsofListeners("  \n"), []);
});

test("parsePidCommand：去掉首尾空白", () => {
  assert.equal(p.parsePidCommand("  /usr/bin/foo --bar  \n"), "/usr/bin/foo --bar");
  assert.equal(p.parsePidCommand(undefined), "");
});

test("窗口与工作区行为按平台区分", () => {
  assert.equal(p.titleBarStyle(), p.IS_WIN ? "default" : "hiddenInset");
  assert.equal(p.supportsAllWorkspaces(), !p.IS_WIN);
});

test("识别后端：Windows 恒 whispercpp，其它按配置", () => {
  if (p.IS_WIN) {
    assert.equal(p.asrBackendFor("mlx"), "whispercpp");
  } else {
    assert.equal(p.asrBackendFor("mlx"), "mlx");
    assert.equal(p.asrBackendFor(""), "mlx");
    assert.equal(p.asrBackendFor("whispercpp"), "whispercpp");
  }
  assert.equal(p.whisperExeName(), p.IS_WIN ? "whisper-server.exe" : "whisper-server");
});

test("asrEngineLabel：按实际后端标注，与平台无关", () => {
  assert.equal(p.asrEngineLabel("whispercpp"), "whisper.cpp");
  assert.equal(p.asrEngineLabel("mlx"), p.IS_WIN ? "whisper.cpp" : "asr.py");
});

test("voicevoxEngineCandidates：环境变量优先，否则给出候选列表", () => {
  const withEnv = p.voicevoxEngineCandidates({ root: "/tmp/r", userData: "/tmp/u", env: { VOICEVOX_ENGINE: "/x/run" } });
  assert.deepEqual(withEnv, ["/x/run"]);

  const list = p.voicevoxEngineCandidates({ root: "/tmp/r", userData: "/tmp/u", env: {} });
  assert.ok(Array.isArray(list) && list.length >= 1);
  assert.ok(list.some((x) => x.includes("vv-engine")), "候选里应该有 vv-engine");
  if (!p.IS_WIN) assert.ok(path.isAbsolute(list[0]), "mac 候选应为绝对路径");
  if (!p.IS_WIN) assert.ok(list.includes("/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run"));
});

test("childPath：mac 补 Homebrew 路径，Windows 原样", () => {
  const env = { PATH: "/usr/bin:/bin" };
  const out = p.childPath(env);
  if (p.IS_WIN) assert.equal(out, "/usr/bin:/bin");
  else assert.ok(out.startsWith("/opt/homebrew/bin:/usr/local/bin:"));
});

test("resolveAsrBackend：显式配置优先，未配置时优先 whisper.cpp", () => {
  if (p.IS_WIN) {   // Windows 只有 whisper.cpp
    assert.equal(p.resolveAsrBackend({ whisper: true, mlx: true }), "whispercpp");
    assert.equal(p.resolveAsrBackend({ configured: "mlx", whisper: false, mlx: true }), "whispercpp");
    return;
  }
  // 未配置：有 whisper.cpp 就用它
  assert.equal(p.resolveAsrBackend({ whisper: true, mlx: true }), "whispercpp");
  assert.equal(p.resolveAsrBackend({ whisper: true, mlx: false }), "whispercpp");
  // 没有 whisper.cpp 才回 mlx
  assert.equal(p.resolveAsrBackend({ whisper: false, mlx: true }), "mlx");
  // 显式配置被尊重（可用时）
  assert.equal(p.resolveAsrBackend({ configured: "mlx", whisper: true, mlx: true }), "mlx");
  assert.equal(p.resolveAsrBackend({ configured: "whispercpp", whisper: true, mlx: true }), "whispercpp");
  // 显式配置但不可用 → 回退到可用的那个
  assert.equal(p.resolveAsrBackend({ configured: "whispercpp", whisper: false, mlx: true }), "mlx");
  assert.equal(p.resolveAsrBackend({ configured: "mlx", whisper: true, mlx: false }), "whispercpp");
});
