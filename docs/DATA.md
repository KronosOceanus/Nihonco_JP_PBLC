# 数据与备份

Nihonco 的数据分四层：

```text
随仓库的种子数据
本地学习状态
本地人格 / 设置 / 窗口状态
备份与日志
```

---

## 1. 数据在哪

### 开发 / 源码运行

```text
项目根/data/
项目根/.env
项目根/.voice/
```

### 打包版

```text
userData/data/
userData/data/.env
userData/.voice/
```

Windows：

```text
%APPDATA%\Nihonco\data\
```

mac：

```text
~/Library/Application Support/Nihonco/data/
```

原则：

```text
随包数据只读
运行时要写的数据全部进 userData
```

---

## 2. 文件总表

### 随仓库的种子数据

| 文件 | 内容 | 进仓库 |
|---|---|---|
| `data/jlpt.json` | 词表（原始 10,169 条 / 去重后 10,109 词） | ✅ |
| `data/patterns-n5.json` | 81 条 N5 句型 | ✅ |
| `data/patterns-n4.json` | 98 条 N4 句型 | ✅ |
| `data/patterns-n3.json` | 101 条 N3 句型 | ✅ |
| `data/patterns-n2.json` | 123 条 N2 句型 | ✅ |
| `data/patterns-n1.json` | 123 条 N1 句型（合计 526 条） | ✅ |
| `data/word-levels.json` | N5–N4 拆成 N5/N4 的映射 | ✅ |
| `data/kanji-stems.json` | 汉字词干 → 假名（复现判定用） | ✅ |
| `data/pattern-gloss-zh.json` | 句型括号英文 → 中文 | ✅ |
| `data/enrich-cache.seed.json` | 公共例句种子（145 条） | ✅ |

### 本地学习状态

| 文件 | 内容 | 进仓库 |
|---|---|---|
| `data/wordbook.json` | 每个词的累计状态 | ❌ |
| `data/wordbook.log.jsonl` | 单词判定流水，只追加 | ❌ |
| `data/wordbook.baseline.json` | 单词日志重放基线 | ❌ |
| `data/patternbook.json` | 每个句型的累计状态 | ❌ |
| `data/patternbook.log.jsonl` | 句型判定流水 | ❌ |
| `data/patternbook.baseline.json` | 句型日志重放基线 | ❌ |
| `data/vocab-daily.json` | 今日单词批次 / 模式 / 档位 | ❌ |
| `data/pattern-daily.json` | 今日句型 / 模式 / 档位 | ❌ |
| `data/settings.json` | 全局水平 + 声线参数 + 始终置顶 | ❌ |
| `data/live2d-models.json` | 模型路径 → 取景参数 | ❌ |
| `data/enrich-cache.json` | 本地新增例句 | ❌ |

### 本地人格 / 设置 / 窗口

| 文件 | 内容 | 进仓库 |
|---|---|---|
| `data/persona.json` | profile / relation / episodes | ❌ |
| `data/shortcuts.json` | 快捷键、自动结束录音阈值 | ❌ |
| `data/window.json` | 挂件窗口尺寸 | ❌ |
| `data/usage.json` | 主动用词 / 目标词的本地使用计数 | ❌ |

这些文件**不在学习数据 schema 的 5 个文件里**，也不会随“导出学习数据”一起导出。

### 备份与日志

| 文件 | 内容 | 进仓库 |
|---|---|---|
| `data/backup/` | 导入 / 恢复 / 清空前的快照，保留最近 7 份 | ❌ |
| `data/logs/app.log` | 应用日志，2MB 轮转 | ❌ |
| `data/logs/asr.log` | 识别日志，2MB 轮转 | ❌ |
| `.voice/cache/*.wav` | 固定短句语音缓存 | ❌ |

### 模型 / 资产

| 路径 | 说明 | 进仓库 |
|---|---|---|
| `model/Hiyori/` | Live2D 模型（用户自备） | ❌ |
| `lib/live2dcubismcore.min.js` | Cubism Core（用户自备） | ❌ |
| `.whisper/` | Whisper 运行时 / 模型 | ❌ |
| `.voicevox/` / `.aivis/` | TTS 引擎 | ❌ |

---

## 3. schema 版本

会写的 5 个学习状态文件带 `version`：

```text
wordbook.json
patternbook.json
vocab-daily.json
pattern-daily.json
settings.json
```

读取统一走 `agent/schema.js`：

| 情况 | 行为 |
|---|---|
| 没有 `version`（早期文件） | 视为 0，迁移后补上并回写 |
| `version < 当前` | 依次执行 `MIGRATIONS[name][v]`，回写 |
| `version > 当前` | 不动数据，只 `console.warn` |
| 文件损坏 / 数组 / 字符串 / null | 当成 `{}`，补 version |

改结构流程：

```text
1. CURRENT[name] += 1
2. MIGRATIONS[name][新版本] = 旧数据 => 新数据
3. tests/schema.test.mjs 补迁移 + 幂等测试
4. npm run scan 检查 backup FILES / SCHEMA_NAME 对齐
```

刻意不进 schema：

```text
live2d-models.json   顶层是路径映射，加 version 会被当成模型
persona.json         记忆自己 normalize，不用 schema 迁移
shortcuts.json       坏值回落默认
window.json          单纯尺寸
usage.json           本地使用计数
*.log.jsonl          追加日志，天然向后兼容
```

---

## 4. 快照 + 追加日志

学习进度是三层：

| 文件 | 作用 |
|---|---|
| `data/wordbook.json` | 当前快照，读的主路径（原子写） |
| `data/wordbook.log.jsonl` | 每次判定的流水，只追加 |
| `data/wordbook.baseline.json` | 日志重放起点 |

损坏恢复：

```text
快照损坏 / 被删
→ 启动时检测
→ 从「基线 + 日志」重放
→ 写回快照
```

句型同理：

```text
patternbook.json
patternbook.log.jsonl
patternbook.baseline.json
```

手动重建：

```bash
node tools/replay-log.mjs           # 预览
node tools/replay-log.mjs --write   # 写回 wordbook.json
```

日志格式：

```jsonl
{"t":"2026-11-02T10:00:01Z","e":"seen","ja":"食べる","kana":"たべる"}
{"t":"2026-11-02T10:00:20Z","e":"grade","ja":"食べる","res":"ok"}
{"t":"2026-11-02T10:00:35Z","e":"skip","ja":"飲む"}
{"t":"2026-11-02T10:00:40Z","e":"batch","date":"2026-11-02","n":16}
{"t":"2026-11-02T10:02:00Z","e":"review","on":true}
```

| 事件 | 重放 |
|---|---|
| `seen` | 建 `new` 记录、`seen+1`，不动阶段 |
| `grade` | 按状态机转移（连对 2 次毕业、答错清零） |
| `skip` | 跳过池；原本是错题则保持 |
| `batch` / `review` | 不参与重放，只用于统计 |

约定：

```text
不记录你打错的原答案
半行跳过，不影响其它行
超过 5MB 归档成 .1
轮转时基线重写为「当前快照 + offset 0」
```

---

## 5. 例句缓存

| 文件 | 内容 | 进仓库 |
|---|---|---|
| `data/enrich-cache.seed.json` | 公共种子（145 条） | ✅ |
| `data/enrich-cache.json` | 本地新增 | ❌ |

读取顺序：

```text
本地 → 种子
```

写入：

```text
只把种子之外的条目写进本地文件
```

好处：

```text
clone 下来立刻有例句
自己的增长不污染仓库
想贡献时手动挪进 seed
```

种子内容是模型生成的，商用前要复核服务条款。

---

## 6. 人格记忆

```text
data/persona.json
```

结构：

```json
{
  "version": 1,
  "profile": {
    "nickname": "",
    "nickname_reading": "",
    "level": "",
    "interests": [],
    "goals": [],
    "preferences": [],
    "boundaries": []
  },
  "relation": {
    "familiarity": 0,
    "tone": "casual",
    "address": "",
    "note": ""
  },
  "episodes": []
}
```

自动巩固：

```text
profile 数组去重
episode 完全相同 summary 合并 tags / weight
profile 上限 8 条
episode 上限 12 条
超限按低 weight / 旧 at 淘汰
```

不做：

```text
LLM 语义合并
整理/合并 UI
聊天全文
向量检索
```

备份：

```text
persona.json 不属于学习数据导出
需要时手动复制
```

---

## 7. 快捷键 / 窗口 / usage

### shortcuts.json

```text
快捷键配置
autoStopSec
enabled
```

坏值：

```text
回落到默认
不阻塞启动
```

### window.json

```text
挂件窗口宽高
```

写入时机：

```text
拖拽结束
设置里改尺寸
```

### usage.json

```text
本地使用计数
```

用于主动用词/目标词选择；不影响学习判分。

---

## 8. 日志

### app.log

```text
data/logs/app.log
```

内容：

```text
主进程 console
IPC 异常
uncaughtException / unhandledRejection
```

轮转：

```text
2MB → app.log.1
```

关闭：

```text
APP_LOG=0
```

### asr.log

```text
data/logs/asr.log
```

每次识别：

```text
时间 | 耗时 | 音频大小 | 语言 | 引擎 | 热词长度 | 重试 | 文本
```

只记文本，不存音频。

关闭：

```text
ASR_LOG=0
```

---

## 9. 备份 / 导出 / 导入

`data/backup/` 保留最近 7 份。

覆盖：

```text
wordbook
patternbook
vocab-daily
pattern-daily
settings
```

不包含：

```text
persona
shortcuts
window
usage
.log.jsonl
logs
```

操作前自动备份，恢复前也可再备份。

---

## 10. 数据目录速查

| 平台 | 数据 |
|---|---|
| macOS 源码 | `项目根/data/` |
| macOS 打包 | `userData/data/` |
| Windows 源码 | `项目根/data/` |
| Windows 打包 | `%APPDATA%\Nihonco\data\` |

`NIHONCO_DATA_DIR` 可以覆盖，测试和巡检都用它指向临时目录。
