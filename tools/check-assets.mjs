#!/usr/bin/env node
/* 打包前检查（lite）
 * lite：允许缺模型/Core；由用户放 %APPDATA%\Nihonco\assets
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("✅ lite：不检查模型/Core（用户从官方获取后放到 assets/）");
console.log(`   资产目录：${process.env.NIHONCO_ASSETS || path.join(root, "assets")}`);
