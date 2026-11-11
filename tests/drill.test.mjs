import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const drill = await import("../agent/drill.js");

test("today()：本地日期格式 YYYY-MM-DD", () => {
  assert.match(drill.today(), /^\d{4}-\d{2}-\d{2}$/);
});

test("sample：不超过池子大小，且元素来自原数组", () => {
  const arr = [1, 2, 3];
  const s = drill.sample(arr, 10);
  assert.equal(s.length, 3);
  assert.deepEqual([...s].sort(), [1, 2, 3]);
  assert.deepEqual(drill.sample([], 3), []);
});

test("pickAvoiding：池子有别的就避开上一张；只有一个时仍返回它", () => {
  const pool = [{ id: "a" }, { id: "b" }];
  for (let i = 0; i < 20; i++) assert.notEqual(drill.pickAvoiding(pool, "a", (x) => x.id).id, "a");
  assert.equal(drill.pickAvoiding([{ id: "a" }], "a", (x) => x.id).id, "a");
  assert.equal(drill.pickAvoiding([], "a"), null);
});

test("batchProgress：完成度与 allDone", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(drill.batchProgress(ids, new Set(["a"])), { done: 1, total: 3, allDone: false });
  assert.deepEqual(drill.batchProgress(ids, new Set(ids)), { done: 3, total: 3, allDone: true });
  assert.deepEqual(drill.batchProgress([], new Set()), { done: 0, total: 0, allDone: false });
});

test("needBuild：日期变 / 批次空 / 档位变都要重建", () => {
  const base = { date: "2026-01-01", batch: [1], level: "N5" };
  assert.equal(drill.needBuild(base, { date: "2026-01-01", batch: base.batch }), false);
  assert.equal(drill.needBuild(base, { date: "2026-01-02", batch: base.batch }), true);
  assert.equal(drill.needBuild(base, { date: "2026-01-01", batch: [] }), true);
  assert.equal(drill.needBuild(base, { date: "2026-01-01", batch: base.batch, currentLevel: "N4" }), true);
});

test("toggleMode：普通模式来回切；refuseWhenEmpty 时空错题本不切", () => {
  const db = { mode: "daily", last: "x" };
  const r1 = drill.toggleMode(db, {});
  assert.equal(r1.switched, true);
  assert.equal(db.mode, "review");
  drill.toggleMode(db, {});
  assert.equal(db.mode, "daily");
  assert.equal(db.last, "x", "切回每日应保留 last，避免紧接着重复同一张");

  const db2 = { mode: "daily", last: "x" };
  const r2 = drill.toggleMode(db2, { refuseWhenEmpty: true, hasWrong: 0 });
  assert.equal(r2.switched, false);
  assert.equal(r2.empty, true);
  assert.equal(db2.mode, "daily");
});

test("createStore：读不到就 empty；写完能读回；外部改写会失效缓存", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-drill-"));
  const file = path.join(dir, "x.json");
  const empty = () => ({ n: 0 });
  const store = drill.createStore({ name: "settings", file, empty, normalize: (j) => ({ n: Number(j.n) || 0 }) });
  assert.equal(store.load().n, 0);
  store.save({ n: 2 });
  assert.equal(store.load().n, 2);
  fs.writeFileSync(file, JSON.stringify({ n: 5 }));
  assert.equal(store.load().n, 5, "文件被外部改写后应该重新读");
});
