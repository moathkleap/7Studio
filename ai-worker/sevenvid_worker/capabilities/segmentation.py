"""Person/background segmentation with MediaPipe Selfie Segmenter (single foreground confidence mask)."""
from __future__ import annotations

import os
from typing import Any

import numpy as np

from ..rpc import WorkerError
from ._media import read_frame_at

_segmenters: dict[str, Any] = {}


def probe() -> dict[str, Any]:
    try:
        from mediapipe.tasks.python import vision  # noqa: F401

        return {"available": True, "reason": None, "requires": ["mediapipe/selfie-segmenter"]}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"mediapipe missing: {e}"}


def _segmenter(model_path: str):
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    seg = _segmenters.get(model_path)
    if seg is None:
        if not os.path.exists(model_path):
            raise WorkerError("MODEL_NOT_INSTALLED", f"segmenter model not found at {model_path}", {"model": "mediapipe/selfie-segmenter"})
        options = vision.ImageSegmenterOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.IMAGE,
            output_confidence_masks=True,
            output_category_mask=False,
        )
        seg = vision.ImageSegmenter.create_from_options(options)
        _segmenters[model_path] = seg
    return seg


def _read(path: str, t_ms) -> "np.ndarray":
    import cv2

    if t_ms is not None:
        frame, _ = read_frame_at(path, float(t_ms))
        return frame
    if not os.path.exists(path):
        raise WorkerError("FILE_NOT_FOUND", f"file not found: {path}")
    img = cv2.imread(path)
    if img is None:
        raise WorkerError("MEDIA_UNSUPPORTED", f"could not read image {path}")
    return img


def segment_image(params: dict, ctx) -> dict[str, Any]:
    """Runs the segmenter on one image/frame and returns the foreground coverage, optionally writing a mask PNG."""
    import cv2
    import mediapipe as mp

    frame = _read(params["path"], params.get("t_ms"))
    h, w = frame.shape[:2]
    seg = _segmenter(params["model_path"])
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    masks = result.confidence_masks
    if not masks:
        raise WorkerError("WORKER_FAILED", "segmenter returned no mask")
    prob = np.asarray(masks[0].numpy_view(), dtype=np.float32)  # foreground probability, 0..1
    threshold = float(params.get("threshold", 0.5))
    coverage = float((prob >= threshold).mean())
    out_path = params.get("out_path")
    if out_path:
        alpha = (np.clip(prob, 0.0, 1.0) * 255.0).astype(np.uint8)
        cv2.imwrite(out_path, alpha)
    return {"width": w, "height": h, "coverage": coverage, "mask_path": out_path}


METHODS = {"segment.image": segment_image}
