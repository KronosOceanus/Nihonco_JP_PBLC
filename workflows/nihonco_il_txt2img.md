# Nihonco · IL 文生图工作流

文件：

```
workflows/nihonco_il_txt2img.json
```

适用：RunningHub 的 ComfyUI，底模用 Illustrious / IL 系列。

## 1. 导入

1. 打开 RunningHub → ComfyUI
2. 顶栏「工作流」→「导入」
3. 选 `nihonco_il_txt2img.json`
4. 在 `CheckpointLoaderSimple` 里选你的 IL 底模
   - 默认写的是 `Illustrious-XL-v0.1.safetensors`
   - 实际文件名不同就在下拉框里换

## 2. 节点结构

```
CheckpointLoaderSimple
  ├─ MODEL → KSampler
  ├─ CLIP  → 正面 CLIPTextEncode
  ├─ CLIP  → 负面 CLIPTextEncode
  └─ VAE   → VAEDecode

正面 CLIPTextEncode ─┐
负面 CLIPTextEncode ─┼→ KSampler → VAEDecode → SaveImage
EmptyLatentImage ────┘
```

## 3. 角色正向提示词

```text
masterpiece, best quality, very aesthetic, absurdres, highres,
1girl, solo, 24 years old, mature female, japanese teacher,
medium-long dark brown hair, side part, wavy hair,
warm amber eyes, straight eyebrows, closed mouth, gentle smile,
confident expression, upright posture, looking at viewer,
cream shirt, navy cropped blazer, loose navy necktie, navy trousers,
small square enamel hairpin on left side of hair, navy and cream hairpin,
classroom, window, sunlight, soft shadows, upper body, depth of field
```

## 4. 负向提示词

```text
lowres, worst quality, low quality, normal quality,
bad anatomy, bad hands, missing fingers, extra digit, fewer digits,
cropped, jpeg artifacts, watermark, signature, username, text, error, blurry,
multiple views, character sheet, 2girls, nsfw, child, loli,
glasses, cat ears, animal ears, bell, choker, frills, military uniform
```

## 5. 参数

```text
分辨率：832 × 1216
步数：30
CFG：6
Sampler：euler_ancestral
Scheduler：normal
Seed：1234567890（固定）
Batch：1
```

跑出第一张后：

```
先固定 seed 看角色一致性
满意后再 randomize 换姿势
```

## 6. 角色设定对应

| 设定 | Prompt |
|---|---|
| 24 岁 | `24 years old, mature female` |
| 日语老师 | `japanese teacher` |
| 中长发 | `medium-long dark brown hair, side part, wavy hair` |
| 暖红眼 | `warm amber eyes` |
| 内敛 | `closed mouth, gentle smile` |
| 自信/正义 | `confident expression, upright posture, neat collar` |
| 阳光 | `sunlight, soft shadows` |
| 毒舌 | 第一版不写进默认表情，靠后续表情差分 |
| 藏青米白 | `cream shirt, navy cropped blazer, navy trousers` |
| logo 发夹 | `small square enamel hairpin, navy and cream` |
| 无猫元素 | 负向写 `cat ears, animal ears, bell, choker` |

## 7. 重要限制：logo 文字

IL 对“具体字母 logo”的文字生成不稳定。  
建议：

```
先生成没有字母的藏青/米白小方形发夹
再用 Photoshop / Figma 把 NH mark 贴上去
```

不要期望模型一次画出正确的 N+H。  
提示词里只要求：

```
small square enamel hairpin, navy and cream
```

## 8. 建议的出图顺序

### 第一轮：确认脸和气质

```
upper body, looking at viewer, gentle smile
```

只改 seed，不改 prompt，选一张最像的。

### 第二轮：确认服装

```
upper body, cream shirt, navy cropped blazer, loose necktie
```

### 第三轮：确认半身

```
cowboy shot, standing, classroom
```

### 第四轮：表情差分

在同一个 seed 下改：

```text
closed mouth, gentle smile
one eyebrow raised, slight smirk
half-closed eyes, teasing expression
focused expression, teaching
```

## 9. 如果要角色三视图

用另一套 prompt，不要和主图混：

```text
character sheet, multiple views, front view, side view, back view,
same character, 24 years old, japanese teacher,
medium-long dark brown hair, warm amber eyes,
cream shirt, navy cropped blazer, loose navy necktie,
full body, white background, reference sheet
```

负向里去掉 `multiple views, character sheet`，否则会互相打架。

## 10. 常见问题

### 脸太幼

加强：

```
mature female, adult, 24 years old
```

负向：

```
child, loli, young
```

### 太像制服/教导主任

减弱：

```
military uniform, strict
```

加强：

```
casual teacher, loose necktie, relaxed posture
```

### 发夹消失

把发夹放到更靠前：

```
hairpin on left side of hair, visible hairpin
```

仍然消失就后期贴图。

### 手崩

这是半身图，先裁掉手：

```
upper body, hands not visible
```

或者后期用局部重绘。
