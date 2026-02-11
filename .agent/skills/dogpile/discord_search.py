#!/usr/bin/env python3
"""
Discord Search Integration for Dogpile

Uses the Horus bot (clawdbot) to search Discord servers.
Requires clawdbot to be installed and configured with bot token.

Usage:
    from discord_search import search_discord, get_configured_guilds

    results = search_discord("CVE-2024-1234", guild_ids=["1294710677658927134"])
"""

import json
import subprocess
from pathlib import Path
from typing import Any

# Path to clawdbot
CLAWDBOT_DIR = Path("/home/graham/workspace/experiments/clawdbot")

# Pre-configured security Discord servers (guild IDs)
# Add guild IDs here after joining with the Horus bot
SECURITY_GUILDS: dict[str, str] = {
    # "bhis": "GUILD_ID_HERE",  # Black Hills InfoSec
    # "trustedsec": "GUILD_ID_HERE",  # TrustedSec
    # "redteamvillage": "GUILD_ID_HERE",  # Red Team Village
    # "htb": "GUILD_ID_HERE",  # Hack The Box
    # "offsec": "GUILD_ID_HERE",  # OffSec
}


def search_discord(
    query: str,
    guild_ids: list[str] | None = None,
    channel_ids: list[str] | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """
    Search Discord messages using the Horus bot.

    Args:
        query: Search query
        guild_ids: List of guild IDs to search (defaults to all configured)
        channel_ids: Optional channel ID filter
        limit: Max results per guild (max 25 per Discord API)

    Returns:
        Dict with results per guild and any errors
    """
    if not CLAWDBOT_DIR.exists():
        return {"error": "clawdbot not found at expected path", "results": []}

    # Use configured guilds if none specified
    if not guild_ids:
        guild_ids = list(SECURITY_GUILDS.values())

    if not guild_ids:
        return {
            "error": "No Discord guilds configured. Add guild IDs to SECURITY_GUILDS.",
            "results": [],
        }

    all_results = []
    errors = []

    for guild_id in guild_ids:
        if not guild_id:
            continue

        cmd = [
            "npx", "tsx", "src/entry.ts",
            "message", "search",
            "--guild-id", guild_id,
            "--query", query,
            "--limit", str(min(limit, 25)),
            "--json",
        ]

        if channel_ids:
            for cid in channel_ids:
                cmd.extend(["--channel-id", cid])

        try:
            result = subprocess.run(
                cmd,
                cwd=CLAWDBOT_DIR,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode == 0:
                try:
                    data = json.loads(result.stdout)
                    messages = data.get("messages", [])
                    for msg in messages:
                        msg["guild_id"] = guild_id
                        msg["guild_name"] = _get_guild_name(guild_id)
                    all_results.extend(messages)
                except json.JSONDecodeError:
                    errors.append(f"Guild {guild_id}: Invalid JSON response")
            else:
                errors.append(f"Guild {guild_id}: {result.stderr[:200]}")

        except subprocess.TimeoutExpired:
            errors.append(f"Guild {guild_id}: Search timed out")
        except Exception as e:
            errors.append(f"Guild {guild_id}: {str(e)}")

    return {
        "results": all_results,
        "count": len(all_results),
        "guilds_searched": len(guild_ids),
        "errors": errors if errors else None,
    }


def _get_guild_name(guild_id: str) -> str:
    """Get friendly name for a guild ID."""
    for name, gid in SECURITY_GUILDS.items():
        if gid == guild_id:
            return name
    return f"Guild {guild_id[:8]}..."


def get_configured_guilds() -> dict[str, str]:
    """Get configured Discord guilds."""
    return SECURITY_GUILDS.copy()


def format_discord_results(results: dict[str, Any]) -> str:
    """Format Discord search results as markdown."""
    if results.get("error"):
        return f"> Discord Error: {results['error']}"

    messages = results.get("results", [])
    if not messages:
        return "No Discord messages found."

    lines = []
    for msg in messages[:10]:  # Limit display
        author = msg.get("author", {}).get("username", "Unknown")
        content = msg.get("content", "")[:200]
        guild = msg.get("guild_name", "Unknown")
        timestamp = msg.get("timestamp", "")[:10]
        msg_id = msg.get("id", "")
        channel_id = msg.get("channel_id", "")
        guild_id = msg.get("guild_id", "")

        # Discord message link
        link = f"https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}"

        lines.append(f"- **[{guild}]** @{author} ({timestamp})")
        lines.append(f"  > {content}")
        lines.append(f"  [Jump to message]({link})")
        lines.append("")

    if results.get("errors"):
        lines.append(f"\n> Errors: {', '.join(results['errors'])}")

    return "\n".join(lines)


# CLI interface
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python discord_search.py <query> [guild_id]")
        print("\nConfigured guilds:")
        for name, gid in SECURITY_GUILDS.items():
            print(f"  {name}: {gid}")
        sys.exit(1)

    query = sys.argv[1]
    guild_ids = [sys.argv[2]] if len(sys.argv) > 2 else None

    print(f"Searching Discord for: {query}")
    results = search_discord(query, guild_ids)
    print(format_discord_results(results))
