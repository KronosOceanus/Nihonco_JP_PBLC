/* Live2D 桌面挂件 · Electron 主进程
 *
 * 职责：
 *  1) 起一个只监听 127.0.0.1 的静态服务器（模型/纹理必须走 http，file:// 会被 CORS 拦）
 *  2) 开一个透明、无边框、置顶、无阴影的窗口
 *  3) 提供 TTS：调用本地 VOICEVOX / AivisSpeech，生成 wav 交给渲染层播放
 *
 * 不做的事：不加载外部 CDN、不联网、不上传任何东西。
 */
const { app, BrowserWindow, ipcMain, Menu, globalShortcut, shell, dialog, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');

app.setName('Nihonco');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = __dirname;
const platform = require('./agent/platform');
const appLog = require('./agent/app-log');
const shortcuts = require('./agent/shortcuts');
const windowSize = require('./agent/window-size');
const reading = require('./agent/reading');
const createStaticServer = require('./main/static-server');
const createProcs = require('./main/procs');
const createMenus = require('./main/menu');
const createVoice = require('./main/voice');
const createAsr = require('./main/asr');
const createIpc = require('./main/ipc');
const createWindows = require('./main/window');
const { IS_WIN, killPid, portOwner, isOurs } = platform;
const IS_PACKAGED = app.isPackaged;

// 所有缓存/配置放项目内，避免写 ~/Library（沙箱环境会 EPERM）
// 用户数据目录：默认在项目内；自检/冒烟测试可用 NIHONCO_USER_DATA 指到临时目录，
// 这样「应用正开着」也能再起一个实例，不会撞单实例锁。
// 打包后 asar 是只读的：userData 必须回落到系统目录，词库/设置一并搬过去。
const USER_DATA = process.env.NIHONCO_USER_DATA
  || (IS_PACKAGED ? app.getPath('userData') : path.join(ROOT, '.electron-data'));
app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);

// lite 包：模型 / Cubism Core 放 userData/assets；也可用 NIHONCO_ASSETS 覆盖
const ASSET_DIR = process.env.NIHONCO_ASSETS || path.join(USER_DATA, 'assets');
process.env.NIHONCO_ASSETS = ASSET_DIR;

// 静态服务需要 userData（打包后 .voice 在那边），所以放在 USER_DATA 定义之后
const staticServer = createStaticServer({
  root: ROOT,
  userData: USER_DATA,
  assetsDir: ASSET_DIR,
  isPackaged: IS_PACKAGED,
  log: console.log,
});

// 打包后：把随包的数据表拷到用户目录（只 seed 共享白名单；缺 jlpt.json 时回退项目 data/）
// 纯逻辑抽到 agent/boot-data.js，便于单测（见 tests/boot-data.test.mjs）
if (IS_PACKAGED && !process.env.NIHONCO_DATA_DIR) {
  const { prepareDataDir } = require('./agent/boot-data');
  const r = prepareDataDir({
    packaged: IS_PACKAGED,
    userData: USER_DATA,
    root: ROOT,
    resourcesPath: process.resourcesPath,
    log: (m) => console.log(m),
  });
  if (r.dir) process.env.NIHONCO_DATA_DIR = r.dir;
}

// 语音产物目录：打包后必须落在可写位置（asar 里写不进去），
// 而且静态服务器只从这一个目录读 `/.voice/*`，缓存目录必须跟它对齐。
const VOICE_DIR = path.join(IS_PACKAGED ? USER_DATA : ROOT, '.voice');

// whisper.cpp 的二进制/模型：打包后在 app.asar.unpacked 里（asar 内的可执行文件 spawn 不了）
if (IS_PACKAGED) {
  process.env.WHISPER_HOME = path.join(process.resourcesPath, 'app.asar.unpacked', '.whisper');
}
// GPU 加速后端（CUDA）放在可写目录：<userData>/asr/<cuda-12.4|cuda-11.8>/
// 约定见 agent/asr-whispercpp.js：显式/记住的后端优先，起不来自动回落内置 CPU 版
process.env.NIHONCO_ASR_DIR = path.join(USER_DATA, 'asr');

// 进程登记（procs.json 在 .voice/ 下）
const procs = createProcs({ file: path.join(VOICE_DIR, 'procs.json'), log: console.log });
const { rememberProc, killStaleProcs, writeProcs } = procs;

process.env.NIHONCO_VOICE_CACHE_DIR = path.join(VOICE_DIR, 'cache');

// 应用日志：data/logs/app.log（2MB 轮转）；开发时同时保留 stdout
const APP_DATA_DIR = process.env.NIHONCO_DATA_DIR || path.join(ROOT, 'data');
appLog.install({
  dir: path.join(APP_DATA_DIR, 'logs'),
  // 打包版遇到未捕获异常：记日志后退出（重启比带病跑更安全）；开发模式保留进程看堆栈
  exit: IS_PACKAGED ? (code) => app.exit(code || 1) : null,
});
console.log('[app] 启动', { packaged: IS_PACKAGED, dataDir: APP_DATA_DIR });

// 必须在 NIHONCO_DATA_DIR 定好之后再 require：agent/* 在模块加载时就把 DATA_DIR 算出来了
const agent = require('./agent/llm');
const config = require('./agent/config');
const tts = require('./agent/tts');
const backup = require('./agent/backup');
const voiceCache = require('./agent/voice-cache');

const voiceSvc = createVoice({
  root: ROOT, userData: USER_DATA, voiceDir: VOICE_DIR,
  tts, platform, procs, voiceCache,
});
const { ensureTtsEngine, startTtsEngine, speakToWav,
        prewarmPrompts, refreshVoiceCache } = voiceSvc;

const asrWhisper = require('./agent/asr-whispercpp');

const asrLog = require('./agent/asr-log');
const asrBackends = require('./agent/asr-backends');

asrWhisper.setSpawnHook?.((child) => rememberProc('asr', child, 'whisper-server'));
const asrSvc = createAsr({ root: ROOT, platform, procs, asrWhisper, asrBackends, log: console.log });
const { startAsr, restartAsr, stopAsr, ensureAsr } = asrSvc;

let registeredShortcuts = [];
let shortcutFailures = [];        // 最近一次注册失败的项（被别的应用占用），设置窗口据此提示

/** 注册 4 个可自定义的全局快捷键；返回注册失败的项（被别的应用占用） */
function registerGlobalShortcuts() {
  for (const a of registeredShortcuts) { try { globalShortcut.unregister(a); } catch (e) {} }
  registeredShortcuts = [];
  const db = shortcuts.load();
  if (!db.enabled) {
    shortcutFailures = [];
    console.log('[shortcut] 已关闭');
    return [];
  }
  const map = db.global;
  const send = (ch) => { try { windowSvc.getWin()?.webContents.send(ch); } catch (e) {} };
  const handlers = {
    toggle: () => windowSvc.toggleVisibility(),
    record: () => send('pet:rec-toggle'),
    mute: () => send('pet:mute-toggle'),
    focus: () => {
      const w = windowSvc.getWin();
      if (!w) return;
      if (!w.isVisible()) w.showInactive();
      w.webContents.send('pet:focus-input');
    },
  };
  const failed = [];
  /* 键盘自动重复：Windows 的 RegisterHotKey 默认会连发——按住不放时 WM_HOTKEY 反复触发，
   * 录音就成了「开→关→开→关」，表现为一按下就被打断（"太短了 再说一次"）。
   * Electron 的 globalShortcut 没有 MOD_NOREPEAT 开关，只能在 Windows 上吃掉：
   * 同一动作 1000ms 内再来算同一次按下。注意每次都刷新计时，所以按住多久都不会漏过去，
   * 松手 1000ms 之后再按才算第二次。mac 的 Carbon 热键本来就不重复，不加冷却。 */
  const HOTKEY_GAP_MS = IS_WIN ? 1000 : 0;
  const lastHotkeyAt = new Map();
  const debounced = (id, fn) => () => {
    if (!HOTKEY_GAP_MS) { fn(); return; }
    const now = Date.now();
    const prev = lastHotkeyAt.get(id) || 0;
    lastHotkeyAt.set(id, now);
    if (now - prev < HOTKEY_GAP_MS) return;
    fn();
  };
  for (const [id, accel] of Object.entries(map)) {
    try {
      if (globalShortcut.register(accel, debounced(id, handlers[id]))) registeredShortcuts.push(accel);
      else failed.push({ id, accel });
    } catch (e) { failed.push({ id, accel, error: e.message }); }
  }
  shortcutFailures = failed;
  if (failed.length) console.log('[shortcut] 注册失败（可能被别的应用占用）：', JSON.stringify(failed));
  return failed;
}

const ipc = createIpc({
  ipcMain, app, shell, dialog, platform,
  getWin: () => windowSvc.getWin(),
  getSettingsWin: () => settingsWin,
  agent, config, backup, tts, voiceCache,
  asrSvc, voiceSvc, asrBackends, asrLog,
  startAsr, restartAsr, stopAsr, ensureAsr, speakToWav, prewarmPrompts, refreshVoiceCache, ensureTtsEngine,
  openSettings: () => openSettings(),
  loadPet: (w) => windowSvc.loadPet(w),
  getLevelIdle: () => windowSvc.getLevelIdle(),
  getPassThrough: () => windowSvc.getPassThrough(),
  isPackaged: IS_PACKAGED,
  // 这两个都在后面才创建：惰性包装，调用时解析
  menus: { buildMenu: (...a) => menus.buildMenu(...a), buildAppMenu: (...a) => menus.buildAppMenu(...a) },
  setPassThrough: (on) => windowSvc.setPassThrough(on),
  petResize: (x, y, corner) => windowSvc.petResize(x, y, corner),
  petResizeEnd: () => windowSvc.petResizeEnd(),
  getPetSize: () => windowSvc.getPetSize(),
  setPetSize: (w, h) => windowSvc.setPetSize(w, h),
  registerShortcuts: () => registerGlobalShortcuts(),
  shortcutFailures: () => shortcutFailures,
  ROOT, VOICE_DIR, ASSET_DIR, USER_DATA,
  DATA_DIR: process.env.NIHONCO_DATA_DIR || path.join(ROOT, 'data'),
  asrGpu: require('./agent/asr-gpu'),
});

const windowSvc = createWindows({
  app, BrowserWindow: require('electron').BrowserWindow, screen,
  ROOT, VOICE_DIR, tts, agent, platform, voiceSvc, asrSvc,
  prewarmPrompts,
});
const { createWindow, loadPet, toggleLevelIdle, setPassThrough } = windowSvc;


// 只允许一个实例（必须在设置 userData 之后，否则锁文件会写到 ~/Library）
if (!app.requestSingleInstanceLock()) {
  console.log('[app] 已有实例在运行，本次退出');
  app.quit();
  process.exit(0);
}
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

/* ------------------------------ 设置窗口 ------------------------------ */
let settingsWin = null;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show(); settingsWin.focus(); return settingsWin;
  }
  settingsWin = null;
  settingsWin = new BrowserWindow({
    width: 620, height: 560,
    resizable: true, minimizable: false, fullscreenable: false,
    title: 'Nihonco 設定',
    titleBarStyle: platform.titleBarStyle(),
    backgroundColor: '#151a24',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),   // 只给配置相关接口
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.loadURL(`http://127.0.0.1:${windowSvc.getStaticPort()}/settings/index.html`);
  settingsWin.on('closed', () => { settingsWin = null; });
  return settingsWin;
}

// 菜单：回调通过 getter/函数注入，避免模块间循环依赖
const menus = createMenus({
  Menu, app, shell, screen, root: ROOT,
  getWin: () => windowSvc.getWin(),
  getLevelIdle: () => windowSvc.getLevelIdle(),
  getPassThrough: () => windowSvc.getPassThrough(),
  toggleLevelIdle: () => toggleLevelIdle(),
  setPassThrough: (on) => windowSvc.setPassThrough(on),
  openSettings: () => openSettings(),
  isWin: IS_WIN,
  resetPetSize: () => windowSvc.setPetSize(windowSize.DEFAULT.w, windowSize.DEFAULT.h),
});

/* -------------------------------- 启动 --------------------------------- */

app.whenReady().then(async () => {
  // macOS：确保以普通 Dock 应用身份运行。
  // 否则可能被 LaunchServices 登记成 UIElement，Dock 右键只有「打开」，没有原生「退出」。
  if (process.platform === "darwin") {
    try {
      if (app.setActivationPolicy) app.setActivationPolicy("regular");
      if (app.dock) await app.dock.show();
    } catch (e) { console.log('[app] Dock 激活失败:', e.message); }
  }
  menus.buildAppMenu();
  const port = await staticServer.startServer();
  windowSvc.setStaticPort(port);
  killStaleProcs();
  setTimeout(startAsr, 300);
  startTtsEngine();
  // 汉字读音词典：后台预热（~200ms），判分要用；没就绪时「也算对」不出现
  setTimeout(() => { reading.warmup().catch((e) => console.log('[reading] 预热失败:', e.message)); }, 800);
  ipc.registerIpcOnce();

  if (process.env.PET_OPEN_SETTINGS) {
    setTimeout(() => openSettings(), Number(process.env.PET_OPEN_SETTINGS_DELAY || 3000));
  }
  if (process.env.PET_SETTINGS_EVAL) {
    setTimeout(async () => {
      try {
        const w = openSettings();
        const run = async () => {
          await new Promise((r) => setTimeout(r, 800));
          const out = await w.webContents.executeJavaScript(process.env.PET_SETTINGS_EVAL);
          console.log('[settings-eval]', JSON.stringify(out));
        };
        // 窗口可能已经加载完（重复自检）→ 直接跑，避免 once 永不触发
        if (w.webContents.isLoading()) w.webContents.once('did-finish-load', run);
        else run();
      } catch (e) { console.log('[settings-eval] 失败', e.message); }
    }, Number(process.env.PET_SETTINGS_EVAL_DELAY || 4000));
  }

  if (process.env.PET_SHOT_SETTINGS) {
    setTimeout(async () => {
      try {
        const w = openSettings();
        w.webContents.once('did-finish-load', async () => {
          await new Promise((r) => setTimeout(r, 1200));
          const img = await w.webContents.capturePage();
          fs.writeFileSync(path.join(VOICE_DIR, 'settings.png'), img.toPNG());
          console.log('[shot] settings.png saved');
        });
      } catch (e) { console.log('[shot] settings failed', e.message); }
    }, Number(process.env.PET_SHOT_SETTINGS_DELAY || 4000));
  }
  await createWindow(port);

  // macOS：Cmd+Ctrl+T/P；Windows：Ctrl+Alt+T/P（Ctrl+Ctrl 在 Windows 上注册不上）
  const MOD = platform.shortcutMod();
  globalShortcut.register(`${MOD}+P`, () => windowSvc.setPassThrough(!windowSvc.getPassThrough()));
  globalShortcut.register(`${MOD}+T`, () => windowSvc.toggleLevelIdle());
  globalShortcut.register('CommandOrControl+,', () => openSettings());

  registerGlobalShortcuts();

  app.on('activate', () => {
    if (windowSvc.getWin()) windowSvc.getWin().showInactive();
  });
});

let quitting = false;
app.on('will-quit', (e) => {
  globalShortcut.unregisterAll();
  if (quitting) return;
  const procs = [asrSvc.getAsrProc(), voiceSvc.getEngineProc()].filter((p) => p && p.exitCode === null);
  if (!procs.length) return;
  quitting = true;
  // 温和退出；真正的强杀兜底在下面的 process.on('exit')
  // （will-quit 里不 preventDefault 的话进程马上就退了，setTimeout 根本不会执行）
  for (const p of procs) { try { if (p.pid) killPid(p.pid, false); } catch (err) {} }
});

// 兜底：进程直接退出时也别留下子进程
process.on('exit', () => {
  for (const p of [asrSvc.getAsrProc(), voiceSvc.getEngineProc()]) {
    try { if (p && p.pid) killPid(p.pid, true); } catch (e) {}
  }
  try { asrWhisper.stop(); } catch (e) {}   // Windows：whisper-server 子进程
  writeProcs({});          // 正常退出后不该留登记
});
app.on('window-all-closed', () => app.quit());
