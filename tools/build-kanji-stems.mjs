#!/usr/bin/env node
/* 生成 data/kanji-stems.json：汉字词干 → 假名读音
 *
 *   node tools/build-kanji-stems.mjs
 *
 * 用途：复现判定时把你打的「汉字 + 假名混合」写法转成假名再比对。
 * 来源：data/jlpt.json 的 ja/kana 对（原始 10,169 条，去重后 10,109 词），只保留含汉字的词。
 * 规则：去掉词尾送り仮名作为词干（食べる → 食べ → たべ），这样 食べた 也能转。
 */
import fs from "node:fs";

const words = JSON.parse(fs.readFileSync("data/jlpt.json", "utf8"));
const map = {};

for (const w of words) {
  if (!w.ja || !w.kana || w.kana === w.ja) continue;

  // 词尾送り仮名（食べる 的「べる」）：假名读音去掉同样长度的尾巴
  const okuri = (w.ja.match(/[ぁ-ん]+$/) || [""])[0];
  const key = w.ja.slice(0, w.ja.length - okuri.length);
  if (!/[\u4e00-\u9fff]/.test(key)) continue;           // 词干必须含汉字
  if (key.length < 1) continue;

  const kanaStem = okuri.length ? w.kana.slice(0, w.kana.length - okuri.length) : w.kana;
  if (!kanaStem || !/^[ぁ-んー]+$/.test(kanaStem)) continue;

  if (!map[key]) map[key] = kanaStem;                    // 先到先得（词表按 N5→N1 排序）
}

fs.writeFileSync("data/kanji-stems.json", JSON.stringify(map));
const size = fs.statSync("data/kanji-stems.json").size;
console.log(`写入 data/kanji-stems.json：${Object.keys(map).length} 条，${(size / 1024).toFixed(0)} KB`);
