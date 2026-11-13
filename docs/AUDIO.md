# 语音识别与合成

本文覆盖：

```text
ASR 后端选择
Windows CPU / CUDA
mac whisper.cpp / mlx
模型路径与回落
识别服务生命周期
识别日志与中文守卫
TTS
启动自检
```

---

## 1. 总链路

```text
麦克风
→ 16k WAV
→ 本地 ASR
→ 日语文本 + lang-guard
→ LLM
→ reply_ja
→ VOICEVOX / AivisSpeech
→ WAV
→ WebAudio
→ 口型
```

音频只在本地识别；发给 LLM 的是文本。

---

## 2. ASR 后端

### 配置

```ini
ASR_BACKEND=whispercpp
ASR_MODEL=ggml-small-q5_1.bin
```

规则：

```text
Windows：恒为 whisper.cpp
mac：whisper.cpp 或 mlx
ASR_BACKEND 留空：有 whisper.cpp 就用，否则 mlx
```

### 设置窗口

```text
设置 → ASR
  引擎       [whisper.cpp] / [mlx]
  实际引擎   [CUDA 12.4] [CUDA 11.8] [CPU]   （Windows）
  模型       [ggml-*.bin]
```

「引擎」和「实际引擎」是两层：

```text
引擎       = 用哪个识别实现
实际引擎   = whisper.cpp 内部用 CPU 还是 CUDA
```

Windows 只显示实际引擎；mac 没有 CUDA 选项。

切换后由 `restartAsr()` 停旧服务、按新配置启动。

---

## 3. Windows：用户安装 CPU 或 CUDA

### 默认

Windows lite **不自带** Whisper。首次使用从设置 → 资源拖入：

```text
CPU 引擎 zip → %APPDATA%\Nihonco\asr\cpu
CUDA 引擎 zip → %APPDATA%\Nihonco\asr\cuda-*
模型 .bin → %APPDATA%\Nihonco\.whisper\models
```

默认：

```text
backend = whisper.cpp
engine  = cpu（装了 CPU 引擎后）
```

### 可选 CUDA

CUDA 12.4 / 11.8 装在：

```text
%APPDATA%\Nihonco\asr\cuda-*
```

用户 CPU 装在：

```text
%APPDATA%\Nihonco\asr\cpu
```

获取方式、zip 识别规则、拖入安装细节见 [ASSETS.md](ASSETS.md) §5。  
AUDIO 只负责运行时行为。

### 实际引擎

```text
设置 → ASR → 实际引擎
  CUDA 12.4
  CUDA 11.8
  CPU
```

只列出已安装的 CUDA；未安装的禁用。

### CUDA 回退 CPU

```text
CUDA 启动失败
→ 记录 gpuFailures
→ 连续 3 次失败后固定 CPU
→ 实际引擎显示 CPU，并提示已回退
```

手动切回 CUDA 会重新尝试。

## 4. mac：whisper.cpp 或 mlx

### whisper.cpp（Metal，默认）

```bash
npm run setup:whisper
```

它做：

```text
装 cmake（.venv 内）
下 whisper.cpp 源码
编译 Metal 版
下 ggml-small-q5_1.bin（181MB）
```

路径：

```text
.whisper/whisper-server
.whisper/models/ggml-small-q5_1.bin
```

### mlx（可选）

```bash
npm run setup:mlx
```

需要：

```text
.venv/bin/python
.hf-cache/models/...
```

`asr.py` 是 mlx 后端：

```text
先监听端口，再后台加载模型
/health 立即返回 ready:false
加载完成后 ready:true
```

模型未就绪时不会被视为可用。

### 后端回退

```text
mac 选 mlx，但 venv/模型不可用
→ 回退 whisper.cpp

mac 选 whisper.cpp，但 binary/模型不可用
→ 回退 mlx
```

Windows 没有 mlx。

### 性能参考

M2 Pro，1.4 秒日语音频，10 段平均：

| 配置 | 平均耗时 | RTF |
|---|---|---|
| whisper.cpp small-q5_1（Metal） | 257ms | 0.20 |
| mlx-small | 634ms | 0.49 |
| mlx-turbo | 995ms | 0.78 |
| whisper.cpp turbo-q5_0 | 1066ms | 0.83 |

q5_1 与 f16 在这批数据上逐字一致，所以默认用 181MB 的 q5_1。

---

## 5. 模型

### 写法

```ini
ASR_MODEL=ggml-small-q5_1.bin
ASR_MODEL=medium
ASR_MODEL=.hf-cache/models/whisper-large-v3-turbo
ASR_MODEL=/abs/path/to/model
```

### 目录

模型目录、内置/用户位置和安装方式见 [ASSETS.md](ASSETS.md) §5。

### 回落

whisper.cpp 找不到指定模型时：

```text
回落到最小可用 .bin
```

日志和 `/health` 会记录：

```json
{
  "fallback": true,
  "modelFallback": true,
  "modelNote": "找不到 ggml-medium.bin，回落到 ggml-small.bin"
}
```

### 默认模型

```text
whisper.cpp：ggml-small-q5_1.bin（181MB）
mlx：whisper-small-mlx
```

设置窗口未配置时选当前后端里最小的模型。

---

## 6. 识别服务生命周期

```text
设置 → ASR → 应用
→ 写配置
→ 停旧 ASR
→ 起新 ASR
→ /health 等待 ready
```

端口固定：

```text
8765
```

切换期间：

```text
/health ready:false
/asr 返回 503「模型还在加载」
```

不会假死或编造结果。

### 超时

| 层 | 超时 | 行为 |
|---|---|---|
| ASR 推理锁 | 15s | 503「识别忙」 |
| 主进程 fetch | 20s | 重启 ASR，重试一次 |
| 渲染层看门狗 | 28s | HUD「识别超时」 |

---

## 7. 中文结果守卫

`language=ja` 只是倾向，Whisper 仍可能吐中文。

`agent/lang-guard.js` 检查：

```text
简体字专属字
中文短语
假名比例
```

可疑时：

```text
guard.ok = false
→ 只回显，不送进对话
→ HUD「像中文，再说一次？」
```

过短录音：

```text
< 0.35s 直接拒绝
```

限制：

```text
共享汉字组成的全汉字中文可能漏
噪声/人名/表外词仍可能误判
不自动重试，避免额外延迟
```

---

## 8. 识别日志

设置窗口：

```text
ASR → 语音识别 → 日志
```

默认开启；`ASR_LOG=0` 关闭。

每次识别追加：

```text
时间 | 耗时 | 音频大小 | 语言 | 引擎 | 热词长度 | 重试 | 文本前 60 字
```

路径：

| 平台 | 路径 |
|---|---|
| macOS 源码 | `data/logs/asr.log` |
| macOS 打包 | `userData/logs/asr.log` |
| Windows | `%APPDATA%\Nihonco\data\logs\asr.log` |

单文件超过 2MB 轮转到 `asr.log.1`。只记文本，不存音频。

隐私提醒：

```text
识别文本会明文写入本地日志
发给别人前建议说明
对方可在设置里关闭
```

---

## 9. TTS

支持两个 VOICEVOX 兼容引擎：

```text
VOICEVOX    端口 50021
AivisSpeech 端口 10101
```

设置：

```text
设置 → TTS
  引擎 [VOICEVOX / AivisSpeech] → 应用
  模型 [角色 / 风格] → 试听一句
```

切换由 `main/voice.js` 管理：

```text
停旧引擎（仅限 Nihonco 自己启动的）
→ 启新引擎
→ 等 /speakers 就绪
→ 切换 TTS URL
→ 失败回滚
```

约定：

```text
外部手动启动的引擎只连接，不强杀
引擎异常退出自动重启（5 秒后，最多 3 次）
参数每次从 settings.json 读取，改完立即生效
TTS 直接读原文，不经过读音表
```

声线：

```text
VOICEVOX 默认 小夜
Aivis 默认 まお
```

名称匹配：

```text
按角色名匹配，不写死 styleId
对不上时回落到第一个可用角色
```

路径：

```text
VOICEVOX_ENGINE
AIVIS_ENGINE
```

要求入口：

```text
vv-engine/run
AivisSpeech-Engine/run
Windows 为 .exe
```

缺引擎：

```text
不发音
HUD 提示
不再回落系统 say
```

---

## 10. 启动自检

原则：

```text
只有确定起不来才报
还在启动不报
```

- TTS：最多等 12s；引擎缺失/超时才失败
- ASR：最多等 30s；`ready:false` 视为 loading，不报错
- 两个都失败时 HUD 轮流显示
- 日志：
  `[health] tts usable=... reason=...`
  `[health] asr status=...`

---

## 11. 契约测试

```text
tests/fixtures/asr-contract.json
tests/asr-contract.test.mjs
```

两层：

```text
源码级：字段/端口/prompt/lang 参数名
运行时：真打 /health 和 /asr，服务没跑就 skip
```

强制运行时：

```bash
npm start
node --test tests/asr-contract.test.mjs
```
