#!/usr/bin/env node
/* 设置页冒烟：真实启动 Electron，检查注册表、语音参数自动保存、保存按钮 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVAL = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  const app = window.SettingsApp;
  const speed = document.getElementById("speed");
  speed.value = "1.1";
  speed.dispatchEvent(new Event("input", { bubbles: true }));
  speed.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(800);
  document.getElementById("save").click();
  await sleep(800);
  return JSON.stringify({
    ok: true,
    modules: app.modules.map((m) => m.name),
    engine: document.getElementById("ttsEngine")?.value || "",
    voice: document.getElementById("voicePick")?.value || "",
    speed: speed.value,
    status: document.getElementById("status")?.textContent || "",
    saved: (document.getElementById("status")?.textContent || "").includes("已保存"),
    restartApi: typeof window.cfg.restartApp,
  });
})().catch((e) => JSON.stringify({ ok: false, error: String(e && e.message || e) }))`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-settings-"));
for (const [src, name] of [[path.join(ROOT, "data/settings.json"), "settings.json"], [path.join(ROOT, ".env"), ".env"]]) {
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
}
const bin = process.platform === "darwin"
  ? path.join(ROOT, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
  : path.join(ROOT, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");
const child = spawn(bin, ["main.js", "--no-sandbox"], {
  cwd: ROOT,
  env: { ...process.env, NIHONCO_DATA_DIR: dir, NIHONCO_USER_DATA: dir, PET_SETTINGS_EVAL: EVAL, PET_SETTINGS_EVAL_DELAY: "5000" },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
let done = false;
const timer = setTimeout(() => finish("timeout"), 45_000);
function finish(why) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (why === "timeout") {
    console.error("✗ 设置页冒烟失败：超时");
    try { child.kill("SIGKILL"); } catch (e) {}
    process.exit(1);
  }
  const m = out.match(/\[settings-eval\]\s+(.+)/);
  if (!m) {
    console.error("✗ 设置页冒烟失败：没有 settings-eval 输出");
    console.error(out.split("\n").slice(-10).join("\n"));
    try { child.kill("SIGKILL"); } catch (e) {}
    process.exit(1);
  }
  let r;
  try { r = JSON.parse(m[1].trim()); if (typeof r === "string") r = JSON.parse(r); } catch (e) {
    console.error("✗ 设置页冒烟失败：JSON 解析失败");
    process.exit(1);
  }
  try { child.kill("SIGKILL"); } catch (e) {}
  if (!r.ok || !r.modules?.includes("tts") || !r.engine || !r.saved || r.restartApi !== "function") {
    console.error("✗ 设置页冒烟失败：", JSON.stringify(r));
    process.exit(1);
  }
  console.log("✓ 设置页冒烟通过");
  console.log(`  modules: ${r.modules.join(", ")}`);
  console.log(`  engine: ${r.engine} / ${r.voice}`);
  console.log(`  save: ${r.status}`);
  process.exit(0);
}
child.stdout.on("data", (d) => {
  out += d.toString();
  if (out.includes("[settings-eval]")) setTimeout(() => finish(), 100);
});
child.stderr.on("data", (d) => { out += d.toString(); });
child.on("exit", () => setTimeout(() => finish(), 300));
