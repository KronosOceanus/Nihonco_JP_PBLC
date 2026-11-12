/* 朗读文本规范化（只影响"读出来"，不影响气泡里的显示文本）
 *
 * 为什么需要：VOICEVOX 对某些写法会读错（实测 0.26.0，speaker 46）：
 *   はは、        → ワワ      （当成助词「は」）
 *   AI            → エエアイ  （字母逐个念，重音错）
 *   2026年        → ニセン/ニジュウ/ロクネン（拆成三段）
 *   …… / emoji    → 直接丢弃（没有停顿）
 *
 * 设计约定：
 *   1. 规则有 id / kind / engines / re / to / note，顺序固定，逐条可测
 *   2. engines 限定生效范围（VOICEVOX 特有的问题不污染 say / SAPI）
 *   3. RULES_VERSION 参与 TTS 缓存键：改规则 → 旧缓存自动失效
 *   4. 未知英文/拉丁词不猜，原样交给引擎（需要时再加词表）
 */
const RULES_VERSION = 2;

const KANA_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 四位数年份 → 假名读法（2026 → にせんにじゅうろく） */
function yearToKana(y) {
  const n = Number(y);
  if (!Number.isInteger(n) || n < 1000 || n > 2999) return null;
  const sen = Math.floor(n / 1000);
  const hyaku = Math.floor((n % 1000) / 100);
  const juu = Math.floor((n % 100) / 10);
  const ichi = n % 10;
  let out = (sen === 1 ? "" : KANA_DIGITS[sen]) + "千";
  if (hyaku) out += (hyaku === 1 ? "" : KANA_DIGITS[hyaku]) + "百";
  if (juu) out += (juu === 1 ? "" : KANA_DIGITS[juu]) + "十";
  if (ichi) out += KANA_DIGITS[ichi];
  return out;
}

/** 规则表：顺序 = 执行顺序 */
const RULES = [
  // ---------- 专有名词（所有引擎） ----------
  { id: "name-nihonco", kind: "proper", engines: null, re: /Nihonco/gi, to: "にほんこ",
    note: "角色名，英文读法会念成 N-I-honco" },

  // ---------- 笑声（VOICEVOX 特性） ----------
  { id: "laugh-haha", kind: "laugh", engines: ["voicevox"],
    re: /(^|[、。！？!?…\s「」『』])はは(?!っ)/g, to: "$1あはは",
    note: "句首/标点后的「はは」会被当助词读成 ワワ；「ははっ」读得对，不动" },
  { id: "laugh-kakko", kind: "laugh", engines: null, re: /[（(]笑[）)]/g, to: "あはは",
    note: "（笑）直接读成笑声，不读括号" },
  { id: "laugh-w-start", kind: "laugh", engines: ["voicevox"],
    re: /^[wｗ]{1,}(?=[\s。、！？!?…」』（(]|$)/gi, to: "あはは",
    note: "句首的 w/ww/www 会被念成字母" },
  { id: "laugh-w-after", kind: "laugh", engines: ["voicevox"],
    re: /(?<=[\u3040-\u30ff\u4e00-\u9fff」』）)。、！？!?…\s])[wｗ]{1,}(?=[\s。、！？!?…」』（(]|$)/gi,
    to: "あはは", note: "日语后面的单个/多个 w 会被念成字母" },

  // ---------- 拉丁缩写 / 常见英文（VOICEVOX 特性） ----------
  { id: "latin-ai", kind: "latin", engines: ["voicevox"], re: /\bAI\b/gi, to: "エーアイ", note: "会被念成 エエアイ" },
  { id: "latin-ok", kind: "latin", engines: ["voicevox"], re: /\bOK\b/gi, to: "オーケー", note: "会被念成 オオケイ" },
  { id: "latin-live2d", kind: "latin", engines: ["voicevox"], re: /\bLive2D\b/gi, to: "ライブツーディー",
    note: "会被念成 ライブニ/ディイ" },
  { id: "latin-pc", kind: "latin", engines: ["voicevox"], re: /\bPC\b/gi, to: "ピーシー", note: "" },

  // ---------- 数字：只处理「四位数 + 年」 ----------
  { id: "num-year", kind: "number", engines: ["voicevox"], re: /(\d{4})年/g,
    to: null, // 动态替换，见 prepare()
    note: "2026年 会被拆成 ニセン/ニジュウ/ロクネン" },

  // ---------- 符号 / emoji ----------
  { id: "sym-ellipsis", kind: "symbol", engines: ["voicevox"], re: /(…{2,}|\.{3,})/g, to: "、",
    note: "省略号被直接丢弃，换成短停顿" },
];

/** 规则表之外的清理：emoji/其他符号直接删（VOICEVOX 会静默丢掉，等于没停顿） */
function stripSymbols(text) {
  // 像素符号（絵文字/绘图符号）+ 声音符号会读成奇怪的东西，直接去掉
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * @param {string} text 原始文本
 * @param {{engine?: "voicevox"|"say"|"sapi"}} opts
 * @returns {string} 用于合成的文本
 */
function prepare(text, opts = {}) {
  const engine = String(opts.engine || "voicevox").toLowerCase();
  let out = String(text || "");
  for (const r of RULES) {
    if (r.engines && !r.engines.includes(engine)) continue;
    if (r.id === "num-year") {
      out = out.replace(r.re, (m, y) => {
        const kana = yearToKana(y);
        return kana ? `${kana}ねん` : m;
      });
      continue;
    }
    out = out.replace(r.re, r.to);
  }
  // 用户昵称：显示保留原名，朗读用单独读音
  const un = String(opts.userName || "").trim();
  const ur = String(opts.userReading || "").trim();
  if (un && ur) out = out.split(un).join(ur);
  return stripSymbols(out);
}

module.exports = { prepare, RULES, RULES_VERSION, yearToKana, stripSymbols };
