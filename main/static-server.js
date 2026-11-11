/* 本地静态服务：只服务渲染层需要的文件
 *
 * 白名单 + Host 校验 + 路径逃逸检查 + 最终路径必须落在 root 内。
 * 依赖注入 root / userData / isPackaged，方便测试（以后可加 tests）。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".wav": "audio/wav",
  ".moc3": "application/octet-stream",
};

/* 静态文件白名单：渲染层只需要这几个资源，其余一律 404
 * （防止 /.env、data/*.json、.voice/rec-*.wav 被 HTTP 读到） */
const ALLOW_EXACT = new Set(["/", "/index.html", "/pet.html", "/pet.js", "/settings.html", "/settings.js", "/settings-core.js", "/settings-assets.js", "/settings-shortcuts.js", "/settings-data.js", "/settings-memory.js", "/settings-tts.js", "/settings-asr.js", "/settings-llm.js", "/settings-live2d.js", "/settings-maintenance.js", "/ui.css", "/favicon.ico"]);
const ALLOW_PREFIX = [
  "/.voice/cache/",
  "/lib/",
  "/renderer/",
  "/model/",
  "/node_modules/pixi.js/",
  "/node_modules/pixi-live2d-display-lipsyncpatch/",
  "/node_modules/@pixi/",
];
const ALLOW_FILE = new Set(["/.voice/say.wav"]);   // 只放行 TTS 输出，录音永不出网

function isAllowed(urlPath) {
  if (ALLOW_EXACT.has(urlPath)) return true;
  if (ALLOW_FILE.has(urlPath)) return true;
  return ALLOW_PREFIX.some((p) => urlPath.startsWith(p));
}

module.exports = function createStaticServer({ root, userData, assetsDir, isPackaged, log = () => {} }) {
  let instance = null;
  const inside = (base, p) => {
    const b = path.resolve(base), f = path.resolve(p);
    return f === b || f.startsWith(b + path.sep);
  };
  const assetFile = (norm) => {
    if (!assetsDir) return null;
    if (!(norm.startsWith('/model/') || norm === '/lib/live2dcubismcore.min.js')) return null;
    const p = path.join(assetsDir, norm);
    return inside(assetsDir, p) ? p : null;
  };
  function startServer() {
    return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // 1) 只接受本机 Host（挡 DNS rebinding：恶意页面把域名解析到 127.0.0.1）
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') {
        res.writeHead(403, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' }).end('forbidden');
        return;
      }

      const deny = () => res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' }).end('not found');

      let rel;
      try {
        rel = decodeURIComponent(req.url.split('?')[0]);
      } catch (e) {
        res.writeHead(400).end('bad request');
        return;
      }
      if (!rel.startsWith('/')) { deny(); return; }
      if (rel === '/') rel = '/pet.html';

      // 2) 只拒绝真正的逃逸标记：含 `..` 段 / 反斜杠 / 空字节
      //    （./ 和 // 是无害的写法，交给 normalize 消化，不再误伤）
      if (/(^|\/)\.\.(\/|$)/.test(rel) || rel.includes('\\') || rel.includes('\0')) {
        deny();
        return;
      }

      // 3) 归一化后再比对白名单（/model/./x 这类等价路径可以放行）
      const norm = path.posix.normalize(rel);

      if (!isAllowed(norm)) { deny(); return; }

      // 4) 兜底：最终路径必须落在项目根目录内
      //    （打包后 .voice/ 挪到了 userData，改从那里读 TTS 产物）
      const base = (isPackaged && norm.startsWith('/.voice/')) ? userData : root;
      let file = path.join(base, norm);
      if (!inside(base, file)) { deny(); return; }
      // lite 包：model / Cubism Core 可放在 NIHONCO_ASSETS（默认 userData/assets）
      if (!fs.existsSync(file)) {
        const alt = assetFile(norm);
        if (alt && fs.existsSync(alt)) file = alt;
      }

      fs.readFile(file, (err, buf) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' }).end('not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(buf);
      });
    });
    instance = server;
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port;
      if (process.env.PET_DEBUG) log('[server] http://127.0.0.1:' + p);
      resolve(p);
    });
  });
}
  const close = () => new Promise((resolve) => {
    if (!instance) return resolve();
    const s = instance;
    instance = null;
    s.close(() => resolve());
  });
  return { startServer, isAllowed, close };
};
