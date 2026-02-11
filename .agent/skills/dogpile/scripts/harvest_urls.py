#!/usr/bin/env python3
import json
import logging
import subprocess
import time
import os
from pathlib import Path
from typing import List, Set, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Task Monitor Constants
TASK_MONITOR_DIR = Path.home() / ".pi" / "task-monitor"
REGISTRY_FILE = TASK_MONITOR_DIR / "registry.json"

class TaskMonitor:
    def __init__(self, name: str, total: int, description: str):
        self.name = name
        self.total = total
        self.description = description
        self.start_time = time.time()
        self.completed = 0
        self.failed = 0
        self.current_item = "Initializing..."
        self.status = "running"
        self.state_file = Path.cwd() / f".{name}.json"
        
        self.register()
        self.update()

    def register(self):
        try:
            TASK_MONITOR_DIR.mkdir(parents=True, exist_ok=True)
            registry = {}
            if REGISTRY_FILE.exists():
                try:
                    registry = json.loads(REGISTRY_FILE.read_text())
                except: pass
            
            registry[self.name] = {
                "state_file": str(self.state_file),
                "total": self.total,
                "description": self.description,
                "project": "corpus-expansion",
                "registered_at": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            
            # Atomic write
            tmp = REGISTRY_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(registry, indent=2))
            os.replace(tmp, REGISTRY_FILE)
        except Exception as e:
            logger.warning(f"Failed to register task: {e}")

    def update(self, current_item: Optional[str] = None, completed_delta: int = 0, failed_delta: int = 0, status: str = "running"):
        if current_item:
            self.current_item = current_item
        self.completed += completed_delta
        self.failed += failed_delta
        self.status = status
        
        state = {
            "completed": self.completed,
            "total": self.total,
            "description": self.description,
            "current_item": self.current_item,
            "stats": {
                "success": self.completed - self.failed,
                "failed": self.failed
            },
            "elapsed_seconds": round(time.time() - self.start_time, 1),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": self.status
        }
        
        try:
            tmp = self.state_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(state, indent=2))
            os.replace(tmp, self.state_file)
        except Exception: pass

    def finish(self):
        self.update(status="completed", current_item="Done")

# Brave Search Script Path
BRAVE_SCRIPT = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/brave-search/brave_search.py")

def search_brave(query: str, monitor: TaskMonitor, count: int = 50, offset: int = 0) -> List[str]:
    """Search Brave and return PDF URLs."""
    cmd = [
        "python3", str(BRAVE_SCRIPT), "web",
        query,
        "--count", str(count),
        "--offset", str(offset),
        "--json"
    ]
    
    max_retries = 3
    base_delay = 5

    for attempt in range(max_retries):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            
            urls = []
            if "results" in data:
                for item in data["results"]:
                    url = item.get("url", "")
                    if url.lower().endswith(".pdf"):
                        urls.append(url)
            
            if not urls:
                logger.warning(f"Brave returned 0 URLs. Raw stdout: {result.stdout[:500]}...")
                
            return urls

        except subprocess.CalledProcessError as e:
            if "429" in e.stderr or "rate limit" in e.stderr.lower():
                wait_time = base_delay * (2 ** attempt)
                msg = f"Rate limited (429). Retrying in {wait_time}s... (Attempt {attempt+1}/{max_retries})"
                logger.warning(msg)
                monitor.update(current_item=msg)
                time.sleep(wait_time)
                continue
            else:
                logger.error(f"Search failed: {e.stderr}")
                return []
        except json.JSONDecodeError:
            logger.error("Failed to parse JSON output")
            return []
            
    logger.error("Max retries exceeded.")
    return []

def harvest_pdfs(queries: List[str], target_count: int = 1000) -> List[str]:
    monitor = TaskMonitor("corpus-expansion-industry", target_count, "Harvesting Industry PDFs")
    found_urls: Set[str] = set()
    
    for query in queries:
        logger.info(f"Harvesting for query: {query}")
        monitor.update(current_item=f"Query: {query}")
        offset = 0
        
        while len(found_urls) < target_count:
            logger.info(f"Fetching offset {offset}...")
            monitor.update(current_item=f"Query: {query} (Offset {offset})", completed_delta=0)
            
            batch_urls = search_brave(query, monitor, count=50, offset=offset)
            
            if not batch_urls:
                logger.info("No more results for this query.")
                break
            
            new_urls = set(batch_urls) - found_urls
            found_urls.update(new_urls)
            
            # Update progress
            new_count = len(new_urls)
            logger.info(f"Found {new_count} new PDFs. Total unique: {len(found_urls)}")
            monitor.update(completed_delta=new_count)
            
            if not new_urls:
                logger.info("No new unique URLs found in this batch (diminishing returns).")
                break # Stop if we are just getting duplicates
                
            offset += 1 
            
            time.sleep(5) # Be nice and avoid 429
            
            if len(found_urls) >= target_count:
                break
        
        if len(found_urls) >= target_count:
            break

    monitor.finish()
    return list(found_urls)

if __name__ == "__main__":
    queries = [
        "filetype:pdf site:ti.com datasheet",
        "filetype:pdf site:analog.com datasheet",
        "filetype:pdf site:infineon.com datasheet",
        "filetype:pdf site:st.com datasheet",
        "filetype:pdf site:nxp.com datasheet",
        "filetype:pdf site:microchip.com datasheet"
    ]
    
    logger.info("Starting Industry PDF Harvest...")
    urls = harvest_pdfs(queries, target_count=500) # Start with 500
    
    output_file = Path("industry_pdfs.txt")
    output_file.write_text("\n".join(urls))
    logger.info(f"Saved {len(urls)} URLs to {output_file}")
