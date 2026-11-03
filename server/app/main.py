"""Retinitry local server: FastAPI app with the /api contract from docs/04_API.md plus the built web app.

Run:  .venv\\Scripts\\python.exe -m uvicorn server.app.main:app --host 127.0.0.1 --port 8765
Env:  RETINITRY_DATA (server/storage), RETINITRY_MODELS (server/models), RETINITRY_DEMO (server/demo)
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import APIRouter, FastAPI, File, Form, Query, Request, UploadFile  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402

from core import policy as P  # noqa: E402

from . import schemas as S  # noqa: E402
from .ids import iso  # noqa: E402
from .pipeline import Pipeline  # noqa: E402
from .report import build_pdf  # noqa: E402
from .service import ApiError, Service, Settings  # noqa: E402
from .storage import MEDIA_BY_EXT, OVERLAY_KINDS  # noqa: E402
from .worker import TERMINAL  # noqa: E402

VERSION = "0.1.0"
HOST, PORT = "127.0.0.1", 8765
MAX_UPLOAD = 25 * 1024 * 1024
EYES, VIEWS = ("OD", "OS"), ("macula", "disc", "other")
ENC_STATUSES = ("open", "awaiting_review", "signed")
REF_STATUSES = ("issued", "scheduled", "attended", "feedback", "closed", "not_completed")

for _ext, _type in {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
                    ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm",
                    ".json": "application/json", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream"}.items():
    mimetypes.add_type(_type, _ext)  # Windows registry can map .js to text/plain, which breaks module scripts


def _env_path(name: str, default: str) -> Path:
    p = Path(os.environ.get(name) or default)
    return p if p.is_absolute() else ROOT / p


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'), ensure_ascii=False)}\n\n"


NOT_BUILT = """<!doctype html><html><head><meta charset="utf-8"><title>Retinitry</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#eee;padding:3rem;max-width:44rem">
<h1>Retinitry server is running</h1>
<p>The web UI is not built yet. Build it with <code>npm --prefix web ci</code> and
<code>npm --prefix web run build</code>, or run <code>scripts/start.ps1</code>.</p>
<p>The API is available at <a style="color:#64D2FF" href="/api/health">/api/health</a>.</p>
<p style="color:#999">Research prototype. Triage aid, not a diagnosis.</p></body></html>"""


def create_app(pipeline: Any = None, data_dir: Optional[Path] = None, models_dir: Optional[Path] = None,
               demo_dir: Optional[Path] = None, web_dist: Optional[Path] = None,
               step_min_ms: Optional[float] = None, heartbeat_s: float = 15.0) -> FastAPI:
    settings = Settings(
        data_dir=Path(data_dir) if data_dir else _env_path("RETINITRY_DATA", "server/storage"),
        models_dir=Path(models_dir) if models_dir else _env_path("RETINITRY_MODELS", "server/models"),
        demo_dir=Path(demo_dir) if demo_dir else _env_path("RETINITRY_DEMO", "server/demo"),
        web_dist=Path(web_dist) if web_dist else ROOT / "web" / "dist",
        step_min_ms=250.0 if step_min_ms is None else float(step_min_ms),
        heartbeat_s=heartbeat_s,
    )
    svc = Service(settings, pipeline if pipeline is not None else Pipeline(settings.models_dir))
    start_lock = threading.Lock()

    def ready() -> Service:
        if svc.Session is None:
            with start_lock:
                svc.start()
        return svc

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await run_in_threadpool(ready)
        yield
        await run_in_threadpool(svc.stop)

    app = FastAPI(title="Retinitry", version=VERSION, lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)
    app.state.service = svc
    app.state.settings = settings
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=False,
                       allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(ApiError)
    async def _api_error(_req, exc: ApiError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_req, exc: RequestValidationError):
        msgs = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e.get("loc", []) if x not in ("body", "query", "path", "form"))
            msgs.append(f"{loc}: {e.get('msg')}" if loc else str(e.get("msg")))
        return JSONResponse({"detail": "; ".join(msgs) or "invalid request"}, status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_req, exc: StarletteHTTPException):
        return JSONResponse({"detail": str(exc.detail)}, status_code=exc.status_code)

    api = APIRouter(prefix="/api")

    client_log = Path(os.environ.get("RETINITRY_LOGS", str(Path(__file__).resolve().parents[2] / "logs"))) / "client.log"
    client_log.parent.mkdir(parents=True, exist_ok=True)
    log_lock = threading.Lock()

    @api.post("/client-log")
    async def post_client_log(request: Request):
        """Front-end errors, unhandled rejections and WebGL context losses (one JSON line each)."""
        try:
            raw = await request.body()
            body = json.loads(raw[:20000] or b"{}")
        except Exception:
            body = {"message": "unparseable client log"}
        entry = {"at": iso(), **{k: (str(v)[:4000] if not isinstance(v, (int, float, bool)) else v)
                                 for k, v in body.items() if k in ("level", "kind", "message", "stack", "url", "route",
                                                                   "component", "ua", "extra")}}
        with log_lock:
            if client_log.exists() and client_log.stat().st_size > 5_000_000:
                client_log.replace(client_log.with_suffix(".log.1"))
            with open(client_log, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        return {"ok": True}

    @api.get("/client-log")
    def get_client_log(limit: int = Query(100, ge=1, le=1000)):
        if not client_log.exists():
            return {"items": []}
        lines = client_log.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
        return {"items": [json.loads(x) for x in lines if x.strip().startswith("{")][::-1]}

    # ------------------------------------------------------------ health / config
    @api.get("/health")
    def health():
        h = ready().pipeline.health()
        return {**h, "status": "ok", "models": h.get("models", {}), "missing": h.get("missing", []),
                "version": VERSION, "offline": True}

    @api.get("/metrics")
    def metrics():
        f = settings.models_dir / "metrics.json"
        if not f.exists():
            return {"available": False}
        return json.loads(f.read_text(encoding="utf-8"))

    @api.get("/policy")
    def policy():
        f = settings.models_dir / "policy.json"
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8"))
        return dict(P.DEFAULT_POLICY)

    # ------------------------------------------------------------ encounters
    @api.post("/encounters")
    def create_encounter(body: Optional[S.EncounterCreate] = None):
        return ready().create_encounter((body or S.EncounterCreate()).model_dump())

    @api.get("/encounters")
    def list_encounters(status: Optional[str] = None, outcome: Optional[str] = None, q: Optional[str] = None,
                        limit: int = Query(50, ge=1, le=1000)):
        if status and status not in ENC_STATUSES:
            raise ApiError(400, f"status must be one of {', '.join(ENC_STATUSES)}")
        if outcome and outcome not in ("ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE"):
            raise ApiError(400, "outcome must be one of ROUTINE, REFER, HUMAN_REVIEW, RETAKE")
        return ready().list_encounters(status, outcome, q, limit)

    @api.get("/encounters/{enc_id}")
    def get_encounter(enc_id: str):
        return ready().get_encounter(enc_id)

    @api.patch("/encounters/{enc_id}")
    def patch_encounter(enc_id: str, body: S.EncounterPatch):
        return ready().patch_encounter(enc_id, body.model_dump(exclude_unset=True))

    @api.put("/encounters/{enc_id}/va")
    def put_va(enc_id: str, body: S.VAUpdate):
        return ready().update_va(enc_id, body.model_dump())

    @api.delete("/encounters/{enc_id}/images/{image_id}")
    def delete_image(enc_id: str, image_id: str):
        return ready().delete_image(enc_id, image_id)

    @api.post("/encounters/{enc_id}/images")
    async def upload_image(enc_id: str, file: UploadFile = File(...), eye: str = Form(...), view: str = Form(...),
                           fov_deg: Optional[str] = Form(None)):
        s = await run_in_threadpool(ready)
        await run_in_threadpool(s.get_encounter, enc_id)  # 404 if unknown
        ok, msg = await run_in_threadpool(s.models_ready)
        if not ok:
            raise ApiError(503, msg)
        if eye not in EYES:
            raise ApiError(400, "eye must be OD or OS")
        if view not in VIEWS:
            raise ApiError(400, "view must be macula, disc or other")
        try:
            fov = 45.0 if fov_deg in (None, "") else float(fov_deg)
        except ValueError:
            raise ApiError(400, "fov_deg must be a number")
        if not (20.0 <= fov <= 200.0):
            raise ApiError(400, "fov_deg must be between 20 and 200")
        ctype = (file.content_type or "").lower()
        if not ctype.startswith("image/"):
            raise ApiError(400, f"file must be an image (content-type image/*), got {ctype or 'none'}")
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise ApiError(400, "file too large (maximum 25 MB)")
        if not data:
            raise ApiError(400, "file is empty")
        return await run_in_threadpool(s.add_image, enc_id, data, file.filename, ctype, eye, view, fov)

    # ------------------------------------------------------------ images
    @api.get("/images/{image_id}")
    def get_image(image_id: str):
        return ready().get_image(image_id)

    @api.get("/images/{image_id}/file/{which}")
    def image_file(image_id: str, which: str):
        if which not in ("original", "canonical"):
            raise ApiError(404, "file must be original or canonical")
        p = ready().image_file(image_id, which)
        media = MEDIA_BY_EXT.get(p.suffix.lower().lstrip("."), "application/octet-stream")
        return FileResponse(p, media_type=media, headers={"Cache-Control": "private, max-age=3600"})

    @api.get("/images/{image_id}/overlay/{kind}")
    def overlay(image_id: str, kind: str):
        if kind not in OVERLAY_KINDS:
            raise ApiError(404, f"overlay must be one of {', '.join(OVERLAY_KINDS)}")
        return FileResponse(ready().overlay_file(image_id, kind), media_type="image/png",
                            headers={"Cache-Control": "private, max-age=3600"})

    @api.post("/images/{image_id}/replay")
    def replay(image_id: str):
        return ready().replay(image_id)

    @api.get("/images/{image_id}/events")
    async def events(image_id: str, request: Request):
        s = await run_in_threadpool(ready)
        status, img = await run_in_threadpool(s.image_status, image_id)  # 404 if unknown
        min_s = settings.step_min_ms / 1000.0

        async def gen():
            if status == "done":
                yield _sse("done", img)
                return
            if status == "error":
                yield _sse("error", {"message": img.get("error") or "analysis failed"})
                return
            ch = s.broker.channel(image_id)
            idx, started, beat = 0, None, time.monotonic()
            while True:
                if await request.is_disconnected():
                    return
                evs, _closed = ch.wait(idx, 0)
                for ev, data in evs:
                    idx += 1
                    if started is not None:
                        wait = min_s - (time.monotonic() - started)
                        if wait > 0:
                            await asyncio.sleep(wait)
                        started = None
                    yield _sse(ev, data)
                    beat = time.monotonic()
                    if ev in TERMINAL:
                        return
                    if ev == "step" and data.get("status") == "start":
                        started = time.monotonic()
                if time.monotonic() - beat >= settings.heartbeat_s:
                    yield ": heartbeat\n\n"
                    beat = time.monotonic()
                await asyncio.sleep(0.05)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                          "Connection": "keep-alive"})

    # ------------------------------------------------------------ review / queue / referrals
    @api.get("/queue")
    def queue():
        return ready().queue()

    @api.post("/encounters/{enc_id}/review")
    def review(enc_id: str, body: S.ReviewIn):
        return ready().review(enc_id, body.model_dump())

    @api.put("/referrals/{ref_id}")
    def move_referral(ref_id: str, body: S.ReferralMove):
        return ready().move_referral(ref_id, body.model_dump())

    @api.get("/referrals")
    def referrals(status: Optional[str] = None):
        if status and status not in REF_STATUSES:
            raise ApiError(400, f"status must be one of {', '.join(REF_STATUSES)}")
        return ready().referrals(status)

    @api.get("/encounters/{enc_id}/report.pdf")
    def report(enc_id: str):
        s = ready()
        enc = s.get_encounter(enc_id)

        def file_for(image_id: str, kind: str):
            try:
                return s.image_file(image_id, "canonical") if kind == "canonical" else s.overlay_file(image_id, kind)
            except ApiError:
                return None

        pdf = build_pdf(enc, file_for, iso())
        name = f"retinitry_{enc['patient_code']}.pdf".replace(" ", "_").replace('"', "")
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{name}"'})

    # ------------------------------------------------------------ audit / stats
    @api.get("/audit")
    def audit_list(encounter_id: Optional[str] = None, limit: int = Query(200, ge=1, le=10000)):
        return ready().audit_items(encounter_id, limit)

    @api.get("/audit/verify")
    def audit_verify():
        return ready().audit_verify()

    @api.get("/stats/today")
    def stats_today():
        return ready().stats_today()

    # ------------------------------------------------------------ demo cases
    @api.get("/demo-cases")
    def demo_cases():
        return [{"name": c.get("name"), "title": c.get("title", ""), "description": c.get("description", ""),
                 "source": c.get("source", ""), "license": c.get("license", ""),
                 "thumb": f"/api/demo-cases/{c.get('name')}/thumb", "eye": c.get("eye"), "view": c.get("view")}
                for c in ready().demo_cases()]

    @api.get("/demo-cases/{name}/thumb")
    def demo_thumb(name: str):
        return Response(ready().demo_thumb(name), media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400"})

    @api.post("/demo-cases/{name}")
    def demo_create(name: str):
        return ready().create_demo(name)

    @api.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_404(rest: str):
        raise ApiError(404, f"no such endpoint /api/{rest}")

    app.include_router(api)

    # ------------------------------------------------------------ web app (SPA)
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        dist = settings.web_dist
        index = dist / "index.html"
        if not index.exists():
            return HTMLResponse(NOT_BUILT)
        if full_path:
            root = dist.resolve()
            p = (root / full_path).resolve()
            if p.is_relative_to(root) and p.is_file():
                return FileResponse(p)
        return FileResponse(index, media_type="text/html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()

if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host=os.environ.get("RETINITRY_HOST", HOST), port=int(os.environ.get("RETINITRY_PORT", PORT)))
