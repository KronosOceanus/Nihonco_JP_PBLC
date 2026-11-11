# 语音识别与合成

ASR 后端、模型、GPU 阶梯，以及 TTS 声线与朗读规范化。

## 识别模型与后端

两个变量配合决定"用什么识别"：

```ini
ASR_BACKEND=whispercpp     # 默认 whisper.cpp；留空=自动：有 whisper.cpp 就用它，否则 mlx；Windows 恒为 whisper.cpp
ASR_MODEL=ggml-small-q5_1.bin
```

**最省事的改法：设置窗口 → ASR → 语音识别**，两个下拉（后端 / 模型）选完点「应用」后才重启识别服务，
等价于手改上面两行。**没配置过时默认选当前后端里体积最小的模型**（whisper.cpp 是
`ggml-small-q5_1.bin`，mlx 是 `whisper-small-mlx`）。

`ASR_MODEL` 的写法见下表，**mac 新机器默认 small**：

| 写法 | 例子 | 说明 |
|---|---|---|
| HF 仓库名 | `mlx-community/whisper-small-mlx` | 首次启动自动下载到 `.hf-cache/`（约 460MB） |
| 相对项目根 | `.hf-cache/models/whisper-large-v3-turbo` | 手动下的模型放这里，换目录不用改 `.env` |
| 绝对路径 | `/Users/xxx/models/whisper-…` | 模型放在别处时用 |

```ini
# .env
ASR_MODEL=.hf-cache/models/whisper-large-v3-turbo
```

#### 换 turbo（可选，1.6GB）

**新机器默认 small**；想要更准就手动下 turbo——注意 `huggingface_hub` 走 xet 通道在国内常卡 0%，
用 `curl` 直连镜像更稳（支持断点续传）：

```bash
cd <项目目录>
mkdir -p .hf-cache/models/whisper-large-v3-turbo
cd .hf-cache/models/whisper-large-v3-turbo
base="https://hf-mirror.com/mlx-community/whisper-large-v3-turbo/resolve/main"
curl -sL -o config.json "$base/config.json"
curl -L -C - --retry 5 -o weights.safetensors "$base/weights.safetensors"   # 1,613,977,612 字节
```

下完把 `.env` 改成相对路径（见上表），重启应用。

#### 两者怎么选

| 模型 | 体积 | 单句耗时（M2 Pro，3–4 秒音频） | 输出风格 |
|---|---|---|---|
| **small** | 460MB | **0.2–0.3s** | `おねえさん`（全假名） |
| **turbo** | 1.6GB | **0.8–0.9s** | `お姉さん。`（汉字 + 标点） |

同一段录音实测：turbo 约是 small 的 3–4 倍耗时，但汉字写法更接近教材。
练口语求快用 small，练听写求准用 turbo。

#### 怎么确认生效

```bash
curl -s http://127.0.0.1:8765/health
# {"model":"…whisper-large-v3-turbo","requested":"…","fallback":false,
#  "modelFallback":false,"modelFile":"…","ready":true}
#   fallback:false        → 用的就是你要的模型
#   modelFallback:true    → Windows 上「指定的模型文件没找到」，用了目录里别的 .bin
#   modelNote             → 回落原因（找不到哪个、用了哪个）
```

耗时看 `data/logs/asr.log`（设置窗口「ASR → 语音识别 → 日志」控制开关）。

> **mac 用 whispercpp 后端**：一条命令准备（编译 Metal 版 + 下载 181MB 小模型）：
>
> ```bash
> npm run setup:whisper          # 已有就跳过；--force 强制重编；--check 只看计划
> ```
>
> 它会装 cmake（进 `.venv`，不动系统）、下源码、编译 `.whisper/whisper-server`、
> 下 `.whisper/models/ggml-small-q5_1.bin`。Intel Mac 也能用（同一脚本，只是慢一些）。

> **Windows 上 `ASR_MODEL` 只当模型名用**：`ASR_MODEL=medium` → 找 `.whisper/models/ggml-medium.bin`；
> 带 `/` 的 HF 仓库名会被忽略、回落到 `small`；要指具体文件用 `ASR_MODEL_FILE=/abs/path/ggml-xxx.bin`。
> 注意目录里找不到指定名字时会**回落到该目录任意一个 `.bin`**（日志里会打印实际加载的文件）。

### mlx-whisper 细节（可选）

- 不用 ffmpeg：`asr.py` 自己解析 WAV（`_wav_to_array`）
- 渲染层 `preprocess()` 先做三步：裁首尾静音（峰值 10%，留 120ms）/ 峰值归一化（最多 8 倍）/ tanh 软限幅
- `condition_on_previous_text=False`，避免上一句污染下一句
- `/health` 与 `/asr` 必须能并发：`transcribe` 持锁串行，但用 `ThreadingHTTPServer` 让探活立即返回
- 语言 `ja` / `zh` / `auto`；`auto` 会跑两遍，置信度领先 0.30 才推翻第一遍

## 语音合成：VOICEVOX / AivisSpeech

没有 TTS 引擎时不发音，只显示文字和缺引擎提示；不再回落系统 `say`。

支持两个 VOICEVOX 兼容引擎：

```text
VOICEVOX   端口 50021   小夜 / SAYO 等
AivisSpeech 端口 10101  まお / コハク 等
```

设置 → TTS：

```text
引擎 [VOICEVOX / AivisSpeech] → [应用]
模型 [角色 / 风格] → [试听一句]
```

切换时由 `main/voice.js` 管理：

```text
停旧引擎（仅限 Nihonco 自己启动的）
→ 启新引擎
→ 等 /speakers 就绪
→ 切换 TTS URL
→ 失败回滚
```

用户手动启动的引擎只连接、不强杀。引擎异常退出会自动重启（5 秒后，最多 3 次）。

几个实现细节：

- `agent/tts.js` 运行时读 `TTS_ENGINE`，切换后不需要重启整个应用
- 参数（语速 / 音高 / 语调 / 音量）每次合成时从 `data/settings.json` 读取，设置窗口改完立即生效
- 名字表记是 `Nihonco`、读音 `にほんこ`，朗读前用 `PRONOUNCE` 表替换，否则会念成英文
- 模型按角色名匹配，不写死 styleId；VOICEVOX 默认 `小夜`，Aivis 默认 `まお`
- 引擎路径可手动指定：VOICEVOX 写 `VOICEVOX_ENGINE`，Aivis 写 `AIVIS_ENGINE`
- 路径校验要求 `vv-engine/run` / `AivisSpeech-Engine/run`（Windows 为 `.exe`）
- 引擎输出偏小（峰值约 0.32），播放链里按引擎补增益

## 日语模式的中文结果守卫

`language=ja` 只是倾向，不是硬约束；Whisper 仍可能吐中文。

主进程 `agent/lang-guard.js` 在 ASR 返回后检查：

```
· 简体字专属字（这/说/时/个/输/测/试…）
· 中文短语（測試 / 中文輸入測試 等）
· 假名比例（辅助；东京駅这种全汉字日语放行）
```

可疑时 `pet:asr` 返回 `guard.ok = false`，渲染层只回显、不送进对话：

```
HUD：像中文，再说一次？
```

同时拒绝 `< 0.35s` 的过短录音。

限制：

```
· 共享汉字组成的全汉字中文可能漏
· 噪声/人名/表外词仍可能误判
· 不自动重试，避免额外延迟
```

## 识别日志（排查慢用）

设置窗口 **ASR → 语音识别 → 日志** 控制，默认开启（`ASR_LOG=0` 关闭，写回 `.env` 立即生效）。
每次识别追加一行：

```
2026-11-03 21:44:53 | 0.25s | 64044B | ja | asr.py | prompt=34 | - | "今日は寒いですね"
        时间           耗时    音频大小  语言   引擎      热词长度  重试  文本前 60 字
```

位置：

| 平台 | 路径 |
|---|---|
| macOS 源码 | `data/logs/asr.log` |
| macOS 打包 | 同 `userData` 下的 `logs/asr.log` |
| Windows | `%APPDATA%\Nihonco\data\logs\asr.log` |

单文件超过 2MB 自动轮转到 `asr.log.1`。**只记文本，不存音频。**

排查「Windows 识别慢」：如果耗时集中在 1.5–4s 且高低差很大，通常是 whisper.cpp 的 `temperature_inc` 触发回退重解码（请求里设 0 / 启动参数 `-nf`）。

> **隐私提醒**：识别文本（前 60 字）会以明文写进本地日志。
> 自己用没问题；如果把应用发给别人，建议在说明里写清这一点——
> 对方可以在设置窗口「ASR → 语音识别 → 日志」关掉（写回 `.env` 的 `ASR_LOG=0`）。

---

## ASR 后端切换（ASR_BACKEND）

**默认是 `whispercpp`**。留空才是自动：

```
ASR_BACKEND=whispercpp → 优先 whisper.cpp
ASR_BACKEND=mlx        → 优先 mlx
ASR_BACKEND=           → 有 whisper.cpp（binary + model）就用它，否则 mlx
```

mac 选 mlx 需要 `.venv` + 已就绪的 mlx 模型；模型未就绪不会再被算作可用。

```
ASR_BACKEND=whispercpp  mac 默认：whisper.cpp（Metal）；Windows 恒为 whisper.cpp
ASR_BACKEND=mlx        仅 mac：需要 .venv + 已就绪的 mlx 模型
```

设置窗口改完 → `cfg:set-asr` 写 `.env` → `restartAsr()` 停旧进程、按新配置起一遍（端口仍是 8765）。
切换瞬间有几秒不可用（新模型加载；whisper.cpp 首次还要编译 Metal 内核），`/health` 会先 `ready:false`。

## ASR 启动顺序（预热不阻塞端口）

`asr.py` 的顺序是「**先监听、再预热**」：

```python
srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)   # 端口立刻可用
threading.Thread(target=_warmup_bg, daemon=True).start()   # 模型在后台加载
```

理由：以前 `warmup()` 在监听之前跑，模型没下完时端口根本不存在，
前端 `ensureAsr()` 会判定「服务不在线」，界面直接报「识别失败」。

现在：

- `/health` 立刻可答：`ready:false`（模型还在加载）→ `ready:true`
- 加载期间 `/asr` 返回 **503 +「识别模型还在加载，稍等几秒再试」**，不假死、不编内容
- 模型选择**先看本地缓存**：`MODEL_FALLBACKS` 里任何一个有 `weights.npz` 就优先试它，
  并且整体启用 `HF_HUB_OFFLINE=1` —— 避免「turbo 没下完但 small 在本地」时，
  启动又跑去网上拉 1.6GB，把端口拖到几分钟后才出现

## ASR_MODEL 可以是本地目录

`ASR_MODEL` 既接受 HF 仓库名，也接受本地目录，三种写法都行：

```ini
ASR_MODEL=mlx-community/whisper-small-mlx          # HF 仓库名
ASR_MODEL=.hf-cache/models/whisper-large-v3-turbo  # 相对项目根
ASR_MODEL=/abs/path/to/model                       # 绝对路径
```

判断规则在 `asr.py` 的 `_as_local_path()`：以 `/`、`~`、`./`、`../` 开头，或相对项目根存在该目录，
就当本地目录（交给 mlx_whisper 时会转成绝对路径）；否则按仓库名处理。

这样手动下载的模型（`.hf-cache/models/…`）不用写绝对路径，换机器/换目录也不用改 `.env`。

## 模型回落的可见性

Windows 的 `findModel()` 找不到 `ASR_MODEL` 指定的文件时会**回落到 models 目录里任意 `.bin`**。
这个行为原来是静默的，现在有两处显式信号：

```log
[asr] ⚠ 找不到 ggml-medium.bin / medium.bin（ASR_MODEL=medium），回落到 ggml-small.bin
[asr] 模型 ggml-small.bin（已回落，不是 ASR_MODEL 指定的那个）
```

```json
GET /health → { "model": "ggml-small.bin", "requested": "medium",
                "fallback": true, "modelFallback": true,
                "modelNote": "找不到 ggml-medium.bin（ASR_MODEL=medium），回落到 ggml-small.bin" }
```

mac 侧对应字段是 `fallback` + `modelNote`（HF 仓库名加载失败时回退到列表里的下一个）。

`ASR_MODEL` 现在**在调用时读取**（`process.env` 优先），所以设置窗口改完不需要重启识别服务。

## whisper.cpp on mac

mac 默认用 whisper.cpp（Metal，免 Python），也保留 mlx 可选。

**现在一条命令就够了**：

```bash
npm run setup:whisper      # --check 只看计划；--force 强制重编
```

它做四件事：装 cmake（.venv 内）→ 下源码（gh-proxy，9.8MB，sha256 校验）→ 编译 Metal 版
→ 下 `ggml-small-q5_1.bin`（181MB，sha256 校验）。下面是手动步骤（脚本失败时参考）：

```bash
# 1. 编译（只需一次；cmake 可以装进 .venv，避免动系统）
.venv/bin/python -m pip install cmake
curl -sL -o /tmp/wc.tgz "https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/archive/refs/heads/master.tar.gz"
mkdir -p /tmp/whisper.cpp && tar xzf /tmp/wc.tgz -C /tmp/whisper.cpp --strip-components=1
cd /tmp/whisper.cpp
~/Documents/Nihonco_JP/.venv/bin/cmake -B build -DGGML_METAL=ON -DWHISPER_BUILD_TESTS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5
~/Documents/Nihonco_JP/.venv/bin/cmake --build build -j 8 --target whisper-server

# 2. 放进项目（.whisper 已 gitignore）
cp build/bin/whisper-server ~/Documents/Nihonco_JP/.whisper/

# 3. 下模型（ggml 格式）
curl -L -o ~/Documents/Nihonco_JP/.whisper/models/ggml-small-q5_1.bin \
  https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin

# 4. 切换
#   设置窗口 → ASR → 语音识别 → 后端 whisper.cpp / 模型 ggml-small-q5_1.bin
#   或手改 .env：ASR_BACKEND=whispercpp、ASR_MODEL=small-q5_1
```

实测（M2 Pro，1.4 秒日语音频，10 段平均）：

| 配置 | 平均耗时 | RTF |
|---|---|---|
| whisper.cpp small-q5_1（Metal） | **257ms** | **0.20** |
| whisper.cpp small-f16 | 257ms | 0.20 |
| mlx-small | 634ms | 0.49 |
| mlx-turbo | 995ms | 0.78 |
| whisper.cpp turbo-q5_0 | 1066ms | 0.83 |

q5_1 与 f16 的转写结果在这批数据上**逐字一致**，所以默认用 181MB 的 q5_1。

> 首次启动 0.7–4 秒会编译 Metal 内核，预热会吃掉这段；`/health` 的 `ready:false` 会持续到编译完。

切换后端时 `main.js` 的 `restartAsr()` 会停掉当前进程、再按新的 `.env` 起一遍，端口仍是 8765。

## 识别卡死的三层超时

「识别中…」永久不消失，根因通常是**服务端一个请求卡在推理里**（旧版 `_lock` 无限等，后续请求全排队）。
现在有三层兜底：

| 层 | 超时 | 行为 |
|---|---|---|
| asr.py 推理锁 | 15s | 拿不到锁直接 503「识别忙」（故意比客户端 20s 短，让 503 先到） |
| 主进程 fetch | 20s | 超时 → `restartAsr()` → 重试一次 |
| 渲染层看门狗 | 28s | 还没回 → HUD 提示「识别超时」 |

另外 `ensureAsr` 必须等 `/health` 的 `ready:true`：模型加载期间接口也会回 `ok:true`，
只看 ok 会过早发请求拿到 503。

## ASR 契约测试（两台后端 + 真机）

契约基准：`tests/fixtures/asr-contract.json`（字段、类型、端口、prompt/lang 参数名）。

`tests/asr-contract.test.mjs` 分两层：

| 层 | 内容 | 何时跑 |
|---|---|---|
| 源码级 | 两个实现都要有契约字段（`ok/model/requested/fallback/ready`、`text/ms/lang/dur`） | 总是 |
| 运行时 | 真打 `http://127.0.0.1:8765/health` 与 `/asr` 校验类型 | 服务在跑时；不在就 skip |

想强制跑运行时那两条：先起服务（`npm start` 或 `.venv/bin/python asr.py`），再 `node --test tests/asr-contract.test.mjs`。

## 启动自检（TTS / ASR）

原则：**只有「确定起不来」才报；「还在启动」永远不报。**

- 判定函数在 `agent/health.js`（纯函数，有单测）；主进程只负责探测，渲染层只负责显示
- TTS（`voiceSvc.bootCheckTts`，最多等 12s）
  · Windows：当前引擎活着才算可用；引擎缺失/超时才失败
  · 当前引擎活着才算可用；没有 say 回落
  · 引擎切换期间显示「引擎启动中…」，不再回退系统声线
  · 结果缓存 15s，避免重复等
- ASR（`asrSvc.probeAsr`，不可达最多等 30s）
  · `/health` 能连上但 `ready:false` = 模型加载中 → 不报
  · 进程退出 / spawn 失败 / 30s 完全不可达 → failed
  · 首次下载模型可能几分钟，属于 loading，不是失败
- 渲染层 `checkServicesOnBoot()`：两个检查并行，谁先失败谁先入队；两个都失败时 HUD 轮流显示
- 日志：`[health] tts usable=... reason=...` / `[health] asr status=...`
