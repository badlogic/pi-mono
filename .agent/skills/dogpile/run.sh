#!/bin/bash
# Dogpile skill runner

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure python environment (using uv as per convention if available, or just python)
# We assume dependencies are installed or we use the project environment

if command -v uv &> /dev/null; then
  EXEC=(uv run python)
else
  EXEC=(python3)
fi

if [ "$1" == "monitor" ]; then
  # Run monitor with textual dependency
  if command -v uv &> /dev/null; then
      uv run --with textual python "$SCRIPT_DIR/monitor.py"
  else
      python3 "$SCRIPT_DIR/monitor.py"
  fi
else
  # Run dogpile search
  # We use process substitution to tee stderr to the logfile AND back to stderr,
  # while leaving stdout (the report/JSON) untouched and pure.
  "${EXEC[@]}" "$SCRIPT_DIR/dogpile.py" "$@" 2> >(tee -a dogpile.log >&2)
fi
