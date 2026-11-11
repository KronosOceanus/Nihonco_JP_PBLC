import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createStaticServer = require("../main/static-server.js");

test("lite：/model 与 Cubism Core 从外置 assets 回落", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nihonco-assets-"));
  const root = path.join(dir, "root");
  const assets = path.join(dir, "assets");
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(assets, "model", "Hiyori"), { recursive: true });
  fs.mkdirSync(path.join(assets, "lib"), { recursive: true });
  fs.writeFileSync(path.join(assets, "model", "Hiyori", "Hiyori.model3.json"), '{"ok":1}');
  fs.writeFileSync(path.join(assets, "lib", "live2dcubismcore.min.js"), "core");
  fs.writeFileSync(path.join(root, "pet.html"), "root");

  const srv = createStaticServer({ root, userData: dir, assetsDir: assets, isPackaged: false });
  const port = await srv.startServer();
  const base = `http://127.0.0.1:${port}`;

  assert.equal(await (await fetch(`${base}/model/Hiyori/Hiyori.model3.json`)).text(), '{"ok":1}');
  assert.equal(await (await fetch(`${base}/lib/live2dcubismcore.min.js`)).text(), "core");
  assert.equal((await fetch(`${base}/model/../.env`)).status, 404);

  await srv.close();
});
