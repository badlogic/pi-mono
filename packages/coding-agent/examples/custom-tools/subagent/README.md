# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process
- **Streaming output**: See tool calls and progress as they happen
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage per agent
- **Abort support**: Ctrl+C propagates to kill subagent processes
- **Fuzzy model matching**: Use patterns like "sonnet" or fallbacks like "gpt, opus"
- **Recursion guard**: Prevents infinite subagent spawning (unless `recursive: true`)
- **Output files**: Optionally write results to files for later reference
- **Configurable**: Adjust concurrency, persistence, and other options

## Structure

```
subagent/
├── README.md            # This file
├── index.ts             # The custom tool (entry point)
├── agents.ts            # Agent discovery logic
├── subagent.json        # Configuration (concurrency, persistence, etc.)
├── subagent.schema.json # JSON schema for configuration
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
ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/subagent/subagent.json" ~/.pi/agent/tools/subagent/subagent.json

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

## Configuration

Edit `subagent.json` to customize behavior:

```json
{
  "maxParallelTasks": 16,      // Max tasks in parallel mode (1-64)
  "maxConcurrency": 8,         // Max concurrent subprocesses (1-32)
  "maxAgentsInDescription": 10, // Agents shown in tool description
  "collapsedItemCount": 10,    // Items shown in collapsed view
  "persistSessions": true,     // Save sessions & artifacts next to parent session
  "maxOutputLines": 5000,      // Max output lines per agent
  "maxOutputBytes": 500000     // Max output bytes per agent
}
```

### Environment Variable Overrides

Environment variables take precedence over `subagent.json`:

| Variable | Description |
|----------|-------------|
| `PI_SUBAGENT_MAX_PARALLEL_TASKS` | Maximum parallel tasks |
| `PI_SUBAGENT_MAX_CONCURRENCY` | Maximum concurrent subprocesses |
| `PI_SUBAGENT_PERSIST_SESSIONS` | `0` or `false` to disable session persistence |

## Security Model

This tool executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.pi/agents/*.md` or `.claude/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.pi/agent/agents` (with `~/.claude/agents` as fallback).

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

### Model override
```
Use scout with model "haiku" to quickly find the config files
```

### Fallback models
```
Use planner with model "gpt, opus" to analyze the architecture
```
(Tries "gpt" first, falls back to "opus" if not available)

### Workflow commands
```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

## Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task, model? }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder |

Each task in parallel/chain modes can have its own `model` override.

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

**Streaming progress** (tree-style):
```
Running 3 agents
├─ scout: Find auth code · 5 tool uses · 12k tokens
│  ⎿ grep: /authenticate/
├─ scout: Find config files · 3 tool uses
│  ⎿ Done
└─ planner · Queued...
```

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
model: claude-haiku-4-5, haiku, flash
recursive: false
---

System prompt for the agent goes here.
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent identifier (used in tool calls) |
| `description` | Yes | What the agent does (shown in tool description) |
| `tools` | No | Comma-separated tool list (default: all tools) |
| `model` | No | Model pattern with optional fallbacks |
| `recursive` | No | If `true`, agent can spawn subagents (default: `false`) |
| `forkContext` | No | Reserved for future use |

### Model Patterns

The `model` field supports fuzzy matching and fallback patterns:

- `claude-sonnet-4-5` - Exact match
- `sonnet` - Fuzzy match (matches any model containing "sonnet")
- `sonnet, haiku, flash` - Fallback chain (tries each in order)

### Agent Locations

**User-level** (always loaded with `agentScope: "user"` or `"both"`):
- `~/.pi/agent/agents/*.md` (primary)
- `~/.claude/agents/*.md` (fallback for backwards compatibility)

**Project-level** (only with `agentScope: "project"` or `"both"`):
- `.pi/agents/*.md` (primary)
- `.claude/agents/*.md` (fallback)

When multiple directories contain an agent with the same name:
1. `.pi` directories take precedence over `.claude`
2. Project directories take precedence over user directories

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
- **Recursion guard**: Unless `recursive: true`, subagents cannot spawn more subagents

## Output Files & Session Persistence

When `persistSessions` is enabled (default: `true`) and there's a parent session:

**Artifacts are stored next to the parent session file:**
```
/path/to/sessions/2026-01-01T14-28-11-636Z_uuid/
├── scout_Abc12345.in.md      # Input task
├── scout_Abc12345.out.md     # Output result  
├── scout_Abc12345.jsonl      # Session file (resumable)
├── planner_Xyz98765.in.md
├── planner_Xyz98765.out.md
└── planner_Xyz98765.jsonl
```

When `persistSessions` is disabled OR there's no parent session:

**Outputs go to temp directory (inputs/sessions not saved):**
```
/tmp/pi-subagent-<runId>/
├── task_scout_0.md
├── task_planner_1.md
└── chain_1_scout.md
```

This is useful for:
- Reviewing agent outputs after the session
- Referencing outputs in follow-up prompts
- Debugging agent behavior
- Resuming subagent sessions (when persistent)

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Agents discovered fresh on each invocation (allows editing mid-session)
- Parallel mode limited by `maxParallelTasks` and `maxConcurrency` settings
- Subagents run in separate processes (no shared context with parent)
