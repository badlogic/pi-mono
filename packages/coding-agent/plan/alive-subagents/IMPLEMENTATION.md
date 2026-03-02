# Implementation Guide

## Prerequisites

Before starting, ensure you have:
1. Read `PLAN.md` for architecture overview
2. Reviewed `TYPES.md` for type definitions
3. Understood the existing subagent extension in `examples/extensions/subagent/`
4. Familiar with `Agent` class in `packages/agent/src/agent.ts`
5. Familiar with `AgentSession` in `packages/coding-agent/src/core/agent-session.ts`

## Step-by-Step Implementation

### Step 1: Create Directory Structure

```bash
mkdir -p packages/coding-agent/src/core/subagents/builtins
mkdir -p packages/coding-agent/src/core/subagents/test
```

### Step 2: Define Types (`types.ts`)

Create `packages/coding-agent/src/core/subagents/types.ts`:

```typescript
// Copy from TYPES.md and add imports
import type { Agent, AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type { ChildProcess } from "node:child_process";

// ... paste all types from TYPES.md
```

**Testing:**
```bash
npx tsc --noEmit packages/coding-agent/src/core/subagents/types.ts
```

### Step 3: Create Parser (`parser.ts`)

Parse markdown files with YAML frontmatter:

```typescript
// packages/coding-agent/src/core/subagents/parser.ts

export interface ParsedFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  memory?: "none" | "user" | "project";
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { frontmatter, body } where body is the content after frontmatter.
 */
export function parseFrontmatter<T extends Record<string, unknown>>(
  content: string
): { frontmatter: T; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (!match) {
    return { frontmatter: {} as T, body: content };
  }
  
  const yamlContent = match[1];
  const body = match[2];
  
  // Simple YAML parsing (or use a library like 'yaml')
  const frontmatter = parseSimpleYaml(yamlContent) as T;
  
  return { frontmatter, body };
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    
    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();
    
    // Handle arrays (comma-separated)
    if (typeof value === "string" && value.includes(",")) {
      value = value.split(",").map(s => s.trim());
    }
    
    result[key] = value;
  }
  
  return result;
}

/**
 * Parse an agent definition file.
 */
export function parseAgentFile(
  content: string,
  filePath: string,
  source: "user" | "project" | "builtin"
): SubagentConfig | null {
  const { frontmatter, body } = parseFrontmatter<ParsedFrontmatter>(content);
  
  if (!frontmatter.name || !frontmatter.description) {
    return null; // Invalid agent definition
  }
  
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    systemPrompt: body.trim(),
    tools: frontmatter.tools,
    model: frontmatter.model,
    memory: frontmatter.memory ?? "none",
    source,
    filePath,
  };
}
```

**Testing:**
```typescript
// test/parser.test.ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter, parseAgentFile } from "../parser.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const content = `---
name: scout
description: Fast recon
---
System prompt here`;
    
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("scout");
    expect(frontmatter.description).toBe("Fast recon");
    expect(body).toBe("System prompt here");
  });
});
```

### Step 4: Create Discovery (`discovery.ts`)

Find and load agent definitions:

```typescript
// packages/coding-agent/src/core/subagents/discovery.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "../../config.js";
import { parseAgentFile } from "./parser.js";
import type { SubagentConfig, DiscoveryResult } from "./types.js";

/**
 * Find the nearest .pi/agents directory starting from cwd.
 */
function findProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Load agents from a directory.
 */
function loadAgentsFromDir(
  dir: string,
  source: "user" | "project" | "builtin"
): SubagentConfig[] {
  if (!fs.existsSync(dir)) return [];
  
  const agents: SubagentConfig[] = [];
  
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    
    const filePath = path.join(dir, entry.name);
    const content = fs.readFileSync(filePath, "utf-8");
    const agent = parseAgentFile(content, filePath, source);
    
    if (agent) agents.push(agent);
  }
  
  return agents;
}

/**
 * Discover all available agents.
 */
export function discoverAgents(cwd: string): DiscoveryResult {
  // User agents: ~/.pi/agent/agents/
  const userAgentsDir = path.join(getAgentDir(), "agents");
  const userAgents = loadAgentsFromDir(userAgentsDir, "user");
  
  // Project agents: .pi/agents/
  const projectAgentsDir = findProjectAgentsDir(cwd);
  const projectAgents = projectAgentsDir 
    ? loadAgentsFromDir(projectAgentsDir, "project")
    : [];
  
  // Built-in agents
  const builtinAgentsDir = path.join(__dirname, "builtins");
  const builtinAgents = loadAgentsFromDir(builtinAgentsDir, "builtin");
  
  // Merge (project overrides user with same name)
  const agentMap = new Map<string, SubagentConfig>();
  
  // Load in order: builtin -> user -> project
  for (const agent of [...builtinAgents, ...userAgents, ...projectAgents]) {
    agentMap.set(agent.name, agent);
  }
  
  return {
    agents: Array.from(agentMap.values()),
    userAgentsDir: fs.existsSync(userAgentsDir) ? userAgentsDir : null,
    projectAgentsDir,
    builtinAgentsDir,
  };
}
```

### Step 5: Create Built-in Agents

Create `packages/coding-agent/src/core/subagents/builtins/scout.md`:

```markdown
---
name: scout
description: Fast codebase recon that returns compressed context for handoff
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

You are a scout. Quickly investigate a codebase and return structured findings.

Your output will be passed to another agent who has NOT seen the files.

Thoroughness (infer from task, default medium):
- Quick: Targeted lookups, key files only
- Medium: Follow imports, read critical sections
- Thorough: Trace all dependencies, check tests/types

Output format:

## Files Retrieved
List with exact line ranges.

## Key Code
Critical types, interfaces, or functions.

## Architecture
Brief explanation.

## Start Here
Which file to look at first.
```

Create `packages/coding-agent/src/core/subagents/builtins/planner.md`:

```markdown
---
name: planner
description: Creates implementation plans from requirements
tools: read, grep, find, ls
model: claude-sonnet-4-5
---

You are a planner. Analyze requirements and create detailed implementation plans.

Output format:

## Analysis
- Current state
- Requirements
- Constraints

## Plan
1. Step one
2. Step two
...

## Files to Modify
- path/to/file.ts - what to change

## Risks
- Potential issues
```

Create `packages/coding-agent/src/core/subagents/builtins/worker.md`:

```markdown
---
name: worker
description: General-purpose subagent with full capabilities
model: claude-sonnet-4-5
---

You are a worker agent. Complete the assigned task autonomously.

Output format:

## Completed
What was done.

## Files Changed
- path/to/file.ts - what changed

## Notes
Anything the main agent should know.
```

### Step 6: Create SubagentManager (`manager.ts`)

The core manager class:

```typescript
// packages/coding-agent/src/core/subagents/manager.ts

import { randomUUID } from "node:crypto";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { discoverAgents } from "./discovery.js";
import type {
  AliveSubagent,
  SubagentConfig,
  SubagentManagerConfig,
  SubagentManagerEvent,
  SubagentManagerEventHandler,
  StartSubagentOptions,
  StartSubagentResult,
  SubagentOutput,
  SubagentFilter,
  SubagentStatus,
  SubagentMessage,
} from "./types.js";

export class SubagentManager {
  private subagents = new Map<string, AliveSubagent>();
  private configs = new Map<string, SubagentConfig>();
  private listeners = new Set<SubagentManagerEventHandler>();
  private config: SubagentManagerConfig;
  private activeSubagentId: string | undefined;

  constructor(config: SubagentManagerConfig) {
    this.config = config;
    this.loadConfigs();
  }

  // ========================================
  // Lifecycle
  // ========================================

  /**
   * Load agent configurations from disk.
   */
  private loadConfigs(): void {
    const discovery = discoverAgents(this.config.cwd);
    for (const agent of discovery.agents) {
      this.configs.set(agent.name, agent);
    }
  }

  /**
   * Start a new subagent.
   */
  async startSubagent(
    name: string,
    task: string,
    options: StartSubagentOptions = {}
  ): Promise<StartSubagentResult> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Unknown agent: ${name}`);
    }

    // Check concurrent limit
    const active = Array.from(this.subagents.values())
      .filter(s => s.status !== "done" && s.status !== "error" && s.status !== "stopped");
    const maxConcurrent = this.config.maxConcurrent ?? 4;
    if (active.length >= maxConcurrent) {
      throw new Error(`Maximum concurrent subagents reached (${maxConcurrent})`);
    }

    const id = this.generateId();
    const mode = options.mode ?? this.config.defaultMode ?? "in-memory";

    const subagent: AliveSubagent = {
      id,
      name,
      config,
      mode,
      status: "starting",
      task,
      cwd: options.cwd ?? this.config.cwd,
      pendingMessages: [],
      messageHistory: [],
      startTime: Date.now(),
      lastActivity: Date.now(),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
      turnCount: 0,
      abortController: new AbortController(),
    };

    this.subagents.set(id, subagent);
    this.emit({ type: "started", subagent });

    try {
      if (mode === "in-memory") {
        await this.startInMemory(subagent, options);
      } else {
        await this.startProcess(subagent, options);
      }

      // If waitForResult, wait for completion
      if (options.waitForResult !== false) {
        await this.waitForCompletion(id, options.timeout);
      }

      return {
        id,
        status: subagent.status,
        complete: subagent.status === "done",
        output: this.getLastOutput(subagent),
        usage: subagent.usage,
      };
    } catch (error) {
      subagent.status = "error";
      this.emit({ type: "stopped", subagentId: id, reason: "error" });
      throw error;
    }
  }

  /**
   * Start an in-memory subagent.
   */
  private async startInMemory(
    subagent: AliveSubagent,
    options: StartSubagentOptions
  ): Promise<void> {
    const config = subagent.config;

    // Resolve model
    const model = config.model
      ? this.config.modelRegistry.find("anthropic", config.model) ??
        this.config.modelRegistry.find("google", config.model) ??
        this.config.modelRegistry.getDefault()
      : this.config.modelRegistry.getDefault();
    subagent.model = model;

    // Create tools subset
    const tools = config.tools
      ? this.config.toolFactory.createSubset(config.tools)
      : this.config.toolFactory.createAll();
    subagent.tools = tools;

    // Build system prompt
    let systemPrompt = config.systemPrompt;
    if (subagent.memoryContent) {
      systemPrompt = `[Previous context]\n${subagent.memoryContent}\n\n${systemPrompt}`;
    }
    if (options.context) {
      systemPrompt = `${systemPrompt}\n\n[Additional context]\n${options.context}`;
    }

    // Create Agent instance
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools,
        messages: [],
        isStreaming: false,
        streamMessage: null,
        pendingToolCalls: new Set(),
      },
    });
    subagent.agent = agent;

    // Subscribe to events
    subagent.unsubscribe = agent.subscribe((event) => {
      this.handleAgentEvent(subagent, event);
    });

    // Send initial task
    subagent.status = "running";
    this.emit({ type: "status", subagentId: subagent.id, status: "running" });

    await agent.prompt(task);
  }

  /**
   * Handle events from in-memory agent.
   */
  private handleAgentEvent(subagent: AliveSubagent, event: AgentEvent): void {
    subagent.lastActivity = Date.now();

    switch (event.type) {
      case "message_end":
        if (event.message.role === "assistant") {
          const usage = event.message.usage;
          if (usage) {
            subagent.usage.inputTokens += usage.input ?? 0;
            subagent.usage.outputTokens += usage.output ?? 0;
            subagent.usage.cacheReadTokens += usage.cacheRead ?? 0;
            subagent.usage.cacheWriteTokens += usage.cacheWrite ?? 0;
            subagent.usage.totalCost += usage.cost?.total ?? 0;
          }
        }
        
        const msg: SubagentMessage = {
          id: randomUUID(),
          subagentId: subagent.id,
          role: event.message.role as any,
          content: this.messageToText(event.message),
          timestamp: Date.now(),
          source: "self",
        };
        subagent.messageHistory.push(msg);
        this.emit({ type: "message", subagentId: subagent.id, message: msg });
        break;

      case "turn_end":
        subagent.turnCount++;
        break;

      case "agent_end":
        subagent.status = "done";
        this.emit({ type: "status", subagentId: subagent.id, status: "done" });
        this.emit({ type: "stopped", subagentId: subagent.id, reason: "completed" });
        break;
    }
  }

  /**
   * Stop a subagent.
   */
  async stopSubagent(id: string): Promise<void> {
    const subagent = this.subagents.get(id);
    if (!subagent) return;

    subagent.abortController?.abort();

    if (subagent.mode === "process" && subagent.process) {
      subagent.process.kill("SIGTERM");
    }

    subagent.unsubscribe?.();
    subagent.status = "stopped";
    
    this.emit({ type: "status", subagentId: id, status: "stopped" });
    this.emit({ type: "stopped", subagentId: id, reason: "killed" });
    
    this.subagents.delete(id);
  }

  /**
   * Stop all subagents.
   */
  async stopAllSubagents(): Promise<void> {
    const ids = Array.from(this.subagents.keys());
    await Promise.all(ids.map(id => this.stopSubagent(id)));
  }

  // ========================================
  // Communication
  // ========================================

  /**
   * Send a message to a subagent.
   */
  async sendToSubagent(id: string, message: string): Promise<void> {
    const subagent = this.subagents.get(id);
    if (!subagent) {
      throw new Error(`Subagent not found: ${id}`);
    }

    if (subagent.status === "done" || subagent.status === "stopped") {
      throw new Error(`Subagent ${id} is not active (status: ${subagent.status})`);
    }

    const msg: SubagentMessage = {
      id: randomUUID(),
      subagentId: id,
      role: "user",
      content: message,
      timestamp: Date.now(),
      source: "parent",
    };

    subagent.messageHistory.push(msg);
    this.emit({ type: "message", subagentId: id, message: msg });

    if (subagent.mode === "in-memory" && subagent.agent) {
      await subagent.agent.prompt(message);
    } else if (subagent.mode === "process" && subagent.rpcClient) {
      await subagent.rpcClient.call("prompt", { message });
    }
  }

  /**
   * Get subagent output.
   */
  async getSubagentOutput(id: string): Promise<SubagentOutput> {
    const subagent = this.subagents.get(id);
    if (!subagent) {
      throw new Error(`Subagent not found: ${id}`);
    }

    return {
      id,
      status: subagent.status,
      output: this.getLastOutput(subagent),
      recentMessages: subagent.messageHistory.slice(-10),
      usage: subagent.usage,
      turnCount: subagent.turnCount,
    };
  }

  /**
   * Wait for subagent to complete.
   */
  async waitForCompletion(id: string, timeout?: number): Promise<void> {
    const subagent = this.subagents.get(id);
    if (!subagent) throw new Error(`Subagent not found: ${id}`);

    return new Promise((resolve, reject) => {
      const timeoutMs = timeout ?? this.config.defaultTimeout ?? 300000;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Subagent ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (event: SubagentManagerEvent) => {
        if (event.type === "stopped" && event.subagentId === id) {
          cleanup();
          if (event.reason === "error") {
            reject(new Error(`Subagent ${id} failed`));
          } else {
            resolve();
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off(handler);
      };

      // Check if already done
      if (subagent.status === "done" || subagent.status === "error") {
        cleanup();
        if (subagent.status === "error") {
          reject(new Error(`Subagent ${id} failed`));
        } else {
          resolve();
        }
        return;
      }

      this.on(handler);
    });
  }

  // ========================================
  // Query
  // ========================================

  getSubagent(id: string): AliveSubagent | undefined {
    return this.subagents.get(id);
  }

  listSubagents(filter?: SubagentFilter): AliveSubagent[] {
    let agents = Array.from(this.subagents.values());

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      agents = agents.filter(a => statuses.includes(a.status));
    }

    if (filter?.name) {
      agents = agents.filter(a => a.name === filter.name);
    }

    if (filter?.mode) {
      agents = agents.filter(a => a.mode === filter.mode);
    }

    return agents;
  }

  getActiveSubagent(): string | undefined {
    return this.activeSubagentId;
  }

  setActiveSubagent(id: string | undefined): void {
    if (id && !this.subagents.has(id)) {
      throw new Error(`Subagent not found: ${id}`);
    }
    this.activeSubagentId = id;
  }

  getAvailableAgents(): SubagentConfig[] {
    return Array.from(this.configs.values());
  }

  // ========================================
  // Events
  // ========================================

  on(handler: SubagentManagerEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  off(handler: SubagentManagerEventHandler): void {
    this.listeners.delete(handler);
  }

  private emit(event: SubagentManagerEvent): void {
    for (const handler of this.listeners) {
      try {
        handler(event);
      } catch (error) {
        console.error("Error in subagent event handler:", error);
      }
    }
  }

  // ========================================
  // Helpers
  // ========================================

  private generateId(): string {
    return randomUUID().slice(0, 8);
  }

  private getLastOutput(subagent: AliveSubagent): string {
    for (let i = subagent.messageHistory.length - 1; i >= 0; i--) {
      const msg = subagent.messageHistory[i];
      if (msg.role === "assistant") {
        return msg.content;
      }
    }
    return "";
  }

  private messageToText(message: AgentMessage): string {
    if (message.role === "assistant") {
      return message.content
        .filter(c => c.type === "text")
        .map(c => (c as any).text)
        .join("\n");
    }
    return JSON.stringify(message);
  }
}
```

### Step 7: Register Tools (`tools.ts`)

```typescript
// packages/coding-agent/src/core/subagents/tools.ts

import type { ExtensionAPI } from "../extensions/types.js";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { SubagentManager } from "./manager.js";

export function registerSubagentTools(
  pi: ExtensionAPI,
  manager: SubagentManager
): void {
  // subagent_start
  pi.registerTool({
    name: "subagent_start",
    label: "Start Subagent",
    description: [
      "Delegate tasks to specialized subagents with isolated context.",
      "Modes: 'fork' = one-shot (default), 'alive' = persistent session.",
      "Use 'alive' mode when you need to interact with the subagent later.",
    ].join(" "),
    parameters: Type.Object({
      agent: Type.String({ description: "Agent name (e.g., 'scout', 'planner', 'worker')" }),
      task: Type.String({ description: "Task for the subagent" }),
      mode: Type.Optional(StringEnum(["fork", "alive"] as const, {
        description: "'fork' = one-shot, 'alive' = persistent",
        default: "fork",
      })),
      waitForResult: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await manager.startSubagent(params.agent, params.task, {
        mode: params.mode === "alive" ? "in-memory" : "in-memory",
        waitForResult: params.mode !== "alive" && params.waitForResult !== false,
      });

      if (params.mode === "alive") {
        return {
          content: [{
            type: "text",
            text: `Started alive subagent '${params.agent}' with ID: ${result.id}\nUser can interact via: /agent ${result.id}`,
          }],
          details: { subagentId: result.id, status: result.status },
        };
      }

      return {
        content: [{ type: "text", text: result.output ?? "(no output)" }],
        details: { subagentId: result.id, usage: result.usage },
      };
    },
  });

  // subagent_send
  pi.registerTool({
    name: "subagent_send",
    label: "Send to Subagent",
    description: "Send a message to an alive subagent.",
    parameters: Type.Object({
      subagentId: Type.String({ description: "ID of the alive subagent" }),
      message: Type.String({ description: "Message to send" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      await manager.sendToSubagent(params.subagentId, params.message);
      const subagent = manager.getSubagent(params.subagentId);
      
      return {
        content: [{
          type: "text",
          text: subagent ? manager.getSubagentOutput(params.subagentId).then(o => o.output) : "Sent",
        }],
        details: { subagentId: params.subagentId },
      };
    },
  });

  // subagent_list
  pi.registerTool({
    name: "subagent_list",
    label: "List Subagents",
    description: "List all alive subagents and their status.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const agents = manager.listSubagents();
      
      if (agents.length === 0) {
        return { content: [{ type: "text", text: "No alive subagents." }] };
      }

      const lines = agents.map(a => 
        `${a.id}: ${a.name} - ${a.status} (turns: ${a.turnCount})`
      );
      
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          status: a.status,
          task: a.task,
          turnCount: a.turnCount,
          usage: a.usage,
        }))},
      };
    },
  });

  // subagent_stop
  pi.registerTool({
    name: "subagent_stop",
    label: "Stop Subagent",
    description: "Stop an alive subagent.",
    parameters: Type.Object({
      subagentId: Type.String({ description: "ID of the subagent to stop" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      await manager.stopSubagent(params.subagentId);
      return {
        content: [{ type: "text", text: `Stopped subagent ${params.subagentId}` }],
      };
    },
  });
}
```

### Step 8: Register Commands (`commands.ts`)

```typescript
// packages/coding-agent/src/core/subagents/commands.ts

import type { ExtensionAPI, ExtensionContext } from "../extensions/types.js";
import type { SubagentManager } from "./manager.js";

export function registerSubagentCommands(
  pi: ExtensionAPI,
  manager: SubagentManager
): void {
  // /agents
  pi.registerCommand("agents", {
    description: "List all alive subagents",
    handler: async (_args, ctx) => {
      const agents = manager.listSubagents();
      
      if (agents.length === 0) {
        ctx.ui.notify("No alive subagents", "info");
        return;
      }

      const items = agents.map(a => ({
        value: a.id,
        label: `${a.name} (${a.status})`,
        description: a.task.slice(0, 60) + (a.task.length > 60 ? "..." : ""),
      }));

      const selected = await ctx.ui.select("Alive Subagents:", items);
      if (selected) {
        manager.setActiveSubagent(selected);
        ctx.ui.notify(`Switched to subagent: ${selected}`, "info");
      }
    },
  });

  // /agent
  pi.registerCommand("agent", {
    description: "Switch to subagent for direct interaction",
    getArgumentCompletions: (prefix) => {
      const agents = manager.listSubagents();
      const filtered = agents.filter(a => a.id.startsWith(prefix));
      return filtered.map(a => ({ value: a.id, label: `${a.id}: ${a.name}` }));
    },
    handler: async (args, ctx) => {
      const id = args.trim();
      
      if (!id) {
        // No ID provided, show list
        const agents = manager.listSubagents();
        if (agents.length === 0) {
          ctx.ui.notify("No alive subagents", "info");
          return;
        }
        ctx.ui.notify(`Alive agents: ${agents.map(a => a.id).join(", ")}`, "info");
        return;
      }

      const subagent = manager.getSubagent(id);
      if (!subagent) {
        ctx.ui.notify(`Subagent ${id} not found`, "error");
        return;
      }

      manager.setActiveSubagent(id);
      ctx.ui.notify(`Switched to subagent: ${subagent.name}`, "info");
    },
  });

  // /agent-send
  pi.registerCommand("agent-send", {
    description: "Send message to the active subagent",
    handler: async (args, ctx) => {
      const activeId = manager.getActiveSubagent();
      
      if (!activeId) {
        ctx.ui.notify("No active subagent. Use /agent <id> first.", "warning");
        return;
      }

      if (!args.trim()) {
        ctx.ui.notify("Usage: /agent-send <message>", "warning");
        return;
      }

      try {
        await manager.sendToSubagent(activeId, args);
        ctx.ui.notify("Message sent to subagent", "info");
      } catch (error) {
        ctx.ui.notify(`Failed to send: ${error}`, "error");
      }
    },
  });

  // /agent-kill
  pi.registerCommand("agent-kill", {
    description: "Stop an alive subagent",
    handler: async (args, ctx) => {
      const id = args.trim() || manager.getActiveSubagent();
      
      if (!id) {
        ctx.ui.notify("Usage: /agent-kill <id>", "warning");
        return;
      }

      const subagent = manager.getSubagent(id);
      if (!subagent) {
        ctx.ui.notify(`Subagent ${id} not found`, "error");
        return;
      }

      const confirm = await ctx.ui.confirm(
        "Kill Subagent?",
        `Stop subagent ${id} (${subagent.name})?`
      );

      if (confirm) {
        await manager.stopSubagent(id);
        if (manager.getActiveSubagent() === id) {
          manager.setActiveSubagent(undefined);
        }
        ctx.ui.notify(`Stopped subagent ${id}`, "info");
      }
    },
  });
}
```

### Step 9: Create Index and Export

```typescript
// packages/coding-agent/src/core/subagents/index.ts

export * from "./types.js";
export { SubagentManager } from "./manager.js";
export { discoverAgents } from "./discovery.js";
export { parseAgentFile, parseFrontmatter } from "./parser.js";
export { registerSubagentTools } from "./tools.js";
export { registerSubagentCommands } from "./commands.js";
```

### Step 10: Integrate with AgentSession

Modify `packages/coding-agent/src/core/agent-session.ts`:

```typescript
// Add import
import { SubagentManager } from "./subagents/index.js";

// In AgentSessionConfig
export interface AgentSessionConfig {
  // ... existing fields
  subagentManager?: SubagentManager;
}

// In AgentSession constructor
constructor(config: AgentSessionConfig) {
  // ... existing code
  
  // Initialize SubagentManager
  this._subagentManager = config.subagentManager ?? new SubagentManager({
    cwd: config.cwd,
    modelRegistry: config.modelRegistry,
    toolFactory: this, // Implement ToolFactory interface
    extensionApi: this._extensionRunner,
  });
}

// Add getter
get subagentManager(): SubagentManager {
  return this._subagentManager;
}
```

### Step 11: Register in Extension System

When extensions are loaded, register the tools and commands:

```typescript
// In extension setup
import { registerSubagentTools, registerSubagentCommands } from "./subagents/index.js";

// After SubagentManager is created
registerSubagentTools(pi, subagentManager);
registerSubagentCommands(pi, subagentManager);
```

## Testing the Implementation

### Unit Tests

```bash
# Run tests
npx tsx ../../node_modules/vitest/dist/cli.js --run packages/coding-agent/src/core/subagents/test/
```

### Manual Testing

```bash
# Start pi
./pi-test.sh

# In pi:
> Start a scout subagent to explore the agents directory
> /agents
> /agent <id>
> /agent-send What files did you find?
> /agent-kill <id>
```

## Checklist

- [ ] `types.ts` - All types defined
- [ ] `parser.ts` - YAML frontmatter parsing
- [ ] `discovery.ts` - Agent file discovery
- [ ] `builtins/*.md` - Built-in agent definitions
- [ ] `manager.ts` - SubagentManager class
- [ ] `tools.ts` - Tool registrations
- [ ] `commands.ts` - Slash command registrations
- [ ] `index.ts` - Exports
- [ ] Integration with AgentSession
- [ ] Unit tests
- [ ] Manual testing
- [ ] Documentation update
