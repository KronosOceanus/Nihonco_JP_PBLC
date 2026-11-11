# Windows 构建与验收清单（v0.7.8）

> 直接照这份做；细节见 [WINDOWS.md](WINDOWS.md)。
> 适用：Windows 10/11 x64，Node 18+，不需要 Python。
>
> ⚠️ `npm run build:win` = **lite**（不含模型/Core）；完整包用 `npm run build:win:full`。

## 0. 旧克隆升级：先备份资产

仓库从 v0.5.x 起把 `model/` 和 `lib/live2dcubismcore.min.js` 移出了跟踪。
旧 clone 直接 `git pull` 可能把这两个删掉。

```powershell
# 先复制到仓库外
Copy-Item -Recurse model\Hiyori $env:USERPROFILE\Desktop\Hiyori-backup
Copy-Item lib\live2dcubismcore.min.js $env:USERPROFILE\Desktop\
Copy-Item .env $env:USERPROFILE\Desktop\env-backup -ErrorAction SilentlyContinue
```

```powershell
cd <项目目录>
git status
git fetch --tags
git pull --ff-only
git log --oneline -3
```

确认是 `v0.7.8` 或更新。

放回：

```powershell
New-Item -ItemType Directory -Force model\Hiyori
Copy-Item $env:USERPROFILE\Desktop\Hiyori-backup\* model\Hiyori -Recurse
Copy-Item $env:USERPROFILE\Desktop\live2dcubismcore.min.js lib\
```

用 miku 等其他模型时，把模型放 `model/<名字>/`，并在 `.env` 设：

```
LIVE2D_MODEL=model/miku/miku.model3.json
```

## 1. 环境

```powershell
node -v          # 18+
npm -v
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

镜像（国内网络）：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

## 2. 依赖与配置

```powershell
npm ci
npm run setup
```

没有 `.env` 时：

```powershell
Copy-Item .env.example .env
# 填 LLM_API_KEY
```

## 3. 语音资产

### whisper.cpp

```powershell
npm run setup:whisper
```

如果缺 `whisper-server.exe` / DLL，下载 b5454：

```
https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip
```

解压到 `.whisper/`，确保有：

```
.whisper/whisper-server.exe
.whisper/whisper.dll
.whisper/ggml.dll
.whisper/ggml-base.dll
.whisper/ggml-cpu-*.dll
.whisper/models/ggml-small-q5_1.bin
```

### VOICEVOX / AivisSpeech

必须装其一（Windows 没有日语 SAPI 兜底）：

```
https://voicevox.hiroshiba.jp/
https://aivis-project.com/speech/
```

VOICEVOX 装小夜 / SAYO 声库；AivisSpeech 首次切引擎会下载 BERT 模型（约 1GB+），
设置页会显示下载阶段和缓存大小。没装不会崩，但不会发音。

## 4. 构建前检查

> lite / full 的区别见 [WINDOWS.md](WINDOWS.md) §4；这里只列操作命令。

lite（默认，不需要模型/Core）：

```powershell
npm run check:assets:lite
```

full（自己用，需要模型/Core）：

```powershell
npm run check:assets
```

两边都跑：

```powershell
npm test               # 322 条（用例数随新增测试变化）
npm run scan           # 应全绿
npm start              # 先开发模式跑一次
```

### 4.1 历史重点验收（v0.7.4）：图标

先确认仓库里有：

```powershell
Get-Item assets\AppIcon.icns, assets\icon.ico
```

构建后检查 exe 图标不是 Electron 默认图标：

```powershell
npm run build:win:dir
Get-Item dist\win-unpacked\Nihonco.exe

# 提取 exe 图标看一眼
Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path 'dist\win-unpacked\Nihonco.exe'))
$ico.ToBitmap().Save("$env:TEMP\nihonco-exe-icon.png")
Invoke-Item "$env:TEMP\nihonco-exe-icon.png"
```

还要看：

- [ ] `dist\win-unpacked\Nihonco.exe` 属性/资源管理器里是 NH 图标
- [ ] NSIS 安装包（`dist\Nihonco-0.7.8-*.exe`，以实际产物名为准）本身也是 NH 图标
- [ ] 安装后的桌面快捷方式、开始菜单快捷方式、任务栏是 NH 图标
- [ ] 16/32px 小尺寸下至少能看出 N，H 是橙色暗示
- [ ] `assets/icon.ico` 不是空文件/损坏；用 Explorer 预览确认

### 4.2 历史重点验收（v0.7.4）：记忆

设置页路径：

```text
设置 → 记忆
```

- [ ] 打开「管理…」能看到资料卡/关系/最近经历
- [ ] 添加一个兴趣，保存后关闭再打开仍在
- [ ] 编辑 episode 摘要，重启后仍是新摘要
- [ ] 删除 episode，重启后不回来
- [ ] 清空记忆有二次确认；清空后面板显示空
- [ ] 确认 `%APPDATA%\Nihonco\data\persona.json` 有写入
- [ ] 安装包里没有 `data/persona.json`（真实个人资料不能进包）

包内容检查：

```powershell
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings-memory
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr persona
```

第一条要有输出；第二条应该没有 `data/persona.json`。

### 4.3 历史重点验收（v0.7.4）：模式语言

这次语言判断已经改成**只看模式**：

- [ ] 日本語模式：日本語聊天正常；中文输入也按日语处理
- [ ] 日本語 + 解説：任何输入都进入解说；黄卡只放纠错/讲解/生词
- [ ] 解説气泡只做反应，不把黄卡里的纠错再讲一遍
- [ ] 中国語模式：中文输入只翻译，不聊天、不答题、不换卡
- [ ] 中国語模式：日语/英语/数字输入也按中文原文硬翻译
- [ ] 中国語模式切换单词/例句：卡片保留，但回车只翻译、不判分
- [ ] 中国語模式不朗读翻译结果

### 4.4 历史重点验收（v0.7.4）：笑声/语音守卫

- [ ] 回复里出现单独的 `w`/`ｗ` 时，气泡显示为 `（笑）`
- [ ] `（笑）` / `www` 朗读是笑声，不是逐字读
- [ ] ASR 短录音（<0.35s）被拒绝，不崩溃
- [ ] 日语回复里不应出现简体中文；异常时有保底

## 5. 构建

同上的版本选择，这里只列命令。lite（默认）：

```powershell
npm run build:win:dir      # dist\win-unpacked\Nihonco.exe
npm run build:win          # NSIS + portable
```

full（带模型/Core，自己用）：

```powershell
npm run build:win:full:dir
npm run build:win:full
```

lite 产物名带 `lite`。full 产物沿用原名字。

确认新设置模块进包：

```powershell
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings-data
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings-shortcuts
npx @electron/asar list dist\win-unpacked\resources\app.asar | findstr settings-memory
```

三条都要有输出。

lite 安装后，把模型/Core 放到：

```powershell
%APPDATA%\Nihonco\assets\model\Hiyori\
%APPDATA%\Nihonco\assets\lib\live2dcubismcore.min.js
```

然后重启。full 不需要这一步。

## 6. 打包版验收

- [ ] lite：没放资产时显示「缺少 Live2D 资源」，放好后重启正常
- [ ] 启动，Live2D 正常渲染
- [ ] 设置 → 资源：Core / 模型 / VOICEVOX 状态正确
- [ ] 会話：说话 → 识别 → 回复 + 中文 + 朗读
- [ ] 点词：气泡/例句里的词可点，浮层有读音/释义，小喇叭能读
- [ ] 解説：日语说错 → 黄卡纠错；「生词」有内容
- [ ] 単語：答题、进度显示实际总数、错题进错题本
- [ ] 例文：例句包含句型核心；复现/造句
- [ ] 回显：中文语音 → 上原文/下译文；朗读可打断
- [ ] 快捷键：录音/显示/静音/聚焦；被占用显示红色
- [ ] 不装 VOICEVOX / AivisSpeech 时 HUD 提示，不崩
- [ ] 数据目录在 `%APPDATA%\Nihonco\data`
- [ ] 安装包没带开发数据 / `.env`

## 7. 已知坑

```
· Ctrl+Alt 可能被输入法/QQ 占用 → 设置里改键
· 杀软可能拦 whisper-server.exe / vv-engine\run.exe → 加白名单
· 端口 50021 / 8765 只监听本机；防火墙放行
· 未签名 exe 会被 SmartScreen 拦 → 更多信息 → 仍要运行
· GPU 包：cuda-12.4 653MB / 11.8 285MB；峰值磁盘约 1.8GB
· 首次启动旧数据会被当成“到期”，复习位偏多（学过 4 / 新词 8），正常
· 不要用 PowerShell 5.1 改仓库里的中文文件（会写坏）
· VOICEVOX / 模型 不随安装包分发，公开分发前确认许可
```

## 8. 出问题给我

```
%APPDATA%\Nihonco\data\logs\app.log
%APPDATA%\Nihonco\data\logs\asr.log
```

## 9. 回滚

```powershell
git checkout v0.7.2
npm ci
npm run build:win:dir
```

不要 push；不要提交 `.env`、`data/`、`dist/`、`model/`、`lib/core`。
