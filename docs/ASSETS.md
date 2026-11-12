# 模型与语音资产（需自备）

> 应用内入口：**设置 → 资源**，可以直接打开下面这些官方下载页；
> Windows 的 Whisper 引擎（CUDA/CPU）和 Whisper 模型在 ASR 行提供下载链接；
> mac 提供 Whisper 模型下载；
> TTS 行可以分别设置 VOICEVOX / AivisSpeech 的本地引擎路径；
> 也支持把单文件/zip 直接拖进资源区安装。

本仓库**不包含** Live2D 模型、VOICEVOX 引擎/声库、Whisper 模型。原因是它们的条款
不允许（或未明确允许）随仓库再分发。

## 拖放安装

设置 → 资源区支持直接拖入：

```text
Live2D Core       live2dcubismcore.min.js
Live2D 模型       *.model3.json 的 zip
ASR 模型          ggml-*.bin
Whisper CUDA 引擎  whisper-server.exe + ggml-cuda.dll 的 zip（Windows）
Aivis 声线        *.aivmx
VOICEVOX 引擎     vv-engine/run(.exe) 的 zip
AivisSpeech 引擎  AivisSpeech-Engine/run(.exe) 的 zip
```

流程：

```text
拖入
→ 按内容识别类型
→ 拒绝拖错区域
→ 列出目标路径
→ 勾选确认
→ 逐项安装
→ 安装后自检
```

注意：

- 目前只支持单文件和 zip，不支持直接拖目录。
- 安装前会备份，自检失败会尝试回滚。
- ASR 显示「正在加载」表示已安装但服务尚未 ready。
- Whisper CUDA zip 按包内的 `ggml-cuda.dll` 与 `cudart64_*.dll` 识别 12.4 / 11.8，安装前停 ASR，安装后重启。
- Aivis 启动时会从 AivisHub 自动恢复默认声线，删掉默认声线后仍可能回来。
- AivisSpeech 首次启动会自动下载 BERT 模型（约 1GB+）；设置窗口显示阶段、缓存大小，可取消并回滚 VOICEVOX。BERT 暂不支持拖放安装。

## 资产总表（先看这个）

“不打包”= 从 clone 直接 `npm start`；“打包”= 生成安装包/壳应用。

| 场景 | 代码 | Live2D 模型 | Cubism Core | Whisper | VOICEVOX | `.env` | 学习数据 |
|---|---|---|---|---|---|---|---|
| **mac 不打包**<br>`npm start` | 项目根 | 项目 `model/<名字>/` | 项目 `lib/live2dcubismcore.min.js` | 项目 `.whisper`（默认）；mlx 可选 `.venv` | 项目 `.voicevox` 或系统安装；可选 | 项目根 `.env` | 项目 `data/` |
| **mac lite**<br>`npm run build:app:lite` | `Nihonco.app` 是壳，指回项目根 | 不内置 | 不内置 | 项目 `.whisper` | 同上 | 项目根 `.env` | 项目 `data/` |
| **Windows 不打包**<br>`npm start` | 项目根 | 项目 `model/<名字>/` | 项目 `lib/live2dcubismcore.min.js` | 项目 `.whisper/` | 系统安装 VOICEVOX 或 AivisSpeech；必须其一 | 项目根 `.env` | 项目 `data/` |
| **Windows lite**<br>`npm run build:win` | `resources/app.asar` | `%APPDATA%\Nihonco\assets\model\<名字>\` | `%APPDATA%\Nihonco\assets\lib\live2dcubismcore.min.js` | 包内 `app.asar.unpacked\.whisper` | 系统安装 VOICEVOX 或 AivisSpeech；不随包 | `%APPDATA%\Nihonco\data\.env` | `%APPDATA%\Nihonco\data\` |

补充：

- `NIHONCO_ASSETS` 可以覆盖 lite 的外置资产目录；默认是 `%APPDATA%\Nihonco\assets`（mac 对应 `~/Library/Application Support/Nihonco/assets`）。

- 设置页的「资产（当前写入）」显示当前实际写入根：开发是项目根，打包 lite 是 userData/assets。
- `.env` 在打包版位于数据目录（`%APPDATA%\Nihonco\data\.env`），不是安装目录。
- Whisper 在 Windows lite 随包；VOICEVOX / AivisSpeech 不随包。
- Windows 装 VOICEVOX 或 AivisSpeech 任一即可；Aivis 首次启动还要下载 BERT。
- ASR 默认是 whisper.cpp；mac 可选 mlx，用户通过 `npm run setup:mlx` 准备。
- TTS 引擎由 Nihonco 管理：切换时停旧启新，外部手动启动的引擎不会被强杀。

## Live2D 模型

默认找 `model/Hiyori/Hiyori.model3.json`（Hiyori 是 Live2D 官方示例）。

1. 打开 [Live2D 示例数据页](https://www.live2d.com/en/learn/sample/)
2. 同意条款后下载 Hiyori
3. 解压到 `model/Hiyori/`，确保存在 `Hiyori.model3.json`
4. 重新启动

使用 Hiyori 时请保留版权声明：

```
This content uses sample data owned and copyrighted by Live2D Inc.
```

- [Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)
- [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)

条款要点：可以使用、修改、发布派生作品；**未经许可不得再分发素材本身**；
Hiyori 不允许改设计；必须标注版权。

## Live2D Cubism Core

渲染 Live2D 需要 `lib/live2dcubismcore.min.js`（Live2D 的专有 SDK，**不是自由许可证**）。
它也不随仓库分发。

1. 打开 [Cubism SDK for Web 下载页](https://www.live2d.com/en/sdk/download/web/)
2. 同意 Live2D 的 SDK 许可后下载
3. 从 SDK 里取出 `live2dcubismcore.min.js`，放到 `lib/live2dcubismcore.min.js`
4. 重新启动

该文件 © Live2D Inc.，按 Live2D Cubism SDK 的 Proprietary Software License 使用；
本仓库的 PolyForm Noncommercial 许可**不覆盖它**。

## VOICEVOX（日语朗读）

- 引擎：[VOICEVOX 官网](https://voicevox.hiroshiba.jp/)
- 小夜 / SAYO 声库：按 VOICEVOX / VirVox 的说明安装
- macOS 也会自动找 `/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run`
  · 也支持项目 `.voicevox/extracted/...` 或 `VOICEVOX_ENGINE` 环境变量

应用只调用你本机安装的引擎，不打包、不再分发。缺引擎时 Windows 不发音（HUD 提示），
mac 也不再用系统 `say`；缺引擎时只显示文字和提示。

- [VOICEVOX 软件利用规约](https://voicevox.hiroshiba.jp/term/)

## AivisSpeech（可选日语朗读）

- 引擎：[AivisSpeech](https://aivis-project.com/speech/)
- 支持 VOICEVOX 兼容 API，端口默认 `10101`
- macOS 自动查找 `/Applications`、`~/Applications`、开发版 `~/Downloads/AivisSpeech-dev/...`
- 也可以用设置 → TTS →「选择路径」指定 `AivisSpeech-Engine/run`
- 模型是 `.aivmx`（例如 まお / コハク），许可证随模型单独提供
- 首次启动会自动下载日语 BERT 模型（约 1GB+），缓存目录是 `~/Library/Application Support/AivisSpeech-Engine/BertModelCaches`；设置页会显示阶段/大小

Nihonco 只连接/启动你本机安装的引擎，不打包引擎或模型。

## Whisper（语音识别）

- 默认：`npm run setup:whisper`（whisper.cpp + `ggml-small-q5_1.bin`）
- mac 可选 mlx：`npm run setup:mlx`
- 设置 → 资源 → ASR：Windows 可下载 CUDA/CPU 引擎和模型，mac 可下载模型；CUDA zip 也支持拖入安装
- Windows：见 [windows/WINDOWS.md](windows/WINDOWS.md)

模型下载到 `.whisper/` / `.hf-cache/`，都不进仓库。下载会校验 sha256。

打包版：

```text
Windows：exe 在 app.asar.unpacked/.whisper
        用户模型在 %APPDATA%\Nihonco\.whisper\models
        内置 .whisper/models 作为兜底
```


## Windows 安装版的资产位置

Windows 的 lite 构建规则见 [windows/WINDOWS.md](windows/WINDOWS.md)。
这里只讲“资产放哪”。

### lite

安装包不含模型和 Core。用户自己放到：

```
%APPDATA%\Nihonco\assets\
```

实际路径一般是：

```
C:\Users\<用户名>\AppData\Roaming\Nihonco\assets\
```

完整结构：

```
assets\
├── model\
│   └── Hiyori\
│       ├── Hiyori.model3.json
│       ├── Hiyori.moc3
│       ├── textures\
│       ├── motions\
│       └── ...
└── lib\
    └── live2dcubismcore.min.js
```

步骤：

1. 从 [Live2D 示例数据页](https://www.live2d.com/en/learn/sample/) 下载 Hiyori
2. 解压后把整个 Hiyori 目录放到 `assets\model\Hiyori\`
3. 从 [Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) 取出
   `live2dcubismcore.min.js`，放到 `assets\lib\`
4. 重启 Nihonco

快速打开目录：Win + R，输入 `%APPDATA%\Nihonco\assets`。

PowerShell 例子：

```powershell
$assets = "$env:APPDATA\Nihonco\assets"
New-Item -ItemType Directory -Force "$assets\model\Hiyori"
New-Item -ItemType Directory -Force "$assets\lib"

Copy-Item "D:\downloads\Hiyori\*" "$assets\model\Hiyori\" -Recurse
Copy-Item "D:\downloads\live2dcubismcore.min.js" "$assets\lib\"
```

验证：

```
设置 → 资源
  Live2D Core   已找到 · lib/live2dcubismcore.min.js
  Live2D 模型   已找到 · model/Hiyori/Hiyori.model3.json
```

两项都“已找到”后重启。

也可以用环境变量 `NIHONCO_ASSETS` 指向别的目录。

## 自行更换 Live2D 模型

模型和语音是两套独立配置：换模型不影响声线，换声线也不影响模型。

### 1. 准备模型

需要 Cubism 3/4 的模型目录，至少包含：

```
<名字>/
├── <名字>.model3.json
├── <名字>.moc3
├── <名字>.physics3.json（可选）
├── <名字>.pose3.json（可选）
├── textures/
└── motions/
```

模型必须能配合 `lib/live2dcubismcore.min.js` 的版本使用；Core 不匹配时可能白屏。

### 2. 放到哪

| 使用方式 | 放置位置 | 说明 |
|---|---|---|
| 源码 / 开发运行 | `model/<名字>/` | 设置里的模型下拉会自动扫描 |
| Windows lite | `%APPDATA%\Nihonco\assets\model\<名字>\` | 放好后重启；设置里可「打开资产目录」 |

统一要求：目录里必须有 `*.model3.json`。放好后重启应用；设置窗口的模型下拉没出现，先检查文件名和目录层级。

### 3. 在应用里切换

```
设置 → Live2D → 模型下拉
  → 选模型
  → 「应用」临时试看
  → 「保存位置」存成该模型默认取景
```

取景参数（倍数 / 左右 / 上下）按模型路径保存在 `data/live2d-models.json`；换模型不会丢旧模型的取景。

### 4. 许可提醒

模型文件不随仓库分发。Hiyori 只允许使用/修改/发布派生作品，**未经许可不得再分发素材本身**；
其他模型看各自条款。把模型打进 Windows 安装包属于再分发，公开分发前必须确认许可。

## 自行更换声线

### 1. 准备引擎和声库

```
1. 安装 VOICEVOX 或 AivisSpeech
2. 安装想要的声库/模型
3. 确认引擎能正常列出角色
```

Windows 没有日语 SAPI 兜底；mac 也不再回落 `say`。**不装 VOICEVOX / AivisSpeech 就不会发音**。

### 2. 在应用里切换

```
设置 → TTS
  → 引擎选 VOICEVOX / AivisSpeech
  → 点「应用」
  → 模型选角色/风格
  → 点「试听一句」
```

引擎切换会写回：

```
TTS_ENGINE=voicevox
VOICEVOX_NAME=小夜
AIVIS_NAME=まお
```

两个引擎的路径分别写：

```
VOICEVOX_ENGINE=/path/to/vv-engine/run
AIVIS_ENGINE=/path/to/AivisSpeech-Engine/run
```

路径选择只保存，不自动启动；点「应用」才生效。

### 3. 注意

- 声库名必须和 `/speakers` 返回的名字一致；对不上会回落到第一个可用角色
- 换声线后提示音缓存会刷新；如果仍是旧声音，重启应用
- 声库/引擎的再分发限制见上文 VOICEVOX / AivisSpeech 一节
