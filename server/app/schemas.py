"""Pydantic models mirroring docs/04_API.md.

Request bodies are validated with these models. Response payloads are built as plain dicts (so optional
ImageResult fields stay absent rather than null) and the tests validate them against the response models.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Eye = Literal["OD", "OS"]
View = Literal["macula", "disc", "other"]
Outcome = Literal["ROUTINE", "REFER", "HUMAN_REVIEW", "RETAKE"]
Urgency = Optional[Literal["routine_12m", "soon", "immediate"]]
LesionType = Literal["MA", "HE", "EX", "SE"]
ReferralStatus = Literal["issued", "scheduled", "attended", "feedback", "closed", "not_completed"]
Sex = Optional[Literal["F", "M", "X"]]


class _Out(BaseModel):
    model_config = ConfigDict(extra="allow")


# ------------------------------------------------------------------ result pieces
class Reason(_Out):
    code: str
    text: str


class RuleStep(_Out):
    rule: str
    fired: bool
    detail: str


class QualityCheck(_Out):
    code: str
    label: str
    value: float
    threshold: float
    pass_: bool = Field(alias="pass")
    hard: bool
    detail: str


class QualityProbs(_Out):
    adequate: float
    usable: float
    inadequate: float


class Quality(_Out):
    category: Literal["adequate", "usable", "inadequate"]
    score: float
    probs: Optional[QualityProbs]
    reasons: list[str]
    checks: list[QualityCheck]


class Landmark(_Out):
    x: float
    y: float
    conf: float


class Laterality(_Out):
    predicted: Literal["OD", "OS", "unknown"]
    confidence: float
    selected: Eye
    mismatch: bool


class Landmarks(_Out):
    od: Landmark
    fovea: Landmark
    disc_diameter: float
    laterality: Laterality


class ModelGrade(_Out):
    name: str
    probs: list[float] = Field(min_length=5, max_length=5)
    p_referable: float
    temperature: float


class Ensemble(_Out):
    probs: list[float] = Field(min_length=5, max_length=5)
    grade: Literal[0, 1, 2, 3, 4]
    p_referable: float


class Grading(_Out):
    models: list[ModelGrade]
    ensemble: Ensemble


class Uncertainty(_Out):
    entropy: float
    entropy_threshold: float
    disagreement: float
    disagreement_threshold: float
    ood_score: float
    ood_threshold: float
    flags: list[str]


class Lesion(_Out):
    id: str
    type: LesionType
    bbox: list[float] = Field(min_length=4, max_length=4)
    centroid: list[float] = Field(min_length=2, max_length=2)
    area_frac: float
    confidence: float
    dist_fovea_dd: Optional[float]


class LesionSummary(_Out):
    count: int
    area_frac: float


class Lesions(_Out):
    summary: dict[LesionType, LesionSummary]
    items: list[Lesion]


class MacularRisk(_Out):
    flag: bool
    ex_within_1dd: int
    label: str


class Triage(_Out):
    outcome: Outcome
    urgency: Urgency
    reasons: list[Reason]
    rule_trace: list[RuleStep]
    policy_version: str


class Overlays(_Out):
    cam: str
    attention: str
    lesions: str
    MA: str
    HE: str
    EX: str
    SE: str


class ImageUrls(_Out):
    original: str
    canonical: str
    overlays: Overlays


class ImageResult(_Out):
    id: str
    encounter_id: str
    eye: Eye
    view: View
    status: Literal["queued", "running", "done", "error"]
    error: Optional[str]
    created_at: str
    sha256: str
    urls: ImageUrls
    canonical_size: int
    fov_deg: float
    quality: Optional[Quality] = None
    landmarks: Optional[Landmarks] = None
    grading: Optional[Grading] = None
    uncertainty: Optional[Uncertainty] = None
    lesions: Optional[Lesions] = None
    macular_risk: Optional[MacularRisk] = None
    triage: Optional[Triage] = None
    timings_ms: Optional[dict[str, float]] = None
    model_versions: Optional[dict[str, str]] = None
    result_hash: Optional[str] = None


# ------------------------------------------------------------------ encounter
class VA(_Out):
    value: Optional[str]
    logmar: Optional[float]


class EncounterVA(_Out):
    OD: VA
    OS: VA
    method: Optional[str]
    measured_at: Optional[str]
    operator: Optional[str]


class EyeDecision(_Out):
    outcome: Optional[Outcome]
    urgency: Urgency
    missing: bool


class EncounterAI(_Out):
    outcome: Outcome
    urgency: Urgency
    eyes: dict[Eye, EyeDecision]
    flags: list[Reason]
    rule_trace: list[RuleStep]
    policy_version: str


class Review(_Out):
    reviewer: str
    decision: Literal["approve", "override"]
    final_outcome: Outcome
    final_urgency: Urgency
    reason: str
    acknowledged_flags: list[str]
    at: str


class ReferralEvent(_Out):
    from_: Optional[ReferralStatus] = Field(alias="from")
    to: ReferralStatus
    note: str
    at: str


class Referral(_Out):
    id: str
    encounter_id: str
    status: ReferralStatus
    priority: Urgency
    facility: Optional[str]
    issued_at: str
    appointment_at: Optional[str]
    attended_at: Optional[str]
    feedback: Optional[str]
    next_followup_at: Optional[str]
    not_completed_reason: Optional[str]
    events: list[ReferralEvent]


class Encounter(_Out):
    id: str
    patient_code: str
    age: Optional[int]
    sex: Sex
    diabetes_years: Optional[float]
    notes: str
    created_at: str
    va: EncounterVA
    images: list[ImageResult]
    ai: Optional[EncounterAI]
    status: Literal["open", "awaiting_review", "signed"]
    review: Optional[Review]
    referral: Optional[Referral]
    priority: float


class EncounterSummary(_Out):
    id: str
    patient_code: str
    created_at: str
    status: Literal["open", "awaiting_review", "signed"]
    ai_outcome: Optional[Outcome]
    ai_urgency: Urgency
    final_outcome: Optional[Outcome]
    thumb: Optional[str]
    n_images: int
    flags: list[str]
    priority: float


class ReferralStats(_Out):
    total: int
    completed_rate: float
    median_days_to_attend: Optional[float]
    overdue: int
    with_feedback_rate: float


class Health(_Out):
    status: Literal["ok"]
    models: dict[str, dict]
    missing: list[str]
    version: str
    offline: Literal[True]


# ------------------------------------------------------------------ request bodies
class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")


class EncounterCreate(_In):
    patient_code: Optional[str] = Field(default=None, max_length=64)
    age: Optional[int] = Field(default=None, ge=0, le=130)
    sex: Sex = None
    diabetes_years: Optional[float] = Field(default=None, ge=0, le=100)
    notes: Optional[str] = Field(default=None, max_length=10000)


class EncounterPatch(EncounterCreate):
    pass


class VAValue(_In):
    value: Optional[str] = Field(default=None, max_length=32)


class VAUpdate(_In):
    OD: VAValue = VAValue()
    OS: VAValue = VAValue()
    method: Optional[str] = Field(default=None, max_length=64)
    measured_at: Optional[str] = None
    operator: Optional[str] = Field(default=None, max_length=128)


class ReviewIn(_In):
    reviewer: str = Field(max_length=128)
    decision: Literal["approve", "override"]
    final_outcome: Outcome
    final_urgency: Urgency = None
    reason: str = Field(default="", max_length=10000)
    acknowledged_flags: list[str] = []


class ReferralMove(_In):
    to: ReferralStatus
    note: Optional[str] = Field(default=None, max_length=10000)
    facility: Optional[str] = Field(default=None, max_length=256)
    appointment_at: Optional[str] = None
    attended_at: Optional[str] = None
    feedback: Optional[str] = Field(default=None, max_length=10000)
    next_followup_at: Optional[str] = None
    not_completed_reason: Optional[str] = Field(default=None, max_length=10000)
