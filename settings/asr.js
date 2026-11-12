/* 设置窗口：ASR 分区（后端 / 模型 / 日志 / Windows GPU） */
(function () {
  const $ = (...a) => window.SettingsApp.$(...a);
  const flash = (...a) => window.SettingsApp.flash(...a);
  const render = (...a) => window.SettingsApp.render(...a);
  const cfg = () => window.SettingsApp.cfg;

let currentAsr = null;

function cfgLang() {
  return (cfg() && cfg().asr && cfg().asr.lang) || "JA";
}

function setAsrHint(opt) {
  const el = $("asrHint");
  if (!el || !opt) return;
  el.innerHTML = opt.isWin
    ? 'whisper.cpp：拖入 <code>ggml-*.bin</code>，或先跑 <code>npm run setup:whisper</code>'
    : 'whisper.cpp 默认；mlx 模型先跑 <code>npm run setup:mlx</code>';
}

function setAsrDetail(opt) {
  const el = $("asrDetail");
  if (!el || !opt) return;
  const esc = (v) => String(v || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  if (opt.isWin) {
    el.innerHTML = `后端 <code>whisper.cpp</code> 需要 <code>${esc(opt.whisperHome)}</code> 里的 whisper-server；<br>` +
      `用户模型来自 <code>${esc(opt.whisperModelsDir)}</code>，内置目录兜底；切换后自动重启识别服务。`;
  } else {
    el.innerHTML = `后端 <code>whisper.cpp</code> 需要 <code>.whisper/whisper-server</code>；<code>mlx</code> 需要 ` +
      `<code>.venv</code>（Python），切换后自动重启识别服务。<br>` +
      `模型清单来自 <code>.whisper/models</code>（ggml）与 <code>.hf-cache</code>（mlx）。`;
  }
}

function setAsrInfoLine(opt, lang) {
  const el = $("asrInfo");
  if (!el || !opt) return;
  const mis = opt.misplacedModel ? `（.env 里的 ${opt.rawModel} 不适用于当前后端，已按最小模型显示）` : "";
  const missing = opt.missingModel ? `（.env 里的 ${opt.rawModel} 已不存在，已回退到 ${opt.model}）` : "";
  el.textContent = `识别 ${String(lang).toUpperCase()} · ${opt.backend} · ${opt.model}${mis}${missing}`;
}

function fillModelOptions(md, list, cur, dflt) {
  if (!md) return;
  md.innerHTML = "";
  if (!list || !list.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "没有模型：请拖入 ggml-*.bin";
    o.disabled = true;
    o.selected = true;
    md.appendChild(o);
    const apply = $("applyAsr");
    if (apply) apply.disabled = true;
    return;
  }
  const apply = $("applyAsr");
  if (apply) apply.disabled = false;
  const seen = new Set();
  for (const m of list) {
    const o = document.createElement("option");
    o.value = m.value;
    o.textContent = (m.label || m.value) + (m.ready === false ? "（未下载）" : "");
    if (m.ready === false && m.value !== cur) o.disabled = true;
    md.appendChild(o);
    seen.add(m.value);
  }
  if (cur && !seen.has(cur)) {
    const o = document.createElement("option");
    o.value = cur; o.textContent = cur;
    md.appendChild(o);
    md.value = cur;
  } else if (cur) {
    md.value = cur;
  } else {
    md.value = (dflt && seen.has(dflt)) ? dflt : ((list[0] && list[0].value) || "");
  }
}

async function renderAsr(cfg) {
  const be = $("asrBackend"), md = $("asrModel");
  if (!be || !md) return;
  let opt = null;
  try { opt = await window.cfg.asrOptions(); } catch (e) {}
  if (!opt) { be.innerHTML = ""; md.innerHTML = ""; return; }
  currentAsr = opt;
  be.innerHTML = "";
  for (const b of opt.backends) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.label + (b.available ? "" : `（${b.hint || "未安装"}）`);
    o.disabled = !b.available;
    be.appendChild(o);
  }
  be.value = opt.backend;
  const list = opt.backend === "whispercpp" ? opt.wcppModels : opt.mlxModels;
  fillModelOptions(md, list, opt.model, opt.defaultModel);
  setAsrHint(opt);
  setAsrDetail(opt);
  setAsrInfoLine(opt, cfgLang());
}

function renderAsrMeta(cfg) {
  const logBtn = $("asrLog");
  if (logBtn) {
    logBtn.textContent = cfg.asr.log ? "已开启" : "已关闭";
    logBtn.classList.toggle("on", !!cfg.asr.log);
  }
  const logPath = $("asrLogPath");
  if (logPath) logPath.textContent = cfg.asr.logFile ? cfg.asr.logFile : "";
}

/* ---------------- GPU 加速版 whisper.cpp（Windows CUDA） ---------------- */
let currentAsrEngine = "cpu";

async function renderAsrEngine() {
  let st = null, opt = null;
  try { st = await window.cfg.asrEngine(); } catch (e) {}
  try { opt = await window.cfg.asrOptions(); } catch (e) {}
  const isWin = !!st && st.platform === "win32";
  for (const id of ["asrActualEngineRow", "whisperEngineRow", "whisperModelRow"]) {
    const el = $(id);
    if (el) el.style.display = isWin ? "" : "none";
  }
  if (!isWin) return;

  const installed = new Set((st.installed || []).map((x) => x.id));
  const mark = (id, ok) => {
    const el = $(id);
    if (!el) return;
    el.textContent = ok ? "已找到" : "未找到";
    el.style.color = ok ? "var(--ok, #7ee2a8)" : "var(--text-dim)";
  };
  const rec = st.recommend || "";
  mark("statWhisperCuda", !!rec && installed.has(rec));
  mark("statWhisperCpu", !!(opt && opt.wcppBin));
  mark("statWhisperModel", !!(opt && opt.wcppModels && opt.wcppModels.length));
  const sel = $("asrActualEngine");
  if (sel) {
    sel.innerHTML = "";
    for (const [id, label] of [["cuda-12.4", "CUDA 12.4"], ["cuda-11.8", "CUDA 11.8"], ["cpu", "CPU"]]) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = label + ((id !== "cpu" && !installed.has(id)) ? "（未安装）" : "");
      o.disabled = id !== "cpu" && !installed.has(id);
      sel.appendChild(o);
    }
    // active.json 可能仍写着 CUDA，但 GPU 连续失败后运行时实际已回退 CPU。
    const effective = st.gpuFallbackPermanent ? "cpu" : st.active;
    currentAsrEngine = installed.has(effective) ? effective : "cpu";
    sel.value = currentAsrEngine;
    const note = $("asrEngineNote");
    if (note) {
      note.textContent = st.gpuFallbackPermanent ? "CUDA 连续失败，已回退 CPU" : "";
      note.style.display = st.gpuFallbackPermanent ? "" : "none";
    }
  }

  const cudaBtn = $("dlWhisperCuda");
  if (cudaBtn) {
    cudaBtn.disabled = !rec;
    cudaBtn.dataset.resource = rec === "cuda-11.8" ? "whisper-cuda-11.8" : "whisper-cuda-12.4";
    cudaBtn.textContent = rec === "cuda-11.8"
      ? "下载 Whisper 引擎（CUDA 11.8 版）"
      : (rec === "cuda-12.4" ? "下载 Whisper 引擎（CUDA 12.4 版）" : "下载 Whisper 引擎（CUDA 版）");
    cudaBtn.title = rec
      ? `下载 ${rec} 引擎`
      : `没有检测到可用的 NVIDIA CUDA 驱动：${(st.gpu && st.gpu.reason) || "驱动太旧或未安装"}`;
  }
}

function bindAsrForm() {
  const beSel = $("asrBackend"), mdSel = $("asrModel");
  if (beSel && mdSel) {
    const apply = async () => {
      const btn = $("applyAsr");
      if (btn) btn.disabled = true;
      flash("应用识别设置…", 0);
      try {
        await window.cfg.setAsr({ backend: beSel.value, model: mdSel.value });
        flash("识别服务已重启");
        render(await window.cfg.get());
      } catch (e) {
        flash("切换失败：" + (e && e.message || e));
        render(await window.cfg.get());
      } finally {
        if (btn) btn.disabled = false;
      }
    };
    beSel.addEventListener("change", async () => {
      if (currentAsr) {
        const list = beSel.value === "whispercpp" ? currentAsr.wcppModels : currentAsr.mlxModels;
        mdSel.innerHTML = "";
        for (const m of list) {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label || m.value; mdSel.appendChild(o);
        }
        currentAsr.backend = beSel.value;
      }
    });
    const applyBtn = $("applyAsr");
    if (applyBtn) applyBtn.addEventListener("click", apply);
  }

  const asrLogBtn = $("asrLog");
  if (asrLogBtn) {
    asrLogBtn.addEventListener("click", async () => {
      const next = !(cfg() && cfg().asr && cfg().asr.log);
      try {
        await window.cfg.setAsrLog(next);
        flash(next ? "已开启识别日志" : "已关闭识别日志");
        render(await window.cfg.get());
      } catch (e) {
        flash("切换失败：" + (e && e.message || e));
      }
    });
  }
}

function bindAsrEngine() {
  const links = {
    dlWhisperCuda: "whisper-cuda-12.4",
    dlWhisperCpu: "whisper-cpu",
    dlWhisperModel: "whisper-model",
  };
  for (const [id, key] of Object.entries(links)) {
    const el = $(id);
    if (el) el.addEventListener("click", () => {
      const target = id === "dlWhisperCuda" ? (el.dataset.resource || key) : key;
      if (!el.disabled) window.cfg.openResource(target).catch(() => {});
    });
  }

  const apply = $("applyAsrEngine");
  if (apply) apply.addEventListener("click", async () => {
    const sel = $("asrActualEngine");
    if (!sel || sel.value === currentAsrEngine) return;
    apply.disabled = true;
    flash("切换识别引擎…", 0);
    try {
      const r = await window.cfg.asrEngineSwitch(sel.value);
      if (!r || r.ok === false) throw new Error((r && r.error) || "切换失败");
      flash("识别引擎已切换");
      await renderAsrEngine();
    } catch (e) {
      flash("切换失败：" + (e && e.message || e), 3500);
      if (sel) sel.value = currentAsrEngine;
    } finally { apply.disabled = false; }
  });
}

async function initAsr() {
  bindAsrForm();
  bindAsrEngine();
  await renderAsr(cfg()).catch(() => {});
  renderAsrEngine().catch(() => {});
}

window.SettingsApp.register("asr", { init: initAsr, render: (cfg) => { renderAsr(cfg); renderAsrMeta(cfg); } });

})();
