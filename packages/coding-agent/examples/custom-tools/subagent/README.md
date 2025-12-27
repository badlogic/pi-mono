# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process
- **Streaming output**: See tool calls and progress as they happen
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage per agent
- **Abort support**: Ctrl+C propagates to kill subagent processes

## Structure

```
subagent/
├── README.md            # This file
├── index.ts             # The custom tool (entry point)
├── agents.ts            # Agent discovery logic
├── chain-runner.ts      # Async chain execution (spawned via jiti)
├── agents/              # Sample agent definitions
│   ├── scout.md         # Fast recon, returns compressed context
│   ├── planner.md       # Creates implementation plans
│   ├── reviewer.md      # Code review
│   └── worker.md        # General-purpose (full capabilities)
└── commands/            # Workflow presets
    ├── implement.md     # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner (no implementation)
    └── implement-and-review.md  # worker -> reviewer -> worker
```

## Installation

From the repository root, symlink the files:

```bash
# Symlink the tool (must be in a subdirectory with index.ts)
mkdir -p ~/.pi/agent/tools/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/subagent/index.ts" ~/.pi/agent/tools/subagent/index.ts
ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/subagent/agents.ts" ~/.pi/agent/tools/subagent/agents.ts
ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/subagent/chain-runner.ts" ~/.pi/agent/tools/subagent/chain-runner.ts

# Symlink agents
mkdir -p ~/.pi/agent/agents
for f in packages/coding-agent/examples/custom-tools/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/agents/$(basename "$f")
done

# Symlink workflow commands
mkdir -p ~/.pi/agent/commands
for f in packages/coding-agent/examples/custom-tools/subagent/commands/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/commands/$(basename "$f")
done
```

## Security Model

This tool executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.pi/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.pi/agent/agents`.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`). Only do this for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents. Set `confirmProjectAgents: false` to disable.

## Usage

### Single agent
```
Use scout to find all authentication code
```

### Parallel execution
```
Run 2 scouts in parallel: one to find models, one to find providers
```

### Chained workflow
```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### Workflow commands
```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

## Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently (max 8, 4 concurrent) |
| Chain | `{ chain: [...] }` | Sequential with `@pi:previous` placeholder |
| Async | `{ ..., async: true }` | Runs in background, emits `subagent:complete` via `pi.events` |

## Async Mode

Runs subagents in the background. Works with single agents, parallel tasks, and chains.

```typescript
// Single async
{ agent: "scout", task: "find auth code", async: true }

// Async parallel (each task notifies independently when done)
{ tasks: [
  { agent: "scout", task: "find auth code" },
  { agent: "scout", task: "find db queries" }
], async: true }

// Async chain (scout -> planner in background)
{ chain: [
  { agent: "scout", task: "find auth code" },
  { agent: "planner", task: "plan based on: @pi:previous" }
], async: true }
```

**How it works:**
1. Subagent(s) spawn as detached processes
2. Returns immediately with an async ID
3. On completion, emits `subagent:complete` event via `pi.events`
4. A hook listens and calls `pi.send()` to notify you

**Async parallel behavior:**
- Each task runs independently and emits its own event when done
- Events include `taskIndex` and `totalTasks` for tracking
- Agent receives N notifications (one per task)
- No aggregated "all done" event - agent tracks completion itself

**Note:** Events only fire in interactive mode (agent must stay alive).

## Output Display

**Collapsed view** (default):
- Status icon (✓/✗/⏳) and agent name
- Last 5-10 items (tool calls and text)
- Usage stats: `3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:contextTokens model`

**Expanded view** (Ctrl+O):
- Full task text
- All tool calls with formatted arguments
- Final output rendered as Markdown
- Per-task usage (for chain/parallel)

**Parallel mode streaming**:
- Shows all tasks with live status (⏳ running, ✓ done, ✗ failed)
- Updates as each task makes progress
- Shows "2/3 done, 1 running" status

**Tool call formatting** (mimics built-in tools):
- `$ command` for bash
- `read ~/path:1-10` for read
- `grep /pattern/ in ~/path` for grep
- etc.

## Agent Definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-haiku-4-5
---

System prompt for the agent goes here.
```

**Locations:**
- `~/.pi/agent/agents/*.md` - User-level (always loaded)
- `.pi/agents/*.md` - Project-level (only with `agentScope: "project"` or `"both"`)

Project agents override user agents with the same name when `agentScope: "both"`.

## Sample Agents

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `scout` | Fast codebase recon | Haiku | read, grep, find, ls, bash |
| `planner` | Implementation plans | Sonnet | read, grep, find, ls |
| `reviewer` | Code review | Sonnet | read, grep, find, ls, bash |
| `worker` | General-purpose | Sonnet | (all default) |

## Workflow Commands

| Command | Flow |
|---------|------|
| `/implement <query>` | scout → planner → worker |
| `/scout-and-plan <query>` | scout → planner |
| `/implement-and-review <query>` | worker → reviewer → worker |

## Error Handling

- **Exit code != 0**: Tool returns error with stderr/output
- **stopReason "error"**: LLM error propagated with error message
- **stopReason "aborted"**: User abort (Ctrl+C) kills subprocess, throws error
- **Chain mode**: Stops at first failing step, reports which step failed

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Agents discovered fresh on each invocation (allows editing mid-session)
- Parallel mode limited to 8 tasks, 4 concurrent
