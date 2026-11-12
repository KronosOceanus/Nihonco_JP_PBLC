/* 设置窗口：资源区（模型 / Core / VOICEVOX）
 * 独立成文件，避免继续堆进 settings/app.js；用 IIFE 避免和 settings/app.js 的顶层声明冲突。
 */
(function () {
  const $ = (id) => document.getElementById(id);

  async function loadAssets() {
    try {
      const r = await window.cfg.assetStatus();
      const set = (id, ok, rel, full) => {
        const el = $(id);
        if (!el) return;
        const prefix = id === "statVoice" ? "VOICEVOX" : (id === "statAivis" ? "AivisSpeech" : "");
        if (prefix) {
          el.textContent = `${prefix} ${ok ? "已找到" : "未找到"}`;
        } else {
          el.textContent = rel
            ? (ok ? `已找到 · ${rel}` : `未找到 · 放到 ${rel}`)
            : (ok ? "已找到" : "未找到");
        }
        el.style.color = ok ? "var(--ok, #7ee2a8)" : "var(--text-dim)";
        el.dataset.open = ok ? ({ statModel: "model", statCore: "core", statVoice: "voicevox", statAivis: "aivis" }[id] || "") : "";
        el.classList.toggle("asset-link", !!ok);
        el.tabIndex = ok ? 0 : -1;
        el.setAttribute("role", ok ? "button" : "text");
        if (ok) el.title = `点击打开目录${full ? "\n" + full : ""}`;
        else if (full) el.title = full;
        else el.removeAttribute("title");
      };
      set("statModel", !!(r && r.model), (r && r.modelRel) || "model/Hiyori/", r && r.paths && r.paths.model);
      set("statCore", !!(r && r.core), "lib/live2dcubismcore.min.js", r && r.paths && r.paths.core);
      set("statVoice", !!(r && r.voicevox), "", r && r.paths && r.paths.voicevox);
      set("statAivis", !!(r && r.aivis), "", r && r.paths && r.paths.aivis);
      paintAssetPath(r);
      paintEnginePath(r);
    } catch (e) {
      for (const id of ["statModel", "statCore", "statVoice", "statAivis"]) {
        const el = $(id);
        if (el) el.textContent = "—";
      }
    }
  }

  function showInstallPanel(plans, errors) {
    return new Promise((resolve) => {
      const panel = $("assetInstallPanel");
      const list = $("assetInstallList");
      const errBox = $("assetInstallErrors");
      list.innerHTML = "";
      for (const p of plans) {
        const row = document.createElement("label");
        row.className = "asset-install-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.value = String(plans.indexOf(p));
        const text = document.createElement("span");
        text.innerHTML = `<b>${p.exists ? "覆盖" : "新增"} ${p.label}</b><div class="path"></div>`;
        text.querySelector(".path").textContent = p.target;
        row.append(cb, text);
        list.appendChild(row);
      }
      errBox.textContent = errors.length ? "无法识别：\n" + errors.join("\n") : "";
      panel.hidden = false;
      panel.scrollIntoView({ block: "nearest" });

      const confirmBtn = $("assetInstallConfirm");
      const cancelBtn = $("assetInstallCancel");
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      const cleanup = () => { panel.hidden = true; confirmBtn.onclick = null; cancelBtn.onclick = null; };
      confirmBtn.onclick = () => {
        const checked = [...list.querySelectorAll("input:checked")].map((x) => plans[Number(x.value)]);
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        list.querySelectorAll("input").forEach((x) => { x.disabled = true; });
        $("assetInstallProgress").textContent = "";
        resolve(checked.length ? checked : null);
      };
      cancelBtn.onclick = () => { cleanup(); resolve(null); };
    });
  }

  function bindAssets() {
    const links = { dlModel: "model", dlCore: "core", dlVoice: "voicevox", dlAivis: "aivis" };
    for (const [id, key] of Object.entries(links)) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener("click", () => {
        if (window.cfg && window.cfg.openResource) window.cfg.openResource(key).catch(() => {});
      });
    }
    const section = $("assetDropZone");
    if (section) {
      section.addEventListener("dragover", (e) => { e.preventDefault(); section.classList.add("dragover"); });
      section.addEventListener("dragleave", (e) => {
        if (!section.contains(e.relatedTarget)) section.classList.remove("dragover");
      });
      section.addEventListener("drop", async (e) => {
        e.preventDefault();
        section.classList.remove("dragover");
        const files = [...(e.dataTransfer.files || [])];
        if (!files.length) return;

        window.SettingsApp.flash(`识别 ${files.length} 个文件…`, 0);
        const plans = [];
        const errors = [];
        for (const file of files) {
          try {
            const src = window.cfg.filePath(file);
            if (!src) throw new Error("拿不到本地路径");
            const p = await window.cfg.previewAsset({ src });
            if (!p || !p.ok) throw new Error((p && p.error) || "识别失败");
            plans.push({ ...p, src, name: file.name });
          } catch (err) {
            errors.push(`${file.name}：${err.message || err}`);
          }
        }

        if (!plans.length) {
          const msg = "没有可安装的文件：\n" + errors.join("\n");
          window.SettingsApp.flash("没有可安装的文件", 4000);
          alert(msg);
          return;
        }

        const selected = await showInstallPanel(plans, errors);
        if (!selected) {
          window.SettingsApp.flash("已取消");
          return;
        }

        let installed = 0;
        const warnings = [];
        const progress = $("assetInstallProgress");
        for (let i = 0; i < selected.length; i++) {
          const p = selected[i];
          progress.textContent = `安装中 ${i + 1}/${selected.length}：${p.name}`;
          try {
            const r = await window.cfg.installAsset({ kind: p.kind, src: p.src });
            if (!r || !r.ok) throw new Error((r && r.error) || "安装失败");
            installed++;
            if (r.health && r.health.ready === false) warnings.push(`${p.name}：${r.health.warning || "正在加载"}`);
          } catch (err) {
            errors.push(`${p.name}：${err.message || err}`);
          }
        }
        progress.textContent = `完成：成功 ${installed} 项` + (errors.length ? `，失败 ${errors.length} 项` : "");
        await loadAssets();
        window.SettingsApp.flash(`已安装 ${installed} 项` + (errors.length ? `，${errors.length} 项失败` : ""), 5000);
        if (errors.length) alert(`安装完成：成功 ${installed} 项\n\n未安装：\n` + errors.join("\n") + (warnings.length ? `\n\n正在加载：\n` + warnings.join("\n") : ""));
        else if (warnings.length) alert(`已安装 ${installed} 项\n\n正在加载：\n` + warnings.join("\n"));
        else alert(`安装成功：${installed} 项`);
        $("assetInstallPanel").hidden = true;
      });
    }

    const restart = $("restartApp");
    if (restart) restart.addEventListener("click", async () => {
      if (!confirm("重启 Nihonco？当前窗口会关闭。")) return;
      try { await window.cfg.restartApp(); } catch (e) {
        window.SettingsApp.flash("重启失败：" + (e.message || e), 4000);
        alert("重启失败：" + (e.message || e));
      }
    });

    const openAssets = $("openAssets");
    if (openAssets) openAssets.addEventListener("click", () => window.cfg.openPath("assets").catch(() => {}));

    // 绿色「已找到」状态本身也是入口：点路径 = 打开所在目录
    for (const id of ["statModel", "statCore", "statVoice", "statAivis"]) {
      const el = $(id);
      if (!el) continue;
      const open = () => {
        const key = el.dataset.open;
        if (key && window.cfg && window.cfg.openPath) window.cfg.openPath(key).catch(() => {});
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    }
  }

  function paintEnginePath(r) {
    const set = (id, p) => {
      const el = $(id);
      if (!el) return;
      el.textContent = p || "未设置路径";
      if (p) el.title = p;
      else el.removeAttribute("title");
    };
    set("voicevoxPath", r && r.paths && r.paths.voicevox);
    set("aivisPath", r && r.paths && r.paths.aivis);
  }

  function paintAssetPath(r) {
    const el = $("dirAssets");
    if (!el) return;
    const p = r && r.dirs && r.dirs.assets;
    el.textContent = p || "未找到";
    if (p) el.title = p;
    else el.removeAttribute("title");
  }

  window.SettingsApp.register("assets", { init: async () => { bindAssets(); await loadAssets(); }, reload: loadAssets });
})();
