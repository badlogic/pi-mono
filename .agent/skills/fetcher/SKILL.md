---
name: fetcher
description: >
  Fetch web pages, PDFs, and documents with automatic fallbacks and content extraction.
  Use when user says "fetch this URL", "download this page", "crawl this website",
  "extract content from", "get the PDF", or provides URLs needing retrieval.
allowed-tools: Bash, Read
triggers:
  - fetch this URL
  - download page
  - crawl website
  - extract content from
  - get the PDF
  - scrape this site
  - retrieve document
metadata:
  short-description: Web crawling and document fetching CLI
---

# Fetcher - Web Crawling

Fetch web pages and documents with automatic fallbacks, proxy rotation, and content extraction.

**Self-contained skill** - auto-installs via `uvx` from git (no pre-installation needed).

**Fully automatic** - Playwright browsers are installed on first run for SPA/JS page support.

## Simplest Usage

```bash
# Via wrapper (recommended - auto-installs)
.agents/skills/fetcher/run.sh get https://example.com

# Or directly if fetcher is installed
fetcher get https://example.com
```

## Common Commands

```bash
./run.sh get https://example.com                   # Fetch single URL
./run.sh get-manifest urls.txt                     # Fetch list of URLs
./run.sh get-manifest - < urls.txt                 # Fetch from stdin
```

## Common Patterns

### Fetch a single URL
```bash
fetcher get https://www.nasa.gov --out run/nasa
```

Outputs to `run/nasa/`:
- `consumer_summary.json` - structured result
- `Walkthrough.md` - human-readable summary
- `downloads/` - raw content files

### Fetch multiple URLs
```bash
# From file (one URL per line)
fetcher get-manifest urls.txt --out run/batch

# From stdin
echo -e "https://example.com\nhttps://nasa.gov" | fetcher get-manifest -
```

### ETL mode (full control)
```bash
fetcher-etl --inventory urls.jsonl --out run/etl_batch
fetcher-etl --manifest urls.txt --out run/demo
```

### Check environment
```bash
fetcher doctor                    # Check dependencies and config
fetcher get --dry-run <url>       # Validate without fetching
fetcher-etl --help-full           # All options
fetcher-etl --find metrics        # Search options
```

## Output Structure

```
run/artifacts/<run-id>/
├── results.jsonl              # Fetch results per URL
├── consumer_summary.json      # Summary stats
├── Walkthrough.md             # Human-readable summary
├── downloads/                 # Raw files (HTML, PDF, etc.)
├── text_blobs/                # Extracted text
├── markdown/                  # LLM-friendly markdown
├── fit_markdown/              # Pruned markdown for LLM input
├── junk_results.jsonl         # Failed/junk URLs
└── junk_table.md              # Quick triage table
```

## Content Extraction

### Enable markdown output
```bash
export FETCHER_EMIT_MARKDOWN=1
export FETCHER_EMIT_FIT_MARKDOWN=1  # Pruned for LLM input
fetcher get https://example.com
```

### Rolling windows (for chunking)
```bash
export FETCHER_DOWNLOAD_MODE=rolling_extract
export FETCHER_ROLLING_WINDOW_SIZE=6000
export FETCHER_ROLLING_WINDOW_STEP=3000
fetcher get https://example.com
```

## Advanced Features

### HTTP caching
```bash
# Cache enabled by default
fetcher get https://example.com

# Disable cache for fresh fetch
fetcher get https://example.com --no-http-cache
```

### PDF discovery
```bash
# Auto-fetch PDF links from HTML pages
export FETCHER_ENABLE_PDF_DISCOVERY=1
export FETCHER_PDF_DISCOVERY_MAX=3
fetcher get https://example.com
```

### Proxy rotation (rate-limited sites)
```bash
export SPARTA_STEP06_PROXY_HOST=gw.iproyal.com
export SPARTA_STEP06_PROXY_PORT=12321
export SPARTA_STEP06_PROXY_USER=team
export SPARTA_STEP06_PROXY_PASSWORD=secret
fetcher-etl --inventory urls.jsonl
```

### Brave/Wayback fallbacks
```bash
# Enable alternate URL resolution
export BRAVE_API_KEY=sk-your-key
fetcher-etl --use-alternates --inventory urls.jsonl
```

## Python API

```python
import asyncio
from fetcher.workflows.web_fetch import URLFetcher, FetchConfig, write_results
from pathlib import Path

async def main():
    config = FetchConfig(concurrency=4, per_domain=2)
    fetcher = URLFetcher(config)
    entries = [{"url": "https://www.nasa.gov"}]
    results, audit = await fetcher.fetch_many(entries)
    write_results(results, Path("artifacts/nasa.jsonl"))
    print(audit)

asyncio.run(main())
```

### Single URL helper
```python
from fetcher.workflows.fetcher import fetch_url

result = await fetch_url("https://example.com")
print(result.content_verdict)  # "ok", "empty", "paywall", etc.
print(result.text)             # Extracted text
```

## FetchResult Fields

| Field | Description |
|-------|-------------|
| `url` | Original URL |
| `final_url` | After redirects |
| `content_verdict` | `ok`, `empty`, `paywall`, `error`, etc. |
| `text` | Extracted text content |
| `file_path` | Path to raw download |
| `markdown_path` | Path to markdown (if enabled) |
| `from_cache` | Whether result came from cache |
| `content_sha256` | Content hash for change detection |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BRAVE_API_KEY` | Enable Brave search fallbacks |
| `FETCHER_EMIT_MARKDOWN` | Generate LLM-friendly markdown |
| `FETCHER_EMIT_FIT_MARKDOWN` | Generate pruned markdown |
| `FETCHER_DOWNLOAD_MODE` | `text`, `download_only`, `rolling_extract` |
| `FETCHER_HTTP_CACHE_DISABLE` | Disable HTTP caching |
| `FETCHER_ENABLE_PDF_DISCOVERY` | Auto-fetch embedded PDFs |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Playwright missing | `uvx --from "git+https://github.com/grahama1970/fetcher.git" playwright install chromium` |
| SPA page returns empty/thin | Playwright auto-fallback should trigger; check `used_playwright` in summary |
| Stale cached results | Set `FETCHER_HTTP_CACHE_DISABLE=1` for fresh fetch |
| Rate limited | Configure proxy rotation or reduce concurrency |
| Paywall detected | Check `content_verdict` and use alternates |
| Empty content | Check `junk_results.jsonl` for diagnosis |

Run `fetcher doctor` to check environment and dependencies.

## SPA/JavaScript Page Support

Fetcher automatically falls back to Playwright for known SPA domains. If a page returns thin/empty content:

1. Check if `used_playwright: 1` in `consumer_summary.json`
2. If not, the domain may need to be added to `SPA_FALLBACK_DOMAINS` in fetcher source
3. Force fresh fetch with `FETCHER_HTTP_CACHE_DISABLE=1`

### Managing SPA_FALLBACK_DOMAINS

To add a new domain that requires Playwright:

```python
# In fetcher source: src/fetcher/workflows/web_fetch.py
SPA_FALLBACK_DOMAINS = {
    "attack.mitre.org",   # React SPA
    "csf.tools",          # NIST CSF - JS-heavy
    "cwe.mitre.org",      # CWE definitions - JS-heavy
    # Add new domain here
}
```

**Seed to memory** for future agents:
```bash
# Use /memory skill to record successful strategy
.agents/skills/memory/run.sh learn \
  --problem "Fetching example.com returns empty JS shell" \
  --solution "Use Playwright for example.com (SPA). Add to SPA_FALLBACK_DOMAINS." \
  --tag "fetch" --tag "playwright" --tag "example.com"
```

## Content Extraction Pipeline

Understanding the extraction flow helps diagnose "empty content" bugs:

```
URL fetch
    ↓
raw HTML → result.text (initially)
    ↓
evaluate_result_content()
    ↓
trafilatura/readability extraction
    ↓
result.text = extracted_text (clean text, not HTML)
    ↓
downloads/     → raw HTML preserved
extracted_text/ → clean text output
```

**Critical**: `result.text` should contain **extracted text**, not raw HTML. If downstream sees `<!DOCTYPE html>`, the extraction step failed.

## Diagnostic Checklist

When content appears empty or wrong, check these fields in `consumer_summary.json`:

| Field | Expected | Problem If |
|-------|----------|------------|
| `status` | 200 | Non-200 = fetch failed |
| `method` | `aiohttp` or `playwright` | `playwright` expected for SPA domains |
| `verdict` | `ok` | `thin`/`empty` = extraction issue |
| `used_playwright` | 0 or 1 | 0 when SPA domain = missing from fallback list |

**Quick verification commands:**
```bash
# Check if Playwright was used
jq '.counts.used_playwright' consumer_summary.json

# Compare raw HTML vs extracted text
head -c 200 downloads/*.html          # Should see <!DOCTYPE html>
head -c 200 extracted_text/*.txt      # Should see clean text

# Verify content is meaningful
grep -c "expected-keyword" extracted_text/*.txt
```

## Common False Positives

Not all "empty content" issues need Playwright:

| Domain | Reality | Why |
|--------|---------|-----|
| `cwe.mitre.org` | Server-side rendered | Returns full HTML without JS |
| `capec.mitre.org` | Server-side rendered | Same as CWE |
| Most `.gov` sites | Static HTML | JS is progressive enhancement |

**Test before adding to SPA_FALLBACK_DOMAINS:**
```bash
# Fetch without Playwright
curl -s "https://example.com" | grep -c "<article>"

# If content exists in raw HTML, Playwright isn't needed
# The issue is likely in the extraction step, not rendering
```
