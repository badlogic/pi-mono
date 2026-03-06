# @mariozechner/pi-stats

Local observability dashboard for pi session usage statistics.

## Features

- Incremental sync from pi session JSONL files
- SQLite-backed aggregates via `better-sqlite3`
- Local HTTP dashboard with JSON API
- CLI modes for `serve`, `sync`, and `json`

## CLI

```bash
pi-stats              # start the local dashboard server
pi-stats --sync       # sync session files and print a text summary
pi-stats --json       # sync and print full stats JSON
pi-stats --port 8080  # serve on a custom port
```

## API

- `GET /api/stats`
- `GET /api/stats/recent?limit=50`
- `GET /api/stats/errors?limit=50`
- `GET /api/stats/models`
- `GET /api/stats/folders`
- `GET /api/stats/timeseries`
- `GET /api/request/:id`
- `GET /api/sync`

## Storage

By default the package reads sessions from `~/.pi/agent/sessions` and stores metrics in `~/.pi/stats.db`.

Supported overrides:

- `PI_CODING_AGENT_DIR`
- `PI_STATS_CONFIG_DIR`
- `PI_STATS_DB_PATH`
- `PI_STATS_SESSIONS_DIR`
