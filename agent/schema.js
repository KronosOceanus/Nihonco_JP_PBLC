/* 学习数据文件的 schema 版本与迁移
 *
 * 每个持久化文件都带 `version`（整数）。读取时：
 *   - 没有 version   → 视为 0（早期版本），跑迁移后补上
 *   - version < 当前 → 依次跑迁移，然后写回
 *   - version > 当前 → 不动数据（可能是更新版本写的），只警告
 *
 * 约定：新增字段/改结构时，CURRENT 加 1，并在 MIGRATIONS 里补一步。
 * 每个迁移函数必须“从旧数据算出新数据”，不能依赖外部状态（要能单测）。
 */

const CURRENT = {
  wordbook: 1,
  patternbook: 1,
  "vocab-daily": 1,
  "pattern-daily": 1,
  settings: 1,
};

/** 迁移表：MIGRATIONS[名字][目标版本] = (旧数据) => 新数据
 *  目前都是 0 → 1：只补 version 字段，结构没变。将来在这里加新步骤。 */
const MIGRATIONS = {
  wordbook: {},
  patternbook: {},
  "vocab-daily": {},
  "pattern-daily": {},
  settings: {},
};

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * 把数据迁移到当前版本。
 * @returns {{data:object, from:number, to:number, changed:boolean, newer:boolean}}
 */
function migrate(name, data) {
  const cur = CURRENT[name];
  if (!cur) throw new Error(`未知的数据文件: ${name}`);

  const src = isPlainObject(data) ? data : {};
  const raw = Number(src.version);
  const from = Number.isInteger(raw) && raw >= 0 ? raw : 0;

  // 比当前版本还新：不动，交给调用方提示（降级不能瞎改别人的数据）
  if (from > cur) return { data: src, from, to: from, changed: false, newer: true };

  let out = { ...src };
  for (let v = from + 1; v <= cur; v++) {
    const step = (MIGRATIONS[name] || {})[v];
    if (typeof step === "function") {
      const next = step(out);
      if (isPlainObject(next)) out = next;
    }
  }
  out.version = cur;
  const changed = src.version !== cur;
  return { data: out, from, to: cur, changed, newer: false };
}

/** 写盘前打上当前版本 */
function stamp(name, data) {
  const cur = CURRENT[name];
  if (!cur) throw new Error(`未知的数据文件: ${name}`);
  return { ...(isPlainObject(data) ? data : {}), version: cur };
}

module.exports = { CURRENT, MIGRATIONS, migrate, stamp };
