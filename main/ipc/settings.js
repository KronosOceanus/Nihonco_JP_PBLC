/* 设置窗口 IPC 装配：config / 快捷键 / TTS+ASR / 数据 / 窗口大小 / 关闭 */
module.exports = function registerSettingsIpc({
  settingsHandle, settingsOn, getWin, getSettingsWin, app, dialog, backup, config,
  ROOT, ASSET_DIR, USER_DATA, DATA_DIR, getPetSize, setPetSize,
  refreshVoiceCache, loadPet, isPackaged, shell, voiceSvc, tts,
  registerShortcuts, shortcutFailures, ensureTtsEngine, speakToWav,
  asrBackends, restartAsr, stopAsr, asrGpu, asrLog, asrSvc, agent, platform,
}) {

  require('./config')({
    settingsHandle, getWin, config, agent, refreshVoiceCache, loadPet,
    app, isPackaged, shell, dialog, voiceSvc, tts, asrSvc, ensureTtsEngine, restartAsr, platform, ROOT, ASSET_DIR, USER_DATA, DATA_DIR,
  });

  settingsHandle('cfg:pet-size', () => {
    const ws = require('../../agent/window-size');
    return { ...(getPetSize() || ws.DEFAULT), default: ws.DEFAULT };
  });

  settingsHandle('cfg:set-pet-size', (e, { w, h } = {}) => {
    return setPetSize(w, h) || { ok: false };
  });

  require('./shortcuts')({ settingsHandle, getWin, registerShortcuts, shortcutFailures });

  require('./audio')({
    settingsHandle, getWin, tts, config, refreshVoiceCache, ensureTtsEngine, speakToWav,
    app, asrBackends, restartAsr, stopAsr, asrGpu, asrLog,
  });

  require('./data')({ settingsHandle, getSettingsWin, getWin, app, dialog, backup, config, ROOT });

  settingsHandle('cfg:restart', () => {
    const args = process.argv.slice(1);
    console.log('[app] relaunch', { execPath: process.execPath, args });
    app.relaunch({ execPath: process.execPath, args });
    setTimeout(() => app.exit(0), 300);
    return { ok: true };
  });

  settingsOn('cfg:close', () => getSettingsWin()?.close());
};
