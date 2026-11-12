# 日语学习规则（现行）

> 本文只写“Nihonco 怎么判、怎么复习、怎么说话”。
>
> ASR/TTS 的引擎、路径、安装、超时见 [AUDIO.md](AUDIO.md)；  
> 数据和 schema 见 [DATA.md](DATA.md)；  
> 人格/记忆见 [PERSONA.md](PERSONA.md)。
>
> 改规则时同步改这里，并跑文末对应测试。

---

## 0. 数据与等级

| 项 | 现状 |
|---|---|
| 词表 | `data/jlpt.json`，10,109 词 |
| 等级拆分 | 原表 N5–N4 合并；`data/word-levels.json` 拆出 N5 621 词，其余归 N4 |
| 默认水平 | `JP_LEVEL`，默认 **N4**；N5/N4 共用一个池 |
| 句型 | `data/patterns-n5…n1.json`，每个等级独立档位 |
| 单词档位 | 独立于句型档位 |

三个档位：

```text
全局档位：对话 / 解説的日语难度
单词档位：每日 20 词从哪一档抽
例文档位：每日 5 句从哪一档抽
```

联动只有一种：

```text
单词档位 == 例文档位
→ 全局档位自动变成这个值
```

---

## 1. 单词卡

文件：

```text
agent/vocab-daily.js
agent/wordbook.js
```

### 1.1 每日批次

默认：

```text
新词 10 / 错题 6 / 跳过 2 / 学过 2
```

规则：

```text
池子不够就少几个，不补
学过池到期优先
到期 ≥2 个时：复习位 2→4，新词 10→8，总数仍 20
批次日期是本地今天且非空 → 沿用
实际批次可能少于 20
卡片进度显示实际总数
```

当前档的新词不足 10 时：

```text
新词全部取出
→ 错题
→ 跳过
→ 学过
按顺序补满 20
```

### 1.2 判分

| 规则 | 说明 |
|---|---|
| 全半角 / 大小写 / 空格 | NFKC + 去空白 + 小写 |
| 标点 / 引号 | 剥掉（`かわいい。`、`「かわいい」` 都算对） |
| 片假名 = 平假名 | 两边 `toHiragana`（`カワイイ` 算对） |
| 汉字 = 假名 | 接受 `ja / kana / readingOf / alts` |
| 用户确认写法 | 「这个也算对」写入 `alts`，以后自动算对 |
| 空提交 | 算跳过，不影响 SRS 等级 |

接受集合：

```text
word.ja
word.kana
readingOf(word)
record.alts
word.alts
```

仍然严格：

```text
食べた ≠ 食べる    活用/时态不接受
てきる ≠ できる    非同音错字
不同词             不能靠长得像混过去
```

### 1.3 「这个也算对」

出现条件：

```text
① 判错，非空提交
② 答案含汉字
③ kuromoji 读音(答案) == 卡片读音
```

典型场景：

```text
かわいい → 可愛い
橋 卡片被 ASR 听成 箸
```

同音只是必要条件：

```text
箸 / 橋 都是 はし
→ 仍要人工点一下
```

点击后：

```text
写入 alts
按答对重新判一次
```

管理：

```text
设置 → 数据 → 也算对记录 → 管理…
```

数据层：

```text
wordbook.listAlts()
wordbook.removeAlt(ja, alt)
wordbook.setAlts(ja, alts)
```

比较用 NFKC + 去空白 + 小写；`setAlts` 排除和 ja/kana 相同的写法。

### 1.4 单词例句

来源：

```text
LLM 生成 + 本地缓存
```

显示：

```text
汉字带振假名
只给提示，不参与判分
```

校验：

```text
必须包含目标词或其活用形
agent/example-check.js
生成最多 2 次
两次不合格 → 不显示、不写缓存
读缓存也校验；坏例句丢弃并重生成
```

难度：

```text
prompt 带 word.level
N5–N4 用 N5/N4 语法
N3/N2/N1 不超过该等级
缓存带 level
旧缓存没有 level → 保留
level 不匹配 → 重生成
```

### 1.5 进度

```text
卡片显示「今日 N 词」
N = 实际批次长度
只出现不算练过
答过才算
```

---

## 2. 例句卡

文件：

```text
agent/pattern-daily.js
agent/patterns.js
```

每天 5 句，任务随机：

```text
reproduce 复现：给例句，照着打
compose   造句：给中文意思 + 句型，自己造
```

### 2.1 每日批次

```text
新句型 3
+ 错题 1
+ 学过 / 跳过 轮流 1
```

池子不够：

```text
用没学过的句型补位
```

当天已有批次：

```text
沿用 5 句
```

### 2.2 例句选择

`pickExample()`：

```text
① 句型取核心：去括号英文、〜、空格，按 / 拆
② 核心长度 ≥2：优先包含核心的例句
③ 单字核心（な / の）或没有匹配：第一句
```

例：

```text
〜な（na-adjective） → 京都は有名な町です。
〜くて / 〜で        → 优先含「くて」
```

### 2.3 复现

`sameSentence(text, probe.ja, probe.reading)`：

```text
① normalize 后精确比
   NFKC、去空白/标点/引号、小写
② kuromoji 读音比
③ 例句自带 reading 比
④ kanji-stems 词干表兜底
```

结果：

```text
汉字/假名混写、标点差异都算对
同音异字直接判对（句子级，没有按钮）
```

### 2.4 造句

`ruleMatch(pattern, text, { id })` 按句型形状：

| 形状 | 判定 |
|---|---|
| `X〜Y` 中间型 | 各字面按顺序出现 |
| `〜X`，X 是助词 | 两侧都有内容 + 句子像话 |
| `〜X`，X ≤2 字 | X 作为独立语法词出现 + 句子像话 |
| `〜X`，X >2 字 | 出现在句中即可 |
| `X〜` 前缀型 | 出现位置后面还有内容 |

补充：

```text
多分支 A / B：命中任一即通过
含 〜ない：先把 ません/ありません/… 归一成 ない/なかった
括号说明去掉再判
SENTENCE_END 判断句子是否像说完的话
同形句型靠 id：
  na-na-adjective：な 后面跟名词
  na-prohibition：な 在句尾
规则通过后再交 LLM judge 看语义
judge 失败/超时 → 按规则结果算
```

不检查：

```text
活用是否正确
助词用法是否正确（只查出现过）
同义表达替换
```

语义只靠可选 LLM judge。

### 2.5 讲评停留

```text
ok=false：
  点评 + 问题 + 改写 + 自然度
  停在当前题

ok=true 且 natural <= 3 或给了 rewrite：
  显示「你的 / 地道 / 自然 / 进度」
  不自动下一题，点「下一句」才继续

ok=true 且自然度 4–5、无 rewrite：
  自动下一题
```

批末提示用 DOM 追加，不要改 `noteEl.textContent`。

---

## 3. 读音与振假名

文件：

```text
agent/reading.js
agent/furigana.js
```

| 项 | 现状 |
|---|---|
| 分词器 | kuromoji（IPADIC），约 200ms 预热，常驻约 350MB |
| 振假名 | 例句卡例句、单词例句 → `<ruby>`；会話/解説回复不标 |
| 未就绪 | 退回纯文本；「也算对」不出现 |
| 罗马字 | 只用于单词卡键盘提示 |
| 读音覆盖 | 无，只使用 token reading |

### 3.1 实现

```text
kuromoji 分词
→ 每个 token 用自己的 reading
→ 假名保留
→ 汉字没有 reading 就放弃
```

不引入额外读音表、人工例外或跨 token 合并。

### 3.2 已知限制

```text
人数/量词音变：
  四人 → よんにん（不是 よにん）
  一日中 → いちにちちゅう（不是 いちにちじゅう）
  二十日目 → にじゅうにちめ（不是 はつかめ）

多读音/语境：
  今日 → きょう / こんにち
  一日 → ついたち / いちにち
  十分 → じゅっぷん / じゅうぶん
  当前接受 kuromoji 默认值

助词/分词边界：
  今日は寒いです。
  可能切成 今日は → こんにちは

专有名词/新词：
  词典旧，人名/地名/新词可能分词或读音错误

同音不等于同义：
  箸 / 橋 → はし

没有声调：
  只有假名读音，没有 pitch accent
```

### 3.3 基准

1,510 条句型例句：

```text
整句全对：1,356 / 1,510 = 89.8%
字符错误率：0.94%
```

这是唯一读音验收基线。  
重新加入任何读音覆盖，必须先跑这个基准。

---

## 4. SRS 与状态机

### 4.1 间隔

```text
答对：srsLevel +1
  1 / 3 / 7 / 14 / 30 / 60 天后再出现
跳过：等级不变，只顺延到明天
答错：等级归零，明天
```

存：

```text
wordbook.json 记录里的 srsLevel / dueAt
```

老数据：

```text
没有 dueAt → 视为立即到期
```

日志重放：

```text
replay() 不重算 dueAt
```

### 4.2 单词状态机

```text
new --答错--> wrong
new --空提交--> skip
new --连对 2 次--> ok

wrong --再答错/空提交--> wrong（streak 清零）
wrong --连对 2 次--> ok

skip --答错--> wrong
skip --空提交--> skip
skip --连对 2 次--> ok

ok --答错--> wrong
ok --空提交--> skip
```

毕业条件：

```text
连续答对 2 次
```

### 4.3 復習模式

```text
单词復習：只轮当前档错题
例句復習：只轮当前档错题句型
错题清空 → 自动回每日
例句错题本为空 → 拒绝切换
```

### 4.4 例句状态

例句复用同一套 stage 状态机，数据在 `patternbook.json`。

---

## 5. 会話模式

文件：

```text
agent/persona.js
agent/persona-scenes.js
agent/prompt.js
agent/llm.js
```

### 5.1 说话规则

| 规则 | 内容 |
|---|---|
| 名字 | 永远写 `Nihonco`；问读音才用 `ニホンコ`；不用平假名当表记 |
| 长度 | 日语 1–2 句，普通体，自然相づち |
| 难度 | 按当前 JLPT 等级选词/语法；难词换简单说法 |
| 追问 | 不是每轮都问；讲情绪/说得多时不追问 |
| 话题 | 跟着对方，不反复拽回电影/周末 |
| 引用 | 逐字照抄，含假名/拟声词，不改写 |
| 网络笑声 | 单独 `w` / `ｗ` 显示前兜底为「（笑）」，TTS 读 あはは |
| 纠错 | 只在 `解説` 出卡；最多 1 件，只挑最严重的 |
| 不纠 | です・ます 混用、语序偏好、省略 |
| 中文输入 | 日本語模式也按日语处理；解説照常；中国語模式只翻译 |
| 中国語模式 | 所有输入按中文原文 `pair()` 翻译；不聊天、不判分、不换卡、不朗读 |
| 纠错 vs 讲解 | `why_zh` ≤40 字，`explain_zh` ≤120 字；重复时只显示讲解 |

### 5.2 黄卡条件

```text
会話 + 任何输入        → 不出黄卡
解説 + 任何输入        → 纠错 / 讲解 / 单词
中国語模式             → 不进入 chat / 黄卡，只翻译
```

语言来源：

```text
speakLang = ja / zh
不再用文本猜语言
```

主进程：

```text
agent/turn.js 的 applyCardPolicy
强制清空非解説的 corrections / explain_zh / words
```

### 5.3 上下文

```text
history：内存 16 轮（32 条消息）
发给模型：最近 8 轮（16 条消息）
assistant 历史：只存 reply_ja / reply_zh / next_question_ja
切模式：不清空
重启：对话历史丢失
长期记忆另见 PERSONA.md
```

### 5.4 学过的词

```text
来源：wordbook stage = "ok"
档位：不高于当前档
冷却：同一个词 7 天
数量：每轮 ≤2
用法：拼进 system prompt，自然才用，不硬塞
记录：data/usage.json
```

### 5.5 容错

```text
JSON 坏格式：洗控制字符 → 重试解析 → 字段恢复 → 友好兜底
response_format 不支持：去掉重试一次
```

---

## 6. ASR 对判分的影响

完整 ASR 链路见 [AUDIO.md](AUDIO.md)，这里只写和判分相关的部分。

| 项 | 规则 |
|---|---|
| 热词 | 当天单词批次 + 错题池，≤60 字，只保留词表词 |
| 语言 | 手动 日本語 / 中国語；日本語按日语进入当前模式 |
| 结束 | 停顿 N 秒自动发送（默认 1.2s） |
| 近无声 | 判「没录到声音」 |
| 单词同音 | 可点「这个也算对」 |
| 复现同音 | 读音一致直接算对 |

没解决：

```text
ASR 把词听错且读音也不同（漏字/错词）→ 仍会判错
```

---

## 7. TTS 朗读规则

完整 TTS 链路见 [AUDIO.md](AUDIO.md)。

处理顺序：

```text
speech-text 规则表
→ VOICEVOX / AivisSpeech audio_query
→ synthesis
→ 缓存
```

缓存 key 含：

```text
RULES_VERSION
引擎
```

规则表：

| id | 作用 |
|---|---|
| `name-nihonco` | `Nihonco` → にほんこ |
| `laugh-haha` | 句首/标点后「はは」→ あはは |
| `laugh-kakko` | 「（笑）」→ あはは |
| `laugh-w-start / laugh-w-after` | `w` / `ｗ` → あはは |
| `latin-ai / ok / live2d / pc` | 拉丁缩写 → 片假名 |
| `num-year` | 四位数 + 年 |
| `sym-ellipsis` | 省略号 → 短停顿 |

其他：

```text
emoji / 变体选择符删除
无引擎 → 不发音，HUD 提示
不回落系统 say
```

TTS 不参与振假名，直接读原文。

---

## 8. 宽松与严格速查

| 场景 | 宽松 | 严格 |
|---|---|---|
| 单词 | 标点、全半角、片假名、alts、同音可人工确认 | 活用、非同音错字 |
| 复现 | 标点、汉字/假名混写、读音一致 | 读音不同 |
| 造句 | 标点、多分支、括号、位置规则 | 活用、助词用法、语义（LLM） |
| 会话 | JSON 容错、纠错只 1 件、引用逐字 | 名字表记 |
| 朗读 | 规则表、缓存 | — |

---

## 9. 已知限制

```text
无发音评分（长音/促音/浊音/声调）
复现题同音异字直接判对
单词不接受活用形（食べた ≠ 食べる）
造句只查句型出现，语法正确性靠 LLM
没有听力/听写/朗读练习
对话历史重启丢失；长期记忆只有 persona profile/episodes
ASR 语言=ja 仍可能吐中文；lang-guard 可能漏
振假名没有开关
kuromoji 常驻约 350MB
```

---

## 10. 改规则时改哪里

| 规则 | 代码 | 测试 |
|---|---|---|
| 单词判分 / alts | `agent/vocab-daily.js`、`agent/wordbook.js` | `tests/vocab-daily.test.mjs`、`tests/alts.test.mjs` |
| 复现 / 造句 | `agent/patterns.js`、`agent/pattern-daily.js` | `tests/patterns.test.mjs` |
| 读音 / 振假名 | `agent/reading.js`、`agent/furigana.js` | `tests/reading.test.mjs` |
| SRS | `agent/wordbook.js`、`agent/vocab-daily.js` | `tests/vocab-daily.test.mjs` |
| 会话 prompt | `agent/prompt.js`、`agent/llm.js` | `tests/prompt-quote.test.mjs`、`tests/llm-parse.test.mjs`、`tests/persona.test.mjs` |
| 人格 / few-shot | `agent/persona.js`、`agent/persona-scenes.js` | `tests/persona.test.mjs` |
| 学过的词 | `agent/targets.js` | `tests/targets.test.mjs` |
| 单词例句 | `agent/example-check.js`、`agent/enrich.js` | `tests/example-check.test.mjs` |
| 例句卡选句 | `agent/patterns.js`（`pickExample`） | `tests/patterns-example.test.mjs` |
| 朗读规则 | `agent/speech-text.js` | `tests/tts-cache-key.test.mjs` |
| ASR 契约 | `agent/asr-*.js`、`asr.py` | `tests/asr-contract.test.mjs` |
| 语言守卫 | `agent/lang-guard.js`、`main/ipc.js`、`renderer/rec.js` | `tests/lang-guard.test.mjs` |

改朗读规则时记得 bump `RULES_VERSION`，否则旧缓存不会失效。
