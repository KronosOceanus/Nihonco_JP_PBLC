#!/bin/bash
# 从 node_modules/electron 生成可双击的 Nihonco.app
# 用法：npm run build:app
set -e
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
APP="Nihonco.app"
ELECTRON_APP="node_modules/electron/dist/Electron.app"

if [ ! -d "$ELECTRON_APP" ]; then
  echo "找不到 $ELECTRON_APP，请先 npm install"
  exit 1
fi

echo "== 清理旧包"
rm -rf "$APP"

echo "== 克隆 Electron（APFS 上几乎不占额外空间）"
cp -cR "$ELECTRON_APP" "$APP" 2>/dev/null || cp -R "$ELECTRON_APP" "$APP"

echo "== 写 Info.plist"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Nihonco</string>
  <key>CFBundleDisplayName</key><string>Nihonco</string>
  <key>CFBundleIdentifier</key><string>local.nihonco.pet</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Electron</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>用于日语语音对话</string>
</dict>
</plist>
PLIST

echo "== 写启动入口"
mkdir -p "$APP/Contents/Resources/app"
cp assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
rm -f "$APP/Contents/Resources/default_app.asar"
cat > "$APP/Contents/Resources/app/bootstrap.js" <<'BOOT'
// 从 App 包位置反推项目根目录，搬到任何地方都能用
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
require(path.join(ROOT, "main.js"));
BOOT
cat > "$APP/Contents/Resources/app/package.json" <<'PKG'
{ "name": "nihonco-pet", "version": "1.0.0", "main": "bootstrap.js" }
PKG

echo "== 去隔离属性 + ad-hoc 签名"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --force --deep -s - "$APP" 2>/dev/null || echo "（签名失败，可忽略；首次打开需右键→打开）"

echo
echo "完成：$ROOT/$APP"
