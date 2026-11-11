#!/usr/bin/env node
/* 端到端冒烟测试：真的把 Electron 拉起来，切一遍模式，检查界面元素显隐。
 *
 * 为什么需要它：
 *   纯 Node 测试测不到 DOM；之前的界面改动全靠截图肉眼看，改一次要验好几次。
 *   这个脚本把「会話 → 単語 → 例文 → 解説 → 会话」走一遍，
 *   用 computed style 断言显隐，失败就非零退出。
 *
 * 用法：npm run smoke
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 90_000;

/* 渲染层里跑的那段：逐步切模式，采集状态 */
const EVAL = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2500);                                   // 等模型与后端就绪

  const vis = (id) => {
    const el = document.getElementById(id);
    if (!el) return "missing";
    return getComputedStyle(el).display === "none" ? "hidden" : "shown";
  };
  const snap = () => ({
    mode: window.__pet.mode,
    sub: window.__pet.convSubMode,
    label: document.getElementById("mtoggle").textContent,
    gLevel: vis("gLevel"),
    newbatch: vis("newbatch"),
    review: vis("review"),
    wordLv: vis("wordLvWrap"),
    patLv: vis("patternLvWrap"),
    wrongOn: document.getElementById("wrongCount").classList.contains("on"),
    wordCnt: document.getElementById("wordSeen").textContent,
    patCnt: document.getElementById("patternSeen").textContent,
    hasCard: !!document.getElementById("replyText").textContent.trim(),
    // 渲染层真的起来了没：有 canvas + 模型就绪后 HUD 会隐藏
    canvas: !!document.querySelector("canvas"),
    canvasSize: (() => { const c = document.querySelector("canvas"); return c ? (c.width + "x" + c.height) : ""; })(),
    modelReady: document.getElementById("hud").classList.contains("gone"),
  });

  const steps = [];
  const step = async (name, fn) => {
    if (fn) await fn();
    await sleep(1200);
    steps.push([name, snap()]);
  };

  await step("boot");
  await step("teach", () => window.__pet.setMode("teach"));
  await step("word", () => window.__pet.setMode("word"));
  await step("pattern", () => window.__pet.setMode("pattern"));
  await step("backToTeach", () => document.getElementById("mtoggle").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await step("conv", () => window.__pet.setMode("conv"));

  // 健壮性：模型偶尔会给越界的 natural（6/7/0/NaN），渲染不能抛
  const robustness = [7, -1, 0, "5", null, 3.5, NaN, 3].map((n) => {
    try {
      const html = window.__pet.renderComposeReview(
        "テスト", { ok: false, review: { natural: n } }, "再打一次", "おしい！");
      return { n: String(n), threw: false, hasNatural: html.includes("自然") };
    } catch (e) {
      return { n: String(n), threw: true, error: String(e && e.message || e) };
    }
  });

  return JSON.stringify({ ok: true, steps, robustness });
})().catch((e) => JSON.stringify({ ok: false, error: String(e && e.message || e) }))`;

/* 临时数据目录：不碰真实学习记录 */
function makeTempData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-smoke-"));
  const keep = ["jlpt.json", "word-levels.json", "kanji-stems.json", "pattern-gloss-zh.json",
                "patterns-n5.json", "patterns-n4.json", "patterns-n3.json", "patterns-n2.json", "patterns-n1.json",
                "enrich-cache.seed.json"];
  for (const f of keep) {
    const src = path.join(ROOT, "data", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }

  // 种一条错题 + 一个错句型：这样「復習 · N」徽标才有东西可验
  const pick = (file, pred) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, "data", file), "utf8"));
      return (j.items || []).find(pred);
    } catch (e) { return null; }
  };
  const n5 = pick("patterns-n5.json", () => true);
  const levelMap = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "word-levels.json"), "utf8")).levels || {};
  const ja = Object.keys(levelMap).find((k) => levelMap[k] === "N5") || "一";

  fs.writeFileSync(path.join(dir, "wordbook.json"), JSON.stringify({
    words: { [ja]: { ja, level: "N5", ok: 0, wrong: 1, skip: 0, seen: 1, stage: "wrong" } },
  }));
  // 单词错题池只算「当前档」的（vocab-daily.wrongPoolForLevel），默认档是 N4；
  // 种子都是 N5，所以必须把档位也钉成 N5，否则徽标永远是 0。
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ level: "N5" }));
  if (n5) {
    fs.writeFileSync(path.join(dir, "patternbook.json"), JSON.stringify({
      words: { [n5.id]: { id: n5.id, level: "N5", ok: 0, wrong: 1, skip: 0, seen: 1, stage: "wrong" } },
    }));
  }
  return dir;
}

function electronBin() {
  const base = path.join(ROOT, "node_modules", "electron", "dist");
  if (process.platform === "darwin") return path.join(base, "Electron.app", "Contents", "MacOS", "Electron");
  if (process.platform === "win32") return path.join(base, "electron.exe");
  return path.join(base, "electron");
}

function run() {
  const dataDir = makeTempData();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-smoke-ud-"));
  const env = {
    ...process.env,
    NIHONCO_DATA_DIR: dataDir,
    NIHONCO_USER_DATA: userData,      // 独立单实例锁，应用开着也能跑
    PET_EVAL: EVAL,
    PET_EVAL_DELAY: "6000",
    PET_EVAL_EXIT: "1",
    PET_SHOT: "",            // 不要截图，加速
    MOCK_LLM: "1",           // 不联网
  };

  const child = spawn(electronBin(), ["main.js", "--no-sandbox"], { cwd: ROOT, env });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });

  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish({ failed: ["超时：Electron 没有在 90 秒内跑完"] });
  }, TIMEOUT_MS);

  let done = false;
  const finish = (result) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    report(result);
  };

  child.on("close", () => {
    const line = out.split("\n").find((l) => l.startsWith("[eval] "));
    if (!line) {
      if (out.includes("已有实例在运行")) {
        return finish({ failed: [
          "检测到已有一个 Nihonco 实例在运行（单实例锁）",
          "请先退出正在运行的 Nihonco 再跑 npm run smoke",
          "（正常情况下脚本会用临时 NIHONCO_USER_DATA，不该撞锁；若仍撞锁说明该变量没生效）",
        ] });
      }
      return finish({ failed: ["没有拿到 [eval] 输出", err.split("\n").slice(-6).join("\n")] });
    }
    let payload;
    try {
      payload = JSON.parse(line.slice("[eval] ".length));
    } catch (e) {
      return finish({ failed: ["eval 输出不是 JSON: " + line.slice(0, 200)] });
    }
    if (!payload.ok) return finish({ failed: ["渲染层报错: " + payload.error] });
    payload.steps.robustness = payload.robustness || [];
    finish({ steps: payload.steps });
  });
}

/* ---------------- 断言 ---------------- */

const HALF = { gLevel: "hidden", newbatch: "shown", review: "shown", wrongOn: true };
const NONE = { gLevel: "shown", newbatch: "hidden", review: "hidden", wrongOn: false };

function check(steps) {
  const failed = [];
  const get = (name) => {
    const hit = steps.find(([n]) => n === name);
    if (!hit) failed.push(`缺少步骤 ${name}`);
    return hit ? hit[1] : {};
  };
  const eq = (name, key, want) => {
    const s = get(name);
    if (s[key] !== want) failed.push(`${name}.${key} = ${JSON.stringify(s[key])}，期望 ${JSON.stringify(want)}`);
  };
  const cnt = (name, key) => {
    const v = get(name)[key];
    if (!/^\d+\/\d+$/.test(String(v || ""))) failed.push(`${name}.${key} = ${JSON.stringify(v)}，应是 n/n`);
  };

  // 启动：会話模式，只剩全局档位
  eq("boot", "mode", "conv");
  Object.entries(NONE).forEach(([k, v]) => eq("boot", k, v));
  // 模型真的渲染出来了：canvas 存在且模型就绪（HUD 已隐藏）
  eq("boot", "canvas", true);
  eq("boot", "modelReady", true);
  if (!/^\d+x\d+$/.test(String(get("boot").canvasSize || ""))) {
    failed.push(`boot.canvasSize = ${JSON.stringify(get("boot").canvasSize)}，应是 宽x高`);
  }
  cnt("boot", "wordCnt");
  cnt("boot", "patCnt");

  // 解説：仍是对话模式
  eq("teach", "mode", "teach");
  eq("teach", "label", "解説");

  // 单词：全局档位收起，新規/復習/错题/单词档位出现
  eq("word", "mode", "word");
  Object.entries(HALF).forEach(([k, v]) => eq("word", k, v));
  eq("word", "wrongOn", true);            // 临时数据里种了 1 条错题
  eq("word", "wordLv", "shown");
  eq("word", "patLv", "hidden");
  eq("word", "hasCard", true);
  eq("word", "label", "解説");              // 子模式应保持解説
  eq("word", "sub", "teach");

  // 例文：档位与计数换成例文口径
  eq("pattern", "mode", "pattern");
  Object.entries(HALF).forEach(([k, v]) => eq("pattern", k, v));
  eq("pattern", "wrongOn", true);         // 种了 1 个错句型
  eq("pattern", "wordLv", "hidden");
  eq("pattern", "patLv", "shown");
  eq("pattern", "hasCard", true);
  eq("pattern", "label", "解説");

  // 从例文点回按钮 → 回到解説（不是会話）
  eq("backToTeach", "mode", "teach");
  eq("backToTeach", "label", "解説");

  // 回到会話：恢复初始
  eq("conv", "mode", "conv");
  Object.entries(NONE).forEach(([k, v]) => eq("conv", k, v));

  // 越界 natural 不能抛
  const rob = steps.robustness || [];
  if (!rob.length) failed.push("缺少健壮性检查（robustness）");
  for (const r of rob) {
    if (r.threw) failed.push(`natural=${r.n} 抛异常：${r.error}`);
  }
  const norm = rob.find((r) => r.n === "3");
  if (norm && !norm.hasNatural) failed.push("natural=3 时应显示「自然」行");
  const bad = rob.find((r) => r.n === "7");
  if (bad && bad.hasNatural) failed.push("natural=7 越界时不应显示「自然」行");

  return failed;
}

function report({ failed, steps }) {
  if (failed) {
    console.error("✗ 冒烟测试失败");
    for (const f of failed) console.error("  - " + f);
    process.exit(1);
  }
  const list = check(steps);
  if (list.length) {
    console.error("✗ 冒烟测试断言失败");
    for (const f of list) console.error("  - " + f);
    console.error("\n实际状态：");
    for (const [name, s] of steps) console.error("  " + name.padEnd(12), JSON.stringify(s));
    process.exit(1);
  }
  console.log("✓ 冒烟测试通过（" + steps.length + " 步）");
  for (const [name] of steps) console.log("  · " + name);
}

run();
