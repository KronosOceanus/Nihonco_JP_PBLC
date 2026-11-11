/* 语音识别日志（可选，默认开；设置窗口「应用信息 → 语音识别 → 日志」可关）
 *
 *   <DATA_DIR>/logs/asr.log        当前日志
 *   <DATA_DIR>/logs/asr.log.1      上一份（超过 2MB 时轮转）
 *
 * 只记元数据 + 文本前 60 字，不落音频。
 * 开关：环境变量 ASR_LOG=0 关闭（设置窗口写入 .env，立即生效，不用重启）。
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const DIR = path.join(DATA_DIR, "logs");
const FILE = process.env.NIHONCO_ASR_LOG_FILE || path.join(DIR, "asr.log");
const MAX_BYTES = Number(process.env.ASR_LOG_MAX || 2 * 1024 * 1024);   // 2MB

function enabled() {
  const v = String(process.env.ASR_LOG ?? "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function rotateIfBig() {
  try {
    if (fs.statSync(FILE).size < MAX_BYTES) return;
    const prev = FILE + ".1";
    try { fs.unlinkSync(prev); } catch (e) {}
    fs.renameSync(FILE, prev);
  } catch (e) { /* 文件还不存在 */ }
}

/**
 * @param {{ms:number, bytes:number, lang?:string, engine?:string,
 *          prompt?:number, retried?:boolean, text?:string}} r
 */
function record(r = {}) {
  if (!enabled()) return false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    rotateIfBig();
    const d = new Date();
    const t = d.toISOString().replace("T", " ").slice(0, 19);
    const secs = (Number(r.ms || 0) / 1000).toFixed(2);
    const text = String(r.text || "").replace(/\s+/g, " ").slice(0, 60);
    const line = [
      t,
      `${secs}s`,
      `${Math.round(Number(r.bytes || 0))}B`,
      r.lang || "ja",
      r.engine || "?",
      `prompt=${r.prompt || 0}`,
      r.retried ? "retry" : "-",
      JSON.stringify(text),
    ].join(" | ") + "\n";
    fs.appendFileSync(FILE, line, "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

function tail(n = 20) {
  try {
    return fs.readFileSync(FILE, "utf8").trimEnd().split("\n").slice(-n).join("\n");
  } catch (e) { return ""; }
}

module.exports = { record, enabled, tail, FILE, MAX_BYTES, rotateIfBig };
