# 数据文件与来源

本目录只放**随程序分发的静态数据**；学习进度、日志、缓存都在用户目录，不在仓库里。

| 文件 | 内容 | 来源 / 许可 |
|---|---|---|
| `jlpt.json` | JLPT 词表（原始 10,169 条，去重后 10,109 词） | 由 [`@polyglot-bundles/ja-jlpt-syllabi`](https://www.npmjs.com/package/@polyglot-bundles/ja-jlpt-syllabi)（MIT）生成，见 `tools/build-jlpt-data.mjs` |
| `word-levels.json` | 把合并的 N5–N4 拆成 N5 / N4 | 由 `jlpt.json` 生成（`tools/build-word-levels.mjs`） |
| `kanji-stems.json` | 汉字词干 → 假名（复现判分兜底） | 由 `jlpt.json` 生成（`tools/build-kanji-stems.mjs`） |
| `jmdict-readings.json` | JMdict 常用词紧凑读音表（约 1.7 万条） | 由 `tools/build-jmdict-readings.mjs` 从 jmdict-simplified 生成，EDRDG / CC BY-SA 4.0 |
| `patterns-n1…n5.json` | JLPT 句型（含中文翻译与例句读音） | [OpenJLPT](https://github.com/evanclan/OpenJLPT)，**CC BY-SA 4.0**；生成脚本 `tools/build-patterns.mjs` |
| `pattern-gloss-zh.json` | OpenJLPT 括号说明的英文 → 中文 | 本项目补充数据，随句型数据以 CC BY-SA 4.0 提供 |
| `enrich-cache.seed.json` | 示例句缓存（seed） | 由模型生成，仅作初始示例；不保证教学准确性 |

## 许可说明

- OpenJLPT 的句型数据按 **CC BY-SA 4.0** 使用；本仓库对它的修改（中文翻译、读音等）
  同样按 CC BY-SA 4.0 提供。该数据许可证**独立于**代码的 PolyForm Noncommercial 许可。
- 词表衍生数据（`word-levels` / `kanji-stems`）来自 MIT 许可的源数据。
- 如果要再分发本目录的数据，请保留本说明与来源链接。

## 不在这里的

```
wordbook.json / vocab-daily.json / patternbook.json / settings.json
logs/ / backup/ / usage.json / window.json / shortcuts.json
```

这些都在用户的 `data/`（打包版为 `%APPDATA%\Nihonco\data` 或
`~/Library/Application Support/Nihonco/data`），由程序生成，不进仓库。
