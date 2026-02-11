#!/usr/bin/env python3
"""Formatters for Dogpile report sections.

Contains format functions for smaller providers:
- Wayback Machine
- Codex Knowledge
- Perplexity
- Readarr
- Discord
"""
from typing import Dict, Any, List


def format_wayback_section(wayback_res: Dict[str, Any]) -> List[str]:
    """Format Wayback Machine results."""
    lines = []
    if wayback_res.get("available"):
        lines.append(f"> **Wayback Machine**: [Snapshot available]({wayback_res['url']}) (Timestamp: {wayback_res.get('timestamp')})")
        lines.append("")
    elif "error" in wayback_res:
        lines.append(f"> Wayback Error: {wayback_res['error']}")
        lines.append("")
    return lines


def format_codex_section(codex_res: str) -> List[str]:
    """Format Codex technical overview."""
    lines = ["## Codex Technical Overview"]
    if not codex_res.startswith("Error:"):
        lines.append(codex_res)
    else:
        lines.append(f"> Error: {codex_res}")
    lines.append("")
    return lines


def format_perplexity_section(perp_res: Dict[str, Any]) -> List[str]:
    """Format Perplexity AI research results."""
    lines = ["## AI Research (Perplexity)"]
    if "error" in perp_res:
        lines.append(f"> Error: {perp_res['error']}")
    else:
        lines.append(perp_res.get("answer", "No answer."))
        if perp_res.get("citations"):
            lines.append("\n**Citations:**")
            for cite in perp_res.get("citations", []):
                lines.append(f"- {cite}")
    lines.append("")
    return lines


def format_readarr_section(readarr_res: List[Dict[str, Any]]) -> List[str]:
    """Format Readarr search results."""
    lines = ["## Books & Usenet (Readarr)"]
    if readarr_res and isinstance(readarr_res, list) and len(readarr_res) > 0:
        if "error" in readarr_res[0]:
            lines.append(f"> Error: {readarr_res[0]['error']}")
        else:
            for item in readarr_res[:5]:
                title = item.get("title", "Unknown")
                cat = item.get("category", "")
                size = int(item.get("size", "0")) / (1024 * 1024)
                lines.append(f"- **{title}** ({cat}) - {size:.1f} MB")
    else:
        lines.append("No books or Usenet results found.")
    lines.append("")
    return lines


def format_discord_section(discord_res: Dict[str, Any]) -> List[str]:
    """Format Discord search results."""
    lines = ["## Discord (Security Servers)"]
    if discord_res.get("skipped"):
        lines.append(f"> Skipped: {discord_res.get('reason', 'Not configured')}")
    elif discord_res.get("error"):
        lines.append(f"> Error: {discord_res['error']}")
    elif discord_res.get("results"):
        messages = discord_res.get("results", [])
        guilds_searched = discord_res.get("guilds_searched", 0)
        lines.append(f"*Searched {guilds_searched} security servers*\n")

        for msg in messages[:10]:
            author = msg.get("author", {}).get("username", "Unknown")
            content = msg.get("content", "")[:200]
            guild = msg.get("guild_name", "Unknown")
            timestamp = msg.get("timestamp", "")[:10]
            msg_id = msg.get("id", "")
            channel_id = msg.get("channel_id", "")
            guild_id = msg.get("guild_id", "")
            link = f"https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}"

            lines.append(f"- **[{guild}]** @{author} ({timestamp})")
            lines.append(f"  > {content}")
            lines.append(f"  [Jump to message]({link})")
            lines.append("")

        if discord_res.get("errors"):
            lines.append(f"> Some servers had errors: {', '.join(discord_res['errors'][:3])}")
    else:
        lines.append("No Discord messages found. Configure servers with `ops-discord setup`.")
    lines.append("")
    return lines
