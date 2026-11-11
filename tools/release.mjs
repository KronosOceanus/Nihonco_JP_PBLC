#!/usr/bin/env node
/* 发版自动化：npm run release -- 0.3.15 [--no-test] [--push] [--sync-windows] [--dry]
 *
 * 它只做「每次发版都要重复做、且容易漏」的四件事：
 *   1. 校验版本号（必须比当前大）
 *   2. 改 package.json
 *   3. 把 CHANGELOG 的「## 未发布」变成「## vX.Y.Z」
 *   4. 跑 test + scan，然后 commit + tag
 *
 * 推送是显式的（--push），同步 windows 分支也是显式的（--sync-windows）——
 * 默认不碰远端。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.join(ROOT, p);

const args = process.argv.slice(2);
const versionOriginal = args.find((a) => !a.startsWith("--"));
const SUMMARY = (() => {
  const i = args.indexOf("--summary");
  return i >= 0 ? String(args[i + 1] || "").trim() : "";
})();
const NO_TEST = args.includes("--no-test");
const PUSH = args.includes("--push");
const SYNC_WIN = args.includes("--sync-windows");
const DRY = args.includes("--dry");

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);

function sh(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", ...opts });
}
function git(...a) { return sh("git", a); }

function semver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

console.log("\nNihonco 发版\n" + "=".repeat(30));

/* 1. 版本号 */
const pkgPath = rel("package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const cur = pkg.version;
const BUMP = { patch: 2, minor: 1, major: 0 };
let version = versionOriginal;
let next = semver(version);
let auto = false;
if (BUMP[versionOriginal] !== undefined) {
  next = [...semver(cur)];
  next[BUMP[versionOriginal]] += 1;
  for (let i = BUMP[versionOriginal] + 1; i < 3; i++) next[i] = 0;
  version = next.join(".");
  auto = true;
}
if (!next) { bad(`版本号要写成 x.y.z 或 patch/minor/major（收到 ${versionOriginal || "(空)"}）`); process.exit(1); }
if (cmp(next, semver(cur)) <= 0) { bad(`新版本 ${version} 必须大于当前 ${cur}`); process.exit(1); }
ok(`版本 ${cur} → ${version}${auto ? `（自动 ${versionOriginal} 递增）` : ""}`);

/* 2. 工作区必须干净（避免把无关改动一起提交） */
const dirty = git("status", "--porcelain").stdout.trim();
if (dirty && !DRY) {
  bad("工作区不干净，先提交或 stash：\n" + dirty.split("\n").slice(0, 10).join("\n"));
  process.exit(1);
}
ok("工作区干净");

/* 3. 检查 CHANGELOG 有没有「未发布」段 */
const logPath = rel("CHANGELOG.md");
let changelog = fs.readFileSync(logPath, "utf8");
const hasUnreleased = /^## 未发布$/m.test(changelog);
if (!hasUnreleased) {
  console.error("✗ CHANGELOG 缺少「## 未发布」段；先写变更再发版，避免产生空版本标题");
  process.exit(1);
}
ok("CHANGELOG 有「## 未发布」段");

if (DRY) {
  console.log("\n--dry：只打印计划，不写文件、不跑测试、不提交");
  process.exit(0);
}

/* 4. 写文件 */
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

changelog = changelog.replace(/^## 未发布$/m, `## v${version}`);
fs.writeFileSync(logPath, changelog);
ok("已更新 package.json / CHANGELOG.md");

/* 5. README 版本行（有就改，没有就提醒） */
const readmePath = rel("README.md");
let readme = fs.readFileSync(readmePath, "utf8");
const before = readme;
readme = readme.replace(new RegExp(`\\*\\*v${cur.replace(/\./g, "\\.")}\\*\\*`, "g"), `**v${version}**`);
readme = readme.replace(new RegExp(`tag \`v${cur.replace(/\./g, "\\.")}\``, "g"), `tag \`v${version}\``);
if (SUMMARY && /[（）]/.test(SUMMARY)) {
  warn("summary 里不要用括号：README 版本行本身是「**vX.Y.Z**（说明）」，会套成双重括号");
}

if (SUMMARY) {
  // 不用正则：找到「**vX.Y.Z**（」后替换到下一个「）」，避免 `**` 的转义坑
  const tag = `**v${version}**`;
  const i = readme.indexOf(tag);
  if (i >= 0) {
    const lineEnd = readme.indexOf("\n", i);
    const j = readme.indexOf("）", i);
    // 只在同一行内替换，避免吞掉后面的内容（版本行没写「（说明）」时）
    if (j > i && (lineEnd < 0 || j < lineEnd)) {
      readme = readme.slice(0, i) + tag + `（${SUMMARY}）` + readme.slice(j + 1);
    } else warn("README 版本行不是「**vX.Y.Z**（说明）」格式，--summary 没应用");
  } else warn("README 里没找到 **vX.Y.Z**，--summary 没应用");
}
if (readme !== before) { fs.writeFileSync(readmePath, readme); ok("README 版本行已更新" + (SUMMARY ? "（含说明）" : "")); }
else warn("README 里没找到旧版本号，记得手改版本行");

if (SUMMARY && hasUnreleased) {
  changelog = changelog.replace(`## v${version}\n`, `## v${version} — ${SUMMARY}\n`);
  fs.writeFileSync(logPath, changelog);
}

/* 6. 测试 + 扫描 */
if (!NO_TEST) {
  console.log("\n跑测试与扫描…");
  const t = sh("npm", ["test"], { stdio: "inherit" });
  if (t.status !== 0) { bad("npm test 失败，已停在提交前（改动还在工作区）"); process.exit(1); }
  const s = sh("npm", ["run", "scan"], { stdio: "inherit" });
  if (s.status !== 0) { bad("scan 失败，已停在提交前"); process.exit(1); }
  ok("测试与扫描通过");
} else {
  warn("--no-test：跳过测试与扫描");
}

/* 7. 提交 + 打 tag */
const add = git("add", "-A");
if (add.status !== 0) { bad("git add 失败"); process.exit(1); }
const commit = git("commit", "-m", `v${version}`);
if (commit.status !== 0) { bad("git commit 失败：\n" + commit.stderr); process.exit(1); }
const tag = git("tag", "-a", `v${version}`, "-m", `v${version}`);
if (tag.status !== 0) { bad("git tag 失败：\n" + tag.stderr); process.exit(1); }
ok(`已提交并打 tag v${version}`);

/* 8. 可选：推送 / 同步 windows */
if (PUSH) {
  const p1 = git("push", "origin", "main");
  if (p1.status !== 0) { bad("push main 失败：\n" + p1.stderr); process.exit(1); }
  const p2 = git("push", "origin", `v${version}`);
  if (p2.status !== 0) { bad("push tag 失败：\n" + p2.stderr); process.exit(1); }
  ok("已推送 main 与 tag");
} else {
  warn("未推送（需要时加 --push）");
}

if (SYNC_WIN) {
  const co = git("checkout", "windows");
  const mg = co.status === 0 ? git("merge", "--ff-only", "main") : co;
  const push = mg.status === 0 ? git("push", "origin", "windows") : mg;
  const back = git("checkout", "main");
  if (push.status !== 0) bad("同步 windows 分支失败：\n" + (push.stderr || ""));
  else ok("windows 分支已同步" + (PUSH ? "并推送" : "（本地，未推送）"));
  if (back.status !== 0) bad("切回 main 失败，请手动 checkout main");
}

if (!SUMMARY) warn("没给 --summary：README 的版本说明和 CHANGELOG 标题仍是旧文案，记得手改");
console.log(`\n完成：v${version}`);
if (!PUSH) console.log("  推送：git push origin main && git push origin v" + version);
