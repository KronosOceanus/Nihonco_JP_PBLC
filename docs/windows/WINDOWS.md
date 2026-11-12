# Windows：差异、安装与打包

> 当前验收版本：**v0.7.19**；后续 TTS/构建改动见 [CHANGELOG.md](../../CHANGELOG.md)。
>
> ⚠️ **公开仓库只提供 lite 构建（不含模型/Core）。**
> full 构建仅维护者在私有仓库内部使用，不提供命令。
>
> 编号沿用历史版本，所以有跳跃；历史记录已移除，保留当前可用的安装/打包流程。

> 合并自原来的 本文件第一部分（原理与差异）与 本文件第二部分（安装/打包实录），
> 避免同一件事写在两处、改一处忘另一处。
>
> **只是构建/验收：直接看 [ACCEPTANCE.md](ACCEPTANCE.md)。**

## 第一部分：平台差异与移植原理

> ⚠️ **这份是「移植方案」文档，移植已经完成了。**
> 真正怎么装、怎么打包、哪里会炸：见本文件「第二部分：Windows 安装与打包实录」。
> 本文保留下来是为了解释「为什么这么改」（平台差异清单、契约约束、分阶段验收标准），
> 以及作为将来做第三个平台时的参考。

> 目标：在 Windows 上跑起与 macOS 版**行为一致**的 Nihonco。
> 这份文档是给"在 Windows 上用 DSH 接手的自己/其他人"看的：先读第 1–3 节，
> 然后按第 6 节的分阶段计划逐段推进，每段都有验收标准。
>
> 第一部分是移植期的方案记录（部分数字/推荐是当时状态），
> 实际安装、打包、命令以第二部分和 [INSTALL](../INSTALL.md) 为准。

---

### 1. 这个项目是什么

一个 Electron 桌面挂件：Live2D 角色 + 本地语音识别 + 云端大模型 + 语音合成。

```
麦克风 ──► 录音（WebAudio，直接生成 16k WAV）
              │
              ▼
        本地 ASR 服务（HTTP :8765，POST /asr，返回 {text, ms}）
              │
              ▼
        大模型（OpenAI 兼容 http API）→ 回复文本 + 结构化 JSON
              │
              ▼
        语音合成（HTTP :50021 VOICEVOX / :10101 AivisSpeech）→ WAV
              │
              ▼
        <audio> 播放 + 实时音量驱动 Live2D 口型
```

关键点：**ASR 与 TTS 都是"本地 HTTP 服务 + 固定契约"**。
Windows 版只要让这两个服务满足同样的契约，上层代码几乎不用改。

---

### 2. 代码地图（哪些要改，哪些别碰）

| 文件/目录 | 职责 | Windows 版 |
|---|---|---|
| `main.js` | 主进程：窗口、静态服务、子进程生命周期、IPC | **要改**（已实现，按平台分支） |
| `pet.html / pet.js` | 渲染层：Live2D、录音、口型、模式与卡片 | 基本不动（纯 Web） |
| `settings/ / preload*.js` | 设置窗口与两个 preload | 基本不动 |
| `ui.css` | 设计令牌 | 不动 |
| `agent/*.js`（除 tts/asr 相关） | LLM、词库、句型、配置、备份、日志 | 不动 |
| `agent/tts.js` | 调 VOICEVOX（50021）或 AivisSpeech（10101） | **不用改**（两者都走 VOICEVOX 兼容 API） |
| `agent/models.js` | Live2D 模型清单 + 每个模型的取景（半身倍数/左右/上下） | 不用改；模型文件要自己放到 `model/` |
| `asr.py` | mlx-whisper（仅 Apple Silicon） | **重写**为 Windows 可跑的识别服务（见 §4） |
| `tools/*.sh` | bash 安装/打包脚本 | **重写**为 PowerShell 或 Node 脚本 |
| `agent/asr-backends.js` | 识别后端/模型清单（设置窗口用） | Windows 只显示 whisper.cpp；mlx 项被隐藏 |
| `tools/setup-whisper.mjs` | 一键准备 whisper.cpp（mac 编译） | **Windows 只打印预编译包链接**，不编译 |
| `tools/smoke.mjs` | 端到端冒烟（拉起 Electron 读 DOM） | 可复用；已按平台选 `Electron.app` / `electron.exe` |
| `agent/asr-whispercpp.js` | **已实现**：whisper.cpp 识别服务（对外契约同 asr.py） | — |
| `agent/boot-data.js` | **已实现**：打包后数据目录 seed + 缺 jlpt 时回退 | — |
| `model/ lib/` | Live2D 模型与 Cubism Core | 不动（跨平台；**用户自备，不随仓库**） |
| `data/*.json` | 词表、句型、拆分表 | 不动（纯数据） |

---

### 4. 语音识别（实际实现：whisper.cpp）

Windows 不跑 `asr.py`。实际实现是 `agent/asr-whispercpp.js`：主进程 spawn
`whisper-server.exe`，监听 `127.0.0.1:8765`，对外契约与 mac 版一致，**不需要 Python**。

```
麦克风 → 16k WAV → POST /asr?lang=ja&prompt=<热词>
     → whisper-server（模型常驻）→ {text, ms, lang, dur}
```

- 模型：`ggml-small-q5_1.bin`（181 MB），`npm run setup:whisper` 下载
- 二进制：`whisper-server.exe` + `whisper.dll` / `ggml*.dll`，从 whisper.cpp b5454 解压到 `.whisper/`
- 热词：主进程把当天批次 + 错题本拼成 `prompt`，整词截断到 60 字；服务端作为 `initial_prompt`
- GPU：设置 → ASR → 识别加速，下载 CUDA 版（可选，缺 `ggml-cuda.dll` 会静默回 CPU）

旧方案（faster-whisper）已放弃：需要 Python 环境，和“免 Python”的移植目标冲突。

### 5. 运行契约（改 Windows 时不要破坏这些）

### 5.1 HTTP 接口

| 服务 | 端口 | 接口 | 请求 | 响应 |
|---|---|---|---|---|
| ASR | 8765 | `POST /asr?lang=ja&prompt=<热词>` | `audio/wav` 字节 | `{text, ms, lang, dur, lp?}` |
| ASR | 8765 | `GET /health` | — | `{ok:true, model, requested, fallback, ready}` |
| TTS | 50021 / 10101 | VOICEVOX / AivisSpeech API | `/audio_query` + `/synthesis` | WAV 字节 |
| — | — | 设置面板取声线前会 `ensureVoicevox()`（最多等 10 秒） | — | — |

### 5.2 IPC 通道（61 个，按域注册）

```
main/ipc.js                 装配 + 桌宠/窗口通道
main/ipc/config.js          配置 / 模型 / 资源 / 开机自启
main/ipc/audio.js           声音 + ASR
main/ipc/data.js            导入导出 / 恢复 / 也算对
main/ipc/shortcuts.js       快捷键
```

约定：

- `pet:*` 必须走 `petHandle` / `petOn`（校验来源）
- `cfg:*` 必须走 `settingsHandle` / `settingsOn`（校验设置窗口）
- `scan [2]` 拦未包装的通道；`scan [13]` 双向检查 IPC 模块依赖

完整通道清单以 `main/ipc*.js` 为准，`npm run scan` 会做注册/调用对账。

### 5.3 数据文件（都在 `data/`，纯 JSON）

| 文件 | 内容 |
|---|---|
| `wordbook.json` / `patternbook.json` | 每个词/句型的 seen/ok/wrong/skip/streak/stage |
| `vocab-daily.json` / `pattern-daily.json` | 今天的批次、档位、对错统计 |
| `settings.json` | 全局水平 + 声线参数 |
| `wordbook.log.jsonl` / `patternbook.log.jsonl` | 追加日志（可重放重建快照） |
| `word-levels.json` / `kanji-stems.json` / `patterns-n*.json` | 随仓库的数据表 |

**这些格式跨平台通用**：Windows 版可以直接用你 mac 上导出的 JSON（设置窗口「导出…」）。

### 5.4 环境变量

`.env` 里 `LLM_*`、`ASR_*`、`VOICEVOX_*`、`PET_*` 全部只在 Node 侧读，跨平台无差异。
Windows 上注意：**不要在 `.env` 里写反斜杠路径**（用正斜杠或 `path.join`）。

---

### 7. 已知坑（mac 版踩过的，Windows 会重演）

| 坑 | 现象 | 对策 |
|---|---|---|
| 暂停音频没兑现 Promise | 之后所有交互"卡住"（dailyBusy 不释放） | `stopSpeech()` 里必须 resolve 旧 Promise；已有 45 秒兜底 |
| 桌宠自己打断自己 | 提示音被卡片语音切掉 | 已有语音队列：`runSpeech()` 串行 + `bargeIn()` 只给用户操作 |
| 合成窗口内被用户打断 | 旧语音 1 秒后又冒出来 | `speakNow()` 合成完再查代际号 |
| 子进程残留 | 端口被占、下次启动失败 | `.voice/procs.json` 登记 + 只杀自己的；Windows 用 `taskkill /T /F` |
| 测试写到真实数据 | 进度被清空 | `tests/_env.mjs` 强制 `NIHONCO_DATA_DIR` 到临时目录；**Windows 上同样要守住** |
| 静态服务路径逃逸 | 能读到 `.env` | 已有三层防护（Host 校验 / 拒绝 `..` / 白名单），别简化 |

---

### 8. 测试与自检

```bash
npm test        # 322 个行为测试（跨平台；用例数随新增测试变化）
npm run smoke   # 端到端冒烟：真启动 Electron 切模式断言显隐（需图形界面）
npm run scan    # 结构扫描：模块导出、IPC 对账、DOM id、死代码
```

**哪些测试可能要改**：
- `tests/recording.test.mjs`：断言的是源码里的字符串（`bargeIn()` 调用），与平台无关 → 不改
- 其余全部是纯逻辑/数据测试 → 不改
- `npm run smoke` 会 spawn Electron：Windows 上走 `node_modules/electron/dist/electron.exe`，
  并用临时 `NIHONCO_USER_DATA` 避免撞单实例锁（应用开着也能跑）
- **`tests/asr-contract.test.mjs` 会读 `asr.py` 源码**，断言 `transcribe()` 有 `hotwords` 参数、
  调用参数个数 ≤ 签名、HTTP 层读 `prompt`、`/health` 回报 `requested`/`fallback`。
  Windows 版如果换成独立服务（不走 `asr.py`），这条测试要**改写或删除**，否则会红
- 如果你的 Windows 版改了 `/asr` 的返回结构，`scan` 不会发现（它只查 JS 侧）→ 手动对照 §5.1

---

### 9. 交付物清单

> ✅ 下面这些已经全部做完并实测过一遍，具体命令、体积、踩坑记录见
> 「第二部分」。

- [x] `main.js` 的平台差异都有 Windows 分支（`process.platform === 'win32'` 判断，**mac 代码保留**）
- [x] `asr.py`（或新服务）满足 §5.1 契约，`/health` 可用 —— 实际走了 **whisper.cpp**（`agent/asr-whispercpp.js`），免 Python
- [x] `tools/setup.mjs`（`npm run setup`）：环境体检 + 复制 `.env`，缺什么会打印下载地址
- [x] `package.json` 里有 `build:win` / `build:win:portable` / `build:win:nsis` / `build:win:dir`
- [x] README 增加「Windows 版」小节
- [x] `model/` 与 `lib/` 自备（仓库不分发 Hiyori / Cubism Core，见 `docs/ASSETS.md`）
- [x] `npm test`（322）+ `npm run scan`（全绿）+ `npm run smoke`（6 步全过）
- [x] 一次完整回归：开窗口 → 说话（whisper.cpp 识别）→ 回复 → TTS（VOICEVOX 小夜）→ 学习模式 → 换档 → 打包 → 安装 → 再启动

---

### 10. 参考资料

- VOICEVOX Windows 版：<https://github.com/VOICEVOX/voicevox/releases>
- whisper.cpp：<https://github.com/ggml-org/whisper.cpp>
- Live2D 示例模型 / Cubism Core：见 [docs/ASSETS.md](../ASSETS.md)
- electron-builder（Windows 目标）：<https://www.electron.build/>
- Live2D Cubism SDK 跨平台说明：<https://www.live2d.com/sdk/about/>

---

### 11. 给接手者的一句话

**先别改渲染层。** `pet.js` 里 90% 的复杂度（语音队列、模式切换、卡片判定）都是平台无关的，
mac 版已经踩过的坑都写在 §7。Windows 版真正的工作量在**三个进程**：ASR 服务、VOICEVOX、系统 TTS。
把这三个换成 Windows 能跑的、并且**保持接口不变**，剩下的就是打包和窗口手感。

---

## 第二部分：Windows 安装与打包实录

> 这份文档记录的是**实际做过一遍**的 Windows 移植与打包流程，不是计划。
> 实测时版本：`Nihonco 0.3.12`（流程仍适用；命令、资产、通道数已按 v0.6.7 更新），2026-11 实测于
> Windows 10 Home China 26H2 (build 26300)、Ryzen 7 5800H / RTX 3060 Laptop / 16 GB。
>
> 配套的「要改什么、为什么」看 「第一部分」；
> 本文只讲「怎么装、怎么打、哪里会炸、炸了怎么办」。

---

### 0. 一句话结论

mac 版的渲染层（`pet.js` / Live2D / 卡片逻辑）**一行没改**就能在 Windows 上跑；
真正的工作量集中在三个外部进程：**ASR（换成 whisper.cpp）**、**TTS（换成 Windows 版 VOICEVOX）**、
**进程管理（`ps` / `lsof` / `SIGTERM` 换成 Windows 等价物）**，最后加一层**打包后的可写目录改造**。

---

### 1. 环境清单（本机实测版本）

| 组件 | 版本 | 装法 |
|---|---|---|
| Node.js | **18+**（实测 v24 LTS） | 官方 MSI，`InstallAllUsers=1 PrependPath=1` |
| Electron | 45.2.1 | 项目 devDependency，`npm ci` 下载 |
| electron-builder | 26.18.0 | `npm i -D electron-builder` |
| whisper.cpp | **b5454**（`whisper-bin-x64.zip`，CPU 版） | 解压到项目 `.whisper/` |
| Whisper 模型 | `ggml-small-q5_1.bin`（181 MB） | `npm run setup:whisper` 下载；打包只带这个 |
| VOICEVOX | **0.26.1**（`voicevox-windows-cpu-0.26.1.zip`，2.07 GB） | 解压到 `.voicevox/windows/` |
| Python | 3.12.9（**可选，本方案不需要**） | whisper.cpp 路线下完全用不到 |

> Python 不是必需项。选 whisper.cpp 的全部意义就是**免 Python**：
> 一个静态链接的 exe + 一个 ggml 模型文件，塞进安装包就能跑，用户不需要装任何运行时。

---

### 2. 一次性准备

### 2.1 Node.js

```powershell
curl.exe -L -o node-v24.22.2-x64.msi https://npmmirror.com/mirrors/node/v24.22.2/node-v24.22.2-x64.msi
Start-Process msiexec.exe -ArgumentList '/i',"`"$PWD\node-v24.22.2-x64.msi`"",'/qn','/norestart' -Verb RunAs -Wait
```

### 2.2 项目依赖

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
cd <项目目录>
npm ci
node node_modules/electron/install.js
```

### 2.3 whisper.cpp（ASR）

**v0.3.16 起用 `npm run setup:whisper` 一把过**（Windows 上它会：检查二进制 → 检查 DLL → 缺模型就下）：

```powershell
npm run setup:whisper          # 模型下到 .whisper/models/ggml-small-q5_1.bin（181 MB）
npm run setup:whisper -- --check   # 只看计划、不下载
```

二进制还是要手动解压（脚本不代下预编译包）：

```powershell
curl.exe -L -o whisper-bin-x64.zip `
  https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip
Expand-Archive whisper-bin-x64.zip -DestinationPath .\.whisper -Force
Move-Item .\.whisper\Release\* .\.whisper\ -Force; Remove-Item .\.whisper\Release -Recurse
```

目录结构：

```
.whisper/
├── whisper-server.exe          ← 主进程 spawn 它，模型常驻内存
├── whisper.dll                 ← 必需（exe 是动态链接的，光有 exe 起不来）
├── ggml.dll / ggml-base.dll
├── ggml-cpu-*.dll              ← 按 CPU 指令集分派的多个后端，别删
└── models/ggml-small-q5_1.bin  ← 打包白名单只收这一个（181 MB 量化版）
```

> **打包白名单**（`package.json` 的 `build.files`）只带：
> `whisper-server[.exe]` + `whisper.dll` / `ggml.dll` / `ggml-base.dll` / `ggml-cpu-*.dll`
> + `models/ggml-small-q5_1.bin`。
> 别的 exe（`whisper-cli` / `parakeet-*` / `wchess`…）和 `ggml-small.bin`（465 MB 全量版）
> **不会进包**，所以 `.whisper` 里留着它们不影响安装包体积。

换模型：`ASR_MODEL=q5_1` 这类文件名，或 `ASR_MODEL_FILE=<绝对路径>`；设置窗口的下拉列的是
`.whisper/models/*.bin`（按体积升序），没配置时用最小的那个。

### 2.4 TTS：VOICEVOX / AivisSpeech

**必须装一个**：Windows 没有日语 SAPI 声线（本机只有 Huihui 中文 / David / Zira / Hazel 英文），
缺引擎就完全不发音，HUD 提示「缺日语语音引擎（VOICEVOX / AivisSpeech），暂时没法出声」。

VOICEVOX 放 `vv-engine`，AivisSpeech 放 `AivisSpeech-Engine`；Nihonco 会按标准安装位置、
`VOICEVOX_ENGINE` / `AIVIS_ENGINE`、以及设置页手动路径查找。切换引擎后会停旧启新。

```powershell
curl.exe -L -o voicevox-windows-cpu.zip `
  https://gh-proxy.com/https://github.com/VOICEVOX/voicevox/releases/download/0.26.1/voicevox-windows-cpu-0.26.1.zip
7z x voicevox-windows-cpu.zip -o.voicevox\windows -y
```

放置位置（`main.js` 的 `VV_ENGINE` 按这个顺序找）：

1. `VOICEVOX_ENGINE` 环境变量（最高优先级）
2. `<安装目录>\resources\..\.voicevox\windows\VOICEVOX\vv-engine\run.exe` ← 开发期/绿色版
3. `.voicevox\windows\vv-engine\run.exe`（同上，不带 `VOICEVOX\` 一层）
4. **`%APPDATA%\Nihonco\.voicevox\windows\VOICEVOX\vv-engine\run.exe`** ← **装好的版本走这条**
5. `%ProgramFiles%\VOICEVOX\vv-engine\run.exe` ← 官方安装器
6. `%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe`

> 第 4 条是给**安装版**准备的：装到 `Program Files` 后没有写权限，引擎只能放用户目录。
> 不想复制 2.5 GB 的话，建一个目录联接就行（不需要管理员）：
>
> ```cmd
> mklink /J "%APPDATA%\Nihonco\.voicevox" "<项目目录>\.voicevox"
> ```
>
> 已经开着 `VOICEVOX.exe` 的用户：`tts.alive()` 探到 `:50021` 有响应就不会再 spawn，不会撞端口。

---

### 3. 代码改动清单

全部用 `process.platform === 'win32'` 分支，**mac 代码原样保留**。

| 文件 | 改动 | 原因 |
|---|---|---|
| `main.js` | 新增 `IS_WIN` / `IS_PACKAGED` | 后面所有分支的开关 |
| `main.js` | `USER_DATA`：打包后回落到 `app.getPath('userData')` | asar 只读，原代码把 userData 写在项目里 |
| `main.js` | 打包后把 `app.asar.unpacked/data/*.json` 播种到 `%APPDATA%\Nihonco\data`，并设 `NIHONCO_DATA_DIR` | 词库/设置要可写；且 `agent/*` 在 require 时就读 `DATA_DIR`，顺序必须在 require 之前 |
| `main.js` | `VOICE_DIR` 打包后指向 `USER_DATA/.voice`；静态服务器 `/.voice/*` 从 `USER_DATA` 取 | TTS 产物目录 + 播放 URL 要跟得上 |
| `main/voice.js` | ~~`speakWithSapi()`~~ → **v0.3.17 起删除**：Windows 缺 TTS 引擎时直接抛「需要日语语音模型」，不再用中文声线念日文 | Windows 没有日语声线，兜底等于念乱码 |
| `main/voice.js` + `renderer/speech.js` | `pet:tts-health` + 启动自检 + 每次发音失败的 HUD 提示 | 让她「不出声」这件事有明确原因，而不是静默 |
| `main.js` | `VOICE` / `VOICE_JA` 默认值改 `Microsoft Huihui Desktop` | 没有日语声线，日语靠 VOICEVOX |
| `main.js` | `VV_ENGINE` 改成多路径探测（见 §2.4） | 兼容便携版 / 官方安装版 / 环境变量 |
| `main.js` | `startVoicevox()` 的 env：`USERPROFILE=VV_HOME`，PATH 不再拼 Homebrew | 引擎默认写 `%LOCALAPPDATA%`，要指到项目里 |
| `main.js` | `isOurs()`：`Get-CimInstance Win32_Process -Filter "ProcessId="` | 没有 `ps -p` |
| `main.js` | `portOwner()`：`netstat -ano -p TCP` 解析 LISTENING | 没有 `lsof` |
| `main.js` | `killPid()`：`taskkill /PID <pid> /T /F` | 没有 SIGKILL；`/T` 必须带，VOICEVOX 会派生子进程 |
| `main.js` | `startAsr()`：win32 走 `asrWhisper.start()` | 免 Python |
| `main.js` | `titleBarStyle: 'default'` | Windows 没有 `hiddenInset` |
| `main.js` | `setVisibleOnAllWorkspaces` 跳过 | Windows 无此概念 |
| `main.js` | `buildAppMenu()`：Windows 用 文件/编辑/视图/帮助，`Ctrl+Q` | mac 的 about/hide/hideOthers 在 Windows 无意义 |
| `main.js` | 退出钩子改 `killPid` + `asrWhisper.stop()` | 避免 whisper-server 残留占端口 |
| `main.js` | 预热前先 `await ensureVoicevox()`，且合成后复查 `tts.alive()` 才写缓存 | 否则会把 SAPI 的中文音按提示音的 key 缓存下来 |
| `main.js` | `pet:speak` 只在 `engine === 'voicevox'` 时写缓存 | 同上，杜绝中文音污染 |
| `main.js` | `VOICE_DIR` / `NIHONCO_VOICE_CACHE_DIR` 在 require 之前定义 | `voice-cache` 在模块加载时就定了目录，晚了就失效 |
| `agent/env.js` | 读 `.env` 的候选顺序：`NIHONCO_DATA_DIR/.env` → 项目根 `.env` | **打包后设置窗口保存的 key 写在用户目录，原来只读项目根 → 每次启动都要重填** |
| `agent/env.js` | 剥行尾注释（`空白 + #` 之后，引号内保留） | `.env.example` 每行都带注释，整串当值会让 `VOICEVOX_NAME` 匹配不上、模型名带注释 |
| `agent/voice-cache.js` | 支持 `NIHONCO_VOICE_CACHE_DIR` | 缓存目录必须和静态服务器读的目录是同一个 |
| `agent/asr-whispercpp.js` | 用 `loadEnv()`；`ASR_MODEL` 含 `/` 时忽略（mac 的 HF 仓库名） | `.env` 里是 `mlx-community/whisper-small-mlx`，Windows 上要回落 `ggml-small.bin` |
| `pet.js` | `startRec()` 返回布尔；按钮/空格都检查；`finishRec()` 早退时清掉「录音中」 | **第一次按麦克风时 getUserMedia 慢，松手后 pointerdown 仍补发 `hudShow("录音中…", 0)`，HUD 永久卡住** |
| `agent/asr-whispercpp.js` | **新增**：监听 8765，内层 spawn `whisper-server.exe`，保持 `/health` + `POST /asr` 契约 | 替代 `asr.py`；契约不变，上层零改动 |
| `tools/scan.mjs`、`tools/build-patterns.mjs` | `new URL(import.meta.url).pathname` → `fileURLToPath()` | Windows 上会得到 `/D:/...`，拼成 `D:\D:\...` 直接崩 |
| `tests/eventlog.test.mjs` | 同上，子进程 `require` 的路径 | 否则 `MODULE_NOT_FOUND` |
| `tests/asr-contract.test.mjs` | 改成按平台读 `asr.py` / `asr-whispercpp.js`，Windows 分支断言 Node 侧契约 | 原测试硬读 `asr.py`，Windows 上没有意义 |
| `package.json` | 加 `build` 段（nsis + portable 双 target）、`build:win*` 脚本、`setup` 改 `node tools/setup.mjs` | electron-builder 配置 |
| `package.json` | **删掉根上的 `"directories": {"lib":"lib"}`** | electron-builder 26 直接报错「deprecated」 |
| `.gitignore` | 加 `.whisper/` | 487 MB 不进仓库 |

### ASR 契约（与 `asr.py` 完全一致，别改）

```
GET  /health → {ok, engine, model, requested, fallback, ready}
POST /asr?lang=ja&prompt=<热词>
     body: audio/wav 字节
     200  → {text, ms, lang, dur}
```

- `prompt`（当天批次 + 错题本的词）作为表单字段 `prompt` 传给 `whisper-server`，等价于 `initial_prompt`。
- 主进程按整词截断到 60 字，服务端不再处理长度。

---

### 4. lite / full 构建规则

| | lite（默认） | full |
|---|---|---|
| 命令 | `build:win` / `build:win:dir` | 内部使用，不公开 |
| 模型 / Core | 不含 | 含 |
| Whisper | 含 | 含 |
| 资产位置 | 用户放 `%APPDATA%\Nihonco\assets` | 安装包内 |
| 分发 | 可公开 | 仅自己用，模型/Core 属于再分发 |
| 检查 | `check:assets:lite` | `check:assets` |

full 的 `build.files` 默认排除 `model/miku`、`model/樱花miku`、`model/重音`；
用这些模型请走 lite + 外置 assets。

### 4.1 构建命令

```powershell
cd <项目目录>
$env:path = "%ProgramFiles%\nodejs;$env:path"
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

# lite（默认）：不检查模型/Core
npm run check:assets:lite
npm start
npm run build:win:dir      # lite → dist\win-unpacked\Nihonco.exe
npm run build:win          # lite NSIS + portable
```

产物（`dist/`）：

| 文件 | 说明 |
|---|---|
| `Nihonco-<版本>-lite-setup.exe` | lite NSIS：不含 model/Core；用户放 `%APPDATA%\Nihonco\assets` |
| `Nihonco-<版本>-lite-portable.exe` | lite 绿色版；首次启动先解压 |
| `Nihonco-<版本>-setup.exe` | full NSIS：含 model/Core，仅自己用 |
| `Nihonco-<版本>-portable.exe` | full 绿色版 |
| `win-unpacked/` | 免安装目录版，调试用 |

> 体积参考（0.2.0 实测，后续版本会变）：setup ~546 MB、portable ~531 MB、装完 ~898 MB。
> 构成：Electron 本体 + `app.asar` + `.whisper`（模型占大头）+ `model/`。
> **模型/Core 打包进安装包 = 再分发**，公开分发前必须换成有许可的模型（见 `docs/ASSETS.md`）。

> **VOICEVOX / AivisSpeech 不进安装包**。分发时让用户自己装，或把
> `vv-engine` 放到 `%APPDATA%\Nihonco\.voicevox\windows\` 下（安装目录只读，别往那里放）。
> 没装也不会崩：日志是 `[vv] 没找到引擎：Windows 上没有日语声线，本次将不发音`，
> 界面 HUD 提示「缺日语语音引擎（VOICEVOX / AivisSpeech）」，**不会**再用中文声线硬念日文。

---

### 5. 打包后的目录结构

```
安装目录\Nihonco\
├── Nihonco.exe
└── resources\
    ├── app.asar                        ← 代码 + 渲染层
    └── app.asar.unpacked\
        ├── .whisper\                   ← 必须解包，exe 不能从 asar 里 spawn
        ├── data\                       ← 种子数据表（只读，首次启动拷到用户目录）
        └── model\                      ← Live2D 模型

%APPDATA%\Nihonco\                      ← 所有可写内容
├── data\                               ← 首次启动从 app.asar.unpacked/data 播种
│   ├── jlpt.json / patterns-n*.json / word-levels.json …（随包）
│   └── wordbook.json / vocab-daily.json / settings.json（运行时生成）
└── .voice\                             ← TTS 产物、录音、截图
```

关键点：**asar 里的一切都是只读的**。任何「运行时要写」的路径都必须落在 `%APPDATA%\Nihonco`，
包括 `userData`、`sessionData`、`data/`、`.voice/`。四处在 `main.js` 顶部一次性处理好，
`agent/*` 的 `DATA_DIR` 靠 `NIHONCO_DATA_DIR` 环境变量指过去。

---

### 6. 验收清单

```powershell
npm test

npm run scan

npm run smoke
```

图标验收：

```powershell
Get-Item assets\AppIcon.icns, assets\icon.ico
npm run build:win:dir
Get-Item dist\win-unpacked\Nihonco.exe

Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path 'dist\win-unpacked\Nihonco.exe'))
$ico.ToBitmap().Save("$env:TEMP\nihonco-exe-icon.png")
Invoke-Item "$env:TEMP\nihonco-exe-icon.png"
```

- [ ] exe / NSIS / 桌面快捷方式 / 开始菜单 / 任务栏均显示 NH 图标
- [ ] 不是 Electron 默认图标
- [ ] `assets/icon.ico` 能被 Explorer 正常预览

后续建议补验：

- [ ] 设置 → 记忆：查看/添加/编辑/删除/清空
- [ ] `%APPDATA%\Nihonco\data\persona.json` 可写
- [ ] 安装包不包含 `data/persona.json`
- [ ] `日本語模式` 全部按日语处理；`中国語模式` 只翻译、不换卡
- [ ] 解説气泡只反应，纠错/讲解只在黄卡
- [ ] TTS 引擎切换：VOICEVOX ↔ AivisSpeech，旧引擎停止、新引擎启动
- [ ] TTS 路径选择：错误路径被拒绝，正确 `run.exe` 可保存
- [ ] `npm run build:win:lite` 会自动准备 whisper，生成 lite 包


语音链路手工验收：

```powershell
curl.exe http://127.0.0.1:8765/health

curl.exe -X POST --data-binary "@test.wav" -H "Content-Type: audio/wav" `
  "http://127.0.0.1:8765/asr?lang=ja"

$env:PET_TTS_TEST='こんにちは、いい天気ですね。'; $env:PET_TTS_TEST_DELAY='16000'
npm start
```

本机实测数值（CPU，`ggml-small`，无 CUDA）：

| 项 | 耗时 |
|---|---|
| whisper 模型加载（冷启） | ~0.85 s |
| 一句 5.65 s 音频识别 | **2.1–2.3 s** |
| VOICEVOX 合成一句 | ~2.9 s（含首次加载） |

---

### 9. 待办 / 已知问题

- [x] ~~`npm run smoke` 里 `word.wrongOn` 断言失败~~ —— 根因是 `agent/llm.js` 把
      `SETTINGS_FILE` 硬编码成 `__dirname/../data/settings.json`，无视 `NIHONCO_DATA_DIR`，
      导致冒烟用的临时档位（N5）被忽略、错题池按 N4 过滤成 0。已改成跟其他模块同一口径，
      顺带修掉了「打包后档位存不进 asar」这个真问题。
- [x] ~~图标~~ —— `assets/AppIcon.icns`（macOS）和 `assets/icon.ico`（Windows）已替换为 NH mark；主标 H 线宽 7，16/32 小尺寸 H 线宽 10。
- [x] ~~缺模型时的提示~~ —— 设置窗口的后端/模型下拉会标出「缺 .whisper/whisper-server」「缺模型」
      并附修复命令；`/health` 也有 `modelFallback` / `modelNote`。
- [x] 缺 TTS 引擎时**不发音**（不再退回 SAPI / say），
      HUD 提示「缺日语语音引擎（VOICEVOX / AivisSpeech）」，`pet:tts-health` 供渲染层启动自检。
- [ ] 首次启动引导：缺 LLM key 时给出明确的向导式提示（TTS 已覆盖）。
- [ ] 高 DPI：125%/150% 缩放下 Live2D 画布与卡片定位还没专项验证。
- [x] ~~开机自启~~ —— 已接（`app.setLoginItemSettings`），仅在打包版显示，默认关闭。
- [ ] 代码签名：`no code signing certificate configured`，SmartScreen 会拦。
- [ ] 设置窗口在 Windows 上仍用 mac 的 `Control+,` 快捷键文案，功能正常只是文案没本地化。

---

### 附 1. 打包后必须验的两件事

### ① 安装包不能带个人学习进度

`data/*.json` 里混着「共享数据表」和「你本机的进度」。`build.files` 已改成显式白名单
（只打 `jlpt / word-levels / kanji-stems / pattern-gloss-zh / patterns-n1..n5 / enrich-cache.seed`），
`main.js` 的 seed 也按同一份白名单过滤。打完包验一下：

```powershell
npx asar list "dist\win-unpacked\resources\app.asar" | Select-String "data/"
```

期望只有那 10 个文件；出现 `wordbook.json` / `settings.json` / `vocab-daily.json` 就是漏了。

`npm run scan` 的 `[8] 打包数据白名单` 会静态校验这两份白名单是否一致
（① 文件是否存在 ② 是否被 `SHARED_DATA` 匹配 ③ 仓库跟踪的文件是否都进了 build.files）。

### ② 包内数据缺失时要能看出问题

打包后数据从 `app.asar.unpacked/data` seed 到 `%APPDATA%\Nihonco\data`。
如果 asar 配置变了、或手动拼包导致目录不在，`agent/boot-data.js` 会：

```js
[//boot] 打包数据缺失（缺 jlpt.json），回退到 <项目>\data
```

而不是「能开但没词可学」。验证方法：删掉 `%APPDATA%\Nihonco\data`，
启动后看日志是否有这行、界面是否还能抽到词。

---

### 附 4. GPU 后端阶梯（whisper.cpp 的 CUDA 版）

CPU 版（`ggml-small-q5_1`）识别一句固定 **2.7–3.0 s** —— 跟句子长短无关，因为 Whisper
永远把音频补零到 30 秒窗口再跑 12 层编码器。想再快只能上 GPU。

**目录约定**（主进程把 `NIHONCO_ASR_DIR` 指到 `<userData>/asr`）：

```
%APPDATA%\Nihonco\asr\
├── active.json          {"backend":"cuda-12.4"}   ← 记住上次能用的
├── cuda-12.4\           whisper-server.exe + cudart64_12.dll + cublas64_12.dll + ggml*.dll
└── cuda-11.8\           （可选，老驱动用）
```

模型**不重复放**：GPU 后端共用内置目录（`app.asar.unpacked\.whisper\models`）里的 `.bin`。

**不校验哈希**：下载只钉版本（whisper.cpp `b5454`）+ gh-proxy 兜底，不做 sha256 校验——
whisper 源码和模型现在由 `tools/setup-whisper.mjs` 做 sha256 校验。

**选择与回落**（`agent/asr-whispercpp.js`）：

```
显式 NIHONCO_ASR_BACKEND / active.json 指定  →  该后端 exe 存在就用
        ↓ 没有
随便哪个 GPU 后端目录有 exe                  →  用它
        ↓ 都没有
内置 CPU 版                                  →  永远兜底
```

GPU 后端**起不来就回落 CPU，连续失败 3 次才永久固定 CPU**：

```text
第 1 次失败 → 本次 CPU，active 仍记 GPU，下次启动再试
第 2 次失败 → 本次 CPU，下次仍试
第 3 次失败 → active 写 cpu，之后不再自动试 GPU
```

触发条件：

```text
spawn 失败（exe 损坏 / 被杀软隔离 / 不是合法 PE）
60 秒内 /health 不通（驱动被换 / 显卡被独占 / 远程桌面）
```

成功启动一次 GPU 后，失败计数清零。日志会写连续失败次数。

`/health` 会回报 `backend` 和 `backendHome`，方便排查当前跑的是哪一版：

```json
{"ok":true,"engine":"whisper.cpp","backend":"cpu","backendHome":"…\\.whisper","ready":true}
```

实测（本机）：CPU 2.7 s；CUDA 12.4 版预期 0.3–0.5 s（待实测，包 685 MB）。

> 还没做：下载器 + 设置窗口的「引擎/模型」区块（进度条、切换、回退）。
> 目前只能手动把解压好的 CUDA 目录放到 `%APPDATA%\Nihonco\asr\cuda-12.4\`。

---

## 附 5. 实战备忘（这台 Windows 机器）

> 原 `HANDOVER-CURRENT.md` 的内容并到这里；只保留仍然有用的事实，过期的
> 分支/版本/未提交改动已删。

### 环境怪癖

| 现象 | 处理 |
|---|---|
| `ELECTRON_RUN_AS_NODE=1` | 启动打包版前必须清掉，否则 exe 以 Node 跑 `main.js`，报 `setName` 后**静默退出**（无窗口无日志） |
| `npm.ps1` 被执行策略禁 | 用 `cmd /c npm ...`，或直接 `node --test "tests/*.test.mjs"` |
| PowerShell 5.1 写坏中文 | 不要用 `Get-Content/Set-Content` 改仓库文件（GBK+BOM）；用编辑器 |
| 旧版应用在跑 → 打包 EPERM | 先 `Get-Process Nihonco \| Stop-Process -Force`，或把包出到临时目录 |
| electron-builder 卡在 unpack | 必须指定本地 electron：`npx electron-builder --win --x64 --dir -c.electronDist=node_modules/electron/dist` |
| `git push` 握手失败 | `git -c http.sslBackend=openssl push`（schannel 偶尔失败） |

### GPU 识别（实测）

| 事实 | 数值 / 说明 |
|---|---|
| CPU 识别 | 恒定 2.7–3.0 s（Whisper 补零到 30s 窗口，**不是 bug**） |
| CUDA 识别 | 145–158 ms（RTX 3060 Laptop）；首句冷启约 2.4 s |
| `ggml-cuda.dll` | 必须拷；漏了会**静默退回 CPU**（只快 0.5s，极难发现） |
| 后端目录 | 约 1.1 GB；zip 653 MB；峰值磁盘约 1.8 GB |
| 本地包 | 用 `NIHONCO_ASR_ZIP` 指过去；不要先拷进 `_download`（每次安装开头会清空） |
| 安装顺序 | 解压 → staging → 停服 → rename；取消/失败不碰已装版本 |
| 卸载/重装 | 必须先停 whisper-server，否则 exe/dll 被占用（`rmSync` 静默失败） |
| 下载校验 | 只钉版本（b5454）+ gh-proxy，不做 sha256 |

### 免安装版（portable）

```bat
npm run build:win:portable
```

- 产物在 `dist/`（gitignored）
- 历史成品约 337 MB（含 whisper 量化模型，不含 VOICEVOX）
- 分发前建议补哈希校验；个人自用可接受

### 已知待办

- [ ] 真机点一次「识别加速 → 重装/取消」的 UI（自动化点不了界面）
- [x] ~~Windows 图标~~ —— `assets/icon.ico` 已接入 `build.win.icon`；待 Windows 实机确认 exe/NSIS/任务栏显示。
- [ ] 代码签名（SmartScreen 会拦）
- [ ] `settings/asr.js` 的 `renderAsr` 结尾没有不可达死代码
