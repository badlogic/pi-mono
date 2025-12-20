# coding-agent Development Guide

This document describes the architecture and development workflow for the coding-agent package.

## Architecture Overview

The coding-agent is structured into distinct layers:

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                           │
│  cli.ts → main.ts → cli/args.ts, cli/file-processor.ts     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Mode Layer                            │
│  modes/interactive/   modes/print-mode.ts   modes/rpc/     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Core Layer                            │
│  core/agent-session.ts (central abstraction)               │
│  core/session-manager.ts, core/model-config.ts, etc.       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   External Dependencies                     │
│  @mariozechner/pi-agent (Agent, tools)                     │
│  @mariozechner/pi-ai (models, providers)                   │
│  @mariozechner/pi-tui (TUI components)                     │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── cli.ts                    # CLI entry point (shebang, calls main)
├── main.ts                   # Main orchestration, argument handling, mode routing
├── index.ts                  # Public API exports
├── config.ts                 # APP_NAME, VERSION, paths (getAgentDir, etc.)

├── cli/                      # CLI-specific utilities
│   ├── args.ts               # parseArgs(), printHelp(), Args interface
│   ├── file-processor.ts     # processFileArguments() for @file args
│   ├── list-models.ts        # --list-models implementation
│   └── session-picker.ts     # selectSession() TUI for --resume

├── core/                     # Core business logic (mode-agnostic)
│   ├── index.ts              # Core exports
│   ├── agent-session.ts      # AgentSession class - THE central abstraction
│   ├── bash-executor.ts      # executeBash() with streaming, abort
│   ├── compaction.ts         # Context compaction logic
│   ├── export-html.ts        # exportSession(), exportFromFile()
│   ├── messages.ts           # BashExecutionMessage, messageTransformer
│   ├── model-config.ts       # findModel(), getAvailableModels(), getApiKeyForModel()
│   ├── model-resolver.ts     # resolveModelScope(), restoreModelFromSession()
│   ├── session-manager.ts    # SessionManager class - JSONL persistence
│   ├── settings-manager.ts   # SettingsManager class - user preferences
│   ├── skills.ts             # loadSkills(), skill discovery from multiple locations
│   ├── slash-commands.ts     # loadSlashCommands() from ~/.pi/agent/commands/
│   ├── system-prompt.ts      # buildSystemPrompt(), loadProjectContextFiles()
│   │
│   ├── oauth/                # OAuth authentication (thin wrapper)
│   │   └── index.ts          # Re-exports from @mariozechner/pi-ai with convenience wrappers
│   │
│   ├── hooks/                # Hook system for extending behavior
│   │   ├── index.ts          # Hook exports
│   │   ├── types.ts          # HookAPI, HookContext, event types
│   │   ├── loader.ts         # loadHooks() from multiple locations
│   │   ├── runner.ts         # runHook() event dispatch
│   │   └── tool-wrapper.ts   # wrapToolsWithHooks() for tool_call events
│   │
│   ├── custom-tools/         # Custom tool loading system
│   │   ├── index.ts          # Custom tool exports
│   │   ├── types.ts          # CustomToolFactory, CustomToolDefinition
│   │   └── loader.ts         # loadCustomTools() from multiple locations
│   │
│   └── tools/                # Built-in tool implementations
│       ├── index.ts          # Tool exports, allTools, codingTools
│       ├── bash.ts           # Bash command execution
│       ├── edit.ts           # Surgical file editing
│       ├── find.ts           # File search by glob
│       ├── grep.ts           # Content search (regex/literal)
│       ├── ls.ts             # Directory listing
│       ├── read.ts           # File reading (text and images)
│       ├── write.ts          # File writing
│       ├── path-utils.ts     # Path resolution utilities
│       └── truncate.ts       # Output truncation utilities

├── modes/                    # Run mode implementations
│   ├── index.ts              # Re-exports InteractiveMode, runPrintMode, runRpcMode, RpcClient
│   ├── print-mode.ts         # Non-interactive: process messages, print output, exit
│   │
│   ├── rpc/                  # RPC mode for programmatic control
│   │   ├── rpc-mode.ts       # runRpcMode() - JSON stdin/stdout protocol
│   │   ├── rpc-types.ts      # RpcCommand, RpcResponse, RpcSessionState types
│   │   └── rpc-client.ts     # RpcClient class for spawning/controlling agent
│   │
│   └── interactive/          # Interactive TUI mode
│       ├── interactive-mode.ts   # InteractiveMode class
│       │
│       ├── components/           # TUI components
│       │   ├── assistant-message.ts    # Agent response rendering
│       │   ├── bash-execution.ts       # Bash output display
│       │   ├── compaction.ts           # Compaction status display
│       │   ├── custom-editor.ts        # Multi-line input editor
│       │   ├── dynamic-border.ts       # Adaptive border rendering
│       │   ├── footer.ts               # Status bar / footer
│       │   ├── hook-input.ts           # Hook input dialog
│       │   ├── hook-selector.ts        # Hook selection UI
│       │   ├── model-selector.ts       # Model picker
│       │   ├── oauth-selector.ts       # OAuth provider picker
│       │   ├── queue-mode-selector.ts  # Message queue mode picker
│       │   ├── session-selector.ts     # Session browser for --resume
│       │   ├── show-images-selector.ts # Image display toggle
│       │   ├── theme-selector.ts       # Theme picker
│       │   ├── thinking-selector.ts    # Thinking level picker
│       │   ├── tool-execution.ts       # Tool call/result rendering
│       │   ├── user-message-selector.ts # Message selector for /branch
│       │   └── user-message.ts         # User message rendering
│       │
│       └── theme/
│           ├── theme.ts      # Theme loading, getEditorTheme(), etc.
│           ├── dark.json
│           ├── light.json
│           └── theme-schema.json

└── utils/                    # Generic utilities
    ├── changelog.ts          # parseChangelog(), getNewEntries()
    ├── clipboard.ts          # copyToClipboard()
    ├── fuzzy.ts              # Fuzzy string matching
    ├── mime.ts               # MIME type detection
    ├── shell.ts              # getShellConfig()
    └── tools-manager.ts      # ensureTool() - download fd, etc.
```

## Key Abstractions

### AgentSession (core/agent-session.ts)

The central abstraction that wraps the low-level `Agent` with:
- Session persistence (via SessionManager)
- Settings persistence (via SettingsManager)
- Model cycling with scoped models
- Context compaction
- Bash command execution
- Message queuing
- Hook integration
- Custom tool loading

All three modes (interactive, print, rpc) use AgentSession.

### InteractiveMode (modes/interactive/interactive-mode.ts)

Handles TUI rendering and user interaction:
- Subscribes to AgentSession events
- Renders messages, tool executions, streaming
- Manages editor, selectors, key handlers
- Delegates all business logic to AgentSession

### RPC Mode (modes/rpc/)

Headless operation via JSON protocol over stdin/stdout:

- **rpc-mode.ts**: `runRpcMode()` function that listens for JSON commands on stdin and emits responses/events on stdout
- **rpc-types.ts**: Typed protocol definitions (`RpcCommand`, `RpcResponse`, `RpcSessionState`)
- **rpc-client.ts**: `RpcClient` class for spawning the agent as a subprocess and controlling it programmatically

The RPC mode exposes the full AgentSession API via JSON commands. See [docs/rpc.md](docs/rpc.md) for protocol documentation.

### SessionManager (core/session-manager.ts)

Handles session persistence:
- JSONL format for append-only writes
- Session file location management
- Message loading/saving
- Model/thinking level persistence

### SettingsManager (core/settings-manager.ts)

Handles user preferences:
- Default model/provider
- Theme selection
- Queue mode
- Thinking block visibility
- Compaction settings
- Hook/custom tool paths

### Hook System (core/hooks/)

Extensibility layer for intercepting agent behavior:
- **loader.ts**: Discovers and loads hooks from `~/.pi/agent/hooks/`, `.pi/hooks/`, and CLI
- **runner.ts**: Dispatches events to registered hooks
- **tool-wrapper.ts**: Wraps tools to emit `tool_call` and `tool_result` events
- **types.ts**: Event types (`session`, `tool_call`, `tool_result`, `message`, `error`)

See [docs/hooks.md](docs/hooks.md) for full documentation.

### Custom Tools (core/custom-tools/)

System for adding LLM-callable tools:
- **loader.ts**: Discovers and loads tools from `~/.pi/agent/tools/`, `.pi/tools/`, and CLI
- **types.ts**: `CustomToolFactory`, `CustomToolDefinition`, `CustomToolResult`

See [docs/custom-tools.md](docs/custom-tools.md) for full documentation.

### Skills (core/skills.ts)

On-demand capability packages:
- Discovers SKILL.md files from multiple locations
- Provides specialized workflows and instructions
- Loaded when task matches description

See [docs/skills.md](docs/skills.md) for full documentation.

## Development Workflow

### Running in Development

Start the watch build in the monorepo root to continuously rebuild all packages:

```bash
# Terminal 1: Watch build (from monorepo root)
npm run dev
```

Then run the CLI with tsx in a separate terminal:

```bash
# Terminal 2: Run CLI (from monorepo root)
npx tsx packages/coding-agent/src/cli.ts

# With arguments
npx tsx packages/coding-agent/src/cli.ts --help
npx tsx packages/coding-agent/src/cli.ts -p "Hello"

# RPC mode
npx tsx packages/coding-agent/src/cli.ts --mode rpc --no-session
```

The watch build ensures changes to dependent packages (`pi-agent`, `pi-ai`, `pi-tui`) are automatically rebuilt.

### Type Checking

```bash
# From monorepo root
npm run check
```

### Building

```bash
# Build all packages
npm run build

# Build standalone binary
cd packages/coding-agent
npm run build:binary
```

## Adding New Features

### Adding a New Slash Command

1. If it's a UI-only command (e.g., `/theme`), add handler in `interactive-mode.ts` `setupEditorSubmitHandler()`
2. If it needs session logic, add method to `AgentSession` and call from mode

### Adding a New Tool

1. Create tool in `core/tools/` following existing patterns
2. Export from `core/tools/index.ts`
3. Add to `allTools` and optionally `codingTools`
4. Add description to `toolDescriptions` in `core/system-prompt.ts`

### Adding a New Hook Event

1. Add event type to `HookEvent` union in `core/hooks/types.ts`
2. Add emission point in relevant code (AgentSession, tool wrapper, etc.)
3. Document in `docs/hooks.md`

### Adding a New RPC Command

1. Add command type to `RpcCommand` union in `rpc-types.ts`
2. Add response type to `RpcResponse` union in `rpc-types.ts`
3. Add handler case in `handleCommand()` switch in `rpc-mode.ts`
4. Add client method in `RpcClient` class in `rpc-client.ts`
5. Document in `docs/rpc.md`

### Adding a New Selector

1. Create component in `modes/interactive/components/`
2. Use `showSelector()` helper in `interactive-mode.ts`:

```typescript
private showMySelector(): void {
    this.showSelector((done) => {
        const selector = new MySelectorComponent(
            // ... params
            (result) => {
                // Handle selection
                done();
                this.showStatus(`Selected: ${result}`);
            },
            () => {
                done();
                this.ui.requestRender();
            },
        );
        return { component: selector, focus: selector.getSelectList() };
    });
}
```

## Testing

The package uses E2E tests only (no unit tests by design). Tests are in `test/`:

```bash
# Run all tests
npm test

# Run specific test pattern
npm test -- --testNamePattern="RPC"

# Run RPC example interactively
npx tsx test/rpc-example.ts
```

## Code Style

- No `any` types unless absolutely necessary
- No inline dynamic imports
- Use `showStatus()` for dim status messages
- Use `showError()` / `showWarning()` for errors/warnings
- Keep InteractiveMode focused on UI, delegate logic to AgentSession
