# Orchestrate Tool

Execute tasks from collaborative task files (e.g., `01_TASKS.md`) with memory-first approach, quality gates, and session archiving.

## Overview

The orchestrate tool implements a **Memory-First Task Agent Architecture** with features consolidated from `tasks_loop`:

1. **Questions/Blockers Gate** - BLOCKS execution if unresolved questions exist
2. **Memory Recall Pre-Hook** - Queries memory for prior solutions before each task
3. **Quality Gate Post-Hook** - Runs tests after each task (must pass to continue)
4. **Retry-Until-Pass Mode** - Iteratively fixes failures with agent assistance
5. **Self-Review** - Agent reviews its own work before marking complete
6. **CLARIFY Handling** - Exit code 42 stops execution for human intervention
7. **Checkbox Updates** - Marks tasks `[x]` in the file upon completion
8. **Session Archiving** - Archives to episodic memory on completion
9. **Full Output Logging** - Complete task outputs saved to `/tmp/pi-orchestrate-*/`
10. **Pause/Resume** - State persistence allows resuming interrupted orchestrations

## Platform Support

**Supported Platforms**: macOS and Linux

**Requirements**:
- `pgrep` command (pre-installed on macOS/Linux)
- Task-monitor process running (MANDATORY - see below)

**Windows**: Not currently supported. The task-monitor enforcement relies on `pgrep`, which is not available on Windows. Windows support can be added in the future using PowerShell-based process detection.

**Development Override**: Set `ORCHESTRATE_SKIP_MONITOR_CHECK=1` to bypass task-monitor check for testing/development.

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

### Standard Execution Mode

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

### Retry-Until-Pass Mode (from tasks_loop)

For tasks that need iterative fixing until a gate passes:

```markdown
- [ ] **Task 3**: Make gate_s05 pass
  - Agent: general-purpose
  - Mode: retry-until-pass
  - Gate: gates/gate_s05.py
  - MaxRetries: 5
  - SelfReview: true
  - Notes: Fix extraction issues
```

### Task Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `Task N` | Yes | Task ID and title |
| `Agent` | No | Agent config to use (default: `general-purpose`) |
| `Dependencies` | No | Task IDs that must complete first |
| `Notes` | No | Additional context for the agent |
| `Mode` | No | `execute` (default) or `retry-until-pass` |
| `Gate` | No | Path to gate script (required for retry-until-pass) |
| `MaxRetries` | No | Max retry attempts (default: 3) |
| `SelfReview` | No | Run self-review before completion (default: false) |

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

### Task File Mode (default)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `taskFile` | string | - | Path to task file (required unless using direct mode) |
| `continueOnError` | boolean | false | Continue if a task fails |
| `archive` | boolean | true | Archive session on completion |
| `taskTimeoutMs` | number | 1800000 | Timeout per task (30 min) |

### Direct Mode Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `gate` | string | - | Path to gate script (triggers direct mode) |
| `maxRetries` | number | 3 | Max retry attempts |
| `selfReview` | boolean | false | Run self-review before completion |
| `agent` | string | "general-purpose" | Agent config to use |
| `prompt` | string | - | Task description for the agent |

### Pause/Resume Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `resume` | string | Resume a paused session by ID, or `"list"` to see all paused sessions |

## Execution Modes

### Standard Execution (Task File)

Default mode. Runs tasks from a file with memory recall pre-hook and quality gate post-hook.

### Direct Mode

For simple single-gate workflows without creating a task file:

```
orchestrate({ gate: "gates/gate_s05.py", maxRetries: 5, selfReview: true })
```

Or via natural language:
```
Run the gate gates/gate_s05.py until it passes
```

Direct mode creates a synthetic retry-until-pass task and runs it.

### Retry-Until-Pass Mode (in Task Files)

When `Mode: retry-until-pass` is set in a task file:

1. Initial task execution
2. Run the gate script
3. If gate fails:
   - Feed failure output (last 160 lines) to agent
   - Agent makes minimal fix
   - Retry gate
4. Repeat until pass or max retries
5. Optional self-review before completion

**Gate Exit Codes:**

| Code | Meaning | Action |
|------|---------|--------|
| 0 | PASS | Task complete |
| 1 | FAIL | Retry with agent fix |
| 42 | CLARIFY | Stop - human intervention required |

## Features

### Memory Recall Pre-Hook

Before each task, queries `~/.pi/agent/skills/memory/run.sh recall` with the task context. Found solutions are injected into the task prompt.

### Quality Gate Post-Hook

After each task, runs the quality gate script. If tests fail, the task is marked failed and orchestration stops (unless `continueOnError` is true).

Configure in: `/home/graham/workspace/experiments/memory/.claude/hooks/quality-gate.sh`

### Self-Review

When `SelfReview: true` is set, the agent reviews its own work before marking complete:

1. Reviews recent git changes
2. Checks: minimal change? obvious issues? root cause addressed?
3. If issues found, agent fixes them
4. Up to 3 review cycles

### Full Output Logging

All task outputs are written to `/tmp/pi-orchestrate-{uuid}/`:
- `task-{id}.log` - Complete JSONL output (not truncated)
- `task-{id}-fix-attempt-{n}.log` - Fix attempt logs (retry-until-pass mode)
- `task-{id}-self-review-{n}.log` - Self-review logs

The output directory path is included in the orchestration summary.

### Pause/Resume (State Persistence)

Orchestration state is persisted to `.orchestrate/<session-id>.state.json` in the project directory. This enables:

1. **Automatic pause on abort** - If orchestration is interrupted (Ctrl+C, timeout, etc.), state is saved
2. **Resume from last checkpoint** - Continue from where you left off
3. **Session listing** - View all paused sessions
4. **Progress preservation** - Completed tasks don't need to re-run

**State File Location:** `.orchestrate/<session-id>.state.json`

**Listing Paused Sessions:**
```
orchestrate({ resume: "list" })
```

**Resuming a Session:**
```
orchestrate({ resume: "abc12345" })
```

**Starting Fresh (ignoring paused state):**
Delete the state file first: `rm .orchestrate/<session-id>.state.json`

**Auto-detection:** When starting orchestration for a task file that has a paused session, you'll be prompted to resume or start fresh.

**State Cleanup:** State files are automatically deleted when orchestration completes (success or failure). Only paused sessions retain their state files.

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
               ┌──────────────┴──────────────┐              │
               │                             │              │
          Standard Mode              Retry-Until-Pass       │
               │                             │              │
               ▼                             ▼              │
   ┌─────────────────────┐     ┌─────────────────────┐     │
   │ 1. Memory Recall    │     │ 1. Memory Recall    │     │
   │ 2. Execute Task     │     │ 2. Execute Task     │     │
   │ 3. Quality Gate     │     │ 3. Run Gate         │     │
   │ 4. Self-Review?     │     │ 4. If FAIL: Fix →   │──┐  │
   └─────────────────────┘     │    Retry gate       │  │  │
               │               │ 5. Self-Review?     │  │  │
               │               └─────────────────────┘  │  │
               │                         │              │  │
               │                    ◄────┘ (retry)      │  │
               │                         │              │  │
               └──────────┬──────────────┘              │  │
                          │                             │  │
                     PASS │ FAIL                        │  │
                          │                             │  │
                          ▼                             │  │
               ┌──────────────────┐                     │  │
               │ Update checkbox  │                     │  │
               │ [ ] → [x]        │                     │  │
               └──────────────────┘                     │  │
                          │                             │  │
                          └─────────── More tasks? ─────┘  │
                                             │             │
                                            NO             │
                                             │             │
                                             ▼             │
                          ┌───────────────────────────────┐
                          │  Archive to Episodic Memory   │
                          │  (if archive=true)            │
                          └───────────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION COMPLETE                      │
│         Full outputs: /tmp/pi-orchestrate-{uuid}/               │
└─────────────────────────────────────────────────────────────────┘
```

## Protected Context

Each task runs in **protected context** using:
- `--mode json` - JSONL output for parsing
- `-p` - Non-interactive mode
- `--no-session` - No persistent session state

This prevents sub-agents from affecting the orchestrator's state.

## Example Session

### Standard Mode

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

Orchestration completed: 2/2 tasks
Full task outputs: /tmp/pi-orchestrate-abc123/
```

### Retry-Until-Pass Mode (Task File)

```
$ pi
> Orchestrate 01_TASKS.md

Running Task 1/1: Make gate_s05 pass (general-purpose)
  [Initial execution] ...
  [Gate attempt 1] FAIL (exit 1)
  [Fix attempt 1] Agent fixing...
  [Gate attempt 2] FAIL (exit 1)
  [Fix attempt 2] Agent fixing...
  [Gate attempt 3] PASS
  [Self-review] No issues found.

Orchestration completed: 1/1 tasks
Full task outputs: /tmp/pi-orchestrate-xyz789/
```

### Direct Mode (No Task File)

```
$ pi
> Run the gate gates/gate_s05.py until it passes with 5 retries

Running gate: gates/gate_s05.py
  [Gate attempt 1] FAIL (exit 1)
  [Fix attempt 1] Agent fixing...
  [Gate attempt 2] FAIL (exit 1)
  [Fix attempt 2] Agent fixing...
  [Gate attempt 3] PASS

Direct mode completed
Gate: gates/gate_s05.py
Result: success [2m34s]
Full output: /tmp/pi-orchestrate-direct-abc123/
```

### Pause/Resume

```
$ pi
> Orchestrate 01_TASKS.md

Running Task 1/3: Implement feature X (general-purpose)
  [Executing] ...
  [Quality gate] PASSED

Running Task 2/3: Add tests for feature X (general-purpose)
  [Executing] ...
^C   <-- User interrupts

Orchestration paused.

Session ID: a1b2c3d4
Completed: 1/3 tasks

To resume: orchestrate({ resume: "a1b2c3d4" })
To list paused sessions: orchestrate({ resume: "list" })
```

Later, resume:
```
$ pi
> Resume the paused orchestration

Resuming session a1b2c3d4...

Running Task 2/3: Add tests for feature X (general-purpose)
  [Executing] ...
  [Quality gate] PASSED

Running Task 3/3: Update documentation (general-purpose)
  [Executing] ...
  [Quality gate] PASSED

Orchestration completed: 3/3 tasks
Full task outputs: /tmp/pi-orchestrate-abc123/
```

List paused sessions:
```
$ pi
> List paused orchestration sessions

## Paused Orchestration Sessions

- **a1b2c3d4**
  File: 01_TASKS.md
  Paused: 1/16/2026, 10:30:00 AM
  Progress: 1/3 tasks

- **e5f6g7h8**
  File: 02_REFACTOR.md
  Paused: 1/15/2026, 3:45:00 PM
  Progress: 4/7 tasks

To resume, use: orchestrate({ resume: "<session-id>" })
```

## Comparison: orchestrate vs tasks_loop

The orchestrate tool consolidates features from `tasks_loop`:

| Feature | tasks_loop | orchestrate |
|---------|-----------|-------------|
| Single gate retry loop | Core feature | Via `gate` param (direct mode) |
| No task file needed | Yes | Yes (direct mode) |
| Multi-task orchestration | Not supported | Core feature |
| Task dependencies | Not supported | Supported |
| Memory recall pre-hook | Not supported | Supported |
| Quality gate post-hook | Gate is the check | Both gate and quality-gate |
| Self-review | Supported | Supported via `selfReview` param |
| CLARIFY exit code | Supported (42) | Supported (42) |
| Artifacts per attempt | ./artifacts/ | /tmp/pi-orchestrate-*/ |
| Context.md recovery | Supported | Via memory recall |
| Session archiving | Not supported | Supported |
| Pause/Resume | Not supported | Supported via state persistence |

**Direct mode fully replaces tasks_loop functionality** while also supporting the richer task-file-based workflows.

## Limitations

| Feature | Status |
|---------|--------|
| Parallel task execution | Not supported (sequential only) |
| Task rollback on failure | Not implemented |
| Interactive task approval | Not supported |
| Cross-file dependencies | Not supported |
