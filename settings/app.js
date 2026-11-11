/* 设置窗口：初始化 / 保存 / 关闭，其它逻辑由 SettingsApp 注册模块负责 */
const App = window.SettingsApp;

function readForm() {
  return { voice: App.module("tts").readVoice() };
}

async function save() {
  try {
    const cfg = await window.cfg.set(readForm());
    App.render(cfg);
    App.flash("已保存");
  } catch (e) {
    App.flash("保存失败：" + e.message);
  }
}

async function init() {
  try {
    App.render(await window.cfg.get());
  } catch (e) {
    App.flash("读取失败：" + e.message);
  }

  for (const m of App.modules) {
    try { await m.init?.(); } catch (e) { console.error(`[settings] ${m.name}.init`, e); }
  }

  App.$("save").addEventListener("click", async () => {
    await save();
    App.flash("已保存");
  });
  App.$("close").addEventListener("click", () => window.cfg.close());
}

init();
