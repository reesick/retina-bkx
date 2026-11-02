"""Fixed, seeded splits written once to data/splits/*.csv.

APTOS has no patient IDs, so the split is image-level (stated as a limitation).
APTOS: 70% train / 15% val (calibration, thresholds) / 15% internal test.
IDRiD and DDR test are external: never used for fitting or threshold selection of the graders.
"""
from __future__ import annotations

import pandas as pd
from sklearn.model_selection import train_test_split

from ml.common import PROC, SEED, SPLITS


def main() -> None:
    SPLITS.mkdir(parents=True, exist_ok=True)
    a = pd.read_csv(PROC / "aptos" / "labels.csv")
    a = a.drop_duplicates("id").sort_values("id").reset_index(drop=True)
    tr, rest = train_test_split(a, test_size=0.30, stratify=a["grade"], random_state=SEED)
    va, te = train_test_split(rest, test_size=0.50, stratify=rest["grade"], random_state=SEED)
    a["split"] = "train"
    a.loc[a["id"].isin(va["id"]), "split"] = "val"
    a.loc[a["id"].isin(te["id"]), "split"] = "test"
    a["path"] = [str(PROC / "aptos" / "img" / f"{i}.jpg") for i in a["id"]]
    a.to_csv(SPLITS / "aptos.csv", index=False)
    print(a.groupby(["split", "grade"]).size().unstack(fill_value=0))


if __name__ == "__main__":
    main()
