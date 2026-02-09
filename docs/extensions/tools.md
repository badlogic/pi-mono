# Creating Custom Tools

Tools are functions the LLM can call. They appear in the system prompt and can have custom rendering.

## Basic Tool

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "What this tool does",
    parameters: Type.Object({
      action: Type.String(),
      count: Type.Optional(Type.Integer()),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Check for cancellation
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }] };
      }

      // Stream progress
      onUpdate?.({ content: [{ type: "text", text: "Working..." }] });

      // Return result
      return {
        content: [{ type: "text", text: "Done" }],  // Sent to LLM
        details: { data: "..." },                   // For rendering & state
      };
    },
  });
}
```

## StringEnum Parameters

Use `StringEnum` from `@mariozechner/pi-ai` for string enums (required for Google API):

```typescript
import { StringEnum } from "@mariozechner/pi-ai";

parameters: Type.Object({
  action: StringEnum(["list", "add"] as const),
  text: Type.Optional(Type.String()),
}),
```

## Custom Rendering

```typescript
import { Text } from "@mariozechner/pi-tui";

pi.registerTool({
  // ... definition ...
  renderCall(args, theme) {
    let text = theme.fg("toolTitle", theme.bold("my_tool "));
    text += theme.fg("muted", args.action);
    return new Text(text, 0, 0);
  },

  renderResult(result, { expanded, isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Processing..."), 0, 0);
    }
    if (expanded && result.details?.items) {
      const items = result.details.items.map((i: string) =>
        theme.fg("dim", `  ${i}`)
      ).join("\n");
      return new Text(theme.fg("success", "✓ Done\n") + items, 0, 0);
    }
    return new Text(theme.fg("success", "✓ Done"), 0, 0);
  },
});
```

## Output Truncation

**Tools MUST truncate output** to avoid overwhelming context (default: 50KB / 2000 lines):

```typescript
import {
  truncateHead,
  formatSize,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@mariozechner/pi-coding-agent";

async execute(toolCallId, params, signal, onUpdate, ctx) {
  const output = await runCommand();
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let result = truncation.content;
  if (truncation.truncated) {
    const tempFile = writeTempFile(output);
    result += `\n\n[Output truncated to ${formatSize(truncation.outputBytes)}. Full output: ${tempFile}]`;
  }

  return { content: [{ type: "text", text: result }] };
}
```

## Overriding Built-in Tools

Register a tool with the same name to override built-ins:

```typescript
pi.registerTool({
  name: "read",  // Override built-in read
  // ... your implementation ...
});
```

Your implementation **must match the exact result shape** including `details` type. See:
- [packages/coding-agent/src/core/tools/read.ts](../../packages/coding-agent/src/core/tools/read.ts)
- [packages/coding-agent/src/core/tools/bash.ts](../../packages/coding-agent/src/core/tools/bash.ts)

## Multiple Tools with Shared State

```typescript
export default function (pi: ExtensionAPI) {
  let connection = null;

  pi.registerTool({ name: "db_connect", ... });
  pi.registerTool({ name: "db_query", ... });
  pi.registerTool({ name: "db_close", ... });

  pi.on("session_shutdown", async () => {
    connection?.close();
  });
}
```

## Remote Execution

Delegate to remote systems via pluggable operations:

```typescript
import { createReadTool } from "@mariozechner/pi-coding-agent";

const remoteRead = createReadTool(cwd, {
  operations: {
    readFile: (path) => sshExec(remote, `cat ${path}`),
    access: (path) => sshExec(remote, `test -r ${path}`).then(() => {}),
  }
});

pi.registerTool({
  ...remoteRead,
  async execute(id, params, signal, onUpdate, _ctx) {
    const ssh = getSshConfig();
    if (ssh) {
      const tool = createReadTool(cwd, { operations: createRemoteOps(ssh) });
      return tool.execute(id, params, signal, onUpdate);
    }
    return localRead.execute(id, params, signal, onUpdate);
  },
});
```

**Operations interfaces:** `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `LsOperations`, `GrepOperations`, `FindOperations`
