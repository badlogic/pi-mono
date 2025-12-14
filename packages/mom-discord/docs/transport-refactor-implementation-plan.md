# Transport Refactor Implementation Plan

## Objective

Refactor the `mom` package to support multiple transports (Slack, Discord) following Mario's preferred structure: a single package with transport modules rather than separate packages.

## Current State Analysis

### mom (Slack) Package Structure
```
packages/mom/src/
├── main.ts          # Entry point, CLI args, handler setup
├── slack.ts         # Slack client (MomBot), SlackContext
├── agent.ts         # Agent runner, system prompt, tool execution
├── store.ts         # Data persistence (log.jsonl, attachments)
├── sandbox.ts       # Host/Docker execution environment
├── log.ts           # Console logging
└── tools/           # Tool implementations (bash, read, write, edit, attach)
```

### mom-discord Package Structure (Current)
```
packages/mom-discord/src/
├── main.ts          # Entry point (Discord-specific)
├── discord.ts       # Discord client (MomDiscordBot), DiscordContext
├── agent.ts         # Agent runner (adapted for Discord)
├── store.ts         # Data persistence (adapted for Discord guild/channel)
├── commands.ts      # Slash command handling
├── sandbox.ts       # Same as Slack
├── log.ts           # Same as Slack (with minor adaptations)
└── tools/           # Same as Slack
```

## Key Differences Between Transports

| Aspect | Slack | Discord |
|--------|-------|---------|
| Message ID | `ts` (timestamp format) | Message ID (snowflake) |
| Threading | `respondInThread()` | `respondFollowUp()` / embeds |
| Stop mechanism | Text command only | Text command + button |
| Server concept | Workspace (implicit) | Guild (explicit in paths) |
| Directory structure | `workingDir/channelId/` | `workingDir/guildId/channelId/` |
| Username obfuscation | Yes (prevents pings) | No (Discord handles differently) |
| Rich content | mrkdwn formatting | Embeds, buttons, components |
| Slash commands | None | `/mom`, `/mom-stop`, `/mom-memory` |
| Message limit | 40,000 chars | 2,000 chars |

## Proposed Target Structure

```
packages/mom/src/
├── agent.ts                    # Core agent logic (transport-agnostic)
├── store.ts                    # Data persistence
├── sandbox.ts                  # Execution environment
├── log.ts                      # Console logging
├── tools/                      # Tool implementations
│   ├── index.ts
│   ├── bash.ts
│   ├── read.ts
│   ├── write.ts
│   ├── edit.ts
│   └── attach.ts
├── transport/
│   ├── types.ts                # Shared interfaces
│   ├── slack/
│   │   ├── index.ts            # SlackTransport class
│   │   └── client.ts           # Slack-specific client logic
│   └── discord/
│       ├── index.ts            # DiscordTransport class
│       ├── client.ts           # Discord-specific client logic
│       └── commands.ts         # Slash command handling
├── main.ts                     # Unified entry point with --transport flag
└── index.ts                    # Public exports
```

## Transport Interface Design

### Core Transport Context Interface

```typescript
// transport/types.ts

export interface TransportMessage {
  text: string;           // Message content (mentions stripped)
  rawText: string;        // Original text with mentions
  user: string;           // User ID
  userName?: string;      // Username/handle
  displayName?: string;   // Display name
  channel: string;        // Channel ID
  server?: string;        // Server/workspace ID (Discord: guildId)
  ts: string;             // Message ID/timestamp
  attachments: Attachment[];
}

export interface TransportContext {
  message: TransportMessage;
  channelName?: string;
  serverName?: string;    // Discord: guildName, Slack: workspace name
  store: ChannelStore;
  channels: ChannelInfo[];
  users: UserInfo[];

  // Core messaging
  respond(text: string, log?: boolean): Promise<void>;
  replaceMessage(text: string): Promise<void>;
  respondFollowUp(text: string): Promise<void>;

  // Status indicators
  setTyping(isTyping: boolean): Promise<void>;
  setWorking(working: boolean): Promise<void>;

  // File handling
  uploadFile(filePath: string, title?: string): Promise<void>;

  // Optional transport-specific features
  respondToolResult?(result: ToolResultData): Promise<void>;
  addStopButton?(): Promise<void>;
  removeStopButton?(): Promise<void>;
}

export interface TransportHandler {
  onMessage(ctx: TransportContext): Promise<void>;
  onStopRequest?(channelId: string): Promise<void>;
}

export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

## Implementation Phases

### Phase 1: Create Transport Abstraction (in mom package)

1. Create `transport/types.ts` with shared interfaces
2. Refactor `slack.ts` → `transport/slack/index.ts`
   - Implement `TransportContext` interface
   - Keep Slack-specific features (obfuscation, threading)
3. Update `agent.ts` to use `TransportContext` instead of `SlackContext`
4. Update imports in `main.ts`
5. **Test**: Verify Slack functionality still works

### Phase 2: Add Discord Transport (in mom package)

1. Copy Discord implementation from `mom-discord` to `transport/discord/`
2. Adapt to implement `TransportContext` interface
3. Keep Discord-specific features (embeds, buttons, slash commands)
4. Update `main.ts` to support `--transport=slack|discord` flag
5. **Test**: Verify Discord functionality works

### Phase 3: Unify Store for Multi-Transport

1. Update `store.ts` to handle both directory structures:
   - Slack: `workingDir/channelId/`
   - Discord: `workingDir/guildId/channelId/`
2. Add `serverId` parameter to store methods
3. Ensure backward compatibility with existing Slack data

### Phase 4: Cleanup and Documentation

1. Remove `packages/mom-discord/` (code now in `mom/src/transport/discord/`)
2. Update `package.json`:
   - Add `discord.js` as optional dependency
   - Add new binary entries (`mom-slack`, `mom-discord`, or flags)
3. Update README with multi-transport documentation
4. Update CHANGELOG

### Phase 5: AgentSession Integration (Future)

Mario mentioned he's working on integrating `AgentSession` from `coding-agent`. This would:
- Provide session persistence
- Enable conversation branching
- Support compaction (summarization of old messages)

**Recommendation**: Wait for Mario's implementation, then adapt the transport layer to work with it.

## Migration Strategy

### For Existing Slack Users
- No changes required
- Existing data directories continue to work
- `mom` command defaults to Slack transport

### For Discord Users
- Install updated `mom` package
- Use `mom --transport=discord` or `mom-discord` command
- Move data from `mom-discord` working directory if needed

## CLI Design Options

### Option A: Single Binary with Flag
```bash
mom --transport=slack ./data      # Slack (default)
mom --transport=discord ./data    # Discord
```

### Option B: Separate Binaries
```bash
mom ./data           # Slack
mom-discord ./data   # Discord
```

### Option C: Combined (Recommended)
```bash
# Default behavior (Slack)
mom ./data

# Explicit transport
mom --transport=discord ./data

# Aliases in package.json bin
mom-slack → mom --transport=slack
mom-discord → mom --transport=discord
```

## Environment Variables

### Slack Transport
- `MOM_SLACK_APP_TOKEN` - Socket mode app token
- `MOM_SLACK_BOT_TOKEN` - Bot OAuth token

### Discord Transport
- `DISCORD_BOT_TOKEN` - Discord bot token

### Shared
- `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing Slack users | Maintain backward compatibility, default to Slack |
| AgentSession conflicts | Coordinate with Mario, wait for his implementation |
| Discord.js bundle size | Make Discord dependencies optional/peer |
| Directory structure conflicts | Clear separation by transport, migration guide |

## Open Questions for Mario

1. **AgentSession timeline**: When will this be ready? Should we wait?
2. **Entry point preference**: Single binary with flag vs. separate binaries?
3. **Discord.js as dependency**: Optional peer dependency or full dependency?
4. **Backfill behavior**: Should Discord transport support message backfill like Slack?

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Transport Abstraction | 2-3 hours |
| Phase 2: Discord Transport | 1-2 hours (code exists) |
| Phase 3: Store Unification | 1 hour |
| Phase 4: Cleanup | 1 hour |
| **Total** | **5-7 hours** |

## Success Criteria

- [ ] Slack transport works identically to current implementation
- [ ] Discord transport works with all features (mentions, DMs, slash commands, embeds, buttons)
- [ ] Single codebase, no duplicate code between transports
- [ ] Clear separation of transport-specific vs. shared code
- [ ] Backward compatible with existing Slack data
- [ ] Documentation updated

---

*Created: December 2024*
*Status: Ready for Review*
