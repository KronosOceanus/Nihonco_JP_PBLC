/* 设置窗口：ASR 分区（后端 / 模型 / 日志 / Windows GPU） */
(function () {
  const $ = (...a) => window.SettingsApp.$(...a);
  const flash = (...a) => window.SettingsApp.flash(...a);
  const render = (...a) => window.SettingsApp.render(...a);
  const cfg = () => window.SettingsApp.cfg();

let currentAsr = null;

function cfgLang() {
  return (cfg() && cfg().asr && cfg().asr.lang) || "JA";
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
let engineBusy = false;
const fmtMB = (n) => (Number(n || 0) / 1024 / 1024).toFixed(1) + " MB";

async function renderAsrEngine() {
  const row = $("gpuRow");
  if (!row) return;
  let st = null;
  try { st = await window.cfg.asrEngine(); } catch (e) {}
  if (!st || st.platform !== "win32") { row.style.display = "none"; return; }
  row.style.display = "";
  const gpu = st.gpu || {};
  const now = st.active || "cpu";
  const inst = st.installed || [];
  const instText = inst.length ? inst.map((x) => `${x.id}（${x.mb} MB）`).join(" / ") : "未装";
  if (!gpu.found) {
    $("gpuInfo").textContent = `没检测到 NVIDIA 显卡 → 走 CPU 版（${gpu.reason || "?"}）`;
  } else {
    $("gpuInfo").textContent =
      `${gpu.name}｜驱动 ${gpu.driver}｜显存 ${gpu.vramMB} MB` +
      `｜当前 ${now}｜已装 ${instText}` +
      (st.recommend ? "" : "｜驱动太旧，只能 CPU");
  }
  $("gpuInstall").disabled = engineBusy || !st.recommend;
  $("gpuInstall").textContent = inst.length ? "重装" : "下载";
  $("gpuRemove").style.display = inst.length ? "" : "none";
  $("gpuRemove").disabled = engineBusy;
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
  const btn = $("gpuInstall");
  if (!btn) return;

  const setCancel = (show) => { const c = $("gpuCancel"); if (c) c.style.display = show ? "" : "none"; };
  const hideProg = (ms = 1600) => {
    setTimeout(() => {
      const wrap = $("gpuProgRow"), bar = $("gpuProg");
      setCancel(false);
      if (!wrap) return;
      wrap.style.display = "none";
      if (bar) bar.style.width = "0%";
    }, ms);
  };

  window.cfg.onAsrEngineProgress((p) => {
    const wrap = $("gpuProgRow"), bar = $("gpuProg"), txt = $("gpuProgText");
    if (!p || !wrap || !bar || !txt) return;
    wrap.style.display = "";
    if (p.phase === "start") {
      setCancel(true); bar.style.width = "1%";
      txt.textContent = `准备中…（约 ${p.approxMB || "?"} MB）`;
    } else if (p.phase === "local") {
      setCancel(true); bar.style.width = "70%";
      txt.textContent = "使用本地包：" + String(p.file || "").split(/[\\/]/).pop();
    } else if (p.phase === "download") {
      setCancel(true);
      const pct = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
      bar.style.width = pct + "%";
      txt.textContent = `${fmtMB(p.received)} / ${p.total ? fmtMB(p.total) : "?"}  ${pct}%`;
    } else if (p.phase === "extract") { setCancel(true); txt.textContent = "解压中…"; bar.style.width = "78%"; }
    else if (p.phase === "copy") { setCancel(true); txt.textContent = "写入文件…"; bar.style.width = "90%"; }
    else if (p.phase === "retry") { txt.textContent = "换源重试…" + (p.msg ? `（${p.msg}）` : ""); }
    else if (p.phase === "cancel") { txt.textContent = "取消中…"; setCancel(false); }
    else if (p.phase === "cancelled") { bar.style.width = "0%"; txt.textContent = "已取消"; setCancel(false); hideProg(); }
    else if (p.phase === "error") { bar.style.width = "0%"; txt.textContent = "失败：" + p.msg; setCancel(false); }
    else if (p.phase === "done" || p.phase === "installed") {
      bar.style.width = "100%"; txt.textContent = "完成"; setCancel(false); hideProg();
    }
  });

  btn.addEventListener("click", async () => {
    engineBusy = true; btn.disabled = true;
    setCancel(true);
    $("gpuProgRow").style.display = "";
    $("gpuProg").style.width = "0%";
    $("gpuProgText").textContent = "准备中…";
    try {
      const r = await window.cfg.asrEngineInstall();
      if (r && r.cancelled) flash("已取消");
      else if (r && r.ok === false) flash("下载失败：" + (r.error || "未知错误"), 3500);
      else flash("GPU 版已启用（识别约 0.15 s）", 3000);
    } catch (e) { flash("下载失败：" + (e.message || e), 3500); }
    engineBusy = false;
    setCancel(false);
    await renderAsrEngine();
    if (typeof cfg() !== "undefined") renderAsr(cfg()).catch(() => {});
  });

  const cancelBtn = $("gpuCancel");
  if (cancelBtn) cancelBtn.addEventListener("click", async () => {
    $("gpuProgText").textContent = "取消中…";
    try { await window.cfg.asrEngineCancel(); } catch (e) {}
  });

  $("gpuRemove").addEventListener("click", async () => {
    engineBusy = true;
    try { await window.cfg.asrEngineRemove("cuda-12.4"); flash("已卸载，回到 CPU 版"); }
    catch (e) { flash("卸载失败：" + (e.message || e)); }
    engineBusy = false;
    await renderAsrEngine();
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
