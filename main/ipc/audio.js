/* 语音链路通道（设置窗口）：声线列表/切换/试听 + ASR 后端/模型/GPU/日志 */
module.exports = function registerAudioIpc({ settingsHandle, getWin, tts, config, refreshVoiceCache, ensureTtsEngine, speakToWav,
  app, asrBackends, restartAsr, stopAsr, asrGpu, asrLog,
}) {
  const path = require('path');
  const ttsConfig = require('../../agent/tts-config');

  /* ---------------- 声音 ---------------- */

  settingsHandle('cfg:voices', async (e) => {
    try {
      if (!(await ensureTtsEngine())) throw new Error('引擎启动失败');
      return { ok: true, ...(await tts.listSpeakers()) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  settingsHandle('cfg:set-voice', (e, name) => {
    const picked = tts.setName(name);
    config.setEnvValue(ttsConfig.engine(tts.engineName()).nameEnv, picked);
    refreshVoiceCache();
    return { ok: true, current: picked };
  });

  settingsHandle('cfg:preview-voice', async (e, text) => {
    await speakToWav(String(text || 'こんにちは').slice(0, 60));
    try { getWin()?.webContents.send('cfg:preview-ready'); } catch (_) {}
    return true;
  });

  /* ---------------- ASR ---------------- */

  settingsHandle('cfg:asr-options', (e) => {
    return asrBackends.info();
  });

  settingsHandle('cfg:set-asr', async (e, { backend, model } = {}) => {
    const before = asrBackends.info();
    const wantBackend = String(backend || before.backend).toLowerCase();
    const wantModel = String(model || before.model || "").trim();
    if (!['mlx', 'whispercpp'].includes(wantBackend)) throw new Error('未知的识别后端');
    if (before.isWin && wantBackend !== 'whispercpp') throw new Error('Windows 只能用 whisper.cpp');
    if (!wantModel) throw new Error('模型不能为空');
    config.setEnvValue('ASR_BACKEND', wantBackend);
    config.setEnvValue('ASR_MODEL', wantModel);
    await restartAsr();
    return { ok: true, ...asrBackends.info() };
  });

  /* GPU 加速版 whisper.cpp（Windows）
   * 下载 → 解压 → 只拷必需文件 → 写 active.json → 重启识别服务。 */
  let asrInstallCtrl = null;
  const asrDirOf = () => process.env.NIHONCO_ASR_DIR || path.join(app.getPath('userData'), 'asr');

  settingsHandle('cfg:asr-engine', (e) => {
    return asrGpu.status(asrDirOf());
  });

  settingsHandle('cfg:asr-engine-install', async (e, id) => {
    if (asrInstallCtrl) throw new Error('已经在下载了');
    const asrDir = asrDirOf();
    const gpu = asrGpu.detectGpu();
    const target = String(id || asrGpu.recommend(gpu) || '');
    if (!target) throw new Error('没有检测到可用的 NVIDIA 显卡，或驱动太旧');
    const ctrl = { abort: new AbortController() };
    asrInstallCtrl = ctrl;
    const send = (p) => { try { e.sender.send('cfg:asr-engine-progress', p); } catch (err) {} };
    let stopped = false;
    try {
      const r = await asrGpu.install(asrDir, target, {
        onProgress: send,
        signal: ctrl.abort.signal,
        beforeCommit: async () => {
          if (asrGpu.readActive(asrDir) !== target) return;
          send({ phase: 'cancel' });
          stopAsr();
          stopped = true;
          await new Promise((r2) => setTimeout(r2, 600));
        },
      });
      await restartAsr();
      send({ phase: 'installed', id: r.id, active: asrGpu.readActive(asrDir) });
      return { ok: true, ...asrGpu.status(asrDir) };
    } catch (err) {
      if (stopped) { try { await restartAsr(); } catch (err2) {} }
      const cancelled = !!(err && (err.cancelled || err.name === 'AbortError')) || ctrl.abort.signal.aborted;
      if (cancelled) {
        send({ phase: 'cancelled' });
        return { ok: false, cancelled: true, error: '已取消', ...asrGpu.status(asrDir) };
      }
      send({ phase: 'error', msg: err.message });
      return { ok: false, error: err.message, ...asrGpu.status(asrDir) };
    } finally {
      if (asrInstallCtrl === ctrl) asrInstallCtrl = null;
    }
  });

  settingsHandle('cfg:asr-engine-cancel', (e) => {
    if (asrInstallCtrl) { try { asrInstallCtrl.abort.abort(); } catch (err) {} }
    return { ok: true };
  });

  settingsHandle('cfg:asr-engine-remove', async (e, id) => {
    const asrDir = asrDirOf();
    const target = String(id || 'cuda-12.4');
    if (asrGpu.readActive(asrDir) === target) {
      asrGpu.writeActive(asrDir, 'cpu');
      await restartAsr();
      await new Promise((r) => setTimeout(r, 800));
    }
    try {
      const r = asrGpu.remove(asrDir, target);
      await restartAsr();
      return { ok: true, ...r, ...asrGpu.status(asrDir) };
    } catch (err) {
      return { ok: false, error: err.message, ...asrGpu.status(asrDir) };
    }
  });

  settingsHandle('cfg:asr-engine-switch', async (e, id) => {
    const asrDir = asrDirOf();
    const target = String(id || 'cpu');
    if (target !== 'cpu' && !asrGpu.installed(asrDir, target)) throw new Error(`${target} 还没装好`);
    asrGpu.writeActive(asrDir, target);
    await restartAsr();
    return { ok: true, ...asrGpu.status(asrDir) };
  });

  settingsHandle('cfg:asr-log', (e, on) => {
    const next = on ? '1' : '0';
    config.setEnvValue('ASR_LOG', next);
    process.env.ASR_LOG = next;
    console.log('[asr] 日志' + (on ? '开启' : '关闭'), '->', asrLog.FILE);
    return { ok: true, enabled: asrLog.enabled(), file: asrLog.FILE };
  });
};
