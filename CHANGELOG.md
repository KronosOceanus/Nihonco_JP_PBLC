# 更新日志

## 未发布

### 构建

- 下载改为「镜像优先、官方兜底」（仿 Go 的 `GOPROXY`）：whisper 源码/模型、Electron 二进制、electron-builder 二进制都按源顺序试，超时或哈希不符才换下一个
- 新增 `--mirror=auto|cn|official`（或 `NIHONCO_MIRROR`），默认 auto
- `npm ci` 没下成 Electron 二进制时，构建脚本会自动补下，不再直接报错退出

### 修复

- `check:assets:lite` 的提示按平台区分，mac 上不再打印 Windows 的说法

### 测试

- 新增 6 项下载源顺序测试（`tests/fetch.test.mjs`），基线 350 项

### 文档

- Windows 文档补 Electron 二进制静默失败、镜像开关、构建前置

---

## v0.7.38 — 修 Windows 无 Whisper 的首启提示

### 修复

- Windows lite 首次启动缺 Whisper 引擎/模型时，HUD 直接提示去「设置 → 资源」拖入，不再只报「语音识别没起来」
- 设置 → ASR 的 Windows 提示改成拖入引擎 zip + `ggml-*.bin`（原来让人跑 `npm run setup:whisper`，打包版跑不了）
- 验收清单 §3 不再要求「默认自带 CPU 运行时和模型」，补「包里没有 `.whisper`」「只装引擎不可用」检查项
- 测试基线更新为 344 项；`check:assets:lite` 提示补上 Whisper

### 文档

- 清掉「GPU 版共用内置 `.whisper/models`」「内置目录兜底」等 v0.7.37 后失效的说法

---

## v0.7.37 — Windows lite 不再内置 Whisper

### 构建

- Windows lite 不再内置 Whisper 运行时和模型；首次启动后从设置 → 资源拖入 CPU/CUDA 引擎和 `ggml-*.bin`
- Windows 构建不再下载/检查 `.whisper`，安装包不再包含 `whisper-server.exe`、DLL 和模型
- mac 构建保持不变，仍由 `setup-whisper` 准备 Metal 版运行时

## v0.7.36 — 始终置顶开关

### 功能

- 新增「始终置顶」开关：设置 → Live2D、右键菜单、`Cmd+Ctrl+T` / `Ctrl+Alt+T` 都可切换
- 开启后启动、失焦、切到其他应用、重启都保持置顶；关闭后恢复「有焦点才置顶」
- 始终置顶使用 `floating` 层级，避免盖住输入法候选窗

### 修复

- Windows 构建不再直接 `spawn npx.cmd`（Node CVE-2024-27980 后会报 `EINVAL`），改用 `node + node_modules/electron-builder/cli.js`
- 构建脚本失败时先输出 `spawn` 错误码，不再只显示误导性的「退出码 null」

## v0.7.35 — 修复 Windows 安装 ASR 模型 EPERM

### 修复

- Windows 安装 ASR 模型前先停止 whisper-server，等文件句柄释放后再替换，避免 EPERM
- ASR 安装失败自动重新拉起识别服务，安装后自检失败回滚旧模型并重启
- 资源安装错误提示区分磁盘空间不足与文件占用

## v0.7.34 — 动态网络用语提示

### 对话

- slang 改为按本轮用户输入动态注入
- 未命中网络用语时只保留假名输入提示，不再发送整张词表

## v0.7.33 — 平台参数契约与文档收敛

### 修复

- `asset-install` 的 platform 参数收紧为 `process.platform` 字符串
- 删除 platformName 兼容层，传模块对象直接报错
- Windows 资源预览统一传字符串，修正 CUDA/CPU 与 TTS 目标路径

### 文档

- 重构 ARCHITECTURE / ASSETS / AUDIO / DATA / PERSONA / UI / JAPANESE-RULES / DEV / BOUNDARIES
- 重构 Windows 安装与验收
- 删除重复的 INSTALL，更新文档地图

## v0.7.32 — 修复 CPU 引擎状态字段

### 设置

- 修复 asrBackends.info() 未返回 wcppBin，CPU 引擎一直显示未找到
- 补充 info() 字段回归测试

## v0.7.31 — 平台判断与 CPU 引擎拖入

### 设置

- 修复 platform 模块对象被当成 win32 字符串判断，CUDA 包不再被误判为无法识别
- 修复 Windows 资源预览的 VOICEVOX / Aivis 目标路径
- CPU 引擎“已找到”改为检查用户 CPU 目录或内置运行时
- 支持拖入 Windows Whisper CPU zip，安装到 userData/asr/cpu 并优先使用

## v0.7.30 — mac Whisper 模型下载与文档同步

### 设置

- mac 资源区显示 Whisper 模型下载
- ASR 状态去掉 ASR 前缀，只显示已找到/未找到
- 文档同步 ASR 下载入口与 CUDA 拖入安装

## v0.7.29 — ASR CUDA 拖入安装与下载布局

### 设置

- Windows 支持拖入 Whisper CUDA zip 安装，按包内 DLL 识别 12.4 / 11.8
- 资源区 ASR 拆成三行：CUDA 引擎、CPU 引擎、Whisper 模型，各自显示状态
- ASR 实际引擎与引擎行对齐，两个「应用」右对齐
- CUDA 下载按钮按驱动推荐版本动态显示

## v0.7.28 — ASR 下载入口与引擎布局

### 设置

- 资源区 ASR 增加 Whisper 引擎 CUDA/CPU、Whisper 模型下载和状态
- 实际引擎移到引擎下方，与引擎行对齐
- 两个「应用」按钮右对齐
- CUDA 下载链接按驱动推荐版本动态显示

## v0.7.27 — Windows ASR 实际引擎与下载链接

### 设置

- Windows ASR 增加 Whisper 引擎 CUDA/CPU 与模型下载链接
- CUDA 下载链接按驱动推荐 12.4 / 11.8
- 用「实际引擎」选择替代「识别加速」行，顺序 CUDA 12.4 → CUDA 11.8 → CPU
- 「实际引擎」只允许切换到已安装的 CUDA，切换后重启 ASR

## v0.7.26 — 设置初始化与识别加速修复

### 设置

- 修复 SettingsApp.cfg 被当成函数调用导致 ASR/LLM/Live2D/TTS/维护初始化中断
- 恢复并上移 Windows「识别加速」入口
- Windows ASR 引擎标签调整为 CUDA / CPU

## v0.7.25 — 焦点置顶、快捷键与文档同步

### 读音

- 读音回退到纯 kuromoji；删除人工例外、词典读音表与跨 token 合并
- 1,510 条例句基准：89.8% 整句全对

### 记忆

- 3C 自动巩固：profile/episode 去重、episode 合并 tags/weight、上限淘汰
- 不使用 LLM 语义合并，不提供整理/合并 UI

### 设置

- 资源目录显示与实际写入统一
- 资源安装说明、ASR 平台提示、空模型提示
- 移除多余的 Aivis 声线行

### 窗口与快捷键

- 置顶只跟随焦点：blur 取消，focus 恢复
- 显示/聚焦快捷键先确认焦点再置顶
- mac 聚焦输入默认从 ⌥K 改为 ⌥J，避开死键

## v0.7.24 — ASR 平台提示与只保留 lite

### 设置

- ASR 引擎/模型路径提示按平台显示，Windows 不再提示 mlx
- 空模型列表给出拖入提示

### 构建

- 移除 full 构建，只保留 lite

## v0.7.23 — GPU 连续失败三次后永久回落 CPU

### 修复

- Windows ASR GPU 连续失败 3 次后才永久回落 CPU

## v0.7.22 — ASR 模型写入用户目录，补齐 Windows 路径修复

### 修复

- Windows 打包版 ASR 模型改写到用户目录，内置模型保留兜底

## v0.7.21 — 修复打包版资源拖拽路径

### 修复

- 打包版拖拽安装模型/Core/TTS 时写入用户可写目录，不再指向 app.asar

## v0.7.20 — 移除个人示例名

### 清理

- 测试、文档和输入提示改用中性示例名，移除个人昵称与读音

## v0.7.19 — 修正 JMdict 生成脚本注释

### 修复

- 修正 JMdict 生成脚本中已删除人工表的过期注释

## v0.7.18 — 振假名只保留 JMdict 基础表

### 重构

- 振假名只保留 JMdict 基础读音表，删除人工例外表

## v0.7.17 — 忽略 data 安全写备份

### 修复

- `.gitignore` 忽略 `data/*.bak-*`，避免安全写备份和个人资料被误提交

## v0.7.16 — 设置目录整理

### 重构

- 设置窗口文件移入 `settings/`，同步 HTML、静态白名单、打包、扫描、测试与文档路径

## v0.7.15 — 演示脚本与视频简介

### 演示与文档

- 完整演示流程并入项目：`npm run demo`
- 新增演示脚本说明与视频简介文案

## v0.7.14 — 造句否定形判定修复

### 修复

- 造句规则 `〜ない` 接受礼貌否定 `ません / ありません / ませんでした`

## v0.7.13 — 追问去重与演示时序

### 修复

- 模型把追问同时写进回复和 next_question 时，近似重复不再追加
- 回退等级菜单的应用端定位兜底，改由演示脚本等待按钮稳定

## v0.7.12 — 等级下拉定位兜底

### 修复

- 等级按钮横坐标为 0 时，下拉仍会贴到左上角

## v0.7.11 — 等级下拉定位修复

### 修复

- 等级下拉首次打开时可能定位到左上角

## v0.7.10 — BERT 提示与声线等待文案

### 设置

- BERT 提示改为「首次启动需要下载 BERT 模型」
- 声线等待文案恢复为「（引擎启动中…）」，BERT 阶段只显示在下方提示

## v0.7.9 — 设置、LLM 与文档收口

### 设置与资源

- AivisSpeech 首次启动显示 BERT 下载阶段、缓存大小与停滞提示，支持取消并回滚 VOICEVOX
- Aivis 进程退出立即判定失败，不再空等 10 分钟
- ASR 引擎/模型改为点「应用」才重启，避免连点重复重启
- 当前接口地址移到模型下方小字；自定义地址不再与只读地址重名
- 学习数据入口改名「学习记录」；TTS「模型」改名「声线」

### LLM

- 清理过期 OpenRouter Claude 3.5 模型
- Ollama 改为读取本机 `/api/tags`，动态补充已安装模型

### 文档与清理

- README / NOTES / ARCHITECTURE / ASSETS / UI / AUDIO / WINDOWS 同步当前实现
- 合并 AUDIO 重复章节，修复文档地图死链
- 删除内部 tmp 文档，忽略 `tmp_*.md`
- 归档早期 TTS 调研到 `docs/archive/`

## v0.7.8 — 换档题池隔离与合并档错题修复

### 修复

- 单词模式换档后不再继承旧档的错题 / 跳过 / 学过题池
- 例句模式同样按当前档过滤题池
- 兼容 `N5–N4` 合并档：换到 N5/N4 时不再漏掉合并档错题
- 录制辅助：可选 TTS 捕获与提示音口型控制

## v0.7.7 — 安装自检、回滚与进程清理收口

### 安装与稳定性

- ASR 安装自检区分「已安装」与「已就绪」，loading 不再显示为完全成功
- 自检失败时回滚旧资源；TTS/ASR/模型均保留备份
- `whisper-server` 纳入进程登记，启动时清理上次残留
- `.aivis/` 加入 `.gitignore`
- 修正 Windows CI 的 zip 安装测试平台假设

## v0.7.6 — 资源拖放安装、自检与 Windows 支持

### 资源拖放安装

- 设置 → 资源区支持拖入 Core、Live2D 模型 zip、ASR 模型、Aivis 声线、VOICEVOX/Aivis 引擎 zip
- 按 zip 内容识别类型，拖错区域拒绝安装
- 支持一次拖入多个文件，逐项勾选、页内确认、逐项进度与结果
- 安装前备份，只保留最新一份；安装后自检 TTS `/speakers` / ASR `/health` / 模型重载
- zip 安全检查：路径穿越、符号链接、文件数、单文件与总解压体积
- 解压保留 Unix 可执行位与符号链接，修复 Aivis 引擎启动
- Windows：run.exe、`.voicevox/windows`、`.aivis`、`%APPDATA%` 声线路径
- 资源区增加「重启应用」

## v0.7.5 — TTS 双引擎、设置/IPC 重构与 Windows CI 修正

### TTS

- **删除 macOS `say` 回落**：没有 VOICEVOX / AivisSpeech 时不再出声
- 新增 AivisSpeech 支持，与 VOICEVOX 统一为双引擎管理器
- 引擎切换显式点「应用」：停旧启新、等待就绪、失败回滚
- 只管理 Nihonco 自己启动的引擎；用户手动启动的引擎不 kill
- 设置 → TTS：引擎 / 模型 / 试听 / 语速 / 音高 / 语调 / 音量
- VOICEVOX、Aivis 可分别手动选择引擎路径，选择后不自动切换
- 路径校验：必须是 `vv-engine/run` / `AivisSpeech-Engine/run`（Windows 为 `.exe`）
- 资源区增加 ASR / VOICEVOX / AivisSpeech 的下载与状态入口

### 构建

- 新增 `tools/build-app.mjs`，统一 mac/Windows 的 lite/full 构建
- mac：`build:app:lite` / `build:app:full`，可选 `:mlx`
- Windows：`build:win:lite` / `build:win:full`，以及 `:dir` / `:nsis` / `:portable`
- 新增 `npm run setup:mlx`，统一 mlx 环境与模型预热
- whisper.cpp / 模型下载增加 sha256 校验
- ASR 默认后端改为 `whispercpp`

### ASR

- 后端可用性要求「运行环境 + 就绪模型」
- 两边都没有模型时不启动，HUD 提示「缺 ASR 模型」
- `asr.py` 接收 `ASR_MLX_READY`，正式 App 以 JS 的 mlx 就绪列表为准

### 设置

- `main/voice.js` 拆出 `agent/tts-engine.js`，设置页拆出 `settings-tts.js` / `settings-asr.js` / `settings-llm.js` / `settings-live2d.js` / `settings-maintenance.js`
- 设置模块改为 `SettingsApp.register()` 注册表，不再依赖 `window.SettingsXxx`
- 桌宠 IPC 拆到 `main/ipc/pet.js`，`main/ipc.js` 只负责装配
- TTS 配置收敛到 `agent/tts-config.js`
- 命名清理：`ensureVoicevox` / `startVoicevox` / `getVvProc` 等改为引擎通用命名
- 分区顺序：资源 / Live2D / ASR / LLM / TTS / 记忆 / 快捷键 / 应用信息 / 数据
- 删除已废弃的目录行和 ASR 下载按钮
- 引擎切换期间禁用并置灰「应用」与下拉


## v0.7.4 — 解説纠错边界与上限对齐

### 解説モード

- 纠错范围写进 prompt：
  · 只纠助词、活用/时态、中文直译、影响理解的搭配
  · 不纠です・ます混用、语序偏好、省略、同义表达
- 纠错上限从 2 条统一为 **1 条**
  · prompt / `parseTurn()` / 文档一致
- 增加 lint 断言：prompt 必含纠错范围，解析器最多保留 1 条

## v0.7.3 — NH 图标、macOS/Windows 应用图标

### 应用图标

- 新 NH monogram：N 正向 + H 内嵌，H 笔画宽 7，中心线 19 / 81
- macOS：`assets/AppIcon.icns` 已替换
- Windows：新增 `assets/icon.ico`，`build.win.icon` 已接入
- 16 / 32px 使用 H 加粗到 10 的小尺寸变体
- 角色发夹 mockup：`assets/logo/nh-hairpin-product.png`
- `.gitignore` 继续忽略真实 `data/persona*.json` / `memory*`

## v0.7.2 — 记忆使用边界与死代码清理

### 人格

- few-shot 的「私、天才だから」改为「また寝坊した」：
  · 不再让用户自述身份，避免被模型当成用户原话
  · 保留轻度吐槽、不攻击人、一个追问
- 新增记忆使用规则：
  · 记忆只作背景，不冒充本轮用户原话
  · 不生成「你刚才说」，summary 不逐字引用
  · 时间不确定就不提

### 清理

- 删除未使用的 `agent/lang.js` 与 `tests/lang.test.mjs`
- 文档同步：语言由模式决定，不再有 detectLang 路由

## v0.7.1 — 记忆、翻译模式与语言守卫

### 新增

- 轻量人格记忆：
  · `agent/memory.js`：profile / relation / episodes，8 + 12 上限，原子写
  · `agent/memory-extract.js`：每 6 条会話消息后台提取，空闲 10 分钟补提取
  · 设置 → 记忆：查看/编辑/删除资料、关系、最近经历
- 语言守卫：ASR 与 `reply_ja` 共用简体字/中文短语/假名比例检查；短录音拒绝

### 调整

- 语言由模式决定：
  · 日本語模式固定 ja：会話聊天、解説出黄卡、单词/例句答题
  · 中国語模式固定 zh：任何文本/语音都只翻译，不聊天、不答题、不换卡、不朗读
  · 删除 `isJapaneseInput` / 文本语言猜测
- 解説 prompt 复用会話人格：
  · 气泡只做自然反应
  · 纠错/讲解/生词只进黄卡
  · 不再发送 slang 词表
- 笑声：few-shot 不再示范 `ｗ`；显示层 `w/ｗ → （笑）`；TTS 单/多 w 与 `（笑）` 读作 あはは

### 修复 / 安全

- `.gitignore` 忽略 `data/persona*.json`、`data/memory*`，防止真实人格资料入库
- 清理输入语言旧文档描述

## v0.7.0 — 人格阶段 1 与运行时分帧

### 人格

- 抽出稳定人格卡 `agent/persona.js`
- 行为 few-shot 抽到 `agent/persona-scenes.js`，从 5 组压到 3 组
  · 累 / 低落合并：轻关心、不追问、不毒舌
  · 嘴硬：接梗但不攻击
  · 短回答：只接一句
- `prompt.js` 改为 persona + 模式规则 + slang + JSON 契约的组合器
- 会話 prompt 不再要求“必须纠错”，避免和不出黄卡冲突
- `systemPrompt` 只接受 conv / teach，未知 mode 直接抛错

### 运行时

- Live2D 分级帧率：
  · 前台活动 / 说话 / 表情动作 60fps
  · 前台空闲 36fps
  · 失焦但仍可见 36fps
  · 最小化 / hidden 暂停 ticker

### 文档

- 新增/更新 `docs/PERSONA.md`：人格、主动、记忆设计
- 帧率与主动调度分别并入 `docs/UI.md`、`docs/ARCHITECTURE.md`
- 更新 `tmp_debt_plan.md` 到 v0.7.0

## v0.6.18 — 动态表情菜单与声线排序

### 新增

- 右键菜单「表情」：按当前模型动态列出可触发的表情与动作
  · 支持 model3 Expressions / Motions、VTube Hotkeys、目录 exp3 兜底
  · 子目录 exp3 也会扫描；水印不列入
  · 未注册的 motion3 不放进菜单
- 点击表情按 `.exp3.json` 参数混合、淡入淡出；动作走 `startMotion(group,index)`

### 调整

- 设置：声线选择移到语速上方

## v0.6.17 — 网络用语模块化与扫描修复

### 重构

- 会話模式网络用语/假名提示抽到 `agent/slang.js`
  · `NET_TERMS` + `promptBlock()`，prompt 不再硬编码词表
  · 新增 `tests/slang.test.mjs`

### 修复

- `scan [1]`：require 别名必须匹配完整模块名，避免 `lang` 误匹配 `slang`

## v0.6.16 — 讲评停留与清理

### 新增

- 例句造句“大概对”时停留讲评卡：
  · natural ≤3 或有地道建议时显示自然度
  · 「下一句」按钮放在「你的」行右侧，胶囊样式
  · 普通答对仍自动下一题

### 修复

- 批末提示不再用 textContent 覆盖讲评卡，保留 HTML / 高亮 / 下一句按钮
- 删除右键「记一下刚才…」及 pet:issue / issues.log 相关入口
- 删除 main.js 未使用的 rotating-log import

### 文案

- rotating-log 注释从 issues.log 改为 app.log

## v0.6.15 — 设置资产入口与主动搭话

### 新增

- 设置 → 资源：「已找到」状态可点击，打开 Core / 模型 / VOICEVOX 所在目录
- 主动搭话显示中文翻译，朗读仍只读日语

### 修复

- 设置目录路径左对齐，不再被 108px 的 hint 边距推走

### 调整

- 「说话…」只在会話 / 解説模式生效；单词 / 例句只提示
- 主动搭话的翻译用 casualSeq / turnId / 模式族守卫：
  · 会話 ↔ 解説 互换不丢翻译
  · 离开会話/解説 作废在途翻译
  · 入口与守卫统一用 isTalkMode

## v0.6.14 — Dock 退出修复与 Genie 实验标记

### 修复

- macOS：启动时显式设为 regular 激活策略，Dock 右键恢复原生「退出」

### 实验

- Genie-TTS 最小接入（`GENIE_TTS_URL`），仅作尝试
  · 默认不启用，VOICEVOX 仍是默认
  · 实测短句 1.5–2s，长句 2.5–3.7s，不适合实时对话
  · 未做完整稳定性/分发测试

## v0.6.13 — 中国语模式输入分流

### 新增

- 中国语模式改为“翻译/回显”输入：
  · 中文/英文/数字只更新回显，不对话、不答题、不换卡、不朗读
  · 含假名的日语输入不处理，HUD 提示「中国语模式下不处理日语输入（切到 日本語）」
  · 日本语模式不变，所有输入按日语处理
- 中国语模式下中文输入不打断当前朗读

## v0.6.12 — 资产与构建文档拆分

### 文档

- 拆分资产与构建说明：
  · `ASSETS.md` 只讲资产从哪来、放哪
  · `WINDOWS.md` 集中 lite / full 构建规则
  · `tmp_windows.md` 只保留操作命令与验收
- 修正 Windows 模型放置表：lite 走外置 assets，full 才打包

## v0.6.11 — 文档地图与发布修复

### 文档

- 修复 v0.6.10 CHANGELOG 标题错位（目录入口布局归 0.6.10，打开目录按钮归 0.6.9）
- 新增 `docs/README.md` 文档地图
- `tmp_tts_plan.md` 移入 `docs/TTS-PLAN.md`，明确「未执行」
- `release.mjs`：缺少「## 未发布」时拒绝发版，不再生成空版本标题


## v0.6.10 — 设置目录入口布局

### 新增

- 设置 → 资源 / ASR / 声音 / 数据：每个区块第一行「目录」
  · 左边标签「目录」+ 打开按钮 + 实际路径
  · 路径由主进程白名单解析
  · 找不到时显示「未找到」+ 按钮置灰

## v0.6.9 — 设置打开目录与 mac VOICEVOX

### 新增

- 设置 → 资源 / ASR / 声音 / 数据：新增「打开目录」按钮
  · 资产 / Whisper / VOICEVOX / 数据目录
  · VOICEVOX / Whisper 未找到时按钮置灰

### 修复

- macOS 自动识别 `/Applications/VOICEVOX.app` 的引擎路径

## v0.6.8 — Windows lite 打包与外置资产

### 打包

- Windows 新增 lite / full 两个构建
  · lite（默认）：不含 `model/`、`lib/live2dcubismcore.min.js`；用户放到 `%APPDATA%\Nihonco\assets`
  · full：保留原行为，模型/Core 随包，仅自己用
- 静态服务：`/model/` 与 Cubism Core 在包内缺失时回落外置 assets
- `check:assets` 分 lite/full；`tools/static-assets.test.mjs` / `build-config.test.mjs`

### 文档

- ASSETS / WINDOWS / tmp_windows：补 lite/full 流程与外置资产路径

## v0.6.7 — 代码与测试边界

### 文档

- 新增 `docs/BOUNDARIES.md`：功能/代码/测试/加固边界与准入规则

### 修复

- `scan [14]` 支持正则字面量（`/['"]/`、`/\{/` 不会再吃掉后续代码）
- 顶层声明扫描拆到 `tools/scan-globals.mjs`，补 5 组测试
- 扫描输出分组：pet 页 / settings 共享作用域 / settings IIFE（内部隔离）

## v0.6.6 — 渲染层状态收口与设置拆分

### 重构

- 渲染层跨文件状态集中到 `renderer/state.js`（speaking / turnId / dailyCard / patternCard 等）
- `scan [14]` 按大括号深度识别顶层声明，覆盖缩进写法和 settings 两页
- `settings.js` 拆出 `settings-data.js`、`settings-shortcuts.js`（1038 → 713）

## v0.6.5 — 例句质量与等级约束

### 改进

- 单词例句按目标词等级生成：prompt 带 `word.level`，新缓存写 `level`
  · 旧缓存（没有 level）保留，不批量重生成
  · 词等级变化时，旧例句按 `level` 不一致重生成
- 单词例句必须包含目标词或活用形；最多重试 2 次，坏缓存丢弃
- 例句卡优先选包含句型核心的例句；单字核心用第一句

## v0.6.4 — 批次进度显示修正

### 修复

- 单词卡进度显示实际批次数量：池子不足 20 时不再写死「今日 20 词」
  · 例句卡本来就用实际 `total`，无需改

## v0.6.3 — 点词查询与交互修复

### 新增

- **点词查询**：气泡/例句里的日语词可点击看读音、原形、中文释义、等级/词性
  · 范围：会話/解説气泡、黄卡与例文卡例句
  · 只处理词表内（JLPT 10k）的词；词表外不可点
  · 浮层小喇叭按词表读音朗读，会打断当前语音但不改变「再读一遍」目标
  · 分词缓存上限 200 条；新回复/切模式自动收起浮层

### 修复

- 点词浮层点击穿透：`#panel` / `#reply` 是 `pointer-events:none`，词 span 需显式 `auto`
- 浮层不会跟新内容收起：新回复、新卡片、切模式现在都会关闭

## v0.6.2 — 回显朗读修复与资产文档

### 修复

- 回显「朗读」在上一句语音还在合成/播放时点击无反应
  · 显式朗读现在会打断上一句（`bargeIn`）
  · 加代际号，旧 TTS 晚回来不会覆盖新朗读
  · 静音时提示「已静音」，旧调用的错误不再覆盖新 HUD

### 文档

- `docs/ASSETS.md`：新增「自行更换 Live2D 模型」「自行更换声线」
- 删除 `docs/windows/WINDOWS-HISTORY.md`（历史记录，当前流程已在 WINDOWS.md）
- 修复 `CONTRIBUTING.md` 指向已移出文件 `tmp_opensource_plan.md` 的坏链接

## v0.6.1 — 技术债清单更新

### 文档

- `tmp_debt_plan.md`：按 v0.6.0 后的实际状态重写，记录已还的债、当前热点与剩余优先级

## v0.6.0 — 架构收债：IPC 分域、守卫与依赖检查

### 重构

- **IPC 按域拆分**：`main/ipc.js` 从 700 行降到 352 行
  · `main/ipc/config.js`（配置/模型/资源/开机自启）
  · `main/ipc/audio.js`（声音 + ASR）
  · `main/ipc/data.js`（导入导出/恢复/也算对）
  · `main/ipc/shortcuts.js`（快捷键）
- **设置通道统一守卫**：`settingsHandle` / `settingsOn`，不再每个 handler 手写 `fromSettings`
- **`agent/enrich.js`**：例句缓存与 `enrichBatch/enrichOne` 从 `llm.js` 抽出（684 → 622 行）
- **`settings-assets.js`**：设置「资源」区独立，`settings.js` 只调用 `SettingsAssets`
- 删除 `setEnvValue` 后重复的 `process.env` 写入

### 检查

- `scan [2]`：`cfg:*` 与 `pet:*` 对称，必须走包装器
- `scan [13]`：`main/ipc/*.js` 依赖双向检查（解构必须传、用了必须解构）
- `scan [14]`：渲染层顶层声明不允许重名
- 新增设置窗口静态测试（分区顺序 / 资源 id / 脚本顺序）
- `tests/config`：`setEnvValue` 同步 `process.env`

### 文档

- `docs/ARCHITECTURE.md` 更新到当前结构（IPC 四域、60 通道、模型/Core 自备），并记录已知结构问题

## v0.5.5 — 源码公开准备、资源引导与设置重组

### 新增

- **源码公开准备**
  · 代码改为 **PolyForm Noncommercial 1.0.0**（禁止商业使用，source-available）
  · `NOTICE` / `THIRD_PARTY_NOTICES.md` / `CONTRIBUTING` / `SECURITY` / `CODE_OF_CONDUCT`
  · `.github` issue/PR 模板
  · 文档重构后的系统文档（INSTALL / UI / AUDIO / DATA / ARCHITECTURE / DEV）
- **资源引导**
  · 设置 →「资源」：Live2D Core / 模型 / VOICEVOX 的官方下载链接与状态（含相对路径，悬停看完整路径）
  · `docs/ASSETS.md`：模型、Core、引擎都不随仓库分发，用户自备
  · 缺模型/Core 时 HUD 提示；打包前 `check:assets` 缺资源直接失败
  · `data/README.md`：词表（MIT）与句型（OpenJLPT CC BY-SA 4.0）来源
- **设置分区重排**：资源 / ASR / LLM / 画面 / 声音 / 快捷键 / 应用信息 / 数据
  · 「应用信息」拆成 ASR（语音识别 + 日志）与应用信息（开机自启）
  · 设置标题的名字读音改为片假名「ニホンコ」

### 修复

- 模型路径统一到 `models.activePath()`：设置状态、打包检查、窗口加载跟随 `LIVE2D_MODEL`
- README 发版时被 summary 替换吞掉段落的 bug（release 脚本只在同一行内替换）
- 「再读一遍」目标收口到 `replayTarget()`（显示与点击共用）

## v0.5.4 — 文档重构、回显展开与交互修正

### 文档

- **文档重构**：README 精简到门面（~100 行）；系统说明拆到 `docs/`
  · `INSTALL` / `UI` / `AUDIO` / `DATA` / `ARCHITECTURE` / `DEV`
  · `NOTES.md` 移到根目录，只留决策/踩坑（847 → ~300 行）
  · `preview.png`、`tmp_opensource_plan.md` 移到根目录

### 修复

- **黄卡规则收紧为一条**：只有「解説 + 日语输入（含假名）」才出纠错 / 讲解 / 单词；
  会話（任何输入）和 解説（中文输入）都按纯聊天处理，不出卡
- 无卡时清空黄卡的旧内容（之前只隐藏，DOM 里还留着上一条）
- **回显可点击展开（仅中→日）**：折叠仍是「上原文 / 下译文」；展开后显示原文、翻译（振假名）、
  「也可以怎么说」（1–2 个不同说法 + 场景）、复制、朗读；日→中不展开
  · 倒计时改为「译文到达才开始」；展开时暂停，收起后重新给 10 秒
  · 标签颜色改为 `--text-accent` 加粗（原来和正文太接近）
  · 正文按列对齐（标签固定宽度）；[复制]/[朗读] 移到「翻译」行最右
  · 「也可以」按随意程度排序：口语/朋友在上，礼貌/正式在下
  · 展开里的「朗读」不再抢占重播目标（读回显译文后，点「再读一遍」仍读她的回复）
- **语言 / 设置 / 重播按钮不再抢输入焦点**：只有手动点输入框才会聚焦（快捷键「聚焦输入框」除外）
- **切模式不再清回显**：回显继续按自己的 10 秒 / 展开暂停规则走，只清单词/例句卡片
- **切回会話/解説时清掉单词/例句卡片**：从单词/例句切回会話/解説，气泡和黄卡直接消失
  （不恢复旧会话，重播按钮一并隐藏）；会話↔解説 互换不受影响
- 回显 pair 竞态改用序号判断：新回显出现后，旧句子的译文不会再贴到新回显上
- 追问去重收口到 `agent/llm.js` 的 `finalizeTurn()`：之前只在 IPC 层调用，
  其它入口会漏；现在和「黄卡规则」在同一个收口点

## v0.5.3 — 启动自检、翻译模式移除、回显与纠错修正

### 修复

- **去掉隐藏的「翻译模式」**：中文/日语都走当前模式，气泡固定显示「日语 + 中文」两行；
  不再因「语音 + 中文」偷偷切成翻译讲解（打字/语音行为一致）
- **会話/解説的回复不再标振假名**；振假名只保留在单词卡、例句卡上
- **纠错与讲解不再重复**：`why_zh` 只写这一句的具体原因，`explain_zh` 讲规律/对比；
  UI 再做一次去重（重合度 ≥0.6 时只保留讲解）
- **会話/解説：中文输入都不再"纠错"**：改为「这句日语怎么说」——`reply_ja` 给自然说法，
  `explain_zh` 讲为什么这么译，`corrections` 强制为空（之前会把中文当成写坏的日语，
  甚至会编出你没说过的错误）
- **回显改为「上原文 / 下译文」**：原文保持 ASR 结果不变，只补另一种语言；
  不再把中文回译改写（`想吃东西` 不会变成 `想吃点东西`）
- **追问去重**：模型偶尔把同一个问题同时写进 `reply_ja` 和 `next_question_ja`，
  现在 prompt 明确要求 + 主进程归一化兜底，界面/朗读不会问两遍
- **「再读一遍」不再读模式提示音**：切到会話/解説后重播只认该模式的最后一条回复；
  没有回复时按钮隐藏（之前会把「会話モード」当成重播目标）
- **录音结束不再抢输入焦点**：不管空格对讲、点话筒还是快捷键，说完焦点都留在原处；
  只有手动点输入框才会聚焦
- **启动自检不再误报**：TTS / ASR 只在「确定起不来」时提示；「还在启动」不报
  · TTS：Windows 只认 VOICEVOX；mac 有 `say`（Kyoko）就算可用，并提示一句「用系统声线」
  · ASR：`/health` 可达但 `ready:false` = 模型加载中，不报；进程退出 / 30s 不可达才报
  · 两个都失败时 HUD 轮流显示
- 合并 Windows 分支的修复：全局快捷键 1s 冷却（仅 Windows；按住不连发）+ TTS 启动等待

## v0.5.2 — 人设措辞修正、开源准备清单

### 修复

- 人设：话题规则去掉「电影/周末」这句重复描述（保留「会話が続いているのに話題を変えない」）
- 人设：主动搭话的 prompt 里名字读音统一为片假名「ニホンコ」
- 人设：删掉「必要なら中国語を 1 文だけ添える」——`reply_zh` 本来就会显示且不朗读，
  原规则会让中文被塞进朗读字段

### 文档

- 新增 `tmp_opensource_plan.md`：开源准备清单（现状审计、三项决策、分阶段待办）

## v0.5.1 — 数据区可管理也算对记录

### 新增

- 设置 → 数据 →「也算对记录 → 管理…」：列出所有 `alts`，可逐条删除、手动添加
  （误点「这个也算对」后在这里清理，删除立即生效，不需要确认）

## v0.5.0 — 间隔复习、读音容错、造句判定与规则文档

### 新增

- **间隔复习（SRS）**：答对后按 1 / 3 / 7 / 14 / 30 / 60 天再出现；
  **跳过只顺延到明天、不降级**；答错才归零
  · `wordbook` 记录新增 `srsLevel` / `dueAt`；旧数据视为立即到期（升级后补一轮）
  · 每日批次「学过」位到期优先；到期 ≥2 个时复习位 2→4、新词 10→8（总数仍 20）
- **同音字容错**：任何卡片答同音异字（如 橋 卡片答 箸）都会出现「这个也算对」，
  人工确认后写入 alts
- 单词判分也剥离标点（和例句模式一致）：`かわいい。` 不再判错

### 修复

- **同形句型「〜な」判定**：な形容词（`有名な町`）和禁止形（`泳ぐな`）去掉括号后都是 `〜な`，
  以前一律按句尾后缀判。现在 `ruleMatch` 按 id 区分：
  · `na-na-adjective`：な 后面跟名词（kuromoji 词性）
  · `na-prohibition`：な 在句尾
- **短后缀改按分词边界**：`〜た / 〜て / 〜ば / 〜さ` 作为独立语法词出现即可，不再要求句尾
  （`食べたから行く`、`雨が降れば行きません` 能过；`たたみます` 仍不误命中）
- 复现题提示改为「照着例文打（读音一致就算对，汉字/假名都行）」

### 文档

- 新增 `docs/JAPANESE-RULES.md`：日语学习相关现行规则的唯一汇总
  （单词/例句判分、宽松规则、SRS、会话、ASR、朗读、已知限制、改规则看哪里）

## v0.4.23 — 振假名、判分容错、会话用上学过的词

### 新增

- **会話模式用上学过的词**：每轮从 `stage=ok` 的词里挑 1–2 个注入 prompt；7 天冷却；
  放不进去就跳过；日志 `[targets] picked/used`
- **单词判分认同一词的其它写法（alts）**
  · 接受集合 ja / kana / reading / alts，统一转平假名（`カワイイ` 也算对）
  · 纯假名卡片答汉字且读音完全一致时（kuromoji），出现「这个也算对（记住）」
- **振假名**：回复、追问、例句卡、单词例句的汉字上方标读音（`<ruby>`）；
  例句卡原来的「读音」行删掉
- **复现题读音容错**：汉字/假名混写、标点差异都算对
  （精确 → kuromoji 读音 → 例句自带读音 → 旧词干表兜底）

### 修复

- 「这个也算对」按钮看得见点不动：`#panel` 是 `pointer-events:none`，按钮忘了打开
- HUD「缺日语语音模型」固定三行（原来在「暂」字处被折行）
- scan [11] 增加 kuromoji 词典打包检查（少一个依赖直接红）

## v0.4.22 — 窗口大小可调（两角拖拽 + 设置 + 菜单恢复默认）

### 新增

- 窗口大小加「恢复默认」（380×560）；左上角也加了拖拽手柄
  · 右键菜单「回到右下角」上方也加了「恢复默认大小」
  · 拖右下角：左上角固定；拖左上角：右下角固定

### 修复

- 创建窗口时按工作区夹尺寸：大屏拖成 2000×1400 后换到 1440×900 的笔记本，
  不会再开成超屏大小，也不会因为坐标为负跑到屏幕外
- 拖拽改大小用 `requestAnimationFrame` 节流：pointermove 不再逐条发 IPC，松手补最后一帧
- 文档：Windows「无 SAPI 兜底」的描述统一（NOTES 平台差异表、README 两处）；
  WINDOWS.md 的移植清单标注为历史方案

## v0.4.21 — 快捷键自定义、录音自动结束、HUD 与设置面板改版

### 新增

- **挂件窗口改大小**：右下角拖拽手柄（按住拖，右下角固定，最小 240×320、最大工作区 90%）
  + 设置 → 画面设置 →「窗口大小」宽/高精确输入（在「模型」上方）
  · 尺寸持久化到 `data/window.json`，下次启动恢复
  · 模型取景跟着窗口自动重算

- **可自定义快捷键**（设置 → 快捷键，两列：左「全局」右「桌宠窗口内」）
  · 全局 4 个：显示/隐藏桌宠、开始/结束录音、静音/打断朗读、聚焦输入框
    （macOS `⌥H / ⌥Space / ⌥M / ⌥K`，对齐 Superwhisper 的 `⌥Space` 惯例；
     Windows 仍为 `Ctrl+Alt+H/Space/M/K`）
  · 录音用「切换式」：按一下开始，**停顿自动发送**（默认 1.2 秒，设置里 1–5 秒可调；
     设置项叫「自动结束录音」，就在「开始 / 结束录音」下面）；再按一次也能手动结束
  · 快捷键区标题旁有**开启/关闭**总开关：关掉后全局不注册、窗口内不响应
  · 窗口内 5 个：`F1` 会話、`F2` 単語、`F3` 例文、`F4` 重读上一句、`F5` 静音开关
    （用功能键：不产生文字，输入框聚焦时也能按）
  · 点「改键」→ 按下新组合；Esc 取消；全局键必须有修饰键，同组撞键会提示
  · 持久化到 `data/shortcuts.json`；被别的应用占用时设置里会提示
  · 改窗口内快捷键后立刻推给正在跑的桌宠窗口，不用重启


## v0.4.2 — 修复 CI：测试脚本兼容 Node 20

### 修复

- **CI 一直红**：`npm test` 原来是 `node --test "tests/*.test.mjs"`，Node 20 不支持 glob
  （报 `Could not find .../tests/*.test.mjs`）；Node 22 又把目录参数当文件
  → 改成 `tools/run-tests.mjs`：自己列 `tests/*.test.mjs` 再交给 `node --test`，
  Node 20/22、Windows/mac 都能跑


## v0.4.1 — CI 增加 Windows 矩阵

### 工程

- **CI 增加 Windows job**：矩阵 `ubuntu-latest` + `windows-latest`，两个平台都跑
  `npm test` + `npm run scan`（`fail-fast: false`，一个挂了另一个照常跑完）
- Windows job 能自动抓：路径分隔符、tar/bsdtar、taskkill、IS_WIN 分支、GPU 安装器的文件操作；
  抓不到：CUDA 实际加速、驱动判断、Electron UI（真机验）


## v0.4.0 — Windows GPU 加速识别；安装器支持续传

### 新增

- **Windows：whisper.cpp GPU 加速（CUDA）**
  · 设置 → 应用信息 → 语音识别 → 「GPU 加速」：自动探测 NVIDIA、按驱动推荐
    `cuda-12.4`（653MB）/ `cuda-11.8`（285MB），支持下载/重装/卸载
  · 识别耗时从 CPU 的 2.7–3.0s 降到 145–158ms（约 18 倍；Whisper 补零到 30s 窗口，CPU 与句长无关）
  · CPU 版永远兜底：GPU 起不来会自动回落并写回 `active.json`
  · 安装器：staging 落位（失败/取消不动旧版）、可取消、进度条、复用本机安装包
- `docs/HANDOVER-CURRENT.md`：Windows 交接现状（含免安装版 337MB 成品与打包坑）

### 变更

- Windows 上**去掉 SAPI 兜底**：没装 VOICEVOX 时不再用中文音念日语，改为 HUD 提示缺日语语音模型
- 打包白名单补 `.whisper/whisper.dll`、`ggml.dll`、`ggml-base.dll`、`ggml-cpu-*.dll`
  （whisper-server.exe 是动态链接的，光有 exe 起不来）

### 修复

- GPU 加速版 whisper.cpp 的下载支持**断点续传**（Range/206；取消或断网后保留半截 zip，
  下次接着下；服务器不支持 Range 时自动从头下；416 视为本地包损坏、删掉重下；解压失败也删包）
- 本地安装包查找去掉硬编码的 `<工具目录>\...`，改为 `NIHONCO_ASR_ZIP` + Downloads/Desktop
- 测试：新增 3 条（续传、服务器不支持 Range、本地包路径优先）


## v0.3.16 — 修复 IPC 改名误伤（识别失败）

### 修复

- **IPC 批量改名误伤**：把 `on(` 全局替换成 `ipcOn(` 时，误改了 `res.json()`（变成 `res.jsipcOn()`）
  和 `agent.testConnection()`，导致**语音识别直接报错**、模型连接测试也坏
- `scan [12]` 增加检查：`main/ipc.js` 里出现 `xxxipcOn(` / `xxxipcHandle(` 这类被误伤的标识符直接报错


## v0.3.15 — 状态机合并、应用日志、发版自动化与 CI

### 重构

- **Windows 文档合并（P2-7）**：`WINDOWS-HANDOVER.md`（平台差异/原理）+ `WINDOWS-BUILD.md`
  （安装/打包实录）→ 合并成 `docs/WINDOWS.md`；旧文件只剩一行入口，避免两处不同步
- `npm run release -- x.y.z`：版本号校验、改 package.json/CHANGELOG/README、可选跑 test+scan、
  commit+tag，`--push` / `--sync-windows` 显式控制远端
- **CI（P1-4）**：`.github/workflows/ci.yml`，push/PR 自动跑 `npm test` + `npm run scan`（Linux）

### 新增

- **应用日志落盘**：`data/logs/app.log`（2MB 轮转，`APP_LOG=0` 关闭）
  · 劫持主进程 console（log/info/warn/error），保留 stdout
  · `uncaughtException` / `unhandledRejection` 记为 fatal；**打包版记完日志后退出**（`app.exit(1)`），
    开发模式保留进程方便看堆栈（监听器会改变 Node 的默认崩溃行为，必须显式收场）
  · 所有 IPC handler 抛错都记一条 `[ipc] <channel>`（打包版看不到 stderr，这是唯一线索）
  · 新增 `agent/app-log.js` + `tests/app-log.test.mjs` 4 条
- 设置窗口「应用信息」里的【日志】改名为【ASR日志】（与应用日志区分）

### 修复

- **气泡里出现过原始 JSON**（`{"reply_ja":…`）：模型偶尔输出坏 JSON（裸换行 / 被截断），
  `parseTurn` 解析失败后把原文直接当回复贴了出来。现在：
  · 解析前清理字符串里的裸控制字符（换行/tab）
  · 半截 JSON 用正则抠出 `reply_ja` / `reply_zh` 等已写好的字段
  · 实在救不回来时给一句自然兜底（「ごめん、うまく言えなかった…」），**绝不再显示 JSON 原文**
  · 解析失败与 `finish_reason != stop` 都会打日志，便于下次定位
- **名字口径统一成只写 `Nihonco`**：被问名字/自我介绍/中文翻译里都不再出现平假名「にほんこ」；
  只有被问「怎么读」时允许片假名「ニホンコ」。删掉了「可以避开罗马字写假名」的放行条款
  （之前就是它让模型回答「ちがうよ、にほんこだよ」）。语音仍读作「にほんこ」（speech-text 负责）
- 夸奖口径统一：会話模式不再「禁止夸奖」，改成「值得时具体肯定，不为了给而给」，
  与解説模式一致
- 模型会把用户说的拟声词改写（`ふわふわ` → `ふわはわ`），TTS 就照着念错。
  提示词补一条：**引用用户原话时假名也要逐字照抄**（含拟声词/片假名），用「」括起来
- 新增 `tests/prompt-quote.test.mjs` 守住这条约束

### 变更

- **识别后端默认改为「自动」**：`ASR_BACKEND` 留空时，有 `.whisper/whisper-server` + 模型就用
  whisper.cpp，否则用 mlx（clone 后只跑 setup 仍是 mlx，准备好 whisper.cpp 自动切过去）
- 显式配置仍优先；配置的后端不可用时回退到另一个（设置窗口仍显示真实生效的后端）

## v0.3.14 — 两大文件拆分 + IPC/识别健壮性

`pet.js`（1983 行）与 `main.js`（1439 行）拆成模块；期间暴露并修掉一批拆分引入的漏注入与识别卡死。

### 修复

- **语音识别卡在「识别中…」**：
  · `asr.py` 的推理锁改成 `acquire(timeout=15)`，卡住的请求不会让后续请求无限等待（返回 503 提示；
    比客户端 20s 超时短，保证用户看到「识别忙」而不是"被重启了一次"）
  · 主进程识别请求加 20 秒超时；超时/连接失败会重启识别服务并重试一次
  · `ensureAsr` 改为等 `/health` 的 `ready:true`（之前 `ok:true` 就返回，模型没加载完就发请求）、
    超时放宽到 40 秒
  · 渲染层加 28 秒看门狗，识别彻底没响应时提示「识别超时」，不再永远停在「识别中…」
- 拆模块后遗症集中排查（逐通道巡检）：`pet:mouse` 缺 `setPassThrough`、
  `pet:save-audio` 缺 `VOICE_DIR`、`pet:issue` 缺 `rotatingLog` 导入，全部补上；
  顺手清理了被误注入到 static-server / menus 两个 ctx 里的字段
- `scan [12]` 加强：ipc 解构字段必须存在于 main.js 的 `createIpc({...})`
  （含路径常量 `ROOT` / `VOICE_DIR` / `DATA_DIR`）
- **声线下拉一直显示「（引擎启动中…）」**：`cfg:voices` 里用了 `ensureVoicevox`，
  但拆模块后没注入 ipc ctx → 每次都抛 ReferenceError，被 try/catch 吞掉变成 `ok:false`。
  已注入；`scan [12]` 增加检查：ipc.js 用到的服务函数必须在 ctx 解构里
- **pet:* 通道补上 fromPet 守卫**（与设置侧的 fromSettings 对称）：
  15 个桌宠通道改走 `petHandle` / `petOn`，非桌宠窗口的调用直接拒绝/忽略；
  `scan [2]` 增加检查：pet 通道必须用这两个包装，不许直接 `ipcMain.handle/on`
- **设置界面打不开**：拆到 `main/ipc.js` 后，`pet:open-settings` / `pet:typing` 里还留着
  裸的 `win` 引用（ReferenceError），点齿轮按钮直接崩；`cfg:get-autostart` 里的
  `IS_PACKAGED` 也没注入 → 全部改走注入的 getter / `isPackaged`
- `npm run scan` 新增 **[12] main/ 注入边界**：main/ 下的模块不许裸用
  `win` / `settingsWin` / `IS_WIN` / `IS_PACKAGED` / `levelIdle` / `passThrough`
  （成员访问如 `platform.IS_WIN` 不算），防止同类问题再漏
- **打包白名单漏项**：`build.files` 补 `main/**/*.js`、`renderer/**/*.js`
  （拆分后新目录不进包 → 主进程 require ENOENT、页面脚本 404，开发模式看不出来）
- 打包只带 whisper.cpp 的二进制 + **181MB 小模型**（`ggml-small-q5_1.bin`），
  不再把 `.whisper/**`（含 465MB/547MB 模型与 91MB 编译目录）塞进安装包
- 打包后 `.whisper` 在 `app.asar.unpacked`：main.js 设 `WHISPER_HOME`，
  `asr-whispercpp.js` / `asr-backends.js` 都按它找二进制与模型
- `npm run scan` 新增 **[11] 打包覆盖**：main/agent 的相对 require + 两个页面的
  script/link 都必须在 `build.files` 里匹配得到；并修好 [7] DOM id 检查（现在覆盖 renderer/，
  引用数从 7 恢复到 50）

### 重构

- **两条平行状态机合并（P2-3）**：新增 `agent/drill.js`，收拢单词/例句共用的机械状态机
  · 本地日期、shuffle/sample、抽卡避开上一张、批次完成度、复习开关
  · `createStore()`：带文件戳缓存的读写 + schema 迁移（数据文件与格式完全不变）
  · `needBuild()`：日期变 / 批次空 / 档位变才重建
  · `toggleMode()`：例句模式「错题本为空不切」这类差异用参数表达
  · vocab-daily 443→397、pattern-daily 297→284，新增 drill 119 行；重复逻辑集中一处
  · 新增 `tests/drill.test.mjs`（7 条）与 `tests/pattern-daily.test.mjs`（5 条，之前完全没有）
- **ASR 契约测试加固（P2-4）**：契约抽成 `tests/fixtures/asr-contract.json`
  （health/asr 字段、类型、端口、prompt/lang 参数），两个后端**在同一平台都检查**
  （之前按平台二选一，mac 上完全不测 whisper.cpp）
- 新增**运行时契约测试**：8765 有服务时直接打 `/health` 与 `/asr` 校验真实字段与类型，
  服务没跑就 skip；本机已用 whisper.cpp 与 mlx 各跑一遍（8/8 通过）

### 重构（P2-2：拆两个巨型文件）

- `main.js` **1439 → 426 行**：静态服务 / 进程登记 / 菜单 / TTS / ASR / IPC / 窗口
  拆到 `main/`（工厂 + 依赖注入，共 7 个模块，最大 299 行）
- `pet.js` **1983 → 152 行**：按职责拆到 `renderer/`（state / ui / audio / speech / rec /
  cards / modes / model / app-ui），加载顺序写在 `pet.html`；classic script 共享顶层词法作用域，
  没有引入构建器、没有改 ESM、行为不变
- `main.js` **1439 → 1193 行**：静态服务、子进程登记、菜单已拆到 `main/`（工厂 + 注入）
- 每刀独立提交，验证方式：`npm test` + `npm run scan` + `npm run smoke`（含 canvas/modelReady 渲染断言）


## v0.3.13 — 朗读规则、CSP 与平台集中化

朗读文本有了统一规则表；两个窗口补上严格 CSP；平台差异收进 `agent/platform.js`。

### 重构

- 冒烟测试新增渲染断言：`canvas` 存在 + `modelReady`（模型就绪后 HUD 隐藏）+ `canvasSize` 为 宽x高，
  以后 CSP / pixi 补丁把画面打挂时 `npm run smoke` 会直接失败（之前只查 DOM，测不到渲染）
- 平台差异集中到 **`agent/platform.js`**：`IS_WIN/IS_MAC`、进程与端口（`killPid` / `portOwner` / `isOurs`）、
  窗口样式、系统声线、VOICEVOX 引擎候选路径、子进程 PATH、识别后端归一
- `main.js` 里的 `IS_WIN` 分支从 16 处降到 4 处（剩下的是 SAPI 分支、菜单、进程提示）
- 新增 `tests/platform.test.mjs` 9 条：netstat/lsof/ps 解析、声线、窗口行为、后端归一

### 安全

- 两个窗口加 **Content-Security-Policy**：`script-src 'self'`、`connect-src 'self'`、
  `object-src 'none'`，不允许内联脚本/远程脚本/`unsafe-eval`
- PixiJS 7 需要 eval，改用官方 **`@pixi/unsafe-eval`** 补丁（在 `pixi.min.js` 之后加载），
  这样不用给 CSP 开 `unsafe-eval`
- `npm run scan` 新增 `[10] 页面 CSP`：检查 CSP 存在、无 `unsafe-eval`、无内联脚本；
  `tests/csp.test.mjs` 7 条同口径测试

### 数据

- `issues.log` 不再只增不减：超过 **256KB** 轮转成 `issues.log.1`（只留一份），由新增的
  `agent/rotating-log.js` 负责（以后的应用日志也复用它）；`.1` 已加 gitignore
- 测试：`tests/rotating-log.test.mjs` 5 条（追加、轮转、只留一份、tail、边界）

### 界面

- 「錯題本是空的」只走左上角 HUD 提示，不再写成黄色卡片（单词 / 例文一致）；
  卡片保持原内容，模式也不切换

### 语音

- 修：预热写的 TTS 缓存与 `pet:speak` 读的键不一致（一个用原文、一个用「版本+规范化文本」），
  导致预热完全失效；现在两边共用 `tts.speechKey()`
- 降级路径（SAPI / mac `say`）也做规范化：`engines: null` 的规则（如 Nihonco → にほんこ）在兜底时同样生效
- 新增 **`agent/speech-text.js`**：朗读前的文本规范化（只影响读出来的内容，不改气泡显示）
  · 规则表带 id / 类别 / 引擎范围 / 备注，顺序固定、逐条可测
  · 覆盖：笑声（はは、www）、拉丁缩写（AI/OK/Live2D/PC）、四位数年份、省略号 → 停顿、emoji 清理
  · 规则按引擎生效：VOICEVOX 专属问题不影响 `say` / SAPI
  · `RULES_VERSION` 参与 TTS 缓存键 → 改规则旧缓存自动失效
- 新增 `npm run snapshot:readings` + `tests/speech-reading.test.mjs`：
  用 VOICEVOX 的 audio_query 记录实际读音（mora）作为快照，引擎在跑时校验"读法没变"
- 测试：`tests/speech-text.test.mjs` 12 条（规则结构、各类行为、幂等、引擎范围）

## v0.3.12 — whisper.cpp 后端 + 设置增强

mac 现在可以不用 Python：whisper.cpp（Metal）作为 mlx 之外的后端；设置窗口能直接切换后端/模型。

### 语音

- mac 支持 **`ASR_BACKEND=mlx|whispercpp`**：whisper.cpp 走 Metal、免 Python，
  与 Windows 同一份 `agent/asr-whispercpp.js`
- 设置窗口「应用信息 → 语音识别」加**后端 / 模型两个下拉**，切换后自动重启识别服务；
  没配置过时**默认选体积最小的模型**，换后端也跟着切到该后端的最小模型
- whisper.cpp 在没有 `ASR_MODEL` 时自动挑 `models/` 里最小的 `.bin`
- 新增 **`npm run setup:whisper`**：一条命令准备 whisper.cpp 后端（cmake → 源码 → Metal 编译
  → `.whisper/whisper-server` → 下 181MB 小模型），支持 `--check` / `--force`，Intel Mac 通用
- 开机自启开关（设置 → 应用信息，默认关闭）：仅 **打包版** 显示/可用，
  开发模式直接隐藏，避免把 node_modules 里的 Electron 写进系统登录项
- 模型下拉：mlx 未下载的项标「（未下载）」并禁用；当前后端不适用 `.env` 里的 HF 名时，
  提示行会说明「已按最小模型显示」
- `setup:whisper` 把 whisper.cpp 版本钉到 **v1.9.5**（`WHISPER_CPP_TAG` 可覆盖），
  并在脚本里注明源码/模型下载**未校验哈希**
- `agent/asr-backends.js`：扫描 `.hf-cache`（mlx）与 `.whisper/models`（ggml）列出可选模型，
  标记"已就绪/未下载"；新增 4 条测试
- `/health` 的 `engine` 字段：mac 现在能区分 `mlx` 与 `whisper.cpp`
- 实测（M2 Pro，10 段 1.4 秒录音）：whisper.cpp small-q5_1 平均 257ms（RTF 0.20），
  比 mlx-small（634ms）快约 2.5 倍；q5_1 与 f16 转写逐字一致

## v0.3.11 — 识别模型更可见

识别模型可以指本地目录、「回落」不再静默、README 补模型小节与隐私提醒。

### 语音

- `ASR_MODEL` 支持本地目录（绝对或相对项目根）：`asr.py` 新增 `_as_local_path()`，
  手动下载的模型不用写死绝对路径
- `ASR_MODEL` 改为调用时读取（`process.env` 优先），设置改动即时生效
- 模型回落不再静默：Windows 找不到指定模型文件时打 `⚠` 日志，`/health` 增加
  `modelFallback` / `modelNote` / `modelFile`；mac 侧 `/health` 增加 `modelNote`
- 测试：`tests/asr-model-resolve.test.mjs` 3 条（回落标记+原因、命中不标记、HF 名按 small）

### 文档

- README 新增「识别模型（ASR_MODEL）」小节：默认 small、三种写法、
  换 turbo 的 curl 命令（避开 xet 卡 0%）、small/turbo 实测对比与 `/health` 验证方法
- README 修正 Windows 侧说法：`ASR_MODEL` 是「当模型名用」（`medium` → `ggml-medium.bin`），
  只有带 `/` 的 HF 仓库名会被忽略；找不到时回落到目录任意 `.bin`
- README 补隐私提醒：识别文本（前 60 字）明文写入本地日志，可用设置开关关闭

## v0.3.1 — 识别可见、语音更一致

识别日志、换声线后的缓存修正、ASR 启动不再卡住。

### 语音

- **ASR 预热不再阻塞启动**：先监听 8765，模型在后台线程加载；
  `/health` 立刻回 `ready:false`，加载期间 `/asr` 返回 503「模型还在加载」。
  修掉「模型没就绪时端口不存在 → 界面报识别失败」
- 启动时**优先用已缓存的模型**并启用离线模式：任意候选（turbo/small）有 `weights.npz`
  就不再联网，避免 turbo 没下完时启动卡在下载

- **识别日志**：每次识别记一行（耗时 / 字节 / 语言 / 引擎 / 热词长度 / 是否重试 / 文本），
  默认开启；设置窗口「应用信息 → 语音识别 → 日志」可关（`ASR_LOG=0`），2MB 轮转。
  mac 与 Windows 都生效，用来排查识别延迟
- 提示音缓存键加入**声线名**（原来只含语速/音高/语调/音量）→ 换角色后不再播旧声音
- 换声线或改语音参数时：清空提示音缓存 + 后台重新预热（8 条模式提示音，约 2–4 秒）
- 新增 `voiceCache.clear()`；预热逻辑抽成 `prewarmPrompts()`（启动与刷新共用）
- 测试：同一句话在不同声线/不同语速下缓存键必须不同

### 文档

- 流程图与代码对齐：
  - 单词状态机补 `ok → skip`（空提交退回跳过池）与 `wrong` 空提交自环
  - 语音数据流：识别分平台（mac mlx-whisper / Windows whisper.cpp）；
    回显改为「原文 + 另一语言」（说中文时上中文、下日语）
  - 数据表补 `data/backup/` 与 5 个状态文件的 `version` 字段说明

### 数据

- **数据文件带 schema 版本**：`wordbook` / `patternbook` / `vocab-daily` / `pattern-daily` / `settings`
  读写统一走 `agent/schema.js`。没有 `version` 的旧文件读取时自动迁移并回写；
  比程序新的版本不降级（只警告）；导入/恢复旧备份同样迁移
- `npm run scan` 新增 `[9] 数据 schema 覆盖`：备份里的每个文件都必须有 schema 与迁移入口
- 新增 `tests/schema.test.mjs` 10 条（迁移幂等、不丢数据、未来版本不降级、备份导入补版本）

## v0.3.0 — 跨平台（macOS + Windows）

Windows 移植 + 打包隐私 + 一轮界面与学习反馈打磨。

### Windows 版（新）

- **移植完成**：同一套渲染层 / 学习逻辑，替换三个外部进程
  - ASR：`asr.py` + mlx-whisper → **whisper.cpp**（`agent/asr-whispercpp.js`，`whisper-server.exe`，免 Python）
  - TTS 兜底：`say` → PowerShell SAPI（Windows 无日语声线，日语朗读靠 VOICEVOX）
  - 进程管理：`ps`/`lsof`/`SIGTERM` → `Get-CimInstance`/`netstat -ano`/`taskkill /T /F`
- **打包**：electron-builder（`build:win` / `build:win:dir` / `build:win:portable` / `build:win:nsis`），
  自包含、可写数据落 `%APPDATA%\Nihonco`（`data/` 与 `.voice/` 迁移）
- **隐私**：`build.files` 从 `data/*.json` 改成显式白名单，个人进度（wordbook / settings / vocab-daily…）
  不再进安装包；`main.js` seed 时按同一白名单二次过滤
- **健壮性**：`agent/boot-data.js` 在包内缺 `jlpt.json` 时回退项目 `data/` 并告警，不再"能开但没词"
- **scan**：新增 `[8] 打包数据白名单` 检查（build.files ↔ SHARED_DATA 一致；无 git 时仍跑前两条）
- 修：`Ctrl+Ctrl+T/P` 在 Windows 注册不上 → 改 `Ctrl+Alt+T/P`
- 修：whisper `/health` 的 `ok` 语义与 mac 对齐；`fallback` 不再恒 true
- 修：`.gitignore` 曾被整体改成 CRLF → 归一 LF + 新增 `.gitattributes`
- Mac 入口保持：恢复 `build:app`，`tools/setup.mjs` 在 macOS 上转交 `setup.sh`

### 数据

- 词表按 `ja` 去重（原始数据 60 条重复，N5–N4 档占 20 条），避免同一天抽到同一个词两次；
  去重后 N5–N4 1548（N5 621 / N4 927）、N3 1573、N2 2921、N1 4067
- NOTES 里过期的「只支持 macOS」改成双平台前提对照

### 界面与交互

v0.2.0 之后的界面细节：

- 造句讲评：例文模式造句后给「你的 / 点评 / 问题点 / 改写（高亮）/ 自然度 1–5」；
  答对时仅在模型给出更自然说法时才附一句，不强行建议
- 语音回显：10 秒自动消失，切模式/换卡/提交立即清除
- 造句讲评：有「改」时不再重复显示「例句」
- 修：自然度来自模型可能越界（6/7/0），渲染会抛 RangeError 导致卡片卡住 → 先钳制 1–5，
  再给讲评渲染包一层兜底（渲染失败也照常往下走）
- 修：引擎自动重启计数只在失败时累加，累计 3 次后永久放弃 → 稳定运行 60 秒后清零
- 冒烟测试新增健壮性步骤：natural 给 7 / -1 / 0 / "5" / null / 3.5 / NaN 都不能抛
- 键盘罗马字跟在「键盘」标签后正常折行（不再把标签单独留一行）
- 黄卡统一加标签：纠错 / 讲解 / 单词 / 说法 / 意思 / 接续 / 例句 / 读音 / 备注 / 你的 / 点评 / 问题 / 改 / 地道 / 键盘 / 自然 / 进度；
  台词不加标签、用暗色放在最末；指令行仍以「——」开头
- 单词答错顺序调整：你的 → 键盘 → 指令 → 台词；答对只显示「进度 + 台词」
- 例文复现答错时给「键盘拼写」（造句题不给，避免等于送答案）；空格不加，因为 IME 里空格是変換键
- 「再读一遍」在单词/例文模式改读卡片内容（词+例句 / 例句），不再是鼓励语
- 会话提示词：少样本 2 → 5 条（天气/电影/开会/肚子饿/短应答），
  追问改为「按需」而非每轮必问；新增「跟着对方话题走，别反复回到同一话题」；
  主动搭话允许陈述句
- 按钮顺序：復習（最宽）→ 新規 → 档位（38px），从上到下由宽到窄

- 数字显示：`単語`/`例文` 按钮内常驻 `已学/全部`（固定宽度），错题数并入 `復習 · N`
- 卡片朗读高亮：单词卡高亮「词 + 例句」，例文卡高亮「例句」（半透明底色，常亮）
- 卡片标签：单词卡补「意思 / 例句」；例文卡「例」统一为「例句」
- 全局档位 `N5` 只在会話/解説 显示
- 启动时预取两组进度，`例文` 不再显示 `0/0`


## v0.2.0 — 模型可换、识别更准

v0.1.0 之后的一批：能换形象、识别更准、设置更好用。

### Live2D 模型

- 设置里**切换模型**：自动扫描 `model/` 下的 `*.model3.json`，选中即重载挂件
- 每个模型**独立取景**：半身（倍数 / 左右 / 上下），选模型自动套用其默认位置
- 「应用」= 临时试看；「保存位置」= 把这组取景存成该模型默认（原子写 `data/live2d-models.json`）
- 取景只保留**半身**（头到大腿），删掉全身与缩放选项
- 第三方模型自带的**水印默认关闭**（读同目录 `水印.exp3.json`，`?watermark=0` 可保留）
- 修复：切换模型后取景输入框没跟着变

### 语音识别

- 默认模型换成 `whisper-large-v3-turbo`，拉不下来按 turbo → large-v3 → small **自动回退**
- `/health` 增加 `requested` / `fallback`，一眼看出是否回退
- **热词**：每次识别把「当天批次 + 错题本」的词作为 `initial_prompt` 传给 ASR
- 修两次热词 bug：`info()` 没返回 batch；取词按对象取导致一个都没进去
- 热词改为**按整词截断**（不再切出「遅」「ロ」这种半个词）
- 修复语音识别全失败：`transcribe()` 多行签名没补 `hotwords` 参数

### 学习

- 错题本**按档筛选**：復習只轮当前档位（单词/例文各自独立）
- 换档提示音「レベルアップ / レベルダウン」**点击即播**（不等后端），换档同时退出復習
- 句型括号里的英文说明显示成中文（`〜から（from）` → `〜から（起点）`）
- 造句判定改用 `patternRaw`，显示与判定分开

### 设置窗口

- 分成 5 组：**声音设置 / 画面设置 / LLM 模型信息 / 应用信息 / 数据**，组间有分割线
- 底部「保存 / 关闭」居中
- 声线下拉列出引擎里的全部角色（切换即生效，写回 `.env`）
- 「识别」改名「语音识别」，去掉重复的声线胶囊

### 语音

- 合成期间被打断也会丢弃（`speakNow()` 合成完再查代际号），不再出现"点了还继续读旧的"
- 新增：右键「记一下刚才…」把当前状态写进 `data/issues.log`

### 工程

- 测试 71 → **78**：ASR 源码契约、热词取词与截断、取景原子写、info().batch
- `data/live2d-models.json` 改用 `writeJsonAtomic`
- 清理死配置 `VOICEVOX_STYLE`（风格功能已回滚）
- README 补齐这一批改动；公开前清理清单新增「BUILTIN_FITS 本地路径」「水印默认关闭」两条
- 新增 `docs/WINDOWS-HANDOVER.md`（Windows 版交接文档）


## v0.1.0 — 日常可用

第一次把整条链路跑通、并稳定自用。

### 模式

- 四种模式：**会話 / 解説 / 単語 / 例文**（会話与解説 共用一个按钮互换）
- 三种声线提示音：切模式念「たんごモード」这类短句；进/出復習、升/降档也有（レベルアップ / レベルダウン）
- 语音队列：桌宠的语音按顺序播完，只有用户操作（说话/打字/点按钮）能打断

### 学习

- 単語：每日 20 词（新 10 / 错 6 / 跳 2 / 学 2），连对 2 次毕业，错题本专项復習
- 例文：每日 5 句（新 3 / 错 1 / 学·跳 轮流 1），复现（照打）或造句（规则 + 模型判定）
- 复现判定接受三种写法：汉字、全假名、汉字+假名混合（内置 7,361 条词干表）
- 错题本**按档筛选**：復習只轮当前档位
- 例句数据 N5–N1 共 **526 条**（OpenJLPT，CC BY-SA 4.0，含中文与假名读音）

### 数据

- 三层保护：快照（原子写）+ 追加日志 + 基线，快照损坏可从日志重放重建
- 设置窗口「数据」区：导出 / 导入 / 从备份恢复 / 清空当前档位 / 清空全部；每次操作前自动快照（保留 7 份）
- 换档不删历史进度；清空会把日志水位线推进到当前，避免重放复活

### 工程

- 71 个行为测试（`npm test`）+ 结构扫描（`npm run scan`，自动发现 agent 模块）
- 语音缓存与启动预热（提示音 ~100ms 出声）
- 两道数据安全闸：测试必须隔离到临时目录；自动化钩子在场时禁止改动真实数据

### 已知限制

- 只支持 macOS（依赖 `say`、`lsof`、mlx-whisper）
- 资产不可公开分发：Live2D Hiyori 模型、VOICEVOX 小夜声线
- 复现混合写法依赖内置词表，表外词（人名等）仍只认精确写法
