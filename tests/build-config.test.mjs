import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lite = require("../electron-builder.lite.js");

test("lite 配置不打包 model / lib", () => {
  const files = lite.files || [];
  assert.ok(!files.includes("model/**"));
  assert.ok(!files.includes("lib/**"));
  assert.ok(!files.some((f) => f.startsWith("model/") && !f.startsWith("!model/")));
  assert.ok(!(lite.asarUnpack || []).includes("model/**"));
});

test("lite 产物名带 lite", () => {
  assert.match(lite.win.artifactName, /lite/);
});
