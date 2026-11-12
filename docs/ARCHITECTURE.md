# 架构

目录结构、进程边界、安全模型与一次对话的数据流。

## 目录结构

```
.
├── Nihonco.app/          # 双击启动的应用包（内含 Electron 壳）
├── main.js               # 主进程入口：app 生命周期、窗口、启动顺序
├── main/                 # 主进程拆分后的模块（工厂 + 依赖注入）
│   ├── static-server.js  # 本地静态服务（白名单/MIME/Host 校验）
│   ├── procs.js          # 子进程登记与残留清理
│   ├── menu.js           # 右键菜单 / 应用菜单模板
│   ├── voice.js          # TTS 合成/缓存/预热，引擎进程在 agent/tts-engine.js
│   ├── asr.js            # 识别服务生命周期（mlx / whisper.cpp）
│   ├── ipc.js            # IPC 装配 + 两侧守卫
│   ├── ipc/              # IPC 按域拆出的通道
│   │   ├── pet.js        # 桌宠窗口通道
│   │   ├── settings/app.js   # 设置窗口装配
│   │   ├── config.js     # 配置 / 模型 / 资源 / 开机自启
│   │   ├── audio.js      # 声音 + ASR
│   │   ├── data.js       # 导入导出 / 恢复 / 也算对
│   │   └── shortcuts.js  # 快捷键
│   └── window.js         # 主窗口、加载页、层级/穿透、截图钩子（置顶只跟随焦点）
├── preload.js            # 暴露给渲染层的 API
├── pet.html / pet.js         # 渲染层入口：模型加载、初始化、window.__pet
├── renderer/                 # 渲染层拆分后的模块（按顺序加载，共享全局词法作用域）
│   ├── state.js          # 共享状态与常量（跨文件唯一声明处）
│   ├── ui.js             # HUD / 黄卡 / 计数 / 复习标签
│   ├── audio.js          # WebAudio、口型包络、播放
│   ├── speech.js         # 语音队列、打断、回显
│   ├── rec.js            # 录音、WAV 预处理、识别调用
│   ├── cards.js          # 卡片与讲评渲染
│   ├── modes.js          # 各模式流程（出卡/判分/会话）
│   ├── model.js          # 模型加载、取景、视线与口型写入点
│   └── app-ui.js         # 模式切换、档位菜单、按钮对齐
├── settings/                 # 设置窗口（独立 preload，只有配置接口）
│   ├── index.html
│   ├── app.js            # 设置编排
│   ├── core.js           # DOM 工具 + SettingsApp 模块注册表
│   ├── tts.js            # TTS（引擎/声线/参数）
│   ├── asr.js            # ASR（后端/模型/GPU）
│   ├── llm.js            # LLM（模型/key/测试）
│   ├── live2d.js         # Live2D（模型/取景）
│   ├── maintenance.js    # 数据 / 开机自启 / 窗口大小
│   ├── assets.js         # 「资源」区（IIFE）：状态、拖放、批量确认、安装进度
│   ├── data.js           # 「数据/也算对」（IIFE）
│   ├── memory.js         # 「记忆」查看/编辑/删除（IIFE）
│   └── shortcuts.js      # 「快捷键」（IIFE）
├── ui.css                    # 共用设计令牌（圆角 / 配色 / 字号 / 间距）
├── preload-settings.js       # 设置窗口专用桥
├── CHANGELOG.md              # 版本变更记录
├── asr.py                # 本地语音识别服务（mlx-whisper）
├── tests/                    # node:test 行为测试（npm test）
├── agent/
│   ├── llm.js            # 模型调用（DeepSeek / Ollama / mock 三层降级）
│   ├── persona.js        # 稳定人格卡（语气 / 节奏 / 边界）
│   ├── persona-scenes.js # 行为 few-shot（毒舌 / 收住 / 短回答）
│   ├── prompt.js         # 组合 persona + 模式规则 + JSON 契约
│   ├── model-actions.js  # 扫描当前模型可触发的表情 / 动作
│   ├── memory.js         # 轻量人格记忆（profile/relation/episodes）
│   ├── memory-extract.js # 每 6 轮提取长期记忆 patch
│   ├── slang.js          # 会話模式网络用语 / 假名歧义提示块
│   ├── lang-guard.js     # 日语字段的简体中文/中文短语污染守卫
│   ├── tts.js            # 语音合成适配（VOICEVOX / Aivis）
│   ├── tts-config.js     # TTS 引擎/URL/名字/路径 env 的唯一解释层
│   ├── tts-engine.js     # TTS 引擎进程管理（发现/启停/切换/健康）
│   ├── curriculum.js     # 词表读取与分档
│   ├── config.js         # 用户配置（settings.json / .env）唯一读写入口
│   ├── env.js            # .env 解析（保证 config/llm/tts 读同一份）
│   ├── providers.js      # 服务商与模型目录（模型名 → 接口地址）
│   ├── jsonfile.js       # 原子写 JSON（先写临时文件再 rename）
│   ├── vocab-daily.js    # 每日批次 / 復習模式 / 默写判定
│   ├── wordbook.js       # 长期词库：seen/ok/wrong/skip/streak
│   ├── eventlog.js       # 追加日志工厂（单词/句型各自一套）
│   ├── patterns.js       # 句型数据（读 patterns-*.json）+ 判定工具
│   ├── patternbook.js    # 句型的状态记录（独立于词库）
│   ├── pattern-daily.js  # 例文模式的批次 / 判定
│   ├── kanji2kana.js     # 汉字 → 假名（复现判定用，词干表驱动）
│   ├── backup.js         # 学习数据导出 / 导入 / 从备份恢复 / 清空
│   ├── voice-cache.js    # 固定短句的语音缓存（提示音）
│   ├── platform.js       # 平台差异（进程/端口/窗口/声线/引擎路径），main 只调用
│   ├── speech-text.js    # 朗读前文本规范化（笑声/缩写/年份/符号的规则表）
│   ├── asr-backends.js   # 识别后端、模型清单与 mlx 就绪判断
│   ├── asr-whispercpp.js # whisper.cpp 后端（本地 HTTP，Windows 与 mac 共用）
│   ├── tts-engines.js    # 引擎路径校验
│   ├── asset-install.js  # 资源识别/zip 解压/安全检查/备份/安装/回滚（选择路径时用）
│   ├── asr-log.js        # 识别日志（耗时/引擎/文本，2MB 轮转）
│   ├── boot-data.js      # 打包后数据目录 seed + 缺 jlpt 时回退
│   ├── schema.js         # 数据文件 schema 版本与迁移
│   ├── models.js         # Live2D 模型清单 + 每个模型的取景参数
│   └── romaji.js         # 假名 → 键盘拼写（IME 键入提示）
├── data/
│   ├── jlpt.json         # 原始 10,169 条 / 去重后 10,109 词（npm run build:jlpt 生成）
│   ├── word-levels.json  # 把合并的 N5–N4 拆成 N5/N4（tools/build-word-levels.mjs）
│   ├── kanji-stems.json  # 汉字词干 → 假名（tools/build-kanji-stems.mjs）
│   ├── patterns-n5.json  # 81 条 N5 句型（node tools/build-patterns.mjs n5）
│   ├── patterns-n4.json  # 98 条 N4（参数换 n4；n3/n2/n1 同理，合计 526 条）
│   ├── enrich-cache.seed.json # 公共例句种子（随仓库）
│   ├── enrich-cache.json      # 本地新增（忽略）
│   # 以下为本地状态，全部不进仓库（已 gitignore）：
│   #   wordbook.json / vocab-daily.json / settings.json
│   #   patternbook.json / pattern-daily.json
│   #   data/README.md 记录数据来源与许可证
│   #   wordbook.log.jsonl / patternbook.log.jsonl（及其 .1 归档、baseline）
│   #   backup/（导出导入前的快照）
├── model/Hiyori/         # Live2D 模型（用户自备，不随仓库）
├── lib/                  # Cubism Web Core（用户自备，不随仓库）
├── assets/AppIcon.icns   # macOS 应用图标（build-app.sh / electron-builder）
├── assets/icon.ico        # Windows 应用图标（electron-builder）
├── assets/logo/           # NH mark、发夹、小尺寸导出
├── assets/cover/          # 视频封面（760×1120 SVG + PNG）
├── .voice/               # 运行时音频（TTS 输出、录音、cache/ 提示音缓存，均 gitignore）
├── requirements.txt      # Python 依赖（mlx-whisper 等）
├── tools/
│   ├── setup.sh          # 一键装依赖（macOS）
│   ├── setup.mjs         # 跨平台环境体检 + 生成 .env（Windows 用这个）
│   ├── setup-whisper.mjs # npm run setup:whisper：编 whisper-server + 下/校验模型
│   ├── setup-mlx.mjs     # npm run setup:mlx：mlx venv + 预热模型
│   ├── build-app.mjs     # 统一 lite、mac/Windows 构建入口
│   ├── snapshot-readings.mjs # npm run snapshot:readings：生成读音快照
│   ├── build-app.sh      # 底层 mac 壳打包脚本
│   ├── scan.mjs          # npm run scan：项目自检（自动发现 agent 模块）
│   ├── replay-log.mjs    # 从追加日志重建快照
│   ├── build-jlpt-data.mjs   # 生成 data/jlpt.json
│   ├── build-word-levels.mjs # 生成 data/word-levels.json（N5/N4 拆分）
│   ├── build-kanji-stems.mjs # 生成 data/kanji-stems.json（汉字→假名，复现判定用）
│   ├── build-patterns.mjs    # 生成 data/patterns-*.json（OpenJLPT + 中文 + 例句读音）
│   ├── build-pattern-readings.mjs # 只给已有数据补例句读音（不重新翻译）
│   ├── install-voicevox.sh
│   └── smoke.mjs         # npm run smoke：拉起 Electron 断言界面状态
└── docs/
    ├── README.md         # 文档地图（先看这个）
    ├── INSTALL.md        # 安装与首次启动
    ├── ASSETS.md         # 模型/Core/语音资产与路径总表
    ├── UI.md             # 界面行为
    ├── JAPANESE-RULES.md # 判分/复习/朗读/会话规则
    ├── AUDIO.md          # ASR/TTS 链路
    ├── DATA.md           # 数据文件/schema/备份
    ├── ARCHITECTURE.md   # 进程/模块/安全边界
    ├── DEV.md            # 测试/scan/smoke
    ├── BOUNDARIES.md     # 代码与测试边界
    └── windows/          # WINDOWS.md（安装/打包）+ ACCEPTANCE.md（构建验收）

根目录的 NOTES.md 是开发笔记与踩坑记录。
```

## 两种结构视角

同一套代码可以按“逻辑 8 文件”看，也可以按“实际展开模块”看。前者用来理解边界，后者用来找文件。

### 1. 逻辑 8 文件

```text
main.js
  = main.js + main/** + agent/**

preload.js
  = preload.js + preload-settings.js

pet.html
  = pet.html

pet.js
  = pet.js + renderer/**

settings/index.html
  = settings/index.html

settings/app.js
  = settings/app.js + settings/*.js

ui.css
  = ui.css
```

这是最小的维护单元：

```text
主进程 + agent
两个 preload
两个页面
两个页面脚本
一份共享样式
```

### 2. 实际展开模块

```text
main.js                 342   窗口/启动/装配
main/window.js          380   窗口、层级、穿透
main/ipc.js              78   IPC 装配 + 守卫
main/ipc/pet.js         332   桌宠通道
main/ipc/settings.js     42   设置通道装配
main/ipc/config.js      315   配置/资源/安装/自检
main/voice.js           106   TTS 合成/缓存/自检
main/asr.js             192   识别生命周期
agent/tts-engine.js     298   引擎发现/启停/切换
agent/asset-install.js  302   资源识别/解压/安全检查/安装
agent/**                52 个模块（LLM/人格/词典/数据/平台）
preload*.js              2 个桥
pet.html / pet.js        渲染层入口
renderer/**             10 个模块
settings/index.html            设置页
settings/app.js              36   设置编排
settings/core.js          29   DOM 工具 + 模块注册表
settings/tts.js          234
settings/asr.js          237
settings/llm.js          184
settings/live2d.js        66
settings/maintenance.js  133
settings/assets.js       208   资源状态/拖放/安装面板
settings/data.js / settings/memory.js / settings/shortcuts.js
ui.css                   设计令牌
```

### 3. 两种视角的关系

```text
逻辑 8 文件 = 运维/架构讨论时的“层”
实际模块   = 开发时的“文件”
```

判断标准：

- 逻辑层不能混：`main`、`agent`、`preload`、`renderer` 各司其职。
- 实际文件可以拆：只按职责拆，不为凑文件数。
- 当前实际模块数多于 8，但每个模块更小，属于“比最小结构更细”。

当前仍然偏大的文件：

```text
agent/llm.js          642
renderer/app-ui.js    606
renderer/modes.js     575
main/ipc/pet.js       332
agent/asset-install.js 302
main/ipc/config.js    315
settings/assets.js    208
```

这些模块职责仍然单一，暂时不再拆。

## 资源拖放安装

设置 → 资源区支持把本地文件/zip 拖进来，安装 Live2D Core、模型、ASR 模型、Aivis 声线和 TTS 引擎。

### 数据流

```text
settings/index.html #assetDropZone
  → settings/assets.js
      filePath(file)          preload 用 webUtils 取本地路径
      previewAsset({src})     主进程只识别，不写盘
  → main/ipc/config.js
      cfg:preview-asset
      cfg:install-asset
  → agent/asset-install.js
      classify → 解压 → 校验 → 备份 → 原子替换
  → 安装后自检
      TTS /speakers
      ASR /health
      Live2D loadPet
```

### 支持类型与目标

```text
live2dcubismcore.min.js  → 当前资产根/lib/
*.model3.json 的 zip      → 当前资产根/model/<目录名>/
ggml-*.bin                → 当前 ASR 模型目录（打包 Windows 为 userData/.whisper/models）
whisper CUDA zip          → userData/asr/cuda-12.4 或 cuda-11.8（按 zip 内 DLL 识别）
*.aivmx                   → AivisSpeech-Engine/Models/
vv-engine/run(.exe)       → .voicevox/...（Windows 为 .voicevox/windows/...）
AivisSpeech-Engine/run(.exe) → .aivis/...
```

当前资产根：开发/源码运行是项目根，打包 asar 是 `userData/assets`；设置页显示实际写入根。

单文件和 zip 都按内容识别，拖错类型直接拒绝。批量拖入时先逐项识别，再在设置页内确认，能识别的继续安装，识别失败的单独列出。

### 安全与可靠性

```text
只接受本地路径，不接受客户端指定目标
zip 检查绝对路径/..、文件数、单文件大小、总解压体积
符号链接目标不允许绝对路径/..
解压写入使用 original-fs，避开 Electron 的 .asar 拦截
覆盖前备份；自检失败回滚旧资源
```

### 当前限制

```text
只支持单文件和 zip，不支持直接拖目录
AivisSpeech 启动时会自动从 AivisHub 恢复默认声线，删除默认声线后仍会回来
ASR 自检的 loading 只表示“已安装、服务加载中”，不是 ready
```

## 安全边界（本地静态服务 + CSP）

两个窗口都声明了 **Content-Security-Policy**：`script-src 'self'`、`connect-src 'self'`、
`object-src 'none'`，不允许内联脚本、远程脚本和 `unsafe-eval`（PixiJS 用官方
`@pixi/unsafe-eval` 补丁代替）。配合 `contextIsolation` / `sandbox` / 静态服务白名单，
即使某处转义漏了，注入的脚本也拿不到 Node、发不出跨域请求。

`npm run scan` 的 `[10]` 会检查这条边界没被放宽。

## 本地静态服务的安全边界

渲染层通过 `http://127.0.0.1:<随机端口>` 加载页面和资源，这个服务做了三层限制：

1. **Host 校验**：只接受 `127.0.0.1` / `localhost`，挡 DNS rebinding
2. **先拦逃逸再做归一化**：含 `..` 段 / 反斜杠 / 空字节的路径一律 404（`/model/../.env`、`/model/%2e%2e/.env` 都在此列）；`./` 与 `//` 这类等价写法归一化后照常放行
3. **白名单**：只放行 `pet.html`、`pet.js`、`lib/`、`model/`、`node_modules/pixi*`、`.voice/say.wav`

也就是说 `.env`、`data/*.json`、`.voice/rec-*.wav` **不可能通过 HTTP 读到**（录音永远不会出网）。

## 工作原理

```
麦克风 ─► 裁静音/归一化 ─► Whisper(本地) ─► 大模型 ─► 文本 + 结构化 JSON
                                                  │
                                  VOICEVOX / AivisSpeech ◄┘
                                          │
                                WAV 音量驱动 Live2D 口型
```

- **语音识别本地跑**（默认 whisper.cpp；mac 可选 mlx-whisper），音频不出本机
- **对话文本发给大模型**（默认 DeepSeek）
- **口型**由播放音频的实时音量驱动，不依赖预训练口型数据
- 引擎/子进程与应用同生命周期：启动拉起、退出 `SIGTERM→SIGKILL`、崩溃后按端口清理残留

---

## 页面 CSP

`pet.html` / `settings/index.html` 都带严格 CSP：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' blob: data:;
connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'
```

要点：

- **不开 `unsafe-eval`**：PixiJS 7 内部用 `new Function`，所以加载官方补丁
  `node_modules/@pixi/unsafe-eval/dist/unsafe-eval.min.js`（必须在 `pixi.min.js` **之后**）
- 不开内联脚本：页面里所有逻辑都在外链 js，`scan [10]` 会拦内联 `<script>`
- `style-src` 仍需要 `'unsafe-inline'`：界面大量使用 `style="..."` 属性与 JS 直接改样式
- `media-src` 放 `'self'` 就够：TTS 产物走同源 `/.voice/*.wav`，不走 blob

改 CSP 后至少验证三处：Live2D 能渲染、设置窗口能开、语音能播（静默失败最坑）。

## 平台差异集中在 agent/platform.js

以前 `main.js` 里 `IS_WIN ? ... : ...` 有十六处，改一个平台行为要满文件找。现在分两类：

| 类型 | 例子 | 测试 |
|---|---|---|
| 常量 | `IS_WIN` / `IS_MAC` / `IS_LINUX` / `ROOT` | — |
| 纯解析 | `parseNetstatListeners` / `parseLsofListeners` / `parsePidCommand` | ✅ 固定字符串喂进去 |
| 系统调用 | `killPid` / `portOwner` / `isOurs` / `openPath` | 失败返回空，不抛 |
| 行为差异 | `titleBarStyle` / `supportsAllWorkspaces` / `asrBackendFor` / `voicevoxEngineCandidates` / `childPath` | ✅ 按平台断言 |

约定：系统调用失败**返回空值不抛**（和原来的行为一致），解析单独拆出来是为了能测——
Windows 的 `netstat -ano` 输出（IPv4/IPv6、LISTENING/ESTABLISHED）和 mac 的 `lsof -t` 都能在 CI 里断言。

## 目录一变，打包白名单就要跟着变

`build.files` 是**白名单**：新增目录（比如 `renderer/`、`main/`）不写进去，开发模式完全正常，
装出来的包才会坏——主进程 `require` 直接 ENOENT，页面脚本 404。

`model/` 与 `lib/live2dcubismcore.min.js` 由用户自备（见 `docs/ASSETS.md`），
打包前 `npm run check:assets:lite` 会检查；`npm run scan` 允许这两个路径缺失。

`npm run scan` 的 `[11] 打包覆盖` 会拦住这类问题：

- 扫 `main.js` / `agent/*.js` / `main/*.js` 里的相对 `require`
- 扫 `pet.html` / `settings/index.html` 的 `<script src>` / `<link href>`
- 每个都要能被 `build.files` 的 glob 匹配到（支持 `**`、`*`、`?` 和 `!` 排除）

`node_modules/` 由 electron-builder 自动带，不检查。

## 打包只带小模型

`build.files` 里 `.whisper` 只列三项：

```
.whisper/whisper-server        # mac（arm64）
.whisper/whisper-server.exe    # Windows
.whisper/models/ggml-small-q5_1.bin   # 181MB
```

不打包 `.whisper/build/`（源码+编译产物，91MB）与另外两个模型（465MB / 547MB）。
`scan [11]` 会拦住把 `.whisper/**` 写回去的改动。

打包后 `.whisper` 落在 `app.asar.unpacked/`（asar 里的可执行文件不能 spawn），
main.js 会设 `process.env.WHISPER_HOME`，ASR 与设置页的模型列表都读这个变量。

## main/ 模块的注入边界

`main/` 下的模块不持有 main.js 的变量，全部通过工厂参数/ctx 注入。裸用会变成运行时
ReferenceError——开发时不一定触发，点某个按钮才炸（设置按钮就是这样坏了一天）。

`scan [12]` 会拦：`win` / `settingsWin` / `IS_WIN` / `IS_PACKAGED` / `levelIdle` / `passThrough`
（`platform.IS_WIN` 这种成员访问不算）。

拆模块时的顺序约定：**先 require 所有依赖，再创建工厂实例**。已经踩过三次 TDZ
（voice / asr / ipc），现象都是 `App threw an error during load` + smoke 超时。

## IPC 的两侧守卫

| 侧 | 守卫 | 说明 |
|---|---|---|
| 设置窗口 | `settingsHandle` | 内部校验 `e.sender === settingsWin.webContents`，否则 throw |
| 桌宠窗口 | `petHandle` / `petOn` | 内部校验 `fromPet(e)`，非桌宠窗口拒绝/忽略 |

`main/ipc.js` 里定义 `settingsHandle`，4 个设置域模块直接用它注册，不再自己写守卫。
`scan [2]` 会拦「pet:* 直接用 ipcMain.handle/on」与「cfg:* 不用 settingsHandle/settingsOn」——
两侧对称，保证新加的通道默认带守卫。

## 别让 try/catch 吞掉注入错误

`cfg:voices` 曾经一直返回 `{ok:false}`，界面显示「（引擎启动中…）」并每 2 秒重试——
看起来像引擎没起来，实际是 `ensureVoicevox` 没注入，抛 ReferenceError 被 catch 吞了。

教训：handler 里 `catch (e) { return { ok:false, error } }` 会把编程错误伪装成运行时错误。
`scan [12]` 会检查 `main/ipc.js` 里用到的服务函数是否都在 ctx 解构中；
`scan [13]` 对 `main/ipc/*.js` 双向检查：解构了必须传进来，用了 ctx 名必须解构。

## 拆完模块后的逐通道巡检

拆分后最容易漏的是「ctx 里少一个字段」，而且往往被 try/catch 吞成业务错误。巡检方法：

```
pet 侧：用 PET_EVAL 依次调用 level/word/pattern/chat-status/asr-health/speak/
        save-audio/issue/typing/mouse，记录返回与主进程 "Error occurred" 计数
设置侧：用 PET_SETTINGS_EVAL 依次调用 cfg:get/asr-options/voices/models/data-info/
        preview-voice/set-asr/set-voice/set…
```

注意：`cfg:data-export` 会弹保存对话框、`cfg:test-llm` / `pet:chat` 会走网络，巡检时跳过。
数据类通道用 `NIHONCO_DATA_DIR` 指到临时目录，自动化钩子在场时 `data-reset` 会被安全闸拦住。

`scan [12]` 现在静态兜底：ipc.js 的解构字段必须都在 main.js 的 `createIpc({...})` 里。

## 主动开口调度（未实现）

> 阶段 2 设计；当前只有右键「说话…」，没有自动开口定时器。

主动**内容**属于人格（`persona.casualPrompt()`）；主动**时机**属于运行时调度。

### 决策输入

```js
decide({
  mode,
  lastUserAt,
  lastSpeakAt,
  lastProactiveAt,
  busy,
  recording,
  speaking,
  muted,
  hidden,
  minimized,
  now,
})
```

### 规则草案

```
只在会話 / 解説
必须空闲
不打断录音 / 朗读 / 输入
用户刚说完不抢话
冷却 10 分钟
一小时最多 1–2 次
对方长时间没说话才考虑

最小化 / hidden 时计时暂停
不在不可见时开口
恢复可见后不立刻补一次
仍然遵守冷却
```

```
隐藏时暂停的是“可开口的计时”
不是取消冷却
```

### 暂不实现

```
· 空闲定时器
· 根据屏幕/应用状态主动开口
· 情绪驱动的主动
```

## 已知结构问题

按影响排序，已做轻量缓解，但还没彻底拆：

1. **渲染层仍是经典脚本**：`renderer/*.js` 共享全局词法环境，靠加载顺序和
   `state.js` 的唯一声明维持；跨文件状态已集中到 `state.js`，`scan [14]` 现在会检查
   pet 页与 settings 共享作用域的顶层重复声明（支持缩进/正则字面量），
   IIFE 模块内部不参与跨文件比较。
2. **设置页核心已经收小**：`settings/app.js` 只做注册、保存、关闭；TTS/ASR/LLM/Live2D/
   维护/资源分别在自己的模块里。当前较大的设置模块是 `settings/assets.js`（拖放与安装 UI）。
3. **`agent/llm.js` 仍是门面 + 编排**（642 行，40+ exports）：enrich 缓存已拆到 `agent/enrich.js`；
   provider 配置、chat、pair、词/句型转发仍在一起，下一次改到哪块再拆哪块。
4. **设置/渲染层测试仍偏薄**：agent 和资源安装有单测；设置窗口有静态结构测试和
   `smoke:settings`，但拖放/安装面板还没有真实点击测试，仍需要手工验证。
