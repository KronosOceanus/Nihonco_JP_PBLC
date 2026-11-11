/* 设置窗口核心：DOM 工具 + 模块注册表 */
(function () {
  const app = {
    modules: [],
    register(name, mod) {
      if (!name || !mod) return;
      this.modules.push({ name, ...mod });
    },
    module(name) {
      return this.modules.find((m) => m.name === name) || null;
    },
    $(id) { return document.getElementById(id); },
    cfg: null,
    flash(text, ms = 2200) {
      const el = this.$("status");
      if (!el) return;
      el.textContent = text;
      clearTimeout(this._flashTimer);
      if (ms) this._flashTimer = setTimeout(() => (el.textContent = ""), ms);
    },
    render(cfg) {
      this.cfg = cfg;
      for (const m of this.modules) {
        try { m.render?.(cfg); } catch (e) { console.error(`[settings] ${m.name}.render`, e); }
      }
    },
  };
  window.SettingsApp = app;
})();
