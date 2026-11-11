# 数据与备份

文件位置、schema、快照 + 追加日志、例句缓存。

## 数据存在哪

> 会写的 5 个状态文件（`wordbook` / `patternbook` / `vocab-daily` / `pattern-daily` / `settings`）
> 都带 `version` 字段，读取时由 `agent/schema.js` 迁移（旧文件没有 version 视为 0）；详见
> [NOTES.md](../NOTES.md) 的「数据文件的 schema 版本」。

| 文件 | 内容 | 进仓库 |
|---|---|---|
| `data/jlpt.json` | 词表（原始 10,169 条 / 去重后 10,109 词） | ✅ |
| `data/patterns-n5.json` | 81 条 N5 句型（含中文 + 例句假名读音，来自 OpenJLPT） | ✅ |
| `data/patterns-n4.json` | 98 条 N4 句型 | ✅ |
| `data/patterns-n3.json` | 101 条 N3 句型 | ✅ |
| `data/patterns-n2.json` | 123 条 N2 句型 | ✅ |
| `data/patterns-n1.json` | 123 条 N1 句型（N5–N1 合计 526 条） | ✅ |
| `data/word-levels.json` | 把合并的「N5–N4」拆成 N5/N4 的映射（`node tools/build-word-levels.mjs`） | ✅ |
| `data/kanji-stems.json` | 汉字词干 → 假名（7,361 条，复现判定用，`node tools/build-kanji-stems.mjs`） | ✅ |
| `data/pattern-gloss-zh.json` | 句型括号里的英文说明 → 中文（如 `〜から（from）` → `〜から（起点）`） | ✅ |
| `data/enrich-cache.seed.json` | 公共例句缓存（种子，随仓库） | ✅ |
| `data/enrich-cache.json` | 你自己新增的例句（本地） | ❌ 本地 |
| `data/wordbook.json` | 每个词的累计状态（seen/ok/wrong/skip/stage） | ❌ 本地 |
| `data/wordbook.log.jsonl` | **追加日志**：判定 / 见过 / 换批 / 復習 的流水（永不覆盖） | ❌ 本地（已 gitignore） |
| `data/wordbook.baseline.json` | 基线快照（重放起点，轮转时自动重写） | ❌ 本地（已 gitignore） |
| `data/backup/` | 导入 / 恢复 / 清空前的自动快照，保留最近 7 份 | ❌ 本地 |
| `data/patternbook.json` | 每个句型的累计状态（和词库同一套状态机） | ❌ 本地（已 gitignore） |
| `data/patternbook.log.jsonl` | 句型判定的追加日志 | ❌ 本地（已 gitignore） |
| `data/patternbook.baseline.json` | 句型基线快照 | ❌ 本地（已 gitignore） |
| `data/pattern-daily.json` | 今日 5 句 + 句型档位 + 今日对错 | ❌ 本地（已 gitignore） |
| `data/vocab-daily.json` | 今日批次 + 今日对错 + 当前模式 + 单词档位 | ❌ 本地 |
| `data/settings.json` | 全局水平 + 声线参数（语速/音高/语调/音量） | ❌ 本地 |
| `data/live2d-models.json` | 每个模型保存的取景（倍数/左右/上下） | ❌ 本地 |
| `data/backup/*.json` | 导出/导入/清空前的快照（保留最近 7 份） | ❌ 本地 |
| `.voice/cache/*.wav` | 固定短句的语音缓存（模式提示音；按声线参数分 key） | ❌ 本地 |
| `model/Hiyori/` | 内置示例模型（Live2D 官方） | ✅ |
| `model/miku`、`model/樱花miku`、`model/重音` | 第三方模型，个人使用，**不进仓库**（`.gitignore`） | ❌ 本地 |

## 数据可靠性：快照 + 追加日志

学习进度是**三层**结构，任一层坏了都能救回来：

| 文件 | 作用 |
|---|---|
| `data/wordbook.json` | 当前快照，读的主路径（原子写） |
| `data/wordbook.log.jsonl` | 每次判定的流水，**只追加、不覆盖** |
| `data/wordbook.baseline.json` | 首次启用日志时的完整基线（重放起点） |

```
快照损坏 / 被删
  → 启动时自动检测
  → 从「基线 + 日志」重放，写回快照
  → 一条记录都不丢
```

句型用的是同一套机制，只是换了前缀：`data/patternbook.log.jsonl` + `data/patternbook.baseline.json`。

手动重建：

```bash
node tools/replay-log.mjs           # 预览：多少事件、能还原多少词
node tools/replay-log.mjs --write   # 真正写回 wordbook.json
```

日志的约定：

```jsonl
{"t":"2026-11-02T10:00:01Z","e":"seen","ja":"食べる","kana":"たべる"}
{"t":"2026-11-02T10:00:20Z","e":"grade","ja":"食べる","res":"ok"}
{"t":"2026-11-02T10:00:35Z","e":"skip","ja":"飲む"}
{"t":"2026-11-02T10:00:40Z","e":"batch","date":"2026-11-02","n":16}
{"t":"2026-11-02T10:02:00Z","e":"review","on":true}
```

| 事件 | 字段 | 重放时怎么处理 |
|---|---|---|
| `seen` | `ja` `kana` | 建 `new` 记录、`seen+1`，不动阶段 |
| `grade` | `ja` `res`(`ok`/`wrong`) | 按状态机转移（连对 2 次毕业、答错清零） |
| `skip` | `ja` | 跳过池；若原本是错题则保持不变 |
| `batch` / `review` | 元信息 | 不参与重放（只用于统计） |

- **不记录你打错的原答案**
- 坏行（崩溃时写了半行）在解析时跳过，不影响其它行
- 超过 5MB 自动归档成 `wordbook.log.1.jsonl`（只留一份旧档）；**轮转时基线会自动重写成「当前快照 + offset 0」**，所以重放不会丢事件

## 关于例句缓存（seed + local）

例句缓存拆成两层：

| 文件 | 内容 | 进仓库 |
|---|---|---|
| `data/enrich-cache.seed.json` | **公共种子**：约定好的例句，clone 下来直接可用 | ✅ |
| `data/enrich-cache.json` | **你本地的增量**：练习时新生成的部分 | ❌ 忽略 |

读取顺序：**本地 → 种子**（本地同名词条覆盖种子）。
写入：只把「种子之外」的条目写进本地文件，所以本地文件一直很小，也不会和别人的改动冲突。

这样做的好处：

- 别人 clone 下来**立刻有 145 条例句可用**，不用重新调模型
- 你自己的使用增长不会污染仓库，`git status` 不会天天脏
- 想贡献好例句时，手动把某几条从本地挪进 seed，再提 PR

> 种子内容是大模型生成的，商用前建议复核一次服务条款。

---

## 数据文件的 schema 版本

五个会写的状态文件都带 `version`：

```
wordbook.json / patternbook.json / vocab-daily.json / pattern-daily.json / settings.json
```

读取路径统一走 `agent/schema.js`：

| 情况 | 行为 |
|---|---|
| 没有 `version`（早期文件） | 视为 0，跑迁移后补上并回写 |
| `version < 当前` | 依次执行 `MIGRATIONS[name][v]`，回写 |
| `version > 当前` | **不动数据**，只 `console.warn`（不降级别人的数据） |
| 文件损坏（数组/字符串/null） | 当成 `{}` 处理，补 `version` |

新增字段/改结构时的流程：

1. `CURRENT[name] += 1`
2. `MIGRATIONS[name][新版本] = (旧数据) => 新数据`
3. `tests/schema.test.mjs` 补一条（迁移不丢数据 + 幂等）
4. `npm run scan` 的 `[9]` 会检查 `backup.js` 的 `FILES` / `SCHEMA_NAME` 与 `CURRENT` 是否对齐

**没进 schema 的文件**（刻意）：`live2d-models.json`（是 `路径 → 取景` 的映射，顶层加 version 会
被当成一个模型路径）、以及纯粹追加的日志（`*.log.jsonl`、基线文件）——它们本来就向后兼容。

## 小日志的轮转

`agent/rotating-log.js` 是通用工具（应用日志在用）：

```
<file>        当前文件
<file>.1      上一份（超过 maxBytes 时轮转，只留 1 份）
```

调用：`rotatingLog.append(file, line, { maxBytes: 256 * 1024 })`。

判定发生在**追加之前**，所以单个文件可能超出上限"一行"的大小，这是刻意的（避免先写后删）。

## 应用日志（data/logs/app.log）

打包后的 app 看不到 stdout，出问题只能靠日志。`agent/app-log.js`：

- `install({dir})` 劫持主进程 `console.log/info/warn/error`，落盘同时保留原输出
- 2MB 轮转，只留一份 `.1`（复用 `rotating-log.js`）
- `uncaughtException` / `unhandledRejection` 记为 `fatal`
- IPC 层统一包装（`main/ipc.js` 的 `ipcHandle` / `ipcOn`），handler 抛错会写
  `[ipc] <channel>`，Electron 自己的 stderr 在打包版里看不到
- 关闭：`APP_LOG=0`
- **崩溃语义**：加 `uncaughtException` / `unhandledRejection` 监听器后，Node 不再因未捕获异常退出。
  所以打包版必须显式收场：`install({ exit: (c) => app.exit(c) })`；开发模式传 `null`，保留进程看堆栈。
  这一条容易在后续改动里被破坏，`tests/app-log.test.mjs` 用子进程验了两种模式

设置窗口里的「ASR → 日志」是 **识别日志**（`asr.log`），和应用日志分开。
