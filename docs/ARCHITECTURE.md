# 架构

Nihonco 是一个 Electron 桌面挂件：

```text
本地语音识别 + 云端 LLM + 本地 TTS + Live2D
```

本文讲：

```text
进程边界
目录与模块
一次对话的数据流
窗口层级
ASR / TTS
记忆
资源安装
安全边界
打包与构建
已知结构问题
```

> 当前版本：**v0.7.32**。只提供 lite 构建，不再维护 full 包。

---

## 1. 进程与边界

```text
Electron 主进程（main.js）
├── 桌宠窗口（BrowserWindow）
├── 设置窗口（BrowserWindow）
├── 本地静态服务（127.0.0.1，随机端口）
├── ASR 服务
│   ├── mac：whisper.cpp 或 mlx
│   └── Windows：whisper.cpp（默认 CPU，可选 CUDA）
├── TTS 服务
│   └── VOICEVOX / AivisSpeech
└── 学习数据 / 词库 / 句型 / 记忆
```

职责：

```text
main.js / main/**     生命周期、窗口、IPC、静态服务、子进程
agent/**              纯逻辑 + 外部服务适配，不直接碰 BrowserWindow
preload*.js           只暴露白名单 API，不暴露 Node
renderer/**           桌宠页面，共享全局词法环境
settings/**           设置页，独立 preload + 独立模块
data/**               词表、句型、运行时状态
```

原则：

```text
main 不写学习逻辑
agent 不直接操作窗口
renderer 不直接 require Node
设置页只能通过 preload-settings.js 调白名单 IPC
```

---

## 2. 目录结构

```text
.
├── main.js                  # 主进程入口：启动顺序、窗口、IPC 装配
├── main/
│   ├── window.js            # 窗口、层级、穿透、截图钩子
│   ├── static-server.js     # 本地静态服务（Host 校验 / 白名单 / MIME）
│   ├── procs.js             # 子进程登记与残留清理
│   ├── menu.js              # 右键菜单 / 应用菜单
│   ├── voice.js             # TTS 合成、缓存、预热
│   ├── asr.js               # ASR 服务生命周期
│   ├── ipc.js               # IPC 守卫装配
│   └── ipc/
│       ├── pet.js           # 桌宠窗口通道
│       ├── settings.js      # 设置窗口装配
│       ├── config.js        # 配置 / 模型 / 资源 / 开机自启
│       ├── audio.js         # TTS / ASR 设置
│       ├── data.js          # 导入导出 / 恢复 / 也算对
│       └── shortcuts.js     # 快捷键
├── preload.js                # 桌宠桥
├── preload-settings.js       # 设置桥
├── pet.html / pet.js         # 桌宠页面入口
├── renderer/                 # 桌宠渲染层（10 个经典脚本）
│   ├── state.js              # 共享状态与常量
│   ├── ui.js                 # HUD / 黄卡 / 计数
│   ├── audio.js              # WebAudio、口型包络
│   ├── speech.js             # 语音队列、打断、回显
│   ├── rec.js                # 录音、WAV、识别
│   ├── cards.js              # 卡片与讲评
│   ├── modes.js              # 各模式流程
│   ├── model.js              # Live2D 模型、取景、口型
│   └── app-ui.js             # 模式切换、档位、按钮
├── settings/                 # 设置页（独立 preload）
│   ├── index.html
│   ├── app.js                # 编排：加载 / 保存 / 关闭
│   ├── core.js               # SettingsApp 注册表 + DOM 工具
│   ├── asr.js                # 后端 / 实际引擎 / 模型 / 日志
│   ├── tts.js                # 引擎 / 声线 / 参数
│   ├── llm.js                # 模型 / key / 连通测试
│   ├── live2d.js             # 模型 / 取景
│   ├── maintenance.js        # 数据 / 开机自启 / 窗口大小
│   ├── assets.js             # 资源状态 / 拖放 / 安装确认
│   ├── data.js               # 数据 / 也算对
│   ├── memory.js             # 记忆查看/编辑/删除
│   └── shortcuts.js          # 快捷键
├── ui.css                    # 共用设计令牌
├── agent/                    # 纯逻辑 + 外部服务适配（52 个模块）
├── data/                     # 词表、句型、运行时数据
├── model/ lib/               # Live2D 模型 / Cubism Core（用户自备）
├── .whisper/                 # whisper.cpp 运行时与模型
├── .voice/                   # TTS / 录音 / 缓存（gitignore）
├── tools/                    # 构建、数据生成、测试、扫描
└── docs/                     # 本目录
```

### 两种视角

```text
逻辑层：main / agent / preload / renderer / settings / data
实际文件：按职责拆分，不按层数凑文件
```

判断标准：

```text
main 只做装配与生命周期
agent 可单测，不依赖窗口
renderer 只处理页面行为
设置页按分组拆模块
```

当前较大的文件：

```text
agent/llm.js           642 行
renderer/app-ui.js     643 行
renderer/modes.js      586 行
main/ipc/pet.js        332 行
agent/asset-install.js 406 行
main/ipc/config.js     359 行
settings/asr.js        266 行
```

职责仍然单一，暂不为了拆而拆。

---

## 3. 启动顺序

```text
main.js
→ 初始化 userData / data / voice 目录
→ 设置 WHISPER_HOME / NIHONCO_WHISPER_MODELS / NIHONCO_ASR_DIR
→ 创建静态服务
→ 创建桌宠窗口（默认不置顶；settings.json 开启始终置顶时创建即置顶）
→ 加载 pet.html
→ 预热 kuromoji
→ 注册 IPC
→ 注册全局快捷键
→ 启动 ASR / TTS（按需）
```

关键路径：

```text
开发 / 源码运行：项目根
打包 asar：
  ASR 用户模型      = userData/.whisper/models
  CPU / CUDA 引擎   = userData/asr/<id>
  data / .env       = userData/data

Windows lite 不再内置 .whisper；WHISPER_HOME 仍指向
resources/app.asar.unpacked/.whisper，但该目录不存在，运行时只看用户引擎/模型。
```

---

## 4. 一次对话的数据流

```text
麦克风
→ 16k WAV
→ 本地 ASR
→ 日语文本
→ LLM（DeepSeek / Ollama / mock）
→ reply_ja + 结构化字段
→ 文本显示
→ VOICEVOX / AivisSpeech
→ WAV
→ WebAudio 播放
→ 实时音量驱动 Live2D 口型
```

边界：

```text
音频不出本机
对话文本发给 LLM
TTS 直接读原文，不经过读音表
振假名只用于显示和判分
```

---

## 5. 窗口层级

默认行为（`alwaysOnTop = false`）：

```text
置顶时一定有焦点
无焦点时一定不置顶
```

实现：

```js
win.on('blur',  () => { if (!alwaysOnTop) win.setAlwaysOnTop(false); });
win.on('focus', () => win.setAlwaysOnTop(true, alwaysOnTop ? 'floating' : levelIdle));
```

始终置顶（`alwaysOnTop = true`，持久化在 `data/settings.json`）：

```text
启动：可见、置顶、不抢焦点
失焦：仍然置顶
点击别的应用：不取消置顶
重启：从 settings.json 恢复
```

层级：

```text
始终置顶用 floating：高于普通窗口，低于输入法候选窗
PET_LEVEL=screen-saver 仍可作为高级选项压住一切
```

行为：

```text
默认启动：可见、不置顶、不抢焦点
默认点击桌宠：focus → 置顶
默认点击别的应用：blur → 取消置顶，不隐藏
始终置顶开启：任何焦点状态都保持 floating
显示快捷键：show + 恢复置顶
聚焦输入快捷键：show + 恢复置顶 + 真正聚焦
```

`Cmd+Ctrl+T` / `Ctrl+Alt+T` 切换「始终置顶」，不是切换 `floating ⇄ screen-saver`。

---

## 6. ASR

### 后端

```text
mac：whisper.cpp（Metal）或 mlx
Windows：whisper.cpp
```

Windows 默认：

```text
不内置 Whisper 运行时/模型
首次启动后拖入 CPU 或 CUDA 引擎
+ userData/.whisper/models/*.bin
```

可选 CUDA：

```text
userData/asr/cuda-12.4/
userData/asr/cuda-11.8/
```

### 运行时选择

```text
读取 active.json / 显式配置
→ CUDA 存在且可用就尝试
→ 启动失败按 3 次阈值回退 CPU
→ 用户可手动切回
```

实际引擎：

```text
CUDA 12.4
CUDA 11.8
CPU
```

只列出已安装的 CUDA；未安装的禁用。  
`gpuFallbackPermanent` 时实际显示为 CPU，并提示已回退。

### 资源安装

```text
拖入 CUDA zip → 按 ggml-cuda.dll + cudart64_*.dll 识别版本
拖入 CPU zip  → 按 whisper-server.exe + ggml*.dll 且无 ggml-cuda.dll 识别
```

目标：

```text
CUDA：userData/asr/cuda-12.4 或 cuda-11.8
CPU： userData/asr/cpu（优先于内置）
```

安装前停 ASR，安装后重启。

---

## 7. TTS

```text
VOICEVOX / AivisSpeech
→ 本地 HTTP 引擎
→ WAV
→ WebAudio
```

约定：

```text
引擎路径由设置页选择或自动发现
切换引擎 = 停旧启新
外部手动启动的引擎不被强杀
TTS 不读读音表
```

---

## 8. 记忆

轻量人格记忆：

```text
data/persona.json
profile + relation + episodes
```

能力：

```text
每 6 轮异步提取
10 分钟空闲补提取
设置页查看/编辑/删除
自动巩固：
  profile 去重
  episode 完全相同 summary 合并 tags / weight
  上限 8 / 12
  超限按低 weight、旧 at 淘汰
```

不做：

```text
LLM 语义合并
整理/合并 UI
聊天全文存储
向量检索
```

---

## 9. 资源拖放安装

```text
设置 → 资源
→ 拖入文件/zip
→ classify 按内容识别
→ preview 显示目标
→ 确认
→ install
→ 自检 / 重启
```

支持：

```text
Live2D Core .js
Live2D 模型 .zip
ASR 模型 .bin
Whisper CUDA zip
Whisper CPU zip
VOICEVOX / AivisSpeech zip
Aivis 声线 .aivmx
```

平台判断：

```text
main 的依赖注入可以用 platform 模块对象
agent 纯函数参数只接受 process.platform 字符串
asset-install 会直接拒绝对象，不能靠 === "win32" 静默兜底
```

安全：

```text
只接受本地路径
zip 检查绝对路径 / ..
限制文件数 / 单文件 / 总解压体积
符号链接目标校验
staging 写入后再替换
覆盖前备份，失败回滚
```

---

## 10. IPC 与安全

### IPC 两侧守卫

| 侧 | 守卫 |
|---|---|
| 设置窗口 | `settingsHandle` 校验 `e.sender === settingsWin.webContents` |
| 桌宠窗口 | `petHandle` / `petOn` 校验 `fromPet(e)` |

新增通道必须走对应 helper，不能直接 `ipcMain.handle`。

### 静态服务

```text
只接受 127.0.0.1 / localhost
先拦 .. / 反斜杠 / 空字节，再归一化
白名单只放行页面、脚本、lib、model、pixi、.voice/say.wav
```

### CSP

```text
script-src 'self'
connect-src 'self'
object-src 'none'
style-src 'self' 'unsafe-inline'
```

不开 `unsafe-eval`；PixiJS 用官方 unsafe-eval 补丁。

---

## 11. 构建与打包

只提供 lite：

```text
npm run build:app:lite
npm run build:app:lite:mlx
npm run build:dist:mac        # 组装 mac 分发包（tgz + sha256）
npm run build:win:lite
npm run build:win:lite:dir
npm run build:win:lite:nsis
npm run build:win:lite:portable
```

下载源：构建期间要下的二进制（Electron、electron-builder、whisper 源码/模型）统一走
`tools/fetch.mjs`，默认「镜像 → 官方」顺序，`--mirror=cn|official` 可强制。

不打包：

```text
Live2D 模型
Cubism Core
VOICEVOX
AivisSpeech
```

Windows lite 包含：

```text
Electron
app.asar
data/*.json（app.asar.unpacked）
```

不包含：

```text
.whisper/（Whisper 运行时/模型由用户拖入）
Live2D / Cubism Core
VOICEVOX / AivisSpeech
```

打包白名单：

```text
build.files 是白名单
新增目录必须同步
scan [11] 检查 require / script / link 是否被 glob 覆盖
```

资源检查：

```text
npm run check:assets:lite
```

---

## 12. 已知结构问题

1. **renderer 仍是经典脚本**：共享全局词法环境，依赖加载顺序；`state.js` 负责唯一声明，`scan [14]` 检查重复。
2. **设置页测试仍偏薄**：已有静态结构测试、`smoke:settings` 和资源安装单测，但拖放确认面板还没有真实点击测试，安装后的 UI 状态刷新仍主要靠手工验证。
3. **`agent/llm.js` 仍是门面 + 编排**：provider、chat、pair、词/句型转发仍在一起，后续按改动再拆。
4. **主动开口未实现**：当前只有右键「说话…」，没有空闲定时器。

### 已修复，仍需保持

**平台参数契约**：`main` 的依赖注入可以用 `agent/platform` 模块对象；`agent` 纯函数参数只接受 `process.platform` 字符串。`asset-install` 现在会直接拒绝对象参数，新增跨层调用不要把模块对象传进纯函数。

---

## 13. 文档地图

```text
ASSETS.md           模型 / Core / 语音资产路径
UI.md               界面行为
JAPANESE-RULES.md   判分 / 复习 / 朗读 / 会话
AUDIO.md            ASR / TTS 链路
DATA.md             数据文件 / schema / 备份
DEV.md              测试 / scan / smoke
BOUNDARIES.md       代码与测试边界
windows/            Windows 安装、打包、验收
mac/                mac 构建、分发、自检
```
