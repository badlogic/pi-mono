#!/usr/bin/env bash
# Install the embry-agent systemd user service.
# Usage: bash install.sh [--uninstall]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="embry-agent.service"
UNIT_DIR="${HOME}/.config/systemd/user"

if [[ "${1:-}" == "--uninstall" ]]; then
    echo "[embry-agent] Uninstalling..."
    systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "${UNIT_DIR}/${SERVICE_NAME}"
    systemctl --user daemon-reload
    echo "[embry-agent] Uninstalled."
    exit 0
fi

echo "[embry-agent] Installing systemd user service..."

# Ensure unit directory exists
mkdir -p "$UNIT_DIR"

# Symlink the service file
ln -sf "${SCRIPT_DIR}/${SERVICE_NAME}" "${UNIT_DIR}/${SERVICE_NAME}"

# Reload systemd
systemctl --user daemon-reload

# Enable (start on login)
systemctl --user enable "$SERVICE_NAME"

echo "[embry-agent] Installed. Start with: systemctl --user start $SERVICE_NAME"
echo "[embry-agent] Check status: systemctl --user status $SERVICE_NAME"
echo "[embry-agent] View logs: journalctl --user -u $SERVICE_NAME -f"
