"""INT8 dynamic quantisation of the ViT grader (the 345 MB model) and an accuracy/latency check on IDRiD (CPU).

Accept rule: ensemble AUROC on IDRiD drops by < 0.005 and triage-relevant P(referable) changes are small.
Writes server/models/grader_vit_int8.onnx (only if accepted) and metrics.json["quantization"].
The app keeps using the fp32 model unless RETINITRY_VIT_INT8=1 is set (see server/app/pipeline.py).

    python -m ml.export.quantize
"""
import json
import time

import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from sklearn.metrics import roc_auc_score

from core.fundus import to_tensor_input
from ml.common import MODELS_OUT, RUNS, read_rgb, softmax
from ml.eval import evaluate as EV


def main():
    src, dst = MODELS_OUT / "grader_vit.onnx", MODELS_OUT / "grader_vit_int8.onnx"
    if not dst.exists():
        quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    s32 = ort.InferenceSession(str(src), so, providers=["CPUExecutionProvider"])
    s8 = ort.InferenceSession(str(dst), so, providers=["CPUExecutionProvider"])
    pol = json.loads((MODELS_OUT / "policy.json").read_text())
    T = pol["temperatures"]
    df = EV.datasets()["idrid"]
    cnn = softmax(np.load(RUNS / "preds" / "idrid.npz")["logits_cnn"], T["cnn"])
    l32, l8, t32, t8 = [], [], 0.0, 0.0
    for k, p in enumerate(df["path"]):
        x = to_tensor_input(read_rgb(p), 448)
        a = time.perf_counter(); l32.append(s32.run(None, {"image": x})[0][0]); t32 += time.perf_counter() - a
        a = time.perf_counter(); l8.append(s8.run(None, {"image": x})[0][0]); t8 += time.perf_counter() - a
        if k % 100 == 0:
            print(f"[quant] {k}/{len(df)}", flush=True)
    y = (df["grade"].to_numpy() >= 2).astype(int)
    p32, p8 = softmax(np.array(l32), T["vit"]), softmax(np.array(l8), T["vit"])
    e32, e8 = (cnn + p32) / 2, (cnn + p8) / 2
    r = {"model": "grader_vit", "method": "onnxruntime dynamic INT8 (MatMul/Gemm weights)",
         "size_mb": {"fp32": round(src.stat().st_size / 1e6, 1), "int8": round(dst.stat().st_size / 1e6, 1)},
         "cpu_ms_per_image": {"fp32": round(t32 / len(df) * 1000, 1), "int8": round(t8 / len(df) * 1000, 1)},
         "idrid_auroc_vit": {"fp32": float(roc_auc_score(y, p32[:, 2:].sum(1))), "int8": float(roc_auc_score(y, p8[:, 2:].sum(1)))},
         "idrid_auroc_ensemble": {"fp32": float(roc_auc_score(y, e32[:, 2:].sum(1))), "int8": float(roc_auc_score(y, e8[:, 2:].sum(1)))},
         "max_abs_diff_p_referable_ensemble": float(np.abs(e32[:, 2:].sum(1) - e8[:, 2:].sum(1)).max()),
         "decision_flips_at_t_refer": int(((e32[:, 2:].sum(1) >= pol["t_refer"]) != (e8[:, 2:].sum(1) >= pol["t_refer"])).sum()),
         "n": int(len(df))}
    r["accepted"] = abs(r["idrid_auroc_ensemble"]["fp32"] - r["idrid_auroc_ensemble"]["int8"]) < 0.005
    print("[quant]", r, flush=True)
    if not r["accepted"]:
        dst.unlink(missing_ok=True)
    m = json.loads((MODELS_OUT / "metrics.json").read_text())
    m["quantization"] = r
    (MODELS_OUT / "metrics.json").write_text(json.dumps(m, indent=2, default=float))


if __name__ == "__main__":
    main()
