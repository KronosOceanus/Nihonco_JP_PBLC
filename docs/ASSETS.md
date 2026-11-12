# 模型与语音资产（需自备）

Nihonco 的资产分三类：

```text
必须自备：Live2D 模型、Cubism Core、VOICEVOX / AivisSpeech
安装包自带：Whisper CPU 运行时 + 小模型（Windows lite）
可选外置：Whisper CUDA 引擎、用户自己的 Whisper 模型
```

> 设置 → 资源 提供下载入口和拖放安装。
>
> Windows：Whisper 引擎 CUDA/CPU、Whisper 模型  
> mac：Whisper 模型  
> TTS：VOICEVOX / AivisSpeech 路径选择

源码仓库不包含 Live2D 模型、Cubism Core、VOICEVOX、AivisSpeech。
Windows lite 安装包会包含 **Whisper CPU 运行时和 `ggml-small-q5_1.bin`**，它们不属于 Live2D/TTS 资产。

---

## 1. 资源总表

“不打包”= 从 clone 直接 `npm start`；“打包”= 生成安装包/壳应用。

| 场景 | 代码 | Live2D 模型 | Cubism Core | Whisper | VOICEVOX / AivisSpeech | `.env` | 学习数据 |
|---|---|---|---|---|---|---|---|
| **mac 不打包**<br>`npm start` | 项目根 | 项目 `model/<名字>/` | 项目 `lib/live2dcubismcore.min.js` | 项目 `.whisper`；mlx 可选 `.venv` | 项目 `.voicevox` 或系统安装 | 项目根 `.env` | 项目 `data/` |
| **mac lite**<br>`npm run build:app:lite` | `Nihonco.app` 是壳，指回项目根 | 不内置 | 不内置 | 项目 `.whisper` | 同上 | 项目根 `.env` | 项目 `data/` |
| **Windows 不打包**<br>`npm start` | 项目根 | 项目 `model/<名字>/` | 项目 `lib/live2dcubismcore.min.js` | 项目 `.whisper` | 系统安装，二者其一 | 项目根 `.env` | 项目 `data/` |
| **Windows lite**<br>`npm run build:win` | `resources/app.asar` | `%APPDATA%\Nihonco\assets\model\<名字>\` | `%APPDATA%\Nihonco\assets\lib\live2dcubismcore.min.js` | 包内 `app.asar.unpacked\.whisper` + 小模型 | 系统安装，不随包 | `%APPDATA%\Nihonco\data\.env` | `%APPDATA%\Nihonco\data\` |

补充：

- `NIHONCO_ASSETS` 可以覆盖 lite 的外置资产目录；默认是 `%APPDATA%\Nihonco\assets`（mac 对应 `~/Library/Application Support/Nihonco/assets`）。
- 设置页的「资产（当前写入）」显示实际写入根：开发是项目根，打包 lite 是 `userData/assets`。
- Whisper 在 Windows lite 随包；VOICEVOX / AivisSpeech 不随包。
- CUDA 是可选外置资产，放在 `%APPDATA%\Nihonco\asr\cuda-*`。
- 用户 CPU 引擎放在 `%APPDATA%\Nihonco\asr\cpu`，优先于内置 CPU。

---

## 2. 拖放安装

设置 → 资源区支持直接拖入：

```text
Live2D Core       live2dcubismcore.min.js
Live2D 模型       *.model3.json 的 zip
ASR 模型          ggml-*.bin
Whisper CUDA 引擎  whisper-server.exe + ggml-cuda.dll 的 zip（Windows）
Whisper CPU 引擎   whisper-server.exe + ggml*.dll 的 zip（Windows）
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

- 只支持单文件和 zip，不支持直接拖目录。
- 安装前会备份，自检失败会尝试回滚。
- ASR 显示「正在加载」表示已安装但服务尚未 ready。
- CUDA zip 按 `ggml-cuda.dll` + `cudart64_*.dll` 识别 12.4 / 11.8，安装到 `%APPDATA%\Nihonco\asr\cuda-*`。
- CPU zip 按 `whisper-server.exe` + `ggml*.dll` 且没有 `ggml-cuda.dll` 识别，安装到 `%APPDATA%\Nihonco\asr\cpu`。
- 两种 Whisper 引擎包安装前都停 ASR，安装后重启。
- Aivis 启动时会从 AivisHub 自动恢复默认声线，删掉默认声线后仍可能回来。
- AivisSpeech 首次启动会自动下载 BERT 模型（约 1GB+）；设置窗口显示阶段、缓存大小，可取消并回滚 VOICEVOX。BERT 暂不支持拖放安装。

---

## 3. Live2D 模型

默认找：

```text
model/Hiyori/Hiyori.model3.json
```

步骤：

1. 打开 [Live2D 示例数据页](https://www.live2d.com/en/learn/sample/)
2. 同意条款后下载 Hiyori
3. 解压到 `model/Hiyori/`，确保存在 `Hiyori.model3.json`
4. 重启 Nihonco

使用 Hiyori 时请保留版权声明：

```text
This content uses sample data owned and copyrighted by Live2D Inc.
```

- [Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)
- [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)

条款要点：

```text
可以使用、修改、发布派生作品
未经许可不得再分发素材本身
Hiyori 不允许改设计
必须标注版权
```

### 自行更换模型

准备目录：

```text
<名字>/
├── <名字>.model3.json
├── <名字>.moc3
├── <名字>.physics3.json（可选）
├── <名字>.pose3.json（可选）
├── textures/
└── motions/
```

放哪：

| 使用方式 | 位置 |
|---|---|
| 源码 / 开发运行 | `model/<名字>/` |
| Windows lite | `%APPDATA%\Nihonco\assets\model\<名字>\` |

统一要求：目录里必须有 `*.model3.json`，且 Core 版本要匹配。

切换：

```text
设置 → Live2D → 模型下拉
→ 应用：临时试看
→ 保存位置：写为该模型默认取景
```

取景保存到 `data/live2d-models.json`，换模型不会丢旧模型的取景。

---

## 4. Cubism Core

渲染 Live2D 需要：

```text
lib/live2dcubismcore.min.js
```

它是 Live2D 的专有 SDK，不随仓库分发。

1. 打开 [Cubism SDK for Web 下载页](https://www.live2d.com/en/sdk/download/web/)
2. 同意 Live2D SDK 许可
3. 取出 `live2dcubismcore.min.js`
4. 放到 `lib/live2dcubismcore.min.js`
5. 重启

版权：

```text
© Live2D Inc.
按 Live2D Cubism SDK Proprietary Software License 使用
本仓库的 PolyForm Noncommercial 不覆盖它
```

---

## 5. Whisper（语音识别）

### 默认

```text
npm run setup:whisper
→ whisper.cpp + ggml-small-q5_1.bin
```

mac 可选：

```text
npm run setup:mlx
```

Windows 默认：

```text
内置 CPU 运行时
+ .whisper/models/ggml-small-q5_1.bin
```

### 设置页

```text
设置 → 资源 → ASR
  Windows：
    [下载 Whisper 引擎（CUDA 12.4 版）]  已找到 / 未找到
    [下载 Whisper 引擎（CPU 版）]       已找到 / 未找到
    [下载 Whisper 模型]                 已找到 / 未找到
  mac：
    [下载 Whisper 模型]                 已找到 / 未找到
```

CUDA 下载按钮按驱动推荐 12.4 / 11.8；没有可用 NVIDIA 时禁用。

### 路径

```text
开发：
  .whisper/whisper-server[.exe]
  .whisper/models/*.bin

Windows lite：
  运行时：app.asar.unpacked/.whisper
  内置模型：app.asar.unpacked/.whisper/models
  用户模型：%APPDATA%\Nihonco\.whisper\models

可选 CUDA：
  %APPDATA%\Nihonco\asr\cuda-12.4
  %APPDATA%\Nihonco\asr\cuda-11.8

用户 CPU：
  %APPDATA%\Nihonco\asr\cpu
```

### 实际引擎

```text
设置 → ASR → 实际引擎
  CUDA 12.4
  CUDA 11.8
  CPU
```

只列出已安装的 CUDA；未安装的选项禁用。  
CUDA 连续失败 3 次后运行时回退 CPU，界面显示 CPU 和回退提示。

---

## 6. VOICEVOX

- 引擎：[VOICEVOX 官网](https://voicevox.hiroshiba.jp/)
- 小夜 / SAYO 声库：按 VOICEVOX / VirVox 的说明安装
- macOS 自动查找 `/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run`
- 也支持项目 `.voicevox/extracted/...` 或 `VOICEVOX_ENGINE`
- 也可以把官方 `voicevox-macos-*` 解压到 `.voicevox/` 后执行：

```bash
./tools/install-voicevox.sh
```

应用只调用本机安装的引擎，不打包、不再分发。

缺引擎时：

```text
Windows：不发音，HUD 提示
mac：不再回落系统 say，只显示文字和提示
```

- [VOICEVOX 软件利用规约](https://voicevox.hiroshiba.jp/term/)

---

## 7. AivisSpeech（可选）

- 引擎：[AivisSpeech](https://aivis-project.com/speech/)
- 兼容 VOICEVOX API，端口默认 `10101`
- macOS 自动查找 `/Applications`、`~/Applications`、开发版 `~/Downloads/AivisSpeech-dev/...`
- 设置 → TTS →「选择路径」指定 `AivisSpeech-Engine/run`
- 模型 `.aivmx`，许可证随模型单独提供
- 首次启动下载日语 BERT，缓存目录：
  `~/Library/Application Support/AivisSpeech-Engine/BertModelCaches`

Nihonco 只连接/启动本机引擎，不打包引擎或模型。

---

## 8. Windows 安装版资产位置

Windows lite 不含 Live2D 模型/Core，但包含 Whisper CPU 运行时和小模型。

用户需要放的：

```text
%APPDATA%\Nihonco\assets\
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

快速打开：

```text
Win + R → %APPDATA%\Nihonco\assets
```

PowerShell：

```powershell
$assets = "$env:APPDATA\Nihonco\assets"
New-Item -ItemType Directory -Force "$assets\model\Hiyori"
New-Item -ItemType Directory -Force "$assets\lib"

Copy-Item "D:\downloads\Hiyori\*" "$assets\model\Hiyori\" -Recurse
Copy-Item "D:\downloads\live2dcubismcore.min.js" "$assets\lib\"
```

验证：

```text
设置 → 资源
  Live2D Core   已找到 · lib/live2dcubismcore.min.js
  Live2D 模型   已找到 · model/Hiyori/Hiyori.model3.json
```

---

## 9. 更换声线

```text
1. 安装 VOICEVOX 或 AivisSpeech
2. 安装想要的声库/模型
3. 确认引擎能列出角色
```

设置：

```text
设置 → TTS
→ 引擎选 VOICEVOX / AivisSpeech
→ 应用
→ 模型选角色/风格
→ 试听一句
```

写入：

```text
TTS_ENGINE=voicevox
VOICEVOX_NAME=小夜
AIVIS_NAME=まお
```

路径：

```text
VOICEVOX_ENGINE=/path/to/vv-engine/run
AIVIS_ENGINE=/path/to/AivisSpeech-Engine/run
```

路径选择只保存，点「应用」才生效。

注意：

- 声库名必须和 `/speakers` 返回的一致；对不上会回落到第一个可用角色。
- 换声线后提示音缓存会刷新；仍是旧声音就重启。
- 引擎/声库的再分发限制见上文。

---

## 10. 许可速查

| 资产 | 是否随仓库/安装包 | 注意 |
|---|---|---|
| Live2D 模型 | 否 | 模型条款，通常禁止再分发素材 |
| Cubism Core | 否 | Live2D 专有 SDK |
| Whisper 模型 | Windows lite 随包小模型 | 用户可替换 |
| Whisper CUDA/CPU 引擎 | 否 | 用户下载/拖入 |
| VOICEVOX | 否 | 用户安装，遵守软件规约 |
| AivisSpeech | 否 | 用户安装，模型单独许可 |

原则：

```text
能自备的自备
能不打包的不打包
公开分发前先确认许可
```
