"""Shared helpers for training and evaluation (seeding, paths, datasets, metrics)."""
from __future__ import annotations

import json
import os
import random
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HOME", str(ROOT.parent / ".cache" / "hf"))
os.environ.setdefault("TORCH_HOME", str(ROOT.parent / ".cache" / "torch"))

DATA = ROOT / "data"
PROC = DATA / "processed"
SPLITS = DATA / "splits"
RUNS = ROOT / "runs"
MODELS_OUT = ROOT / "server" / "models"
SEED = 42


def seed_all(seed: int = SEED) -> None:
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    # Seeded, but cuDNN autotuning is on for speed: training is reproducible in distribution, not bit-exact.
    # Inference (ONNX Runtime on CPU) is bit-exact, which is what the product guarantees.
    torch.backends.cudnn.benchmark = True
    torch.backends.cudnn.deterministic = False


def read_rgb(path: Path | str) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(path)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=float))


def load_json(path: Path, default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default


def worker_init(worker_id: int) -> None:
    np.random.seed(SEED + worker_id)
    random.seed(SEED + worker_id)


def ensure_imagenet_tensor(rgb: np.ndarray):
    import torch
    from core.fundus import IMAGENET_MEAN, IMAGENET_STD

    x = (rgb.astype(np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(x.transpose(2, 0, 1).copy())


# ------------------------------------------------------------------ metrics
def softmax(z: np.ndarray, t: float = 1.0) -> np.ndarray:
    z = z / t
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def entropy(p: np.ndarray) -> np.ndarray:
    return -(p * np.log(np.clip(p, 1e-12, 1))).sum(axis=1)


def qwk(y: np.ndarray, yhat: np.ndarray, k: int = 5) -> float:
    from sklearn.metrics import cohen_kappa_score

    return float(cohen_kappa_score(y, yhat, weights="quadratic", labels=list(range(k))))


def ece(conf: np.ndarray, correct: np.ndarray, bins: int = 15) -> tuple[float, dict]:
    edges = np.linspace(0, 1, bins + 1)
    e, rel = 0.0, {"bins": [], "acc": [], "conf": [], "count": []}
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.sum() == 0:
            continue
        a, c = correct[m].mean(), conf[m].mean()
        e += m.mean() * abs(a - c)
        rel["bins"].append(float((lo + hi) / 2)); rel["acc"].append(float(a))
        rel["conf"].append(float(c)); rel["count"].append(int(m.sum()))
    return float(e), rel


def binary_ece(p: np.ndarray, y: np.ndarray, bins: int = 15) -> tuple[float, dict]:
    """ECE of P(referable) as a probability of the positive class."""
    edges = np.linspace(0, 1, bins + 1)
    e, rel = 0.0, {"bins": [], "acc": [], "conf": [], "count": []}
    for i, (lo, hi) in enumerate(zip(edges[:-1], edges[1:])):
        m = (p >= lo) & ((p < hi) if i < bins - 1 else (p <= hi))
        if m.sum() == 0:
            continue
        a, c = y[m].mean(), p[m].mean()
        e += m.mean() * abs(a - c)
        rel["bins"].append(float((lo + hi) / 2)); rel["acc"].append(float(a))
        rel["conf"].append(float(c)); rel["count"].append(int(m.sum()))
    return float(e), rel


def bootstrap_ci(fn, *arrays, n: int = 1000, seed: int = SEED) -> list[float]:
    rng = np.random.default_rng(seed)
    N = len(arrays[0])
    vals = []
    for _ in range(n):
        idx = rng.integers(0, N, N)
        try:
            v = fn(*[a[idx] for a in arrays])
        except ValueError:
            continue
        if v is not None and np.isfinite(v):
            vals.append(v)
    if not vals:
        return [float("nan"), float("nan")]
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]
