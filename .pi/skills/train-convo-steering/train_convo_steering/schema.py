from __future__ import annotations
"""
Data models for train-convo-steering.

Contains:
- TurnLog: Runtime interaction log
- FeatureRow: Offline feature vector
"""

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Literal
import datetime

@dataclass
class SteeringWeights:
    fast_tempo_delta: float = -0.8
    deep_tempo_delta: float = 0.8
    praise_trust_delta: float = 0.5
    frustration_trust_delta: float = -0.7
    confused_alignment_delta: float = -0.7
    proceed_alignment_delta: float = 0.3
    
    # Reward weights
    reward_praise: float = 1.0
    reward_proceed: float = 1.0
    reward_reask: float = -0.6
    reward_failure: float = -1.0

@dataclass
class SteeringConfig:
    weights: SteeringWeights = field(default_factory=SteeringWeights)
    min_samples: int = 5
    alpha: float = 1.0
    max_nightly_delta: float = 0.10

Channel = Literal["text", "voice"]

@dataclass(frozen=True)
class TurnLog:
    user_id: str
    session_id: str
    ts: str  # ISO 8601
    channel: Channel
    user_text: str
    agent_text: str

    # runtime decisioning fields (optional at log time)
    chosen_preset: Optional[str] = None
    state_bucket: Optional[Dict[str, str]] = None

    # optional signals
    latency_ms: Optional[int] = None
    interruptions: Optional[int] = None
    barge_in: Optional[bool] = None

    # optional metadata
    agent_meta: Optional[Dict[str, Any]] = None
    outcomes: Optional[Dict[str, Any]] = None

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "TurnLog":
        for k in ("user_id","session_id","ts","channel","user_text","agent_text"):
            if k not in d:
                raise ValueError(f"missing field: {k}")
        ch = d["channel"]
        if ch not in ("text","voice"):
            raise ValueError(f"invalid channel: {ch}")
        return TurnLog(
            user_id=str(d["user_id"]),
            session_id=str(d["session_id"]),
            ts=str(d["ts"]),
            channel=ch,
            user_text=str(d["user_text"]),
            agent_text=str(d["agent_text"]),
            chosen_preset=d.get("chosen_preset"),
            state_bucket=d.get("state_bucket"),
            latency_ms=d.get("latency_ms"),
            interruptions=d.get("interruptions"),
            barge_in=d.get("barge_in"),
            agent_meta=d.get("agent_meta"),
            outcomes=d.get("outcomes"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

@dataclass(frozen=True)
class FeatureRow:
    user_id: str
    session_id: str
    ts: str
    channel: Channel
    state_key: str
    preset_id: str
    reward: float
    flags: Dict[str, bool]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
