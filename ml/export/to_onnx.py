"""Export trained checkpoints to ONNX for CPU inference, with explanation maps baked in.

  grader_cnn.onnx  image[1,3,512,512] -> logits[1,5], features[1,1536], cam[1,5,16,16]
                   CAM = W_c · A (exact Grad-CAM for a GAP + linear head)
  grader_vit.onnx  image[1,3,448,448] -> logits[1,5], features[1,768], attn[1,32,32]
                   attn = last-block CLS->patch attention averaged over heads
  lesions.onnx     image[1,3,1024,1024] -> probs[1,4,1024,1024]
  landmarks.onnx   image[1,3,512,512] -> heatmaps[1,2,128,128] (sigmoid)
  quality.onnx     image[1,3,384,384] -> logits[1,3]

    python -m ml.export.to_onnx [names...]
"""
from __future__ import annotations

import hashlib
import sys

import numpy as np
import torch
import torch.nn as nn

from ml.common import MODELS_OUT, RUNS, load_json, save_json

OPSET = 17


class CnnWrap(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        a = self.m.forward_features(x)                       # [1,C,h,w]
        pooled = a.mean(dim=(2, 3))
        logits = self.m.classifier(pooled)
        w = self.m.classifier.weight                          # [5,C]
        cam = torch.einsum("kc,bchw->bkhw", w, a)
        return logits, pooled, cam


class VitWrap(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        m = self.m
        x = m.patch_embed(x)
        x = m._pos_embed(x)
        x = m.patch_drop(x)
        x = m.norm_pre(x)
        for blk in m.blocks[:-1]:
            x = blk(x)
        blk = m.blocks[-1]
        y = blk.norm1(x)
        B, N, C = y.shape
        H = blk.attn.num_heads
        qkv = blk.attn.qkv(y).reshape(B, N, 3, H, C // H).permute(2, 0, 3, 1, 4)
        q, k, v = qkv[0], qkv[1], qkv[2]
        q, k = blk.attn.q_norm(q), blk.attn.k_norm(k)
        attn = torch.softmax((q * blk.attn.scale) @ k.transpose(-2, -1), dim=-1)
        o = (attn @ v).transpose(1, 2).reshape(B, N, C)
        o = blk.attn.proj(blk.attn.norm(o) if hasattr(blk.attn, "norm") else o)
        x = x + blk.ls1(o)
        x = x + blk.ls2(blk.mlp(blk.norm2(x)))
        x = m.norm(x)
        npfx = m.num_prefix_tokens
        cls_attn = attn[:, :, 0, npfx:].mean(1)               # [B, P]
        gh, gw = m.patch_embed.grid_size
        feats = m.forward_head(x, pre_logits=True)
        logits = m.head(feats)
        return logits, feats, cls_attn.reshape(B, gh, gw)


class SigWrap(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return torch.sigmoid(self.m(x))


def sha12(path) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]


def export(name: str, model: nn.Module, size: int, outputs: list[str]) -> None:
    model.eval().float()
    x = torch.randn(1, 3, size, size)
    path = MODELS_OUT / f"{name}.onnx"
    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    with torch.no_grad():
        ref = model(x)
        torch.onnx.export(model, (x,), str(path), input_names=["image"], output_names=outputs, opset_version=OPSET,
                          dynamo=False, do_constant_folding=True)
    import onnxruntime as ort

    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    got = s.run(None, {"image": x.numpy()})
    ref = ref if isinstance(ref, (tuple, list)) else [ref]
    err = max(float(np.abs(r.numpy() - g).max()) for r, g in zip(ref, got))
    print(f"[export] {name}: max |torch - onnx| = {err:.2e}  sha {sha12(path)}")
    man = load_json(MODELS_OUT / "manifest.json", {})
    man[name] = {"file": f"{name}.onnx", "input": [1, 3, size, size], "outputs": outputs, "sha": sha12(path),
                 "parity_max_abs": err}
    save_json(MODELS_OUT / "manifest.json", man)


def main(names: list[str]) -> None:
    names = names or ["quality", "grader_cnn", "grader_vit", "lesions", "landmarks"]
    if "grader_cnn" in names:
        from ml.train.grader import build_model

        m = build_model("cnn", pretrained=False)
        m.load_state_dict(torch.load(RUNS / "grader_cnn" / "best.pt", map_location="cpu")["state_dict"])
        export("grader_cnn", CnnWrap(m), 512, ["logits", "features", "cam"])
    if "grader_vit" in names:
        from ml.train.grader import build_model

        m = build_model("vit", pretrained=False)
        m.load_state_dict(torch.load(RUNS / "grader_vit" / "best.pt", map_location="cpu")["state_dict"])
        export("grader_vit", VitWrap(m), 448, ["logits", "features", "attn"])
    if "lesions" in names:
        from ml.train.lesions import build_model

        ck = torch.load(RUNS / "lesions" / "best.pt", map_location="cpu")
        m = build_model(pretrained=False)
        m.load_state_dict(ck["state_dict"])
        export("lesions", SigWrap(m), 1024, ["probs"])
        man = load_json(MODELS_OUT / "manifest.json", {})
        man["lesions"]["thresholds"] = ck["thresholds"]
        save_json(MODELS_OUT / "manifest.json", man)
    if "landmarks" in names:
        from ml.train.landmarks import LandmarkNet

        m = LandmarkNet(pretrained=False)
        m.load_state_dict(torch.load(RUNS / "landmarks" / "best.pt", map_location="cpu")["state_dict"])
        export("landmarks", SigWrap(m), 512, ["heatmaps"])
    if "quality" in names:
        from ml.train.quality import build_model

        m = build_model(pretrained=False)
        m.load_state_dict(torch.load(RUNS / "quality" / "best.pt", map_location="cpu")["state_dict"])
        export("quality", m, 384, ["logits"])


if __name__ == "__main__":
    main(sys.argv[1:])
