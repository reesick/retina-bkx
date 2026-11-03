"""End-to-end check against a running server (python scripts/e2e.py [base_url]).

Creates every demo encounter, waits for analysis, checks the encounter outcome equals the expected one
recorded in cases.json, then exercises SSE, sign-off, referral moves, PDF, replay and the audit chain.
Exit code 0 only if everything passes.
"""
import json
import sys
import time
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765") + "/api"
fails = []


def req(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            b = resp.read()
            return (resp.status, b, resp.headers.get("Content-Type")) if raw else json.loads(b)
    except urllib.error.HTTPError as e:
        return (e.code, e.read(), None) if raw else {"_status": e.code, "_body": e.read().decode()}


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)
    if not ok:
        fails.append(name)


h = req("GET", "/health")
check("health ready", h.get("ready") is True, f"missing={h.get('missing')}")
cases = json.load(open("server/demo/cases.json"))
encs = {}
for c in cases:
    e = req("POST", f"/demo-cases/{c['name']}")
    t0 = time.time()
    while True:
        e = req("GET", f"/encounters/{e['id']}")
        if all(i["status"] in ("done", "error") for i in e["images"]) or time.time() - t0 > 180:
            break
        time.sleep(1)
    errs = [i["error"] for i in e["images"] if i["status"] == "error"]
    exp = c["expected"]
    got = (e["ai"] or {}).get("outcome")
    check(f"demo {c['name']}: {len(e['images'])} images analysed", not errs and len(e["images"]) == len(c["images"]), str(errs))
    check(f"demo {c['name']}: outcome {exp['outcome']}", got == exp["outcome"], f"got {got}, flags {[f['code'] for f in e['ai']['flags']]}")
    encs[c["name"]] = e

# SSE replays a finished image
img = encs["refer-immediate"]["images"][0]
st, body, ct = req("GET", f"/images/{img['id']}/events", raw=True)
check("SSE done event", st == 200 and b"event: done" in body and "text/event-stream" in (ct or ""))
# overlays
for k in ["cam", "attention", "lesions", "EX"]:
    st, body, ct = req("GET", f"/images/{img['id']}/overlay/{k}", raw=True)
    check(f"overlay {k} png", st == 200 and body[:4] == b"\x89PNG")
# replay determinism
r = req("POST", f"/images/{img['id']}/replay")
check("replay identical hash", r.get("match") is True, f"{r.get('original_hash', '')[:12]} vs {r.get('replay_hash', '')[:12]}")
# sign-off rules + referral
enc = encs["refer-immediate"]
flags = [f["code"] for f in enc["ai"]["flags"]]
bad = req("POST", f"/encounters/{enc['id']}/review", {"reviewer": "Dr Test", "decision": "override", "final_outcome": "ROUTINE",
                                                     "reason": "", "acknowledged_flags": flags})
check("override without reason rejected", bad.get("_status") == 400)
ok = req("POST", f"/encounters/{enc['id']}/review", {"reviewer": "Dr Test", "decision": "approve", "final_outcome": "REFER",
                                                    "final_urgency": "immediate", "reason": "", "acknowledged_flags": flags})
check("approve REFER", ok.get("status") == "signed" and ok.get("referral"), str(ok)[:200])
ref = ok.get("referral") or {}
mv = req("PUT", f"/referrals/{ref.get('id')}", {"to": "attended"})
check("illegal referral move blocked", mv.get("_status") == 409)
mv = req("PUT", f"/referrals/{ref.get('id')}", {"to": "scheduled", "facility": "District eye hospital", "appointment_at": "2026-11-10T09:00:00Z"})
check("referral scheduled", mv.get("status") == "scheduled")
# VA safeguard must require acknowledgement
enc = encs["vision-safeguard"]
miss = req("POST", f"/encounters/{enc['id']}/review", {"reviewer": "Dr Test", "decision": "approve", "final_outcome": "REFER",
                                                      "final_urgency": "soon", "reason": "", "acknowledged_flags": []})
check("unacknowledged VA flag rejected", miss.get("_status") == 400)
# PDF
st, body, ct = req("GET", f"/encounters/{encs['refer-immediate']['id']}/report.pdf", raw=True)
check("PDF report", st == 200 and body[:4] == b"%PDF", f"{len(body)} bytes")
# queue, stats, metrics, audit
q = req("GET", "/queue")
check("queue lists open cases", isinstance(q, list) and len(q) >= 4, f"{len(q)} items")
m = req("GET", "/metrics")
check("metrics available", m.get("available") is True)
v = req("GET", "/audit/verify")
check("audit chain intact", v.get("valid") is True, f"{v.get('checked')} entries")
st, body, ct = req("GET", "/../", raw=True) if False else (None, None, None)
print("\nRESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
