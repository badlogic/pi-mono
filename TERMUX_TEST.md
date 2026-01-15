# Termux Testing Checklist

Test from a clean phone to verify the termux-support branch works.

## Setup Steps

```bash
# 1. Install prerequisites
pkg update
pkg install git nodejs-lts

# 2. Clone repository
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/VaclavSynacek/pi-mono.git
cd pi-mono
git checkout termux-support

# 3. Run setup script
./scripts/setup-termux.sh

# 4. Build
npm run build
```

Expected: Build completes successfully (takes 5-10 minutes on slow devices)

## Run Test

```bash
# 5. Test help command
./packages/coding-agent/dist/cli.js --help
```

Expected: Shows help text with all options

## Smoke Test

```bash
# 6. Set API key (use real key)
export ANTHROPIC_API_KEY="your-key-here"

# 7. Run simple test
echo "Create a hello.txt file with 'Hello from Termux'" | ./packages/coding-agent/dist/cli.js
```

Expected: 
- Agent starts
- Shows interface
- Can interact with model
- Creates file successfully

## What to Check

- ✅ No "gyp ERR!" during npm install (using --ignore-scripts)
- ✅ No "Cannot find module @typescript/native-preview-android-arm64" (using tsc wrapper)
- ✅ No "Cannot find module @mariozechner/clipboard" (optional import)
- ✅ No TypeScript errors about ES2024 regex flags (tsconfig updated)
- ✅ Agent runs and can execute commands

## Known Warnings (OK to ignore)

- "fd not found. Downloading... Failed to download fd: Unsupported platform: android/arm64"
  - fd is a file finder tool, fallback to 'find' command works fine

## If Something Fails

Check git status to ensure no local modifications needed:
```bash
git status
```

Should show clean working tree after running setup script.
