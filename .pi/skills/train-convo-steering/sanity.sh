#!/bin/bash
# Sanity check for train-convo-steering
# This script is required by best-practices-skills/SKILL.md

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"

# Run the python sanity tests
"$SCRIPT_DIR/run.sh" "$SCRIPT_DIR/sanity/test_sanity.py"
