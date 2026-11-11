import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const mod = await import("../agent/asr-gpu.js");

/** 造一个假的 CUDA 包：只要文件名对，内容无所谓 */
function mkZip() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-gpu-src-"));
  const names = [
    "whisper-server.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cuda.dll",
    "cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll",
    "ggml-cpu-haswell.dll", "ggml-cpu-sandybridge.dll",
    "sd.exe",            // 清单外的文件：不该被拷进去
  ];
  for (const n of names) fs.writeFileSync(path.join(src, n), n);
  const zip = path.join(src, "fake-cuda.zip");
  const r = spawnSync("tar", ["-a", "-cf", zip, "-C", src, "."], { encoding: "utf8" });
  assert.equal(r.status, 0, "tar 造 zip 失败：" + (r.stderr || ""));
  return zip;
}

function mkAsrDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-asr-gpu-"));
  return dir;
}

const ZIP = mkZip();

test("本地包安装：解压 → staging → 落位，只拷清单内文件，active 写成目标后端", async () => {
  const asrDir = mkAsrDir();
  const phases = [];
  const committed = [];
  const r = await mod.install(asrDir, "cuda-12.4", {
    localZip: ZIP,
    onProgress: (p) => phases.push(p.phase),
    beforeCommit: async (dst) => committed.push(dst),
  });

  assert.equal(r.id, "cuda-12.4");
  const dir = path.join(asrDir, "cuda-12.4");
  for (const f of mod.REQUIRED) assert.ok(fs.existsSync(path.join(dir, f)), `缺 ${f}`);
  assert.ok(fs.existsSync(path.join(dir, "ggml-cpu-haswell.dll")), "CPU 分派 dll 必须带上");
  assert.ok(!fs.existsSync(path.join(dir, "sd.exe")), "清单外文件不该拷");
  assert.equal(mod.readActive(asrDir), "cuda-12.4");
  assert.ok(mod.installed(asrDir, "cuda-12.4"));
  assert.ok(!fs.existsSync(path.join(asrDir, "_download")), "临时目录要清掉");
  assert.deepEqual(committed, [dir], "落位前要回调一次，参数是目标目录");
  assert.deepEqual(phases, ["start", "local", "extract", "copy", "done"]);
});

test("中途取消（copy 阶段）：报 cancelled，已装目录原样保留，临时目录清空", async () => {
  const asrDir = mkAsrDir();
  // 先装一遍，再补一个标记文件，取消后它必须还在
  await mod.install(asrDir, "cuda-12.4", { localZip: ZIP });
  const dir = path.join(asrDir, "cuda-12.4");
  fs.writeFileSync(path.join(dir, "whisper-server.exe"), "OLD");

  const ctrl = new AbortController();
  let err = null;
  try {
    await mod.install(asrDir, "cuda-12.4", {
      localZip: ZIP,
      signal: ctrl.signal,
      onProgress: (p) => { if (p.phase === "copy") ctrl.abort(); },
    });
  } catch (e) { err = e; }

  assert.ok(err, "取消要抛错");
  assert.equal(err.cancelled, true, "要带 cancelled 标记，ipc 才不会当失败报");
  assert.equal(fs.readFileSync(path.join(dir, "whisper-server.exe"), "utf8"), "OLD",
    "取消不能动已装好的目录");
  assert.ok(!fs.existsSync(path.join(asrDir, "_download")), "临时目录（含 staging）要清掉");
  assert.equal(mod.readActive(asrDir), "cuda-12.4");
});

test("已经 abort 的信号：一个文件都不写", async () => {
  const asrDir = mkAsrDir();
  const ctrl = new AbortController();
  ctrl.abort();
  let err = null;
  try {
    await mod.install(asrDir, "cuda-12.4", { localZip: ZIP, signal: ctrl.signal });
  } catch (e) { err = e; }
  assert.equal(err && err.cancelled, true);
  assert.ok(!fs.existsSync(path.join(asrDir, "cuda-12.4")));
  assert.deepEqual(fs.readdirSync(asrDir), [], "asrDir 里不该留任何东西");
});

test("重装：旧目录先删再改名，文件内容换成新的", async () => {
  const asrDir = mkAsrDir();
  await mod.install(asrDir, "cuda-12.4", { localZip: ZIP });
  const dir = path.join(asrDir, "cuda-12.4");
  fs.writeFileSync(path.join(dir, "whisper-server.exe"), "OLD");
  fs.writeFileSync(path.join(dir, "junk.txt"), "x");          // 新装后应该消失
  await mod.install(asrDir, "cuda-12.4", { localZip: ZIP });
  assert.equal(fs.readFileSync(path.join(dir, "whisper-server.exe"), "utf8"), "whisper-server.exe");
  assert.ok(!fs.existsSync(path.join(dir, "junk.txt")), "重装要清掉旧目录里的杂文件");
});

test("包里缺文件：报错，且不落位、不写 active", async () => {
  const asrDir = mkAsrDir();
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-gpu-bad-"));
  fs.writeFileSync(path.join(src, "whisper-server.exe"), "x");
  const zip = path.join(src, "bad.zip");
  spawnSync("tar", ["-a", "-cf", zip, "-C", src, "."], { encoding: "utf8" });

  await assert.rejects(
    () => mod.install(asrDir, "cuda-12.4", { localZip: zip }),
    /缺文件/,
  );
  assert.ok(!fs.existsSync(path.join(asrDir, "cuda-12.4")), "缺文件不能落位");
  assert.equal(mod.readActive(asrDir), "cpu");
  assert.ok(!fs.existsSync(path.join(asrDir, "_download")));
});

/* ---------------- 断点续传 / 本地包发现 ---------------- */

import http from "node:http";

/** 一个支持 Range 的小服务器：body 固定，记录收到的 Range */
function rangeServer(body) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.headers.range || "");
    const range = String(req.headers.range || "");
    const m = range.match(/bytes=(\d+)-/);
    if (m) {
      const start = Number(m[1]);
      const buf = body.subarray(start);
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
        "Content-Length": String(buf.length),
      });
      res.end(buf);
      return;
    }
    res.writeHead(200, { "Content-Length": String(body.length) });
    res.end(body);
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port, seen })));
}

test("download：已有半截文件时用 Range 续传，不会从头下", async () => {
  const body = Buffer.from("0123456789".repeat(100));
  const { srv, port, seen } = await rangeServer(body);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-dl-"));
    const dst = path.join(dir, "x.zip");
    fs.writeFileSync(dst, body.subarray(0, 300));          // 假装上次下了 300 字节
    const r = await mod.download(`http://127.0.0.1:${port}/x.zip`, dst);
    assert.equal(r.resumedFrom, 300, "应该从 300 续传");
    assert.equal(r.received, body.length);
    assert.ok(seen.some((h) => h === "bytes=300-"), `应该发 Range 头，实际：${JSON.stringify(seen)}`);
    assert.deepEqual(fs.readFileSync(dst), body);
  } finally { srv.close(); }
});

test("download：服务器不支持 Range（回 200）时从头下并覆盖", async () => {
  const body = Buffer.from("abcdef".repeat(50));
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Length": String(body.length) });  // 故意忽略 Range
    res.end(body);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-dl2-"));
    const dst = path.join(dir, "y.zip");
    fs.writeFileSync(dst, "garbage");                       // 半截但不是真数据
    const r = await mod.download(`http://127.0.0.1:${srv.address().port}/y.zip`, dst);
    assert.equal(r.resumedFrom, 0);
    assert.deepEqual(fs.readFileSync(dst), body);
  } finally { srv.close(); }
});

test("findLocalZip：NIHONCO_ASR_ZIP 指定的包优先", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-zip-"));
  const zip = mkZip();                       // 必须是真包：函数会用 tar -tf 校验内容
  const prev = process.env.NIHONCO_ASR_ZIP;
  process.env.NIHONCO_ASR_ZIP = zip;
  try {
    const got = mod.findLocalZip({ zip: "x.zip", approxMB: 0 }, dir);
    assert.equal(got, zip);
  } finally {
    if (prev === undefined) delete process.env.NIHONCO_ASR_ZIP; else process.env.NIHONCO_ASR_ZIP = prev;
  }
});
