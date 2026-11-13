import test from "node:test";
import assert from "node:assert/strict";

const mod = await import("../tools/fetch.mjs");

test("镜像模式：auto 先镜像后官方", () => {
  assert.deepEqual(mod.mirrorOrder("auto"), ["cn", "official"]);
  assert.deepEqual(mod.mirrorOrder(""), ["cn", "official"]);
  assert.deepEqual(mod.mirrorOrder(undefined), ["cn", "official"]);
});

test("镜像模式：cn / official 只走单一来源", () => {
  assert.deepEqual(mod.mirrorOrder("cn"), ["cn"]);
  assert.deepEqual(mod.mirrorOrder("mirror"), ["cn"]);
  assert.deepEqual(mod.mirrorOrder("official"), ["official"]);
  assert.deepEqual(mod.mirrorOrder("github"), ["official"]);
});

test("--mirror= 从参数读，读不到才用环境变量，都不合法就报错", () => {
  assert.equal(mod.parseMirrorMode(["--mirror=official"], {}), "official");
  assert.equal(mod.parseMirrorMode([], { NIHONCO_MIRROR: "cn" }), "cn");
  assert.equal(mod.parseMirrorMode([], {}), "auto");
  assert.throws(() => mod.parseMirrorMode(["--mirror=bogus"], {}), /--mirror/);
});

test("pickUrls 按模式顺序摊平，并保持不重复", () => {
  const sources = {
    cn: ["https://mirror.example/a", "https://mirror.example/b"],
    official: ["https://mirror.example/a", "https://github.com/c"],
  };
  assert.deepEqual(mod.pickUrls(sources, ["cn", "official"]), [
    "https://mirror.example/a", "https://mirror.example/b", "https://github.com/c",
  ]);
  assert.deepEqual(mod.pickUrls(sources, ["official"]), ["https://mirror.example/a", "https://github.com/c"]);
  assert.deepEqual(mod.pickUrls(sources, ["cn"]), ["https://mirror.example/a", "https://mirror.example/b"]);
});

test("hostOf 只取主机名，坏 URL 不抛异常", () => {
  assert.equal(mod.hostOf("https://hf-mirror.com/a/b.bin"), "hf-mirror.com");
  assert.equal(typeof mod.hostOf("not a url"), "string");
});

test("镜像地址是 https 且以 / 结尾（拼版本号要用）", () => {
  assert.match(mod.ELECTRON_MIRROR_CN, /^https:\/\/.+\/$/);
  assert.match(mod.BUILDER_MIRROR_CN, /^https:\/\/.+\/$/);
});
