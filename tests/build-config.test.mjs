import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const build = pkg.build || {};

test("lite 配置不打包 model / lib", () => {
  const files = build.files || [];
  assert.ok(!files.includes("model/**"));
  assert.ok(!files.includes("lib/**"));
  assert.ok(!files.some((f) => f.startsWith("model/") && !f.startsWith("!model/")));
  assert.ok(!(build.asarUnpack || []).includes("model/**"));
});

test("Windows lite 不打包 .whisper 运行时和模型", () => {
  const files = build.files || [];
  assert.ok(!files.some((f) => f.startsWith(".whisper")), "build.files 不应包含 .whisper");
  assert.ok(!(build.asarUnpack || []).some((f) => f.startsWith(".whisper")), "asarUnpack 不应包含 .whisper");
});

test("只提供 lite 构建命令，产物名带 lite", () => {
  const scripts = pkg.scripts || {};
  assert.equal(scripts["build:app"], "node tools/build-app.mjs --target=mac --mode=lite");
  assert.equal(scripts["build:win:lite"], "node tools/build-app.mjs --target=win --mode=lite");
  assert.ok(!Object.keys(scripts).some((k) => k.includes("full")));
  assert.match(build.nsis.artifactName, /lite/);
  assert.match(build.portable.artifactName, /lite/);
});
