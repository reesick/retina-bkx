"""Fixed, seeded splits written once to data/splits/*.csv.

aptos.csv    APTOS 70 / 15 / 15 (train / val / test), image-level (no patient ids), stratified, seed 42.
grading.csv  Multi-source grader splits (v2, fixes the APTOS-only domain shift):
               train = APTOS train + DDR train + DeepDRiD train
               val   = APTOS val + DDR valid          (temperatures, OOD, every policy threshold)
               test  = APTOS test + DDR test (same sources, held out) + DeepDRiD val (patient-level held out)
               ext   = IDRiD, all 516 images          (never used for training or fitting: the external test)
             DDR grade 5 (ungradable) and DeepDRiD images without a grade are excluded from grading splits.
"""
from __future__ import annotations

import pandas as pd
from sklearn.model_selection import train_test_split

from ml.common import PROC, SEED, SPLITS


def aptos() -> pd.DataFrame:
    a = pd.read_csv(PROC / "aptos" / "labels.csv")
    a = a.drop_duplicates("id").sort_values("id").reset_index(drop=True)
    tr, rest = train_test_split(a, test_size=0.30, stratify=a["grade"], random_state=SEED)
    va, te = train_test_split(rest, test_size=0.50, stratify=rest["grade"], random_state=SEED)
    a["split"] = "train"
    a.loc[a["id"].isin(va["id"]), "split"] = "val"
    a.loc[a["id"].isin(te["id"]), "split"] = "test"
    a["path"] = [str(PROC / "aptos" / "img" / f"{i}.jpg") for i in a["id"]]
    return a


def grading(a: pd.DataFrame) -> pd.DataFrame:
    parts = [a.assign(source="aptos")[["id", "grade", "split", "path", "source"]]]
    ddr = []
    for f in ["labels_trainval.csv", "labels.csv"]:
        p = PROC / "ddr" / f
        if p.exists():
            ddr.append(pd.read_csv(p)[["id", "grade", "split"]])
    if ddr:
        d = pd.concat(ddr).drop_duplicates("id")
        d = d[d.grade <= 4]
        d["path"] = [str(PROC / "ddr" / "img" / f"{i}.jpg") for i in d["id"]]
        parts.append(d.assign(source="ddr"))
    p = PROC / "deepdrid" / "labels.csv"
    if p.exists():
        q = pd.read_csv(p)
        q = q[pd.to_numeric(q.grade, errors="coerce").between(0, 4)].copy()
        q["grade"] = q.grade.astype(float).astype(int)
        q["split"] = q.split.map({"train": "train", "val": "test"})
        q["path"] = [str(PROC / "deepdrid" / "img" / f"{i}.jpg") for i in q["id"]]
        parts.append(q[["id", "grade", "split", "path"]].assign(source="deepdrid"))
    i = pd.read_csv(PROC / "idrid" / "labels.csv")
    i["path"] = [str(PROC / "idrid" / "img" / f"{x}.jpg") for x in i["id"]]
    parts.append(i[["id", "grade", "path"]].assign(split="ext", source="idrid"))
    return pd.concat(parts, ignore_index=True)


def main() -> None:
    SPLITS.mkdir(parents=True, exist_ok=True)
    a = aptos()
    a.to_csv(SPLITS / "aptos.csv", index=False)
    g = grading(a)
    g.to_csv(SPLITS / "grading.csv", index=False)
    print(g.groupby(["split", "source"]).size().unstack(fill_value=0))
    print(g.groupby(["split", "grade"]).size().unstack(fill_value=0))


if __name__ == "__main__":
    main()
