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

# Update TypeScript target to ES2024 (required for regex v flag)
echo "Updating TypeScript configuration..."
if [ -f tsconfig.base.json ]; then
    # Backup original
    cp tsconfig.base.json tsconfig.base.json.backup
    
    # Update target and lib to ES2024
    sed -i 's/"target": "ES2022"/"target": "ES2024"/' tsconfig.base.json
    sed -i 's/"lib": \["ES2022"\]/"lib": ["ES2024"]/' tsconfig.base.json
    
    echo "TypeScript configuration updated (backup saved as tsconfig.base.json.backup)"
fi

echo ""
echo "Setup complete! Now run:"
echo "  npm run build"
echo ""
echo "This will take several minutes on Android devices."
echo ""
echo "After building, you can run:"
echo "  ./packages/coding-agent/dist/cli.js"
