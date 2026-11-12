/* 识别后端与模型的可选清单（设置窗口用）
 *
 *   ASR_BACKEND 留空 = 自动：有 whisper.cpp（二进制+模型）就用它，否则 mlx
 *   Windows：只能用 whispercpp
 *
 * 模型来源：
 *   mlx       → .hf-cache/hub/models--*（HF 仓库名，也可手填本地目录）
 *   whispercpp→ .whisper/models/*.bin（文件名）
 */
const fs = require("fs");
const path = require("path");
const platform = require("./platform");

const ROOT = path.join(__dirname, "..");
const HF_HUB = path.join(ROOT, ".hf-cache", "hub");
const whisperModelsDir = (root = ROOT) => process.env.NIHONCO_WHISPER_MODELS
  || path.join(process.env.WHISPER_HOME || path.join(root, ".whisper"), "models");
const IS_WIN = process.platform === "win32";

function mlxModels(root = ROOT) {
  const hub = path.join(root, ".hf-cache", "hub");
  const out = [];
  try {
    for (const d of fs.readdirSync(hub)) {
      if (!d.startsWith("models--")) continue;
      const repo = d.slice("models--".length).replace(/--/g, "/");
      const snap = path.join(hub, d, "snapshots");
      let ready = false;
      try {
        for (const s of fs.readdirSync(snap)) {
          if (fs.existsSync(path.join(snap, s, "weights.npz")) ||
              fs.existsSync(path.join(snap, s, "weights.safetensors"))) { ready = true; break; }
        }
      } catch (e) {}
      let bytes = 0;
      try {
        for (const s2 of fs.readdirSync(snap)) {
          for (const f of fs.readdirSync(path.join(snap, s2))) {
            try { bytes += fs.statSync(path.join(snap, s2, f)).size; } catch (e) {}
          }
        }
      } catch (e) {}
      out.push({ value: repo, ready, bytes });
    }
  } catch (e) {}
  // 已下好的在前；同组按体积由小到大（体积未知的排后面）
  return out.sort((a, b) =>
    Number(b.ready) - Number(a.ready) ||
    (a.bytes || Infinity) - (b.bytes || Infinity) ||
    a.value.localeCompare(b.value));
}

function wcppModels(root = ROOT) {
  // 用户可写模型目录优先；再扫内置目录（打包后 app.asar.unpacked）
  const home = process.env.WHISPER_HOME || path.join(root, ".whisper");
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(path.resolve(d))) dirs.push(path.resolve(d)); };
  add(whisperModelsDir(root));
  add(path.join(home, "models"));
  const seen = new Map();
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".bin") || seen.has(f)) continue;
        const full = path.join(dir, f);
        const bytes = fs.statSync(full).size;
        const mb = Math.round(bytes / 1024 / 1024);
        seen.set(f, { value: f, label: `${f}（${mb}MB）`, bytes, ready: true });
      }
    } catch (e) {}
  }
  // 由小到大（按体积，不是文件名）——列表里一眼看出去哪个最轻
  return [...seen.values()].sort((a, b) => a.bytes - b.bytes || a.value.localeCompare(b.value));
}

/** 某个 mlx 模型是否已就绪：支持 HF 仓库名和本地目录 */
function mlxModelReady(name, root = ROOT) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  const local = path.isAbsolute(raw) ? raw : path.join(root, raw);
  if (["weights.npz", "weights.safetensors"].some((f) => {
    try { return fs.existsSync(path.join(local, f)); } catch (e) { return false; }
  })) return true;
  return mlxModels(root).some((m) => m.ready && m.value === raw.replace(/\\/g, "/"));
}

function available(root = ROOT) {
  const mlxPy = !IS_WIN && fs.existsSync(path.join(root, ".venv", "bin", "python"));
  const mlxList = mlxModels(root);
  const mlxReady = mlxList.some((m) => m.ready);
  const whisperHome = process.env.WHISPER_HOME || path.join(root, ".whisper");
  const wcppBin = fs.existsSync(path.join(whisperHome, IS_WIN ? "whisper-server.exe" : "whisper-server"));
  // 后端可用 = 运行环境 + 至少一个真正就绪的模型
  const models = wcppModels(root);
  return {
    mlx: mlxPy && mlxReady,
    mlxBin: mlxPy,
    mlxModels: mlxList.filter((m) => m.ready).length,
    wcpp: wcppBin && models.length > 0,
    wcppBin,
    wcppModels: models.length,
  };
}

/** 当前配置 + 可选清单 */
function info(root = ROOT) {
  const av = available(root);
  const mlxList = mlxModels(root);
  const wcppList = wcppModels(root);
  const smallest = (list) => (list.find((m) => m.ready) || list[0] || {}).value || "";
  const backend = platform.resolveAsrBackend({
    configured: process.env.ASR_BACKEND, whisper: av.wcpp, mlx: av.mlx,
  });
  const rawModel = String(process.env.ASR_MODEL || "").trim();
  // whisper.cpp 只认文件名：HF 仓库名（带 /）在这里没有意义，规整成最小模型，
  // 否则设置窗口会把它当成「自定义」选中，运行时却回落到别的 .bin。
  const misplaced = backend === "whispercpp" && rawModel.includes("/");
  const missing = backend === "whispercpp" && !!rawModel && !misplaced
    && !wcppList.some((m) => m.value === rawModel);
  const model = misplaced || missing ? smallest(wcppList) : rawModel;
  return {
    backend,
    model,
    rawModel,
    misplacedModel: misplaced,     // UI 可以据此提示「原值不适用于 whisper.cpp」
    missingModel: missing,         // .env 指定的 .bin 已不存在，运行时回退
    defaultModel: backend === "whispercpp" ? smallest(wcppList) : smallest(mlxList),
    defaults: { mlx: smallest(mlxList), whispercpp: smallest(wcppList) },
    backends: [
      {
        id: "whispercpp", label: IS_WIN ? "whisper.cpp（CUDA / CPU，免 Python）" : "whisper.cpp（Metal，免 Python）",
        available: av.wcpp,
        hint: av.wcpp ? ""
          : (!av.wcppBin ? "缺 .whisper/whisper-server：跑 npm run setup:whisper"
                         : "缺模型：把 ggml-*.bin 放进 .whisper/models/"),
      },
      {
        id: "mlx", label: "mlx-whisper（Apple GPU，需 Python）",
        available: av.mlx, hidden: IS_WIN,
        hint: av.mlx ? "" : (!av.mlxBin ? "缺 .venv：先跑 npm run setup" : "缺 mlx 模型：先跑 npm run setup"),
      },
    ].filter((b) => !b.hidden),
    mlxModels: mlxList,
    wcppModels: wcppList,
    whisperHome: process.env.WHISPER_HOME || path.join(ROOT, ".whisper"),
    whisperModelsDir: whisperModelsDir(),
    hfCache: path.join(ROOT, ".hf-cache"),
    isWin: IS_WIN,
  };
}

module.exports = { info, mlxModels, wcppModels, mlxModelReady, available };
