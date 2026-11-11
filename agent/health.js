/* 启动自检的判定（纯函数，方便单测）
 *
 * 核心原则：只有「确定起不来」才算失败；「还在启动」永远不报。
 *   · ASR：端口通了但 ready:false = 模型还在加载（首次还要下载），属于 starting
 *   · TTS：只看当前引擎是否就绪；没有 say 回落
 */

/** 语音合成：返回 { usable, reason }。reason 用于日志/渲染层选提示文案 */
function ttsVerdict({ hasEngine, engine }) {
  if (engine) return { usable: true, reason: "engine" };
  return { usable: false, reason: hasEngine ? "engine-timeout" : "no-engine" };
}

/** 语音识别：返回 { status: "ready"|"loading"|"starting"|"failed", reason? }
 *  processAlive：mlx 子进程还活着 / whisper-server 子进程还活着
 *  reachable：/health 能连上（能连上但 ready:false → loading）
 *  spawnError：spawn 失败或进程异常退出的原因
 */
function asrVerdict({ reachable, ready, processAlive, spawnError, waitedMs, timeoutMs }) {
  if (reachable && ready) return { status: "ready" };
  if (spawnError) return { status: "failed", reason: "spawn" };
  if (reachable && !ready) {
    // 端口通了但模型没就绪：进程还活着 = 加载中；进程没了 = 起不来
    return processAlive ? { status: "loading" } : { status: "failed", reason: "child-exit" };
  }
  if (!processAlive) return { status: "failed", reason: "exited" };
  if (waitedMs >= timeoutMs) return { status: "failed", reason: "timeout" };
  return { status: "starting" };
}

module.exports = { ttsVerdict, asrVerdict };
