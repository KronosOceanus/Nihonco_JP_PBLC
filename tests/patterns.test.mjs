import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTempData } from "./_env.mjs";

const dir = useTempData();
// 句型数据要放进临时目录（模块按 NIHONCO_DATA_DIR 读）
fs.copyFileSync(path.resolve("data/patterns-n5.json"), path.join(dir, "patterns-n5.json"));

const patterns = await import("../agent/patterns.js");
const pb = await import("../agent/patternbook.js");
const pd = await import("../agent/pattern-daily.js");

test("句型数据可加载，字段齐全", () => {
  const all = patterns.all("N5");
  assert.ok(all.length >= 50, `N5 句型数量 ${all.length}`);
  for (const it of all.slice(0, 10)) {
    assert.ok(it.pattern, "pattern 不能为空");
    assert.ok(it.meaning_zh, `${it.id} 缺中文意思`);
    assert.ok(it.examples.length > 0, `${it.id} 缺例句`);
  }
});

test("复现比对：汉字写法或全假名读音都算对", () => {
  const ja = "週末は家で映画を見た。";
  const rd = "しゅうまつはいえでえいがをみた。";
  assert.equal(patterns.sameSentence("週末は家で映画を見た", ja, rd), true);
  assert.equal(patterns.sameSentence("しゅうまつはいえでえいがをみた", ja, rd), true, "全假名也该算对");
  assert.equal(patterns.sameSentence("しゅうまつは いえで えいがを みた。", ja, rd), true);
  assert.equal(patterns.sameSentence("しゅうまつはいえでえいがをよんだ", ja, rd), false);
});

test("复现比对：汉字 + 假名混合写法也能过", () => {
  const ja = "週末は家で映画を見た。";
  const rd = "しゅうまつはいえでえいがをみた。";
  assert.equal(patterns.sameSentence("週末は家でえいがをみた", ja, rd), true, "汉字+假名混合");
  assert.equal(patterns.sameSentence("しゅうまつは家で映画をみた", ja, rd), true, "假名+汉字混合");
  assert.equal(patterns.sameSentence("しゅうまつはいえでえいがをよんだ", ja, rd), false, "读音不对");
});

test("复现比对：忽略标点与空格，假名必须一致", () => {
  assert.equal(patterns.sameSentence("私は学生です。", "私は学生です"), true);
  assert.equal(patterns.sameSentence("私は学生です。", "わたしは学生です"), false);
  assert.equal(patterns.sameSentence("", "x"), false);
});

test("造句规则：多分支句型命中任一分支即可", () => {
  assert.equal(patterns.ruleMatch("〜が上手 / 〜が下手", "私は日本語が上手です"), true);
  assert.equal(patterns.ruleMatch("〜がほしい", "車がほしいです"), true);
  assert.equal(patterns.ruleMatch("〜がほしい", "雨が降りました"), false);
});

test("造句规则：礼貌否定等价于 〜ない", () => {
  assert.equal(patterns.ruleMatch("全然〜ない", "この問題は全然わかりません。"), true);
  assert.equal(patterns.ruleMatch("全然〜ない", "この問題は全然わかります。"), false);
  assert.equal(patterns.ruleMatch("全然〜ない", "この問題は全然わからない。"), true);
});

test("造句规则：后缀型（〜た）可以出现在句尾", () => {
  assert.equal(patterns.ruleMatch("〜た", "もう食べた"), true);
  assert.equal(patterns.ruleMatch("〜た", "食べた"), true);
  assert.equal(patterns.ruleMatch("〜た", "た"), false, "只有一个后缀不算");
  assert.equal(patterns.ruleMatch("〜た", "ぜんぜん違う"), false);
  assert.equal(patterns.ruleMatch("〜た", "たたみます"), false, "只在句中含 た 不算");
  assert.equal(patterns.ruleMatch("〜た", "食べたよ"), true, "带语气尾也算");
});

test("造句规则：太短、没谓语、把助词抄一遍都不算", () => {
  assert.equal(patterns.ruleMatch("〜は", "は"), false);
  assert.equal(patterns.ruleMatch("〜は", "はです"), false);
  assert.equal(patterns.ruleMatch("〜は", "これはペン"), false, "没有谓语形态");
  assert.equal(patterns.ruleMatch("〜がほしい", "がほしい"), false, "只是抄句型");
  assert.equal(patterns.ruleMatch("〜は", "私は学生です"), true);
});

test("状态机：连对 2 次毕业、答错回错题本", () => {
  const id = patterns.all("N5")[0].id;
  pb.grade(id, "wrong");
  assert.equal(pb.pools().wrong.length, 1);
  pb.grade(id, "ok");
  assert.equal(pb.pools().wrong.length, 1, "只对 1 次还不毕业");
  pb.grade(id, "ok");
  assert.equal(pb.pools().wrong.length, 0);
  assert.equal(pb.pools().seen.length, 1);
});

test("批次：5 句 = 新句型 3 + 错题 1 + （学过 / 跳过轮流 1）", () => {
  const ids = patterns.all("N5").map((x) => x.id);
  // 造池子：2 错题、2 跳过、2 学过
  pb.grade(ids[10], "wrong");
  pb.grade(ids[11], "skip");
  for (const id of [ids[12], ids[13]]) { pb.grade(id, "wrong"); pb.grade(id, "ok"); pb.grade(id, "ok"); }

  const seenRotating = new Set();
  for (let n = 1; n <= 4; n++) {
    const db = pd.build();
    assert.equal(db.ids.length, 5, "一批应正好 5 句");
    const rec = pb.load().words;
    const c = { new: 0, wrong: 0, skip: 0, seen: 0 };
    for (const id of db.ids) {
      const st = (rec[id] || {}).stage;
      if (!st) c.new += 1;
      else if (st === "wrong") c.wrong += 1;
      else if (st === "skip") c.skip += 1;
      else c.seen += 1;
    }
    assert.equal(c.new, 3, `第 ${n} 批新句型应是 3`);
    assert.ok(c.wrong >= 1, `第 ${n} 批应含错题`);
    assert.equal(c.seen + c.skip, 1, `第 ${n} 批学过+跳过应是 1`);
    seenRotating.add(db.rotating);
  }
  assert.deepEqual([...seenRotating].sort(), ["seen", "skip"], "学过与跳过应轮流出现");
});

test("復習模式只从错题本抽", () => {
  // 清空状态，保证错题本里只有这一个
  fs.writeFileSync(path.join(dir, "patternbook.json"), JSON.stringify({ words: {} }));
  const ids = patterns.all("N5").map((x) => x.id);
  pb.grade(ids[20], "wrong");
  pd.toggleReview();
  const card = pd.nextCard();
  assert.equal(card.mode, "review");
  assert.equal(card.id, ids[20]);
  pd.toggleReview();
});

test("批次进度与来源标记", () => {
  fs.writeFileSync(path.join(dir, "patternbook.json"), JSON.stringify({ words: {} }));
  pd.build();
  const c = pd.nextCard();
  assert.equal(typeof c.tag, "string");
  assert.equal(c.total, 5);
});

test("升档：有数据就一路升到 N1，最高档再升会失败", () => {
  // 把所有已导入的句型档都放进临时目录
  for (const lv of ["n5", "n4", "n3", "n2", "n1"]) {
    const src = path.resolve(`data/patterns-${lv}.json`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `patterns-${lv}.json`));
  }
  patterns.reload();

  const seen = [];
  for (let i = 0; i < 4; i++) {
    const r = pd.advanceLevel();
    assert.equal(r.ok, true, `第 ${i + 1} 次升档应成功`);
    seen.push(r.level);
    assert.equal(pd.info().level, r.level);
    assert.ok(pd.info().tierTotal > 0, `${r.level} 应有句型`);
  }
  assert.deepEqual(seen, ["N4", "N3", "N2", "N1"]);

  const top = pd.advanceLevel();
  assert.equal(top.ok, false, "N1 是最高档");
  assert.ok(top.reason.includes("最高"));
});



test("错题本为空时不能进復習；清空后自动回每日", () => {
  fs.writeFileSync(path.join(dir, "patternbook.json"), JSON.stringify({ words: {} }));
  fs.writeFileSync(path.join(dir, "pattern-daily.json"), JSON.stringify({ mode: "daily", ids: [] }));
  pd.build();
  const r = pd.toggleReview();
  assert.equal(r.empty, true, "空错题本应拒绝切换");
  assert.equal(r.mode, "daily");
  assert.equal(pd.info().mode, "daily");
});

test("句型括号里的英文说明显示成中文", () => {
  assert.equal(patterns.displayPattern("〜から（from）"), "〜から（起点）");
  assert.equal(patterns.displayPattern("〜という（named）"), "〜という（叫做）");
  assert.equal(patterns.displayPattern("〜は"), "〜は", "没有括号就不动");
  assert.equal(patterns.displayPattern("〜に（时间）"), "〜に（时间）", "中文说明保持原样");
});

test("造句讲评：judge 返回的结构化点评会透传出来", async () => {
  const card = await pd.nextCard();
  if (!card) return;                                   // 批次为空就跳过
  const base = patterns.byId(card.id);
  const sentence = base.examples[0].ja;
  if (!patterns.ruleMatch(base.pattern, sentence)) return;   // 该句型的例句不走规则，跳过

  const judge = async () => ({
    ok: false,
    hint: "「で」多余",
    natural: 2,
    issues: [{ type: "助词", text: "で勉強します→勉強します", why: "「で」多余" }],
    rewrite: "音楽を聞きながら勉強します。",
    rewrite_zh: "一边听音乐一边学习。",
  });

  const r = await pd.check(card.id, sentence, { task: "compose", judge });
  assert.ok(r.review, "应该带 review");
  assert.equal(r.review.natural, 2);
  assert.equal(r.review.issues.length, 1);
  assert.equal(r.review.issues[0].type, "助词");
  assert.equal(r.review.rewrite_zh, "一边听音乐一边学习。");
  assert.equal(r.ok, false);
});

test("造句讲评：judge 失败时退回规则结果，review 为空", async () => {
  const card = await pd.nextCard();
  if (!card) return;
  const base = patterns.byId(card.id);
  const sentence = base.examples[0].ja;
  if (!patterns.ruleMatch(base.pattern, sentence)) return;    // 该句型例句不走规则，跳过
  const r = await pd.check(card.id, sentence, { task: "compose", judge: async () => null });
  assert.equal(r.review, null, "模型失败时不带讲评");
  assert.equal(r.ok, true, "规则通过就算对（模型不可用时降级）");
});

test("同形句型 〜な：な形容词 vs 禁止形靠 id 区分", async () => {
  const reading = await import("../agent/reading.js");
  await reading.warmup();
  assert.equal(patterns.ruleMatch("〜な", "京都は有名な町です", { id: "na-na-adjective" }), true);
  assert.equal(patterns.ruleMatch("〜な", "危ないから、この川では泳ぐな", { id: "na-na-adjective" }), false);
  assert.equal(patterns.ruleMatch("〜な", "危ないから、この川では泳ぐな", { id: "na-prohibition" }), true);
  assert.equal(patterns.ruleMatch("〜な", "京都は有名な町です", { id: "na-prohibition" }), false);
});

test("短后缀按分词边界：〜た 可以出现在句中，但不能命中「たたみ」", async () => {
  const reading = await import("../agent/reading.js");
  await reading.warmup();
  assert.equal(patterns.ruleMatch("〜た", "食べたから行く"), true);
  assert.equal(patterns.ruleMatch("〜た", "たたみます"), false);
  assert.equal(patterns.ruleMatch("〜ば", "雨が降れば、行きません。"), true);
  assert.equal(patterns.ruleMatch("〜さ", "この町の美しさに感動した。"), true);
});
