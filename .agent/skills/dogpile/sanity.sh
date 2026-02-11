#!/bin/bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Dogpile Skill Sanity ==="

# Check run.sh
if [[ -x "$SCRIPT_DIR/run.sh" ]]; then
    echo "  [PASS] run.sh exists"
else
    echo "  [FAIL] run.sh missing"
    exit 1
fi

# Check --help
if "$SCRIPT_DIR/run.sh" --help >/dev/null; then
    echo "  [PASS] run.sh --help works"
else
    echo "  [FAIL] run.sh --help failed"
    exit 1
fi

# Check module structure
echo ""
echo "=== Module Structure Check ==="
MODULES=(
    "config.py"
    "utils.py"
    "brave.py"
    "perplexity.py"
    "arxiv_search.py"
    "github_search.py"
    "github_deep.py"
    "youtube_search.py"
    "wayback.py"
    "codex.py"
    "discord.py"
    "readarr.py"
    "formatters.py"
    "synthesis.py"
    "cli.py"
    "__init__.py"
)

for mod in "${MODULES[@]}"; do
    if [[ -f "$SCRIPT_DIR/$mod" ]]; then
        # Check line count
        lines=$(wc -l < "$SCRIPT_DIR/$mod")
        if [[ $lines -lt 500 ]]; then
            echo "  [PASS] $mod exists ($lines lines < 500)"
        else
            echo "  [WARN] $mod exists but has $lines lines (> 500)"
        fi
    else
        echo "  [FAIL] $mod missing"
        exit 1
    fi
done

# Check monolith backup
if [[ -f "$SCRIPT_DIR/dogpile_monolith.py" ]]; then
    echo "  [PASS] dogpile_monolith.py backup exists"
else
    echo "  [WARN] dogpile_monolith.py backup not found (may be intentional)"
fi

# Check Python imports
echo ""
echo "=== Python Import Check ==="
cd "$SCRIPT_DIR"
if python3 -c "
import sys
sys.path.insert(0, '$(dirname $SCRIPT_DIR)')

# Test all module imports
from dogpile.config import app, console, SKILLS_DIR, VERSION
from dogpile.utils import run_command, log_status, with_semaphore
from dogpile.brave import search_brave
from dogpile.perplexity import search_perplexity
from dogpile.arxiv_search import search_arxiv
from dogpile.github_search import search_github
from dogpile.youtube_search import search_youtube
from dogpile.wayback import search_wayback
from dogpile.codex import search_codex
from dogpile.discord import search_discord_messages
from dogpile.readarr import search_readarr
from dogpile.synthesis import generate_report

print('All imports successful')
" 2>&1; then
    echo "  [PASS] All module imports work"
else
    echo "  [FAIL] Module import failed"
    exit 1
fi

# Check circular imports
echo ""
echo "=== Circular Import Check ==="
if python3 -c "
import sys
sys.path.insert(0, '$(dirname $SCRIPT_DIR)')
from dogpile.cli import app, search
print('No circular imports detected')
" 2>&1; then
    echo "  [PASS] No circular imports"
else
    echo "  [FAIL] Circular import detected"
    exit 1
fi

# Check dependencies
echo ""
echo "=== Dependency Check ==="
for cmd in gh yt-dlp python3; do
    if command -v "$cmd" &> /dev/null; then
        echo "  [PASS] Dependency '$cmd' found"
    else
        echo "  [WARN] Dependency '$cmd' missing (some sources will fail)"
        # Note: We don't exit 1 here as some sources might still work
    fi
done

# Check sub-skills
echo ""
echo "=== Sub-skill Check ==="
for skill in arxiv perplexity brave-search codex ingest-youtube; do
    if [[ -d "$SCRIPT_DIR/../$skill" ]]; then
        echo "  [PASS] Sub-skill '$skill' found"
    else
        echo "  [FAIL] Sub-skill '$skill' missing in $(dirname "$SCRIPT_DIR")"
        MISSING=1
    fi
done

if [[ ${MISSING:-0} -eq 1 ]]; then
    echo "Result: FAIL"
    exit 1
fi

# CLI Commands Check
echo ""
echo "=== CLI Commands Check ==="

# Check version command
if "$SCRIPT_DIR/run.sh" version 2>&1 | grep -q "Dogpile v"; then
    echo "  [PASS] version command works"
else
    echo "  [FAIL] version command failed"
    exit 1
fi

# Skip full search test if --quick flag passed
if [[ "$1" == "--quick" ]]; then
    echo ""
    echo "=== Quick Mode: Skipping functional search test ==="
    echo "Result: PASS (quick)"
    exit 0
fi

# Functional Check: Mock/Quick Search
echo ""
echo "=== Functional Search Test ==="
echo "  [INFO] Running functional search test (AI agent memory)..."
# We use --no-interactive to skip the user interview and test the search stage
# We use a timeout to prevent hanging if a source is stuck
REPORT=$(timeout 120 "$SCRIPT_DIR/run.sh" search "AI agent memory" --no-interactive 2>&1 || echo "TIMEOUT")

if echo "$REPORT" | grep -q "Dogpile Report"; then
    echo "  [PASS] Functional search: Report generated"
else
    echo "  [FAIL] Functional search: Report missing or failed"
    echo "         Output: ${REPORT:0:500}"
    exit 1
fi

if echo "$REPORT" | grep -q "Codex"; then
    echo "  [PASS] Functional search: Codex section present"
else
    echo "  [WARN] Functional search: Codex section missing (may be expected if codex unavailable)"
fi

# Check state file
if [[ -f "$SCRIPT_DIR/dogpile_state.json" ]]; then
    if grep -q "DONE" "$SCRIPT_DIR/dogpile_state.json"; then
        echo "  [PASS] Functional search: State file updated correctly"
    else
        echo "  [WARN] Functional search: State file has no 'DONE' status"
    fi
else
    echo "  [WARN] Functional search: dogpile_state.json not created"
fi

echo ""
echo "Result: PASS"
