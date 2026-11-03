"""SQLite persistence (SQLAlchemy 2.x). Tables follow docs/02_ARCHITECTURE.md."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import Float, ForeignKey, Integer, String, Text, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class EncounterRow(Base):
    __tablename__ = "encounters"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    patient_code: Mapped[str] = mapped_column(String, index=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sex: Mapped[str | None] = mapped_column(String, nullable=True)
    diabetes_years: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String, index=True)
    va_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_outcome_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open", index=True)
    final_outcome: Mapped[str | None] = mapped_column(String, nullable=True)
    final_urgency: Mapped[str | None] = mapped_column(String, nullable=True)


class ImageRow(Base):
    __tablename__ = "images"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    encounter_id: Mapped[str] = mapped_column(String, ForeignKey("encounters.id"), index=True)
    eye: Mapped[str] = mapped_column(String)
    view: Mapped[str] = mapped_column(String)
    camera: Mapped[str | None] = mapped_column(String, nullable=True)
    fov_deg: Mapped[float] = mapped_column(Float, default=45.0)
    sha256: Mapped[str] = mapped_column(String)
    path_original: Mapped[str] = mapped_column(String)
    path_canonical: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String)


class LesionRow(Base):
    __tablename__ = "lesions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    image_id: Mapped[str] = mapped_column(String, ForeignKey("images.id"), index=True)
    type: Mapped[str] = mapped_column(String)
    bbox_json: Mapped[str] = mapped_column(Text)
    centroid_json: Mapped[str] = mapped_column(Text)
    area_frac: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    dist_fovea_dd: Mapped[float | None] = mapped_column(Float, nullable=True)


class ReviewRow(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    encounter_id: Mapped[str] = mapped_column(String, ForeignKey("encounters.id"), unique=True)
    reviewer: Mapped[str] = mapped_column(String)
    decision: Mapped[str] = mapped_column(String)
    final_outcome: Mapped[str] = mapped_column(String)
    final_urgency: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    acknowledged_flags_json: Mapped[str] = mapped_column(Text, default="[]")
    at: Mapped[str] = mapped_column(String)


class ReferralRow(Base):
    __tablename__ = "referrals"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    encounter_id: Mapped[str] = mapped_column(String, ForeignKey("encounters.id"), unique=True)
    status: Mapped[str] = mapped_column(String, index=True)
    priority: Mapped[str | None] = mapped_column(String, nullable=True)
    facility: Mapped[str | None] = mapped_column(String, nullable=True)
    issued_at: Mapped[str] = mapped_column(String)
    appointment_at: Mapped[str | None] = mapped_column(String, nullable=True)
    attended_at: Mapped[str | None] = mapped_column(String, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_followup_at: Mapped[str | None] = mapped_column(String, nullable=True)
    not_completed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[str] = mapped_column(String)


class ReferralEventRow(Base):
    __tablename__ = "referral_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    referral_id: Mapped[str] = mapped_column(String, ForeignKey("referrals.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String, nullable=True)
    to_status: Mapped[str] = mapped_column(String)
    note: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[str] = mapped_column(String)


class AgentRunRow(Base):
    """One LangGraph encounter run (the graph's own checkpoints live in agents.db; this is the app-facing summary)."""
    __tablename__ = "agent_runs"
    encounter_id: Mapped[str] = mapped_column(String, ForeignKey("encounters.id"), primary_key=True)
    thread_id: Mapped[str] = mapped_column(String)
    run_no: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String, default="queued")   # queued | running | awaiting_signoff | done | error
    state_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    overrides_json: Mapped[str] = mapped_column(Text, default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[str] = mapped_column(String)


class AuditRow(Base):
    __tablename__ = "audit"
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[str] = mapped_column(String)
    event: Mapped[str] = mapped_column(String, index=True)
    encounter_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    image_id: Mapped[str | None] = mapped_column(String, nullable=True)
    actor: Mapped[str] = mapped_column(String)
    payload_json: Mapped[str] = mapped_column(Text)
    prev_hash: Mapped[str] = mapped_column(String)
    hash: Mapped[str] = mapped_column(String)


def make_engine(db_path: Path) -> Engine:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _rec):  # pragma: no cover - trivial
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(engine)
    return engine


def make_sessionmaker(engine: Engine) -> sessionmaker:
    return sessionmaker(engine, expire_on_commit=False)
