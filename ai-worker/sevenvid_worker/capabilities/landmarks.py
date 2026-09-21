"""Face landmarks (up to 478 points per face) with MediaPipe Face Landmarker, for precise face masks."""
from __future__ import annotations

import os
from typing import Any

from ..rpc import WorkerError
from ._media import read_frame_at

_landmarkers: dict[str, Any] = {}


def probe() -> dict[str, Any]:
    try:
        from mediapipe.tasks.python import vision  # noqa: F401

        return {"available": True, "reason": None, "requires": ["mediapipe/face-landmarker"]}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"mediapipe missing: {e}"}


def _landmarker(model_path: str, num_faces: int):
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    key = f"{model_path}:{num_faces}"
    lm = _landmarkers.get(key)
    if lm is None:
        if not os.path.exists(model_path):
            raise WorkerError("MODEL_NOT_INSTALLED", f"face landmarker not found at {model_path}", {"model": "mediapipe/face-landmarker"})
        options = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=num_faces,
        )
        lm = vision.FaceLandmarker.create_from_options(options)
        _landmarkers[key] = lm
    return lm


def _read(path: str, t_ms):
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


def detect_image(params: dict, ctx) -> dict[str, Any]:
    """Detects face landmarks in one image/frame. Returns per-face normalized points and a tight bounding box."""
    import cv2
    import mediapipe as mp

    frame = _read(params["path"], params.get("t_ms"))
    h, w = frame.shape[:2]
    lm = _landmarker(params["model_path"], int(params.get("num_faces", 5)))
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    include_points = bool(params.get("include_points", True))
    faces: list[dict[str, Any]] = []
    for face in result.face_landmarks:
        xs = [p.x for p in face]
        ys = [p.y for p in face]
        x0, x1 = max(0.0, min(xs)), min(1.0, max(xs))
        y0, y1 = max(0.0, min(ys)), min(1.0, max(ys))
        entry: dict[str, Any] = {"count": len(face), "box": {"x": x0, "y": y0, "w": max(0.0, x1 - x0), "h": max(0.0, y1 - y0)}}
        if include_points:
            entry["points"] = [[round(float(p.x), 5), round(float(p.y), 5)] for p in face]
        faces.append(entry)
    return {"faces": faces, "width": w, "height": h}


METHODS = {"landmarks.detectImage": detect_image}
