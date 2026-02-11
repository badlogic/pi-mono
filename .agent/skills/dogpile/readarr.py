#!/usr/bin/env python3
"""Readarr search integration for Dogpile.

Searches Usenet/Books via Readarr Ops nzb-search.
"""
import json
import sys
from pathlib import Path
from typing import Dict, Any, List

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import SKILLS_DIR
from dogpile.utils import log_status, with_semaphore, run_command


@with_semaphore("readarr")
def search_readarr(query: str) -> List[Dict[str, Any]]:
    """Search Usenet/Books via Readarr Ops nzb-search.

    Args:
        query: Search query

    Returns:
        List of search results with title, category, size
    """
    log_status(f"Starting Readarr Search for '{query}'...", provider="readarr", status="RUNNING")

    # Locate ingest-book skill (provides Readarr/Usenet search)
    ingest_book_dir = SKILLS_DIR / "ingest-book"

    if not ingest_book_dir.exists():
        log_status("ingest-book skill not found", provider="readarr", status="SKIPPED")
        return []

    cmd = ["bash", "run.sh", "nzb-search", query, "--json"]
    output = run_command(cmd, cwd=ingest_book_dir)

    try:
        if output.startswith("Error:"):
            return [{"error": output}]

        # Parse JSON output
        results = json.loads(output)
        if isinstance(results, dict) and "error" in results:
            return [{"error": results["error"]}]

        log_status("Readarr Search finished.", provider="readarr", status="DONE")
        return results if isinstance(results, list) else []

    except Exception as e:
        log_status(f"Readarr parse error: {e}", provider="readarr", status="ERROR")
        return [{"error": str(e)}]
