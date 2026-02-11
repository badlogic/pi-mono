#!/usr/bin/env python3
"""Wayback Machine integration for Dogpile.

Checks Internet Archive's Wayback Machine for archived snapshots of URLs.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Dict, Any

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.utils import log_status, with_semaphore, parse_rate_limit_headers


@with_semaphore("wayback")
def search_wayback(query: str) -> Dict[str, Any]:
    """Check Wayback Machine for snapshots if query is a URL.

    Args:
        query: Search query (only checked if starts with http:// or https://)

    Returns:
        Dict with snapshot info:
        - available: True if snapshot exists
        - url: Wayback Machine URL
        - timestamp: Snapshot timestamp
        Or empty dict if not a URL or no snapshot found
    """
    # Simple URL heuristic
    if not (query.startswith("http://") or query.startswith("https://")):
        return {}

    log_status(f"Checking Wayback Machine for {query}...", provider="wayback", status="RUNNING")
    api_url = f"http://archive.org/wayback/available?url={query}"

    try:
        with urllib.request.urlopen(api_url, timeout=10) as resp:
            # Check rate limit headers
            headers = dict(resp.headers)
            wait_time = parse_rate_limit_headers(headers, "wayback")
            if wait_time:
                time.sleep(min(wait_time, 30))  # Cap at 30s

            data = json.loads(resp.read().decode())
            # Format: {"archived_snapshots": {"closest": {"available": true, "url": "...", ...}}}
            snapshots = data.get("archived_snapshots", {})
            closest = snapshots.get("closest", {})

            if closest.get("available"):
                log_status("Wayback Machine snapshot found.", provider="wayback", status="DONE")
                return {
                    "available": True,
                    "url": closest.get("url"),
                    "timestamp": closest.get("timestamp")
                }
            log_status("No Wayback Machine snapshot available.", provider="wayback", status="DONE")

    except Exception as e:
        log_status(f"Wayback Machine error: {e}", provider="wayback", status="ERROR")
        return {"error": str(e)}

    return {}
