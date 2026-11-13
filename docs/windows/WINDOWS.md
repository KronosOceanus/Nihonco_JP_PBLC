# Windows 安装与打包

> 当前版本：**v0.7.37**
>
> 本项目只提供 **lite** 构建。构建/验收清单见 [ACCEPTANCE.md](ACCEPTANCE.md)。

---

## 1. 结论

Windows 与 mac 共用同一套渲染层和 agent 逻辑，差异集中在：

```text
ASR：whisper.cpp（免 Python），引擎与模型都由用户拖入
TTS：VOICEVOX / AivisSpeech（外部引擎）
窗口：没有 hiddenInset / 全工作区
路径：asar 只读，运行时数据写 %APPDATA%\Nihonco
打包：electron-builder lite（不打包 .whisper）
```

---

## 2. 环境

| 项 | 要求 | 本次实测 |
|---|---|---|
| 系统 | Windows 10/11 x64 | Windows 11 x64 |
| Node | ≥ 18 | v24.22.2 |
| npm | 随 Node | 11.19.1 |
| Python | 不需要 | — |
| 磁盘 | 构建 ≥ 2GB；运行另算 | 见下 |

运行时额外占用（都在 `%APPDATA%\Nihonco`，不含在安装包里）：

```text
Whisper CPU 引擎  约 11MB
Whisper CUDA 引擎 约 1.1GB（下载包 653MB，解压峰值约 1.8GB）
Whisper 模型      约 181MB（ggml-small-q5_1）
VOICEVOX          约 2GB（含声库）
Live2D Core+模型  约 5MB
```

## 2.1 依赖版本

`package.json` 里写的是范围，`package-lock.json` 锁定的实际版本如下（v0.7.37）：

| 依赖 | package.json | 锁定/实装 | 用途 |
|---|---|---|---|
| electron | `^45.2.1` | **45.2.1** | 运行时（Chromium + Node） |
| electron-builder | `^26.18.0` | **26.18.0** | 打包 |
| @electron/asar | 间接依赖 | **3.4.1** | 验收时 `asar list` |
| kuromoji | `^0.1.2` | **0.1.2** | 振假名/读音 |
| pixi.js | `^7.4.3` | **7.4.3** | Live2D 渲染 |
| @pixi/unsafe-eval | `^7.4.3` | **7.4.3** | PIXI 补丁 |
| pixi-live2d-display-lipsyncpatch | `^0.5.0-ls-8` | **0.5.0-ls-8** | Live2D 显示 + 口型 |
| adm-zip | `^0.6.1` | **0.6.1** | 资源 zip 安装 |
| @polyglot-bundles/ja-jlpt-syllabi | `^0.1.5` | **0.1.5** | JLPT 数据 |
| doublearray / zlibjs / async | kuromoji 依赖 | **0.0.2 / 0.3.1 / 2.6.4** | 词典运行时（随 asar 打包） |

`package.json` 的 `engines.node` 是 `>=18`。

核对实际版本：

```powershell
node -e "const l=require('./package-lock.json');for(const n of ['electron','electron-builder','kuromoji','pixi.js','adm-zip'])console.log(n.padEnd(18), l.packages['node_modules/'+n].version)"
```

国内镜像（首次 `npm ci` 前设置）：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

---

## 3. 安装（源码运行）

```powershell
git clone https://github.com/KronosOceanus/Nihonco_JP.git
cd Nihonco_JP
npm ci
npm run setup          # 检查运行时/依赖，复制 .env.example → .env
npm start
```

`npm run setup` 做的事：

```text
[1] 检查 node 版本与 electron 是否装好
[2] 检查 npm 依赖
[3] 没有 .env 就从 .env.example 复制，并提示填 LLM_API_KEY
[4] 检查语音识别（lite 下只提示从设置拖入）
```

`npm ci` 之后如果 `node_modules\electron\dist\electron.exe` 不存在（npm 跳过 postinstall 时会这样），补一次：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

源码模式要语音识别，按第 4 节把 CPU 引擎和模型拖进设置；只打包不需要。
Windows lite 安装包本身**不含** Whisper 运行时和模型（v0.7.37 起）。

### 源码模式要放 Live2D 资产

源码模式（`npm start` / `npm run smoke`）从**仓库根目录**读资产，和打包版走 `%APPDATA%` 不一样：

```text
lib\live2dcubismcore.min.js        ← pet.html 里 <script src="lib/…">
model\Hiyori\Hiyori.model3.json    ← 模型目录
```

两个路径都在 `.gitignore` 里。缺 Core 时渲染层直接抛
`Could not find Cubism 4 runtime`，`npm run smoke` 会报成
`渲染层报错: Cannot read properties of undefined (reading 'mode')`（`window.__pet` 没建起来）。

---

## 4. ASR

### Windows lite 不含 ASR 资源

Windows lite 安装包**不包含**：

```text
whisper-server.exe
whisper.dll / ggml*.dll
ggml-small-q5_1.bin
```

首次启动时桌宠、TTS、LLM、单词/句型都正常，但语音识别不可用。
设置 → 资源 里 ASR 三行会显示「未找到」（CUDA 引擎 / CPU 引擎 / Whisper 模型）。

### 安装 CPU 引擎

从设置 → 资源拖入 CPU 引擎 zip（zip 内需含）：

```text
whisper-server.exe
whisper.dll
ggml.dll
ggml-base.dll
ggml-cpu-*.dll（至少一个）
```

安装到：

```text
%APPDATA%\Nihonco\asr\cpu
```

装有这份用户 CPU 运行时后，它**优先于**内置兜底。

### 安装 CUDA 引擎（可选）

拖入官方 CUDA 包 zip（需含 `whisper-server.exe` + `ggml-cuda.dll`），按包内 DLL 自动判版本：

```text
含 cudart64_12 / cublas64_12 / cublasLt64_12 → cuda-12.4
含 cudart64_11 / cublas64_11 / cublasLt64_11 → cuda-11.8
```

安装到：

```text
%APPDATA%\Nihonco\asr\cuda-12.4
%APPDATA%\Nihonco\asr\cuda-11.8
```

也可以直接在资源区点「下载 Whisper 引擎（CUDA …）」，按驱动推荐 12.4 / 11.8；没有可用 NVIDIA 时 CUDA 禁用。
本地已有官方 zip 时，放在 `Desktop\whisper-cuda-12.4.zip` 或 `Downloads\`，或用环境变量 `NIHONCO_ASR_ZIP` 指路，安装会直接解压本地包、不联网。

### 安装模型

拖入任意 `ggml-*.bin`：

```text
%APPDATA%\Nihonco\.whisper\models
```

推荐：

```text
ggml-small-q5_1.bin（约 181MB）
```

安装前停 ASR，安装后自动重启。引擎和模型要**分别安装**，只装一个不够。

### 实际引擎

```text
设置 → ASR → 实际引擎
  CUDA 12.4
  CUDA 11.8
  CPU
```

只列出已安装的 CUDA；未安装的禁用。
CUDA 连续失败 3 次后回退 CPU（`active.json` 记 `gpuFailures` / `gpuFallbackPermanent`），并在下拉里切回。

### 路径

```text
CPU 引擎：  %APPDATA%\Nihonco\asr\cpu
CUDA：      %APPDATA%\Nihonco\asr\cuda-*
用户模型：  %APPDATA%\Nihonco\.whisper\models
```

Windows lite 的 `app.asar.unpacked` 里没有 `.whisper`；不要再往包里塞运行时。

源码 `npm start` 的路径不同：用户数据默认在项目 `.electron-data`，模型默认在项目 `.whisper/models`；设置里拖入仍然可用。

---

## 5. TTS

Windows 没有日语 SAPI 兜底，必须装一个：

- [VOICEVOX](https://voicevox.hiroshiba.jp/)
- [AivisSpeech](https://aivis-project.com/speech/)

设置：

```text
设置 → TTS
  引擎 [VOICEVOX / AivisSpeech] → 应用
  模型 [角色 / 风格] → 试听一句
```

引擎路径：

```text
VOICEVOX_ENGINE
AIVIS_ENGINE
```

要求入口：

```text
vv-engine/run.exe
AivisSpeech-Engine/run.exe
```

自动查找：

```text
%APPDATA%\Nihonco\.voicevox\windows\VOICEVOX\vv-engine\run.exe
%APPDATA%\Nihonco\.aivis\...
%ProgramFiles%\VOICEVOX\vv-engine\run.exe
%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe
```

装到 Program Files 后没有写权限，引擎放用户目录；设置页可用「选择路径」。

缺引擎：

```text
不发音
HUD 提示
不回落系统 SAPI
```

AivisSpeech 首次启动下载 BERT（约 1GB+），设置页显示阶段。

---

## 6. Live2D / 资产

自备：

```text
%APPDATA%\Nihonco\assets\model\Hiyori\
%APPDATA%\Nihonco\assets\lib\live2dcubismcore.min.js
```

或拖入资源区。详见 [ASSETS.md](../ASSETS.md)。

---

## 7. 构建

```powershell
npm run check:assets:lite   # lite 不检查模型/Core，只确认目录
npm test                    # 见 §9 基线
npm run scan

npm run build:win:lite:dir  # dist\win-unpacked\Nihonco.exe（本文档用这个）
npm run build:win:lite      # NSIS + portable
npm run build:win:lite:nsis
npm run build:win:lite:portable
```

别名：

```text
build:win     = build:win:lite
build:win:dir = build:win:lite:dir
```

`npm run build:win:lite:dir` 实际执行（`tools/build-app.mjs`）：

```text
1. node tools/check-assets.mjs --lite
2. node node_modules/electron-builder/cli.js --win --x64 --dir
```

留意三点：

```text
Windows 上不调 setup-whisper：不下载模型、不打包 .whisper
不经过 npx.cmd（规避 spawn EINVAL），直接 node 调本地 cli.js
版本由 package-lock 锁定，不会临时换 electron-builder
```

### 如果 electron-builder 卡在下载 electron

本机已有 `node_modules\electron\dist` 时，直接告诉它用本地二进制：

```powershell
cmd /c "npx electron-builder --win --x64 --dir -c.electronDist=node_modules/electron/dist"
```

等价于给 `electronDist` 传本地目录，跳过下载与校验。

### 产物

```text
dist\win-unpacked\                    约 429MB，87 个文件（0.7.37 实测）
dist\win-unpacked\Nihonco.exe         版本号 = package.json version
Nihonco-<版本>-lite-setup.exe         NSIS 安装包
Nihonco-<版本>-lite-portable.exe      单文件便携版
```

`win-unpacked` 压成 zip 约 170MB（不压缩模式的 zip，`-mx=5`）。

---

## 8. 打包后结构

```text
安装目录\Nihonco\
├── Nihonco.exe
└── resources\
    ├── app.asar
    └── app.asar.unpacked\
        └── data\            ← 只读数据表（jlpt / patterns / word-levels …）

%APPDATA%\Nihonco\
├── data\          ← 学习数据、记忆、设置、日志
├── assets\        ← 用户拖入：Lib / 模型
├── .voicevox\     ← 用户拖入：VOICEVOX
├── .aivis\        ← 用户拖入：AivisSpeech
├── .whisper\      ← 用户拖入的模型
├── asr\           ← 用户拖入的 CPU / CUDA 引擎（+ active.json）
└── .voice\        ← 录音与语音缓存
```

原则：

```text
asar 只读
Windows lite 不带 .whisper 运行时/模型（v0.7.37 起）
运行时可写全部在 %APPDATA%\Nihonco
```

---

## 9. 验收

```powershell
npm test
npm run scan
npm run smoke
npm run smoke:settings
```

当前基线（v0.7.37，Windows x64 / Node 24.22.2）：

```text
npm test   → tests 344，pass 341，fail 0，skipped 3
npm run scan → 全绿
npm run smoke → 6 步
```

完整清单见 [ACCEPTANCE.md](ACCEPTANCE.md)。

---

## 10. 已知问题

```text
Ctrl+Alt 可能被输入法/QQ 占用 → 设置里改键
杀软可能拦 whisper-server.exe / vv-engine\run.exe → 加白名单
端口 50021 / 8765 只监听本机；防火墙放行
未签名 exe 会被 SmartScreen 拦
CUDA 包约 653MB，峰值磁盘约 1.8GB
高 DPI 125%/150% 未专项验证
代码签名未做
```

日志：

```text
%APPDATA%\Nihonco\data\logs\app.log
%APPDATA%\Nihonco\data\logs\asr.log
```

---

## 11. 环境怪癖

| 现象 | 处理 |
|---|---|
| `ELECTRON_RUN_AS_NODE=1` | 启动打包版前清掉，否则报错退出 |
| PowerShell 执行策略禁 `npm.ps1` | 用 `cmd /c npm ...` 或直接 `node tools/...` |
| PowerShell 5.1 改中文文件变乱码 | 用编辑器，不要 `Set-Content` |
| 旧版应用在跑导致 EPERM unlink Nihonco.exe | 先停进程再打包 |
| electron-builder 卡下载 electron | `-c.electronDist=node_modules/electron/dist` |
| 本机有 HTTP(S)_PROXY 但没 NO_PROXY | 启动应用前清掉代理变量，否则本机 ASR 端口连不上 |
| `git push` 握手失败 | `git -c http.sslBackend=openssl push` |

---

## 12. 升级依赖

```powershell
# 只升补丁版本
npm update
# 升到新的主版本时手工改 package.json，再
npm install
```

改完必须重跑：

```text
npm test / npm run scan / npm run build:win:lite:dir
npx @electron/asar list dist\win-unpacked\resources\app.asar   # 复核包内容
```

Electron 大版本升级时额外核对：`pet.html` / `settings/index.html` 的 `-webkit-app-region`、
`BrowserWindow` 的透明/置顶选项、`contextIsolation` 下的 preload 通道是否都还在。
