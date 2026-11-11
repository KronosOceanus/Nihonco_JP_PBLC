# Nihonco NH mark

## 结构

- N：正向，粗笔画；100×100 字框内，竖笔 x=10–28 / 72–90
- H：细笔画，线中心 x=19 / 81，线宽 7，外框 15.5–84.5；y=18–82
- H 在 N 两竖笔内居中：左右各留 5.5，上下各留 8
- N 斜线：左上 → 右下

## 颜色

```
米白  #F3EBDD
藏青  #1F2A44
暖橙  #D98A5F
```

## 文件

```
nh-mark.svg                 透明底 mark
nh-app-icon-cream.svg/png   米白底应用图标 1024
nh-app-icon-navy.svg/png    藏青底应用图标 1024
nh-icon-64.png              64px
nh-icon-32.png              32px
nh-icon-16.png              16px（使用 small 变体）
nh-small-icon.svg/png       小尺寸 H 加粗版
nh-hairpin-product.svg/png  徽章发夹 mockup
nh-cover-760x1120.png       视频封面：桌宠框比例 760×1120，米白底 + NH mark
nh-cover-A-760x1120.svg/png 方案 A 文字型封面：标题 + 日语副标题 + 四个模式标签
```

## 小尺寸

- 64px：H 可见
- 32px：H 变弱，主要读成 N
- 16px：H 基本消失，只剩 N

16px 使用 `nh-small-icon`（H 加粗到 9）仍只能保住橙色暗示；完整 H 在 16px 下不可稳定辨认。

## 打包图标

```
assets/AppIcon.icns   macOS（build-app.sh / electron-builder）
assets/icon.ico       Windows（electron-builder）
```

生成规则：

```
16 / 32 用 nh-small-icon（H 加粗到 10）
64+     用 nh-app-icon-cream（H 为 7）
```
