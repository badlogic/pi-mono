#!/usr/bin/env python3
"""GitHub deep search and Stage 2 orchestration for Dogpile.

Provides:
- fetch_repo_details: Repository metadata and README fetching
- evaluate_github_repos: Codex-based repo evaluation
- deep_search_github_repo: Multi-strategy deep code search
- extract_target_repo: Heuristic repo selection
- run_stage2_github: Stage 2 orchestration
"""
import base64
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import console
from dogpile.utils import log_status, run_command
from dogpile.github_search import (
    search_github_code,
    search_github_symbols,
    search_github_by_path,
    fetch_file_content,
    extract_search_terms,
)


def fetch_repo_details(repo: str) -> Dict[str, Any]:
    """GitHub Stage 2: Fetch repository details including README content.

    Uses gh CLI to get:
    - Repository metadata (description, topics, language, stars)
    - README.md content for deeper understanding

    Args:
        repo: Repository in owner/repo format

    Returns:
        Dict with fullName, metadata, readme, languages
    """
    import shutil
    if not shutil.which("gh"):
        return {"error": "gh CLI not installed"}

    log_status(f"Fetching details for repo {repo}...", provider="github", status="FETCHING")

    result = {
        "fullName": repo,
        "metadata": {},
        "readme": "",
        "languages": {},
    }

    # Get repo metadata
    meta_cmd = ["gh", "repo", "view", repo, "--json",
                "description,stargazerCount,forkCount,primaryLanguage,repositoryTopics,updatedAt,url"]
    meta_output = run_command(meta_cmd)

    try:
        if not meta_output.startswith("Error:"):
            result["metadata"] = json.loads(meta_output)
    except json.JSONDecodeError:
        pass

    # Get README content via API
    readme_cmd = ["gh", "api", f"repos/{repo}/readme", "--jq", ".content"]
    readme_output = run_command(readme_cmd)

    if not readme_output.startswith("Error:"):
        try:
            # README is base64 encoded
            readme_content = base64.b64decode(readme_output.strip()).decode('utf-8', errors='ignore')
            # Limit to first 3000 chars for evaluation
            result["readme"] = readme_content[:3000] if len(readme_content) > 3000 else readme_content
        except Exception:
            result["readme"] = ""

    # Get language breakdown
    lang_cmd = ["gh", "api", f"repos/{repo}/languages"]
    lang_output = run_command(lang_cmd)

    try:
        if not lang_output.startswith("Error:"):
            result["languages"] = json.loads(lang_output)
    except json.JSONDecodeError:
        pass

    log_status(f"Fetched details for {repo}.", provider="github", status="DONE")
    return result


def evaluate_github_repos(repos_details: List[Dict[str, Any]], query: str, search_codex_fn) -> int:
    """Use Codex to evaluate which repository is most relevant based on README and metadata.

    Args:
        repos_details: List of repo detail dicts from fetch_repo_details
        query: Original search query
        search_codex_fn: Function to call Codex for evaluation

    Returns:
        Index (0-based) of the most relevant repo, or -1 if none are relevant
    """
    if not repos_details:
        return -1

    # Build summary for Codex evaluation
    summaries = []
    for i, repo in enumerate(repos_details):
        meta = repo.get("metadata", {})
        topics = meta.get("repositoryTopics", [])
        topic_names = [t.get("name", "") for t in topics] if topics else []

        summary = f"""[{i+1}] **{repo.get('fullName')}**
- Description: {meta.get('description', 'No description')}
- Stars: {meta.get('stargazerCount', 0)} | Language: {meta.get('primaryLanguage', {}).get('name', 'Unknown')}
- Topics: {', '.join(topic_names) if topic_names else 'None'}
- README excerpt:
{repo.get('readme', 'No README')[:800]}
"""
        summaries.append(summary)

    eval_prompt = f"""You are evaluating GitHub repositories for relevance to this query:
"{query}"

Analyze each repository's README, description, topics, and metadata to determine which is MOST relevant.

{chr(10).join(summaries)}

Consider:
1. Does the README describe functionality matching the query?
2. Are the topics/tags relevant?
3. Is the project actively maintained (recent updates, stars)?
4. Does the language/tech stack match the query context?

Return ONLY a single number (1, 2, or 3) for the most relevant repository.
Return 0 if NONE are relevant to the query."""

    log_status("Evaluating repos with Codex...", provider="github", status="EVALUATING")
    eval_result = search_codex_fn(eval_prompt)

    try:
        match = re.search(r'(\d)', eval_result)
        if match:
            idx = int(match.group(1)) - 1
            if 0 <= idx < len(repos_details):
                return idx
    except Exception:
        pass

    return -1


def deep_search_github_repo(repo: str, query: str, repo_details: Dict[str, Any] = None) -> Dict[str, Any]:
    """GitHub Stage 3: Multi-strategy deep code search within the selected repository.

    Uses multiple search strategies:
    1. Basic text search - General keyword matching
    2. Symbol search - Function/class definitions via symbol: qualifier
    3. Path-filtered search - Search in src/, lib/, core/ directories
    4. Full file fetch - Get complete content of most relevant files

    Args:
        repo: Repository in owner/repo format
        query: Search query
        repo_details: Optional repo details for language detection

    Returns:
        Dict with repo, language, code_matches, symbol_matches, path_matches, file_contents, file_tree
    """
    log_status(f"Deep searching code in {repo}...", provider="github", status="SEARCHING")

    # Detect primary language for filtering
    language = None
    if repo_details:
        lang_info = repo_details.get("metadata", {}).get("primaryLanguage", {})
        language = lang_info.get("name") if lang_info else None

    result = {
        "repo": repo,
        "language": language,
        "code_matches": [],
        "symbol_matches": [],
        "path_matches": [],
        "file_contents": [],
        "file_tree": [],
    }

    # Extract search terms for multi-strategy search
    search_terms = extract_search_terms(query)
    log_status(f"Extracted: {len(search_terms['symbols'])} symbols, {len(search_terms['keywords'])} keywords")

    # Strategy 1: Basic text search
    log_status("Strategy 1: Basic text search...", provider="github", status="SEARCHING")
    code_results = search_github_code(repo, query, language)
    result["code_matches"] = code_results

    # Strategy 2: Symbol search for definitions (if we have potential symbols)
    if search_terms["symbols"]:
        log_status(f"Strategy 2: Symbol search for {search_terms['symbols']}...", provider="github", status="SEARCHING")
        symbol_results = search_github_symbols(repo, search_terms["symbols"], language)
        result["symbol_matches"] = symbol_results

    # Strategy 3: Path-filtered search (search in implementation directories)
    log_status("Strategy 3: Path-filtered search...", provider="github", status="SEARCHING")
    # Use keywords for path search (symbols already covered)
    path_query = " ".join(search_terms["keywords"]) if search_terms["keywords"] else query
    path_results = search_github_by_path(repo, path_query, search_terms["paths"], language)
    result["path_matches"] = path_results

    # Strategy 4: Fetch full content of most relevant files
    # Collect unique paths from all searches
    all_paths = set()
    for match in result["code_matches"][:2]:
        if match.get("path"):
            all_paths.add(match["path"])
    for match in result["symbol_matches"][:2]:
        if match.get("path"):
            all_paths.add(match["path"])

    if all_paths:
        log_status(f"Strategy 4: Fetching full content for {len(all_paths)} files...", provider="github", status="FETCHING")
        for path in list(all_paths)[:3]:  # Limit to 3 files
            content = fetch_file_content(repo, path)
            if not content.get("error"):
                result["file_contents"].append(content)

    # Get file tree for context (top-level structure)
    tree_cmd = ["gh", "api", f"repos/{repo}/contents", "--jq", ".[].name"]
    tree_output = run_command(tree_cmd)

    if not tree_output.startswith("Error:"):
        result["file_tree"] = tree_output.strip().split('\n')[:20]  # Top 20 files/dirs

    # Summary stats
    total_matches = len(result["code_matches"]) + len(result["symbol_matches"]) + len(result["path_matches"])
    log_status(f"Deep search complete: {total_matches} matches, {len(result['file_contents'])} files fetched", provider="github", status="DONE")

    return result


def extract_target_repo(github_res: Dict[str, Any]) -> Optional[str]:
    """Heuristic to find the most relevant repository from search results.

    Args:
        github_res: GitHub search results

    Returns:
        Repository fullName or None
    """
    # 1. Try top GitHub Repo result
    repos = github_res.get("repos", [])
    if repos and isinstance(repos, list) and len(repos) > 0:
        return repos[0].get("fullName")
    return None


def run_stage2_github(
    github_res: Dict[str, Any],
    query: str,
    is_code_related: bool,
    search_codex_fn
) -> Tuple[List[Dict], Dict, Optional[str], List]:
    """Stage 2: GitHub deep dive - README analysis, repo evaluation, code search.

    Args:
        github_res: Stage 1 GitHub search results
        query: Original search query
        is_code_related: Whether query is code-related
        search_codex_fn: Function to call Codex for evaluation

    Returns:
        Tuple of (github_details, github_deep, target_repo, deep_code_res)
    """
    github_details = []
    github_deep = {}
    target_repo = None
    deep_code_res = []

    # Check if github_res came from github-search skill (has top_repo_analysis)
    if github_res.get("top_repo_analysis"):
        console.print("[bold green]GitHub:[/bold green] Using /github-search skill results")

        top_analysis = github_res.get("top_repo_analysis", {})
        if top_analysis.get("repo"):
            target_repo = top_analysis.get("repo")
            github_details = [{
                "fullName": target_repo,
                "metadata": top_analysis.get("metadata", {}),
                "readme": top_analysis.get("readme", {}).get("content", ""),
                "languages": top_analysis.get("languages", {})
            }]

        code_search = github_res.get("code_search", {})
        if code_search:
            github_deep = {
                "repo": target_repo,
                "language": code_search.get("language"),
                "code_matches": code_search.get("basic_matches", []),
                "symbol_matches": code_search.get("symbol_matches", []),
                "path_matches": code_search.get("path_matches", []),
                "file_contents": code_search.get("file_contents", []),
                "file_tree": []
            }
            deep_code_res = github_deep.get("code_matches", [])

    elif is_code_related and github_res.get("repos"):
        # Manual deep dive
        repos = github_res.get("repos", [])[:3]
        if repos:
            console.print(f"[bold magenta]GitHub Stage 2:[/bold magenta] Fetching README & metadata for {len(repos)} repos...")
            log_status(f"GitHub Stage 2: Fetching details for {len(repos)} repos...", provider="github", status="RUNNING")

            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = {executor.submit(fetch_repo_details, r.get("fullName")): r for r in repos if r.get("fullName")}
                for f in as_completed(futures):
                    res = f.result()
                    if res and not res.get("error"):
                        github_details.append(res)
            log_status("GitHub Stage 2 finished.", provider="github", status="DONE")

            if github_details:
                console.print(f"[bold magenta]GitHub Stage 2b:[/bold magenta] Evaluating {len(github_details)} repos with Codex...")
                best_repo_idx = evaluate_github_repos(github_details, query, search_codex_fn)

                if 0 <= best_repo_idx < len(github_details):
                    selected = github_details[best_repo_idx]
                    target_repo = selected.get("fullName")
                    console.print(f"[bold green]Selected:[/bold green] {target_repo} as most relevant repo")

                    console.print(f"[bold magenta]GitHub Stage 3:[/bold magenta] Multi-strategy deep search in {target_repo}...")
                    log_status(f"GitHub Stage 3: Multi-strategy deep search in {target_repo}...", provider="github", status="SEARCHING")
                    github_deep = deep_search_github_repo(target_repo, query, selected)
                    deep_code_res = github_deep.get("code_matches", [])
                    log_status("GitHub Stage 3 finished.", provider="github", status="DONE")
                else:
                    log_status("No relevant GitHub repo identified.", provider="github", status="DONE")

    return github_details, github_deep, target_repo, deep_code_res
