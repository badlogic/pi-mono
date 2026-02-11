#!/usr/bin/env python3
"""GitHub search integration for Dogpile.

Provides core GitHub search functions:
- Basic repo/issues search
- Code search within repos
- Symbol search (function/class definitions)
- Path-filtered search
- File content fetching

For deep search and Stage 2 orchestration, see github_deep.py.

Reference: https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax
"""
import base64
import json
import re
import shutil
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


@create_retry_decorator("github")
@with_semaphore("github")
def search_github(query: str) -> Dict[str, Any]:
    """Search GitHub Repos and Issues with rate limiting protection.

    GitHub has strict secondary rate limits. Uses semaphore to limit concurrency
    and checks for rate limit errors to back off appropriately.

    Args:
        query: Search query

    Returns:
        Dict with repos and issues lists, or errors
    """
    log_status(f"Starting GitHub Search for '{query}'...", provider="github", status="RUNNING")

    if not shutil.which("gh"):
        return {"error": "GitHub CLI (gh) not installed"}

    repos_cmd = ["gh", "search", "repos", query, "--limit", "5", "--json", "fullName,html_url,description,stargazersCount"]
    issues_cmd = ["gh", "search", "issues", query, "--limit", "5", "--json", "title,html_url,state,repository"]

    repos_out = run_command(repos_cmd)

    # Check for rate limit in repo search
    if "rate limit" in repos_out.lower() or "secondary rate limit" in repos_out.lower():
        log_status("GitHub rate limited, backing off 60s...", provider="github", status="RATE_LIMITED")
        time.sleep(60)  # GitHub recommends waiting until reset, use 60s as safe default
        repos_out = run_command(repos_cmd)  # Retry once

    issues_out = run_command(issues_cmd)
    log_status("GitHub Search finished.", provider="github", status="DONE")

    results = {}
    try:
        if not repos_out.startswith("Error:"):
            results["repos"] = json.loads(repos_out)
        else:
            results["repos_error"] = repos_out
    except json.JSONDecodeError:
        results["repos_error"] = "Invalid JSON"

    try:
        if not issues_out.startswith("Error:"):
            results["issues"] = json.loads(issues_out)
        else:
            results["issues_error"] = issues_out
    except json.JSONDecodeError:
        results["issues_error"] = "Invalid JSON"

    return results


@create_retry_decorator("github")
@with_semaphore("github")
def search_github_via_skill(query: str, deep: bool = True, treesitter: bool = False, taxonomy: bool = False) -> Dict[str, Any]:
    """Search GitHub using the /github-search skill with rate limiting protection.

    This provides multi-strategy search with:
    - Repository analysis (README, metadata, languages)
    - Symbol search (function/class definitions)
    - Path-filtered search
    - Optional treesitter parsing
    - Optional taxonomy classification

    The skill handles its own internal rate limiting, but we wrap with semaphore
    to prevent concurrent skill invocations from overwhelming GitHub.

    Args:
        query: Search query
        deep: Enable deep analysis of top repo
        treesitter: Parse files with treesitter for symbols
        taxonomy: Classify repos with taxonomy

    Returns:
        Dict with repos, issues, analysis, code_search
    """
    log_status(f"Starting GitHub Search (via skill) for '{query}'...", provider="github", status="RUNNING")

    github_skill = SKILLS_DIR / "github-search"
    if not github_skill.exists():
        log_status("github-search skill not found, falling back to direct search", provider="github", status="FALLBACK")
        return search_github(query)

    cmd = ["bash", "run.sh", "search", query, "--limit", "5", "--json"]
    if deep:
        cmd.append("--deep")
    if treesitter:
        cmd.append("--treesitter")
    if taxonomy:
        cmd.append("--taxonomy")

    output = run_command(cmd, cwd=github_skill)

    if output.startswith("Error:"):
        # Check for rate limit errors
        if "rate limit" in output.lower() or "secondary rate limit" in output.lower():
            log_status("GitHub rate limited via skill, backing off 60s...", provider="github", status="RATE_LIMITED")
            time.sleep(60)
            output = run_command(cmd, cwd=github_skill)  # Retry once

        if output.startswith("Error:"):
            log_status(f"GitHub skill error: {output[:50]}", provider="github", status="ERROR")
            return {"error": output}

    try:
        result = json.loads(output)
        log_status("GitHub Search (via skill) finished.", provider="github", status="DONE")
        return result
    except json.JSONDecodeError:
        return {"error": "Invalid JSON from github-search skill", "raw": output[:200]}


def search_github_code(repo: str, query: str, language: str = None) -> List[Dict[str, Any]]:
    """Search for code within a specific repository.

    Args:
        repo: Repository in owner/repo format
        query: Search query
        language: Optional language filter

    Returns:
        List of code search results
    """
    if not shutil.which("gh"):
        return []

    # gh search code --repo owner/repo "query"
    cmd = ["gh", "search", "code", "--repo", repo, query, "--limit", "5", "--json", "path,repository,url,textMatches"]
    if language:
        cmd.extend(["--language", language])
    output = run_command(cmd)

    try:
        if output.startswith("Error:"):
            # Code search might fail if not authenticated or other issues, just return empty
            return []
        return json.loads(output)
    except Exception:
        return []


def search_github_symbols(repo: str, symbols: List[str], language: str = None) -> List[Dict[str, Any]]:
    """Search for symbol definitions (functions, classes) using GitHub's symbol: qualifier.

    Uses tree-sitter parsing to find actual definitions, not just text matches.
    Reference: https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax

    Args:
        repo: Repository in owner/repo format
        symbols: List of symbol names to search
        language: Optional language filter

    Returns:
        List of symbol match results
    """
    if not shutil.which("gh"):
        return []

    results = []
    for symbol in symbols[:3]:  # Limit to 3 symbols to avoid rate limits
        # Use symbol: qualifier for definition search
        sym_query = f"symbol:{symbol}"
        cmd = ["gh", "search", "code", "--repo", repo, sym_query, "--limit", "3", "--json", "path,repository,url,textMatches"]
        if language:
            cmd.extend(["--language", language])

        output = run_command(cmd)
        try:
            if not output.startswith("Error:"):
                matches = json.loads(output)
                for m in matches:
                    m["symbol"] = symbol
                    m["search_type"] = "definition"
                results.extend(matches)
        except Exception:
            continue

    return results


def search_github_by_path(repo: str, query: str, paths: List[str], language: str = None) -> List[Dict[str, Any]]:
    """Search for code in specific directories (src/, lib/, core/, etc.).

    Uses path: qualifier to narrow search to implementation directories.

    Args:
        repo: Repository in owner/repo format
        query: Search query
        paths: List of paths to search in
        language: Optional language filter

    Returns:
        List of path-filtered search results
    """
    if not shutil.which("gh"):
        return []

    results = []
    for path in paths[:3]:  # Limit paths
        # Combine query with path filter
        full_query = f"{query} path:{path}"
        cmd = ["gh", "search", "code", "--repo", repo, full_query, "--limit", "3", "--json", "path,repository,url,textMatches"]
        if language:
            cmd.extend(["--language", language])

        output = run_command(cmd)
        try:
            if not output.startswith("Error:"):
                matches = json.loads(output)
                for m in matches:
                    m["searched_path"] = path
                results.extend(matches)
        except Exception:
            continue

    return results


def fetch_file_content(repo: str, file_path: str) -> Dict[str, Any]:
    """Fetch full file content from a repository.

    Uses GitHub API: GET /repos/{owner}/{repo}/contents/{path}
    Returns base64-decoded content.

    Args:
        repo: Repository in owner/repo format
        file_path: Path to file within repo

    Returns:
        Dict with path, content, size, truncated flag, or error
    """
    if not shutil.which("gh"):
        return {"error": "gh CLI not installed"}

    cmd = ["gh", "api", f"repos/{repo}/contents/{file_path}", "--jq", ".content,.size,.sha"]
    output = run_command(cmd)

    if output.startswith("Error:"):
        return {"error": output, "path": file_path}

    try:
        lines = output.strip().split('\n')
        if len(lines) >= 2:
            content_b64 = lines[0]
            size = int(lines[1]) if len(lines) > 1 else 0

            # Decode content
            content = base64.b64decode(content_b64).decode('utf-8', errors='ignore')

            return {
                "path": file_path,
                "content": content[:5000],  # Limit to 5k chars
                "size": size,
                "truncated": len(content) > 5000
            }
    except Exception as e:
        return {"error": str(e), "path": file_path}

    return {"error": "Failed to parse response", "path": file_path}


def extract_search_terms(query: str) -> Dict[str, List[str]]:
    """Extract potential symbols, keywords, and paths from a search query.

    Args:
        query: Search query

    Returns:
        Dict with:
        - symbols: Potential function/class names (CamelCase, snake_case)
        - keywords: General search terms
        - paths: Suggested directories to search
    """
    result = {
        "symbols": [],
        "keywords": [],
        "paths": ["src/", "lib/", "core/", "pkg/"]
    }

    words = query.split()
    for word in words:
        # CamelCase or PascalCase -> likely a class/type name
        if re.match(r'^[A-Z][a-zA-Z0-9]*$', word):
            result["symbols"].append(word)
        # snake_case with underscores -> likely a function name
        elif re.match(r'^[a-z][a-z0-9_]+$', word) and '_' in word:
            result["symbols"].append(word)
        # camelCase -> likely a function/method name
        elif re.match(r'^[a-z][a-zA-Z0-9]+$', word) and any(c.isupper() for c in word):
            result["symbols"].append(word)
        else:
            result["keywords"].append(word)

    return result
