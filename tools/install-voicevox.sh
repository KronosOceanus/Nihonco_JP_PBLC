#!/bin/bash
# 解包 VOICEVOX 并定位引擎
# 用法：./tools/install-voicevox.sh [zip路径]
#   默认：.voicevox/vv-cpu.zip
# 做完只解包 + 报告，不会改动应用代码。

set -e
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
VV="$ROOT/.voicevox"
ZIP="${1:-$VV/vv-cpu.zip}"

if [ ! -f "$ZIP" ]; then
  echo "找不到文件：$ZIP"
  echo "把下载好的 voicevox-macos-cpu-arm64-0.26.1.zip 放进 $VV/ 再跑本脚本"
  exit 1
fi

SIZE=$(stat -f%z "$ZIP")
EXPECT=2041836212
echo "文件：$ZIP"
echo "大小：$SIZE 字节（预期 $EXPECT）"
if [ "$SIZE" -ne "$EXPECT" ]; then
  echo "⚠️  大小不一致，可能没下完或被改动"
fi

mkdir -p "$VV/extracted"
echo "解包中（约 5GB，可能需要一两分钟）…"
ditto -x -k "$ZIP" "$VV/extracted" 2>/dev/null || unzip -q -o "$ZIP" -d "$VV/extracted"
echo "解包完成"

echo
echo "=== 找引擎（可执行文件）"
find "$VV/extracted" -type f \( -name "run" -o -name "voicevox_engine*" -o -name "*.vvm" \) 2>/dev/null | head -20

echo
echo "=== 顶层结构"
find "$VV/extracted" -maxdepth 3 -type d | head -15

echo
echo "下一步：把上面的路径告诉助手，由它接入 main.js（自动拉起/退出清理）"
