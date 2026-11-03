import re
from pathlib import Path

H = Path("docs/handoff")


def sub(f, pattern, repl, count=1):
    p = H / f
    s = p.read_text(encoding="utf-8")
    n = len(re.findall(pattern, s, flags=re.M))
    assert n >= 1, (f, pattern)
    s = re.sub(pattern, repl, s, count=count, flags=re.M)
    p.write_text(s, encoding="utf-8")


sub("00_START_HERE.md", r"^\| Biggest handoff trap \|.*$",
    "| Shipping | **Clone and double-click `START_RETINITRY.bat`.** The models ship in git as 45 MB hash-checked parts "
    "(`server/models/parts/`) and are rebuilt on first start; `web/dist` is prebuilt; runtime packages are pinned in "
    "`requirements-runtime.txt`. Tested on a fresh clone: launcher installed, rebuilt models, 28/28 e2e checks passed. "
    "Needs Python 3.11 on Windows (`start.sh` for macOS/Linux is untested) |")
sub("00_START_HERE.md", r"^\| Trained ONNX models \+ fitted JSON \|.*$",
    "| Trained ONNX models + fitted JSON | `server\\models\\` (`*.onnx` rebuilt from `server\\models\\parts\\`; the parts and JSON are in git) |")
sub("01_STATUS.md", r"^\| `requirements.txt` mixes training.*$",
    "| Two requirement files: `requirements-runtime.txt` (pinned, app only) and `requirements.txt` (training, unpinned) | Training installs may drift | repo root |")
sub("05_CODE_MAP.md", r"\(ONNX not in git\)", "(ONNX shipped as parts in `server/models/parts/`, rebuilt by `scripts/models.py`)")
sub("06_DECISIONS_AND_RISKS.md", r"^\| Model files lost \(not in git\).*$",
    "| Repo size grows with every retrain (models are ~500 MB of parts per version in git history) | Medium | Re-pack only when models change; consider Git LFS or release assets if retrained often |")
sub("07_NEXT_STEPS.md", r"^\| 1 \| Back up .*$",
    "| 1 | Done: models ship in git as parts (`scripts/models.py`). Remaining: keep a second copy of `runs/` checkpoints if retraining from them matters | | |")
sub("07_NEXT_STEPS.md", r"^\| 4 \| Pin dependency versions.*$",
    "| 4 | Runtime deps are pinned (`requirements-runtime.txt`); pin `requirements.txt` (training) too | Reproducible training installs | `requirements.txt` |")
sub("07_NEXT_STEPS.md", r"^\| 13 \| Split runtime vs training requirements.*$",
    "| 13 | Done: `requirements-runtime.txt`. Next: a one-file installer that bundles portable Python so the recipient needs nothing pre-installed |")

# runbook section 2
p = H / "04_RUNBOOK.md"
s = p.read_text(encoding="utf-8")
start = s.index("## 2.")
end = s.index("## 3.")
new = """## 2. Set up on a NEW machine

Everything needed to run is in git: code, the five models as 45 MB parts, fitted thresholds, demo images and the
prebuilt web app.

1. Install **Python 3.11** (`winget install Python.Python.3.11`) and Git.
2. Clone and start:
   ```powershell
   git clone https://github.com/reesick/retina-bkx.git retinitry
   cd retinitry
   .\\START_RETINITRY.bat
   ```
   The first run (3–6 min) creates `.venv` from `requirements-runtime.txt`, runs `python scripts\\models.py assemble`
   (rebuilds `server\\models\\*.onnx` and checks every SHA-256), starts the server and opens the browser.
   No GPU and no Node.js are needed.
3. **To retrain** (needs an NVIDIA GPU, about 4–5 h on an RTX 4050, and ~10 GB of disk):
   - run `scripts\\setup_env.ps1` for CUDA PyTorch;
   - then `scripts\\train.ps1`;
   - then `python scripts\\models.py pack` and commit `server\\models\\parts\\` plus the JSON files.

   Results will differ slightly from 03, because training is not bit-reproducible.

"""
p.write_text(s[:start] + new + s[end:], encoding="utf-8")
print("ok")
