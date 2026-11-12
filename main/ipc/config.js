/* 设置项通道：配置 / API key / provider / 模型 / 开机自启 / 资源链接 */
module.exports = function registerConfigIpc({ settingsHandle, getWin, config, agent, refreshVoiceCache, loadPet,
  app, isPackaged, shell, dialog, voiceSvc, tts, asrSvc, ensureTtsEngine, restartAsr, platform, ROOT, ASSET_DIR, USER_DATA, WHISPER_MODELS_DIR, DATA_DIR,
}) {
  const fs = require('fs');
  const path = require('path');
  const { validateEnginePath } = require('../../agent/tts-engines');
  const ttsConfig = require('../../agent/tts-config');
  const assetInstall = require('../../agent/asset-install');
  const ASSET_BASE = assetInstall.assetBase({ root: ROOT, assetsDir: ASSET_DIR });
  const changed = (next) => { try { getWin()?.webContents.send('cfg:changed', next); } catch (_) {} };

  const enginePath = (id) => (voiceSvc.enginePath ? voiceSvc.enginePath(id) : "");


  settingsHandle('cfg:get', (e) => {
    return config.get();
  });

  settingsHandle('cfg:set', (e, patch) => {
    const before = config.get().voice;
    const next = config.patch(patch || {});
    agent.setLevel(next.level);                                  // 让后端 CONF 同步
    if (JSON.stringify(before) !== JSON.stringify(next.voice)) refreshVoiceCache();
    changed(next);
    return next;
  });

  settingsHandle('cfg:set-key', (e, key) => {
    const res = config.setApiKey(key);
    agent.applyApiKey(String(key || '').trim());          // 运行中的会话立刻用新 key
    const next = config.get();
    changed(next);
    console.log('[cfg] API key 已更新', res.keyMasked || '（已清空）');
    return next;
  });

  settingsHandle('cfg:set-provider', (e, payload) => {
    const r = config.setProvider(payload || {});
    if (!r.ok) throw new Error(r.error || '切换失败');
    agent.applyProvider({ model: r.model, baseUrl: r.baseUrl });   // 热更新，不重启
    const next = config.get();
    changed(next);
    console.log('[cfg] 模型已切换:', r.model, '@', r.baseUrl);
    return next;
  });

  settingsHandle('cfg:test-llm', async (e) => {
    try {
      return await agent.testConnection();          // 真发一次请求，不再只看"有没有配 key"
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  settingsHandle('cfg:models', (e) => {
    const models = require('../../agent/models');
    const active = models.activePath();
    return { ok: true, active, list: models.list(), fits: models.fits(), fit: models.fitOf(active) };
  });

  settingsHandle('cfg:set-model', async (e, { path: modelPath, fit } = {}) => {
    const models = require('../../agent/models');
    const known = models.list().some((m) => m.path === modelPath);
    if (!known) return { ok: false, error: '没有这个模型' };

    const f = models.setFit(modelPath, fit || {});
    config.setEnvValue('LIVE2D_MODEL', modelPath);

    if (getWin()) await loadPet(getWin());          // 用新模型重新加载挂件页
    return { ok: true, active: modelPath, fit: f };
  });

  /* ---------------- 打开目录（只接受白名单，不让渲染层传路径） ---------------- */
  settingsHandle('cfg:open-path', async (e, id) => {
    const assets = require('../../agent/assets');
    let dir = '';
    if (id === 'assets') dir = ASSET_BASE;
    else if (id === 'data') dir = DATA_DIR;
    else if (id === 'whisper') dir = WHISPER_MODELS_DIR || process.env.NIHONCO_WHISPER_MODELS || path.join(ROOT, '.whisper', 'models');
    else if (id === 'core') {
      const p = assets.find('lib/live2dcubismcore.min.js');
      dir = p ? path.dirname(p) : '';
    } else if (id === 'model') {
      const models = require('../../agent/models');
      const active = models.activePath();
      const p = path.isAbsolute(active) ? active : assets.find(active);
      dir = p ? path.dirname(p) : '';
    } else if (id === 'voicevox') {
      const p = enginePath('voicevox');
      dir = p ? path.dirname(p) : '';
    } else if (id === 'aivis') {
      const p = enginePath('aivis');
      dir = p ? path.dirname(p) : '';
    }
    else return { ok: false, error: 'unknown path' };
    if (!dir) return { ok: false, error: '未找到目录' };
    if (id === 'assets' || id === 'data' || id === 'whisper') {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
    }
    if (!fs.existsSync(dir)) return { ok: false, error: '目录不存在', path: dir };
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err, path: dir } : { ok: true, path: dir };
  });

  /* ---------------- 应用信息 ---------------- */

  settingsHandle('cfg:get-autostart', (e) => {
    if (!isPackaged) return { ok: true, available: false, enabled: false };
    try { return { ok: true, available: true, enabled: !!app.getLoginItemSettings().openAtLogin }; }
    catch (err) { return { ok: false, available: false, enabled: false, error: err.message }; }
  });

  settingsHandle('cfg:set-autostart', (e, on) => {
    if (!isPackaged) {
      return { ok: false, available: false, enabled: false, error: '开发模式下不支持（打包后才有效）' };
    }
    const enabled = !!on;
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
      return { ok: true, enabled: !!app.getLoginItemSettings().openAtLogin };
    } catch (err) {
      return { ok: false, enabled: false, error: err.message };
    }
  });

  /* ---------------- 资源（模型 / Core / VOICEVOX） ---------------- */

  const LINKS = {
    model: 'https://www.live2d.com/en/learn/sample/',
    core: 'https://www.live2d.com/en/sdk/download/web/',
    voicevox: 'https://voicevox.hiroshiba.jp/',
    aivis: 'https://aivis-project.com/speech/',
    'whisper-cuda-12.4': 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip',
    'whisper-cuda-11.8': 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-11.8.0-x64.zip',
    'whisper-cpu': 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
    'whisper-model': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
  };

  settingsHandle('cfg:tts-engine', () => ({ ok: true, engine: tts.engineName() }));

  settingsHandle('cfg:tts-engine-status', async () => ({ ok: true, engines: await voiceSvc.engineStatus() }));

  settingsHandle('cfg:pick-engine-path', async (e, engine) => {
    const target = ["voicevox", "aivis"].includes(String(engine || "").toLowerCase())
      ? String(engine).toLowerCase() : tts.engineName();
    const key = ttsConfig.pathEnv(target);
    const r = await dialog.showOpenDialog(getWin(), {
      title: `选择 ${target === "aivis" ? "AivisSpeech" : "VOICEVOX"} 引擎可执行文件`,
      properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    const picked = r.filePaths[0];
    const check = validateEnginePath(target, picked);
    if (!check.ok) return { ok: false, error: check.error };
    config.setEnvValue(key, check.path);
    // 只有改的是当前正在使用的引擎，才停掉自己启动的进程；不自动切换下拉
    if (target === tts.engineName()) {
      try { voiceSvc.stopEngine(target); } catch (err) {}
    }
    return { ok: true, engine: target, path: check.path };
  });

  settingsHandle('cfg:set-tts-engine', async (e, engine) => {
    const want = String(engine || "").toLowerCase();
    if (!["voicevox", "aivis"].includes(want)) throw new Error("未知的语音引擎");
    const switched = await voiceSvc.switchEngine(want);
    const def = ttsConfig.engine(want);
    config.setEnvValue("TTS_ENGINE", want);
    if (want === "voicevox") config.setEnvValue(def.urlEnv, def.defaultUrl);
    config.setEnvValue(def.nameEnv, ttsConfig.name(want));
    tts.setName(ttsConfig.name(want));
    refreshVoiceCache();
    return { ok: true, engine: want, path: switched.path || "" };
  });

  settingsHandle('cfg:bert-status', () => {
    const fs = require('fs');
    const path = require('path');
    const home = app.getPath('home');
    const base = platform.IS_WIN
      ? path.join(app.getPath('appData'), 'AivisSpeech-Engine', 'BertModelCaches')
      : path.join(home, 'Library', 'Application Support', 'AivisSpeech-Engine', 'BertModelCaches');
    const dir = path.join(base, 'models--tsukumijima--deberta-v2-large-japanese-char-wwm-onnx');
    let bytes = 0, latest = 0, files = 0;
    const walk = (d) => {
      let list = [];
      try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const ent of list) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) { walk(p); continue; }
        try {
          const st = fs.statSync(p);
          bytes += st.size;
          files++;
          latest = Math.max(latest, st.mtimeMs || 0);
        } catch (e) {}
      }
    };
    walk(dir);
    return { ok: true, dir, bytes, files, latest };
  });

  settingsHandle('cfg:cancel-tts-switch', () => {
    return { ok: voiceSvc.cancelSwitch ? voiceSvc.cancelSwitch() : false };
  });

  settingsHandle('cfg:preview-asset', (e, { kind, src } = {}) => {
    return assetInstall.preview({ kind, src, root: ROOT, assetsDir: ASSET_DIR, userData: USER_DATA, whisperModelsDir: WHISPER_MODELS_DIR, app });
  });

  settingsHandle('cfg:install-asset', async (e, { kind, src } = {}) => {
    const wasRunning = kind === 'tts' && !!voiceSvc.getEngineProc();
    if (kind === 'tts') voiceSvc.stopEngine();
    let r;
    try {
      r = assetInstall.install({ kind, src, root: ROOT, assetsDir: ASSET_DIR, userData: USER_DATA, whisperModelsDir: WHISPER_MODELS_DIR, app });
    } finally {
      if (wasRunning) voiceSvc.startTtsEngine();
    }

    // 安装后自检：只测当前正在使用的引擎，避免把别的引擎误报成失败
    if (kind === 'tts') {
      const current = tts.engineName();
      if (current === r.kind) {
        try {
          voiceSvc.startTtsEngine();
          if (!(await voiceSvc.ensureTtsEngine())) throw new Error('引擎没有就绪');
          const list = await tts.listSpeakers();
          r.health = { ok: true, ready: true, speakers: (list.speakers || []).length };
        } catch (err) {
          r.health = { ok: false, error: err?.message || "TTS 引擎没有就绪" };
        }
      } else {
        r.health = { ok: true, ready: true, skipped: `当前引擎是 ${current}` };
      }
    } else if (kind === 'asr') {
      try {
        await asrSvc.restartAsr();
        const p = await asrSvc.probeAsr({ timeoutMs: 30000 });
        const loading = p.status === "loading" || p.status === "starting";
        r.health = {
          ok: !!p.ok || loading,
          ready: !!p.ok,
          status: p.status || "",
          error: p.ok || loading ? undefined : (p.lastError || p.reason || p.status || "ASR 未就绪"),
          warning: loading ? "ASR 已安装，识别服务正在加载" : undefined,
        };
      } catch (err) {
        r.health = { ok: false, error: err?.message || "ASR 重启失败" };
      }
    } else if (kind === 'model') {
      // 必须传窗口：不传会让 loadPet 里 undefined.loadURL 抛成 unhandledRejection
      try {
        const ok = await loadPet(getWin());
        r.health = ok ? { ok: true, ready: true } : { ok: true, ready: true, warning: '窗口未就绪，模型将在下次启动生效' };
      } catch (err) { r.health = { ok: false, error: err?.message || "模型重载失败" }; }
    }
    if (r.health && !r.health.ok) {
      const rb = assetInstall.rollback(r);
      if (kind === 'tts') {
        voiceSvc.stopEngine();
        if (wasRunning) voiceSvc.startTtsEngine();
      } else if (kind === 'asr') {
        try { await asrSvc.restartAsr(); } catch (e) {}
      } else if (kind === 'model') {
        try { await loadPet(getWin()); } catch (e) {}
      }
      return {
        ...r,
        ok: false,
        error: '安装后自检失败：' + r.health.error + (rb.ok ? '（已回滚旧资源）' : '（回滚失败）'),
        rolledBack: !!rb.ok,
      };
    }
    return r;
  });

  settingsHandle('cfg:ollama-models', async () => {
    const providers = require('../../agent/providers');
    return { ok: true, models: await providers.ollamaModels((require('../../agent/llm').CONF || {}).ollama) };
  });

  settingsHandle('cfg:asset-status', (e) => {
    const has = (p) => { try { return fs.existsSync(p); } catch (err) { return false; } };
    const models = require('../../agent/models');
    const assets = require('../../agent/assets');
    const active = models.activePath();
    const modelPath = path.isAbsolute(active) ? active : assets.find(active);
    const corePath = assets.find('lib/live2dcubismcore.min.js')
      || path.join(ROOT, 'lib', 'live2dcubismcore.min.js');
    const whisperDir = WHISPER_MODELS_DIR || process.env.NIHONCO_WHISPER_MODELS || path.join(ROOT, '.whisper', 'models');
    const whisperHome = process.env.WHISPER_HOME || path.join(ROOT, '.whisper');
    const whisperModels = has(whisperDir)
      ? fs.readdirSync(whisperDir).filter((f) => f.endsWith('.bin'))
      : [];
    return {
      ok: true,
      model: !!modelPath && has(modelPath),
      modelRel: active,
      core: has(corePath),
      whisper: has(whisperHome),
      asr: has(whisperHome) && whisperModels.length > 0,
      voicevox: has(enginePath('voicevox')),
      aivis: !!enginePath('aivis'),
      engine: tts.engineName(),
      paths: { model: modelPath || path.join(ROOT, active), core: corePath, voicevox: enginePath('voicevox'), aivis: enginePath('aivis'), asr: has(whisperDir) ? whisperDir : '' },
      dirs: {
        assets: ASSET_BASE,
        data: DATA_DIR,
        whisper: has(whisperDir) ? whisperDir : '',
        voicevox: enginePath('voicevox') ? path.dirname(enginePath('voicevox')) : '',
        aivis: enginePath('aivis') ? path.dirname(enginePath('aivis')) : '',
      },
    };
  });

  settingsHandle('cfg:open-resource', async (e, id) => {
    const url = LINKS[id];
    if (!url) return { ok: false, error: 'unknown resource' };
    await shell.openExternal(url);
    return { ok: true };
  });
};
