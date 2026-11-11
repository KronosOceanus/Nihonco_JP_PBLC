/* 设置窗口：TTS 分区（引擎 / 模型 / 语音参数） */
(function () {
  const $ = (...a) => window.SettingsApp.$(...a);
  const flash = (...a) => window.SettingsApp.flash(...a);
  const render = (...a) => window.SettingsApp.render(...a);
  const cfg = () => window.SettingsApp.cfg();

const VOICE_KEYS = ["speed", "pitch", "intonation", "volume"];
const fmt = {
  speed: (v) => `${Number(v).toFixed(2)}x`,
  pitch: (v) => (Number(v) > 0 ? "+" : "") + Number(v).toFixed(2),
  intonation: (v) => Number(v).toFixed(2),
  volume: (v) => Number(v).toFixed(2),
};

function paintRange(el) {
  const min = Number(el.min || 0), max = Number(el.max || 100), v = Number(el.value);
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--fill", pct.toFixed(1) + "%");
}

async function loadTtsEngine() {
  const sel = $("ttsEngine");
  if (!sel) return;
  try {
    const [r, st] = await Promise.all([
      window.cfg.ttsEngine(),
      window.cfg.ttsEngineStatus ? window.cfg.ttsEngineStatus().catch(() => null) : Promise.resolve(null),
    ]);
    const engines = (st && st.engines) || {};
    const labels = { voicevox: "VOICEVOX", aivis: "AivisSpeech" };
    for (const opt of sel.options) {
      const info = engines[opt.value];
      const usable = !info || info.installed || info.reachable;
      const current = r && r.engine === opt.value;
      opt.disabled = !usable && !current;
      opt.textContent = `${labels[opt.value] || opt.value}${usable ? "" : "（未安装）"}`;
    }
    if (r && r.engine) sel.value = r.engine;
  } catch (e) {}
}

function voicesBusy(text = "（引擎启动中…）") {
  const sel = $("voicePick");
  if (!sel) return;
  sel.innerHTML = "";
  const o = document.createElement("option");
  o.textContent = text;
  sel.appendChild(o);
}

function ttsWaitHint(want, seconds, phase, detail, bert) {
  const el = $("ttsEngineHint");
  if (!el) return;
  if (want !== "aivis") {
    el.textContent = `正在启动 VOICEVOX… 已等待 ${seconds} 秒`;
    return;
  }
  const mb = (bert && bert.bytes ? (bert.bytes / 1024 / 1024).toFixed(0) : "0") + " MB";
  const stalled = bert && bert.stalled ? "（最近 30 秒没有增长，可能卡住）" : "";
  // 没有解析到实际阶段时，只报“启动/检查”，不能按时间猜成加载
  let msg = "正在启动 AivisSpeech，首次启动需要下载 BERT 模型…";
  if (phase === "bert_downloading") msg = "正在下载 BERT 模型（暂无精确百分比）…";
  else if (phase === "bert_loading") msg = "BERT 模型已下载，正在加载…";
  else if (phase === "bert_retry") msg = "BERT 下载遇到网络错误，正在重试…";
  else if (phase === "models") msg = "正在扫描 AivisSpeech 声线模型…";
  else if (phase === "failed") msg = "AivisSpeech 启动/下载失败：" + (detail || "查看日志");
  const esc = (x) => String(x || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const line2 = "下载期间请保持网络连接；如果长时间没有反应，可点「取消」回滚到 VOICEVOX。";
  el.innerHTML = `${esc(msg)} 已等待 ${seconds} 秒，BERT 缓存 <span class="bert-size">${mb}${esc(stalled)}</span>。<br>${line2}`;
}

async function loadVoices() {
  const sel = $("voicePick");
  if (!sel) return;
  try {
    const r = await window.cfg.voices();
    if (!r || !r.ok) throw new Error("no engine");
    sel.innerHTML = "";
    for (const sp of r.speakers || []) {
      const o = document.createElement("option");
      o.value = sp.name;
      const styles = (sp.styles || []).map((x) => x.name).slice(0, 3).join("/");
      o.textContent = styles ? `${sp.name} / ${styles.split("/")[0]}` : sp.name;
      sel.appendChild(o);
    }
    const hit = (r.speakers || []).find((sp) => sp.name.includes(r.current));
    sel.value = hit ? hit.name : ((r.speakers && r.speakers[0]) ? r.speakers[0].name : "");
  } catch (e) {
    voicesBusy();
    const o = sel.querySelector("option");
    if (!sel.dataset.retry) sel.dataset.retry = "0";
    const n = Number(sel.dataset.retry);
    if (n < 5) {
      sel.dataset.retry = String(n + 1);
      setTimeout(loadVoices, 2000);
    } else {
      o.textContent = "（引擎未启动，重启应用试试）";
    }
  }
}

function renderTts(cfg) {
  for (const k of VOICE_KEYS) {
    const el = $(k);
    if (!el) continue;
    el.value = cfg.voice[k];
    paintRange(el);
    $(k + "Val").textContent = fmt[k](cfg.voice[k]);
  }
}

function readVoice() {
  const voice = {};
  for (const k of VOICE_KEYS) voice[k] = Number($(k).value);
  return voice;
}

async function saveVoice() {
  try {
    const cfg = await window.cfg.set({ voice: readVoice() });
    render(cfg);
    flash("已保存");
  } catch (e) {
    flash("保存失败：" + e.message);
  }
}

function bindTts() {
  const engineSel = $("ttsEngine");
  const applyEngine = $("applyEngine");
  for (const [id, engine] of [["pickVoicevox", "voicevox"], ["pickAivis", "aivis"]]) {
    const btn = $(id);
    if (!btn) continue;
    btn.addEventListener("click", async () => {
      try {
        const r = await window.cfg.pickEnginePath(engine);
        if (!r || r.canceled) return;
        if (!r.ok) { flash(r.error || "路径无效"); return; }
        flash(`引擎路径：${r.path}`);
        window.SettingsApp.module("assets")?.reload?.();
        await loadTtsEngine();
      } catch (e) {
        flash("选择路径失败：" + (e && e.message || e));
      }
    });
  }

  const cancelEngine = $("cancelEngine");
  if (cancelEngine) cancelEngine.addEventListener("click", async () => {
    cancelEngine.disabled = true;
    flash("取消中…", 0);
    try { await window.cfg.cancelTtsSwitch(); } catch (e) {}
  });

  if (applyEngine) applyEngine.addEventListener("click", async () => {
    const want = engineSel ? engineSel.value : "";
    if (!want) return;
    applyEngine.disabled = true;
    if (engineSel) engineSel.disabled = true;
    if (cancelEngine) { cancelEngine.disabled = false; cancelEngine.hidden = false; }
    const started = Date.now();
    ttsWaitHint(want, 0);
    let lastBytes = -1, lastGrowth = Date.now();
    const waitTimer = setInterval(async () => {
      const sec = Math.floor((Date.now() - started) / 1000);
      let st = null, bert = null;
      try { st = await window.cfg.ttsEngineStatus(); } catch (e) {}
      try { bert = want === "aivis" ? await window.cfg.bertStatus() : null; } catch (e) {}
      if (bert) {
        if (bert.bytes !== lastBytes) { lastBytes = bert.bytes; lastGrowth = Date.now(); }
        bert.stalled = Date.now() - lastGrowth > 30000;
      }
      const a = st && st[want];
      ttsWaitHint(want, sec, a && a.phase, a && a.detail, bert);
    }, 1000);
    flash(want === "aivis" ? "AivisSpeech 启动/下载中…" : "切换引擎…", 0);
    voicesBusy("（引擎启动中…）");
    try {
      const r = await window.cfg.setTtsEngine(want);
      flash(r && r.ok ? `引擎：${r.engine}` : "切换失败");
      await loadVoices();
      window.SettingsApp.module("assets")?.reload?.();
    } catch (e) {
      flash("切换失败：" + (e && e.message || e));
      await loadTtsEngine();
      await loadVoices();
    } finally {
      clearInterval(waitTimer);
      applyEngine.disabled = false;
      if (engineSel) engineSel.disabled = false;
      if (cancelEngine) { cancelEngine.hidden = true; cancelEngine.disabled = false; }
      const h = $("ttsEngineHint");
      if (h) h.textContent = "首次启动 AivisSpeech 会自动下载 BERT 模型，可能需要几分钟。";
    }
  });

  const voiceSel = $("voicePick");
  if (voiceSel) voiceSel.addEventListener("change", async () => {
    const r = await window.cfg.setVoice(voiceSel.value);
    flash(r && r.ok ? `声线：${r.current}` : "切换失败");
  });

  for (const k of VOICE_KEYS) {
    const el = $(k);
    if (!el) continue;
    el.addEventListener("input", () => {
      $(k + "Val").textContent = fmt[k](el.value);
      paintRange(el);
    });
    el.addEventListener("change", saveVoice);
  }

  const preview = $("preview");
  if (preview) preview.addEventListener("click", async () => {
    flash("试听中…", 0);
    try {
      await window.cfg.previewVoice("こんにちは、にほんこだよ。");
      flash("试听完成");
    } catch (e) {
      flash("试听失败：" + e.message);
    }
  });
}

async function initTts() {
  bindTts();
  await loadTtsEngine();
  loadVoices();
}

window.SettingsApp.register("tts", { init: initTts, render: renderTts, loadEngine: loadTtsEngine, loadVoices, readVoice });

})();
