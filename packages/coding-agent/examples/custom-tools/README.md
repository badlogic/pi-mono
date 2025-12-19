# Custom Tools Examples

Example custom tools for pi-coding-agent.

## Examples

Each example uses the `subdirectory/index.ts` structure required for tool discovery.

### hello/
Minimal example showing the basic structure of a custom tool.

### question/
Demonstrates `pi.ui.select()` for asking the user questions with options.

### todo/
Full-featured example demonstrating:
- `onSession` for state reconstruction from session history
- Custom `renderCall` and `renderResult`
- Proper branching support via details storage
- State management without external files

### subagent/
Delegate tasks to specialized subagents with isolated context windows. Includes:
- `index.ts` - The custom tool (single, parallel, and chain modes)
- `agents.ts` - Agent discovery helper
- `agents/` - Sample agent definitions (scout, planner, reviewer, worker)
- `commands/` - Workflow presets (/implement, /scout-and-plan, /implement-and-review)

See [subagent/README.md](subagent/README.md) for full documentation.

## Usage

```bash
# Test directly (can point to any .ts file)
pi --tool examples/custom-tools/todo/index.ts

# Or copy entire folder to tools directory for persistent use
cp -r todo ~/.pi/agent/tools/
```

Then in pi:
```
> add a todo "test custom tools"
> list todos
> toggle todo #1
> clear todos
```

## Writing Custom Tools

See [docs/custom-tools.md](../../docs/custom-tools.md) for full documentation.

### Key Points

**Factory pattern:**
```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import type { CustomToolFactory } from "@mariozechner/pi-coding-agent";

const factory: CustomToolFactory = (pi) => ({
  name: "my_tool",
  label: "My Tool",
  description: "Tool description for LLM",
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),
  }),
  
  // Called on session start/switch/branch/clear
  onSession(event) {
    // Reconstruct state from event.entries
  },
  
  async execute(toolCallId, params) {
    return {
      content: [{ type: "text", text: "Result" }],
      details: { /* for rendering and state reconstruction */ },
    };
  },
});

export default factory;
```

**Custom rendering:**
```typescript
renderCall(args, theme) {
  return new Text(
    theme.fg("toolTitle", theme.bold("my_tool ")) + args.action,
    0, 0  // No padding - Box handles it
  );
},

renderResult(result, { expanded, isPartial }, theme) {
  if (isPartial) {
    return new Text(theme.fg("warning", "Working..."), 0, 0);
  }
  return new Text(theme.fg("success", "✓ Done"), 0, 0);
},
```

**Use StringEnum for string parameters** (required for Google API compatibility):
```typescript
import { StringEnum } from "@mariozechner/pi-ai";

// Good
action: StringEnum(["list", "add"] as const)

// Bad - doesn't work with Google
action: Type.Union([Type.Literal("list"), Type.Literal("add")])
```
