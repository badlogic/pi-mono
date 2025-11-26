# @mariozechner/pi-mom

A Slack bot powered by Claude that can execute bash commands, read/write files, and interact with your development environment. Designed to be your helpful team assistant.

## Features

- **Slack Integration**: Responds to @mentions in channels and DMs
- **Full Bash Access**: Execute any command, install tools, configure credentials
- **File Operations**: Read, write, and edit files
- **Docker Sandbox**: Optional isolation to protect your host machine
- **Persistent Workspace**: Each channel gets its own workspace that persists across conversations
- **Thread-Based Details**: Clean main messages with verbose tool details in threads

## Installation

```bash
npm install @mariozechner/pi-mom
```

## Quick Start

```bash
# Set environment variables
export MOM_SLACK_APP_TOKEN=xapp-...
export MOM_SLACK_BOT_TOKEN=xoxb-...
export ANTHROPIC_API_KEY=sk-ant-...
# or use your Claude Pro/Max subscription
# to get the token install Claude Code and run claude setup-token
export ANTHROPIC_OAUTH_TOKEN=sk-ant-...

# Run mom
mom ./data
```

## Slack App Setup

1. Create a new Slack app at https://api.slack.com/apps
2. Enable **Socket Mode** (Settings → Socket Mode → Enable)
3. Generate an **App-Level Token** with `connections:write` scope → this is `MOM_SLACK_APP_TOKEN`
4. Add **Bot Token Scopes** (OAuth & Permissions):
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `files:read`
   - `files:write`
   - `im:history`
   - `im:read`
   - `im:write`
   - `users:read`
5. **Subscribe to Bot Events** (Event Subscriptions):
   - `app_mention`
   - `message.channels`
   - `message.im`
6. Install the app to your workspace → get the **Bot User OAuth Token** → this is `MOM_SLACK_BOT_TOKEN`

## Usage

### Host Mode (Default)

Run tools directly on your machine:

```bash
mom ./data
```

### Docker Sandbox Mode

Isolate mom in a container to protect your host:

```bash
# Create the sandbox container
./docker.sh create ./data

# Run mom with sandbox
mom --sandbox=docker:mom-sandbox ./data
```

### Talking to Mom

In Slack:
```
@mom what's in the current directory?
@mom clone the repo https://github.com/example/repo and find all TODO comments
@mom install htop and show me system stats
```

Mom will:
1. Show brief status updates in the main message
2. Post detailed tool calls and results in a thread
3. Provide a final response

### Stopping Mom

If mom is working on something and you need to stop:
```
@mom stop
```

## CLI Options

```bash
mom [options] <working-directory>

Options:
  --sandbox=host              Run tools on host (default)
  --sandbox=docker:<name>     Run tools in Docker container
```

## Docker Sandbox

The Docker sandbox treats the container as mom's personal computer:

- **Persistent**: Install tools with `apk add`, configure credentials - changes persist
- **Isolated**: Mom can only access `/workspace` (your data directory)
- **Self-Managing**: Mom can install what she needs and ask for credentials

### Container Management

```bash
./docker.sh create <data-dir>   # Create and start container
./docker.sh start               # Start existing container
./docker.sh stop                # Stop container
./docker.sh remove              # Remove container
./docker.sh status              # Check if running
./docker.sh shell               # Open shell in container
```

### Example Flow

```
User: @mom check the spine-runtimes repo on GitHub
Mom:  I need gh CLI. Installing...
      (runs: apk add github-cli)
Mom:  I need a GitHub token. Please provide one.
User: ghp_xxxx...
Mom:  (configures gh auth)
Mom:  Done. Here's the repo info...
```

## Workspace Structure

Each Slack channel gets its own workspace:

```
./data/
  └── C123ABC/                    # Channel ID
      ├── log.jsonl               # Message history (managed by mom)
      ├── attachments/            # Files shared in channel
      └── scratch/                # Mom's working directory
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MOM_SLACK_APP_TOKEN` | Slack app-level token (xapp-...) |
| `MOM_SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_OAUTH_TOKEN` | Alternative: Anthropic OAuth token |

## Security Considerations

**Host Mode**: Mom has full access to your machine. Only use in trusted environments.

**Docker Mode**: Mom is isolated to the container. She can:
- Read/write files in `/workspace` (your data dir)
- Make network requests
- Install packages in the container

She cannot:
- Access files outside `/workspace`
- Access your host credentials
- Affect your host system

**Recommendations**:
1. Use Docker mode for shared Slack workspaces
2. Create a dedicated GitHub bot account with limited repo access
3. Only share necessary credentials with mom

## License

MIT
