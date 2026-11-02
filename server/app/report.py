"""PDF screening report (ReportLab, built-in Helvetica, no network)."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

TITLE = "Retinitry screening report \u2014 research prototype, not a diagnosis"
DISCLAIMER = ("Research prototype. Triage aid, not a diagnosis. Clinician makes the final decision. "
              "Regions and lesion candidates are model outputs for review, not confirmed findings. "
              "External public-dataset evaluation only; not clinically validated.")
MACULAR_TEXT = "Macular finding for review. Not a DME diagnosis."
OUTCOME_TEXT = {"ROUTINE": "Routine rescreen", "REFER": "Refer", "HUMAN_REVIEW": "Needs human review",
                "RETAKE": "Retake photos"}
URGENCY_TEXT = {"routine_12m": "rescreen in 12 months", "soon": "soon (3\u20136 months)", "immediate": "immediate",
                None: "\u2013"}
DASH = "\u2013"
_REPL = {"\u2265": ">=", "\u2264": "<=", "\u2192": "->", "\u00b1": "+/-", "\u2248": "~"}


def _t(s) -> str:
    """Escape for Paragraph markup and keep to characters the built-in fonts can draw (cp1252)."""
    s = "" if s is None else str(s)
    for a, b in _REPL.items():
        s = s.replace(a, b)
    s = s.encode("cp1252", "replace").decode("cp1252")
    return escape(s)


def _f(x, nd=3) -> str:
    return "\u2013" if x is None else f"{float(x):.{nd}f}"


def composite(canonical: Path | None, overlay: Path | None, size: int = 360) -> bytes | None:
    if canonical is None or not canonical.exists():
        return None
    base = cv2.imread(str(canonical), cv2.IMREAD_COLOR)
    if base is None:
        return None
    base = cv2.resize(base, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32)
    if overlay is not None and overlay.exists():
        ov = cv2.imread(str(overlay), cv2.IMREAD_UNCHANGED)
        if ov is not None and ov.ndim == 3 and ov.shape[2] == 4:
            ov = cv2.resize(ov, (size, size), interpolation=cv2.INTER_NEAREST).astype(np.float32)
            a = ov[..., 3:4] / 255.0
            base = base * (1 - a) + ov[..., :3] * a
    ok, buf = cv2.imencode(".jpg", np.clip(base, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes() if ok else None


def build_pdf(enc: dict, file_for: Callable[[str, str], Path | None], generated_at: str) -> bytes:
    """enc: Encounter dict (API shape). file_for(image_id, 'canonical'|'lesions') -> Path or None."""
    buf = io.BytesIO()
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=14, leading=17, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11.5, leading=14, spaceBefore=8, spaceAfter=3)
    h3 = ParagraphStyle("h3", parent=ss["Heading3"], fontSize=10, leading=12, spaceBefore=4, spaceAfter=2)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=8.5, leading=11)
    small = ParagraphStyle("s", parent=body, fontSize=7.2, leading=9, textColor=colors.HexColor("#444444"))

    def P(text, st=body):
        return Paragraph(text, st)

    def table(rows, widths=None):
        t = Table([[P(_t(c)) if not hasattr(c, "wrap") else c for c in r] for r in rows], colWidths=widths)
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#BBBBBB")),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEEEEE")),
                               ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        return t

    story = [P(_t(TITLE), h1)]
    va = enc.get("va") or {}
    story.append(table([
        ["Patient code", "Encounter", "Created (UTC)", "Report generated (UTC)"],
        [enc["patient_code"], enc["id"], enc["created_at"], generated_at],
    ]))
    story.append(Spacer(1, 3))
    story.append(table([
        ["Age", "Sex", "Diabetes (years)", "VA OD", "VA OS", "VA method / operator / measured"],
        [enc.get("age") if enc.get("age") is not None else "\u2013", enc.get("sex") or "\u2013",
         enc.get("diabetes_years") if enc.get("diabetes_years") is not None else "\u2013",
         _va(va.get("OD")), _va(va.get("OS")),
         " / ".join(str(va.get(k) or "\u2013") for k in ("method", "operator", "measured_at"))],
    ]))

    ai = enc.get("ai")
    story.append(P("AI triage (encounter)", h2))
    if ai:
        story.append(P(f"<b>Outcome:</b> {_t(ai['outcome'])} ({_t(OUTCOME_TEXT.get(ai['outcome'], ''))}) &nbsp; "
                       f"<b>Urgency:</b> {_t(URGENCY_TEXT.get(ai.get('urgency'), ai.get('urgency')))} &nbsp; "
                       f"<b>Policy:</b> {_t(ai.get('policy_version'))}"))
        eyes = ai.get("eyes") or {}
        story.append(P("Per eye: " + "; ".join(
            f"{e}: {_t((eyes.get(e) or {}).get('outcome') or DASH)}"
            f"{' (missing)' if (eyes.get(e) or {}).get('missing') else ''}" for e in ("OD", "OS"))))
        if ai.get("flags"):
            story.append(P("<b>Flags for the reviewer:</b>"))
            for f in ai["flags"]:
                story.append(P(f"&bull; {_t(f['code'])}: {_t(f['text'])}"))
    else:
        story.append(P("No completed image analysis."))

    rv = enc.get("review")
    story.append(P("Clinician review", h2))
    if rv:
        story.append(table([
            ["Decision", "Final outcome", "Final urgency", "Reviewer", "Signed (UTC)"],
            [rv["decision"], rv["final_outcome"], URGENCY_TEXT.get(rv.get("final_urgency"), rv.get("final_urgency")),
             rv["reviewer"], rv["at"]],
        ]))
        story.append(P(f"<b>Reason:</b> {_t(rv.get('reason') or DASH)}"))
        if rv.get("acknowledged_flags"):
            story.append(P(f"<b>Acknowledged flags:</b> {_t(', '.join(rv['acknowledged_flags']))}"))
        ref = enc.get("referral")
        if ref:
            story.append(P(f"<b>Referral:</b> {_t(ref['id'])}, status {_t(ref['status'])}, priority "
                           f"{_t(ref.get('priority'))}, issued {_t(ref['issued_at'])}"))
    else:
        story.append(P("<b>Awaiting clinician review.</b> This AI triage has not been confirmed by a clinician."))

    for eye in ("OD", "OS"):
        imgs = [i for i in enc.get("images", []) if i["eye"] == eye]
        story.append(P(f"{'Right eye (OD)' if eye == 'OD' else 'Left eye (OS)'}", h2))
        if not imgs:
            story.append(P("No image for this eye."))
            continue
        for im in imgs:
            story.append(_image_block(im, file_for, P, table, h3, body, small))

    story.append(Spacer(1, 6))
    story.append(P(_t(DISCLAIMER), small))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#555555"))
        canvas.drawString(15 * mm, 9 * mm, "Research prototype. Triage aid, not a diagnosis. Clinician makes the final decision.")
        canvas.drawRightString(A4[0] - 15 * mm, 9 * mm, f"{enc['patient_code']} \u00b7 page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm,
                            bottomMargin=16 * mm, title="Retinitry screening report", author="Retinitry (offline)")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def _va(v: dict | None) -> str:
    if not v or not v.get("value"):
        return "not measured"
    lm = v.get("logmar")
    return f"{v['value']} (logMAR {lm:.2f})" if lm is not None else str(v["value"])


def _image_block(im, file_for, P, table, h3, body, small):
    parts = [P(f"Image {_t(im['id'])} \u00b7 view {_t(im['view'])} \u00b7 FOV {_t(im['fov_deg'])}\u00b0 "
               f"\u00b7 status {_t(im['status'])}", h3)]
    if im["status"] != "done":
        parts.append(P(_t(im.get("error") or "Analysis not complete.")))
        return KeepTogether(parts)
    jpg = composite(file_for(im["id"], "canonical"), file_for(im["id"], "lesions"))
    left = []
    if jpg:
        left.append(Image(io.BytesIO(jpg), width=58 * mm, height=58 * mm))
        left.append(P("Canonical image with model-predicted lesion candidates", small))
    q = im.get("quality") or {}
    g = im.get("grading") or {}
    u = im.get("uncertainty") or {}
    tr = im.get("triage") or {}
    mr = im.get("macular_risk") or {}
    ens = g.get("ensemble") or {}
    right = [
        P(f"<b>AI outcome:</b> {_t(tr.get('outcome'))} &nbsp; <b>Urgency:</b> "
          f"{_t(URGENCY_TEXT.get(tr.get('urgency'), tr.get('urgency')))}"),
        P(f"<b>Quality:</b> {_t(q.get('category'))} (score {_f(q.get('score'), 2)})"
          f"{'; failed: ' + _t(', '.join(q.get('reasons') or [])) if q.get('reasons') else ''}"),
    ]
    for r in tr.get("reasons") or []:
        right.append(P(f"&bull; {_t(r['code'])}: {_t(r['text'])}"))
    probs = ens.get("probs") or []
    rows = [["", "G0", "G1", "G2", "G3", "G4", "P(ref)"]]
    for m in g.get("models") or []:
        rows.append([m["name"], *[_f(p) for p in m["probs"]], _f(m["p_referable"])])
    if probs:
        rows.append([f"ensemble (grade {ens.get('grade')})", *[_f(p) for p in probs], _f(ens.get("p_referable"))])
    right.append(table(rows))
    fl = u.get("flags") or []

    def over(code):
        return "yes" if code in fl else "no"

    right.append(table([
        ["Uncertainty", "Value", "Threshold", "Above threshold"],
        ["Entropy", _f(u.get("entropy")), _f(u.get("entropy_threshold")), over("HIGH_ENTROPY")],
        ["Disagreement", _f(u.get("disagreement")), _f(u.get("disagreement_threshold")), over("DISAGREEMENT")],
        ["OOD score", _f(u.get("ood_score"), 2), _f(u.get("ood_threshold"), 2), over("OOD")],
    ]))
    mtxt = (f"Exudate candidates within 1 disc diameter of the fovea: {mr.get('ex_within_1dd', 0)}. "
            if mr else "")
    right.append(P(f"<b>Macular-risk indicator:</b> {'raised' if mr.get('flag') else 'not raised'}. "
                   f"{_t(mtxt)}{_t(MACULAR_TEXT)}"))
    mv = im.get("model_versions") or {}
    right.append(P(f"<b>Determinism receipt</b> \u00b7 input sha256 {_t(im.get('sha256'))} \u00b7 result hash "
                   f"{_t(im.get('result_hash'))} \u00b7 models "
                   f"{_t(', '.join(f'{k}={v}' for k, v in sorted(mv.items())))}", small))
    t = Table([[left, right]], colWidths=[62 * mm, None])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    parts.append(t)
    return KeepTogether(parts)
