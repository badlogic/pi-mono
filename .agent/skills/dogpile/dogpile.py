#!/usr/bin/env python3
"""Dogpile: Comprehensive deep search aggregator.

Orchestrates searches across:
- Brave Search (Web)
- Perplexity (Deep Research)
- GitHub (Repos & Issues)
- ArXiv (Papers)
- YouTube (Videos)
"""
import json
import subprocess
import sys
import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request

try:
    import typer
    from rich.console import Console
    from rich.markdown import Markdown
    from rich.panel import Panel
except ImportError:
    print("Missing requirements. Run: pip install typer rich", file=sys.stderr)
    sys.exit(1)

app = typer.Typer(help="Dogpile - Deep research aggregator")
console = Console()

SKILLS_DIR = Path(__file__).resolve().parents[1]

def run_command(cmd: List[str], cwd: Optional[Path] = None) -> str:
    """Run a command and return stdout."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            cwd=cwd
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        return f"Error: {e.stderr}"
    except Exception as e:
        return f"Error: {e}"

def log_status(msg: str):
    """Log status to stderr."""
    # Use a distinct prefix for easier parsing by other agents
    sys.stderr.write(f"[DOGPILE-STATUS] {msg}\n")
    sys.stderr.flush()

def search_wayback(query: str) -> Dict[str, Any]:
    """Check Wayback Machine for snapshots if query is a URL."""
    # Simple URL heuristic
    if not (query.startswith("http://") or query.startswith("https://")):
        return {}

    api_url = f"http://archive.org/wayback/available?url={query}"
    try:
        with urllib.request.urlopen(api_url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            # Format: {"archived_snapshots": {"closest": {"available": true, "url": "...", ...}}}
            snapshots = data.get("archived_snapshots", {})
            closest = snapshots.get("closest", {})
            if closest.get("available"):
                return {
                    "available": True,
                    "url": closest.get("url"),
                    "timestamp": closest.get("timestamp")
                }
    except Exception as e:
        return {"error": str(e)}
    
    return {}

def search_brave(query: str) -> Dict[str, Any]:
    """Search Brave Web."""
    log_status(f"Starting Brave Search for '{query}'...")
    script = SKILLS_DIR / "brave-search" / "brave_search.py"
    cmd = [sys.executable, str(script), "web", query, "--count", "5", "--json"]
    try:
        output = run_command(cmd)
        log_status("Brave Search finished.")
        if output.startswith("Error:"):
            return {"error": output}
        return json.loads(output)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON output from Brave", "raw": output}

def search_perplexity(query: str) -> Dict[str, Any]:
    """Search Perplexity."""
    log_status(f"Starting Perplexity Research for '{query}'...")
    script = SKILLS_DIR / "perplexity" / "perplexity.py"
    cmd = [sys.executable, str(script), "research", query, "--model", "small", "--json"]
    try:
        output = run_command(cmd)
        log_status("Perplexity finished.")
        if output.startswith("Error:"):
            return {"error": output}
        return json.loads(output)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON output from Perplexity", "raw": output}

def search_github(query: str) -> Dict[str, Any]:
    """Search GitHub Repos and Issues."""
    log_status(f"Starting GitHub Search for '{query}'...")
    if not shutil.which("gh"):
        return {"error": "GitHub CLI (gh) not installed"}
    
    repos_cmd = ["gh", "search", "repos", query, "--limit", "5", "--json", "fullName,html_url,description,stargazersCount"]
    issues_cmd = ["gh", "search", "issues", query, "--limit", "5", "--json", "title,html_url,state,repository"]
    
    repos_out = run_command(repos_cmd)
    issues_out = run_command(issues_cmd)
    log_status("GitHub Search finished.")
    
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

def search_arxiv(query: str) -> str:
    """Search ArXiv (Raw output for now as it might not be JSON)."""
    log_status(f"Starting ArXiv Search for '{query}'...")
    arxiv_dir = SKILLS_DIR / "arxiv"
    cmd = ["bash", "run.sh", "search", "-q", query, "-n", "5"]
    res = run_command(cmd, cwd=arxiv_dir)
    log_status("ArXiv Search finished.")
    return res

def search_youtube(query: str) -> List[Dict[str, str]]:
    """Search YouTube via yt-dlp."""
    log_status(f"Starting YouTube Search for '{query}'...")
    if not shutil.which("yt-dlp"):
         return [{"title": "Error: yt-dlp not installed", "url": "", "id": "", "description": ""}]

    # yt-dlp search using JSON for robust parsing
    # Use --dump-json and NO --flat-playlist to get descriptions
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--no-warnings",
        f"ytsearch5:{query}"
    ]
    output = run_command(cmd)
    log_status("YouTube Search finished.")
    
    if output.startswith("Error"):
         return [{"title": f"Error searching YouTube: {output}", "url": "", "id": "", "description": ""}]
    
    results = []
    # yt-dlp outputs one JSON object per line
    for line in output.splitlines():
        try:
            data = json.loads(line)
            desc = data.get("description") or "No description available."
            # Clean up newlines for display
            desc = desc.replace("\n", " ").strip()
            if len(desc) > 200:
                desc = desc[:197] + "..."
                
            results.append({
                "title": data.get("title", "Unknown Title"),
                "id": data.get("id", ""),
                "url": data.get("webpage_url") or data.get("url", ""),
                "description": desc
            })
        except json.JSONDecodeError:
            continue
            
    return results


def analyze_query(query: str, interactive: bool) -> Tuple[str, bool]:
    """
    Analyze query for ambiguity and code-related intent.
    Returns: (query, is_code_related)
    Exits if ambiguous and interactive.
    """
    if not interactive:
        return query, True  # Default to treating as code-related if skipping check? Or maybe False? Let's say True to allow deep dive if repo found.

    prompt = (
        f"Analyze the search query '{query}'.\n"
        "1. Is it ambiguous? (True/False)\n"
        "2. Is it related to programming, software, libraries, or technical documentation? (True/False)\n"
        "3. If ambiguous, provide 3 multiple-choice questions.\n"
        "Return JSON: "
        '{"is_ambiguous": bool, "is_code_related": bool, "clarifications": [{"question": "...", "options": []}]}'
    )
    
    result = search_perplexity(prompt)
    
    if "error" in result:
        return query, True # Fail open

    try:
        text = result.get("answer", "")
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
            
        data = json.loads(text.strip())
        
        # Check Ambiguity
        if data.get("is_ambiguous"):
            clarifications = data.get("clarifications", [])
            if clarifications:
                output = {
                    "status": "ambiguous",
                    "query": query,
                    "clarifications": clarifications,
                    "message": "The query is ambiguous. Please ask the user these clarifying questions."
                }
                # Print JSON to stdout for agentic handoff
                print(json.dumps(output, indent=2))
                raise typer.Exit(code=0)
        
        return query, data.get("is_code_related", False)

    except json.JSONDecodeError:
        pass
    except typer.Exit:
        raise
    except Exception:
        pass

    return query, True


def search_github_code(repo: str, query: str) -> List[Dict[str, Any]]:
    """Search for code within a specific repository."""
    if not shutil.which("gh"):
        return []
    
    # gh search code --repo owner/repo "query"
    cmd = ["gh", "search", "code", "--repo", repo, query, "--limit", "3", "--json", "path,repository,url"]
    output = run_command(cmd)
    
    try:
        if output.startswith("Error:"):
            # Code search might fail if not authenticated or other issues, just return empty
            return []
        return json.loads(output)
    except Exception:
        return []

def extract_target_repo(github_res: Dict[str, Any]) -> Optional[str]:
    """Heuristic to find the most relevant repository from search results."""
    # 1. Try top GitHub Repo result
    repos = github_res.get("repos", [])
    if repos and isinstance(repos, list) and len(repos) > 0:
        return repos[0].get("fullName")
    return None

@app.command()
def search(
    query: str = typer.Argument(..., help="Search query"),
    interactive: bool = typer.Option(True, "--interactive/--no-interactive", help="Enable ambiguity/intent check"),
):
    """Aggregate search results from multiple sources."""
    
    # 1. Analyze Query (Ambiguity + Intent)
    query, is_code_related = analyze_query(query, interactive)

    console.print(f"[bold blue]Dogpiling on:[/bold blue] {query} (Code Related: {is_code_related})...")

    # Stage 1: Broad Search
    with ThreadPoolExecutor(max_workers=6) as executor:
        future_brave = executor.submit(search_brave, query)
        future_perplexity = executor.submit(search_perplexity, query)
        future_github = executor.submit(search_github, query)
        future_arxiv = executor.submit(search_arxiv, query)
        future_youtube = executor.submit(search_youtube, query)
        future_wayback = executor.submit(search_wayback, query)

        # Collect results
        brave_res = future_brave.result()
        perp_res = future_perplexity.result()
        github_res = future_github.result()
        arxiv_res = future_arxiv.result()
        youtube_res = future_youtube.result()
        wayback_res = future_wayback.result()

    # Stage 2: Deep Dive (only if code related AND target repo found)
    target_repo = extract_target_repo(github_res)
    deep_code_res = []

    if is_code_related and target_repo:
        console.print(f"[bold magenta]Deep Dive:[/bold magenta] Analying target repo '{target_repo}'...")
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_code = executor.submit(search_github_code, target_repo, query)
            deep_code_res = future_code.result()
    elif target_repo:
        console.print(f"[dim]Skipping deep code search (Query identified as non-code related)[/dim]")

    # --- GLUE THE REPORT ---
    md_lines = [f"# Dogpile Report: {query}", ""]
    
    # 0. Wayback (Top if available)
    if wayback_res.get("available"):
        md_lines.append(f"> 🏛️ **Wayback Machine**: [Snapshot available]({wayback_res['url']}) (Timestamp: {wayback_res.get('timestamp')})")
        md_lines.append("")
    elif "error" in wayback_res:
         md_lines.append(f"> 🏛️ Wayback Error: {wayback_res['error']}")
         md_lines.append("")

    # 1. Perplexity (Summary)
    md_lines.append("## 🧠 AI Research (Perplexity)")
    if "error" in perp_res:
         md_lines.append(f"> Error: {perp_res['error']}")
    else:
        md_lines.append(perp_res.get("answer", "No answer."))
        if perp_res.get("citations"):
            md_lines.append("\n**Citations:**")
            for cite in perp_res.get("citations", []):
                md_lines.append(f"- {cite}")
    md_lines.append("")

    # 2. GitHub & Code Deep Dive
    md_lines.append("## OCTOCAT GitHub")
    if "error" in github_res:
        md_lines.append(f"> Error: {github_res['error']}")
    else:
        md_lines.append("### Repositories")
        repos = github_res.get("repos", [])
        if not repos:
            md_lines.append("No repositories found.")
        elif isinstance(repos, list):
            for i, repo in enumerate(repos):
                desc = repo.get("description", "No description") or "No description"
                star = f"⭐ {repo.get('stargazersCount', 0)}"
                prefix = "🎯 **TARGET**" if repo.get("fullName") == target_repo else "-"
                
                md_lines.append(f"{prefix} **[{repo.get('fullName')}]({repo.get('html_url')})** ({star})")
                md_lines.append(f"  {desc}")
        
        if deep_code_res:
            md_lines.append(f"\n### 🔍 Code Matches in {target_repo}")
            for item in deep_code_res:
                md_lines.append(f"- [`{item.get('path')}`]({item.get('url')})")

        md_lines.append("\n### Issues/Discussions")
        issues = github_res.get("issues", [])
        if not issues:
             md_lines.append("No issues found.")
        elif isinstance(issues, list):
            for issue in issues:
                repo_name = issue.get("repository", {}).get("nameWithOwner", "unknown")
                md_lines.append(f"- **{repo_name}**: [{issue.get('title')}]({issue.get('html_url')}) ({issue.get('state')})")
    md_lines.append("")

    # 3. Brave (Web)
    md_lines.append("## 🌐 Web Results (Brave)")
    if "error" in brave_res:
         md_lines.append(f"> Error: {brave_res['error']}")
    else:
        for item in brave_res.get("results", [])[:5]:
            md_lines.append(f"- **[{item.get('title', 'No Title')}]({item.get('url', '#')})**")
            md_lines.append(f"  {item.get('description', '')}")
    md_lines.append("")

    # 4. ArXiv
    md_lines.append("## 📄 Academic Papers (ArXiv)")
    # ArXiv output is raw text (table likely)
    md_lines.append(arxiv_res)
    md_lines.append("")

    # 5. YouTube
    md_lines.append("## 📺 Videos (YouTube)")
    if not youtube_res:
        md_lines.append("No videos found or error.")
    else:
        for i, video in enumerate(youtube_res):
             if "Error" in video.get("title", ""):
                 md_lines.append(f"> {video['title']}")
             else:
                 md_lines.append(f"- **[{video['title']}]({video['url']})**")
                 if video.get("description"):
                     md_lines.append(f"  _{video.get('description')}_")
    
    # Print the report
    console.print(Markdown("\n".join(md_lines)))

@app.command()
def version():
    """Show version."""
    console.print("Dogpile v0.2.0")

if __name__ == "__main__":
    app()
