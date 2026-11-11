# 开发笔记（NOTES）

> 这里只保留**决策、踩坑、为什么**；具体系统怎么运作见 `docs/` 下的对应文档。

## 渲染层

| 组成 | 版本 / 说明 |
|---|---|
| PixiJS | 7.4.3 |
| pixi-live2d-display-lipsyncpatch | 0.5.0-ls-8（cubism4 构建） |
| Cubism Web Core | `lib/live2dcubismcore.min.js` |
| 模型 | Live2D 官方示例 **Hiyori**（`model/Hiyori/`） |

- 必须经 **http 访问**（Electron 里由本地静态服务提供）；`file://` 会被 CORS 拦掉贴图。
- 模型原生 2976×4175，窗口只有 380×560 → `scale` 约 0.13，脸很小。用 `zoom` 做**半身取景**：头顶留一点边、腿裁到窗口外。
- 视线修正 `fx` / `fy`：不同模型参数正负约定不同，默认值按 Hiyori 调的，**换模型大概率要改**，否则视线往反方向看。
- `autoHitTest: false, autoFocus: false`：不接管点击/焦点（0.5.0 起 `autoInteract` 已弃用，写了会出 warning）。

---

## ⚠️ 核心坑：为什么「帧外设参数」一定失效

`InternalModel.update()` 每帧的执行顺序（从库源码读出来的）：

```
beforeMotionUpdate → motionManager.update → afterMotionUpdate
→ saveParameters()          ← 存一份快照
→ expression → eyeBlink → updateFocus → updateNaturalMovements
→ physics → pose
→ beforeModelUpdate
→ coreModel.update()        ← 真正生效
→ loadParameters()          ← 把参数恢复成快照！
```

**所以 `coreModel.setParameterValueById()` 在帧外调用（控制台、定时器、普通事件回调里）会被下一帧的 `loadParameters()` 抹掉。**
症状是「设了 0.8，读回来 0」——代码看起来没错，功能完全不生效。

**唯一正确的写入位置**：`beforeModelUpdate` 事件回调里。

---

## 口型：自己算比库自带的稳

**为什么不用库自带的 `model.speak()`**：它会把 `ParamMouthOpenY` 长时间**顶死在 1.0**（实测连续 25 帧全 1.0），映射没有标定，听感上嘴一直在最大张开。

现在的做法：自己建 `AudioContext` + `AnalyserNode`（`fftSize 1024`），每帧读时域数据算 **RMS**：

```js
const mouth = { max: 0.85, gain: 4.6, floor: 0.012 };   // 实测标定值
const raw = rms > mouth.floor ? Math.pow(rms * mouth.gain, 0.7) : 0;
mouth.target = Math.min(mouth.max, raw);
```

- 平滑：张开快（0.55）、闭合慢（0.25）
- 上限 0.85，避免顶到全开
- 在 `beforeModelUpdate` 里写 `ParamMouthOpenY`（见第 2 节）

### 口型标定数据（Tingting，2.25 秒，137 帧）

| 指标 | 值 |
|---|---|
| RMS | p50 0.102 / p90 0.180 / p95 0.187 / max 0.199 |
| 嘴型（最终值） | p50 **0.60** / p90 0.81 / p95 0.82 / max 0.85 |
| 顶死（≥0.84）占比 | **1.5%**（旧参数 `gain 7.5` 时是 48%） |

**换 TTS 声线或改音量后要重新标定**：把 `gain` 调到「p95 ≈ 0.85、顶死占比 < 10%」。
现在的声线是小夜（VOICEVOX），不同引擎的输出电平差别大，所以播放增益按引擎分开设（`PLAY_GAIN`）。

---

## 音频链路：一条路，且打断必须兑现 Promise

```
src ──→ analyser ──→ gainNode ──→ destination
```

**只有一个出口。** 曾经在每次播放时又给 `analyser` 直连了一次 `destination`，导致同信号两路叠加（约 +6dB），增益形同虚设——那句「1.45 会爆」的注释就是这么来的。

**打断（barge-in）时必须手动兑现旧的 Promise**：

```js
function stopSpeech() {
  audioEl.pause();
  if (pendingResolve) { pendingResolve(); }   // 不兑现 → await playAudio() 永远挂着
}
```

不兑现的后果很具体：`dailyBusy` 卡在 true，表现为「打字、切模式、空格跳过全部没反应」，只有「新規」能救。另外加了 45 秒兜底强制兑现。

---

## 窗口层（Electron）

- **透明无边框** + `alwaysOnTop`
- 层级：`floating`(3) 常驻 → 不挡输入法；`screen-saver`(1000) 压住一切。`Cmd+Ctrl+T` 手动切。
  常驻用 `floating` 是因为 `screen-saver` 会把**中文输入法的候选框**盖在下面。
- **输入框聚焦时降层级**：IME 候选窗是独立窗口（层级约 100），比 `floating` 高但比 `screen-saver` 低，所以在打字时把窗口降到 `floating`，候选框才看得见。
- **鼠标穿透**：`setIgnoreMouseEvents(true, { forward: true })` + `Cmd+Ctrl+P` 切换，穿透时仍能收到 hover 以便恢复。
- **单实例锁必须在 `app.setPath('userData', ...)` 之后**：顺序反了会把锁文件写进默认目录，导致「明明只有一个实例却提示已在运行」。
- 应用包是 clone `node_modules/electron/dist/Electron.app` 再塞 `app/`，`bootstrap.js` 从 `Nihonco.app/Contents/Resources/app` 向上 4 层找项目根。**整个项目目录可以搬走，单独的 `.app` 不能拖走**，否则会去找 `Documents/main.js`。

---

## 学习系统（单词）

**每日 20 词 = 新词 10 + 错题 6 + 跳过 2 + 学过 2**（1:1:3:5 放大两倍）。
池子不够就少几个，**不拿新词补位**；只有当新词不足 10 个（这一档快学完）时，才降级成「新词 → 错题 → 跳过 → 学过」补满 20。

状态机（`agent/wordbook.js`）：

```
new ──错──→ wrong ──连对 2 次──→ ok（毕业）
 └──空──→ skip  ──连对 2 次──→ ok
ok ──错──→ 打回 wrong
```

- **毕业条件只有一个：连续答对 2 次**，中途答错清零。日模式/復習模式的答对都算同一个 streak。
- 今日统计按**单词**算，不按次数：一个词错三次再答对，只记「1 个对」。
- 「復習」按钮只轮错题本；错题本空的时候点击只弹 HUD 提示，不切模式。最后一个错题毕业时语音庆祝并自动回每日。

**键盘拼写提示**（`agent/romaji.js`）：给的是「IME 里敲什么能出这个词」。踩过的坑：

- 缺 `ちぇ/しぇ/じぇ/つぁ` 等小写元音组合 → `チェック` 被拼成 `chiekku`，打不出来
- 促音双写规则：`ch`/`ts` 前写 `t`（`まっちゃ → matcha`、`みっつ → mittsu`），其它取首字母
- `を` 必须是 `wo`（打 `o` 出的是「お」）
- 词表里有 705 个外来语的 `kana` 字段是**英文**（`escalator`、`door`），必须校验「纯假名」否则读音直接显示英文

---

## 数据与安全

- **原子写**：所有 JSON 先写 `.tmp` 再 `rename`（`agent/jsonfile.js`）。直接覆盖时崩溃会让文件损坏 → `load()` 的 catch 返回空对象 → **进度静默清零**。
- **例句缓存分两层**：`enrich-cache.seed.json`（随仓库，别人 clone 就能用）+ `enrich-cache.json`（本地新增，忽略）。
- **静态服务三层防护**：
  1. Host 必须是 `127.0.0.1` / `localhost`（挡 DNS rebinding）
  2. 含 `..` 段 / 反斜杠 / 空字节直接 404（`./`、`//` 归一化后放行）
  3. 白名单只放行 `pet.html`、`pet.js`、`lib/`、`model/`、`node_modules/pixi*`、`.voice/say.wav`
  → `.env`、`data/*.json`、`.voice/rec-*.wav` 不可能通过 HTTP 读到
- **进程只清理自己的**：`.voice/procs.json` 登记 PID，退出时清理；发现端口被别的程序占用**只提示不动手**（否则会误杀用户自己装的 VOICEVOX）。

---

## 调试钩子

全在 `.env.example` 末尾，常用的：

| 变量 | 作用 |
|---|---|
| `PET_SHOT=1` + `PET_SHOT_DELAY` + `PET_SHOT_EXIT` | 截图到 `.voice/shot.png` 后退出 |
| `PET_EVAL="..."` + `PET_EVAL_DELAY` | 在渲染层执行一段 JS，结果打到 stdout |
| `PET_MODE_TEST=word` | 启动后直接进单词模式 |
| `PET_CHAT_TEST=1` / `PET_SAY="..."` | 模拟一次对话 / 一句朗读 |
| `PET_MIC_TEST=1` | 录 1.5 秒并走完识别链路 |
| `PET_DEBUG=1` | 打印静态服务端口等 |

渲染层还有 `window.__pet`（`sendChat`、`dailyNext`、`card`、`recState()`、`stopSpeech()` 等），
自检脚本直接调它，比点 UI 稳。

---

## 已知限制 / 待办

- 双平台，前提不同：
  - macOS：`lsof`；ASR 默认 whisper.cpp（Metal），mlx-whisper 为可选后端
  - Windows：whisper.cpp（+ `ggml-*.bin` 模型）、VOICEVOX / AivisSpeech（必装其一；没有日语 SAPI 声线，
    缺引擎时直接不发音并提示安装）、`taskkill` / `netstat` / `Get-CimInstance`
- 词表原始数据把 N5/N4 合并（1568 条，按 ja 去重后 1548 词）；已用 data/word-levels.json
  拆成 N5 621 / N4 927（526 个未覆盖的词归 N4），抽词（freshPool）与进度分母
  （wordsOfCurrentLevel）同一口径，因此换档会真正换池
- 解説模式还停在「讲完就结束」，没有配套练习（**下一步要补的**）
- ~~`next_question_ja` 只显示日文~~ → 已补 `next_question_zh`，中文行现在完整
- eventlog 已改成工厂（createLog(prefix)），单词用 wordbook.*、句型用 patternbook.*，各自独立轮转与基线
- 例句模式（句型）数据来自 OpenJLPT（CC BY-SA 4.0），中文是 tools/build-patterns.mjs 用模型翻的；
  判定：复现比对例句、造句先规则后模型（模型挂了就按规则算）
- 学习数据已有三层保护：快照（原子写）+ 追加日志 + 基线，快照坏了可重放重建
- ~~`playAudio` 每次 `new Audio()`~~ → 已改为复用同一个 `<audio>` + 单一 MediaElementSource（每轮只换 `src`）
- `npm start` 带 `--no-sandbox`（关 Chromium 沙箱）：本地自用没问题，公开发布前要评估
- `main.js` 的 `will-quit` 里 `quitting` 标志基本是冗余的（`process.on('exit')` 会兜底），保留只为语义清晰

---

## 授权

模型为 Live2D Inc. 官方免费示例数据，个人/小规模事业者（年销售额 < 1000 万日元）可商用与非商用使用，
**但不得再分发模型文件本身**，发布内容时需标注：

> This content uses sample data owned and copyrighted by Live2D Inc.

详见 <https://www.live2d.com/en/learn/sample/model-terms/>

⚠️ **Hiyori 禁止任何形式的设计改动**（改色、换装都不行）。

## 已知取舍：词干表「一字一音」

`data/kanji-stems.json` 是从 `jlpt.json` 生成的，一个汉字词干只保留**第一条**读音，例如 `日 → にち`。
所以用户打了另一个同样正确的读音（`ひ`）时，复现判定会判错。

- `hasUnknownKanji()` 会挡住"转不出来就乱凑"的情况，所以不会误判为**对**
- 这是刻意的「宁严勿松」：宁可让人重打一遍，也不要把错的判成对的
- 若以后要放宽，需要按词（而不是按字）建读音表，或者上形态素分析器（kuromoji 一类）

## 已知取舍：朗读高亮是静态的

卡片上「会被念出来的那段」用半透明底色常亮标着（`.hl`，颜色走 `--hl-bg` / `--hl-line`），
**不跟音频节奏走**。

- 原因：TTS 只返回 WAV，没有时间轴，前端不知道"现在念到第几个字"
- 这作为"提示重点"够用；想要卡拉OK式逐字跟读，需要词级时间戳
- 可行路线：VOICEVOX 的 `audio_query` 返回 mora 级 `time`/`length` 信息，
  合成后按这些时间点驱动高亮即可（本项目暂未实现）


## 两个平台的分支约定

同一份代码跑 macOS 与 Windows，靠**运行时判断**而不是两份代码：

```js
const IS_WIN = process.platform === 'win32';
const IS_PACKAGED = app.isPackaged;
```

| 区域 | 分支方式 | 注意 |
|---|---|---|
| ASR | `startAsr()`：mac / Windows 默认都是 `whispercpp`，走 `agent/asr-whispercpp.js`；mac 可选 `ASR_BACKEND=mlx` 走 `asr.py` | 对外 HTTP 契约必须一致（端口 8765、`/asr?lang=&prompt=`、`/health` 有 `requested`/`fallback`） |
| TTS 兜底 | `speakToWav()`：mac / Windows **都无系统 TTS 兜底**；缺 VOICEVOX / AivisSpeech 抛 `TTS_NO_JA_VOICE` | Windows 没有日语 SAPI 声线；两个平台都必须装日语 TTS 引擎 |
| 进程管理 | `isOurs()` / `portOwner()` / `killPid()` | Windows：`Get-CimInstance` / `netstat -ano` / `taskkill /T /F`；无窗口进程不带 `/F` 常失败 |
| 窗口 | `createWindow()` | Windows 没有 `setVisibleOnAllWorkspaces`；`titleBarStyle` 用 `default` |
| 快捷键 | `globalShortcut.register()` | `CommandOrControl+Control+X` 在 Windows 等于 `Ctrl+Ctrl`，**注册不上** → 用 `Control+Alt+X` |
| 打包目录 | `IS_PACKAGED` 时 `userData` 落系统目录 | 数据 seed 与回退逻辑在 `agent/boot-data.js`（可单测），别写回 `main.js` |

**白名单有两份**，`npm run scan` 的 `[8]` 会校验一致性：

1. `package.json` 的 `build.files`（哪些文件进安装包）
2. `agent/boot-data.js` 的 `SHARED_DATA`（哪些文件会被 seed 到用户目录）

加新的共享数据表时**两处都要改**，否则现象是静默的（包里缺文件 / 打进包但不 seed）。

## 提示音缓存的键

`.voice/cache/<sha1>.wav` 的键是：

```
文本 + 声线名 + 语速 + 音高 + 语调 + 音量
```

**声线名必须在内**——否则换角色后仍会命中旧文件，播出来还是上一个角色的声音（这个坑踩过）。
换声线 / 改参数时 `main.js` 会 `voiceCache.clear()` 并在后台重跑 `prewarmPrompts()`。

## 每日练习的共用状态机（agent/drill.js）

单词（`vocab-daily`）和例句（`pattern-daily`）原先各写一份机械逻辑。现在共用：

| 函数 | 作用 |
|---|---|
| `today()` | 本地日期（避免 toISOString 的 UTC 换天问题） |
| `shuffle` / `sample` / `pickAvoiding` | 抽卡与避开上一张 |
| `createStore({name,file,empty,normalize})` | 文件戳缓存 + `schema.migrate` + 原子写 |
| `needBuild(db,{date,batch,currentLevel})` | 什么时候重建今日批次 |
| `batchProgress(ids,answered)` | 完成度 / allDone |
| `toggleMode(db,{hasWrong,refuseWhenEmpty})` | 复习开关（例句空错题本不切） |

**数据格式不变**：`vocab-daily.json` / `pattern-daily.json` 的结构、版本号、迁移逻辑都在各自模块里，
`createStore` 只负责"读-迁移-写"的骨架。各模块保留自己的：批次配额、池子构成、判分、卡片形状。

## 会话历史（短期记忆）

- 存在 `main/ipc.js` 的 `chatHistory`（进程内，不落盘）：保留最近 32 条消息（16 轮）
- `agent/llm.js` 取最近 16 条传给模型（`history.slice(-16)`）
- **assistant 历史必须是 JSON 形状**：本轮请求带 `response_format=json_object`，
  如果历史里 assistant 是纯文本，模型会跟着纯文本走，返回空 content（实测 completion_tokens=13 但内容为空）
  所以存 `{reply_ja, reply_zh, next_question_ja}` 的精简 JSON
- 切模式**不再** `chatReset()`（`renderer/app-ui.js`）；想开新会话时手动调 `window.pet.chatReset()`
- 跨会话的长期记忆还没做（计划：`data/conv-memory.json` + 提示词注入）

## 翻译模式已移除（v0.5.x 后）

- 以前「语音 + 识别语言=中文 + 会話/解説」会隐式切成 `translate`，给说法列表 + 讲解；
  打字走正常会话 → 语音/打字行为不一致
- 现在统一：中文/日语都走当前模式；`reply_ja` 是日语，`reply_zh` 固定显示在气泡下方 = 自动中日互译
- 语音回显（`showEcho`）：**上原文 / 下译文**。原文永远保持 ASR 结果，一个字不改；
  `agent.pair(text, lang)` 只补缺失的那一侧（中文输入→补日语，日语输入→补中文）
  · 之前是 `pair()` 返回 {ja,zh} 后整行替换，中文会被"日语→中文"回译改写
    （想吃东西 → 想吃点东西），原文丢失
  · pair 的 prompt 明确「不要改写原文，只给另一种语言」
- 回显可点击展开（**仅中文→日语**，`renderer/speech.js`）：
  · 折叠：上原文 / 下译文（和以前一样）
  · 展开：原文 + 翻译（振假名）+「也可以怎么说」（1–2 个不同说法 + 场景）
    + [复制] / [朗读]
  · `pair()` 对 zh→ja 返回 `ja_furigana` 和 `ja_alternatives`（每个也带振假名）
  · ja→zh 不展开（中文意思已经在折叠行里）
  · 用 class 不用 id（动态 DOM，scan 只查静态 id）
  · 倒计时：译文到达才开始；展开时暂停；收起后重新给 10 秒
  · 标签 `.echo-k` 用 `--text-accent` + 加粗（原来是 --text-dim，和正文分不清）
  · 展开用 flex：`.echo-k` 固定 3.8em、`.echo-body` flex:1 → 正文左边界对齐
  · [复制]/[朗读] 放在「翻译」行右侧（`margin-left:auto`），不再单独一行
  · 回显「朗读」调 `say(text, { replay:false })`：不写 `lastConvSay/lastContentSay`，
    否则点过回显朗读后，「再读一遍」会读译文
  · 「也可以」用 `agent/turn.js orderAlternatives()` 排序：casual → neutral → polite；
    模型给 tone，缺 tone 时按 scene_zh 关键词猜（随意/口语/朋友 → 0，礼貌/正式/长辈 → 2）
- 追问去重：`agent/turn.js` 的 `normalizeFollowUp()` 在 `pet:chat` 返回前清掉
  「已经包含在 reply_ja 里的 next_question_ja」
- 会話/解説回复不标振假名：`pet:chat` 不再算 `reply_furigana`，卡片/例句仍各自补
