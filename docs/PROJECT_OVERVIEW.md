# Retinitry: project overview

*What it is, why it exists, how it was built, what each part contains, what it does and why, and how it differs from existing tools.*
*Status as of 03 Nov 2026. All numbers are measured and come from `server/models/metrics.json`.*

---

## 1. In one paragraph

Retinitry is a research prototype that helps screen people with diabetes for **diabetic retinopathy (DR)**, the eye damage
diabetes causes. A health worker photographs the back of both eyes and records the patient's eyesight. Retinitry then does
four things:

- checks whether each photo is good enough to judge, and says why if it isn't;
- estimates how severe the disease is and how sure it is of that estimate;
- shows the evidence it used;
- recommends one of four next steps: **routine follow-up**, **refer to a specialist**, **needs a human to look**, or **retake the photo**.

A clinician always makes the final decision. It runs on an ordinary laptop with **no internet and no GPU**, and the same photo always
gives exactly the same answer.

> It is a triage aid, not a diagnosis, and it has not been clinically validated.

---

## 2. The problem

| Fact | Source |
|---|---|
| About 101 million Indians have diabetes | ICMR-INDIAB, Lancet Diabetes Endocrinol 2023 |
| About 17% of diabetics aged 50+ already have retinopathy | NBVIS 2019 |
| Only about 10% of diabetics have ever had a retinal exam | MoHFW / AIIMS 2025 |
| About 1,700 retina specialists for 1.4 billion people | Same |

Early DR causes no symptoms, and the vision loss it leads to is mostly preventable if it's caught early. The bottleneck is
**grading the photos**: deciding which patients need a specialist. AI graders already exist (LumineticsCore, EyeArt, Medios,
MadhuNetrAI), but most behave like black boxes. They return "refer" or "don't refer" and little else. They don't say:

- why a photo was rejected;
- how unsure they are;
- which part of the retina was never photographed;
- what happens to the patient after the referral.

The hackathon brief (Vishwakarandak '26, HEA-S08) asks for a prototype that sorts public retinal images into *refer* vs
*routine follow-up*, explains which image regions drove each result, shows calibrated confidence and rejects poor-quality images.

---

## 3. What makes Retinitry different (USPs)

We don't claim higher accuracy than the cleared commercial tools, which have years of clinical trials behind them. Retinitry's
contribution is the **trust layer around the AI**. It is built to be safe when it's wrong and honest about what it doesn't know.

| # | USP | What it means in practice | Why it matters |
|---|---|---|---|
| 1 | **Explains every rejection** | A bad photo gets reason codes (blur, too dark, glare, field incomplete, vessels unclear, disc or macula not visible), each with its measured value and threshold | The health worker knows *how* to retake, not just *that* they must |
| 2 | **Says "I'm not sure"** | Calibrated confidence plus three doubt signals: how spread out the grade estimate is, how much the two models disagree, and how unusual the photo looks compared with training. Above validated thresholds it hands the case to a person | A tool that knows its limits is safer than one that is always confident |
| 3 | **Never hides visible disease behind a quality rejection** | Quality and disease are judged in parallel. A blurry photo that still shows bleeding goes to human review, not "retake" | Follows NHS screening guidance; prevents a classic miss |
| 4 | **A bad photo can never be marked "routine"** | Inadequate images only ever end as RETAKE or HUMAN REVIEW | Missing evidence is not reassurance |
| 5 | **Clinical safeguards independent of the AI** | Vision worse than 6/12 refers even when the photos look normal. Missing vision is flagged ("missing is not normal"). A hard-exudate cue near the fovea is labelled "macular finding, not a DME diagnosis". The left/right eye is checked from the optic-disc position | From India's operational DR guidelines: DR grade alone is not a complete referral rule |
| 6 | **Three separate kinds of evidence, tested** | (a) where the model looked (heat-maps), (b) model-predicted lesion outlines, (c) anatomy (disc, fovea). Each heat-map was tested: pointing game, deletion test, weight-randomisation sanity check | A heat-map can look convincing and still be meaningless; we checked ours |
| 7 | **Shows what the camera never saw** | The photo is projected onto a 3D eye; the rest of the retina stays grey and is labelled "not imaged" | A "normal" result only covers the photographed patch |
| 8 | **Every decision is traceable** | A deterministic rule set with a step-by-step trace ("Why this outcome"), thresholds with their provenance, model version hashes, a result hash, a **Replay** button that proves the same result, and a hash-chained audit log | Clinicians and programme managers can check the reasoning and catch tampering |
| 9 | **Closes the loop after referral** | Each referral moves through issued → scheduled → attended → specialist feedback → closed, with a reason when it fails and a dashboard of completion | A referral the patient never attends helps no one |
| 10 | **Fully offline, cheap hardware** | Runs on a laptop CPU in about 4.5 s per photo; no images leave the device; no cloud, no account | Works in clinics with weak or no internet; protects patient privacy |
| 11 | **Honest evaluation** | Tested on IDRiD, a hospital and camera the graders never trained on; weaknesses published next to strengths | Avoids the "great on its own data, worse elsewhere" trap |

---

## 4. Who uses it and how

| User | What they do in Retinitry |
|---|---|
| Health worker at a primary health centre | Enters a patient code and vision, uploads photos of both eyes, gets a clear next step and retake reasons |
| Ophthalmologist / reviewer | Works through the **Queue** of cases the AI couldn't settle, reviews the evidence, signs off by holding a button, or overrides with a reason |
| Programme lead | Watches **Referrals** (completion rate, overdue cases), the **Audit** log and the measured model performance on **Evidence** |
| Patient / student | Sees the result on the 3D eye; learns anatomy and optics in the **Eye Lab** |

### A screening, step by step
1. **New screening**: patient code (no names), optional age, sex and years with diabetes; vision for each eye from a wheel picker,
   or "Not measured".
2. **Drop photos** into the right-eye and left-eye circles (macula-centred, disc-centred or other view).
3. **Analysis**: the photo grows in a circle while each step lights up: quality, disc and fovea, first grader, second grader,
   lesions, doubt, decision. The outcome then appears in large type.
4. **Case page**:
   - the 2D photo with switchable layers;
   - the 3D eye;
   - the decision panel: outcome, rule trace, confidence, doubt, quality, safeguards, lesions and the determinism receipt;
   - sign-off.
5. **After sign-off**: a REFER creates a referral to track; the PDF report is available.

---

## 5. Features and why each one exists

### 5.1 Screening outcomes
| Outcome | When | Why |
|---|---|---|
| **ROUTINE** (rescreen in about 12 months) | Adequate photos, no referral trigger, low doubt, both eyes present, vision measured and normal | The only case where the AI can suggest clearance, and still subject to sign-off |
| **REFER**, *soon* (3–6 months) or *immediate* | Probability of grade ≥ 2 above the validated operating point, or vision worse than 6/12 | Follows the AIOS/VRSI consensus pathways |
| **HUMAN REVIEW** | High doubt, the models disagree, an unusual image, lesions that contradict a low score, suspicious signs on a bad photo, a macular finding, a left/right mismatch, or missing vision | Abstaining is the safe failure mode |
| **RETAKE** | Inadequate photo with no visible disease, or a missing eye | There isn't enough evidence to reassure |

### 5.2 The AI components
| Component | What it does | Why this choice |
|---|---|---|
| Quality checks (rules) | Measure focus, brightness, glare, even lighting, field coverage, colour, vessel visibility, and disc/macula visibility | Interpretable reasons a health worker can act on |
| Quality model (EfficientNet-B0) | Learns adequate / usable / inadequate from real DeepDRiD quality labels plus synthetic damage | Catches problems the rules miss; its cut-off is set so at most about 10% of good photos are rejected |
| Grader 1: CNN (EfficientNet-B3) | Grades DR 0–4 and produces a heat-map of where it looked | Fast and good at small local patterns such as tiny bleeds |
| Grader 2: foundation model (DINOv2 ViT-B/14) | Grades DR 0–4 and produces an attention map | Different architecture with different mistakes; pretrained on huge image collections; openly licensed (Apache-2.0) |
| Ensemble + calibration | Averages the two after temperature scaling | "90% sure" should mean right about 90% of the time |
| Doubt layer | Measures the spread of the grade estimate, the disagreement between models, and how unusual the photo is | Drives abstention to human review |
| Lesion model (U-Net) | Outlines microaneurysms, haemorrhages, hard exudates and soft exudates | Evidence a clinician can check, a macular-risk cue, and "lesions contradict the score" alerts |
| Landmark model | Finds the optic disc and fovea | Disc/macula-visible checks, left/right eye, macular distance, and placing the photo on the 3D eye |
| Triage policy (`core/policy.py`) | Plain-code rules turn all of the above into one outcome with a trace | Deterministic, auditable, and the same code is used in the evaluation and the app |

### 5.3 The workflow features
| Feature | Why |
|---|---|
| Both eyes and multiple views per encounter | A single photo is not a full screening; a missing eye is shown |
| Clinician sign-off: acknowledge every flag, hold to approve, override needs a reason | The final decision stays with a person, and overrides are explained |
| Queue sorted by urgency, with keyboard navigation | Reviewers see the most urgent cases first |
| Referral tracking board (drag cards between steps; illegal moves are blocked) | Referral closure, from India's operational guidelines |
| PDF screening report | Something to hand over or file |
| Hash-chained audit log with **Verify chain** | Tamper evidence for every action |
| Determinism receipt and **Replay** | Proves the same input gives the same output |
| Evidence page | The measured results, with axis labels, plain-language takeaways, a glossary and real example cases |
| Eye Lab | Anatomy you can hover and explode, light-ray optics (myopia and hyperopia sliders), DR stages, and how much retina 1, 2 or 4 photos cover |
| Error logging (`logs/client.log`), crash screens and 3D recovery | A crash on one page never kills the app, and every error is recorded |

---

## 6. How well it works (measured)

| Test set | How it relates to training | Photos | AUROC | Sensitivity | Specificity | Referable eyes cleared as ROUTINE |
|---|---|---|---|---|---|---|
| **IDRiD** (India) | **Never used for training or tuning** | 516 | 0.917 | 0.84 | 0.80 | 3 of 286 |
| DDR (China) | Held out; other DDR images used in training | 3,759 | 0.975 | 0.79 | 0.98 | 66 of 1,690 |
| DeepDRiD (China) | Held-out patients | 400 | 0.975 | 0.96 | 0.88 | 1 of 180 |
| APTOS (India) | Held out | 550 | 0.985 | 0.92 | 0.94 | 0 of 223 |

- **Quality gate:** rejects 10% of good photos and flags 80% of poor ones. No ungradable DDR photo was ever cleared as routine.
- **Lesion outlines (Dice, IDRiD):** exudates 0.77, haemorrhages 0.65, soft exudates 0.67, microaneurysms 0.43.
- **Landmarks:** optic disc within one disc-width on 100% of IDRiD test photos, fovea on 98%. Left/right eye is right 98% of the time.
- **Explanations:** heat-map peaks land on an expert-marked lesion 67% (CNN) and 81% (ViT) of the time, against a 23% random baseline.
- **Speed and determinism:** about 4.5 s per photo on a laptop CPU; the same photo always gives an identical result hash.

**Honest weaknesses:**
- On IDRiD the system is cautious: specificity is 0.80 and 70% of cases go to human review. It often calls healthy IDRiD eyes
  mildly diseased.
- Microaneurysm outlines are weak.
- Severe vs moderate (urgency) is unreliable.
- Calibration helps little on new cameras.
- Full details are in `docs/handoff/01_STATUS.md` and `09_VERIFICATION_REPORT.md`.

**How we fixed a real failure.** The first version trained only on APTOS. It ranked cases well on other hospitals, but its
threshold didn't transfer: 641 of 1,690 referable DDR eyes were cleared as routine. Version 2 trains on three sources and uses a
sensitivity-first operating point. That brought the count down to 66, and on IDRiD from 33 to 3.

---

## 7. How it was built

### 7.1 Process
1. **Research and plan.** We read the brief, the 4-day build plan, the expanded research findings (visual acuity, parallel quality,
   image-sets, DeepDRiD, referral closure) and the pitch deck. We wrote the design documents in `docs/01–06` before any code:
   product, architecture, ML, the exact API contract, UI/UX spec and build plan.
2. **Parallel build from written contracts.** The lead (the AI agent that wrote this document) made the product, safety and ML
   decisions, wrote the shared core, the data harness, all training/evaluation/export code and the inference pipeline, and trained
   on the local GPU. Sub-agents built the web app and the backend API against the written contract. Every handover was checked
   by tests.
3. **Data harness.** `ml/data/fetch.py` downloads public datasets from mirrors, crops every image once to a standard square,
   deletes the raw files, and resumes after any interruption.
4. **Training on one laptop GPU** (RTX 4050, 6 GB), with every epoch checkpointed so a crash never meant starting over.
5. **Evaluate, find the failure, fix it.** v1 → v2, as in §6.
6. **Export** every model to ONNX, so it runs on any CPU with identical output.
7. **Verify.** We ran backend tests, front-end tests, an end-to-end script, an automated browser QA run, claim checks against
   `metrics.json`, live safety probes, a leakage audit and a fresh-clone install test.

### 7.2 Technology
| Layer | Technology |
|---|---|
| Training | Python 3.11, PyTorch (CUDA), timm, segmentation-models-pytorch, scikit-learn |
| Runtime inference | ONNX Runtime on CPU, OpenCV, NumPy |
| Backend | FastAPI, SQLite (SQLAlchemy), Server-Sent Events, ReportLab |
| Front end | React 18, TypeScript, Vite, Tailwind, framer-motion, three.js (react-three-fiber), TanStack Query |
| Design | Based on the team's STRONGER app: black canvas, Inter font, glass tab bar, rings, one bold word at the moment of truth |

### 7.3 Data used
| Dataset | Origin | Licence | Used for |
|---|---|---|---|
| APTOS 2019 | Aravind, India | Kaggle competition rules (not redistributed) | Grader training and testing |
| DDR | China, multi-site | CC-BY 4.0 | Grader training and testing; lesion training |
| DeepDRiD | China | CC-BY-SA 4.0 | Grader training; real quality labels; left/right check |
| IDRiD | Nanded, India | CC-BY 4.0 | Fully external grading test; landmark and lesion training; demo images |

---

## 8. What the repository contains

```
retinitry/
├─ START_RETINITRY.bat        one-click start (Windows)
├─ README.md                  how to run, results, where things are
├─ requirements-runtime.txt   Python packages needed to run (pinned)
├─ requirements.txt           extra packages for training
├─ core/                      shared by training and the app
│   ├─ fundus.py              crop / resize / normalise photos
│   ├─ quality.py             quality checks and reason codes
│   └─ policy.py              the triage rules and safety guardrails
├─ ml/                        offline machine learning (needs a GPU)
│   ├─ data/                  dataset download, splits, demo-case picker
│   ├─ train/                 the five models (+ out-of-fold landmarks)
│   ├─ eval/                  calibration, thresholds, metrics, explanation tests, leakage check
│   ├─ export/                ONNX export and self-test
│   └─ run_all.py             runs the whole chain, resumable
├─ server/
│   ├─ app/                   FastAPI app: API, pipeline, database, audit, PDF, worker
│   ├─ models/                fitted thresholds and metrics (JSON); models as parts/ (rebuilt to .onnx on start)
│   ├─ demo/                  six two-eye demo cases (CC-BY images) + attribution
│   └─ tests/                 backend tests
├─ web/
│   ├─ src/                   the React app (pages, components, 3D eye, API client, mock mode)
│   ├─ dist/                  the prebuilt app the server serves
│   └─ qa/ui_qa.mjs           automated browser QA
├─ scripts/                   start, train, models pack/assemble, e2e and verification scripts
└─ docs/
    ├─ PROJECT_OVERVIEW.md    this document
    ├─ 01–07_*.md             the original design documents
    └─ handoff/               status, architecture, results, runbook, code map, risks, next steps, demo, verification
```

Not in the repository: datasets (`data/`, ~2 GB), training checkpoints (`runs/`), logs, and the local case database
(`server/storage/`, which is patient data).

---

## 9. What Retinitry is not

- **Not a diagnosis.** It is a triage aid; a qualified clinician decides.
- **Not clinically validated.** It has only been tested on public retrospective datasets; real use would need prospective trials
  and regulatory approval (CDSCO, as Software as a Medical Device).
- **Not complete eye screening.** It covers diabetic retinopathy only, not glaucoma, cataract or AMD.
- **Not a DME detector.** The macular cue is an image hint; DME needs OCT.
- **The 3D eye is generic,** an approximate projection and not a scan of the patient's eye. It never drives a decision.

---

## 10. Where it can go next

The full backlog is in `docs/handoff/07_NEXT_STEPS.md`.

| Stage | What changes |
|---|---|
| Now | One laptop, SQLite, CPU inference, one reviewer |
| District pilot | Ophthalmologist-reviewed rules, login and roles, encryption, a bundle per health centre, nightly sync, a shared review queue |
| State programme | ABHA-linked records (ABDM), FHIR reports, tele-ophthalmology routing |
| Product | Smartphone fundus cameras with per-camera calibration, an Android build, glaucoma/AMD models, retraining on licensed data, CDSCO approval, DPDP compliance |
