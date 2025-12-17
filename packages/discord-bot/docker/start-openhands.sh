#!/bin/bash
# Start OpenHands Docker container

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment variables from parent .env
export $(grep -E "^ZAI_API_KEY=" ../env 2>/dev/null | xargs)

# Check if container is running
if docker ps | grep -q pi-openhands; then
    echo "[OpenHands] Already running"
    exit 0
fi

# Check if container exists but stopped
if docker ps -a | grep -q pi-openhands; then
    echo "[OpenHands] Starting existing container..."
    docker start pi-openhands
else
    echo "[OpenHands] Creating and starting new container..."
    docker compose -f docker-compose.openhands.yml up -d
fi

# Wait for service to be ready
echo "[OpenHands] Waiting for service..."
for i in {1..30}; do
    if curl -s http://localhost:3100/health > /dev/null 2>&1; then
        echo "[OpenHands] Service ready on port 3100"
        exit 0
    fi
    sleep 1
done

echo "[OpenHands] Warning: Service may not be ready"
exit 1
