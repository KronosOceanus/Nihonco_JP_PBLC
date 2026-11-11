/* 主进程 IPC：桌宠窗口 / 设置窗口的全部通道
 *
 * 依赖全部通过 ctx 注入（getter 形式），模块本身不持有窗口或全局状态。
 * 约定：设置窗口的 cfg:* 必须校验 sender；桌宠窗口的 pet:* 也校验来源。
 */
const fs = require("fs");
const path = require("path");
const appLog = require("../agent/app-log");
const langGuard = require("../agent/lang-guard");

module.exports = function createIpc(ctx) {
  const {
    ipcMain, app, shell, dialog, platform,
    getWin, getSettingsWin, agent, config, backup, tts, voiceCache,
    asrSvc, voiceSvc, asrBackends, asrLog, asrGpu, registerShortcuts, shortcutFailures,
    petResize, petResizeEnd, getPetSize, setPetSize,
    startAsr, restartAsr, stopAsr, ensureAsr, speakToWav, prewarmPrompts, refreshVoiceCache, ensureTtsEngine,
    openSettings, loadPet, getLevelIdle, getPassThrough, isPackaged,
    menus, setPassThrough,
    ROOT, DATA_DIR, VOICE_DIR,
  } = ctx;

  let ipcReady = false;

  // 统一给 IPC 加一层错误日志：Electron 只会把错误打到 stderr（打包版看不到）
  const ipcHandle = (ch, fn) => ipcMain.handle(ch, async (e, ...args) => {
    try { return await fn(e, ...args); } catch (err) { appLog.write("error", [`[ipc] ${ch}`, err]); throw err; }
  });
  const ipcOn = (ch, fn) => ipcMain.on(ch, (e, ...args) => {
    try { fn(e, ...args); } catch (err) { appLog.write("error", [`[ipc:on] ${ch}`, err]); }
  });

  /* ---- 桌宠窗口通道：统一 fromPet 守卫（与设置侧的 fromSettings 对称） ---- */
  const fromPet = (e) => !!getWin() && e.sender === getWin().webContents;
  const assertPet = (e) => { if (!fromPet(e)) throw new Error('forbidden'); };
  const petHandle = (ch, fn) => ipcHandle(ch, (e, ...args) => { assertPet(e); return fn(...args); });
  const petOn = (ch, fn) => ipcOn(ch, (e, ...args) => { if (!fromPet(e)) return console.log(`[ipc] 忽略非桌宠窗口的 ${ch}`); fn(...args); });


  function registerIpcOnce() {

  if (ipcReady) return;
  ipcReady = true;

  /* ---- 设置窗口专用 IPC（用 sender 校验，桌宠窗口调不到） ---- */
  const fromSettings = (e) => !!getSettingsWin() && e.sender === getSettingsWin().webContents;

  // 设置窗口通道：注册 + sender 校验一次完成（与 petHandle/fromPet 对称）
  const settingsHandle = (ch, fn) => ipcHandle(ch, (e, ...args) => {
    if (!fromSettings(e)) throw new Error('forbidden');
    return fn(e, ...args);
  });
  const settingsOn = (ch, fn) => ipcOn(ch, (e, ...args) => {
    if (!fromSettings(e)) return console.log(`[ipc] 忽略非设置窗口的 ${ch}`);
    fn(...args);
  });

  require('./ipc/settings')({
    settingsHandle, settingsOn, getWin, getSettingsWin, app, dialog, backup, config,
    agent, refreshVoiceCache, loadPet, isPackaged, shell, voiceSvc, tts, ROOT, DATA_DIR,
    getPetSize, setPetSize, registerShortcuts, shortcutFailures, ensureTtsEngine, speakToWav,
    asrBackends, restartAsr, stopAsr, asrGpu, asrLog, asrSvc, platform,
  });

  require('./ipc/pet')({
    petHandle, petOn, app, agent, tts, voiceCache, asrSvc, voiceSvc, asrLog, platform,
    ensureAsr, restartAsr, speakToWav, getWin, getLevelIdle, menus, setPassThrough,
    openSettings, petResize, petResizeEnd, VOICE_DIR,
  });

  app.on('activate', () => {
    if (getWin()) getWin().showInactive();
  });

  }

  return { registerIpcOnce };
};
