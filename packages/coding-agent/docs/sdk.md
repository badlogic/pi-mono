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
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
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
- Models (`models.json`)
- OAuth tokens (`oauth.json`)
- Sessions (`sessions/`)

### Model

```typescript
import { findModel, discoverAvailableModels } from "@mariozechner/pi-coding-agent";

// Find specific model (returns { model, error })
const { model, error } = findModel("anthropic", "claude-sonnet-4-20250514");
if (error) throw new Error(error);
if (!model) throw new Error("Model not found");

// Or get all models with valid API keys
const available = await discoverAvailableModels();

const { session } = await createAgentSession({
  model: model,
  thinkingLevel: "medium", // off, minimal, low, medium, high, xhigh
  
  // Models for cycling (Ctrl+P in interactive mode)
  scopedModels: [
    { model: sonnet, thinkingLevel: "high" },
    { model: haiku, thinkingLevel: "off" },
  ],
});
```

If no model is provided:
1. Tries to restore from session (if continuing)
2. Uses default from settings
3. Falls back to first available model

### API Keys

```typescript
import { defaultGetApiKey, configureOAuthStorage } from "@mariozechner/pi-coding-agent";

// Default: checks models.json, OAuth, environment variables
const { session } = await createAgentSession();

// Custom resolver
const { session } = await createAgentSession({
  getApiKey: async (model) => {
    // Custom logic (secrets manager, database, etc.)
    if (model.provider === "anthropic") {
      return process.env.MY_ANTHROPIC_KEY;
    }
    // Fall back to default
    return defaultGetApiKey()(model);
  },
});

// Use OAuth from ~/.pi/agent with custom agentDir for everything else
configureOAuthStorage(); // Must call before createAgentSession
const { session } = await createAgentSession({
  agentDir: "/custom/config",
  // OAuth tokens still come from ~/.pi/agent/oauth.json
});
```

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

### Tools

```typescript
import {
  codingTools,   // read, bash, edit, write (default)
  readOnlyTools, // read, bash
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

// Custom agentDir for sessions
const { session } = await createAgentSession({
  agentDir: "/custom/agent",
  sessionManager: SessionManager.create(process.cwd(), "/custom/agent"),
});
```

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

## Discovery Functions

All discovery functions accept optional `cwd` and `agentDir` parameters.

```typescript
import {
  discoverModels,
  discoverAvailableModels,
  findModel,
  discoverSkills,
  discoverHooks,
  discoverCustomTools,
  discoverContextFiles,
  discoverSlashCommands,
  loadSettings,
  buildSystemPrompt,
} from "@mariozechner/pi-coding-agent";

// Models
const allModels = discoverModels();
const available = await discoverAvailableModels();
const { model, error } = findModel("anthropic", "claude-sonnet-4-20250514");

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
import { Type } from "@sinclair/typebox";
import {
  createAgentSession,
  configureOAuthStorage,
  defaultGetApiKey,
  findModel,
  SessionManager,
  SettingsManager,
  readTool,
  bashTool,
  type HookFactory,
  type CustomAgentTool,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent/config";

// Use OAuth from default location
configureOAuthStorage(getAgentDir());

// Custom API key with fallback
const getApiKey = async (model: { provider: string }) => {
  if (model.provider === "anthropic" && process.env.MY_KEY) {
    return process.env.MY_KEY;
  }
  return defaultGetApiKey()(model as any);
};

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

const { model, error } = findModel("anthropic", "claude-sonnet-4-20250514");
if (error) throw new Error(error);
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
  getApiKey,
  
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
configureOAuthStorage

// Discovery
discoverModels
discoverAvailableModels
findModel
discoverSkills
discoverHooks
discoverCustomTools
discoverContextFiles
discoverSlashCommands

// Helpers
defaultGetApiKey
loadSettings
buildSystemPrompt

// Session management
SessionManager
SettingsManager

// Built-in tools
codingTools
readOnlyTools
readTool, bashTool, editTool, writeTool
grepTool, findTool, lsTool

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
