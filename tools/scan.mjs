#!/usr/bin/env node
/* 项目自检：静态扫描常见"改了 A 忘了 B"的问题
 *
 *   npm run scan
 *
 * 覆盖：
 *   1. 跨模块调用 vs module.exports        （调用了不存在的方法）
 *   2. IPC 通道：ipcMain 注册 vs 渲染层调用  （通道名写错）
 *   3. preload 暴露面 vs 渲染层使用          （window.pet.xxx 没暴露）
 *   4. JSON 契约字段 vs parseTurn 保留字段    （模型输出被丢掉）
 *   5. 数据文件 JSON 是否合法
 *   6. 死函数（只定义、从未被引用）
 *   7. DOM id：JS 里 getElementById/querySelector 引用的 id 是否在 HTML 里存在
 *   8. 打包数据白名单：package.json build.files 与 agent/boot-data.js 的 SHARED_DATA 是否同步
 *   9. 数据 schema：备份里的每个文件都要有 schema 版本与迁移入口
 *  10. 页面 CSP：两个窗口都要有 Content-Security-Policy，且不许 unsafe-eval / 内联脚本
 *  2. IPC 通道：pet:* 必须带 fromPet 守卫（petHandle/petOn 包装）
 *  12. main/ 注入边界：不许裸用 win / settingsWin / IS_WIN / IS_PACKAGED 等
 *  11. 打包覆盖：main/agent 里的相对 require + 页面的 script/link 都要能被 build.files 覆盖
 *
 * 退出码：发现问题返回 1，干净返回 0。
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { topLevelNames } from "./scan-globals.mjs";

// Windows 上 URL.pathname 会给出 "/D:/path/..."，path.resolve 后变成 "D:\D:\path\..."
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), "utf8");

const problems = [];
const warnings = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { problems.push(msg); console.log(`  ✗ ${msg}`); };

/* ---------------- 1. 跨模块调用 ---------------- */
function checkCrossModule() {
  console.log("\n[1] 跨模块调用 vs 导出");

  // 自动发现 agent/*.js，别名从源码里的 require 绑定推断（不再手工维护清单）
  const agentFiles = fs.readdirSync(rel("agent")).filter((f) => f.endsWith(".js")).sort();
  const allSources = ["main.js", "preload.js", "preload-settings.js", "pet.js", "settings/app.js",
    ...agentFiles.map((f) => `agent/${f}`), ...fs.readdirSync(rel("tools")).filter((f) => f.endsWith(".mjs")).map((f) => `tools/${f}`)];
  const sources = {};
  for (const f of allSources) { try { sources[f] = read(f); } catch (e) {} }

  // 工厂模块：createXxx() 返回一组实例方法，调用点用的是这些方法
  const factoryMethods = {
    "agent/eventlog.js": ["append", "readAll", "readAllWithOffset", "size", "rotateIfNeeded",
                          "setRotateHook", "ensureDir", "FILE", "ARCHIVE", "BASELINE"],
  };

  let count = 0;
  for (const file of agentFiles) {
    const base = file.replace(/\.js$/, "");
    const src = sources[`agent/${file}`] || "";
    const m = src.match(/module\.exports\s*=\s*\{([^}]*)\}/);
    const names = new Set(m ? m[1].split(",").map((x) => x.trim().split(":")[0].trim()).filter(Boolean) : []);
    for (const extra of factoryMethods[`agent/${file}`] || []) names.add(extra);
    if (!names.size) continue;

    // 别名：任何文件里 `const X = require("...<base>")` 的 X
    const aliases = new Set();
    const re = new RegExp(
      `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*["'](?:\\.\\.?/)*(?:agent/)?${base}(?:\\.js)?["']\\s*\\)\\s*;?\\s*(?=\\n|$)`,
      "g");
    for (const [f, srcText] of Object.entries(sources)) {
      if (f === `agent/${file}`) continue;
      for (const hit of srcText.matchAll(re)) {
        if (hit[1].length >= 2) aliases.add(hit[1]);   // 单字母别名太容易和局部变量撞
      }
    }
    if (!aliases.size) continue;

    for (const [target, text] of Object.entries(sources)) {
      if (target === `agent/${file}`) continue;
      for (const alias of aliases) {
        for (const hit of text.matchAll(new RegExp(`\\b${alias}\\.([a-zA-Z_$][\\w$]*)\\s*\\(`, "g"))) {
          if (!names.has(hit[1])) {
            const line = text.slice(0, hit.index).split("\n").length;
            bad(`${target}:${line} 调用 ${alias}.${hit[1]}()，但 agent/${file} 没导出`);
            count++;
          }
        }
      }
    }
  }
  if (!count) ok(`${agentFiles.length} 个 agent 模块的导出与全部调用点一致`);
}

/* ---------------- 2. IPC 通道 ---------------- */
function checkIpc() {
  console.log("\n[2] IPC 通道");
  // 通道注册现在可能在 main.js 或 main/*.js（拆分后）
  const mainFiles = [
    "main.js",
    ...(() => {
      try {
        return fs.readdirSync(rel("main")).filter((f) => f.endsWith(".js")).sort().map((f) => `main/${f}`);
      } catch (e) { return []; }
    })(),
    ...(() => {
      try {
        return fs.readdirSync(rel("main/ipc")).filter((f) => f.endsWith(".js")).sort().map((f) => `main/ipc/${f}`);
      } catch (e) { return []; }
    })(),
  ];
  const registered = new Set();
  for (const f of mainFiles) {
    // 直呼 + pet 包装（petHandle / petOn，带 fromPet 守卫）
    for (const m of read(f).matchAll(/(?:ipcMain\.(?:handle|on)|pet(?:Handle|On)|ipc(?:Handle|On)|settings(?:Handle|On))\(\s*['"]([^'"]+)['"]/g)) registered.add(m[1]);
  }

  // pet:* 必须走 petHandle/petOn（带 fromPet 守卫），不许直接 ipcMain.handle/on
  for (const f of mainFiles) {
    const src = read(f);
    for (const m of src.matchAll(/(?:ipcMain\.(?:handle|on)|ipc(?:Handle|On))\(\s*['"](pet:[^'"]+)['"]/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      bad(`${f}:${line} 的 ${m[1]} 必须用 petHandle/petOn（pet 通道必须带 fromPet）`);
    }
  }

  // cfg:* 必须走 settingsHandle/settingsOn（设置通道必须校验 sender）
  for (const f of mainFiles) {
    const src = read(f);
    for (const m of src.matchAll(/(?:ipcMain\.(?:handle|on)|ipc(?:Handle|On))\(\s*['"](cfg:[^'"]+)['"]/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      bad(`${f}:${line} 的 ${m[1]} 必须用 settingsHandle/settingsOn（设置通道必须校验 sender）`);
    }
  }

  const calls = [];
  for (const f of ["preload.js", "preload-settings.js"]) {
    const src = read(f);
    for (const m of src.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*['"]([^'"]+)['"]/g)) {
      calls.push({ file: f, ch: m[1], line: src.slice(0, m.index).split("\n").length });
    }
  }

  const missing = calls.filter((c) => !registered.has(c.ch));
  missing.forEach((c) => bad(`${c.file}:${c.line} 调用未注册的通道 ${c.ch}`));
  const calledNames = new Set(calls.map((c) => c.ch));
  const unused = [...registered].filter((ch) => !calledNames.has(ch));
  if (!missing.length) ok(`注册 ${registered.size} 个通道，渲染层 ${calls.length} 处调用全部有对应`);
  if (unused.length) warnings.push(`注册但未被渲染层调用：${unused.join(", ")}`);
}

/* ---------------- 3. preload 暴露面 ---------------- */
function checkPreload() {
  console.log("\n[3] preload 暴露面");
  const surfaces = [
    { preload: "preload.js", api: "pet", consumer: "pet.js" },
    { preload: "preload-settings.js", api: "cfg", consumer: "settings/app.js" },
  ];
  let count = 0;
  for (const { preload, api, consumer } of surfaces) {
    const src = read(preload);
    const body = src.slice(src.indexOf("exposeInMainWorld"));
    const names = new Set([
      ...[...body.matchAll(/([a-zA-Z_$][\w$]*)\s*:\s*\(/g)].map((m) => m[1]),
      ...[...body.matchAll(/([a-zA-Z_$][\w$]*)\s*:\s*[a-zA-Z_$][\w$]*\s*,/g)].map((m) => m[1]),
    ]);
    const c = read(consumer);
    for (const m of c.matchAll(new RegExp(`window\\.${api}\\.([a-zA-Z_$][\\w$]*)`, "g"))) {
      if (!names.has(m[1])) {
        bad(`${consumer}:${c.slice(0, m.index).split("\n").length} 用了 window.${api}.${m[1]}，preload 没暴露`);
        count++;
      }
    }
    if (count === 0) ok(`${api} 暴露 ${names.size} 个接口，${consumer} 用到的都在`);
  }
}

/* ---------------- 4. 契约字段 ---------------- */
function checkContract() {
  console.log("\n[4] JSON 契约 vs parseTurn");
  const prompt = read("agent/prompt.js");
  const contract = prompt.match(/const JSON_CONTRACT = `[\s\S]*?`/)?.[0] || "";
  const nested = new Set(["wrong", "right", "why_zh", "ja", "kana", "zh"]);
  const fields = [...contract.matchAll(/"([a-z_]+)"\s*:/g)].map((m) => m[1]).filter((f) => !nested.has(f));
  const llm = read("agent/llm.js");
  const missing = fields.filter((f) => !new RegExp(`\\b${f}:`).test(llm));
  if (missing.length) missing.forEach((f) => bad(`契约要求 ${f}，但 parseTurn 没保留`));
  else ok(`契约 ${fields.length} 个顶层字段全部被 parseTurn 保留`);
}

/* ---------------- 5. 数据文件 ---------------- */
function checkData() {
  console.log("\n[5] 数据文件");
  const required = ["data/jlpt.json", "data/enrich-cache.seed.json"];   // 随仓库提供
  const dataDir = rel("data");
  const present = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter((f) => f.endsWith(".json")).map((f) => `data/${f}`)
    : [];

  let count = 0;
  // 必需文件
  for (const f of required) {
    if (!fs.existsSync(rel(f))) { bad(`${f} 缺失（应由仓库提供）`); count++; continue; }
  }
  // 目录里实际存在的全部检查（本地运行时文件在就查，不在就跳过）
  for (const f of present.sort()) {
    try {
      const j = JSON.parse(read(f));
      const size = Array.isArray(j) ? `${j.length} 条` : `${Object.keys(j).length} 键`;
      ok(`${f}（${size}）`);
    } catch (e) {
      bad(`${f} 不是合法 JSON：${e.message.slice(0, 60)}`);
      count++;
    }
  }
  const skipped = ["data/wordbook.json", "data/vocab-daily.json", "data/settings.json", "data/enrich-cache.json"]
    .filter((f) => !present.includes(f));
  if (skipped.length) console.log(`  · 本地运行时文件暂不存在，跳过：${skipped.join("、")}`);
  return count;
}

/* ---------------- 8. 打包数据白名单一致性 ---------------- */
function checkPackData() {
  console.log("\n[8] 打包数据白名单");
  const before = problems.length;
  const pkg = JSON.parse(read("package.json"));
  const files = (pkg.build && pkg.build.files) || [];
  const packed = files.filter((f) => typeof f === "string" && f.startsWith("data/"));
  const boot = read("agent/boot-data.js");
  const m = boot.match(/const SHARED_DATA = \/(.+)\//);
  if (!m) { bad("agent/boot-data.js 里找不到 SHARED_DATA 正则"); return 1; }

  let regex;
  try { regex = new RegExp(m[1]); } catch (e) { bad(`SHARED_DATA 不是合法正则：${e.message}`); return 1; }

  // ① 不依赖 git：build.files 里列的每个文件必须真实存在（抓改名/删除/打错字）
  for (const f of packed) {
    if (!fs.existsSync(rel(f))) bad(`${f} 在 build.files 里，但仓库里没有这个文件（打包会缺）`);
  }

  // ② 不依赖 git：build.files 里每个 data/*.json 都要能被 SHARED_DATA 匹配
  for (const f of packed) {
    const base = path.basename(f);
    if (!regex.test(base)) bad(`${f} 在 build.files 里，但不被 SHARED_DATA 匹配（打进包也不会 seed）`);
  }

  // ③ 只有 git 可用时才做：仓库跟踪的 data/*.json 是否都进了 build.files
  //    （Windows CI 上没装 git 时只跳过这一条，①② 仍然有效）
  let trackedOk = null;
  try {
    const tracked = execSync("git ls-files data/*.json", { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((x) => x.trim()).filter(Boolean);
    trackedOk = true;
    for (const f of tracked) {
      if (!packed.includes(f)) bad(`${f} 被仓库跟踪，但没进 build.files（打包后会缺文件）`);
    }
  } catch (e) {
    trackedOk = false;
  }

  if (!packed.length) bad("build.files 里没有任何 data/*.json（打包后会没有词表）");
  else if (problems.length === before) ok(`${packed.length} 个共享数据文件：build.files / SHARED_DATA 一致`);
  else console.log(`  · 共 ${packed.length} 个共享数据文件，其中上面标出的有问题`);
  if (trackedOk === false) {
    console.log("  · 没有 git 可用，跳过「仓库跟踪文件是否都被打包」（其余两条已检查）");
  }
  return 0;
}

/* ---------------- 7. DOM id 交叉检查 ---------------- */
/** renderer/ 下所有 js 文件（按文件名排序；拆分后 DOM 访问大多在这里） */
function rendererJs() {
  try {
    return fs.readdirSync(rel("renderer")).filter((f) => f.endsWith(".js")).sort()
      .map((f) => `renderer/${f}`);
  } catch (e) { return []; }
}

function checkDomIds() {
  console.log("\n[7] DOM id 引用");
  const settingsJs = (() => {
    try { return fs.readdirSync(rel("settings")).filter((f) => f.endsWith(".js")).sort().map((f) => `settings/${f}`); }
    catch (e) { return ["settings/app.js"]; }
  })();
  const pairs = [
    { html: "pet.html", js: ["pet.js", ...rendererJs()] },
    { html: "settings/index.html", js: settingsJs },
  ];
  let count = 0;

  for (const { html, js } of pairs) {
    const src = read(html);
    const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const jsSrc = js.map((f) => [f, read(f)]);
    let used = 0;

    for (const [f, code] of jsSrc) {
      const refs = [
        ...[...code.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => [m[1], m.index]),
        ...[...code.matchAll(/querySelector\(\s*["']#([\w$-]+)["']\s*\)/g)].map((m) => [m[1], m.index]),
        // 本项目习惯用 $("id") 包一层 getElementById
        ...(/const \$\s*=\s*\(id\)\s*=>\s*document\.getElementById/.test(code)
          ? [...code.matchAll(/\$\s*\(\s*["']([\w$-]+)["']\s*\)/g)].map((m) => [m[1], m.index])
          : []),
      ];
      for (const [id, idx] of refs) {
        used++;
        if (!ids.has(id)) {
          bad(`${f}:${code.slice(0, idx).split("\n").length} 引用 #${id}，但 ${html} 里没有这个 id`);
          count++;
        }
      }
    }
    if (!count) ok(`${html} 提供 ${ids.size} 个 id，${js.join("/")} 引用 ${used} 处全部存在`);
  }
  return count;
}

/* ---------------- 9. 数据 schema 覆盖 ---------------- */
function checkSchemaCover() {
  console.log("\n[9] 数据 schema 覆盖");
  const before = problems.length;
  const schemaSrc = read("agent/schema.js");
  const backupSrc = read("agent/backup.js");

  // CURRENT 里登记的文件名
  const curBlock = schemaSrc.match(/const CURRENT = \{([\s\S]*?)\};/);
  if (!curBlock) { bad("agent/schema.js 里找不到 CURRENT"); return 1; }
  const current = new Set([...curBlock[1].matchAll(/^\s*"?([a-z-]+)"?\s*:\s*\d+/gm)].map((m) => m[1]));

  // backup 的 SCHEMA_NAME 映射
  const mapBlock = backupSrc.match(/const SCHEMA_NAME = \{([\s\S]*?)\};/);
  if (!mapBlock) { bad("agent/backup.js 里找不到 SCHEMA_NAME"); return 1; }
  const pairs = [...mapBlock[1].matchAll(/(\w+):\s*"([a-z-]+)"/g)].map((m) => [m[1], m[2]]);

  for (const [fileKey, schemaName] of pairs) {
    if (!current.has(schemaName)) bad(`backup 的 ${fileKey} 映射到 "${schemaName}"，但 schema.CURRENT 里没有（导入时不会迁移）`);
  }

  // backup 的 FILES 里每个文件都应该有映射
  const filesBlock = backupSrc.match(/const FILES = \{([\s\S]*?)\};/);
  if (filesBlock) {
    const keys = [...filesBlock[1].matchAll(/(\w+):\s*"/g)].map((m) => m[1]);
    const mapped = new Set(pairs.map(([k]) => k));
    for (const k of keys) if (!mapped.has(k)) bad(`backup.FILES 有 ${k}，但 SCHEMA_NAME 没映射（导入时不会迁移）`);
  }

  if (problems.length === before) ok(`schema 覆盖 ${current.size} 个数据文件，备份映射齐全`);
  return 0;
}

/* ---------------- 11. 打包覆盖（require/页面引用 vs build.files） ---------------- */
/** 极简 glob：** / * / ?，只用于匹配 build.files 的写法 */
function globToRe(g) {
  let out = "^";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") { i++; out += "(?:.*/)?"; } else out += ".*";
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

function packCovered(relPath, files) {
  const norm = relPath.replace(/^\.\//, "");
  let ok = false;
  for (const pat of files) {
    if (typeof pat !== "string") continue;
    if (pat.startsWith("!")) {
      if (globToRe(pat.slice(1)).test(norm)) return false;   // 被排除
    } else if (globToRe(pat).test(norm)) ok = true;
  }
  return ok;
}

function checkPackCoverage() {
  console.log("\n[11] 打包覆盖（require / 页面引用）");
  const before = problems.length;
  const pkg = JSON.parse(read("package.json"));
  const files = (pkg.build && pkg.build.files) || [];
  const need = new Set();

  // ① 主进程侧的相对 require（main.js、agent/、main/）
  const jsFiles = [
    "main.js",
    ...fs.readdirSync(rel("agent")).filter((f) => f.endsWith(".js")).map((f) => `agent/${f}`),
    ...fs.readdirSync(rel("main")).filter((f) => f.endsWith(".js")).map((f) => `main/${f}`),
  ];
  for (const f of jsFiles) {
    const code = read(f);
    for (const m of code.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      // 统一用 / 分隔：Windows 上 path.join 会给反斜杠，
      // 而 build.files 的 glob 是 POSIX 写法，直接比对会把所有文件判成「没被覆盖」
      const resolved = path.normalize(path.join(path.dirname(f), m[1])).split(path.sep).join("/");
      need.add(resolved.endsWith(".js") || resolved.endsWith(".json") ? resolved : `${resolved}.js`);
    }
  }

  // ② 页面引用（script src / link href）；node_modules 由 electron-builder 自动带
  for (const html of ["pet.html", "settings/index.html"]) {
    const src = read(html);
    const base = path.posix.dirname(html);
    const resolveRef = (u) => path.posix.normalize(path.posix.join(base, u));
    for (const m of src.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) need.add(resolveRef(m[1]));
    for (const m of src.matchAll(/<link[^>]*\bhref="([^"]+)"/g)) need.add(resolveRef(m[1]));
  }

  // ③ 打包的 .whisper 只允许：两个平台的二进制 + 运行必需的 DLL + 181MB 小模型
  //    （Windows 的 whisper-server.exe 是动态链接的，缺 whisper.dll/ggml*.dll 起不来）
  const WCPP_ALLOW = new Set([
    ".whisper/whisper-server",
    ".whisper/whisper-server.exe",
    ".whisper/whisper.dll",
    ".whisper/ggml.dll",
    ".whisper/ggml-base.dll",
    ".whisper/ggml-cpu-*.dll",
    ".whisper/models/ggml-small-q5_1.bin",
  ]);
  for (const pat of files) {
    if (typeof pat !== "string" || !pat.startsWith(".whisper")) continue;
    if (!WCPP_ALLOW.has(pat)) bad(`build.files 里的 ${pat} 不在允许清单（只带 whisper-server + ggml-small-q5_1.bin）`);
  }

  // 词典类运行依赖：kuromoji 的 dict 必须进包，否则打包后读音判断直接失效
  if (fs.existsSync(rel("node_modules/kuromoji/package.json"))) {
    const kp = JSON.parse(read("node_modules/kuromoji/package.json"));
    for (const name of ["kuromoji", ...Object.keys(kp.dependencies || {})]) {
      if (!files.some((f) => String(f).startsWith(`node_modules/${name}/`))) {
        bad(`build.files 缺 node_modules/${name}（kuromoji 词典的运行依赖，打包后「也算对」会用不了）`);
      }
    }
  }

  let checked = 0;
  for (const p of [...need].sort()) {
    if (p.startsWith("node_modules/") || p.startsWith("../")) continue;
    checked++;
    // 用户自备的资产（不随仓库分发）：允许缺失，打包前由 tools/check-assets.mjs 检查
    if (p === "lib/live2dcubismcore.min.js") continue;
    if (!fs.existsSync(rel(p))) { bad(`${p} 被引用，但仓库里不存在`); continue; }
    if (!packCovered(p, files)) bad(`${p} 被引用，但不在 build.files 里（打包后会缺）`);
  }
  if (problems.length === before) ok(`${checked} 个被引用的文件都能被 build.files 覆盖`);
  return 0;
}

/* ---------------- 12. main/ 模块的注入边界 ---------------- */
function checkInjectBoundary() {
  console.log("\n[12] main/ 注入边界");
  const before = problems.length;
  // 这些模块通过 ctx 拿依赖；裸用 main.js 的变量会变成 ReferenceError（运行时才炸）
  const FORBID = [
    [/(?<![.\w])win\b/g, "win（用 getWin()）"],
    [/(?<![.\w])settingsWin\b/g, "settingsWin（用 getSettingsWin()）"],
    [/(?<![.\w])IS_WIN\b/g, "IS_WIN（注入 isWin）"],
    [/(?<![.\w])IS_PACKAGED\b/g, "IS_PACKAGED（注入 isPackaged）"],
    [/(?<![.\w])levelIdle\b/g, "levelIdle（用 getLevelIdle()）"],
    [/(?<![.\w])passThrough\b/g, "passThrough（用 getPassThrough()）"],
  ];
  let n = 0;
  for (const f of ["main/ipc.js", "main/menu.js", "main/voice.js", "main/asr.js"]) {
    if (!fs.existsSync(rel(f))) continue;
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "");   // 去注释
    for (const [re, hint] of FORBID) {
      for (const m of code.matchAll(re)) {
        const line = code.slice(0, m.index).split("\n").length;
        bad(`${f}:${line} 裸用 ${hint}`);
        n++;
      }
    }
  }
  // 防止「全局替换 on( → ipcOn(」这类误伤（曾把 res.json() 改成 res.jsipcOn()）
  if (fs.existsSync(rel("main/ipc.js"))) {
    const code = read("main/ipc.js");
    for (const m of code.matchAll(/[A-Za-z0-9_]ipc(?:On|Handle)\(/g)) {
      const line = code.slice(0, m.index).split("\n").length;
      bad(`main/ipc.js:${line} 出现 ${m[0]}（像是批量替换误伤了普通函数名）`);
    }
  }

  // ipc.js 用到的服务函数必须出现在 ctx 解构里（否则运行时 ReferenceError，被 try/catch 吞掉）
  const ipcPath = "main/ipc.js";
  if (fs.existsSync(rel(ipcPath))) {
    const code = read(ipcPath);
    const m = code.match(/const \{([\s\S]*?)\} = ctx;/);
    const injected = new Set(m ? m[1].split(",").map((x) => x.split(":").pop().trim()).filter(Boolean) : []);
    const NEED = ["ensureVoicevox", "startVoicevox", "speakToWav", "prewarmPrompts",
      "refreshVoiceCache", "pickVoice", "loadPet", "openSettings", "startAsr", "restartAsr", "ensureAsr",
      "VOICE_DIR", "ROOT", "DATA_DIR"];
    for (const name of NEED) {
      if (new RegExp("\\b" + name + "\\b").test(code) && !injected.has(name)) {
        bad(`${ipcPath} 用了 ${name}，但 ctx 解构里没有（运行时会 ReferenceError）`);
      }
    }
  }

  // ipc.js 的解构字段必须在 main.js 的 createIpc({...}) 里存在
  if (fs.existsSync(rel(ipcPath)) && fs.existsSync(rel("main.js"))) {
    const ipcCode = read(ipcPath);
    const dm = ipcCode.match(/const \{([\s\S]*?)\} = ctx;/);
    const mm = read("main.js").match(/createIpc\(\{([\s\S]*?)\}\);/);
    if (dm && mm) {
      const body = mm[1].replace(/\/\/[^\n]*/g, "");   // 去行注释，避免逗号被注释挡掉
      for (const part of dm[1].split(",")) {
        const raw = part.trim();
        if (!raw) continue;
        const src = raw.includes(":") ? raw.split(":")[1].split("=")[0].trim() : raw.split("=")[0].trim();
        if (!/^[a-zA-Z_$][\w$]*$/.test(src)) continue;
        // 支持 `key: value` 与简写 `key`；不按逗号切（箭头函数里有逗号）
        const okKey = new RegExp(`(?:^|[{,])\\s*${src}\\s*[:,}]`).test(body);
        if (!okKey) bad(`ipc ctx 键与解构不一致：ipc.js 要 ${src}，但 main.js 的 createIpc({...}) 没给`);
      }
    }
  }

  if (problems.length === before) ok("main/ 模块都通过 ctx 取依赖，没有裸用 main.js 的变量");
  return n;
}

/* ---------------- 10. 页面 CSP ---------------- */
function checkCsp() {
  console.log("\n[10] 页面 CSP");
  const before = problems.length;
  for (const f of ["pet.html", "settings/index.html"]) {
    const html = read(f);
    if (!/Content-Security-Policy/i.test(html)) { bad(`${f} 没有 CSP meta`); continue; }
    if (!/script-src 'self'/i.test(html)) bad(`${f} 的 CSP 应限制 script-src 'self'`);
    if (/'unsafe-eval'/i.test(html)) bad(`${f} 的 CSP 不要放开 unsafe-eval（pixi 用 @pixi/unsafe-eval 补丁）`);
    // 内联 <script>（没有 src）在 CSP 下会被拦，等于死代码
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .filter((m) => m[1].trim().length > 0);
    if (inline.length) bad(`${f} 里有 ${inline.length} 段内联脚本（CSP 下不会执行）`);
  }
  if (problems.length === before) ok("两个页面都有严格 CSP，且没有内联脚本");
  return 0;
}

/* ---------------- 6. 死函数 ---------------- */
function checkDeadFunctions() {
  console.log("\n[6] 死函数（启发式）");
  const files = ["main.js", "pet.js", "settings/app.js",
                 ...fs.readdirSync(rel("agent")).filter((f) => f.endsWith(".js")).map((f) => `agent/${f}`)];
  const allSrc = Object.fromEntries(files.map((f) => [f, read(f)]));
  let count = 0;

  for (const [file, src] of Object.entries(allSrc)) {
    const defs = [...src.matchAll(/^(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    const exported = new Set((src.match(/module\.exports\s*=\s*\{([^}]*)\}/)?.[1] || "")
      .split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean));
    for (const name of defs) {
      if (exported.has(name)) continue;
      // 统计：带括号调用 + 作为回调传入（不带括号）
      let refs = 0;
      for (const [f2, s2] of Object.entries(allSrc)) {
        const hits = [...s2.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length;
        refs += f2 === file ? Math.max(0, hits - 1) : hits;
      }
      if (refs === 0) { bad(`${file}: ${name}() 定义了但从未被引用`); count++; }
    }
  }
  if (!count) ok("没有只定义未使用的函数");
}


/* ---------------- 13. IPC 模块依赖注入 ---------------- */
function checkIpcModuleDeps() {
  console.log("\n[13] IPC 模块依赖注入");
  const dir = "main/ipc";
  let files = [];
  try { files = fs.readdirSync(rel(dir)).filter((f) => f.endsWith(".js")).sort(); } catch (e) { return; }
  const ipcSrc = read("main/ipc.js") + "\n" + read("main/ipc/settings.js");
  let n = 0;
  for (const f of files) {
    const src = read(`${dir}/${f}`);
    const m = src.match(/module\.exports\s*=\s*function\s+\w+\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (!m) { bad(`${dir}/${f}: 找不到模块工厂的参数解构`); n++; continue; }
    const deps = m[1].split(",").map((x) => x.split(":")[0].split("=")[0].trim()).filter(Boolean);
    const base = f.replace(/\.js$/, "");
    let idx = ipcSrc.indexOf(`require('./ipc/${base}')`);
    if (idx < 0) idx = ipcSrc.indexOf(`require('./${base}')`);
    if (idx < 0) { bad(`${dir}/${f}: main/ipc.js 没有注册（require('./ipc/${base}')）`); n++; continue; }
    const open = ipcSrc.indexOf('({', idx);
    const close = ipcSrc.indexOf('});', open);
    if (open < 0 || close < 0) { bad(`${dir}/${f}: 注册调用没有对象参数`); n++; continue; }
    const body = ipcSrc.slice(open, close);
    for (const d of deps) {
      if (!new RegExp(`\\b${d}\\b`).test(body)) bad(`${dir}/${f}: 依赖 ${d} 没有在 main/ipc.js 的注册调用里传入`);
      else n++;
    }

    // 反向：模块里用了 ctx 名，但既没解构、也不是本地声明 → 运行时 ReferenceError
    const ctxM = ipcSrc.match(/const \{([\s\S]*?)\} = ctx;/);
    const ctxNames = ctxM ? ctxM[1].split(",").map((x) => x.split(":")[0].split("=")[0].trim())
      .filter((x) => /^[A-Za-z_$][\w$]*$/.test(x)) : [];
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/`(?:\\[\s\S]|[^`])*`/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, '""')
      .replace(/"(?:\\.|[^"\\])*"/g, '""');
    const locals = new Set(deps);
    for (const lm of code.matchAll(/(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/g)) locals.add(lm[1]);
    for (const name of ctxNames) {
      if (!new RegExp(`\\b${name}\\b`).test(code)) continue;
      if (locals.has(name)) continue;
      bad(`${dir}/${f}: 用了 ${name} 但没解构（运行时会 ReferenceError）`);
    }
  }
  if (!n) ok("IPC 模块依赖与注册调用一致");
}

/* ---------------- 14. 渲染层全局声明 ---------------- */
function checkRendererGlobals() {
  console.log("\n[14] 渲染层全局声明");
  const groups = [
    {
      name: "pet 页（共享作用域）",
      shared: true,
      files: ["pet.js", ...fs.readdirSync(rel("renderer")).filter((f) => f.endsWith(".js")).sort().map((f) => `renderer/${f}`)],
    },
    { name: "settings 共享作用域", shared: true, files: ["settings/app.js"] },
    {
      name: "settings IIFE（内部隔离）",
      shared: false,
      files: ["settings/assets.js", "settings/data.js", "settings/shortcuts.js", "settings/memory.js"],
    },
  ];
  let dup = 0, total = 0;
  for (const g of groups) {
    const seen = new Map();
    let count = 0;
    for (const f of g.files) {
      const names = topLevelNames(read(f));
      count += names.length;
      total += names.length;
      if (!g.shared) continue;
      for (const name of names) {
        if (seen.has(name)) { bad(`${f}: 顶层 ${name} 与 ${seen.get(name)} 重复声明（${g.name}）`); dup++; }
        else seen.set(name, f);
      }
    }
    console.log(`  · ${g.name}: ${g.files.length} 文件 / ${count} 个顶层声明`);
  }
  if (!dup) ok(`${total} 个顶层声明没有跨文件重名（IIFE 内部不参与跨文件比较）`);
}

/* ---------------- run ---------------- */
console.log("Nihonco 项目自检");
checkCrossModule();
checkIpc();
checkPreload();
checkContract();
checkData();
checkDeadFunctions();
checkDomIds();
checkPackData();
checkSchemaCover();
checkCsp();
checkPackCoverage();
checkInjectBoundary();
checkIpcModuleDeps();
checkRendererGlobals();

if (warnings.length) {
  console.log("\n提示：");
  warnings.forEach((w) => console.log("  · " + w));
}
console.log(`\n${problems.length ? "❌ 发现 " + problems.length + " 个问题" : "✅ 全部通过"}`);
process.exit(problems.length ? 1 : 0);
