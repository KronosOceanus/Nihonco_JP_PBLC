# 私有仓库 → 公开仓库同步规则

公开仓库：`KronosOceanus/Nihonco_JP_PBLC`

## 同步时不要覆盖的公开差异

这些文件在公开仓库中是**lite-only 版本**，同步私有代码时要保留公开版本：

```text
package.json
README.md
docs/ASSETS.md
docs/DEV.md
docs/INSTALL.md
docs/README.md
docs/windows/ACCEPTANCE.md
docs/windows/WINDOWS.md
```

公开版本与私有的固定差异：

```text
仅提供 lite 构建
删除所有 build:app:full* / build:win:full* 脚本
README / INSTALL / DEV / ASSETS / WINDOWS / ACCEPTANCE 不写 full 命令
clone 地址为 Nihonco_JP_PBLC
cd 目录为 Nihonco_JP_PBLC
```

## 推荐同步流程

```bash
# 1. 私有仓库确认干净并测试
cd ~/Documents/Nihonco_JP
git status
npm test
npm run scan

# 2. 备份公开的 lite-only 文件
cd ~/Documents/Nihonco_JP_PBLC
mkdir -p /tmp/public-policy
cp package.json README.md /tmp/public-policy/
# 以及上面列出的 docs 文件

# 3. 私有 HEAD 导出到公开，保留 .git
cd ~/Documents/Nihonco_JP
git archive HEAD | tar -x -C ~/Documents/Nihonco_JP_PBLC

# 4. 恢复上面列出的公开 lite-only 文件
cp /tmp/public-policy/package.json ~/Documents/Nihonco_JP_PBLC/
# README/docs 同理

# 5. 公开 package.json 只保留 lite 脚本，版本号跟随私有
# 6. 公开 README 版本行改为当前私有版本
# 7. 提交、打 tag、推送
```

## 禁止

```text
不要把私有 package.json 的 full 脚本带进公开
不要把 private clone 地址带进公开
不要把 tmp_*.md / .env / 学习数据带进公开
不要用整仓 rsync 覆盖公开的 lite-only 文档
```
