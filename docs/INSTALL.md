# 安装与首次启动

从零装好 Nihonco：macOS 走下面的步骤；Windows 见 [windows/WINDOWS.md](windows/WINDOWS.md)。

> **模型需自备**：Live2D Hiyori 不随仓库分发，先按 [ASSETS.md](ASSETS.md) 放到 `model/Hiyori/`。

## 前提

| 项目 | macOS | Windows |
|---|---|---|
| 系统 | macOS 13+ | Windows 10/11 x64 |
| 芯片 | Apple Silicon 推荐；whisper.cpp 也可在 Intel 跑 | x64（无需特定 GPU） |
| Node | 18+ | 18+（实测 24 LTS） |
| Python | 可选（mlx 才需要，`npm run setup` 建 venv） | **不需要**（识别走 whisper.cpp） |
| 磁盘 | 预留 3GB；VOICEVOX 再加 2GB | 预留 4GB（Electron + whisper 小模型 181MB + VOICEVOX 2GB） |
| 常驻内存 | 主进程 + kuromoji 词典约 350MB；VOICEVOX 引擎约 2GB | 同左（kuromoji 词典跨平台） |

> **主进程为什么占 400MB 左右**：汉字读音词典（kuromoji，磁盘 17MB）预热后常驻约 350MB
> （double-array trie + Buffer）。它用于振假名、单词「也算对」门禁和复现读音判断；
> 关掉应用就释放。

> 默认 ASR 是 **whisper.cpp**；先跑 `npm run setup:whisper`
> （自动编译 Metal 版 whisper-server 并下 181MB 小模型）。
> 想用 mlx 再跑 `npm run setup:mlx`。

> **Windows 用户请直接跳到 [Windows 版](#windows-版)**：安装步骤、whisper.cpp / VOICEVOX 下载、
> 打包命令都在那里；下面的「四步装好」是 macOS 流程。

## 四步装好（macOS）

```bash
# 1. 克隆
git clone https://github.com/KronosOceanus/Nihonco_JP_PBLC.git && cd Nihonco_JP_PBLC

# 2. 依赖（Node 包 + .env；需要 mlx 时再建 venv）
npm run setup

# 3. 默认 ASR：编译 whisper.cpp + 下载小模型
npm run setup:whisper

# 4. 填 API key（也可以启动后在设置窗口里填）
vim .env          # LLM_API_KEY=sk-...

# 5. 构建（没有 Live2D 资产用 lite）
npm run build:app:lite    # 不要求 Live2D
# npm run build:app:full  # 需要 model/ + lib/Core
open Nihonco.app          # 或 npm start（开发调试，不打包直接跑）
```

## 构建产物说明（重要）

`npm run build:app:lite` / `build:app:full` 生成的是**壳**，不是自包含应用：

```
Nihonco.app（~253MB，其中 251MB 是 Electron 本体）
└── Contents/Resources/app/bootstrap.js
        require(path.join(ROOT, "main.js"))   // ROOT = 项目根目录（反推四层）
```

由此有三条约束：

| 约束 | 说明 |
|---|---|
| **不能单独拷走** | 把 `Nihonco.app` 拖到别处/别的机器会启动失败，它指回项目目录 |
| **首次要右键 → 打开** | 只有 ad-hoc 签名（`codesign -s -`），没有开发者证书，Gatekeeper 会拦一次 |
| **改了代码不用重新打包** | app 每次启动都从项目目录加载 `main.js`，改完重启即可生效 |

想要真正能分发的包（自包含 + 签名 + 公证）是另一套工作，见「已知限制」。

**Windows 不一样**：用 `npm run build:win` / `build:win:dir`（electron-builder），产出的是**自包含**包
（`dist\win-unpacked\Nihonco.exe` 或 portable/NSIS），可写数据落在 `%APPDATA%\Nihonco`，
不依赖项目目录。细节见 [windows/WINDOWS.md](windows/WINDOWS.md)。

## 首次启动会发生什么

1. 自动拉起本地服务：语音识别（8765）、语音合成（VOICEVOX 50021 或 Aivis 10101）
   · 引擎切换时会停旧启新；用户手动开的引擎只连接，不强杀
2. **模型在后台加载**（首次还要下载，mlx small 约 460MB）：`/health` 立刻可答但 `ready:false`，
   这期间说话会返回「识别模型还在加载，稍等几秒再试」——不是卡死。
   用 whisper.cpp 后端时首次启动还要编译 Metal 内核（几秒）
3. 国内网络慢，可在 `.env` 里加 `HF_ENDPOINT=https://hf-mirror.com` 走镜像
4. 没填 key 也能启动、能看角色，但对话会提示「还没有可用的语言模型」

## 想要日语朗读（可选）

不装也能用（文字对话、Live2D 正常），只是不会出声。

VOICEVOX：

```bash
# 1. 下载 voicevox-macos-cpu-arm64-*.zip
#    https://github.com/VOICEVOX/voicevox/releases
# 2. 解压到 .voicevox/ 后执行
./tools/install-voicevox.sh
# 3. 设置 → TTS → 引擎 VOICEVOX → 应用
```

AivisSpeech：

```bash
# 安装 AivisSpeech.app（官方版或开发版）
# 设置 → TTS → 引擎 AivisSpeech → 应用
# 找不到时用「选择路径」选 AivisSpeech-Engine/run
```

## 装完自检

```bash
npm run scan                        # 静态自检，应显示「全部通过」
curl 127.0.0.1:8765/health          # 应用启动后应返回 {"ok":true,...}
```

## Windows

Windows 的安装、打包与已知问题统一在 [windows/WINDOWS.md](windows/WINDOWS.md)。

默认 `npm run build:win:lite` 是 **lite**（不含模型/Core）；完整包用 `npm run build:win:full`。
构建会先准备 whisper.cpp；lite 的资产放到 `%APPDATA%\Nihonco\assets`。
