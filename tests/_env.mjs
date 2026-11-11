/* 测试公共准备：把数据目录指到临时目录，避免污染真实进度
 * 必须在 import agent 模块之前调用（各模块在 require 时算路径）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_DATA = path.resolve(process.cwd(), "data");

/** 断言数据目录是隔离的临时目录（防止测试写到真实进度上） */
export function assertIsolated(dir = process.env.NIHONCO_DATA_DIR) {
  if (!dir) throw new Error("[test] NIHONCO_DATA_DIR 未设置，测试可能读写真实数据");
  const real = path.resolve(dir);
  const tmp = path.resolve(os.tmpdir());
  if (real === REPO_DATA) {
    throw new Error("[test] 数据目录指向仓库 data/，拒绝继续");
  }
  if (!real.startsWith(tmp + path.sep)) {
    throw new Error(`[test] 数据目录不在临时目录下：${real}`);
  }
  return real;
}

export function useTempData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-test-"));
  process.env.NIHONCO_DATA_DIR = dir;
  assertIsolated(dir);
  // 数据目录里放一份真实词表（只读用），避免测试依赖仓库外的数据
  const repoData = path.resolve(process.cwd(), "data");
  for (const f of ["jlpt.json", "word-levels.json", "enrich-cache.seed.json",
                  "patterns-n5.json", "patterns-n4.json", "kanji-stems.json",
                  "pattern-gloss-zh.json"]) {
    const src = path.join(repoData, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  return dir;
}
