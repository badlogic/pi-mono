# Orchestrate Tool

Execute tasks from collaborative task files (e.g., `01_TASKS.md`) with memory-first approach, quality gates, and session archiving.

## Overview

The orchestrate tool implements a **Memory-First Task Agent Architecture**:

1. **Questions/Blockers Gate** - BLOCKS execution if unresolved questions exist
2. **Memory Recall Pre-Hook** - Queries memory for prior solutions before each task
3. **Quality Gate Post-Hook** - Runs tests after each task (must pass to continue)
4. **Checkbox Updates** - Marks tasks `[x]` in the file upon completion
5. **Session Archiving** - Archives to episodic memory on completion

## Installation

```bash
# From pi-mono root
mkdir -p ~/.pi/agent/tools/orchestrate
ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/orchestrate/index.ts" \
  ~/.pi/agent/tools/orchestrate/index.ts
```

## Usage

Within pi-mono:

```
Run the tasks in 01_TASKS.md
```

```
Orchestrate the task file
```

```
Execute the pending tasks
```

## Task File Format

```markdown
# Task List: Feature Name

## Context
Brief description of what we're building.

## Tasks

- [ ] **Task 1**: Implement feature X
  - Agent: general-purpose
  - Dependencies: none
  - Notes: Handle edge cases

- [ ] **Task 2**: Add tests for feature X
  - Agent: general-purpose
  - Dependencies: Task 1
  - Notes: Cover happy path and errors

## Completion Criteria
All tests pass and code is reviewed.

## Questions/Blockers
None
```

### Task Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `Task N` | Yes | Task ID and title |
| `Agent` | No | Agent config to use (default: `general-purpose`) |
| `Dependencies` | No | Task IDs that must complete first |
| `Notes` | No | Additional context for the agent |

### Questions/Blockers Section

If this section contains any items other than "None", orchestration **will not start**. This prevents work from beginning before requirements are clarified.

## Agent Configs

Create agent configs in `~/.pi/agent/agents/<name>.md`:

```markdown
---
name: general-purpose
description: General coding agent with memory-first approach
tools: read,grep,find,ls,bash,edit,write
provider: google
model: gemini-2.0-flash
---

You are a focused coding agent. Complete the assigned task following best practices.
```

### Agent Config Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Agent name (defaults to filename) |
| `description` | No | Agent description |
| `tools` | No | Comma-separated list of allowed tools |
| `provider` | No | API provider (`google`, `anthropic`, `openai`) |
| `model` | No | Model to use |

The body after frontmatter becomes the agent's system prompt.

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `taskFile` | string | (required) | Path to task file |
| `continueOnError` | boolean | false | Continue if a task fails |
| `archive` | boolean | true | Archive session on completion |
| `taskTimeoutMs` | number | 1800000 | Timeout per task (30 min) |

## Hooks

### Memory Recall Pre-Hook

Before each task, queries `~/.pi/agent/skills/memory/run.sh recall` with the task context. Found solutions are injected into the task prompt.

### Quality Gate Post-Hook

After each task, runs the quality gate script. If tests fail, the task is marked failed and orchestration stops (unless `continueOnError` is true).

Configure in: `/home/graham/workspace/experiments/memory/.claude/hooks/quality-gate.sh`

## Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION START                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │   Parse Task File      │
                 │   (01_TASKS.md)        │
                 └────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Questions/Blockers Gate      │
              │  ───────────────────────      │
              │  Any unresolved questions?    │
              └───────────────────────────────┘
                    │                 │
                   YES               NO
                    │                 │
                    ▼                 ▼
           ┌──────────────┐   ┌──────────────────┐
           │ BLOCK: Cannot│   │ Continue to      │
           │ start until  │   │ task execution   │
           │ resolved     │   │                  │
           └──────────────┘   └──────────────────┘
                                      │
                                      ▼
                 ┌────────────────────────────────┐
                 │      FOR EACH PENDING TASK     │◄────────┐
                 └────────────────────────────────┘         │
                              │                             │
                              ▼                             │
              ┌───────────────────────────────┐             │
              │ 1. PRE-HOOK: Memory Recall    │             │
              │    Query: memory/run.sh recall│             │
              │    Inject prior solutions     │             │
              └───────────────────────────────┘             │
                              │                             │
                              ▼                             │
              ┌───────────────────────────────┐             │
              │ 2. EXECUTE TASK               │             │
              │    pi --mode json -p          │             │
              │    --no-session               │             │
              │    --provider <provider>      │             │
              │    --model <model>            │             │
              └───────────────────────────────┘             │
                              │                             │
                              ▼                             │
              ┌───────────────────────────────┐             │
              │ 3. POST-HOOK: Quality Gate    │             │
              │    Run: quality-gate.sh       │             │
              │    Tests must pass            │             │
              └───────────────────────────────┘             │
                     │                │                     │
                   PASS             FAIL                    │
                     │                │                     │
                     ▼                ▼                     │
          ┌──────────────┐   ┌──────────────┐              │
          │ Update [ ]   │   │ STOP or      │              │
          │ to [x]       │   │ continue     │              │
          └──────────────┘   │ (if flag set)│              │
                  │          └──────────────┘              │
                  │                                        │
                  └────────── More tasks? ─────────────────┘
                                      │
                                     NO
                                      │
                                      ▼
              ┌───────────────────────────────┐
              │  Archive to Episodic Memory   │
              │  (if archive=true)            │
              └───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION COMPLETE                      │
└─────────────────────────────────────────────────────────────────┘
```

## Protected Context

Each task runs in **protected context** using:
- `--mode json` - JSONL output for parsing
- `-p` - Non-interactive mode
- `--no-session` - No persistent session state

This prevents sub-agents from affecting the orchestrator's state.

## Example Session

```
$ pi
> Orchestrate 01_TASKS.md

Checking for unresolved questions... None found.

Running Task 1/3: Implement feature X (general-purpose)
  [Memory recall] Found 2 prior solutions
  [Executing] ...
  [Quality gate] PASSED

Running Task 2/3: Add tests for feature X (general-purpose)
  [Memory recall] No prior solutions found
  [Executing] ...
  [Quality gate] PASSED

Running Task 3/3: Update documentation (general-purpose)
  [Memory recall] Found 1 prior solution
  [Executing] ...
  [Quality gate] PASSED

Orchestration completed: 3/3 tasks
Session archived to episodic memory.
```

## Limitations

| Feature | Status |
|---------|--------|
| Parallel task execution | Not supported (sequential only) |
| Task rollback on failure | Not implemented |
| Interactive task approval | Not supported |
| Cross-file dependencies | Not supported |
