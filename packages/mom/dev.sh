#!/usr/bin/env bash
set -e

CONTAINER_NAME="mom-sandbox"
DATA_DIR="$(pwd)/data"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Check if container exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    # Check if it's running
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Starting existing container: $CONTAINER_NAME"
        docker start "$CONTAINER_NAME"
    else
        echo "Container $CONTAINER_NAME already running"
    fi
else
    echo "Creating container: $CONTAINER_NAME"
    docker run -d \
        --name "$CONTAINER_NAME" \
        -v "$DATA_DIR:/workspace" \
        alpine:latest \
        tail -f /dev/null
fi

# Run mom with tsx watch mode
echo "Starting mom in dev mode..."
npx tsx --watch-path src --watch src/main.ts --sandbox=docker:$CONTAINER_NAME ./data
