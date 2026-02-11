#!/usr/bin/env python3
"""Perplexity AI integration for Dogpile.

Provides deep research via Perplexity API with rate limiting protection.
"""
import json
import sys
import time
from pathlib import Path
from typing import Dict, Any

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import SKILLS_DIR
from dogpile.utils import log_status, with_semaphore, run_command, create_retry_decorator


@create_retry_decorator("perplexity")
@with_semaphore("perplexity")
def search_perplexity(query: str) -> Dict[str, Any]:
    """Search Perplexity with rate limiting protection.

    Args:
        query: Research query

    Returns:
        Dict with answer, citations, or error
    """
    log_status(f"Starting Perplexity Research for '{query}'...", provider="perplexity", status="RUNNING")
    script = SKILLS_DIR / "perplexity" / "perplexity.py"
    cmd = [sys.executable, str(script), "research", query, "--model", "huge", "--json"]

    try:
        output = run_command(cmd)
        log_status("Perplexity finished.", provider="perplexity", status="DONE")

        if output.startswith("Error:"):
            # Check for rate limit errors
            if "429" in output or "rate limit" in output.lower():
                log_status("Perplexity rate limited, backing off...", provider="perplexity", status="RATE_LIMITED")
                time.sleep(10)  # Perplexity is paid, be conservative
            return {"error": output}

        return json.loads(output)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON output from Perplexity", "raw": output}
