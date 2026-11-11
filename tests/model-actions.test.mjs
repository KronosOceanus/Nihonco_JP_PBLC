import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan } from "../agent/model-actions.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-model-"));
  fs.writeFileSync(path.join(dir, "x.model3.json"), JSON.stringify({
    FileReferences: {
      Moc: "x.moc3",
      Expressions: [{ Name: "笑", File: "笑.exp3.json" }],
      Motions: { Idle: [{ File: "motions/idle.motion3.json" }] },
    },
  }));
  fs.mkdirSync(path.join(dir, "motions"));
  fs.writeFileSync(path.join(dir, "笑.exp3.json"), "{}");
  fs.writeFileSync(path.join(dir, "水印.exp3.json"), "{}");
  fs.writeFileSync(path.join(dir, "直接.exp3.json"), "{}");
  fs.writeFileSync(path.join(dir, "motions", "idle.motion3.json"), "{}");
  fs.writeFileSync(path.join(dir, "Scene1.motion3.json"), "{}");
  fs.writeFileSync(path.join(dir, "x.vtube.json"), JSON.stringify({
    Hotkeys: [
      { Name: "哭", Action: "ToggleExpression", File: "哭.exp3.json" },
      { Name: "移除", Action: "RemoveAllExpressions", File: "" },
    ],
  }));
  fs.writeFileSync(path.join(dir, "哭.exp3.json"), "{}");
  fs.mkdirSync(path.join(dir, "expressions"));
  fs.writeFileSync(path.join(dir, "expressions", "子目录.exp3.json"), "{}");
  return dir;
}

test("扫描 model3、vtube、目录兜底与未注册 motion", () => {
  const dir = fixture();
  try {
    const r = scan(path.join(dir, "x.model3.json"));
    const names = r.expressions.map((x) => x.name);
    assert.deepEqual(names.sort(), ["哭", "笑", "直接", "子目录"].sort());
    assert.ok(!names.includes("水印"));
    assert.ok(r.expressions.some((x) => x.name === "哭" && x.source === "vtube"));
    assert.ok(r.expressions.some((x) => x.name === "直接" && x.source === "file"));
    assert.deepEqual(r.motions.map((x) => x.label), ["Idle · idle"]);
    assert.ok(r.skipped.some((x) => x.file === "Scene1.motion3.json"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
