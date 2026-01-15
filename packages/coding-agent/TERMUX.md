# Running pi-coding-agent on Termux (Android)

## Installation

Install [Termux](https://f-droid.org/en/packages/com.termux/) from F-Droid, then run:

```bash
pkg update && pkg install git nodejs-lts
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/VaclavSynacek/pi-mono.git
cd pi-mono
git checkout termux-support
./scripts/setup-termux.sh
npm run build
```

Building takes 5-10 minutes on older devices.

## Running

```bash
./packages/coding-agent/dist/cli.js --help
```

Set your API key:

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

Start coding:

```bash
./packages/coding-agent/dist/cli.js
```

## Limitations

- **No image support**: photon-node and canvas cannot build on Android ARM64
- **fd warning**: File finder not available for Android, falls back to `find` command

## Tips

- Use tmux for better terminal management
- Use an external keyboard for easier coding
- Keep device plugged in during builds
