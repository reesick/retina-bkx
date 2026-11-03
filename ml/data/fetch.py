"""Resumable data harness for Retinitry.

Downloads public datasets, converts every image to the canonical square crop
(core.fundus.crop_square) at a fixed size, writes a labels CSV, and deletes the raw
download afterwards to fit on a small disk. Each step is recorded in
data/manifest.json, so re-running skips work that is already done.

Usage:
    python -m ml.data.fetch                 # everything
    python -m ml.data.fetch aptos idrid     # selected sources
    python -m ml.data.fetch --status
"""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HOME", str(ROOT.parent / ".cache" / "hf"))
# C: is nearly full: keep every temp file on D: and use plain HTTP downloads (no xet chunk cache)
_TMP = ROOT.parent / ".cache" / "tmp"
_TMP.mkdir(parents=True, exist_ok=True)
for _k in ("TMP", "TEMP", "TMPDIR"):
    os.environ[_k] = str(_TMP)
if os.environ.get("RT_USE_XET") != "1":
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_XET_CACHE", str(ROOT.parent / ".cache" / "xet"))

from core.fundus import crop_mask_like, crop_square, decode_image  # noqa: E402

DATA = ROOT / "data"
RAW = DATA / "raw"
PROC = DATA / "processed"
MANIFEST = DATA / "manifest.json"
GRADE_SIZE = 768
SEG_SIZE = 1024
LESIONS = ["MA", "HE", "EX", "SE"]  # bit 0..3 in packed masks


# ----------------------------------------------------------------- manifest
def _load() -> dict:
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}


def done(key: str) -> bool:
    return _load().get(key) == "done"


def mark(key: str, value="done") -> None:
    m = _load()
    m[key] = value
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(m, indent=2))
    tmp.replace(MANIFEST)


def log(*a):
    print("[fetch]", *a, flush=True)


def save_jpg(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


# ----------------------------------------------------------------- APTOS 2019
def fetch_aptos() -> None:
    """APTOS 2019 train set (3,662 graded images) from the HF parquet mirror sngsfydy/aptos."""
    if done("aptos"):
        return
    from huggingface_hub import HfApi, hf_hub_download
    import pyarrow.parquet as pq

    repo = "sngsfydy/aptos"
    files = sorted(f for f in HfApi().list_repo_files(repo, repo_type="dataset") if f.endswith(".parquet"))
    out = PROC / "aptos"
    part_dir = out / "parts"
    part_dir.mkdir(parents=True, exist_ok=True)
    for si, f in enumerate(files):
        key = f"aptos:{f}"
        if done(key):
            continue
        log("APTOS shard", si + 1, "/", len(files))
        p = hf_hub_download(repo, f, repo_type="dataset", local_dir=str(RAW / "aptos"))
        rows = []
        pf = pq.ParquetFile(p)
        ri = 0
        for batch in pf.iter_batches(batch_size=8):
            for r in batch.to_pylist():
                name = Path(r["image"].get("path") or f"s{si}_{ri}").stem
                ri += 1
                rgb = decode_image(r["image"]["bytes"])
                sq, tr = crop_square(rgb, GRADE_SIZE)
                save_jpg(out / "img" / f"{name}.jpg", sq)
                rows.append({"id": name, "grade": int(r["label"]), "orig_w": tr.orig_w, "orig_h": tr.orig_h})
        write_csv(part_dir / f"{si:02d}.csv", rows)
        del pf
        import gc

        gc.collect()
        try:
            os.remove(p)
        except OSError as e:
            log("could not delete shard yet:", e)
        mark(key)
    rows = []
    for pc in sorted(part_dir.glob("*.csv")):
        rows += list(csv.DictReader(open(pc)))
    write_csv(out / "labels.csv", rows)
    log("APTOS images:", len(rows))
    mark("aptos")


# ----------------------------------------------------------------- IDRiD
def _idrid_zip(name: str) -> zipfile.ZipFile:
    from huggingface_hub import hf_hub_download

    p = hf_hub_download("MahsaTorki/IDRiD_Dataset", name, repo_type="dataset", local_dir=str(RAW / "idrid"))
    return zipfile.ZipFile(p)


def _read_csv_from_zip(z: zipfile.ZipFile, member: str) -> list[list[str]]:
    txt = z.read(member).decode("utf-8-sig", errors="ignore")
    return [r for r in csv.reader(io.StringIO(txt)) if r and r[0].strip()]


def fetch_idrid() -> None:
    """IDRiD (CC-BY 4.0): grading (516) + OD/fovea centres, and lesion segmentation (81)."""
    if not done("idrid:grading"):
        z = _idrid_zip("B.Disease_Grading.zip")
        zl = _idrid_zip("C.Localization.zip")
        # IDRiD reuses the same file names in its training and testing sets (IDRiD_001.. in both), so every key is
        # (split, name) and test images get their own id (IDRiD_T001 ..). Without this, test images overwrite
        # training images on disk.
        def uid(split: str, name: str) -> str:
            return name if split == "train" else name.replace("IDRiD_", "IDRiD_T")

        labels = {}
        for m in z.namelist():
            if m.lower().endswith(".csv"):
                split = "train" if "Training" in m else "test"
                for r in _read_csv_from_zip(z, m)[1:]:
                    labels[(split, r[0].strip())] = (int(r[1]), int(r[2]))
        cents: dict[tuple, dict] = {}
        for m in zl.namelist():
            if m.lower().endswith(".csv"):
                kind = "od" if "OD_Center" in m else "fovea"
                split = "train" if "Training" in m else "test"
                for r in _read_csv_from_zip(zl, m)[1:]:
                    if len(r) >= 3 and r[1].strip():
                        cents.setdefault((split, r[0].strip()), {})[kind] = (float(r[1]), float(r[2]))
        rows = []
        out = PROC / "idrid"
        shutil.rmtree(out / "img", ignore_errors=True)
        for m in sorted(z.namelist()):
            if not m.lower().endswith(".jpg"):
                continue
            name = Path(m).stem
            split = "train" if "Training" in m else "test"
            if (split, name) not in labels:
                continue
            grade, dme = labels[(split, name)]
            rid = uid(split, name)
            rgb = decode_image(z.read(m))
            sq, tr = crop_square(rgb, GRADE_SIZE)
            save_jpg(out / "img" / f"{rid}.jpg", sq)
            c = cents.get((split, name), {})
            od = tr.to_canonical(*c["od"]) if "od" in c else (None, None)
            fv = tr.to_canonical(*c["fovea"]) if "fovea" in c else (None, None)
            rows.append({"id": rid, "split": split, "grade": grade, "dme": dme,
                         "od_x": od[0], "od_y": od[1], "fovea_x": fv[0], "fovea_y": fv[1],
                         "orig_w": tr.orig_w, "orig_h": tr.orig_h, "scale": tr.scale})
        assert len({r["id"] for r in rows}) == len(rows), "IDRiD ids must be unique"
        write_csv(out / "labels.csv", rows)
        log("IDRiD graded images:", len(rows))
        z.close(); zl.close()
        mark("idrid:grading")
    if not done("idrid:seg"):
        z = _idrid_zip("A.Segmentation.zip")
        names = z.namelist()
        code = {"1. Microaneurysms": 0, "2. Haemorrhages": 1, "3. Hard Exudates": 2, "4. Soft Exudates": 3}
        rows = []
        out = PROC / "seg"
        for m in sorted(names):
            if "1. Original Images" not in m or not m.lower().endswith(".jpg"):
                continue
            name = Path(m).stem
            split = "train" if "Training" in m else "test"
            rgb = decode_image(z.read(m))
            sq, tr = crop_square(rgb, SEG_SIZE)
            packed = np.zeros((SEG_SIZE, SEG_SIZE), np.uint8)
            for gm in names:
                if f"/{name}_" in gm and gm.lower().endswith(".tif"):
                    folder = gm.split("/")[-2]
                    if folder in code:
                        msk = cv2.imdecode(np.frombuffer(z.read(gm), np.uint8), cv2.IMREAD_GRAYSCALE)
                        msk = (msk > 0).astype(np.uint8)
                        packed |= (crop_mask_like(msk, tr) << code[folder]).astype(np.uint8)
            save_jpg(out / "img" / f"idrid_{name}.jpg", sq)
            (out / "mask").mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out / "mask" / f"idrid_{name}.png"), packed)
            rows.append({"id": f"idrid_{name}", "source": "idrid", "split": split})
        _append_seg_rows(rows)
        z.close()
        mark("idrid:seg")
    if done("idrid:grading") and done("idrid:seg"):
        shutil.rmtree(RAW / "idrid", ignore_errors=True)
        mark("idrid")


def _append_seg_rows(rows: list[dict]) -> None:
    p = PROC / "seg" / "labels.csv"
    old = list(csv.DictReader(open(p))) if p.exists() else []
    ids = {r["id"] for r in rows}
    write_csv(p, [r for r in old if r["id"] not in ids] + rows)


# ----------------------------------------------------------------- DDR
DDR_REPO = "ctmedtech/DDR-dataset"


def _ddr_files(prefix: str) -> list[str]:
    from huggingface_hub import HfApi

    return sorted(f.path for f in HfApi().list_repo_tree(DDR_REPO, path_in_repo=prefix, repo_type="dataset",
                                                         recursive=True) if hasattr(f, "size"))


def _ddr_get(path: str) -> Path:
    """Download one file (streamed to D:), returning its local path."""
    from huggingface_hub import hf_hub_download

    local = RAW / "ddr"
    p = local / path
    if p.exists() and p.stat().st_size > 0:
        return p
    for attempt in range(6):
        try:
            return Path(hf_hub_download(DDR_REPO, path, repo_type="dataset", local_dir=str(local)))
        except Exception as e:  # rate limits (429/499) and transient network errors
            if attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))
            log("retry", path, type(e).__name__)


def fetch_ddr() -> None:
    """DDR (CC-BY 4.0): grading test split (external test, incl. grade 5 = ungradable)
    and lesion segmentation (757 images, EX/HE/MA/SE masks). Streams file by file: download,
    convert, delete, so peak disk use stays small."""
    if not done("ddr:test"):
        out = PROC / "ddr"
        (out / "img").mkdir(parents=True, exist_ok=True)
        lines = _ddr_get("DR_grading/test.txt").read_text().split()
        pairs = list(zip(lines[0::2], lines[1::2]))

        def work(p):
            fn, g = p
            dst = out / "img" / f"{Path(fn).stem}.jpg"
            if not dst.exists():
                src = _ddr_get(f"DR_grading/test/{fn}")
                rgb = decode_image(src.read_bytes())
                sq, _ = crop_square(rgb, GRADE_SIZE)
                save_jpg(dst, sq)
                src.unlink(missing_ok=True)
            return {"id": Path(fn).stem, "split": "test", "grade": int(g)}

        rows = []
        with ThreadPoolExecutor(4) as ex:
            for i, r in enumerate(ex.map(work, pairs)):
                rows.append(r)
                if i % 500 == 0:
                    log("DDR test", i, "/", len(pairs))
        write_csv(out / "labels.csv", rows)
        log("DDR test images:", len(rows))
        shutil.rmtree(RAW / "ddr" / "DR_grading", ignore_errors=True)
        mark("ddr:test")
    if not done("ddr:seg"):
        out = PROC / "seg"
        (out / "mask").mkdir(parents=True, exist_ok=True)
        (out / "img").mkdir(parents=True, exist_ok=True)
        files = _ddr_files("lesion_segmentation")
        ann_map = {"train": "train", "val": "val", "test": "tet"}
        ann = {}
        for f in files:
            parts = f.split("/")
            if parts[1] == "annotations" and len(parts) == 5:
                ann[(parts[2], parts[3], Path(parts[4]).stem)] = f
        imgs = [f for f in files if f.split("/")[1] == "images" and f.lower().endswith(".jpg")]

        def work(f):
            split, stem = f.split("/")[2], Path(f).stem
            rid = f"ddr_{stem}"
            if not ((out / "img" / f"{rid}.jpg").exists() and (out / "mask" / f"{rid}.png").exists()):
                src = _ddr_get(f)
                rgb = decode_image(src.read_bytes())
                sq, tr = crop_square(rgb, SEG_SIZE)
                packed = np.zeros((SEG_SIZE, SEG_SIZE), np.uint8)
                for bit, les in enumerate(LESIONS):
                    key = (ann_map[split], les, stem)
                    if key in ann:
                        ap = _ddr_get(ann[key])
                        msk = cv2.imread(str(ap), cv2.IMREAD_GRAYSCALE)
                        if msk is not None:
                            packed |= (crop_mask_like((msk > 0).astype(np.uint8), tr) << bit).astype(np.uint8)
                        ap.unlink(missing_ok=True)
                save_jpg(out / "img" / f"{rid}.jpg", sq)
                cv2.imwrite(str(out / "mask" / f"{rid}.png"), packed)
                src.unlink(missing_ok=True)
            return {"id": rid, "source": "ddr", "split": split}

        with ThreadPoolExecutor(4) as ex:
            rows = list(ex.map(work, imgs))
        _append_seg_rows(rows)
        log("DDR seg images:", len(rows))
        shutil.rmtree(RAW / "ddr" / "lesion_segmentation", ignore_errors=True)
        mark("ddr:seg")
    if not done("ddr:gradetrain"):
        out = PROC / "ddr"
        (out / "img").mkdir(parents=True, exist_ok=True)
        rows = []
        for split, txt in [("train", "DR_grading/train.txt"), ("val", "DR_grading/valid.txt")]:
            lines = _ddr_get(txt).read_text().split()
            pairs = list(zip(lines[0::2], lines[1::2]))
            folder = "train" if split == "train" else "valid"

            def work(p, folder=folder, split=split):
                fn, g = p
                dst = out / "img" / f"{Path(fn).stem}.jpg"
                if not dst.exists():
                    src = _ddr_get(f"DR_grading/{folder}/{fn}")
                    rgb = decode_image(src.read_bytes())
                    sq, _ = crop_square(rgb, GRADE_SIZE)
                    save_jpg(dst, sq)
                    src.unlink(missing_ok=True)
                return {"id": Path(fn).stem, "split": split, "grade": int(g)}

            with ThreadPoolExecutor(6) as ex:
                for i, r in enumerate(ex.map(work, pairs)):
                    rows.append(r)
                    if i % 500 == 0:
                        log("DDR", split, i, "/", len(pairs))
        write_csv(out / "labels_trainval.csv", rows)
        log("DDR train/val images:", len(rows))
        shutil.rmtree(RAW / "ddr" / "DR_grading", ignore_errors=True)
        mark("ddr:gradetrain")
    if done("ddr:test") and done("ddr:seg"):
        shutil.rmtree(RAW / "ddr", ignore_errors=True)
        mark("ddr")


# ----------------------------------------------------------------- DeepDRiD
def fetch_deepdrid() -> None:
    """DeepDRiD (CC-BY-SA 4.0): regular fundus images with DR grade and real quality labels."""
    if done("deepdrid"):
        return
    local = Path(os.environ.get("DEEPDRID_RAW") or (RAW / "deepdrid"))  # raw clone can live on another drive
    if not (local / ".git").exists():
        shutil.rmtree(local, ignore_errors=True)
        subprocess.run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
                        "https://github.com/deepdrdoc/DeepDRiD.git", str(local)], check=True)
    subprocess.run(["git", "-C", str(local), "sparse-checkout", "set", "regular_fundus_images/regular-fundus-training",
                    "regular_fundus_images/regular-fundus-validation"], check=True)
    out = PROC / "deepdrid"
    rows = []
    for split, folder in [("train", "regular-fundus-training"), ("val", "regular-fundus-validation")]:
        d = local / "regular_fundus_images" / folder
        csvs = [c for c in d.glob("*.csv") if "source" not in c.name.lower()]
        if not csvs:
            log("DeepDRiD: no csv in", d)
            continue
        recs = list(csv.DictReader(open(csvs[0], encoding="utf-8-sig")))
        index = {p.stem: p for p in d.rglob("*.jpg")}
        for r in recs:
            r = {k.strip(): (v or "").strip() for k, v in r.items()}
            img_id = Path(r.get("image_id", "")).stem
            src = index.get(img_id)
            if src is None:
                continue
            lg = r.get("left_eye_DR_Level") or ""
            rg = r.get("right_eye_DR_Level") or ""
            grade = lg if lg not in ("", None) else rg
            rgb = decode_image(src.read_bytes())
            sq, _ = crop_square(rgb, GRADE_SIZE)
            save_jpg(out / "img" / f"{img_id}.jpg", sq)
            rows.append({
                "id": img_id, "split": split, "patient_id": r.get("patient_id", ""),
                "grade": grade, "overall_quality": r.get("Overall quality", ""),
                "clarity": r.get("Clarity", ""), "field_definition": r.get("Field definition", ""),
                "artifact": r.get("Artifact", ""),
            })
    if rows:
        write_csv(out / "labels.csv", rows)
        log("DeepDRiD images:", len(rows))
        shutil.rmtree(local, ignore_errors=True)
        mark("deepdrid")


# ----------------------------------------------------------------- main
SOURCES = {"idrid": fetch_idrid, "aptos": fetch_aptos, "ddr": fetch_ddr, "deepdrid": fetch_deepdrid}


def main(argv: list[str]) -> int:
    if "--status" in argv:
        print(json.dumps(_load(), indent=2))
        return 0
    names = [a for a in argv if not a.startswith("-")] or list(SOURCES)
    failed = []
    for n in names:
        try:
            log("==>", n)
            SOURCES[n]()
            log("<== ok", n)
        except Exception as e:  # keep going so one broken mirror does not block the rest
            log("!! failed", n, repr(e))
            failed.append(n)
    if failed:
        log("FAILED:", failed, "- re-run `python -m ml.data.fetch", " ".join(failed), "` to resume")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
