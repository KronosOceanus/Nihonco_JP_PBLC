/* 主窗口：创建、加载挂件页、层级与穿透、截图/自检钩子
 *
 * 状态（win / staticPort / passThrough / levelIdle）封装在工厂闭包里，
 * 对外只给 getter 与操作函数——菜单与 IPC 都通过这里拿窗口引用。
 */
const path = require("path");
const fs = require("fs");
const windowSize = require("../agent/window-size");

module.exports = function createWindows({
  app, BrowserWindow, screen, ROOT, VOICE_DIR,
  tts, agent, platform, voiceSvc, asrSvc, prewarmPrompts,
}) {


let win = null;
let staticPort = 0;   // 静态服务端口（设置窗口要用）

/* IPC 注册只做一次（窗口重建时不会因为 "second handler" 抛错） */
let passThrough = false;
let levelIdle = process.env.PET_LEVEL || 'floating';   // 常驻层级：floating 不挡输入法 / screen-saver 压住一切

/* 按当前配置加载挂件页（换模型时也走这里） */
async function loadPet(w, overrideFit) {
  const models = require('../agent/models');
  const modelPath = models.activePath();
  const fit = overrideFit || models.fitOf(modelPath);

  const qs = new URLSearchParams();
  const params = {
    fx: process.env.PET_FX,
    fy: process.env.PET_FY,
    model: modelPath,
    mx: String(fit.mx),        // 取景只来自 models.fitOf()（默认值 → 内置 → 本地保存）
    my: String(fit.my),
    f: String(fit.f),
  };
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  await w.loadURL(`http://127.0.0.1:${staticPort}/pet.html${qs.toString() ? '?' + qs : ''}`);
}

async function createWindow(port) {
  const saved = windowSize.load();          // 记住上次拖出来的大小
  // 换到更小的屏幕时，旧尺寸可能比工作区还大：创建前先夹一次（否则窗口超屏、坐标变负）
  const wa0 = screen.getPrimaryDisplay().workArea;
  const winSize = windowSize.clampSize(
    (saved || windowSize.DEFAULT).w, (saved || windowSize.DEFAULT).h,
    { maxW: wa0.width * 0.9, maxH: wa0.height * 0.9 },
  );
  win = new BrowserWindow({
    width: winSize.w,
    height: winSize.h,
    minWidth: 240,
    minHeight: 320,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    title: 'Live2D 挂件',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // 层级换算（macOS）：普通窗口 0 < floating 3 < status 25 < 输入法候选窗 101 < screen-saver 1000
  // 平时用 screen-saver 压住一切；打字时降到 status —— 仍高于其他应用，但让输入法候选窗露出来
  // 常驻用 floating(3)：高于普通窗口(0)，但低于输入法候选窗(~100)，
  // 这样在别的应用里打字时，输入法不会被我们盖住。
  // 想重新压住全屏应用，可用 PET_LEVEL=screen-saver 启动。
  const LEVEL_TYPING = 'floating';   // 打字时让位给输入法
  win.setAlwaysOnTop(true, levelIdle);

  // Cmd+Ctrl+T：在「压住一切」和「让位给输入法」之间切换

  // Windows 没有"所有工作区可见"的概念，跳过（WINDOWS-HANDOVER §3-7）
  if (platform.supportsAllWorkspaces()) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 默认贴在主屏右下角（用实际尺寸，不用写死的 380/560）
  const { workArea } = require('electron').screen.getPrimaryDisplay();
  win.setPosition(
    Math.max(workArea.x, Math.round(workArea.x + workArea.width - winSize.w - 24)),
    Math.max(workArea.y, Math.round(workArea.y + workArea.height - winSize.h - 24)),
  );

  // 开发用：把渲染层 console 转到终端
  if (process.env.PET_DEBUG) {
    win.webContents.on('console-message', (...args) => {
      const d = args[0];
      const msg = d && typeof d === 'object' && 'message' in d ? d.message : args[2];
      console.log('[renderer]', msg);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) =>
      console.log('[renderer] 加载失败', code, desc));
  }

  await loadPet(win);
  win.showInactive(); // 不抢焦点

  // 自检用：加载后自动说一句话（验证 TTS + 口型链路）
  if (process.env.PET_SAY) {
    setTimeout(() => {
      win.webContents.executeJavaScript(
        `window.__pet && window.__pet.say(${JSON.stringify(process.env.PET_SAY)})`
      ).catch((e) => console.log('[say] 失败', e.message));
    }, Number(process.env.PET_SAY_DELAY || 2500));
  }

  // 自检用：把指定 wav 送进 ASR，验证 主进程 → ASR 服务 → 渲染层 的通道
  // 自检用：在渲染层执行任意 JS（调样式/布局用）
  if (process.env.PET_EVAL) {
    setTimeout(async () => {
      try {
        console.log('[eval]', await win.webContents.executeJavaScript(process.env.PET_EVAL));
      } catch (e) {
        console.log('[eval] 失败', e.message);
      }
      if (process.env.PET_EVAL_EXIT) app.quit();   // 自检脚本用：跑完就退
    }, Number(process.env.PET_EVAL_DELAY || 6000));
  }

  setTimeout(() => { prewarmPrompts(); }, Number(process.env.VOICE_PREWARM_DELAY || 4000));

  // 自检用：把鼠标移到某坐标（用于验证悬浮提示）
  if (process.env.PET_MOUSE_TEST) {
    setTimeout(async () => {
      try {
        let [x, y] = process.env.PET_MOUSE_TEST.split(",").map(Number);
        if (Number.isNaN(x)) {                     // 支持传 CSS 选择器
          const r = JSON.parse(await win.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(process.env.PET_MOUSE_TEST)}); if (!el) return "{}"; const b = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }); })()`));
          x = r.x; y = r.y;
        }
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await new Promise((r) => setTimeout(r, 400));
        console.log('[mouse]', await win.webContents.executeJavaScript(
          `(() => {
             const el = document.elementFromPoint(${x}, ${y});
             const cs = el ? getComputedStyle(el, '::after') : null;
             return JSON.stringify({ id: el && el.id, hover: el && el.matches(':hover'),
               tip: el && el.dataset && el.dataset.tip,
               after: cs ? { opacity: cs.opacity, content: cs.content, display: cs.display, position: cs.position, bottom: cs.bottom, z: cs.zIndex, visibility: cs.visibility } : null });
           })()`));
      } catch (e) { console.log('[mouse] 失败', e.message); }
    }, Number(process.env.PET_MOUSE_TEST_DELAY || 12000));
  }

  // 自检用：模拟空格录音（space / space-cancel）
  if (process.env.PET_KEY_TEST) {
    const cancel = String(process.env.PET_KEY_TEST).includes('cancel');
    setTimeout(async () => {
      const js = (cancel
        ? `(async () => {
             window.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', key:' ', bubbles:true}));
             await new Promise(r => setTimeout(r, 1500));
             window.dispatchEvent(new KeyboardEvent('keydown', {code:'Escape', key:'Escape', bubbles:true}));
             await new Promise(r => setTimeout(r, 300));
             window.dispatchEvent(new KeyboardEvent('keyup', {code:'Space', key:' ', bubbles:true}));
             return {hud: document.getElementById('hud').textContent, cancel: true};
           })()`
        : `(async () => {
             window.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', key:' ', bubbles:true}));
             await new Promise(r => setTimeout(r, 1800));
             window.dispatchEvent(new KeyboardEvent('keyup', {code:'Space', key:' ', bubbles:true}));
             await new Promise(r => setTimeout(r, 3500));
             return {hud: document.getElementById('hud').textContent, cancel: false};
           })()`);
      try { console.log('[key-test]', JSON.stringify(await win.webContents.executeJavaScript(js))); }
      catch (e) { console.log('[key-test] 失败', e.message); }
    }, Number(process.env.PET_KEY_TEST_DELAY || 6000));
  }

  // 自检用：直接测 TTS（不经过渲染层）
  if (process.env.PET_TTS_TEST) {
    setTimeout(async () => {
      try {
        const t0 = Date.now();
        // 拆分 main.js 之后 speakToWav 在 voiceSvc 里，这里必须走 svc（原来裸调用会 ReferenceError）
        const f = await voiceSvc.speakToWav(process.env.PET_TTS_TEST);
        const st = fs.statSync(f);
        console.log(`[tts-test] ${Date.now() - t0}ms ${st.size}B → ${f}`);
      } catch (e) { console.log('[tts-test] 失败', e.message); }
    }, Number(process.env.PET_TTS_TEST_DELAY || 20000));
  }

  // 自检用：在指定毫秒后杀掉 asr 子进程，验证自动恢复
  if (process.env.PET_KILL_ASR_AT) {
    setTimeout(() => {
      try { const p = asrSvc.getAsrProc(); if (p) { p.kill('SIGKILL'); console.log('[test] 已强杀 asr 子进程'); } } catch (e) {}
    }, Number(process.env.PET_KILL_ASR_AT));
  }

  if (process.env.PET_ASR_TEST) {
    setTimeout(async () => {
      try {
        const b64 = fs.readFileSync(process.env.PET_ASR_TEST).toString('base64');
        const r = await win.webContents.executeJavaScript(
          `window.pet.asr(${JSON.stringify(b64)}, "zh")`,
        );
        console.log('[asr-test]', JSON.stringify(r));
      } catch (e) {
        console.log('[asr-test] 失败', e.message);
      }
    }, Number(process.env.PET_ASR_TEST_DELAY || 5000));
  }

  // 自检用：走完整录音链路（配合 --use-fake-device-for-media-stream）
  if (process.env.PET_MIC_TEST) {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript('window.__pet.recTest(1500)');
        console.log('[mic-test]', JSON.stringify(r));
      } catch (e) {
        console.log('[mic-test] 失败', e.message);
      }
    }, Number(process.env.PET_MIC_TEST_DELAY || 8000));
  }

  // 自检用：模拟一次对话（验证 agent → UI → TTS）
  if (process.env.PET_CHAT_TEST) {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(
          `(async () => { window.__pet.sendChat(${JSON.stringify(process.env.PET_CHAT_TEST)});
             await new Promise(res => setTimeout(res, 4000));
             return { mode: document.querySelector('.mode-btn.active')?.dataset.mode,
                      reply: document.getElementById('reply').textContent.slice(0, 120),
                      note: document.getElementById('note').textContent.slice(0, 200) }; })()`,
        );
        console.log('[chat-test]', JSON.stringify(r));
      } catch (e) {
        console.log('[chat-test] 失败', e.message);
      }
    }, Number(process.env.PET_CHAT_TEST_DELAY || 4000));
  }

  // 自检用：切到指定模式（conv/teach/word/pattern）
  if (process.env.PET_MODE_TEST) {
    setTimeout(async () => {
      try {
        await win.webContents.executeJavaScript(
          `(function(){ const el=document.querySelector('.mode-btn[data-mode="${process.env.PET_MODE_TEST}"]');
             el && el.click(); return 'ok'; })()`);
        console.log('[mode-test]', process.env.PET_MODE_TEST);
      } catch (e) { console.log('[mode-test] 失败', e.message); }
    }, 2500);
  }

  // 自检用：切到单词模式并上一课
  if (process.env.PET_WORD_TEST) {
    setTimeout(async () => {
      try {
        await win.webContents.executeJavaScript(
          `(function(){ const el=document.querySelector('.mode-btn[data-mode="word"]');
             el && el.click();
             return 'ok'; })()`);
        console.log('[word-test] 已切到単語模式');
      } catch (e) { console.log('[word-test] 失败', e.message); }
    }, 3000);
  }

  // 自检用：离屏截图存 PNG，方便不开显示器也能确认渲染结果
  if (process.env.PET_SHOT) {
    const delay = Number(process.env.PET_SHOT_DELAY || 6000);
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        const out = path.join(VOICE_DIR, 'shot.png');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, img.toPNG());
        console.log('[shot]', out, img.getSize());
      } catch (e) {
        console.log('[shot] 失败', e.message);
      }
      if (process.env.PET_SHOT_EXIT) app.quit();
    }, delay);
  }
}

function toggleLevelIdle() {
  levelIdle = levelIdle === "floating" ? "screen-saver" : "floating";
  try { win?.setAlwaysOnTop(true, levelIdle); } catch (e) {}
  console.log("[level]", levelIdle);
  return levelIdle;
}

/** 应用尺寸：夹到工作区 90%
 *  anchor：'br' = 右下角固定（设置里改大小、拖左上角）；'tl' = 左上角固定（拖右下角） */
function applyPetSize(w, h, { anchor = "br", left, top, right, bottom, save = false } = {}) {
  if (!win) return null;
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  const wa = display.workArea;
  const s = windowSize.clampSize(w, h, { maxW: wa.width * 0.9, maxH: wa.height * 0.9 });
  let x, y;
  if (anchor === "tl") {
    x = Number.isFinite(left) ? left : b.x;
    y = Number.isFinite(top) ? top : b.y;
  } else {
    const R = Number.isFinite(right) ? right : b.x + b.width;
    const B = Number.isFinite(bottom) ? bottom : b.y + b.height;
    x = R - s.w;
    y = B - s.h;
  }
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - s.w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - s.h));
  win.setBounds({ x, y, width: s.w, height: s.h });
  if (save) windowSize.save(s);
  return { ...s, x, y };
}

let resizeStart = null;
/** 拖拽中：两个角都保持「右下角固定」
 *  corner = "br"：往右下变大；corner = "tl"：光标往左上 → 宽高变大 */
function petResize(sx, sy, corner = "br") {
  if (!win) return null;
  const b = win.getBounds();
  if (!resizeStart || resizeStart.corner !== corner) {
    resizeStart = { corner, sx, sy, w: b.width, h: b.height,
      left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
  }
  if (corner === "tl") {
    // 拖左上角：右下角不动，光标往左上 → 变大
    return applyPetSize(resizeStart.right - sx, resizeStart.bottom - sy,
      { anchor: "br", right: resizeStart.right, bottom: resizeStart.bottom });
  }
  // 拖右下角：左上角不动，光标往右下 → 变大
  return applyPetSize(resizeStart.w + (sx - resizeStart.sx), resizeStart.h + (sy - resizeStart.sy),
    { anchor: "tl", left: resizeStart.left, top: resizeStart.top });
}

function petResizeEnd() {
  resizeStart = null;
  if (!win) return null;
  const b = win.getBounds();
  windowSize.save({ w: b.width, h: b.height });
  return { w: b.width, h: b.height };
}

function getPetSize() {
  if (!win) return null;
  const b = win.getBounds();
  return { w: b.width, h: b.height };
}

function setPetSize(w, h) {
  return applyPetSize(w, h, { save: true });
}

/** 显示 / 隐藏挂件（不抢焦点） */
function toggleVisibility() {
  if (!win) return false;
  if (win.isVisible()) { win.hide(); return false; }
  win.showInactive();
  return true;
}

function setPassThrough(on) {
  passThrough = on;
  // forward: true —— 穿透状态下仍把鼠标移动送给页面，方便做「靠近才接管」
  if (win) win.setIgnoreMouseEvents(on, { forward: true });
}


  function getWin() { return win; }
  function getLevelIdle() { return levelIdle; }
  function getPassThrough() { return passThrough; }
  function setStaticPort(p) { staticPort = p; }
  function getStaticPort() { return staticPort; }

  return { createWindow, loadPet, toggleLevelIdle, toggleVisibility, setPassThrough,
           petResize, petResizeEnd, getPetSize, setPetSize,
           getWin, getLevelIdle, getPassThrough, setStaticPort, getStaticPort };
};
