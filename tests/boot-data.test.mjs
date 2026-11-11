import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareDataDir, SHARED_DATA } from "../agent/boot-data.js";

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-boot-"));
const write = (p, txt = "{}") => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); };

test("非打包 / 显式数据目录：什么都不做", () => {
  const root = mk();
  assert.equal(prepareDataDir({ packaged: false, userData: mk(), root, resourcesPath: "/x" }).dir, null);
  assert.equal(prepareDataDir({ packaged: true, dataDirEnv: "/tmp/xx", userData: mk(), root, resourcesPath: "/x" }).dir, null);
});

test("打包：只 seed 共享数据表，个人进度不复制", () => {
  const root = mk();
  const userData = mk();
  const seed = path.join(mk(), "app.asar.unpacked", "data");
  write(path.join(seed, "jlpt.json"), '{"words":[]}');
  write(path.join(seed, "patterns-n5.json"), "{}");
  write(path.join(seed, "wordbook.json"), '{"words":{}}');       // 个人进度：不该被复制
  write(path.join(seed, "settings.json"), "{}");

  const r = prepareDataDir({ packaged: true, userData, root, resourcesPath: path.dirname(path.dirname(seed)) });
  assert.equal(r.fallback, false);
  assert.equal(r.dir, path.join(userData, "data"));
  assert.ok(fs.existsSync(path.join(userData, "data", "jlpt.json")));
  assert.ok(fs.existsSync(path.join(userData, "data", "patterns-n5.json")));
  assert.ok(!fs.existsSync(path.join(userData, "data", "wordbook.json")), "个人进度不能进用户目录");
  assert.ok(!fs.existsSync(path.join(userData, "data", "settings.json")));
});

test("打包但包里没有 data：回退到项目 data/ 并警告", () => {
  const root = mk();
  write(path.join(root, "data", "jlpt.json"), '{"words":[]}');
  const r = prepareDataDir({ packaged: true, userData: mk(), root, resourcesPath: mk() });
  assert.equal(r.fallback, true);
  assert.equal(r.dir, path.join(root, "data"));
  assert.match(r.warning, /回退/);
});

test("共享数据白名单不匹配个人文件", () => {
  for (const f of ["jlpt.json", "word-levels.json", "kanji-stems.json",
                   "pattern-gloss-zh.json", "patterns-n1.json", "enrich-cache.seed.json"]) {
    assert.ok(SHARED_DATA.test(f), `${f} 应命中`);
  }
  for (const f of ["wordbook.json", "wordbook.baseline.json", "settings.json",
                   "vocab-daily.json", "live2d-models.json", "enrich-cache.json"]) {
    assert.ok(!SHARED_DATA.test(f), `${f} 不该命中`);
  }
});
