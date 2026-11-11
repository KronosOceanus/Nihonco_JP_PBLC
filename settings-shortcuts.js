/* 设置窗口：快捷键改键（独立 IIFE，避免和 settings.js 顶层重名） */
(function () {
  const $ = (id) => document.getElementById(id);

  const SHORTCUT_SCOPE_NAME = { global: "全局（不聚焦也能用）", local: "桌宠窗口内" };

  /** KeyboardEvent → Electron accelerator 的按键名（按物理键取，避免输入法干扰） */
  function keyToken(e) {
    const c = e.code || "";
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^F([1-9]|1[0-2])$/.test(c)) return c;
    const map = {
      Space: "Space", Tab: "Tab", Escape: "Escape", Enter: "Enter", Backspace: "Backspace",
      Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
      ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
      Backquote: "Backquote", Minus: "Minus", Equal: "Equal", BracketLeft: "BracketLeft",
      BracketRight: "BracketRight", Backslash: "Backslash", Semicolon: "Semicolon",
      Quote: "Quote", Comma: "Comma", Period: "Period", Slash: "Slash",
    };
    return map[c] || "";
  }

  /** 从键盘事件拼出快捷键字符串（macOS 的 ⌘ 统一写成 CommandOrControl） */
  function accelFromEvent(e) {
    const key = keyToken(e);
    if (!key) return "";
    const mods = [];
    if (e.metaKey) mods.push("CommandOrControl");
    if (e.ctrlKey) mods.push("Control");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    return [...mods, key].join("+");
  }

  const IS_MAC_UI = navigator.userAgent.includes("Mac OS");

  function prettyAccel(accel) {
    let t = String(accel || "—");
    t = t.replace(/CommandOrControl/g, IS_MAC_UI ? "⌘" : "Ctrl");
    t = t.replace(/Control/g, IS_MAC_UI ? "⌃" : "Ctrl");
    t = t.replace(/Alt/g, IS_MAC_UI ? "⌥" : "Alt");
    t = t.replace(/Shift/g, IS_MAC_UI ? "⇧" : "Shift");
    return t.replace(/\+/g, " + ");
  }

  let capturing = null;        // { scope, id, btn, codeEl }

  async function renderShortcuts() {
    const cols = {
      global: document.querySelector('#shortcutCols .sc-col[data-scope="global"]'),
      local: document.querySelector('#shortcutCols .sc-col[data-scope="local"]'),
    };
    if (!cols.global || !cols.local) return;

    let r;
    try { r = await window.cfg.shortcuts(); } catch (e) { return; }
    if (!r || !r.ok) return;

    const toggle = $("shortcutToggle");
    if (toggle) {
      const hint = $("shortcutHint");
      if (hint) {
        hint.style.paddingLeft = "0px";
        const dx = toggle.getBoundingClientRect().left - hint.getBoundingClientRect().left;
        if (dx > 0) hint.style.paddingLeft = Math.round(dx) + "px";
      }
      const on = r.enabled !== false;
      toggle.textContent = on ? "已开启" : "已关闭";
      toggle.style.color = on ? "" : "var(--text-dim)";
      toggle.dataset.on = on ? "1" : "0";
    }

    for (const scope of ["global", "local"]) {
      const col = cols[scope];
      col.innerHTML = "";

      const head = document.createElement("div");
      head.className = "sc-head";
      head.textContent = SHORTCUT_SCOPE_NAME[scope];
      col.appendChild(head);

      for (const row of r.rows.filter((x) => x.scope === scope)) {
        const div = document.createElement("div");
        div.className = "row";
        const label = document.createElement("label");
        label.textContent = row.label;
        const code = document.createElement("span");
        code.className = "pill";
        code.textContent = prettyAccel(row.accel);
        if (row.occupied) {
          code.style.color = "#ff8a8a";
          code.title = "被其它应用占用：点「改键」换一个";
        }
        const btn = document.createElement("button");
        btn.textContent = "改键";
        btn.dataset.scope = scope;
        btn.dataset.id = row.id;
        btn.addEventListener("click", () => startCapture(scope, row.id, btn, code));
        div.append(label, code, btn);
        col.appendChild(div);

        if (scope === "global" && row.id === "record") {
          const row2 = document.createElement("div");
          row2.className = "row";
          const l2 = document.createElement("label");
          l2.textContent = "自动结束录音";
          const inp = document.createElement("input");
          inp.type = "number";
          inp.id = "autoStopSec";
          inp.min = "1";
          inp.max = "5";
          inp.step = "0.1";
          inp.style.width = "64px";
          inp.value = String(r.autoStopSec ?? 1.2);
          const unit = document.createElement("span");
          unit.className = "mini";
          unit.style.marginLeft = "4px";
          unit.textContent = "秒";
          const wrap = document.createElement("span");
          wrap.style.display = "inline-flex";
          wrap.style.alignItems = "center";
          wrap.style.gap = "4px";
          wrap.style.marginRight = "auto";
          wrap.append(inp, unit);
          inp.addEventListener("change", async () => {
            const res = await window.cfg.setAutoStop(Number(inp.value));
            if (res && res.ok) {
              inp.value = String(res.autoStopSec);
              msg(`自动结束录音：${res.autoStopSec} 秒`);
            } else {
              msg("设置失败");
            }
          });
          row2.append(l2, wrap);
          col.appendChild(row2);
        }
      }
    }
  }

  function startCapture(scope, id, btn, codeEl) {
    capturing = { scope, id, btn, codeEl };
    btn.textContent = "按新键…";
    codeEl.textContent = "…";
    msg("按下组合键（Esc 取消）");
  }

  function msg(text, ms = 4000) {
    const el = $("shortcutMsg");
    if (!el) return;
    el.textContent = text;
    if (ms) setTimeout(() => { if (el.textContent === text) el.textContent = "—"; }, ms);
  }

  async function finishCapture(accel) {
    const c = capturing;
    capturing = null;
    if (!c) return;
    c.btn.textContent = "改键";
    const r = await window.cfg.setShortcut({ scope: c.scope, id: c.id, accel });
    if (!r || !r.ok) {
      msg("没改成：" + ((r && r.error) || "未知错误"));
      c.codeEl.textContent = prettyAccel(window.__lastShortcutPick || "—");
      await renderShortcuts();
      return;
    }
    msg(c.scope === "global" && r.failed && r.failed.length ? "已保存，但这个键被别的应用占用了" : "已保存");
    await renderShortcuts();
    if (r.failed && r.failed.length) console.log("[shortcut] 注册失败", r.failed);
  }

  document.addEventListener("keydown", (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      const c = capturing;
      capturing = null;
      c.btn.textContent = "改键";
      c.codeEl.textContent = "—";
      msg("已取消");
      renderShortcuts();
      return;
    }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    const accel = capturing.scope === "local" ? keyToken(e) : accelFromEvent(e);
    if (!accel) { msg("这个键不支持"); return; }
    window.__lastShortcutPick = accel;
    finishCapture(accel);
  });

  window.addEventListener("load", () => {
    renderShortcuts();
    const toggle = $("shortcutToggle");
    if (toggle) toggle.addEventListener("click", async () => {
      const want = toggle.dataset.on !== "1";
      const r = await window.cfg.setShortcutsEnabled(want);
      msg(r && r.ok ? (want ? "快捷键已开启" : "快捷键已关闭") : "切换失败");
      renderShortcuts();
    });
    const reset = $("shortcutReset");
    if (reset) reset.addEventListener("click", async () => {
      const r = await window.cfg.resetShortcuts();
      msg(r && r.ok ? "已恢复默认" : "恢复失败");
      renderShortcuts();
    });
  });
})();
