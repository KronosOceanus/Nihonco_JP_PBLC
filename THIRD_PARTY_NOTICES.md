# Third-Party Notices

本仓库的**源代码**以 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供（source-available，**禁止商业使用**；不是 OSI 开源许可证）。
以下组件/资产各自适用其原有许可证；仓库不包含不可再分发的资产。

## 运行时依赖

| 组件 | 许可证 | 说明 |
|---|---|---|
| [Electron](https://www.electronjs.org/) | MIT | 桌面运行时 |
| [kuromoji](https://github.com/takuyaa/kuromoji.js) | Apache-2.0 | 日语分词；词典基于 IPADIC（其条目另有说明） |
| [PixiJS](https://pixijs.com/) | MIT | 渲染 |
| [@pixi/unsafe-eval](https://www.npmjs.com/package/@pixi/unsafe-eval) | MIT | Pixi 扩展 |
| [pixi-live2d-display-lipsyncpatch](https://github.com/RaSan147/pixi-live2d-display) | MIT | Live2D 显示与口型 |
| [Live2D Cubism Core](https://www.live2d.com/sdk/) | 专有（Cubism SDK Proprietary Software License） | **不随仓库分发**；用户从官方 SDK 取 `live2dcubismcore.min.js` 放到 `lib/` |

## 语音

| 组件 | 许可证 / 条款 | 是否随仓库分发 |
|---|---|---|
| [whisper.cpp](https://github.com/ggerganov/whisper.cpp) | MIT | 否（脚本下载/本地构建） |
| Whisper 模型权重 | MIT（OpenAI） | 否（脚本下载） |
| [VOICEVOX 引擎](https://github.com/VOICEVOX/voicevox_engine) | LGPL-3.0；另受 VOICEVOX 软件利用规约约束 | **否**（用户自行安装） |
| 小夜 / SAYO 声库 | 声库自身条款（VirVox） | **否**（用户自行安装） |
| [AivisSpeech Engine](https://github.com/Aivis-Project/AivisSpeech-Engine) | LGPL-3.0（以官方仓库为准） | **否**（用户自行安装） |
| Aivis 声线 `.aivmx` | 各声线自身条款 | **否**（用户自行安装） |
| Aivis 日语 BERT 模型 | HuggingFace 模型仓库条款 | **否**（首次启动由引擎下载） |

VOICEVOX 软件利用规约禁止未经许可再分发；本项目只调用用户本机安装的引擎。
AivisSpeech 及其声线、BERT 模型同样不随仓库分发；生成音频的使用需遵守对应声库/模型条款。

## Live2D 模型

本仓库**不包含** Live2D 模型文件（`model/` 在 `.gitignore` 中）。示例模型
Hiyori 属于 Live2D Original Character，受
[Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)
与 [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)
约束：允许使用/发布派生作品，但**未经许可不得再分发素材本身**，且必须标注版权。

如果你使用 Hiyori，请在你的分发物中保留：

```
This content uses sample data owned and copyrighted by Live2D Inc.
```

## 数据

`data/` 下的词表/句型数据来源与许可证见 [data/README.md](data/README.md)。
若某个数据文件不允许再分发，公开仓库中应移除，改为脚本生成或用户自备。
