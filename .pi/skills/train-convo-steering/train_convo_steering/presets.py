from __future__ import annotations
"""
Steering Presets definition.

Defines the bounded set of actions (presets) available to the agent,
mapping high-level names to low-level knobs (length, tone, etc).
"""

from dataclasses import dataclass, asdict
from typing import Dict, Any, List

@dataclass(frozen=True)
class SteeringPreset:
    preset_id: str
    description: str

    # response knobs
    length: str              # short|medium|long
    questions: str           # 0|1|2+
    initiative: str          # propose-first|ask-first
    certainty: str           # tentative|neutral|confident
    grounding: str           # none|light|heavy

    # voice knobs (optional; caller maps to PersonaPlex)
    pace: str                # slow|normal|fast
    pause_density: str       # low|normal|high
    energy: str              # low|normal|high

    # traversal knobs
    traversal_budget: str    # low|normal|high
    confirm_density: str     # low|normal|high

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

def default_presets() -> List[SteeringPreset]:
    # Keep bounded and interpretable. Add more later.
    return [
        SteeringPreset(
            preset_id="fast_proceed",
            description="Fast, no-fluff execution with minimal questions.",
            length="short", questions="0", initiative="propose-first", certainty="neutral", grounding="light",
            pace="fast", pause_density="low", energy="normal",
            traversal_budget="low", confirm_density="low",
        ),
        SteeringPreset(
            preset_id="clarify_once",
            description="Short answer plus exactly one clarifying question.",
            length="short", questions="1", initiative="ask-first", certainty="neutral", grounding="light",
            pace="normal", pause_density="normal", energy="normal",
            traversal_budget="normal", confirm_density="normal",
        ),
        SteeringPreset(
            preset_id="trust_repair",
            description="Repair trust: concrete artifacts, careful claims, citations if available.",
            length="medium", questions="0", initiative="propose-first", certainty="tentative", grounding="heavy",
            pace="slow", pause_density="high", energy="low",
            traversal_budget="high", confirm_density="high",
        ),
        SteeringPreset(
            preset_id="deep_dive",
            description="Thorough, structured explanation with steps and tradeoffs.",
            length="long", questions="1", initiative="propose-first", certainty="neutral", grounding="light",
            pace="normal", pause_density="normal", energy="normal",
            traversal_budget="high", confirm_density="normal",
        ),
        SteeringPreset(
            preset_id="exec_summary_plus_steps",
            description="Executive summary then concrete steps; minimizes cognitive load.",
            length="medium", questions="0", initiative="propose-first", certainty="confident", grounding="light",
            pace="normal", pause_density="normal", energy="normal",
            traversal_budget="normal", confirm_density="low",
        ),
        SteeringPreset(
            preset_id="socratic",
            description="Exploratory, user-led; uses questions to converge.",
            length="medium", questions="2+", initiative="ask-first", certainty="tentative", grounding="none",
            pace="slow", pause_density="high", energy="low",
            traversal_budget="normal", confirm_density="high",
        ),
    ]
