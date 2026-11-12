/* 设置窗口：数据 / 开机自启 / 窗口大小 */
(function () {
  const $ = (...a) => window.SettingsApp.$(...a);
  const flash = (...a) => window.SettingsApp.flash(...a);
  const render = (...a) => window.SettingsApp.render(...a);
  const cfg = () => window.SettingsApp.cfg;

function bindDataButtons() {
  const exp = $("exportData"), imp = $("importData"), rst = $("resetData");
  if (exp) exp.addEventListener("click", async () => {
    const r = await window.cfg.dataExport();
    flash(r && r.ok ? `已导出到 ${r.path}` : (r && r.canceled ? "" : "导出失败"));
  });
  if (imp) imp.addEventListener("click", async () => {
    if (!confirm("导入会覆盖当前学习记录（会先自动备份），继续？")) return;
    const r = await window.cfg.dataImport();
    if (r && r.ok) {
      flash(`已导入：单词 ${r.words} · 句型 ${r.patterns}`);
      await window.SettingsApp.module("data")?.refresh?.();
    } else if (r && !r.canceled) {
      flash(r.error || "导入失败");
    }
  });
  if (rst) rst.addEventListener("click", async () => {
    if (!confirm("清空所有学习进度（所有档位的单词与句型）？会先自动备份。")) return;
    const r = await window.cfg.dataReset("all");
    if (r && r.ok) {
      flash("已清空全部（可从 data/backup/ 找回）");
      await window.SettingsApp.module("data")?.refresh?.();
    } else {
      flash("清空失败");
    }
  });

  const restore = $("restoreBackup");
  if (restore) restore.addEventListener("click", async () => {
    const file = $("backupList") && $("backupList").value;
    if (!file) { flash("没有可恢复的备份"); return; }
    if (!confirm(`恢复备份 ${file}？当前进度会先自动备份。`)) return;
    const r = await window.cfg.dataRestore(file);
    if (r && r.ok) {
      flash(`已恢复：单词 ${r.words} · 句型 ${r.patterns}`);
      await window.SettingsApp.module("data")?.refresh?.();
    } else {
      flash((r && r.error) || "恢复失败");
    }
  });

  const autoBtn = $("autostart");
  if (autoBtn) {
    window.cfg.getAutostart().then((r) => {
      const row = $("autostartRow");
      if (row) row.style.display = r && r.available ? "" : "none";
      autoBtn.textContent = r && r.enabled ? "开启" : "关闭";
      autoBtn.classList.toggle("on", !!(r && r.enabled));
    }).catch(() => {});
    autoBtn.addEventListener("click", async () => {
      const next = !autoBtn.classList.contains("on");
      const r = await window.cfg.setAutostart(next).catch(() => null);
      if (r && r.ok) {
        autoBtn.textContent = r.enabled ? "开启" : "关闭";
        autoBtn.classList.toggle("on", !!r.enabled);
        flash(r.enabled ? "已开启开机自启" : "已关闭开机自启");
      } else {
        flash("切换失败：" + ((r && r.error) || "未知错误"));
      }
    });
  }

  const lvl = $("resetLevel");
  if (lvl) lvl.addEventListener("click", async () => {
    if (!confirm("只清空「当前档位」的单词与句型进度？会先自动备份。")) return;
    const r = await window.cfg.dataReset("level");
    if (r && r.ok) {
      flash(`已清空 ${r.wordLevel} 单词 ${r.removedWords} 个 / ${r.patternLevel} 句型 ${r.removedPatterns} 个`);
      await window.SettingsApp.module("data")?.refresh?.();
    } else {
      flash("清空失败");
    }
  });
}

let winSizeDefault = { w: 380, h: 560 };

async function loadPetSize() {
  try {
    const sz = await window.cfg.petSize();
    if (!sz) return;
    if (sz.default && sz.default.w) winSizeDefault = sz.default;
    const w = $("winW"), h = $("winH");
    if (w) w.value = String(sz.w);
    if (h) h.value = String(sz.h);
  } catch (e) {}
}

function bindPetSize() {
  const reset = $("resetWinSize");
  if (reset) reset.addEventListener("click", async () => {
    const r = await window.cfg.setPetSize(winSizeDefault);
    if (r && r.w) {
      if ($("winW")) $("winW").value = String(r.w);
      if ($("winH")) $("winH").value = String(r.h);
      flash(`已恢复默认：${r.w} × ${r.h}`);
    } else {
      flash("恢复失败");
    }
  });

  const btn = $("applyWinSize");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const w = Number($("winW")?.value || 0);
    const h = Number($("winH")?.value || 0);
    const r = await window.cfg.setPetSize({ w, h });
    if (r && r.w) {
      if ($("winW")) $("winW").value = String(r.w);
      if ($("winH")) $("winH").value = String(r.h);
      flash(`窗口大小：${r.w} × ${r.h}`);
    } else {
      flash("调整失败");
    }
  });
}

async function initMaintenance() {
  bindDataButtons();
  await loadPetSize();
  bindPetSize();
}

window.SettingsApp.register("maintenance", { init: initMaintenance });

})();
