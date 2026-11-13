#!/usr/bin/env node
/* 下载源与回退（Go GOPROXY 那种「镜像优先、官方兜底」）
 *
 * 设计取舍：
 *   - 只用 curl：macOS 自带，Windows 10 1803+ 自带 curl.exe，不引第三方下载库
 *   - 每个源带 --max-time，失败/超时就换下一个源，不会在一个死源上吊着
 *   - 有 sha256 就一定校验：换源下载不安全的前提是"文件可能不同"，校验把它消掉
 *   - `-C -` 续传：跨源续传是安全的（镜像与官方是同一份字节）
 *
 * 模式（--mirror=... 或 NIHONCO_MIRROR）：
 *   auto      镜像优先，失败回退官方（默认）
 *   cn        只用境内镜像
 *   official  只用官方源
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const ELECTRON_MIRROR_CN = "https://npmmirror.com/mirrors/electron/";
export const BUILDER_MIRROR_CN = "https://npmmirror.com/mirrors/electron-builder-binaries/";

export const MIRROR_MODES = ["auto", "cn", "official"];

/** 源顺序：auto = 镜像 → 官方 */
export function mirrorOrder(mode = "auto") {
  const m = String(mode || "auto").toLowerCase();
  if (m === "cn" || m === "mirror") return ["cn"];
  if (m === "official" || m === "github") return ["official"];
  return ["cn", "official"];
}

export function parseMirrorMode(argv = [], env = process.env) {
  const hit = argv.find((a) => a.startsWith("--mirror="));
  const raw = hit ? hit.slice("--mirror=".length) : (env.NIHONCO_MIRROR || "auto");
  const m = String(raw || "auto").toLowerCase();
  if (!MIRROR_MODES.includes(m)) throw new Error(`--mirror 只能是 ${MIRROR_MODES.join(" / ")}（收到 ${raw}）`);
  return m;
}

/** 按顺序把 [{cn:[...], official:[...]}] 摊平成 URL 列表 */
export function pickUrls(sources, order) {
  const out = [];
  for (const key of order) for (const u of sources[key] || []) if (!out.includes(u)) out.push(u);
  return out;
}

export function hostOf(url) {
  try { return new URL(url).host; } catch (e) { return String(url).slice(0, 40); }
}

export function sha256File(file) {
  const h = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function unlinkQuiet(file) {
  try { fs.unlinkSync(file); } catch (e) {}
}

/** 单次下载（可续传）。返回 true 表示 curl 认为成功。 */
export function downloadTo(url, dst, { maxTime = 600 } = {}) {
  const r = spawnSync("curl", ["-sL", "--max-time", String(maxTime), "-C", "-", "-o", dst, url],
    { encoding: "utf8", windowsHide: true });
  if (r.error) return { ok: false, error: r.error.code || r.error.message };
  // 文件已完整时 -C - 会拿到 416，curl 退出码非 0，但内容是齐的
  if (r.status === 0) return { ok: true };
  if (/416|range/i.test(r.stderr || "")) return { ok: true };
  return { ok: false, error: (r.stderr || "").trim().split("\n").pop() || `curl 退出码 ${r.status}` };
}

/** 按源顺序下载到 dst；校验大小与 sha256，任一项不过就换下一个源
 *  注意：curl 超时（退出码 28）不代表文件没下完——所以「成功与否」只认大小和哈希 */
export function downloadFrom({ urls, dst, minBytes = 1, sha256 = "", label = "文件", maxTime = 600, log = console.log }) {
  const sizeOf = () => { try { return fs.statSync(dst).size; } catch (e) { return 0; } };
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    log(`  · 下载${label}：${hostOf(url)}（源 ${i + 1}/${urls.length}）`);
    const r = downloadTo(url, dst, { maxTime });
    if (!r.ok) log(`   ! ${hostOf(url)} 中断（${r.error}）`);
    const size = sizeOf();
    if (size >= minBytes) {
      if (!sha256) return { ok: true, url, size };
      const actual = sha256File(dst);
      if (actual === sha256) return { ok: true, url, size };
      log(`   ! ${hostOf(url)} sha256 不匹配（期望 ${sha256.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…），丢掉重下`);
      unlinkQuiet(dst);
      continue;
    }
    log(`   ! ${hostOf(url)} 只收到 ${size}B（需要 ≥${minBytes}B），换下一个源（已下的部分会续传）`);
  }
  return { ok: false };
}
