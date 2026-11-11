/* 菜单模板（右键菜单 + 应用菜单）
 *
 * 依赖注入：win / app / shell / Menu / screen 由 main.js 提供；
 * 菜单项回调（切换置顶、鼠标穿透、打开设置）也由调用方注入，避免循环依赖。
 */
const modelActions = require('../agent/model-actions');

module.exports = function createMenus({
  Menu, app, shell, screen, root,
  getWin, getLevelIdle, getPassThrough,
  toggleLevelIdle, setPassThrough, openSettings, isWin, resetPetSize,
}) {
function runPet(js) {
  try { getWin()?.webContents.executeJavaScript(js).catch(() => {}); } catch (e) {}
}

function expressionMenu() {
  let r = { expressions: [], motions: [] };
  try { r = modelActions.current({ root }); } catch (e) {}
  const items = [];
  if (r.expressions.length) {
    items.push({ label: '表情', enabled: false });
    for (const x of r.expressions) {
      items.push({
        label: x.name,
        click: () => runPet(`window.__pet && window.__pet.playExpressionFile(${JSON.stringify(x.file)}, 3000)`),
      });
    }
  }
  if (r.motions.length) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: '动作', enabled: false });
    for (const x of r.motions) {
      items.push({
        label: x.label,
        click: () => runPet(`window.__pet && window.__pet.playMotion(${JSON.stringify(x.group)}, ${Number(x.index) || 0})`),
      });
    }
  }
  if (!items.length) items.push({ label: '当前模型没有可触发的表情/动作', enabled: false });
  return items;
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '说话…', click: () => runPet('window.__pet && window.__pet.casualSay()') },
    { label: '表情', submenu: expressionMenu() },
    { label: '恢复默认大小', click: () => { try { resetPetSize?.(); } catch (e) {} } },
    { label: '回到右下角', click: () => {
        const { workArea } = require('electron').screen.getPrimaryDisplay();
        getWin().setPosition(
          Math.round(workArea.x + workArea.width - getWin().getBounds().width - 24),
          Math.round(workArea.y + workArea.height - getWin().getBounds().height - 24),
        );
      } },
    { type: 'separator' },
    {
      label: '置顶开关（Cmd+Ctrl+T 切换）',
      type: 'checkbox',
      checked: getLevelIdle() === "screen-saver",
      click: () => toggleLevelIdle(),
    },
    {
      label: '鼠标穿透（Cmd+Ctrl+P 切换）',
      type: 'checkbox',
      checked: getPassThrough(),
      click: (item) => setPassThrough(item.checked),
    },
    { label: '設定…（Cmd+,）', click: () => openSettings() },
    { label: '打开项目文件夹', click: () => shell.openPath(root) },
    { type: 'separator' },
    { label: '退出挂件', click: () => app.quit() },
  ]);
}

function buildAppMenu() {
  // Windows 上 about/hide/hideOthers/unhide 这几个 role 无意义（也没有 Command 键），
  // 换成「文件/编辑/视图/帮助」的常规菜单（WINDOWS-HANDOVER §3-9）
  const template = isWin ? [
    { label: '文件', submenu: [
      { label: '設定…', accelerator: 'Control+,', click: () => openSettings() },
      { type: 'separator' },
      { label: '退出', role: 'quit', accelerator: 'Control+Q' },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '视图', submenu: [
      { role: 'reload', label: '重新载入' },
      { role: 'toggleDevTools', label: '开发者工具' },
    ] },
    { label: '帮助', submenu: [
      { label: '打开项目文件夹', click: () => shell.openPath(root) },
    ] },
  ] : [
    { label: 'Nihonco', submenu: [
      { role: 'about', label: '关于 Nihonco' },
      { type: 'separator' },
      { role: 'hide', label: '隐藏 Nihonco' },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { role: 'quit', label: '退出 Nihonco', accelerator: 'Command+Q' },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '显示', submenu: [
      { role: 'reload', label: '重新载入' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '全屏' },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

  return { buildMenu, buildAppMenu };
};
