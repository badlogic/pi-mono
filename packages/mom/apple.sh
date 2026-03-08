#!/usr/bin/env bash

# Mom Apple Container Sandbox Management Script
# Usage:
#   ./apple.sh create <data-dir>   - Create and start the container
#   ./apple.sh start               - Start the container
#   ./apple.sh stop                - Stop the container
#   ./apple.sh remove              - Remove the container
#   ./apple.sh status              - Check container status
#   ./apple.sh shell               - Open a shell in the container

CONTAINER_NAME="mom-sandbox"
IMAGE="alpine:latest"

check_macos_version() {
  if [[ "$(uname)" != "Darwin" ]]; then
    echo "Error: Apple container is only available on macOS"
    exit 1
  fi

  local version
  version=$(sw_vers -productVersion)
  local major_version
  major_version=$(echo "$version" | cut -d. -f1)

  if [[ "$major_version" -lt 26 ]]; then
    echo "Error: Apple container requires macOS 26 (Tahoe) or later. Current version: $version"
    exit 1
  fi
}

check_container_cli() {
  if ! command -v container &> /dev/null; then
    echo "Error: Apple container CLI is not installed or not in PATH"
    echo "Install it from: https://github.com/apple/container/releases"
    exit 1
  fi
}

check_system_status() {
  local status
  status=$(container system status --format json 2>/dev/null)
  if [[ -z "$status" ]]; then
    echo "Error: Apple container system is not running."
    echo "Start it with: container system start"
    exit 1
  fi
  if ! echo "$status" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('status')=='running' else 1)" 2>/dev/null; then
    echo "Error: Apple container system is not running."
    echo "Start it with: container system start"
    exit 1
  fi
}

case "$1" in
  create)
    if [ -z "$2" ]; then
      echo "Usage: $0 create <data-dir>"
      echo "Example: $0 create ./data"
      exit 1
    fi

    check_macos_version
    check_container_cli
    check_system_status

    DATA_DIR=$(cd "$2" && pwd)

    # Check if container already exists
    if container list --format json 2>/dev/null | python3 -c "import sys,json; containers=json.load(sys.stdin); exit(0 if any(c.get('configuration',{}).get('id')=='${CONTAINER_NAME}' for c in containers) else 1)"; then
      echo "Container '${CONTAINER_NAME}' already exists. Remove it first with: $0 remove"
      exit 1
    fi

    echo "Creating container '${CONTAINER_NAME}'..."
    echo "  Data dir: ${DATA_DIR} -> /workspace"

    # Pull the image first if not available
    echo "Pulling image '${IMAGE}'..."
    container image pull "$IMAGE"

    # Create and run the container
    container run -d \
      --name "$CONTAINER_NAME" \
      -v "${DATA_DIR}:/workspace" \
      "$IMAGE" \
      tail -f /dev/null

    if [ $? -eq 0 ]; then
      echo "Container created and running."
      echo ""
      echo "Run mom with: mom --sandbox=apple:${CONTAINER_NAME} $2"
    else
      echo "Failed to create container."
      exit 1
    fi
    ;;

  start)
    check_container_cli
    check_system_status

    echo "Starting container '${CONTAINER_NAME}'..."
    container start "$CONTAINER_NAME"
    ;;

  stop)
    check_container_cli

    echo "Stopping container '${CONTAINER_NAME}'..."
    container stop "$CONTAINER_NAME"
    ;;

  remove)
    check_container_cli

    echo "Removing container '${CONTAINER_NAME}'..."
    container delete -f "$CONTAINER_NAME" 2>/dev/null || container rm -f "$CONTAINER_NAME" 2>/dev/null || {
      echo "Note: Container may not exist or already removed"
    }
    ;;

  status)
    check_container_cli
    check_system_status
    
    # Check running containers
    if container list --format json 2>/dev/null | python3 -c "import sys,json; containers=json.load(sys.stdin); exit(0 if any(c.get('configuration',{}).get('id')=='${CONTAINER_NAME}' for c in containers) else 1)"; then
      echo "Container '${CONTAINER_NAME}' is running."
      container list --format json 2>/dev/null | python3 -c "import sys,json; containers=json.load(sys.stdin); c=[c for c in containers if c.get('configuration',{}).get('id')=='${CONTAINER_NAME}'][0]; print(f\"ID: {c['configuration']['id']}\"); print(f\"Status: {c['status']}\"); print(f\"Address: {c['networks'][0]['ipv4Address'] if c.get('networks') else 'N/A'}\");"
    else
      echo "Container '${CONTAINER_NAME}' does not exist or is not running."
      echo "Create it with: $0 create <data-dir>"
    fi
    ;;

  shell)
    check_container_cli
    check_system_status

    echo "Opening shell in '${CONTAINER_NAME}'..."
    container exec -it "$CONTAINER_NAME" /bin/sh
    ;;

  *)
    echo "Mom Apple Container Sandbox Management"
    echo ""
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  create <data-dir>  - Create and start the container"
    echo "  start              - Start the container"
    echo "  stop               - Stop the container"
    echo "  remove             - Remove the container"
    echo "  status             - Check container status"
    echo "  shell              - Open a shell in the container"
    echo ""
    echo "Requirements:"
    echo "  - macOS 26 (Tahoe) or later"
    echo "  - Apple silicon (M1/M2/M3/M4)"
    echo "  - Apple container CLI (https://github.com/apple/container)"
    ;;
esac
