#!/usr/bin/env python3
"""Brave Search integration for Dogpile.

Provides web search via Brave Search API with rate limiting protection.
"""
import json
import sys
import time
from pathlib import Path
from typing import Dict, Any, List

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import SKILLS_DIR
from dogpile.utils import log_status, with_semaphore, run_command, create_retry_decorator


@create_retry_decorator("brave")
@with_semaphore("brave")
def search_brave(query: str) -> Dict[str, Any]:
    """Search Brave Web with rate limiting protection.

    Args:
        query: Search query

    Returns:
        Dict with search results or error
    """
    log_status(f"Starting Brave Search for '{query}'...", provider="brave", status="RUNNING")
    script = SKILLS_DIR / "brave-search" / "brave_search.py"
    cmd = [sys.executable, str(script), "web", query, "--count", "5", "--json"]

    try:
        output = run_command(cmd)
        log_status("Brave Search finished.", provider="brave", status="DONE")

        if output.startswith("Error:"):
            # Check for rate limit errors
            if "429" in output or "rate limit" in output.lower():
                log_status("Brave rate limited, backing off...", provider="brave", status="RATE_LIMITED")
                time.sleep(5)  # Brief backoff for subprocess errors
            return {"error": output}

        return json.loads(output)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON output from Brave", "raw": output}


def deep_extract_url(url: str, title: str = "") -> Dict[str, Any]:
    """Deep extraction for web URLs via /fetcher + /extractor.

    Fetches full page content for relevant Brave search results.

    Args:
        url: URL to fetch and extract
        title: Optional title for the result

    Returns:
        Dict with extracted content or error
    """
    log_status(f"Deep extracting URL: {url[:50]}...", provider="brave", status="EXTRACTING")

    fetcher_dir = SKILLS_DIR / "fetcher"
    if not fetcher_dir.exists():
        return {"error": "fetcher skill not found", "url": url}

    try:
        fetch_cmd = ["bash", "run.sh", url]
        fetch_output = run_command(fetch_cmd, cwd=fetcher_dir)

        if fetch_output.startswith("Error:"):
            return {"error": fetch_output, "url": url}

        log_status("URL extraction finished.", provider="brave", status="DONE")
        return {
            "url": url,
            "title": title,
            "content": fetch_output[:8000],  # Limit to 8k chars
            "extracted": True,
        }

    except Exception as e:
        return {"error": str(e), "url": url}


def run_stage2_brave(brave_res: Dict[str, Any], query: str, search_codex_fn) -> List[Dict]:
    """Stage 2: Brave URL deep extraction for most relevant result.

    Args:
        brave_res: Stage 1 Brave search results
        query: Original search query
        search_codex_fn: Function to call Codex for evaluation

    Returns:
        List of deep extracted content
    """
    import re as regex

    brave_deep = []

    if brave_res and isinstance(brave_res, dict) and "web" in brave_res:
        web_results = brave_res.get("web", {}).get("results", [])[:3]

        if web_results:
            urls_summary = "\n".join([
                f"[{i+1}] {r.get('title', 'Unknown')}: {r.get('description', '')[:200]}"
                for i, r in enumerate(web_results)
            ])
            eval_prompt = f"""Given these web results for query "{query}", which ONE is MOST relevant for technical/documentation purposes?
{urls_summary}

Return just the number (1, 2, or 3) of the most relevant result, or 0 if none are worth deep extraction."""

            best_url_idx = -1
            eval_result = search_codex_fn(eval_prompt)

            try:
                match = regex.search(r'(\d)', eval_result)
                if match:
                    best_url_idx = int(match.group(1)) - 1
            except Exception:
                pass

            if 0 <= best_url_idx < len(web_results):
                best_result = web_results[best_url_idx]
                log_status(
                    f"Brave Stage 2: Deep extracting '{best_result.get('title', 'Unknown')[:50]}'...",
                    provider="brave",
                    status="EXTRACTING"
                )
                deep_result = deep_extract_url(
                    best_result.get("url", ""),
                    best_result.get("title", "")
                )
                if deep_result.get("extracted"):
                    brave_deep.append(deep_result)
                    log_status("Brave Stage 2 deep extraction finished.", provider="brave", status="DONE")

    return brave_deep
