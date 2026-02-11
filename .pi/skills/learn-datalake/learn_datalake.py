#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "typer>=0.12.3",
#   "loguru>=0.7.0",
# ]
# ///
"""learn-datalake orchestrator.

Purpose:
- provide one user-facing entrypoint that continuously learns a document directory
  into graph memory while maintaining PDF extraction quality.

Inputs:
- root content directory and runtime options.

Outputs:
- invokes review-pdf quality loops for PDFs and memory acquire for non-PDF files.

Failure modes:
- subprocess failures are surfaced as non-zero exits in strict modes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
import subprocess
import threading
import time
from queue import Empty, Queue
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import typer
from loguru import logger

app = typer.Typer(no_args_is_help=True, add_completion=False)

SKILL_DIR = Path(__file__).resolve().parent
REVIEW_PDF_DIR = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/review-pdf")
MEMORY_DIR = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/memory")
DOGPILE_DIR = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/dogpile")
FETCHER_DIR = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/fetcher")
TASK_MONITOR_DIR = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/task-monitor")
TASK_MONITOR_RUN = TASK_MONITOR_DIR / "run.sh"
STATE_DIR = SKILL_DIR / "state"
STATE_DIR.mkdir(parents=True, exist_ok=True)
TASK_MONITOR_STATE_DIR = STATE_DIR / "task_monitor"
TASK_MONITOR_STATE_DIR.mkdir(parents=True, exist_ok=True)

NON_PDF_EXTENSIONS = {
    ".html",
    ".htm",
    ".xml",
    ".json",
    ".yaml",
    ".yml",
    ".md",
    ".rst",
    ".txt",
    ".csv",
    ".tsv",
    ".docx",
    ".pptx",
    ".xlsx",
    ".ipynb",
    ".py",
    ".js",
    ".ts",
    ".java",
    ".cpp",
    ".c",
    ".go",
    ".rs",
}

DOC_EXTENSIONS = {
    ".pdf",
    ".html",
    ".htm",
    ".md",
    ".markdown",
    ".rst",
    ".xml",
    ".json",
    ".yaml",
    ".yml",
    ".txt",
    ".csv",
    ".tsv",
    ".docx",
    ".pptx",
    ".xlsx",
    ".ipynb",
}

SECTOR_KEYS = [
    "arxiv",
    "dtic",
    "faa",
    "nasa",
    "nist",
    "ietf",
    "industry",
    "adversarial",
    "edge_cases",
]

SECTOR_DOMAIN_HINTS: Dict[str, List[str]] = {
    "arxiv": ["arxiv.org"],
    "dtic": ["dtic.mil", "apps.dtic.mil"],
    "faa": ["faa.gov"],
    "nasa": ["nasa.gov", "ntrs.nasa.gov"],
    "nist": ["nist.gov", "nvlpubs.nist.gov"],
    "ietf": ["ietf.org", "rfc-editor.org", "datatracker.ietf.org"],
    "industry": [
        "ti.com",
        "nxp.com",
        "microchip.com",
        "infineon.com",
        "analog.com",
        "st.com",
        "intel.com",
        "amd.com",
        "nvidia.com",
        "qualcomm.com",
    ],
    "adversarial": [
        "courtlistener.com",
        "law.cornell.edu",
        "cia.gov",
        "justice.gov",
        "archive.org",
        "loc.gov",
    ],
    "edge_cases": [],
}

CANDIDATE_URL_FILES = [
    "expansion_manifest.txt",
    "industry_pdfs.txt",
    "finance_pdfs.txt",
    "finance_pdfs_v2.txt",
    "adversarial_pdfs.txt",
    "adversarial_pdfs_v2.txt",
]


@dataclass
class CommandResult:
    cmd: str
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False
    stalled: bool = False
    elapsed_seconds: float = 0.0


RE_EXTRACT_NEW = re.compile(r"extract_missing status=extracted new_count=(?P<count>[0-9]+)")
RE_EXTRACT_TIMEOUT = re.compile(r"extract_timeout seconds=(?P<seconds>[0-9]+)")
RE_DISCOVER_PROGRESS = re.compile(
    r"discover_progress scanned=(?P<scanned>[0-9]+) extracted_new=(?P<new_count>[0-9]+)"
)
RE_INCREMENTAL_SKIP = re.compile(r"incremental_skip .*changed_pdfs=(?P<changed>[0-9]+)")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run(cmd: str, timeout: int = 7200) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "-lc", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _task_monitor_cmd(
    args: List[str],
    *,
    strict: bool,
    timeout: int = 120,
) -> bool:
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
        msg = (
            f"task-monitor command failed rc={proc.returncode} "
            f"args={' '.join(args)} stderr_tail={proc.stderr.splitlines()[-1] if proc.stderr else ''}"
        )
        if strict:
            raise RuntimeError(msg)
        logger.warning(msg)
        return False
    return True


def _tm_start_session(*, project: str, enabled: bool, strict: bool) -> None:
    if not enabled:
        return
    _task_monitor_cmd(["start-session", "--project", project], strict=strict)


def _tm_end_session(*, notes: str, enabled: bool, strict: bool) -> None:
    if not enabled:
        return
    _task_monitor_cmd(["end-session", "--notes", notes], strict=strict)


def _tm_add_accomplishment(*, text: str, enabled: bool, strict: bool) -> None:
    if not enabled:
        return
    _task_monitor_cmd(["add-accomplishment", text], strict=strict)


def _tm_register_task(
    *,
    name: str,
    state_file: Path,
    total: Optional[int],
    description: str,
    project: str,
    enabled: bool,
    strict: bool,
) -> None:
    if not enabled:
        return
    args = [
        "register",
        "--name",
        name,
        "--state",
        str(state_file),
        "--desc",
        description,
        "--project",
        project,
    ]
    if total is not None:
        args.extend(["--total", str(total)])
    _task_monitor_cmd(args, strict=strict)


def _write_task_state(state_file: Path, payload: Dict[str, Any]) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    payload.setdefault("last_updated", _utc_now())
    state_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _terminate_process(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def _run_with_watchdog(
    cmd: str,
    *,
    timeout: int,
    watchdog_seconds: int,
    watchdog_poll_seconds: int,
    stream_stdout: bool = False,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> CommandResult:
    max_buffer_lines = 4000
    start = time.monotonic()
    proc = subprocess.Popen(
        ["bash", "-lc", cmd],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    queue: Queue[tuple[str, str]] = Queue()

    def pump(stream: Any, channel: str) -> None:
        if stream is None:
            return
        try:
            for line in iter(stream.readline, ""):
                queue.put((channel, line))
        finally:
            try:
                stream.close()
            except Exception:
                pass

    t_out = threading.Thread(target=pump, args=(proc.stdout, "stdout"), daemon=True)
    t_err = threading.Thread(target=pump, args=(proc.stderr, "stderr"), daemon=True)
    t_out.start()
    t_err.start()

    stdout_lines: List[str] = []
    stderr_lines: List[str] = []
    last_output = time.monotonic()
    last_report = 0.0
    # Emit a periodic watchdog heartbeat to stdout for long-running subprocesses.
    # This does not affect stall detection, which still keys off subprocess output.
    last_heartbeat_print = 0.0
    timed_out = False
    stalled = False

    while True:
        now = time.monotonic()
        if now - start > timeout and proc.poll() is None:
            timed_out = True
            _terminate_process(proc)
        elif watchdog_seconds > 0 and now - last_output > watchdog_seconds and proc.poll() is None:
            stalled = True
            _terminate_process(proc)

        if progress_callback and now - last_report >= max(1, watchdog_poll_seconds):
            progress_callback(
                {
                    "elapsed_seconds": now - start,
                    "last_output_age_seconds": now - last_output,
                    "stdout_tail": "".join(stdout_lines[-20:]),
                    "stderr_tail": "".join(stderr_lines[-20:]),
                    "returncode": proc.poll(),
                }
            )
            last_report = now

        if stream_stdout and now - last_heartbeat_print >= max(30, watchdog_poll_seconds * 4):
            print(
                (
                    "[watchdog] running "
                    f"elapsed={int(now - start)}s "
                    f"last_output_age={int(now - last_output)}s "
                    f"cmd={cmd}"
                ),
                flush=True,
            )
            last_heartbeat_print = now

        if proc.poll() is not None and queue.empty():
            break

        try:
            channel, line = queue.get(timeout=max(1, watchdog_poll_seconds))
            last_output = time.monotonic()
            if channel == "stdout":
                stdout_lines.append(line)
                if len(stdout_lines) > max_buffer_lines:
                    del stdout_lines[: len(stdout_lines) - max_buffer_lines]
                if stream_stdout:
                    print(line, end="", flush=True)
            else:
                stderr_lines.append(line)
                if len(stderr_lines) > max_buffer_lines:
                    del stderr_lines[: len(stderr_lines) - max_buffer_lines]
        except Empty:
            continue

    t_out.join(timeout=1)
    t_err.join(timeout=1)

    if timed_out:
        stderr_lines.append(
            f"[watchdog] hard-timeout exceeded after {timeout}s for command: {cmd}\n"
        )
    if stalled:
        stderr_lines.append(
            f"[watchdog] no output for {watchdog_seconds}s; command terminated: {cmd}\n"
        )

    elapsed = time.monotonic() - start
    return CommandResult(
        cmd=cmd,
        returncode=proc.returncode if proc.returncode is not None else 1,
        stdout="".join(stdout_lines),
        stderr="".join(stderr_lines),
        timed_out=timed_out,
        stalled=stalled,
        elapsed_seconds=elapsed,
    )


def _json_load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _scan_files(root: Path, exts: Iterable[str]) -> Dict[str, float]:
    suffixes = {ext.lower() for ext in exts}
    state: Dict[str, float] = {}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() in suffixes:
            state[str(path)] = path.stat().st_mtime
    return state


def _changed_files(prev: Dict[str, float], curr: Dict[str, float]) -> List[Path]:
    changed = []
    for path_str, mtime in curr.items():
        if prev.get(path_str) != mtime:
            changed.append(Path(path_str))
    return sorted(changed)


def _load_state(path: Path) -> Dict[str, float]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return {str(k): float(v) for k, v in payload.items()}
    except Exception:
        return {}
    return {}


def _save_state(path: Path, state: Dict[str, float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _ingest_non_pdf_files(
    files: List[Path],
    memory_scope: str,
    *,
    watchdog_seconds: int,
    watchdog_poll_seconds: int,
    state_file: Optional[Path] = None,
    prior_completed: int = 0,
) -> Dict[str, int]:
    ok = 0
    failed = 0
    total = len(files)
    for idx, file_path in enumerate(files, start=1):
        cmd = (
            f"cd {MEMORY_DIR} && "
            f"./run.sh acquire content \"{file_path}\" --scope \"{memory_scope}\""
        )
        proc = _run_with_watchdog(
            cmd,
            timeout=1800,
            watchdog_seconds=watchdog_seconds,
            watchdog_poll_seconds=watchdog_poll_seconds,
            stream_stdout=False,
        )
        if proc.returncode == 0 and not proc.stalled and not proc.timed_out:
            ok += 1
        else:
            failed += 1
            logger.warning(
                f"memory ingest failed for {file_path} "
                f"rc={proc.returncode} stalled={proc.stalled} timed_out={proc.timed_out}"
            )
        if state_file is not None:
            _write_task_state(
                state_file,
                {
                    "completed": prior_completed + idx,
                    "stats": {
                        "ok": ok,
                        "failed": failed,
                        "total": total,
                    },
                    "current_item": str(file_path),
                    "consecutive_failures": failed,
                },
            )
    return {"ok": ok, "failed": failed}


def _count_doc_extensions(root: Path) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for ext in sorted(DOC_EXTENSIONS):
        counts[ext] = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in DOC_EXTENSIONS:
            counts[suffix] = counts.get(suffix, 0) + 1
    return counts


def _sector_pdf_counts(root: Path) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for sector in SECTOR_KEYS:
        sector_dir = root / sector
        if sector_dir.is_dir():
            counts[sector] = len(list(sector_dir.rglob("*.pdf")))
        else:
            counts[sector] = 0
    return counts


def _find_consumer_summaries(root: Path) -> List[Path]:
    return sorted(path for path in root.rglob("consumer_summary.json") if path.is_file())


def _summary_items(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = payload.get("items")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return []


def _domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    return (parsed.netloc or "").lower()


def _sector_for_domain(domain: str) -> Optional[str]:
    for sector, hints in SECTOR_DOMAIN_HINTS.items():
        if any(hint in domain for hint in hints):
            return sector
    return None


def _downloaded_url_set(root: Path) -> set[str]:
    seen: set[str] = set()
    for summary in _find_consumer_summaries(root):
        try:
            payload = _json_load(summary)
        except Exception:
            continue
        for item in _summary_items(payload):
            url = str(item.get("original_url", "")).strip()
            if url:
                seen.add(url)
    return seen


def _source_domain_pdf_counts(root: Path) -> Dict[str, int]:
    domain_counts: Dict[str, int] = {}
    for summary in _find_consumer_summaries(root):
        try:
            payload = _json_load(summary)
        except Exception:
            continue
        for item in _summary_items(payload):
            if str(item.get("verdict")) != "ok":
                continue
            url = str(item.get("original_url", "")).strip()
            if not url:
                continue
            domain = _domain_from_url(url)
            if not domain:
                continue
            domain_counts[domain] = domain_counts.get(domain, 0) + 1
    return dict(sorted(domain_counts.items(), key=lambda kv: kv[1], reverse=True))


def _sector_gaps(sector_counts: Dict[str, int], target_pdf_per_sector: int) -> Dict[str, int]:
    gaps: Dict[str, int] = {}
    for sector in SECTOR_KEYS:
        current = sector_counts.get(sector, 0)
        gaps[sector] = max(target_pdf_per_sector - current, 0)
    return gaps


def _coverage_report(root: Path, target_pdf_per_sector: int) -> Dict[str, Any]:
    extension_counts = _count_doc_extensions(root)
    sector_counts = _sector_pdf_counts(root)
    sector_gap_counts = _sector_gaps(sector_counts, target_pdf_per_sector)
    domain_counts = _source_domain_pdf_counts(root)
    report: Dict[str, Any] = {
        "root": str(root),
        "timestamp": int(time.time()),
        "targets": {"pdf_per_sector": target_pdf_per_sector},
        "totals": {
            "pdf": extension_counts.get(".pdf", 0),
            "documents_by_extension": extension_counts,
        },
        "sectors": {
            "pdf_counts": sector_counts,
            "pdf_gap_counts": sector_gap_counts,
            "sectors_below_target": [k for k, v in sector_gap_counts.items() if v > 0],
        },
        "source_domains": {
            "top_pdf_domains": dict(list(domain_counts.items())[:50]),
            "domain_count_total": len(domain_counts),
        },
    }
    return report


def _read_candidate_urls() -> List[str]:
    urls: List[str] = []
    for filename in CANDIDATE_URL_FILES:
        path = DOGPILE_DIR / filename
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            value = line.strip()
            if value.startswith("http://") or value.startswith("https://"):
                urls.append(value)
    # Preserve order while deduping.
    seen: set[str] = set()
    deduped: List[str] = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


def _urls_by_sector(urls: List[str]) -> Dict[str, List[str]]:
    grouped: Dict[str, List[str]] = {sector: [] for sector in SECTOR_KEYS}
    for url in urls:
        sector = _sector_for_domain(_domain_from_url(url))
        if sector is None:
            continue
        grouped[sector].append(url)
    return grouped


def _write_manifest(path: Path, urls: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "\n".join(urls) + ("\n" if urls else "")
    path.write_text(payload, encoding="utf-8")


def _run_fetcher_manifest(
    manifest_path: Path,
    out_dir: Path,
    *,
    watchdog_seconds: int,
    watchdog_poll_seconds: int,
    state_file: Optional[Path] = None,
) -> CommandResult:
    cmd = (
        f"cd {FETCHER_DIR} && "
        f"./run.sh get-manifest \"{manifest_path}\" "
        f"--out \"{out_dir}\" --soft-fail"
    )
    return _run_with_watchdog(
        cmd,
        timeout=21600,
        watchdog_seconds=watchdog_seconds,
        watchdog_poll_seconds=watchdog_poll_seconds,
        stream_stdout=True,
        progress_callback=(
            (lambda progress: _write_task_state(
                state_file,
                {
                    "completed": 0,
                    "stats": {
                        "elapsed_seconds": round(progress["elapsed_seconds"], 2),
                        "last_output_age_seconds": round(progress["last_output_age_seconds"], 2),
                    },
                    "current_item": str(manifest_path),
                },
            ))
            if state_file is not None
            else None
        ),
    )


def _run_review_pdf_once(
    *,
    root: Path,
    target_score: float,
    target_fail_ratio: float,
    poll_seconds: int,
    execute_jobs: bool,
    ingest_memory: bool,
    memory_scope: str,
    taxonomy_collection: str,
    watchdog_seconds: int,
    watchdog_poll_seconds: int,
    review_incremental: bool,
    state_file: Optional[Path] = None,
) -> CommandResult:
    # Large PDFs can keep extractor stages quiet for >15m; avoid false watchdog kills.
    review_watchdog_seconds = max(watchdog_seconds, 3600)
    cmd = (
        f"cd {REVIEW_PDF_DIR} && ./run.sh loop \"{root}\" "
        f"--target-score {target_score} --target-fail-ratio {target_fail_ratio} "
        "--no-watch --max-cycles 1 "
        f"--poll-seconds {poll_seconds} "
        f"{'--execute-jobs ' if execute_jobs else ''}"
        "--extract-missing "
        f"{'--ingest-memory ' if ingest_memory else ''}"
        f"{'--incremental ' if review_incremental else '--no-incremental '}"
        f"--memory-scope \"{memory_scope}\" "
        f"--taxonomy-collection \"{taxonomy_collection}\""
    )
    return _run_with_watchdog(
        cmd,
        timeout=21600,
        watchdog_seconds=review_watchdog_seconds,
        watchdog_poll_seconds=watchdog_poll_seconds,
        stream_stdout=True,
        progress_callback=(
            (lambda progress: _write_task_state(
                state_file,
                {
                    "completed": 0,
                    "stats": {
                        "elapsed_seconds": round(progress["elapsed_seconds"], 2),
                        "last_output_age_seconds": round(progress["last_output_age_seconds"], 2),
                    },
                    "current_item": "review-pdf loop",
                },
            ))
            if state_file is not None
            else None
        ),
    )


def _ensure_not_stalled(result: CommandResult, label: str) -> None:
    if result.stalled or result.timed_out:
        logger.error(
            f"{label} watchdog failure rc={result.returncode} "
            f"stalled={result.stalled} timed_out={result.timed_out}"
        )
        if result.stderr.strip():
            logger.error(result.stderr.splitlines()[-1])
        raise typer.Exit(code=2)


def _summarize_review_output(result: CommandResult) -> Dict[str, Any]:
    text = f"{result.stdout}\n{result.stderr}"
    extracted_new_max = 0
    timeout_count = 0
    scanned_max = 0
    discover_new_max = 0
    changed_pdfs = -1
    incremental_skipped = False
    for line in text.splitlines():
        match_extract = RE_EXTRACT_NEW.search(line)
        if match_extract:
            extracted_new_max = max(extracted_new_max, int(match_extract.group("count")))
        match_timeout = RE_EXTRACT_TIMEOUT.search(line)
        if match_timeout:
            timeout_count += 1
        match_discover = RE_DISCOVER_PROGRESS.search(line)
        if match_discover:
            scanned_max = max(scanned_max, int(match_discover.group("scanned")))
            discover_new_max = max(discover_new_max, int(match_discover.group("new_count")))
        match_skip = RE_INCREMENTAL_SKIP.search(line)
        if match_skip:
            incremental_skipped = True
            changed_pdfs = int(match_skip.group("changed"))
    return {
        "extracted_new_max": extracted_new_max,
        "timeout_count": timeout_count,
        "discover_scanned_max": scanned_max,
        "discover_new_max": discover_new_max,
        "incremental_skipped": incremental_skipped,
        "changed_pdfs": changed_pdfs,
    }


@app.command("ingest-non-pdf")
def cmd_ingest_non_pdf(
    root: Path = typer.Argument(..., exists=True, file_okay=False, dir_okay=True),
    memory_scope: str = typer.Option("datalake_nonpdf", help="Memory scope for non-PDF files"),
    state_file: Path = typer.Option(STATE_DIR / "non_pdf_state.json", help="State file path"),
    watchdog_seconds: int = typer.Option(900, min=30, help="Fail when a command produces no output for this many seconds"),
    watchdog_poll_seconds: int = typer.Option(15, min=1, help="Watchdog polling interval in seconds"),
) -> None:
    """Ingest changed non-PDF files into graph memory."""
    prev = _load_state(state_file)
    curr = _scan_files(root, NON_PDF_EXTENSIONS)
    changed = _changed_files(prev, curr)
    stats = (
        _ingest_non_pdf_files(
            changed,
            memory_scope,
            watchdog_seconds=watchdog_seconds,
            watchdog_poll_seconds=watchdog_poll_seconds,
        )
        if changed
        else {"ok": 0, "failed": 0}
    )
    _save_state(state_file, curr)
    print(
        f"non_pdf_changed={len(changed)} "
        f"ingested_ok={stats['ok']} ingested_failed={stats['failed']}"
    )
    if stats["failed"] > 0:
        raise typer.Exit(code=1)


@app.command("once")
def cmd_once(
    root: Path = typer.Argument(..., exists=True, file_okay=False, dir_okay=True),
    target_score: float = typer.Option(0.95, min=0.0, max=1.0),
    target_fail_ratio: float = typer.Option(0.01, min=0.0, max=1.0),
    execute_jobs: bool = typer.Option(True),
    ingest_memory: bool = typer.Option(True),
    ingest_non_pdf: bool = typer.Option(True),
    memory_scope_pdf: str = typer.Option("datalake_pdf"),
    memory_scope_non_pdf: str = typer.Option("datalake_nonpdf"),
    taxonomy_collection: str = typer.Option("operational"),
    task_monitor: bool = typer.Option(True, help="Register and report to task-monitor"),
    task_monitor_project: str = typer.Option("datalake_training", help="Task-monitor project grouping"),
    task_monitor_strict: bool = typer.Option(True, help="Hard-fail if task-monitor integration fails"),
    watchdog_seconds: int = typer.Option(900, min=30, help="Fail when a long-running command emits no output for this many seconds"),
    watchdog_poll_seconds: int = typer.Option(15, min=1, help="Watchdog polling interval in seconds"),
    review_incremental: bool = typer.Option(True, help="Enable incremental changed-PDF review mode"),
) -> None:
    """Run one datalake learning cycle."""
    cycle_state = TASK_MONITOR_STATE_DIR / "learn_datalake_once_cycle.json"
    review_state = TASK_MONITOR_STATE_DIR / "learn_datalake_once_review_pdf.json"
    non_pdf_state = TASK_MONITOR_STATE_DIR / "learn_datalake_once_non_pdf.json"

    _tm_start_session(project=task_monitor_project, enabled=task_monitor, strict=task_monitor_strict)
    _tm_register_task(
        name="learn_datalake_once_cycle",
        state_file=cycle_state,
        total=1,
        description="One-shot datalake learning cycle",
        project=task_monitor_project,
        enabled=task_monitor,
        strict=task_monitor_strict,
    )
    _tm_register_task(
        name="learn_datalake_once_review_pdf",
        state_file=review_state,
        total=1,
        description="review-pdf one-shot pass",
        project=task_monitor_project,
        enabled=task_monitor,
        strict=task_monitor_strict,
    )
    _tm_register_task(
        name="learn_datalake_once_non_pdf",
        state_file=non_pdf_state,
        total=None,
        description="non-PDF ingest one-shot pass",
        project=task_monitor_project,
        enabled=task_monitor,
        strict=task_monitor_strict,
    )

    non_pdf_stats = {"ok": 0, "failed": 0}
    review = CommandResult(cmd="", returncode=1, stdout="", stderr="")
    final_notes = "learn-datalake once failed"
    try:
        _write_task_state(
            cycle_state,
            {"completed": 0, "stats": {"phase": "review_pdf"}, "current_item": str(root)},
        )
        review = _run_review_pdf_once(
            root=root,
            target_score=target_score,
            target_fail_ratio=target_fail_ratio,
            poll_seconds=300,
            execute_jobs=execute_jobs,
            ingest_memory=ingest_memory,
            memory_scope=memory_scope_pdf,
            taxonomy_collection=taxonomy_collection,
            watchdog_seconds=watchdog_seconds,
            watchdog_poll_seconds=watchdog_poll_seconds,
            review_incremental=review_incremental,
            state_file=review_state,
        )
        _ensure_not_stalled(review, "review-pdf")
        if review.stderr.strip():
            logger.info(review.stderr.splitlines()[-1])
        _write_task_state(
            review_state,
            {
                "completed": 1,
                "stats": {"returncode": review.returncode},
                "current_item": str(root),
                "consecutive_failures": 1 if review.returncode != 0 else 0,
            },
        )

        if ingest_non_pdf:
            curr = _scan_files(root, NON_PDF_EXTENSIONS)
            _write_task_state(
                non_pdf_state,
                {"completed": 0, "stats": {"total": len(curr)}, "current_item": "non-pdf scan"},
            )
            non_pdf_stats = _ingest_non_pdf_files(
                [Path(path) for path in curr.keys()],
                memory_scope_non_pdf,
                watchdog_seconds=watchdog_seconds,
                watchdog_poll_seconds=watchdog_poll_seconds,
                state_file=non_pdf_state,
                prior_completed=0,
            )
            print(
                f"non_pdf_total={len(curr)} "
                f"ingested_ok={non_pdf_stats['ok']} ingested_failed={non_pdf_stats['failed']}"
            )

        hard_fail = review.returncode != 0 or non_pdf_stats["failed"] > 0
        _write_task_state(
            cycle_state,
            {
                "completed": 1,
                "stats": {
                    "review_returncode": review.returncode,
                    "non_pdf_failed": non_pdf_stats["failed"],
                },
                "current_item": str(root),
                "consecutive_failures": 1 if hard_fail else 0,
            },
        )
        if hard_fail:
            final_notes = "learn-datalake once completed with failures"
            raise typer.Exit(code=1)

        final_notes = "learn-datalake once completed"
        _tm_add_accomplishment(
            text=(
                f"one-shot cycle complete root={root} "
                f"review_rc={review.returncode} non_pdf_failed={non_pdf_stats['failed']}"
            ),
            enabled=task_monitor,
            strict=task_monitor_strict,
        )
    finally:
        _tm_end_session(notes=final_notes, enabled=task_monitor, strict=task_monitor_strict)


@app.command("start")
def cmd_start(
    root: Path = typer.Argument(..., exists=True, file_okay=False, dir_okay=True),
    target_score: float = typer.Option(0.95, min=0.0, max=1.0),
    target_fail_ratio: float = typer.Option(0.01, min=0.0, max=1.0),
    poll_seconds: int = typer.Option(300, min=10),
    execute_jobs: bool = typer.Option(True),
    ingest_memory: bool = typer.Option(True),
    ingest_non_pdf: bool = typer.Option(True),
    memory_scope_pdf: str = typer.Option("datalake_pdf"),
    memory_scope_non_pdf: str = typer.Option("datalake_nonpdf"),
    taxonomy_collection: str = typer.Option("operational"),
    task_monitor: bool = typer.Option(True, help="Register and report to task-monitor"),
    task_monitor_project: str = typer.Option("datalake_training", help="Task-monitor project grouping"),
    task_monitor_strict: bool = typer.Option(True, help="Hard-fail if task-monitor integration fails"),
    watchdog_seconds: int = typer.Option(900, min=30, help="Fail when a long-running command emits no output for this many seconds"),
    watchdog_poll_seconds: int = typer.Option(15, min=1, help="Watchdog polling interval in seconds"),
    review_incremental: bool = typer.Option(True, help="Enable incremental changed-PDF review mode"),
) -> None:
    """Continuously learn directory content into memory and monitor PDF quality."""
    non_pdf_change_state = STATE_DIR / "non_pdf_state.json"
    cycle_state = TASK_MONITOR_STATE_DIR / "learn_datalake_start_cycle.json"
    review_state = TASK_MONITOR_STATE_DIR / "learn_datalake_start_review_pdf.json"
    non_pdf_state = TASK_MONITOR_STATE_DIR / "learn_datalake_start_non_pdf.json"

    _tm_start_session(project=task_monitor_project, enabled=task_monitor, strict=task_monitor_strict)
    _tm_register_task(
        name="learn_datalake_start_cycle",
        state_file=cycle_state,
        total=None,
        description="Continuous learn-datalake cycles",
        project=task_monitor_project,
        enabled=task_monitor,
        strict=task_monitor_strict,
    )
    _tm_register_task(
        name="learn_datalake_start_review_pdf",
        state_file=review_state,
        total=None,
        description="Continuous review-pdf cycle runs",
        project=task_monitor_project,
        enabled=task_monitor,
        strict=task_monitor_strict,
    )
    _tm_register_task(
        name="learn_datalake_start_non_pdf",
        state_file=non_pdf_state,
        total=None,
        description="Continuous non-PDF ingest runs",
        project=task_monitor_project,
        enabled=task_monitor,
        strict=task_monitor_strict,
    )

    print(f"watch_root={root}")
    print(f"target_score={target_score:.3f}")
    print(f"poll_seconds={poll_seconds}")

    cycle_count = 0
    cycle_failures = 0
    try:
        while True:
            cycle_count += 1
            _write_task_state(
                cycle_state,
                {
                    "completed": cycle_count - 1,
                    "stats": {"cycle_failures": cycle_failures},
                    "current_item": f"cycle_{cycle_count}",
                    "consecutive_failures": cycle_failures,
                },
            )
            review = _run_review_pdf_once(
                root=root,
                target_score=target_score,
                target_fail_ratio=target_fail_ratio,
                poll_seconds=poll_seconds,
                execute_jobs=execute_jobs,
                ingest_memory=ingest_memory,
                memory_scope=memory_scope_pdf,
                taxonomy_collection=taxonomy_collection,
                watchdog_seconds=watchdog_seconds,
                watchdog_poll_seconds=watchdog_poll_seconds,
                review_incremental=review_incremental,
                state_file=review_state,
            )
            _ensure_not_stalled(review, "review-pdf")
            review_summary = _summarize_review_output(review)
            # Incremental mode can stall backlog reduction when no files changed.
            # Force a non-incremental pass in the same cycle to keep extraction moving.
            if (
                review_incremental
                and review_summary["incremental_skipped"]
                and int(review_summary["changed_pdfs"]) == 0
            ):
                print(
                    "review-pdf backlog_pass_triggered "
                    "reason=incremental_skip_no_changes mode=full",
                    flush=True,
                )
                full_pass = _run_review_pdf_once(
                    root=root,
                    target_score=target_score,
                    target_fail_ratio=target_fail_ratio,
                    poll_seconds=poll_seconds,
                    execute_jobs=execute_jobs,
                    ingest_memory=ingest_memory,
                    memory_scope=memory_scope_pdf,
                    taxonomy_collection=taxonomy_collection,
                    watchdog_seconds=watchdog_seconds,
                    watchdog_poll_seconds=watchdog_poll_seconds,
                    review_incremental=False,
                    state_file=review_state,
                )
                _ensure_not_stalled(full_pass, "review-pdf-full-pass")
                review = full_pass
                review_summary = _summarize_review_output(review)
            if review.stderr.strip():
                logger.info(review.stderr.splitlines()[-1])
            if review.returncode != 0:
                cycle_failures += 1
            else:
                cycle_failures = 0
            _write_task_state(
                review_state,
                {
                    "completed": cycle_count,
                    "stats": {
                        "review_returncode": review.returncode,
                        "extracted_new_max": review_summary["extracted_new_max"],
                        "timeout_count": review_summary["timeout_count"],
                        "discover_scanned_max": review_summary["discover_scanned_max"],
                        "discover_new_max": review_summary["discover_new_max"],
                        "incremental_skipped": review_summary["incremental_skipped"],
                        "changed_pdfs": review_summary["changed_pdfs"],
                    },
                    "current_item": f"cycle_{cycle_count}",
                    "consecutive_failures": cycle_failures,
                },
            )
            print(
                (
                    f"cycle={cycle_count} review_rc={review.returncode} "
                    f"extracted_new_max={review_summary['extracted_new_max']} "
                    f"timeout_count={review_summary['timeout_count']} "
                    f"scanned_max={review_summary['discover_scanned_max']} "
                    f"incremental_skipped={str(review_summary['incremental_skipped']).lower()} "
                    f"changed_pdfs={review_summary['changed_pdfs']}"
                ),
                flush=True,
            )

            if ingest_non_pdf:
                prev = _load_state(non_pdf_change_state)
                curr = _scan_files(root, NON_PDF_EXTENSIONS)
                changed = _changed_files(prev, curr)
                stats = (
                    _ingest_non_pdf_files(
                        changed,
                        memory_scope_non_pdf,
                        watchdog_seconds=watchdog_seconds,
                        watchdog_poll_seconds=watchdog_poll_seconds,
                        state_file=non_pdf_state,
                        prior_completed=0,
                    )
                    if changed
                    else {"ok": 0, "failed": 0}
                )
                _save_state(non_pdf_change_state, curr)
                print(
                    f"cycle={cycle_count} non_pdf_changed={len(changed)} "
                    f"ingested_ok={stats['ok']} ingested_failed={stats['failed']}"
                )

            _write_task_state(
                cycle_state,
                {
                    "completed": cycle_count,
                    "stats": {
                        "cycle_failures": cycle_failures,
                        "last_review_returncode": review.returncode,
                        "last_extracted_new_max": review_summary["extracted_new_max"],
                        "last_timeout_count": review_summary["timeout_count"],
                    },
                    "current_item": f"cycle_{cycle_count}",
                    "consecutive_failures": cycle_failures,
                },
            )
            _tm_add_accomplishment(
                text=(
                    f"cycle={cycle_count} review_rc={review.returncode} "
                    f"consecutive_failures={cycle_failures}"
                ),
                enabled=task_monitor,
                strict=task_monitor_strict,
            )
            time.sleep(poll_seconds)
    finally:
        _tm_end_session(
            notes=f"learn-datalake start stopped after cycles={cycle_count}",
            enabled=task_monitor,
            strict=task_monitor_strict,
        )


@app.command("assess-coverage")
def cmd_assess_coverage(
    root: Path = typer.Argument(..., exists=True, file_okay=False, dir_okay=True),
    target_pdf_per_sector: int = typer.Option(500, min=1),
    output_json: Path = typer.Option(
        STATE_DIR / "coverage" / "coverage_latest.json",
        help="Coverage report output JSON",
    ),
) -> None:
    """Assess datalake corpus coverage and write a machine-readable report."""
    report = _coverage_report(root, target_pdf_per_sector)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    sectors_below = report["sectors"]["sectors_below_target"]
    print(
        f"coverage_report={output_json} "
        f"pdf_total={report['totals']['pdf']} "
        f"sectors_below_target={len(sectors_below)}"
    )
    if sectors_below:
        print("sectors_below_target=" + ",".join(sectors_below))


@app.command("plan-gap-download")
def cmd_plan_gap_download(
    root: Path = typer.Argument(..., exists=True, file_okay=False, dir_okay=True),
    target_pdf_per_sector: int = typer.Option(500, min=1),
    per_sector_limit: int = typer.Option(250, min=1),
    output_manifest: Path = typer.Option(
        STATE_DIR / "coverage" / "gap_manifest_urls.txt",
        help="Manifest output path for selected gap URLs",
    ),
    output_plan_json: Path = typer.Option(
        STATE_DIR / "coverage" / "gap_plan.json",
        help="Gap plan report output JSON",
    ),
    execute_fetch: bool = typer.Option(
        False,
        help="Execute fetcher get-manifest after writing manifest",
    ),
    fetch_output_dir: Optional[Path] = typer.Option(
        None,
        help="Override fetcher output directory",
    ),
    task_monitor: bool = typer.Option(True, help="Register and report to task-monitor"),
    task_monitor_project: str = typer.Option("datalake_training", help="Task-monitor project grouping"),
    task_monitor_strict: bool = typer.Option(True, help="Hard-fail if task-monitor integration fails"),
    watchdog_seconds: int = typer.Option(900, min=30, help="Fail when fetcher produces no output for this many seconds"),
    watchdog_poll_seconds: int = typer.Option(15, min=1, help="Watchdog polling interval in seconds"),
) -> None:
    """Plan and optionally execute URL downloads to fill sector PDF gaps."""
    report = _coverage_report(root, target_pdf_per_sector)
    sector_gap_counts: Dict[str, int] = report["sectors"]["pdf_gap_counts"]
    downloaded = _downloaded_url_set(root)
    candidates = _read_candidate_urls()
    grouped = _urls_by_sector(candidates)

    selected_urls: List[str] = []
    selected_by_sector: Dict[str, int] = {}
    available_by_sector: Dict[str, int] = {}

    for sector in SECTOR_KEYS:
        need = sector_gap_counts.get(sector, 0)
        if need <= 0:
            selected_by_sector[sector] = 0
            available_by_sector[sector] = len(grouped.get(sector, []))
            continue
        pool = [url for url in grouped.get(sector, []) if url not in downloaded]
        available_by_sector[sector] = len(pool)
        take = min(need, per_sector_limit, len(pool))
        chosen = pool[:take]
        selected_urls.extend(chosen)
        selected_by_sector[sector] = len(chosen)

    # Deduplicate final manifest while preserving order.
    final_urls: List[str] = []
    seen: set[str] = set()
    for url in selected_urls:
        if url in seen:
            continue
        seen.add(url)
        final_urls.append(url)

    _write_manifest(output_manifest, final_urls)
    plan_payload: Dict[str, Any] = {
        "root": str(root),
        "timestamp": int(time.time()),
        "target_pdf_per_sector": target_pdf_per_sector,
        "per_sector_limit": per_sector_limit,
        "coverage_report": report,
        "candidate_urls_total": len(candidates),
        "already_downloaded_urls": len(downloaded),
        "selected_manifest_path": str(output_manifest),
        "selected_url_count": len(final_urls),
        "selected_by_sector": selected_by_sector,
        "available_by_sector": available_by_sector,
        "execute_fetch": execute_fetch,
        "fetch_result": None,
    }

    if execute_fetch:
        fetch_state = TASK_MONITOR_STATE_DIR / "learn_datalake_gap_fetch.json"
        _tm_start_session(project=task_monitor_project, enabled=task_monitor, strict=task_monitor_strict)
        _tm_register_task(
            name="learn_datalake_gap_fetch",
            state_file=fetch_state,
            total=len(final_urls),
            description="Gap-fill fetcher run",
            project=task_monitor_project,
            enabled=task_monitor,
            strict=task_monitor_strict,
        )
        if len(final_urls) == 0:
            print("selected_url_count=0 fetch_skipped=true")
            plan_payload["fetch_result"] = {
                "status": "skipped",
                "reason": "no_selected_urls",
            }
        else:
            run_id = int(time.time())
            out_dir = fetch_output_dir or (root / f"expansion_gapfill_{run_id}")
            _write_task_state(
                fetch_state,
                {
                    "completed": 0,
                    "stats": {"selected_url_count": len(final_urls)},
                    "current_item": str(output_manifest),
                },
            )
            fetch_proc = _run_fetcher_manifest(
                output_manifest,
                out_dir,
                watchdog_seconds=watchdog_seconds,
                watchdog_poll_seconds=watchdog_poll_seconds,
                state_file=fetch_state,
            )
            _ensure_not_stalled(fetch_proc, "gap-fetch")
            plan_payload["fetch_result"] = {
                "status": "ok" if fetch_proc.returncode == 0 else "failed",
                "returncode": fetch_proc.returncode,
                "out_dir": str(out_dir),
                "stdout_tail": "\n".join(fetch_proc.stdout.splitlines()[-40:]),
                "stderr_tail": "\n".join(fetch_proc.stderr.splitlines()[-40:]),
                "elapsed_seconds": round(fetch_proc.elapsed_seconds, 2),
                "stalled": fetch_proc.stalled,
                "timed_out": fetch_proc.timed_out,
            }
            _write_task_state(
                fetch_state,
                {
                    "completed": len(final_urls) if fetch_proc.returncode == 0 else 0,
                    "stats": {
                        "returncode": fetch_proc.returncode,
                        "elapsed_seconds": round(fetch_proc.elapsed_seconds, 2),
                        "stalled": fetch_proc.stalled,
                        "timed_out": fetch_proc.timed_out,
                    },
                    "current_item": str(out_dir),
                    "consecutive_failures": 1 if fetch_proc.returncode != 0 else 0,
                },
            )
            print(
                f"fetch_status={plan_payload['fetch_result']['status']} "
                f"fetch_out_dir={out_dir}"
            )
            if fetch_proc.returncode != 0:
                output_plan_json.parent.mkdir(parents=True, exist_ok=True)
                output_plan_json.write_text(json.dumps(plan_payload, indent=2), encoding="utf-8")
                _tm_end_session(
                    notes="gap-fetch failed",
                    enabled=task_monitor,
                    strict=task_monitor_strict,
                )
                raise typer.Exit(code=1)
            _tm_add_accomplishment(
                text=f"gap-fetch completed urls={len(final_urls)} out={out_dir}",
                enabled=task_monitor,
                strict=task_monitor_strict,
            )
        _tm_end_session(
            notes="gap-fetch completed",
            enabled=task_monitor,
            strict=task_monitor_strict,
        )

    output_plan_json.parent.mkdir(parents=True, exist_ok=True)
    output_plan_json.write_text(json.dumps(plan_payload, indent=2), encoding="utf-8")
    print(
        f"gap_plan={output_plan_json} "
        f"manifest={output_manifest} "
        f"selected_urls={len(final_urls)}"
    )


if __name__ == "__main__":
    app()
