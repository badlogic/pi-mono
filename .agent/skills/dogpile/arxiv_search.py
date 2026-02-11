#!/usr/bin/env python3
"""ArXiv search integration for Dogpile.

Provides multi-stage academic paper search:
- Stage 1: Abstracts search
- Stage 2: Paper details/metadata
- Stage 3: Full paper extraction via fetcher/extractor
"""
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List, Tuple

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import SKILLS_DIR
from dogpile.utils import log_status, with_semaphore, run_command


@with_semaphore("arxiv")
def search_arxiv(query: str) -> Dict[str, Any]:
    """Search ArXiv (Stage 1: Abstracts) with rate limiting protection.

    ArXiv API has rate limits. Use semaphore to be respectful of academic resources.

    Args:
        query: Search query

    Returns:
        Dict with items list or error
    """
    log_status(f"Starting ArXiv Search (Stage 1: Abstracts) for '{query}'...", provider="arxiv", status="RUNNING")
    arxiv_dir = SKILLS_DIR / "arxiv"
    cmd = ["bash", "run.sh", "search", "-q", query, "-n", "10", "--json"]

    try:
        output = run_command(cmd, cwd=arxiv_dir)
        log_status("ArXiv Search (Stage 1) finished.", provider="arxiv", status="DONE")

        if output.startswith("Error:"):
            return {"error": output}

        return json.loads(output)
    except Exception as e:
        return {"error": str(e)}


def search_arxiv_details(paper_id: str) -> Dict[str, Any]:
    """Search ArXiv (Stage 2: Paper Details/Metadata).

    Args:
        paper_id: ArXiv paper ID

    Returns:
        Dict with paper details or error
    """
    log_status(f"Fetching ArXiv Paper Details for {paper_id}...")
    arxiv_dir = SKILLS_DIR / "arxiv"
    cmd = ["bash", "run.sh", "get", "-i", paper_id]

    try:
        output = run_command(cmd, cwd=arxiv_dir)
        log_status(f"ArXiv Details for {paper_id} finished.")

        if output.startswith("Error:"):
            return {"error": output}

        return json.loads(output)
    except Exception as e:
        return {"error": str(e)}


def deep_extract_arxiv(paper_id: str, abstract: str = "") -> Dict[str, Any]:
    """ArXiv Stage 3: Full paper extraction via /fetcher + /extractor.

    Downloads the PDF and extracts full text for deep analysis.
    Only call this for papers the agent determines are highly relevant.

    Args:
        paper_id: ArXiv paper ID
        abstract: Paper abstract for context

    Returns:
        Dict with full_text and metadata, or error
    """
    log_status(f"Deep extracting ArXiv paper {paper_id}...", provider="arxiv", status="EXTRACTING")

    pdf_url = f"https://arxiv.org/pdf/{paper_id}.pdf"

    # Use fetcher to download
    fetcher_dir = SKILLS_DIR / "fetcher"
    if not fetcher_dir.exists():
        return {"error": "fetcher skill not found", "paper_id": paper_id}

    try:
        fetch_cmd = ["bash", "run.sh", pdf_url]
        fetch_output = run_command(fetch_cmd, cwd=fetcher_dir)

        if fetch_output.startswith("Error:"):
            return {"error": fetch_output, "paper_id": paper_id}

        # Use extractor to get text from PDF
        extractor_dir = SKILLS_DIR / "extractor"
        if extractor_dir.exists():
            # Use fetcher to download (supports proxies/IP rotation)
            import tempfile
            import shutil
            
            with tempfile.TemporaryDirectory() as tmp_dir_str:
                tmp_dir = Path(tmp_dir_str)
                # Fetch PDF using fetcher to respect routing/proxies
                # We use 'get' command explicitly with --emit download
                fetch_cmd = ["bash", "run.sh", "get", pdf_url, "--out", str(tmp_dir), "--emit", "download"]
                
                fetch_output = run_command(fetch_cmd, cwd=fetcher_dir)
                
                # Check for downloaded file
                downloads_dir = tmp_dir / "downloads"
                downloaded_file = None
                if downloads_dir.exists():
                    # Look for the PDF file
                    files = list(downloads_dir.glob("*.pdf"))
                    if not files:
                        files = list(downloads_dir.glob("*"))
                    if files:
                        downloaded_file = files[0]
                
                if downloaded_file:
                    extract_cmd = ["bash", "run.sh", str(downloaded_file)]
                    extract_output = run_command(extract_cmd, cwd=extractor_dir)
                else:
                    return {"error": f"Failed to download PDF via fetcher. Output: {fetch_output[:200]}", "paper_id": paper_id}
            # Cleanup is handled by TemporaryDirectory context manager

            log_status(f"ArXiv deep extraction for {paper_id} finished.", provider="arxiv", status="DONE")
            return {
                "paper_id": paper_id,
                "abstract": abstract,
                "full_text": extract_output[:10000],  # Limit to 10k chars
                "extracted": True,
            }

        return {"error": "extractor skill not found", "paper_id": paper_id}

    except Exception as e:
        return {"error": str(e), "paper_id": paper_id}


def run_stage2_arxiv(arxiv_res: Dict[str, Any], query: str, search_codex_fn) -> Tuple[List[Dict], List[Dict]]:
    """Stage 2: ArXiv deep dive - paper details and full extraction.

    Args:
        arxiv_res: Stage 1 ArXiv search results
        query: Original search query
        search_codex_fn: Function to call Codex for evaluation

    Returns:
        Tuple of (arxiv_details, arxiv_deep)
    """
    import re as regex

    arxiv_details = []
    arxiv_deep = []

    if isinstance(arxiv_res, dict) and "items" in arxiv_res:
        valid_papers = arxiv_res["items"][:3]

        if valid_papers:
            log_status(f"ArXiv Stage 2: Fetching details for {len(valid_papers)} papers...", provider="arxiv", status="RUNNING")

            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = {executor.submit(search_arxiv_details, p["id"]): p for p in valid_papers}
                for f in as_completed(futures):
                    res = f.result()
                    if "items" in res and res["items"]:
                        arxiv_details.append(res["items"][0])
            log_status("ArXiv Stage 2 finished.", provider="arxiv", status="DONE")

            # Stage 3: Deep extract most relevant paper
            if arxiv_details:
                abstracts_summary = "\n".join([
                    f"[{i+1}] {p.get('title', 'Unknown')}: {p.get('abstract', '')[:300]}"
                    for i, p in enumerate(arxiv_details)
                ])
                eval_prompt = f"""Given these paper abstracts for query "{query}", which ONE paper is MOST relevant?
{abstracts_summary}

Return just the number (1, 2, or 3) of the most relevant paper, or 0 if none are relevant."""

                best_paper_idx = 0
                eval_result = search_codex_fn(eval_prompt)

                try:
                    match = regex.search(r'(\d)', eval_result)
                    if match:
                        best_paper_idx = int(match.group(1)) - 1
                except Exception:
                    pass

                if 0 <= best_paper_idx < len(arxiv_details):
                    best_paper = arxiv_details[best_paper_idx]
                    log_status(
                        f"ArXiv Stage 3: Deep extracting '{best_paper.get('title', 'Unknown')[:50]}'...",
                        provider="arxiv",
                        status="EXTRACTING"
                    )
                    deep_result = deep_extract_arxiv(
                        best_paper.get("id", ""),
                        best_paper.get("abstract", "")
                    )
                    if deep_result.get("extracted"):
                        arxiv_deep.append(deep_result)
                        log_status("ArXiv Stage 3 deep extraction finished.", provider="arxiv", status="DONE")

    return arxiv_details, arxiv_deep
