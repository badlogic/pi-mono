#!/usr/bin/env python3
import argparse
import json
import sys
import subprocess
import os
import duckdb
from pathlib import Path

# Config
DB_PATH = Path(os.environ.get("SPARTA_DB_PATH", "/home/graham/workspace/experiments/sparta/data/runs/run-recovery-verify/sparta.duckdb"))
FETCHER_SCRIPT = Path(__file__).parent.parent / "run.sh"

def get_urls_from_db(control_type):
    if not DB_PATH.exists():
        print(f"Error: DB not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)
        
    conn = duckdb.connect(str(DB_PATH), read_only=True)
    
    # We need to find where URLs are stored. 
    # Based on schema analysis, 'controls' has 'url_count'. 
    # But where are the actual URLs?
    # Tables include: 'urls', 'control_urls', 'url_sources'
    # Likely 'control_urls' links 'control_id' to 'url'?
    
    # Let's try to join controls -> control_urls -> urls (or similar)
    # Schema checks earlier showed:
    # controls: control_id, control_type
    # control_urls: ? (likely control_id, url)
    # urls: url
    
    query = """
    SELECT DISTINCT u.url 
    FROM controls c
    JOIN control_urls cu ON c.control_id = cu.control_id
    JOIN urls u ON cu.url_id = u.url_id
    WHERE c.control_type = ?
    """
    
    # Fallback if control_urls doesn't exist or is different structure
    # Let's assume standard join or check schema if query fails.
    # For now, implemented based on standard relational pattern.
    
    try:
        results = conn.execute(query, [control_type]).fetchall()
        urls = [r[0] for r in results]
        return urls
    except Exception as e:
        print(f"Database query error: {e}", file=sys.stderr)
        # Fallback to direct URL table check if simple join fails
        # But for this script I'll assume the join works or fail hard.
        sys.exit(1)
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser(description="Fetch URLs from SPARTA DB by control type")
    parser.add_argument("--control-type", required=True, help="Control type to query (e.g., NIST)")
    parser.add_argument("--dry-run", action="store_true", help="Print URLs instead of fetching")
    parser.add_argument("--out", help="Output directory for fetcher")
    args = parser.parse_args()

    # Get URLs
    print(f"Querying DB for {args.control_type}...", file=sys.stderr)
    urls = get_urls_from_db(args.control_type)
    
    if not urls:
        print(f"No URLs found for control type: {args.control_type}", file=sys.stderr)
        sys.exit(0)
        
    print(f"Found {len(urls)} URLs.", file=sys.stderr)

    if args.dry_run:
        for url in urls:
            print(url)
    else:
        # Prepare manifest for fetcher
        # Fetcher expects line-separated URLs for get-manifest
        manifest_str = "\n".join(urls)
        
        cmd = [str(FETCHER_SCRIPT), "get-manifest", "-"]
        if args.out:
            cmd.extend(["--out", args.out])
            
        print(f"Running fetcher: {' '.join(cmd)}", file=sys.stderr)
        
        # Pipe URLs to fetcher
        process = subprocess.Popen(cmd, stdin=subprocess.PIPE, text=True)
        process.communicate(input=manifest_str)
        
        sys.exit(process.returncode)

if __name__ == "__main__":
    main()
