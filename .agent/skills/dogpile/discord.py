#!/usr/bin/env python3
"""Discord search integration for Dogpile.

Searches Discord messages in configured security servers.
Uses the discord_search module which wraps clawdbot for Discord API access.
"""
import sys
from pathlib import Path
from typing import Dict, Any

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import DISCORD_AVAILABLE, _search_discord_impl
from dogpile.utils import log_status, with_semaphore


@with_semaphore("discord")
def search_discord_messages(query: str, preset: str = "security") -> Dict[str, Any]:
    """Search Discord messages in configured security servers.

    Uses the discord_search module which wraps clawdbot for Discord API access.
    Only available if Discord guilds are configured.

    Args:
        query: Search query
        preset: Search preset (default: security)

    Returns:
        Dict with results, count, guilds_searched, or error/skipped status
    """
    if not DISCORD_AVAILABLE:
        log_status("Discord search not available (module not found)", provider="discord", status="SKIPPED")
        return {"skipped": True, "reason": "discord_search module not available"}

    log_status(f"Starting Discord Search for '{query}'...", provider="discord", status="RUNNING")

    try:
        # Use the discord_search module - it reads guild IDs from its own config
        results = _search_discord_impl(query, guild_ids=None, limit=10)

        if results.get("error"):
            log_status(f"Discord error: {results['error']}", provider="discord", status="ERROR")
            return results

        msg_count = results.get("count", 0)
        guild_count = results.get("guilds_searched", 0)
        log_status(f"Discord Search finished: {msg_count} messages from {guild_count} guilds", provider="discord", status="DONE")
        return results

    except Exception as e:
        log_status(f"Discord search error: {e}", provider="discord", status="ERROR")
        return {"error": str(e), "results": []}
