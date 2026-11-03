# 06 · Decisions and risks

## 1. Key decisions and why

| Decision | Why | Trade-off |
|---|---|---|
| DINOv2 ViT-B/14 instead of RETFound as the foundation model | Apache-2.0 and openly downloadable; a 2025 comparison found DINOv2 at least as good for DR detection; RETFound is gated and non-commercial | No retina-specific pretraining |
| Two graders + ensemble | Disagreement is a usable doubt signal; the two architectures make different errors | 2× inference cost; on IDRiD the CNN alone scores higher (0.935 vs 0.917) |
| Multi-source training (v2) | The v1 APTOS-only threshold did not transfer to other cameras (DDR sensitivity 0.30) | DDR test and DeepDRiD val are no longer fully external; IDRiD is the only fully external set |
| Sensitivity-first operating point (validation sensitivity ≥ 0.95) | In screening a missed referral costs far more than an extra review | More human review (70% on IDRiD) and lower specificity |
| Quality and disease branches always both run | From the expanded research findings and NHS guidance: a bad photo with visible disease must not be discarded | More cases to human review |
| Deterministic rule-based policy in `core/policy.py` | Auditable, explainable trace; the same code in the evaluation and the app | Thresholds are global, not per camera |
| ONNX Runtime on CPU | Offline on ordinary laptops; bit-reproducible results | ~4.5 s per image |
| Procedural 3D eye instead of a downloaded GLB | No licence questions, no network, every layer addressable | Less anatomical detail than a sculpted model |
| SQLite + single worker thread | One laptop, one reviewer; simple and robust | Not multi-user |
| Hash-chained audit log | Tamper evidence without a server | Does not stop deletion of the whole database file |
| Sub-agents for repetitive code (UI, backend), lead for ML and integration | Parallel build from written contracts (`docs/04_API.md`) | Sub-agent work was verified by tests and the QA harness, not line by line |

## 2. Licensing

| Asset | Licence | Consequence |
|---|---|---|
| APTOS 2019 images | Kaggle competition rules | Used for training only; never bundled or redistributed. A commercial product must retrain without it |
| IDRiD, DDR | CC-BY 4.0 | Attribution in `server/demo/ATTRIBUTION.md` |
| DeepDRiD | CC-BY-SA 4.0 | Share-alike may affect redistribution of derived weights; check before publishing weights |
| DINOv2 weights | Apache-2.0 | OK |
| timm / smp ImageNet weights | Apache-2.0 / various | OK for research |
| Inter font | OFL | Bundled with licence |

## 3. Clinical and safety risks

- **Not validated.** All numbers come from public retrospective datasets; none is a prospective clinical study. The UI says
  "research prototype, triage aid, not a diagnosis" on every page.
- **Missed referable eyes still occur** (3/286 IDRiD, 66/1,690 DDR). A clinician must review routine results if this is ever used.
- **Thresholds were not reviewed by an ophthalmologist.** This covers the referral definition (grade ≥ 2), the VA cut-off (6/12),
  the urgency mapping and the wording. That review is a precondition for any pilot.
- **Camera shift.** Calibration error on IDRiD is 0.09; probabilities on an unseen camera are less trustworthy than on validation.
- **Macular risk is an image cue only.** DME needs OCT and clinical assessment, and the UI says so.
- **The 3D projection is approximate** and uses a generic eye; it never feeds a decision.
- **Demo encounters** combine images from different people.

## 4. Privacy and security risks

- No login, roles or encryption at rest. Patient photos and records sit unencrypted in `server/storage/`.
- The server binds to 127.0.0.1 only. Exposing it on a network would expose patient data with no authentication.
- No data-retention or deletion policy. India's DPDP Act 2023 requirements are not addressed.
- Uploads are validated (type, size, decode) and SQL access goes through SQLAlchemy, but the app has not had a security review.

## 5. Technical risks

| Risk | Likelihood | Mitigation in place / needed |
|---|---|---|
| Repo size grows with every retrain (models are ~500 MB of parts per version in git history) | Medium | Re-pack only when models change; consider Git LFS or release assets if retrained often |
| WebGL crashes on weak or busy GPUs | Medium | Context-loss recovery, auto low-power, single canvas; real-GPU testing still needed |
| Mock policy (TS) drifts from `core/policy.py` | Medium | Only affects mock mode; add a shared test vector (07) |
| Dependency drift (torch cu128, onnxruntime, timm versions) | Medium | Pin versions in requirements (currently unpinned) |
| SSE or worker stalls under many uploads | Low for one user | Worker is sequential; queue depth not limited |
| Windows-specific paths in scripts | Medium off Windows | `start.sh` exists but is untested |
