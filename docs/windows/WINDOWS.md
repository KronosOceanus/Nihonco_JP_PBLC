# Windows 安装与打包

> 当前版本：**v0.7.32**
>
> 本项目只提供 **lite** 构建。构建/验收清单见 [ACCEPTANCE.md](ACCEPTANCE.md)。

---

## 1. 结论

Windows 与 mac 共用同一套渲染层和 agent 逻辑，差异集中在：

```text
ASR：whisper.cpp（免 Python）
TTS：VOICEVOX / AivisSpeech（外部引擎）
窗口：没有 hiddenInset / 全工作区
路径：asar 只读，运行时数据写 %APPDATA%\Nihonco
打包：electron-builder lite
```

---

## 2. 环境

| 项 | 要求 |
|---|---|
| 系统 | Windows 10/11 x64 |
| Node | 18+（实测 24 LTS） |
| Python | 不需要 |
| 磁盘 | 至少 4GB；VOICEVOX 另加约 2GB |
| 显卡 | 无要求；NVIDIA 可选 CUDA |

国内镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

---

## 3. 安装

```powershell
git clone https://github.com/KronosOceanus/Nihonco_JP.git
cd Nihonco_JP
npm ci
npm run setup
npm run setup:whisper
# 编辑 .env，填 LLM_API_KEY
npm start
```

---

## 4. ASR

### 默认：CPU

Windows lite 默认包含：

```text
app.asar.unpacked/.whisper/whisper-server.exe
whisper.dll
ggml.dll / ggml-base.dll
ggml-cpu-*.dll
.whisper/models/ggml-small-q5_1.bin
```

默认：

```text
backend = whisper.cpp
engine  = cpu
```

### 可选：CUDA

```text
设置 → 资源 → ASR
  [下载 Whisper 引擎（CUDA 12.4 版）]
  [下载 Whisper 引擎（CPU 版）]
  [下载 Whisper 模型]
```

按钮按驱动推荐 12.4 / 11.8；没有可用 NVIDIA 时 CUDA 禁用。

也可以直接拖 zip：

```text
CUDA zip → %APPDATA%\Nihonco\asr\cuda-12.4 / cuda-11.8
CPU zip  → %APPDATA%\Nihonco\asr\cpu
```

安装前停 ASR，安装后重启。

### 实际引擎

```text
设置 → ASR → 实际引擎
  CUDA 12.4
  CUDA 11.8
  CPU
```

只列出已安装的 CUDA；未安装的禁用。  
CUDA 连续失败 3 次后回退 CPU，界面显示 CPU 和原因。

### 路径

```text
内置 CPU 运行时：app.asar.unpacked/.whisper
内置模型：      app.asar.unpacked/.whisper/models
用户模型：      %APPDATA%\Nihonco\.whisper\models
CUDA：          %APPDATA%\Nihonco\asr\cuda-*
用户 CPU：      %APPDATA%\Nihonco\asr\cpu
```

`%APPDATA%\Nihonco\asr\cpu` 优先于内置 CPU。

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
npm run check:assets:lite
npm test
npm run scan

npm run build:win:lite:dir    # dist\win-unpacked\Nihonco.exe
npm run build:win:lite        # NSIS + portable
npm run build:win:lite:nsis
npm run build:win:lite:portable
```

别名：

```text
build:win  = build:win:lite
build:win:dir = build:win:lite:dir
```

产物：

```text
Nihonco-<版本>-lite-setup.exe
Nihonco-<版本>-lite-portable.exe
win-unpacked/
```

---

## 8. 打包后结构

```text
安装目录\Nihonco\
├── Nihonco.exe
└── resources\
    ├── app.asar
    └── app.asar.unpacked\
        ├── .whisper\
        └── data\

%APPDATA%\Nihonco\
├── data\
├── assets\
├── .voicevox\
├── .aivis\
├── .whisper\
└── asr\
```

原则：

```text
asar 只读
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
| `ELECTRON_RUN_AS_NODE=1` | 启动打包版前清掉 |
| PowerShell 执行策略禁 npm.ps1 | `cmd /c npm ...` 或 `node ...` |
| PowerShell 5.1 改中文文件变乱码 | 用编辑器，不要 `Set-Content` |
| 旧版应用在跑导致 EPERM | 先停进程，或输出到临时目录 |
| `git push` 握手失败 | `git -c http.sslBackend=openssl push` |
