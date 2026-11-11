/* 设置窗口：数据概况、备份、也算对记录（独立 IIFE） */
(function () {
  const $ = (id) => document.getElementById(id);

  async function refreshDataInfo() {
    const el = $("dataInfo");
    if (!el) return;
    try {
      const d = await window.cfg.dataInfo();
      el.textContent = d.ok
        ? `单词 ${d.words} 个（错题 ${d.wrongWords}） · 句型 ${d.patterns} 个（错题 ${d.wrongPatterns}） · 备份 ${d.backupCount} 份`
        : "读不到数据目录";
      fillBackupList(d && d.backups);
    } catch (e) {
      el.textContent = "读不到数据目录";
    }
  }

  function fillBackupList(backups) {
    const sel = $("backupList");
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = "";
    const list = (backups || []).slice(0, 7);
    if (!list.length) {
      const o = document.createElement("option");
      o.textContent = "（还没有备份）";
      o.value = "";
      sel.appendChild(o);
      return;
    }
    for (const b of list) {
      const o = document.createElement("option");
      o.value = b.file;
      const t = String(b.mtime || "").replace("T", " ").slice(0, 19);
      o.textContent = `${t} · ${b.file.replace(/^before-/, "").replace(/-\d{8}-\d+.*$/, "")} · ${Math.round((b.size || 0) / 1024)}KB`;
      sel.appendChild(o);
    }
    if (cur) sel.value = cur;
  }

  let altsCache = [];

  async function loadAlts() {
    try { const r = await window.cfg.altsList(); altsCache = (r && r.list) || []; } catch (e) { altsCache = []; }
    const count = $("altsCount");
    if (count) count.textContent = altsCache.length ? `${altsCache.length} 个词` : "—";
    renderAlts();
  }

  function renderAlts() {
    const wrap = $("altsList");
    const empty = $("altsEmpty");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!altsCache.length) { if (empty) empty.style.display = ""; return; }
    if (empty) empty.style.display = "none";

    for (const item of altsCache) {
      const row = document.createElement("div");
      row.className = "alts-item";

      const word = document.createElement("span");
      word.className = "alts-word";
      word.textContent = item.ja + (item.kana && item.kana !== item.ja ? `（${item.kana}）` : "");
      row.appendChild(word);

      for (const alt of item.alts) {
        const chip = document.createElement("span");
        chip.className = "alts-chip";
        chip.textContent = alt;
        const x = document.createElement("button");
        x.textContent = "×";
        x.title = "删除这条写法";
        x.addEventListener("click", async () => {
          const r = await window.cfg.altsRemove({ ja: item.ja, alt });
          if (r && r.ok) loadAlts();
          else flash((r && r.error) || "删除失败");
        });
        chip.appendChild(x);
        row.appendChild(chip);
      }

      const inp = document.createElement("input");
      inp.className = "alts-add";
      inp.placeholder = "添加写法";
      inp.spellcheck = false;
      const add = document.createElement("button");
      add.textContent = "＋";
      const doAdd = async () => {
        const v = inp.value.trim();
        if (!v) return;
        const r = await window.cfg.altsSet({ ja: item.ja, alts: [...item.alts, v] });
        if (r && r.ok) { inp.value = ""; loadAlts(); }
        else flash((r && r.error) || "添加失败");
      };
      add.addEventListener("click", doAdd);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
      row.append(inp, add);
      wrap.appendChild(row);
    }
  }

  function bindDataButtons() {
    const open = $("openData");
    if (open) open.addEventListener("click", () => window.cfg.openPath("data").catch(() => {}));
    if (window.cfg && window.cfg.assetStatus) {
      window.cfg.assetStatus().then((r) => {
        const dir = $("dirData");
        const p = r && r.dirs && r.dirs.data;
        if (dir) { dir.textContent = p || "未找到"; if (p) dir.title = p; }
      }).catch(() => {});
    }
  }

  function bindAlts() {
    const btn = $("altsManage");
    const panel = $("altsPanel");
    if (!btn || !panel) return;
    btn.addEventListener("click", async () => {
      const show = panel.style.display === "none";
      panel.style.display = show ? "" : "none";
      btn.textContent = show ? "收起" : "管理…";
      if (show) await loadAlts();
    });
  }

  window.SettingsApp.register("data", { init: async () => { refreshDataInfo(); bindDataButtons(); bindAlts(); await loadAlts(); }, refresh: refreshDataInfo });
})();
