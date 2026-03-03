# Subagent Extension Implementation Plan

## Overview

This plan describes how to implement the subagent extension that self-registers with pi's extension system. The extension will:
- Create a `SubagentManager` instance on session start
- Register subagent tools (`subagent_start`, `subagent_send`, `subagent_list`, `subagent_stop`)
- Register subagent commands (`/agents`, `/agent`, `/agent-send`, `/agent-output`, `/agent-kill`, `/agent-list-configs`)
- Clean up on session shutdown

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Extension System                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Subagent Extension                              ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  Extension Entry (index.ts)                              │││
│  │  │  - session_start: Create SubagentManager                │││
│  │  │  - session_shutdown: Cleanup                            │││
│  │  │  - Register tools via pi.registerTool()                 │││
│  │  │  - Register commands via pi.registerCommand()           │││
│  │  └─────────────────────────────────────────────────────────┘││
│  │                           │                                  ││
│  │                           ▼                                  ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  SubagentManager (imported from core/subagents)         │││
│  │  │  - Manages subagent lifecycle                           │││
│  │  │  - Message routing                                      │││
│  │  │  - Event emission                                       │││
│  │  └─────────────────────────────────────────────────────────┘││
│  │                           │                                  ││
│  │                           ▼                                  ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  ToolFactory (implemented in extension)                 │││
│  │  │  - Uses createAllTools(cwd) from core/tools             │││
│  │  │  - Creates tool subsets for subagents                   │││
│  │  └─────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Export Subagent Module from Main Package

**File:** `packages/coding-agent/src/index.ts`

Add exports for the subagent module:

```typescript
// Subagents
export {
	SubagentManager,
	registerSubagentCommands,
	registerSubagentTools,
	discoverAgents,
	formatAgentList,
	getAgentByName,
	getAvailableAgentNames,
	parseAgentFile,
	parseFrontmatter,
	stripFrontmatter,
} from "./core/subagents/index.js";

export type {
	AgentFrontmatter,
	AliveSubagent,
	DiscoveryResult,
	MemoryScope,
	RpcClientLike,
	StartSubagentOptions,
	StartSubagentResult,
	SubagentConfig,
	SubagentContextActions,
	SubagentFilter,
	SubagentListDetails,
	SubagentManagerConfig,
	SubagentManagerEvent,
	SubagentManagerEventHandler,
	SubagentMessage,
	SubagentMode,
	SubagentOutput,
	SubagentSendDetails,
	SubagentSource,
	SubagentStartDetails,
	SubagentStatus,
	SubagentUsage,
	ToolFactory,
} from "./core/subagents/index.js";
```

### Step 2: Modify ToolFactory to Accept cwd

**Issue:** The current `ToolFactory` interface doesn't pass cwd, but tools need it for correct path resolution.

**Option A (Simple):** ToolFactory uses session cwd for all subagents
- Subagents inherit the main session's cwd
- If subagent needs different cwd, tools operate in wrong directory

**Option B (Better):** Pass cwd to tool creation

Modify `ToolFactory` interface:

```typescript
export interface ToolFactory {
	createSubset(toolNames: string[], cwd: string): AgentTool[];
	createAll(cwd: string): AgentTool[];
}
```

Update `SubagentManager` to pass cwd:

```typescript
// In startInMemory()
const tools = config.tools
	? this.config.toolFactory.createSubset(config.tools, subagent.cwd)
	: this.config.toolFactory.createAll(subagent.cwd);
```

### Step 3: Create Extension File

**File:** `packages/coding-agent/extensions/subagent.ts` (or `~/.pi/agent/extensions/subagent.ts`)

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	SubagentManager,
	type ToolFactory,
	type AgentTool,
	type SubagentManagerConfig,
} from "@mariozechner/pi-coding-agent";
import { createAllTools } from "@mariozechner/pi-coding-agent";

/**
 * ToolFactory implementation that creates tools for a specific cwd.
 */
class ExtensionToolFactory implements ToolFactory {
	createSubset(toolNames: string[], cwd: string): AgentTool[] {
		const all = this.createAll(cwd);
		return all.filter((t) => toolNames.includes(t.name));
	}

	createAll(cwd: string): AgentTool[] {
		const tools = createAllTools(cwd);
		return Object.values(tools);
	}
}

// Manager instance (singleton per session)
let manager: SubagentManager | null = null;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		// Create ToolFactory
		const toolFactory = new ExtensionToolFactory();

		// Create SubagentManager config
		const config: SubagentManagerConfig = {
			cwd: ctx.cwd,
			modelRegistry: ctx.modelRegistry,
			toolFactory,
			// Optional settings
			maxConcurrent: 4,
			defaultMode: "in-memory",
			defaultTimeout: 300000,
		};

		// Create manager
		manager = new SubagentManager(config);

		// Register tools (passing manager via closure)
		registerTools(pi, manager);

		// Register commands (passing manager via closure)
		registerCommands(pi, manager);
	});

	pi.on("session_shutdown", async () => {
		// Cleanup
		if (manager) {
			await manager.dispose();
			manager = null;
		}
	});
}

/**
 * Register subagent tools.
 */
function registerTools(pi: ExtensionAPI, manager: SubagentManager) {
	// subagent_start
	pi.registerTool({
		name: "subagent_start",
		label: "Start Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: 'fork' = one-shot task (default), 'alive' = persistent session.",
			"Available agents: scout (fast recon), planner (plans), worker (general).",
		].join(" "),
		parameters: {
			// ... schema
		},
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			// Use manager from closure
			const result = await manager.startSubagent(params.agent, params.task, {
				mode: "in-memory",
				waitForResult: params.mode !== "alive",
				cwd: ctx.cwd,
			});
			return {
				content: [{ type: "text", text: result.output ?? "Started" }],
				details: result,
			};
		},
	});

	// subagent_send, subagent_list, subagent_stop...
}

/**
 * Register subagent commands.
 */
function registerCommands(pi: ExtensionAPI, manager: SubagentManager) {
	// /agents, /agent, /agent-send, /agent-output, /agent-kill, /agent-list-configs
}
```

### Step 4: Alternative - Use Existing Registration Functions

The existing `registerSubagentTools` and `registerSubagentCommands` functions in `core/subagents/tools.ts` and `core/subagents/commands.ts` already implement tool/command registration. We can:

**Option A:** Import and use them directly
```typescript
import { registerSubagentTools, registerSubagentCommands } from "@mariozechner/pi-coding-agent";

// In extension:
registerSubagentTools(pi, manager);
registerSubagentCommands(pi, manager);
```

**Option B:** Refactor to use extension pattern
- Move tool definitions from `tools.ts` to the extension file
- Keep `tools.ts` as exports for programmatic use

**Recommendation:** Option A is simpler. The existing `registerSubagentTools` and `registerSubagentCommands` work correctly.

### Step 5: Handle cwd Changes

If the user changes the session's cwd (e.g., via `/cd` command or by navigating to a different directory), the SubagentManager's cwd becomes stale.

**Solution:** Listen for cwd changes and update the manager

```typescript
pi.on("session_start", async (_event, ctx) => {
	// ... create manager

	// Store reference to ctx for cwd access
	const getCwd = () => ctx.cwd;
});
```

Actually, looking at the ExtensionContext, `ctx.cwd` is a property that returns the current cwd at access time. So tools can just use `ctx.cwd` when they execute.

But the SubagentManager stores `this.cwd` from its config at construction time. If the session's cwd changes, subagents would still use the old cwd.

**Fix:** Either:
1. Don't store cwd in SubagentManager, always get from context
2. Add a method to update cwd
3. Accept that subagents use the cwd from when the session started

For MVP, Option 3 is acceptable. We can improve this later.

## File Changes Summary

| File | Change |
|------|--------|
| `packages/coding-agent/src/index.ts` | Add exports for subagent module |
| `packages/coding-agent/src/core/subagents/types.ts` | Modify `ToolFactory` to accept cwd (optional) |
| `packages/coding-agent/src/core/subagents/manager.ts` | Pass cwd to toolFactory methods (optional) |
| `packages/coding-agent/extensions/subagent.ts` | Create extension file (new) |

## Testing

1. **Manual Testing:**
   ```bash
   pi -e packages/coding-agent/extensions/subagent.ts
   ```

2. **Test Cases:**
   - Start a subagent: `subagent_start agent="scout" task="List files in src/"`
   - List subagents: `subagent_list`
   - Send message: `subagent_send subagentId="xxx" message="What did you find?"`
   - Stop subagent: `subagent_stop subagentId="xxx"`
   - Use slash commands: `/agents`, `/agent xxx`, `/agent-send hello`, `/agent-kill xxx`

## Open Questions

1. **Extension location:** Should the extension be in the package (examples/extensions/) or in user directory?
   - Recommendation: Include in package as an example, document how to enable it

2. **ToolFactory cwd:** Should we modify the interface to accept cwd?
   - Recommendation: Yes, for correctness. But can defer to Phase 2.

3. **Extension tools:** Should subagents have access to extension tools from the main session?
   - Recommendation: No for MVP. Subagents get core tools only. Can add later.

## Implementation Order

1. Add exports to `index.ts` (Step 1)
2. Create extension file with ToolFactory (Step 3)
3. Test manually
4. (Optional) Modify ToolFactory interface (Step 2)
5. Write tests
6. Document in README
