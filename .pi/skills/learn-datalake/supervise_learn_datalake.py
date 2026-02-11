#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "typer>=0.12.3",
#   "loguru>=0.7.0",
# ]
# ///
"""Active supervisor for learn-datalake long-running loops.

This script provides deterministic control around a non-deterministic pipeline:
- keep the child process alive (auto-restart)
- diagnose failure signatures from logs
- persist run diagnostics and failure buckets
- stop safely via stop-file
"""

from __future__ import annotations

import json
import os
import re
import shlex
import signal
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import typer
from loguru import logger

app = typer.Typer(no_args_is_help=True, add_completion=False)

SKILL_DIR = Path(__file__).resolve().parent
SKILLS_ROOT = SKILL_DIR.parent
LEARN_DATALAKE_RUN = SKILL_DIR / "run.sh"
REVIEW_PDF_DIR = SKILLS_ROOT / "review-pdf"
DEBUG_PDF_DIR = SKILLS_ROOT / "debug-pdf"
DEBUG_TABLE_DIR = SKILLS_ROOT / "debug-table"
FIXTURE_TRICKY_DIR = SKILLS_ROOT / "fixture-tricky"
MEMORY_DIR = SKILLS_ROOT / "memory"
MEMORY_RUN = MEMORY_DIR / "run.sh"
TASK_MONITOR_DIR = SKILLS_ROOT / "task-monitor"
TASK_MONITOR_RUN = TASK_MONITOR_DIR / "run.sh"
DEFAULT_ROOT = Path("/mnt/storage12tb/extractor_corpus/nasa")
STATE_DIR = SKILL_DIR / "state"
WATCHDOG_DIR = STATE_DIR / "watchdogs"
RUN_DIR = STATE_DIR / "runs"
DIAG_DIR = WATCHDOG_DIR / "diagnostics"
TASK_MONITOR_STATE_DIR = STATE_DIR / "task_monitor"
MEMORY_RETRY_QUEUE = WATCHDOG_DIR / "memory_retry_queue.jsonl"

EXTRACT_SUCCESS_RE = re.compile(r"extract_missing status=extracted new_count=[0-9]+")
EXTRACT_FAIL_RE = re.compile(r"extract_missing status=extract_failed")
EXTRACT_EVENT_PDF_RE = re.compile(
    r"extract_missing status=(?P<status>[a-z_]+)(?: .*?)? pdf=(?P<pdf>.+)$"
)
EXTRACT_TIMEOUT_HINT_RE = re.compile(
    r"extract_timeout seconds=(?P<seconds>[0-9]+)\s+"
    r"page_count=(?P<page_count>[0-9]+)\s+"
    r"step00_estimated=(?P<step00_estimated>[0-9]+)\s+"
    r"source=[^ ]+\s+pdf=(?P<pdf>.+)$"
)
ROLLING_QUALITY_RE = re.compile(
    r"rolling_quality\s+analyzed=(?P<analyzed>[0-9]+)\s+"
    r"avg_score=(?P<avg_score>[0-9.]+)\s+"
    r"fail_ratio=(?P<fail_ratio>[0-9.]+)\s+"
    r"critical_doc_ratio=(?P<critical_ratio>[0-9.]+)"
)
DOC_TOTAL_RE = re.compile(r"^documents_total=(?P<value>[0-9]+)$")
DOC_ANALYZED_RE = re.compile(r"^documents_analyzed=(?P<value>[0-9]+)$")
DOC_MISSING_RE = re.compile(r"^documents_missing=(?P<value>[0-9]+)$")
OVERALL_SCORE_RE = re.compile(r"^overall_average_score=(?P<value>[0-9.]+)$")
VERDICTS_RE = re.compile(
    r"^verdicts=PASS:(?P<pass>[0-9]+)\s+WARN:(?P<warn>[0-9]+)\s+FAIL:(?P<fail>[0-9]+)$"
)
LOOP_HEALTH_RE = re.compile(
    r"loop cycle=(?P<cycle>[0-9]+)\s+healthy=(?P<healthy>True|False)\s+"
    r"score=(?P<score>[0-9.]+)\s+fail_ratio=(?P<fail_ratio>[0-9.]+)"
)


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_read_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _failure_total(failure_buckets: Dict[str, int]) -> int:
    return sum(int(v) for v in failure_buckets.values())


def _append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


def _normalize_pdf_path(raw_value: str) -> Optional[str]:
    candidate = raw_value.strip().strip('"').strip("'")
    if not candidate:
        return None
    if not candidate.lower().endswith(".pdf"):
        return None
    return candidate


def _append_recent_failure(
    *,
    metrics: Dict[str, Any],
    pdf_path: str,
    reason: str,
    max_items: int = 32,
) -> None:
    normalized = _normalize_pdf_path(pdf_path)
    if not normalized:
        return
    events = list(metrics.get("recent_failed_events", []))
    events = [item for item in events if item.get("pdf") != normalized]
    events.append(
        {
            "pdf": normalized,
            "reason": reason,
            "timestamp": _now_utc_iso(),
        }
    )
    metrics["recent_failed_events"] = events[-max_items:]
    metrics["recent_failed_pdfs"] = [item["pdf"] for item in metrics["recent_failed_events"]]
    metrics["recent_failed_pdf_count"] = len(metrics["recent_failed_pdfs"])


def _recommended_watchdog_from_step00(
    timeout_seconds: int,
    page_count: int,
    step00_estimated: int,
) -> int:
    baseline = max(3600, timeout_seconds)
    estimate_component = max(0, step00_estimated) * 45
    page_component = max(0, page_count) * 90
    proposed = max(baseline, estimate_component, page_component)
    return int(max(3600, min(43200, proposed + 600)))


def _detect_phase(line: str) -> Optional[str]:
    lowered = line.lower()
    if "discover_profiles" in lowered or "discover_pdfs" in lowered:
        return "discover"
    if "discover_progress" in lowered or "extract_missing status=" in lowered:
        return "extract"
    if "rolling_quality" in lowered or "documents_total=" in lowered:
        return "score"
    if "hard_fail" in lowered or "auto_debug" in lowered:
        return "debug"
    if "loop cycle=" in lowered:
        return "evaluate"
    if "review-pdf summary" in lowered:
        return "summary"
    return None


def _run_shell_command(
    *,
    cmd: str,
    cwd: Path,
    timeout_seconds: int,
) -> Dict[str, Any]:
    proc = subprocess.run(
        ["bash", "-lc", cmd],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    return {
        "returncode": proc.returncode,
        "stdout_tail": "\n".join(proc.stdout.splitlines()[-30:]),
        "stderr_tail": "\n".join(proc.stderr.splitlines()[-30:]),
    }


def _memory_learn(
    *,
    problem: str,
    solution: str,
    strict: bool,
) -> None:
    if not MEMORY_RUN.exists():
        msg = f"memory skill missing at {MEMORY_RUN}"
        if strict:
            raise RuntimeError(msg)
        logger.warning(msg)
        return
    cmd = [
        str(MEMORY_RUN),
        "learn",
        "--problem",
        problem,
        "--solution",
        solution,
        "--scope",
        "learn_datalake",
        "--tag",
        "learn-datalake",
    ]
    proc = subprocess.run(
        cmd,
        cwd=str(MEMORY_DIR),
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if proc.returncode != 0:
        tail = proc.stderr.splitlines()[-1] if proc.stderr else ""
        msg = f"memory learn failed rc={proc.returncode} problem={problem[:80]} stderr_tail={tail}"
        if strict:
            raise RuntimeError(msg)
        logger.warning(msg)


def _record_learning_event(
    *,
    events_path: Path,
    event_type: str,
    root: Path,
    label: str,
    run_id: str,
    summary: str,
    details: Dict[str, Any],
    strict: bool,
) -> None:
    event = {
        "event_type": event_type,
        "timestamp": _now_utc_iso(),
        "root": str(root),
        "label": label,
        "run_id": run_id,
        "summary": summary,
        "details": details,
    }
    _append_jsonl(events_path, event)
    compact = {
        "event_type": event_type,
        "run_id": run_id,
        "summary": summary,
        "quality_gate_action": details.get("quality_gate_action"),
        "quality_gate_reason": details.get("quality_gate_reason"),
        "rolling_avg_score": details.get("rolling_avg_score"),
        "rolling_fail_ratio": details.get("rolling_fail_ratio"),
        "documents_missing_ratio": details.get("documents_missing_ratio"),
        "failure_signature": details.get("failure_signature"),
    }
    memory_problem = f"learn-datalake {event_type}: {summary}"
    memory_solution = json.dumps(compact, ensure_ascii=True)
    try:
        _memory_learn(
            problem=memory_problem,
            solution=memory_solution,
            strict=strict,
        )
    except Exception as exc:
        retry_payload = {
            "timestamp": _now_utc_iso(),
            "event_type": event_type,
            "root": str(root),
            "label": label,
            "run_id": run_id,
            "problem": memory_problem,
            "solution": memory_solution,
            "error": str(exc),
        }
        _append_jsonl(MEMORY_RETRY_QUEUE, retry_payload)
        logger.warning(
            "memory_write_queued "
            f"run_id={run_id} event_type={event_type} error={type(exc).__name__}"
        )


def _collect_run_metrics(
    *,
    run_log: Path,
    heartbeat_timeout_seconds: int,
) -> Dict[str, Any]:
    metrics: Dict[str, Any] = {
        "phase": "startup",
        "phase_age_seconds": 0,
        "documents_total": 0,
        "documents_analyzed": 0,
        "documents_missing": 0,
        "documents_missing_ratio": None,
        "rolling_docs_analyzed": 0,
        "rolling_avg_score": None,
        "rolling_fail_ratio": None,
        "rolling_critical_doc_ratio": None,
        "overall_average_score": None,
        "last_loop_healthy": None,
        "last_loop_score": None,
        "last_loop_fail_ratio": None,
        "loop_cycle_count": 0,
        "extraction_success_count": 0,
        "extraction_failed_count": 0,
        "extraction_timeout_count": 0,
        "extraction_attempts": 0,
        "extraction_timeout_rate_pct": 0.0,
        "extraction_fail_rate_pct": 0.0,
        "recent_failed_events": [],
        "recent_failed_pdfs": [],
        "recent_failed_pdf_count": 0,
        "recommended_watchdog_seconds": 0,
        "adaptive_heartbeat_timeout_seconds": heartbeat_timeout_seconds,
        "last_extracted_pdf": "",
    }
    if not run_log.exists():
        return metrics

    phase_seen_at: Dict[str, int] = {}
    lines = _tail_text(run_log, max_lines=3000).splitlines()
    now_epoch = int(time.time())
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        phase = _detect_phase(stripped)
        if phase:
            metrics["phase"] = phase
            phase_seen_at[phase] = now_epoch
        if EXTRACT_SUCCESS_RE.search(stripped):
            metrics["extraction_success_count"] = int(metrics["extraction_success_count"]) + 1
            match_pdf = EXTRACT_EVENT_PDF_RE.search(stripped)
            if match_pdf:
                metrics["last_extracted_pdf"] = match_pdf.group("pdf").strip()
        if EXTRACT_FAIL_RE.search(stripped):
            metrics["extraction_failed_count"] = int(metrics["extraction_failed_count"]) + 1
        event_match = EXTRACT_EVENT_PDF_RE.search(stripped)
        if event_match:
            status = event_match.group("status")
            pdf_path = event_match.group("pdf")
            if status != "extracted":
                _append_recent_failure(metrics=metrics, pdf_path=pdf_path, reason=f"extract_{status}")
        timeout_match = EXTRACT_TIMEOUT_HINT_RE.search(stripped)
        if timeout_match:
            metrics["extraction_timeout_count"] = int(metrics["extraction_timeout_count"]) + 1
            timeout_seconds = int(timeout_match.group("seconds"))
            page_count = int(timeout_match.group("page_count"))
            step00_estimated = int(timeout_match.group("step00_estimated"))
            recommended = _recommended_watchdog_from_step00(
                timeout_seconds=timeout_seconds,
                page_count=page_count,
                step00_estimated=step00_estimated,
            )
            metrics["recommended_watchdog_seconds"] = max(
                int(metrics["recommended_watchdog_seconds"]),
                recommended,
            )
            _append_recent_failure(
                metrics=metrics,
                pdf_path=timeout_match.group("pdf"),
                reason="extract_timeout",
            )
        rolling_match = ROLLING_QUALITY_RE.search(stripped)
        if rolling_match:
            metrics["rolling_docs_analyzed"] = int(rolling_match.group("analyzed"))
            metrics["rolling_avg_score"] = float(rolling_match.group("avg_score"))
            metrics["rolling_fail_ratio"] = float(rolling_match.group("fail_ratio"))
            metrics["rolling_critical_doc_ratio"] = float(rolling_match.group("critical_ratio"))
        loop_match = LOOP_HEALTH_RE.search(stripped)
        if loop_match:
            metrics["loop_cycle_count"] = int(loop_match.group("cycle"))
            metrics["last_loop_healthy"] = loop_match.group("healthy") == "True"
            metrics["last_loop_score"] = float(loop_match.group("score"))
            metrics["last_loop_fail_ratio"] = float(loop_match.group("fail_ratio"))
        total_match = DOC_TOTAL_RE.search(stripped)
        if total_match:
            metrics["documents_total"] = int(total_match.group("value"))
        analyzed_match = DOC_ANALYZED_RE.search(stripped)
        if analyzed_match:
            metrics["documents_analyzed"] = int(analyzed_match.group("value"))
        missing_match = DOC_MISSING_RE.search(stripped)
        if missing_match:
            metrics["documents_missing"] = int(missing_match.group("value"))
        score_match = OVERALL_SCORE_RE.search(stripped)
        if score_match:
            metrics["overall_average_score"] = float(score_match.group("value"))

    attempts = int(metrics["extraction_success_count"]) + int(metrics["extraction_failed_count"]) + int(
        metrics["extraction_timeout_count"]
    )
    metrics["extraction_attempts"] = attempts
    if attempts > 0:
        metrics["extraction_timeout_rate_pct"] = round(
            100.0 * int(metrics["extraction_timeout_count"]) / attempts,
            2,
        )
        metrics["extraction_fail_rate_pct"] = round(
            100.0 * int(metrics["extraction_failed_count"]) / attempts,
            2,
        )
    docs_total = int(metrics["documents_total"])
    if docs_total > 0:
        metrics["documents_missing_ratio"] = round(
            int(metrics["documents_missing"]) / docs_total,
            4,
        )
    effective_heartbeat = max(
        heartbeat_timeout_seconds,
        int(metrics["recommended_watchdog_seconds"] or 0),
    )
    metrics["adaptive_heartbeat_timeout_seconds"] = effective_heartbeat
    metrics["phase_age_seconds"] = 0 if not phase_seen_at else max(0, int(time.time()) - max(phase_seen_at.values()))
    return metrics


def _apply_quality_gate(
    metrics: Dict[str, Any],
    *,
    target_score: float,
    target_fail_ratio: float,
) -> Dict[str, str]:
    docs_total = int(metrics.get("documents_total", 0) or 0)
    docs_analyzed = int(metrics.get("documents_analyzed", 0) or 0)
    docs_missing_ratio = metrics.get("documents_missing_ratio")
    phase = str(metrics.get("phase", "") or "")
    phase_age_seconds = int(metrics.get("phase_age_seconds", 0) or 0)
    loop_cycles = int(metrics.get("loop_cycle_count", 0) or 0)
    rolling_docs = int(metrics.get("rolling_docs_analyzed", 0) or 0)
    rolling_score = metrics.get("rolling_avg_score")
    rolling_fail = metrics.get("rolling_fail_ratio")
    if (
        docs_total >= 50
        and isinstance(docs_missing_ratio, (int, float))
        and float(docs_missing_ratio) > 0.20
    ):
        if phase in {"discover", "extract"} and phase_age_seconds < 1800:
            return {
                "quality_gate_action": "continue_extracting",
                "quality_gate_reason": "coverage_backlog_in_progress",
            }
        if loop_cycles == 0 or docs_analyzed < 50:
            return {
                "quality_gate_action": "continue_extracting",
                "quality_gate_reason": "coverage_pending_cycle_completion",
            }
        return {
            "quality_gate_action": "diagnose_debug_resume",
            "quality_gate_reason": "documents_missing_ratio_high",
        }
    if (
        rolling_docs >= 10
        and isinstance(rolling_score, (int, float))
        and float(rolling_score) < float(target_score)
    ):
        return {
            "quality_gate_action": "diagnose_debug_resume",
            "quality_gate_reason": "rolling_score_below_target_early",
        }
    if (
        rolling_docs >= 10
        and isinstance(rolling_fail, (int, float))
        and float(rolling_fail) > float(target_fail_ratio)
    ):
        return {
            "quality_gate_action": "diagnose_debug_resume",
            "quality_gate_reason": "rolling_fail_ratio_above_target_early",
        }
    return {
        "quality_gate_action": "continue_extracting",
        "quality_gate_reason": "within_thresholds",
    }


def _run_targeted_debug_chain(
    *,
    run_id: str,
    recent_failed_pdfs: list[str],
    timeout_seconds: int,
    max_failure_samples: int,
) -> Dict[str, Any]:
    output_dir = DIAG_DIR / f"targeted_debug_{run_id}_{int(time.time())}"
    output_dir.mkdir(parents=True, exist_ok=True)
    selected_paths: list[Path] = []
    seen: set[str] = set()
    for raw in recent_failed_pdfs:
        normalized = _normalize_pdf_path(raw)
        if not normalized or normalized in seen:
            continue
        path = Path(normalized)
        if not path.exists():
            continue
        selected_paths.append(path)
        seen.add(normalized)
        if len(selected_paths) >= max_failure_samples:
            break
    if not selected_paths:
        return {
            "status": "skipped",
            "reason": "no_recent_failed_pdfs",
            "output_dir": str(output_dir),
        }

    per_pdf_timeout = max(600, min(2400, timeout_seconds // max(1, len(selected_paths))))
    pdf_results: list[Dict[str, Any]] = []
    for index, pdf_path in enumerate(selected_paths, start=1):
        review_output_dir = output_dir / f"review_{index}"
        review_output_dir.mkdir(parents=True, exist_ok=True)
        review_cmd = (
            f"./run.sh check {shlex.quote(str(pdf_path))} "
            f"--output-dir {shlex.quote(str(review_output_dir))} "
            "--execute-jobs --max-jobs-per-doc 2 --extract-missing "
            "--ingest-memory --memory-scope datalake_pdf "
            "--taxonomy-collection operational"
        )
        review_result = _run_shell_command(
            cmd=review_cmd,
            cwd=REVIEW_PDF_DIR,
            timeout_seconds=per_pdf_timeout,
        )
        table_cmd = (
            f"./run.sh tune {shlex.quote(str(pdf_path))} "
            "--converge --max-iterations 2 --json"
        )
        table_result = _run_shell_command(
            cmd=table_cmd,
            cwd=DEBUG_TABLE_DIR,
            timeout_seconds=max(900, per_pdf_timeout),
        )
        pdf_results.append(
            {
                "pdf": str(pdf_path),
                "review_pdf_check": review_result,
                "debug_table_tune": table_result,
            }
        )

    fixture_dir = output_dir / "fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    fixture_commands = [
        ("gauntlet", f"./run.sh gauntlet --output {shlex.quote(str(fixture_dir / 'gauntlet.pdf'))}", 1800),
        (
            "malformed_tables",
            f"./run.sh malformed-tables --output {shlex.quote(str(fixture_dir / 'malformed_tables.pdf'))}",
            1200,
        ),
        (
            "cursed_text",
            f"./run.sh cursed-text --output {shlex.quote(str(fixture_dir / 'cursed_text.pdf'))}",
            1200,
        ),
    ]
    fixture_results: list[Dict[str, Any]] = []
    for name, cmd, command_timeout in fixture_commands:
        result = _run_shell_command(
            cmd=cmd,
            cwd=FIXTURE_TRICKY_DIR,
            timeout_seconds=min(timeout_seconds, command_timeout),
        )
        result["name"] = name
        fixture_results.append(result)
    return {
        "status": "ok",
        "output_dir": str(output_dir),
        "sampled_pdf_count": len(selected_paths),
        "selected_pdfs": [str(path) for path in selected_paths],
        "pdf_results": pdf_results,
        "fixture_results": fixture_results,
    }

def _task_monitor_cmd(args: list[str], *, strict: bool, timeout: int = 120) -> bool:
    if not TASK_MONITOR_RUN.exists():
        msg = f"task-monitor missing at {TASK_MONITOR_RUN}"
        if strict:
            raise RuntimeError(msg)
        logger.warning(msg)
        return False

    proc = subprocess.run(
        [str(TASK_MONITOR_RUN), *args],
        cwd=str(TASK_MONITOR_DIR),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        tail = proc.stderr.splitlines()[-1] if proc.stderr else ""
        msg = (
            f"task-monitor command failed rc={proc.returncode} "
            f"args={' '.join(args)} stderr_tail={tail}"
        )
        if strict:
            raise RuntimeError(msg)
        logger.warning(msg)
        return False
    return True


def _run_alert_hook(
    *,
    command: str,
    env_extra: Dict[str, str],
    strict: bool,
    timeout: int = 120,
) -> bool:
    if not command.strip():
        return True
    env = os.environ.copy()
    env.update(env_extra)
    proc = subprocess.run(
        ["bash", "-lc", command],
        cwd=str(SKILL_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        tail = proc.stderr.splitlines()[-1] if proc.stderr else ""
        msg = (
            f"alert hook failed rc={proc.returncode} "
            f"cmd={command} stderr_tail={tail}"
        )
        if strict:
            raise RuntimeError(msg)
        logger.warning(msg)
        return False
    return True


def _register_supervisor_task(
    *,
    label: str,
    state_file: Path,
    project: str,
    enabled: bool,
    strict: bool,
) -> None:
    if not enabled:
        return
    _task_monitor_cmd(
        [
            "register",
            "--name",
            f"learn_datalake_supervisor_{label}",
            "--state",
            str(state_file),
            "--total",
            "1",
            "--desc",
            "Supervisor watchdog health for learn-datalake",
            "--project",
            project,
        ],
        strict=strict,
    )


def _parse_iso_to_epoch(value: str) -> Optional[float]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except Exception:
        return None


def _tail_text(path: Path, max_lines: int = 200) -> str:
    if not path.exists():
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return ""
    return "\n".join(lines[-max_lines:])


def _classify_failure(exit_code: int, log_tail: str, forced_reason: str = "") -> str:
    if forced_reason:
        return forced_reason
    lowered = log_tail.lower()
    if "watchdog failure" in lowered or "no output for" in lowered:
        return "watchdog_failure"
    if "hard_fail" in lowered:
        return "hard_fail"
    if "no_documents_analyzed" in lowered:
        return "no_documents_analyzed"
    if "traceback" in lowered:
        return "python_traceback"
    return f"exit_{exit_code}"


def _terminate_process(proc: subprocess.Popen[Any], wait_seconds: int = 20) -> None:
    if proc.poll() is not None:
        return
    # Child runs in its own session; terminate the full process group to avoid orphans.
    try:
        pgid = os.getpgid(proc.pid)
    except Exception:
        pgid = None

    try:
        if pgid is not None:
            os.killpg(pgid, signal.SIGTERM)
        else:
            proc.terminate()
    except ProcessLookupError:
        return

    try:
        proc.wait(timeout=wait_seconds)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        if pgid is not None:
            os.killpg(pgid, signal.SIGKILL)
        else:
            proc.kill()
    except ProcessLookupError:
        return
    proc.wait(timeout=10)


def _build_child_command(
    *,
    root: Path,
    target_score: float,
    target_fail_ratio: float,
    poll_seconds: int,
    watchdog_seconds: int,
    watchdog_poll_seconds: int,
    task_monitor: bool,
    task_monitor_project: str,
    execute_jobs: bool,
    ingest_memory: bool,
    ingest_non_pdf: bool,
) -> list[str]:
    cmd = [
        str(LEARN_DATALAKE_RUN),
        "start",
        str(root),
        "--target-score",
        str(target_score),
        "--target-fail-ratio",
        str(target_fail_ratio),
        "--poll-seconds",
        str(poll_seconds),
        "--watchdog-seconds",
        str(watchdog_seconds),
        "--watchdog-poll-seconds",
        str(watchdog_poll_seconds),
        "--task-monitor-project",
        task_monitor_project,
    ]
    cmd.append("--task-monitor" if task_monitor else "--no-task-monitor")
    cmd.append("--execute-jobs" if execute_jobs else "--no-execute-jobs")
    cmd.append("--ingest-memory" if ingest_memory else "--no-ingest-memory")
    cmd.append("--ingest-non-pdf" if ingest_non_pdf else "--no-ingest-non-pdf")
    return cmd


@app.command("run")
def run_supervisor(
    root: Path = typer.Argument(DEFAULT_ROOT, exists=True, file_okay=False, dir_okay=True),
    label: str = typer.Option("nasa", help="Run label used in state/log filenames"),
    target_score: float = typer.Option(0.95, min=0.0, max=1.0),
    target_fail_ratio: float = typer.Option(0.01, min=0.0, max=1.0),
    poll_seconds: int = typer.Option(300, min=10),
    watchdog_seconds: int = typer.Option(900, min=30),
    watchdog_poll_seconds: int = typer.Option(15, min=1),
    supervisor_poll_seconds: int = typer.Option(20, min=2),
    heartbeat_timeout_seconds: int = typer.Option(1800, min=60),
    quality_gate_consecutive_failures: int = typer.Option(
        2,
        min=1,
        help="Escalate diagnose/debug after this many consecutive quality gate failures",
    ),
    restart_max_backoff_seconds: int = typer.Option(600, min=5),
    max_restarts: int = typer.Option(
        0,
        min=0,
        help="0 means unlimited restart attempts; otherwise stop after this many",
    ),
    task_monitor: bool = typer.Option(True),
    task_monitor_project: str = typer.Option("datalake_training"),
    task_monitor_strict: bool = typer.Option(
        True,
        help="Hard-fail when task-monitor registration/update fails",
    ),
    alert_hook_command: str = typer.Option(
        "",
        help=(
            "Optional shell command to run on watchdog failures/restarts. "
            "Env includes LEARN_DATALAKE_* context vars."
        ),
    ),
    alert_hook_strict: bool = typer.Option(
        False,
        help="Hard-fail supervisor if alert hook command fails",
    ),
    execute_jobs: bool = typer.Option(True),
    ingest_memory: bool = typer.Option(True),
    ingest_non_pdf: bool = typer.Option(True),
    debug_cycle_timeout_seconds: int = typer.Option(
        7200,
        min=600,
        help="Timeout in seconds for targeted diagnose/debug cycle",
    ),
    max_failure_samples: int = typer.Option(
        5,
        min=1,
        max=20,
        help="Maximum failed PDFs sampled for targeted debug per escalation",
    ),
    memory_events_path: Path = typer.Option(
        WATCHDOG_DIR / "supervisor_memory_events.jsonl",
        help="Mandatory memory event sink",
    ),
    memory_write_strict: bool = typer.Option(
        True,
        help="Hard-fail when memory write fails",
    ),
) -> None:
    """Keep learn-datalake running; diagnose and restart on failures."""
    if not LEARN_DATALAKE_RUN.exists():
        raise typer.BadParameter(f"Missing run script: {LEARN_DATALAKE_RUN}")

    WATCHDOG_DIR.mkdir(parents=True, exist_ok=True)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    DIAG_DIR.mkdir(parents=True, exist_ok=True)
    TASK_MONITOR_STATE_DIR.mkdir(parents=True, exist_ok=True)

    supervisor_state = WATCHDOG_DIR / f"supervisor_{label}.json"
    supervisor_log = WATCHDOG_DIR / f"supervisor_{label}.log"
    stop_file = WATCHDOG_DIR / f"STOP_{label}"
    cycle_state = STATE_DIR / "task_monitor" / "learn_datalake_start_cycle.json"
    review_state = STATE_DIR / "task_monitor" / "learn_datalake_start_review_pdf.json"
    watchdog_task_state = TASK_MONITOR_STATE_DIR / f"learn_datalake_supervisor_{label}.json"

    prior = _safe_read_json(supervisor_state)
    failure_buckets: Dict[str, int] = prior.get("failure_buckets", {})
    restart_count = int(prior.get("restart_count", 0))
    run_count = int(prior.get("run_count", 0))
    dynamic_watchdog_seconds = int(max(watchdog_seconds, 3600))

    logger.remove()
    logger.add(
        str(supervisor_log),
        level="INFO",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
    )
    logger.add(lambda msg: print(msg, end=""), level="INFO")

    logger.info(f"supervisor_start label={label} root={root}")
    logger.info(f"stop_file={stop_file}")
    _register_supervisor_task(
        label=label,
        state_file=watchdog_task_state,
        project=task_monitor_project,
        enabled=task_monitor,
        strict=task_monitor_strict,
    )

    while True:
        if stop_file.exists():
            _write_json(
                watchdog_task_state,
                {
                    "completed": 0,
                    "errors": _failure_total(failure_buckets),
                    "stats": {
                        "status": "stopped_by_stop_file",
                        "restart_count": restart_count,
                        "run_count": run_count,
                    },
                    "current_item": f"label={label}",
                    "consecutive_failures": 0,
                    "last_updated": _now_utc_iso(),
                },
            )
            logger.info(f"stop_file_detected={stop_file}")
            _write_json(
                supervisor_state,
                {
                    "label": label,
                    "root": str(root),
                    "status": "stopped_by_stop_file",
                    "updated_at": _now_utc_iso(),
                    "restart_count": restart_count,
                    "run_count": run_count,
                    "failure_buckets": failure_buckets,
                    "stop_file": str(stop_file),
                },
            )
            raise typer.Exit(code=0)

        run_count += 1
        run_id = f"{label}_{int(time.time())}"
        run_log = RUN_DIR / f"learn_datalake_{run_id}.log"
        run_metrics: Dict[str, Any] = {
            "quality_gate_action": "continue_extracting",
            "quality_gate_reason": "startup",
            "quality_gate_consecutive_failures": 0,
            "recommended_watchdog_seconds": dynamic_watchdog_seconds,
            "adaptive_heartbeat_timeout_seconds": heartbeat_timeout_seconds,
            "recent_failed_pdfs": [],
            "recent_failed_pdf_count": 0,
        }
        last_gate_action = ""
        last_gate_reason = ""
        gate_failure_streak = 0
        cmd = _build_child_command(
            root=root,
            target_score=target_score,
            target_fail_ratio=target_fail_ratio,
            poll_seconds=poll_seconds,
            watchdog_seconds=dynamic_watchdog_seconds,
            watchdog_poll_seconds=watchdog_poll_seconds,
            task_monitor=task_monitor,
            task_monitor_project=task_monitor_project,
            execute_jobs=execute_jobs,
            ingest_memory=ingest_memory,
            ingest_non_pdf=ingest_non_pdf,
        )

        logger.info(f"child_start run_id={run_id} cmd={' '.join(cmd)}")
        with open(run_log, "ab", buffering=0) as log_file:
            child_start_epoch = time.time()
            proc = subprocess.Popen(
                cmd,
                cwd=str(SKILL_DIR),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )

            forced_reason = ""
            while True:
                if stop_file.exists():
                    forced_reason = "stopped_by_stop_file"
                    logger.info("stop_file detected while child running; terminating child")
                    _terminate_process(proc)
                    break

                rc = proc.poll()
                if rc is not None:
                    break

                now = time.time()
                cycle_payload = _safe_read_json(cycle_state)
                review_payload = _safe_read_json(review_state)
                cycle_completed = int(cycle_payload.get("completed", 0) or 0)
                cycle_failures = int(cycle_payload.get("consecutive_failures", 0) or 0)
                run_metrics = _collect_run_metrics(
                    run_log=run_log,
                    heartbeat_timeout_seconds=heartbeat_timeout_seconds,
                )
                child_age = int(now - child_start_epoch)
                run_metrics["loop_cycle_count"] = max(
                    int(run_metrics.get("loop_cycle_count", 0) or 0),
                    cycle_completed,
                )
                throughput_per_hour = 0.0
                if child_age > 0:
                    throughput_per_hour = round(
                        (3600.0 * float(run_metrics.get("extraction_success_count", 0) or 0)) / child_age,
                        2,
                    )
                run_metrics["extraction_throughput_per_hour"] = throughput_per_hour
                if int(run_metrics.get("recommended_watchdog_seconds", 0) or 0) > dynamic_watchdog_seconds:
                    dynamic_watchdog_seconds = int(run_metrics["recommended_watchdog_seconds"])
                    logger.info(f"adaptive_watchdog_seconds={dynamic_watchdog_seconds}")
                run_metrics.update(
                    _apply_quality_gate(
                        run_metrics,
                        target_score=target_score,
                        target_fail_ratio=target_fail_ratio,
                    )
                )
                gate_action = str(run_metrics.get("quality_gate_action", "continue_extracting"))
                gate_reason = str(run_metrics.get("quality_gate_reason", "within_thresholds"))
                if gate_action == "diagnose_debug_resume":
                    gate_failure_streak += 1
                else:
                    gate_failure_streak = 0
                run_metrics["quality_gate_consecutive_failures"] = gate_failure_streak
                if gate_action != last_gate_action or gate_reason != last_gate_reason:
                    event_type = "success" if gate_action == "continue_extracting" else "failure"
                    if (
                        gate_action == "diagnose_debug_resume"
                        and last_gate_action == "continue_extracting"
                    ):
                        event_type = "regression"
                    _record_learning_event(
                        events_path=memory_events_path,
                        event_type=event_type,
                        root=root,
                        label=label,
                        run_id=run_id,
                        summary=f"{gate_action}:{gate_reason}",
                        details={
                            "quality_gate_action": gate_action,
                            "quality_gate_reason": gate_reason,
                            "rolling_avg_score": run_metrics.get("rolling_avg_score"),
                            "rolling_fail_ratio": run_metrics.get("rolling_fail_ratio"),
                            "documents_missing_ratio": run_metrics.get("documents_missing_ratio"),
                            "phase": run_metrics.get("phase"),
                            "phase_age_seconds": run_metrics.get("phase_age_seconds"),
                        },
                        strict=memory_write_strict,
                    )
                    last_gate_action = gate_action
                    last_gate_reason = gate_reason
                if (
                    gate_action == "diagnose_debug_resume"
                    and int(run_metrics.get("quality_gate_consecutive_failures", 0) or 0)
                    >= quality_gate_consecutive_failures
                ):
                    forced_reason = "quality_gate_escalation"
                    logger.warning(
                        "quality gate escalation triggered "
                        f"run_id={run_id} action={gate_action} reason={gate_reason} "
                        f"streak={run_metrics.get('quality_gate_consecutive_failures', 0)}"
                    )
                    _terminate_process(proc)
                    break

                review_last_updated = str(review_payload.get("last_updated", ""))
                review_epoch = _parse_iso_to_epoch(review_last_updated)
                heartbeat_is_fresh = (
                    review_epoch is not None and review_epoch >= (child_start_epoch - 5.0)
                )
                review_age = int(now - review_epoch) if heartbeat_is_fresh else None
                effective_heartbeat_timeout = int(
                    run_metrics.get("adaptive_heartbeat_timeout_seconds", heartbeat_timeout_seconds)
                    or heartbeat_timeout_seconds
                )

                if (
                    review_age is not None
                    and review_age > effective_heartbeat_timeout
                ):
                    forced_reason = "heartbeat_timeout"
                    logger.warning(
                        f"heartbeat_timeout age={review_age}s "
                        f"limit={effective_heartbeat_timeout}s; terminating child"
                    )
                    _terminate_process(proc)
                    break
                if (
                    review_age is None
                    and child_age > effective_heartbeat_timeout
                ):
                    forced_reason = "heartbeat_timeout_startup"
                    logger.warning(
                        f"heartbeat_timeout_startup child_age={child_age}s "
                        f"limit={effective_heartbeat_timeout}s; terminating child"
                    )
                    _terminate_process(proc)
                    break

                _write_json(
                    supervisor_state,
                    {
                        "label": label,
                        "root": str(root),
                        "status": "running",
                        "updated_at": _now_utc_iso(),
                        "run_id": run_id,
                        "run_log": str(run_log),
                        "child_pid": proc.pid,
                        "restart_count": restart_count,
                        "run_count": run_count,
                        "cycle_completed": cycle_completed,
                        "cycle_failures": cycle_failures,
                        "child_age_seconds": child_age,
                        "review_heartbeat_age_seconds": review_age,
                        "review_heartbeat_fresh": heartbeat_is_fresh,
                        "run_metrics": run_metrics,
                        "failure_buckets": failure_buckets,
                        "stop_file": str(stop_file),
                    },
                )
                _write_json(
                    watchdog_task_state,
                    {
                        "completed": 1 if heartbeat_is_fresh else 0,
                        "errors": _failure_total(failure_buckets),
                        "stats": {
                            "status": "running",
                            "run_id": run_id,
                            "child_pid": proc.pid,
                            "child_age_seconds": child_age,
                            "heartbeat_fresh": heartbeat_is_fresh,
                            "heartbeat_age_seconds": review_age,
                            "restart_count": restart_count,
                            "run_count": run_count,
                            "extracted_pdf_coverage_pct": cycle_payload.get("extracted_pdf_coverage_pct"),
                            "extraction_timeout_rate_pct": run_metrics.get("extraction_timeout_rate_pct"),
                            "extraction_fail_rate_pct": run_metrics.get("extraction_fail_rate_pct"),
                            "extraction_throughput_per_hour": run_metrics.get("extraction_throughput_per_hour"),
                            "rolling_docs_analyzed": run_metrics.get("rolling_docs_analyzed"),
                            "rolling_avg_score": run_metrics.get("rolling_avg_score"),
                            "rolling_fail_ratio": run_metrics.get("rolling_fail_ratio"),
                            "rolling_critical_doc_ratio": run_metrics.get("rolling_critical_doc_ratio"),
                            "documents_missing_ratio": run_metrics.get("documents_missing_ratio"),
                            "phase": run_metrics.get("phase"),
                            "quality_gate_action": run_metrics.get("quality_gate_action"),
                            "quality_gate_reason": run_metrics.get("quality_gate_reason"),
                            "quality_gate_consecutive_failures": run_metrics.get(
                                "quality_gate_consecutive_failures"
                            ),
                            "adaptive_watchdog_seconds": dynamic_watchdog_seconds,
                            "adaptive_heartbeat_timeout_seconds": effective_heartbeat_timeout,
                            "recent_failed_pdf_count": run_metrics.get("recent_failed_pdf_count"),
                        },
                        "current_item": (
                            f"run_id={run_id} gate={run_metrics.get('quality_gate_action')} "
                            f"phase={run_metrics.get('phase')}"
                        ),
                        "consecutive_failures": 0 if heartbeat_is_fresh else 1,
                        "last_updated": _now_utc_iso(),
                    },
                )
                time.sleep(supervisor_poll_seconds)

        exit_code = proc.returncode if proc.returncode is not None else 1
        log_tail = _tail_text(run_log)
        failure_signature = _classify_failure(exit_code, log_tail, forced_reason=forced_reason)
        failure_buckets[failure_signature] = failure_buckets.get(failure_signature, 0) + 1
        restart_count += 1
        debug_result: Dict[str, Any] | None = None
        if failure_signature in {"quality_gate_escalation", "watchdog_failure", "hard_fail"}:
            debug_result = _run_targeted_debug_chain(
                run_id=run_id,
                recent_failed_pdfs=list(run_metrics.get("recent_failed_pdfs", [])),
                timeout_seconds=debug_cycle_timeout_seconds,
                max_failure_samples=max_failure_samples,
            )
        if failure_signature == "watchdog_failure":
            dynamic_watchdog_seconds = min(43200, max(dynamic_watchdog_seconds * 2, 3600))
            logger.warning(
                f"adaptive watchdog increased after watchdog_failure: {dynamic_watchdog_seconds}s"
            )

        diag_path = DIAG_DIR / f"diagnostic_{label}_{int(time.time())}.json"
        _write_json(
            diag_path,
            {
                "timestamp": _now_utc_iso(),
                "label": label,
                "root": str(root),
                "run_id": run_id,
                "run_log": str(run_log),
                "exit_code": exit_code,
                "forced_reason": forced_reason,
                "failure_signature": failure_signature,
                "failure_bucket_count": failure_buckets[failure_signature],
                "restart_count": restart_count,
                "run_count": run_count,
                "run_metrics": run_metrics,
                "log_tail": log_tail,
                "debug_result": debug_result,
            },
        )

        _write_json(
            supervisor_state,
            {
                "label": label,
                "root": str(root),
                "status": "restarting",
                "updated_at": _now_utc_iso(),
                "last_run_id": run_id,
                "last_run_log": str(run_log),
                "last_exit_code": exit_code,
                "last_failure_signature": failure_signature,
                "last_diagnostic": str(diag_path),
                "last_debug_result": debug_result,
                "restart_count": restart_count,
                "run_count": run_count,
                "failure_buckets": failure_buckets,
                "stop_file": str(stop_file),
            },
        )
        _write_json(
            watchdog_task_state,
            {
                "completed": 0,
                "errors": _failure_total(failure_buckets),
                "stats": {
                    "status": "restarting",
                    "last_exit_code": exit_code,
                    "last_failure_signature": failure_signature,
                    "restart_count": restart_count,
                    "run_count": run_count,
                },
                "current_item": f"run_id={run_id}",
                "consecutive_failures": failure_buckets.get(failure_signature, 1),
                "last_updated": _now_utc_iso(),
            },
        )
        if failure_signature == "stopped_by_stop_file":
            _record_learning_event(
                events_path=memory_events_path,
                event_type="success",
                root=root,
                label=label,
                run_id=run_id,
                summary="stopped_by_operator",
                details={
                    "failure_signature": failure_signature,
                    "exit_code": exit_code,
                    "diagnostic": str(diag_path),
                },
                strict=memory_write_strict,
            )
        else:
            _record_learning_event(
                events_path=memory_events_path,
                event_type="failure",
                root=root,
                label=label,
                run_id=run_id,
                summary=f"{failure_signature} exit_code={exit_code}",
                details={
                    "failure_signature": failure_signature,
                    "exit_code": exit_code,
                    "quality_gate_action": run_metrics.get("quality_gate_action"),
                    "quality_gate_reason": run_metrics.get("quality_gate_reason"),
                    "rolling_avg_score": run_metrics.get("rolling_avg_score"),
                    "rolling_fail_ratio": run_metrics.get("rolling_fail_ratio"),
                    "documents_missing_ratio": run_metrics.get("documents_missing_ratio"),
                    "phase": run_metrics.get("phase"),
                    "debug_result_status": (debug_result or {}).get("status"),
                    "diagnostic": str(diag_path),
                },
                strict=memory_write_strict,
            )
        if failure_signature != "stopped_by_stop_file":
            _run_alert_hook(
                command=alert_hook_command,
                strict=alert_hook_strict,
                env_extra={
                    "LEARN_DATALAKE_LABEL": label,
                    "LEARN_DATALAKE_ROOT": str(root),
                    "LEARN_DATALAKE_RUN_ID": run_id,
                    "LEARN_DATALAKE_FAILURE_SIGNATURE": failure_signature,
                    "LEARN_DATALAKE_EXIT_CODE": str(exit_code),
                    "LEARN_DATALAKE_RESTART_COUNT": str(restart_count),
                    "LEARN_DATALAKE_RUN_COUNT": str(run_count),
                    "LEARN_DATALAKE_DIAGNOSTIC": str(diag_path),
                    "LEARN_DATALAKE_LOG": str(run_log),
                },
            )

        logger.warning(
            f"child_exit run_id={run_id} exit_code={exit_code} "
            f"signature={failure_signature} restart_count={restart_count}"
        )

        if forced_reason == "stopped_by_stop_file":
            logger.info("supervisor stopped by stop-file request")
            raise typer.Exit(code=0)

        if max_restarts > 0 and restart_count >= max_restarts:
            logger.error(f"max_restarts_reached={max_restarts} stopping supervisor")
            raise typer.Exit(code=1)

        backoff = min(
            restart_max_backoff_seconds,
            10 + (failure_buckets[failure_signature] * 15),
        )
        logger.info(f"restart_backoff_seconds={backoff}")
        time.sleep(backoff)


if __name__ == "__main__":
    app()
