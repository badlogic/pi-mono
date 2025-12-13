# mom-discord Implementation Plan

## Overview

Create a Discord version of mom - a Claude-powered coding agent bot for Discord with full command execution capabilities.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| **Package structure** | New separate package (`packages/mom-discord/`) |
| **Code sharing** | Copy & adapt (potential extraction to `mom-core` later) |
| **Interaction model** | Hybrid (@mention + slash commands) |
| **Thread behavior** | Channel replies (simple, direct) |
| **Working indicator** | Edit message with status |
| **Discord features** | Embeds, buttons where appropriate |

---

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/mom <message>` | Main interaction with the bot |
| `/mom-stop` | Abort current run in channel |
| `/mom-memory` | View/edit channel memory |

---

## Package Structure

```
packages/mom-discord/
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── docs/
│   └── setup-guide.md
└── src/
    ├── main.ts           # Entry point, CLI args
    ├── discord.ts        # Discord.js client, events (NEW)
    ├── commands.ts       # Slash command registration/handling (NEW)
    ├── agent.ts          # Agent runner (ADAPT from mom)
    ├── store.ts          # Data persistence (ADAPT from mom)
    ├── sandbox.ts        # Docker/host execution (COPY from mom)
    ├── log.ts            # Logging (COPY from mom)
    └── tools/
        ├── index.ts      # Tool factory (ADAPT)
        ├── bash.ts       # Shell execution (COPY)
        ├── read.ts       # File reading (COPY)
        ├── write.ts      # File writing (COPY)
        ├── edit.ts       # File editing (COPY)
        └── attach.ts     # File upload (ADAPT for Discord)
```

---

## File Reusability Analysis

| File | Action | Changes Required |
|------|--------|------------------|
| `sandbox.ts` | COPY | None |
| `log.ts` | COPY | None |
| `tools/bash.ts` | COPY | None |
| `tools/read.ts` | COPY | None |
| `tools/write.ts` | COPY | None |
| `tools/edit.ts` | COPY | None |
| `tools/attach.ts` | ADAPT | Discord `AttachmentBuilder` API |
| `tools/index.ts` | ADAPT | Update attach tool integration |
| `store.ts` | ADAPT | Discord channel/guild IDs, same log.jsonl format |
| `agent.ts` | ADAPT | Discord markdown, embed formatting, prompt changes |
| `main.ts` | ADAPT | Discord env vars, client initialization |
| `slack.ts` | REPLACE | New `discord.ts` + `commands.ts` |

---

## Implementation Phases

### Phase 1: Foundation

**Goal**: Set up package structure and copy reusable code

- [ ] Create `packages/mom-discord/` directory structure
- [ ] Set up `package.json` with dependencies:
  - `discord.js` (v14)
  - `@anthropic-ai/sdk` or existing pi-ai/pi-agent-core
  - `@sinclair/typebox`
  - `chalk`
  - `diff`
- [ ] Set up `tsconfig.json`
- [ ] Copy unchanged files:
  - `sandbox.ts`
  - `log.ts`
  - `tools/bash.ts`
  - `tools/read.ts`
  - `tools/write.ts`
  - `tools/edit.ts`

### Phase 2: Discord Client

**Goal**: Establish Discord connection and basic event handling

- [ ] Create `discord.ts`:
  - Discord.js client initialization with required intents:
    - `Guilds`
    - `GuildMessages`
    - `MessageContent` (privileged)
    - `DirectMessages`
  - Gateway connection handling
  - Event handlers for `messageCreate`
  - Bot mention detection
  - DM detection
  - User/channel metadata caching
  - Message posting/editing utilities
  - Typing indicator management
- [ ] Create `main.ts`:
  - CLI argument parsing (`--sandbox=host|docker:<name>`)
  - Environment variable validation:
    - `DISCORD_BOT_TOKEN`
    - `DISCORD_APPLICATION_ID`
    - `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`
  - Bot startup and shutdown handling

### Phase 3: Core Agent Integration

**Goal**: Connect Discord events to the agent system

- [ ] Adapt `agent.ts`:
  - Update system prompt for Discord:
    - Discord markdown syntax (vs Slack mrkdwn)
    - Channel/user mention format (`<@USER_ID>`, `<#CHANNEL_ID>`)
    - Guild/server context
  - Integrate with Discord message posting
  - Tool execution event handling → Discord embeds
  - Token usage tracking
- [ ] Adapt `store.ts`:
  - Discord guild/channel ID structure
  - Same `log.jsonl` format
  - Attachment download handling
  - Message deduplication
- [ ] Adapt `tools/index.ts`:
  - Wire up all tools
- [ ] Adapt `tools/attach.ts`:
  - Use Discord `AttachmentBuilder`
  - Handle file upload via `channel.send({ files: [...] })`

### Phase 4: Slash Commands

**Goal**: Implement Discord slash command support

- [ ] Create `commands.ts`:
  - Command definitions:
    ```typescript
    /mom message:string       // Main interaction
    /mom-stop                 // Abort current run
    /mom-memory action:view|edit [content:string]
    ```
  - Command registration (on bot startup)
  - Command handlers with deferred replies
- [ ] Update `main.ts`:
  - Register commands on startup
  - Handle `interactionCreate` events
- [ ] Update `discord.ts`:
  - Route slash command interactions to handlers

### Phase 5: Discord-Specific Features

**Goal**: Leverage Discord's rich features for better UX

- [ ] **Embeds**:
  - Tool execution results (bash output, file contents)
  - Error messages (red embed)
  - Success confirmations (green embed)
  - Code blocks with syntax highlighting
  - Diff output for edit operations
- [ ] **Buttons**:
  - "Stop" button on bot responses
  - Button interaction handling
- [ ] **Message Formatting**:
  - Working indicator via message edit (`Processing...`)
  - Final response formatting
  - Long response handling (Discord 2000 char limit)
    - Split into multiple messages
    - Or use embeds (4096 char description limit)
    - Or upload as file attachment

### Phase 6: Memory System

**Goal**: Implement persistent memory across sessions

- [ ] Global memory (`data/MEMORY.md`)
- [ ] Per-channel memory (`data/<GUILD_ID>/<CHANNEL_ID>/MEMORY.md`)
- [ ] `/mom-memory` command implementation:
  - View current memory
  - Edit memory (modal input?)
- [ ] Load memory into system prompt

### Phase 7: Polish & Documentation

**Goal**: Production-ready release

- [ ] **Error handling**:
  - Graceful disconnection/reconnection
  - API error handling
  - Rate limit handling (discord.js handles automatically)
- [ ] **Documentation**:
  - `README.md` - Overview, features, quick start
  - `docs/setup-guide.md` - Discord Developer Portal setup
  - Environment variable documentation
- [ ] **Testing**:
  - Manual testing checklist
  - Test with Docker sandbox
  - Test with host sandbox
- [ ] **CHANGELOG.md** - Initial release notes

---

## Environment Variables

```bash
# Required
DISCORD_BOT_TOKEN=...           # Bot token from Developer Portal
DISCORD_APPLICATION_ID=...      # Application ID from Developer Portal
ANTHROPIC_API_KEY=...           # Anthropic API key

# Optional (alternative auth)
ANTHROPIC_OAUTH_TOKEN=...       # OAuth token instead of API key
```

---

## Discord Developer Portal Setup

1. Go to https://discord.com/developers/applications
2. Click "New Application", name it (e.g., "mom-discord")
3. Go to "Bot" section:
   - Click "Add Bot"
   - Copy the **Bot Token**
   - Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
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
6. Copy the **Application ID** from "General Information"

---

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

---

## Key Differences from Slack Version

| Aspect | Slack (mom) | Discord (mom-discord) |
|--------|-------------|----------------------|
| **Auth tokens** | App Token + Bot Token | Bot Token + App ID |
| **Connection** | Socket Mode | Gateway WebSocket |
| **Mention format** | `<@U123ABC>` | `<@123456789>` |
| **Channel format** | `<#C123ABC>` | `<#123456789>` |
| **Message limit** | 40,000 chars | 2,000 chars (4,096 in embeds) |
| **Markdown** | mrkdwn (Slack flavor) | Discord Markdown |
| **Threads** | Thread replies | Channel replies |
| **Rich formatting** | Blocks (limited) | Embeds (rich) |
| **Buttons** | Block Kit | Message Components |
| **Privileged access** | Always available | MESSAGE_CONTENT intent required |

---

## Discord Markdown Quick Reference

```markdown
**bold**
*italic*
__underline__
~~strikethrough~~
`inline code`
```code block```
> quote
>>> block quote
# Heading 1
## Heading 2
### Heading 3
[link text](url)
<@USER_ID>        # User mention
<#CHANNEL_ID>     # Channel mention
<@&ROLE_ID>       # Role mention
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| MESSAGE_CONTENT intent rejection (>100 servers) | Target small deployments; document verification process |
| Rate limiting | discord.js handles automatically; implement request queuing |
| Message length limits | Use embeds, split messages, or file attachments |
| Gateway disconnections | Implement reconnection logic (discord.js handles) |
| Prompt injection | Same mitigations as mom: sandbox, minimal permissions |

---

## Success Criteria

- [ ] Bot connects to Discord and stays connected
- [ ] Responds to @mentions in channels
- [ ] Responds to DMs
- [ ] All 5 tools working (bash, read, write, edit, attach)
- [ ] Slash commands functional (`/mom`, `/mom-stop`, `/mom-memory`)
- [ ] Memory system working
- [ ] Docker sandbox working
- [ ] Embeds displaying correctly
- [ ] Stop button functional
- [ ] No rate limit issues under normal use
