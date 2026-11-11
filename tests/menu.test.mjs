import test from "node:test";
import assert from "node:assert/strict";

/* 右键菜单：结构守卫。菜单是原生对象，测不了点击效果，但能测
 * 「模板里有这一项」「顺序在回到右下角上方」「点击会调到注入的回调」。 */

const createMenus = (await import("../main/menu.js")).default;

function build(overrides = {}) {
  const captured = [];
  const calls = [];
  const menus = createMenus({
    Menu: { buildFromTemplate: (t) => { captured.push(t); return t; } },
    app: {}, shell: {}, screen: {}, root: "/tmp",
    getWin: () => null,
    getLevelIdle: () => "floating",
    getPassThrough: () => false,
    toggleLevelIdle: () => {},
    setPassThrough: () => {},
    openSettings: () => {},
    isWin: false,
    resetPetSize: () => calls.push("resetPetSize"),
    ...overrides,
  });
  const tpl = menus.buildMenu();
  return { tpl, calls, captured };
}

test("右键菜单：「恢复默认大小」在「回到右下角」上方", () => {
  const { tpl } = build();
  const labels = tpl.filter((x) => x && x.label).map((x) => x.label);
  const iReset = labels.indexOf("恢复默认大小");
  const iHome = labels.indexOf("回到右下角");
  assert.ok(iReset >= 0, "要有「恢复默认大小」");
  assert.ok(iHome >= 0, "要有「回到右下角」");
  assert.equal(iReset + 1, iHome, "两项目前是相邻的，且恢复默认在上方");
});

test("点「恢复默认大小」会调用注入的 resetPetSize", () => {
  const { tpl, calls } = build();
  const item = tpl.find((x) => x && x.label === "恢复默认大小");
  item.click();
  assert.deepEqual(calls, ["resetPetSize"]);
});

test("没注入 resetPetSize 时点击不抛错（防菜单整个坏掉）", () => {
  const menus = createMenus({
    Menu: { buildFromTemplate: (t) => t },
    app: {}, shell: {}, screen: {}, root: "/tmp",
    getWin: () => null, getLevelIdle: () => "floating", getPassThrough: () => false,
    toggleLevelIdle: () => {}, setPassThrough: () => {}, openSettings: () => {}, isWin: false,
  });
  const item = menus.buildMenu().find((x) => x && x.label === "恢复默认大小");
  assert.doesNotThrow(() => item.click());
});
