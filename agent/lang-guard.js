/* 日语字段的脚本污染守卫（不是语言识别器）。
 *
 * 解决两个真实问题：
 *   1. ASR 请求 language=ja 时仍可能吐中文
 *   2. LLM 的 reply_ja 偶尔混进简体中文
 *
 * 判据：
 *   · 简体字专属字（日语不用这些字形）
 *   · 假名比例（辅助；不把「東京駅」这种全汉字日语判死）
 *
 * 注意：CJK 统一区里日语汉字和中文汉字重叠，不能用码点范围判断。
 */

const SIMPLIFIED_ONLY = new Set([
  // 高频、明确不是日语标准字形的简体字
  "这", "说", "时", "们", "个", "么", "还", "过", "对", "开",
  "发", "关", "话", "见", "让", "为", "东", "车", "长", "门",
  "问", "间", "题", "买", "卖", "读", "书", "记", "认", "识",
  "语", "词", "听", "声", "儿", "头", "没", "很", "吗",
  "呢", "吧", "你", "输", "测", "试", "爱", "觉",
  "从", "样", "种", "应", "该", "现", "实", "际", "电", "脑",
  "网", "络", "软", "据", "错", "误", "转", "换", "简", "单",
]);

// 繁体/简体都可能出现、且日语里不常用的词形。
// 纯简繁字表覆盖不到 "中文輸入測試" 这种繁体输出。
const CHINESE_MARKERS = [
  "测试", "測試", "软件", "軟件", "网络", "網絡",
  "简体", "簡體", "学习", "學習", "单词", "單詞", "日語",
  "这个", "這個", "什么", "什麼", "可以", "没有", "沒有",
];

const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const HAN_KANA_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function kanaRatio(text) {
  const chars = [...String(text || "")].filter((ch) => HAN_KANA_RE.test(ch));
  if (!chars.length) return 0;
  let kana = 0;
  for (const ch of chars) if (KANA_RE.test(ch)) kana++;
  return kana / chars.length;
}

function markerHits(text) {
  const s = String(text || "");
  return CHINESE_MARKERS.filter((w) => s.includes(w));
}

function simplifiedHits(text) {
  const hits = [];
  const seen = new Set();
  for (const ch of String(text || "")) {
    if (SIMPLIFIED_ONLY.has(ch) && !seen.has(ch)) {
      seen.add(ch);
      hits.push(ch);
    }
  }
  return hits;
}

/**
 * 检查一段「应该是日语」的文本。
 * ok=false 只表示“疑似混入简体中文”，不是“这一定不是日语”。
 */
function checkJapanese(text) {
  const s = String(text || "").trim();
  if (!s) return { ok: false, reason: "empty", hits: [], kanaRatio: 0 };
  const hits = simplifiedHits(s);
  const markers = markerHits(s);
  const ratio = kanaRatio(s);
  if (hits.length) {
    return { ok: false, reason: "simplified-chars", hits, markers, kanaRatio: ratio };
  }
  if (markers.length) {
    return { ok: false, reason: "chinese-markers", hits: [], markers, kanaRatio: ratio };
  }
  return { ok: true, reason: ratio > 0 ? "kana" : "all-kanji", hits: [], markers: [], kanaRatio: ratio };
}

module.exports = { SIMPLIFIED_ONLY, CHINESE_MARKERS, kanaRatio, simplifiedHits, markerHits, checkJapanese };
