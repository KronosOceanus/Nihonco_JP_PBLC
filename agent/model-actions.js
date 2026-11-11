/* 扫描当前 Live2D 模型可触发的表情与动作。
 *
 * 兼容三种登记方式：
 *   1. model3.json 的 FileReferences.Expressions / Motions
 *   2. VTube Studio 的 .vtube.json Hotkeys（ToggleExpression）
 *   3. 模型目录里的 *.exp3.json 兜底
 *
 * 只返回“真的能触发”的项；未注册的 motion3 放进 skipped，不塞进菜单。
 */
const fs = require("fs");
const path = require("path");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

function absModelPath(modelPath, root) {
  const p = String(modelPath || "");
  if (!p) return "";
  return path.isAbsolute(p) ? p : path.join(root, p);
}

/** 递归列出 dir 下的文件（跳过隐藏目录），返回相对路径 */
function walkFiles(dir, depth = 0, root = dir) {
  if (depth > 6) return [];
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(abs, depth + 1, root));
    else if (ent.isFile()) out.push(path.relative(root, abs));
  }
  return out;
}

function fileBase(file) {
  return path.basename(String(file || "")).replace(/\.(exp3|motion3)\.json$/i, "");
}

function relFile(dir, file) {
  const f = String(file || "").trim();
  if (!f) return "";
  return path.isAbsolute(f) ? path.relative(dir, f) : f;
}

function scan(modelPath, { root = path.join(__dirname, "..") } = {}) {
  const file = absModelPath(modelPath, root);
  const dir = path.dirname(file);
  const model = readJson(file);
  const out = { expressions: [], motions: [], skipped: [], modelPath: file, dir };
  if (!model) return out;

  const seenExp = new Set();
  const addExp = (name, rel, source) => {
    const key = String(rel || "").replace(/\\/g, "/");
    if (!key || seenExp.has(key)) return;
    seenExp.add(key);
    const n = String(name || fileBase(rel)).trim() || fileBase(rel);
    // 水印是开关，不是表演；不放进菜单
    if (/水印/.test(n) || /水印/.test(key)) return;
    out.expressions.push({ name: n, file: key, source });
  };

  // 1) model3 标准登记
  const fr = (model && model.FileReferences) || {};
  for (const e of (fr.Expressions || [])) {
    if (e && e.File) addExp(e.Name, relFile(dir, e.File), "model3");
  }

  // 2) VTube 热键
  let vtube = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".vtube.json")) continue;
      vtube = readJson(path.join(dir, f));
      break;
    }
  } catch (e) {}
  for (const h of ((vtube && vtube.Hotkeys) || [])) {
    if (!h || h.Action !== "ToggleExpression" || !h.File) continue;
    if (!String(h.File).endsWith(".exp3.json")) continue;
    addExp(h.Name, relFile(dir, h.File), "vtube");
  }

  // 3) 目录兜底：只要 exp3 文件存在，就能手动播放（含子目录）
  for (const f of walkFiles(dir)) {
    if (!f.endsWith(".exp3.json")) continue;
    addExp("", f, "file");
  }

  // 4) model3 注册的 motion 分组；未注册的文件只报 skipped
  const motions = (fr.Motions || {});
  const seenMotion = new Set();
  for (const [group, list] of Object.entries(motions)) {
    (Array.isArray(list) ? list : []).forEach((m, index) => {
      if (!m || !m.File) return;
      const rel = relFile(dir, m.File);
      if (!rel || seenMotion.has(rel)) return;
      seenMotion.add(rel);
      out.motions.push({
        label: `${group} · ${fileBase(m.File)}`,
        group,
        index,
        file: rel,
        source: "model3",
      });
    });
  }
  for (const f of walkFiles(dir)) {
    if (!f.endsWith(".motion3.json") || seenMotion.has(f)) continue;
    out.skipped.push({ file: f, reason: "未注册到 model3.json 的 Motions" });
  }

  return out;
}

/** 当前模型：从 models.activePath() 取；找不到就返回空结构，不抛错 */
function current(options = {}) {
  try {
    const models = require("./models");
    return scan(models.activePath(), options);
  } catch (e) {
    return { expressions: [], motions: [], skipped: [], error: e.message };
  }
}

module.exports = { scan, current, fileBase };
