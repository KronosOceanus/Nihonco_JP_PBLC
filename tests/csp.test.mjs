import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/* 页面必须有 CSP，而且不能靠 unsafe-eval 兜：pixi 用 @pixi/unsafe-eval 补丁。
 * 这条测试和 npm run scan 的 [10] 互补：scan 看的是同一份文件，但 CI 里只有 npm test。 */

const ROOT = path.resolve(import.meta.dirname, "..");
const pages = ["pet.html", "settings.html"];

for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");

  test(`${page}：声明了 Content-Security-Policy`, () => {
    assert.match(html, /http-equiv="Content-Security-Policy"/i);
    assert.match(html, /default-src 'self'/i);
  });

  test(`${page}：脚本只允许同源，且不放开 unsafe-eval`, () => {
    assert.match(html, /script-src 'self'/i);
    assert.doesNotMatch(html, /'unsafe-eval'/i);
    assert.doesNotMatch(html, /script-src[^;"]*http/i, "CSP 里不该允许远程脚本");
  });

  test(`${page}：没有内联脚本（CSP 下会被拦）`, () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .filter((m) => m[1].trim().length > 0);
    assert.equal(inline.length, 0, `发现内联脚本 ${inline.length} 段`);
  });
}

test("pet.html 在 pixi 之后加载 @pixi/unsafe-eval 补丁", () => {
  const html = fs.readFileSync(path.join(ROOT, "pet.html"), "utf8");
  const i = html.indexOf("pixi.js/dist/pixi.min.js");
  const j = html.indexOf("@pixi/unsafe-eval");
  assert.ok(i > 0 && j > i, "补丁必须在 pixi.min.js 之后加载");
});
