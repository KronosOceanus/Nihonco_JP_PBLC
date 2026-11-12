/* 轻量人格记忆：profile + relation + episodes。
 *
 * 只存少量稳定事实和共同经历；不是聊天全文，也不做向量检索。
 * 文件：<DATA_DIR>/persona.json（原子写）。
 *
 * 上限：
 *   profile 的数组条目合计 ≤8（nickname / level 是标量，不占条目）
 *   episodes ≤12
 */
const path = require("path");
const { writeJsonAtomic, readJson } = require("./jsonfile");

const PROFILE_ARRAYS = ["interests", "goals", "preferences", "boundaries"];
const MAX_PROFILE_ITEMS = 8;
const MAX_EPISODES = 12;
const MAX_SUMMARY = 40;

function nowIso() {
  return new Date().toISOString();
}

function blank() {
  return {
    version: 1,
    profile: {
      nickname: "",
      nickname_reading: "",
      level: "",
      interests: [],
      goals: [],
      preferences: [],
      boundaries: [],
    },
    relation: { familiarity: 0, tone: "casual", address: "", note: "" },
    episodes: [],
  };
}

function text(v, max = 200) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function norm(v) {
  return String(v == null ? "" : v).normalize("NFKC").replace(/[\s。、，．,.!！?？「」『』（）()・…]/g, "").toLowerCase();
}

const LEVELS = new Set(["N5", "N4", "N3", "N2", "N1"]);

function validLevel(v) {
  const lv = String(v || "").trim().toUpperCase();
  return LEVELS.has(lv) ? lv : "";
}

function kanaReading(v) {
  const s = String(v || "").trim();
  return /^[\u3040-\u309fー]+$/.test(s) ? s.slice(0, 40) : "";
}

/** 只保留称呼本身；提取器偶尔写成「名字为 X，读音为 Y」，这里兜底拆开 */
function cleanNickname(v) {
  let s = text(v, 80);
  if (!s) return "";
  const m = s.match(/名字(?:为|是|叫)?[「『]([^」』]+)[」』]/);
  if (m) return m[1].trim().slice(0, 40);
  if (/名字|称呼|读音|歳|岁/.test(s)) return "";
  return s.slice(0, 40);
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const v = text(raw, 80);
    if (!v) continue;
    const k = norm(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function clampFamiliarity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function normalizeEpisode(raw = {}) {
  const at = text(raw.at, 40) || new Date().toISOString().slice(0, 10);
  return {
    id: text(raw.id, 80),
    at,
    topic: text(raw.topic, 40),
    summary: text(raw.summary, MAX_SUMMARY),
    tags: uniq(raw.tags).slice(0, 8),
    weight: Math.max(1, Math.min(5, Number(raw.weight) || 1)),
    createdAt: text(raw.createdAt, 40) || nowIso(),
    updatedAt: text(raw.updatedAt, 40) || "",
    lastUsedAt: text(raw.lastUsedAt, 40) || "",
  };
}

function normalize(raw) {
  const d = blank();
  if (!raw || typeof raw !== "object") return d;
  d.profile.nickname = cleanNickname(raw.profile?.nickname);
  d.profile.nickname_reading = kanaReading(raw.profile?.nickname_reading);
  d.profile.level = validLevel(raw.profile?.level);
  for (const k of PROFILE_ARRAYS) d.profile[k] = uniq(raw.profile?.[k]).slice(0, 20);
  d.relation.familiarity = clampFamiliarity(raw.relation?.familiarity);
  d.relation.tone = text(raw.relation?.tone, 20) || "casual";
  d.relation.address = text(raw.relation?.address, 20);
  d.relation.note = text(raw.relation?.note, 120);
  d.episodes = (Array.isArray(raw.episodes) ? raw.episodes : [])
    .map(normalizeEpisode)
    .filter((e) => e.id && e.summary)
    .slice(0, MAX_EPISODES);
  return d;
}

function profileCount(p) {
  return PROFILE_ARRAYS.reduce((n, k) => n + (Array.isArray(p[k]) ? p[k].length : 0), 0);
}

/** 超 8 条：从最长的数组头部淘汰（新条目在尾部） */
function trimProfile(p) {
  const evicted = [];
  while (profileCount(p) > MAX_PROFILE_ITEMS) {
    let key = "";
    for (const k of PROFILE_ARRAYS) {
      if (!p[k].length) continue;
      if (!key || p[k].length > p[key].length) key = k;
    }
    if (!key) break;
    evicted.push({ key, value: p[key].shift() });
  }
  return evicted;
}

/** 超 12 条：低 weight、旧 at 的先淘汰 */
function trimEpisodes(list) {
  const evicted = [];
  const sorted = () => [...list].sort((a, b) => {
    const w = (Number(a.weight) || 1) - (Number(b.weight) || 1);
    if (w) return w;
    return String(a.at).localeCompare(String(b.at));
  });
  while (list.length > MAX_EPISODES) {
    const drop = sorted()[0];
    const i = list.indexOf(drop);
    if (i < 0) break;
    evicted.push(list.splice(i, 1)[0]);
  }
  return evicted;
}

function bigrams(s) {
  const x = norm(s);
  const out = new Set();
  for (let i = 0; i < x.length - 1; i++) out.add(x.slice(i, i + 2));
  return out;
}

function overlap(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / Math.min(A.size, B.size);
}

class MemoryStore {
  constructor({ dataDir } = {}) {
    this.dataDir = dataDir || process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
    this.file = path.join(this.dataDir, "persona.json");
    this.data = null;
  }

  load() {
    this.data = normalize(readJson(this.file, null));
    return this.data;
  }

  save() {
    if (!this.data) this.load();
    writeJsonAtomic(this.file, this.data);
    return this.data;
  }

  snapshot() {
    if (!this.data) this.load();
    return JSON.parse(JSON.stringify(this.data));
  }

  patch(patch) {
    if (!this.data) this.load();
    const list = Array.isArray(patch) ? patch : [patch];
    const evicted = [];
    const applied = [];
    for (const p of list) {
      if (!p || typeof p !== "object") continue;
      const op = String(p.op || "").toLowerCase();
      const type = String(p.type || "").toLowerCase();

      if (type === "profile") {
        const key = String(p.key || "");
        if (PROFILE_ARRAYS.includes(key)) {
          const val = text(p.value, 80);
          if (!val || /年龄|年纪|歳|岁|生日|住址|地址|密码|账号/.test(val)) continue;
          if (op === "add") {
            if (!this.data.profile[key].some((x) => norm(x) === norm(val))) this.data.profile[key].push(val);
            applied.push({ op, type, key, value: val });
          } else if (op === "delete") {
            const before = this.data.profile[key].length;
            this.data.profile[key] = this.data.profile[key].filter((x) => norm(x) !== norm(val));
            if (this.data.profile[key].length !== before) applied.push({ op, type, key, value: val });
          } else if (op === "update") {
            const old = text(p.old, 80);
            const idx = this.data.profile[key].findIndex((x) => norm(x) === norm(old || val));
            if (idx >= 0) this.data.profile[key][idx] = val;
            else if (!this.data.profile[key].some((x) => norm(x) === norm(val))) this.data.profile[key].push(val);
            applied.push({ op, type, key, value: val });
          }
        } else if (key === "nickname" || key === "nickname_reading" || key === "level") {
          if (op === "delete") this.data.profile[key] = "";
          else {
            const next = key === "nickname" ? cleanNickname(p.value)
              : key === "nickname_reading" ? kanaReading(p.value)
              : validLevel(p.value);
            if (!next) continue;   // 非法值不覆盖原值
            this.data.profile[key] = next;
          }
          applied.push({ op, type, key, value: this.data.profile[key] });
        }
      } else if (type === "relation") {
        const rel = this.data.relation;
        if (p.key === "familiarity") rel.familiarity = clampFamiliarity(p.value);
        else if (p.key === "tone") rel.tone = text(p.value, 20) || "casual";
        else if (p.key === "address") rel.address = text(p.value, 20);
        else if (p.key === "note") rel.note = text(p.value, 120);
        else continue;
        applied.push({ op, type, key: p.key, value: rel[p.key] });
      } else if (type === "episode") {
        if (op === "add") {
          const e = normalizeEpisode(p.data || {});
          if (!e.id) e.id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          if (e.summary) {
            this.data.episodes.push(e);
            applied.push({ op, type, id: e.id });
          }
        } else if (op === "update") {
          const id = text(p.id, 80);
          const e = this.data.episodes.find((x) => x.id === id);
          if (e && p.data && typeof p.data === "object") {
            for (const key of ["at", "topic", "summary", "weight", "lastUsedAt"]) {
              if (p.data[key] !== undefined) {
                if (key === "summary") e.summary = text(p.data[key], MAX_SUMMARY);
                else if (key === "weight") e.weight = Math.max(1, Math.min(5, Number(p.data[key]) || 1));
                else if (key === "at") e.at = text(p.data[key], 40);
                else if (key === "topic") e.topic = text(p.data[key], 40);
                else if (key === "lastUsedAt") e.lastUsedAt = text(p.data[key], 40);
              }
            }
            if (p.data.tags !== undefined) e.tags = uniq(p.data.tags).slice(0, 8);
            e.updatedAt = nowIso();
            applied.push({ op, type, id });
          }
        } else if (op === "delete") {
          const id = text(p.id, 80);
          const before = this.data.episodes.length;
          this.data.episodes = this.data.episodes.filter((x) => x.id !== id);
          if (this.data.episodes.length !== before) applied.push({ op, type, id });
        }
      }
    }
    evicted.push(...trimProfile(this.data.profile));
    evicted.push(...trimEpisodes(this.data.episodes));
    if (applied.length || evicted.length) this.save();
    return { ok: true, applied, evicted, data: this.snapshot() };
  }

  addProfile(key, value) { return this.patch({ op: "add", type: "profile", key, value }); }
  addEpisode(data) { return this.patch({ op: "add", type: "episode", data }); }
  updateEpisode(id, data) { return this.patch({ op: "update", type: "episode", id, data }); }
  deleteEpisode(id) { return this.patch({ op: "delete", type: "episode", id }); }
  setRelation(key, value) { return this.patch({ op: "update", type: "relation", key, value }); }

  scoreEpisode(e, userText) {
    const t = norm(userText);
    let score = 0;
    if (t) {
      for (const tag of e.tags || []) if (t.includes(norm(tag)) && norm(tag)) score += 3;
      score += overlap(userText, `${e.topic} ${e.summary}`) * 4;
    }
    score += (Number(e.weight) || 1) * 0.4;
    const at = Date.parse(e.at);
    if (Number.isFinite(at)) score += Math.max(0, 1 - (Date.now() - at) / (90 * 864e5));
    if (e.lastUsedAt && Date.now() - Date.parse(e.lastUsedAt) < 2 * 864e5) score -= 0.5;
    return score;
  }

  /** 选择与当前输入相关的 episode；没有命中就不硬塞。 */
  selectEpisodes(userText, { limit = 3 } = {}) {
    if (!this.data) this.load();
    const scored = this.data.episodes
      .map((e) => ({ e, score: this.scoreEpisode(e, userText) }))
      .filter((x) => {
        const t = norm(userText);
        if (!t) return false;
        const tagHit = (x.e.tags || []).some((tag) => t.includes(norm(tag)) && norm(tag));
        return tagHit || overlap(userText, `${x.e.topic} ${x.e.summary}`) >= 0.2;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit));
    return scored.map((x) => x.e);
  }

  /** 拼成给 prompt 的小块；无内容返回空字符串。 */
  context(userText, { limit = 3 } = {}) {
    if (!this.data) this.load();
    const p = this.data.profile;
    const rel = this.data.relation;
    const lines = [];
    const who = [
      p.nickname ? `叫我 ${p.nickname}${p.nickname_reading ? `（读音 ${p.nickname_reading}）` : ""}` : "",
      p.level ? `在学日语（${p.level}）` : "",
    ].filter(Boolean);
    const facts = [];
    for (const k of PROFILE_ARRAYS) if (p[k].length) facts.push(`${k === "interests" ? "喜欢" : k === "goals" ? "目标" : k === "preferences" ? "偏好" : "边界"}：${p[k].join("、")}`);
    if (who.length || facts.length) {
      lines.push("【关于对方】");
      if (who.length) lines.push(who.join("；"));
      for (const f of facts) lines.push(f);
    }
    const eps = this.selectEpisodes(userText, { limit });
    if (eps.length) {
      lines.push("【最近记得】");
      for (const e of eps) lines.push(`${e.at} · ${e.summary}`);
    }
    if (rel.familiarity > 0 || rel.note) {
      lines.push("【相处】");
      lines.push(`熟悉度 ${rel.familiarity}/5${rel.note ? `；${rel.note}` : ""}`);
    }
    return lines.join("\n").slice(0, 1200);
  }

  clear() {
    this.data = blank();
    this.save();
    return this.snapshot();
  }
}

function createMemory(opts) {
  return new MemoryStore(opts);
}

module.exports = {
  MemoryStore, createMemory,
  PROFILE_ARRAYS, MAX_PROFILE_ITEMS, MAX_EPISODES, MAX_SUMMARY,
  blank, normalize, trimProfile, trimEpisodes, validLevel, kanaReading, cleanNickname,
};
