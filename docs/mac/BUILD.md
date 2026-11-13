# macOS 构建

> 适用：macOS 13+（Apple Silicon）、Node 18+，只提供 **lite** 构建。
> Windows 的做法见 [../windows/WINDOWS.md](../windows/WINDOWS.md)，两边共用同一套渲染层和 agent 逻辑。

---

## 1. 结论

mac 的 lite 产物是一个**壳**：把 `node_modules/electron/dist/Electron.app` 拷一份，塞进
`bootstrap.js`，运行时从包位置向上找到项目根再 `require` 真正的 `main.js`。

所以 mac 没有安装包、没有 asar、也不做签名（只有 ad-hoc）。这也决定了后面 §5 的所有注意事项。

---

## 2. 前置

| 项 | 要求 | 说明 |
|---|---|---|
| 系统 | macOS 13+ | Apple Silicon；Intel 可源码运行但打包未验证 |
| Node | 18+ | 实测 v22 / v24 |
| cmake | 需要，但**会自动装** | `setup:whisper` 依次找 `$CMAKE` / `.venv/bin/cmake` / Homebrew / PATH；都没有就用 `.venv` 的 pip 装（不动系统），再没有就 `brew install cmake` |
| Python | 只有 `--with-mlx` 需要 | `npm run setup` 会建 `.venv` |
| 磁盘 | 约 2GB | `.whisper` 约 400MB + 两次 Electron（`node_modules` 258MB + `.app` 252MB） |

---

## 3. 命令

```bash
git clone git@github.com:KronosOceanus/Nihonco_JP.git
cd Nihonco_JP
npm ci
npm run build:app:lite        # 产物：Nihonco.app
npm run build:app:lite:mlx    # 额外准备 mlx 环境与模型（仅 Apple Silicon）
```

首次构建会下这些（之后走缓存 / 跳过）：

```text
npm ci          Electron 二进制约 120MB
setup-whisper   whisper.cpp 源码 9.8MB + 模型 181MB
（缺 cmake 时）  几十 MB
```

下载源默认「镜像 → 官方」，要强制单源：

```bash
npm run build:app:lite -- --mirror=official   # 只走官方
npm run build:app:lite -- --mirror=cn         # 只走镜像
```

---

## 4. 构建做了什么

`node tools/build-app.mjs --target=mac --mode=lite` 只有三步：

```text
1. check-assets.mjs --lite   只打印，不检查 Live2D/Whisper（都是运行时外置）
2. setup-whisper.mjs         下源码 → cmake 编译 whisper-server → 下模型并校验 sha256
3. build-app.sh              cp -cR Electron.app → Nihonco.app，写 Info.plist / bootstrap.js，
                             去隔离属性，ad-hoc codesign
```

第 1、2 步都有幂等判断：`.whisper/whisper-server` 和模型都在就整段跳过，所以第二次构建是秒级。

---

## 5. 产物：`Nihonco.app` 是壳，不能单独拖走

```text
<项目根>/
├── Nihonco.app                    ← 壳；bootstrap.js 向上 4 层找项目根
├── main.js / agent/ / renderer/ / settings/ / data/
├── node_modules/                  ← 运行时依赖（pixi、kuromoji…）
├── model/Hiyori/                  ← 自备
├── lib/live2dcubismcore.min.js    ← 自备
└── .whisper/                      ← 构建产物：whisper-server + models
```

- 只把 `Nihonco.app` 拖到 `/Applications` 会在 `Documents/main.js` 之类的地方找不到入口，起不来
- 移动可以，但必须**整个目录**一起移
- 只有 ad-hoc 签名；首次打开被 Gatekeeper 拦，右键 → 打开

mac 与 Windows 的资产路径对照见 [../ASSETS.md](../ASSETS.md) §1。

---

## 6. 分发（发给别人）

| 能发 | 不能发 |
|---|---|
| 整个项目目录（含 `Nihonco.app`、`.whisper`、`node_modules`） | `.env`（里面是 API key） |
| — | `model/`、`lib/live2dcubismcore.min.js`（Live2D 条款禁止再分发模型） |
| — | `.voice/`、`data/` 里的学习进度 |

对方要自己补三样才能用：

1. **模型 + Core**：`model/Hiyori/`、`lib/live2dcubismcore.min.js`（[../ASSETS.md](../ASSETS.md) §3、§4）
2. **VOICEVOX 或 AivisSpeech**（约 2GB，否则不发音）
3. **LLM key**：启动后 设置 → LLM 填，写进 `~/Library/Application Support/Nihonco/data/.env`

打包命令：

```bash
npm run build:dist:mac -- --verify
```

脚本 `tools/build-dist-mac.mjs` 按**固定清单**拷贝（壳 + 代码 + 运行时依赖 + `.whisper`），
缺一样直接报错停下，不会产出半成品；`--verify` 会真的启动一次，确认 `main.js` 跑得起来
（这个坑踩过：漏拷 `main.js`，包能启动但主进程直接挂，终端还没有任何输出）。

产物：

```text
dist-mac/Nihonco-mac-arm64-<版本>.tgz        约 348MB
dist-mac/Nihonco-mac-arm64-<版本>.tgz.sha256
```

不带 `--verify` 就只组装不启动；`--no-tar` 只出目录。包里已排除 `model/`、`lib/`、`.env`、
个人进度和 `node_modules` 里的 electron/electron-builder（约 259MB 构建期依赖）。

对方是 Intel Mac 就别发了：产物是 arm64，跑不了。

---

## 7. 自检（构建完 6 条）

```text
[ ] npm test        350 项（347 pass / 3 skipped）
[ ] npm run scan    全绿
[ ] npm run smoke   6 步通过（需要 lib/ + model/，否则渲染层报错）
[ ] 启动            `open Nihonco.app`，窗口出现，没有白屏
[ ] 资源            HUD 不提示「缺少 Live2D 资源」；设置页能打开
[ ] 语音            说一句日语能识别、能回复、能朗读
```

---

## 8. 常见失败

```text
编译失败           看 .whisper/build 下的 cmake 输出；whisper.cpp 会打几条 nlohmann/json 的 warning，无害
源码/模型下不动     换源：--mirror=official 或 --mirror=cn；也可以手动把 ggml-small-q5_1.bin 放进 .whisper/models/
启动报缺 Electron   构建脚本会自动用镜像补；手动补是 node node_modules/electron/install.js
窗口空白 / HUD 提示   没放 model/ 和 lib/，见 §6
设置页打不开         看 data/logs/app.log
```
