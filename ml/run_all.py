"""End-to-end ML orchestrator: waits for data, trains every model, exports ONNX, evaluates.

Each stage is skipped when its output already exists, so this is safe to re-run after a crash.
Logs: logs/stage_<name>.log.   Usage: python -m ml.run_all [--only stage,stage]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable
LOGS = ROOT / "logs"
MAN = ROOT / "data" / "manifest.json"
RUNS = ROOT / "runs"
MODELS = ROOT / "server" / "models"


def manifest() -> dict:
    try:
        return json.loads(MAN.read_text())
    except Exception:
        return {}


def wait_for(keys: list[str], timeout_min: float) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout_min * 60:
        m = manifest()
        if all(m.get(k) == "done" for k in keys):
            return True
        time.sleep(30)
    print(f"[run_all] timed out waiting for {keys}", flush=True)
    return False


def run(name: str, args: list[str]) -> bool:
    LOGS.mkdir(exist_ok=True)
    print(f"[run_all] >>> {name}: {' '.join(args)}", flush=True)
    t0 = time.time()
    with open(LOGS / f"stage_{name}.log", "w") as f:
        r = subprocess.run([PY, "-u", "-m", *args], cwd=ROOT, stdout=f, stderr=subprocess.STDOUT)
    print(f"[run_all] <<< {name} exit {r.returncode} in {(time.time() - t0) / 60:.1f} min", flush=True)
    return r.returncode == 0


STAGES = [
    # name, wait-for manifest keys, wait minutes, done-marker, module args
    ("splits", ["aptos"], 240, ROOT / "data" / "splits" / "aptos.csv", ["ml.data.splits"]),
    ("landmarks", ["idrid"], 1, RUNS / "landmarks" / "best.pt", ["ml.train.landmarks"]),
    ("grader_cnn", ["aptos"], 1, RUNS / "grader_cnn" / "best.pt", ["ml.train.grader", "--arch", "cnn"]),
    ("quality", ["deepdrid"], 60, RUNS / "quality" / "best.pt", ["ml.train.quality"]),
    ("grader_vit", ["aptos"], 1, RUNS / "grader_vit" / "best.pt", ["ml.train.grader", "--arch", "vit"]),
    ("lesions", ["ddr:seg"], 240, RUNS / "lesions" / "best.pt", ["ml.train.lesions"]),
    ("export", [], 0, MODELS / "lesions.onnx", ["ml.export.to_onnx"]),
    ("evaluate", ["ddr:test"], 120, MODELS / "policy.json", ["ml.eval.evaluate"]),
    ("extras", [], 0, RUNS / "extras.done", ["ml.eval.extras"]),
    ("demo", [], 0, ROOT / "server" / "demo" / "cases.json", ["ml.data.demo_cases"]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    for name, keys, wait, marker, args in STAGES:
        if only and name not in only:
            continue
        if marker.exists() and not a.force:
            print(f"[run_all] skip {name} (have {marker.name})", flush=True)
            continue
        if keys and not wait_for(keys, wait):
            print(f"[run_all] continuing without {keys} for {name}", flush=True)
        ok = run(name, args)
        if not ok:
            print(f"[run_all] stage {name} failed; see logs/stage_{name}.log", flush=True)
            if name in ("splits", "grader_cnn", "grader_vit", "export"):
                return 1
    print("[run_all] all stages finished", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
