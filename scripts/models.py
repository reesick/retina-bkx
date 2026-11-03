"""Ship the trained ONNX models through plain git (no LFS, no tokens).

GitHub rejects files over 100 MB, and grader_vit.onnx is ~330 MB. So each model is split into 45 MB parts under
server/models/parts/, with a SHA-256 manifest. `assemble` rebuilds the .onnx files and verifies every hash.

    python scripts/models.py pack       # maintainer: after retraining, before committing
    python scripts/models.py assemble   # recipient: done automatically by START_RETINITRY.bat / start.ps1 / start.sh
    python scripts/models.py verify     # check the assembled models match the manifest

Only the Python standard library is used, so this runs before any dependency is installed.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "server" / "models"
PARTS = MODELS / "parts"
MANIFEST = PARTS / "parts.json"
NAMES = ["quality", "grader_cnn", "grader_vit", "lesions", "landmarks"]
PART_SIZE = 45 * 1024 * 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pack() -> int:
    PARTS.mkdir(parents=True, exist_ok=True)
    for old in PARTS.glob("*.part*"):
        old.unlink()
    man = {"part_size": PART_SIZE, "models": {}}
    for n in NAMES:
        src = MODELS / f"{n}.onnx"
        if not src.exists():
            print(f"[models] missing {src}; train/export first")
            return 1
        parts = []
        with open(src, "rb") as f:
            i = 0
            while True:
                buf = f.read(PART_SIZE)
                if not buf:
                    break
                p = PARTS / f"{n}.onnx.part{i:02d}"
                p.write_bytes(buf)
                parts.append({"file": p.name, "sha256": hashlib.sha256(buf).hexdigest(), "bytes": len(buf)})
                i += 1
        man["models"][n] = {"file": src.name, "sha256": sha256(src), "bytes": src.stat().st_size, "parts": parts}
        print(f"[models] {n}: {src.stat().st_size / 1e6:.1f} MB -> {len(parts)} parts")
    MANIFEST.write_text(json.dumps(man, indent=2))
    return 0


def assemble(force: bool = False) -> int:
    if not MANIFEST.exists():
        print(f"[models] no {MANIFEST}; nothing to assemble")
        return 1
    man = json.loads(MANIFEST.read_text())
    ok = True
    for n, m in man["models"].items():
        dst = MODELS / m["file"]
        if not force and dst.exists() and dst.stat().st_size == m["bytes"] and sha256(dst) == m["sha256"]:
            print(f"[models] {m['file']} ok")
            continue
        tmp = dst.with_suffix(".onnx.tmp")
        with open(tmp, "wb") as out:
            for part in m["parts"]:
                p = PARTS / part["file"]
                if not p.exists():
                    print(f"[models] MISSING part {p.name}")
                    ok = False
                    break
                data = p.read_bytes()
                if hashlib.sha256(data).hexdigest() != part["sha256"]:
                    print(f"[models] CORRUPT part {p.name}")
                    ok = False
                    break
                out.write(data)
        if not ok:
            tmp.unlink(missing_ok=True)
            continue
        if sha256(tmp) != m["sha256"]:
            print(f"[models] assembled {m['file']} hash mismatch")
            tmp.unlink(missing_ok=True)
            ok = False
            continue
        tmp.replace(dst)
        print(f"[models] assembled {m['file']} ({m['bytes'] / 1e6:.1f} MB)")
    return 0 if ok else 1


def verify() -> int:
    man = json.loads(MANIFEST.read_text())
    bad = [m["file"] for m in man["models"].values()
           if not (MODELS / m["file"]).exists() or sha256(MODELS / m["file"]) != m["sha256"]]
    print("[models] all models verified" if not bad else f"[models] mismatch: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "assemble"
    sys.exit({"pack": pack, "assemble": lambda: assemble("--force" in sys.argv), "verify": verify}[cmd]())
