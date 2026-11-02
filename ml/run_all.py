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
    with open(LOGS / f"stage_{name}.log", "a", encoding="utf-8") as f:
        f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} start {name} =====\n")
        proc = subprocess.Popen([PY, "-u", "-m", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", bufsize=1)
        for line in proc.stdout:  # live: console + log file
            if "unauthenticated requests" in line:
                continue
            sys.stdout.write(line)
            sys.stdout.flush()
            f.write(line)
            f.flush()
        rc = proc.wait()
    print(f"[run_all] <<< {name} exit {rc} in {(time.time() - t0) / 60:.1f} min", flush=True)
    return rc == 0


V1 = RUNS / "v1_aptos_only"
STAGES = [
    # name, wait-for manifest keys, wait minutes, done-marker, module args
    ("splits", ["aptos", "ddr:gradetrain", "deepdrid"], 240, ROOT / "data" / "splits" / "grading.csv", ["ml.data.splits"]),
    ("landmarks", ["idrid"], 1, RUNS / "landmarks" / "done.txt", ["ml.train.landmarks"]),
    ("quality", ["deepdrid"], 60, RUNS / "quality" / "done.txt", ["ml.train.quality"]),
    ("grader_cnn", ["ddr:gradetrain"], 240, RUNS / "grader_cnn" / "done.txt",
     ["ml.train.grader", "--arch", "cnn", "--init", str(V1 / "grader_cnn" / "best.pt")]),
    ("grader_vit", ["ddr:gradetrain"], 240, RUNS / "grader_vit" / "done.txt",
     ["ml.train.grader", "--arch", "vit", "--init", str(V1 / "grader_vit" / "best.pt")]),
    ("lesions", ["ddr:seg"], 240, RUNS / "lesions" / "done.txt", ["ml.train.lesions"]),
    ("export", [], 0, RUNS / "export_v2.done", ["ml.export.to_onnx"]),
    ("evaluate", ["ddr:test"], 120, RUNS / "evaluate_v2.done", ["ml.eval.evaluate"]),
    ("extras", [], 0, RUNS / "extras_v2.done", ["ml.eval.extras"]),
    ("demo", [], 0, RUNS / "demo_v2.done", ["ml.data.demo_cases"]),
]


def _locked() -> bool:
    """True if another run_all is alive (lock file holds its PID)."""
    lock = LOGS / "run_all.lock"
    if lock.exists():
        try:
            pid = int(lock.read_text().strip())
            import psutil  # noqa: F401
        except Exception:
            pid = None
        if pid:
            try:
                import psutil

                if psutil.pid_exists(pid) and "python" in psutil.Process(pid).name().lower():
                    return True
            except Exception:
                pass
    LOGS.mkdir(exist_ok=True)
    import os

    lock.write_text(str(os.getpid()))
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if _locked():
        print("[run_all] another run_all is already running (logs/run_all.lock); exiting", flush=True)
        return 2
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
        if ok and marker.suffix == ".done":
            marker.write_text("ok")
        if not ok:
            print(f"[run_all] stage {name} failed; see logs/stage_{name}.log", flush=True)
            if name in ("splits", "grader_cnn", "grader_vit", "export"):
                return 1
    print("[run_all] all stages finished", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
