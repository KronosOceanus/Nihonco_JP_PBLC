#!/usr/bin/env python3
"""本地语音识别服务（mlx-whisper）

提供两个接口（只监听 127.0.0.1）：
  GET  /health            → {"ok":true,"model":...}
  POST /asr               → 请求体是 wav 音频（audio/wav），返回 {"text": "...", "ms": N}
     可选 ?lang=zh（默认 zh）

设计取舍：
  - 不引 fastapi/uvicorn，只用标准库，启动快、依赖少
  - 模型常驻内存（第一次加载慢，之后每句话 0.3~1s）
  - 失败时返回明确错误，前端好提示
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
from urllib.parse import parse_qs, urlparse

# 模型可选：
#   mlx-community/whisper-small-mlx           ~460MB  快，中文够用（推荐起步）
#   mlx-community/whisper-large-v3-turbo      ~1.5GB  更准更快，网络好时首选
def _load_env() -> None:
    """读项目根 .env（不引第三方库），让 ASR_LANG 等配置和 agent 共用一份"""
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, ".env")
    if not os.path.isfile(path):
        return
    try:
        for line in open(path, encoding="utf-8"):
            m = __import__("re").match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
            if m and not os.environ.get(m.group(1)):
                os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    except OSError:
        pass


_load_env()

MODEL = os.environ.get("ASR_MODEL", "mlx-community/whisper-small-mlx")
# 模型拉不下来时按顺序回退，避免一个 repo 名写错就整块不可用
MODEL_FALLBACKS = [
    MODEL,
    "mlx-community/whisper-large-v3-turbo",
    "mlx-community/whisper-large-v3-mlx",
    "mlx-community/whisper-small-mlx",
]
# 默认锁定日语：练习场景不需要猜语言（中文问题请打字）
LANG = os.environ.get("ASR_LANG", "ja")
PORT = int(os.environ.get("ASR_PORT", "8765"))

_model_ready = False

KANA_RE = __import__("re").compile(r"[\u3040-\u309f\u30a0-\u30ff]")
JA_PROMPT = "日本語の会話です。"

def has_kana(t: str) -> bool:
    return bool(KANA_RE.search(t or ""))

def avg_lp(result) -> float:
    """whisper 的平均 logprob，用来在多假设之间比较（越接近 0 越好）"""
    segs = result.get("segments") or []
    if not segs:
        return -9.9
    return sum(s.get("avg_logprob", -9.9) for s in segs) / len(segs)
_lock = threading.Lock()   # mlx 模型不是线程安全的：串行化推理
_LOCK_WAIT = 15            # 等锁上限（秒）：要比客户端的 20s 短，先回 503「识别忙」


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


def _as_local_path(name: str):
    """ASR_MODEL 既可以是 HF 仓库名（org/name），也可以是本地目录。
    本地路径写法：绝对路径、~/x、./x、.hf-cache/models/x（相对项目根）。
    返回绝对路径；判断为 HF 仓库名时返回 None。"""
    if not name:
        return None
    p = os.path.expanduser(name)
    looks_like_path = p.startswith(("/", "~", "./", "../")) or p in (".", "..")
    if not looks_like_path:
        cand = os.path.join(ROOT_DIR, p)
        return os.path.abspath(cand) if os.path.isdir(cand) else None
    if not os.path.isabs(p):
        p = os.path.join(ROOT_DIR, p)
    return os.path.abspath(p)


def _resolved(name: str) -> str:
    """交给 mlx_whisper 的最终值：本地路径转绝对路径，仓库名原样返回"""
    return _as_local_path(name) or name


def _js_ready_models():
    """主进程传下来的 mlx 就绪列表（JS 的 mlxModelReady 是唯一判断源）。

    没设置这个环境变量 → None，表示 asr.py 被单独运行，退回本地扫描。
    """
    raw = os.environ.get("ASR_MLX_READY")
    if raw is None:
        return None
    try:
        v = json.loads(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except Exception:
        return []


def _weights_present(repo: str) -> bool:
    """只确认权重文件存在，不做“是否 ready”的业务判断"""
    local = _as_local_path(repo)
    if local and os.path.isdir(local):
        return any(os.path.exists(os.path.join(local, f))
                   for f in ("weights.npz", "weights.safetensors"))
    hf = os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface")
    snap = os.path.join(hf, "hub", "models--" + repo.replace("/", "--"), "snapshots")
    try:
        for d in os.listdir(snap):
            for f in ("weights.npz", "weights.safetensors"):
                if os.path.exists(os.path.join(snap, d, f)):
                    return True
    except OSError:
        pass
    return False


def _is_cached(repo: str) -> bool:
    """这个模型是否可用：本地目录（手动下的）或 HF 缓存里有权重都算"""
    if not repo:
        return False
    ready = _js_ready_models()
    if ready is not None:
        # 主进程已经判断过哪些模型 ready；这里只确认权重没被删
        return repo in ready and _weights_present(repo)
    return _weights_present(repo)


def _offline_if_cached() -> bool:
    """**任意**候选模型已缓存时强制离线。

    以前只检查 MODEL（turbo）：turbo 没下完但 small 在本地时，启动会去网上拉 turbo，
    服务端口迟迟不出现 → 界面显示「识别失败」。现在有可用的就离线，秒退到缓存的那个。
    """
    if any(_is_cached(m) for m in MODEL_FALLBACKS):
        os.environ["HF_HUB_OFFLINE"] = "1"
        return True
    return False


ACTIVE_MODEL = MODEL   # 实际加载成功的模型（可能来自回退列表）


def active_model() -> str:
    return ACTIVE_MODEL


def warmup() -> None:
    """预加载模型；MODEL 拉不下来就按回退列表逐个试。"""
    global _model_ready, ACTIVE_MODEL
    import mlx_whisper  # noqa: F401
    import numpy as np

    silent = np.zeros(8000, dtype=np.float32)
    # 先试本地已缓存的（离线模式下只有它们能成功），再按配的优先级
    cached = [m for m in MODEL_FALLBACKS if _is_cached(m)]
    order = cached + [m for m in MODEL_FALLBACKS if m not in cached]
    for name in order:
        try:
            mlx_whisper.transcribe(silent, path_or_hf_repo=_resolved(name), language=LANG, verbose=False)
            ACTIVE_MODEL = name
            _model_ready = True
            print(f"[asr] 模型就绪: {name}", flush=True)
            if name != MODEL:
                print(f"[asr] 注意：ASR_MODEL={MODEL} 加载失败，已回退到 {name}", flush=True)
            return
        except Exception as e:
            print(f"[asr] 模型 {name} 不可用: {e}", flush=True)
    print("[asr] 全部模型都加载失败（首句会更慢/不可用）", flush=True)


def _wav_to_array(data: bytes, target_sr: int = 16000):
    """把 WAV 字节解成 16k 单声道 float32，避免依赖 ffmpeg（Dock 启动时 PATH 里没有它）"""
    import io
    import wave
    import numpy as np
    with wave.open(io.BytesIO(data)) as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw != 2:
        raise ValueError(f"只支持 16bit PCM，收到 {sw * 8}bit")
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if sr != target_sr and len(x):
        n_out = int(round(len(x) * target_sr / sr))
        x = np.interp(np.linspace(0, len(x) - 1, n_out), np.arange(len(x)), x).astype(np.float32)
    return x


def _run(audio, language, prompt: str | None = None):
    import mlx_whisper
    kw = {
        "path_or_hf_repo": _resolved(active_model()),
        "language": language,
        "verbose": False,
        "temperature": 0,
        # 这三项专治「同一句无限复读」：静音/噪声输入时 whisper 的经典病症
        "condition_on_previous_text": False,
        "compression_ratio_threshold": 2.0,
        "no_speech_threshold": 0.5,
    }
    if prompt:
        kw["initial_prompt"] = prompt
    return mlx_whisper.transcribe(audio, **kw)


def transcribe(
    wav_bytes: bytes, lang: str, hotwords: str | None = None
) -> tuple[str, int, str, tuple[float, float] | None]:
    """识别一段 WAV，返回 4 元组 (text, ms, lang, lp_pair)。

    - text    : 识别文本（已 strip）
    - ms      : 耗时（毫秒）
    - lang    : 判定/指定的语言标签，可能带后缀如 "ja(置信度)"
    - lp_pair : (第一遍平均对数概率, 第二遍)；只跑一遍时两值相同，用于调试展示

    auto 模式做两遍：
      A. 不指定语言，让模型自己判
      B. 若 A 的结果里没有假名（很短的中文式输出），用 ja + 日文 initial_prompt 再跑一遍
    选优规则：有假名的优先 > 置信度更高的（ja 需领先 0.30 才推翻第一遍）
    """
    t0 = time.time()
    audio = None
    path = None
    try:
        audio = _wav_to_array(wav_bytes)
    except Exception as e:
        print(f"[asr] 内置解码失败({e})，退回落盘 + ffmpeg", flush=True)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes)
            path = f.name
    src = audio if audio is not None else path
    try:
        if lang not in ("auto", "", "none"):
            r = _run(src, lang, hotwords or JA_PROMPT)
            lp = avg_lp(r)                    # 只算一次（之前白算了两遍）
            return ((r.get("text") or "").strip(), int((time.time() - t0) * 1000),
                    str(r.get("language") or lang), (lp, lp))

        a = _run(src, None)
        ta = (a.get("text") or "").strip()
        la, lpa = str(a.get("language") or "auto"), avg_lp(a)

        # 已经是日语（含假名）就直接用
        if has_kana(ta) or la == "ja":
            return ta, int((time.time() - t0) * 1000), la, (lpa, lpa)

        # 否则补跑一次日语，专治超短句被判成中文
        b = _run(src, "ja", JA_PROMPT)
        tb = (b.get("text") or "").strip()
        lpb = avg_lp(b)

        # 标定自实测：日语短句 ja 领先 ~0.38，中文领先 ~0.11~0.49
        # → 只有 ja 明确领先 0.30 以上才推翻第一遍的结果，避免把中文硬拧成日语
        if lpb > lpa + 0.30:
            pick, lang_out = tb, "ja(置信度)"
        else:
            pick, lang_out = ta, la
        return pick, int((time.time() - t0) * 1000), lang_out, (lpa, lpb)
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json(200, {
                "ok": True,
                "engine": "mlx",
                "model": active_model(),      # 实际加载成功的
                "requested": MODEL,           # .env 里要的
                "fallback": active_model() != MODEL,
                "modelNote": (f"ASR_MODEL={MODEL} 没加载成功，已回退到 {active_model()}"
                              if active_model() != MODEL else None),
                "ready": _model_ready,
            })
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/asr"):
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return self._json(400, {"error": "空请求体"})
        data = self.rfile.read(n)
        if not _model_ready:
            return self._json(503, {"error": "识别模型还在加载，稍等几秒再试"})
        q = parse_qs(urlparse(self.path).query)
        lang = (q.get("lang") or [LANG])[0]
        hot = (q.get("prompt") or [""])[0].strip()[:200] or None   # 热词提示（当天练的词）
        if not _lock.acquire(timeout=_LOCK_WAIT):
            return self._json(503, {"error": "识别忙：上一个请求还没结束，稍后重试"})
        try:
            try:
                text, ms, detected, lp_pair = transcribe(data, lang, hot)
            finally:
                _lock.release()
            extra_hint = f" prompt={len(hot)}字" if hot else ""
            print(f"[asr] {len(data)}B -> {text!r} ({ms}ms){extra_hint}", flush=True)
            dur = None
            if data[:4] == b"RIFF" and len(data) > 44:
                try:
                    rate = int.from_bytes(data[24:28], "little") or 16000
                    ch = int.from_bytes(data[22:24], "little") or 1
                    bits = int.from_bytes(data[34:36], "little") or 16
                    dur = round((len(data) - 44) / (rate * ch * bits / 8), 2)
                except Exception:
                    pass
            extra = {}
            if lp_pair:                             # 置信度调试信息（可能为空）
                lp_a, lp_b = lp_pair
                extra = {"lp": [round(lp_a, 2), round(lp_b, 2)]}
            self._json(200, {"text": text, "ms": ms, "lang": detected, "dur": dur, **extra})
        except Exception as e:
            print(f"[asr] 失败: {e}", flush=True)
            self._json(500, {"error": str(e)})

    def log_message(self, *args):
        pass


def _warmup_bg() -> None:
    t0 = time.time()
    try:
        warmup()
    except Exception as e:
        print(f"[asr] 预热失败: {e}", flush=True)
    print(f"[asr] 预热耗时 {int((time.time() - t0) * 1000)}ms", flush=True)


def main() -> None:
    _offline_if_cached()
    # 先监听、再预热：模型没就绪时端口也已经在了，/health 立刻能答（ready:false），
    # 前端只会看到「启动中」，而不是「识别失败」。
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[asr] 监听 http://127.0.0.1:{PORT}", flush=True)
    threading.Thread(target=_warmup_bg, daemon=True, name="asr-warmup").start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
