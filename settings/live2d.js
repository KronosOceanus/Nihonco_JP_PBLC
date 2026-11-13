/* 设置窗口：Live2D 模型 / 取景 */
(function () {
  const $ = (...a) => window.SettingsApp.$(...a);
  const flash = (...a) => window.SettingsApp.flash(...a);
  const render = (...a) => window.SettingsApp.render(...a);
  const cfg = () => window.SettingsApp.cfg;

async function loadModels() {
  const sel = $("modelPick");
  if (!sel) return;
  try {
    const r = await window.cfg.models();
    if (!r || !r.ok) throw new Error("no models");
    sel.innerHTML = "";
    for (const m of r.list || []) {
      const o = document.createElement("option");
      o.value = m.path;
      o.textContent = m.label + (m.path === r.active ? "（当前）" : "");
      sel.appendChild(o);
    }
    sel.value = r.active;
    $("fitMx").value = r.fit.mx;
    $("fitMy").value = r.fit.my;
    $("fitF").value = r.fit.f || 1.62;
  } catch (e) {
    sel.innerHTML = "";
    const o = document.createElement("option");
    o.textContent = "（没有可用模型）";
    sel.appendChild(o);
  }
}

function bindLive2d() {
  const modelSel = $("modelPick");
  const fillFit = (fit) => {
    $("fitF").value = fit.f;
    $("fitMx").value = fit.mx;
    $("fitMy").value = fit.my;
  };

  const apply = async (save, pickOnly) => {
    const fit = pickOnly
      ? undefined
      : {
          mx: Number($("fitMx").value),
          my: Number($("fitMy").value) || 0,
          f: Number($("fitF").value) || 1.7,
        };
    const r = await window.cfg.setModel({ path: modelSel.value, fit, save: !!save });
    if (r && r.ok) {
      [...modelSel.options].forEach((o) => {
        o.textContent = o.textContent.replace("（当前）", "") + (o.value === r.active ? "（当前）" : "");
      });
      if (r.fit) fillFit(r.fit);
      flash(save ? `已保存 ${r.active.split("/")[1]} 的默认位置` : `模型：${r.active.split("/")[1]}`);
    } else {
      flash("切换失败");
    }
  };
  if (modelSel) modelSel.addEventListener("change", () => apply(false, true));
  const applyBtn = $("applyFit");
  if (applyBtn) applyBtn.addEventListener("click", () => apply(false));
  const saveBtn = $("saveFit");
  if (saveBtn) saveBtn.addEventListener("click", () => apply(true));
}

function renderAlwaysOnTop(c) {
  const btn = $("alwaysOnTop");
  if (!btn) return;
  const on = !!(c && c.alwaysOnTop);
  btn.textContent = on ? "开启" : "关闭";
  btn.classList.toggle("on", on);
}

function bindAlwaysOnTop() {
  const btn = $("alwaysOnTop");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      // 以主进程当前值为准：托盘/快捷键也可能改过
      const cur = await window.cfg.get();
      const next = !cur.alwaysOnTop;
      const saved = await window.cfg.set({ alwaysOnTop: next });
      renderAlwaysOnTop(saved);
      flash(next ? "已开启始终置顶" : "已关闭始终置顶");
    } catch (e) {
      flash("切换失败：" + (e.message || e));
    }
  });
}

async function initLive2d() {
  await loadModels();
  bindLive2d();
  bindAlwaysOnTop();
}

window.SettingsApp.register("live2d", {
  init: initLive2d,
  load: loadModels,
  render: renderAlwaysOnTop,
});

})();
