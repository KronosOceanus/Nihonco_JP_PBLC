/* 数据管理通道（设置窗口）：导出/导入/恢复/清空 + 「也算对」记录
 *
 * 写闸只在这里：自动化钩子（PET_*）在场时默认禁止改真实学习数据。
 */
module.exports = function registerDataIpc({ settingsHandle, getSettingsWin, getWin, app, dialog, backup, config, ROOT }) {
  const fs = require('fs');
  const path = require('path');

  // 普通用户调参项，不算自动化钩子
  const USER_TUNING = /^PET_(LEVEL|DEBUG|VOICE|VOICE_JA|RATE|RATE_JA|ZOOM|FX|FY)$/;
  const automated = () =>
    Object.keys(process.env).some((k) => k.startsWith('PET_') && !USER_TUNING.test(k));
  const dataDirIsRepo = () => {
    const d = process.env.NIHONCO_DATA_DIR || path.join(ROOT, 'data');
    try { return path.resolve(d) === path.resolve(path.join(ROOT, 'data')); } catch (e) { return true; }
  };
  const dataWriteAllowed = () =>
    !automated() ||
    (process.env.NIHONCO_ALLOW_DATA_WRITE === '1' && !dataDirIsRepo());
  const denyWrite = () => ({ ok: false, error: '自动化运行时禁止改动学习数据（设置 NIHONCO_ALLOW_DATA_WRITE=1 才允许）' });
  const changed = () => { try { getWin()?.webContents.send('cfg:changed', config.get()); } catch (_) {} };

  settingsHandle('cfg:data-info', (e) => {
    return backup.info();
  });

  settingsHandle('cfg:data-export', async (e) => {
    const r = await dialog.showSaveDialog(getSettingsWin(), {
      title: '导出学习数据',
      defaultPath: path.join(app.getPath('downloads'), `nihonco-data-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const out = backup.exportAll();
    fs.writeFileSync(r.filePath, JSON.stringify(out.body, null, 2), 'utf8');
    backup.snapshot('before-export');
    return { ok: true, path: r.filePath };
  });

  settingsHandle('cfg:data-import', async (e) => {
    if (!dataWriteAllowed()) return denyWrite();
    const r = await dialog.showOpenDialog(getSettingsWin(), {
      title: '导入学习数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    try {
      const body = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const res = backup.importAll(body);
      if (res.ok) changed();
      return res;
    } catch (err) {
      return { ok: false, error: '文件读不出来：' + err.message };
    }
  });

  settingsHandle('cfg:data-restore', (e, file) => {
    if (!dataWriteAllowed()) return denyWrite();
    const res = backup.restoreBackup(file);
    if (res.ok) changed();
    return res;
  });

  settingsHandle('cfg:alts-list', (e) => {
    return { ok: true, list: require('../../agent/wordbook').listAlts() };
  });

  settingsHandle('cfg:alts-remove', (e, { ja, alt } = {}) => {
    return require('../../agent/wordbook').removeAlt(ja, alt);
  });

  settingsHandle('cfg:alts-set', (e, { ja, alts } = {}) => {
    return require('../../agent/wordbook').setAlts(ja, alts);
  });

  // 轻量人格记忆：设置页查看/编辑/删除
  const memStore = () => {
    const { createMemory } = require('../../agent/memory');
    const m = createMemory();
    m.load();
    return m;
  };

  settingsHandle('cfg:memory-get', () => {
    const m = memStore();
    return { ok: true, data: m.snapshot() };
  });

  settingsHandle('cfg:memory-patch', (e, patch = []) => {
    if (!dataWriteAllowed()) return denyWrite();
    try {
      const r = memStore().patch(patch);
      return { ok: true, data: r.data, applied: r.applied, evicted: r.evicted };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  settingsHandle('cfg:memory-clear', () => {
    if (!dataWriteAllowed()) return denyWrite();
    try {
      const data = memStore().clear();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  settingsHandle('cfg:data-reset', (e, scope = 'all') => {
    if (!dataWriteAllowed()) return denyWrite();
    const res = scope === 'level' ? backup.resetLevel() : backup.resetAll();
    if (res.ok) changed();
    return res;
  });
};
