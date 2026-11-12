# Windows 构建与验收清单（v0.7.19）

> 适用：Windows 10/11 x64，Node 18+，不需要 Python。
> 细节和平台差异见 [WINDOWS.md](WINDOWS.md)。

## 0. 旧 clone 先备份资产

`model/`、`lib/live2dcubismcore.min.js`、`.env`、`data/` 都不跟随仓库更新。

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

确认当前是：

```text
v0.7.19
```

## 1. 环境

```powershell
node -v          # 18+
npm -v
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

国内网络镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

## 2. 依赖与配置

```powershell
npm ci
npm run setup
```

没有 `.env`：

```powershell
Copy-Item .env.example .env
# 填 LLM_API_KEY
```

## 3. 语音资产

### whisper.cpp

```powershell
npm run setup:whisper
```

必须存在：

```text
.whisper/whisper-server.exe
.whisper/whisper.dll
.whisper/ggml.dll
.whisper/ggml-base.dll
.whisper/ggml-cpu-*.dll
.whisper/models/ggml-small-q5_1.bin
```

### VOICEVOX / AivisSpeech

Windows 没有日语 SAPI 兜底，必须装一个：

```text
https://voicevox.hiroshiba.jp/
https://aivis-project.com/speech/
```

- VOICEVOX：需要小夜 / SAYO 声库
- AivisSpeech：首次切引擎会下载 BERT，约 1GB+
- 设置页会显示引擎状态和下载阶段

## 4. 构建前检查

lite 是默认版本，不需要模型/Core：

```powershell
npm run check:assets:lite
```

两边都跑：

```powershell
npm test
npm run scan
npm start
```

当前基线：

```text
npm test  → 328 条（以实际输出为准）
scan      → 全绿
```

## 5. 构建

### lite（公开支持）

```powershell
npm run build:win:lite:dir   # dist\win-unpacked\Nihonco.exe
npm run build:win:lite       # NSIS + portable
```

`build:win` / `build:win:dir` 是 lite 的别名。

## 6. 包内容检查

确认设置模块进包：

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

## 7. lite 资产放置

```text
%APPDATA%\Nihonco\assets\model\Hiyori\
%APPDATA%\Nihonco\assets\lib\live2dcubismcore.min.js
```

放好后重启。放好后重启即可。

## 8. 安装后验收

### 启动与设置

- [ ] 安装/绿色版能启动，无白屏
- [ ] 设置页能打开
- [ ] 设置 → 记忆 → 资料卡：称呼、称呼读音、等级正常
- [ ] 等级只接受 N5–N1
- [ ] 旧数据里的 `27岁` 不再显示为等级
- [ ] 称呼读音是平假名，TTS 朗读昵称时使用读音

### 资源与 Live2D

- [ ] 打包版拖入模型/Core 后写到 `%APPDATA%\Nihonco\assets`，不出现 `ENOTDIR`
- [ ] 打包版拖入 TTS zip 后写到 `%APPDATA%\Nihonco\.voicevox` / `.aivis`
- [ ] 打包版拖入 ASR `.bin` 后写到 `%APPDATA%\Nihonco\.whisper\models`
- [ ] 内置 `.whisper\models` 里的模型仍能作为兜底显示和选择
- [ ] 设置 → 资源：Core / 模型 / VOICEVOX 状态正确
- [ ] 缺少 Live2D 资产时显示明确提示，不崩
- [ ] 放好资产后重启，模型正常渲染
- [ ] 模型切换、取景、口型正常

### 语音

- [ ] 会話：说话 → 识别 → 回复 → 中文 → 朗读
- [ ] 录音短于 0.35s 被拒绝，不崩溃
- [ ] 不装 VOICEVOX / AivisSpeech 时 HUD 提示，不崩
- [ ] VOICEVOX / AivisSpeech 首次启动能就绪
- [ ] AivisSpeech 首次 BERT 下载有阶段提示，失败可回滚

### 模式

- [ ] 日本語：正常聊天
- [ ] 日本語 + 解説：说错后黄卡纠错
- [ ] 単語：答题、进度、错题本
- [ ] 例文：复现/造句
- [ ] 中国語：只翻译，不聊天、不判分
- [ ] 外国語：按原文翻译
- [ ] 回显：中文语音 → 原文/译文；朗读可打断
- [ ] 快捷键：录音/显示/静音/聚焦；冲突显示红色

### 振假名与读音

- [ ] `四人` 显示/判定为 `よにん`
- [ ] `四人家族です。` 的振假名是 `四人（よにん）`
- [ ] 没有人工例外表时，多读音词按 kuromoji 默认读音
- [ ] `今日`、`一日` 这类语境词即使读错也不崩，记录具体例子

### 数据与隐私

- [ ] 数据目录在 `%APPDATA%\Nihonco\data`
- [ ] 安装包不带 `.env`
- [ ] 安装包不带 `data/persona.json`
- [ ] 安装包不带学习数据 / 日志 / 录音

## 9. 已知坑

```text
Ctrl+Alt 可能被输入法/QQ 占用 → 设置里改键
杀软可能拦 whisper-server.exe / vv-engine\run.exe → 加白名单
端口 50021 / 8765 只监听本机；防火墙放行
未签名 exe 会被 SmartScreen 拦 → 更多信息 → 仍要运行
GPU 包体积大；峰值磁盘可能约 1.8GB
首次启动旧数据会被当成“到期”，复习位偏多，正常
不要用 PowerShell 5.1 改仓库里的中文文件
VOICEVOX / 模型不随安装包分发，公开分发前确认许可
```

## 10. 出问题提供

```text
%APPDATA%\Nihonco\data\logs\app.log
%APPDATA%\Nihonco\data\logs\asr.log
```

## 11. 回滚

```powershell
git checkout v0.7.18
npm ci
npm run build:win:lite:dir
```

不要提交：

```text
.env
data/
dist/
model/
lib/live2dcubismcore.min.js
```
