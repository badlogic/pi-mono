# SDK Examples

Programmatic usage of pi-coding-agent via `createAgentSession()`.

## Examples

| File | Description |
|------|-------------|
| `01-minimal.ts` | Simplest usage with all defaults |
| `02-custom-model.ts` | Select model and thinking level |
| `03-custom-prompt.ts` | Replace or modify system prompt |
| `04-skills.ts` | Discover, filter, or replace skills |
| `05-tools.ts` | Built-in tools, custom tools |
| `06-hooks.ts` | Logging, blocking, result modification |
| `07-context-files.ts` | AGENTS.md context files |
| `08-slash-commands.ts` | File-based slash commands |
| `09-api-keys-and-oauth.ts` | API key resolution, OAuth config |
| `10-settings.ts` | Override compaction, retry, terminal settings |
| `11-sessions.ts` | In-memory, persistent, continue, list sessions |
| `12-full-control.ts` | Replace everything, no discovery |

## Running

```bash
cd packages/coding-agent
npx tsx examples/sdk/01-minimal.ts
```

## Quick Reference

```typescript
import {
  createAgentSession,
  configureOAuthStorage,
  discoverSkills,
  discoverHooks,
  discoverCustomTools,
  discoverContextFiles,
  discoverSlashCommands,
  discoverAvailableModels,
  findModel,
  defaultGetApiKey,
  loadSettings,
  buildSystemPrompt,
  SessionManager,
  codingTools,
  readOnlyTools,
  readTool, bashTool, editTool, writeTool,
} from "@mariozechner/pi-coding-agent";

// Minimal
const { session } = await createAgentSession();

// Custom model
const { model } = findModel("anthropic", "claude-sonnet-4-20250514");
const { session } = await createAgentSession({ model, thinkingLevel: "high" });

// Modify prompt
const { session } = await createAgentSession({
  systemPrompt: (defaultPrompt) => defaultPrompt + "\n\nBe concise.",
});

// Read-only
const { session } = await createAgentSession({ tools: readOnlyTools });

// In-memory
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});

// Full control
configureOAuthStorage(); // Use OAuth from ~/.pi/agent
const { session } = await createAgentSession({
  model,
  getApiKey: async (m) => process.env.MY_KEY,
  systemPrompt: "You are helpful.",
  tools: [readTool, bashTool],
  customTools: [{ tool: myTool }],
  hooks: [{ factory: myHook }],
  skills: [],
  contextFiles: [],
  slashCommands: [],
  sessionManager: SessionManager.inMemory(),
  settings: { compaction: { enabled: false } },
});

// Run prompts
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
await session.prompt("Hello");
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `cwd` | `process.cwd()` | Working directory |
| `agentDir` | `~/.pi/agent` | Config directory |
| `model` | From settings/first available | Model to use |
| `thinkingLevel` | From settings/"off" | off, low, medium, high |
| `getApiKey` | Built-in resolver | API key function |
| `systemPrompt` | Discovered | String or `(default) => modified` |
| `tools` | `codingTools` | Built-in tools |
| `customTools` | Discovered | Replaces discovery |
| `additionalCustomToolPaths` | `[]` | Merge with discovery |
| `hooks` | Discovered | Replaces discovery |
| `additionalHookPaths` | `[]` | Merge with discovery |
| `skills` | Discovered | Skills for prompt |
| `contextFiles` | Discovered | AGENTS.md files |
| `slashCommands` | Discovered | File commands |
| `sessionManager` | `SessionManager.create(cwd)` | Persistence |
| `settings` | From agentDir | Overrides |

## Events

```typescript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      break;
    case "tool_execution_start":
      console.log(`Tool: ${event.toolName}`);
      break;
    case "tool_execution_end":
      console.log(`Result: ${event.result}`);
      break;
    case "agent_end":
      console.log("Done");
      break;
  }
});
```
