# Async Subagent Example

Full-featured subagent tool with sync and async modes, demonstrating event bus communication and TUI rendering.

**Requires:** pi-coding-agent with event bus support (`pi.events`)

## Features

- **Sync mode**: Streams output, tracks usage, renders markdown
- **Async mode**: Background execution, emits events when done
- **TUI rendering**: Collapsed/expanded views, tool call display, usage stats
- **Three execution modes**: Single, parallel, chain

## Files

```
async-subagent/
├── index.ts           # Main tool (~450 lines)
├── subagent-runner.ts # Detached runner for async
├── agents.ts          # Agent discovery
└── README.md
```

## Usage

### Single (async by default)
```typescript
{ agent: "worker", task: "refactor auth" }
// Returns immediately: "Async: worker [uuid]"
```

### Single (sync)
```typescript
{ agent: "worker", task: "refactor auth", async: false }
// Streams output, waits for completion
```

### Parallel
```typescript
{ tasks: [
    { agent: "scout", task: "find auth" },
    { agent: "scout", task: "find db" }
] }
```

### Chain
```typescript
{ chain: [
    { agent: "scout", task: "find auth code" },
    { agent: "planner", task: "based on {previous}, plan improvements" }
] }
```

## Parameters

| Param | Type | Description |
|-------|------|-------------|
| `agent` | string | Agent name (single mode) |
| `task` | string | Task description |
| `tasks` | array | Parallel tasks `[{agent, task, cwd?}]` |
| `chain` | array | Sequential chain with `{previous}` placeholder |
| `async` | boolean | Background execution (default: `true`) |
| `agentScope` | string | `"user"`, `"project"`, or `"both"` |
| `cwd` | string | Working directory |

## Async Flow

```
Tool called with async:true (default)
         │
         ▼
Spawns subagent-runner.ts (detached)
         │
         ▼
Returns immediately: "Async: worker [uuid]"
         │
         │  [background]
         ▼
Runner executes: pi -p --no-session "Task: ..."
         │
         ▼
Writes result to $TMPDIR/pi-async-subagent-results/
         │
         ▼
File watcher detects → emits async_subagent:complete
         │
         ▼
Hook receives → pi.sendMessage() → agent wakes up
```

## Sync Flow

```
Tool called with async:false
         │
         ▼
Spawns: pi --mode json -p --no-session
         │
         ▼
Streams JSON events, parses messages
         │
         ▼
Tracks usage (tokens, cost, turns)
         │
         ▼
Returns result with full details
```

## TUI Rendering

**Collapsed view** (default):
```
ok worker
  $ grep -r "auth" src/
  read src/auth.ts
  "Found 3 auth files..."
  2 turns in:1.1k out:342 $0.002 claude-sonnet-4-5
```

**Expanded view** (Ctrl+O):
```
ok worker

Task: Find all authentication code

  $ grep -r "auth" src/
  read src/auth.ts:1-50
  read src/login.ts:1-30

## Summary
Found authentication code in 3 files:
- src/auth.ts - main auth logic
- src/login.ts - login handler
- src/session.ts - session management

2 turns in:1.1k out:342 R1.8k $0.002 claude-sonnet-4-5
```

## Event Format

```typescript
interface AsyncSubagentResult {
  id: string;
  agent: string;        // "worker" or "chain:scout->planner"
  success: boolean;
  summary: string;
  exitCode: number;
  timestamp: number;
  results?: Array<{ agent: string; output: string; success: boolean }>;
  taskIndex?: number;   // For parallel
  totalTasks?: number;
}
```

## Hook Example

```typescript
// ~/.pi/agent/hooks/async-notify.ts
import type { HookAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: HookAPI) {
  pi.events.on("async_subagent:complete", (data: unknown) => {
    const r = data as { agent: string; success: boolean; summary: string };
    pi.sendMessage(
      {
        customType: "async-notify",
        content: `Background task ${r.success ? "completed" : "failed"}: **${r.agent}**\n\n${r.summary}`,
        display: true,
      },
      { triggerTurn: true },  // Wake the agent to respond
    );
  });
}
```

Register: `~/.pi/agent/settings.json`
```json
{ "hooks": ["~/.pi/agent/hooks/async-notify.ts"] }
```

## Installation

```bash
mkdir -p ~/.pi/agent/tools/async-subagent
cp examples/custom-tools/async-subagent/*.ts ~/.pi/agent/tools/async-subagent/

# Agents (if needed)
mkdir -p ~/.pi/agent/agents
cp examples/custom-tools/subagent/agents/*.md ~/.pi/agent/agents/

# Hook (optional)
cp examples/hooks/async-notify.ts ~/.pi/agent/hooks/
```

## Agent Definitions

Markdown with YAML frontmatter in `~/.pi/agent/agents/`:

```markdown
---
name: worker
description: General purpose
tools: read, write, edit, bash
model: claude-sonnet-4-5
---
System prompt here.
```
