# 开发与自检

本地测试、端到端冒烟、结构扫描。

## 开发自检

常用脚本：

| 命令 | 作用 |
|---|---|
| `npm start` / `npm run pet` | 开发模式直接跑（不打包） |
| `npm run setup` | 生成 `.env`；可选建 Python venv |
| `npm run setup:whisper` | 编译 whisper.cpp + 下载/校验模型（默认 ASR） |
| `npm run setup:mlx` | 建 `.venv` + 下载/预热 mlx 模型（mac 可选） |
| `npm run build:app:lite` | 生成 ASR 版 `Nihonco.app`（不含 Live2D） |
| 内部 full | 仅私有仓库维护者使用，公开仓库不提供命令 |
| `npm run build:app:*:mlx` | 额外带 mlx 环境 |
| `npm test` | 跑 `tests/` 下全部 `*.test.mjs` |
| `npm run test:watch` | 监听模式 |
| `npm run scan` | 结构扫描（模块导出、IPC、提示词契约、DOM id、死代码） |
| `npm run smoke` | **端到端冒烟测试**：真启动 Electron，切一遍模式，断言界面显隐（约 25 秒） |
| `npm run smoke:settings` | 真启动设置页，验证注册表、控件和语音参数保存 |
| `npm run build:jlpt` | 重新生成 `data/jlpt.json` |

测试文件全部放在 `tests/`（新增文件会自动被 `npm test` 收进来，不必改文档）。

```bash
npm test        # 行为测试：跑 tests/ 下全部 *.test.mjs（用例数见输出）
npm run scan    # 结构扫描
```

### 行为测试（`tests/`）

用 Node 自带的 `node:test`，**不引第三方依赖**。测试会把数据目录指到临时目录（`NIHONCO_DATA_DIR`），
不碰你真实的 `data/`。

覆盖范围：罗马字拼写、词库状态机、每日批次与配额、配置读写、事件日志与重放、
句型数据与判定、录音/播放互斥守卫、**ASR 源码契约**（签名/参数个数/热词接口）、
**热词取词**（当天批次优先）、**取景原子写**。

不测的：Live2D 渲染、音频播放、ASR 实际识别（要下模型）、LLM 调用（要联网）。

### 端到端冒烟（`tools/smoke.mjs`）

纯 Node 测试测不到 DOM，所以单独有一条会**真启动 Electron** 的冒烟：

```bash
npm run smoke
```

它做的事：用临时数据目录（不碰真实学习记录）启动应用 → 依次走
`boot → teach → word → pattern → 点回按钮 → conv` → 每步用 `computed style` 采集
`gLevel / newbatch / review / 错题徽标 / 两个档位 / 两张卡片` 的状态 → 断言。

覆盖的是最容易改坏的地方：

- 会話/解説 子模式在切到单词/例文后是否保持
- 模式切换时的显隐是否符合 `MODE_UI` 表
- 「復習 · N」徽标是否只在有错题时出现
- 单词/例文卡片是否真的渲染出来了
- **健壮性**：`natural` 给 `7 / -1 / 0 / "5" / null / 3.5 / NaN` 时渲染不抛异常
  （越界值不显示「自然」行；这条就是防"卡片卡住"那类回归的）

实现方式：主进程的 `PET_EVAL` 钩子在渲染层跑一段脚本并打印 JSON，
`PET_EVAL_EXIT` 让应用跑完就退；脚本解析输出后断言，失败非零退出。

**应用开着也能跑**：脚本会给子进程传临时 `NIHONCO_USER_DATA`（Electron 用户数据目录），
单实例锁因此互不干扰；真撞上锁时会直接提示「请先退出正在运行的 Nihonco」，而不是只报「没有 eval 输出」。

### 结构扫描（`tools/scan.mjs`）

改完代码跑一次，专门抓「改了 A 忘了 B」这类问题（7 类）：

| 检查 | 抓什么 |
|---|---|
| 跨模块调用 | 调用了 `book.xxx()` / `vocab.xxx()`，但那个模块根本没导出（会导致静默失败） |
| IPC 通道 | 渲染层 `invoke('pet:xxx')` 与主进程注册的通道对不上 |
| preload 暴露面 | `window.pet.xxx` / `window.cfg.xxx` 在 preload 里没暴露 |
| JSON 契约 | 契约里要求的字段，`parseTurn` 没保留（模型输出会被丢掉） |
| 数据文件 | `data/` 下**所有存在**的 JSON 是否合法（本地运行时文件不在就跳过，必需的两份缺失会报错） |
| 死函数 | 定义了但从没被引用（含回调式引用） |
| DOM id | JS 里 `getElementById` / `$("id")` / `querySelector("#id")` 引用的 id，HTML 里是否真的存在 |

发现问题时返回退出码 1，可以直接挂到 CI / pre-commit。
