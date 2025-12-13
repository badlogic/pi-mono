# mom-core Extraction Plan

> **Status**: Draft / Future Consideration
> **Note**: This refactoring should be coordinated with the original author (Mario Zechner) as it modifies the existing `mom` package structure.

---

## Overview

Extract shared functionality from `mom` into a reusable `mom-core` package that can be consumed by platform-specific implementations (Slack, Discord, etc.).

---

## Goals

1. **DRY**: Eliminate code duplication between mom-slack and mom-discord
2. **Maintainability**: Single source of truth for core logic
3. **Extensibility**: Easy to add new platforms (Teams, Telegram, etc.)
4. **Backward Compatibility**: Existing mom (Slack) should work unchanged after refactor

---

## Proposed Package Structure

```
packages/
├── mom-core/                    # NEW: Shared core functionality
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # Public exports
│       ├── agent.ts             # Platform-agnostic agent runner
│       ├── sandbox.ts           # Docker/host execution
│       ├── store.ts             # Data persistence (abstract)
│       ├── log.ts               # Logging utilities
│       ├── memory.ts            # Memory system (MEMORY.md)
│       ├── types.ts             # Shared types/interfaces
│       └── tools/
│           ├── index.ts         # Tool factory
│           ├── bash.ts          # Shell execution
│           ├── read.ts          # File reading
│           ├── write.ts         # File writing
│           ├── edit.ts          # File editing
│           └── types.ts         # Tool interfaces
│
├── mom/                         # REFACTORED: Slack-specific
│   ├── package.json             # Now depends on @mariozechner/mom-core
│   └── src/
│       ├── main.ts              # Slack entry point
│       ├── slack.ts             # Slack client & events
│       ├── attach.ts            # Slack file upload
│       └── formatter.ts         # Slack mrkdwn formatting
│
└── mom-discord/                 # NEW: Discord-specific
    ├── package.json             # Depends on @mariozechner/mom-core
    └── src/
        ├── main.ts              # Discord entry point
        ├── discord.ts           # Discord client & events
        ├── commands.ts          # Slash commands
        ├── attach.ts            # Discord file upload
        └── formatter.ts         # Discord markdown formatting
```

---

## mom-core Public API

### Types & Interfaces

```typescript
// types.ts

export interface PlatformContext {
  channelId: string;
  userId: string;
  userName: string;
  displayName: string;
  text: string;
  attachments: Attachment[];

  // Platform-specific callbacks
  respond: (text: string) => Promise<void>;
  updateMessage: (messageId: string, text: string) => Promise<void>;
  setWorking: (working: boolean) => Promise<void>;
  uploadFile: (path: string, title?: string) => Promise<void>;
}

export interface PlatformAdapter {
  name: string;  // 'slack' | 'discord' | etc.

  // Format text for the platform
  formatCode: (code: string, language?: string) => string;
  formatBold: (text: string) => string;
  formatItalic: (text: string) => string;
  formatLink: (text: string, url: string) => string;
  formatMention: (userId: string) => string;
  formatChannel: (channelId: string) => string;

  // Platform-specific limits
  maxMessageLength: number;
  maxEmbedLength?: number;
}

export interface AgentConfig {
  workingDirectory: string;
  sandboxMode: 'host' | `docker:${string}`;
  platform: PlatformAdapter;
  model?: string;  // Default: 'claude-sonnet-4-5'
}

export interface ToolResult {
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  details?: any;
}
```

### Agent Runner

```typescript
// agent.ts

export interface AgentRunner {
  run(ctx: PlatformContext): Promise<void>;
  stop(): void;
}

export function createAgentRunner(config: AgentConfig): AgentRunner;

// Builds platform-agnostic system prompt
export function buildSystemPrompt(
  config: AgentConfig,
  memory: { global: string; channel: string },
  channelContext: ChannelContext
): string;
```

### Tools

```typescript
// tools/index.ts

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ToolResult>;
}

export function createTools(config: AgentConfig): Tool[];

// Individual tool factories (for custom configurations)
export { createBashTool } from './bash';
export { createReadTool } from './read';
export { createWriteTool } from './write';
export { createEditTool } from './edit';
```

### Store

```typescript
// store.ts

export interface StoreConfig {
  workingDirectory: string;
  channelId: string;
  guildId?: string;  // For Discord
}

export interface ChannelStore {
  logMessage(entry: LogEntry): Promise<void>;
  getHistory(limit?: number): Promise<LogEntry[]>;
  downloadAttachment(url: string, filename: string): Promise<string>;
  getMemory(): Promise<string>;
  setMemory(content: string): Promise<void>;
}

export function createChannelStore(config: StoreConfig): ChannelStore;
```

### Sandbox

```typescript
// sandbox.ts

export type SandboxMode = 'host' | `docker:${string}`;

export interface SandboxConfig {
  mode: SandboxMode;
  workingDirectory: string;
  timeout?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export function executeCommand(
  command: string,
  config: SandboxConfig,
  signal?: AbortSignal
): Promise<CommandResult>;

export function validateSandbox(mode: SandboxMode): Promise<void>;
```

### Memory

```typescript
// memory.ts

export interface MemoryManager {
  getGlobalMemory(): Promise<string>;
  getChannelMemory(channelId: string): Promise<string>;
  setGlobalMemory(content: string): Promise<void>;
  setChannelMemory(channelId: string, content: string): Promise<void>;
}

export function createMemoryManager(workingDirectory: string): MemoryManager;
```

---

## Refactoring Steps

### Phase 1: Create mom-core Package

1. Create `packages/mom-core/` directory structure
2. Define all interfaces in `types.ts`
3. Move platform-agnostic code:
   - `sandbox.ts` → copy as-is
   - `log.ts` → copy as-is
   - `tools/bash.ts` → copy as-is
   - `tools/read.ts` → copy as-is
   - `tools/write.ts` → copy as-is
   - `tools/edit.ts` → copy as-is
4. Create `store.ts` with abstract interface
5. Create `memory.ts` for memory management
6. Refactor `agent.ts`:
   - Extract platform-agnostic prompt building
   - Accept `PlatformAdapter` for formatting
   - Accept `PlatformContext` for callbacks
7. Set up package.json with exports

### Phase 2: Refactor mom (Slack)

1. Add dependency on `@mariozechner/mom-core`
2. Create `formatter.ts` implementing `PlatformAdapter`:
   ```typescript
   export const slackAdapter: PlatformAdapter = {
     name: 'slack',
     formatCode: (code, lang) => '```' + code + '```',
     formatBold: (text) => `*${text}*`,
     formatItalic: (text) => `_${text}_`,
     formatLink: (text, url) => `<${url}|${text}>`,
     formatMention: (userId) => `<@${userId}>`,
     formatChannel: (channelId) => `<#${channelId}>`,
     maxMessageLength: 40000,
   };
   ```
3. Update `slack.ts` to create `PlatformContext`
4. Update `main.ts` to use `createAgentRunner` from core
5. Move `attach.ts` to platform-specific (Slack API)
6. Remove duplicated code (now in core)
7. Update imports throughout

### Phase 3: Create mom-discord

1. Create `packages/mom-discord/`
2. Add dependency on `@mariozechner/mom-core`
3. Create `formatter.ts` implementing `PlatformAdapter`:
   ```typescript
   export const discordAdapter: PlatformAdapter = {
     name: 'discord',
     formatCode: (code, lang) => '```' + (lang || '') + '\n' + code + '\n```',
     formatBold: (text) => `**${text}**`,
     formatItalic: (text) => `*${text}*`,
     formatLink: (text, url) => `[${text}](${url})`,
     formatMention: (userId) => `<@${userId}>`,
     formatChannel: (channelId) => `<#${channelId}>`,
     maxMessageLength: 2000,
     maxEmbedLength: 4096,
   };
   ```
4. Create `discord.ts` with Discord.js client
5. Create `commands.ts` for slash commands
6. Create `attach.ts` for Discord file uploads
7. Create `main.ts` entry point

### Phase 4: Testing & Validation

1. Ensure mom (Slack) works identically after refactor
2. Test mom-discord with shared core
3. Verify all tools work on both platforms
4. Test memory system on both platforms
5. Test Docker sandbox on both platforms

---

## Package Dependencies

### mom-core

```json
{
  "name": "@mariozechner/mom-core",
  "version": "0.12.9",
  "dependencies": {
    "@anthropic-ai/sandbox-runtime": "^0.0.16",
    "@mariozechner/pi-agent-core": "^0.12.9",
    "@mariozechner/pi-ai": "^0.12.9",
    "@sinclair/typebox": "^0.34.0",
    "chalk": "^5.6.2",
    "diff": "^8.0.2"
  }
}
```

### mom (Slack) - After Refactor

```json
{
  "name": "@mariozechner/pi-mom",
  "version": "0.13.0",
  "dependencies": {
    "@mariozechner/mom-core": "^0.12.9",
    "@slack/socket-mode": "^2.0.0",
    "@slack/web-api": "^7.0.0"
  }
}
```

### mom-discord

```json
{
  "name": "@mariozechner/mom-discord",
  "version": "0.1.0",
  "dependencies": {
    "@mariozechner/mom-core": "^0.12.9",
    "discord.js": "^14.0.0"
  }
}
```

---

## Migration Considerations

### Breaking Changes

The refactor should be **non-breaking** for mom users:
- CLI interface unchanged
- Environment variables unchanged
- Data directory structure unchanged
- Behavior unchanged

### Version Strategy

| Package | Current | After Refactor |
|---------|---------|----------------|
| mom | 0.12.9 | 0.13.0 (minor bump) |
| mom-core | - | 0.12.9 (new) |
| mom-discord | - | 0.1.0 (new) |

### Monorepo Considerations

- All packages stay in `packages/` directory
- Shared versioning via lerna/changesets
- Workspace dependencies for local development

---

## Pros & Cons

### Pros

1. **No code duplication** - Single source of truth
2. **Easier maintenance** - Fix bugs once, all platforms benefit
3. **Consistent behavior** - Same agent logic everywhere
4. **Easier to add platforms** - Just implement adapter + client
5. **Better testing** - Test core logic independently

### Cons

1. **Refactoring risk** - Could break existing mom
2. **Coordination required** - Need author buy-in
3. **More packages** - Slightly more complexity
4. **Version coupling** - Core changes affect all platforms
5. **Initial effort** - More work upfront than copy-paste

---

## Recommendation

**For now**: Use the copy & adapt approach for mom-discord.

**Later**: If mom-discord is successful and there's interest in more platforms (Teams, Telegram, Matrix, etc.), propose the mom-core extraction to the author.

**Trigger for extraction**:
- 2+ platform implementations exist
- Significant code drift between implementations
- Author expresses interest in supporting multiple platforms

---

## Future Platform Ideas

With mom-core, adding new platforms becomes straightforward:

| Platform | Library | Complexity |
|----------|---------|------------|
| Microsoft Teams | `@microsoft/teams-js` | Medium |
| Telegram | `telegraf` or `node-telegram-bot-api` | Low |
| Matrix | `matrix-js-sdk` | Medium |
| IRC | `irc` | Low |
| CLI (local) | None (stdin/stdout) | Very Low |
| Web UI | WebSocket server | Medium |

Each would only need:
- Platform client (~200-400 lines)
- Platform adapter (~50 lines)
- Attach tool adaptation (~50 lines)
