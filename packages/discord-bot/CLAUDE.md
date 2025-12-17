# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development (hot reload)
npm run dev

# Build TypeScript
npm run build

# Type checking only
npm run type-check

# Linting
npm run lint
npm run lint:fix

# Format code
npm run format
npm run format:check

# Run tests (vitest)
npx vitest run                    # All tests
npx vitest run mcp-tools.test.ts  # Single file

# Database migrations
npm run migrate

# Clean build artifacts
npm run clean

# Production start (requires build first)
npm start
```

There's also a Makefile with additional commands: `make help` lists all targets.

## Architecture Overview

This is a full-featured Discord bot powered by the pi-mono agent framework. It provides 89+ MCP tools, bash execution, file operations, voice channels, and persistent memory.

### Core Dependencies

- **@mariozechner/pi-agent-core**: Agent runtime and event handling
- **@mariozechner/pi-ai**: AI model abstraction layer (AgentTool, Model types)
- **discord.js**: Discord API client
- **better-sqlite3**: SQLite database (WAL mode enabled)

### Key Source Files

**`src/main.ts`** (2500+ lines) - Main entry point containing:
- Discord client setup with intents and slash command registration
- Multi-provider model configuration (OpenRouter, Cerebras, Groq, Z.ai, Ollama)
- Message handling and agent execution loop
- Rate limiting and bot statistics
- All slash command implementations

**`src/mcp-tools.ts`** - 89+ MCP tools organized by category:
- Web search/scrape, GitHub, HuggingFace integrations
- Memory (knowledge graph), skills, task management
- Voice (TTS/STT), code sandbox, file processing
- Each tool follows the `AgentTool` interface with `execute()` method

**`src/database.ts`** - SQLite persistence layer:
- Tables: users, alerts, command_history, settings, scheduled_tasks
- Singleton pattern via `initDatabase()` / `getDatabase()`
- All queries use prepared statements

### Module Organization

```
src/
├── main.ts              # Entry point, Discord client, slash commands
├── mcp-tools.ts         # 89+ MCP tool implementations
├── database.ts          # SQLite layer (BotDatabase class)
├── scheduler.ts         # Cron-based task scheduling (node-cron)
├── analytics.ts         # Usage tracking and metrics
├── dashboard-integration.ts  # Express server for monitoring dashboard
├── webhook-server.ts    # External alert/signal endpoints
├── trading/             # Multi-agent trading system
│   ├── orchestrator.ts  # Coordinates all trading agents
│   ├── consensus.ts     # Signal consensus engine
│   ├── base-agent.ts    # Base class for trading agents
│   └── agents/          # PriceAgent, SentimentAgent, WhaleAgent
├── voice/               # Voice channel support
│   ├── vibevoice.ts     # Microsoft TTS integration
│   ├── whisper-local.ts # Local Whisper STT
│   └── voice-session.ts # Per-channel voice state
├── agents/              # AI agent integrations (Claude, OpenHands)
│   ├── expertise/       # Agent Experts learning files (per mode)
│   ├── claude-agent.ts  # Claude Code subagent spawning
│   ├── openhands-agent.ts   # OpenHands SDK TypeScript wrapper
│   ├── openhands-runner.py  # OpenHands Python runner (GLM via Z.ai)
│   └── index.ts         # Agent exports
├── music/               # AI music generation
│   └── suno-service.ts  # Suno API integration (sunoapi.org)
├── knowledge/           # RAG knowledge base
└── news/                # News feed integration
```

### OpenHands Software Agent Integration

The bot integrates OpenHands SDK for expert-level software development tasks via `/openhands` command:

```
Discord /openhands <subcommand>
    └── TypeScript (openhands-agent.ts)
            └── Python subprocess (openhands-runner.py)
                    └── OpenHands SDK with Expert Modes
                            └── Z.ai API (GLM-4.6 via LiteLLM)
```

**Files:**
- `src/agents/openhands-runner.py` - Python runner with expert modes, security analyzer, persistence
- `src/agents/openhands-agent.ts` - TypeScript wrapper with all expert presets
- `src/main.ts` - `/openhands` slash command handlers

**Expert Modes (9 total):**

| Mode | Description | Use Case |
|------|-------------|----------|
| `developer` | General development | Coding, debugging, file operations |
| `vulnerability_scan` | Security scanning | OWASP Top 10, secrets, CVE detection |
| `code_review` | Code quality analysis | Quality, performance, best practices |
| `test_generation` | Test creation | Unit, integration, edge cases |
| `documentation` | Doc generation | README, API docs, architecture |
| `refactor` | Code improvement | Complexity reduction, DRY, patterns |
| `debug` | Issue fixing | Root cause analysis, regression tests |
| `migrate` | Dependency upgrades | Breaking changes, migration plans |
| `optimize` | Performance tuning | Profiling, bottleneck fixes |

**Slash Commands:**

| Command | Description |
|---------|-------------|
| `/openhands run` | Run with any mode (developer, security, etc.) |
| `/openhands security <path>` | Security vulnerability scan |
| `/openhands review <path>` | Thorough code review |
| `/openhands tests <path>` | Generate comprehensive tests |
| `/openhands docs <path>` | Generate documentation |
| `/openhands refactor <path>` | Refactor for quality |
| `/openhands debug <path> <issue>` | Debug and fix issues |
| `/openhands optimize <path>` | Performance optimization |
| `/openhands status` | Check SDK availability |
| `/openhands modes` | List all expert modes |

**Advanced Features:**

1. **Security Analyzer** - Blocks dangerous operations (rm -rf, fork bombs, etc.)
2. **Session Persistence** - Resume interrupted tasks with `--persist` flag
3. **Sub-Agent Delegation** - Parallel specialist agents for complex tasks
4. **Multi-Provider LLM** - GLM primary, Groq/OpenRouter for sub-agents
5. **Agent Experts (Act-Learn-Reuse)** - Agents that learn and improve over time

**Agent Experts Pattern:**

The OpenHands integration implements self-improving agents that accumulate expertise:

```
ACT     → Load expertise file, inject into context, execute task
LEARN   → Extract learnings from output, update expertise file
REUSE   → Next execution loads accumulated knowledge
```

- **Expertise Files:** `src/agents/expertise/*.md` (one per mode)
- **Self-Improve Prompts:** Each mode has prompts that teach the agent HOW to learn
- **Session Insights:** Last 5 learnings kept to prevent unbounded growth
- **Enable/Disable:** `--no-learning` flag or `enableLearning: false` option

**TypeScript Presets:**
```typescript
OpenHandsPresets.vulnerabilityScan(path)  // Security scan
OpenHandsPresets.codeReview(path, focus)  // Code review
OpenHandsPresets.testGeneration(path, 90) // 90% coverage
OpenHandsPresets.documentation(path)       // All docs
OpenHandsPresets.refactor(path, target)   // Refactoring
OpenHandsPresets.debug(path, issue)       // Debug + fix
OpenHandsPresets.optimize(path, focus)    // Performance
OpenHandsPresets.persistent(task)         // Resumable session
OpenHandsPresets.multiAgent(task)         // Sub-agent delegation
OpenHandsPresets.fullAudit(path)          // Security + review + docs
```

### Suno AI Music Generation

The bot integrates Suno AI for music generation via `/suno` command using sunoapi.org:

**Slash Commands:**

| Command | Description |
|---------|-------------|
| `/suno generate` | Quick generation from text prompt (AI handles lyrics) |
| `/suno custom` | Full control: custom lyrics, style, title, model |
| `/suno instrumental` | Generate instrumental tracks |
| `/suno status` | Check service status and remaining credits |

**Features:**
- Multiple model versions (V4, V4.5, V4.5+, V4.5 All, V5)
- Vocal/instrumental toggle
- Custom lyrics support (up to 5000 chars)
- Style customization (e.g., rock, jazz, electronic, doom metal)
- Returns 2 tracks per generation
- Stream and download URLs provided

**Service Module:** `src/music/suno-service.ts`
```typescript
import { sunoService } from "./music/suno-service.js";

// Simple generation
const { taskId } = await sunoService.generateSimple("upbeat electronic dance track", false);
const result = await sunoService.waitForCompletion(taskId);

// Custom lyrics
await sunoService.generateCustom(lyrics, "doom metal", "Cosmic Void", "V4_5ALL");

// Instrumental
await sunoService.generateInstrumental("ambient synthwave", "Night Drive");

// Check credits
const { remaining } = await sunoService.getCredits();
```

**Environment Variable:** `SUNO_API_KEY` (from sunoapi.org)

### Model Provider System

The bot supports multiple AI providers with runtime switching:

1. **OpenRouter** (default) - Best agentic performance, wide model selection
2. **Cerebras** - Fastest inference (2100+ tok/s)
3. **Groq** - Free tier, fast
4. **Z.ai** - GLM-4.6 coding specialization
5. **Ollama** - Local models

Model selection uses `createModelConfig()` factory functions that return `Model<"openai-completions">` configs.

### Agent Event Loop

Messages flow through:
1. Discord `messageCreate` event
2. Rate limiting check
3. Per-channel agent instance (from Map)
4. `Agent.run()` with tools from `getAllMcpTools()`
5. Event stream processing (tool calls, responses)
6. Discord message updates with progress feedback

### Trading System

Multi-agent architecture inspired by Moon Dev:
- `TradingOrchestrator` coordinates agents and manages signal flow
- Agents (Price, Sentiment, Whale) extend `BaseAgent`
- `ConsensusEngine` aggregates signals with confidence thresholds
- Signals broadcast to configured Discord channel

## Configuration

Key environment variables:
- `DISCORD_BOT_TOKEN` (required)
- `OPENROUTER_API_KEY` (recommended - best agentic)
- `GROQ_API_KEY`, `CEREBRAS_API_KEY` (optional providers)
- `ZAI_API_KEY` (required for OpenHands SDK - GLM-4.6)
- `GITHUB_TOKEN`, `HF_TOKEN` (for integrations)
- `WEBHOOK_PORT` (default: 3001)
- `ALLOWED_USER_IDS` (comma-separated, empty = allow all)

## Testing

Tests use Vitest. The test file `src/mcp-tools.test.ts` covers:
- Tool array structure and uniqueness
- `withRetry()` retry logic
- Tool category presence validation

Run with `npx vitest run` or `npm test`.

## Workspace Data Structure

The bot creates per-channel directories under the data path:
```
<data_dir>/
├── MEMORY.md           # Global memory
├── knowledge/          # RAG documents
├── skills/             # Loadable skill files
├── scheduled/          # Task definitions
├── <channel_id>/       # Per-channel state
│   ├── MEMORY.md       # Channel-specific memory
│   ├── log.jsonl       # Message history
│   └── scratch/        # Working directory
└── bot.db              # SQLite database
```
