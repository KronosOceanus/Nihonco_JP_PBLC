/* 设置窗口：轻量人格记忆的查看 / 编辑 / 删除。
 * 只展示 profile / relation / episodes，不展示聊天原文。
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const ARR = ["interests", "goals", "preferences", "boundaries"];
  const LABEL = {
    nickname: "称呼", nickname_reading: "称呼读音", level: "等级",
    interests: "喜欢", goals: "目标", preferences: "偏好", boundaries: "边界",
  };

  let data = null;
  let bound = false;

  function flash(msg) {
    if (typeof window.__settingsFlash === "function") return window.__settingsFlash(msg);
    const st = $("status");
    if (st) { st.textContent = msg || ""; setTimeout(() => { if (st.textContent === (msg || "")) st.textContent = ""; }, 2500); }
  }

  function countProfile(d) {
    const p = d && d.profile || {};
    return ARR.reduce((n, k) => n + (Array.isArray(p[k]) ? p[k].length : 0), 0)
      + (p.nickname ? 1 : 0) + (p.nickname_reading ? 1 : 0) + (p.level ? 1 : 0);
  }

  function paintCount(d) {
    const el = $("memoryCount");
    if (!el) return;
    el.textContent = d ? `${countProfile(d)} 条资料 · ${(d.episodes || []).length} 段经历` : "—";
  }

  function row(label, node) {
    const div = document.createElement("div");
    div.className = "mem-row";
    const k = document.createElement("span");
    k.className = "mem-key";
    k.textContent = label;
    div.append(k, node);
    return div;
  }

  function chip(text, onDelete) {
    const span = document.createElement("span");
    span.className = "mem-chip";
    span.textContent = text;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "×";
    b.title = "删除";
    b.addEventListener("click", onDelete);
    span.appendChild(b);
    return span;
  }

  function patch(p) {
    return window.cfg.memoryPatch(p).then((r) => {
      if (!r || !r.ok) { flash((r && r.error) || "保存失败"); return; }
      data = r.data;
      render();
    }).catch((e) => flash("保存失败：" + e.message));
  }

  function renderProfile() {
    const wrap = $("memoryProfile");
    if (!wrap || !data) return;
    wrap.innerHTML = "";
    const head = document.createElement("div");
    head.className = "mem-head";
    head.textContent = "资料卡";
    wrap.appendChild(head);

    for (const key of ["nickname", "nickname_reading", "level"]) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = data.profile[key] || "";
      inp.placeholder = key === "level" ? "N4" : key === "nickname_reading" ? "ももいとう" : "";
      inp.style.flex = "1";
      inp.addEventListener("change", () => patch({ op: "update", type: "profile", key, value: inp.value.trim() }));
      wrap.appendChild(row(LABEL[key], inp));
    }

    for (const key of ARR) {
      const group = document.createElement("div");
      group.className = "mem-group";
      const list = document.createElement("div");
      list.className = "mem-row";
      const k = document.createElement("span");
      k.className = "mem-key";
      k.textContent = LABEL[key];
      list.appendChild(k);
      for (const v of data.profile[key] || []) {
        list.appendChild(chip(v, () => patch({ op: "delete", type: "profile", key, value: v })));
      }
      group.appendChild(list);

      const addRow = document.createElement("div");
      addRow.className = "mem-row";
      addRow.style.marginLeft = "52px";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "mem-add";
      inp.placeholder = "添加…";
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "＋";
      const doAdd = () => {
        const v = inp.value.trim();
        if (!v) return;
        patch({ op: "add", type: "profile", key, value: v });
      };
      add.addEventListener("click", doAdd);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
      addRow.append(inp, add);
      group.appendChild(addRow);
      wrap.appendChild(group);
    }
  }

  function renderRelation() {
    const wrap = $("memoryRelation");
    if (!wrap || !data) return;
    wrap.innerHTML = "";
    const head = document.createElement("div");
    head.className = "mem-head";
    head.textContent = "关系";
    wrap.appendChild(head);

    const sel = document.createElement("select");
    for (let i = 0; i <= 5; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${i} / 5`;
      sel.appendChild(o);
    }
    sel.value = String(data.relation.familiarity || 0);
    sel.style.maxWidth = "120px";
    sel.addEventListener("change", () => patch({ op: "update", type: "relation", key: "familiarity", value: Number(sel.value) }));
    wrap.appendChild(row("熟悉度", sel));

    const note = document.createElement("input");
    note.type = "text";
    note.value = data.relation.note || "";
    note.placeholder = "例如：可以轻轻吐槽，但不要攻击学习能力";
    note.style.flex = "1";
    note.addEventListener("change", () => patch({ op: "update", type: "relation", key: "note", value: note.value.trim() }));
    wrap.appendChild(row("备注", note));
  }

  function renderEpisodes() {
    const wrap = $("memoryEpisodes");
    if (!wrap || !data) return;
    wrap.innerHTML = "";
    const head = document.createElement("div");
    head.className = "mem-head";
    head.textContent = "最近经历";
    wrap.appendChild(head);

    if (!(data.episodes || []).length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.style.margin = "4px 0";
      empty.textContent = "还没有长期经历记录。";
      wrap.appendChild(empty);
      return;
    }

    for (const e of data.episodes) {
      const item = document.createElement("div");
      item.className = "mem-ep";
      const meta = document.createElement("div");
      meta.className = "mem-ep-meta";
      meta.textContent = [e.at, e.topic].filter(Boolean).join(" · ");
      const sum = document.createElement("div");
      sum.className = "mem-ep-summary";
      sum.textContent = e.summary;
      const tags = document.createElement("div");
      tags.className = "mem-ep-tags";
      tags.textContent = (e.tags || []).map((t) => `#${t}`).join(" ");
      const actions = document.createElement("div");
      actions.className = "mem-ep-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "编辑";
      edit.addEventListener("click", () => {
        const next = window.prompt("修改这段经历", e.summary);
        if (next == null) return;
        const v = next.trim();
        if (v && v !== e.summary) patch({ op: "update", type: "episode", id: e.id, data: { summary: v } });
      });
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "删除";
      del.addEventListener("click", () => {
        if (!window.confirm("删除这段经历？")) return;
        patch({ op: "delete", type: "episode", id: e.id });
      });
      actions.append(edit, del);
      item.append(meta, sum, tags, actions);
      wrap.appendChild(item);
    }
  }

  function render() {
    paintCount(data);
    renderProfile();
    renderRelation();
    renderEpisodes();
  }

  async function load() {
    try {
      const r = await window.cfg.memoryGet();
      data = (r && r.data) || null;
      paintCount(data);
      if ($("memoryPanel") && $("memoryPanel").style.display !== "none") render();
    } catch (e) {
      flash("读取记忆失败：" + e.message);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const btn = $("memoryManage");
    const panel = $("memoryPanel");
    if (btn && panel) {
      btn.addEventListener("click", async () => {
        const show = panel.style.display === "none";
        panel.style.display = show ? "" : "none";
        btn.textContent = show ? "收起" : "管理…";
        if (show) { await load(); render(); }
      });
    }
    const clear = $("memoryClear");
    if (clear) {
      clear.addEventListener("click", async () => {
        if (!window.confirm("清空全部长期记忆？这不会删除学习数据。")) return;
        const r = await window.cfg.memoryClear();
        if (!r || !r.ok) return flash((r && r.error) || "清空失败");
        data = r.data;
        render();
      });
    }
    load();
  }

  window.SettingsApp.register("memory", { init: async () => { bind(); await load(); }, render });
})();
