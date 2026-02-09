from __future__ import annotations
"""
CLI entrypoint for train-convo-steering.

Commands:
- runtime-step: Fast, single-turn inference
- nightly: Heavy, offline learning pipeline
"""

import asyncio
import datetime as dt
from pathlib import Path
from typing import Optional

import sys
from pathlib import Path
from typing import Optional

import typer
from loguru import logger

# Add .pi/skills to path to find shared helpers if needed, 
# although run.sh usually handles this.
try:
    from ..dotenv_helper import load_env
except ImportError:
    # Fallback if imported from outside the skills package structure
    def load_env(): pass

from .io_utils import append_jsonl, write_json
from .schema import TurnLog, SteeringConfig, SteeringWeights
from .heuristics import estimate_state_bucket
from .presets import default_presets
from .policy import load_user_prior, choose_preset, preset_by_id
from .pipeline import normalize_logs, build_features, train_priors, run_judge_subset

import json

app = typer.Typer(add_completion=False)

def load_config(path: Optional[Path]) -> SteeringConfig:
    if not path or not path.exists():
        return SteeringConfig()
    try:
        data = json.loads(path.read_text())
        weights_data = data.get("weights", {})
        weights = SteeringWeights(**weights_data) if weights_data else SteeringWeights()
        return SteeringConfig(
            weights=weights,
            min_samples=data.get("min_samples", 5),
            alpha=data.get("alpha", 1.0),
            max_nightly_delta=data.get("max_nightly_delta", 0.10)
        )
    except Exception as e:
        logger.warning(f"Failed to load config from {path}: {e}")
        return SteeringConfig()

@app.command()
def runtime_step(
    user_id: str = typer.Option(..., help="User identifier"),
    session_id: str = typer.Option(..., help="Session identifier"),
    channel: str = typer.Option(..., help="text|voice"),
    user_text: str = typer.Option(..., help="User utterance/transcript"),
    agent_text: str = typer.Option("", help="Optional agent text (if already generated)"),
    priors_dir: Path = typer.Option(Path("./priors"), help="Directory containing per-user priors"),
    log_out: Path = typer.Option(Path("./_out/live_logs.jsonl"), help="Append-only runtime log output"),
    config_path: Optional[Path] = typer.Option(None, "--config", help="Path to SteeringConfig JSON"),
):
    """Runtime per-turn steering: infer state, choose preset, append log row.

    Voice-first: this should be fast and bounded.
    """
    load_env()
    config = load_config(config_path)

    if channel not in ("text","voice"):
        raise typer.BadParameter("channel must be text or voice")

    presets = default_presets()
    state_bucket = estimate_state_bucket(user_text, outcomes=None, config=config)

    prior = load_user_prior(priors_dir, user_id=user_id)
    decision = choose_preset(state_bucket=state_bucket, presets=presets, user_prior=prior, config=config)
    preset = preset_by_id(presets, decision.preset_id)

    row = TurnLog(
        user_id=user_id,
        session_id=session_id,
        ts=dt.datetime.now(dt.timezone.utc).isoformat(),
        channel=channel,  # type: ignore
        user_text=user_text,
        agent_text=agent_text,
        chosen_preset=preset.preset_id,
        state_bucket=state_bucket,
    ).to_dict()

    append_jsonl(log_out, row)

    # Print decision as JSON to integrate upstream
    out = {
        "state_bucket": state_bucket,
        "decision": {"preset_id": decision.preset_id, "confidence": decision.confidence, "reason": decision.reason},
        "preset": preset.to_dict(),
    }
    typer.echo_json(out)

@app.command()
def nightly(
    logs: Path = typer.Option(..., help="Input JSONL logs (append-only from runtime)"),
    out: Path = typer.Option(Path("./_out"), help="Output directory"),
    enable_judge: bool = typer.Option(False, help="Force-enable DeepSeek judge (also requires env vars)"),
    judge_max_examples: int = typer.Option(200, help="Max judged examples per nightly run"),
    config_path: Optional[Path] = typer.Option(None, "--config", help="Path to SteeringConfig JSON"),
):
    """Nightly pipeline: normalize -> featurize -> (optional) judge -> train priors -> report."""
    load_env()
    config = load_config(config_path)

    out = out.resolve()
    artifacts = out / "artifacts"
    priors_dir = out / "priors"
    reports = out / "reports"

    episodes_path = artifacts / "episodes.jsonl"
    features_path = artifacts / "features.jsonl"
    labels_path = artifacts / "judge_labels.jsonl"

    # Estimate total items for task monitor (lines in logs x phases)
    total_lines = 0
    if logs.exists():
        with logs.open("r") as f:
            for _ in f: total_lines += 1
    
    # Approx 4 phases: normalize, featurize, judge (partial), train
    task_client = None
    if total_lines > 0:
        from .task_monitor_client import SteeringTaskClient
        task_client = SteeringTaskClient(task_name=f"nightly-{dt.datetime.now().strftime('%Y%m%d')}", total_items=total_lines * 4)

    logger.info(f"Normalize: {logs} -> {episodes_path}")
    norm_stats = normalize_logs(logs, episodes_path, task_client=task_client)

    logger.info(f"Featurize: {episodes_path} -> {features_path}")
    feat_stats = build_features(episodes_path, features_path, config=config, task_client=task_client)

    do_judge = enable_judge
    # also allow env flag
    from .judge_deepseek import judge_enabled as _je
    do_judge = do_judge or _je()

    judge_stats = None
    if do_judge:
        logger.info(f"Judge subset -> {labels_path}")
        judge_stats = asyncio.run(run_judge_subset(episodes_path, labels_path, max_examples=judge_max_examples, task_client=task_client))
    else:
        logger.info("Judge disabled (set DEESEEK_JUDGE_ENABLED=1 or pass --enable-judge)")

    logger.info(f"Train priors -> {priors_dir}")
    train_report = train_priors(features_path, priors_dir, judge_labels_path=(labels_path if judge_stats else None), config=config, task_client=task_client)
    
    if task_client:
        task_client.finish()

    report = {
        "norm": norm_stats,
        "features": feat_stats,
        "judge": judge_stats,
        "train": train_report,
        "outputs": {
            "episodes": str(episodes_path),
            "features": str(features_path),
            "judge_labels": str(labels_path) if judge_stats else None,
            "priors_dir": str(priors_dir),
        },
    }
    write_json(reports / "nightly_report.json", report)
    logger.success(f"Wrote report: {reports / 'nightly_report.json'}")

if __name__ == "__main__":
    app()
