#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Create venv if needed
if [[ ! -d .venv ]]; then
    uv venv .venv
fi

PYTHON_BIN=".venv/bin/python"

# Ensure required runtime deps exist; install package if missing/broken.
if ! "$PYTHON_BIN" -c "import pydantic, task_monitor" >/dev/null 2>&1; then
    uv pip install --python "$PYTHON_BIN" -e .
fi

# Run the task-monitor Typer CLI.
"$PYTHON_BIN" monitor.py "$@"
