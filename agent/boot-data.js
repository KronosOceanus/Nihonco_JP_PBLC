/* 打包后的数据目录准备（可测的纯逻辑，不依赖 electron）
 *
 * 打包后 app.asar 是只读的，数据必须落在可写目录：
 *   1) 把包内的「共享数据表」seed 到 <userData>/data
 *   2) 校验 jlpt.json 是否存在；缺了就回退到项目 data/，并给出警告
 *
 * 只 seed 白名单文件：个人进度（wordbook / settings / vocab-daily…）即使误打进包，
 * 也不会被复制到用户目录。
 */
const fs = require("fs");
const path = require("path");

/** 共享数据表：这些才允许随包分发、也才允许 seed */
const SHARED_DATA = /^(jlpt|word-levels|kanji-stems|pattern-gloss-zh|patterns-n[1-5]|jmdict-readings|enrich-cache\.seed)\.json$/;

/**
 * @param {{packaged:boolean, userData:string, root:string, resourcesPath:string,
 *          dataDirEnv?:string, log?:(msg:string)=>void}} opts
 * @returns {{dir:string|null, seeded:number, fallback:boolean, warning?:string}}
 */
function prepareDataDir(opts) {
  const { packaged, userData, root, resourcesPath } = opts;
  const log = opts.log || (() => {});

  // 显式指定就不用管了（自检/冒烟/开发）
  if (!packaged || opts.dataDirEnv) {
    return { dir: null, seeded: 0, fallback: false };
  }

  const dataDir = path.join(userData, "data");
  const seed = path.join(resourcesPath, "app.asar.unpacked", "data");
  let seeded = 0;

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const f of fs.readdirSync(seed)) {
      if (!SHARED_DATA.test(f)) continue;
      const dst = path.join(dataDir, f);
      if (!fs.existsSync(dst)) { fs.copyFileSync(path.join(seed, f), dst); seeded += 1; }
    }
  } catch (e) {
    log(`[boot] 初始化数据目录失败: ${e.message}`);
  }

  // 自检：没有 jlpt.json 说明包里的数据没解出来（asar 配置变了 / 手搓包）。
  // 这时指向空目录会"能开但没词可学"，所以退回项目 data/。
  if (!fs.existsSync(path.join(dataDir, "jlpt.json"))) {
    const fallback = path.join(root, "data");
    const ok = fs.existsSync(path.join(fallback, "jlpt.json"));
    const warning = `打包数据缺失（缺 jlpt.json），回退到 ${fallback}`
      + (ok ? "" : "（这个目录也没有，功能会不可用）");
    log(`[boot] ${warning}`);
    return { dir: fallback, seeded, fallback: true, warning };
  }

  return { dir: dataDir, seeded, fallback: false };
}

module.exports = { prepareDataDir, SHARED_DATA };
