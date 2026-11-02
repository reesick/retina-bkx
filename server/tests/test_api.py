from __future__ import annotations

import json
import sqlite3
import threading
from datetime import timedelta

import pytest

from conftest import FakePipeline, fundus_jpeg, parse_sse, wait_image
from core import policy as P
from server.app import schemas as S
from server.app.db import ReferralRow
from server.app.ids import iso, utcnow
from server.app.pipeline import Pipeline, STEPS
from server.app.service import Service


def upload(client, enc_id, eye, seed=0, **extra):
    data = {"eye": eye, "view": "macula", **extra}
    return client.post(f"/api/encounters/{enc_id}/images", data=data,
                       files={"file": (f"{eye}.jpg", fundus_jpeg(seed), "image/jpeg")})


# ----------------------------------------------------------------------------- models missing
def test_health_reports_missing_models_and_upload_503(make_client, tmp_path):
    empty = tmp_path / "empty_models"
    empty.mkdir()
    c = make_client(pipeline=Pipeline(empty), models_dir=empty)
    h = c.get("/api/health")
    assert h.status_code == 200
    body = h.json()
    S.Health.model_validate(body)
    assert body["status"] == "ok" and body["offline"] is True
    assert "grader_cnn.onnx" in body["missing"] and "policy.json" in body["missing"]
    assert body["models"]["grader_cnn"]["loaded"] is False

    enc = c.post("/api/encounters", json={}).json()
    r = upload(c, enc["id"], "OD")
    assert r.status_code == 503
    assert "Missing" in r.json()["detail"] or "not installed" in r.json()["detail"]
    assert c.get(f"/api/encounters/{enc['id']}").json()["images"] == []
    assert c.post("/api/demo-cases/nope").status_code == 404


# ----------------------------------------------------------------------------- full flow
def test_full_flow(make_client):
    gate = threading.Event()
    fake = FakePipeline(gate=gate)
    c = make_client(pipeline=fake)

    # encounter with auto patient code
    enc = c.post("/api/encounters", json={"age": 58, "sex": "F", "diabetes_years": 12}).json()
    S.Encounter.model_validate(enc)
    assert enc["patient_code"].startswith("RT-") and len(enc["patient_code"]) == len("RT-YYMMDD-0001")
    assert enc["id"].startswith("enc_") and len(enc["id"]) == 14
    assert enc["status"] == "open" and enc["ai"] is None and enc["va"]["OD"] == {"value": None, "logmar": None}
    eid = enc["id"]
    enc2 = c.post("/api/encounters", json={"patient_code": "  "}).json()
    assert enc2["patient_code"] != enc["patient_code"]

    # validation
    assert upload(c, eid, "XX").status_code == 400
    assert upload(c, eid, "OD", fov_deg="10").status_code == 400
    bad = c.post(f"/api/encounters/{eid}/images", data={"eye": "OD", "view": "macula"},
                 files={"file": ("a.txt", b"hello", "text/plain")})
    assert bad.status_code == 400 and "image" in bad.json()["detail"]
    assert c.post("/api/encounters/enc_missing/images", data={"eye": "OD", "view": "macula"},
                  files={"file": ("a.jpg", b"x", "image/jpeg")}).status_code == 404

    # upload OD, subscribe to SSE while the worker is held, then release it
    r = upload(c, eid, "OD", seed=1)
    assert r.status_code == 200, r.text
    od = r.json()
    S.ImageResult.model_validate(od)
    assert od["status"] == "queued" and od["fov_deg"] == 45.0 and od["canonical_size"] == 768
    timer = threading.Timer(0.3, gate.set)
    timer.start()
    with c.stream("GET", f"/api/images/{od['id']}/events") as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        text = "".join(resp.iter_text())
    events = parse_sse(text)
    steps = [(d["step"], d["status"]) for e, d in events if e == "step"]
    assert steps == [(s, st) for s in STEPS for st in ("start", "done")]
    partials = {d["step"]: d.get("partial") for e, d in events if e == "step" and d["status"] == "done"}
    S.Quality.model_validate(partials["quality"])
    S.Landmarks.model_validate(partials["landmarks"])
    S.ModelGrade.model_validate(partials["grader_cnn"])
    S.Lesions.model_validate(partials["lesions"])
    S.Uncertainty.model_validate(partials["uncertainty"])
    S.Triage.model_validate(partials["policy"])
    assert all("ms" in d for e, d in events if e == "step" and d["status"] == "done")
    assert events[-1][0] == "done"
    done = events[-1][1]
    S.ImageResult.model_validate(done)
    assert done["status"] == "done" and done["triage"]["outcome"] == "REFER" and len(done["result_hash"]) == 64
    assert "timings_ms" in done and done["model_versions"]["grader_cnn"] == "fakecnn00001"

    # already done -> 'done' immediately
    with c.stream("GET", f"/api/images/{od['id']}/events") as resp:
        again = parse_sse("".join(resp.iter_text()))
    assert [e for e, _ in again] == ["done"]

    # files and overlays
    f = c.get(f"/api/images/{od['id']}/file/canonical")
    assert f.status_code == 200 and f.headers["content-type"] == "image/jpeg"
    assert c.get(f"/api/images/{od['id']}/file/original").status_code == 200
    ov = c.get(f"/api/images/{od['id']}/overlay/lesions")
    assert ov.status_code == 200 and ov.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert c.get(f"/api/images/{od['id']}/overlay/nope").status_code == 404

    # OS
    os_ = upload(c, eid, "OS", seed=2).json()
    os_done = wait_image(c, os_["id"])
    assert os_done["status"] == "done" and os_done["triage"]["outcome"] == "ROUTINE"

    # encounter-level decision equals core.policy.triage_encounter on the stored results
    enc = c.get(f"/api/encounters/{eid}").json()
    S.Encounter.model_validate(enc)
    expected = P.triage_encounter(
        images=[{"eye": i["eye"], "triage": i["triage"], "macular_risk": i["macular_risk"],
                 "laterality": i["landmarks"]["laterality"]} for i in enc["images"]],
        va={"OD": {"value": None}, "OS": {"value": None}}, policy=P.DEFAULT_POLICY)
    assert enc["ai"]["outcome"] == expected["outcome"] == "REFER"
    assert enc["ai"]["urgency"] == "soon"
    assert [f["code"] for f in enc["ai"]["flags"]] == [f["code"] for f in expected["flags"]]
    assert {"VA_NOT_MEASURED_OD", "VA_NOT_MEASURED_OS"} <= {f["code"] for f in enc["ai"]["flags"]}
    assert enc["ai"]["eyes"]["OD"] == {"outcome": "REFER", "urgency": "soon", "missing": False}
    assert enc["ai"]["eyes"]["OS"]["urgency"] is None
    assert enc["status"] == "awaiting_review"
    assert enc["priority"] >= 80

    # queue + list
    q = c.get("/api/queue").json()
    assert [x["id"] for x in q] == [eid]
    S.EncounterSummary.model_validate(q[0])
    assert q[0]["ai_outcome"] == "REFER" and q[0]["n_images"] == 2 and q[0]["thumb"]
    lst = c.get("/api/encounters", params={"outcome": "REFER"}).json()
    assert [x["id"] for x in lst] == [eid]
    assert c.get("/api/encounters", params={"q": enc["patient_code"]}).json()[0]["id"] == eid
    assert len(c.get("/api/encounters").json()) == 2
    assert c.get("/api/encounters", params={"status": "bogus"}).status_code == 400

    # PATCH
    pr = c.patch(f"/api/encounters/{eid}", json={"notes": "first visit"})
    assert pr.status_code == 200 and pr.json()["notes"] == "first visit" and pr.json()["age"] == 58

    # VA update changes flags
    assert c.put(f"/api/encounters/{eid}/va", json={"OD": {"value": "banana"}, "OS": {"value": "6/6"}}).status_code == 400
    r = c.put(f"/api/encounters/{eid}/va", json={"OD": {"value": "6/60"}, "OS": {"value": "6/6"},
                                                 "method": "Snellen", "operator": "hw1"})
    assert r.status_code == 200
    enc = r.json()
    assert enc["va"]["OD"]["value"] == "6/60" and enc["va"]["OD"]["logmar"] == pytest.approx(1.0)
    assert enc["va"]["OS"]["logmar"] == pytest.approx(0.0)
    assert enc["va"]["method"] == "Snellen" and enc["va"]["measured_at"]
    codes = [f["code"] for f in enc["ai"]["flags"]]
    assert codes == ["VA_REDUCED_OD"]

    # review validation
    body = {"reviewer": "Dr A", "decision": "approve", "final_outcome": "REFER", "reason": "", "acknowledged_flags": []}
    r = c.post(f"/api/encounters/{eid}/review", json=body)
    assert r.status_code == 400 and "VA_REDUCED_OD" in r.json()["detail"]
    r = c.post(f"/api/encounters/{eid}/review", json={**body, "decision": "override", "final_outcome": "ROUTINE",
                                                       "acknowledged_flags": codes})
    assert r.status_code == 400 and "reason" in r.json()["detail"]
    r = c.post(f"/api/encounters/{eid}/review", json={**body, "final_outcome": "ROUTINE", "acknowledged_flags": codes})
    assert r.status_code == 400  # approve must keep the AI outcome
    r = c.post(f"/api/encounters/{eid}/review", json={**body, "decision": "maybe"})
    assert r.status_code == 400

    # approve
    r = c.post(f"/api/encounters/{eid}/review", json={**body, "acknowledged_flags": codes})
    assert r.status_code == 200, r.text
    enc = r.json()
    S.Encounter.model_validate(enc)
    assert enc["status"] == "signed"
    assert enc["review"]["decision"] == "approve" and enc["review"]["final_outcome"] == "REFER"
    assert enc["review"]["final_urgency"] == "soon"
    ref = enc["referral"]
    assert ref["status"] == "issued" and ref["priority"] == "soon"
    assert ref["events"] == [{"from": None, "to": "issued", "note": ref["events"][0]["note"], "at": ref["issued_at"]}]
    assert c.post(f"/api/encounters/{eid}/review", json={**body, "acknowledged_flags": codes}).status_code == 409
    assert c.get("/api/queue").json() == []
    assert upload(c, eid, "OD").status_code == 409

    # referral moves
    rid = ref["id"]
    assert c.put(f"/api/referrals/{rid}", json={"to": "attended"}).status_code == 409
    assert c.put(f"/api/referrals/{rid}", json={"to": "closed"}).status_code == 409
    assert c.put(f"/api/referrals/{rid}", json={"to": "not_completed"}).status_code == 400
    assert c.put(f"/api/referrals/{rid}", json={"to": "flying"}).status_code == 400
    r = c.put(f"/api/referrals/{rid}", json={"to": "scheduled", "facility": "District Eye Hospital",
                                             "appointment_at": iso(utcnow() + timedelta(days=7)), "note": "booked"})
    assert r.status_code == 200 and r.json()["status"] == "scheduled"
    S.Referral.model_validate(r.json())
    r = c.put(f"/api/referrals/{rid}", json={"to": "attended"})
    assert r.status_code == 200 and r.json()["attended_at"]
    r = c.put(f"/api/referrals/{rid}", json={"to": "feedback", "feedback": "PRP planned"})
    assert r.status_code == 200 and r.json()["feedback"] == "PRP planned"
    r = c.put(f"/api/referrals/{rid}", json={"to": "closed", "next_followup_at": iso(utcnow() + timedelta(days=90))})
    assert r.status_code == 200 and r.json()["status"] == "closed"
    assert [e["to"] for e in r.json()["events"]] == ["issued", "scheduled", "attended", "feedback", "closed"]
    assert c.put(f"/api/referrals/{rid}", json={"to": "not_completed", "not_completed_reason": "x"}).status_code == 409
    assert c.put(f"/api/referrals/{rid}", json={"to": "scheduled"}).status_code == 409
    assert c.put("/api/referrals/ref_missing", json={"to": "scheduled"}).status_code == 404

    refs = c.get("/api/referrals").json()
    assert refs["items"][0]["patient_code"] == enc["patient_code"]
    S.ReferralStats.model_validate(refs["stats"])
    assert refs["stats"]["total"] == 1 and refs["stats"]["completed_rate"] == 1.0
    assert refs["stats"]["with_feedback_rate"] == 1.0 and refs["stats"]["overdue"] == 0
    assert refs["stats"]["median_days_to_attend"] is not None
    assert c.get("/api/referrals", params={"status": "issued"}).json()["items"] == []

    # stats
    st = c.get("/api/stats/today").json()
    assert st == {"screened_today": 1, "awaiting_review": 0, "referred_today": 1, "retake_today": 0, "total": 2}

    # audit
    items = c.get("/api/audit", params={"encounter_id": eid}).json()["items"]
    events_logged = {i["event"] for i in items}
    assert {"encounter_created", "image_uploaded", "image_analysed", "va_updated", "review_signed",
            "referral_moved"} <= events_logged
    assert items[0]["seq"] > items[-1]["seq"]
    v = c.get("/api/audit/verify").json()
    assert v["valid"] is True and v["first_bad_seq"] is None and v["checked"] >= len(items)

    # PDF
    pdf = c.get(f"/api/encounters/{eid}/report.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF" and len(pdf.content) > 5000

    # replay
    rp = c.post(f"/api/images/{od['id']}/replay").json()
    assert rp["match"] is True and rp["original_hash"] == rp["replay_hash"] == done["result_hash"]
    assert isinstance(rp["ms"], float)
    assert "replay_checked" in {i["event"] for i in c.get("/api/audit").json()["items"]}

    # demo cases: none configured
    assert c.get("/api/demo-cases").json() == []
    assert c.get("/api/metrics").json() == {"available": False}
    pol = c.get("/api/policy").json()
    assert pol["version"] == "default-unfitted"
    assert c.get("/api/nope").status_code == 404


def test_pdf_awaiting_review_and_delete_image(make_client):
    c = make_client()
    eid = c.post("/api/encounters", json={"patient_code": "P-1"}).json()["id"]
    img = upload(c, eid, "OS").json()
    wait_image(c, img["id"])
    enc = c.get(f"/api/encounters/{eid}").json()
    # OS routine, OD missing -> RETAKE dominates routine
    assert enc["ai"]["outcome"] == "RETAKE" and "EYE_MISSING_OD" in [f["code"] for f in enc["ai"]["flags"]]
    pdf = c.get(f"/api/encounters/{eid}/report.pdf")
    assert pdf.content[:4] == b"%PDF"
    r = c.delete(f"/api/encounters/{eid}/images/{img['id']}")
    assert r.status_code == 200
    enc = r.json()
    assert enc["images"] == [] and enc["ai"] is None and enc["status"] == "open"
    assert c.get(f"/api/images/{img['id']}").status_code == 404
    assert "image_deleted" in {i["event"] for i in c.get("/api/audit").json()["items"]}
    assert c.get("/api/stats/today").json()["retake_today"] == 0


def test_override_to_routine_creates_no_referral(make_client):
    c = make_client()
    eid = c.post("/api/encounters", json={}).json()["id"]
    for eye in ("OD", "OS"):
        wait_image(c, upload(c, eid, eye).json()["id"])
    enc = c.get(f"/api/encounters/{eid}").json()
    codes = [f["code"] for f in enc["ai"]["flags"]]
    r = c.post(f"/api/encounters/{eid}/review", json={"reviewer": "Dr B", "decision": "override", "final_outcome": "ROUTINE",
                                                      "reason": "artefact, not haemorrhage", "acknowledged_flags": codes})
    assert r.status_code == 200
    enc = r.json()
    assert enc["referral"] is None and enc["review"]["final_urgency"] == "routine_12m"
    assert c.get("/api/referrals").json()["stats"]["total"] == 0


def test_decode_error_marks_image_error(make_client):
    c = make_client()
    eid = c.post("/api/encounters", json={}).json()["id"]
    r = c.post(f"/api/encounters/{eid}/images", data={"eye": "OD", "view": "disc"},
               files={"file": ("x.jpg", b"not really a jpeg", "image/jpeg")})
    assert r.status_code == 200
    d = wait_image(c, r.json()["id"])
    assert d["status"] == "error" and "decodable" in d["error"]
    with c.stream("GET", f"/api/images/{d['id']}/events") as resp:
        evs = parse_sse("".join(resp.iter_text()))
    assert evs[0][0] == "error" and "decodable" in evs[0][1]["message"]
    assert "image_failed" in {i["event"] for i in c.get("/api/audit").json()["items"]}
    assert c.get(f"/api/encounters/{eid}").json()["status"] == "open"


def test_sse_steps_visible_min_duration(make_client):
    import time as _t

    gate = threading.Event()
    c = make_client(pipeline=FakePipeline(gate=gate), step_min_ms=60)
    eid = c.post("/api/encounters", json={}).json()["id"]
    img = upload(c, eid, "OD").json()
    threading.Timer(0.2, gate.set).start()
    t0 = _t.monotonic()
    with c.stream("GET", f"/api/images/{img['id']}/events") as resp:
        evs = parse_sse("".join(resp.iter_text()))
    assert _t.monotonic() - t0 >= len(STEPS) * 0.06
    assert evs[-1][0] == "done"


def test_audit_tamper_detected(make_client, tmp_path):
    c = make_client(name="tamper")
    for i in range(3):
        c.post("/api/encounters", json={"patient_code": f"T-{i}"})
    assert c.get("/api/audit/verify").json() == {"valid": True, "checked": 3, "first_bad_seq": None}
    con = sqlite3.connect(tmp_path / "tamper" / "retinitry.db")
    con.execute("UPDATE audit SET payload_json = ? WHERE seq = 2", (json.dumps({"patient_code": "EVIL"}),))
    con.commit()
    con.close()
    v = c.get("/api/audit/verify").json()
    assert v == {"valid": False, "checked": 1, "first_bad_seq": 2}


def test_demo_cases(make_client, tmp_path):
    demo = tmp_path / "demo_cases"
    demo.mkdir()
    (demo / "case1.jpg").write_bytes(fundus_jpeg(3, 600))
    (demo / "cases.json").write_text(json.dumps([{"name": "case1", "title": "Moderate NPDR", "description": "d",
                                                  "source": "IDRiD", "license": "CC-BY-4.0", "file": "case1.jpg",
                                                  "eye": "OD", "view": "macula", "fov_deg": 50}]))
    c = make_client(demo_dir=demo)
    cases = c.get("/api/demo-cases").json()
    assert cases == [{"name": "case1", "title": "Moderate NPDR", "description": "d", "source": "IDRiD",
                      "license": "CC-BY-4.0", "thumb": "/api/demo-cases/case1/thumb", "eye": "OD", "view": "macula"}]
    th = c.get("/api/demo-cases/case1/thumb")
    assert th.status_code == 200 and th.content[:2] == b"\xff\xd8"
    r = c.post("/api/demo-cases/case1")
    assert r.status_code == 200
    enc = r.json()
    assert enc["patient_code"] == "DEMO-case1" and len(enc["images"]) == 1 and enc["images"][0]["fov_deg"] == 50.0
    assert wait_image(c, enc["images"][0]["id"])["status"] == "done"
    assert c.post("/api/demo-cases/unknown").status_code == 404


def test_spa_fallback_without_dist(make_client):
    c = make_client()
    r = c.get("/")
    assert r.status_code == 200 and "not built" in r.text
    assert c.get("/review/enc_x").status_code == 200


def test_spa_serves_dist(tmp_path):
    from fastapi.testclient import TestClient

    from server.app.main import create_app

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>APP</html>")
    (dist / "assets" / "a.js").write_text("console.log(1)")
    app = create_app(pipeline=FakePipeline(), data_dir=tmp_path / "d", models_dir=tmp_path / "m",
                     demo_dir=tmp_path / "x", web_dist=dist)
    with TestClient(app) as c:
        assert c.get("/").text == "<html>APP</html>"
        assert c.get("/queue/123").text == "<html>APP</html>"
        js = c.get("/assets/a.js")
        assert js.text == "console.log(1)" and "javascript" in js.headers["content-type"]
        assert c.get("/api/unknown").status_code == 404
        assert c.get("/../secret").text == "<html>APP</html>"
        cors = c.options("/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        assert cors.headers.get("access-control-allow-origin") == "http://localhost:5173"
        bad = c.options("/api/health", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"})
        assert "access-control-allow-origin" not in bad.headers


def test_overdue_rules():
    now = utcnow()

    def row(status, issued_days_ago, appt_days=None, attended=None):
        return ReferralRow(id="r", encounter_id="e", status=status, priority="soon",
                           issued_at=iso(now - timedelta(days=issued_days_ago)),
                           appointment_at=iso(now + timedelta(days=appt_days)) if appt_days is not None else None,
                           attended_at=attended, updated_at=iso(now))

    assert Service.is_overdue(row("issued", 31), now) is True
    assert Service.is_overdue(row("issued", 5), now) is False
    assert Service.is_overdue(row("scheduled", 5, appt_days=-1), now) is True
    assert Service.is_overdue(row("scheduled", 5, appt_days=3), now) is False
    assert Service.is_overdue(row("attended", 60, appt_days=-30, attended=iso(now)), now) is False
    assert Service.is_overdue(row("closed", 90), now) is False
