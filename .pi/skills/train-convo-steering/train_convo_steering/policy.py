from __future__ import annotations
"""
Policy logic for train-convo-steering.

Handles:
- Loading per-user priors
- Selecting the best preset based on state and history
- Fallback heuristics
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List, Optional
import json

from .presets import SteeringPreset
from .heuristics import state_key
from .schema import SteeringConfig

@dataclass(frozen=True)
class PolicyDecision:
    preset_id: str
    confidence: float
    reason: str

def load_user_prior(priors_dir: Path, user_id: str) -> Optional[Dict[str, Any]]:
    p = priors_dir / f"{user_id}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None

def choose_preset(
    state_bucket: Dict[str, str],
    presets: List[SteeringPreset],
    user_prior: Optional[Dict[str, Any]],
    config: Optional[SteeringConfig] = None,
) -> PolicyDecision:
    """Choose the best preset, favoring per-user priors if confident."""
    sk = state_key(state_bucket)
    config = config or SteeringConfig()

    # Fallback global default
    fallback = "clarify_once"
    
    if user_prior:
        fallback = user_prior.get("global_fallback_preset", fallback)
        entry = (user_prior.get("state_policy") or {}).get(sk)
        conf_thresh = user_prior.get("bounds", {}).get("confidence_threshold", 0.5)
        if entry and float(entry.get("confidence", 0.0)) >= conf_thresh:
            pid = entry.get("best_preset", fallback)
            return PolicyDecision(preset_id=pid, confidence=float(entry.get("confidence", 0.5)), reason="user_prior")

    # Simple global heuristic: if trust/affect low -> trust_repair; if tempo low -> fast_proceed
    if state_bucket["trust"] == "low" or state_bucket["affect"] == "low":
        return PolicyDecision(preset_id="trust_repair", confidence=0.6, reason="global_heuristic_trust_repair")
    if state_bucket["tempo"] == "low" and state_bucket["alignment"] != "low":
        return PolicyDecision(preset_id="fast_proceed", confidence=0.6, reason="global_heuristic_fast")
    if state_bucket["alignment"] == "low":
        return PolicyDecision(preset_id="clarify_once", confidence=0.6, reason="global_heuristic_clarify")

    return PolicyDecision(preset_id=fallback, confidence=0.4, reason="fallback")

def preset_by_id(presets: List[SteeringPreset], preset_id: str) -> SteeringPreset:
    for p in presets:
        if p.preset_id == preset_id:
            return p
    # should not happen; return clarify_once
    for p in presets:
        if p.preset_id == "clarify_once":
            return p
    return presets[0]
