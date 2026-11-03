# 08 · Demo script (3–5 minutes)

**Before:**
1. Start with a clean state: stop the server, delete `server\storage\`, then run `scripts\start.ps1`.
2. Close GPU-heavy apps.
3. Keep `D:\retina\test_images\` handy. It has `RIGHT_eye_OD.jpg` and `LEFT_eye_OS.jpg`.

| Time | Do | Say |
|---|---|---|
| 0:00 | **Today.** Hover the eye, then don't click yet | "Offline screening triage for diabetic eye disease. Everything runs on this laptop." |
| 0:20 | **New screening:** patient code auto, VA right 6/6, left 6/9 → Continue → drop RIGHT_eye_OD.jpg into OD and LEFT_eye_OS.jpg into OS → Analyse | "Vision is an independent safety input. Missing vision is never treated as normal." |
| 0:40 | **Theatre** runs | "Quality, landmarks, two graders, lesion tracing, doubt, then a deterministic decision." |
| 1:10 | Outcome **REFER** (right eye moderate, macular flag). Open case | |
| 1:20 | **Case page:** toggle Attention CNN/ViT, Lesions, Landmarks; Split slider; open "Why this outcome" | "Three separate kinds of evidence: where the model looked, model-predicted lesion candidates, and anatomy. The rule trace shows exactly which rule fired with which numbers." |
| 2:00 | **3D eye:** Inside view, rotate; point at the grey area | "The photo is projected onto a generic eye. The grey is retina the camera never saw, so a normal result only covers the imaged patch." |
| 2:30 | **Sign-off:** tick the macular flag, hold to approve | "The clinician makes the final decision. Override needs a reason." |
| 2:50 | **Referrals:** drag the new card to Scheduled | "Referral closure is tracked, because an AI referral is useless if the patient never arrives." |
| 3:10 | **Today → demo case "Unusable photo of one eye"** | "Bad photos are rejected with a reason, never cleared as routine." |
| 3:30 | **Demo case "Clear photos, reduced vision"** | "Photos look normal, but vision is 6/18, so it refers anyway." |
| 3:50 | **Evidence:** IDRiD tab | "Measured on IDRiD, a hospital and camera the models never trained on: AUROC 0.92, sensitivity 0.84, specificity 0.80. 3 of 286 referable eyes were cleared as routine. We show the weaknesses too." |
| 4:20 | **Settings → Audit → Verify chain**; Replay on a case | "Every action is in a tamper-evident log, and the same photo always gives the same result hash." |

**Questions to expect:**
- **"Why not just use Medios or MadhuNetrAI?"** Retinitry doesn't claim better accuracy. Its contribution is the trust layer
  around a grader: explained rejections, calibrated doubt, evidence layers, a coverage map, clinical guardrails and a closed
  referral loop.
- **"Is it validated?"** No. It uses public retrospective datasets; it is a research prototype.
- **"Why so many human reviews on IDRiD?"** The operating point is sensitivity-first, and camera shift makes the models less
  sure; abstaining is the safe failure mode.
