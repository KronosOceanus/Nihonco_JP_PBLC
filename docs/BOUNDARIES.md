# 代码与测试边界

> 目的：防止“无限修复/加固”。不是所有债都要现在还，也不是所有异常都要兜底。
> 适用于 **v0.7.32**；改代码前先读这一页。

---

## 1. 产品边界

保留：

```text
会話 / 解説 / 単語 / 例文
点词查询
回显翻译
本地 ASR + VOICEVOX / AivisSpeech
Windows Whisper CPU / CUDA
SRS + 错题本
轻量人格记忆
设置 / 数据导出
资源拖放安装
```

不扩成：

```text
× 五十音课程
× 完整字典 / 词典平台
× 发音评分 / 跟读打分
× 场景课 / 多角色
× 手机端 / Web 端
× 通用 AI 桌宠平台
× 插件市场 / 多 Agent 编排
```

功能原则：

```text
只做当前日语学习闭环内的收口
新功能先讨论
不接受“顺手加一个”
```

当前允许的方向：

```text
Windows ASR 运行时
CUDA / CPU 引擎安装
实际引擎切换
Whisper 模型管理
资源状态与下载入口
```

这些是当前产品的一部分，不是“新平台”。

---

## 2. 代码边界

会动：

```text
可复现的用户 bug
数据丢失 / 安全问题
明确影响主流程的回归
正在改的那块代码顺手收口
```

不会动：

```text
× 为了“更整齐”重写渲染层
× 引入 TypeScript / 打包器
× 全仓 Prettier
× 把所有空 catch 一次性治理
× 为了行数把 settings 模块拆得更碎
× 把 llm.js 拆成多个文件
× 把 scan 做成完整 JS 解析器
× 为了跨平台重写整个窗口系统
```

重构只在两种情况下做：

```text
1. 这次改动正好落在那个文件
2. 不拆就会让这次改动更容易出错
```

不为了“以后可能”提前拆。

---

## 3. 测试边界

测试命令、覆盖清单和基线见 [DEV.md](DEV.md)。  
本文只定边界：

```text
覆盖：
  agent 规则 / 数据 / 配置 / 资源安装 / ASR 契约
  settings 静态结构
  smoke / smoke:settings

不覆盖：
  renderer 交互
  拖放确认面板真实点击
  GUI 视觉回归
  LLM 输出质量
  ASR/TTS 真机音频
  Windows 真机
  mac + Windows UI CI
```

原则：

```text
不为 getter / 一行转发写测试
不为“理论上可能”的异常写测试
只测规则、契约、曾经真出过 bug 的路径
测试要能抓住字段漏传 / 平台判断错误
```

## 4. 修复 / 加固的准入

至少满足一个：

```text
1. 有复现步骤
2. 有日志 / 数据证据
3. 是安全或数据丢失问题
4. 是当前正在改的代码的自然收口
```

不满足就只记录，不改。

加固的停止条件：

```text
正常路径正确
有一个合理兜底
失败时用户能看到提示或日志
test / scan / smoke 全绿
```

不要求：

```text
× 每个 catch 都有日志
× 每个 IPC 都有超时
× 每个状态都有防御性拷贝
× 每个函数都有单元测试
```

---

## 5. scan / lint 的边界

scan 是项目自检，不是 ESLint：

```text
支持：本项目实际使用的 classic JS 子集
不支持：完整 JS 语法、所有正则边界、所有 ASI 情况
```

修到“当前代码 + 常见写法”即可，不扩成 parser。

lint 如果加：

```text
只查 agent/ + main/
只 warn，不阻塞
不上 Prettier
```

---

## 6. 什么时候算“做完了”

```text
npm test 全绿
npm run scan 全绿
npm run smoke 通过
没有已知阻塞用户的问题
已知债有记录
```

满足即停，不继续找“还能不能更好”。

---

## 7. 当前接受的债

```text
renderer 仍是经典脚本
settings 已按功能拆到 settings/*
  当前较大的是 settings/asr.js、settings/assets.js
agent/llm.js 642 行
没有 lint / format
空 catch 较多
IIFE 内部不参与跨文件重名检查
拖放确认面板仍缺真实点击测试
Windows 真机验证仍靠手工
```

已修复但需保持：

```text
main 的依赖注入可以用 platform 模块对象
agent 纯函数参数只接受 process.platform 字符串
asset-install 会拒绝对象参数
```

技术债不单独维护清单；有证据的才修，其余记录在 NOTES / CHANGELOG。

---

## 8. 一句话

```text
功能：围绕日语学习闭环收口，不扩成平台。
代码：只修有证据的问题，只拆正在改的地方。
测试：规则和契约优先，不为覆盖率而覆盖率。
加固：正常路径 + 一个兜底 + 可诊断，够了。
```
