/* 原子写 JSON：先写临时文件再 rename
 * 目的：写到一半崩溃 / 断电时，原文件仍然完整
 * （rename 在同分区是原子操作，不会出现"半个 JSON"）
 */
const fs = require("fs");
const path = require("path");

function writeJsonAtomic(file, data, indent = 2) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, indent), "utf8");
  fs.renameSync(tmp, file);          // 原子替换
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

module.exports = { writeJsonAtomic, readJson };
