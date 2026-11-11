/* 从最近会話中提取少量长期记忆 patch。
 *
 * 只做提取和校验；模型永远不直接写 persona.json。
 * 调用方传入 callJson（agent/llm.js 的 provider 封装），避免这里再造一套网络层。
 */

const PROFILE_KEYS = new Set(["nickname", "level", "interests", "goals", "preferences", "boundaries"]);
const OPS = new Set(["add", "update", "delete"]);

function buildPrompt({ recent = [], snapshot = {} } = {}) {
  const messages = (Array.isArray(recent) ? recent : [])
    .map((x) => String(x || "").trim().slice(0, 300))
    .filter(Boolean)
    .slice(-6);
  const system = `你是「Nihonco」的长期记忆提取器。
只从下面用户的发言中提取少量、稳定、以后还会用到的信息。

规则：
- 只记用户明确说过的内容；不要从 Nihonco 自己的回复里提取。
- 不要推测、不要补全、不要记一次性情绪或临时话题。
- profile：称呼、等级、长期兴趣、目标、偏好、边界。
- episode：一次具体经历，summary ≤40 字；tags 2–4 个，尽量同时给日中两语标签。
- 不记敏感信息，不记学习进度（单词本已有），不记密码/账号/住址。
- 最多输出 2 条 patch；没有值得记的就输出 {"patches":[]}。
- confidence < 0.7 不要输出。
- 输出严格 JSON，不要 Markdown，不要解释：
{"patches":[
  {"op":"add","type":"profile","key":"preferences","value":"…","confidence":0.9},
  {"op":"add","type":"episode","data":{"topic":"…","summary":"…","tags":["…"],"weight":2},"confidence":0.8}
]}`;
  const user = [
    "当前记忆：",
    JSON.stringify(snapshot, null, 1).slice(0, 3000),
    "",
    "最近用户发言：",
    messages.length ? messages.map((m) => `- ${m}`).join("\n") : "（无）",
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** 过滤模型输出；未知类型/低置信度/空摘要直接丢弃。 */
function normalizePatches(raw) {
  const list = Array.isArray(raw?.patches) ? raw.patches : [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const op = String(p.op || "").toLowerCase();
    const type = String(p.type || "").toLowerCase();
    const confidence = Number(p.confidence);
    if (!OPS.has(op) || !Number.isFinite(confidence) || confidence < 0.7) continue;
    if (type === "profile") {
      const key = String(p.key || "");
      const value = String(p.value || "").trim().slice(0, 80);
      if (!PROFILE_KEYS.has(key) || !value) continue;
      out.push({ op, type, key, value, confidence });
    } else if (type === "episode") {
      if (op === "add" || op === "update") {
        const d = p.data || {};
        const summary = String(d.summary || "").trim().slice(0, 40);
        if (!summary) continue;
        out.push({
          op, type,
          id: String(p.id || "").trim().slice(0, 80),
          data: {
            topic: String(d.topic || "").trim().slice(0, 40),
            summary,
            tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t || "").trim().slice(0, 40)).filter(Boolean).slice(0, 8) : [],
            weight: Math.max(1, Math.min(5, Number(d.weight) || 1)),
            at: String(d.at || "").trim().slice(0, 40),
          },
          confidence,
        });
      } else if (op === "delete") {
        const id = String(p.id || "").trim().slice(0, 80);
        if (id) out.push({ op, type, id, confidence });
      }
    }
    if (out.length >= 2) break;
  }
  return out;
}

async function extract({ recent, snapshot, memory, callJson } = {}) {
  if (typeof callJson !== "function" || !memory) return { ok: false, error: "missing callJson/memory" };
  const messages = buildPrompt({ recent, snapshot });
  let raw;
  try {
    raw = await callJson(messages, 0.1);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const patches = normalizePatches(raw);
  if (!patches.length) return { ok: true, patches: [], applied: [], evicted: [] };
  try {
    const r = memory.patch(patches.map(({ confidence, ...p }) => p));
    return { ok: true, patches, applied: r.applied, evicted: r.evicted };
  } catch (e) {
    return { ok: false, error: e.message, patches };
  }
}

module.exports = { PROFILE_KEYS, OPS, buildPrompt, normalizePatches, extract };
