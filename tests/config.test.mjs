import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTempData } from "./_env.mjs";

const dir = useTempData();
const config = await import("../agent/config.js");
const providers = await import("../agent/providers.js");

test("掩码：与 key 前缀无关，取头尾各 4 位", () => {
  assert.equal(config.maskKey("sk-4a7b2fd6"), "sk-4…2fd6");
  assert.equal(config.maskKey("AIzaSyD-EXAMPLE-1234"), "AIza…1234");
  assert.equal(config.maskKey("gsk_abcdefghijk"), "gsk_…hijk");
  assert.equal(config.maskKey("ollama"), "••••");
  assert.equal(config.maskKey(""), "");
});

test("声线参数会被钳制到安全范围", () => {
  const v = config.patch({ voice: { speed: 9, pitch: 9, intonation: -3, volume: 9 } }).voice;
  assert.equal(v.speed, 1.5);
  assert.equal(v.pitch, 0.15);
  assert.equal(v.intonation, 0);
  assert.equal(v.volume, 2);
});

test("patch 只接受白名单字段（乱塞的键不进配置）", () => {
  const before = config.get().level;
  const after = config.patch({ level: "N1", evil: "x" });
  assert.equal(after.level, "N1");
  assert.equal(after.evil, undefined);
  const raw = JSON.parse(fs.readFileSync(`${dir}/settings.json`, "utf8"));
  assert.equal(raw.evil, undefined);
  config.patch({ level: before });
});

test("非法水平不会写进配置", () => {
  const before = config.get().level;
  config.patch({ level: "N9" });
  assert.equal(config.get().level, before);
});

test("setEnvValue 拒绝换行（防注入新变量）", () => {
  assert.throws(() => config.setEnvValue("X", "a\nLLM_API_KEY=evil"), /换行/);
});

test("setEnvValue 同时更新 process.env（调用方不用再写一遍）", () => {
  const key = "NIHONCO_TEST_ENV_SYNC";
  const old = process.env[key];
  try {
    config.setEnvValue(key, "ok");
    assert.equal(process.env[key], "ok");
    assert.match(fs.readFileSync(`${dir}/.env`, "utf8"), /NIHONCO_TEST_ENV_SYNC=ok/);
  } finally {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
});

test("模型目录：按模型名能反查接口地址", () => {
  assert.equal(providers.baseOf("deepseek-chat"), "https://api.deepseek.com/v1");
  assert.equal(providers.baseOf("gpt-4o"), "https://api.openai.com/v1");
  assert.equal(providers.baseOf("模型不存在"), "");
});

test("setProvider：目录里的模型自动填地址；自定义则沿用当前地址", () => {
  const r1 = config.setProvider({ model: "gpt-4o-mini" });
  assert.equal(r1.ok, true);
  assert.equal(r1.baseUrl, "https://api.openai.com/v1");

  const r2 = config.setProvider({ model: "my-gateway-model" });
  assert.equal(r2.ok, true);
  assert.equal(r2.baseUrl, "https://api.openai.com/v1", "应沿用当前地址");
});
