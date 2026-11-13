# Windows 构建与验收清单（v0.7.37）

> 适用：Windows 10/11 x64，Node ≥ 18（实测 24.22.2 / npm 11.19.1），不需要 Python。
> 安装、平台差异、依赖版本见 [WINDOWS.md](WINDOWS.md)。

---

## 0. 旧 clone 先备份

`model/`、`lib/live2dcubismcore.min.js`、`.env`、`data/` 不跟随仓库更新。

```powershell
cd <项目目录>
Copy-Item -Recurse model\Hiyori $env:USERPROFILE\Desktop\Hiyori-backup -ErrorAction SilentlyContinue
Copy-Item lib\live2dcubismcore.min.js $env:USERPROFILE\Desktop\ -ErrorAction SilentlyContinue
Copy-Item .env $env:USERPROFILE\Desktop\env-backup -ErrorAction SilentlyContinue
```

```powershell
git status
git fetch --tags
git pull --ff-only
git log --oneline -3
```

确认版本号是：

```text
v0.7.37
```

---

## 1. 环境

```powershell
node -v          # ≥ 18
cmd /c npm -v    # PowerShell 禁 npm.ps1 时这样查
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

本次验收的环境：

```text
Windows 11 x64
node  v24.22.2
npm   11.19.1
```

依赖版本（`package-lock.json` 锁定，详表见 WINDOWS.md §2.1）：

| 依赖 | 版本 |
|---|---|
| electron | 45.2.1 |
| electron-builder | 26.18.0 |
| @electron/asar | 3.4.1 |
| kuromoji | 0.1.2 |
| pixi.js / @pixi/unsafe-eval | 7.4.3 |
| pixi-live2d-display-lipsyncpatch | 0.5.0-ls-8 |
| adm-zip | 0.6.1 |
| doublearray / zlibjs / async | 0.0.2 / 0.3.1 / 2.6.4 |

核对：

```powershell
node -e "const l=require('./package-lock.json');for(const n of ['electron','electron-builder','kuromoji','pixi.js','adm-zip'])console.log(n.padEnd(18), l.packages['node_modules/'+n].version)"
```

国内镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

---

## 2. 依赖与配置

```powershell
npm ci
Test-Path node_modules\electron\dist\electron.exe   # 期望 True
npm run setup
```

若 `electron.exe` 缺失（npm 跳过了 postinstall）：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

配置：

```powershell
Copy-Item .env.example .env    # 已存在就跳过
# 填 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
```

---

## 3. 语音资产

v0.7.37 起 Windows lite **不内置** Whisper，构建前后都要单独准备，路径见 [WINDOWS.md](WINDOWS.md) §4。

验收时确认：

- [ ] 构建产物里**没有** `.whisper` 目录（见 §6）
- [ ] 拖入 CPU 引擎 zip → 落到 `%APPDATA%\Nihonco\asr\cpu`
- [ ] 拖入 CUDA zip → 落到 `%APPDATA%\Nihonco\asr\cuda-12.4` 或 `cuda-11.8`（按包内 DLL 判版本）
- [ ] 拖入 `ggml-*.bin` → 落到 `%APPDATA%\Nihonco\.whisper\models`
- [ ] 只装引擎不装模型 → ASR 仍不可用；补模型后可用
- [ ] TTS 已安装 VOICEVOX 或 AivisSpeech 之一

## 4. 构建前检查

`npm run smoke` 是端到端冒烟（真的拉起 Electron 切模式），跑之前必须先放好**源码模式**的 Live2D 资产，
否则渲染层会因为缺 Cubism Core 直接报错退出（表现为 `渲染层报错: Cannot read properties of undefined (reading 'mode')`）：

```powershell
# 源码模式从仓库根目录读，不是 %APPDATA%
Copy-Item <CubismCore>\live2dcubismcore.min.js lib\
Expand-Archive <Hiyori.zip> -DestinationPath model\ -Force   # 期望 model\Hiyori\Hiyori.model3.json
```

两个路径都已写在 `.gitignore` 里，不会进仓库。

```powershell
npm run check:assets:lite
npm test
npm run scan
npm start          # 源码模式能起
npm run smoke
```

当前基线（v0.7.37 / Windows / Node 24.22.2）：

```text
npm test   → tests 344，pass 341，fail 0，skipped 3
npm run scan → 全绿
npm run smoke → 6 步
```

与旧版相比 skip 数会变（v0.7.32 时是 340 / 338 pass / 2 skip），以实际输出为准，但 `fail` 必须是 0。

---

## 5. 构建

```powershell
npm run build:win:lite:dir   # → dist\win-unpacked\Nihonco.exe
npm run build:win:lite       # → NSIS + portable
```

`build:win` / `build:win:dir` 是 lite 别名。

内部只做两步（`tools/build-app.mjs`）：

```text
node tools/check-assets.mjs --lite
node node_modules/electron-builder/cli.js --win --x64 --dir
```

Windows 上**不再**调用 `setup-whisper`，`package.json` 的 `build.files` 也不再列 `.whisper/**`。

期望产物体积（0.7.37 实测）：

```text
dist\win-unpacked\              约 429MB（87 个文件）
win-unpacked 打成 zip           约 170MB
```

卡在下载 electron 时：

```powershell
cmd /c "npx electron-builder --win --x64 --dir -c.electronDist=node_modules/electron/dist"
```

---

## 6. 包内容检查

必须存在：

```powershell
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\data
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\memory
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\shortcuts
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\index.html
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\asr
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\assets
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\live2d
```

`data\` 里应只有这些只读表（10 个）：

```text
data\enrich-cache.seed.json  data\jlpt.json          data\kanji-stems.json
data\pattern-gloss-zh.json   data\patterns-n1..n5.json  data\word-levels.json
```

必须没有：

```powershell
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr whisper-server
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr live2dcubismcore
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings.json
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr wordbook
Test-Path dist\win-unpacked\resources\app.asar.unpacked\.whisper   # False
Test-Path dist\win-unpacked\.voicevox                              # False
```

`findstr persona` 会命中 `agent\persona.js` / `agent\persona-scenes.js` 两个**代码文件**，这是正常的；
要确认的不是它们，而是没有 `data\persona.json`（用 `findstr data\\persona` 查，应为空）。

打包成 zip 后再查一遍（防漏装）：

```powershell
& "<7za 路径>" l <zip> | findstr /i "Hiyori vv-engine .env wordbook whisper-server"
```

以上应全部无输出。

---

## 7. lite 资产放置

拖入安装（推荐），或手工放：

```text
%APPDATA%\Nihonco\assets\model\Hiyori\
%APPDATA%\Nihonco\assets\lib\live2dcubismcore.min.js
```

放好后重启。

---

## 8. 安装后验收

### 启动与设置

- [ ] 安装/绿色版能启动，无白屏
- [ ] 设置页能打开
- [ ] 设置 → 记忆：称呼、读音、等级正常
- [ ] 等级只接受 N5–N1
- [ ] 旧数据里的 `27岁` 不显示为等级
- [ ] 称呼读音为平假名，TTS 朗读昵称时使用读音

### 资源与 Live2D

- [ ] `win-unpacked` 里没有 `.whisper` 目录
- [ ] 首次启动 ASR 未安装，设置 → 资源显示「缺 Whisper 引擎 / 缺模型」
- [ ] 资源区 ASR 三行：CUDA 引擎、CPU 引擎、Whisper 模型
- [ ] CUDA/CPU/模型状态能正确显示「已找到 / 未找到」
- [ ] 下载 CUDA 按钮按驱动显示 12.4 / 11.8
- [ ] CUDA / CPU / ASR `.bin` 拖入后写入对应目录，确认面板写出的目标路径正确
- [ ] 只装引擎不装模型时仍不可用；补模型后 ASR 可用
- [ ] 打包版拖入模型/Core → `%APPDATA%\Nihonco\assets`，无 `ENOTDIR`
- [ ] 打包版拖入 TTS zip → `%APPDATA%\Nihonco\.voicevox` / `.aivis`
- [ ] 缺少 Live2D 资产时提示明确，不崩
- [ ] 放好资产后重启，模型正常渲染
- [ ] 模型切换、取景、口型正常

### ASR 实际引擎

- [ ] 设置 → ASR：实际引擎顺序为 CUDA 12.4 → CUDA 11.8 → CPU
- [ ] 未安装的 CUDA 选项禁用
- [ ] 切换到已安装 CUDA 后 ASR 重启并生效
- [ ] CUDA 连续失败 3 次后显示 CPU，并提示已回退（`active.json` 的 `gpuFallbackPermanent`）
- [ ] 手动切回 CUDA 会重新尝试；`gpuFailures` 归零

### 语音

- [ ] 会話：说话 → 识别 → 回复 → 中文 → 朗读
- [ ] 录音短于 0.35s 被拒绝，不崩
- [ ] 不装 VOICEVOX / AivisSpeech 时 HUD 提示，不崩
- [ ] VOICEVOX / AivisSpeech 首次启动能就绪
- [ ] AivisSpeech 首次 BERT 下载有阶段提示，失败可回滚

### 窗口

- [ ] 顶部拖拽条能移动窗口，模型区域点击是互动不是拖动
- [ ] 右下角/左上角手柄能缩放，右下角为锚点
- [ ] 始终置顶开关生效：设置 → Live2D / 右键菜单 / `Ctrl+Alt+T`
- [ ] 鼠标穿透开关生效：`Ctrl+Alt+P`（穿透后点击落到下层窗口，用快捷键关回来）
- [ ] 窗口位置尺寸重启后保持（`data\window.json`）

### 模式

- [ ] 日本語：正常聊天
- [ ] 日本語 + 解説：说错后黄卡纠错
- [ ] 単語：答题、进度、错题本
- [ ] 例文：复现 / 造句
- [ ] 中国語：只翻译，不聊天、不判分
- [ ] 回显：中文语音 → 原文/译文；朗读可打断
- [ ] 快捷键：录音/显示/静音/聚焦；冲突显示红色

### 振假名与读音

当前只使用 kuromoji，按已知限制验收：

- [ ] `四人` 读作 `よんにん`（不修正为 よにん）
- [ ] `一日中` 读作 `いちにちちゅう`（不修正为 いちにちじゅう）
- [ ] `二十日目` 读作 `にじゅうにちめ`
- [ ] `今日`、`一日`、`十分` 接受 kuromoji 默认读法
- [ ] 振假名只出现在例句卡、单词例句；会話/解説回复不标
- [ ] 读音失败时退回纯文本，不崩

### 数据与隐私

- [ ] 数据目录在 `%APPDATA%\Nihonco\data`
- [ ] 安装包不带 `.env`
- [ ] 安装包不带 `data/persona.json`
- [ ] 安装包不带学习数据 / 日志 / 录音
- [ ] 导出学习数据不包含 persona / shortcuts / window / usage

---

## 9. 已知坑

```text
Ctrl+Alt 可能被输入法/QQ 占用 → 设置里改键
杀软可能拦 whisper-server.exe / vv-engine\run.exe → 加白名单
端口 50021 / 8765 只监听本机；防火墙放行
未签名 exe 会被 SmartScreen 拦 → 更多信息 → 仍要运行
CUDA 包体积大；峰值磁盘可能约 1.8GB
首次启动旧数据会被当成“到期”，复习位偏多，正常
不要用 PowerShell 5.1 改仓库里的中文文件
VOICEVOX / 模型不随安装包分发，公开分发前确认许可
没放 lib/live2dcubismcore.min.js 时 smoke 会报「渲染层 mode」错，实际是缺 Cubism Core
```

---

## 10. 出问题提供

```text
%APPDATA%\Nihonco\data\logs\app.log
%APPDATA%\Nihonco\data\logs\asr.log
%APPDATA%\Nihonco\asr\active.json
```

---

## 11. 回滚

```powershell
git checkout v0.7.37
npm ci
npm run build:win:lite:dir
```

回滚跨过 v0.7.37 时注意：更早的版本把 Whisper 打进包里，体积约 622MB；回滚后要重新 `setup:whisper`（`npm run setup:whisper`）。

不要提交：

```text
.env
data/
dist/
model/
lib/live2dcubismcore.min.js
```
