import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/* HUD 只有 ~97px 宽（模式栏左边），一条文案超过 16 个字就会折 3 行以上。
 * 这条测试守住「长文案不许再写回 HUD」：错误详情写 console/log，不塞进 HUD。 */

const files = ["renderer/app-ui.js", "renderer/rec.js", "renderer/modes.js",
               "renderer/speech.js", "renderer/cards.js"];

test("HUD 静态文案不超过 16 字", () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    for (const m of src.matchAll(/hudShow\(\s*"([^"]*)"/g)) {
      const text = m[1];
      // 允许断句：按每一行算长度（HUD 只有 ~97px 宽）
      for (const line of text.split("\\n")) {
        if (line.length > 16) bad.push(`${f}: ${text}（行「${line}」${line.length} 字）`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("HUD 不拼接错误详情（错误应进 console）", () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    for (const m of src.matchAll(/hudShow\([^;\n]*e\.message/g)) bad.push(`${f}: ${m[0].slice(0, 60)}`);
    for (const m of src.matchAll(/hudShow\([^;\n]*err\.message/g)) bad.push(`${f}: ${m[0].slice(0, 60)}`);
  }
  assert.deepEqual(bad, []);
});
