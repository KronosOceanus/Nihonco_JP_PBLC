import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

const dir = useTempData();
const pd = await import("../agent/pattern-daily.js");
const pb = await import("../agent/patternbook.js");

const reset = () => {
  fs.writeFileSync(`${dir}/patternbook.json`, JSON.stringify({ words: {} }));
  fs.writeFileSync(`${dir}/pattern-daily.json`, JSON.stringify({
    date: "", level: "N5", ids: [], last: "", mode: "daily",
    stats: { right: 0, wrong: 0, skip: 0 },
  }));
};

test("ensureToday：首次进入组出 5 个句型", () => {
  reset();
  const db = pd.ensureToday();
  assert.equal(db.date, pd.today());
  assert.equal(db.ids.length, 5);
});

test("nextCard：返回卡片 + 练法 + 总数", () => {
  reset();
  const c = pd.nextCard();
  assert.ok(c && c.id, "要有卡片");
  assert.ok(["reproduce", "compose"].includes(c.task));
  assert.equal(c.total, 5);
  assert.equal(c.mode, "daily");
});

test("check：复现题答对/答错", async () => {
  reset();
  const c = pd.nextCard();
  const probe = c.probe && c.probe.ja;      // nextCard 返回的卡片就带着固定下来的例句
  assert.ok(probe, "probe 例句应该固定下来");
  const ok = await pd.check(c.id, probe, { task: "reproduce" });
  assert.equal(ok.ok, true);
  const bad = await pd.check(c.id, "ぜんぜんちがう", { task: "reproduce" });
  assert.equal(bad.ok, false);
});

test("check：空提交 = skip，计入 stats", async () => {
  reset();
  const c = pd.nextCard();
  const r = await pd.check(c.id, "", { task: "compose" });
  assert.equal(r.empty, true);
  assert.equal(r.stats.skip, 1);
});

test("toggleReview：错题本为空不切", () => {
  reset();
  const r = pd.toggleReview();
  assert.equal(r.empty, true);
  assert.equal(pd.info().mode, "daily");
});
