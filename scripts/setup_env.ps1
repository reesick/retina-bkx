# Creates the Python environment for Retinitry on D: (C: is nearly full).
# Safe to re-run: uv skips packages that are already installed.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$env:UV_CACHE_DIR = "d:\retina\.cache\uv"
$env:UV_LINK_MODE = "copy"
$py = Join-Path $root ".venv\Scripts\python.exe"
$log = Join-Path $root "logs\setup_env.log"
New-Item -ItemType Directory -Force -Path (Join-Path $root "logs") | Out-Null
if (-not (Test-Path $py)) { uv venv (Join-Path $root ".venv") --python 3.11 *>> $log }
"[$(Get-Date -Format s)] installing torch" | Out-File -Append $log
uv pip install --python $py torch torchvision --index-url https://download.pytorch.org/whl/cu128 *>> $log
"[$(Get-Date -Format s)] installing deps" | Out-File -Append $log
uv pip install --python $py -r (Join-Path $root "requirements.txt") *>> $log
& $py -c "import torch,timm,segmentation_models_pytorch,onnxruntime,cv2;print('ENV_OK', torch.__version__, torch.cuda.is_available())" *>> $log
"[$(Get-Date -Format s)] done" | Out-File -Append $log
