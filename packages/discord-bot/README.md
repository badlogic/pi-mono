# Pi Discord Bot

A full agentic Discord bot powered by AI with 89+ MCP tools, bash execution, file operations, voice channels, plugins, and persistent memory. Similar to pi-mom but for Discord instead of Slack.

## Features

### Core Capabilities
- **89+ MCP Tools**: Web search, GitHub, HuggingFace, memory, tasks, skills, voice, image/video generation, and more
- **Full Bash Access**: Execute any shell command on the host system
- **File Operations**: Read, write, and edit files
- **Persistent Memory**: Knowledge graph + MEMORY.md files
- **Per-Channel State**: Each channel/DM has isolated conversation history
- **Session Persistence**: JSONL-based conversation history survives restarts
- **Auto-Compaction**: Long conversations automatically summarized to maintain context

### AI & Models
- **11 Model Presets**: Claude Sonnet 4, GPT-4o, Gemini 2.5, DeepSeek, Llama, and more
- **OpenRouter + Ollama**: Cloud and local model support
- **Cost Tracking**: Per-user token usage and cost estimates with alerts

### Creative Tools
- **Image Generation**: FLUX, Ideogram, Recraft (via Fal.ai)
- **Music Generation**: Suno AI integration
- **Video Generation**: Text-to-video and image-to-video
- **Voice Synthesis**: ElevenLabs, VibeVoice (multi-speaker TTS)
- **3D Generation**: TripoSR, ShapE models

### Infrastructure
- **Real-time Feedback**: Shows tool execution progress in Discord
- **Voice Channels**: LiveKit integration for real-time voice/video
- **Webhook Server**: External alerts, trading signals, CI/CD integration
- **Docker Ready**: Multi-stage Dockerfile with non-root user
- **Backup System**: `/backup` command for data dumps
- **24 Slash Commands**: Including `/reset`, `/backup`, `/cost`, `/health`
- **38 Skills**: Specialized knowledge domains (trading, coding, research, etc.)
- **21 Personas**: Different personality modes

## Quick Start

```bash
# Set environment variables
export DISCORD_BOT_TOKEN=your_discord_bot_token
export OPENROUTER_API_KEY=your_openrouter_key

# Run the bot
pi-discord /path/to/data/directory
```

## Installation

### Prerequisites

- Node.js 20+
- Discord Bot Token (from Discord Developer Portal)
- OpenRouter API Key (free at openrouter.ai)

### Discord App Setup

1. Go to https://discord.com/developers/applications
2. Click **New Application** -> name it -> **Create**
3. Go to **Bot** section:
   - Click **Reset Token** -> copy the token
   - Enable **MESSAGE CONTENT INTENT** (required)
4. Go to **OAuth2 -> URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `View Channels`, `Connect`, `Speak`
5. Copy the generated URL -> open it -> invite bot to your server

### As a Systemd Service

```bash
cat > /etc/systemd/system/pi-discord.service << 'EOF'
[Unit]
Description=Pi Discord Bot
After=network.target

[Service]
Type=simple
User=root
Environment=DISCORD_BOT_TOKEN=your_token_here
Environment=OPENROUTER_API_KEY=your_key_here
Environment=GROQ_API_KEY=your_groq_key
Environment=GITHUB_TOKEN=your_github_token
ExecStart=/usr/local/bin/pi-discord /opt/discord-bot-data
Restart=always
RestartSec=10
WorkingDirectory=/opt/pi-mono/packages/discord-bot

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pi-discord
systemctl start pi-discord
```

## MCP Tools (51 tools across 25 categories)

### Web Search & Scraping
| Tool | Description |
|------|-------------|
| `web_search` | Search the web using Brave Search API |
| `web_scrape` | Scrape and extract content from URLs |
| `web_fetch` | Fetch raw content from URLs |

### GitHub Integration
| Tool | Description |
|------|-------------|
| `github_repo_search` | Search GitHub repositories |
| `github_repo_info` | Get repository details |
| `github_file_read` | Read files from repos |
| `github_issues` | List and manage issues |
| `github_prs` | List and manage pull requests |
| `github_commits` | View commit history |
| `github_create_issue` | Create new issues |

### HuggingFace Integration
| Tool | Description |
|------|-------------|
| `hf_model_search` | Search ML models |
| `hf_dataset_search` | Search datasets |
| `hf_space_search` | Search Spaces |
| `hf_paper_search` | Search ML papers |
| `hf_inference` | Run model inference |

### Memory & Knowledge
| Tool | Description |
|------|-------------|
| `memory_store` | Store facts in knowledge graph |
| `memory_retrieve` | Retrieve stored knowledge |
| `memory_search` | Search memory by query |
| `memory_delete` | Remove stored facts |
| `knowledge_search` | RAG search over knowledge base |

### Skills & Learning
| Tool | Description |
|------|-------------|
| `skill_list` | List available skills |
| `skill_load` | Load a skill into context |
| `skill_search` | Search skills by topic |
| `auto_learn` | Extract learnings from conversations |

### Task Management
| Tool | Description |
|------|-------------|
| `task_create` | Create new tasks |
| `task_list` | List pending tasks |
| `task_update` | Update task status |
| `task_delete` | Delete tasks |
| `schedule_task` | Schedule future tasks |
| `scheduled_tasks_list` | List scheduled tasks |

### Code Execution
| Tool | Description |
|------|-------------|
| `code_sandbox` | Execute code safely |
| `docker_sandbox` | Run code in Docker containers |

### File Processing
| Tool | Description |
|------|-------------|
| `file_process` | Process uploaded files (images, code, text) |
| `image_analyze` | Analyze images with vision API |

### Voice & Audio
| Tool | Description |
|------|-------------|
| `voice_join` | Join voice channel |
| `voice_leave` | Leave voice channel |
| `voice_tts` | Text-to-speech in voice |
| `voice_transcribe` | Transcribe audio |

### Discord Features
| Tool | Description |
|------|-------------|
| `rich_embed` | Create rich Discord embeds |
| `conversation_export` | Export chat history |

### User Management
| Tool | Description |
|------|-------------|
| `user_preferences` | Get/set user preferences |

### Plugin System
| Tool | Description |
|------|-------------|
| `plugin_load` | Load a plugin |
| `plugin_list` | List available plugins |
| `plugin_unload` | Unload a plugin |

### Slash Commands
| Tool | Description |
|------|-------------|
| `slash_command_create` | Create custom slash commands |
| `slash_command_list` | List slash commands |
| `slash_command_delete` | Delete slash commands |

### Multi-Server
| Tool | Description |
|------|-------------|
| `server_sync` | Sync knowledge across servers |
| `server_list` | List connected servers |

### Webhooks
| Tool | Description |
|------|-------------|
| `webhook_send` | Send webhook messages |
| `webhook_create` | Create webhooks |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help message |
| `/status` | Show bot status |
| `/tools` | List available tools by category |
| `/skills` | List available skills |
| `/memory` | View memory contents |
| `/clear` | Clear conversation history |
| `/model` | Change AI model |
| `/export` | Export conversation |
| `/settings` | View/edit settings |

## Usage Examples

### Basic Commands

```
@BotName what's my IP address?
@BotName show disk usage
@BotName list running docker containers
```

### File Operations

```
@BotName read /etc/hostname
@BotName create a file called test.txt with "hello world"
@BotName edit /path/to/file.txt and replace "old" with "new"
```

### Web Search

```
@BotName search the web for "latest AI news"
@BotName scrape https://example.com and summarize
```

### GitHub

```
@BotName search GitHub for "discord bot typescript"
@BotName show issues for repo owner/name
@BotName create an issue on owner/repo titled "Bug fix needed"
```

### HuggingFace

```
@BotName find models for text generation
@BotName search datasets for sentiment analysis
@BotName what's new in ML papers about transformers?
```

### Code Execution

```
@BotName run this python code: print("Hello World")
@BotName execute in docker: npm test
```

### Voice

```
@BotName join voice channel General
@BotName say "Hello everyone" in voice
@BotName leave voice
```

### Memory

```
@BotName remember that my favorite language is Rust
@BotName what do you remember about me?
@BotName search memory for "database"
```

## Skills (32 available)

| Category | Skills |
|----------|--------|
| **Pi-Mono** | pi-ai, pi-agent, pi-coding-agent, pi-discord, pi-tui, pi-mom-patterns |
| **Trading** | quant-trading, technical-analysis, risk-management, crypto-apis |
| **Integrations** | webhooks, slack, telegram, notion, google-sheets, airtable |
| **Research** | data-analysis, research-assistant, writing-assistant |
| **Development** | typescript, react, nodejs, python, docker, kubernetes |

Load skills with:
```
@BotName load skill quant-trading
@BotName what skills do you have for trading?
```

## Workspace Structure

```
/opt/discord-bot-data/
├── MEMORY.md                    # Global memory (all channels)
├── knowledge/                   # RAG knowledge base
│   └── *.md                     # Knowledge documents
├── skills/                      # Loadable skills
│   └── *.md                     # Skill definitions
├── plugins/                     # Plugin system
│   ├── registry.json           # Plugin registry
│   └── */                      # Plugin directories
├── scheduled/                   # Scheduled tasks
│   └── *.json                   # Task definitions
├── 1234567890/                  # Channel directory
│   ├── MEMORY.md               # Channel-specific memory
│   ├── log.jsonl               # Message history
│   └── scratch/                # Working directory
└── dashboard/                   # Monitoring dashboard
    └── index.html
```

## Webhook Server

The bot includes a webhook server for receiving external alerts and trading signals.

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/status` | Bot status JSON |
| GET | `/api/tools` | List all tools |
| GET | `/api/skills` | List all skills |
| POST | `/webhook/alert` | Send alerts |
| POST | `/webhook/signal` | Trading signals |
| POST | `/webhook/ci` | CI/CD notifications |
| POST | `/webhook/custom` | Custom webhooks |

### Security

The webhook server includes multiple security layers:

1. **IP Allowlist**: Only requests from allowed IPs are accepted (default: localhost only)
2. **API Key Authentication**: Valid API key bypasses IP restrictions
3. **Rate Limiting**: 3 unauthorized attempts per minute triggers 5-minute block
4. **Request Size Limits**: Prevents DoS attacks
5. **Helmet.js**: Security headers and HSTS

**Environment Variables:**
- `WEBHOOK_API_KEY` - Required for authenticated requests
- `WEBHOOK_ALLOWED_IPS` - Comma-separated list of allowed IPs (default: `127.0.0.1,::1,::ffff:127.0.0.1`)

**Security Behavior:**
- Requests from non-allowed IPs without valid API key → `403 Forbidden`
- Requests with valid API key bypass IP restrictions → allowed from any IP
- 3+ failed auth attempts in 1 minute → IP blocked for 5 minutes
- All unauthorized attempts logged with IP address

### External Access

- **URL**: `http://your-server:3001`
- **Port**: 3001 (configurable via `WEBHOOK_PORT`)

### Examples

```bash
# Health check (no auth required)
curl http://localhost:3001/health

# Send alert (requires API key if accessing from non-allowed IP)
curl -X POST http://localhost:3001/webhook/alert \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-webhook-api-key" \
  -d '{"message":"BTC price alert","priority":"high"}'

# Send trading signal (authenticated request)
curl -X POST http://localhost:3001/webhook/signal \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-webhook-api-key" \
  -d '{"symbol":"BTC/USD","action":"BUY","price":"42000"}'

# From allowed IP (no API key needed if IP is in allowlist)
curl -X POST http://localhost:3001/webhook/alert \
  -H "Content-Type: application/json" \
  -d '{"message":"BTC price alert","priority":"high"}'
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `GROQ_API_KEY` | No | Groq API key (for voice) |
| `GITHUB_TOKEN` | No | GitHub API token |
| `HF_TOKEN` | No | HuggingFace token |
| `WEBHOOK_PORT` | No | Webhook server port (default: 3001) |
| `WEBHOOK_API_KEY` | No | API key for webhook authentication |
| `WEBHOOK_ALLOWED_IPS` | No | Comma-separated IP allowlist (default: localhost only) |
| `REPORT_CHANNEL_ID` | No | Channel for alerts |

### Changing the Model

```bash
# Via slash command
/model anthropic/claude-3.5-sonnet

# Or edit main.ts
const model = getModel("openrouter", "anthropic/claude-3.5-sonnet");
```

Available models:
- Free: `mistralai/devstral-2512:free`, `meta-llama/llama-3.1-8b-instruct:free`
- Paid: `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, `google/gemini-pro`
- Local: Any Ollama model

## Monitoring Dashboard

Access the monitoring dashboard at:
- **Local**: `http://localhost:3001/dashboard`
- **External**: `http://your-server:3001/dashboard`

Features:
- Real-time bot status
- Tool usage statistics
- Memory usage
- Recent activity log
- Skills overview
- System metrics

## Security

**The bot runs as root by default** and can execute any command.

### Mitigations

1. **Restrict channel access**: Only add to private channels
2. **Run as non-root**: Create dedicated user
3. **Use Docker isolation**: Run in container
4. **Enable rate limiting**: Configure in settings
5. **Monitor logs**: Watch for suspicious activity

### Running as Non-Root

```bash
useradd -m -s /bin/bash pibot
usermod -aG docker pibot
chown -R pibot:pibot /opt/discord-bot-data

sed -i 's/User=root/User=pibot/' /etc/systemd/system/pi-discord.service
systemctl daemon-reload
systemctl restart pi-discord
```

## Docker Deployment

The bot includes a production-ready Dockerfile with multi-stage build and non-root user.

### Quick Docker Setup

```bash
# Copy environment file
cp .env.example .env
# Edit .env with your API keys
nano .env

# Build and run
docker-compose up -d

# View logs
docker-compose logs -f
```

### Docker Compose

```yaml
version: '3.8'
services:
  pi-discord-bot:
    build: .
    container_name: pi-discord-bot
    restart: unless-stopped
    ports:
      - "3001:3001"   # Webhook
      - "9090:9090"   # Metrics
    volumes:
      - ./data:/data
    environment:
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - FAL_KEY=${FAL_KEY}
      - SUNO_API_KEY=${SUNO_API_KEY}
    deploy:
      resources:
        limits:
          memory: 2G
```

### Build Only

```bash
docker build -t pi-discord-bot .
docker run -d \
  --name pi-discord-bot \
  -e DISCORD_BOT_TOKEN=xxx \
  -e OPENROUTER_API_KEY=xxx \
  -v $(pwd)/data:/data \
  pi-discord-bot
```

## New Features (v0.20+)

### Session Persistence
Conversations are automatically saved to `session.jsonl` files per channel and restored on restart.

### Auto-Compaction
When conversations exceed 100 messages, older messages are summarized to maintain context without excessive token usage.

### Backup System
```bash
/backup              # Backup current channel
/backup scope:all    # Backup all data
```
Creates timestamped `.tar.gz` archives in the `backups/` directory.

### Cost Tracking
```bash
/cost               # Your usage
/cost view:top      # Top users
/cost view:daily    # Daily breakdown
```
Tracks estimated token usage and costs per user with configurable alerts.

### Health Check
```bash
/health             # Check bot and API status
```

### Reset Conversation
```bash
/reset              # Clear conversation history
```

## Development

```bash
cd /opt/pi-mono/packages/discord-bot

# Install dependencies
npm install

# Watch mode
npm run dev /opt/discord-bot-data

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest run mcp-tools.test.ts
```

## Logs & Debugging

```bash
# View service logs
journalctl -u pi-discord -f

# Check bot status
systemctl status pi-discord

# View channel history
cat /opt/discord-bot-data/<channel-id>/log.jsonl | jq .

# View memory
cat /opt/discord-bot-data/MEMORY.md
```

## Troubleshooting

### Bot doesn't respond

1. Check bot is running: `systemctl status pi-discord`
2. Check logs: `journalctl -u pi-discord -n 50`
3. Verify MESSAGE CONTENT INTENT is enabled
4. Make sure bot is invited to the channel

### Tools not working

1. Check API keys are set correctly
2. Verify network connectivity
3. Check tool-specific logs in console

### Memory issues

1. Restart bot: `systemctl restart pi-discord`
2. Check disk space: `df -h`
3. Clear old logs if needed

### Voice not working

1. Ensure bot has Connect/Speak permissions
2. Install required audio dependencies
3. Check Groq API key for transcription

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Run tests: `npm test`
5. Submit pull request

## License

MIT
