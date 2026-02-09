from __future__ import annotations
"""
Heuristic signal extraction for train-convo-steering.

Contains regex-based classifiers for extracting:
- State bucket signals (tempo, trust, etc)
- Outcome flags (frustration, praise, etc)
"""

import re
from typing import Dict, Any, Tuple

_FRUSTRATION = re.compile(r"\b(hallucinat|wrong|stop|wtf|this sucks|missed|bullshit)\b", re.I)
_PRAISE = re.compile(r"\b(thanks|great|perfect|nice|awesome|exactly)\b", re.I)
_PROCEED = re.compile(r"\b(proceed|do it|run it|yes|go ahead)\b", re.I)
_FAST = re.compile(r"\b(tldr|quick|short|fast|no fluff|skip)\b", re.I)
_DEEP = re.compile(r"\b(comprehensive|thorough|details|deep|step by step)\b", re.I)
_SLOW = re.compile(r"\b(slow|careful|explain)\b", re.I)
_CONFUSED = re.compile(r"\b(i'?m lost|confused|confus|what do you mean|clarify)\b", re.I)

from .schema import TurnLog, SteeringConfig

def bucket3(x: float) -> str:
    if x < -0.33:
        return "low"
    if x > 0.33:
        return "high"
    return "mid"

def estimate_state_bucket(user_text: str, outcomes: Dict[str, Any] | None = None, config: SteeringConfig | None = None) -> Dict[str, str]:
    ut = user_text or ""
    outcomes = outcomes or {}
    config = config or SteeringConfig()
    w = config.weights

    tempo = 0.0
    trust = 0.0
    alignment = 0.0
    affect = 0.0
    control = 0.0

    if _FAST.search(ut):
        tempo += w.fast_tempo_delta
    if _DEEP.search(ut) or _SLOW.search(ut):
        tempo += w.deep_tempo_delta

    if _PRAISE.search(ut) or outcomes.get("praise"):
        trust += w.praise_trust_delta
        affect += 0.4

    if _FRUSTRATION.search(ut) or outcomes.get("frustration") or outcomes.get("stop"):
        trust += w.frustration_trust_delta
        affect -= 0.8

    if _CONFUSED.search(ut) or outcomes.get("reask"):
        alignment += w.confused_alignment_delta

    if _PROCEED.search(ut) or outcomes.get("proceed"):
        alignment += w.proceed_alignment_delta
        control += 0.3

    return {
        "tempo": bucket3(tempo),
        "trust": bucket3(trust),
        "alignment": bucket3(alignment),
        "affect": bucket3(affect),
        "control": bucket3(control),
    }

def state_key(state_bucket: Dict[str, str]) -> str:
    return "|".join([state_bucket[k] for k in ("tempo","trust","alignment","affect","control")])

def reward_from_outcomes(outcomes: Dict[str, Any] | None, config: SteeringConfig | None = None) -> Tuple[float, Dict[str, bool]]:
    outcomes = outcomes or {}
    config = config or SteeringConfig()
    w = config.weights
    
    flags = {
        "proceed": bool(outcomes.get("proceed", False)),
        "stop": bool(outcomes.get("stop", False)),
        "reask": bool(outcomes.get("reask", False)),
        "frustration": bool(outcomes.get("frustration", False)),
        "praise": bool(outcomes.get("praise", False)),
    }
    r = 0.0
    if flags["proceed"]:
        r += w.reward_proceed
    if flags["praise"]:
        r += w.reward_praise
    if flags["reask"]:
        r += w.reward_reask
    if flags["stop"] or flags["frustration"]:
        r += w.reward_failure
        
    return float(r), flags
