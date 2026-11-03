"""Probe the running server for the safety features the original documents require.

    python scripts/verify_features.py   (server running on 127.0.0.1:8765)
"""
import json
import re
import sys
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
B = "http://127.0.0.1:8765/api"
fails = []


def call(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=180) as resp:
            b = resp.read()
            return b if raw else json.loads(b)
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read().decode()}


def upload(enc, path, eye, view="macula", fov=50):
    bnd = uuid.uuid4().hex
    parts = []
    for k, v in [("eye", eye), ("view", view), ("fov_deg", str(fov))]:
        parts.append(f"--{bnd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    parts.append(f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{Path(path).name}\"\r\n"
                 f"Content-Type: image/jpeg\r\n\r\n".encode() + Path(path).read_bytes() + b"\r\n")
    parts.append(f"--{bnd}--\r\n".encode())
    r = urllib.request.Request(f"{B}/encounters/{enc}/images", data=b"".join(parts), method="POST",
                               headers={"Content-Type": f"multipart/form-data; boundary={bnd}"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read())


def wait(enc):
    for _ in range(240):
        e = call("GET", f"/encounters/{enc}")
        if e["images"] and all(i["status"] in ("done", "error") for i in e["images"]):
            return e
        time.sleep(1)
    return e


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        fails.append(name)


D = ROOT / "server" / "demo"
flags = lambda e: [f["code"] for f in (e.get("ai") or {}).get("flags", [])]

# 1. Laterality mismatch: a right-eye photo labelled as left eye
e = call("POST", "/encounters", {"patient_code": "VERIFY-lat"})
call("PUT", f"/encounters/{e['id']}/va", {"OD": {"value": "6/6"}, "OS": {"value": "6/6"}})
upload(e["id"], D / "refer-soon-od.jpg", "OS")
upload(e["id"], D / "refer-soon-os.jpg", "OD")
e = wait(e["id"])
check("laterality mismatch flagged when eyes are swapped", "LATERALITY_MISMATCH" in flags(e), flags(e))

# 2. Missing eye + missing VA
e = call("POST", "/encounters", {"patient_code": "VERIFY-missing"})
upload(e["id"], D / "routine-od.jpg", "OD")
e = wait(e["id"])
fl = flags(e)
check("missing eye flagged", any(f.startswith("EYE_MISSING") for f in fl), fl)
check("missing VA flagged (not treated as normal)", any(f.startswith("VA_NOT_MEASURED") for f in fl), fl)
check("single routine eye with missing data is NOT routine", e["ai"]["outcome"] != "ROUTINE", e["ai"]["outcome"])

# 3. Quality: reasons and per-check values for the unusable demo photo
e = call("POST", "/encounters", {"patient_code": "VERIFY-quality"})
upload(e["id"], D / "retake-od.jpg", "OD")
e = wait(e["id"])
img = e["images"][0]
q = img["quality"]
check("unusable photo -> inadequate with reason codes", q["category"] == "inadequate" and len(q["reasons"]) > 0, q["reasons"])
check("every quality check reports value + threshold", all("value" in c and "threshold" in c for c in q["checks"]) and len(q["checks"]) >= 7,
      f"{len(q['checks'])} checks")
check("inadequate image is never ROUTINE", img["triage"]["outcome"] != "ROUTINE", img["triage"]["outcome"])
check("rule trace present", len(img["triage"]["rule_trace"]) >= 1)

# 4. Evidence layers and receipts on an analysed image
e = call("POST", "/encounters", {"patient_code": "VERIFY-layers"})
upload(e["id"], D / "refer-immediate-od.jpg", "OD")
e = wait(e["id"])
img = e["images"][0]
for k in ["cam", "attention", "lesions", "MA", "HE", "EX", "SE"]:
    b = call("GET", f"/images/{img['id']}/overlay/{k}", raw=True)
    check(f"overlay {k}", isinstance(b, bytes) and b[:4] == b"\x89PNG")
check("two graders + ensemble", len(img["grading"]["models"]) == 2 and "ensemble" in img["grading"])
check("calibration temperature recorded", all(mm["temperature"] != 1.0 for mm in img["grading"]["models"]))
check("uncertainty with thresholds", all(k in img["uncertainty"] for k in ["entropy", "entropy_threshold", "disagreement", "ood_score", "ood_threshold"]))
check("landmarks + disc diameter", img["landmarks"]["od"]["conf"] > 0 and img["landmarks"]["disc_diameter"] > 0)
check("lesion candidates listed", len(img["lesions"]["items"]) > 0, len(img["lesions"]["items"]))
check("macular-risk wording", "Not a DME diagnosis" in img["macular_risk"]["label"])
check("model versions + result hash", len(img["model_versions"]) >= 5 and len(img["result_hash"]) == 64)
check("urgency on referral", img["triage"]["outcome"] != "REFER" or img["triage"]["urgency"] in ("soon", "immediate"))

# 5. Referral dashboard and policy provenance
r = call("GET", "/referrals")
check("referral stats", all(k in r["stats"] for k in ["total", "completed_rate", "median_days_to_attend", "overdue", "with_feedback_rate"]))
p = call("GET", "/policy")
check("threshold provenance", all(k in p["provenance"] for k in ["t_refer", "t_entropy", "t_disagreement", "t_ood", "fitted_on"]))
check("client log endpoint", call("POST", "/client-log", {"level": "info", "kind": "verify", "message": "verify_features"}).get("ok") is True)

# 6. Offline: the built web app references no external hosts
ext = set()
for f in (ROOT / "web" / "dist").rglob("*"):
    if f.suffix in (".js", ".html", ".css"):
        for u in re.findall(r"https?://([a-zA-Z0-9.-]+)", f.read_text(encoding="utf-8", errors="ignore")):
            if not re.match(r"(127\.0\.0\.1|localhost|www\.w3\.org|w3\.org|reactjs\.org|react\.dev|github\.com|fb\.me|threejs\.org|mozilla\.org|developer\.mozilla\.org|tailwindcss\.com|xmlns|example\.com|docs\.pmnd\.rs)", u):  # docs.pmnd.rs: link text inside a react-three-fiber error message, never fetched
                ext.add(u)
check("no unexpected external hosts in web/dist", not ext, sorted(ext)[:10])

print("\nRESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
