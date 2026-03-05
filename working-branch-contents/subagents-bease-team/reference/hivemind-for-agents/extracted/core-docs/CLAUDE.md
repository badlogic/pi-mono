# Claude Code Configuration - Ruflo v3.5

> **Ruflo v3.5** (2026-02-27) — First major stable release. Formerly "Claude Flow".
> 5,800+ commits, 55 alpha iterations, 215 MCP tools, 60+ agents, 8 AgentDB controllers.
> Packages: `@claude-flow/cli@3.5.0`, `claude-flow@3.5.0`, `ruflo@3.5.0`

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Key Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@claude-flow/cli` | `v3/@claude-flow/cli/` | CLI entry point (26 commands) |
| `@claude-flow/codex` | `v3/@claude-flow/codex/` | Dual-mode Claude + Codex collaboration |
| `@claude-flow/guidance` | `v3/@claude-flow/guidance/` | Governance control plane |
| `@claude-flow/hooks` | `v3/@claude-flow/hooks/` | 17 hooks + 12 workers |
| `@claude-flow/memory` | `v3/@claude-flow/memory/` | AgentDB + HNSW search |
| `@claude-flow/security` | `v3/@claude-flow/security/` | Input validation, CVE remediation |

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP

**Mandatory patterns:**
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL terminal operations in ONE Bash message
- ALWAYS batch ALL memory store/retrieve operations in ONE message

---

## Swarm Orchestration

- MUST initialize the swarm using MCP tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use MCP tools alone for execution — Task tool agents do the actual work

### MCP + Task Tool in SAME Message

- MUST call MCP tools AND Task tool in ONE message for complex work
- Always call MCP first, then IMMEDIATELY call Task tool to spawn agents

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types, etc.) — **Skip LLM entirely** |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Always check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]` — intent types: `var-to-const`, `add-types`, `add-error-handling`, `async-await`, `add-logging`, `remove-console`

## Swarm Configuration & Anti-Drift

### Anti-Drift Coding Swarm (PREFERRED DEFAULT)

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use `raft` consensus for hive-mind (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents
- Keep task cycles short with verification gates

```javascript
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})
```

## Dual-Mode Collaboration (Claude Code + Codex)

This repository uses **dual-mode orchestration** to run Claude Code (🔵) and OpenAI Codex (🟢) workers in parallel with shared memory coordination. Both platforms collaborate on development tasks with cross-learning.

### Why Dual-Mode?

| Single Platform | Dual-Mode Collaboration |
|----------------|------------------------|
| One model's perspective | Two AI platforms cross-validating |
| Limited reasoning styles | Complementary strengths |
| No external verification | Built-in code review |
| Sequential workflows | Parallel execution |

### Dual-Mode Swarm Protocol

For complex tasks, spawn both Claude and Codex workers in parallel:

```javascript
// STEP 1: Initialize dual-mode swarm
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// STEP 2: Spawn BOTH platforms in parallel via Task tool
// 🔵 Claude Code workers (architecture, security, testing)
Task("Architect", "Design the implementation. Store design in memory namespace 'collaboration'.", "system-architect")
Task("Tester", "Write tests based on architect's design. Read from 'collaboration' namespace.", "tester")
Task("Reviewer", "Review code quality and security. Store findings in 'collaboration'.", "reviewer")

// 🟢 Codex workers (implementation, optimization)
// Spawn via CLI for Codex platform
Bash("npx claude-flow-codex dual run --worker 'codex:coder:Implement the solution based on architect design' --namespace collaboration")
Bash("npx claude-flow-codex dual run --worker 'codex:optimizer:Optimize performance based on implementation' --namespace collaboration")

// STEP 3: Coordinate via shared memory
Bash("npx claude-flow@v3alpha memory store --namespace collaboration --key 'task-context' --value '[task description]'")
```

### Collaboration Templates (Pre-Built Pipelines)

| Template | Workers | Pipeline |
|----------|---------|----------|
| `feature` | 🔵 Architect → 🟢 Coder → 🔵 Tester → 🟢 Reviewer | Full feature development |
| `security` | 🔵 Analyst → 🟢 Scanner → 🔵 Reporter | Security audit workflow |
| `refactor` | 🔵 Architect → 🟢 Refactorer → 🔵 Tester | Code modernization |
| `bugfix` | 🔵 Researcher → 🟢 Coder → 🔵 Tester | Bug investigation & fix |

### Dual-Mode CLI Commands

```bash
# Run a collaboration template
npx claude-flow-codex dual run feature --task "Add user authentication with OAuth"
npx claude-flow-codex dual run security --target "./src"
npx claude-flow-codex dual run refactor --target "./src/legacy"

# Custom multi-platform swarm
npx claude-flow-codex dual run \
  --worker "claude:architect:Design the API structure" \
  --worker "codex:coder:Implement REST endpoints" \
  --worker "claude:tester:Write integration tests" \
  --worker "codex:reviewer:Review code quality" \
  --namespace "api-feature"

# Check collaboration status
npx claude-flow-codex dual status

# List available templates
npx claude-flow-codex dual templates
```

### Shared Memory Coordination

All workers share state via the `collaboration` namespace:

```bash
# Store context for cross-platform sharing
npx claude-flow@v3alpha memory store --namespace collaboration --key "design-decisions" --value "..."

# Search for patterns across all workers
npx claude-flow@v3alpha memory search --namespace collaboration --query "authentication patterns"

# Retrieve specific findings
npx claude-flow@v3alpha memory retrieve --namespace collaboration --key "security-findings"
```

### Cross-Platform Learning

Both platforms learn from each other's outputs:

```bash
# After successful collaboration, train patterns
npx claude-flow@v3alpha hooks post-task --task-id "dual-[id]" --success true --train-neural true

# Store successful collaboration patterns
npx claude-flow@v3alpha memory store --namespace patterns --key "dual-mode-[pattern]" --value "[what worked]"

# Transfer learnings to both platforms
npx claude-flow@v3alpha hooks transfer store --pattern "dual-collab-success"
```

### Worker Dependency Levels

Workers execute in dependency order:

```
Level 0: [🔵 Architect]           # No dependencies - runs first
Level 1: [🟢 Coder, 🔵 Tester]    # Depends on Architect
Level 2: [🔵 Reviewer]            # Depends on Coder + Tester
Level 3: [🟢 Optimizer]           # Depends on Reviewer approval
```

### Platform Strengths

| Task Type | Preferred Platform | Reason |
|-----------|-------------------|--------|
| Architecture & Design | 🔵 Claude | Strong reasoning, system thinking |
| Implementation | 🟢 Codex | Fast code generation |
| Security Review | 🔵 Claude | Careful analysis, threat modeling |
| Performance Optimization | 🟢 Codex | Code-level optimizations |
| Testing Strategy | 🔵 Claude | Coverage analysis, edge cases |
| Refactoring | 🟢 Codex | Bulk code transformations |

### Programmatic API

```typescript
import { DualModeOrchestrator, CollaborationTemplates } from '@claude-flow/codex';

const orchestrator = new DualModeOrchestrator({
  namespace: 'my-feature',
  memoryBackend: 'hybrid'
});

// Use pre-built template
const workers = CollaborationTemplates.featureDevelopment('Add OAuth login');

// Run collaboration
const results = await orchestrator.runCollaboration(workers, 'Implement OAuth feature');

// Access shared memory
const designDocs = await orchestrator.getMemory('design-decisions');
```

---

## Swarm Protocols & Routing

### Auto-Start Swarm Protocol

When the user requests a complex task (multi-file changes, feature implementation, refactoring), **immediately execute this pattern in a SINGLE message:**

```javascript
// STEP 1: Initialize swarm coordination via MCP (in parallel with agent spawning)
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// STEP 2: Spawn agents concurrently using Claude Code's Task tool
// ALL Task calls MUST be in the SAME message for parallel execution
Task("Coordinator", "You are the swarm coordinator. Initialize session, coordinate other agents via memory. Run: npx claude-flow@v3alpha hooks session-start", "hierarchical-coordinator")
Task("Researcher", "Analyze requirements and existing code patterns. Store findings in memory via hooks.", "researcher")
Task("Architect", "Design implementation approach based on research. Document decisions in memory.", "system-architect")
Task("Coder", "Implement the solution following architect's design. Coordinate via hooks.", "coder")
Task("Tester", "Write tests for the implementation. Report coverage via hooks.", "tester")
Task("Reviewer", "Review code quality and security. Document findings.", "reviewer")

// STEP 3: Batch all todos
TodoWrite({ todos: [
  {content: "Initialize swarm coordination", status: "in_progress", activeForm: "Initializing swarm"},
  {content: "Research and analyze requirements", status: "in_progress", activeForm: "Researching requirements"},
  {content: "Design architecture", status: "pending", activeForm: "Designing architecture"},
  {content: "Implement solution", status: "pending", activeForm: "Implementing solution"},
  {content: "Write tests", status: "pending", activeForm: "Writing tests"},
  {content: "Review and finalize", status: "pending", activeForm: "Reviewing code"}
]})

// STEP 4: Store swarm state in memory
mcp__claude-flow__memory_usage({
  action: "store",
  namespace: "swarm",
  key: "current-session",
  value: JSON.stringify({task: "[user's task]", agents: 6, startedAt: new Date().toISOString()})
})
```

### Agent Routing (Anti-Drift)

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |
| 11 | Memory | coordinator, memory-specialist, perf-engineer |
| 13 | Docs | researcher, api-docs |

**Codes 1-11: hierarchical/specialized (anti-drift). Code 13: mesh/balanced**

### Task Complexity Detection

**AUTO-INVOKE SWARM when task involves:**
- Multiple files (3+)
- New feature implementation
- Refactoring across modules
- API changes with tests
- Security-related changes
- Performance optimization
- Database schema changes

**SKIP SWARM for:**
- Single file edits
- Simple bug fixes (1-2 lines)
- Documentation updates
- Configuration changes
- Quick questions/exploration

## Project Configuration

This project is configured with Claude Flow V3 (Anti-Drift Defaults):
- **Topology**: hierarchical (prevents drift via central coordination)
- **Max Agents**: 8 (smaller team = less drift)
- **Strategy**: specialized (clear roles, no overlap)
- **Consensus**: raft (leader maintains authoritative state)
- **Memory Backend**: hybrid (SQLite + AgentDB)
- **HNSW Indexing**: Enabled (150x-12,500x faster)
- **Neural Learning**: Enabled (SONA)

## V3 CLI Commands (26 Commands, 140+ Subcommands)

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization with wizard, presets, skills, hooks |
| `agent` | 8 | Agent lifecycle (spawn, list, status, stop, metrics, pool, health, logs) |
| `swarm` | 6 | Multi-agent swarm coordination and orchestration |
| `memory` | 11 | AgentDB memory with vector search (150x-12,500x faster) |
| `mcp` | 9 | MCP server management and tool execution |
| `task` | 6 | Task creation, assignment, and lifecycle |
| `session` | 7 | Session state management and persistence |
| `config` | 7 | Configuration management and provider setup |
| `status` | 3 | System status monitoring with watch mode |
| `start` | 3 | Service startup and quick launch |
| `workflow` | 6 | Workflow execution and template management |
| `hooks` | 17 | Self-learning hooks + 12 background workers |
| `hive-mind` | 6 | Queen-led Byzantine fault-tolerant consensus |

### Advanced Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `daemon` | 5 | Background worker daemon (start, stop, status, trigger, enable) |
| `neural` | 5 | Neural pattern training (train, status, patterns, predict, optimize) |
| `security` | 6 | Security scanning (scan, audit, cve, threats, validate, report) |
| `performance` | 5 | Performance profiling (benchmark, profile, metrics, optimize, report) |
| `providers` | 5 | AI providers (list, add, remove, test, configure) |
| `plugins` | 5 | Plugin management (list, install, uninstall, enable, disable) |
| `deployment` | 5 | Deployment management (deploy, rollback, status, environments, release) |
| `embeddings` | 4 | Vector embeddings (embed, batch, search, init) - 75x faster with agentic-flow |
| `claims` | 4 | Claims-based authorization (check, grant, revoke, list) |
| `migrate` | 5 | V2 to V3 migration with rollback support |
| `process` | 4 | Background process management |
| `doctor` | 1 | System diagnostics with health checks |
| `completions` | 4 | Shell completions (bash, zsh, fish, powershell) |

### Quick CLI Examples

```bash
# Initialize project
npx claude-flow@v3alpha init --wizard

# Start daemon with background workers
npx claude-flow@v3alpha daemon start

# Spawn an agent
npx claude-flow@v3alpha agent spawn -t coder --name my-coder

# Initialize swarm
npx claude-flow@v3alpha swarm init --v3-mode

# Search memory (HNSW-indexed)
npx claude-flow@v3alpha memory search -q "authentication patterns"

# System diagnostics
npx claude-flow@v3alpha doctor --fix

# Security scan
npx claude-flow@v3alpha security scan --depth full

# Performance benchmark
npx claude-flow@v3alpha performance benchmark --suite all
```

## Headless Background Instances (claude -p)

Use `claude -p` (print/pipe mode) to spawn headless Claude instances for parallel background work. These run non-interactively and return results to stdout.

### Basic Usage

```bash
# Single headless task
claude -p "Analyze the authentication module for security issues"

# With model selection
claude -p --model haiku "Format this config file"
claude -p --model opus "Design the database schema for user management"

# With output format
claude -p --output-format json "List all TODO comments in src/"
claude -p --output-format stream-json "Refactor the error handling in api.ts"

# With budget limits
claude -p --max-budget-usd 0.50 "Run comprehensive security audit"

# With specific tools allowed
claude -p --allowedTools "Read,Grep,Glob" "Find all files that import the auth module"

# Skip permissions (sandboxed environments only)
claude -p --dangerously-skip-permissions "Fix all lint errors in src/"
```

### Parallel Background Execution

```bash
# Spawn multiple headless instances in parallel
claude -p "Analyze src/auth/ for vulnerabilities" &
claude -p "Write tests for src/api/endpoints.ts" &
claude -p "Review src/models/ for performance issues" &
wait  # Wait for all to complete

# With results captured
SECURITY=$(claude -p "Security audit of auth module" &)
TESTS=$(claude -p "Generate test coverage report" &)
PERF=$(claude -p "Profile memory usage in workers" &)
wait
echo "$SECURITY" "$TESTS" "$PERF"
```

### Session Continuation

```bash
# Start a task, resume later
claude -p --session-id "abc-123" "Start analyzing the codebase"
claude -p --resume "abc-123" "Continue with the test files"

# Fork a session for parallel exploration
claude -p --resume "abc-123" --fork-session "Try approach A: event sourcing"
claude -p --resume "abc-123" --fork-session "Try approach B: CQRS pattern"
```

### Key Flags

| Flag | Purpose |
|------|---------|
| `-p, --print` | Non-interactive mode, print and exit |
| `--model <model>` | Select model (haiku, sonnet, opus) |
| `--output-format <fmt>` | Output: text, json, stream-json |
| `--max-budget-usd <amt>` | Spending cap per invocation |
| `--allowedTools <tools>` | Restrict available tools |
| `--append-system-prompt` | Add custom instructions |
| `--resume <id>` | Continue a previous session |
| `--fork-session` | Branch from resumed session |
| `--fallback-model <model>` | Auto-fallback if primary overloaded |
| `--permission-mode <mode>` | acceptEdits, bypassPermissions, plan, etc. |
| `--mcp-config <json>` | Load MCP servers from JSON |

## Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### V3 Specialized Agents
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### @claude-flow/security Module
CVE remediation, input validation, path security:
- `InputValidator` — Zod-based validation at boundaries
- `PathValidator` — Path traversal prevention
- `SafeExecutor` — Command injection protection
- `PasswordHasher` — bcrypt hashing
- `TokenGenerator` — Secure token generation

### Token Optimizer (Agent Booster)
Integrates agentic-flow optimizations for 30-50% token reduction:
```typescript
import { getTokenOptimizer } from '@claude-flow/integration';
const optimizer = await getTokenOptimizer();

// Compact context (32% fewer tokens)
const ctx = await optimizer.getCompactContext("auth patterns");

// 352x faster edits = fewer retries
await optimizer.optimizedEdit(file, old, new, "typescript");

// Optimal config (100% success rate)
const config = optimizer.getOptimalConfig(agentCount);
```
| Feature | Token Savings |
|---------|---------------|
| ReasoningBank retrieval | -32% |
| Agent Booster edits | -15% |
| Cache (95% hit rate) | -10% |
| Optimal batch size | -20% |

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`, `swarm-memory-manager`

### Consensus & Distributed
`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `consensus-builder`, `crdt-synchronizer`, `quorum-manager`, `security-manager`

### Performance & Optimization
`perf-analyzer`, `performance-benchmarker`, `task-orchestrator`, `memory-coordinator`, `smart-agent`

### GitHub & Repository
`github-modes`, `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`, `workflow-automation`, `project-board-sync`, `repo-architect`, `multi-repo-swarm`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`, `refinement`

### Specialized Development
`backend-dev`, `mobile-dev`, `ml-developer`, `cicd-engineer`, `api-docs`, `system-architect`, `code-analyzer`, `base-template-generator`

### Testing & Validation
`tdd-london-swarm`, `production-validator`

## Agent Teams (Multi-Agent Coordination)

Claude Code's experimental Agent Teams feature is fully integrated with Claude Flow for advanced multi-agent coordination.

### Enabling Agent Teams

Agent Teams is automatically enabled when you run `npx claude-flow@v3alpha init`. The following is added to `.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "claudeFlow": {
    "agentTeams": {
      "enabled": true,
      "teammateMode": "auto",
      "taskListEnabled": true,
      "mailboxEnabled": true
    }
  }
}
```

### Agent Teams Components

| Component | Tool | Purpose |
|-----------|------|---------|
| **Team Lead** | You (main Claude) | Coordinates teammates, assigns tasks, reviews results |
| **Teammates** | `Task` tool | Sub-agents spawned to work on specific tasks |
| **Task List** | `TaskCreate/TaskList/TaskUpdate` | Shared todo list visible to all team members |
| **Mailbox** | `SendMessage` | Inter-agent messaging for coordination |

### Creating and Managing Teams

```javascript
// Create a team
TeamCreate({
  team_name: "feature-dev",
  description: "Building new feature",
  agent_type: "coordinator"
})

// Create shared tasks
TaskCreate({ subject: "Design API", description: "...", activeForm: "Designing" })
TaskCreate({ subject: "Implement endpoints", description: "...", activeForm: "Implementing" })
TaskCreate({ subject: "Write tests", description: "...", activeForm: "Testing" })

// Spawn teammates (run in background for parallel work)
Task({
  prompt: "Design the API according to task #1...",
  subagent_type: "system-architect",
  team_name: "feature-dev",
  name: "architect",
  run_in_background: true
})
Task({
  prompt: "Implement endpoints from task #2...",
  subagent_type: "coder",
  team_name: "feature-dev",
  name: "developer",
  run_in_background: true
})
```

### Agent Teams Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `TeammateIdle` | Teammate finishes turn | Auto-assign pending tasks to idle teammates |
| `TaskCompleted` | Task marked complete | Train patterns from successful work, notify lead |

### Hook Commands

```bash
# Handle idle teammate (auto-assigns available tasks)
npx claude-flow@v3alpha hooks teammate-idle --auto-assign true

# Handle task completion (trains patterns, notifies lead)
npx claude-flow@v3alpha hooks task-completed -i task-123 --train-patterns true

# Check on team progress
TaskList

# Send message to teammate
SendMessage({
  type: "message",
  recipient: "developer",
  content: "Please prioritize the auth endpoint",
  summary: "Prioritize auth"
})

# Shutdown teammate gracefully
SendMessage({
  type: "shutdown_request",
  recipient: "developer",
  content: "Work complete, shutting down"
})
```

### Best Practices for Agent Teams

1. **Spawn teammates in background**: Use `run_in_background: true` for parallel work
2. **Create tasks first**: Use TaskCreate before spawning teammates so they have work
3. **Use descriptive names**: Name teammates by role (architect, developer, tester)
4. **Don't poll status**: Wait for teammates to message back or complete
5. **Graceful shutdown**: Always send shutdown_request before TeamDelete
6. **Clean up**: Use TeamDelete after all teammates have shut down

### Teammate Display Modes

| Mode | Description |
|------|-------------|
| `auto` | Automatically selects best mode for environment |
| `in-process` | Teammates run in same process (default for CI/background) |
| `tmux` | Split-pane display in terminal (requires tmux) |

## V3 Hooks System (17 Hooks + 12 Workers)

### Hook Categories

| Category | Hooks | Purpose |
|----------|-------|---------|
| **Core** | `pre-edit`, `post-edit`, `pre-command`, `post-command`, `pre-task`, `post-task` | Tool lifecycle |
| **Session** | `session-start`, `session-end`, `session-restore`, `notify` | Context management |
| **Intelligence** | `route`, `explain`, `pretrain`, `build-agents`, `transfer` | Neural learning |
| **Learning** | `intelligence` (trajectory-start/step/end, pattern-store/search, stats, attention) | Reinforcement |
| **Agent Teams** | `teammate-idle`, `task-completed` | Multi-agent coordination |

### 12 Background Workers

| Worker | Priority | Description |
|--------|----------|-------------|
| `ultralearn` | normal | Deep knowledge acquisition |
| `optimize` | high | Performance optimization |
| `consolidate` | low | Memory consolidation |
| `predict` | normal | Predictive preloading |
| `audit` | critical | Security analysis |
| `map` | normal | Codebase mapping |
| `preload` | low | Resource preloading |
| `deepdive` | normal | Deep code analysis |
| `document` | normal | Auto-documentation |
| `refactor` | normal | Refactoring suggestions |
| `benchmark` | normal | Performance benchmarking |
| `testgaps` | normal | Test coverage analysis |

### Essential Hook Commands

```bash
# Core hooks
npx claude-flow@v3alpha hooks pre-task --description "[task]"
npx claude-flow@v3alpha hooks post-task --task-id "[id]" --success true
npx claude-flow@v3alpha hooks post-edit --file "[file]" --train-patterns

# Session management
npx claude-flow@v3alpha hooks session-start --session-id "[id]"
npx claude-flow@v3alpha hooks session-end --export-metrics true
npx claude-flow@v3alpha hooks session-restore --session-id "[id]"

# Intelligence routing
npx claude-flow@v3alpha hooks route --task "[task]"
npx claude-flow@v3alpha hooks explain --topic "[topic]"

# Neural learning
npx claude-flow@v3alpha hooks pretrain --model-type moe --epochs 10
npx claude-flow@v3alpha hooks build-agents --agent-types coder,tester

# Background workers
npx claude-flow@v3alpha hooks worker list
npx claude-flow@v3alpha hooks worker dispatch --trigger audit
npx claude-flow@v3alpha hooks worker status
```

## Intelligence System (RuVector)

V3 includes the RuVector Intelligence System:
- **SONA**: Self-Optimizing Neural Architecture (<0.05ms adaptation)
- **MoE**: Mixture of Experts for specialized routing
- **HNSW**: 150x-12,500x faster pattern search
- **EWC++**: Elastic Weight Consolidation (prevents forgetting)
- **Flash Attention**: 2.49x-7.47x speedup

The 4-step intelligence pipeline:
1. **RETRIEVE** — Fetch relevant patterns via HNSW
2. **JUDGE** — Evaluate with verdicts (success/failure)
3. **DISTILL** — Extract key learnings via LoRA
4. **CONSOLIDATE** — Prevent catastrophic forgetting via EWC++

## Embeddings Package (v3.0.0-alpha.12)

Features:
- **sql.js**: Cross-platform SQLite persistent cache (WASM, no native compilation)
- **Document chunking**: Configurable overlap and size
- **Normalization**: L2, L1, min-max, z-score
- **Hyperbolic embeddings**: Poincare ball model for hierarchical data
- **75x faster**: With agentic-flow ONNX integration
- **Neural substrate**: Integration with RuVector

## Hive-Mind Consensus

### Topologies
- `hierarchical` — Queen controls workers directly
- `mesh` — Fully connected peer network
- `hierarchical-mesh` — Hybrid (recommended)
- `adaptive` — Dynamic based on load

### Consensus Strategies
- `byzantine` — BFT (tolerates f < n/3 faulty)
- `raft` — Leader-based (tolerates f < n/2)
- `gossip` — Epidemic for eventual consistency
- `crdt` — Conflict-free replicated data types
- `quorum` — Configurable quorum-based

## V3 Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| HNSW Search | 150x-12,500x faster | **Implemented** (persistent) |
| Memory Reduction | 50-75% with quantization | **Implemented** (3.92x Int8) |
| SONA Integration | Pattern learning | **Implemented** (ReasoningBank) |
| Flash Attention | 2.49x-7.47x speedup | In progress |
| MCP Response | <100ms | Achieved |
| CLI Startup | <500ms | Achieved |
| SONA Adaptation | <0.05ms | In progress |

## Environment Variables

```bash
# Configuration
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info

# Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# MCP Server
CLAUDE_FLOW_MCP_PORT=3000
CLAUDE_FLOW_MCP_HOST=localhost
CLAUDE_FLOW_MCP_TRANSPORT=stdio

# Memory
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
```

## Doctor Health Checks

Run `npx claude-flow@v3alpha doctor` to check:
- Node.js version (20+)
- npm version (9+)
- Git installation
- Config file validity
- Daemon status
- Memory database
- API keys
- MCP servers
- Disk space
- TypeScript installation

## Quick Setup

```bash
# Add MCP servers
claude mcp add claude-flow npx claude-flow@v3alpha mcp start
claude mcp add ruv-swarm npx ruv-swarm mcp start  # Optional
claude mcp add flow-nexus npx flow-nexus@latest mcp start  # Optional

# Start daemon
npx claude-flow@v3alpha daemon start

# Run doctor
npx claude-flow@v3alpha doctor --fix
```

## Claude Code vs MCP Tools

### Claude Code Handles ALL EXECUTION:
- **Task tool**: Spawn and run agents concurrently
- File operations (Read, Write, Edit, MultiEdit, Glob, Grep)
- Code generation and programming
- Bash commands and system operations
- TodoWrite and task management
- Git operations

### MCP Tools ONLY COORDINATE:
- Swarm initialization (topology setup)
- Agent type definitions
- Task orchestration
- Memory management
- Neural features
- Performance tracking

- Keep MCP for coordination strategy only — use Claude Code's Task tool for real execution

## Publishing to npm

### Publishing Rules

- MUST publish ALL THREE packages when publishing CLI changes: `@claude-flow/cli`, `claude-flow`, AND `ruflo`
- MUST update ALL dist-tags for ALL THREE packages after publishing
- Publish order: `@claude-flow/cli` first, then `claude-flow` (umbrella), then `ruflo` (alias umbrella)
- MUST run verification for ALL THREE before telling user publishing is complete

```bash
# STEP 1: Build and publish CLI
cd v3/@claude-flow/cli
npm version 3.0.0-alpha.XXX --no-git-tag-version
npm run build
npm publish --tag alpha
npm dist-tag add @claude-flow/cli@3.0.0-alpha.XXX latest

# STEP 2: Publish claude-flow umbrella
cd /workspaces/claude-flow
npm version 3.0.0-alpha.XXX --no-git-tag-version
npm publish --tag v3alpha

# STEP 3: Update ALL claude-flow umbrella tags (CRITICAL - DON'T SKIP!)
npm dist-tag add claude-flow@3.0.0-alpha.XXX latest
npm dist-tag add claude-flow@3.0.0-alpha.XXX alpha

# STEP 4: Publish ruflo umbrella (CRITICAL - DON'T FORGET!)
cd /workspaces/claude-flow/ruflo
npm version 3.0.0-alpha.XXX --no-git-tag-version
npm publish --tag alpha
npm dist-tag add ruflo@3.0.0-alpha.XXX latest
```

**Verification (run before telling user):**
```bash
npm view @claude-flow/cli dist-tags --json
npm view claude-flow dist-tags --json
npm view ruflo dist-tags --json
# ALL THREE packages need: alpha AND latest pointing to newest version
```

### All Tags That Must Be Updated
| Package | Tag | Command Users Run |
|---------|-----|-------------------|
| `@claude-flow/cli` | `alpha` | `npx @claude-flow/cli@alpha` |
| `@claude-flow/cli` | `latest` | `npx @claude-flow/cli@latest` |
| `@claude-flow/cli` | `v3alpha` | `npx @claude-flow/cli@v3alpha` |
| `claude-flow` | `alpha` | `npx claude-flow@alpha` — EASY TO FORGET |
| `claude-flow` | `latest` | `npx claude-flow@latest` |
| `claude-flow` | `v3alpha` | `npx claude-flow@v3alpha` |
| `ruflo` | `alpha` | `npx ruflo@alpha` — EASY TO FORGET |
| `ruflo` | `latest` | `npx ruflo@latest` |

- Never forget the `ruflo` package — it's a thin wrapper users run via `npx ruflo@alpha`
- Never forget the umbrella `alpha` tag — users run `npx claude-flow@alpha`
- `ruflo` source is in `/ruflo/` — it depends on `@claude-flow/cli`

## Plugin Registry Maintenance (IPFS/Pinata)

The plugin registry is stored on IPFS via Pinata for decentralized, immutable distribution.

### Registry Location
- **Current CID**: Stored in `v3/@claude-flow/cli/src/plugins/store/discovery.ts`
- **Gateway**: `https://gateway.pinata.cloud/ipfs/{CID}`
- **Format**: JSON with plugin metadata, categories, featured/trending lists

### Required Environment Variables
Add to `.env` (NEVER commit actual values):
```bash
PINATA_API_KEY=your-api-key
PINATA_API_SECRET=your-api-secret
PINATA_API_JWT=your-jwt-token
```

## Plugin Registry Operations

### Adding a New Plugin to Registry

1. **Fetch current registry**:
```bash
curl -s "https://gateway.pinata.cloud/ipfs/$(grep LIVE_REGISTRY_CID v3/@claude-flow/cli/src/plugins/store/discovery.ts | cut -d"'" -f2)" > /tmp/registry.json
```

2. **Add plugin entry** to the `plugins` array:
```json
{
  "id": "@claude-flow/your-plugin",
  "name": "@claude-flow/your-plugin",
  "displayName": "Your Plugin",
  "description": "Plugin description",
  "version": "1.0.0-alpha.1",
  "size": 100000,
  "checksum": "sha256:abc123",
  "author": {"id": "claude-flow-team", "displayName": "Claude Flow Team", "verified": true},
  "license": "MIT",
  "categories": ["official"],
  "tags": ["your", "tags"],
  "downloads": 0,
  "rating": 5,
  "lastUpdated": "2026-01-25T00:00:00.000Z",
  "minClaudeFlowVersion": "3.0.0",
  "type": "integration",
  "hooks": [],
  "commands": [],
  "permissions": ["memory"],
  "exports": ["YourExport"],
  "verified": true,
  "trustLevel": "official"
}
```

3. **Update counts and arrays**:
   - Increment `totalPlugins`
   - Add to `official` array
   - Add to `featured`/`newest` if applicable
   - Update category `pluginCount`

4. **Upload to Pinata** (read credentials from .env):
```bash
# Source credentials from .env
PINATA_JWT=$(grep "^PINATA_API_JWT=" .env | cut -d'=' -f2-)

# Upload updated registry
curl -X POST "https://api.pinata.cloud/pinning/pinJSONToIPFS" \
  -H "Authorization: Bearer $PINATA_JWT" \
  -H "Content-Type: application/json" \
  -d @/tmp/registry.json
```

5. **Update discovery.ts** with new CID:
```typescript
export const LIVE_REGISTRY_CID = 'NEW_CID_FROM_PINATA';
```

6. **Also update demo registry** in discovery.ts `demoPluginRegistry` for offline fallback

### Security Rules
- NEVER hardcode API keys in scripts or source files
- NEVER commit .env (already in .gitignore)
- Always source credentials from environment at runtime
- Always delete temporary scripts after one-time uploads

### Verification
```bash
# Verify new registry is accessible
curl -s "https://gateway.pinata.cloud/ipfs/{NEW_CID}" | jq '.totalPlugins'
```

## Optional Plugins (20 Available)

Plugins are distributed via IPFS and can be installed with the CLI. Browse and install from the official registry:

```bash
# List all available plugins
npx claude-flow@v3alpha plugins list

# Install a plugin
npx claude-flow@v3alpha plugins install @claude-flow/plugin-name

# Enable/disable
npx claude-flow@v3alpha plugins enable @claude-flow/plugin-name
npx claude-flow@v3alpha plugins disable @claude-flow/plugin-name
```

### Core Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| `@claude-flow/embeddings` | 3.0.0-alpha.1 | Vector embeddings with sql.js, HNSW, hyperbolic support |
| `@claude-flow/security` | 3.0.0-alpha.1 | Input validation, path security, CVE remediation |
| `@claude-flow/claims` | 3.0.0-alpha.8 | Claims-based authorization (check, grant, revoke, list) |
| `@claude-flow/neural` | 3.0.0-alpha.7 | Neural pattern training (SONA, MoE, EWC++) |
| `@claude-flow/plugins` | 3.0.0-alpha.1 | Plugin system core (manager, discovery, store) |
| `@claude-flow/performance` | 3.0.0-alpha.1 | Performance profiling and benchmarking |

### Integration Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| `@claude-flow/plugin-agentic-qe` | 3.0.0-alpha.4 | Agentic quality engineering integration |
| `@claude-flow/plugin-prime-radiant` | 0.1.5 | Prime Radiant intelligence integration |
| `@claude-flow/plugin-gastown-bridge` | 3.0.0-alpha.1 | Gastown bridge protocol integration |
| `@claude-flow/teammate-plugin` | 1.0.0-alpha.1 | Multi-agent teammate coordination |
| `@claude-flow/plugin-code-intelligence` | 0.1.0 | Advanced code analysis and intelligence |
| `@claude-flow/plugin-test-intelligence` | 0.1.0 | Intelligent test generation and gap analysis |
| `@claude-flow/plugin-perf-optimizer` | 0.1.0 | Performance optimization automation |
| `@claude-flow/plugin-neural-coordinator` | 0.1.0 | Neural network coordination across agents |
| `@claude-flow/plugin-cognitive-kernel` | 0.1.0 | Core cognitive processing kernel |
| `@claude-flow/plugin-quantum-optimizer` | 0.1.0 | Quantum-inspired optimization algorithms |
| `@claude-flow/plugin-hyperbolic-reasoning` | 0.1.0 | Hyperbolic space reasoning for hierarchical data |

### Domain-Specific Plugins

| Plugin | Version | Description |
|--------|---------|-------------|
| `@claude-flow/plugin-healthcare-clinical` | 0.1.0 | Healthcare clinical workflow automation |
| `@claude-flow/plugin-financial-risk` | 0.1.0 | Financial risk assessment and modeling |
| `@claude-flow/plugin-legal-contracts` | 0.1.0 | Legal contract analysis and generation |

### Plugin Development

```bash
# Create a new plugin from template
npx claude-flow@v3alpha plugins create my-plugin

# Test locally
npx claude-flow@v3alpha plugins install ./path/to/my-plugin

# Publish to registry (requires Pinata credentials)
npx claude-flow@v3alpha plugins publish
```

Registry source: IPFS via Pinata (`QmXbfEAaR7D2Ujm4GAkbwcGZQMHqAMpwDoje4583uNP834`)

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues

---

Remember: **Claude Flow coordinates, Claude Code creates!**
