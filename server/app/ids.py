"""Short random ids and deterministic patient codes."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Callable


def new_id(prefix: str) -> str:
    """`enc_` + 10 hex chars, `img_…`, `ref_…`, `rev_…`."""
    return f"{prefix}_{secrets.token_hex(5)}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    dt = dt or utcnow()
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def patient_code(day: datetime, exists: Callable[[str], bool]) -> str:
    """`RT-YYMMDD-XXXX` where XXXX is the next free 4-digit sequence number for that (local) day.

    Deterministic: the n-th auto-coded encounter of a day always gets sequence n (skipping codes in use).
    """
    prefix = f"RT-{day.strftime('%y%m%d')}-"
    n = 1
    while exists(f"{prefix}{n:04d}"):
        n += 1
    return f"{prefix}{n:04d}"
