import json
import shutil
import logging
from pathlib import Path
from typing import Dict, List, Set

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# Config
BATCH_DIR = Path("/mnt/storage12tb/extractor_corpus/expansion_batch_1")
SUMMARY_FILE = BATCH_DIR / "consumer_summary.json"
DOWNLOADS_DIR = BATCH_DIR / "downloads"
TARGET_BASE = Path("/mnt/storage12tb/extractor_corpus")

# Source Lists
SOURCE_MAP = {
    "industry": Path("industry_pdfs.txt"),
    "adversarial": Path("adversarial_pdfs.txt"),
    "finance": Path("finance_pdfs.txt")
}

def load_url_set(path: Path) -> Set[str]:
    """Load URLs from a text file into a set."""
    if not path.exists():
        logger.warning(f"Source file not found: {path}")
        return set()
    
    urls = set()
    with open(path, "r") as f:
        for line in f:
            url = line.strip()
            if url:
                urls.add(url)
    return urls

def sort_corpus():
    """Sort downloaded PDFs into categorized folders based on source lists."""
    if not SUMMARY_FILE.exists():
        logger.error(f"Summary file not found: {SUMMARY_FILE}")
        return

    # Load source mappings
    url_to_category: Dict[str, str] = {}
    for category, path in SOURCE_MAP.items():
        urls = load_url_set(path)
        logger.info(f"Loaded {len(urls)} URLs for category '{category}'")
        for url in urls:
            url_to_category[url] = category

    # Load fetcher summary
    try:
        with open(SUMMARY_FILE, "r") as f:
            summary = json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse summary JSON: {e}")
        return

    # Process items
    success_count = 0
    moved_count = 0
    
    # Check if summary is a list (fetcher consumer_summary might be a list of results)
    # or a dict with "results" key. 
    # Based on fetcher code, it seems to emit a list of results or a summary dict.
    # We'll assume list for now, or adapt.
    
    items = summary if isinstance(summary, list) else summary.get("results", [])
    
    for item in items:
        url = item.get("url")
        status = item.get("status")
        artifacts = item.get("artifacts", {})
        download_path_str = artifacts.get("download")
        
        if not url or not download_path_str:
            continue
            
        # Normalize URL if needed (fetcher might normalize it)
        # We try exact match first
        category = url_to_category.get(url)
        if not category:
            # Try matching/normalizing
            # This is simple exact string matching for now
            pass
            
        if not category:
            category = "uncategorized"
            
        # Target directory
        target_dir = TARGET_BASE / category
        target_dir.mkdir(parents=True, exist_ok=True)
        
        source_path = BATCH_DIR / download_path_str
        if not source_path.exists():
            # Sometimes fetcher path is relative to out_dir
            source_path = BATCH_DIR / download_path_str
            
        if source_path.exists():
            file_name = source_path.name
            target_path = target_dir / file_name
            
            try:
                shutil.move(str(source_path), str(target_path))
                moved_count += 1
                if moved_count % 100 == 0:
                    logger.info(f"Moved {moved_count} files so far...")
            except Exception as e:
                logger.error(f"Failed to move {source_path} to {target_path}: {e}")
        else:
            logger.warning(f"File not found for {url}: {source_path}")

    logger.info(f"Sorting complete. Moved {moved_count} files.")

if __name__ == "__main__":
    sort_corpus()
