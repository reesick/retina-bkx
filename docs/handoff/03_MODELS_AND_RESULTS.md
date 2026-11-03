# 03 · Models, data and every measured result

All numbers below come from `server/models/metrics.json` (written by `ml/eval/evaluate.py` and `ml/eval/extras.py`,
policy `fit-20261102-2332`). "Referable" means DR grade ≥ 2, which is a research definition, not a clinical rule.

## 1. Data

| Dataset | Licence | Images used | Role |
|---|---|---|---|
| APTOS 2019 (Aravind, India) via HF mirror `sngsfydy/aptos` | Kaggle competition rules: **do not redistribute** | 3,662 | train 2,563 / val 549 / test 550 |
| DDR (China, multi-site) via HF `ctmedtech/DDR-dataset` | CC-BY 4.0 | grading 13,673 (train 6,260 used after removing ungradable, val 2,503, test 4,105 incl. 346 ungradable); lesion seg 757 | grader training, validation, held-out test; lesion training |
| DeepDRiD (regular fundus) via GitHub `deepdrdoc/DeepDRiD` | CC-BY-SA 4.0 | 1,600 (train 1,200 / val 400, patient-level) | grader training; real quality labels; laterality check |
| IDRiD (Nanded, India) via HF `MahsaTorki/IDRiD_Dataset` | CC-BY 4.0 | 516 graded, 81 lesion-annotated, OD/fovea centres | **only fully external** grading test; landmark and lesion training (train split only); demo images |

**Leakage rules**
- IDRiD grading images are never used to train or fit the graders, temperatures or thresholds.
- IDRiD train images *are* used for the landmark and lesion models. The grading set and the segmentation set overlap in patients
  only in the sense that both come from the same hospital and camera.
- APTOS has no patient ids, so its split is image-level, and that is stated in the notes.

All images are pre-cropped once by `core/fundus.py` to a centred square (768 px for grading, 1024 px for lesions).

## 2. Models (all exported to ONNX opset 17, run on CPU)

| File | Architecture | Input | Trained on | Size |
|---|---|---|---|---|
| `grader_cnn.onnx` | EfficientNet-B3 (timm), 5-class softmax; CAM computed in-graph | 512 | v1: APTOS 14 epochs; v2: fine-tuned 6 epochs on APTOS + DDR + DeepDRiD train (10,023 images) | 41 MB |
| `grader_vit.onnx` | DINOv2 ViT-B/14, last 4 blocks + head trained; CLS attention in-graph | 448 | v1: APTOS 10 epochs; v2: fine-tuned 5 epochs, same sources | 329 MB |
| `lesions.onnx` | U-Net, EfficientNet-B3 encoder, scSE decoder; sigmoid ×4 | 1024 | IDRiD train 54 + DDR train 383; 40 epochs; thresholds Dice-optimal on DDR val | 48 MB |
| `landmarks.onnx` | U-Net, ResNet-34 encoder → 2 heat-maps | 512 → 128 | IDRiD train 413 (15% hold-out for selection); 60 epochs | 93 MB |
| `quality.onnx` | EfficientNet-B0, 3 classes | 384 | DeepDRiD train real labels (80% of patients, ×3) + APTOS/IDRiD with synthetic degradations; selected on real-label AUROC on the held-out 20% of DeepDRiD train patients | 15 MB |

Fitted side files:
- **`policy.json`**: thresholds, temperatures, lesion-suspicion levels and the laterality rule, each with its provenance text.
- **`quality_rules.json`**: rule thresholds and the model cut-off of 0.778.
- **`ood.npz`**: PCA and Mahalanobis parameters for the out-of-distribution check.
- **`manifest.json`**: per-model SHA and the PyTorch-vs-ONNX parity check, max |Δ| ≤ 1.3e-3.

## 3. Fitted thresholds (validation = APTOS val + DDR valid, n = 3,052)

| Threshold | Value | Rule |
|---|---|---|
| t_refer | 0.497 | Highest P(referable) cut-off with validation sensitivity ≥ 0.95 |
| t_entropy | 0.607 | Smallest cut-off where accepted cases reach sensitivity ≥ 0.97 with ≤ 30% abstention |
| t_disagreement | 0.328 | 95th percentile of the CNN–ViT P(referable) gap |
| t_ood | 13.72 | 99th percentile of the Mahalanobis distance on validation |
| Temperatures | CNN 1.44, ViT 1.33 | Validation NLL |
| Lesion suspicion | HE area 0.061%, EX area 0.054%, HE count 3 | 97th percentile among validation grade 0–1 |

## 4. Grading results (ensemble, at the operating point)

| Test set | Relationship to training | n | AUROC (95% CI) | Sens | Spec | PPV | NPV | QWK | ECE before → after |
|---|---|---|---|---|---|---|---|---|---|
| **IDRiD** | fully external | 516 | **0.917** (0.893–0.941) | 0.84 | 0.80 | 0.84 | 0.80 | 0.70 | 0.099 → 0.090 |
| DDR test | held out, source seen | 3,759 | 0.975 (0.970–0.979) | 0.79 | 0.98 | 0.97 | 0.85 | 0.88 | 0.081 → 0.082 |
| DeepDRiD val | held-out patients, source seen | 400 | 0.975 (0.961–0.986) | 0.96 | 0.88 | 0.87 | 0.96 | 0.84 | 0.066 → 0.053 |
| APTOS test | held out, source seen | 550 | 0.985 (0.977–0.991) | 0.92 | 0.94 | 0.92 | 0.95 | 0.91 | 0.035 → 0.034 |

Single models (AUROC):

| Model | IDRiD | DDR | DeepDRiD | APTOS |
|---|---|---|---|---|
| CNN | 0.935 | 0.964 | 0.966 | 0.982 |
| ViT | 0.887 | 0.970 | 0.977 | 0.982 |

Note that on IDRiD the CNN alone beats the ensemble. This is a clear lead (see 07).

Per-grade recall, grades 0 → 4:

| Test set | Grade 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| IDRiD | **0.43** | 0.82 | 0.68 | 0.35 | 0.62 |
| DDR | 0.99 | 0.40 | 0.72 | 0.52 | 0.88 |
| DeepDRiD | 0.82 | 0.37 | 0.78 | 0.66 | 0.55 |
| APTOS | 0.97 | 0.66 | 0.78 | 0.34 | 0.66 |

PPV/NPV depend on dataset prevalence (45–55% referable here) and do not transfer to a primary-health-centre population.

## 5. Triage simulation (real `core/policy.py` on every test image)

| Test set | Auto-decided (coverage) | Sensitivity on auto-decided | Specificity on auto-decided | ROUTINE | REFER | HUMAN_REVIEW | RETAKE | Referable cleared as ROUTINE |
|---|---|---|---|---|---|---|---|---|
| IDRiD | 30% | 0.96 | 0.99 | 16% | 15% | **70%** | 0% | **3 / 286** |
| DDR test | 61% | 0.90 | 1.00 | 41% | 14% | 43% | 2% | **66 / 1,690** |
| DeepDRiD val | 30% | 0.98 | 0.91 | 16% | 14% | 57% | 13% | **1 / 180** |
| APTOS test | 60% | 1.00 | 0.98 | 42% | 18% | 39% | 1% | **0 / 223** |

DDR ungradable images: 346, of which 100% were not cleared as ROUTINE.

**v1 vs v2.**
- v1 trained the graders on APTOS only. It let 641 / 1,690 referable DDR eyes and 33 / 286 IDRiD eyes through as ROUTINE.
- v2 multi-source training plus the sensitivity-first operating point cut those to 66 and 3.
- The price is more human review.
- v1 metrics are kept in `server/models/v1_aptos_only/`; `python -m ml.eval.compare` prints both side by side.

## 6. Other components

| Component | Result |
|---|---|
| Quality on DeepDRiD val (real labels, 218 poor / 182 good) | AUROC 0.80 for "inadequate"; 80% of poor photos flagged (49% outright inadequate); 10% of good photos rejected; split: adequate 166, usable 109, inadequate 125 |
| Lesion Dice, IDRiD test (27) | EX 0.77 · HE 0.65 · SE 0.67 · MA 0.43 |
| Lesion Dice, DDR test (225) | EX 0.58 · HE 0.40 · SE 0.43 · MA 0.24 |
| Landmarks, IDRiD test (103 images, 206 points) | Median error: disc 0.05 DD, fovea 0.07 DD; within 1 DD: disc 100%, fovea 98% |
| Laterality rule (disc on image right = OD) | 98.3% on 1,163 DeepDRiD images where the model was confident |
| Pointing game (heat-map peak inside an expert lesion mask, IDRiD seg test, n = 27) | CNN 0.67, ViT 0.81, random baseline 0.23 |
| Deletion test (APTOS test referable, n = 80) | Hiding the top 10% CAM area drops P(referable) by 0.154 on average, vs 0.009 for random areas; larger drop in 94% of images |
| Weight-randomisation sanity check (n = 40) | Spearman correlation between trained and randomised CAM 0.03, so the map depends on learned weights |
| Latency (full CPU pipeline, Ryzen 7 7435HS, 4 threads) | p50 4.47 s, p95 4.57 s per image |
| Determinism | Same image twice → identical result hash |

## 7. How to reproduce

`powershell -ExecutionPolicy Bypass -File scripts\train.ps1` runs fetch → splits → train all → export → evaluate → extras →
demo. Every stage resumes and skips finished outputs. See 04_RUNBOOK §4 for running a single stage.
