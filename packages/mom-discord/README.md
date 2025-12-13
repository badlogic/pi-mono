# mom-discord

A Discord bot that delegates messages to a Claude-powered coding agent. Discord version of [mom](../mom/).

## Features

- **@mention** responses in Discord channels
- **Direct messages** support
- **Slash commands**: `/mom`, `/mom-stop`, `/mom-memory`
- **Tool execution**: bash, read, write, edit, attach
- **Memory system**: persistent context across conversations
- **Docker sandbox**: isolated command execution
- **File attachments**: upload and download files

## Installation

```bash
npm install @mariozechner/mom-discord
```

## Setup

### 1. Discord Developer Portal

1. Go to https://discord.com/developers/applications
2. Click "New Application", name it (e.g., "mom")
3. Go to "Bot" section:
   - Click "Add Bot"
   - Copy the **Bot Token**
   - Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
   - Enable **SERVER MEMBERS INTENT** (optional, for better user info)
4. Go to "OAuth2" → "URL Generator":
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions:
     - Send Messages
     - Send Messages in Threads
     - Embed Links
     - Attach Files
     - Read Message History
     - Use Slash Commands
     - Add Reactions
5. Copy the generated URL and use it to invite the bot to your server

### 2. Environment Variables

```bash
export DISCORD_BOT_TOKEN=your_bot_token_here
export ANTHROPIC_API_KEY=your_anthropic_key_here
# OR
export ANTHROPIC_OAUTH_TOKEN=your_oauth_token_here
```

### 3. Run the Bot

```bash
# Host mode (not recommended for production)
mom-discord ./data

# Docker mode (recommended)
mom-discord --sandbox=docker:mom-sandbox ./data
```

## Usage

### Mention the Bot

```
@mom hello, can you help me with a bash script?
```

### Direct Message

Send a DM to the bot directly.

### Slash Commands

- `/mom message:your message here` - Send a message to mom
- `/mom-stop` - Stop the current operation
- `/mom-memory action:view` - View channel memory
- `/mom-memory action:edit` - Edit channel memory

### Stop Command

While mom is working, you can type:
```
@mom stop
```

## Data Directory Structure

```
data/
├── MEMORY.md                           # Global memory
├── skills/                             # Global skills
└── <GUILD_ID>/
    └── <CHANNEL_ID>/
        ├── MEMORY.md                   # Channel-specific memory
        ├── log.jsonl                   # Conversation history
        ├── attachments/                # Downloaded files
        ├── scratch/                    # Working directory
        ├── skills/                     # Channel-specific skills
        └── last_prompt.txt             # Debug: last full prompt
```

## Docker Sandbox Setup

For isolated command execution, use Docker:

```bash
# Create a Docker container (similar to mom)
docker run -d --name mom-sandbox \
  -v $(pwd)/data:/workspace \
  alpine:latest \
  tail -f /dev/null

# Run with Docker sandbox
mom-discord --sandbox=docker:mom-sandbox ./data
```

## Security Considerations

⚠️ **Warning**: Mom can execute arbitrary bash commands. Use with caution.

- Use Docker sandbox mode for production
- Never expose the bot token
- Limit bot permissions to necessary channels
- Monitor the log.jsonl for suspicious activity

## Differences from Slack Version

| Aspect | Slack (mom) | Discord (mom-discord) |
|--------|-------------|----------------------|
| **Message limit** | 40,000 chars | 2,000 chars |
| **Formatting** | mrkdwn | Discord Markdown |
| **Threads** | Thread replies | Follow-up messages |
| **Mention format** | `<@UXXXXXX>` | `<@123456789>` |
| **Rich content** | Blocks | Embeds |

## License

MIT
