"""Hash-chained audit log.

hash = sha256(prev_hash + canonical_json({at, event, encounter_id, image_id, actor, payload}))
The first entry uses 64 zeros as prev_hash. Callers append inside their own transaction while holding
the store write lock, so the chain is linear.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import AuditRow
from .ids import iso

GENESIS = "0" * 64


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def entry_hash(prev_hash: str, at: str, event: str, encounter_id: str | None, image_id: str | None,
               actor: str, payload: Any) -> str:
    body = canonical_json({"at": at, "event": event, "encounter_id": encounter_id, "image_id": image_id,
                           "actor": actor, "payload": payload})
    return hashlib.sha256((prev_hash + body).encode("utf-8")).hexdigest()


def append(s: Session, event: str, *, encounter_id: str | None = None, image_id: str | None = None,
           actor: str = "system", payload: dict | None = None) -> AuditRow:
    payload = payload or {}
    last = s.execute(select(AuditRow).order_by(AuditRow.seq.desc()).limit(1)).scalar_one_or_none()
    prev = last.hash if last else GENESIS
    at = iso()
    row = AuditRow(at=at, event=event, encounter_id=encounter_id, image_id=image_id, actor=actor,
                   payload_json=canonical_json(payload), prev_hash=prev,
                   hash=entry_hash(prev, at, event, encounter_id, image_id, actor, payload))
    s.add(row)
    s.flush()
    return row


def to_dict(r: AuditRow) -> dict:
    return {"seq": r.seq, "at": r.at, "event": r.event, "encounter_id": r.encounter_id, "image_id": r.image_id,
            "actor": r.actor, "payload": json.loads(r.payload_json), "prev_hash": r.prev_hash, "hash": r.hash}


def verify(s: Session) -> dict:
    prev = GENESIS
    checked = 0
    for r in s.execute(select(AuditRow).order_by(AuditRow.seq)).scalars():
        try:
            payload = json.loads(r.payload_json)
            h = entry_hash(prev, r.at, r.event, r.encounter_id, r.image_id, r.actor, payload)
        except Exception:
            return {"valid": False, "checked": checked, "first_bad_seq": r.seq}
        if r.prev_hash != prev or r.hash != h:
            return {"valid": False, "checked": checked, "first_bad_seq": r.seq}
        prev = r.hash
        checked += 1
    return {"valid": True, "checked": checked, "first_bad_seq": None}
