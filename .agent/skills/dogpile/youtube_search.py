#!/usr/bin/env python3
"""YouTube search integration for Dogpile.

Provides multi-stage video search:
- Stage 1: Video metadata search via yt-dlp
- Stage 2: Transcript extraction
"""
import json
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import SKILLS_DIR
from dogpile.utils import log_status, with_semaphore, run_command


@with_semaphore("youtube")
def search_youtube(query: str) -> List[Dict[str, str]]:
    """Search YouTube (Stage 1: Metadata) with rate limiting protection.

    YouTube/yt-dlp can get rate limited. Uses semaphore to limit concurrent requests.

    Args:
        query: Search query

    Returns:
        List of video dicts with title, id, url, description
    """
    log_status(f"Starting YouTube Search for '{query}'...", provider="youtube", status="RUNNING")

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

    if output.startswith("Error"):
        # Check for rate limit
        if "429" in output or "rate limit" in output.lower():
            log_status("YouTube rate limited, backing off 30s...", provider="youtube", status="RATE_LIMITED")
            time.sleep(30)
            output = run_command(cmd)  # Retry once

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

    log_status("YouTube Search finished.", provider="youtube", status="DONE")
    return results


@with_semaphore("youtube")
def search_youtube_transcript(video_id: str) -> Dict[str, Any]:
    """Search YouTube (Stage 2: Transcript) with rate limiting protection.

    Args:
        video_id: YouTube video ID

    Returns:
        Dict with full_text or error
    """
    log_status(f"Fetching YouTube Transcript for {video_id}...")
    skill_dir = SKILLS_DIR / "youtube-transcripts"
    cmd = [sys.executable, str(skill_dir / "youtube_transcript.py"), "get", "-i", video_id]

    try:
        output = run_command(cmd)
        log_status(f"YouTube Transcript for {video_id} finished.")

        if output.startswith("Error:"):
            return {"error": output}

        return json.loads(output)
    except Exception as e:
        return {"error": str(e)}


def run_stage2_youtube(youtube_res: List[Dict]) -> List[Dict]:
    """Stage 2: YouTube transcript fetch for top videos.

    Args:
        youtube_res: Stage 1 YouTube search results

    Returns:
        List of transcript dicts with full_text, title, url
    """
    youtube_transcripts = []

    if youtube_res:
        valid_videos = [v for v in youtube_res if v.get("id")][:2]

        if valid_videos:
            log_status(
                f"YouTube Stage 2: Fetching transcripts for {len(valid_videos)} videos...",
                provider="youtube",
                status="RUNNING"
            )

            with ThreadPoolExecutor(max_workers=2) as executor:
                futures = {executor.submit(search_youtube_transcript, v["id"]): v for v in valid_videos}
                for f in as_completed(futures):
                    res = f.result()
                    if "full_text" in res:
                        res["title"] = futures[f]["title"]
                        res["url"] = futures[f]["url"]
                        youtube_transcripts.append(res)
            log_status("YouTube Stage 2 finished.", provider="youtube", status="DONE")

    return youtube_transcripts
