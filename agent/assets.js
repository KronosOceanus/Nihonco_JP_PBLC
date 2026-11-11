/* 外置资产目录（lite 包 / 用户自备模型）
 *
 * 顺序：项目根目录（开发 / full 包）→ NIHONCO_ASSETS（默认 userData/assets）
 * 只解析 model/ 和 lib/live2dcubismcore.min.js，不把整个目录暴露给静态服务。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ASSET_DIR = process.env.NIHONCO_ASSETS || path.join(ROOT, "assets");

function roots() {
  const out = [ROOT];
  if (path.resolve(ASSET_DIR) !== path.resolve(ROOT)) out.push(ASSET_DIR);
  return out;
}

/** 相对路径（如 model/Hiyori/Hiyori.model3.json）→ 第一个存在的绝对路径 */
function find(rel) {
  const r = String(rel || "").replace(/^[/\\]+/, "");
  if (!r) return null;
  for (const base of roots()) {
    const p = path.join(base, r);
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}

/** 优先项目根，其次外置目录 */
function modelDirs() {
  return roots().map((base) => path.join(base, "model"));
}

module.exports = { ROOT, ASSET_DIR, roots, find, modelDirs };
