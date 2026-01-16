#!/bin/bash
PROJECT_ROOT="/home/graham/workspace/experiments/memory"
export PYTHONPATH="$PROJECT_ROOT/src:$PYTHONPATH"

echo "Checking graph_memory import..."
echo "PYTHONPATH=$PYTHONPATH"
ls -l "$PROJECT_ROOT/src/graph_memory/__init__.py"

python3 -c "import sys; print(sys.path); import graph_memory; print('Success:', graph_memory)"
