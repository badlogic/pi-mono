#!/usr/bin/env python3
"""Result synthesis and report generation for Dogpile.

Generates markdown reports from aggregated search results.
"""
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

# Import smaller formatters
from dogpile.formatters import (
    format_wayback_section,
    format_codex_section,
    format_perplexity_section,
    format_readarr_section,
    format_discord_section,
)


def format_github_section(
    github_res: Dict[str, Any],
    github_details: List[Dict],
    github_deep: Dict,
    target_repo: Optional[str],
    deep_code_res: List
) -> List[str]:
    """Format GitHub search results."""
    lines = ["## GitHub"]

    if "error" in github_res:
        lines.append(f"> Error: {github_res['error']}")
    else:
        lines.append("### Repositories")
        repos = github_res.get("repos", [])

        if not repos:
            lines.append("No repositories found.")
        elif isinstance(repos, list):
            for repo in repos:
                desc = repo.get("description", "No description") or "No description"
                star = f"* {repo.get('stargazersCount', 0)}"
                is_target = repo.get("fullName") == target_repo
                prefix = "**TARGET**" if is_target else "-"
                lines.append(f"{prefix} **[{repo.get('fullName')}]({repo.get('html_url')})** ({star})")
                lines.append(f"  {desc}")

        # Stage 2: README Deep Dive for evaluated repos
        if github_details:
            lines.append("\n### Repository Deep Dive (README Analysis)")
            for detail in github_details:
                repo_name = detail.get("fullName", "Unknown")
                meta = detail.get("metadata", {})
                is_target = repo_name == target_repo
                target_marker = " **SELECTED**" if is_target else ""

                lines.append(f"\n#### [{repo_name}]({meta.get('url', '#')}){target_marker}")

                topics = meta.get("repositoryTopics", [])
                topic_names = [t.get("name", "") for t in topics] if topics else []
                lang = meta.get("primaryLanguage", {}).get("name", "Unknown")
                stars = meta.get("stargazerCount", 0)
                updated = meta.get("updatedAt", "Unknown")[:10] if meta.get("updatedAt") else "Unknown"

                lines.append(f"**Language:** {lang} | **Stars:** {stars} | **Updated:** {updated}")
                if topic_names:
                    lines.append(f"**Topics:** {', '.join(topic_names)}")

                readme = detail.get("readme", "")
                if readme:
                    readme_excerpt = readme[:500] + "..." if len(readme) > 500 else readme
                    lines.append(f"\n**README excerpt:**\n```\n{readme_excerpt}\n```")

                langs = detail.get("languages", {})
                if langs:
                    total = sum(langs.values())
                    top_langs = sorted(langs.items(), key=lambda x: x[1], reverse=True)[:5]
                    lang_pcts = [f"{l[0]}: {l[1]*100/total:.1f}%" for l in top_langs]
                    lines.append(f"**Languages:** {', '.join(lang_pcts)}")

        # Stage 3: Multi-Strategy Deep Code Search Results
        if github_deep and target_repo:
            lang = github_deep.get("language", "Unknown")
            lines.append(f"\n### Multi-Strategy Deep Search in {target_repo}")
            lines.append(f"**Primary Language:** {lang}")

            file_tree = github_deep.get("file_tree", [])
            if file_tree:
                lines.append("\n**Project Structure:**")
                lines.append("```")
                for f in file_tree[:15]:
                    lines.append(f"|-- {f}")
                if len(file_tree) > 15:
                    lines.append(f"|-- ... ({len(file_tree) - 15} more)")
                lines.append("```")

            symbol_matches = github_deep.get("symbol_matches", [])
            if symbol_matches:
                lines.append("\n#### Symbol Definitions Found")
                lines.append("*Using `symbol:` qualifier for tree-sitter parsed definitions*")
                for item in symbol_matches:
                    path = item.get("path", "unknown")
                    url = item.get("url", "#")
                    symbol = item.get("symbol", "")
                    lines.append(f"- [`{symbol}`]({url}) in `{path}`")
                    text_matches = item.get("textMatches", [])
                    for tm in text_matches[:1]:
                        fragment = tm.get("fragment", "")[:200]
                        if fragment:
                            lines.append(f"  ```\n  {fragment}\n  ```")

            code_matches = github_deep.get("code_matches", [])
            if code_matches:
                lines.append("\n#### Text Matches")
                for item in code_matches:
                    path = item.get("path", "unknown")
                    url = item.get("url", "#")
                    lines.append(f"- [`{path}`]({url})")
                    text_matches = item.get("textMatches", [])
                    for tm in text_matches[:2]:
                        fragment = tm.get("fragment", "")[:150]
                        if fragment:
                            lines.append(f"  > `{fragment}...`")

            path_matches = github_deep.get("path_matches", [])
            if path_matches:
                lines.append("\n#### Path-Filtered Matches")
                lines.append("*Searched in: src/, lib/, core/, pkg/*")
                for item in path_matches:
                    path = item.get("path", "unknown")
                    url = item.get("url", "#")
                    searched_path = item.get("searched_path", "")
                    lines.append(f"- [`{path}`]({url}) (via `{searched_path}`)")

            file_contents = github_deep.get("file_contents", [])
            if file_contents:
                lines.append("\n#### Full File Content (Key Files)")
                for fc in file_contents:
                    path = fc.get("path", "unknown")
                    content = fc.get("content", "")
                    size = fc.get("size", 0)
                    truncated = fc.get("truncated", False)
                    lines.append(f"\n**`{path}`** ({size} bytes{' - truncated' if truncated else ''})")
                    preview = content[:1500] + "\n..." if len(content) > 1500 else content
                    lines.append(f"```\n{preview}\n```")

            total = len(symbol_matches) + len(code_matches) + len(path_matches)
            if total == 0:
                lines.append("\nNo specific code matches found.")
            else:
                lines.append(f"\n**Summary:** {len(symbol_matches)} definitions, {len(code_matches)} text matches, {len(path_matches)} path matches")

        elif deep_code_res:
            lines.append(f"\n### Code Matches in {target_repo}")
            for item in deep_code_res:
                lines.append(f"- [`{item.get('path')}`]({item.get('url')})")

        lines.append("\n### Issues/Discussions")
        issues = github_res.get("issues", [])
        if not issues:
            lines.append("No issues found.")
        elif isinstance(issues, list):
            for issue in issues:
                repo_name = issue.get("repository", {}).get("nameWithOwner", "unknown")
                lines.append(f"- **{repo_name}**: [{issue.get('title')}]({issue.get('html_url')}) ({issue.get('state')})")

    lines.append("")
    return lines


def format_brave_section(brave_res: Dict[str, Any], brave_deep: List[Dict]) -> List[str]:
    """Format Brave search results."""
    lines = ["## Web Results (Brave)"]

    if "error" in brave_res:
        lines.append(f"> Error: {brave_res['error']}")
    else:
        web_results = brave_res.get("web", {}).get("results", []) or brave_res.get("results", [])
        for item in web_results[:5]:
            lines.append(f"- **[{item.get('title', 'No Title')}]({item.get('url', '#')})**")
            lines.append(f"  {item.get('description', '')}")

        if brave_deep:
            lines.append("\n### Deep Extracted Content (Stage 2)")
            for deep in brave_deep:
                if deep.get("extracted"):
                    lines.append(f"**Source:** [{deep.get('title', 'Unknown')}]({deep.get('url')})")
                    content = deep.get("content", "")
                    if len(content) > 3000:
                        content = content[:3000] + "\n\n[... truncated for brevity ...]"
                    lines.append(f"```\n{content}\n```")
                    lines.append("")
                elif deep.get("error"):
                    lines.append(f"> Extraction failed for {deep.get('url')}: {deep.get('error')}")

    lines.append("")
    return lines


def format_arxiv_section(
    arxiv_res: Dict[str, Any],
    arxiv_details: List[Dict],
    arxiv_deep: List[Dict]
) -> List[str]:
    """Format ArXiv search results."""
    lines = ["## Academic Papers (ArXiv)"]

    if arxiv_details:
        lines.append("### Deep Dive: Paper Details")
        for paper in arxiv_details:
            lines.append(f"#### [{paper.get('title')}]({paper.get('abs_url')})")
            lines.append(f"**Authors:** {', '.join(paper.get('authors', []))}")
            abstract = paper.get("abstract", "")
            if len(abstract) > 500:
                abstract = abstract[:500] + "..."
            lines.append(f"**Summary:** {abstract}")
            lines.append("")

        if arxiv_deep:
            lines.append("### Full Paper Extraction (Stage 3)")
            for deep in arxiv_deep:
                if deep.get("extracted"):
                    lines.append(f"**Paper ID:** `{deep.get('paper_id')}`")
                    full_text = deep.get("full_text", "")
                    if len(full_text) > 2000:
                        full_text = full_text[:2000] + "\n\n[... truncated for brevity ...]"
                    lines.append(f"```\n{full_text}\n```")
                    lines.append("")
                elif deep.get("error"):
                    lines.append(f"> Extraction failed for {deep.get('paper_id')}: {deep.get('error')}")
            lines.append("")

        lines.append("### Other Relevant Papers")

    if isinstance(arxiv_res, dict) and "items" in arxiv_res:
        for p in arxiv_res["items"][len(arxiv_details):len(arxiv_details)+5]:
            lines.append(f"- **[{p.get('title')}]({p.get('abs_url')})** ({p.get('published')})")
    elif isinstance(arxiv_res, str):
        lines.append(arxiv_res)

    lines.append("")
    return lines


def format_youtube_section(youtube_res: List[Dict], youtube_transcripts: List[Dict]) -> List[str]:
    """Format YouTube search results."""
    lines = ["## Videos (YouTube)"]

    if youtube_transcripts:
        lines.append("### Video Insights (Transcripts)")
        for trans in youtube_transcripts:
            lines.append(f"#### [{trans.get('title')}]({trans.get('url')})")
            text = trans.get("full_text", "")
            if len(text) > 800:
                text = text[:800] + "..."
            lines.append(f"> {text}")
            lines.append("")
        lines.append("### More Videos")

    if not youtube_res:
        lines.append("No videos found or error.")
    else:
        for video in youtube_res[len(youtube_transcripts):len(youtube_transcripts)+5]:
            if "Error" in video.get("title", ""):
                lines.append(f"> {video['title']}")
            else:
                lines.append(f"- **[{video['title']}]({video['url']})**")
                if video.get("description"):
                    lines.append(f"  _{video.get('description')}_")

    lines.append("")
    return lines


def generate_report(
    query: str,
    wayback_res: Dict[str, Any],
    codex_src_res: str,
    perp_res: Dict[str, Any],
    readarr_res: List[Dict],
    discord_res: Dict[str, Any],
    github_res: Dict[str, Any],
    github_details: List[Dict],
    github_deep: Dict,
    target_repo: Optional[str],
    deep_code_res: List,
    brave_res: Dict[str, Any],
    brave_deep: List[Dict],
    arxiv_res: Dict[str, Any],
    arxiv_details: List[Dict],
    arxiv_deep: List[Dict],
    youtube_res: List[Dict],
    youtube_transcripts: List[Dict],
    synthesis: Optional[str] = None
) -> str:
    """Generate full markdown report from all search results."""
    md_lines = [f"# Dogpile Report: {query}", ""]

    md_lines.extend(format_wayback_section(wayback_res))
    md_lines.extend(format_codex_section(codex_src_res))
    md_lines.extend(format_perplexity_section(perp_res))
    md_lines.extend(format_readarr_section(readarr_res))
    md_lines.extend(format_discord_section(discord_res))
    md_lines.extend(format_github_section(
        github_res, github_details, github_deep, target_repo, deep_code_res
    ))
    md_lines.extend(format_brave_section(brave_res, brave_deep))
    md_lines.extend(format_arxiv_section(arxiv_res, arxiv_details, arxiv_deep))
    md_lines.extend(format_youtube_section(youtube_res, youtube_transcripts))

    if synthesis and not synthesis.startswith("Error:"):
        md_lines.append("## Codex Synthesis (gpt-5.2 High Reasoning)")
        md_lines.append(synthesis)
        md_lines.append("")

    return "\n".join(md_lines)
