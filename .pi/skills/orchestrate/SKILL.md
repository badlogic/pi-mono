---
name: orchestrate
description: >
  Orchestrate tasks from a 0N_TASKS.md file with enforced memory-first pre-hooks,
  quality-gate post-hooks, and session archiving. BLOCKS if unresolved questions exist.
  Use when user says "run the tasks", "execute the task file", or "orchestrate".
allowed-tools: Bash, Read, orchestrate
triggers:
  - orchestrate
  - run the tasks
  - execute the task file
  - run 0N_TASKS
  - execute tasks.md
  - run each task
  - start the task list
metadata:
  short-description: Execute task list with enforced hooks (memory recall + quality gate)
---

# Task Orchestration Skill

Execute tasks from a collaborative **task file** (e.g., `0N_TASKS.md`) with **enforced** hooks:

- **Questions/Blockers Gate**: BLOCKS execution if unresolved questions exist
- **Memory-first Pre-hook**: Queries memory BEFORE each task (not optional)
- **Quality-gate Post-hook**: Runs tests AFTER each task (must pass)
- **Session Archiving**: Stores completed session for future recall

## The Collaborative Workflow

```mermaid
flowchart TB
    subgraph Phase1["PHASE 1: Collaborate on Task File"]
        H1[Human: I need to refactor auth] --> A1[Agent creates 0N_TASKS.md]
        A1 --> Q1["## Questions/Blockers<br/>- Which auth method?<br/>- Backwards compat?"]
        Q1 --> H2[Human answers questions]
        H2 --> Q2["Questions resolved → None"]
    end

    subgraph Phase2["PHASE 2: Execute via orchestrate tool"]
        O1["orchestrate({ taskFile })"] --> Check{Questions<br/>exist?}
        Check -->|Yes| Block[BLOCKED - Clarify first]
        Check -->|No| Loop["For each task:"]
        Loop --> Pre["PRE-HOOK: memory recall"]
        Pre --> Exec["Execute: pi --no-session"]
        Exec --> Post["POST-HOOK: quality-gate.sh"]
        Post --> Pass{Tests<br/>pass?}
        Pass -->|Yes| Update["Update: [ ] → [x]"]
        Pass -->|No| Fail[Task FAILED]
        Update --> Next{More<br/>tasks?}
        Next -->|Yes| Loop
        Next -->|No| Done[All complete]
    end

    subgraph Phase3["PHASE 3: Archive"]
        Archive["episodic-archiver<br/>→ Future recall enabled"]
    end

    Phase1 --> Phase2
    Done --> Phase3
```

## Critical: Questions/Blockers Section

The orchestrator **BLOCKS** execution if unresolved questions exist:

```markdown
## Questions/Blockers
- Which database should we use? (blocks Task 3)
- Do we need backwards compatibility?
```

**To proceed**: Answer the questions and either:
- Remove the items
- Change to "None" or "N/A"

This forces collaborative clarification BEFORE coding starts.

## Task File Format: 0N_TASKS.md

```markdown
# Task List: <Project/Feature Name>

## Context
<Brief description of what we're trying to accomplish>

## Tasks

- [ ] **Task 1**: <Clear, actionable description>
  - Agent: general-purpose
  - Dependencies: none
  - Notes: <any context>

- [ ] **Task 2**: <Description>
  - Agent: general-purpose
  - Dependencies: Task 1
  - Notes: <context>

- [ ] **Task 3**: <Description>
  - Agent: explore
  - Dependencies: none

## Completion Criteria
<How do we know we're done?>

## Questions/Blockers
None - all questions resolved.
```

## The orchestrate Tool

### Basic Usage

```typescript
orchestrate({
  taskFile: "01_TASKS.md",      // Path to task file
  continueOnError: false,        // Stop on first failure (default)
  archive: true,                 // Archive on completion (default)
  taskTimeoutMs: 1800000         // 30 min per task (default)
})
```

### What Happens

1. **Parse**: Read and validate task file
2. **Block Check**: STOP if Questions/Blockers section has items
3. **For Each Task**:
   - **PRE-HOOK**: `~/.pi/agent/skills/memory/run.sh recall --q "<task>"`
     - If solutions found → injected as context in task prompt
     - Agent decides how to use prior knowledge
   - **EXECUTE**: `pi --mode json -p --no-session "<task prompt>"`
     - Protected context, no session bleed
     - Agent config provides system prompt
   - **POST-HOOK**: `quality-gate.sh`
     - Auto-detects project (Python/Node/Go/Rust)
     - Runs tests/checks
     - Task FAILS if tests don't pass
   - **UPDATE**: Mark checkbox `[x]` in task file
4. **Archive**: Store session via episodic-archiver

### Memory Recall Context

When memory finds prior solutions, they're injected into the task prompt:

```markdown
## Memory Recall (Prior Solutions Found)

The following relevant solutions were found in memory. Review and adapt as needed:

1. **Problem**: OAuth token refresh failing silently
   **Solution**: Add explicit error handling in refreshToken(), log failures

---

## Context
...rest of task prompt...
```

The agent sees this context and decides whether to apply, adapt, or ignore it.

### Quality Gate Enforcement

After each task, `quality-gate.sh` runs:

```bash
# Auto-detects project type and runs:
# - Python: pytest -q -x
# - Node: npm test
# - Go: go test ./...
# - Rust: cargo check
# - Makefile: make test (or make smokes)
```

If tests fail:
- Task status = `failed`
- Error output included in results
- Orchestration stops (unless `continueOnError: true`)

## When to Use

| Trigger | Action |
|---------|--------|
| "Let's plan this" | Collaborate on task file (don't run yet) |
| "Run the tasks" | Execute via orchestrate tool |
| "Orchestrate 01_TASKS.md" | Execute specific file |
| Unresolved questions | BLOCKED - clarify first |

## Agent Selection

Specify agent per task in the task file:

| Agent | Use For |
|-------|---------|
| `general-purpose` | Code changes, bug fixes, implementation |
| `explore` | Research, code exploration, finding patterns |

Agent configs live at `~/.pi/agent/agents/<name>.md` with:
- Frontmatter: name, description, tools, model
- Body: System prompt with instructions

## Example Full Flow

```
User: "I need to fix the auth bug and add tests"

Agent: "I'll create a task file. First, some questions:
- Which auth system? OAuth, JWT, or session?
- Unit tests or integration tests?"

User: "OAuth, unit tests"

Agent: [Creates 01_TASKS.md]

# Task List: Fix OAuth Auth Bug

## Context
Fix the OAuth token refresh bug and add unit tests.

## Tasks
- [ ] **Task 1**: Investigate OAuth token refresh failure
  - Agent: explore
  - Dependencies: none

- [ ] **Task 2**: Fix the token refresh logic
  - Agent: general-purpose
  - Dependencies: Task 1

- [ ] **Task 3**: Add unit tests for token refresh
  - Agent: general-purpose
  - Dependencies: Task 2

## Questions/Blockers
None - resolved above.

User: "Run the tasks"

Agent: [Calls orchestrate({ taskFile: "01_TASKS.md" })]

→ Task 1: Memory recall finds prior OAuth issues, injects context
          Explore agent investigates, reports findings
          Quality gate: N/A for explore (no code changes)
          ✓ Complete

→ Task 2: Memory recall provides solutions from Task 1
          General-purpose fixes the bug
          Quality gate: pytest runs, all tests pass
          ✓ Complete

→ Task 3: Memory recall finds test patterns
          General-purpose adds tests
          Quality gate: pytest runs, new tests pass
          ✓ Complete

→ Archive: Session stored to episodic memory

"All 3 tasks complete. Session archived for future recall."
```

## Key Principles

1. **Clarify FIRST** - Questions/Blockers section forces this
2. **Memory BEFORE** - Pre-hook always runs, provides context
3. **Quality AFTER** - Post-hook always runs, tests must pass
4. **Isolated Context** - Each task runs in `--no-session` mode
5. **Archive at End** - Enables future recall of solutions
