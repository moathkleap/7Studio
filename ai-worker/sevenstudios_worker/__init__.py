"""Seven Studios local AI worker."""

import os

# ONNX Runtime's official wheels embed Microsoft's 1DS telemetry client and upload trace events as soon as
# the library is imported. This worker must never contact the network on its own, so the documented opt-out
# is set here, before any capability module can import onnxruntime.
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")

__version__ = "0.1.0"
