#!/bin/bash
# test_full_loop.sh
# Verifies the chain: Switchboard -> Memory(Archive) -> EdgeVerifier -> Graph

set -e

# Setup Paths
REGISTRY="$HOME/workspace/experiments/pi-mono/.pi/skills"
MEMORY_SCRIPT="$REGISTRY/memory/run.sh"
ARCHIVER_SCRIPT="$REGISTRY/episodic-archiver/run.sh"
TRANSCRIPT_FILE="/tmp/test_simulation.json"

echo "=== 1. Seeding Knowledge Graph ==="
# We need a target lesson for the verifier to find.
SEED_PROBLEM="How to test the verification loop?"
SEED_SOLUTION="Run this script and check ArangoDB."

# Use the memory skill to 'learn' this (creates a lesson)
$MEMORY_SCRIPT learn --problem "$SEED_PROBLEM" --solution "$SEED_SOLUTION"
echo "Seed lesson created."

echo "=== 2. Simulating Transcript (Switchboard Output) ==="
# Create a transcript that refers to the seed lesson
cat <<EOF > $TRANSCRIPT_FILE
{
  "session_id": "sim_test_session_$(date +%s)",
  "messages": [
    {
      "from": "user",
      "timestamp": $(date +%s),
      "type": "task",
      "content": "I need to verify the loop."
    },
    {
      "from": "agent",
      "timestamp": $(date +%s),
      "type": "completion",
      "content": "I figured it out! $SEED_SOLUTION"
    }
  ]
}
EOF
echo "Transcript generated at $TRANSCRIPT_FILE"

echo "=== 3. Running Archiver (Triggers Edge Verifier) ==="
# This should:
# a) Insert turns into agent_conversations
# b) Detect "Solution" category for the second message
# c) Trigger edge-verifier
# d) Find the seed lesson via KNN
# e) Insert an edge
$ARCHIVER_SCRIPT archive "$TRANSCRIPT_FILE"

echo "=== 4. Verifying Edge Insertion ==="
# We use a simple Python script to check the edge count for today
python3 -c "
import sys
import os
# Add memory/src to path so we can import graph_memory
sys.path.append('$HOME/workspace/experiments/memory/src')
# Add edge-verifier to path (optional if using graph_memory directly)
sys.path.append('$HOME/workspace/experiments/memory/.agents/skills/edge-verifier')

try:
    from graph_memory.arango_client import get_db
    db = get_db()
    # Check for edges created in the last minute
    import time
    now = int(time.time())
    query = 'FOR e IN lesson_edges FILTER e.created_at > @ts AND e.source == \"edge-verifier\" RETURN e'
    cursor = db.aql.execute(query, bind_vars={'ts': now - 60})
    edges = list(cursor)
    print(f'Found {len(edges)} new verified edges.')
    if len(edges) > 0:
        print('SUCCESS: Full verification loop passed!')
        for e in edges:
            print(f' - {e[\"_from\"]} -> {e[\"_to\"]} ({e.get(\"type\")})')
    else:
        print('FAILURE: No edges found. Check logs.')
        sys.exit(1)
except Exception as e:
    print(f'Error querying DB: {e}')
    sys.exit(1)
"
