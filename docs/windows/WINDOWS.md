# Windows 安装与打包

> 当前版本：**v0.7.38**
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
| 磁盘 | 至少 2GB；Whisper 模型另约 181MB；VOICEVOX 另加约 2GB |
| 显卡 | 无要求；NVIDIA 可选 CUDA |

### 下载源

构建脚本按「镜像优先、官方兜底」下载（仿 Go 的 `GOPROXY`）：

```text
Electron 二进制        npmmirror  →  github.com
electron-builder 二进制 npmmirror  →  github.com
whisper 源码 / 模型     只在 mac 构建用到，同样镜像优先
```

每个源都有超时，失败/超时/哈希不符就换下一个，不会吊在一个死源上。

```powershell
npm run build:win:lite -- --mirror=official   # 只走官方
npm run build:win:lite -- --mirror=cn         # 只走镜像
$env:NIHONCO_MIRROR = 'cn'                    # 环境变量写法
```

`npm ci` 仍归 npm 管（它没有回退机制），网络慢时自己加：

```powershell
npm ci --registry https://registry.npmmirror.com
```

---

## 3. 安装

```powershell
git clone https://github.com/KronosOceanus/Nihonco_JP.git
cd Nihonco_JP
npm ci
npm run setup
# 编辑 .env，填 LLM_API_KEY
npm start
```

源码模式要语音识别，按第 4 节准备 Whisper 引擎和模型；只打包不需要。  
Windows lite 安装包本身**不含** Whisper 运行时和模型。

`npm ci` 之后要确认 Electron 二进制真的落地了——它可能**静默失败**，npm 不报错：

```powershell
Test-Path node_modules\electron\dist\electron.exe    # 应为 True
```

缺了就手动补（设了 `ELECTRON_MIRROR` 才快）：

```powershell
node node_modules\electron\install.js
```

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
设置 → 资源会显示「缺 Whisper 引擎 / 缺模型」。

### 安装 CPU 引擎

从设置 → 资源拖入 CPU 引擎 zip：

```text
whisper-server.exe
whisper.dll
ggml.dll
ggml-base.dll
ggml-cpu-*.dll
```

安装到：

```text
%APPDATA%\Nihonco\asr\cpu
```

### 安装 CUDA 引擎（可选）

```text
whisper-server.exe
ggml-cuda.dll
cudart64_*.dll
```

安装到：

```text
%APPDATA%\Nihonco\asr\cuda-12.4
%APPDATA%\Nihonco\asr\cuda-11.8
```

按驱动推荐 12.4 / 11.8；没有可用 NVIDIA 时 CUDA 禁用。

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
CUDA 连续失败 3 次后回退 CPU，界面显示 CPU 和原因。

### 路径

```text
CPU 引擎：  %APPDATA%\Nihonco\asr\cpu
CUDA：      %APPDATA%\Nihonco\asr\cuda-*
用户模型：  %APPDATA%\Nihonco\.whisper\models
```

`app.asar.unpacked\.whisper` 在 Windows lite 中不存在；不要按旧文档往里放文件。

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
npm run check:assets:lite
npm test
npm run scan

npm run build:win:lite:dir    # dist\win-unpacked\Nihonco.exe
npm run build:win:lite        # NSIS + portable
npm run build:win:lite:nsis
npm run build:win:lite:portable
```

Windows lite 不再执行 `setup-whisper`：不下载模型，也不打包 `.whisper`。  
首次启动后从设置 → 资源拖入引擎和模型。

前置：

```text
node_modules\electron\dist 必须存在；缺了构建脚本会自己用镜像补（失败再走官方）
```

首次构建还会下 `winCodeSign-2.6.0` / `nsis-3.0.4.1` / `nsis-resources-3.4.1`（几 MB，缓存在 `%LOCALAPPDATA%\electron-builder\Cache`），之后不再下载。下载失败会自动换下一个源重试整次构建。

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
        └── data\

%APPDATA%\Nihonco\
├── data\
├── assets\
├── .voicevox\
├── .aivis\
├── .whisper\        ← 用户拖入的模型
└── asr\             ← 用户拖入的 CPU / CUDA 引擎
```

原则：

```text
asar 只读
Windows lite 不带 .whisper 运行时/模型
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
| `npm ci` 说成功，但 `node_modules\electron\dist` 不存在 | Electron 的 postinstall 静默失败；`node node_modules\electron\install.js` |
| Electron / builder 二进制下载卡住 | 设 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`；这两个变量没有自动回退 |
| PowerShell 执行策略禁 npm.ps1 | `cmd /c npm ...` 或 `node ...` |
| PowerShell 5.1 改中文文件变乱码 | 用编辑器，不要 `Set-Content` |
| 旧版应用在跑导致 EPERM | 先停进程，或输出到临时目录 |
| `git push` 握手失败 | `git -c http.sslBackend=openssl push` |
