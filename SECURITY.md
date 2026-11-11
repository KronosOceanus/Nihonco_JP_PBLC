# 安全政策

## 支持范围

当前只维护 `main` 分支上的最新版本（0.5.x）。

## 报告漏洞

请**不要**开公开 Issue。使用 GitHub 的私密漏洞报告：

https://github.com/KronosOceanus/Nihonco_JP/security/advisories/new

报告里请包含：

- 影响版本 / 平台
- 复现步骤
- 影响（泄露、RCE、本地文件读取等）
- 相关日志（`data/logs/app.log`，先删掉 API key、聊天内容）

## 已知边界

- LLM API key 只存在本机 `.env`，不会被应用上传
- 本地静态服务只监听 `127.0.0.1`，有 Host 校验与路径白名单
- 日志、词库、识别文本都在本机 `data/`，不联网
