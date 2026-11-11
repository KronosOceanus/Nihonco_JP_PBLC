/* 读取 .env（不引 dotenv）：进程环境优先，其次用户数据目录，最后项目根
 * 单独成模块，是为了让 config.js / llm.js / tts.js 共用同一份解析结果，
 * 并且保证「先加载 .env，再读 process.env」的顺序。
 *
 * 为什么要分两级：
 *   打包后代码在 app.asar 里（只读），设置窗口保存 key 时写的是
 *   <用户数据目录>/.env（见 config.js 的 ENV_FILE）；如果这里只读
 *   项目根 .env，就会「保存了但下次启动读不到、又要重新填」。
 */
const fs = require("fs");
const path = require("path");

/** 解析一行的值：去掉行尾注释（引号里的 # 不算），再去掉成对引号 */
function parseValue(raw) {
  let v = String(raw || "").trim();
  const quoted = v.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) return quoted[2];
  // 只有「空白 + #」才算注释：URL 里的 # 和密码里的 # 不受影响
  v = v.replace(/\s+#.*$/, "").trim();
  return v;
}

/** 按优先级列出 .env 候选：用户数据目录 > 项目根 */
function envFiles() {
  const list = [];
  if (process.env.NIHONCO_DATA_DIR) list.push(path.join(process.env.NIHONCO_DATA_DIR, ".env"));
  list.push(path.join(__dirname, "..", ".env"));
  return list;
}

function loadEnv() {
  const env = { ...process.env };
  for (const file of envFiles()) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch (e) { continue; }
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      // .env.example 里大量行尾带注释（VOICEVOX_NAME=小夜   # 按角色名匹配），
      // 直接整行当值会让名字匹配不上、模型名/语言名也带上注释 —— 必须剥掉。
      if (m && !env[m[1]]) env[m[1]] = parseValue(m[2]);
    }
  }
  return env;
}

module.exports = { loadEnv, parseValue, envFiles };
