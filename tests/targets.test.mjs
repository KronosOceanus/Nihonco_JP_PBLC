import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

/* 会话主动带词：只挑已掌握、档位不高于当前、冷却期外的词；
 * 回复里出现的词写入 usage.json（last_used）。 */

const dir = useTempData();
const targets = await import("../agent/targets.js");

function seedWords(words) {
  fs.writeFileSync(`${dir}/wordbook.json`, JSON.stringify({ words }));
}
const rec = (ja, level, stage, extra = {}) => ({
  ja, kana: "かな", zh: "中文", level, stage,
  seen: 3, ok: 3, wrong: 0, skip: 0, streak: 2, lastAt: "", lastResult: "ok", ...extra,
});
const resetUsage = () => { try { fs.unlinkSync(`${dir}/usage.json`); } catch (e) {} };

test("只挑 stage=ok，且不高于当前档", () => {
  resetUsage();
  seedWords({
    "ねこ": rec("ねこ", "N5", "ok"),
    "いぬ": rec("いぬ", "N5", "ok"),
    "複雑": rec("複雑", "N2", "ok"),        // 比 N5 难，不该出现
    "未熟": rec("未熟", "N5", "wrong"),      // 没掌握
    "新語": rec("新語", "N5", "skip"),
  });
  const got = targets.pick({ level: "N5", max: 2 }).map((w) => w.ja);
  assert.equal(got.length, 2);
  for (const ja of got) assert.ok(["ねこ", "いぬ"].includes(ja), `不该挑到 ${ja}`);
});

test("冷却期内不重复；过期后可再挑", () => {
  resetUsage();
  seedWords({ "ねこ": rec("ねこ", "N5", "ok"), "いぬ": rec("いぬ", "N5", "ok") });
  fs.writeFileSync(`${dir}/usage.json`, JSON.stringify({
    "ねこ": { at: new Date().toISOString(), count: 1 },
  }));
  const got = targets.pick({ level: "N5", max: 2 }).map((w) => w.ja);
  assert.deepEqual(got, ["いぬ"]);

  fs.writeFileSync(`${dir}/usage.json`, JSON.stringify({
    "ねこ": { at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(), count: 1 },
  }));
  const got2 = targets.pick({ level: "N5", max: 2 }).map((w) => w.ja).sort();
  assert.deepEqual(got2, ["いぬ", "ねこ"]);
});

test("block：包含词、读音、释义和「不要硬塞」的约束", () => {
  const b = targets.block([{ ja: "ミルクパン", kana: "みるくぱん", zh: "牛奶面包" }]);
  assert.match(b, /ミルクパン/);
  assert.match(b, /みるくぱん/);
  assert.match(b, /牛奶面包/);
  assert.match(b, /詰め込まない/);
});

test("noteReply：回复里出现的词写进 usage.json，没出现的保持不动", () => {
  resetUsage();
  const list = [{ ja: "ミルクパン", kana: "みるくぱん" }, { ja: "予約", kana: "よやく" }];
  const used = targets.noteReply("ミルクパン、予約できるって知ってた？", list);
  assert.deepEqual(used, ["ミルクパン", "予約"]);
  const u = JSON.parse(fs.readFileSync(`${dir}/usage.json`, "utf8"));
  assert.ok(u["ミルクパン"].at);
  assert.equal(u["ミルクパン"].count, 1);

  const used2 = targets.noteReply("ミルクパンおいしい", list);
  assert.deepEqual(used2, ["ミルクパン"]);
  const u2 = JSON.parse(fs.readFileSync(`${dir}/usage.json`, "utf8"));
  assert.equal(u2["ミルクパン"].count, 2);
  assert.equal(u2["予約"].count, 1);
});
