#!/usr/bin/env node
/* 打包前检查（lite）
 * lite：允许缺 Live2D 模型/Core 与 Whisper 运行时；用户自备
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
console.log("✅ lite：不检查 Live2D 模型/Core 和 Whisper 运行时/模型（用户自备）");
if (IS_WIN) {
  console.log("   Windows lite 不内置 Whisper：首次启动后从设置 → 资源拖入引擎 zip 和 ggml-*.bin");
} else {
  console.log("   mac 构建会先跑 setup-whisper，把 whisper-server 和模型准备到 .whisper/");
}
console.log(`   资产目录：${process.env.NIHONCO_ASSETS || path.join(root, "assets")}`);
