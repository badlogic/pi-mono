# Custom Tools

Custom tools are additional tools that the LLM can call directly, just like the built-in `read`, `write`, `edit`, and `bash` tools. They are TypeScript modules that define callable functions with parameters, return values, and optional TUI rendering.

**Key capabilities:**
- **User interaction** - Prompt users via `pi.ui` (select, confirm, input dialogs)
- **Custom rendering** - Control how tool calls and results appear via `renderCall`/`renderResult`
- **TUI components** - Render custom components with `pi.ui.custom()` (see [tui.md](tui.md))
- **State management** - Persist state in tool result `details` for proper branching support
- **Streaming results** - Send partial updates via `onUpdate` callback

**Example use cases:**
- Interactive dialogs (questions with selectable options)
- Stateful tools (todo lists, connection pools)
- Rich output rendering (progress indicators, structured views)
- External service integrations with confirmation flows

**When to use custom tools vs. alternatives:**

| Need | Solution |
|------|----------|
| Always-needed context (conventions, commands) | AGENTS.md |
| User triggers a specific prompt template | Slash command |
| On-demand capability package (workflows, scripts, setup) | Skill |
| Additional tool directly callable by the LLM | **Custom tool** |

See [examples/custom-tools/](../examples/custom-tools/) for working examples.

## Quick Start

Create a file `~/.pi/agent/tools/hello/index.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import type { CustomToolFactory } from "@mariozechner/pi-coding-agent";

const factory: CustomToolFactory = (pi) => ({
  name: "hello",
  label: "Hello",
  description: "A simple greeting tool",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),

  async execute(toolCallId, params, onUpdate, ctx, signal) {
    const { name } = params as { name: string };
    return {
      content: [{ type: "text", text: `Hello, ${name}!` }],
      details: { greeted: name },
    };
  },
});

export default factory;
```

The tool is automatically discovered and available in your next pi session.

## Tool Locations

Tools must be in a subdirectory with an `index.ts` entry point:

| Location | Scope | Auto-discovered |
|----------|-------|-----------------|
| `~/.pi/agent/tools/*/index.ts` | Global (all projects) | Yes |
| `.pi/tools/*/index.ts` | Project-local | Yes |
| `settings.json` `customTools` array | Configured paths | Yes |
| `--tool <path>` CLI flag | One-off/debugging | No |

**Example structure:**
```
~/.pi/agent/tools/
├── hello/
│   └── index.ts        # Entry point (auto-discovered)
└── complex-tool/
    ├── index.ts        # Entry point (auto-discovered)
    ├── helpers.ts      # Helper module (not loaded directly)
    └── types.ts        # Type definitions (not loaded directly)
```

**Priority:** Later sources win on name conflicts. CLI `--tool` takes highest priority.

**Reserved names:** Custom tools cannot use built-in tool names (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`).

## Available Imports

Custom tools can import from these packages (automatically resolved by pi):

| Package | Purpose |
|---------|---------|
| `@sinclair/typebox` | Schema definitions (`Type.Object`, `Type.String`, etc.) |
| `@mariozechner/pi-coding-agent` | Types (`CustomToolFactory`, `CustomTool`, `CustomToolContext`, etc.) |
| `@mariozechner/pi-ai` | AI utilities (`StringEnum` for Google-compatible enums) |
| `@mariozechner/pi-tui` | TUI components (`Text`, `Box`, etc. for custom rendering) |

Node.js built-in modules (`node:fs`, `node:path`, etc.) are also available.

## Tool Definition

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import type {
  CustomTool,
  CustomToolContext,
  CustomToolFactory,
  CustomToolSessionEvent,
} from "@mariozechner/pi-coding-agent";

const factory: CustomToolFactory = (pi) => ({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (be specific for LLM)",
  parameters: Type.Object({
    // Use StringEnum for string enums (Google API compatible)
    action: StringEnum(["list", "add", "remove"] as const),
    text: Type.Optional(Type.String()),
  }),

  async execute(toolCallId, params, onUpdate, ctx, signal) {
    // signal - AbortSignal for cancellation
    // onUpdate - Callback for streaming partial results
    // ctx - CustomToolContext with sessionManager, modelRegistry, model
    return {
      content: [{ type: "text", text: "Result for LLM" }],
      details: { /* structured data for rendering */ },
    };
  },

  // Optional: Session lifecycle callback
  onSession(event, ctx) {
    if (event.reason === "shutdown") {
      // Cleanup resources (close connections, save state, etc.)
      return;
    }
    // Reconstruct state from ctx.sessionManager.getBranch()
  },

  // Optional: Custom rendering
  renderCall(args, theme) { /* return Component */ },
  renderResult(result, options, theme) { /* return Component */ },
});

export default factory;
```

**Important:** Use `StringEnum` from `@mariozechner/pi-ai` instead of `Type.Union`/`Type.Literal` for string enums. The latter doesn't work with Google's API.

## CustomToolAPI Object

The factory receives a `CustomToolAPI` object (named `pi` by convention):

```typescript
interface CustomToolAPI {
  cwd: string;  // Current working directory
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  ui: ToolUIContext;
  hasUI: boolean;  // false in --print or --mode rpc
}

interface ToolUIContext {
  select(title: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  custom(component: Component & { dispose?(): void }): { close: () => void; requestRender: () => void };
}

interface ExecOptions {
  signal?: AbortSignal;  // Cancel the process
  timeout?: number;      // Timeout in milliseconds
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;  // True if process was killed by signal/timeout
}
```

Always check `pi.hasUI` before using UI methods.

### Cancellation Example

Pass the `signal` from `execute` to `pi.exec` to support cancellation:

```typescript
async execute(toolCallId, params, onUpdate, ctx, signal) {
  const result = await pi.exec("long-running-command", ["arg"], { signal });
  if (result.killed) {
    return { content: [{ type: "text", text: "Cancelled" }] };
  }
  return { content: [{ type: "text", text: result.stdout }] };
}
```

## CustomToolContext

The `execute` and `onSession` callbacks receive a `CustomToolContext`:

```typescript
interface CustomToolContext {
  sessionManager: ReadonlySessionManager;  // Read-only access to session
  modelRegistry: ModelRegistry;            // For API key resolution
  model: Model | undefined;                // Current model (may be undefined)
}
```

Use `ctx.sessionManager.getBranch()` to get entries on the current branch for state reconstruction.

## Session Lifecycle

Tools can implement `onSession` to react to session changes:

```typescript
interface CustomToolSessionEvent {
  reason: "start" | "switch" | "branch" | "new" | "tree" | "shutdown";
  previousSessionFile: string | undefined;
}
```

**Reasons:**
- `start`: Initial session load on startup
- `switch`: User switched to a different session (`/resume`)
- `branch`: User branched from a previous message (`/branch`)
- `new`: User started a new session (`/new`)
- `tree`: User navigated to a different point in the session tree (`/tree`)
- `shutdown`: Process is exiting (Ctrl+C, Ctrl+D, or SIGTERM) - use to cleanup resources

### State Management Pattern

Tools that maintain state should store it in `details` of their results, not external files. This allows branching to work correctly, as the state is reconstructed from the session history.

```typescript
interface MyToolDetails {
  items: string[];
}

const factory: CustomToolFactory = (pi) => {
  // In-memory state
  let items: string[] = [];

  // Reconstruct state from session entries
  const reconstructState = (event: CustomToolSessionEvent, ctx: CustomToolContext) => {
    if (event.reason === "shutdown") return;
    
    items = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult") continue;
      if (msg.toolName !== "my_tool") continue;
      
      const details = msg.details as MyToolDetails | undefined;
      if (details) {
        items = details.items;
      }
    }
  };

  return {
    name: "my_tool",
    label: "My Tool",
    description: "...",
    parameters: Type.Object({ ... }),
    
    onSession: reconstructState,
    
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      // Modify items...
      items.push("new item");
      
      return {
        content: [{ type: "text", text: "Added item" }],
        // Store current state in details for reconstruction
        details: { items: [...items] },
      };
    },
  };
};
```

This pattern ensures:
- When user branches, state is correct for that point in history
- When user switches sessions, state matches that session
- When user starts a new session, state resets

## Custom Rendering

Custom tools can provide `renderCall` and `renderResult` methods to control how they appear in the TUI. Both are optional. See [tui.md](tui.md) for the full component API.

### How It Works

Tool output is wrapped in a `Box` component that handles:
- Padding (1 character horizontal, 1 line vertical)
- Background color based on state (pending/success/error)

Your render methods return `Component` instances (typically `Text`) that go inside this box. Use `Text(content, 0, 0)` since the Box handles padding.

### renderCall

Renders the tool call (before/during execution):

```typescript
renderCall(args, theme) {
  let text = theme.fg("toolTitle", theme.bold("my_tool "));
  text += theme.fg("muted", args.action);
  if (args.text) {
    text += " " + theme.fg("dim", `"${args.text}"`);
  }
  return new Text(text, 0, 0);
}
```

Called when:
- Tool call starts (may have partial args during streaming)
- Args are updated during streaming

### renderResult

Renders the tool result:

```typescript
renderResult(result, { expanded, isPartial }, theme) {
  const { details } = result;

  // Handle streaming/partial results
  if (isPartial) {
    return new Text(theme.fg("warning", "Processing..."), 0, 0);
  }

  // Handle errors
  if (details?.error) {
    return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
  }

  // Normal result
  let text = theme.fg("success", "✓ ") + theme.fg("muted", "Done");
  
  // Support expanded view (Ctrl+O)
  if (expanded && details?.items) {
    for (const item of details.items) {
      text += "\n" + theme.fg("dim", `  ${item}`);
    }
  }

  return new Text(text, 0, 0);
}
```

**Options:**
- `expanded`: User pressed Ctrl+O to expand
- `isPartial`: Result is from `onUpdate` (streaming), not final

### Best Practices

1. **Use `Text` with padding `(0, 0)`** - The Box handles padding
2. **Use `\n` for multi-line content** - Not multiple Text components
3. **Handle `isPartial`** - Show progress during streaming
4. **Support `expanded`** - Show more detail when user requests
5. **Use theme colors** - For consistent appearance
6. **Keep it compact** - Show summary by default, details when expanded

### Theme Colors

```typescript
// Foreground
theme.fg("toolTitle", text)   // Tool names
theme.fg("accent", text)      // Highlights
theme.fg("success", text)     // Success
theme.fg("error", text)       // Errors
theme.fg("warning", text)     // Warnings
theme.fg("muted", text)       // Secondary text
theme.fg("dim", text)         // Tertiary text
theme.fg("toolOutput", text)  // Output content

// Styles
theme.bold(text)
theme.italic(text)
```

### Fallback Behavior

If `renderCall` or `renderResult` is not defined or throws an error:
- `renderCall`: Shows tool name
- `renderResult`: Shows raw text output from `content`

## Execute Function

```typescript
async execute(toolCallId, args, onUpdate, ctx, signal) {
  // Type assertion for params (TypeBox schema doesn't flow through)
  const params = args as { action: "list" | "add"; text?: string };

  // Check for abort
  if (signal?.aborted) {
    return { content: [...], details: { status: "aborted" } };
  }

  // Stream progress
  onUpdate?.({
    content: [{ type: "text", text: "Working..." }],
    details: { progress: 50 },
  });

  // Return final result
  return {
    content: [{ type: "text", text: "Done" }],  // Sent to LLM
    details: { data: result },  // For rendering only
  };
}
```

## Multiple Tools from One File

Return an array to share state between related tools:

```typescript
const factory: CustomToolFactory = (pi) => {
  // Shared state
  let connection = null;

  const handleSession = (event: CustomToolSessionEvent, ctx: CustomToolContext) => {
    if (event.reason === "shutdown") {
      connection?.close();
    }
  };

  return [
    { name: "db_connect", onSession: handleSession, ... },
    { name: "db_query", onSession: handleSession, ... },
    { name: "db_close", onSession: handleSession, ... },
  ];
};
```

## Examples

See [`examples/custom-tools/todo/index.ts`](../examples/custom-tools/todo/index.ts) for a complete example with:
- `onSession` for state reconstruction
- Custom `renderCall` and `renderResult`
- Proper branching support via details storage

Test with:
```bash
pi --tool packages/coding-agent/examples/custom-tools/todo/index.ts
```
