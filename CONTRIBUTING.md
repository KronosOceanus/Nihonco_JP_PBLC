# 贡献指南

感谢愿意帮忙。这个项目是单人维护的桌面日语学习工具，**PR 请先开 Issue 说明要改什么**，避免白做。

## 环境

| 平台 | 需要 |
|---|---|
| macOS | Node 18+、Python 3.13（`npm run setup` 建 `.venv`） |
| Windows | Node 18+、whisper.cpp 模型、VOICEVOX（可选，但日语朗读需要） |

```bash
npm ci
cp .env.example .env     # 填 LLM_API_KEY
npm start
```

Windows 的安装/打包细节见 [docs/windows/WINDOWS.md](docs/windows/WINDOWS.md)。

## 许可证

本项目采用 PolyForm Noncommercial License 1.0.0（禁止商业使用，source-available）。
提交 PR 即表示你同意贡献内容按同一许可证发布。

## 提交前必须跑

```bash
npm test        # 行为测试
npm run scan    # 结构/契约检查
npm run smoke   # 端到端冒烟（需要图形界面）
```

- 三条全绿再提 PR
- 改了判分、黄卡、回显、SRS、prompt 后处理，请补对应测试
- 改了 `build.files` / 数据白名单，务必跑 scan（它会检查不一致）

## 不要提交

```
.env
data/            # 学习进度、日志、缓存
dist/            # 打包产物
model/           # Live2D 模型（条款不允许再分发）
.whisper/ .voicevox/ .venv/
```

模型与语音资产由用户自行从官方渠道获取，见 [docs/ASSETS.md](docs/ASSETS.md) 的「模型与语音资产（需自备）」。

## 代码约定

- 渲染层是经典脚本，共享全局词法环境：**跨文件变量只在 `renderer/state.js` 声明**
- 主进程模块通过 `ctx` 注入依赖，不要裸用 `main.js` 的变量
- 新增 IPC：优先挂在对应域的 `register` 里，并加 `fromSettings` / `fromPet` 守卫
- 新依赖：说明用途、许可证、打包体积影响

## PR 检查清单

- [ ] 说明动机与行为变化
- [ ] `npm test` / `npm run scan` / `npm run smoke` 通过
- [ ] 新增/修改的规则有测试
- [ ] 更新相关文档（`docs/` 或 `NOTES.md`）
- [ ] 没有提交密钥、个人路径、学习数据或第三方资产
