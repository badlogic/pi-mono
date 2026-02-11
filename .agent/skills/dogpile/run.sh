#!/bin/bash
# Dogpile skill runner

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$(dirname "$SCRIPT_DIR")"

# Ensure python environment (using uv as per convention if available, or just python)
# We assume dependencies are installed or we use the project environment

if command -v uv &> /dev/null; then
  EXEC=(uv run python)
else
  EXEC=(python3)
fi

# Route to specialized discover skills for media types
case "$1" in
  movies|movie)
    # Route to discover-movies skill
    shift
    if [[ -x "$SKILLS_DIR/discover-movies/run.sh" ]]; then
      echo "[dogpile] Routing to discover-movies..." >&2
      # Parse query for bridge or similar commands
      if [[ -n "$1" ]]; then
        # Check if first arg is a bridge attribute
        case "$1" in
          Precision|Resilience|Fragility|Corruption|Loyalty|Stealth)
            exec "$SKILLS_DIR/discover-movies/run.sh" bridge "$@"
            ;;
          *)
            # Default to similar search
            exec "$SKILLS_DIR/discover-movies/run.sh" similar "$@"
            ;;
        esac
      else
        exec "$SKILLS_DIR/discover-movies/run.sh" trending --json
      fi
    else
      echo "[dogpile] discover-movies skill not found, falling back to search" >&2
      "${EXEC[@]}" "$SCRIPT_DIR/cli.py" search "movie recommendations $*" 2> >(tee -a dogpile.log >&2)
    fi
    ;;
  books|book)
    # Route to discover-books skill
    shift
    if [[ -x "$SKILLS_DIR/discover-books/run.sh" ]]; then
      echo "[dogpile] Routing to discover-books..." >&2
      # Parse query for bridge or similar commands
      if [[ -n "$1" ]]; then
        # Check if first arg is a bridge attribute
        case "$1" in
          Precision|Resilience|Fragility|Corruption|Loyalty|Stealth)
            exec "$SKILLS_DIR/discover-books/run.sh" bridge "$@"
            ;;
          *)
            # Default to similar search
            exec "$SKILLS_DIR/discover-books/run.sh" similar "$@"
            ;;
        esac
      else
        exec "$SKILLS_DIR/discover-books/run.sh" trending --json
      fi
    else
      echo "[dogpile] discover-books skill not found, falling back to search" >&2
      "${EXEC[@]}" "$SCRIPT_DIR/cli.py" search "book recommendations $*" 2> >(tee -a dogpile.log >&2)
    fi
    ;;
  music)
    # Route to discover-music skill
    shift
    if [[ -x "$SKILLS_DIR/discover-music/run.sh" ]]; then
      echo "[dogpile] Routing to discover-music..." >&2
      if [[ -n "$1" ]]; then
        case "$1" in
          Precision|Resilience|Fragility|Corruption|Loyalty|Stealth)
            exec "$SKILLS_DIR/discover-music/run.sh" bridge "$@"
            ;;
          *)
            exec "$SKILLS_DIR/discover-music/run.sh" similar "$@"
            ;;
        esac
      else
        exec "$SKILLS_DIR/discover-music/run.sh" trending --json
      fi
    else
      echo "[dogpile] discover-music skill not found, falling back to search" >&2
      "${EXEC[@]}" "$SCRIPT_DIR/cli.py" search "music recommendations $*" 2> >(tee -a dogpile.log >&2)
    fi
    ;;
  monitor)
    # Run monitor with textual dependency
    if command -v uv &> /dev/null; then
        uv run --with textual python "$SCRIPT_DIR/monitor.py"
    else
        python3 "$SCRIPT_DIR/monitor.py"
    fi
    ;;
  *)
    # Run dogpile search
    # We use process substitution to tee stderr to the logfile AND back to stderr,
    # while leaving stdout (the report/JSON) untouched and pure.
    "${EXEC[@]}" "$SCRIPT_DIR/cli.py" "$@" 2> >(tee -a dogpile.log >&2)
    ;;
esac
