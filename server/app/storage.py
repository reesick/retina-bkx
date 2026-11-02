"""Image files: storage/images/{image_id}/original.<ext>, canonical.jpg, overlay_<kind>.png."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

OVERLAY_KINDS = ["cam", "attention", "lesions", "MA", "HE", "EX", "SE"]
_EXT_BY_TYPE = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/tiff": "tif",
                "image/bmp": "bmp", "image/webp": "webp"}
MEDIA_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "tif": "image/tiff",
                "tiff": "image/tiff", "bmp": "image/bmp", "webp": "image/webp"}
_ID = re.compile(r"^[A-Za-z0-9_\-]+$")


class Storage:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.images = self.root / "images"
        self.images.mkdir(parents=True, exist_ok=True)

    def image_dir(self, image_id: str) -> Path:
        if not _ID.match(image_id):
            raise ValueError("bad image id")
        return self.images / image_id

    @staticmethod
    def pick_ext(filename: str | None, content_type: str | None) -> str:
        suffix = Path(filename or "").suffix.lower().lstrip(".")
        if suffix in MEDIA_BY_EXT:
            return "jpg" if suffix == "jpeg" else suffix
        return _EXT_BY_TYPE.get((content_type or "").lower(), "jpg")

    def save_original(self, image_id: str, data: bytes, ext: str) -> Path:
        d = self.image_dir(image_id)
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"original.{ext}"
        p.write_bytes(data)
        return p

    def save_results(self, image_id: str, canonical_jpeg: bytes, overlays: dict[str, bytes]) -> Path:
        d = self.image_dir(image_id)
        d.mkdir(parents=True, exist_ok=True)
        c = d / "canonical.jpg"
        c.write_bytes(canonical_jpeg)
        for kind, png in overlays.items():
            if kind in OVERLAY_KINDS:
                (d / f"overlay_{kind}.png").write_bytes(png)
        return c

    def overlay_path(self, image_id: str, kind: str) -> Path:
        return self.image_dir(image_id) / f"overlay_{kind}.png"

    def delete(self, image_id: str) -> None:
        shutil.rmtree(self.image_dir(image_id), ignore_errors=True)

    def rel(self, p: Path) -> str:
        try:
            return p.resolve().relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return str(p)

    def abs(self, rel: str) -> Path:
        p = Path(rel)
        return p if p.is_absolute() else self.root / p
