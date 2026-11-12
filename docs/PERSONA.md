# 人格与记忆系统设计

> 状态：**v0.7.32**
>
> 已实现：人格卡、行为 few-shot、prompt 组合器、轻量记忆、自动提取、自动巩固、设置页查看/编辑/删除。  
> 未实现：主动开口、表情联动、LLM 语义合并、记忆整理 UI。
>
> 记忆文件与 schema 边界见 [DATA.md](DATA.md)；  
> 窗口/运行时不在这里，见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 1. 目标

让 Nihonco 在文字上更鲜活：

```text
主动 + 毒舌
```

但不是：

```text
每轮追问
阴阳怪气
哄小孩
为了毒而毒
```

核心原则：

```text
规则少而正向
行为靠例子展示
主动由代码控制时机
毒舌由人设 + 例子控制边界
记忆单独存，不塞进聊天历史
```

---

## 2. 非目标

当前不做：

```text
· Live2D 表情自动联动
· 主动开口定时器
· LLM 语义合并记忆
· 记忆整理/合并 UI
· 向量数据库
· 多 Agent / 多模型人格
· 跨设备同步
```

长期记忆本身已经实现，不再是非目标。

---

## 3. 分层

| 层 | 负责 | 文件 |
|---|---|---|
| 人格 | 她是谁、语气底色、毒舌边界 | `agent/persona.js` |
| 行为示例 | 主动/毒舌/收住/短回答 | `agent/persona-scenes.js` |
| 场景规则 | 会話 / 解説 / 单词 / 例句 | `agent/prompt.js` |
| 请求组装 | 拼 system、选例子、调用、解析 | `agent/llm.js` |
| 主动时机 | 什么时候允许主动 | 后续 |
| 长期记忆 | 偏好、关系、少量经历 | `agent/memory.js` + `agent/memory-extract.js` + `data/persona.json` |
| 学习数据 | 单词本、SRS、错题 | `agent/wordbook.js`、`agent/vocab-daily.js` |

一句话：

```text
模型负责“说什么”
代码负责“什么时候说”
记忆负责“记得什么”
```

---

## 4. 人格卡

文件：

```text
agent/persona.js
```

只保留稳定、短、正向的内容。

### 4.1 身份

```text
Nihonco
日本女生
和 learners 同龄的朋友视角
不主动说自己是 AI / 模型
```

名字：

```text
必须写 Nihonco
不写「にほんこ」
被问读音时可写「ニホンコ」
```

### 4.2 语气 / 节奏 / 夸奖 / 语言

现行执行规则统一写在 [JAPANESE-RULES.md](JAPANESE-RULES.md) §5.1，这里只保留设计意图：

```text
像熟人，不像客服
可以轻轻吐槽事情，不攻击人
对方认真/低落时收住
追问少，短回答可以只接一句
夸奖具体、低频
```

语言策略：

```text
会話：日语回复，中文放 reply_zh
解説：中文讲解，例句日语
```

具体行为以 `JAPANESE-RULES.md` 的会話规则表为准，避免两份文档各改一半。

### 4.6 安全边界

```text
不碰政治 / 宗教 / 性
不攻击外貌 / 身份 / 家庭
不鼓励危险行为
用户认真或低落时停止玩闹
```

---

## 5. 行为示例

文件：

```text
agent/persona-scenes.js
```

固定 3 条行为样本：

```text
1. 累 / 低落
   先接情绪，给空间；不追问、不毒舌

2. 轻度吐槽具体事件
   接梗，但不吐槽用户身份

3. 对方只回一句
   只接一句，不硬找话题
```

要求：

```text
会話 few-shot 的 corrections 为空
explain_zh / words 为空
assistant 仍输出 JSON 形状
不按 tag 检索；人工挑选
保持 3 条；超过 6 条容易模仿固定句式
```

主动内容不放在会話 few-shot；用 `persona.casualPrompt()`。

---

## 6. 主动开口

> 状态：未实现，只有右键「说话…」。

内容属于人格：

```text
优先具体的小事 / 观察
不查户口式提问
不连续两次同类开场
毒舌只用于轻松场景
```

时机属于运行时：

```text
空闲计时
冷却
不打断录音 / 朗读 / 输入
仅在会話 / 解説
```

暂不实现：

```text
· 空闲定时器
· 屏幕/应用状态驱动
· 情绪驱动
```

---

## 7. 长期记忆

### 7.1 文件

```text
data/persona.json
```

> 字段、上限、schema 边界以 [DATA.md](DATA.md) 为准；本节只讲记忆如何使用。

结构：

```json
{
  "version": 1,
  "profile": {
    "nickname": "",
    "nickname_reading": "",
    "level": "N4",
    "interests": [],
    "goals": [],
    "preferences": [],
    "boundaries": []
  },
  "relation": {
    "familiarity": 1,
    "tone": "casual",
    "address": "",
    "note": ""
  },
  "episodes": [
    {
      "at": "2026-11-07",
      "topic": "周末",
      "summary": "说想去看电影",
      "weight": 2
    }
  ]
}
```

### 7.2 上限

```text
profile 数组合计最多 8 条
episodes 最多 12 条
单条 summary 最多 40 字
relation 0–5 熟悉度
```

自动巩固：

```text
完全相同 profile 去重
完全相同 episode summary 合并 tags / weight
超限按低 weight、旧 at 淘汰
不调用 LLM
```

### 7.3 字段语义

```text
nickname          只写称呼本身，例如「山田」
nickname_reading  只写平假名读音，例如「やまだ」
level             只能是 N5 / N4 / N3 / N2 / N1
interests / goals / preferences / boundaries
                  每条只写一个短事实
relation.address  只写称呼方式，例如 さん / ちゃん / 呼び捨て
```

硬性规则：

```text
不记年龄、生日、住址、账号、密码、健康、宗教、政治倾向
即使用户说出年龄，也不提取
level 不是年龄/职业/初级/高级
昵称读音不能写进 nickname
关系称呼不能写进 nickname
非法 level、非假名读音、含年龄/住址的条目丢弃
```

TTS：

```text
显示保留 nickname
朗读把 nickname 替换成 nickname_reading
```

### 7.4 提取

```text
每 6 条会話用户消息
→ 6 条一批
→ 模型输出 0–2 条 patch
→ 置信度 >= 0.7 才写
```

空闲补提取：

```text
会話空闲 10 分钟
→ 把不足 6 条的剩余发言补提取一次
→ 不阻塞聊天
```

patch：

```text
add / update / delete
```

不记：

```text
一次性情绪
敏感信息
学习进度（单词本已有）
没明确说过的推测
```

不做：

```text
LLM 语义合并
整理/合并 UI
应用退出时补提取
会话跨重启游标
```

### 7.5 注入

每次只拼一小块：

```text
【关于对方】
叫她 …
目标 …
喜欢 …
不喜欢 …

【最近】
上次提到 …

【相处】
已经聊过一段时间。
```

规则：

```text
记忆是背景资料，不是本轮聊天记录
不要复述成「你刚才说」
不要把 summary 当成用户原话
时间不确定就不提
```

预算：

```text
300–500 tokens
profile / relation 永远带
episodes 按关键词 + 新近度选 2–3 条
```

### 7.6 检索

```text
不做向量数据库
关键词 + 新近度
```

### 7.7 UI

设置页提供：

```text
查看
编辑
删除
清空
```

入口：

```text
设置 → 记忆
```

### 7.8 隐私

```text
只存本地
不主动上传记忆
用户可查看/删除
学习数据导出不包含 persona.json
需要备份时手动复制
```

---

## 8. Prompt 顺序

```text
1. persona.block()
2. 模式规则 modeRules(mode)
3. slang.promptBlock()（仅会話）
4. JSON 契约
5. 模式 system 补丁（如「本轮不出黄卡」）
6. persona-scenes 选中的例子
7. 最近历史
8. 当前用户输入
```

原则：

```text
每层短
层与层不重复
否定句尽量合并成正向规则
```

---

## 9. 文件职责

| 文件 | 负责 | 不负责 |
|---|---|---|
| `agent/persona.js` | 人格、语气、边界 | 请求、解析、记忆 |
| `agent/persona-scenes.js` | 行为示例 | 检索、状态 |
| `agent/prompt.js` | 组合 system、模式规则、契约 | 历史、网络请求 |
| `agent/llm.js` | 请求、解析、历史切片 | 人格文案 |
| `agent/memory.js` | 读取、合并、裁剪记忆 | prompt 文案 |
| `agent/memory-extract.js` | 提取 patch | 直接写文件 |
| `main/ipc.js` | 历史存储、IPC | 人格策略 |
| `agent/targets.js` | 学过的词注入 | 记忆 |

---

## 10. 实施阶段

### 阶段 1：文字人格（已完成）

```text
persona.js
persona-scenes.js
prompt 组合器
llm 去掉固定 few-shot / 重复 no-card
casual() 用同一套人格
```

### 阶段 2：主动开口（未实现）

```text
空闲计时
冷却
不打断规则
小范围开关
```

### 阶段 3：轻量记忆（已完成）

```text
persona.json
读取/注入
设置页查看/编辑/删除
每 6 轮异步提取
10 分钟空闲补提取
自动去重 / 合并 tags / 上限淘汰
```

不做：

```text
LLM 语义合并
整理/合并 UI
```

### 阶段 4：表情联动（未实现）

需要先确定：

```text
模型有哪些表情/动作
哪些是情绪，哪些是道具
语义枚举
映射配置
播放策略
```

---

## 11. 评估

### 11.1 行为指标

```text
追问比例
平均句长 / 句长变化
重复句式比例
空洞夸奖比例
毒舌后是否收住
主动开口频率
```

### 11.2 场景检查

```text
A. 对方说累 → 是否先接情绪，不硬追问
B. 对方嘴硬 → 是否接梗但不攻击
C. 对方低落 → 是否停止毒舌
D. 对方只回一句 → 是否只接一句
E. 对方做对 → 是否具体夸
F. 主动开口 → 是否具体、不查户口
```

### 11.3 回归

```text
会話 few-shot 不带 corrections
teach 模式仍是中文讲解
JSON 解析仍兼容
历史仍只存 brief
记忆不进入聊天历史
```

---

## 12. 待定问题

```text
1. 毒舌强度默认几级？
2. 熟悉度是否影响毒舌？
3. 主动开口是否默认开启？
4. 记忆是否跨设备同步？（默认否）
5. 用户能否单独关闭记忆提取？
6. 是否需要「安静模式」？
```
