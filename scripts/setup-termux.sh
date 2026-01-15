#!/bin/bash
# Setup script for running pi-mono on Termux (Android)

set -e

echo "Setting up pi-mono for Termux..."

# Check if we're running on Termux
if [ -z "$TERMUX_VERSION" ]; then
    echo "Warning: TERMUX_VERSION not set. This script is intended for Termux."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Install dependencies (skip native module builds)
echo "Installing dependencies..."
npm install --ignore-scripts

# Create tsgo wrapper (tsgo's native binaries don't support Android ARM64)
echo "Creating tsgo wrapper..."
cat > node_modules/.bin/tsgo << 'EOF'
#!/bin/sh
# Wrapper for tsgo that falls back to tsc on Termux
exec "$(dirname "$0")/tsc" "$@"
EOF
chmod +x node_modules/.bin/tsgo

echo ""
echo "Setup complete! Now run:"
echo "  npm run build"
echo ""
echo "This will take several minutes on Android devices."
echo ""
echo "After building, you can run:"
echo "  ./packages/coding-agent/dist/cli.js"
