# Windows 构建与验收清单（v0.7.38）

> 适用：Windows 10/11 x64，Node 18+，不需要 Python。
> 安装、平台差异见 [WINDOWS.md](WINDOWS.md)。

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

确认：

```text
v0.7.38
```

---

## 1. 环境

```powershell
node -v          # 18+
npm -v
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

国内镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

换源不是回退：没设就是 GitHub，失败不会自动切镜像。npm 包另加
`--registry https://registry.npmmirror.com`。

---

## 2. 依赖与配置

```powershell
npm ci
npm run setup
```

确认 Electron 二进制落地（`npm ci` 可能静默跳过下载，npm 不报错）：

```powershell
Test-Path node_modules\electron\dist\electron.exe   # 应为 True
node node_modules\electron\install.js               # 缺了再跑这条
```

```powershell
Copy-Item .env.example .env
# 填 LLM_API_KEY
```

---

## 3. 语音资产

准备方式与路径见 [WINDOWS.md](WINDOWS.md) §4 和 [ASSETS.md](../ASSETS.md) §5。

v0.7.37 起 Windows lite **不内置** Whisper 运行时和模型，验收前先自己放好：

- [ ] 安装包 / `win-unpacked` 里没有 `.whisper` 目录
- [ ] CPU 引擎 zip 拖入 → `%APPDATA%\Nihonco\asr\cpu`（有 `whisper-server.exe` + dll）
- [ ] CUDA 引擎 zip（可选）拖入 → `%APPDATA%\Nihonco\asr\cuda-12.4` / `cuda-11.8`
- [ ] 模型 `ggml-*.bin` 拖入 → `%APPDATA%\Nihonco\.whisper\models`
- [ ] 只装引擎不装模型时 ASR 不可用，补模型后自动可用
- [ ] TTS 已安装 VOICEVOX 或 AivisSpeech 之一

## 4. 构建前检查

```powershell
npm run check:assets:lite
npm test
npm run scan
npm start
npm run smoke
```

当前基线：

```text
npm test       → 344（341 pass，3 skipped）
scan           → 全绿
smoke          → 6 步
smoke:settings → 通过
```

skipped 数随本机资产变：`.whisper` 里有模型 / whisper-server 在跑时，
运行时 ASR 契约那几条会真的执行（341→342→343 pass）。不是回归。

---

## 5. 构建

```powershell
npm run build:win:lite:dir   # dist\win-unpacked\Nihonco.exe
npm run build:win:lite       # NSIS + portable
```

`build:win` / `build:win:dir` 是 lite 别名。

前置与首次开销：

```text
node_modules\electron\dist 必须存在（缺了 node node_modules\electron\install.js）
首次构建下 winCodeSign-2.6.0 / nsis-3.0.4.1 / nsis-resources-3.4.1（几 MB，之后走缓存）
不下载 whisper，也不打包 .whisper
```

---

## 6. 包内容检查

```powershell
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\data
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\memory
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\shortcuts
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings\\index.html
```

确认没有个人数据：

```powershell
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr persona
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings.json
```

后两条不应出现。

---

## 7. lite 资产放置

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
- [ ] 首次启动（引擎和模型都没装）HUD 提示「缺 Whisper 引擎 / 设置 → 资源」

### 资源与 Live2D

- [ ] 安装包/`win-unpacked` 里没有 `.whisper` 目录
- [ ] 首次启动 ASR 未安装，设置 → 资源显示「缺 Whisper 引擎 / 缺模型」
- [ ] 资源区 ASR 三行：CUDA 引擎、CPU 引擎、Whisper 模型
- [ ] CUDA/CPU/模型状态能正确显示“已找到 / 未找到”
- [ ] 下载 CUDA 按钮按驱动显示 12.4 / 11.8
- [ ] CUDA / CPU / ASR `.bin` 拖入后写入对应目录（路径见 ASSETS）
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
- [ ] CUDA 连续失败 3 次后显示 CPU，并提示已回退
- [ ] 手动切回 CUDA 会重新尝试

### 语音

- [ ] 会話：说话 → 识别 → 回复 → 中文 → 朗读
- [ ] 录音短于 0.35s 被拒绝，不崩
- [ ] 不装 VOICEVOX / AivisSpeech 时 HUD 提示，不崩
- [ ] VOICEVOX / AivisSpeech 首次启动能就绪
- [ ] AivisSpeech 首次 BERT 下载有阶段提示，失败可回滚

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
```

---

## 10. 出问题提供

```text
%APPDATA%\Nihonco\data\logs\app.log
%APPDATA%\Nihonco\data\logs\asr.log
```

---

## 11. 回滚

```powershell
git checkout v0.7.37          # 上一个发布版本
npm ci
npm run build:win:lite:dir
```

注意：v0.7.37 之前装过旧版的话，旧包里 `.whisper` 是随包的；回滚后
`%APPDATA%\Nihonco` 里用户自己拖入的引擎/模型不会被删，可以继续用。

不要提交：

```text
.env
data/
dist/
model/
lib/live2dcubismcore.min.js
```
