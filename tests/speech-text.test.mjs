import test from "node:test";
import assert from "node:assert/strict";
import { prepare, RULES, RULES_VERSION, yearToKana } from "../agent/speech-text.js";

/* 朗读文本规范化：只影响读出来的内容，不改气泡显示。
 * 规则表见 agent/speech-text.js，这里逐类固定行为。 */

const V = (t) => prepare(t, { engine: "voicevox" });

test("专有名词：Nihonco → にほんこ（所有引擎）", () => {
  assert.equal(V("Nihoncoだよ"), "にほんこだよ");
  assert.equal(prepare("Nihoncoだよ", { engine: "say" }), "にほんこだよ");
});

test("笑声：句首/标点后的「はは」→ あはは", () => {
  assert.equal(V("はは、笑ったね。"), "あはは、笑ったね。");
  assert.equal(V("そうだね。はは。"), "そうだね。あはは。");
  assert.equal(V("「はは」と言った"), "「あはは」と言った");
});

test("笑声：「ははっ」不动（本来就读得对）", () => {
  assert.equal(V("ははっ"), "ははっ");
});

test("笑声：www → あはは", () => {
  assert.equal(V("www すごい"), "あはは すごい");
});

test("笑声：单个/多个 w、（笑）都读成笑声", () => {
  assert.equal(V("天才さんｗ で"), "天才さんあはは で");
  assert.equal(V("天才さんw で"), "天才さんあはは で");
  assert.equal(V("ww すごい"), "あはは すごい");
  assert.equal(V("天才さん（笑）"), "天才さんあはは");
  assert.equal(prepare("天才さん（笑）", { engine: "say" }), "天才さんあはは");
  assert.equal(V("Webを開く"), "Webを開く", "英文单词里的 w 不能误伤");
});

test("拉丁缩写：AI / OK / Live2D / PC", () => {
  assert.equal(V("AI と OK"), "エーアイ と オーケー");
  assert.equal(V("Live2D のモデル"), "ライブツーディー のモデル");
  assert.equal(V("PC を開く"), "ピーシー を開く");
});

test("数字：四位数 + 年 → 假名", () => {
  assert.equal(V("2026年に会った"), "二千二十六ねんに会った");
  assert.equal(yearToKana(2026), "二千二十六");
  assert.equal(yearToKana(2000), "二千");
  assert.equal(yearToKana(1999), "千九百九十九");
  assert.equal(yearToKana(26), null, "不是四位数就不动");
});

test("符号：省略号 → 短停顿；emoji 删除", () => {
  assert.equal(V("……そうだね🎤"), "、そうだね");
  assert.equal(V("はい！？"), "はい！？");
});

test("引擎范围：VOICEVOX 专属规则不影响 say", () => {
  assert.equal(prepare("はは、笑ったね。", { engine: "say" }), "はは、笑ったね。");
  assert.equal(prepare("AI と OK", { engine: "say" }), "AI と OK");
});

test("未知英文不猜：原样保留", () => {
  assert.equal(V("hello"), "hello");
});

test("幂等：处理两次结果一致", () => {
  const once = V("はは、笑ったね。AI と 2026年");
  assert.equal(V(once), V(once));
});

test("规则表结构：每条都有 id/kind/note，id 唯一", () => {
  const ids = new Set();
  for (const r of RULES) {
    assert.ok(r.id && r.kind, "缺 id/kind");
    assert.ok(typeof r.note === "string", `${r.id} 缺 note`);
    assert.ok(!ids.has(r.id), `id 重复：${r.id}`);
    ids.add(r.id);
  }
  assert.ok(Number.isInteger(RULES_VERSION) && RULES_VERSION >= 1);
});
