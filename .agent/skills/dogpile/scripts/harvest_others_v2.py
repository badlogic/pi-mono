#!/usr/bin/env python3
import json
import logging
import subprocess
import time
import os
from pathlib import Path
from typing import List, Set, Optional

# Setup similar to v1
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

BRAVE_SCRIPT = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/brave-search/brave_search.py")

def search_brave(query: str, monitor: TaskMonitor, count: int = 50, offset: int = 0) -> List[str]:
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
            return urls

        except subprocess.CalledProcessError as e:
            if "429" in e.stderr or "rate limit" in e.stderr.lower():
                wait_time = base_delay * (2 ** attempt)
                logger.warning(f"Rate limit (429). Retrying in {wait_time}s...")
                monitor.update(current_item=f"Rate limit backoff {wait_time}s")
                time.sleep(wait_time)
                continue
            else:
                logger.error(f"Search failed: {e.stderr}")
                return []
        except json.JSONDecodeError:
            logger.error("Failed to parse JSON")
            return []
            
    return []

def harvest_pdfs(queries: List[str], filename: str, task_name: str, target_count: int = 500) -> List[str]:
    monitor = TaskMonitor(task_name, target_count, f"Harvesting {filename}")
    found_urls: Set[str] = set()
    
    for query in queries:
        logger.info(f"Harvesting for query: {query}")
        monitor.update(current_item=f"Query: {query}")
        offset = 0
        
        while len(found_urls) < target_count:
            # logger.info(f"Fetching offset {offset}...")
            monitor.update(current_item=f"Query: {query} (Offset {offset})", completed_delta=0)
            
            batch_urls = search_brave(query, monitor, count=50, offset=offset)
            
            if not batch_urls:
                logger.info("No more results for this query.")
                break
            
            new_urls = set(batch_urls) - found_urls
            found_urls.update(new_urls)
            
            new_count = len(new_urls)
            logger.info(f"Found {new_count} new PDFs. Total unique: {len(found_urls)}")
            monitor.update(completed_delta=new_count)
            
            if not new_urls:
                # logger.info("No new unique URLs found in this batch.")
                break 
                
            offset += 1 
            time.sleep(3) # Slightly faster but safe
            
            if len(found_urls) >= target_count:
                break
        
        if len(found_urls) >= target_count:
            break

    monitor.finish()
    
    output_file = Path(filename)
    output_file.write_text("\n".join(found_urls))
    logger.info(f"Saved {len(found_urls)} URLs to {output_file}")
    
    return list(found_urls)

if __name__ == "__main__":
    # Adversarial Queries V2 (Corrected & Expanded)
    adversarial_queries = [
        "filetype:pdf site:hathitrust.org",             # Corrected typo
        "filetype:pdf site:cia.gov/readingroom",        # Declassified
        "filetype:pdf site:fcc.gov order",              # Regulatory orders
        "filetype:pdf site:osti.gov technical report",  # SciTech
        "filetype:pdf site:justice.gov indictment"      # Legal/Adversarial context
    ]
    harvest_pdfs(adversarial_queries, "adversarial_pdfs_v2.txt", "corpus-expansion-adversarial-v2", target_count=500) 
    
    # Finance/Legal Queries V2
    finance_queries = [
        "filetype:pdf site:irs.gov instructions",       # Tax forms
        "filetype:pdf site:bis.org basel",              # Banking standards
        "filetype:pdf site:worldbank.org report",       # Global finance
        "filetype:pdf site:imf.org country report"      # IMF
    ]
    harvest_pdfs(finance_queries, "finance_pdfs_v2.txt", "corpus-expansion-finance-v2", target_count=500)
