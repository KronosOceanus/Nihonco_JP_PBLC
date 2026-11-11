# TTS 许可证审计：前三个候选

> 审计范围：Kokoro-82M / sherpa-onnx / Open JTalk + HTS Voice。
> 这是文档与许可证审计，不是法律意见；商业分发前仍应让律师确认。
> 结论只针对“能否随 Nihonco 安装包分发并商业使用”。

## 结论

| 候选 | 代码 | 模型权重 | 声音/声库 | 日语可用性 | 结论 |
|---|---|---|---|---|---|
| **Kokoro-82M** | Apache-2.0 | Apache-2.0（官方 README 称 weights Apache） | 日语 voice 包需逐个确认 | 5 个日语 voice，24kHz | **条件通过，优先 PoC** |
| **sherpa-onnx** | Apache-2.0 | 取决于具体模型 | 取决于具体模型 | 官方预训练表未列日语模型 | **运行时通过，模型侧待定** |
| **Open JTalk + HTS Voice** | 修改 BSD（3-clause） | — | HTS Voice 数据 CC-BY 3.0，但有 HTK 尾巴 | 日语专用，音质机械 | **条件通过，适合兜底** |

一句话：

```
Kokoro：许可最接近可用，集成最重
sherpa：运行时干净，日语模型供应不明
Open JTalk：代码/体积最稳，音质和声库许可有历史包袱
```

## 1. Kokoro-82M

### 代码

- 仓库：https://github.com/hexgrad/kokoro
- LICENSE：Apache-2.0

### 权重

- 官方 README 明确写：“Apache-licensed weights”
- 模型卡：https://huggingface.co/hexgrad/Kokoro-82M
- 82M 参数，ONNX int8 约 92MB；24kHz 单声道

### 日语

`KPipeline(lang_code='j')` 需要：

```
pip install misaki[ja]
```

`misaki[ja]` 依赖：

```
fugashi / jaconv / mojimoji / unidic / pyopenjtalk
```

日语 voice（第三方打包信息，需以官方 voice 包为准）：

```
jf_alpha
jf_gongitsune
jf_nezumi
jf_tebukuro
jm_kumo
```

可参考第三方离线包：

- https://pypi.org/project/kokoro-ja-voice/
- Apache-2.0；int8 ONNX；92MB；5 个日语 voice

### 风险

```
· 第三方打包不是官方发布，供应链要自己验
· 日语 G2P 依赖 pyopenjtalk / unidic / Sudachi 等，需逐个核许可
· Python 运行时或 ONNX Runtime 需要随包，体积/启动/崩溃面增加
· 训练数据与声音来源的授权，模型卡不一定写全
```

### 结论

**可以进入 PoC，但不能直接宣布“可商业分发”。**

下一步必须先确认：

```
□ 官方日语 voice 文件的许可证
□ misaki[ja] / pyopenjtalk / unidic / Sudachi 的许可证
□ 训练数据/声音授权说明
□ Python 或 ONNX 运行时的打包方式
```

## 2. sherpa-onnx

### 代码

- 仓库：https://github.com/k2-fsa/sherpa-onnx
- LICENSE：Apache-2.0
- 提供 C++ / Node addon / Python 等接口，Electron 集成相对方便

### 日语模型

官方预训练模型表：

- https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html

当前列出的 TTS 模型主要是：

```
Matcha：英文/中文
Kokoro：中文+英文
KittenTTS：英文
VITS：中文/英文
Piper：英文
```

**没有列出一个明确的日语 TTS 模型。**

日语模型（例如 MeloTTS 日语）需要从别处找，而：

```
· 运行时 Apache-2.0 ≠ 模型权重可商用
· MeloTTS 代码许可 ≠ 日语模型权重许可
· 每个模型目录通常有自己的 LICENSE
```

### 风险

```
· 找不到官方日语模型 = 不能只凭 sherpa 本身下结论
· 第三方日语模型可能是 CC BY-NC / 研究 only
· 模型来源、训练数据、声音授权都要单独审
```

### 结论

**运行时层通过，模型层未通过。**

在没有指定“具体哪个日语模型 + 它的 LICENSE”之前，不适合作为第一 PoC。

## 3. Open JTalk + HTS Voice

### 代码

- Open JTalk：修改 BSD（3-clause）
- HTS Engine：修改 BSD
- 字典：需单独确认（NAIST-jdic 等）

### 声库

以 `hts_voice_nitech_jp_atr503_m001`（Mei）为例：

- 声库数据：**CC-BY 3.0**
- 但 Debian 把它放在 `contrib`，原因写明：

```
voice data 由 HTK Speech Recognition Toolkit 生成，
HTK 使用 non-free EULA。
```

来源：

- https://sources.debian.org/src/hts-voice-nitech-jp-atr503-m001/
- Debian copyright：CC-BY-3.0 + HTK EULA 说明

这意味着：

```
· 声库本身是 CC-BY，允许复制/分发/改编，需署名
· 但底层工具链的许可历史不干净，商业分发前要单独确认
```

### 质量

```
· 日语专用
· 体积极小（声库 ~几 MB，字典 ~几十 MB）
· CPU 极快，无 GPU
· 音质机械、单调，情感弱
```

### 结论

**代码层最稳，体积最小；声库有 HTK 尾巴，音质不适合作为主音色。**

适合：

```
· 兜底
· 低配机器
· PoC 基线
· 不想引入 Python/ONNX 的场景
```

不适合：

```
· 陪伴型产品的主声音
· 需要情感/自然语调的场景
```

## 推荐顺序

```
1. Kokoro-82M
   先做许可证补审 + 20 句日语 PoC
   通过后再考虑 Python/ONNX 打包

2. Open JTalk + HTS Voice
   作为兜底/基线
   先确认 Mei 声库的 HTK 条款

3. sherpa-onnx
   暂缓
   等找到明确的日语模型 + 模型 LICENSE
```

## 最小验收

```
□ 代码、权重、声库三者都允许商业使用/再分发
□ 日语 20 句：汉字、长句、疑问、口语
□ 首句延迟 < 1.5s
□ 包体积 < 300MB
□ 无网络依赖
□ 有署名/NOTICE
```

## 来源

- Kokoro：https://github.com/hexgrad/kokoro
- Kokoro 模型：https://huggingface.co/hexgrad/Kokoro-82M
- Kokoro 日语离线包：https://pypi.org/project/kokoro-ja-voice/
- sherpa-onnx：https://github.com/k2-fsa/sherpa-onnx
- sherpa 预训练模型：https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html
- Open JTalk：https://github.com/nishimotz/libopenjtalk
- HTS Voice Mei（Debian）：https://sources.debian.org/src/hts-voice-nitech-jp-atr503-m001/
