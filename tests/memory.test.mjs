import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../agent/memory.js";

function temp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-memory-"));
  return { dir, m: new MemoryStore({ dataDir: dir }) };
}

test("profile 数组追加、去重、超过 8 条淘汰", () => {
  const { m } = temp();
  for (const v of ["电影", "动画", "电影", "旅行", "音乐", "游戏", "阅读", "摄影", "咖啡", "猫"]) {
    m.addProfile("interests", v);
  }
  assert.equal(m.snapshot().profile.interests.length + m.snapshot().profile.goals.length +
    m.snapshot().profile.preferences.length + m.snapshot().profile.boundaries.length, 8);
  assert.ok(!m.snapshot().profile.interests.includes("电影"));
});

test("episode 追加、更新、删除", () => {
  const { m } = temp();
  m.addEpisode({ id: "e1", topic: "电影", summary: "说想去看电影", tags: ["电影"] });
  assert.equal(m.snapshot().episodes[0].id, "e1");
  m.updateEpisode("e1", { summary: "说周末想去看电影", tags: ["电影", "周末"], weight: 3 });
  assert.equal(m.snapshot().episodes[0].summary, "说周末想去看电影");
  assert.deepEqual(m.snapshot().episodes[0].tags, ["电影", "周末"]);
  m.deleteEpisode("e1");
  assert.equal(m.snapshot().episodes.length, 0);
});

test("episode 超过 12 条时淘汰低 weight / 较旧条目", () => {
  const { m } = temp();
  for (let i = 1; i <= 12; i++) {
    m.addEpisode({ id: `e${i}`, at: `2026-01-${String(i).padStart(2, "0")}`, topic: "话题", summary: `第 ${i} 条`, weight: i === 1 ? 1 : 5 });
  }
  m.addEpisode({ id: "e13", at: "2026-02-01", topic: "话题", summary: "第 13 条", weight: 5 });
  const ids = m.snapshot().episodes.map((e) => e.id);
  assert.equal(ids.length, 12);
  assert.ok(!ids.includes("e1"));
  assert.ok(ids.includes("e13"));
});

test("称呼读音独立保存；等级只接受 N5–N1；年龄不落盘", () => {
  const { m } = temp();
  m.patch([
    { op: "update", type: "profile", key: "nickname", value: "山田" },
    { op: "update", type: "profile", key: "nickname_reading", value: "やまだ" },
    { op: "update", type: "profile", key: "level", value: "N4" },
  ]);
  assert.equal(m.snapshot().profile.nickname, "山田");
  assert.equal(m.snapshot().profile.nickname_reading, "やまだ");
  assert.equal(m.snapshot().profile.level, "N4");

  m.patch([
    { op: "update", type: "profile", key: "level", value: "27岁" },
    { op: "update", type: "profile", key: "nickname_reading", value: "山田" },
    { op: "add", type: "profile", key: "interests", value: "27岁" },
  ]);
  assert.equal(m.snapshot().profile.level, "N4", "非法等级不覆盖原值");
  assert.equal(m.snapshot().profile.nickname_reading, "やまだ", "非假名读音不覆盖");
  assert.ok(!m.snapshot().profile.interests.includes("27岁"));
});

test("context 注入 profile 与相关 episode，不注入无关经历", () => {
  const { m } = temp();
  m.addProfile("nickname", "阿林");
  m.addProfile("nickname_reading", "ありん");
  m.addProfile("interests", "电影");
  m.addEpisode({ id: "e1", at: "2026-11-01", topic: "考试", summary: "说下周要考 N3", tags: ["考试", "N3"] });
  m.addEpisode({ id: "e2", at: "2026-11-02", topic: "电影", summary: "说想去看电影", tags: ["电影", "周末"] });
  m.setRelation("familiarity", 3);

  const ctx = m.context("周末去看电影");
  assert.match(ctx, /叫我 阿林（读音 ありん）/);
  assert.match(ctx, /喜欢：电影/);
  assert.match(ctx, /说想去看电影/);
  assert.doesNotMatch(ctx, /考 N3/);
  assert.match(ctx, /熟悉度 3\/5/);

  const empty = m.context("今天天气不错");
  assert.doesNotMatch(empty, /说想去看电影/);
});

test("日语标签也能召回", () => {
  const { m } = temp();
  m.addEpisode({ id: "e1", at: "2026-11-01", topic: "映画", summary: "映画を見に行きたいと言った", tags: ["映画", "週末"] });
  const ctx = m.context("週末に映画を見た");
  assert.match(ctx, /映画を見に行きたい/);
});

test("relation familiarity 限制在 0–5", () => {
  const { m } = temp();
  m.setRelation("familiarity", 99);
  assert.equal(m.snapshot().relation.familiarity, 5);
  m.setRelation("familiarity", -3);
  assert.equal(m.snapshot().relation.familiarity, 0);
});

test("persona.json 是有效 JSON，clear 能清空", () => {
  const { dir, m } = temp();
  m.addProfile("nickname", "阿林");
  m.addEpisode({ id: "e1", topic: "电影", summary: "说想去看电影", tags: ["电影"] });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "persona.json"), "utf8"));
  assert.equal(raw.version, 1);
  assert.equal(raw.profile.nickname, "阿林");
  m.clear();
  assert.equal(m.snapshot().episodes.length, 0);
  assert.equal(m.snapshot().profile.nickname, "");
});
