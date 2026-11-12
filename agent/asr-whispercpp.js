/* Windows 本地语音识别服务：whisper.cpp
 *
 * 替代 macOS 的 asr.py（mlx-whisper，仅 Apple Silicon）。
 * 对外契约与 asr.py 完全一致（见 docs/WINDOWS-HANDOVER.md §5.1）：
 *   GET  /health → {ok, model, ready}
 *   POST /asr?lang=ja&prompt=...  请求体是 WAV 字节 → {text, ms, lang, dur}
 *
 * 为什么不用 Python：Windows 上装 Python + ctranslate2 对"双击就能用"的
 * 桌面挂件太重；whisper.cpp 是静态链接的 exe，塞进 .whisper/ 即可。
 *
 * 结构：本模块在 Electron 主进程里监听 127.0.0.1:8765，
 * 内层 spawn whisper-server.exe（模型常驻内存，避免每句重新加载）。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { loadEnv } = require('./env');
const ENV = loadEnv();     // .env 里的 ASR_* 也要生效（和其他 agent 模块保持一致）

const EXE_NAME = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
const PORT = Number(ENV.ASR_PORT || 8765);        // 对外端口（渲染层/主进程都知道这个）
const WPORT = Number(ENV.WHISPER_PORT || 8766);   // whisper-server 内部端口
const LANG_DEFAULT = ENV.ASR_LANG || 'ja';

let child = null;
let ready = false;
let server = null;
let starting = null;      // Promise：避免并发重复 spawn
let modelPath = null;
let lastErr = '';
let onSpawn = null;

function log(...a) { console.log('[asr]', ...a); }

/* ------------------ 后端：GPU 版优先，CPU 永远兜底 ------------------
 * 目录约定（主进程用 NIHONCO_ASR_DIR 指过来，通常是 <userData>/asr）：
 *   asr/active.json            {"backend":"cuda-12.4"}  ← 记住上次能用的
 *   asr/cuda-12.4/whisper-server.exe + *.dll            ← 用户下的 GPU 版
 *   asr/cuda-11.8/...
 * CPU 版固定在内置位置（打包后 app.asar.unpacked/.whisper，开发期 ROOT/.whisper），
 * 模型也只在内置位置放一份，GPU 版共用它（省 181MB 重复）。
 */
const ASR_DIR = process.env.NIHONCO_ASR_DIR || '';
const GPU_BACKEND_IDS = ['cuda-12.4', 'cuda-11.8'];

/** 内置（CPU）后端目录 */
function baseHome() {
  let home = process.env.WHISPER_HOME || path.join(ROOT, '.whisper');
  // 打包后 exe 不能从 asar 里 spawn：electron-builder 会把它解到 app.asar.unpacked。
  // 注意 main.js 已经直接给的是 ...\app.asar.unpacked\.whisper，别再替换一次
  //（否则会变成 app.asar.unpacked.unpacked，找不到 exe）。
  if (home.includes('app.asar') && !home.includes('app.asar.unpacked')) {
    home = home.replace('app.asar', 'app.asar.unpacked');
  }
  return home;
}

let current = null;   // { id, home, exe }

function detectBackends() {
  const base = baseHome();
  const list = [];
  if (ASR_DIR) {
    for (const id of GPU_BACKEND_IDS) {
      const home = path.join(ASR_DIR, id);
      const exe = path.join(home, EXE_NAME);
      try { if (fs.existsSync(exe)) list.push({ id, home, exe }); } catch (e) {}
    }
  }
  list.push({ id: 'cpu', home: base, exe: path.join(base, EXE_NAME) });
  return list;
}

function readActiveBackend() {
  const envWant = String(process.env.NIHONCO_ASR_BACKEND || '').trim().toLowerCase();
  if (envWant) return envWant;
  try {
    return String(JSON.parse(fs.readFileSync(path.join(ASR_DIR, 'active.json'), 'utf8')).backend || '').toLowerCase();
  } catch (e) { return ''; }
}

function writeActiveBackend(id) {
  if (!ASR_DIR) return;
  try {
    fs.mkdirSync(ASR_DIR, { recursive: true });
    fs.writeFileSync(path.join(ASR_DIR, 'active.json'),
      JSON.stringify({ backend: id, at: new Date().toISOString() }, null, 2));
  } catch (e) {}
}

/** 选后端：显式/记住的优先（exe 必须存在）→ 任一 GPU 版 → CPU */
function selectBackend(forceId) {
  const list = detectBackends();
  const want = String(forceId || readActiveBackend() || '').toLowerCase();
  current = list.find((b) => b.id.toLowerCase() === want)
         || list.find((b) => b.id !== 'cpu')
         || list[0];
  return current;
}

// 不缓存：测试会反复改 WHISPER_HOME / NIHONCO_ASR_DIR，缓存会让它读到上一轮的目录
function backend() { return selectBackend(); }
function whisperHome() { return backend().home; }
function findExe() {
  const b = backend();
  return fs.existsSync(b.exe) ? b.exe : null;
}

/** 找模型：ASR_MODEL_FILE 优先，其次 ASR_MODEL（small/medium/ggml-small.bin 都行）
 *  注意：.env 里默认写的是 mac 的 HF 仓库名（mlx-community/whisper-small-mlx），
 *  带 "/" 的一律忽略，回落到 ggml-small.bin。 */
/** 实际会加载的模型名（findModel 的解析结果，用于 /health 回报 fallback） */
function resolvedModelName() {
  const m = modelPath || findModel();
  return m ? path.basename(m) : null;
}

/** 最近一次模型解析的结果：{ file, want, fallback, reason }
 *  fallback=true 表示「没找到 ASR_MODEL 指定的那个，用了别的」——日志和 /health 都会报出来 */
let lastResolve = { file: null, want: null, fallback: false, reason: '' };

/** 当前想要的模型名：process.env 优先（设置窗口改完会同步），其次 .env 快照 */
function wantModel() {
  // process.env 优先（设置窗口会同步）；显式设为空串 = 没配置 → 让 findModel 挑最小的
  const raw = process.env.ASR_MODEL !== undefined ? process.env.ASR_MODEL : (ENV.ASR_MODEL || '');
  return String(raw).trim();
}

function findModel() {
  if (ENV.ASR_MODEL_FILE) {
    const ok = fs.existsSync(ENV.ASR_MODEL_FILE);
    lastResolve = {
      file: ok ? ENV.ASR_MODEL_FILE : null,
      want: ENV.ASR_MODEL_FILE,
      fallback: false,
      reason: ok ? '' : 'ASR_MODEL_FILE 指向的文件不存在',
    };
    return lastResolve.file;
  }
  // 用户可写模型目录优先，其次当前后端 / 内置目录；GPU 版共用
  const dirs = [];
  const addDir = (d) => { if (d && !dirs.includes(path.resolve(d))) dirs.push(path.resolve(d)); };
  addDir(process.env.NIHONCO_WHISPER_MODELS);
  addDir(path.join(whisperHome(), 'models'));
  addDir(path.join(baseHome(), 'models'));
  const dir = dirs[0];
  const findBin = (name) => dirs.map((d) => path.join(d, name)).find((p) => fs.existsSync(p)) || null;
  const listBins = () => {
    const seen = new Map();
    for (const d of dirs) {
      try {
        for (const f of fs.readdirSync(d)) {
          if (!f.endsWith('.bin')) continue;
          const p = path.join(d, f);
          if (!seen.has(f)) seen.set(f, { f, p, n: fs.statSync(p).size });
        }
      } catch (e) {}
    }
    return [...seen.values()].sort((a, b) => a.n - b.n);
  };
  let raw = wantModel();
  // HF 仓库名（带 /）在 whisper.cpp 下没有意义 → 当没配置处理，下面会挑最小的 .bin
  if (raw.includes('/')) raw = '';
  if (!raw) {
    // 没配置 → 用体积最小的那个（默认最省事：小模型快、体积小）
    const bins = listBins();
    if (bins.length) {
      lastResolve = { file: bins[0].p, want: '(未设置)', fallback: false,
                      reason: `未设置 ASR_MODEL，用最小的 ${bins[0].f}` };
      return bins[0].p;
    }
    lastResolve = { file: null, want: '(未设置)', fallback: false, reason: 'models 目录里没有任何 .bin' };
    return null;
  }
  const want = raw;
  const tries = [];
  if (/\.bin$/i.test(want)) tries.push(want);
  else { tries.push(`ggml-${want}.bin`, `${want}.bin`); }
  for (const t of tries) {
    const p = path.isAbsolute(t) ? t : findBin(t);
    if (p) {
      lastResolve = { file: p, want: raw, fallback: false, reason: '' };
      return p;
    }
  }
  // 兜底：目录里任意一个 .bin —— 显式记下原因，别让人以为设的模型生效了
  const any = listBins()[0];
  if (any) {
    lastResolve = {
      file: any.p, want: raw, fallback: true,
      reason: `找不到 ${tries.join(' / ')}（ASR_MODEL=${raw}），回落到 ${any.f}`,
    };
    return any.p;
  }
  lastResolve = { file: null, want: raw, fallback: false, reason: 'models 目录里没有任何 .bin' };
  return null;
}

function spawnWhisper() {
  const exe = findExe();
  const model = findModel();
  if (!exe) { lastErr = `找不到 ${EXE_NAME}（${whisperHome()}）`; log(lastErr); return; }
  if (!model) { lastErr = `找不到模型（${process.env.NIHONCO_WHISPER_MODELS || path.join(whisperHome(), 'models')}）`; log(lastErr); return; }

  modelPath = model;
  const threads = String(Math.max(2, Math.min(8, require('os').cpus().length - 2)));
  const args = ['-m', model, '--host', '127.0.0.1', '--port', String(WPORT),
                '-t', threads, '-l', LANG_DEFAULT === 'auto' ? 'auto' : LANG_DEFAULT,
                '-nt', '-sow'];
  if (lastResolve.fallback) {
    log('⚠ ' + lastResolve.reason);
  } else if (lastResolve.reason) {
    log(lastResolve.reason);
  }
  log('模型', path.basename(model), lastResolve.fallback ? '（已回落，不是 ASR_MODEL 指定的那个）' : '');
  log(`后端 ${backend().id}（${backend().home}）`);
  log('spawn', exe, args.slice(0, 6).join(' '), '...');
  // spawn 在 Windows 上可能同步抛（exe 被损坏/被杀软隔离/不是合法 PE），
  // 必须包起来：否则 waitReady 直接 reject，回落逻辑就走不到了
  try {
    child = spawn(exe, args, { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    if (onSpawn) { try { onSpawn(child); } catch (e) {} }
  } catch (e) {
    lastErr = `spawn 失败：${e.message}`;
    log(lastErr);
    child = null;
    ready = false;
    return;
  }
  lastErr = '';
  child.stdout.on('data', (d) => log(String(d).trimEnd().split('\n').pop()));
  child.stderr.on('data', (d) => {
    const s = String(d);
    // whisper-server 把推理进度写到 stderr，只保留最后一行，避免刷屏
    if (!/load_backend|whisper_print_timings|^$/.test(s.trim())) lastErr = s.trim().split('\n').pop();
  });
  child.on('exit', (code) => { log('whisper-server 退出', code); child = null; ready = false; });
  child.on('error', (e) => { log('spawn error', e.message); lastErr = e.message; child = null; ready = false; });
}

function killChild() {
  if (!child) return;
  const pid = child.pid;
  try { child.kill(); } catch (e) {}
  try {
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
  } catch (e) {}
  child = null;
  ready = false;
}

/** GPU 后端起不来就回落 CPU：驱动被换/显卡被独占/远程桌面都能自愈 */
async function fallbackToCpu(why) {
  const from = backend().id;
  log(`⚠ ${why} → ${from} 后端不可用，回落到 CPU（只慢，不会没功能）`);
  killChild();
  writeActiveBackend('cpu');
  selectBackend('cpu');
  return waitReady(45000, false);
}

/** 轮询 whisper-server 的内部 /health，直到就绪或超时 */
async function waitReady(timeoutMs = 60000, allowFallback = true) {
  if (ready) return true;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!child) spawnWhisper();
    if (!child) {
      if (allowFallback && backend().id !== 'cpu') return fallbackToCpu(`spawn 失败（${lastErr || '未知'}）`);
      return false;
    }
    try {
      const r = await fetch(`http://127.0.0.1:${WPORT}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) { ready = true; log(`就绪 backend=${backend().id} model=${path.basename(modelPath || '')} ${Date.now() - t0}ms`); return true; }
    } catch (e) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  log('等待就绪超时');
  if (allowFallback && backend().id !== 'cpu') return fallbackToCpu('等待就绪超时');
  return false;
}

function ensureStarted() {
  if (!starting) {
    starting = waitReady().finally(() => { starting = null; });
  }
  return starting;
}

/** 组 multipart/form-data（不引第三方库） */
function multipart(fields, file) {
  const boundary = '----nihonco' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
    `Content-Type: ${file.type}\r\n\r\n`));
  chunks.push(file.buf);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

/** 从 WAV 头算时长（秒），与 asr.py 的口径一致 */
function wavDuration(buf) {
  if (buf.length <= 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  try {
    const rate = buf.readUInt32LE(24) || 16000;
    const ch = buf.readUInt16LE(22) || 1;
    const bits = buf.readUInt16LE(34) || 16;
    return Math.round(((buf.length - 44) / (rate * ch * bits / 8)) * 100) / 100;
  } catch (e) { return null; }
}

/** 一次 /inference 请求；temperatureInc 决定要不要走「温度阶梯重试」 */
async function infer(wavBuf, { language, prompt, temperature, temperatureInc }) {
  const { boundary, body } = multipart(
    {
      language,
      prompt: prompt || '',
      response_format: 'json',
      temperature: String(temperature),
      temperature_inc: String(temperatureInc),
      no_timestamps: 'true',
    },
    { name: 'audio.wav', type: 'audio/wav', buf: wavBuf },
  );
  const r = await fetch(`http://127.0.0.1:${WPORT}/inference`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.length) },
    body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`whisper HTTP ${r.status}: ${text.slice(0, 200)}`);
  let j = {};
  try { j = JSON.parse(text); } catch (e) { j = { text }; }
  return String(j.text || '').trim();
}

/** 复读幻觉：同一小段连刷 4 次以上（"いいいい" / "哈哈哈哈哈"） */
function looksLikeLoop(t) {
  return /(.{1,6})\1{3,}/u.test(String(t || ''));
}

async function transcribe(wavBuf, { lang, prompt } = {}) {
  if (!(await waitReady())) {
    throw new Error(lastErr || 'whisper 未就绪');
  }
  const language = (lang && lang !== 'none') ? lang : LANG_DEFAULT;

  // 性能关键：temperature_inc=0 关掉 whisper.cpp 的「温度阶梯重试」。
  // 默认 0.2 时，一句完全正常的话只要压缩率/熵踩线，就会在 0 / 0.2 / 0.4… 上各解码一遍
  //（实测 5.65s 音频多花 400–700ms，识别结果一字不差）。
  // 那几个阈值是按英文调的，日语/中文短句很容易误触。
  const t0 = Date.now();
  let text = await infer(wavBuf, { language, prompt, temperature: 0, temperatureInc: 0 });

  // 只在「真的可疑」时补一次：空结果 或 复读幻觉
  if (!text || looksLikeLoop(text)) {
    const t1 = Date.now();
    log(`结果可疑（${text ? '复读' : '空'}），用 0.4 温度重试一次`);
    try {
      const retry = await infer(wavBuf, { language, prompt, temperature: 0.4, temperatureInc: 0 });
      if (retry && !looksLikeLoop(retry)) text = retry;
    } catch (e) { log('重试失败：', e.message); }
    log(`重试耗时 ${Date.now() - t1}ms`);
  }

  return { text: String(text || '').trim(), detected: language, elapsedMs: Date.now() - t0 };
}

/* ------------------------------ HTTP 服务 ------------------------------ */

function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length });
  res.end(b);
}

function handle(req, res) {
  if (req.method === 'GET' && req.url.startsWith('/health')) {
    // 与 mac 的 asr.py 对齐：ok 表示"服务在"，ready 表示"模型好了"
    const name = resolvedModelName();
    const want = wantModel();
    const wantName = /\//.test(want) ? 'small' : want.replace(/\.bin$/i, '').replace(/^ggml-/, '');
    return json(res, 200, {
      ok: true,
      engine: 'whisper.cpp',
      backend: backend().id,
      backendHome: backend().home,
      model: name,
      requested: want || '(未设置)',
      fallback: !!name && !name.includes(wantName),
      // 显式回落标记：ASR_MODEL 指定的文件没找到、用了目录里别的 .bin
      modelFallback: !!lastResolve.fallback,
      modelNote: lastResolve.reason || undefined,
      modelFile: name,
      ready,
      error: ready ? undefined : lastErr || 'starting',
    });
  }

  if (req.method === 'POST' && req.url.startsWith('/asr')) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const lang = url.searchParams.get('lang') || LANG_DEFAULT;
    const prompt = (url.searchParams.get('prompt') || '').slice(0, 200) || undefined;

    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('error', (e) => json(res, 400, { error: e.message }));
    req.on('end', async () => {
      const wav = Buffer.concat(chunks);
      if (!wav.length) return json(res, 400, { error: '空请求体' });
      const t0 = Date.now();
      try {
        const { text, detected } = await transcribe(wav, { lang, prompt });
        const ms = Date.now() - t0;
        log(`${wav.length}B -> ${JSON.stringify(text)} (${ms}ms)` + (prompt ? ` prompt=${prompt.length}字` : ''));
        return json(res, 200, { text, ms, lang: detected, dur: wavDuration(wav) });
      } catch (e) {
        log('识别失败:', e.message);
        return json(res, 500, { error: e.message });
      }
    });
    return;
  }

  json(res, 404, { error: 'not found' });
}

/** 启动：监听 8765 + 拉起 whisper-server（异步，不阻塞 app 启动） */
function start() {
  if (server) return Promise.resolve(PORT);
  return new Promise((resolve, reject) => {
    server = http.createServer(handle);
    server.on('error', (e) => {
      log('监听失败', e.message);
      server = null;
      reject(e);
    });
    server.listen(PORT, '127.0.0.1', () => {
      log(`监听 http://127.0.0.1:${PORT}`);
      ensureStarted();          // 后台预热，失败只记录不抛
      resolve(PORT);
    });
  });
}

function stop() {
  try { server && server.close(); } catch (e) {}
  server = null;
  ready = false;
  if (child) {
    try {
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    } catch (e) {}
    child = null;
  }
}

/** 最近一次模型解析结果（给 /health 与自检用） */
function resolveInfo() {
  return {
    ...lastResolve,
    file: lastResolve.file ? path.basename(lastResolve.file) : null,
  };
}

/** 启动自检用：子进程是否在跑、模型是否就绪、最后一次错误 */
function status() {
  return { running: !!child && child.exitCode === null, ready, lastErr, model: resolvedModelName() };
}

module.exports = { start, stop, transcribe, wavDuration, findExe, findModel, resolveInfo, status, PORT,
  setSpawnHook(fn) { onSpawn = fn; } };
