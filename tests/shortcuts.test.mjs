import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

const dir = useTempData();
const sc = await import("../agent/shortcuts.js");

const reset = () => { try { fs.unlinkSync(`${dir}/shortcuts.json`); } catch (e) {} };

test("默认值：4 个全局 + 5 个窗口内", () => {
  reset();
  const d = sc.defaults();
  assert.equal(Object.keys(d.global).length, 4);
  assert.equal(Object.keys(d.local).length, 5);
  assert.ok(d.global.toggle.includes("+"), "全局必须带修饰键");
  assert.equal(d.local.conv, "F1");
});

test("normalize：别名统一、主键大写、修饰键排序", () => {
  assert.equal(sc.normalize("ctrl+shift+h"), "Control+Shift+H");
  assert.equal(sc.normalize("CmdOrCtrl+Option+R"), "CommandOrControl+Alt+R");
  assert.equal(sc.normalize("  f8 "), "F8");
});

test("validate：全局必须有修饰键；窗口内可以单键", () => {
  assert.equal(sc.validate("global", "H").ok, false);
  assert.equal(sc.validate("global", "CommandOrControl+Control+H").ok, true);
  assert.equal(sc.validate("local", "R").ok, true);
  assert.equal(sc.validate("local", "Enter").ok, true);
  assert.equal(sc.validate("global", "CommandOrControl+Control+Escape").ok, false);
});

test("set：写入后能读回；同 scope 撞键会被拒绝", () => {
  reset();
  const r = sc.set("local", "conv", "9");
  assert.equal(r.ok, true);
  assert.equal(sc.load().local.conv, "9");
  const bad = sc.set("local", "word", "9");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /冲突/);
});

test("坏值回落到默认（手改坏了不至于没快捷键用）", () => {
  reset();
  fs.writeFileSync(`${dir}/shortcuts.json`, JSON.stringify({ global: { toggle: "不是键" }, local: {} }));
  assert.equal(sc.load().global.toggle, sc.defaults().global.toggle);
});

test("总开关：默认开，关掉后 load().enabled=false 且映射还在", () => {
  reset();
  assert.equal(sc.info().enabled, true);
  const off = sc.setEnabled(false);
  assert.equal(off.enabled, false);
  assert.equal(sc.load().enabled, false);
  assert.equal(Object.keys(sc.load().local).length, 5, "关掉后映射不能丢");
  sc.setEnabled(true);
  assert.equal(sc.load().enabled, true);
});

test("静音阈值：默认 1.2 秒，范围夹在 1–5，保留一位小数", () => {
  reset();
  assert.equal(sc.info().autoStopSec, 1.2);
  assert.equal(sc.setAutoStop(3.4).autoStopSec, 3.4);
  assert.equal(sc.load().autoStopSec, 3.4);
  assert.equal(sc.setAutoStop(0).autoStopSec, 1);
  assert.equal(sc.setAutoStop(9).autoStopSec, 5);
  assert.equal(sc.setAutoStop("abc").autoStopSec, 1.2);
});

test("reset：恢复默认并清掉自定义", () => {
  reset();
  sc.set("local", "word", "8");
  sc.reset();
  assert.equal(sc.load().local.word, "F2");
});
