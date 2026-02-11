---
name: dogpile
description: >
  Deep research aggregator that searches Brave (Web), Perplexity (AI), GitHub (Code/Issues),
  ArXiv (Papers), YouTube (Videos), and Wayback Machine simultaneously.
  Provides a consolidated Markdown report with an ambiguity check and Agentic Handoff.
allowed-tools:
  - run_command
  - read_file
triggers:
  - dogpile
  - research
  - deep search
  - find code
  - search everything
metadata:
  short-description: Deep research aggregator (Web, AI, Code, Papers, Videos)
---

# Dogpile: Deep Research Aggregator

Orchestrate a multi-source deep search to "dogpile" on a problem from every angle.

## Analyzed Sources

1.  **Codex (🤖)**: High-reasoning technical starting point and final synthesis (gpt-5.2).
2.  **Perplexity (🧠)**: AI-synthesized deep answers and reasoning (Sonar Reasoning).
3.  **Brave Search (🌐)**: **Three-Stage Search** (Search → Evaluate → Deep Extract via /fetcher).
4.  **ArXiv (📄)**: **Three-Stage Search** (Abstracts → Details → Full Paper via /fetcher + /extractor).
5.  **YouTube (📺)**: **Two-Stage Search** (Metadata → Detailed Transcripts via Whisper/Direct).
6.  **GitHub (🐙)**: **Three-Stage Search**:
    - **Stage 1**: Search repositories and issues
    - **Stage 2**: Fetch README.md and metadata for top repos, agent evaluates relevance
    - **Stage 3**: Deep code search inside the selected repository
7.  **Wayback Machine (🏛️)**: Historical snapshots for URLs.

## Features

1.  **Query Tailoring**: Uses Codex to generate service-specific queries optimized for each source:
    - **ArXiv**: Academic/technical terms
    - **Perplexity**: Natural language questions
    - **Brave**: Documentation-style queries
    - **GitHub**: Code patterns, library names
    - **YouTube**: Tutorial-style phrases

2.  **Ambiguity Guard**: Uses Codex High Reasoning to analyze the query first. If ambiguous, it asks you for clarification before wasting resources.

3.  **Three-Stage Deep Dive**:
    - **ArXiv**: Fetches detailed metadata → Agent evaluates → Full PDF extraction via /fetcher + /extractor
    - **GitHub**: Fetches README + metadata → Agent evaluates most relevant repo → Deep code search
    - **Brave**: Fetches results → Agent evaluates → Full page extraction via /fetcher
    - **YouTube**: Extracts full transcripts for the most relevant videos

4.  **Codex Synthesis**: Consolidates all results into a coherent, high-reasoning conclusion.

5.  **Textual TUI Monitor**: Real-time progress tracking of all concurrent searches via `run.sh monitor`.

6.  **Resilience Features** (2025-2026 Best Practices):
    - **Per-provider semaphores**: Limits concurrent requests to avoid rate limit bans
    - **Exponential backoff with jitter**: Prevents thundering herd on retries (via tenacity)
    - **Rate limit header parsing**: Respects Retry-After, x-ratelimit-*, and IETF RateLimit-* headers
    - **Automatic retry**: Retries rate-limited requests after appropriate backoff

## GitHub Three-Stage Search

The GitHub search uses intelligent evaluation to find the most relevant repository:

```
Stage 1: Broad Search
├── Search repos: gh search repos "query"
├── Search issues: gh search issues "query"
└── Returns: Top 5 repos and issues

Stage 2: README Analysis & Evaluation
├── For top 3 repos:
│   ├── gh repo view <repo> --json ... (metadata)
│   ├── gh api repos/<repo>/readme (README content)
│   └── gh api repos/<repo>/languages (language breakdown)
├── Codex evaluates based on:
│   ├── README content relevance
│   ├── Topics and tags
│   ├── Language/tech stack match
│   └── Activity (stars, recent updates)
└── Returns: Selected target repository

Stage 3: Deep Code Search
├── gh api repos/<repo>/contents (file tree)
├── gh search code --repo <repo> "query" (code matches)
└── Returns: File structure + code locations with context
```

## Presets (For Security Research)

**Don't think about 100+ resources. Pick ONE preset:**

| Preset | Use When |
|--------|----------|
| `vulnerability_research` | CVE lookup, exploit availability |
| `red_team` | Privesc, bypasses, payloads |
| `blue_team` | Detection rules, threat hunting |
| `threat_intel` | APT groups, IOCs, campaigns |
| `malware_analysis` | Sample analysis, sandboxes |
| `osint` | Recon, domain intel |
| `bleeding_edge` | Latest zero-days |
| `community` | Reddit, Discord discussions |
| `general` | Non-security research |

```bash
# Use a preset (recommended for security research)
./run.sh search "CVE-2024-1234" --preset vulnerability_research
./run.sh search "privesc linux" --preset red_team

# Auto-detect preset from query
./run.sh search "CVE-2024-1234" --auto-preset

# List all presets
python dogpile.py presets
```

Presets use **Brave site: filters** to search curated domains (Exploit-DB, GTFOBins, MITRE ATT&CK, etc.) plus **direct API calls** for resources with APIs (NVD, CISA KEV, MalwareBazaar).

## Commands

| Command | Description |
|---------|-------------|
| `./run.sh search "query"` | Run a search |
| `./run.sh search "query" --preset NAME` | Search with a preset |
| `./run.sh monitor` | Open the Real-time TUI Monitor |
| `python dogpile.py presets` | List available presets |
| `python dogpile.py resources` | List all resources |
| `python dogpile.py errors` | View error summary |
| `python dogpile.py errors --json` | Get errors as JSON |
| `python dogpile.py errors --clear` | Clear error logs |

## Usage

```bash
# General research
./run.sh search "AI agent memory systems"

# Security research with preset
./run.sh search "CVE-2024-1234" --preset vulnerability_research
```

## Agentic Handoff

The skill automatically analyzes queries for ambiguity.

- If the query is clear (e.g., "python sort list"), it proceeds.
- If ambiguous (e.g., "apple"), it returns a JSON object with clarifying questions.
  - The calling agent should interpret this JSON and ask the user the questions.

## Error Reporting & Debugging

Dogpile tracks all errors, rate limits, and failures for agent debugging.

### Error Commands

```bash
# View error summary (human-readable)
python dogpile.py errors

# View errors as JSON (for agent parsing)
python dogpile.py errors --json

# Clear error logs
python dogpile.py errors --clear
```

### Error Logs

| File | Contents |
|------|----------|
| `dogpile_errors.json` | Structured error log (last 50 sessions) |
| `dogpile.log` | Human-readable log (timestamped) |
| `rate_limit_state.json` | Persistent rate limit tracking |
| `dogpile_state.json` | Real-time status for monitoring |

### Rate Limit Tracking

Rate limits are tracked per-provider with:
- Total hit count
- Exponential backoff multiplier
- Reset timestamps
- Last hit time

When a provider is rate-limited:
1. Error is logged to `dogpile_errors.json`
2. Backoff multiplier increases (up to 10x)
3. Status appears in `dogpile_state.json`
4. Summary shown at end of search

### Agent Debugging Workflow

```bash
# 1. Run search
./run.sh search "query"

# 2. If errors occurred, check summary
python dogpile.py errors --json | jq '.rate_limits'

# 3. View recent errors
python dogpile.py errors --json | jq '.recent_errors'

# 4. Check specific provider
cat dogpile_state.json | jq '.providers'
```

### Error Types

| Type | Description |
|------|-------------|
| `rate_limit` | HTTP 429 or rate limit headers detected |
| `timeout` | Request timed out |
| `auth_failure` | 401/403 authentication error |
| `network_error` | Connection failed |
| `api_error` | Provider API returned error |
| `parse_error` | Failed to parse response |
| `config_error` | Missing configuration |
| `dependency_missing` | Required module not installed |

## Task Monitor Integration

Dogpile integrates with `/task-monitor` for centralized progress tracking.

### Automatic Registration

Every search automatically:
1. Registers with `~/.pi/task-monitor/registry.json`
2. Writes progress to `dogpile_task_state.json`
3. Reports provider status and timing

### Progress Tracking

The task monitor state includes:
- Completed/total steps
- Per-provider status (pending, running, done, error, rate_limited)
- Per-provider timing
- Error count and recent errors
- Rate limit summary

### Viewing Progress

```bash
# Via task-monitor TUI
cd ~/.pi/skills/task-monitor
uv run python monitor.py tui --filter dogpile

# Direct state file
cat .pi/skills/dogpile/dogpile_task_state.json | jq

# Via task-monitor API (if running)
curl http://localhost:8765/tasks/dogpile-search
```

### Task State Schema

```json
{
  "completed": 12,
  "total": 16,
  "description": "Dogpile: AI agent skills 2026",
  "current_item": "synthesis",
  "stats": {
    "providers_done": 8,
    "providers_total": 9,
    "errors": 2,
    "rate_limits": 1
  },
  "provider_status": {
    "brave": "done",
    "perplexity": "error",
    "github": "done",
    "codex": "rate_limited"
  },
  "provider_times": {
    "brave": 3.2,
    "github": 12.4
  },
  "errors": [...],
  "elapsed_seconds": 45.2,
  "progress_pct": 75.0,
  "status": "running"
}
```
