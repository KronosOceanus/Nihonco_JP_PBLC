/* 设置窗口：LLM 模型 / API key / 连通测试 */
(function () {
  const $ = (...a) => window.SettingsApp.$(...a);
  const flash = (...a) => window.SettingsApp.flash(...a);
  const render = (...a) => window.SettingsApp.render(...a);
  const cfg = () => window.SettingsApp.cfg();

let maskedKey = "";
let pendingKey = "";
let keyDirty = false;
let keyMaskTimer = null;
let customDirty = false;
let ollamaModels = [];

async function loadOllamaModels() {
  if (!window.cfg.ollamaModels) return;
  try {
    const r = await window.cfg.ollamaModels();
    ollamaModels = (r && r.models) || [];
    if (ollamaModels.length && window.SettingsApp.cfg()) renderLlm(window.SettingsApp.cfg());
  } catch (e) {}
}

function renderLlm(cfg) {
  const sel = $("model");
  const known = cfg.llm.known;
  sel.innerHTML = "";
  let group = null, lastProvider = null;
  const catalog = [...(cfg.llm.catalog || [])];
  for (const m of ollamaModels) {
    if (!catalog.some((x) => x.model === m && x.base === "http://127.0.0.1:11434/v1")) {
      catalog.push({ model: m, base: "http://127.0.0.1:11434/v1", provider: "ollama", providerName: "本地 Ollama" });
    }
  }
  for (const item of catalog) {
    if (item.providerName !== lastProvider) {
      lastProvider = item.providerName;
      group = document.createElement("optgroup");
      group.label = item.providerName;
      sel.appendChild(group);
    }
    const opt = document.createElement("option");
    opt.value = JSON.stringify({ model: item.model, base: item.base });
    opt.textContent = item.model;
    group.appendChild(opt);
  }

  const savedValue = JSON.stringify({ model: cfg.llm.model, base: cfg.llm.baseUrl });
  if (!known && cfg.llm.model) {
    const opt = document.createElement("option");
    opt.value = savedValue;
    opt.textContent = `当前：${cfg.llm.model}`;
    sel.appendChild(opt);
  }

  const customOpt = document.createElement("option");
  customOpt.value = "__custom__";
  customOpt.textContent = "自定义…";
  sel.appendChild(customOpt);

  sel.value = known ? JSON.stringify({ model: known.model, base: known.base })
                    : (cfg.llm.model ? savedValue : "__custom__");

  const isCustom = sel.value === "__custom__";
  $("customRow").style.display = isCustom ? "" : "none";
  $("customBaseRow").style.display = isCustom ? "" : "none";
  if (isCustom && !customDirty) {
    $("customModel").value = cfg.llm.model;
    $("customBase").value = cfg.llm.baseUrl || "";
  }

  $("baseUrl").textContent = "当前接口：" + (cfg.llm.baseUrl || "—");

  maskedKey = cfg.llm.hasKey ? (cfg.llm.keyMasked || "") : "";
  const keyInput = $("apiKey");
  keyInput.placeholder = cfg.llm.hasKey ? "粘贴新 key 才会修改" : "缺少 API key，请粘贴";
  if (!keyDirty) {
    keyInput.value = maskedKey;
    keyInput.classList.toggle("masked", !!maskedKey);
  }
}

async function applyModel({ model, base }) {
  flash("切换中…", 0);
  try {
    const cfg = await window.cfg.setProvider({ model, base });
    render(cfg);
    flash("已切换到 " + cfg.llm.model);
    return true;
  } catch (e) {
    flash("切换失败：" + e.message);
    return false;
  }
}

function bindLlm() {
  $("model").addEventListener("change", async () => {
    const v = $("model").value;
    if (v === "__custom__") {
      $("customRow").style.display = "";
      $("customBaseRow").style.display = "";
      if (!$("customBase").value.trim() && cfg()) $("customBase").value = cfg().llm.baseUrl || "";
      $("customModel").focus();
      return;
    }
    $("customRow").style.display = "none";
    $("customBaseRow").style.display = "none";
    customDirty = false;
    await applyModel(JSON.parse(v));
  });

  const applyCustom = async () => {
    const m = $("customModel").value.trim();
    if (!m) { flash("请填写模型名"); return; }
    const ok = await applyModel({ model: m, base: $("customBase").value.trim() });
    if (ok) customDirty = false;
  };
  for (const id of ["customModel", "customBase"]) {
    $(id).addEventListener("input", () => { customDirty = true; });
  }
  $("applyCustom").addEventListener("click", applyCustom);
  for (const id of ["customModel", "customBase"]) {
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") applyCustom(); });
  }

  const keyInput = $("apiKey");
  const showMasked = () => {
    const shown = maskedKey || (pendingKey ? "••••" : "");
    if (!shown) return;
    keyInput.value = shown;
    keyInput.classList.add("masked");
  };

  keyInput.addEventListener("focus", () => {
    keyDirty = true;
    clearTimeout(keyMaskTimer);
    if (keyInput.classList.contains("masked")) { keyInput.value = pendingKey || ""; keyInput.classList.remove("masked"); }
  });
  keyInput.addEventListener("input", () => {
    keyDirty = true;
    pendingKey = keyInput.value;
    keyInput.classList.remove("masked");
    clearTimeout(keyMaskTimer);
    keyMaskTimer = setTimeout(() => {
      if (document.activeElement !== keyInput && pendingKey) showMasked();
    }, 3000);
  });
  keyInput.addEventListener("blur", () => {
    if (!keyInput.value.trim()) { keyDirty = false; showMasked(); return; }
    clearTimeout(keyMaskTimer);
    keyMaskTimer = setTimeout(showMasked, 3000);
  });

  $("saveKey").addEventListener("click", async () => {
    const el = $("apiKey");
    const v = (el.classList.contains("masked") ? pendingKey : el.value).trim();
    if (!v || v === maskedKey) { flash("key 没有改动"); return; }
    flash("保存中…", 0);
    try {
      const cfg = await window.cfg.setKey(v);
      pendingKey = "";
      keyDirty = false;
      clearTimeout(keyMaskTimer);
      render(cfg);
      flash("key 已保存（立即生效）");
    } catch (e) {
      flash("保存失败：" + e.message);
    }
  });

  $("testLLM").addEventListener("click", async () => {
    flash("测试中…", 0);
    try {
      const r = await window.cfg.testLLM();
      flash(r.ok ? `连通 ✓ ${r.model}` : `失败：${r.error}`);
    } catch (e) {
      flash("失败：" + e.message);
    }
  });
}

window.SettingsApp.register("llm", { init: () => { bindLlm(); loadOllamaModels(); }, render: renderLlm });

})();
