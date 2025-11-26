# Mom Docker Sandbox

## Overview

Mom can run tools either directly on the host or inside a Docker container for isolation.

## Why Docker?

When mom runs on your machine and is accessible via Slack, anyone in your workspace could potentially:
- Execute arbitrary commands on your machine
- Access your files, credentials, etc.
- Cause damage via prompt injection

The Docker sandbox isolates mom's tools to a container where she can only access what you explicitly mount.

## Quick Start

```bash
# 1. Create and start the container
cd packages/mom
./docker.sh create ./data

# 2. Run mom with Docker sandbox
mom --sandbox=docker:mom-sandbox ./data
```

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  Host                                               │
│                                                     │
│  mom process (Node.js)                              │
│  ├── Slack connection                               │
│  ├── LLM API calls                                  │
│  └── Tool execution ──────┐                         │
│                           ▼                         │
│              ┌─────────────────────────┐            │
│              │  Docker Container       │            │
│              │  ├── bash, git, gh, etc │            │
│              │  └── /workspace (mount) │            │
│              └─────────────────────────┘            │
└─────────────────────────────────────────────────────┘
```

- Mom process runs on host (handles Slack, LLM calls)
- All tool execution (`bash`, `read`, `write`, `edit`) happens inside the container
- Only `/workspace` (your data dir) is accessible to the container

## Container Setup

Use the provided script:

```bash
./docker.sh create <data-dir>   # Create and start container
./docker.sh start               # Start existing container
./docker.sh stop                # Stop container
./docker.sh remove              # Remove container
./docker.sh status              # Check if running
./docker.sh shell               # Open shell in container
```

Or manually:

```bash
docker run -d --name mom-sandbox \
  -v /path/to/mom-data:/workspace \
  alpine:latest tail -f /dev/null
```

## Mom Manages Her Own Computer

The container is treated as mom's personal computer. She can:

- Install tools: `apk add github-cli git curl`
- Configure credentials: `gh auth login`
- Create files and directories
- Persist state across restarts

When mom needs a tool, she installs it. When she needs credentials, she asks you.

### Example Flow

```
User: "@mom check the spine-runtimes repo"
Mom:  "I need gh CLI. Installing..."
      (runs: apk add github-cli)
Mom:  "I need a GitHub token. Please provide one."
User: "ghp_xxxx..."
Mom:  (runs: echo "ghp_xxxx" | gh auth login --with-token)
Mom:  "Done. Checking repo..."
```

## Persistence

The container persists across:
- `docker stop` / `docker start`
- Host reboots

Installed tools and configs remain until you `docker rm` the container.

To start fresh: `./docker.sh remove && ./docker.sh create ./data`

## CLI Options

```bash
# Run on host (default, no isolation)
mom ./data

# Run with Docker sandbox
mom --sandbox=docker:mom-sandbox ./data

# Explicit host mode
mom --sandbox=host ./data
```

## Security Considerations

**What the container CAN do:**
- Read/write files in `/workspace` (your data dir)
- Make network requests (for git, gh, curl, etc.)
- Install packages
- Run any commands

**What the container CANNOT do:**
- Access files outside `/workspace`
- Access your host's credentials
- Affect your host system

**For maximum security:**
1. Create a dedicated GitHub bot account with limited repo access
2. Only share that bot's token with mom
3. Don't mount sensitive directories

## Troubleshooting

### Container not running
```bash
./docker.sh status  # Check status
./docker.sh start   # Start it
```

### Reset container
```bash
./docker.sh remove
./docker.sh create ./data
```

### Missing tools
Ask mom to install them, or manually:
```bash
docker exec mom-sandbox apk add <package>
```
