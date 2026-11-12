/* 从最近会話中提取少量长期记忆 patch。
 *
 * 只做提取和校验；模型永远不直接写 persona.json。
 * 调用方传入 callJson（agent/llm.js 的 provider 封装），避免这里再造一套网络层。
 */

const { validLevel, kanaReading, cleanNickname } = require("./memory");
const PROFILE_KEYS = new Set(["nickname", "nickname_reading", "level", "interests", "goals", "preferences", "boundaries"]);
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
- profile 字段严格按含义使用：
  nickname 只写称呼本身（如「山田」），不要写「名字为…」「读音为…」
  nickname_reading 只写平假名读音（如「やまだ」），不要括号
  level 只能是 N5 / N4 / N3 / N2 / N1；年龄、职业、初级/高级都不是 level
  interests / goals / preferences / boundaries 每条只写一个短事实
  relation.address 只表示称呼方式（さん / ちゃん / 呼び捨て），不写名字
- episode：一次具体经历，summary ≤40 字；tags 2–4 个，尽量同时给日中两语标签。
- 不记年龄、生日、住址、账号、密码、健康、宗教、政治倾向；即使用户说出年龄也不要提取。
- 不记学习进度（单词本已有）。
- 不确定属于哪个字段就丢弃，不要猜、不要塞进最近的字段。
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
      let value = String(p.value || "").trim().slice(0, 80);
      if (!PROFILE_KEYS.has(key) || !value) continue;
      if (key === "level") {
        value = validLevel(value);
        if (!value) continue;
      } else if (key === "nickname_reading") {
        value = kanaReading(value);
        if (!value) continue;
      } else if (key === "nickname") {
        value = cleanNickname(value);
        if (!value) continue;
      } else if (/年龄|年纪|歳|岁|生日|住址|地址|密码/.test(value)) {
        continue;   // 不记年龄/住址等，禁止塞进兴趣/目标/偏好
      }
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
