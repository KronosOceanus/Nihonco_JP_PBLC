/* 常用服务商 + 模型目录
 * 目的：界面里只选「模型名」，接口地址自动跟着定，不再手打 base URL
 * （模型名在同一服务商内唯一，跨服务商的同名情况用「服务商 · 模型」的显示区分）
 */
const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    base: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openai",
    name: "OpenAI",
    base: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o4-mini"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    models: ["deepseek/deepseek-chat", "openai/gpt-4o-mini"],
  },
  {
    id: "moonshot",
    name: "Moonshot",
    base: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k"],
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    base: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
  },
  {
    id: "ollama",
    name: "本地 Ollama",
    base: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5:7b", "llama3.1:8b"],
  },
];

/** 全部模型（带 provider 信息），给下拉框用 */
function catalog() {
  const out = [];
  for (const p of PROVIDERS) {
    for (const m of p.models) out.push({ model: m, base: p.base, provider: p.id, providerName: p.name });
  }
  return out;
}

/** 按模型名反查接口地址（同名取第一个，界面用「服务商 · 模型」避免歧义） */
function baseOf(model) {
  const m = String(model || "").trim();
  if (!m) return "";
  const hit = catalog().find((x) => x.model === m);
  return hit ? hit.base : "";
}

/** 读取本机 Ollama 已安装模型（设置页动态补充） */
async function ollamaModels(base = "http://127.0.0.1:11434/v1") {
  const root = String(base || "").replace(/\/v1\/?$/, "");
  try {
    const r = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.models || []).map((x) => String(x.name || "").trim()).filter(Boolean);
  } catch (e) { return []; }
}

/** 当前配置对应哪一项（找不到就是"自定义"） */
function find(model, base) {
  const m = String(model || "").trim();
  const b = String(base || "").replace(/\/+$/, "");
  return catalog().find((x) => x.model === m && (!b || x.base === b)) || null;
}

module.exports = { PROVIDERS, catalog, baseOf, find, ollamaModels };
