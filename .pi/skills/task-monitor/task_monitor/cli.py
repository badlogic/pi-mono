"""Task Monitor CLI - Command-line interface commands.

This module provides all CLI commands for the task-monitor skill.
"""
from __future__ import annotations

from datetime import datetime
import time
from typing import Any

import typer
from rich.console import Console
from rich.table import Table

from task_monitor.config import DEFAULT_API_PORT, DEFAULT_REFRESH_INTERVAL
from task_monitor.models import HistoryEntry, TaskConfig
from task_monitor.stores import HistoryStore, SessionTracker, TaskRegistry
from task_monitor.tui import TaskMonitorTUI
from task_monitor.utils import get_task_status


console = Console()


def _ascii_cell(value: Any, max_len: int = 16) -> str:
    text = str(value) if value is not None else "-"
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _render_ascii_table(headers: list[str], rows: list[list[Any]]) -> None:
    if not rows:
        return
    normalized = [[_ascii_cell(cell) for cell in row] for row in rows]
    widths = [len(header) for header in headers]
    for row in normalized:
        for idx, cell in enumerate(row):
            widths[idx] = max(widths[idx], len(cell))
    border = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    header_row = "| " + " | ".join(headers[i].ljust(widths[i]) for i in range(len(headers))) + " |"
    console.print(border)
    console.print(header_row)
    console.print(border)
    for row in normalized:
        console.print(
            "| " + " | ".join(row[i].ljust(widths[i]) for i in range(len(headers))) + " |"
        )
    console.print(border)


def _is_task_active(task_status: dict[str, Any]) -> bool:
    stats = task_status.get("stats", {}) or {}
    state = str(stats.get("status", "") or "").lower()
    if state in {"running", "restarting", "active", "in_progress", "starting"}:
        return True
    total = task_status.get("total")
    completed = task_status.get("completed")
    if isinstance(total, (int, float)) and total > 0 and isinstance(completed, (int, float)):
        if completed < total:
            return True
    return False

# =============================================================================
# Main CLI Application
# =============================================================================

app_cli = typer.Typer(help="Task Monitor - TUI + API for long-running tasks")


@app_cli.command()
def tui(
    refresh: int = typer.Option(DEFAULT_REFRESH_INTERVAL, "--refresh", "-r", help="Refresh interval in seconds"),
    filter_term: str = typer.Option(None, "--filter", "-f", help="Filter tasks by name"),
):
    """Start the Rich TUI monitor."""
    monitor = TaskMonitorTUI(filter_term=filter_term)

    if not monitor.registry.tasks:
        console.print("[yellow]No tasks registered. Use 'register' command first.[/]")
        return

    monitor.run(refresh_interval=refresh)


@app_cli.command()
def serve(port: int = typer.Option(DEFAULT_API_PORT, "--port", "-p", help="Port to run on")):
    """Start the HTTP API server."""
    from task_monitor.http_api import run_server
    run_server(port)


@app_cli.command()
def register(
    name: str = typer.Option(..., "--name", "-n", help="Task name"),
    state: str = typer.Option(..., "--state", "-s", help="Path to state file"),
    total: int = typer.Option(None, "--total", "-t", help="Total items to process"),
    description: str = typer.Option(None, "--desc", "-d", help="Task description"),
    on_complete: str = typer.Option(None, "--on-complete", help="Command to run on completion (or 'batch-report')"),
    batch_type: str = typer.Option(None, "--batch-type", "-b", help="Batch type for reporting"),
    project: str = typer.Option(None, "--project", "-p", help="Project name for grouping"),
):
    """Register a task to monitor."""
    config = TaskConfig(
        name=name,
        state_file=state,
        total=total,
        description=description,
        on_complete=on_complete,
        batch_type=batch_type,
        project=project,
    )
    registry = TaskRegistry()
    registry.register(config)

    # Record in history
    history = HistoryStore()
    history.record(HistoryEntry(
        task_name=name,
        project=project,
        action="started",
        timestamp=datetime.now().isoformat(),
        details={"total": total, "description": description},
    ))

    # Add to active session if exists
    sessions = SessionTracker()
    active = sessions.get_active_session()
    if active:
        sessions.add_task(active["session_id"], name)

    console.print(f"[green]Registered task: {name}[/]")
    console.print(f"  State file: {state}")
    if total:
        console.print(f"  Total items: {total}")
    if project:
        console.print(f"  Project: {project}")


@app_cli.command()
def unregister(name: str = typer.Argument(..., help="Task name to unregister")):
    """Unregister a task."""
    registry = TaskRegistry()
    if name not in registry.tasks:
        console.print(f"[red]Task not found: {name}[/]")
        return
    registry.unregister(name)
    console.print(f"[green]Unregistered task: {name}[/]")


@app_cli.command()
def status(
    project: str = typer.Option(None, "--project", "-p", help="Filter by project"),
    name_filter: str = typer.Option(None, "--name", "-n", help="Filter tasks by substring in task name"),
    all_tasks: bool = typer.Option(
        False,
        "--all/--active-only",
        help="Show all tasks, including inactive historical entries",
    ),
    table: bool = typer.Option(True, "--table/--no-table", help="Render an ASCII status table"),
    watch: int = typer.Option(0, "--watch", "-w", min=0, help="Refresh interval in seconds (0=single run)"),
):
    """Show quick status of tasks with extraction-quality metrics."""
    registry = TaskRegistry()

    if not registry.tasks:
        console.print("[yellow]No tasks registered.[/]")
        return

    def _iter_rows() -> list[list[Any]]:
        rows: list[list[Any]] = []
        for name, task in registry.tasks.items():
            if project and task.project != project:
                continue
            if name_filter and name_filter.lower() not in task.name.lower():
                continue
            task_status = get_task_status(task)
            if not all_tasks and not _is_task_active(task_status):
                continue
            stats = task_status.get("stats", {}) or {}
            state_str = str(stats.get("status", "-"))
            coverage_value = stats.get("extracted_pdf_coverage_pct")
            coverage_str = f"{coverage_value:.2f}%" if isinstance(coverage_value, (int, float)) else "-"
            timeout_rate = stats.get("extraction_timeout_rate_pct")
            timeout_rate_str = f"{timeout_rate:.2f}%" if isinstance(timeout_rate, (int, float)) else "-"
            fail_rate = stats.get("extraction_fail_rate_pct")
            fail_rate_str = f"{fail_rate:.2f}%" if isinstance(fail_rate, (int, float)) else "-"
            throughput = stats.get("extraction_throughput_per_hour")
            throughput_str = f"{throughput:.2f}" if isinstance(throughput, (int, float)) else "-"
            rolling_docs = stats.get("rolling_docs_analyzed")
            rolling_docs_str = str(int(rolling_docs)) if isinstance(rolling_docs, (int, float)) else "-"
            loop_score = stats.get("rolling_avg_score", stats.get("last_loop_score"))
            loop_score_str = f"{loop_score:.4f}" if isinstance(loop_score, (int, float)) else "-"
            loop_fail_ratio = stats.get("rolling_fail_ratio", stats.get("last_loop_fail_ratio"))
            loop_fail_ratio_str = f"{loop_fail_ratio:.4f}" if isinstance(loop_fail_ratio, (int, float)) else "-"
            rolling_critical_ratio = stats.get("rolling_critical_doc_ratio")
            rolling_critical_ratio_str = (
                f"{(100.0 * rolling_critical_ratio):.2f}%"
                if isinstance(rolling_critical_ratio, (int, float))
                else "-"
            )
            missing_ratio = stats.get("documents_missing_ratio")
            missing_ratio_str = f"{(100.0 * missing_ratio):.2f}%" if isinstance(missing_ratio, (int, float)) else "-"
            phase = str(stats.get("phase", "-"))
            gate_action = str(stats.get("quality_gate_action", "-"))
            restart_str = str(stats.get("restart_count", "-"))
            updated = str(task_status.get("last_updated", ""))[:16] or "-"
            rows.append(
                [
                    name,
                    state_str,
                    coverage_str,
                    timeout_rate_str,
                    fail_rate_str,
                    throughput_str,
                    rolling_docs_str,
                    loop_score_str,
                    loop_fail_ratio_str,
                    rolling_critical_ratio_str,
                    missing_ratio_str,
                    phase,
                    gate_action,
                    restart_str,
                    updated,
                ]
            )
        return rows

    def _render_once() -> None:
        rows = _iter_rows()
        if len(rows) == 0:
            suffix = f" for project='{project}'" if project else ""
            mode = "all tasks" if all_tasks else "active tasks"
            console.print(f"[yellow]No {mode} found{suffix}.[/]")
            return
        title = f"Task Status{f' ({project})' if project else ''}"
        console.print(title)
        if table:
            _render_ascii_table(
                headers=[
                    "Task",
                    "St",
                    "Cov%",
                    "To%",
                    "Fa%",
                    "Thr/h",
                    "N",
                    "LSc",
                    "LFr",
                    "Crit%",
                    "Miss%",
                    "Ph",
                    "Gate",
                    "R",
                    "Upd",
                ],
                rows=rows,
            )
        else:
            for row in rows:
                console.print(" | ".join(_ascii_cell(cell, max_len=24) for cell in row))

    if watch <= 0:
        _render_once()
        return

    while True:
        console.clear()
        _render_once()
        time.sleep(watch)


@app_cli.command("list")
def list_tasks():
    """List all registered tasks."""
    registry = TaskRegistry()

    if not registry.tasks:
        console.print("[yellow]No tasks registered.[/]")
        return

    for name, task in registry.tasks.items():
        console.print(f"[cyan]{name}[/]: {task.state_file}")


# =============================================================================
# History CLI Subcommands
# =============================================================================

history_app = typer.Typer(help="Search task history and session context")
app_cli.add_typer(history_app, name="history")


@history_app.command("search")
def history_search(
    term: str = typer.Argument(..., help="Search term (task name or project)"),
    limit: int = typer.Option(20, "--limit", "-n", help="Max results"),
):
    """Search history by task name or project."""
    store = HistoryStore()
    results = store.search(term, limit=limit)

    if not results:
        console.print(f"[yellow]No history found for '{term}'[/]")
        return

    table = Table(title=f"History: {term}")
    table.add_column("Timestamp", style="dim")
    table.add_column("Task", style="cyan")
    table.add_column("Action")
    table.add_column("Project")
    table.add_column("Details")

    for entry in results:
        ts = entry.get("timestamp", "")[:19]
        action = entry.get("action", "")
        action_style = {
            "started": "[green]started[/]",
            "completed": "[bold green]completed[/]",
            "failed": "[red]failed[/]",
            "paused": "[yellow]paused[/]",
            "progress": "[blue]progress[/]",
        }.get(action, action)

        details = entry.get("details", {})
        detail_str = ""
        if details:
            if "completed" in details:
                detail_str = f"{details['completed']}/{details.get('total', '?')}"
            elif "reason" in details:
                detail_str = details["reason"][:30]

        table.add_row(
            ts,
            entry.get("task_name", "")[:20],
            action_style,
            (entry.get("project") or "")[:15] or "-",
            detail_str,
        )

    console.print(table)


@history_app.command("recent")
def history_recent(
    limit: int = typer.Option(20, "--limit", "-n", help="Max results"),
):
    """Show recent history entries."""
    store = HistoryStore()
    results = store.get_recent(limit=limit)

    if not results:
        console.print("[yellow]No history found[/]")
        return

    table = Table(title="Recent History")
    table.add_column("Timestamp", style="dim")
    table.add_column("Task", style="cyan")
    table.add_column("Action")
    table.add_column("Project")

    for entry in results:
        ts = entry.get("timestamp", "")[:19]
        action = entry.get("action", "")
        action_style = {
            "started": "[green]started[/]",
            "completed": "[bold green]completed[/]",
            "failed": "[red]failed[/]",
            "paused": "[yellow]paused[/]",
            "progress": "[blue]progress[/]",
        }.get(action, action)

        table.add_row(
            ts,
            entry.get("task_name", "")[:25],
            action_style,
            (entry.get("project") or "")[:15] or "-",
        )

    console.print(table)


@history_app.command("project")
def history_project(
    project: str = typer.Argument(..., help="Project name"),
    limit: int = typer.Option(50, "--limit", "-n", help="Max results"),
):
    """Show history for a specific project."""
    store = HistoryStore()
    results = store.get_by_project(project, limit=limit)

    if not results:
        console.print(f"[yellow]No history found for project '{project}'[/]")
        return

    table = Table(title=f"Project History: {project}")
    table.add_column("Timestamp", style="dim")
    table.add_column("Task", style="cyan")
    table.add_column("Action")
    table.add_column("Details")

    for entry in results:
        ts = entry.get("timestamp", "")[:19]
        action = entry.get("action", "")
        details = entry.get("details", {})
        detail_str = ""
        if details and "completed" in details:
            detail_str = f"{details['completed']}/{details.get('total', '?')}"

        table.add_row(ts, entry.get("task_name", "")[:25], action, detail_str)

    console.print(table)


@history_app.command("resume")
def history_resume():
    """Show 'where was I?' context - incomplete tasks and last session."""
    store = HistoryStore()
    sessions = SessionTracker()

    context = store.get_last_session_context()
    last_session = sessions.get_last_session()

    console.print("\n[bold cyan]=== Where Was I? ===[/]\n")

    # Show last session info
    if last_session:
        console.print("[bold]Last Session:[/]")
        console.print(f"  Started: {last_session.get('started_at', '')[:19]}")
        if last_session.get("ended_at"):
            console.print(f"  Ended: {last_session.get('ended_at', '')[:19]}")
        else:
            console.print("  [yellow]Status: Still active (or interrupted)[/]")

        if last_session.get("project"):
            console.print(f"  Project: [cyan]{last_session['project']}[/]")

        if last_session.get("tasks"):
            console.print(f"  Tasks: {', '.join(last_session['tasks'][:5])}")

        if last_session.get("accomplishments"):
            console.print("  [green]Accomplishments:[/]")
            for acc in last_session["accomplishments"][:5]:
                console.print(f"    - {acc}")

        console.print()

    # Show incomplete tasks
    incomplete = context.get("incomplete_tasks", [])
    if incomplete:
        console.print("[bold yellow]Incomplete Tasks:[/]")
        for task in incomplete[:5]:
            console.print(f"  [cyan]{task['task_name']}[/]")
            console.print(f"    Last action: {task['last_action']} at {task['last_timestamp'][:19]}")
            if task.get("project"):
                console.print(f"    Project: {task['project']}")
            if task.get("details"):
                details = task["details"]
                if "completed" in details:
                    console.print(f"    Progress: {details['completed']}/{details.get('total', '?')}")
        console.print()

    # Show suggestion
    suggestion = context.get("suggestion")
    if suggestion:
        console.print("[bold green]Suggested Resume Point:[/]")
        console.print(f"  -> [bold]{suggestion['task_name']}[/]")
        if suggestion.get("details"):
            details = suggestion["details"]
            if "completed" in details:
                console.print(f"    Resume at: {details['completed']}/{details.get('total', '?')}")
    elif not incomplete:
        console.print("[green]All tasks completed! Start a new session.[/]")

    console.print()


@history_app.command("sessions")
def history_sessions(
    project: str = typer.Option(None, "--project", "-p", help="Filter by project"),
    limit: int = typer.Option(10, "--limit", "-n", help="Max sessions"),
):
    """List recent work sessions."""
    tracker = SessionTracker()
    sessions = tracker.get_sessions(project=project, limit=limit)

    if not sessions:
        console.print("[yellow]No sessions found[/]")
        return

    table = Table(title="Work Sessions")
    table.add_column("Session ID", style="cyan")
    table.add_column("Project")
    table.add_column("Started", style="dim")
    table.add_column("Status")
    table.add_column("Tasks")
    table.add_column("Accomplishments")

    for session in sessions:
        status = session.get("status", "unknown")
        status_style = {
            "active": "[green]active[/]",
            "completed": "[dim]completed[/]",
            "interrupted": "[yellow]interrupted[/]",
        }.get(status, status)

        tasks = session.get("tasks", [])
        task_str = f"{len(tasks)} tasks" if tasks else "-"

        accs = session.get("accomplishments", [])
        acc_str = f"{len(accs)} items" if accs else "-"

        table.add_row(
            session.get("session_id", "")[:8],
            (session.get("project") or "")[:15] or "-",
            session.get("started_at", "")[:16],
            status_style,
            task_str,
            acc_str,
        )

    console.print(table)


# =============================================================================
# Session Management Commands
# =============================================================================

@app_cli.command("start-session")
def start_session(
    project: str = typer.Option(None, "--project", "-p", help="Project name"),
):
    """Start a new work session."""
    tracker = SessionTracker()

    # Check for existing active session
    active = tracker.get_active_session()
    if active:
        console.print(f"[yellow]Active session exists: {active['session_id']}[/]")
        console.print("End it with 'end-session' first, or continue working.")
        return

    session_id = tracker.start_session(project=project)
    console.print(f"[green]Started session: {session_id}[/]")
    if project:
        console.print(f"  Project: {project}")
    console.print("Use 'end-session' when done, or 'add-accomplishment' to track progress.")


@app_cli.command("end-session")
def end_session(
    notes: str = typer.Option(None, "--notes", "-n", help="Session notes"),
):
    """End the current work session."""
    tracker = SessionTracker()

    active = tracker.get_active_session()
    if not active:
        console.print("[yellow]No active session found[/]")
        return

    tracker.end_session(active["session_id"], notes=notes)
    console.print(f"[green]Ended session: {active['session_id']}[/]")

    if active.get("accomplishments"):
        console.print("Accomplishments:")
        for acc in active["accomplishments"]:
            console.print(f"  - {acc}")


@app_cli.command("add-accomplishment")
def add_accomplishment(
    text: str = typer.Argument(..., help="What you accomplished"),
):
    """Add an accomplishment to the current session."""
    tracker = SessionTracker()

    active = tracker.get_active_session()
    if not active:
        console.print("[yellow]No active session. Use 'start-session' first.[/]")
        return

    tracker.add_accomplishment(active["session_id"], text)
    console.print(f"[green]Added: {text}[/]")
