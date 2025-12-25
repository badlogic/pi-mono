# SDK

The SDK provides programmatic access to pi's agent capabilities. Use it to embed pi in other applications, build custom interfaces, or integrate with automated workflows.

**Example use cases:**
- Build a custom UI (web, desktop, mobile)
- Integrate agent capabilities into existing applications
- Create automated pipelines with agent reasoning
- Build custom tools that spawn sub-agents
- Test agent behavior programmatically

See [examples/sdk/](../examples/sdk/) for working examples from minimal to full control.

## Quick Start

```typescript
import { createAgentSession, discoverAuthStorage, discoverModels, SessionManager } from "@mariozechner/pi-coding-agent";

// Set up credential storage and model registry
const authStorage = discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

## Installation

```bash
npm install @mariozechner/pi-coding-agent
```

The SDK is included in the main package. No separate installation needed.

## Core Concepts

### createAgentSession()

The main factory function. Creates an `AgentSession` with configurable options.

**Philosophy:** "Omit to discover, provide to override."
- Omit an option → pi discovers/loads from standard locations
- Provide an option → your value is used, discovery skipped for that option

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

// Minimal: all defaults (discovers everything from cwd and ~/.pi/agent)
const { session } = await createAgentSession();

// Custom: override specific options
const { session } = await createAgentSession({
  model: myModel,
  systemPrompt: "You are helpful.",
  tools: [readTool, bashTool],
  sessionManager: SessionManager.inMemory(),
});
```

### AgentSession

The session manages the agent lifecycle, message history, and event streaming.

```typescript
interface AgentSession {
  // Send a prompt and wait for completion
  prompt(text: string, options?: PromptOptions): Promise<void>;
  
  // Subscribe to events (returns unsubscribe function)
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  
  // Session info
  sessionFile: string | null;
  sessionId: string;
  
  // Model control
  setModel(model: Model): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  cycleModel(): Promise<ModelCycleResult | null>;
  cycleThinkingLevel(): ThinkingLevel | null;
  
  // State access
  agent: Agent;
  model: Model | null;
  thinkingLevel: ThinkingLevel;
  messages: AppMessage[];
  isStreaming: boolean;
  
  // Session management
  reset(): Promise<void>;
  branch(entryIndex: number): Promise<{ selectedText: string; skipped: boolean }>;
  switchSession(sessionPath: string): Promise<void>;
  
  // Compaction
  compact(customInstructions?: string): Promise<CompactionResult>;
  abortCompaction(): void;
  
  // Abort current operation
  abort(): Promise<void>;
  
  // Cleanup
  dispose(): void;
}
```

### Agent and AgentState

The `Agent` class (from `@mariozechner/pi-agent-core`) handles the core LLM interaction. Access it via `session.agent`.

```typescript
// Access current state
const state = session.agent.state;

// state.messages: AppMessage[] - conversation history
// state.model: Model - current model
// state.thinkingLevel: ThinkingLevel - current thinking level
// state.systemPrompt: string - system prompt
// state.tools: Tool[] - available tools

// Replace messages (useful for branching, restoration)
session.agent.replaceMessages(messages);

// Wait for agent to finish processing
await session.agent.waitForIdle();
```

### Events

Subscribe to events to receive streaming output and lifecycle notifications.

```typescript
session.subscribe((event) => {
  switch (event.type) {
    // Streaming text from assistant
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      if (event.assistantMessageEvent.type === "thinking_delta") {
        // Thinking output (if thinking enabled)
      }
      break;
    
    // Tool execution
    case "tool_execution_start":
      console.log(`Tool: ${event.toolName}`);
      break;
    case "tool_execution_update":
      // Streaming tool output
      break;
    case "tool_execution_end":
      console.log(`Result: ${event.isError ? "error" : "success"}`);
      break;
    
    // Message lifecycle
    case "message_start":
      // New message starting
      break;
    case "message_end":
      // Message complete
      break;
    
    // Agent lifecycle
    case "agent_start":
      // Agent started processing prompt
      break;
    case "agent_end":
      // Agent finished (event.messages contains new messages)
      break;
    
    // Turn lifecycle (one LLM response + tool calls)
    case "turn_start":
      break;
    case "turn_end":
      // event.message: assistant response
      // event.toolResults: tool results from this turn
      break;
    
    // Session events (auto-compaction, retry)
    case "auto_compaction_start":
    case "auto_compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
      break;
  }
});
```

## Options Reference

### Directories

```typescript
const { session } = await createAgentSession({
  // Working directory for project-local discovery
  cwd: process.cwd(), // default
  
  // Global config directory
  agentDir: "~/.pi/agent", // default (expands ~)
});
```

`cwd` is used for:
- Project hooks (`.pi/hooks/`)
- Project tools (`.pi/tools/`)
- Project skills (`.pi/skills/`)
- Project commands (`.pi/commands/`)
- Context files (`AGENTS.md` walking up from cwd)
- Session directory naming

`agentDir` is used for:
- Global hooks (`hooks/`)
- Global tools (`tools/`)
- Global skills (`skills/`)
- Global commands (`commands/`)
- Global context file (`AGENTS.md`)
- Settings (`settings.json`)
- Custom models (`models.json`)
- Credentials (`auth.json`)
- Sessions (`sessions/`)

### Model

```typescript
import { getModel } from "@mariozechner/pi-ai";
import { discoverAuthStorage, discoverModels } from "@mariozechner/pi-coding-agent";

const authStorage = discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

// Find specific built-in model (doesn't check if API key exists)
const opus = getModel("anthropic", "claude-opus-4-5");
if (!opus) throw new Error("Model not found");

// Find any model by provider/id, including custom models from models.json
// (doesn't check if API key exists)
const customModel = modelRegistry.find("my-provider", "my-model");

// Get only models that have valid API keys configured
const available = await modelRegistry.getAvailable();

const { session } = await createAgentSession({
  model: opus,
  thinkingLevel: "medium", // off, minimal, low, medium, high, xhigh
  
  // Models for cycling (Ctrl+P in interactive mode)
  scopedModels: [
    { model: opus, thinkingLevel: "high" },
    { model: haiku, thinkingLevel: "off" },
  ],
  
  authStorage,
  modelRegistry,
});
```

If no model is provided:
1. Tries to restore from session (if continuing)
2. Uses default from settings
3. Falls back to first available model

> See [examples/sdk/02-custom-model.ts](../examples/sdk/02-custom-model.ts)

### API Keys and OAuth

API key resolution priority (handled by AuthStorage):
1. Runtime overrides (via `setRuntimeApiKey`, not persisted)
2. Stored credentials in `auth.json` (API keys or OAuth tokens)
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
4. Fallback resolver (for custom provider keys from `models.json`)

```typescript
import { AuthStorage, ModelRegistry, discoverAuthStorage, discoverModels } from "@mariozechner/pi-coding-agent";

// Default: uses ~/.pi/agent/auth.json and ~/.pi/agent/models.json
const authStorage = discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

// Runtime API key override (not persisted to disk)
authStorage.setRuntimeApiKey("anthropic", "sk-my-temp-key");

// Custom auth storage location
const customAuth = new AuthStorage("/my/app/auth.json");
const customRegistry = new ModelRegistry(customAuth, "/my/app/models.json");

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: customAuth,
  modelRegistry: customRegistry,
});

// No custom models.json (built-in models only)
const simpleRegistry = new ModelRegistry(authStorage);
```

> See [examples/sdk/09-api-keys-and-oauth.ts](../examples/sdk/09-api-keys-and-oauth.ts)

### System Prompt

```typescript
const { session } = await createAgentSession({
  // Replace entirely
  systemPrompt: "You are a helpful assistant.",
  
  // Or modify default (receives default, returns modified)
  systemPrompt: (defaultPrompt) => {
    return `${defaultPrompt}\n\n## Additional Rules\n- Be concise`;
  },
});
```

> See [examples/sdk/03-custom-prompt.ts](../examples/sdk/03-custom-prompt.ts)

### Tools

```typescript
import {
  codingTools,   // read, bash, edit, write (default)
  readOnlyTools, // read, grep, find, ls
  readTool, bashTool, editTool, writeTool,
  grepTool, findTool, lsTool,
} from "@mariozechner/pi-coding-agent";

// Use built-in tool set
const { session } = await createAgentSession({
  tools: readOnlyTools,
});

// Pick specific tools
const { session } = await createAgentSession({
  tools: [readTool, bashTool, grepTool],
});
```

#### Tools with Custom cwd

**Important:** The pre-built tool instances (`readTool`, `bashTool`, etc.) use `process.cwd()` for path resolution. When you specify a custom `cwd` AND provide explicit `tools`, you must use the tool factory functions to ensure paths resolve correctly:

```typescript
import {
  createCodingTools,    // Creates [read, bash, edit, write] for specific cwd
  createReadOnlyTools,  // Creates [read, grep, find, ls] for specific cwd
  createReadTool,
  createBashTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";

const cwd = "/path/to/project";

// Use factory for tool sets
const { session } = await createAgentSession({
  cwd,
  tools: createCodingTools(cwd),  // Tools resolve paths relative to cwd
});

// Or pick specific tools
const { session } = await createAgentSession({
  cwd,
  tools: [createReadTool(cwd), createBashTool(cwd), createGrepTool(cwd)],
});
```

**When you don't need factories:**
- If you omit `tools`, pi automatically creates them with the correct `cwd`
- If you use `process.cwd()` as your `cwd`, the pre-built instances work fine

**When you must use factories:**
- When you specify both `cwd` (different from `process.cwd()`) AND `tools`

> See [examples/sdk/05-tools.ts](../examples/sdk/05-tools.ts)

### Custom Tools

```typescript
import { Type } from "@sinclair/typebox";
import { createAgentSession, discoverCustomTools, type CustomAgentTool } from "@mariozechner/pi-coding-agent";

// Inline custom tool
const myTool: CustomAgentTool = {
  name: "my_tool",
  label: "My Tool",
  description: "Does something useful",
  parameters: Type.Object({
    input: Type.String({ description: "Input value" }),
  }),
  execute: async (toolCallId, params) => ({
    content: [{ type: "text", text: `Result: ${params.input}` }],
    details: {},
  }),
};

// Replace discovery with inline tools
const { session } = await createAgentSession({
  customTools: [{ tool: myTool }],
});

// Merge with discovered tools
const discovered = await discoverCustomTools();
const { session } = await createAgentSession({
  customTools: [...discovered, { tool: myTool }],
});

// Add paths without replacing discovery
const { session } = await createAgentSession({
  additionalCustomToolPaths: ["/extra/tools"],
});
```

> See [examples/sdk/05-tools.ts](../examples/sdk/05-tools.ts)

### Hooks

```typescript
import { createAgentSession, discoverHooks, type HookFactory } from "@mariozechner/pi-coding-agent";

// Inline hook
const loggingHook: HookFactory = (api) => {
  api.on("tool_call", async (event) => {
    console.log(`Tool: ${event.toolName}`);
    return undefined; // Don't block
  });
  
  api.on("tool_call", async (event) => {
    // Block dangerous commands
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command" };
    }
    return undefined;
  });
};

// Replace discovery
const { session } = await createAgentSession({
  hooks: [{ factory: loggingHook }],
});

// Disable all hooks
const { session } = await createAgentSession({
  hooks: [],
});

// Merge with discovered
const discovered = await discoverHooks();
const { session } = await createAgentSession({
  hooks: [...discovered, { factory: loggingHook }],
});

// Add paths without replacing
const { session } = await createAgentSession({
  additionalHookPaths: ["/extra/hooks"],
});
```

> See [examples/sdk/06-hooks.ts](../examples/sdk/06-hooks.ts)

### Skills

```typescript
import { createAgentSession, discoverSkills, type Skill } from "@mariozechner/pi-coding-agent";

// Discover and filter
const allSkills = discoverSkills();
const filtered = allSkills.filter(s => s.name.includes("search"));

// Custom skill
const mySkill: Skill = {
  name: "my-skill",
  description: "Custom instructions",
  filePath: "/path/to/SKILL.md",
  baseDir: "/path/to",
  source: "custom",
};

const { session } = await createAgentSession({
  skills: [...filtered, mySkill],
});

// Disable skills
const { session } = await createAgentSession({
  skills: [],
});

// Discovery with settings filter
const skills = discoverSkills(process.cwd(), undefined, {
  ignoredSkills: ["browser-*"],  // glob patterns to exclude
  includeSkills: ["search-*"],   // glob patterns to include (empty = all)
});
```

> See [examples/sdk/04-skills.ts](../examples/sdk/04-skills.ts)

### Context Files

```typescript
import { createAgentSession, discoverContextFiles } from "@mariozechner/pi-coding-agent";

// Discover AGENTS.md files
const discovered = discoverContextFiles();

// Add custom context
const { session } = await createAgentSession({
  contextFiles: [
    ...discovered,
    {
      path: "/virtual/AGENTS.md",
      content: "# Guidelines\n\n- Be concise\n- Use TypeScript",
    },
  ],
});

// Disable context files
const { session } = await createAgentSession({
  contextFiles: [],
});
```

> See [examples/sdk/07-context-files.ts](../examples/sdk/07-context-files.ts)

### Slash Commands

```typescript
import { createAgentSession, discoverSlashCommands, type FileSlashCommand } from "@mariozechner/pi-coding-agent";

const discovered = discoverSlashCommands();

const customCommand: FileSlashCommand = {
  name: "deploy",
  description: "Deploy the application",
  source: "(custom)",
  content: "# Deploy\n\n1. Build\n2. Test\n3. Deploy",
};

const { session } = await createAgentSession({
  slashCommands: [...discovered, customCommand],
});
```

> See [examples/sdk/08-slash-commands.ts](../examples/sdk/08-slash-commands.ts)

### Session Management

```typescript
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

// In-memory (no persistence)
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});

// New persistent session
const { session } = await createAgentSession({
  sessionManager: SessionManager.create(process.cwd()),
});

// Continue most recent
const { session, modelFallbackMessage } = await createAgentSession({
  sessionManager: SessionManager.continueRecent(process.cwd()),
});
if (modelFallbackMessage) {
  console.log("Note:", modelFallbackMessage);
}

// Open specific file
const { session } = await createAgentSession({
  sessionManager: SessionManager.open("/path/to/session.jsonl"),
});

// List available sessions
const sessions = SessionManager.list(process.cwd());
for (const info of sessions) {
  console.log(`${info.id}: ${info.firstMessage} (${info.messageCount} messages)`);
}

// Custom session directory (no cwd encoding)
const customDir = "/path/to/my-sessions";
const { session } = await createAgentSession({
  sessionManager: SessionManager.create(process.cwd(), customDir),
});
// Also works with list and continueRecent:
// SessionManager.list(process.cwd(), customDir);
// SessionManager.continueRecent(process.cwd(), customDir);
```

> See [examples/sdk/11-sessions.ts](../examples/sdk/11-sessions.ts)

### Settings Management

```typescript
import { createAgentSession, SettingsManager, SessionManager } from "@mariozechner/pi-coding-agent";

// Default: loads from files (global + project merged)
const { session } = await createAgentSession({
  settingsManager: SettingsManager.create(),
});

// With overrides
const settingsManager = SettingsManager.create();
settingsManager.applyOverrides({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 5 },
});
const { session } = await createAgentSession({ settingsManager });

// In-memory (no file I/O, for testing)
const { session } = await createAgentSession({
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
  sessionManager: SessionManager.inMemory(),
});

// Custom directories
const { session } = await createAgentSession({
  settingsManager: SettingsManager.create("/custom/cwd", "/custom/agent"),
});
```

**Static factories:**
- `SettingsManager.create(cwd?, agentDir?)` - Load from files
- `SettingsManager.inMemory(settings?)` - No file I/O

**Project-specific settings:**

Settings load from two locations and merge:
1. Global: `~/.pi/agent/settings.json`
2. Project: `<cwd>/.pi/settings.json`

Project overrides global. Nested objects merge keys. Setters only modify global (project is read-only for version control).

> See [examples/sdk/10-settings.ts](../examples/sdk/10-settings.ts)

## Discovery Functions

All discovery functions accept optional `cwd` and `agentDir` parameters.

```typescript
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  ModelRegistry,
  discoverAuthStorage,
  discoverModels,
  discoverSkills,
  discoverHooks,
  discoverCustomTools,
  discoverContextFiles,
  discoverSlashCommands,
  loadSettings,
  buildSystemPrompt,
} from "@mariozechner/pi-coding-agent";

// Auth and Models
const authStorage = discoverAuthStorage();           // ~/.pi/agent/auth.json
const modelRegistry = discoverModels(authStorage);   // + ~/.pi/agent/models.json
const allModels = modelRegistry.getAll();            // All models (built-in + custom)
const available = await modelRegistry.getAvailable(); // Only models with API keys
const model = modelRegistry.find("provider", "id");   // Find specific model
const builtIn = getModel("anthropic", "claude-opus-4-5"); // Built-in only

// Skills
const skills = discoverSkills(cwd, agentDir, skillsSettings);

// Hooks (async - loads TypeScript)
const hooks = await discoverHooks(cwd, agentDir);

// Custom tools (async - loads TypeScript)
const tools = await discoverCustomTools(cwd, agentDir);

// Context files
const contextFiles = discoverContextFiles(cwd, agentDir);

// Slash commands
const commands = discoverSlashCommands(cwd, agentDir);

// Settings (global + project merged)
const settings = loadSettings(cwd, agentDir);

// Build system prompt manually
const prompt = buildSystemPrompt({
  skills,
  contextFiles,
  appendPrompt: "Additional instructions",
  cwd,
});
```

## Return Value

`createAgentSession()` returns:

```typescript
interface CreateAgentSessionResult {
  // The session
  session: AgentSession;
  
  // Custom tools (for UI setup)
  customToolsResult: {
    tools: LoadedCustomTool[];
    setUIContext: (ctx, hasUI) => void;
  };
  
  // Warning if session model couldn't be restored
  modelFallbackMessage?: string;
}
```

## Complete Example

```typescript
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  readTool,
  bashTool,
  type HookFactory,
  type CustomAgentTool,
} from "@mariozechner/pi-coding-agent";

// Set up auth storage (custom location)
const authStorage = new AuthStorage("/custom/agent/auth.json");

// Runtime API key override (not persisted)
if (process.env.MY_KEY) {
  authStorage.setRuntimeApiKey("anthropic", process.env.MY_KEY);
}

// Model registry (no custom models.json)
const modelRegistry = new ModelRegistry(authStorage);

// Inline hook
const auditHook: HookFactory = (api) => {
  api.on("tool_call", async (event) => {
    console.log(`[Audit] ${event.toolName}`);
    return undefined;
  });
};

// Inline tool
const statusTool: CustomAgentTool = {
  name: "status",
  label: "Status",
  description: "Get system status",
  parameters: Type.Object({}),
  execute: async () => ({
    content: [{ type: "text", text: `Uptime: ${process.uptime()}s` }],
    details: {},
  }),
};

const model = getModel("anthropic", "claude-opus-4-5");
if (!model) throw new Error("Model not found");

// In-memory settings with overrides
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 2 },
});

const { session } = await createAgentSession({
  cwd: process.cwd(),
  agentDir: "/custom/agent",
  
  model,
  thinkingLevel: "off",
  authStorage,
  modelRegistry,
  
  systemPrompt: "You are a minimal assistant. Be concise.",
  
  tools: [readTool, bashTool],
  customTools: [{ tool: statusTool }],
  hooks: [{ factory: auditHook }],
  skills: [],
  contextFiles: [],
  slashCommands: [],
  
  sessionManager: SessionManager.inMemory(),
  settingsManager,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("Get status and list files.");
```

## RPC Mode Alternative

For subprocess-based integration, use RPC mode instead of the SDK:

```bash
pi --mode rpc --no-session
```

See [RPC documentation](rpc.md) for the JSON protocol.

The SDK is preferred when:
- You want type safety
- You're in the same Node.js process
- You need direct access to agent state
- You want to customize tools/hooks programmatically

RPC mode is preferred when:
- You're integrating from another language
- You want process isolation
- You're building a language-agnostic client

## Exports

The main entry point exports:

```typescript
// Factory
createAgentSession

// Auth and Models
AuthStorage
ModelRegistry
discoverAuthStorage
discoverModels

// Discovery
discoverSkills
discoverHooks
discoverCustomTools
discoverContextFiles
discoverSlashCommands

// Helpers
loadSettings
buildSystemPrompt

// Session management
SessionManager
SettingsManager

// Built-in tools (use process.cwd())
codingTools
readOnlyTools
readTool, bashTool, editTool, writeTool
grepTool, findTool, lsTool

// Tool factories (for custom cwd)
createCodingTools
createReadOnlyTools
createReadTool, createBashTool, createEditTool, createWriteTool
createGrepTool, createFindTool, createLsTool

// Types
type CreateAgentSessionOptions
type CreateAgentSessionResult
type CustomAgentTool
type HookFactory
type Skill
type FileSlashCommand
type Settings
type SkillsSettings
type Tool
```

For hook types, import from the hooks subpath:

```typescript
import type { HookAPI, HookEvent, ToolCallEvent } from "@mariozechner/pi-coding-agent/hooks";
```

For config utilities:

```typescript
import { getAgentDir } from "@mariozechner/pi-coding-agent/config";
```
