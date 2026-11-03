# 07 · UI quality pass: what was reported, how each item is verified

User report (03 Nov 2026), after using the real app:

| # | Problem reported | Likely cause to check | How it is verified |
|---|---|---|---|
| 1 | Eye Lab crashed after using it for a while | Several WebGL canvases (Today eye, Case eye, Lab) never disposed → GPU context limit (16 in Chrome) → "context lost"; or a render-time exception with no error boundary blanks the app | Automated: open Lab, cycle every mode 5×, leave and return 10×; record `webglcontextlost`, page errors, live canvas count |
| 2 | App suddenly became unclickable | An invisible full-screen layer (sheet/backdrop, bloom, loupe, theatre overlay, dropped Canvas) left on top with pointer events | Automated: on every page, for every button/link, `elementFromPoint(centre)` must be the element (or inside it); report blockers by selector |
| 3 | Clicking the eye zooms in fully, then opens Eye Lab, which crashes | Today eye click = camera fly-in + route change while the old Canvas is still mounted | Automated: click Today eye → wait → assert Lab rendered, no errors, one canvas |
| 4 | Hovering the eyeball does nothing visible | Hover on the Today eye had no affordance | Hover effect (scale, rim glow, cursor, tooltip) + automated hover check |
| 5 | Placeholder text not visible; things misaligned | Placeholder colour too dark on black; overflow / clipping | Automated: computed contrast of placeholders and labels; detect elements overflowing their container or overlapping |
| 6 | Not clear what is a link or button | Low affordance on links and secondary buttons | Visible hover/focus states and cursor:pointer on every interactive element; audit lists any clickable without them |
| 7 | Laggy | Post-processing on every canvas, high DPR, render loops running off-screen, heavy blur filters | Measure long tasks and FPS per page; cap DPR, `frameloop="demand"` when idle, pause off-screen canvases, lighter blur |
| 8 | No proper logging | Front-end errors invisible | Error boundary per route (friendly fallback, reload button), `window.onerror` / unhandled rejections / WebGL context loss sent to `POST /api/client-log` → `logs/client.log` |
| 9 | Empty/new-data states show nothing useful | Missing placeholders and empty states | Every input has an example placeholder; every list/chart has an explained empty state |
| 10 | Queue / Referrals / Evidence: what do they mean, where is the actual evidence | No plain-language explanation; Evidence shows numbers, not cases | One-line "what this is" header on each page; Evidence gets "How to read this" per card and a gallery of real example cases (correct and failed) |
| 11 | Data is shown prettily but not understandably | Charts without axis labels/legends/plain-language takeaway | Each chart: axis labels, legend, a one-sentence takeaway computed from the data |

Process: (1) instrument logging, (2) run the automated QA harness `web/qa/ui_qa.mjs` against the real server and save a report to `logs/ui_qa.json` + screenshots, (3) fix, (4) re-run until the harness reports zero errors, zero blocked clicks and zero contrast failures, (5) commit.
