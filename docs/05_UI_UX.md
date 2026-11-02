# 05 · UI / UX

The reference is the user's own app, STRONGER (`d:\retina\stronger`, screenshots in `stronger/docs/screens`,
design notes in `stronger/docs/REDESIGN_PLAN.md`). That app sets the taste: pure black, Inter, one huge number,
white as the only accent until something is *earned*, a floating glass capsule tab bar with a sliding lens,
springs everywhere the finger touches, a ring that fills while you hold, a bloom and a single bold word at the
moment of truth ("YOU WON."). Retinitry takes that language to a desktop clinical tool and adds a living 3D eye.

The bar: someone opening it for the first time should say "what is this" out loud. Every interaction responds
within one frame, every state change is animated with physics, and nothing is decorative without meaning.

## 1. Design system

### Type
Inter variable, bundled from `stronger/app/src/main/assets/fonts/Inter.ttf` (OFL) into `web/src/assets/fonts/`.
`font-feature-settings: "ss01","cv11","tnum"` for numbers.

| Token | Size / weight / tracking | Use |
|---|---|---|
| display | 160 / 600 / -4.5% | the outcome word on the theatre, hero numbers |
| hero | 96 / 600 / -4% | Today counters, AUROC ring centre |
| title-xl | 34 / 700 / -1% | page large titles (like "Progress") |
| title | 22 / 600 | card titles |
| headline | 17 / 600 | row titles |
| body | 15 / 400 | body |
| footnote | 13 / 400, 60% white | captions |
| eyebrow | 11 / 600 / +32% uppercase | "WINS"-style labels, "STRONGER"-style brand mark |

### Colour
| Token | Value | Use |
|---|---|---|
| canvas | `#000000` | background, always |
| surface-1 | `#1C1C1E` | grouped cards |
| surface-2 | `#2C2C2E` | raised controls, segmented thumb |
| separator | `#38383A` | hairlines (0.5px on retina screens) |
| label-2 | `rgba(255,255,255,0.6)` | secondary text |
| label-3 | `rgba(255,255,255,0.32)` | tertiary, locked states |
| routine | `#30D158` | ROUTINE |
| refer | `#FF9F0A` | REFER soon |
| urgent | `#FF453A` | REFER immediate, destructive |
| review | `#FFD60A` | HUMAN_REVIEW |
| retake | `#64D2FF` | RETAKE |
| lesion MA / HE / EX / SE | `#FF375F` / `#FF453A` / `#FFD60A` / `#E5E5EA` | lesion layers |
| cam | magma ramp (black→purple→orange→white) at 55% | model attention |

Colour appears only when it carries meaning (an outcome, a lesion type, a fail). Everything else is greyscale.

### Space, shape, depth
8px grid. 24px page margins (desktop 32px). 32px between sections. Cards radius 22px, controls 14px, pills 999px.
No drop shadows on cards; depth comes from blur, glow and light. Glass = `backdrop-filter: blur(24px) saturate(180%)`
with `rgba(28,28,30,0.55)` fill and a 0.5px `rgba(255,255,255,0.08)` inner border. Glass is only for the control
layer (tab bar, toolbars, sheets), never for content.

### Motion
framer-motion everywhere.
- Springs for anything the pointer moves: `{type:"spring", stiffness:380, damping:30}`.
- Screen changes: 350 ms, `cubic-bezier(0.22,1,0.36,1)`, crossfade + 8px rise + `blur(8px)→0`.
- Numbers never jump: they roll (odometer digits) with a spring.
- Lists stagger in at 30 ms per item.
- `prefers-reduced-motion` and a Settings toggle reduce all of this to plain fades.

### Sound (the web's haptics)
A tiny Web Audio synth (`web/src/lib/sound.ts`, no audio files): `tick()` (2 kHz sine, 8 ms), `lowTick()`,
`thud()` (90 Hz sine with fast decay), `rise(duration)` (sweep 220→880 Hz), `success()` (two-note chord),
`fail()` (falling minor third). Used for: tab change (tick), toggle (tick), each pipeline step landing (lowTick),
outcome reveal (thud + chord), hold-to-sign (rise with ticks speeding up, like STRONGER's 45–55 s tension), errors.
Volume low. Off switch in Settings. Respect reduced motion.

### Components
- **GlassTabBar**: floating capsule bottom centre, 64px tall, inset 20px. Tabs: Today, Queue, Referrals, Evidence,
  Eye Lab. Brighter lens pill slides between tabs with a spring and can be dragged; press scales to 0.96; tick sound.
  Badge on Queue with the awaiting-review count.
- **Odometer**: rolling digits for every count.
- **Ring**: SVG ring with a glowing head dot (like the hold ring), animatable 0..1, colour token.
- **OutcomePill**: dot + word, outcome colour, subtle inner glow.
- **GroupedList**: iOS inset grouped rows, 52px, chevron, hairline separators, no subtitles unless needed.
- **Segmented**: sliding thumb segmented control.
- **Switch**: iOS switch, green on.
- **Sheet**: bottom sheet / side sheet with spring, glass, drag to dismiss.
- **HoldButton**: STRONGER's hold circle reused for clinician sign-off (see §3.5).
- **Gauge**: horizontal track with the threshold marked as a tick and the value as a glowing dot; the zone past
  the threshold is tinted. Used for entropy, disagreement, OOD and every quality check.
- **GradeBars**: five vertical bars like STRONGER's week bars (0..4), the predicted grade is white, others grey,
  referable zone (2–4) bracketed underneath. Per-model ghost bars behind the ensemble.
- **Toast**: top-centre glass capsule.
- Footer line on every page in label-3: "Research prototype · triage aid, not a diagnosis · runs offline".

## 2. Navigation and layout

Desktop-first (1280–1920 wide), works down to 1024. Single page app with React Router. Top-left brand mark
`R E T I N I T R Y` (eyebrow tracking) with "One look at a time." under it on Today only. Top-right: offline dot
(green "Offline · on this device"), a gear for Settings, the reviewer's initials. Primary action "New screening"
is a white capsule button (black text) top-right and also the big call to action on Today.

Routes: `/` Today · `/screen/new` capture · `/screen/:encId/analyse` theatre · `/case/:encId` case ·
`/queue` · `/referrals` · `/evidence` · `/lab` Eye Lab · `/settings` · `/audit`.

## 3. Screens

### 3.1 Today (`/`)
The STRONGER Today screen, scaled up.
- Left half: brand, then the hero number (Odometer, display size) = screened today, eyebrow "SCREENED TODAY", then
  "+N this week" and a comparison line ("3 need you" in review gold if any).
- Right half: the **living eye** (3D, R3F) floating in black. It slowly breathes (pupil 2.5↔3.2 mm), and its gaze
  follows the cursor with a spring (max 25°). Blinks every 6–10 s (eyelid-less: quick pupil constrict + iris
  shimmer). Clicking it routes to Eye Lab with a camera fly-in.
- Under the hero: the big round **"Begin screening"** button, STRONGER's HOLD TO WIN circle restyled (click, not hold),
  with the radial glow; hover grows it with a spring.
- Bottom row: four stat tiles (awaiting review, referred today, retakes today, referral completion rate) like the
  streak tiles, then "Recent" horizontal strip of encounter cards (fundus thumbnail in a circle, patient code,
  OutcomePill), and a "Try a demo case" strip using `/api/demo-cases`.
- If `/health` reports missing models: a quiet top banner "Models not installed. Run scripts/fetch_and_train" (no fake data).

### 3.2 New screening (`/screen/new`)
A two-step full-screen flow with a progress capsule at the top.
1. **Patient**: patient code (auto-generated, editable), optional age, sex (segmented), years with diabetes.
   **Visual acuity** for OD and OS: a vertical wheel picker (iOS style) of Snellen values 6/5 … 6/60, CF, HM, PL, NPL,
   plus a clear "Not measured" chip (default, shown in review gold with "Missing is not normal"). Method segmented
   (Snellen / Tumbling E / LogMAR chart), operator name, date default now.
2. **Images**: two big eye slots side by side, labelled "Right eye · OD" and "Left eye · OS" (as you face the patient,
   OD is on the left of the screen). Each slot is a circle drop zone that accepts several images; each dropped image
   becomes a circular thumbnail with a view selector (Macula / Disc / Other) and a FOV field (default 45°). Drag over →
   the circle inhales (scale 1.04) and its ring lights. Paste from clipboard works. Big white "Analyse" button.
   Uploading creates the encounter, posts all images, then routes to the theatre.

### 3.3 Analysis theatre (`/screen/:encId/analyse`)
The emotional centre. Full-screen black, everything else blurs away (like the hold state).
- The current fundus sits centred in a circle that starts at 320px and grows continuously to ~70% of the height
  while it is analysed (STRONGER's growing circle). A ring around it fills with progress; the head dot glows.
- A WebGL scan shader sweeps across the image (a soft luminance band with fine scanlines) while steps run.
- Above the circle, one line at a time cross-fades for each SSE step:
  decode "Reading the photo." → quality "Checking focus and light." → landmarks "Finding the optic disc and fovea." →
  grader_cnn "First grader reading." → grader_vit "Second grader reading." → lesions "Tracing lesion candidates." →
  uncertainty "Measuring doubt." → policy "Deciding the next step."
- As each `partial` arrives it is drawn *on the image*: quality checks tick in as tiny chips around the ring (green
  ticks / gold or red crosses); the disc and fovea get crosshair markers that snap in with a spring and a lowTick;
  the two graders' GradeBars rise beside the circle (left: CNN, right: ViT); lesion candidates ink in as coloured
  contours that draw themselves (stroke-dashoffset); doubt appears as three small gauges.
- At `done`: overshoot (scale 1.06 → 1), a white bloom in the outcome colour, thud + chord, and the outcome word
  in display size above the circle: **"ROUTINE."**, **"REFER."**, **"NEEDS A HUMAN."**, **"RETAKE."**, with one
  line underneath (top reason, e.g. "Estimated grade 3 · P(referable) 0.91" or "Too dark to see the retina.").
- With several images the theatre runs them in sequence with small circles queued at the bottom; then shows the
  encounter outcome. Buttons fade in after 1.2 s: "Open case" (white), "Next patient".

### 3.4 Case (`/case/:encId`)
Three columns on wide screens (2D viewer · 3D eye · decision panel), stacked on narrow screens.
- **Header**: patient code (title-xl), age/sex, created time, encounter OutcomePill (AI) and, after sign-off, the final
  outcome with a seal icon. Eye switcher (OD / OS segmented) and image strip for the views of that eye.
- **2D viewer**: the canonical image on black in a rounded square, zoom (wheel, pinch) and pan with inertia, a
  magnifier loupe on Alt/hover-hold. Layer dock (glass toolbar): Photo, Attention (CNN CAM), Attention (ViT), Lesions
  (with per-type chips MA/HE/EX/SE and counts), Landmarks, Macula ring (1 DD circle around fovea), Unimaged mask.
  Opacity slider per layer. A split-slider mode drags a vertical divider between photo and any layer.
  Hover a lesion → tooltip (type, area, confidence, distance to fovea). Click → selected in 3D and in the list.
  Every layer has its honest caption ("Regions influencing the model score", "Model-predicted lesion candidates").
- **3D eye**: the procedural eye (see §4) with the fundus, CAM and lesion textures projected onto the retina, the
  un-imaged retina grey with a fine hatch and the label "Not imaged". Camera starts outside, then on case open flies
  through the pupil to view the posterior pole from inside (1.6 s, eased). Controls: orbit, zoom, "Inside / Outside",
  "Cross-section" toggle, "Layers" (exploded) toggle, "Reset". Selected lesion pulses on the 3D surface with a
  billboard label. Caption: "Approximate projection onto a generic eye. Not a scan of this patient."
- **Decision panel** (scrolling column of cards):
  1. Outcome card: huge outcome word, urgency, top reasons, "Why this outcome" expands the rule trace as a vertical
     timeline (each rule: fired = bright with value vs threshold; skipped = dim).
  2. Confidence: ensemble GradeBars with per-model ghosts, P(referable) as a Ring with the operating point marked,
     "calibrated (temperature T=…)". Model agreement line ("CNN 0.84 · ViT 0.79 · Δ 0.05").
  3. Doubt: Gauges for entropy, disagreement, OOD with thresholds and provenance tooltip ("set on APTOS validation,
     n=549, target sensitivity 0.90").
  4. Quality: category + every check as a Gauge row with pass/fail.
  5. Clinical safeguards: VA for both eyes (editable inline, re-runs the policy), macular-risk card, laterality check.
  6. Lesions: list grouped by type with counts and areas; click selects.
  7. Determinism receipt: input sha, model hashes, result hash, "Replay" button → spinner → "Identical ✓" with the
     two hashes side by side.
  8. **Sign-off** card, sticky at the bottom (§3.5).

### 3.5 Clinician sign-off
- Flags that need acknowledgement are listed as checkable rows (VA not measured, macular finding, mismatch…). The
  sign-off control stays dim until all are ticked.
- "Approve AI outcome": STRONGER's hold circle, 1.2 s hold. The ring fills, rise sound with accelerating ticks, the
  circle grows slightly; on completion: overshoot, bloom in the outcome colour, "SIGNED." then the seal appears in the
  header. Release early → ring drains with a falling sound.
- "Override": opens a sheet: choose final outcome (four big pills), urgency if REFER, reason (required, with quick
  chips: "Lesions not confirmed", "Artefact", "Additional clinical info", "Image actually adequate", free text),
  then the same hold-to-sign.
- After signing REFER, a referral is issued and a toast links to it.

### 3.6 Queue (`/queue`)
Large title "Queue" + count. Grouped list sorted by priority; each row: circular thumbnail, patient code, flags as
tiny icons, waiting time, OutcomePill. Filter segmented: All / Human review / Refer / Retake. Keyboard: ↑↓ to move,
Enter to open, `A` to open sign-off. Empty state: a calm ring and "Nothing needs you."

### 3.7 Referrals (`/referrals`)
Large title. Hero row of tiles (STRONGER streak tiles): completion rate (Ring), median days to attendance, overdue
(count in urgent red if > 0), feedback received rate. Then a pipeline board with five columns (Issued, Scheduled,
Attended, Feedback, Closed) plus a "Not completed" tray; cards drag between columns (spring physics) which calls
`PUT /referrals/{id}`; illegal moves snap back with a fail sound. Clicking a card opens a side sheet with the
timeline of events and fields (facility, appointment date, specialist feedback, next follow-up).

### 3.8 Evidence (`/evidence`)
The STRONGER Progress screen as a model report card. All numbers come from `/api/metrics`; if unavailable, show
"Evaluation not run yet" — never placeholder numbers.
- Hero: a big Ring for ensemble AUROC on the primary external set, centre number with Odometer, caption with dataset
  and n; below it "sensitivity 0.xx (CI) · specificity 0.xx (CI)".
- Dataset segmented control: APTOS internal / IDRiD external / DDR external. Model segmented: CNN / ViT / Ensemble.
- Cards: ROC curve (animated draw), reliability diagram before vs after calibration (bars + diagonal), risk–coverage
  curve with the chosen operating point, confusion matrix as a 5×5 grid of rounded squares whose brightness = count
  (like STRONGER's 16-week grid), per-grade recall bars, internal vs external comparison table (the drop is shown,
  not hidden), quality evaluation (DeepDRiD real labels, DDR ungradable rejection rate), lesion Dice per type,
  landmark error, explanation tests (pointing game, deletion AUC, randomisation check), latency.
- "Awards"-style row of honest badges that only light when measured: "Calibrated (ECE ↓)", "External test run",
  "Explanations tested", "Determinism verified". Locked ones are outlines.
- Notes list from metrics.json (limitations).

### 3.9 Eye Lab (`/lab`)
Full-screen 3D. Left glass panel with modes:
1. **Anatomy**: hover any part → it glows and a label with a one-line explanation appears (cornea, iris, pupil, lens,
   ciliary body, vitreous, retina, macula/fovea, optic disc, choroid, sclera, optic nerve). "Explode" slider separates
   layers along the axis; "Section" slider moves a clipping plane through the eye with caps rendered.
2. **Optics**: the eye in side section with light rays (a fan of parallel rays from a distant object, or a point
   source at a chosen distance) traced live through the Le Grand schematic eye with Snell's law. Sliders: axial length
   21–28 mm (default 24.2), accommodation 0–8 D, object distance ∞ … 25 cm, pupil diameter 2–8 mm. Read-outs: focus
   point position relative to the retina, refractive state ("Emmetropic", "Myopic −2.5 D", "Hyperopic"), and an inset
   showing the blur circle on the retina. Toggle a corrective lens in front (auto-computed power).
3. **DR stages**: a fundus-textured retina viewed from inside with procedurally placed example lesions per grade
   0–4 (clearly labelled "illustration") and a slider through the grades; each step explains what changes.
4. **Coverage**: compare 1-field 45°, 2-field, 4-field and ultra-widefield caps on the retina, showing why
   single-photo screening misses periphery (cite the meta-analysis numbers in the caption from 01_PRODUCT).

### 3.10 Settings (`/settings`), Audit (`/audit`)
Settings = STRONGER settings: grouped rows. Reviewer name; Sound (switch) + Volume (Soft/Balanced/Strong segmented);
Reduced motion; Show un-imaged region (switch); Default FOV; Threshold provenance (read-only rows from `/api/policy`);
Audit log → `/audit`; About + disclaimer. Footer: "Everything stays on this device."
Audit: timeline list with hash snippets; a "Verify chain" button animates a scan down the list and ends with a green
ring "Chain intact · N entries" or a red marker at the first bad entry.

## 4. The 3D eye (procedural, offline)

No downloaded model: the eye is built from geometry and shaders so every layer is ours to name, explode, clip and
texture, and nothing loads from the network. Units: millimetres, eye axial length 24 mm, optical axis = −Z (front at +Z).

| Part | Geometry | Material |
|---|---|---|
| Sclera | sphere r 12, front cap removed where cornea joins (polar angle < 32°) | warm white, subtle procedural vessels (noise shader), sheen |
| Cornea | spherical cap R 7.8 meeting sclera at the limbus (diameter ~11.7) | MeshPhysicalMaterial transmission 1, ior 1.376, thickness 0.55, clearcoat |
| Iris | annulus, inner radius = pupil (1–4 mm), outer 5.9, at z ≈ +8.5 | procedural radial fibres + crypts, user-selectable colour, collarette ring |
| Lens | biconvex lathe (front R 10.2, back R 6.0, thickness 3.6–4.0, diameter 9) | transmission, ior 1.42, slight yellow |
| Ciliary body | torus behind iris | dark brown |
| Vitreous | sphere r 11.6 | nearly invisible, faint volume for section view |
| Retina | inner sphere r 11.75, posterior ~300° | custom shader: fundus projection (below) |
| Choroid | sphere r 11.85 | deep red |
| Optic nerve | tapered tube leaving the back, 15° nasal of the posterior pole, 3 mm diameter, dural sheath | pale yellow |
| Macula | darker pigmented disc at posterior pole on the retina (texture), fovea pit | — |

Lighting: one key light, one rim light, ambient. Post-processing: bloom (subtle), vignette, SMAA. No `Environment`
presets (they load remote HDRIs). Use a tiny generated cube map if reflections are needed.

### Fundus → globe projection (fragment shader on the retina)
Inputs (uniforms): fundus texture (canonical square), overlay textures, fovea (fx, fy) and disc (dx, dy) normalised,
FOV in degrees, eye (OD/OS). Treat the canonical image centre c = (0.5, 0.5) as the camera axis and the fundus circle
radius r = 0.5 as FOV/2. For an image point q: θ = |q − c| / r · FOV/2, φ = atan2(q − c).
Place the fovea at the posterior pole P = (0, 0, −1) on the unit sphere centred at the eye centre. Compute the camera
axis direction A by rotating P by the fovea's own (θf, φf) in the opposite direction. Orientation: a fundus photo is
seen as if looking into the eye from the front, so image +x maps to world +X and image +y (down) maps to world −Y
(eye looks toward +Z, up = +Y, viewer in front). With the patient facing +Z, the nasal side of the right eye (OD)
is world +X and of the left eye (OS) is world −X, so the 3D optic nerve is placed at +X for OD and −X for OS.
A right-eye photo has its disc on the image's right, so it lands nasally without any mirroring. For each retina fragment with unit direction d: θ = angle(d, A); φ = atan2 in A's tangent
frame; q = c + (θ / (FOV/2)) · r · (cos φ, sin φ). If |q − c| > r or θ > FOV/2 → un-imaged (grey #3A3A3C with 45°
hatch, and a soft 2° fade at the border). Overlays sample the same q. The disc landmark must land within a few
degrees of the 3D optic nerve head; if it does not (eccentricity between fovea and disc ≠ ~15°), scale θ so that the
disc–fovea angle equals 15.5° (anatomical average), and record this in the caption ("scaled to disc–fovea distance").

### Ray optics (Le Grand full theoretical eye)
| Surface | Radius (mm) | Distance to next (mm) | Index after |
|---|---|---|---|
| Anterior cornea | 7.80 | 0.55 | 1.3771 |
| Posterior cornea | 6.50 | 3.05 | 1.3374 |
| Anterior lens | 10.20 | 4.00 | 1.4200 |
| Posterior lens | −6.00 | 16.5966 | 1.3360 |
| Retina | −12 (approx sphere) | — | — |

Trace meridional rays in 2D with vector Snell's law (`t = η i + (η cosθi − cosθt) n`, total internal reflection
handled). Accommodation A (0–8 D): interpolate anterior lens radius 10.2 → 5.0, posterior −6.0 → −5.0, thickness
4.0 → 4.5, anterior chamber shrinks equally. Axial length slider moves the retina; myopia = focus in front of the
retina. Refractive error estimate: find the trial lens power (−10…+10 D, bisection) at the spectacle plane (12 mm)
that puts the paraxial focus on the retina. Unit-test: the default eye focuses parallel rays within 0.2 mm of the
retina at 24.2 mm axial length.

## 5. Tech

React 18 + Vite + TypeScript (strict), React Router, TanStack Query for server state, zustand for UI state,
framer-motion, three + @react-three/fiber + @react-three/drei (OrbitControls, Html, Line — no remote assets) +
@react-three/postprocessing, Tailwind CSS with the tokens above, lucide-react icons (tree-shaken, local). Build output
goes to `web/dist`, served by FastAPI at `/`. Dev server proxies `/api` to 8765. `VITE_MOCK=1` serves fixtures.

## 6. Quality bar (checked before calling the UI done)

1. 60 fps on the case page with the 3D eye on an integrated GPU (drop post-processing on low FPS automatically).
2. No layout shift on load; skeletons shaped like the final content.
3. Every async action has a pending, success and failure state.
4. Keyboard reachable; focus rings visible; contrast AA for text.
5. Honest captions present on every evidence layer, 3D view and the footer.
6. Works with the network unplugged (verify by disabling Wi-Fi).
