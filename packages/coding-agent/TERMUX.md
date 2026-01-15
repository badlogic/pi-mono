# Running pi-coding-agent on Termux (Android)

This guide explains how to run pi-coding-agent on Android devices using Termux.

## Prerequisites

1. Install [Termux](https://f-droid.org/en/packages/com.termux/) from F-Droid (recommended) or GitHub releases
2. Open Termux and install required packages:

```bash
pkg update
pkg install git nodejs-lts
```

## Installation

### Quick Setup (Recommended)

1. Clone the repository:

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/VaclavSynacek/pi-mono.git
cd pi-mono
git checkout termux-support
```

2. Run the Termux setup script:

```bash
./scripts/setup-termux.sh
```

3. Build the project:

```bash
npm run build
```

This will take several minutes on older Android devices.

### Manual Setup

If you prefer to set up manually or the script doesn't work:

1. Clone the repository (same as above)

2. Install dependencies (skip native module builds):

```bash
npm install --ignore-scripts
```

3. Create a tsgo wrapper (tsgo's native binaries don't support Android ARM64):

```bash
cat > node_modules/.bin/tsgo << 'EOF'
#!/bin/sh
# Wrapper for tsgo that falls back to tsc on Termux
exec "$(dirname "$0")/tsc" "$@"
EOF
chmod +x node_modules/.bin/tsgo
```

4. Update TypeScript target to ES2024 (required for regex v flag):

```bash
sed -i 's/"target": "ES2022"/"target": "ES2024"/' tsconfig.base.json
sed -i 's/"lib": \["ES2022"\]/"lib": ["ES2024"]/' tsconfig.base.json
```

5. Build the project:

```bash
npm run build
```

## Running

```bash
cd ~/projects/pi-mono
./packages/coding-agent/dist/cli.js --help
```

Set up your API key (example for Anthropic):

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

Start coding:

```bash
./packages/coding-agent/dist/cli.js
```

## Limitations

On Termux, the following features are not available:

- **Image support**: The photon-node and canvas packages cannot be built on Android ARM64, so image conversion and clipboard image reading are disabled
- **Clipboard operations**: The @mariozechner/clipboard package is not available; clipboard operations will fall back to shell commands where possible

## Troubleshooting

### npm install fails with "gyp ERR!"

Use `--ignore-scripts` to skip native module builds:

```bash
npm install --ignore-scripts
```

### Build is very slow

This is normal on older Android devices. The TypeScript compilation can take 5-10 minutes. Be patient.

### "Cannot find module" errors

Make sure you've created the tsgo wrapper script and made it executable.

## Tips

- Use a terminal multiplexer like tmux for better terminal management
- Consider using an external keyboard for better coding experience
- Keep your device plugged in during builds to avoid battery drain
