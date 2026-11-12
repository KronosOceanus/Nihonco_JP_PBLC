# 文档地图

先看这一页，再按目的找文档。

## 用户 / 当前行为

| 文档 | 负责 |
|---|---|
| [UI.md](UI.md) | 模式、操作、气泡、黄卡、HUD、设置、窗口 |
| [JAPANESE-RULES.md](JAPANESE-RULES.md) | 判分、SRS、黄卡、读音、会話规则、朗读 |
| [PERSONA.md](PERSONA.md) | 人设、few-shot、记忆、Prompt 顺序 |
| [ASSETS.md](ASSETS.md) | 模型 / Core / Whisper / TTS 从哪来、放哪、许可 |
| [AUDIO.md](AUDIO.md) | ASR/TTS 运行时、回退、超时、日志、自检 |
| [DATA.md](DATA.md) | 数据文件、schema、快照、备份、日志 |

## Windows

| 文档 | 负责 |
|---|---|
| [windows/WINDOWS.md](windows/WINDOWS.md) | Windows 安装、ASR CPU/CUDA、TTS、lite 构建、打包结构 |
| [windows/ACCEPTANCE.md](windows/ACCEPTANCE.md) | Windows 构建与安装后验收清单 |

## 开发 / 维护

| 文档 | 负责 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 进程、目录、模块、IPC、CSP、构建边界 |
| [DEV.md](DEV.md) | 开发命令、测试、smoke、scan、发版 |
| [BOUNDARIES.md](BOUNDARIES.md) | 哪些修、哪些不修、测试边界、完成标准 |
| [archive/](archive/) | 历史调研/旧方案；不代表当前实现 |
| [NOTES.md](../NOTES.md) | 开发笔记、决策、踩坑 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本记录 |

## 单一事实来源

同一件事只在一处维护：

```text
资产路径 / 下载 / 许可       → ASSETS.md
ASR/TTS 运行时 / 回退 / 超时  → AUDIO.md
Windows 安装 / 打包          → windows/WINDOWS.md
Windows 验收                 → windows/ACCEPTANCE.md
判分 / SRS / 对话规则        → JAPANESE-RULES.md
人设 / 记忆设计              → PERSONA.md
数据文件 / schema / 备份     → DATA.md
进程 / 模块 / IPC / 安全     → ARCHITECTURE.md
测试命令 / scan / smoke      → DEV.md
修不修 / 完成标准            → BOUNDARIES.md
```

其它文档只做摘要和链接，不复制完整规则。

## 推荐阅读顺序

```text
第一次用：
README → UI → JAPANESE-RULES → PERSONA

装环境：
README → ASSETS → AUDIO → windows/WINDOWS

改代码：
ARCHITECTURE → DATA → DEV → BOUNDARIES

Windows 验收：
windows/WINDOWS → windows/ACCEPTANCE
```

## 根目录标准文件

| 文件 | 作用 |
|---|---|
| [README.md](../README.md) | 项目门面、快速开始、文档入口 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本记录 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献方式与开发约定 |
| [SECURITY.md](../SECURITY.md) | 安全问题报告 |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | 行为准则 |
| [LICENSE](../LICENSE) / [NOTICE](../NOTICE) | 许可与版权 |
| [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | 第三方许可 |

## 约定

```text
docs/ 里的“当前行为”必须和代码同步
未执行的计划明确标「未实现」，不冒充现状
临时文档用 tmp_*.md，不提交仓库
文档里的路径以实际代码为准，不写临时本机路径
```

---

## 本次收敛后的重复处理

```text
UI → 判分/SRS/振假名细节指向 JAPANESE-RULES
PERSONA → 会話执行规则指向 JAPANESE-RULES
AUDIO → 资产安装/路径指向 ASSETS
ACCEPTANCE → 资产准备指向 WINDOWS/ASSETS
BOUNDARIES → 测试覆盖指向 DEV
ARCHITECTURE → 只保留结构总览，不维护完整路径清单
```
