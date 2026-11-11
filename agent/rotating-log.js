/* 追加型小日志：带体积上限的轮转（app.log 等追加型日志共用）
 *
 *   <file>        当前
 *   <file>.1      上一份（超过 maxBytes 时轮转，只保留 1 份）
 *
 * 与 agent/asr-log.js 的区别：这个是通用工具，调用方决定文件名和上限。
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_MAX = 256 * 1024;   // 256KB ≈ 几百条 JSON 行

function size(file) {
  try { return fs.statSync(file).size; } catch (e) { return 0; }
}

/** 超过上限就把当前文件挪成 .1（旧的 .1 直接删） */
function rotateIfNeeded(file, maxBytes = DEFAULT_MAX) {
  try {
    if (size(file) < maxBytes) return false;
    const prev = file + ".1";
    try { fs.rmSync(prev, { force: true }); } catch (e) {}
    fs.renameSync(file, prev);
    return true;
  } catch (e) {
    return false;
  }
}

/** 追加一行（自动补换行），并保证文件不超过上限 */
function append(file, line, opts = {}) {
  const maxBytes = Number(opts.maxBytes || DEFAULT_MAX);
  const text = String(line == null ? "" : line);
  const one = text.endsWith("\n") ? text : text + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rotateIfNeeded(file, maxBytes);
  fs.appendFileSync(file, one, "utf8");
  return { file, bytes: size(file) };
}

/** 读最后 n 行（调试/测试用） */
function tail(file, n = 20) {
  try {
    const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
    return lines.slice(-n).join("\n");
  } catch (e) { return ""; }
}

module.exports = { append, rotateIfNeeded, size, tail, DEFAULT_MAX };
