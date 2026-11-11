import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

const dir = useTempData();
const vocab = await import("../agent/vocab-daily.js");
const book = await import("../agent/wordbook.js");

const resetAll = () => {
  fs.writeFileSync(`${dir}/wordbook.json`, JSON.stringify({ words: {} }));
  fs.writeFileSync(`${dir}/vocab-daily.json`, JSON.stringify({
    date: "", batch: [], last: "", mode: "daily", today: { ok: [], wrong: [], skip: [] },
  }));
};

test("首次进入会组出今日批次，日期是本地今天", () => {
  resetAll();
  const db = vocab.ensureToday();
  assert.equal(db.date, vocab.today());
  assert.ok(db.batch.length > 0);
});

test("配额：新词 10 + 错题 6 + 跳过 2 + 学过 2", () => {
  resetAll();
  for (let i = 0; i < 6; i++) book.grade({ ja: `错${i}` }, "wrong");
  for (let i = 0; i < 2; i++) book.grade({ ja: `跳${i}` }, "skip");
  for (let i = 0; i < 2; i++) {
    const w = { ja: `学${i}` };
    book.grade(w, "wrong"); book.grade(w, "ok"); book.grade(w, "ok");
  }
  const db = vocab.buildBatch();
  const n = (src) => db.batch.filter((w) => w.source === src).length;
  assert.equal(n("new"), 10);
  assert.equal(n("wrong"), 6);
  assert.equal(n("skip"), 2);
  assert.equal(n("seen"), 2);
  assert.equal(db.batch.length, 20);
});

test("池子不够就不补（空池时批次少于 20）", () => {
  resetAll();
  const db = vocab.buildBatch();
  assert.equal(db.batch.filter((w) => w.source === "wrong").length, 0);
  assert.ok(db.batch.length <= 14, `实际 ${db.batch.length}`);
});

test("判定：汉字 / 假名都算对；错一个字符算错", () => {
  const card = { ja: "食べる", kana: "たべる" };
  assert.equal(vocab.check(card, "食べる").ok, true);
  assert.equal(vocab.check(card, "たべる").ok, true);
  assert.equal(vocab.check(card, "食べた").ok, false);
  assert.equal(vocab.check(card, "たべろ").ok, false);
});

test("空提交 = skip，进跳过池", () => {
  resetAll();
  const r = vocab.check({ ja: "飲む", kana: "のむ" }, "");
  assert.equal(r.empty, true);
  assert.equal(book.load().words["飲む"].stage, "skip");
});

test("今日统计按单词算：错三次再答对，只记 1 个对", () => {
  resetAll();
  const card = { ja: "見る", kana: "みる" };
  vocab.check(card, "x");
  vocab.check(card, "y");
  vocab.check(card, "z");
  const before = vocab.info().stats;
  vocab.check(card, "みる");
  const after = vocab.info().stats;
  assert.equal(after.right, before.right + 1);
  assert.equal(after.wrong, before.wrong - 1);
});

test("復習模式：只从错题本抽；最后一个错题毕业后回每日", () => {
  resetAll();
  vocab.setWordLevel("N5");
  const real = vocab.wordsOfCurrentLevel()[0];      // 必须是当前档的真词（错题按档筛选）
  book.grade({ ja: real.ja }, "wrong");
  const t = vocab.toggleReview();
  assert.equal(t.mode, "review");
  const card = vocab.nextCard();
  assert.equal(card.source, "review");
  assert.equal(card.ja, real.ja);

  vocab.check({ ja: real.ja }, real.ja);
  vocab.check({ ja: real.ja }, real.ja);
  assert.equal(vocab.info().pools.wrong, 0);
  assert.equal(vocab.info().mode, "daily");
});

test("删掉批次文件后立即重置（缓存按 mtime 失效）", () => {
  resetAll();
  vocab.ensureToday();
  assert.ok(vocab.info().total > 0);
  fs.unlinkSync(`${dir}/vocab-daily.json`);
  assert.equal(vocab.info().total, 0);
});

test("外来语：词表里的英文 kana 要纠正成假名与键盘拼写", () => {
  const r = vocab.check({ ja: "エスカレーター", kana: "escalator" }, "エスカレーター");
  assert.equal(r.expected.kana, "えすかれーたー");
  assert.equal(r.expected.romaji, "esukare-ta-");
});

test("N5 / N4 的词池不重叠，合起来等于合并档", () => {
  const v = vocab;
  v.setWordLevel("N5");
  const n5 = v.wordsOfCurrentLevel().map((w) => w.ja);
  v.setWordLevel("N4");
  const n4 = v.wordsOfCurrentLevel().map((w) => w.ja);

  const set5 = new Set(n5);
  assert.equal(n4.filter((ja) => set5.has(ja)).length, 0, "两档不应有重叠词");
  assert.ok(n5.length > 0 && n4.length > 0);

  // 非 N5/N4 档走原区间
  v.setWordLevel("N3");
  const n3 = v.wordsOfCurrentLevel();
  assert.ok(n3.length > 0);
  assert.ok(n3.every((w) => w.level === "N3"), "N3 应只含 N3 词");
});

test("进度只统计练过的词：组批不算，答一题才算", () => {
  resetAll();
  vocab.setWordLevel("N5");
  const before = vocab.info().tierSeen;
  const card = vocab.nextCard();                 // 抽卡会组批并标记「出现过」
  assert.equal(vocab.info().tierSeen, before, "只出现不算练过");
  vocab.check(card, card.ja);
  assert.equal(vocab.info().tierSeen, before + 1, "答过一题才 +1");
});

test("info() 带当天批次，热词能拿到它", async () => {
  resetAll();
  vocab.ensureToday();
  const info = vocab.info();
  assert.ok(Array.isArray(info.batch), "info().batch 必须是数组");
  assert.equal(info.batch.length, info.total, "批次条数要和 total 一致");
  assert.equal(typeof info.batch[0], "string", "批次里存的是日语词字符串");

  const llm = await import("../agent/llm.js");
  const hot = llm.asrHotwords(200);
  assert.ok(hot.includes(info.batch[0]), `热词应包含当天第一个词：${info.batch[0]}`);
});

test("模型取景用原子写（不直接覆盖原文件）", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const models = await import("../agent/models.js");
  const file = path.join(process.env.NIHONCO_DATA_DIR, "live2d-models.json");

  models.setFit("model/x/x.model3.json", { mx: 0.3, my: 0, f: 2 });
  const first = fs.readFileSync(file, "utf8");

  models.setFit("model/x/x.model3.json", { mx: 0.4, my: 0, f: 2 });
  const second = fs.readFileSync(file, "utf8");

  assert.notEqual(first, second);
  assert.ok(JSON.parse(second)["model/x/x.model3.json"].mx === 0.4);
  // 原子写不留临时文件
  const leftovers = fs.readdirSync(process.env.NIHONCO_DATA_DIR).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("热词按整词截断，不会切出半个词", async () => {
  const llm = await import("../agent/llm.js");
  const vocab2 = await import("../agent/vocab-daily.js");
  const curriculum = await import("../agent/curriculum.js");
  vocab2.ensureToday();

  const known = new Set(curriculum.words().map((w) => w.ja));
  const batch = vocab2.info().batch;
  assert.ok(batch.length > 0, "要有当天批次");

  for (const limit of [10, 12, 15, 20, 21, 24, 27, 60]) {
    const hot = llm.asrHotwords(limit);
    assert.ok(hot.length <= limit, `长度不能超过 ${limit}（实际 ${hot.length}）`);
    for (const w of hot.split("、")) {
      assert.ok(known.has(w), `「${w}」不是完整词表里的词（limit=${limit}）`);
    }
  }
});

test("词表按 ja 去重，不会在同一天抽到同一个词两次", async () => {
  const curriculum = await import("../agent/curriculum.js");
  const all = curriculum.words();
  const ja = all.map((w) => w.ja);
  assert.equal(new Set(ja).size, ja.length, "curriculum.words() 不应有重复 ja");

  // 每一档的池子也不能有重复
  for (const lv of ["N5", "N4"]) {
    resetAll();
    vocab.setWordLevel(lv);
    const pool = vocab.wordsOfCurrentLevel();
    assert.equal(new Set(pool.map((w) => w.ja)).size, pool.length, `${lv} 池子里有重复词`);
  }
});

test("标点不算错：かわいい。 也能过（和例句模式一致）", () => {
  resetAll();
  book.grade({ ja: "かわいい", kana: "かわいい" }, "ok");
  const r = vocab.check({ ja: "かわいい", kana: "かわいい" }, "かわいい。");
  assert.equal(r.ok, true);
});

test("SRS：答对写入 dueAt（1/3/7…天），答错归零到明天", () => {
  resetAll();
  book.grade({ ja: "予約", kana: "よやく" }, "ok");
  const r1 = book.load().words["予約"];
  assert.ok(r1.dueAt, "要有 dueAt");
  const days1 = (Date.parse(r1.dueAt) - Date.now()) / 86400000;
  assert.ok(days1 > 0.9 && days1 < 1.1, `第一次应约 1 天，实际 ${days1}`);

  book.grade({ ja: "予約", kana: "よやく" }, "ok");
  const r2 = book.load().words["予約"];
  const days2 = (Date.parse(r2.dueAt) - Date.now()) / 86400000;
  assert.ok(days2 > 2.9 && days2 < 3.1, `第二次应约 3 天，实际 ${days2}`);

  // 跳过：不降级，只推到明天
  book.grade({ ja: "予約", kana: "よやく" }, "skip");
  const rSkip = book.load().words["予約"];
  assert.equal(rSkip.srsLevel, 2, "跳过不该把等级清零");
  const daysSkip = (Date.parse(rSkip.dueAt) - Date.now()) / 86400000;
  assert.ok(daysSkip > 0.9 && daysSkip < 1.1, `跳过应推到明天，实际 ${daysSkip}`);

  // 答错：归零 + 明天
  book.grade({ ja: "予約", kana: "よやく" }, "wrong");
  const r3 = book.load().words["予約"];
  assert.equal(r3.srsLevel, 0);
  const days3 = (Date.parse(r3.dueAt) - Date.now()) / 86400000;
  assert.ok(days3 > 0.9 && days3 < 1.1, `答错应约 1 天，实际 ${days3}`);
});

test("到期优先：到期词先复习；到期多时多给复习位、少给新词", () => {
  vocab.setWordLevel("N5");
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  const mk = (ja, dueAt) => ({ ja, kana: "かな", level: "N5", stage: "ok", dueAt,
    seen: 2, ok: 2, wrong: 0, skip: 0, streak: 2 });
  fs.writeFileSync(`${dir}/wordbook.json`, JSON.stringify({
    words: {
      "期限A": mk("期限A", past), "期限B": mk("期限B", past), "期限C": mk("期限C", past),
      "未来D": mk("未来D", future), "未来E": mk("未来E", future),
    },
  }));
  fs.writeFileSync(`${dir}/vocab-daily.json`, JSON.stringify({
    date: "", level: "N5", batch: [], last: "", mode: "daily", today: { ok: [], wrong: [], skip: [] },
  }));
  const db = vocab.buildBatch();
  const seen = db.batch.filter((w) => w.source === "seen").map((w) => w.ja);
  const news = db.batch.filter((w) => w.source === "new").length;

  for (const ja of ["期限A", "期限B", "期限C"]) assert.ok(seen.includes(ja), `${ja} 到期应进批次`);
  // 4 个复习位：3 个到期 + 最多 1 个未到期
  assert.equal(seen.length, 4);
  assert.ok(seen.filter((ja) => ja.startsWith("未来")).length <= 1);
  assert.equal(news, 8, "到期多时新词从 10 降到 8");
});
