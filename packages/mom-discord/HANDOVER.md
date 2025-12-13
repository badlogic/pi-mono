# Mom-Discord Handover Document

## Overview

This package implements a Discord bot version of the Slack-based "mom" coding agent. It allows users to interact with a Claude-powered AI assistant through Discord via @mentions, direct messages, and slash commands.

## Architecture

### Package Structure

```
packages/mom-discord/
├── src/
│   ├── main.ts          # Entry point, CLI args, bot initialization
│   ├── discord.ts       # Discord client, message handling, context creation
│   ├── agent.ts         # Claude agent runner, system prompt, tool execution
│   ├── commands.ts      # Slash command definitions and handlers
│   ├── store.ts         # Data persistence (log.jsonl, attachments)
│   ├── sandbox.ts       # Host/Docker execution environment
│   ├── log.ts           # Console logging utilities
│   ├── index.ts         # Public exports
│   └── tools/           # Agent tool implementations
│       ├── index.ts     # Tool factory
│       ├── bash.ts      # Shell command execution
│       ├── read.ts      # File reading
│       ├── write.ts     # File writing
│       ├── edit.ts      # File editing
│       └── attach.ts    # File upload to Discord
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── README.md
├── CHANGELOG.md
└── HANDOVER.md          # This file
```

### Data Flow

```
User Message (@mention/DM/slash command)
    ↓
discord.ts (MomDiscordBot)
    ↓
main.ts (handleMessage / onMomCommand)
    ↓
agent.ts (createAgentRunner → runner.run)
    ↓
Claude API (via pi-agent-core)
    ↓
Tool Execution (bash, read, write, edit, attach)
    ↓
Response via Discord embeds/messages
```

### Key Design Decisions

1. **Separate Package**: Created as `mom-discord` rather than modifying the original `mom` (Slack) package. Code was copied and adapted rather than extracting shared `mom-core`.

2. **Hybrid Interaction Model**: Supports both @mentions and slash commands (`/mom`, `/mom-stop`, `/mom-memory`).

3. **Channel Replies**: Responses go to the channel directly (not threads like Slack).

4. **Discord Features**: Uses embeds for tool results, buttons for stop functionality.

5. **Directory Structure**: `workingDir/guildId/channelId/` for guild channels, `workingDir/channelId/` for DMs.

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key |
| `ANTHROPIC_OAUTH_TOKEN` | Yes* | Alternative to API key |

*One of `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` must be set.

### CLI Usage

```bash
mom-discord [--sandbox=host|docker:<container>] <working-directory>

# Examples:
mom-discord ./data
mom-discord --sandbox=docker:mom-sandbox ./data
```

### Discord Bot Setup

1. Create application at https://discord.com/developers/applications
2. Enable these Gateway Intents:
   - Guilds
   - Guild Messages
   - Message Content (privileged)
   - Direct Messages
   - Guild Members
3. Generate bot token
4. Invite with scopes: `bot`, `applications.commands`
5. Bot permissions: Send Messages, Embed Links, Attach Files, Read Message History, Use Slash Commands

## Slash Commands

| Command | Description |
|---------|-------------|
| `/mom message:<text>` | Send a message to the bot |
| `/mom-stop` | Stop the current operation in this channel |
| `/mom-memory action:view\|edit scope:channel\|global` | View or edit memory files |

## Key Files Explained

### main.ts
- Entry point with argument parsing
- Manages `activeRuns` Map to track running agents per channel
- Implements try-finally pattern for proper cleanup
- Sets up slash command handlers
- Registers commands on bot ready

### discord.ts
- `MomDiscordBot` class wraps Discord.js client
- `createContext()` - Creates context from regular messages
- `createContextFromInteraction()` - Creates context from slash commands
- Handles button interactions for stop functionality
- Manages user/channel caching

### agent.ts
- `createAgentRunner()` - Factory for agent instances
- Builds system prompt with Discord-specific formatting
- Handles message history from `log.jsonl`
- Posts tool results as Discord embeds
- Manages stop button during execution

### store.ts
- `ChannelStore` class for data persistence
- Logs messages to `log.jsonl` (JSONL format)
- Downloads and stores attachments
- Has deduplication for message logging

### commands.ts
- Slash command definitions using SlashCommandBuilder
- `registerCommands()` - Registers with Discord API
- `setupCommandHandlers()` - Sets up interaction listeners
- Memory view/edit with modal support

## Known Issues

### Minor (Not Fixed)

1. **Duplicate Attachment Downloads**: For DMs and mentions, `processAttachments()` is called twice (once in `logMessage`, once in `createContext`). The second download overwrites the first with identical content. Wasteful but not breaking.

2. **Type Assertion**: `(interaction.channel as any).name` used in main.ts for channel name access. Works but not fully type-safe.

### Fixed This Session

| Issue | Commit | Description |
|-------|--------|-------------|
| Slash messages not logged | `cb51ee4` | Agent couldn't see slash command messages |
| Missing setTyping/setWorking | `cb51ee4` | No working indicator for slash commands |
| Path separator (commands.ts) | `cb51ee4` | Windows incompatibility |
| Path separator (store.ts) | `338a3a3` | Windows incompatibility |
| Channel lock on error | `71a852b` | Missing try-finally caused permanent lock |

## Testing Checklist

### Manual Testing Required

- [ ] Bot connects and shows online
- [ ] @mention triggers response
- [ ] DM triggers response
- [ ] `/mom` slash command works
- [ ] `/mom-stop` stops running operation
- [ ] `/mom-memory view` shows memory
- [ ] `/mom-memory edit` opens modal
- [ ] Stop button appears and works
- [ ] Tool embeds display correctly
- [ ] Attachments are downloaded
- [ ] Error handling shows user-friendly message
- [ ] Multiple channels can run independently
- [ ] Bot handles network errors gracefully

### Docker Sandbox Testing

- [ ] `--sandbox=docker:<container>` mode works
- [ ] Commands execute in container
- [ ] File paths translate correctly

## Future Improvements

### From Original Plan (Not Implemented)

1. **mom-core Extraction**: Shared code between mom (Slack) and mom-discord could be extracted to a common package. See `docs/mom-core-extraction-plan.md`.

2. **Thread Support**: Could add thread-based conversations like Slack version.

3. **Reaction Controls**: Could use reactions for stop/feedback instead of buttons.

### Code Quality

1. Deduplicate attachment processing to avoid double downloads
2. Extract shared context creation logic in discord.ts
3. Add proper TypeScript types for channel name access
4. Add unit tests for critical paths

## Dependencies

```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "^0.12.9",
    "@mariozechner/pi-ai": "^0.12.9",
    "@sinclair/typebox": "^0.34.0",
    "chalk": "^5.6.2",
    "diff": "^8.0.2",
    "discord.js": "^14.16.3"
  }
}
```

## Commit History (This Session)

```
71a852b fix(mom-discord): add try-finally to prevent channel lock on errors
338a3a3 fix(mom-discord): use path.dirname in store.ts for Windows compat
cb51ee4 fix(mom-discord): fix slash command bugs
5d9d953 style(mom-discord): apply linter formatting
4c0583a feat(mom-discord): wire up slash commands
14fd78c feat(mom-discord): add embeds and stop button
0f6fc9c feat(mom-discord): initial Discord bot implementation
```

## Contact

This implementation was created as a fork/adaptation of the original `mom` Slack bot by Mario Zechner. The Discord version maintains similar functionality while adapting to Discord's API and UX patterns.

---

*Last updated: December 2024*
