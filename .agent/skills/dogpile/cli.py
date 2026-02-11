#!/usr/bin/env python3
"""Dogpile: Comprehensive deep search aggregator.

Orchestrates searches across:
- Brave Search (Web)
- Perplexity (Deep Research)
- GitHub (Repos & Issues)
- ArXiv (Papers)
- YouTube (Videos)
- Discord (Security Servers)
- Readarr (Books/Usenet)
- Wayback Machine (Archives)

Resilience features (based on 2025-2026 best practices):
- Tenacity retries with exponential backoff + jitter
- Per-provider semaphores for concurrency control
- Rate limit header parsing (Retry-After, x-ratelimit-*)
"""
import json
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Optional

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

import typer
from rich.markdown import Markdown

from dogpile.config import (
    app,
    console,
    REGISTRY_AVAILABLE,
    get_registry,
    VERSION,
)
from dogpile.utils import log_status
from dogpile.error_tracking import (
    start_session as start_error_session,
    end_session as end_error_session,
    get_error_summary,
    ErrorType,
)
from dogpile.task_monitor_integration import (
    start_search as start_monitor,
    end_search as end_monitor,
    get_monitor,
)
from dogpile.codex import (
    search_codex,
    search_codex_knowledge,
    tailor_queries_for_services,
    analyze_query,
)
from dogpile.brave import search_brave, run_stage2_brave
from dogpile.perplexity import search_perplexity
from dogpile.arxiv_search import search_arxiv, run_stage2_arxiv
from dogpile.github_search import search_github, search_github_via_skill
from dogpile.github_deep import run_stage2_github
from dogpile.youtube_search import search_youtube, run_stage2_youtube
from dogpile.wayback import search_wayback
from dogpile.discord import search_discord_messages
from dogpile.readarr import search_readarr
from dogpile.synthesis import generate_report


def run_stage1_searches(
    tailored: Dict[str, str],
    query: str,
    use_github_skill: bool,
    is_code_related: bool
) -> Dict[str, Any]:
    """Stage 1: Run broad parallel searches across all providers.

    Uses ThreadPoolExecutor with provider semaphores for rate limit protection.

    Args:
        tailored: Dict of service-specific queries
        query: Original search query
        use_github_skill: Whether to use /github-search skill
        is_code_related: Whether query is code-related

    Returns:
        Dict with results from each provider
    """
    # Explicitly define the callable to avoid lambda/decoration issues
    if use_github_skill:
        def github_search_func(q):
            return search_github_via_skill(q, deep=is_code_related, treesitter=False, taxonomy=False)
    else:
        def github_search_func(q):
            return search_github(q)

    with ThreadPoolExecutor(max_workers=8) as executor:
        future_brave = executor.submit(search_brave, tailored["brave"])
        future_perplexity = executor.submit(search_perplexity, tailored["perplexity"])
        future_github = executor.submit(github_search_func, tailored["github"])
        future_arxiv = executor.submit(search_arxiv, tailored["arxiv"])
        future_youtube = executor.submit(search_youtube, tailored["youtube"])
        future_readarr = executor.submit(search_readarr, tailored.get("readarr", query))
        future_wayback = executor.submit(search_wayback, query)
        future_codex_src = executor.submit(search_codex_knowledge, query)
        future_discord = executor.submit(search_discord_messages, query)

        return {
            "brave": future_brave.result(),
            "perplexity": future_perplexity.result(),
            "github": future_github.result(),
            "arxiv": future_arxiv.result(),
            "youtube": future_youtube.result(),
            "readarr": future_readarr.result(),
            "wayback": future_wayback.result(),
            "codex_knowledge": future_codex_src.result(),
            "discord": future_discord.result(),
        }


@app.command()
def search(
    query: str = typer.Argument(..., help="Search query"),
    preset: Optional[str] = typer.Option(None, "--preset", "-p", help="Use a resource preset (vulnerability_research, red_team, blue_team, etc.)"),
    interactive: bool = typer.Option(True, "--interactive/--no-interactive", help="Enable ambiguity/intent check"),
    tailor: bool = typer.Option(True, "--tailor/--no-tailor", help="Tailor queries per service"),
    use_github_skill: bool = typer.Option(True, "--github-skill/--no-github-skill", help="Use /github-search skill"),
    auto_preset: bool = typer.Option(False, "--auto-preset", help="Auto-detect preset from query"),
):
    """Aggregate search results from multiple sources."""

    # Initialize error tracking and task-monitor
    session_id = start_error_session(query)
    monitor = start_monitor(query, name=f"dogpile-{session_id[-8:]}")
    search_success = False

    try:
        _run_search(
            query=query,
            preset=preset,
            interactive=interactive,
            tailor=tailor,
            use_github_skill=use_github_skill,
            auto_preset=auto_preset,
            monitor=monitor,
        )
        search_success = True
    except Exception as e:
        console.print(f"[red]Search failed: {e}[/red]")
        log_status(f"Search failed: {e}", provider="dogpile", status="ERROR", error_type="unknown")
    finally:
        # End monitoring and log summary
        end_error_session("completed" if search_success else "failed")
        end_monitor(search_success)

        # Print error summary if there were issues
        summary = get_error_summary()
        session = summary.get("current_session")
        if session and session.get("error_count", 0) > 0:
            console.print("\n[yellow]--- Error Summary ---[/yellow]")
            if session.get("failed"):
                console.print(f"  Failed providers: {', '.join(session['failed'])}")
            if session.get("rate_limits_hit"):
                console.print(f"  Rate limits: {session['rate_limits_hit']}")
            console.print(f"  Total errors: {session.get('error_count', 0)}")
            console.print("[dim]  See dogpile_errors.json for details[/dim]")


def _run_search(
    query: str,
    preset: Optional[str],
    interactive: bool,
    tailor: bool,
    use_github_skill: bool,
    auto_preset: bool,
    monitor,
):
    """Internal search implementation."""
    # 0. Handle preset selection
    active_preset = None
    preset_brave_query = None

    if REGISTRY_AVAILABLE:
        registry = get_registry()

        # Auto-detect preset if requested
        if auto_preset and not preset:
            suggested = registry.suggest_preset(query)
            if suggested != "general":
                preset = suggested
                console.print(f"[dim]Auto-detected preset: {preset}[/dim]")

        # Load preset if specified
        if preset:
            active_preset = registry.get_preset(preset)
            if active_preset:
                console.print(f"[bold magenta]Using preset:[/bold magenta] {preset} - {active_preset.description}")
                console.print(f"[dim]  Brave sites: {len(active_preset.brave_sites)} | API resources: {active_preset.api_resources}[/dim]")
                # Generate site-filtered Brave query
                if active_preset.brave_sites:
                    preset_brave_query = active_preset.get_brave_query(query)
            else:
                console.print(f"[yellow]Warning: Preset '{preset}' not found, using default search[/yellow]")

    # 1. Analyze Query (Ambiguity + Intent)
    query, is_code_related = analyze_query(query, interactive)

    console.print(f"[bold blue]Dogpiling on:[/bold blue] {query} (Code Related: {is_code_related})...")

    # 2. Tailor queries for each service (expert-level optimization)
    monitor.start_stage("tailoring")
    if tailor:
        tailored = tailor_queries_for_services(query, is_code_related)
        console.print("[dim]Tailored queries:[/dim]")
        for svc, q in tailored.items():
            console.print(f"  [cyan]{svc}:[/cyan] {q[:60]}...")
    else:
        # Use same query for all services
        tailored = {svc: query for svc in ["arxiv", "perplexity", "brave", "github", "youtube", "readarr"]}

    # Override Brave query with preset-filtered query if active
    if preset_brave_query:
        tailored["brave"] = preset_brave_query
        console.print(f"  [magenta]brave (preset):[/magenta] {preset_brave_query[:80]}...")
    monitor.complete_stage("tailoring")

    # Stage 1: Broad parallel searches
    monitor.start_stage("stage1")
    stage1_results = run_stage1_searches(tailored, query, use_github_skill, is_code_related)
    monitor.complete_stage("stage1")

    brave_res = stage1_results["brave"]
    perp_res = stage1_results["perplexity"]
    github_res = stage1_results["github"]
    arxiv_res = stage1_results["arxiv"]
    youtube_res = stage1_results["youtube"]
    readarr_res = stage1_results["readarr"]
    wayback_res = stage1_results["wayback"]
    codex_src_res = stage1_results["codex_knowledge"]
    discord_res = stage1_results["discord"]

    # Stage 2: Deep dives
    # 2.1 GitHub Multi-Stage
    monitor.start_stage("stage2_github")
    github_details, github_deep, target_repo, deep_code_res = run_stage2_github(
        github_res, query, is_code_related, search_codex
    )
    monitor.complete_stage("stage2_github")

    # 2.2 ArXiv Multi-Stage
    monitor.start_stage("stage2_arxiv")
    arxiv_details, arxiv_deep = run_stage2_arxiv(arxiv_res, query, search_codex)
    monitor.complete_stage("stage2_arxiv")

    # 2.3 YouTube Two-Stage
    monitor.start_stage("stage2_youtube")
    youtube_transcripts = run_stage2_youtube(youtube_res)
    monitor.complete_stage("stage2_youtube")

    # 2.4 Brave Deep Extraction
    monitor.start_stage("stage2_brave")
    brave_deep = run_stage2_brave(brave_res, query, search_codex)
    monitor.complete_stage("stage2_brave")

    # Synthesis (Codex High Reasoning)
    monitor.start_stage("synthesis")
    log_status("Starting Codex Synthesis...", provider="synthesis", status="RUNNING")
    console.print("\n[bold cyan]Synthesizing report via Codex (gpt-5.2 High Reasoning)...[/bold cyan]")

    # Generate initial report for synthesis
    initial_report = generate_report(
        query=query,
        wayback_res=wayback_res,
        codex_src_res=codex_src_res,
        perp_res=perp_res,
        readarr_res=readarr_res,
        discord_res=discord_res,
        github_res=github_res,
        github_details=github_details,
        github_deep=github_deep,
        target_repo=target_repo,
        deep_code_res=deep_code_res,
        brave_res=brave_res,
        brave_deep=brave_deep,
        arxiv_res=arxiv_res,
        arxiv_details=arxiv_details,
        arxiv_deep=arxiv_deep,
        youtube_res=youtube_res,
        youtube_transcripts=youtube_transcripts,
    )

    synthesis_prompt = (
        f"Synthesize the following research results for the query '{query}' into a concise, "
        f"high-reasoning conclusion. Highlight unique insights from any source (GitHub, ArXiv, Web).\n\n"
        f"RESULTS:\n{initial_report}"
    )
    synthesis = search_codex(synthesis_prompt)

    if not synthesis.startswith("Error:"):
        log_status("Codex Synthesis finished.", provider="synthesis", status="DONE")
        monitor.complete_stage("synthesis")
    else:
        log_status("Codex Synthesis failed.", provider="synthesis", status="ERROR", error_type="api_error")
        monitor.log_error("codex", f"Synthesis failed: {synthesis[:100]}", "api_error")
        synthesis = None

    # Generate final report with synthesis
    final_report = generate_report(
        query=query,
        wayback_res=wayback_res,
        codex_src_res=codex_src_res,
        perp_res=perp_res,
        readarr_res=readarr_res,
        discord_res=discord_res,
        github_res=github_res,
        github_details=github_details,
        github_deep=github_deep,
        target_repo=target_repo,
        deep_code_res=deep_code_res,
        brave_res=brave_res,
        brave_deep=brave_deep,
        arxiv_res=arxiv_res,
        arxiv_details=arxiv_details,
        arxiv_deep=arxiv_deep,
        youtube_res=youtube_res,
        youtube_transcripts=youtube_transcripts,
        synthesis=synthesis,
    )

    # Print the report
    # When piped (non-TTY), output raw markdown for machine parsing.
    # Interactive TTY gets Rich-rendered markdown with colors/formatting.
    if console.is_terminal:
        console.print(Markdown(final_report))
    else:
        print(final_report)


@app.command()
def resources(
    category: Optional[str] = typer.Option(None, "--category", "-c", help="Filter by category (security, default)"),
    tags: Optional[str] = typer.Option(None, "--tags", "-t", help="Filter by tags (comma-separated)"),
    search_query: Optional[str] = typer.Option(None, "--search", "-s", help="Search resources"),
    output_json: bool = typer.Option(False, "--json", help="Output as JSON"),
    markdown: bool = typer.Option(False, "--markdown", help="Output as Markdown table"),
):
    """List and search available research resources."""
    if not REGISTRY_AVAILABLE:
        console.print("[red]Resource registry not available. Check resources/ directory.[/red]")
        raise typer.Exit(1)

    registry = get_registry()

    # Build filter chain
    results = registry.all()

    if category:
        results = [r for r in results if r.category == category]

    if tags:
        tag_list = [t.strip() for t in tags.split(",")]
        results = [r for r in results if r.matches_tags(tag_list)]

    if search_query:
        results = [r for r in results if r.matches_search(search_query)]

    # Output
    if output_json:
        output = [
            {
                "name": r.name,
                "url": r.url,
                "api_url": r.api_url,
                "type": r.type,
                "tags": r.tags,
                "category": r.category,
                "auth_required": r.auth_required,
                "description": r.description,
            }
            for r in results
        ]
        print(json.dumps(output, indent=2))
    elif markdown:
        print(registry.to_markdown_table(results))
    else:
        console.print(f"[bold]Found {len(results)} resources:[/bold]\n")
        for r in results:
            auth_badge = "[yellow]AUTH[/yellow]" if r.auth_required else "[green]FREE[/green]"
            console.print(f"  [{r.category}] [bold]{r.name}[/bold] {auth_badge}")
            console.print(f"    [dim]{r.url}[/dim]")
            console.print(f"    Tags: [cyan]{', '.join(r.tags[:5])}[/cyan]")
            console.print(f"    {r.description}")
            console.print()


@app.command()
def presets(
    output_json: bool = typer.Option(False, "--json", help="Output as JSON"),
):
    """List available research presets for agents."""
    if not REGISTRY_AVAILABLE:
        console.print("[red]Resource registry not available.[/red]")
        raise typer.Exit(1)

    registry = get_registry()
    preset_list = registry.list_presets()

    if output_json:
        print(json.dumps(preset_list, indent=2))
    else:
        console.print("[bold]Available Presets[/bold]\n")
        console.print("Pick ONE preset that matches your research goal:\n")

        for p in preset_list:
            api_badge = f"[green]{len(p['api_resources'])} APIs[/green]" if p['api_resources'] else ""
            sites_badge = f"[cyan]{p['brave_sites_count']} sites[/cyan]"

            console.print(f"  [bold]{p['name']}[/bold] {sites_badge} {api_badge}")
            console.print(f"    {p['description']}")
            console.print(f"    [dim]Use when: {p['use_when'][0] if p['use_when'] else 'General'}[/dim]")
            console.print()

        console.print("[dim]Usage: dogpile search 'query' --preset red_team[/dim]")
        console.print("[dim]       dogpile search 'query' --auto-preset[/dim]")


@app.command()
def resource_stats():
    """Show statistics about available resources."""
    if not REGISTRY_AVAILABLE:
        console.print("[red]Resource registry not available.[/red]")
        raise typer.Exit(1)

    registry = get_registry()
    stats = registry.stats()

    console.print("[bold]Resource Registry Statistics[/bold]\n")
    console.print(f"  Total resources: [cyan]{stats['total_resources']}[/cyan]")
    console.print(f"  Unique tags: [cyan]{stats['unique_tags']}[/cyan]")
    console.print(f"  With API: [cyan]{stats['with_api']}[/cyan]")
    console.print(f"  Free: [green]{stats['free']}[/green]")
    console.print(f"  Auth required: [yellow]{stats['auth_required']}[/yellow]")
    console.print("\n  [bold]Categories:[/bold]")
    for cat, count in stats["categories"].items():
        console.print(f"    {cat}: {count}")


@app.command()
def errors(
    output_json: bool = typer.Option(False, "--json", help="Output as JSON"),
    clear: bool = typer.Option(False, "--clear", help="Clear error log after display"),
):
    """Show error summary and rate limit status for debugging."""
    from dogpile.error_tracking import get_error_summary, get_tracker
    from pathlib import Path

    summary = get_error_summary()

    if output_json:
        print(json.dumps(summary, indent=2))
    else:
        console.print("[bold]Dogpile Error Summary[/bold]\n")

        # Current/last session
        session = summary.get("current_session")
        if session:
            console.print(f"[bold cyan]Last Session:[/bold cyan] {session.get('session_id', 'unknown')}")
            console.print(f"  Query: {session.get('query', 'N/A')}")
            console.print(f"  Status: {session.get('status', 'unknown')}")
            if session.get("succeeded"):
                console.print(f"  [green]Succeeded:[/green] {', '.join(session['succeeded'])}")
            if session.get("failed"):
                console.print(f"  [red]Failed:[/red] {', '.join(session['failed'])}")
            if session.get("rate_limits_hit"):
                console.print(f"  [yellow]Rate limits:[/yellow] {session['rate_limits_hit']}")
            console.print(f"  Error count: {session.get('error_count', 0)}")
            console.print()

        # Rate limits by provider
        rate_limits = summary.get("rate_limits", {})
        if rate_limits:
            console.print("[bold yellow]Rate Limit Status:[/bold yellow]")
            for provider, state in rate_limits.items():
                hits = state.get("total_hits", 0)
                backoff = state.get("backoff_multiplier", 1.0)
                last_hit = state.get("last_hit", "never")
                status = "[red]ACTIVE[/red]" if backoff > 1.5 else "[green]OK[/green]"
                console.print(f"  {provider}: {hits} hits, backoff x{backoff:.1f} {status}")
                if last_hit != "never":
                    console.print(f"    Last hit: {last_hit}")
            console.print()

        # Recent errors
        recent = summary.get("recent_errors", [])
        if recent:
            console.print(f"[bold red]Recent Errors ({len(recent)}):[/bold red]")
            for err in recent[-5:]:  # Last 5
                console.print(f"  [{err.get('provider', '?')}] {err.get('error_type', 'unknown')}: {err.get('message', '')[:60]}")
            console.print()

        # Total stats
        console.print(f"[dim]Total errors logged: {summary.get('total_errors', 0)}[/dim]")

        # Log file locations
        tracker = get_tracker()
        console.print(f"\n[dim]Error log: {tracker.error_log}[/dim]")
        console.print(f"[dim]Human log: {tracker.human_log}[/dim]")

    if clear:
        # Clear error logs
        tracker = get_tracker()
        try:
            tracker.error_log.unlink(missing_ok=True)
            tracker.human_log.unlink(missing_ok=True)
            Path(tracker.log_dir / "rate_limit_state.json").unlink(missing_ok=True)
            console.print("[green]Error logs cleared.[/green]")
        except Exception as e:
            console.print(f"[red]Failed to clear logs: {e}[/red]")


@app.command()
def version():
    """Show version."""
    console.print(f"Dogpile v{VERSION} (Modular)")


if __name__ == "__main__":
    app()
