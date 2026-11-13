/* 渲染层 ↔ 主进程的唯一桥。contextIsolation 打开，渲染层拿不到 node。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  speak: (text, opts) => ipcRenderer.invoke('pet:speak', text, opts),
  // 语音识别：传 base64 的 wav，拿回 { text, ms }
  asr: (wavBase64, lang) => ipcRenderer.invoke('pet:asr', { wavBase64, lang }),
  asrHealth: () => ipcRenderer.invoke('pet:asr-health'),
  // 缺哪些 Whisper 资产（engine / model），首启 HUD 用
  asrAssets: () => ipcRenderer.invoke('pet:asr-assets'),
  lookup: (text) => ipcRenderer.invoke('pet:lookup', text),
  // 语音合成是否可用（Windows 缺 VOICEVOX 时 ok=false，界面据此提示）
  ttsHealth: () => ipcRenderer.invoke('pet:tts-health'),
  // 对话：{ text, mode: 'conv'|'teach' } → { ok, provider, turn }
  chat: (payload) => ipcRenderer.invoke('pet:chat', payload),
  chatStatus: () => ipcRenderer.invoke('pet:chat-status'),
  chatReset: () => ipcRenderer.invoke('pet:chat-reset'),
  word: (payload) => ipcRenderer.invoke('pet:word', payload),
  pattern: (payload) => ipcRenderer.invoke('pet:pattern', payload),
  pair: (text, lang) => ipcRenderer.invoke('pet:pair', text, lang),
  casual: () => ipcRenderer.invoke('pet:casual'),
  level: (payload) => ipcRenderer.invoke('pet:level', payload || {}),
  setTyping: (typing) => ipcRenderer.invoke('pet:typing', !!typing),
  saveAudio: (wavBase64) => ipcRenderer.invoke('pet:save-audio', wavBase64),
  menu: () => ipcRenderer.send('pet:menu'),
  openSettings: () => ipcRenderer.send('pet:open-settings'),
  quit: () => ipcRenderer.send('pet:quit'),
  setMouseThrough: (on) => ipcRenderer.send('pet:mouse', on),
  // 拖右下角改窗口大小（screenX/screenY 原样传，主进程按右下角锚定）
  resize: (x, y, corner) => ipcRenderer.send('pet:resize', x, y, corner),
  resizeEnd: () => ipcRenderer.send('pet:resize-end'),
  onFocusInput: (cb) => ipcRenderer.on('pet:focus-input', () => cb()),
  // 全局快捷键触发：录音开关 / 静音开关
  onRecToggle: (cb) => ipcRenderer.on('pet:rec-toggle', () => cb()),
  onMuteToggle: (cb) => ipcRenderer.on('pet:mute-toggle', () => cb()),
  // 窗口内快捷键表（设置里可改）
  shortcuts: () => ipcRenderer.invoke('pet:shortcuts'),
  onShortcutsChanged: (cb) => ipcRenderer.on('pet:shortcuts-changed', () => cb()),
  onConfigChanged: (cb) => ipcRenderer.on('cfg:changed', (_e, cfg) => cb(cfg)),
  onPreviewReady: (cb) => ipcRenderer.on('cfg:preview-ready', () => cb()),
});
