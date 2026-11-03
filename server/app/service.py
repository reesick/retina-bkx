"""Business logic behind the HTTP routes: encounters, images, encounter policy, review, referrals, stats.

All writes run under one re-entrant lock so the audit hash chain stays linear. Encounter-level decisions
come from core.policy.triage_encounter; this module only gathers inputs and stores outputs.
"""
from __future__ import annotations

import hashlib
import json
import logging
import statistics
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from core import policy as P

from . import audit
from .db import (AgentRunRow, AuditRow, EncounterRow, ImageRow, LesionRow, ReferralEventRow, ReferralRow, ReviewRow,
                 make_engine, make_sessionmaker)
from .ids import iso, new_id, parse_iso, patient_code, utcnow
from .pipeline import CANON, ModelsMissing
from .storage import OVERLAY_KINDS, Storage
from .worker import Broker, Worker

log = logging.getLogger("retinitry.service")

OUTCOMES = ("ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE")
REFERRAL_NEXT = {"issued": "scheduled", "scheduled": "attended", "attended": "feedback", "feedback": "closed"}
REFERRAL_OPEN = set(REFERRAL_NEXT)
REFERRAL_COMPLETED = {"attended", "feedback", "closed"}
REFERRAL_WITH_FEEDBACK = {"feedback", "closed"}
OVERDUE_NO_APPOINTMENT_DAYS = 30
PRIORITY_BASE = {("REFER", "immediate"): 100.0, ("REFER", "soon"): 80.0, "REFER": 80.0, "HUMAN_REVIEW": 60.0,
                 "RETAKE": 40.0, "ROUTINE": 10.0}
HASHED_KEYS = ("eye", "view", "sha256", "canonical_size", "fov_deg", "quality", "landmarks", "grading",
               "uncertainty", "lesions", "macular_risk", "triage", "model_versions")
RESULT_KEYS = ("canonical_size", "quality", "landmarks", "grading", "uncertainty", "lesions", "macular_risk",
               "triage", "timings_ms", "model_versions")
_NOT_MEASURED = {"", "NM", "NOT MEASURED", "NONE"}


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class Settings:
    data_dir: Path
    models_dir: Path
    demo_dir: Path
    web_dist: Path
    step_min_ms: float = 250.0
    heartbeat_s: float = 15.0


def canonical_json(obj: Any) -> str:
    return audit.canonical_json(obj)


def result_hash(meta: dict, out: dict) -> str:
    """sha256 of the canonical JSON of the result without timings, ids, timestamps, urls, status, error."""
    src = {**meta, **out}
    body = {k: src.get(k) for k in HASHED_KEYS}
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


def _empty_va() -> dict:
    return {"OD": {"value": None, "logmar": None}, "OS": {"value": None, "logmar": None},
            "method": None, "measured_at": None, "operator": None}


def _local_date(ts: str):
    return parse_iso(ts).astimezone().date()


class Service:
    def __init__(self, settings: Settings, pipeline: Any):
        self.settings = settings
        self.pipeline = pipeline
        self.lock = threading.RLock()
        self.pipeline_lock = threading.Lock()
        self.broker = Broker()
        self.worker = Worker(self.process_image)
        self.storage: Storage | None = None
        self.engine = None
        self.Session: Callable[[], Session] | None = None
        self._thumbs: dict[str, bytes] = {}
        self.agents = None

    # ------------------------------------------------------------ lifecycle
    def start(self) -> None:
        if self.Session is not None:
            return
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.storage = Storage(self.settings.data_dir)
        self.engine = make_engine(self.settings.data_dir / "retinitry.db")
        self.Session = make_sessionmaker(self.engine)
        self.worker.start()
        import os as _os
        if _os.environ.get("RETINITRY_AGENTS", "1") != "0":
            from server.agents.runner import AgentRunner
            self.agents = AgentRunner(self, self.settings.data_dir / "agents.db")
            self.agents.start()
        with self.Session() as s:
            pending = s.execute(select(ImageRow).where(ImageRow.status.in_(["queued", "running"]))
                                .order_by(ImageRow.created_at)).scalars().all()
            for r in pending:
                r.status = "queued"
            s.commit()
            for r in pending:
                self.broker.channel(r.id)
                self.worker.submit(r.id)

    def stop(self) -> None:
        if self.agents:
            self.agents.stop()
        self.worker.stop()
        if self.engine is not None:
            self.engine.dispose()

    # ------------------------------------------------------------ policy / models
    def policy(self) -> dict:
        f = self.settings.models_dir / "policy.json"
        if f.exists():
            return {**P.DEFAULT_POLICY, **json.loads(f.read_text(encoding="utf-8"))}
        return dict(P.DEFAULT_POLICY)

    def models_ready(self) -> tuple[bool, str]:
        h = self.pipeline.health()
        if h.get("missing"):
            return False, ("Models are not installed; analysis is unavailable. Missing in "
                           f"{self.settings.models_dir}: {', '.join(h['missing'])}")
        if not h.get("ready", True):
            return False, f"Models failed to load: {h.get('error') or 'unknown error'}"
        return True, ""

    # ------------------------------------------------------------ serialisation
    def image_dict(self, r: ImageRow) -> dict:
        base = f"/api/images/{r.id}"
        d: dict[str, Any] = {
            "id": r.id, "encounter_id": r.encounter_id, "eye": r.eye, "view": r.view, "status": r.status,
            "error": r.error, "created_at": r.created_at, "sha256": r.sha256,
            "urls": {"original": f"{base}/file/original", "canonical": f"{base}/file/canonical",
                     "overlays": {k: f"{base}/overlay/{k}" for k in OVERLAY_KINDS}},
            "canonical_size": CANON, "fov_deg": r.fov_deg,
        }
        if r.result_json:
            res = json.loads(r.result_json)
            for k in RESULT_KEYS:
                if k in res:
                    d[k] = res[k]
            d["result_hash"] = r.result_hash
        return d

    def _images(self, s: Session, enc_id: str) -> list[ImageRow]:
        return list(s.execute(select(ImageRow).where(ImageRow.encounter_id == enc_id)
                              .order_by(ImageRow.created_at, ImageRow.id)).scalars())

    def _review(self, s: Session, enc_id: str) -> ReviewRow | None:
        return s.execute(select(ReviewRow).where(ReviewRow.encounter_id == enc_id)).scalar_one_or_none()

    def _referral(self, s: Session, enc_id: str) -> ReferralRow | None:
        return s.execute(select(ReferralRow).where(ReferralRow.encounter_id == enc_id)).scalar_one_or_none()

    @staticmethod
    def review_dict(r: ReviewRow | None) -> dict | None:
        if r is None:
            return None
        return {"reviewer": r.reviewer, "decision": r.decision, "final_outcome": r.final_outcome,
                "final_urgency": r.final_urgency, "reason": r.reason,
                "acknowledged_flags": json.loads(r.acknowledged_flags_json), "at": r.at}

    def referral_dict(self, s: Session, r: ReferralRow | None) -> dict | None:
        if r is None:
            return None
        evs = s.execute(select(ReferralEventRow).where(ReferralEventRow.referral_id == r.id)
                        .order_by(ReferralEventRow.id)).scalars()
        return {"id": r.id, "encounter_id": r.encounter_id, "status": r.status, "priority": r.priority,
                "facility": r.facility, "issued_at": r.issued_at, "appointment_at": r.appointment_at,
                "attended_at": r.attended_at, "feedback": r.feedback, "next_followup_at": r.next_followup_at,
                "not_completed_reason": r.not_completed_reason,
                "events": [{"from": e.from_status, "to": e.to_status, "note": e.note, "at": e.at} for e in evs]}

    @staticmethod
    def priority(e: EncounterRow, ai: dict | None) -> float:
        if not ai:
            return 0.0
        base = PRIORITY_BASE.get((ai["outcome"], ai.get("urgency")), PRIORITY_BASE.get(ai["outcome"], 0.0))
        waited_min = max(0.0, (utcnow() - parse_iso(e.created_at)).total_seconds() / 60.0)
        return round(base + waited_min / 1000.0, 4)

    def encounter_dict(self, s: Session, e: EncounterRow) -> dict:
        ai = json.loads(e.ai_outcome_json) if e.ai_outcome_json else None
        return {
            "id": e.id, "patient_code": e.patient_code, "age": e.age, "sex": e.sex,
            "diabetes_years": e.diabetes_years, "notes": e.notes or "", "created_at": e.created_at,
            "va": json.loads(e.va_json) if e.va_json else _empty_va(),
            "images": [self.image_dict(i) for i in self._images(s, e.id)],
            "ai": ai, "status": e.status, "review": self.review_dict(self._review(s, e.id)),
            "referral": self.referral_dict(s, self._referral(s, e.id)), "priority": self.priority(e, ai),
        }

    def summary_dict(self, s: Session, e: EncounterRow) -> dict:
        ai = json.loads(e.ai_outcome_json) if e.ai_outcome_json else None
        imgs = self._images(s, e.id)
        done = [i for i in imgs if i.status == "done"]
        return {"id": e.id, "patient_code": e.patient_code, "created_at": e.created_at, "status": e.status,
                "ai_outcome": ai["outcome"] if ai else None, "ai_urgency": ai.get("urgency") if ai else None,
                "final_outcome": e.final_outcome,
                "thumb": f"/api/images/{done[0].id}/file/canonical" if done else None,
                "n_images": len(imgs), "flags": [f["code"] for f in (ai or {}).get("flags", [])],
                "priority": self.priority(e, ai)}

    # ------------------------------------------------------------ helpers
    def _get_enc(self, s: Session, enc_id: str) -> EncounterRow:
        e = s.get(EncounterRow, enc_id)
        if e is None:
            raise ApiError(404, f"encounter {enc_id} not found")
        return e

    def _get_img(self, s: Session, image_id: str) -> ImageRow:
        r = s.get(ImageRow, image_id)
        if r is None:
            raise ApiError(404, f"image {image_id} not found")
        return r

    def recompute(self, s: Session, e: EncounterRow) -> dict | None:
        """Re-run the encounter policy from the done images and current VA; update status."""
        done = [i for i in self._images(s, e.id) if i.status == "done" and i.result_json]
        has_review = self._review(s, e.id) is not None
        if not done:
            e.ai_outcome_json = None
            e.status = "signed" if has_review else "open"
            return None
        run = s.get(AgentRunRow, e.id)
        overrides = json.loads(run.overrides_json) if run and run.overrides_json else {}
        imgs = []
        for i in done:
            res = json.loads(i.result_json)
            tri = res.get("triage")
            ov = overrides.get(i.id)
            if ov and tri and tri.get("outcome") == "HUMAN_REVIEW":
                tri = {**tri, "outcome": ov["outcome"], "urgency": ov.get("urgency"),
                       "reasons": tri["reasons"] + [{"code": "SECOND_OPINION", "text": "Second-opinion agent: all views consistently referable (" + ov.get("detail", "") + ")."}],
                       "rule_trace": tri.get("rule_trace", []) + [{"rule": ov.get("rule", "R3b second opinion"), "fired": True, "detail": ov.get("detail", "")}]}
            imgs.append({"eye": i.eye, "triage": tri, "macular_risk": res.get("macular_risk"),
                         "laterality": (res.get("landmarks") or {}).get("laterality")})
        va = json.loads(e.va_json) if e.va_json else _empty_va()
        ai = P.triage_encounter(images=imgs, va={"OD": va["OD"], "OS": va["OS"]}, policy=self.policy())
        for eye in ("OD", "OS"):
            ai["eyes"].setdefault(eye, {"outcome": None, "missing": True})
            ai["eyes"][eye].setdefault("urgency", None)
        e.ai_outcome_json = canonical_json(ai)
        e.status = "signed" if has_review else "awaiting_review"
        return ai

    # ------------------------------------------------------------ encounters
    def create_encounter(self, body: dict, actor: str = "user") -> dict:
        with self.lock, self.Session() as s:
            code = (body.get("patient_code") or "").strip()
            if not code:
                code = patient_code(datetime.now().astimezone(), lambda c: s.execute(
                    select(func.count()).select_from(EncounterRow).where(EncounterRow.patient_code == c)).scalar() > 0)
            e = EncounterRow(id=new_id("enc"), patient_code=code, age=body.get("age"), sex=body.get("sex"),
                             diabetes_years=body.get("diabetes_years"), notes=body.get("notes") or "",
                             created_at=iso(), va_json=canonical_json(_empty_va()), status="open")
            s.add(e)
            s.flush()
            audit.append(s, "encounter_created", encounter_id=e.id, actor=actor, payload={"patient_code": code})
            s.commit()
            return self.encounter_dict(s, e)

    def get_encounter(self, enc_id: str) -> dict:
        with self.Session() as s:
            return self.encounter_dict(s, self._get_enc(s, enc_id))

    def list_encounters(self, status: str | None, outcome: str | None, q: str | None, limit: int) -> list[dict]:
        with self.Session() as s:
            stmt = select(EncounterRow).order_by(EncounterRow.created_at.desc(), EncounterRow.id.desc())
            if status:
                stmt = stmt.where(EncounterRow.status == status)
            out = []
            ql = (q or "").strip().lower()
            for e in s.execute(stmt).scalars():
                ai = json.loads(e.ai_outcome_json) if e.ai_outcome_json else None
                if outcome and outcome not in ((ai or {}).get("outcome"), e.final_outcome):
                    continue
                if ql and ql not in e.patient_code.lower() and ql not in e.id.lower() and ql not in (e.notes or "").lower():
                    continue
                out.append(self.summary_dict(s, e))
                if len(out) >= limit:
                    break
            return out

    def queue(self) -> list[dict]:
        with self.Session() as s:
            rows = s.execute(select(EncounterRow).where(EncounterRow.status == "awaiting_review")).scalars()
            items = [self.summary_dict(s, e) for e in rows]
        return sorted(items, key=lambda d: (-d["priority"], d["created_at"]))

    def patch_encounter(self, enc_id: str, fields: dict, actor: str = "user") -> dict:
        with self.lock, self.Session() as s:
            e = self._get_enc(s, enc_id)
            changed = {}
            for k in ("patient_code", "age", "sex", "diabetes_years", "notes"):
                if k in fields:
                    v = fields[k]
                    if k == "patient_code":
                        v = (v or "").strip()
                        if not v:
                            raise ApiError(400, "patient_code cannot be empty")
                    if k == "notes":
                        v = v or ""
                    if getattr(e, k) != v:
                        setattr(e, k, v)
                        changed[k] = v
            if changed:
                audit.append(s, "encounter_updated", encounter_id=e.id, actor=actor, payload={"fields": changed})
            s.commit()
            return self.encounter_dict(s, e)

    def update_va(self, enc_id: str, body: dict) -> dict:
        va = _empty_va()
        for eye in ("OD", "OS"):
            raw = ((body.get(eye) or {}).get("value"))
            raw = None if raw is None else str(raw).strip()
            if raw is None or raw.upper() in _NOT_MEASURED:
                continue
            lm = P.va_to_logmar(raw)
            if lm is None:
                raise ApiError(400, f"unrecognised visual acuity for {eye}: {raw!r} (use e.g. 6/9, 20/40, 0.3, CF, HM, PL, NPL)")
            va[eye] = {"value": raw, "logmar": round(lm, 4)}
        if body.get("measured_at"):
            try:
                parse_iso(body["measured_at"])
            except ValueError:
                raise ApiError(400, "measured_at must be an ISO-8601 timestamp")
        va["method"] = body.get("method")
        va["operator"] = body.get("operator")
        va["measured_at"] = body.get("measured_at") or (iso() if (va["OD"]["value"] or va["OS"]["value"]) else None)
        actor = body.get("operator") or "user"
        with self.lock, self.Session() as s:
            e = self._get_enc(s, enc_id)
            e.va_json = canonical_json(va)
            ai = self.recompute(s, e)
            audit.append(s, "va_updated", encounter_id=e.id, actor=actor,
                         payload={"va": va, "ai_outcome": ai["outcome"] if ai else None,
                                  "flags": [f["code"] for f in (ai or {}).get("flags", [])]})
            s.commit()
            out = self.encounter_dict(s, e)
        self._maybe_start_agents(enc_id)
        return out

    # ------------------------------------------------------------ images
    def add_image(self, enc_id: str, data: bytes, filename: str | None, content_type: str | None,
                  eye: str, view: str, fov_deg: float, actor: str = "user") -> dict:
        with self.lock, self.Session() as s:
            e = self._get_enc(s, enc_id)
            if e.status == "signed":
                raise ApiError(409, "encounter is signed; images cannot be added")
            img_id = new_id("img")
            sha = hashlib.sha256(data).hexdigest()
            ext = Storage.pick_ext(filename, content_type)
            p = self.storage.save_original(img_id, data, ext)
            r = ImageRow(id=img_id, encounter_id=e.id, eye=eye, view=view, camera=None, fov_deg=float(fov_deg),
                         sha256=sha, path_original=self.storage.rel(p), path_canonical=None, status="queued",
                         error=None, created_at=iso())
            s.add(r)
            s.flush()
            audit.append(s, "image_uploaded", encounter_id=e.id, image_id=img_id, actor=actor,
                         payload={"eye": eye, "view": view, "fov_deg": float(fov_deg), "sha256": sha, "bytes": len(data)})
            s.commit()
            d = self.image_dict(r)
        self.broker.channel(img_id)
        self.worker.submit(img_id)
        return d

    def get_image(self, image_id: str) -> dict:
        with self.Session() as s:
            return self.image_dict(self._get_img(s, image_id))

    def image_status(self, image_id: str) -> tuple[str, dict]:
        with self.Session() as s:
            r = self._get_img(s, image_id)
            return r.status, self.image_dict(r)

    def image_file(self, image_id: str, which: str) -> Path:
        with self.Session() as s:
            r = self._get_img(s, image_id)
            rel = r.path_original if which == "original" else r.path_canonical
        if not rel:
            raise ApiError(404, f"{which} image not available yet")
        p = self.storage.abs(rel)
        if not p.exists():
            raise ApiError(404, f"{which} file missing")
        return p

    def overlay_file(self, image_id: str, kind: str) -> Path:
        with self.Session() as s:
            self._get_img(s, image_id)
        p = self.storage.overlay_path(image_id, kind)
        if not p.exists():
            raise ApiError(404, f"overlay {kind} not available")
        return p

    def delete_image(self, enc_id: str, image_id: str, actor: str = "user") -> dict:
        with self.lock, self.Session() as s:
            e = self._get_enc(s, enc_id)
            r = s.get(ImageRow, image_id)
            if r is None or r.encounter_id != enc_id:
                raise ApiError(404, f"image {image_id} not found in encounter {enc_id}")
            if e.status == "signed":
                raise ApiError(409, "encounter is signed; images cannot be deleted")
            payload = {"eye": r.eye, "view": r.view, "sha256": r.sha256, "status": r.status}
            s.execute(delete(LesionRow).where(LesionRow.image_id == image_id))
            s.delete(r)
            s.flush()
            ai = self.recompute(s, e)
            payload["ai_outcome"] = ai["outcome"] if ai else None
            audit.append(s, "image_deleted", encounter_id=e.id, image_id=image_id, actor=actor, payload=payload)
            s.commit()
            out = self.encounter_dict(s, e)
        self.storage.delete(image_id)
        self.broker.publish(image_id, "error", {"message": "image deleted"})
        return out

    def _run_pipeline(self, data: bytes, eye: str, view: str, fov: float, emit) -> dict:
        with self.pipeline_lock:
            return self.pipeline.run(data, eye, view, fov, emit)

    def process_image(self, image_id: str) -> None:
        """Worker handler: analyse one queued image, store results, recompute the encounter, publish events."""
        with self.lock, self.Session() as s:
            r = s.get(ImageRow, image_id)
            if r is None or r.status not in ("queued", "running"):
                return
            r.status = "running"
            s.commit()
            meta = {"eye": r.eye, "view": r.view, "sha256": r.sha256, "fov_deg": r.fov_deg}
            path = self.storage.abs(r.path_original)

        def emit(step, status, partial=None, ms=None):
            ev: dict[str, Any] = {"step": step, "status": status}
            if ms is not None:
                ev["ms"] = ms
            if partial is not None:
                ev["partial"] = partial
            self.broker.publish(image_id, "step", ev)

        try:
            data = path.read_bytes()
            out = self._run_pipeline(data, meta["eye"], meta["view"], meta["fov_deg"], emit)
        except ModelsMissing as ex:
            return self._fail(image_id, str(ex))
        except ValueError as ex:
            return self._fail(image_id, f"could not analyse image: {ex}")
        except Exception as ex:  # keep the worker alive, surface the error
            log.exception("pipeline failed for %s", image_id)
            return self._fail(image_id, f"analysis failed: {type(ex).__name__}: {ex}")

        rh = result_hash(meta, out)
        res = {k: out[k] for k in RESULT_KEYS if k in out}
        canon = self.storage.save_results(image_id, out["canonical_jpeg"], out.get("overlays") or {})
        with self.lock, self.Session() as s:
            r = s.get(ImageRow, image_id)
            if r is None:  # deleted while running
                self.storage.delete(image_id)
                return
            r.status, r.error = "done", None
            r.result_json = canonical_json(res)
            r.result_hash = rh
            r.path_canonical = self.storage.rel(canon)
            s.execute(delete(LesionRow).where(LesionRow.image_id == image_id))
            for it in (res.get("lesions") or {}).get("items", []):
                s.add(LesionRow(id=f"{image_id}_{it['id']}", image_id=image_id, type=it["type"],
                                bbox_json=canonical_json(it["bbox"]), centroid_json=canonical_json(it["centroid"]),
                                area_frac=it["area_frac"], confidence=it["confidence"],
                                dist_fovea_dd=it.get("dist_fovea_dd")))
            e = s.get(EncounterRow, r.encounter_id)
            ai = self.recompute(s, e)
            tri = res.get("triage") or {}
            audit.append(s, "image_analysed", encounter_id=r.encounter_id, image_id=image_id, actor="system",
                         payload={"sha256": r.sha256, "result_hash": rh, "outcome": tri.get("outcome"),
                                  "urgency": tri.get("urgency"), "model_versions": res.get("model_versions"),
                                  "encounter_outcome": ai["outcome"] if ai else None})
            s.commit()
            done = self.image_dict(r)
            enc_id = r.encounter_id
        self.broker.publish(image_id, "done", done)
        self._maybe_start_agents(enc_id)

    def _fail(self, image_id: str, message: str) -> None:
        with self.lock, self.Session() as s:
            r = s.get(ImageRow, image_id)
            if r is None:
                return
            r.status, r.error = "error", message
            e = s.get(EncounterRow, r.encounter_id)
            self.recompute(s, e)
            audit.append(s, "image_failed", encounter_id=r.encounter_id, image_id=image_id, actor="system",
                         payload={"sha256": r.sha256, "error": message})
            s.commit()
            enc_id = r.encounter_id
        self.broker.publish(image_id, "error", {"message": message})
        self._maybe_start_agents(enc_id)

    def replay(self, image_id: str) -> dict:
        with self.Session() as s:
            r = self._get_img(s, image_id)
            if r.status != "done" or not r.result_hash:
                raise ApiError(400, "image has no completed analysis to replay")
            meta = {"eye": r.eye, "view": r.view, "sha256": r.sha256, "fov_deg": r.fov_deg}
            original_hash, enc_id = r.result_hash, r.encounter_id
            path = self.storage.abs(r.path_original)
        ok, msg = self.models_ready()
        if not ok:
            raise ApiError(503, msg)
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != meta["sha256"]:
            replay_hash, ms = None, 0.0
        else:
            t0 = time.perf_counter()
            try:
                out = self._run_pipeline(data, meta["eye"], meta["view"], meta["fov_deg"], lambda *a, **k: None)
            except ModelsMissing as ex:
                raise ApiError(503, str(ex))
            ms = round((time.perf_counter() - t0) * 1000, 1)
            replay_hash = result_hash(meta, out)
        match = replay_hash == original_hash
        with self.lock, self.Session() as s:
            audit.append(s, "replay_checked", encounter_id=enc_id, image_id=image_id, actor="user",
                         payload={"match": match, "original_hash": original_hash, "replay_hash": replay_hash, "ms": ms})
            s.commit()
        return {"match": match, "original_hash": original_hash, "replay_hash": replay_hash, "ms": ms}

    # ------------------------------------------------------------ review
    def review(self, enc_id: str, body: dict) -> dict:
        with self.lock, self.Session() as s:
            e = self._get_enc(s, enc_id)
            if self._review(s, enc_id) is not None:
                raise ApiError(409, "encounter already signed; re-review is not allowed")
            ai = json.loads(e.ai_outcome_json) if e.ai_outcome_json else None
            if ai is None:
                raise ApiError(400, "no completed image analysis to review")
            reviewer = (body.get("reviewer") or "").strip()
            if not reviewer:
                raise ApiError(400, "reviewer is required")
            decision, final = body["decision"], body["final_outcome"]
            reason = (body.get("reason") or "").strip()
            if decision == "override" and not reason:
                raise ApiError(400, "override requires a non-empty reason")
            if decision == "approve" and final != ai["outcome"]:
                raise ApiError(400, f"approve keeps the AI outcome {ai['outcome']}; use decision 'override' to change it")
            ack = [str(c) for c in (body.get("acknowledged_flags") or [])]
            missing = [f["code"] for f in ai.get("flags", []) if f["code"] not in ack]
            if missing:
                raise ApiError(400, f"all flags must be acknowledged; missing: {', '.join(missing)}")
            urg = body.get("final_urgency")
            if final == "REFER":
                if urg is None:
                    urg = ai.get("urgency") if ai["outcome"] == "REFER" and ai.get("urgency") else "soon"
                if urg not in ("soon", "immediate"):
                    raise ApiError(400, "final_urgency for REFER must be 'soon' or 'immediate'")
            elif final == "ROUTINE":
                if urg not in (None, "routine_12m"):
                    raise ApiError(400, "final_urgency for ROUTINE must be 'routine_12m' or omitted")
                urg = "routine_12m"
            else:
                if urg is not None:
                    raise ApiError(400, f"final_urgency must be null for {final}")
            at = iso()
            s.add(ReviewRow(id=new_id("rev"), encounter_id=e.id, reviewer=reviewer, decision=decision,
                            final_outcome=final, final_urgency=urg, reason=reason,
                            acknowledged_flags_json=canonical_json(ack), at=at))
            e.status, e.final_outcome, e.final_urgency = "signed", final, urg
            ref_id = None
            if final == "REFER":
                ref_id = new_id("ref")
                s.add(ReferralRow(id=ref_id, encounter_id=e.id, status="issued", priority=urg, issued_at=at,
                                  updated_at=at))
                s.flush()
                s.add(ReferralEventRow(referral_id=ref_id, from_status=None, to_status="issued",
                                       note="Referral issued at clinician sign-off", at=at))
            s.flush()
            audit.append(s, "review_signed", encounter_id=e.id, actor=reviewer,
                         payload={"decision": decision, "final_outcome": final, "final_urgency": urg,
                                  "ai_outcome": ai["outcome"], "ai_urgency": ai.get("urgency"), "reason": reason,
                                  "acknowledged_flags": ack, "referral_id": ref_id})
            if ref_id:
                audit.append(s, "referral_moved", encounter_id=e.id, actor=reviewer,
                             payload={"referral_id": ref_id, "from": None, "to": "issued", "note": ""})
            s.commit()
            out = self.encounter_dict(s, e)
        if self.agents:
            self.agents.submit("resume", enc_id, {"reviewer": reviewer, "decision": decision, "final_outcome": final,
                                                  "final_urgency": urg, "reason": reason})
        return out

    # ------------------------------------------------------------ referrals
    def move_referral(self, ref_id: str, body: dict, actor: str = "user") -> dict:
        to = body["to"]
        for k in ("appointment_at", "attended_at", "next_followup_at"):
            if body.get(k):
                try:
                    parse_iso(body[k])
                except ValueError:
                    raise ApiError(400, f"{k} must be an ISO-8601 timestamp")
        with self.lock, self.Session() as s:
            r = s.get(ReferralRow, ref_id)
            if r is None:
                raise ApiError(404, f"referral {ref_id} not found")
            cur = r.status
            if to == "not_completed":
                if cur not in REFERRAL_OPEN:
                    raise ApiError(409, f"illegal referral move {cur} -> {to}")
                reason = (body.get("not_completed_reason") or "").strip()
                if not reason:
                    raise ApiError(400, "not_completed_reason is required")
                r.not_completed_reason = reason
            elif REFERRAL_NEXT.get(cur) != to:
                raise ApiError(409, f"illegal referral move {cur} -> {to}")
            now = iso()
            if body.get("facility") is not None:
                r.facility = body["facility"]
            if body.get("appointment_at"):
                r.appointment_at = body["appointment_at"]
            if body.get("attended_at"):
                r.attended_at = body["attended_at"]
            elif to == "attended":
                r.attended_at = now
            if body.get("feedback") is not None:
                r.feedback = body["feedback"]
            if body.get("next_followup_at"):
                r.next_followup_at = body["next_followup_at"]
            r.status, r.updated_at = to, now
            note = body.get("note") or ""
            s.add(ReferralEventRow(referral_id=r.id, from_status=cur, to_status=to, note=note, at=now))
            s.flush()
            audit.append(s, "referral_moved", encounter_id=r.encounter_id, actor=actor,
                         payload={"referral_id": r.id, "from": cur, "to": to, "note": note,
                                  "fields": {k: body.get(k) for k in ("facility", "appointment_at", "attended_at",
                                                                       "feedback", "next_followup_at",
                                                                       "not_completed_reason") if body.get(k) is not None}})
            s.commit()
            return self.referral_dict(s, r)

    @staticmethod
    def is_overdue(r: ReferralRow, now: datetime) -> bool:
        if r.status not in ("issued", "scheduled") or r.attended_at:
            return False
        if r.appointment_at:
            return parse_iso(r.appointment_at) < now
        return r.status == "issued" and now - parse_iso(r.issued_at) > timedelta(days=OVERDUE_NO_APPOINTMENT_DAYS)

    def referrals(self, status: str | None) -> dict:
        now = utcnow()
        with self.Session() as s:
            rows = list(s.execute(select(ReferralRow).order_by(ReferralRow.issued_at.desc())).scalars())
            codes = dict(s.execute(select(EncounterRow.id, EncounterRow.patient_code)).all())
            items = [{**self.referral_dict(s, r), "patient_code": codes.get(r.encounter_id, "")}
                     for r in rows if not status or r.status == status]
        total = len(rows)
        days = [(parse_iso(r.attended_at) - parse_iso(r.issued_at)).total_seconds() / 86400.0
                for r in rows if r.attended_at and r.status in REFERRAL_COMPLETED]
        stats = {
            "total": total,
            "completed_rate": round(sum(r.status in REFERRAL_COMPLETED for r in rows) / total, 4) if total else 0.0,
            "median_days_to_attend": round(statistics.median(days), 2) if days else None,
            "overdue": sum(self.is_overdue(r, now) for r in rows),
            "with_feedback_rate": round(sum(r.status in REFERRAL_WITH_FEEDBACK for r in rows) / total, 4) if total else 0.0,
        }
        return {"items": items, "stats": stats}

    # ------------------------------------------------------------ stats / audit
    def stats_today(self) -> dict:
        today = datetime.now().astimezone().date()
        out = {"screened_today": 0, "awaiting_review": 0, "referred_today": 0, "retake_today": 0, "total": 0}
        with self.Session() as s:
            for e in s.execute(select(EncounterRow)).scalars():
                out["total"] += 1
                if e.status == "awaiting_review":
                    out["awaiting_review"] += 1
                if _local_date(e.created_at) != today or not e.ai_outcome_json:
                    continue
                out["screened_today"] += 1
                eff = e.final_outcome or json.loads(e.ai_outcome_json)["outcome"]
                out["referred_today"] += eff == "REFER"
                out["retake_today"] += eff == "RETAKE"
        return out

    def audit_items(self, encounter_id: str | None, limit: int) -> dict:
        with self.Session() as s:
            stmt = select(AuditRow).order_by(AuditRow.seq.desc()).limit(limit)
            if encounter_id:
                stmt = stmt.where(AuditRow.encounter_id == encounter_id)
            return {"items": [audit.to_dict(r) for r in s.execute(stmt).scalars()]}

    def audit_verify(self) -> dict:
        with self.Session() as s:
            return audit.verify(s)

    # ------------------------------------------------------------ demo cases
    def demo_cases(self) -> list[dict]:
        f = self.settings.demo_dir / "cases.json"
        if not f.exists():
            return []
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else data.get("cases", [])

    def demo_case(self, name: str) -> tuple[dict, Path]:
        for c in self.demo_cases():
            if c.get("name") == name:
                root = self.settings.demo_dir.resolve()
                p = (root / c["file"]).resolve()
                if not p.is_relative_to(root) or not p.exists():
                    raise ApiError(404, f"demo file for {name} not found")
                return c, p
        raise ApiError(404, f"demo case {name} not found")

    def demo_thumb(self, name: str) -> bytes:
        if name in self._thumbs:
            return self._thumbs[name]
        import cv2
        import numpy as np

        _, p = self.demo_case(name)
        img = cv2.imdecode(np.frombuffer(p.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ApiError(404, f"demo image for {name} cannot be decoded")
        h, w = img.shape[:2]
        sc = 320.0 / max(h, w)
        if sc < 1:
            img = cv2.resize(img, (max(1, int(w * sc)), max(1, int(h * sc))), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        self._thumbs[name] = buf.tobytes()
        return self._thumbs[name]

    def create_demo(self, name: str) -> dict:
        c, p = self.demo_case(name)
        ok, msg = self.models_ready()
        if not ok:
            raise ApiError(503, msg)
        eye = c.get("eye", "OD")
        view = c.get("view", "macula")
        fov = float(c.get("fov_deg", 45))
        enc = self.create_encounter({"patient_code": f"DEMO-{name}", "notes": c.get("title", "")}, actor="demo")
        if c.get("va"):
            self.update_va(enc["id"], {"OD": {"value": c["va"].get("OD")}, "OS": {"value": c["va"].get("OS")},
                                       "method": c["va"].get("method", "Snellen"), "measured_at": None,
                                       "operator": "demo"})
        imgs = c.get("images") or [{"file": c.get("file"), "eye": eye, "view": view, "fov_deg": fov}]
        for im in imgs:
            ip = (self.settings.demo_dir / im["file"]).resolve()
            if self.settings.demo_dir.resolve() not in ip.parents or not ip.exists():
                raise ApiError(404, f"demo image missing: {im['file']}")
            self.add_image(enc["id"], ip.read_bytes(), ip.name, None, im.get("eye", eye), im.get("view", view),
                           float(im.get("fov_deg", fov)), actor="demo")
        return self.get_encounter(enc["id"])


    # ------------------------------------------------------------ agents (LangGraph)
    def _maybe_start_agents(self, enc_id: str) -> None:
        """Start a new agent run once every image of an unsigned encounter is finished."""
        if not self.agents:
            return
        with self.lock, self.Session() as s:
            e = s.get(EncounterRow, enc_id)
            if e is None or e.status == "signed":
                return
            imgs = self._images(s, enc_id)
            if not imgs or any(i.status in ("queued", "running") for i in imgs) or not any(i.status == "done" for i in imgs):
                return
        self.agents.submit("start", enc_id)

    def agent_tools(self):
        svc = self

        class _T:
            pipeline = svc.pipeline
            pipeline_lock = svc.pipeline_lock

            @staticmethod
            def get_encounter(enc_id: str) -> dict:
                return svc.get_encounter(enc_id)

            @staticmethod
            def image_bytes(image_id: str) -> bytes:
                with svc.Session() as s:
                    r = svc._get_img(s, image_id)
                    return svc.storage.abs(r.path_original).read_bytes()

            @staticmethod
            def policy() -> dict:
                return svc.policy()

            @staticmethod
            def set_overrides(enc_id: str, overrides: dict) -> dict:
                with svc.lock, svc.Session() as s:
                    e = svc._get_enc(s, enc_id)
                    run = s.get(AgentRunRow, enc_id)
                    if run is None:
                        return svc.encounter_dict(s, e)
                    run.overrides_json = canonical_json(overrides)
                    s.flush()
                    ai = svc.recompute(s, e)
                    audit.append(s, "agent_override", encounter_id=enc_id, actor="agent:second_opinion",
                                 payload={"overrides": overrides, "encounter_outcome": ai["outcome"] if ai else None})
                    s.commit()
                    return svc.encounter_dict(s, e)

            @staticmethod
            def audit(enc_id: str, event: str, payload: dict) -> None:
                with svc.lock, svc.Session() as s:
                    audit.append(s, event, encounter_id=enc_id, actor="agent", payload=payload)
                    s.commit()

            @staticmethod
            def facility(enc_id: str):
                with svc.Session() as s:
                    r = svc._referral(s, enc_id)
                    return r.facility if r else None

        return _T

    def agent_new_run(self, enc_id: str) -> tuple[int, str]:
        with self.lock, self.Session() as s:
            run = s.get(AgentRunRow, enc_id)
            n = (run.run_no + 1) if run else 1
            tid = f"{enc_id}:{n}"
            if run is None:
                run = AgentRunRow(encounter_id=enc_id, thread_id=tid, run_no=n, status="queued", updated_at=iso())
                s.add(run)
            else:
                run.thread_id, run.run_no, run.status, run.error, run.state_json = tid, n, "queued", None, None
                had = run.overrides_json not in (None, "", "{}")
                run.overrides_json = "{}"
                if had:   # inputs changed: drop the previous run's upgrades until the new run decides again
                    s.flush()
                    self.recompute(s, self._get_enc(s, enc_id))
            run.updated_at = iso()
            s.commit()
            return n, tid

    def agent_thread(self, enc_id: str) -> str | None:
        with self.Session() as s:
            run = s.get(AgentRunRow, enc_id)
            return run.thread_id if run else None

    def agent_save(self, enc_id: str, status: str, state: dict | None = None, error: str | None = None) -> None:
        with self.lock, self.Session() as s:
            run = s.get(AgentRunRow, enc_id)
            if run is None:
                return
            run.status = status
            if state is not None:
                run.state_json = json.dumps(state, default=str)
            if error is not None:
                run.error = error
            run.updated_at = iso()
            s.commit()

    def agent_state(self, enc_id: str) -> dict:
        from server.agents import llm as L

        with self.Session() as s:
            self._get_enc(s, enc_id)
            run = s.get(AgentRunRow, enc_id)
            base = {"available": bool(self.agents and self.agents.ready), "llm": L.status()}
            if run is None:
                return {**base, "status": "not_started"}
            st = json.loads(run.state_json) if run.state_json else {}
            return {**base, "status": run.status, "run_no": run.run_no, "thread_id": run.thread_id, "error": run.error,
                    "updated_at": run.updated_at, "overrides": json.loads(run.overrides_json or "{}"),
                    "trace": st.get("trace", []), "second_opinion": st.get("second_opinion", {}),
                    "coaching": st.get("coaching", {}), "brief": st.get("brief"), "letter": st.get("letter"),
                    "next": st.get("next", [])}

    def agent_rerun(self, enc_id: str) -> dict:
        with self.Session() as s:
            e = self._get_enc(s, enc_id)
            if e.status == "signed":
                raise ApiError(409, "encounter is signed; the pre-review agents cannot be re-run")
        if not self.agents or not self.agents.ready:
            raise ApiError(503, "agents unavailable")
        self.agents.submit("start", enc_id)
        return {"queued": True}

    # ------------------------------------------------------------ read-only tools for 'Ask Retinitry'
    def ask_tools(self) -> dict:
        svc = self

        def screening_summary(days: int = 7) -> dict:
            since = utcnow() - timedelta(days=int(days))
            with svc.Session() as s:
                encs = [e for e in s.execute(select(EncounterRow)).scalars() if parse_iso(e.created_at) >= since]
                ai = {}
                for e in encs:
                    o = json.loads(e.ai_outcome_json)["outcome"] if e.ai_outcome_json else "PENDING"
                    ai[o] = ai.get(o, 0) + 1
                fin = {}
                for e in encs:
                    if e.final_outcome:
                        fin[e.final_outcome] = fin.get(e.final_outcome, 0) + 1
                return {"days": int(days), "screenings": len(encs), "ai_outcomes": ai, "final_outcomes": fin,
                        "awaiting_review": sum(1 for e in encs if e.status == "awaiting_review"),
                        "signed": sum(1 for e in encs if e.status == "signed")}

        def referral_pipeline() -> dict:
            r = svc.referrals(None)
            counts = {}
            for it in r["items"]:
                counts[it["status"]] = counts.get(it["status"], 0) + 1
            return {"by_status": counts, **r["stats"]}

        def overdue_referrals() -> dict:
            now = utcnow()
            out = []
            with svc.Session() as s:
                for ref in s.execute(select(ReferralRow)).scalars():
                    if svc.is_overdue(ref, now):
                        e = s.get(EncounterRow, ref.encounter_id)
                        out.append({"patient_code": e.patient_code if e else None, "status": ref.status,
                                    "priority": ref.priority, "days_since_issue": (now - parse_iso(ref.issued_at)).days})
            return {"overdue": len(out), "items": out[:20]}

        def override_summary(days: int = 30) -> dict:
            since = utcnow() - timedelta(days=int(days))
            with svc.Session() as s:
                revs = [r for r in s.execute(select(ReviewRow)).scalars() if parse_iso(r.at) >= since]
                changes, reasons = {}, []
                for r in revs:
                    if r.decision == "override":
                        e = s.get(EncounterRow, r.encounter_id)
                        a = json.loads(e.ai_outcome_json)["outcome"] if e and e.ai_outcome_json else "?"
                        k = f"{a}->{r.final_outcome}"
                        changes[k] = changes.get(k, 0) + 1
                        reasons.append(r.reason)
                return {"days": int(days), "signed": len(revs), "approved": sum(1 for r in revs if r.decision == "approve"),
                        "overridden": sum(1 for r in revs if r.decision == "override"), "changes": changes, "reasons": reasons[:10]}

        def model_performance(dataset: str = "idrid") -> dict:
            f = svc.settings.models_dir / "metrics.json"
            if not f.exists():
                return {"error": "evaluation not run"}
            m = json.loads(f.read_text(encoding="utf-8"))
            d = dataset if dataset in m.get("models", {}).get("ensemble", {}) else "idrid"
            e, t = m["models"]["ensemble"][d], m.get("triage", {}).get(d, {})
            return {"dataset": d, "source": m.get("datasets", {}).get(d, {}).get("source"), "n": e.get("n"),
                    "auroc": round(e["auroc"], 3), "sensitivity": round(e["sens"], 2), "specificity": round(e["spec"], 2),
                    "referable_cleared_as_routine": t.get("referable_routed_routine"), "referable_total": t.get("referable_total"),
                    "human_review_rate": round(t["human_review_rate"], 2) if "human_review_rate" in t else None}

        def find_case(patient_code: str) -> dict:
            with svc.Session() as s:
                e = s.execute(select(EncounterRow).where(EncounterRow.patient_code == patient_code)).scalars().first()
                if e is None:
                    return {"found": False}
                ai = json.loads(e.ai_outcome_json) if e.ai_outcome_json else {}
                ref = svc._referral(s, e.id)
                return {"found": True, "patient_code": e.patient_code, "status": e.status, "ai_outcome": ai.get("outcome"),
                        "ai_urgency": ai.get("urgency"), "final_outcome": e.final_outcome,
                        "referral_status": ref.status if ref else None, "created_at": e.created_at}

        return {"screening_summary": screening_summary, "referral_pipeline": referral_pipeline,
                "overdue_referrals": overdue_referrals, "override_summary": override_summary,
                "model_performance": model_performance, "find_case": find_case}
