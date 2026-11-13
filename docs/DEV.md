# 开发与自检

本地运行、测试、端到端冒烟、结构扫描。

---

## 1. 常用命令

| 命令 | 作用 |
|---|---|
| `npm start` / `npm run pet` | 开发模式直接跑，不打包 |
| `npm run setup` | 生成 `.env`；可选创建 Python venv |
| `npm run setup:whisper` | 编译 whisper.cpp + 下载/校验模型 |
| `npm run setup:mlx` | 建 `.venv` + 下载/预热 mlx 模型（mac 可选） |
| `npm test` | 跑 `tests/` 下全部 `*.test.mjs` |
| `npm run test:watch` | 监听测试 |
| `npm run scan` | 结构扫描 |
| `npm run smoke` | 真启动 Electron，切模式并断言界面 |
| `npm run smoke:settings` | 真启动设置页，验证模块、控件、保存 |
| `npm run build:app` | mac lite（等同 `build:app:lite`） |
| `npm run build:app:lite` | mac lite，不含 Live2D |
| `npm run build:app:lite:mlx` | lite + mlx 环境/模型 |
| `npm run build:dist:mac` | 组装 mac 分发包（tgz + sha256）；`--verify` 先启动校验 |
| `npm run build:win` | Windows lite（NSIS + portable） |
| `npm run build:win:lite:dir` | 只出目录，便于先试 |
| `npm run check:assets:lite` | 打包前资产检查 |
| `npm run release -- 0.7.x` | 发版：改版本、CHANGELOG、测试、tag |
| `npm run build:jlpt` | 重新生成 `data/jlpt.json` |
| `npm run snapshot:readings` | 生成读音快照 |
| `npm run demo` | 演示脚本，不打包 |

当前只提供 lite 构建，没有 full 命令。

构建下载默认「镜像优先、官方兜底」（见 `tools/fetch.mjs`），可用 `--mirror` 覆盖：

```bash
npm run build:app:lite -- --mirror=official   # 只走官方源
npm run build:win:lite -- --mirror=cn         # 只走镜像
```

---

## 2. 行为测试

```bash
npm test
```

用 Node 自带 `node:test`，不引第三方测试框架。

测试会把数据目录指到临时目录（`NIHONCO_DATA_DIR`），不碰真实 `data/`。

### 当前覆盖

```text
词库状态机 / SRS / 每日批次与配额
句型数据 / 判定 / 造句规则
配置读写 / schema 迁移
事件日志 / 回放 / 备份
记忆 3C：去重、合并、上限
快捷键：默认值、冲突、mac 死键
ASR 后端 / 模型解析 / 契约
ASR GPU 安装 / CUDA 与 CPU 包识别
资源预览 / 安装 / 回滚 / 平台字符串契约
录音/播放互斥
取景原子写
```

当前基线：

```text
350 tests
347 pass
3 skipped（运行时 ASR 契约，服务没跑）
```

### 不测

```text
Live2D 渲染
真实音频播放
ASR 实际识别（要模型/音频）
LLM 输出质量（要联网）
Windows 真机
GUI 视觉回归
```

---

## 3. 端到端冒烟

纯 Node 测不到 DOM，所以有一条会真拉 Electron：

```bash
npm run smoke
```

流程：

```text
boot
→ teach
→ word
→ pattern
→ 点回按钮
→ conv
```

每步用 `computed style` 采集：

```text
gLevel
newbatch
review
错题徽标
两个档位
两张卡片
```

断言：

```text
会話/解説 子模式切到单词/例文后是否保持
模式切换显隐是否符合 MODE_UI
「復習 · N」是否只在有错题时出现
单词/例文卡片是否渲染
natural 越界值（7 / -1 / 0 / "5" / null / 3.5 / NaN）不抛异常
```

实现：

```text
PET_EVAL 在渲染层跑脚本并打印 JSON
PET_EVAL_EXIT 让应用跑完退出
```

应用开着也能跑：子进程传临时 `NIHONCO_USER_DATA`，单实例锁互不干扰；真撞锁会提示先退出。

---

## 4. 设置页冒烟

```bash
npm run smoke:settings
```

真启动设置窗口，验证：

```text
模块注册
设置分区
TTS 引擎/声线
保存流程
```

它不能替代真实拖放点击测试。

---

## 5. 结构扫描

```bash
npm run scan
```

当前 14 类检查。

| # | 检查 | 抓什么 |
|---|---|---|
| 1 | 跨模块调用 | 调用了模块没导出的函数 |
| 2 | IPC 通道 | 渲染层 invoke 与主进程注册对不上 |
| 3 | preload 暴露面 | `window.pet.*` / `window.cfg.*` 没暴露 |
| 4 | JSON 契约 | 契约字段和 `parseTurn` 不一致 |
| 5 | 数据文件 | `data/` 下 JSON 合法性 |
| 6 | 死函数 | 定义但从未引用（启发式） |
| 7 | DOM id | JS 引用的 id 在 HTML 不存在 |
| 8 | 打包数据白名单 | `SHARED_DATA` 与 data seed 对齐 |
| 9 | 数据 schema 覆盖 | `backup.js` 的 FILES / SCHEMA_NAME 与 CURRENT 对齐 |
| 10 | 页面 CSP | 不允许内联脚本/远程脚本/unsafe-eval 放宽 |
| 11 | 打包覆盖 | require / script / link 是否被 `build.files` glob 覆盖 |
| 12 | main 注入边界 | main 模块裸用全局变量 |
| 13 | IPC 依赖注入 | 解构了没传、用了没解构 |
| 14 | 渲染层全局声明 | pet / settings 共享作用域顶层重名 |

失败返回退出码 1，可挂 CI / pre-commit。

---

## 6. 测试数据与夹具

```text
tests/fixtures/
  读音、ASR 契约、例句等固定输入
```

原则：

```text
测试数据放临时目录
不读真实 wordbook / settings / persona
需要 zip 的测试用 AdmZip 现场生成
```

---

## 7. 首次启动自检

```bash
npm run scan
curl http://127.0.0.1:8765/health
```

`/health` 返回 `ready:false` 表示模型还在加载，不是失败。

## 8. 发版前检查

```bash
npm test
npm run scan
npm run smoke
npm run smoke:settings
```

然后：

```bash
npm run release -- 0.7.x --summary "一句话"
```

发布脚本会：

```text
校验版本递增
改 package.json
把 CHANGELOG 的「未发布」改成版本标题
更新 README 版本行
跑 test + scan
commit + tag
可选 push
```

---

## 9. 开发约定

```text
改 agent 逻辑 → 跑 npm test
改 renderer / settings DOM → 跑 smoke:settings / smoke
改 IPC / 打包 → 跑 npm run scan
改数据 / 资源 → 跑对应单测 + scan
```

不要：

```text
为了整齐重写渲染层
引入 TypeScript / 打包器
全仓 Prettier
把 scan 做成完整 JS 解析器
```
