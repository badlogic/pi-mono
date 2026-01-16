# Embedded Sessions Extension

Child agent sessions that run in an overlay within the parent session. Useful for focused subtasks, exploration, or read-only review without polluting the main conversation.

## Installation

Copy this directory to your extensions folder:

```bash
cp -r embedded-sessions ~/.pi/agent/extensions/
```

Or symlink for development:

```bash
ln -s /path/to/pi-mono/packages/coding-agent/examples/extensions/embedded-sessions ~/.pi/agent/extensions/
```

## Commands

| Command | Description |
|---------|-------------|
| `/embed [message]` | Open embedded session with optional initial message |
| `/embed-context` | Session with recent parent conversation forked in |

## Keybindings

Inside the embedded session overlay:

| Key | Action |
|-----|--------|
| Enter | Send message |
| Escape | Abort (if streaming) or cancel session |
| `/model` | Switch model |
| `/done` | Complete session (generates summary) |
| `/compact` | Compact session history |

## Features

- **Tool inheritance**: Inherits parent's tools by default
- **Tool exclusion**: Exclude specific tools (e.g., `["write", "edit"]` for read-only)
- **Parent context**: Optionally fork recent conversation history
- **Persistence**: Sessions saved to `~/.pi/agent/sessions/embedded/{parent-id}/`
- **Summary**: Extracts summary from last assistant response on `/done`
- **File tracking**: Tracks files read and modified during session
- **Session refs**: Reference stored in parent session showing completion status, duration, files, tokens

## Programmatic Usage

Extensions can create embedded sessions directly:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { EmbeddedSessionComponent } from "./embedded-sessions/embedded-session-component.js";

export default function myExtension(pi: ExtensionAPI) {
  pi.registerCommand("my-embed", {
    description: "Custom embedded session",
    handler: async (args, ctx) => {
      const result = await ctx.ui.custom(
        async (tui, _theme, keybindings, done) => {
          return EmbeddedSessionComponent.create({
            tui,
            parentSession: ctx.session,
            options: {
              title: "My Task",
              initialMessage: args.trim() || undefined,
              excludeTools: ["write"], // read-only
            },
            keybindings,
            onClose: done,
          });
        },
        { overlay: true },
      );

      if (!result.cancelled) {
        ctx.ui.notify(`Completed: ${result.messageCount} messages`, "info");
      }
    },
  });
}
```

## Options

```typescript
interface EmbeddedSessionOptions {
  title?: string;                    // Overlay title (default: "Embedded Session")
  model?: Model;                     // Override model (default: inherit)
  thinkingLevel?: ThinkingLevel;     // Override thinking (default: inherit)
  inheritTools?: boolean;            // Include parent tools (default: true)
  additionalTools?: AgentTool[];     // Extra tools for this session
  excludeTools?: string[];           // Tools to exclude (e.g., ["write", "edit"])
  initialMessage?: string;           // Auto-send on open
  includeParentContext?: boolean;    // Fork parent messages (default: false)
  parentContextDepth?: number;       // How many exchanges to fork (default: 5)
  sessionFile?: string | false;      // Path, or false for in-memory
  generateSummary?: boolean;         // Generate summary on close (default: true)
  width?: number | `${number}%`;     // Overlay width (default: "90%")
  maxHeight?: number | `${number}%`; // Overlay height (default: "85%")
}
```

## Result

```typescript
interface EmbeddedSessionResult {
  cancelled: boolean;       // true if Escape, false if /done
  summary?: string;         // Last assistant response excerpt
  sessionId: string;
  sessionFile?: string;     // undefined for in-memory
  durationMs: number;
  filesRead: string[];
  filesModified: string[];
  messageCount: number;
  tokens: { input, output, cacheRead, cacheWrite };
}
```
