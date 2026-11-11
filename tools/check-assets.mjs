#!/usr/bin/env node
/* 打包前检查
 *   full：模型 + Cubism Core 必须在，缺了会打出「能装不能用」的包
 *   lite：允许缺失；模型/Core 由用户放 %APPDATA%\Nihonco\assets
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const models = require("../agent/models.js");
const assets = require("../agent/assets.js");
const lite = process.argv.includes("--lite");

const active = models.activePath();
const modelPath = path.isAbsolute(active) ? active : assets.find(active);
const corePath = assets.find("lib/live2dcubismcore.min.js");

if (lite) {
  console.log("✅ lite：不检查模型/Core（用户从官方获取后放到 assets/）");
  console.log(`   资产目录：${process.env.NIHONCO_ASSETS || path.join(root, "assets")}`);
  process.exit(0);
}

const need = [
  [corePath, "lib/live2dcubismcore.min.js", "Live2D Cubism Core（从 Cubism SDK for Web 取）"],
  [modelPath, active, "当前 Live2D 模型（从 Live2D 示例数据页取，或设置 LIVE2D_MODEL）"],
];
const missing = need.filter(([p]) => !p || !fs.existsSync(p));
if (!missing.length) {
  console.log("✅ 模型与 Live2D Core 都在");
  process.exit(0);
}
console.error("✗ 打包缺资源：");
for (const [, rel, hint] of missing) console.error(`  - ${rel}  ← ${hint}`);
console.error("\n见 docs/ASSETS.md；补齐后再打包。");
process.exit(1);
