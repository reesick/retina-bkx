"""Self-test with randomly initialised weights (no training needed):

1. CnnWrap / VitWrap logits equal the plain model forward (explanation wrappers are faithful).
2. Export all five graphs to a temp dir, write dummy policy/ood/manifest, and run the real server
   pipeline end to end on an IDRiD image twice (checks shapes, timing and determinism).

    python -m ml.export.selftest
"""
from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import time
from pathlib import Path

import numpy as np
import torch

import ml.export.to_onnx as X
from ml.common import PROC


def main():
    torch.manual_seed(0)
    from ml.train.grader import build_model
    from ml.train.landmarks import LandmarkNet
    from ml.train.lesions import build_model as build_les
    from ml.train.quality import build_model as build_q

    cnn = build_model("cnn", pretrained=False).eval()
    vit = build_model("vit", pretrained=False).eval()
    with torch.no_grad():
        x = torch.randn(1, 3, 512, 512)
        d1 = (X.CnnWrap(cnn)(x)[0] - cnn(x)).abs().max().item()
        x = torch.randn(1, 3, 448, 448)
        d2 = (X.VitWrap(vit)(x)[0] - vit(x)).abs().max().item()
    print(f"[selftest] wrapper vs model: cnn {d1:.2e}  vit {d2:.2e}")
    assert d1 < 1e-4 and d2 < 1e-3, "explanation wrapper changes the logits"

    tmp = Path(tempfile.mkdtemp(prefix="rt_models_"))
    X.MODELS_OUT = tmp
    X.export("grader_cnn", X.CnnWrap(cnn), 512, ["logits", "features", "cam"])
    X.export("grader_vit", X.VitWrap(vit), 448, ["logits", "features", "attn"])
    X.export("lesions", X.SigWrap(build_les(pretrained=False)), 1024, ["probs"])
    X.export("landmarks", X.SigWrap(LandmarkNet(pretrained=False)), 512, ["heatmaps"])
    X.export("quality", build_q(pretrained=False), 384, ["logits"])
    man = json.loads((tmp / "manifest.json").read_text())
    man["lesions"]["thresholds"] = {"MA": 0.5, "HE": 0.5, "EX": 0.5, "SE": 0.5}
    (tmp / "manifest.json").write_text(json.dumps(man))
    (tmp / "policy.json").write_text(json.dumps({"version": "selftest", "temperatures": {"cnn": 1.0, "vit": 1.0}}))
    k = 64
    np.savez(tmp / "ood.npz", mean=np.zeros(1536, np.float32), components=np.eye(k, 1536, dtype=np.float32),
             mu=np.zeros(k, np.float32), prec=np.eye(k, dtype=np.float32))

    from server.app.pipeline import Pipeline

    pl = Pipeline(tmp)
    print("[selftest] health", pl.health()["ready"])
    img = sorted((PROC / "idrid" / "img").glob("*.jpg"))[0].read_bytes()
    steps = []
    t0 = time.perf_counter()
    out = pl.run(img, "OD", "macula", 50, lambda s, st, p, ms: steps.append((s, st)))
    t1 = time.perf_counter()
    out2 = pl.run(img, "OD", "macula", 50, lambda *a: None)
    keys = ["quality", "landmarks", "grading", "uncertainty", "lesions", "macular_risk", "triage"]
    h = [hashlib.sha256(json.dumps({k_: o[k_] for k_ in keys}, sort_keys=True).encode()).hexdigest() for o in (out, out2)]
    print("[selftest] steps", [s for s, st in steps if st == "done"])
    print("[selftest] timings", out["timings_ms"], f"total {1000 * (t1 - t0):.0f} ms")
    print("[selftest] triage", out["triage"]["outcome"], "quality", out["quality"]["category"],
          "lesion items", len(out["lesions"]["items"]), "overlays", sorted(out["overlays"]))
    print("[selftest] deterministic", h[0] == h[1])
    assert h[0] == h[1]
    json.dumps({k_: out[k_] for k_ in keys})  # JSON-serialisable
    shutil.rmtree(tmp, ignore_errors=True)
    print("[selftest] OK")


if __name__ == "__main__":
    main()
