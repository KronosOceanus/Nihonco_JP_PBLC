# 文档地图

先看这一页，再按目的找文档。

## 当前行为（用户/维护者）

| 文档 | 内容 |
|---|---|
| [INSTALL.md](INSTALL.md) | 安装、首次启动、自检 |
| [ASSETS.md](ASSETS.md) | 模型 / Core / Whisper / VOICEVOX / AivisSpeech：从哪来、放哪；只讲资产位置，构建规则见 WINDOWS |
| [UI.md](UI.md) | 模式、气泡、黄卡、回显、HUD、设置、窗口 |
| [JAPANESE-RULES.md](JAPANESE-RULES.md) | 判分、黄卡、SRS、朗读、语言规则、行为变更 |
| [AUDIO.md](AUDIO.md) | ASR 后端/模型/GPU、TTS 双引擎与朗读规范化 |
| [DATA.md](DATA.md) | 数据文件、schema、备份、日志 |
| [windows/WINDOWS.md](windows/WINDOWS.md) | Windows 安装、lite 构建规则、GPU、已知问题 |
| [windows/ACCEPTANCE.md](windows/ACCEPTANCE.md) | Windows 构建与验收清单 |

## 开发/维护

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 目录、进程、模块、IPC、安全 |
| [DEV.md](DEV.md) | 测试、scan、smoke、CI |
| [BOUNDARIES.md](BOUNDARIES.md) | 哪些修、哪些不修、完成标准 |
| [archive/](archive/) | 历史调研/旧方案；不代表当前实现 |
| [NOTES.md](../NOTES.md) | 开发笔记、决策、踩坑 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本记录 |

## 设计/未实现

| 文档 | 内容 |
|---|---|
| [PERSONA.md](PERSONA.md) | 人格与记忆设计；阶段 1 与轻量记忆已实现，主动开口未实现 |

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

```
· docs/ 里的“当前行为”文档必须和代码同步
· 未执行的计划明确标「未执行」，不冒充现状
· 临时文档用 `tmp_*.md`，已被 .gitignore 忽略，不提交仓库
· 文档里的路径以实际代码为准，不写临时的本机路径
```
