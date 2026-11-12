/* 快捷键：默认值、校验、持久化、冲突检测
 *
 * 两类：
 *   global —— 全局（globalShortcut），不聚焦也能用，必须带修饰键
 *   local  —— 桌宠窗口内（renderer），可以只是单个字母
 *
 * 持久化：data/shortcuts.json（只存改过的项；默认值由 shortcutMod() 按平台算）
 */
const fs = require("fs");
const path = require("path");
const platform = require("./platform");
const { writeJsonAtomic } = require("./jsonfile");

const DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "shortcuts.json");

const AUTO_STOP_DEF = 1.2;      // 停顿多少秒自动结束录音（切换式）
const AUTO_STOP_MIN = 1;
const AUTO_STOP_MAX = 5;

const IS_WIN = platform.IS_WIN;

/* macOS 用 ⌥+键（语音输入类应用的惯例，如 Superwhisper 的 ⌥Space）；
 * Windows 用 Ctrl+Alt+键（Alt+字母会触发菜单栏）。
 * 避开 ⌥E/U/I/N/K（死键）、⌥Tab、⌥方向键。 */
const GLOBAL_DEF = IS_WIN
  ? { toggle: "Control+Alt+H", record: "Control+Alt+Space", mute: "Control+Alt+M", focus: "Control+Alt+K" }
  : { toggle: "Alt+H", record: "Alt+Space", mute: "Alt+M", focus: "Alt+J" };

/** 动作清单：id → 显示名 + 默认键 */
const ACTIONS = {
  global: {
    toggle: { label: "显示 / 隐藏桌宠", def: GLOBAL_DEF.toggle },
    record: { label: "开始 / 结束录音", def: GLOBAL_DEF.record },
    mute: { label: "静音 / 打断朗读", def: GLOBAL_DEF.mute },
    focus: { label: "聚焦输入框", def: GLOBAL_DEF.focus },
  },
  // 窗口内用功能键：不产生文字，所以输入框聚焦时也能用（字母/数字会和打字抢）
  local: {
    conv: { label: "会話模式", def: "F1" },
    word: { label: "単語模式", def: "F2" },
    pattern: { label: "例文模式", def: "F3" },
    reread: { label: "重读上一句", def: "F4" },
    mute: { label: "静音开关", def: "F5" },
  },
};

const MOD_ALIASES = {
  cmd: "Command", command: "Command", cmdorctrl: "CommandOrControl",
  commandorcontrol: "CommandOrControl", commandorctrl: "CommandOrControl",
  ctrl: "Control", control: "Control", alt: "Alt", option: "Alt",
  shift: "Shift", super: "Super", meta: "Super",
};
const MODS = new Set(["CommandOrControl", "Command", "Control", "Alt", "Shift", "Super"]);
// Electron accelerator 里允许的按键名（够用即可；不接受多字符键名）
// macOS 上这些 Option+字母 是组合音/死键，不能做全局快捷键
const MAC_DEAD_KEYS = new Set(["E", "U", "I", "N", "K"]);
const KEYS = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."0123456789".split(""),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  "Space", "Tab", "Backspace", "Delete", "Insert", "Enter", "Escape",
  "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
  "Comma", "Period", "Slash", "Semicolon", "Quote", "BracketLeft", "BracketRight",
  "Backslash", "Minus", "Equal", "Backquote", "Plus",
]);

/** 统一写法：CommandOrControl+Control+H（修饰键按固定顺序，主键大写） */
function normalize(accel) {
  const parts = String(accel || "").split("+").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  const mods = [];
  let key = "";
  for (const p of parts) {
    const low = p.toLowerCase();
    if (MOD_ALIASES[low]) { mods.push(MOD_ALIASES[low]); continue; }
    key = p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
  }
  if (!key) return "";
  if (key.length > 1 && /^f\d+$/i.test(key)) key = key.toUpperCase();
  const order = ["CommandOrControl", "Command", "Control", "Alt", "Shift", "Super"];
  const uniq = [...new Set(mods)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...uniq, key].join("+");
}

/** 校验并返回 { ok, accel } / { ok:false, error } */
function validate(scope, accel) {
  const n = normalize(accel);
  if (!n) return { ok: false, error: "没听清，再按一次" };
  const parts = n.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!KEYS.has(key)) return { ok: false, error: `不支持的键：${key}` };
  if (!IS_WIN && mods.includes("Alt") && MAC_DEAD_KEYS.has(key.toUpperCase())) {
    return { ok: false, error: `⌥${key} 在 mac 上是组合键，换一个` };
  }
  if (scope === "global") {
    if (key === "Escape" || key === "Enter" || key === "Tab") return { ok: false, error: "这个键不适合做全局快捷键" };
    if (!mods.some((m) => ["CommandOrControl", "Command", "Control", "Alt", "Super"].includes(m))) {
      return { ok: false, error: "全局快捷键至少要有一个修饰键（⌘/⌃/⌥）" };
    }
  }
  return { ok: true, accel: n };
}

function clampAutoStop(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return AUTO_STOP_DEF;
  return Math.min(AUTO_STOP_MAX, Math.max(AUTO_STOP_MIN, Math.round(n * 10) / 10));
}

function defaults() {
  const out = { global: {}, local: {}, autoStopSec: AUTO_STOP_DEF };
  for (const scope of ["global", "local"]) {
    for (const [id, a] of Object.entries(ACTIONS[scope])) out[scope][id] = normalize(a.def);
  }
  return out;
}

function load() {
  const out = { ...defaults(), enabled: true };
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch (e) { return out; }
  out.enabled = saved.enabled !== false;
  out.autoStopSec = clampAutoStop(saved.autoStopSec);
  for (const scope of ["global", "local"]) {
    for (const [id, accel] of Object.entries(saved[scope] || {})) {
      if (!ACTIONS[scope][id]) continue;                 // 程序里已删掉的动作
      const v = validate(scope, accel);
      if (v.ok) out[scope][id] = v.accel;                // 坏值回落到默认
    }
  }
  return out;
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJsonAtomic(FILE, {
    enabled: db.enabled !== false,
    autoStopSec: clampAutoStop(db.autoStopSec),
    global: db.global,
    local: db.local,
  });
}

/** 设置窗口用的一份快照 */
function info() {
  const db = load();
  const rows = [];
  for (const scope of ["global", "local"]) {
    for (const [id, a] of Object.entries(ACTIONS[scope])) {
      rows.push({ scope, id, label: a.label, accel: db[scope][id], def: normalize(a.def) });
    }
  }
  return { ok: true, enabled: db.enabled !== false, autoStopSec: db.autoStopSec, rows, defaults: defaults() };
}

/** 同一个 scope 里不能撞键 */
function conflict(scope, id, accel, db) {
  for (const [other, v] of Object.entries(db[scope])) {
    if (other !== id && v === accel) {
      return { ok: false, error: `和「${ACTIONS[scope][other].label}」冲突` };
    }
  }
  return { ok: true };
}

function set(scope, id, accel) {
  if (!ACTIONS[scope] || !ACTIONS[scope][id]) return { ok: false, error: "没有这个动作" };
  const v = validate(scope, accel);
  if (!v.ok) return v;
  const db = load();
  const c = conflict(scope, id, v.accel, db);
  if (!c.ok) return c;
  db[scope][id] = v.accel;
  save(db);
  return { ok: true, accel: v.accel, rows: info().rows };
}

/** 静音阈值（秒）：切换式录音停顿多久自动发送，范围 1–5 */
function setAutoStop(sec) {
  const db = load();
  db.autoStopSec = clampAutoStop(sec);
  save(db);
  return { ok: true, autoStopSec: db.autoStopSec };
}

/** 总开关：关掉后全局不注册、窗口内不响应（改键 UI 仍然可用） */
function setEnabled(on) {
  const db = load();
  db.enabled = !!on;
  save(db);
  return { ok: true, enabled: db.enabled, rows: info().rows };
}

function reset(scope) {
  const db = defaults();
  if (scope === "global" || scope === "local") {
    const cur = load();
    cur[scope] = db[scope];
    save(cur);
  } else {
    save(db);
  }
  return { ok: true, rows: info().rows };
}

module.exports = { ACTIONS, normalize, validate, defaults, load, save, info, set, reset, setEnabled, setAutoStop,
  AUTO_STOP_DEF, AUTO_STOP_MIN, AUTO_STOP_MAX, FILE };
