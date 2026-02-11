#!/bin/bash
# Self-contained fetcher skill - auto-installs via uvx
# Usage: ./run.sh get https://example.com

# Load .env from current directory or parent directories
load_dotenv() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.env" ]]; then
            set -a  # Auto-export variables
            source "$dir/.env" 2>/dev/null || true
            set +a
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    # Also check home directory
    if [[ -f "$HOME/.env" ]]; then
        set -a
        source "$HOME/.env" 2>/dev/null || true
        set +a
    fi
}

load_dotenv

# Load canonical fetcher .env for BRAVE_API_KEY if not already set
if [[ -z "$BRAVE_API_KEY" && -f "/home/graham/workspace/experiments/fetcher/.env" ]]; then
    set -a
    source "/home/graham/workspace/experiments/fetcher/.env" 2>/dev/null || true
    set +a
fi

# Git source for fetcher (pinned to stable commit)
REPO="git+https://github.com/grahama1970/fetcher.git@35c4983729d05ca3fd7825b04c67b518f5567a6c"

# Playwright browser marker
PW_MARKER="$HOME/.cache/fetcher-playwright-installed"

# Default to emitting markdown (most useful for LLM agents)
export FETCHER_EMIT_MARKDOWN="${FETCHER_EMIT_MARKDOWN:-1}"
export FETCHER_EMIT_FIT_MARKDOWN="${FETCHER_EMIT_FIT_MARKDOWN:-1}"

# Auto-install Playwright browsers on first run (one-time)
ensure_playwright() {
    if [[ ! -f "$PW_MARKER" ]]; then
        # Check if chromium exists in playwright cache
        if ! find "$HOME/.cache/ms-playwright" -name "chromium-*" -type d 2>/dev/null | grep -q .; then
            echo "[fetcher] First run: Installing Playwright browsers for SPA support..." >&2
            if ! uvx --from "$REPO" playwright install chromium >&2; then
                echo "[fetcher] Warning: Playwright install failed. SPA pages may not render." >&2
            fi
        fi
        mkdir -p "$(dirname "$PW_MARKER")"
        touch "$PW_MARKER"
    fi
}

# Main execution
if command -v uvx &> /dev/null; then
    ensure_playwright
    uvx --from "$REPO" fetcher "$@"
    exit_code=$?
elif command -v uv &> /dev/null; then
    ensure_playwright
    uv tool run --from "$REPO" fetcher "$@"
    exit_code=$?
elif command -v fetcher &> /dev/null; then
    fetcher "$@"
    exit_code=$?
else
    echo "Error: Neither uv nor fetcher found" >&2
    echo "Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    exit 1
fi

# Exit code 3 = success with soft failures (e.g., missing BRAVE_API_KEY)
# This is normal and doesn't indicate a problem
if [[ $exit_code -eq 3 ]]; then
    exit 0
fi

# Provide context on actual failures
if [[ $exit_code -ne 0 ]]; then
    echo "" >&2
    echo "[fetcher] Command failed with exit code $exit_code" >&2
    echo "[fetcher] Run './sanity.sh' to diagnose issues" >&2
fi

exit $exit_code
