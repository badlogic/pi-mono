#!/usr/bin/env bash
#
# Switchboard Service Manager
#
# Usage:
#   switchboard.sh start   - Start the Switchboard daemon
#   switchboard.sh stop    - Stop the Switchboard daemon
#   switchboard.sh restart - Restart the Switchboard daemon
#   switchboard.sh status  - Check if Switchboard is running
#   switchboard.sh logs    - Tail the log file
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/switchboard.pid"
LOG_FILE="$SCRIPT_DIR/switchboard.log"
PORT="${SWITCHBOARD_PORT:-7890}"

is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

start() {
    if is_running; then
        echo "Switchboard is already running (PID: $(cat "$PID_FILE"))"
        exit 0
    fi

    echo "Starting Switchboard on port $PORT..."

    # Ensure tsx is available
    if ! command -v npx &> /dev/null; then
        echo "Error: npx not found. Please install Node.js."
        exit 1
    fi

    # Start in background, redirect output to log
    nohup npx tsx "$SCRIPT_DIR/index.ts" >> "$LOG_FILE" 2>&1 &
    local pid=$!

    # Wait a moment for startup
    sleep 1

    if ps -p "$pid" > /dev/null 2>&1; then
        echo "$pid" > "$PID_FILE"
        echo "Switchboard started (PID: $pid)"
        echo "Log file: $LOG_FILE"
        echo "URL: http://127.0.0.1:$PORT"
    else
        echo "Failed to start Switchboard. Check logs: $LOG_FILE"
        exit 1
    fi
}

stop() {
    if ! is_running; then
        echo "Switchboard is not running"
        [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
        exit 0
    fi

    local pid
    pid=$(cat "$PID_FILE")
    echo "Stopping Switchboard (PID: $pid)..."

    kill "$pid" 2>/dev/null || true

    # Wait for graceful shutdown
    local count=0
    while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 10 ]; do
        sleep 0.5
        count=$((count + 1))
    done

    # Force kill if still running
    if ps -p "$pid" > /dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
    fi

    rm -f "$PID_FILE"
    echo "Switchboard stopped"
}

status() {
    if is_running; then
        local pid
        pid=$(cat "$PID_FILE")
        echo "Switchboard is running (PID: $pid)"

        # Try to get health status
        if command -v curl &> /dev/null; then
            local health
            health=$(curl -s "http://127.0.0.1:$PORT/health" 2>/dev/null || echo '{"error":"unavailable"}')
            echo "Health: $health"
        fi
    else
        echo "Switchboard is not running"
        exit 1
    fi
}

logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "No log file found at $LOG_FILE"
        exit 1
    fi
}

case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 1
        start
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
