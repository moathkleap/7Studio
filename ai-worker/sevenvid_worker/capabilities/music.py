"""Local music generation (MusicGen via transformers). Honest: unavailable unless the backend and a model are present."""
from __future__ import annotations

import os
import wave
from typing import Any

from ..rpc import WorkerError


def probe() -> dict[str, Any]:
    try:
        import torch  # noqa: F401
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"torch not installed: {e}", "requires_gpu": True}
    try:
        import transformers  # noqa: F401
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"transformers not installed: {e}", "requires_gpu": True}
    try:
        import torch

        gpu = torch.cuda.is_available() or bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception:  # noqa: BLE001
        gpu = False
    return {"available": True, "reason": None if gpu else "no GPU: music generation will be slow on CPU", "requires_gpu": True, "gpu": gpu}


def _write_wav(path: str, samples, sample_rate: int) -> float:
    import numpy as np

    audio = np.asarray(samples, dtype="float32").reshape(-1)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    pcm = (audio * 32767.0).astype("<i2")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return len(pcm) / sample_rate * 1000.0


def generate(params: dict, ctx) -> dict[str, Any]:
    prompt = str(params.get("prompt", "")).strip()
    out_path = params["out_path"]
    duration_ms = int(params.get("duration_ms", 15000))
    model_path = params.get("model_path")  # local dir managed by the model manager (downloaded via the gateway)
    model_id = params.get("model_id") or "musicgen/small"
    if not prompt:
        raise WorkerError("INVALID_INPUT", "prompt is empty")
    # Only load from the locally managed model directory; never let transformers reach the network.
    if not model_path or not os.path.isdir(model_path):
        raise WorkerError("MODEL_NOT_INSTALLED", "music model is not installed", {"model": model_id})
    try:
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
    except Exception as e:  # noqa: BLE001
        raise WorkerError("PROVIDER_UNAVAILABLE", f"music generation backend missing: {e}")

    try:
        processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
        model = MusicgenForConditionalGeneration.from_pretrained(model_path, local_files_only=True)
    except Exception as e:  # noqa: BLE001
        raise WorkerError("MODEL_NOT_INSTALLED", f"could not load music model from {model_path}: {e}", {"model": model_id})

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    sample_rate = int(model.config.audio_encoder.sampling_rate)
    # MusicGen produces ~50 tokens/sec; cap tokens to the requested duration.
    max_new_tokens = max(64, int(duration_ms / 1000 * 50))
    inputs = processor(text=[prompt], padding=True, return_tensors="pt").to(device)
    with torch.no_grad():
        audio = model.generate(**inputs, do_sample=True, max_new_tokens=max_new_tokens)
    samples = audio[0, 0].cpu().numpy()
    actual_ms = _write_wav(out_path, samples, sample_rate)
    if not os.path.exists(out_path) or os.path.getsize(out_path) < 100:
        raise WorkerError("PROVIDER_FAILED", "music generation produced no audio")
    return {"out_path": out_path, "duration_ms": actual_ms, "sample_rate": sample_rate, "model_id": model_id}


METHODS = {"music.generate": generate}
