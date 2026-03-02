# Alive Subagents Implementation Plan

## Executive Summary

This plan describes how to implement "alive" subagents in pi coding agent that:
1. Can be called by the main agent to delegate tasks
2. Allow users to interact with subagents via slash commands when they're alive
3. Support parallel execution, chaining, and persistent sessions

## Research Summary

### Industry Patterns

Based on research from Claude Code, Cursor, Google Cloud, and Microsoft Azure:

| Feature | Claude Code | Cursor | Best Practice |
|---------|-------------|--------|---------------|
| **Context Isolation** | Separate context window | Separate context window | Essential for preventing context pollution |
| **Agent Definitions** | Markdown + YAML frontmatter | Markdown + YAML frontmatter | `.pi/agents/*.md` and `~/.pi/agent/agents/*.md` |
| **Built-in Agents** | Explore, Plan, General-purpose | Similar | Provide useful defaults |
| **Parallel Execution** | Yes | Yes | Up to 8 concurrent, 4 parallel |
| **Memory Persistence** | Yes (`memory: user/project`) | Limited | Useful for building knowledge |
| **User Interaction** | Via main agent only | Via main agent only | **We add slash commands** |

### Key Differentiator for pi

Unlike Claude Code and Cursor where users can only interact with subagents through the main agent, pi will allow **direct user interaction** with alive subagents via slash commands.

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Agent Session                        │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   Agent     │  │  Extension   │  │  SubagentManager      │  │
│  │  (Agent.ts) │  │   Runner     │  │  - Registry           │  │
│  │             │  │              │  │  - Process Pool       │  │
│  └─────────────┘  └──────────────┘  │  - Communication Bus  │  │
│         │                │          └───────────────────────┘  │
│         │                │                     │               │
│         ▼                ▼                     ▼               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Tool Registry                            ││
│  │  read | bash | edit | write | subagent | subagent_start    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Subagent #1    │ │  Subagent #2    │ │  Subagent #3    │
│  (scout)        │ │  (planner)      │ │  (worker)       │
│  Process/In-Mem │ │  Process/In-Mem │ │  Process/In-Mem │
│  Status: alive  │ │  Status: alive  │ │  Status: done   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Component Design

#### 1. SubagentManager

Central registry and lifecycle manager for all subagents.

```typescript
// packages/coding-agent/src/core/subagents/manager.ts

interface SubagentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
  memory?: "none" | "user" | "project";
}

interface AliveSubagent {
  id: string;                    // Unique instance ID (uuid)
  name: string;                  // Agent type (e.g., "scout")
  config: SubagentConfig;
  
  // Execution mode
  mode: "process" | "in-memory";
  
  // State
  status: "starting" | "idle" | "running" | "waiting-input" | "done" | "error";
  task: string;
  
  // Process-based: child process reference
  process?: ChildProcess;
  rpcClient?: RpcClient;
  
  // In-memory: Agent instance
  agent?: Agent;
  session?: MiniSession;
  
  // Communication
  pendingMessages: SubagentMessage[];
  messageHistory: SubagentMessage[];
  
  // Metrics
  startTime: number;
  lastActivity: number;
  tokensUsed: { input: number; output: number };
  turnCount: number;
  
  // Memory persistence
  memoryDir?: string;
}

class SubagentManager {
  private subagents: Map<string, AliveSubagent> = new Map();
  private config: SubagentManagerConfig;
  
  // Lifecycle
  async startSubagent(name: string, task: string, options?: StartOptions): Promise<string>;
  async stopSubagent(id: string): Promise<void>;
  async stopAllSubagents(): Promise<void>;
  
  // Communication
  async sendToSubagent(id: string, message: string): Promise<void>;
  async getSubagentOutput(id: string): Promise<SubagentOutput>;
  
  // Query
  getSubagent(id: string): AliveSubagent | undefined;
  listSubagents(filter?: StatusFilter): AliveSubagent[];
  
  // Events
  on(event: "started" | "stopped" | "message" | "status", handler: Handler): () => void;
}
```

#### 2. Subagent Definition Format

Agent definitions are Markdown files with YAML frontmatter:

```markdown
---
name: scout
description: Fast codebase recon that returns compressed context
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
memory: none
---

You are a scout. Quickly investigate a codebase and return structured findings.

[... system prompt content ...]
```

**File locations:**
- `~/.pi/agent/agents/*.md` - User-level (global)
- `.pi/agents/*.md` - Project-level (repo-specific)
- Built-in agents in `packages/coding-agent/src/core/subagents/builtins/`

#### 3. Execution Modes

**Option A: Process-based (Recommended for isolation)**

```typescript
// Spawn a child pi process in RPC mode
const proc = spawn("pi", [
  "--mode", "rpc",
  "--model", config.model || "default",
  "--tools", config.tools?.join(",") || "default",
  "--no-session",
]);

// Communicate via RPC protocol
const rpcClient = new RpcClient(proc.stdin, proc.stdout);
await rpcClient.initialize();

// Send task
await rpcClient.call("prompt", { message: task });

// Get streaming updates
rpcClient.on("message", (event) => {
  // Emit to SubagentManager events
});
```

**Pros:**
- True context isolation
- Subagent crash doesn't affect main agent
- Can use different models/providers

**Cons:**
- Higher memory usage
- Process management complexity
- Slower startup

**Option B: In-memory (Recommended for speed)**

```typescript
// Create Agent instance within main process
const agent = new Agent({
  initialState: {
    systemPrompt: config.systemPrompt,
    model: resolveModel(config.model),
    tools: createToolSubset(config.tools),
  },
  streamFn: streamSimple,
});

// Track in registry
const subagent: AliveSubagent = {
  id: generateId(),
  agent,
  mode: "in-memory",
  status: "idle",
  // ...
};

// Execute task
agent.subscribe((event) => {
  // Emit to SubagentManager events
});
await agent.prompt(task);
```

**Pros:**
- Fast startup
- Lower memory overhead
- Easier communication

**Cons:**
- Shared memory space
- Subagent crash could affect main agent
- Context still in same process

**Recommendation:** Start with **in-memory** for MVP, add process-based as option later.

#### 4. Tools for Main Agent

```typescript
// packages/coding-agent/src/core/subagents/tools.ts

// Tool 1: Start an alive subagent
pi.registerTool({
  name: "subagent_start",
  label: "Start Subagent",
  description: "Start a specialized subagent that runs independently. Returns subagent ID for interaction.",
  parameters: Type.Object({
    agent: Type.String({ description: "Agent name (e.g., 'scout', 'planner', 'worker')" }),
    task: Type.String({ description: "Task for the subagent" }),
    mode: Type.Optional(StringEnum(["fork", "alive"] as const, { 
      description: "'fork' = one-shot (default), 'alive' = persistent session",
      default: "fork",
    })),
    waitForResult: Type.Optional(Type.Boolean({ 
      description: "Wait for completion before returning (default: true for fork, false for alive)",
    })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const id = await ctx.subagentManager.startSubagent(params.agent, params.task, {
      mode: params.mode ?? "fork",
      waitForResult: params.waitForResult,
    });
    
    if (params.mode === "alive") {
      return {
        content: [{ type: "text", text: `Started alive subagent '${params.agent}' with ID: ${id}\nUse /agent ${id} to interact.` }],
        details: { subagentId: id, status: "started" },
      };
    }
    
    // Fork mode: wait for result
    const result = await ctx.subagentManager.waitForCompletion(id);
    return {
      content: [{ type: "text", text: result.output }],
      details: { subagentId: id, status: "done", usage: result.usage },
    };
  },
});

// Tool 2: Send message to alive subagent
pi.registerTool({
  name: "subagent_send",
  label: "Send to Subagent",
  description: "Send a message to an alive subagent. Use for follow-up questions or additional tasks.",
  parameters: Type.Object({
    subagentId: Type.String({ description: "ID of the alive subagent" }),
    message: Type.String({ description: "Message to send" }),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const result = await ctx.subagentManager.sendToSubagent(params.subagentId, params.message);
    return {
      content: [{ type: "text", text: result.output }],
      details: { subagentId: params.subagentId },
    };
  },
});

// Tool 3: List alive subagents
pi.registerTool({
  name: "subagent_list",
  label: "List Subagents",
  description: "List all alive subagents and their status.",
  parameters: Type.Object({}),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const agents = ctx.subagentManager.listSubagents();
    const text = agents.map(a => 
      `${a.id.slice(0, 8)}: ${a.name} - ${a.status} (${a.task.slice(0, 50)}...)`
    ).join("\n") || "No alive subagents";
    return { content: [{ type: "text", text }] };
  },
});

// Tool 4: Stop an alive subagent
pi.registerTool({
  name: "subagent_stop",
  label: "Stop Subagent",
  description: "Stop an alive subagent and free resources.",
  parameters: Type.Object({
    subagentId: Type.String({ description: "ID of the subagent to stop" }),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    await ctx.subagentManager.stopSubagent(params.subagentId);
    return { content: [{ type: "text", text: `Stopped subagent ${params.subagentId}` }] };
  },
});
```

#### 5. Slash Commands for User Interaction

```typescript
// packages/coding-agent/src/core/subagents/commands.ts

// /agents - List all alive subagents
pi.registerCommand("agents", {
  description: "List all alive subagents with status",
  handler: async (args, ctx) => {
    const agents = ctx.subagentManager.listSubagents();
    
    if (agents.length === 0) {
      ctx.ui.notify("No alive subagents", "info");
      return;
    }
    
    const items = agents.map(a => ({
      value: a.id,
      label: `${a.name} (${a.status})`,
      description: a.task.slice(0, 60),
    }));
    
    const selected = await ctx.ui.select("Alive Subagents:", items);
    if (selected) {
      // Switch to this subagent
      ctx.setActiveSubagent(selected);
    }
  },
});

// /agent <id> - Switch to subagent context
pi.registerCommand("agent", {
  description: "Switch to subagent context for direct interaction",
  getArgumentCompletions: (prefix) => {
    // Return matching subagent IDs
  },
  handler: async (args, ctx) => {
    const id = args.trim();
    if (!id) {
      ctx.ui.notify("Usage: /agent <id>", "warning");
      return;
    }
    
    const subagent = ctx.subagentManager.getSubagent(id);
    if (!subagent) {
      ctx.ui.notify(`Subagent ${id} not found`, "error");
      return;
    }
    
    ctx.setActiveSubagent(id);
    ctx.ui.notify(`Switched to subagent: ${subagent.name}`, "info");
  },
});

// /agent-send <message> - Send message to active subagent
pi.registerCommand("agent-send", {
  description: "Send message to the active subagent",
  handler: async (args, ctx) => {
    const activeId = ctx.getActiveSubagent();
    if (!activeId) {
      ctx.ui.notify("No active subagent. Use /agent <id> first.", "warning");
      return;
    }
    
    if (!args.trim()) {
      ctx.ui.notify("Usage: /agent-send <message>", "warning");
      return;
    }
    
    await ctx.subagentManager.sendToSubagent(activeId, args);
  },
});

// /agent-output - View subagent output
pi.registerCommand("agent-output", {
  description: "View the output from the active subagent",
  handler: async (args, ctx) => {
    const activeId = ctx.getActiveSubagent();
    if (!activeId) {
      ctx.ui.notify("No active subagent", "warning");
      return;
    }
    
    const output = await ctx.subagentManager.getSubagentOutput(activeId);
    // Display in a pager or panel
    ctx.ui.showOutput(output);
  },
});

// /agent-kill <id> - Kill a subagent
pi.registerCommand("agent-kill", {
  description: "Stop an alive subagent",
  handler: async (args, ctx) => {
    const id = args.trim() || ctx.getActiveSubagent();
    if (!id) {
      ctx.ui.notify("Usage: /agent-kill <id>", "warning");
      return;
    }
    
    const confirm = await ctx.ui.confirm("Kill Subagent?", `Stop subagent ${id}?`);
    if (confirm) {
      await ctx.subagentManager.stopSubagent(id);
      ctx.ui.notify(`Stopped subagent ${id}`, "info");
    }
  },
});
```

#### 6. UI Integration

**Status Widget** - Show alive subagents in footer:

```typescript
// Widget shows: "Agents: scout (running), planner (idle)"
ctx.ui.setWidget("subagents", {
  placement: "footer",
  render: () => {
    const agents = ctx.subagentManager.listSubagents();
    if (agents.length === 0) return null;
    return agents.map(a => `${a.name} (${a.status})`).join(", ");
  },
});
```

**Subagent Panel** - Show subagent output in a split view:

```typescript
// When user does /agent <id>, show subagent messages in a side panel
ctx.ui.setPanel("subagent", {
  title: `Subagent: ${subagent.name}`,
  content: subagent.messageHistory,
});
```

#### 7. Memory Persistence

For subagents that need to accumulate knowledge:

```typescript
interface SubagentMemory {
  load(agentName: string, scope: "user" | "project"): Promise<string>;
  save(agentName: string, content: string, scope: "user" | "project"): Promise<void>;
}

// File locations:
// ~/.pi/agent/agents/.memory/<agent-name>.md
// .pi/agents/.memory/<agent-name>.md
```

The memory file is loaded into the system prompt at start and updated after each turn.

## Implementation Phases

### Phase 1: Core Infrastructure (MVP)

**Goal:** Basic alive subagents with in-memory execution

1. **Create subagent types and interfaces**
   - `packages/coding-agent/src/core/subagents/types.ts`
   - `SubagentConfig`, `AliveSubagent`, `SubagentMessage`, etc.

2. **Implement SubagentManager**
   - `packages/coding-agent/src/core/subagents/manager.ts`
   - In-memory Agent instantiation
   - Basic lifecycle (start, stop, list)
   - Message passing

3. **Create agent discovery**
   - `packages/coding-agent/src/core/subagents/discovery.ts`
   - Load from `~/.pi/agent/agents/` and `.pi/agents/`
   - Parse YAML frontmatter
   - Merge user + project agents

4. **Register tools**
   - `subagent_start` (alive mode)
   - `subagent_list`
   - `subagent_stop`

5. **Integrate with AgentSession**
   - Add `subagentManager` to `AgentSessionConfig`
   - Initialize in constructor
   - Expose via `ExtensionContext`

**Estimated effort:** 2-3 days

### Phase 2: User Interaction

**Goal:** Slash commands for user interaction

1. **Register commands**
   - `/agents` - List alive subagents
   - `/agent <id>` - Switch context
   - `/agent-send <msg>` - Send message
   - `/agent-output` - View output
   - `/agent-kill <id>` - Stop subagent

2. **Context switching**
   - Track "active subagent" in session
   - Route user messages to active subagent when set
   - Display subagent messages in TUI

3. **UI widgets**
   - Status widget showing alive subagents
   - Different styling for subagent messages

**Estimated effort:** 1-2 days

### Phase 3: Enhanced Features

**Goal:** Production-ready subagents

1. **Memory persistence**
   - `.memory/<agent-name>.md` files
   - Load/save memory on subagent lifecycle

2. **Streaming updates**
   - Real-time output from subagents
   - Progress indicators

3. **Error handling**
   - Subagent crash recovery
   - Timeout handling
   - Graceful shutdown

4. **Parallel execution**
   - Run multiple subagents concurrently
   - Aggregate results

**Estimated effort:** 2-3 days

### Phase 4: Process-based Isolation (Optional)

**Goal:** True process isolation for subagents

1. **RPC mode integration**
   - Spawn `pi --mode rpc` processes
   - Communicate via RPC protocol

2. **Process pool**
   - Manage multiple child processes
   - Resource limits

3. **Hybrid mode**
   - Choose between in-memory and process-based
   - Default based on task complexity

**Estimated effort:** 3-4 days

## File Structure

```
packages/coding-agent/src/core/subagents/
├── index.ts              # Public exports
├── types.ts              # TypeScript interfaces
├── manager.ts            # SubagentManager class
├── discovery.ts          # Agent definition discovery
├── parser.ts             # YAML frontmatter parsing
├── memory.ts             # Memory persistence
├── tools.ts              # Tool registrations
├── commands.ts           # Slash command registrations
├── builtins/
│   ├── scout.md          # Built-in scout agent
│   ├── planner.md        # Built-in planner agent
│   └── worker.md         # Built-in worker agent
└── test/
    ├── manager.test.ts
    ├── discovery.test.ts
    └── integration.test.ts
```

## Configuration

### Settings

```json
// ~/.pi/agent/settings.json
{
  "subagents": {
    "enabled": true,
    "maxConcurrent": 4,
    "defaultMode": "in-memory",
    "timeout": 300000,
    "memory": {
      "enabled": true,
      "maxSize": 10000
    }
  }
}
```

### CLI Flags

```bash
# Start with subagents disabled
pi --no-subagents

# Set max concurrent subagents
pi --max-subagents 8

# Use process-based isolation
pi --subagent-mode process
```

## Security Considerations

1. **Project-level agents** - Prompt before running agents from `.pi/agents/`
2. **Tool restrictions** - Subagents only have tools specified in config
3. **Memory isolation** - Subagent memory files are separate from main session
4. **Resource limits** - Max concurrent subagents, memory limits, timeouts

## Backward Compatibility

1. **Existing subagent tool** - Keep current process-based tool as `subagent` for one-shot tasks
2. **New tools** - Add `subagent_start`, `subagent_send`, etc. for alive subagents
3. **Agent definitions** - Same Markdown + YAML format, new optional fields

## Testing Strategy

1. **Unit tests** - Manager, discovery, parsing
2. **Integration tests** - Full lifecycle with AgentSession
3. **E2E tests** - CLI with alive subagents
4. **Performance tests** - Multiple concurrent subagents

## Success Metrics

1. **Context isolation** - Main agent context not affected by subagent work
2. **Responsiveness** - Subagent starts in < 500ms (in-memory)
3. **Parallelism** - 4 subagents run concurrently without degradation
4. **User adoption** - `/agents` command usage in sessions

## References

- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Cursor Subagents](https://cursor.com/docs/context/subagents)
- [Google Cloud Multi-agent Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
- [Azure AI Agent Orchestration](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Spring AI Subagent Orchestration](https://spring.io/blog/2026/01/27/spring-ai-agentic-patterns-4-task-subagents)
