# Agent Hooks for Discord Bot

This module provides **pi-coding-agent compatible hooks** for the discord-bot agent system. Based on [prateekmedia/pi-hooks](https://github.com/prateekmedia/pi-hooks) patterns.

## Available Hooks

### 1. Checkpoint Hook

Git-based state checkpointing for conversation branching.

**Features:**
- Captures tracked, staged, AND untracked files (respects .gitignore)
- Persists checkpoints as git refs (survives session resume)
- Saves current state before restore (allows going back to latest)

```typescript
import { checkpointHook, createCheckpointHook, CheckpointUtils } from './agents/hooks';

// Use default hook
manager.register(createHookRegistration('checkpoint', checkpointHook));

// Or customize
const customCheckpoint = createCheckpointHook({
  enabled: true,
  autoCreate: true,
  maxCheckpoints: 100,
  refBase: 'refs/pi-checkpoints',
});

// Manual checkpoint operations
await CheckpointUtils.createCheckpoint(cwd, id, turnIndex, sessionId);
await CheckpointUtils.restoreCheckpoint(cwd, checkpointData);
const checkpoints = await CheckpointUtils.loadAllCheckpoints(cwd);

// Checkpoint Tagging
const tag = await CheckpointUtils.tagCheckpoint(cwd, checkpointId, 'v1.0', 'First working version');
const tags = await CheckpointUtils.listTags(cwd);
const checkpoint = await CheckpointUtils.getCheckpointByTag(cwd, 'v1.0');
await CheckpointUtils.deleteTag(cwd, 'v1.0');
```

### 2. LSP Hook

Language Server Protocol integration for diagnostics feedback.

**Supported Languages:**
- TypeScript/JavaScript (typescript-language-server)
- Python (pyright-langserver)
- Go (gopls)
- Rust (rust-analyzer)
- Dart/Flutter (dart language-server)
- Vue (vue-language-server)
- Svelte (svelteserver)

```typescript
import { lspHook, createLSPHook, LSPUtils } from './agents/hooks';

// Use default hook
manager.register(createHookRegistration('lsp', lspHook));

// Or customize
const customLSP = createLSPHook({
  enabled: true,
  waitMs: 3000,
  initTimeoutMs: 30000,
  servers: ['typescript', 'pyright', 'gopls'],
});

// Check available language servers
console.log(LSPUtils.LSP_SERVERS);
console.log(LSPUtils.LANGUAGE_IDS);
```

### 3. Expert Hook

Act-Learn-Reuse expertise integration (TAC Lesson 13).

**Features:**
- Auto-detect domain from task content
- Inject accumulated expertise into agent context
- Extract and persist learnings from agent output
- Risk-aware domain handling

**Domains:**
| Domain | Risk Level | Description |
|--------|------------|-------------|
| security | critical | Authentication, encryption, secrets |
| database | critical | Schema, migrations, queries |
| trading | critical | Market operations, risk management |
| billing | critical | Payment processing, subscriptions |
| api_integration | high | External API contracts |
| performance | high | Optimization, profiling |
| user_experience | medium | UI/UX patterns |
| error_recovery | medium | Error handling, recovery |

```typescript
import { expertHook, createExpertHook, ExpertUtils, detectDomain } from './agents/hooks';

// Use default hook
manager.register(createHookRegistration('expert', expertHook));

// Detect domain from task
const domain = detectDomain('Fix SQL injection in login form');
// => 'security'

// Build expert context
const context = ExpertUtils.buildExpertContext(task, domain);

// Create enhanced prompt with expertise
const prompt = ExpertUtils.createExpertPrompt(task, context);
```

## Hook Manager

Coordinates all registered hooks and routes events.

### Metrics

The hook manager tracks detailed execution metrics:

```typescript
import { AgentHookManager, type HookMetrics } from './agents/hooks';

const manager = new AgentHookManager(cwd);

// Get current metrics
const metrics: HookMetrics = manager.getMetrics();
console.log(metrics.totalEvents);        // Total events emitted
console.log(metrics.eventsByType);       // Events by type (turn_start: 5, tool_call: 20, etc.)
console.log(metrics.executionTimes);     // Execution times (total, byHook, byEvent)
console.log(metrics.errors);             // Error counts (total, byHook)
console.log(metrics.session);            // Session info (startTime, sessionId, turnCount)
console.log(metrics.toolCalls);          // Tool call stats (total, blocked, modified)

// Reset metrics on new session
manager.resetMetrics('new-session-id');
```

### Debug Logging

Enable detailed logging for troubleshooting:

```typescript
import { enableDebugLogging, isDebugLoggingEnabled } from './agents/hooks';

// Enable debug logging
enableDebugLogging(true);

// Check if enabled
if (isDebugLoggingEnabled()) {
  console.log('Debug logging is active');
}

// Disable
enableDebugLogging(false);
```

Debug logs include:
- Event emission with hook count
- Individual handler execution
- Tool blocking decisions
- Tool result modifications
- Event timing

### Basic Usage

```typescript
import {
  AgentHookManager,
  createHookRegistration,
  createDefaultHookManager,
  createDiscordContext,
} from './agents/hooks';

// Create manager with all hooks
const manager = createDefaultHookManager(process.cwd(), {
  checkpoint: true,
  lsp: true,
  expert: true,
  onSend: (text) => console.log('Agent message:', text),
});

// Or manual setup
const manager = new AgentHookManager(cwd);
manager.register(createHookRegistration('checkpoint', checkpointHook));
manager.register(createHookRegistration('lsp', lspHook));
manager.register(createHookRegistration('expert', expertHook));

// Emit events during agent execution
await manager.emit({ type: 'session', reason: 'start', sessionId: '...' });
await manager.emit({ type: 'turn_start', turnIndex: 0, timestamp: Date.now() });

// Handle tool results (LSP diagnostics appended automatically)
const result = await manager.emit({
  type: 'tool_result',
  toolName: 'write',
  toolCallId: '...',
  input: { path: 'src/index.ts' },
  result: 'File written',
  isError: false,
});

// Branch events (checkpoint restore)
const branchResult = await manager.emit({
  type: 'branch',
  targetTurnIndex: 5,
  entries: [...],
  sessionId: '...',
});
```

## Discord Integration

### Per-Channel Hook Integration

The `discord-integration.ts` module provides turnkey integration with Discord bot's agent lifecycle:

```typescript
import {
  createDiscordHookIntegration,
  getChannelHookIntegration,
  disposeChannelHookIntegration,
  generateSessionId,
  type HookIntegration,
} from './agents/hooks';

// Create per-channel hook integration
const hooks = createDiscordHookIntegration({
  cwd: channelDir,
  channelId: '1234567890',
  userId: 'user123',
  checkpoint: true,  // Enable git checkpointing
  lsp: true,         // Enable LSP diagnostics
  expert: true,      // Enable Act-Learn-Reuse
});

// Emit lifecycle events
await hooks.emitSession('start', generateSessionId(channelId));
await hooks.emitTurnStart(turnIndex);
await hooks.emitTurnEnd(turnIndex, messages);

// Tool events (can block or modify results)
const { block, reason } = await hooks.emitToolCall('bash', 'call-123', { command: 'rm -rf /' });
if (block) {
  return `Blocked: ${reason}`;
}

const { result, isError } = await hooks.emitToolResult('write', 'call-456', input, output, false);

// Cleanup when channel closes
disposeChannelHookIntegration(channelId);
```

### Tool Wrapping

Wrap existing tools to automatically emit hook events:

```typescript
import { wrapToolWithHooks } from './agents/hooks';

const bashTool = createBashTool();
const hookedBashTool = wrapToolWithHooks(bashTool, () => getChannelHookIntegration(channelId));

// Tool now automatically emits tool_call and tool_result events
await hookedBashTool.execute({ command: 'echo hello' });
```

### Discord Context

Create Discord-aware context for custom hooks:

```typescript
import { createDiscordContext } from './agents/hooks';

// Create Discord-aware context
const ctx = createDiscordContext(cwd, {
  channelId: message.channelId,
  userId: message.author.id,
  selectCallback: async (title, options) => {
    // Show Discord select menu
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('hook-select')
        .setPlaceholder(title)
        .addOptions(options.map(o => ({ label: o, value: o })))
    );
    // ...
  },
  notifyCallback: (message, type) => {
    // Send Discord message
    channel.send(`**${type?.toUpperCase()}:** ${message}`);
  },
});

// Use with manager
await manager.emit(event, ctx);
```

### Integration in main.ts

The hooks are automatically integrated into the Discord bot agent lifecycle:

```typescript
// In getChannelState() - creates hook integration per channel
const hooks = createDiscordHookIntegration({
  cwd: channelDir,
  channelId,
  checkpoint: true,
  lsp: true,
  expert: true,
});
hooks.emitSession('start', sessionId);

state = { running: false, agent, hooks, sessionId, turnIndex: 0 };

// In handleAgentRequest() - emits turn events
state.turnIndex++;
await state.hooks.emitTurnStart(state.turnIndex);

// ... agent execution ...

await state.hooks.emitTurnEnd(state.turnIndex, messages);
```

## Pre-configured Hook Sets

```typescript
import { ALL_HOOKS, CODING_HOOKS, MINIMAL_HOOKS, SECURITY_HOOKS } from './agents/hooks';

// All available hooks
Object.values(ALL_HOOKS).forEach(hook => manager.register(hook));

// Recommended for coding tasks (checkpoint + LSP + expert)
CODING_HOOKS.forEach(hook => manager.register(hook));

// Minimal for non-coding tasks (expert only)
MINIMAL_HOOKS.forEach(hook => manager.register(hook));

// Security-focused (checkpoint + expert)
SECURITY_HOOKS.forEach(hook => manager.register(hook));
```

## pi-coding-agent Compatibility

These hooks are designed to be compatible with pi-coding-agent's hook system.

### Using with pi-coding-agent

```bash
# Copy hooks to pi-coding-agent hooks directory
cp -r src/agents/hooks ~/.pi/agent/hooks/discord-bot-hooks

# Or use directly in pi-coding-agent
pi --hook ./src/agents/hooks/checkpoint-hook.ts
pi --hook ./src/agents/hooks/lsp-hook.ts
pi --hook ./src/agents/hooks/expert-hook.ts
```

### Event Types (pi-coding-agent compatible)

| Event | Description | Return Type |
|-------|-------------|-------------|
| session | Session start/switch/clear | void |
| agent_start | Agent loop starts | void |
| agent_end | Agent loop ends | void |
| turn_start | Turn begins | void |
| turn_end | Turn completes | void |
| tool_call | Before tool execution | ToolCallEventResult (can block) |
| tool_result | After tool execution | ToolResultEventResult (can modify) |
| branch | Conversation branching | BranchEventResult |

## License

Same as pi-mono project.
