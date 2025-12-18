# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Structure

```
subagent/
├── README.md            # This file
├── subagent.ts          # The custom tool
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

From the `examples/custom-tools/subagent/` directory:

```bash
# Copy the tool
mkdir -p ~/.pi/agent/tools
cp subagent.ts ~/.pi/agent/tools/

# Copy agents
mkdir -p ~/.pi/agent/agents
cp agents/*.md ~/.pi/agent/agents/

# Copy workflow commands
mkdir -p ~/.pi/agent/commands
cp commands/*.md ~/.pi/agent/commands/
```

## Security Model

This example intentionally executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

Treat **project-local agent definitions as repo-controlled prompts**:
- A project can define agents in `.pi/agents/*.md`.
- Those prompts can instruct the model to read files, run bash commands, etc. (depending on the allowed tools).

**Default behavior:** the tool only loads **user-level agents** from `~/.pi/agent/agents`.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`) explicitly. Only do this for repositories you trust.

When running interactively, the tool will prompt for confirmation before running project-local agents. Set `confirmProjectAgents: false` to disable the prompt.

## Usage

### Single agent
```
> Use the subagent tool with agent "scout" and task "find all authentication code"
```

### Parallel execution
```
> Use subagent with tasks:
>   - scout: "analyze the auth module"
>   - scout: "analyze the api module"
>   - scout: "analyze the database module"
```

### Chained workflow
```
> Use subagent chain:
>   1. scout: "find code related to caching"
>   2. planner: "plan Redis integration using: {previous}"
>   3. worker: "implement: {previous}"
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
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently |
| Chain | `{ chain: [...] }` | Sequential with `{previous}` placeholder |

<details>
<summary>Flow Diagrams</summary>

### Single Mode

```
┌─────────────────┐
│   Main Agent    │
└────────┬────────┘
         │ "use scout to find auth code"
         ▼
┌─────────────────┐
│  subagent tool  │
└────────┬────────┘
         │ pi -p --model haiku ...
         ▼
┌─────────────────┐
│     Scout       │
│   (subprocess)  │
└────────┬────────┘
         │ stdout
         ▼
┌─────────────────┐
│   Tool Result   │
└─────────────────┘
```

### Parallel Mode

```
┌──────────────────────┐
│      Main Agent      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│    subagent tool     │
│    Promise.all()     │
└──────────┬───────────┘
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
┌──────┐┌──────┐┌──────┐
│Scout ││Scout ││Scout │
│ auth ││ api  ││  db  │
└──┬───┘└──┬───┘└──┬───┘
   │       │       │
   └───────┼───────┘
           ▼
┌──────────────────────┐
│   Combined Result    │
└──────────────────────┘
```

### Chain Mode

```
┌─────────────────┐
│   Main Agent    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  subagent tool  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Step 1: Scout  │
└────────┬────────┘
         │ {previous} = scout output
         ▼
┌─────────────────┐
│ Step 2: Planner │
└────────┬────────┘
         │ {previous} = planner output
         ▼
┌─────────────────┐
│ Step 3: Worker  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Chain Result   │
└─────────────────┘
```

### Workflow Command Expansion

```
/implement add Redis
        │
        ▼
┌─────────────────────────────────────────┐
│  Expands to chain:                      │
│  1. scout: "find code for add Redis"    │
│  2. planner: "plan using {previous}"    │
│  3. worker: "implement {previous}"      │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│            Chain Execution              │
│                                         │
│ scout ──► planner ──► worker            │
│ (haiku)   (sonnet)    (sonnet)          │
└─────────────────────────────────────────┘
```

</details>

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
- `~/.pi/agent/agents/*.md` - User-level (global)
- `.pi/agents/*.md` - Project-level (only loaded if `agentScope` includes `"project"`)

## Sample Agents

| Agent | Purpose | Model |
|-------|---------|-------|
| `scout` | Fast codebase recon, returns compressed context | Haiku |
| `planner` | Creates implementation plans from context | Sonnet |
| `reviewer` | Code review for quality/security | Sonnet |
| `worker` | General-purpose with full capabilities | Sonnet |

## Workflow Commands

Commands are prompt templates that invoke the subagent tool:

| Command | Flow |
|---------|------|
| `/implement <query>` | scout -> planner -> worker |
| `/scout-and-plan <query>` | scout -> planner |
| `/implement-and-review <query>` | worker -> reviewer -> worker |

## Limitations

- No timeout/cancellation (subprocess limitation)
- Output truncated to 500 lines / 50KB per agent
- Agents discovered fresh on each invocation
