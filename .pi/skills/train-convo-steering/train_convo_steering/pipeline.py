from __future__ import annotations
"""
Nightly pipeline module for train-convo-steering.

Handles the offline learning loop:
1. Normalizing raw logs into episodes
2. Computing features and rewards
3. Running DeepSeek judge (optional)
4. Training empirical bandits (priors)
"""

import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional
import asyncio

import asyncio

from loguru import logger

from .io_utils import read_jsonl, write_jsonl, write_json
from .heuristics import estimate_state_bucket, state_key, reward_from_outcomes
from .presets import default_presets
from .judge_deepseek import judge_enabled, judge_best_preset
from .schema import TurnLog, FeatureRow, SteeringConfig

# Type hint for task monitor if available
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .task_monitor_client import SteeringTaskClient

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def now_iso() -> str:
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc).isoformat()

def normalize_logs(logs_path: Path, out_episodes_path: Path, task_client: Optional[SteeringTaskClient] = None) -> Dict[str, Any]:
    turns: List[Dict[str, Any]] = []
    bad = 0
    for d in read_jsonl(logs_path):
        try:
            t = TurnLog.from_dict(d)
            turns.append(t.to_dict())
            if task_client:
                task_client.update(status="normalizing")
        except Exception as e:
            bad += 1
            logger.warning(f"Skipping bad log row: {e}")

    turns.sort(key=lambda x: (x["user_id"], x["session_id"], x["ts"]))
    write_jsonl(out_episodes_path, turns)
    return {"rows": len(turns), "bad_rows": bad, "sha256": sha256_file(out_episodes_path)}

def build_features(episodes_path: Path, out_features_path: Path, config: Optional[SteeringConfig] = None, task_client: Optional[SteeringTaskClient] = None) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    config = config or SteeringConfig()
    for d in read_jsonl(episodes_path):
        t = TurnLog.from_dict(d)
        sb = t.state_bucket or estimate_state_bucket(t.user_text, t.outcomes, config=config)
        sk = state_key(sb)
        preset = t.chosen_preset or "clarify_once"

        reward, flags = reward_from_outcomes(t.outcomes, config=config)
        fr = FeatureRow(
            user_id=t.user_id,
            session_id=t.session_id,
            ts=t.ts,
            channel=t.channel,
            state_key=sk,
            preset_id=preset,
            reward=reward,
            flags=flags,
        )
        rows.append(fr.to_dict())
        if task_client:
            task_client.update(status="featurizing")

    rows.sort(key=lambda x: (x["user_id"], x["session_id"], x["ts"]))
    write_jsonl(out_features_path, rows)
    return {"rows": len(rows), "sha256": sha256_file(out_features_path)}

async def run_judge_subset(
    episodes_path: Path,
    out_labels_path: Path,
    max_examples: int = 200,
    task_client: Optional[SteeringTaskClient] = None,
) -> Dict[str, Any]:
    # Judge only ambiguous/failure-ish turns to maximize value.
    presets = default_presets()
    out_rows: List[Dict[str, Any]] = []
    count = 0

    for d in read_jsonl(episodes_path):
        if count >= max_examples:
            break
        t = TurnLog.from_dict(d)
        if task_client:
            task_client.update(status=f"judging ({count}/{max_examples})")
        sb = t.state_bucket or estimate_state_bucket(t.user_text, t.outcomes)
        outcomes = t.outcomes or {}
        is_failure = bool(outcomes.get("frustration") or outcomes.get("stop") or outcomes.get("reask"))
        is_ambiguous = (sb["alignment"] == "low") or (sb["trust"] == "low") or (sb["affect"] == "low")
        if not (is_failure or is_ambiguous):
            continue

        obj = await judge_best_preset(
            user_text=t.user_text,
            channel=t.channel,
            state_bucket=sb,
            presets=presets,
        )
        if not obj:
            continue

        best = obj.get("best_preset_id")
        ranking = obj.get("ranking")
        if not isinstance(best, str):
            continue

        out_rows.append({
            "user_id": t.user_id,
            "session_id": t.session_id,
            "ts": t.ts,
            "state_bucket": sb,
            "best_preset_id": best,
            "ranking": ranking if isinstance(ranking, list) else None,
            "rationale": obj.get("rationale"),
        })
        count += 1

    out_rows.sort(key=lambda x: (x["user_id"], x["session_id"], x["ts"]))
    write_jsonl(out_labels_path, out_rows)
    return {"rows": len(out_rows), "sha256": sha256_file(out_labels_path)}

def train_priors(
    features_path: Path,
    priors_dir: Path,
    judge_labels_path: Optional[Path] = None,
    config: Optional[SteeringConfig] = None,
    task_client: Optional[SteeringTaskClient] = None,
) -> Dict[str, Any]:
    """Train per-user priors as empirical bandits over presets."""
    config = config or SteeringConfig()
    alpha = config.alpha
    min_samples_per_state = config.min_samples
    max_nightly_delta = config.max_nightly_delta

    # user -> state -> preset -> [sum_reward, count]
    agg: Dict[str, Dict[str, Dict[str, List[float]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])))
    overall: Dict[str, List[float]] = defaultdict(lambda: [0.0, 0.0])
    user_rows = defaultdict(int)

    for d in read_jsonl(features_path):
        uid = d["user_id"]
        sk = d["state_key"]
        pid = d["preset_id"]
        r = float(d["reward"])
        agg[uid][sk][pid][0] += r
        agg[uid][sk][pid][1] += 1.0
        overall[pid][0] += r
        overall[pid][1] += 1.0
        user_rows[uid] += 1
        if task_client:
            task_client.update(status="training")

    # Incorporate judge labels gently (acts like preference supervision)
    judge_used = 0
    if judge_labels_path and judge_labels_path.exists():
        for d in read_jsonl(judge_labels_path):
            uid = d["user_id"]
            sb = d.get("state_bucket") or {}
            if not isinstance(sb, dict):
                continue
            sk = "|".join([sb.get(k, "mid") for k in ("tempo","trust","alignment","affect","control")])
            best = d.get("best_preset_id")
            if not isinstance(best, str):
                continue
            # Small positive bump and count bump.
            agg[uid][sk][best][0] += 0.5
            agg[uid][sk][best][1] += 0.5
            overall[best][0] += 0.5
            overall[best][1] += 0.5
            judge_used += 1

    def smoothed_mean(s: float, n: float) -> float:
        return (s + alpha * 0.0) / (n + alpha)

    # Global fallback: best overall preset
    global_best = "clarify_once"
    best_score = -1e9
    for pid, (s, n) in overall.items():
        m = smoothed_mean(s, n)
        if m > best_score:
            best_score = m
            global_best = pid

    priors_dir.mkdir(parents=True, exist_ok=True)
    emitted = 0

    for uid, by_state in agg.items():
        state_policy: Dict[str, Any] = {}
        for sk, by_preset in by_state.items():
            total = sum(v[1] for v in by_preset.values())

            best_pid = global_best
            best_m = -1e9
            dist = {}
            for pid, (s, n) in by_preset.items():
                m = smoothed_mean(s, n)
                dist[pid] = {"mean_reward": m, "count": float(n)}
                if m > best_m:
                    best_m = m
                    best_pid = pid

            confidence = min(1.0, float(total) / float(max(min_samples_per_state, 1)))
            state_policy[sk] = {
                "best_preset": best_pid,
                "best_mean_reward": best_m,
                "total_samples": float(total),
                "confidence": confidence,
                "presets": dist,
            }

        prior = {
            "user_id": uid,
            "version": "v2-empirical-bandit-presets",
            "trained_at": now_iso(),
            "training_rows": int(user_rows[uid]),
            "judge_labels_used": int(judge_used),
            "global_fallback_preset": global_best,
            "state_policy": state_policy,
            "bounds": {
                "allowed_presets": [p.preset_id for p in default_presets()],
                "confidence_threshold": 0.5,
                "max_nightly_delta": max_nightly_delta,
            },
        }
        write_json(priors_dir / f"{uid}.json", prior)
        emitted += 1

    return {"users": emitted, "global_best_preset": global_best, "judge_labels_used": judge_used, "unique_presets": len(overall)}
