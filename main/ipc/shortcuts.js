/* 快捷键设置通道：cfg:shortcuts*
 * 只依赖注册器/守卫/重注册函数，由 main/ipc.js 注入。
 */
module.exports = function registerShortcutIpc({ settingsHandle, getWin, registerShortcuts, shortcutFailures }) {
  const shortcuts = () => require('../../agent/shortcuts');

  settingsHandle('cfg:shortcuts', (e) => {
    const info = shortcuts().info();
    const failed = typeof shortcutFailures === 'function' ? shortcutFailures() : [];
    info.rows = info.rows.map((r) => ({
      ...r,
      occupied: failed.some((f) => f.id === r.id && f.accel === r.accel),
    }));
    return info;
  });

  settingsHandle('cfg:set-shortcut', (e, { scope, id, accel } = {}) => {
    const r = shortcuts().set(scope, id, accel);
    if (!r.ok) return r;
    const failed = typeof registerShortcuts === 'function' ? registerShortcuts() : [];
    if (scope === 'local') { try { getWin()?.webContents.send('pet:shortcuts-changed'); } catch (err) {} }
    return { ...r, failed };
  });

  settingsHandle('cfg:set-auto-stop', (e, sec) => {
    const r = shortcuts().setAutoStop(sec);
    try { getWin()?.webContents.send('pet:shortcuts-changed'); } catch (err) {}
    return r;
  });

  settingsHandle('cfg:set-shortcuts-enabled', (e, on) => {
    const r = shortcuts().setEnabled(!!on);
    const failed = typeof registerShortcuts === 'function' ? registerShortcuts() : [];
    try { getWin()?.webContents.send('pet:shortcuts-changed'); } catch (err) {}
    return { ...r, failed };
  });

  settingsHandle('cfg:reset-shortcuts', (e, scope) => {
    const r = shortcuts().reset(scope);
    if (typeof registerShortcuts === 'function') registerShortcuts();
    return r;
  });
};
