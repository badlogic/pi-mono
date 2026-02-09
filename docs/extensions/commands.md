# Custom Commands, Shortcuts, and Flags

## Commands

Register slash commands like `/mycommand`:

```typescript
pi.registerCommand("stats", {
  description: "Show session statistics",
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} entries`, "info");
  }
});
```

### Argument Completion

Add auto-completion for command arguments:

```typescript
import type { AutocompleteItem } from "@mariozechner/pi-tui";

pi.registerCommand("deploy", {
  description: "Deploy to an environment",
  getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
    const envs = ["dev", "staging", "prod"];
    const items = envs.map((e) => ({ value: e, label: e }));
    const filtered = items.filter((i) => i.value.startsWith(prefix));
    return filtered.length > 0 ? filtered : null;
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploying: ${args}`, "info");
  },
});
```

## Keyboard Shortcuts

Register keyboard shortcuts:

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "Toggle plan mode",
  handler: async (ctx) => {
    ctx.ui.notify("Toggled plan mode!", "info");
  },
});
```

See [keybindings.md](../../packages/coding-agent/docs/keybindings.md) for the shortcut format and built-in keybindings.

## CLI Flags

Register CLI flags:

```typescript
pi.registerFlag("plan", {
  description: "Start in plan mode",
  type: "boolean",
  default: false,
});

// Check value
if (pi.getFlag("--plan")) {
  // Plan mode enabled
}
```

## Session Control (Commands Only)

Command handlers receive `ExtensionCommandContext` with additional session control methods:

```typescript
pi.registerCommand("my-cmd", {
  description: "Do something with session control",
  handler: async (args, ctx) => {
    // Wait for agent to finish
    await ctx.waitForIdle();

    // Create new session
    const result = await ctx.newSession({
      parentSession: ctx.sessionManager.getSessionFile(),
      setup: async (sm) => {
        sm.appendMessage({
          role: "user",
          content: [{ type: "text", text: "Context..." }],
          timestamp: Date.now(),
        });
      },
    });

    if (result.cancelled) {
      // An extension cancelled the new session
    }

    // Fork from entry
    await ctx.fork("entry-id-123");

    // Navigate tree
    await ctx.navigateTree("entry-id-456", {
      summarize: true,
      customInstructions: "Focus on errors",
    });

    // Reload extensions
    await ctx.reload();
  },
});
```

**Note:** Session control methods are only available in commands because they can deadlock if called from event handlers.
