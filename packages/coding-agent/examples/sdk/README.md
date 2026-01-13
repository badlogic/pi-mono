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
| `06-extensions.ts` | Logging, blocking, result modification |
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
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  discoverAuthStorage,
  discoverModels,
  discoverSkills,
  discoverExtensions,
  discoverContextFiles,
  discoverPromptTemplates,
  loadSettings,
  buildSystemPrompt,
  ModelRegistry,
  SessionManager,
  codingTools,
  readOnlyTools,
  readTool, bashTool, editTool, writeTool,
} from "@mariozechner/pi-coding-agent";

// Auth and models setup
const authStorage = discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

// Minimal
const { session } = await createAgentSession({ authStorage, modelRegistry });

// Custom model
const model = getModel("anthropic", "claude-opus-4-5");
const { session } = await createAgentSession({ model, thinkingLevel: "high", authStorage, modelRegistry });

// Modify prompt
const { session } = await createAgentSession({
  systemPrompt: (defaultPrompt) => defaultPrompt + "\n\nBe concise.",
  authStorage,
  modelRegistry,
});

// Read-only
const { session } = await createAgentSession({ tools: readOnlyTools, authStorage, modelRegistry });

// In-memory
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

// Full control
const customAuth = new AuthStorage("/my/app/auth.json");
customAuth.setRuntimeApiKey("anthropic", process.env.MY_KEY!);
const customRegistry = new ModelRegistry(customAuth);

const { session } = await createAgentSession({
  model,
  authStorage: customAuth,
  modelRegistry: customRegistry,
  systemPrompt: "You are helpful.",
  tools: [readTool, bashTool],
  customTools: [{ tool: myTool }],
  extensions: [{ factory: myExtension }],
  skills: [],
  contextFiles: [],
  promptTemplates: [],
  sessionManager: SessionManager.inMemory(),
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
| `authStorage` | `discoverAuthStorage()` | Credential storage |
| `modelRegistry` | `discoverModels(authStorage)` | Model registry |
| `cwd` | `process.cwd()` | Working directory |
| `agentDir` | `~/.pi/agent` | Config directory |
| `model` | From settings/first available | Model to use |
| `thinkingLevel` | From settings/"off" | off, low, medium, high |
| `systemPrompt` | Discovered | String or `(default) => modified` |
| `tools` | `codingTools` | Built-in tools |
| `customTools` | Discovered | Replaces discovery |
| `additionalCustomToolPaths` | `[]` | Merge with discovery |
| `extensions` | Discovered | Replaces discovery |
| `additionalExtensionPaths` | `[]` | Merge with discovery |
| `skills` | Discovered | Skills for prompt |
| `contextFiles` | Discovered | AGENTS.md files |
| `promptTemplates` | Discovered | Prompt templates (slash commands) |
| `sessionManager` | `SessionManager.create(cwd)` | Persistence |
| `settingsManager` | From agentDir | Settings overrides |

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
