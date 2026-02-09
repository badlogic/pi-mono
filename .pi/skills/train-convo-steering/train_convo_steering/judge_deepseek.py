from __future__ import annotations
"""
DeepSeek V3 Judge integration.

Uses an external LLM (via scillm/Chutes.ai) to rank steering presets
for ambiguous conversation turns.
"""

import os
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from loguru import logger

# Add scillm to path
SKILLS_DIR = Path(__file__).resolve().parents[2]
if str(SKILLS_DIR) not in sys.path:
    sys.path.append(str(SKILLS_DIR))

try:
    from scillm import parallel_acompletions
except ImportError:
    parallel_acompletions = None

from .presets import SteeringPreset

try:
    from ..dotenv_helper import load_env
    load_env()
except ImportError:
    pass

def judge_enabled() -> bool:
    return os.getenv("DEESEEK_JUDGE_ENABLED", "0").lower() in ("1", "true", "yes")

def validate_judge_response(obj: Any, presets: List[SteeringPreset]) -> bool:
    """Validate that the judge returned a proper ranking of existing presets."""
    if not isinstance(obj, dict): return False
    best = obj.get("best_preset_id")
    ranking = obj.get("ranking")
    if not isinstance(best, str) or not isinstance(ranking, list): return False
    
    # Ensure all IDs exist
    valid_ids = {p.preset_id for p in presets}
    if best not in valid_ids: return False
    for rid in ranking:
        if rid not in valid_ids: return False
    return True

def build_judge_prompt(user_text: str, channel: str, state_bucket: Dict[str, str], presets: List[SteeringPreset]) -> str:
    # Keep prompt short and deterministic.
    lines = []
    lines.append("You are a conversation steering judge. Choose the best steering preset for the next assistant turn.")
    lines.append("Return ONLY valid JSON with keys: best_preset_id, ranking (array of preset_id), rationale (<=30 words).")
    lines.append("")
    lines.append(f"Channel: {channel}")
    lines.append(f"User text: {user_text}")
    lines.append(f"State bucket: {state_bucket}")
    lines.append("")
    lines.append("Presets:")
    for p in presets:
        lines.append(f"- {p.preset_id}: {p.description}")
    return "\n".join(lines)

async def judge_best_preset(
    user_text: str,
    channel: str,
    state_bucket: Dict[str, str],
    presets: List[SteeringPreset],
    timeout_s: float = 30.0,
) -> Optional[Dict[str, Any]]:
    """Judge the best preset via scillm with tenacious retries."""
    if not parallel_acompletions:
        logger.warning("scillm not found, skipping judge call")
        return None

    api_base = os.getenv("CHUTES_API_BASE", "").rstrip("/")
    api_key = os.getenv("CHUTES_API_KEY", "")
    model = os.getenv("DEESEEK_MODEL", os.getenv("CHUTES_TEXT_MODEL", "deepseek-v3"))
    
    if not api_key:
        logger.warning("DeepSeek judge enabled but missing CHUTES_API_KEY")
        return None

    prompt = build_judge_prompt(user_text=user_text, channel=channel, state_bucket=state_bucket, presets=presets)
    
    req = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a strict JSON-only assistant. Return ONLY JSON with keys: best_preset_id, ranking, rationale."},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.0,
        "max_tokens": 300,
    }

    try:
        # Tenacious mode enabled as requested by user
        results = await parallel_acompletions(
            [req],
            api_base=api_base,
            api_key=api_key,
            custom_llm_provider="openai_like",
            timeout=timeout_s,
            tenacious=True,
        )
        if not results or "error" in results[0]:
            err = results[0].get("error") if results else "Empty response"
            logger.warning(f"DeepSeek judge call failed: {err}")
            return None
            
        content = results[0].get("content", "{}")
        obj = json.loads(content)
        if validate_judge_response(obj, presets):
            return obj
        logger.warning(f"Judge returned invalid structure: {content[:100]}...")
    except Exception as e:
        logger.warning(f"DeepSeek judge call handler failed: {e}")
    
    return None
