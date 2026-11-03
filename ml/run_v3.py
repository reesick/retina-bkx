"""v3 re-run after the IDRiD file-name fix (test images had overwritten training images with the same names).

Retrains what used IDRiD images, then rebuilds every downstream result. Resumable: each finished stage writes
runs/v3/<stage>.done; re-run the same command after any interruption.

    python -m ml.run_v3
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "runs"
MARK = RUNS / "v3"
LOGS = ROOT / "logs"
PY = sys.executable

STAGES = [
    # name, module args, things to delete before the first attempt (stale outputs)
    ("landmarks", ["ml.train.landmarks"], [RUNS / "landmarks"]),
    ("landmarks_oof", ["ml.train.landmarks_oof"], [RUNS / "landmarks_oof"]),
    ("export_landmarks", ["ml.export.to_onnx", "landmarks"], []),
    ("evaluate", ["ml.eval.evaluate"], [RUNS / "preds" / "idrid.npz"]),
    ("extras", ["ml.eval.extras"], []),
    ("explain_more", ["ml.eval.explain_more"], []),
    ("leakage_check", ["ml.eval.leakage_check"], []),
    ("app_eval", ["ml.eval.app_eval"], [RUNS / "app_eval"]),
    ("site_calibration", ["ml.eval.site_calibration"], []),
    ("quantize", ["ml.export.quantize"], [ROOT / "server" / "models" / "grader_vit_int8.onnx"]),
    ("failure_gallery", ["ml.eval.failure_gallery"], []),
    ("demo_cases", ["ml.data.demo_cases"], []),
]


def run(name: str, args: list[str]) -> bool:
    print(f"[v3] >>> {name}", flush=True)
    t0 = time.time()
    with open(LOGS / f"v3_{name}.log", "a", encoding="utf-8") as f:
        f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} start {name} =====\n")
        p = subprocess.Popen([PY, "-u", "-m", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace", bufsize=1)
        for line in p.stdout:
            if "unauthenticated" in line or "Warning" in line:
                continue
            sys.stdout.write(line); sys.stdout.flush(); f.write(line); f.flush()
        rc = p.wait()
    print(f"[v3] <<< {name} exit {rc} in {(time.time() - t0) / 60:.1f} min", flush=True)
    return rc == 0


def main() -> int:
    MARK.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(exist_ok=True)
    for name, args, stale in STAGES:
        done = MARK / f"{name}.done"
        started = MARK / f"{name}.started"
        if done.exists():
            print(f"[v3] skip {name}", flush=True)
            continue
        if not started.exists():   # first attempt: clear stale outputs; later attempts resume (checkpoints, caches)
            for s in stale:
                shutil.rmtree(s, ignore_errors=True) if s.is_dir() else s.unlink(missing_ok=True)
            started.write_text("1")
        if not run(name, args):
            print(f"[v3] stage {name} FAILED - see logs/v3_{name}.log; re-run `python -m ml.run_v3` to resume", flush=True)
            return 1
        done.write_text("ok")
    print("[v3] all stages finished", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
