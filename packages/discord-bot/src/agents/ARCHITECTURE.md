# Agent System Architecture

## Overview

The agent system implements TAC Lesson 13 (Agent Experts) with the Act-Learn-Reuse pattern,
enabling agents that accumulate expertise over time and improve with each execution.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT SYSTEM ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Discord /expert │    │ Discord /task   │    │ Direct API      │         │
│  │ Commands        │    │ Commands        │    │ Calls           │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           ▼                      ▼                      ▼                   │
│  ┌────────────────────────────────────────────────────────────────┐        │
│  │                    AGENT ORCHESTRATION LAYER                    │        │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │        │
│  │  │ executeWithAuto  │  │ runTwoAgent      │  │ actLearnReuse│  │        │
│  │  │ Expert()         │  │ Workflow()       │  │ ()           │  │        │
│  │  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘  │        │
│  └───────────┼─────────────────────┼───────────────────┼──────────┘        │
│              │                     │                   │                   │
│              ▼                     ▼                   ▼                   │
│  ┌────────────────────────────────────────────────────────────────┐        │
│  │                    EXPERT SELECTION & CREATION                  │        │
│  │                                                                 │        │
│  │  ┌─────────────────────────────────────────────────────────┐   │        │
│  │  │ detectExpertDomain() - Keyword-based domain detection   │   │        │
│  │  │ getExpert() - Load expert with methods                   │   │        │
│  │  │ createCodebaseExpert() - Meta-agentic expert creation   │   │        │
│  │  └─────────────────────────────────────────────────────────┘   │        │
│  │                                                                 │        │
│  │  CODEBASE_EXPERTS:                                             │        │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │        │
│  │  │ security │ │ database │ │ trading  │ │ api_integration  │  │        │
│  │  │ CRITICAL │ │ CRITICAL │ │ CRITICAL │ │ HIGH             │  │        │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │        │
│  │  ┌──────────┐ ┌───────────────┐                                │        │
│  │  │ billing  │ │ performance   │                                │        │
│  │  │ CRITICAL │ │ HIGH          │                                │        │
│  │  └──────────┘ └───────────────┘                                │        │
│  └────────────────────────────────────────────────────────────────┘        │
│                                    │                                        │
│                                    ▼                                        │
│  ┌────────────────────────────────────────────────────────────────┐        │
│  │                    ACT-LEARN-REUSE CYCLE                        │        │
│  │                                                                 │        │
│  │     ┌──────────┐         ┌──────────┐         ┌──────────┐     │        │
│  │     │   ACT    │────────▶│  LEARN   │────────▶│  REUSE   │     │        │
│  │     │ Execute  │         │ Extract  │         │ Persist  │     │        │
│  │     │ w/Expert │         │ Insights │         │ Update   │     │        │
│  │     └──────────┘         └──────────┘         └──────────┘     │        │
│  │          │                    │                    │           │        │
│  │          ▼                    ▼                    ▼           │        │
│  │  ┌──────────────┐    ┌───────────────┐    ┌──────────────┐    │        │
│  │  │ Load expert  │    │ extractLearn  │    │ updateExpert │    │        │
│  │  │ createPrompt │    │ ings()        │    │ ise()        │    │        │
│  │  │ with selfImp │    │ from markers  │    │ bounded max  │    │        │
│  │  └──────────────┘    └───────────────┘    └──────────────┘    │        │
│  └────────────────────────────────────────────────────────────────┘        │
│                                    │                                        │
│                                    ▼                                        │
│  ┌────────────────────────────────────────────────────────────────┐        │
│  │                    EXPERTISE PERSISTENCE                        │        │
│  │                                                                 │        │
│  │  src/agents/expertise/                                         │        │
│  │  ├── security.md        # Security domain learnings            │        │
│  │  ├── database.md        # Database domain learnings            │        │
│  │  ├── trading.md         # Trading domain learnings             │        │
│  │  ├── api_integration.md # API integration learnings            │        │
│  │  ├── billing.md         # Billing domain learnings             │        │
│  │  ├── performance.md     # Performance domain learnings         │        │
│  │  ├── meta_agentic.md    # Meta-learning (agents building agents)│       │
│  │  ├── general.md         # General purpose learnings            │        │
│  │  └── ...                # Mode-specific expertise files        │        │
│  └────────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Modules

### 1. Agent Experts (`agent-experts.ts`)

Domain-specific experts for high-risk codebases:

```typescript
// Get expert for a domain
const expert = getExpert("security");

// Auto-detect domain from task
const domain = detectExpertDomain("Review auth code"); // => "security"

// Execute with automatic expert selection
const result = await executeWithAutoExpert(task, executor);

// Create new expert (meta-agentic)
const newExpert = await createCodebaseExpert("websockets", "Real-time communication", executor);
```

### 2. Expertise Manager (`expertise-manager.ts`)

Handles the Act-Learn-Reuse cycle:

```typescript
// Load accumulated expertise
const expertise = loadExpertise("trading");

// Create learning-enhanced prompt
const prompt = createLearningPrompt(task, "trading");

// Extract learnings from output
const insights = extractLearnings(output);

// Full cycle
const result = await actLearnReuse("security", task, executor);
```

### 3. Claude SDK Agent (`claude-sdk-agent.ts`)

Two-Phase Agent Pattern (Initializer + Coding):

```typescript
// Phase 1: Initialize task with feature breakdown
const init = await initializeClaudeTask({ prompt: task });

// Phase 2: Execute features sequentially
await executeClaudeFeature(init.taskId);

// Full workflow
const result = await runTwoAgentWorkflow({ prompt: task });

// Resume interrupted task
await resumeClaudeTask(taskId);
```

### 4. Lightweight Agent (`lightweight-agent.ts`)

Simple agent execution with learning:

```typescript
// Basic agent
const result = await runAgent({ prompt: task });

// Learning-enabled agent
const result = await runLearningAgent({
  prompt: task,
  mode: "coding",
  enableLearning: true,
});
```

## Data Flow

### Act-Learn-Reuse Cycle

```
1. ACT
   Task + Expertise + SelfImprove → Enhanced Prompt → Executor → Output

2. LEARN
   Output → extractLearnings() → Insights (if learning markers found)

3. REUSE
   Insights → updateExpertise() → Persisted to expertise/{mode}.md
   (Next execution loads updated expertise)
```

### Two-Phase Workflow

```
Phase 1: Initializer Agent
   Task Description → Feature Analysis → Feature List + TaskSpec

Phase 2: Coding Agent (repeated for each feature)
   TaskSpec + Feature → Implementation → Update Feature Status
   (With expertise injection and learning extraction)
```

## Expert Domain Detection

Keywords trigger domain selection (checked in order):

| Domain | Keywords |
|--------|----------|
| security | auth, vulnerability, owasp, csrf, xss, injection, token, password |
| database | database, schema, migration, query, sql, index, postgresql |
| performance | performance, optimize, cache, profile, memory, latency |
| billing | billing, payment, subscription, invoice, stripe |
| api_integration | api, webhook, endpoint, rest, graphql, rate limit |
| trading | trading, market, portfolio, risk, backtest, sharpe |

## Bounded Learning

To prevent unbounded expertise growth:

- Max 5 session insights stored per expertise file
- New insights replace oldest when limit reached
- Each insight limited to 500 characters
- Learning extraction requires explicit markers

## Testing

```bash
# Run all agent tests (94 tests)
npx vitest run src/agents/

# Run specific test files
npx vitest run src/agents/agent-system.test.ts      # 34 tests
npx vitest run src/agents/act-learn-reuse.test.ts   # 12 tests
npx vitest run src/agents/session/session.test.ts  # 48 tests
```

## Discord Commands

### /expert - Codebase Experts

| Subcommand | Description |
|------------|-------------|
| `/expert run <task>` | Execute with auto-selected expert |
| `/expert list` | List all experts |
| `/expert view <domain>` | View accumulated expertise |
| `/expert create <domain> <desc>` | Create new expert |

### /task - Two-Phase Workflow

| Subcommand | Description |
|------------|-------------|
| `/task create <desc>` | Initialize task (Phase 1) |
| `/task execute <id>` | Execute next feature (Phase 2) |
| `/task status <id>` | Check progress |
| `/task resume <id>` | Resume interrupted task |
| `/task run <desc>` | Full workflow |
| `/task list` | List all tasks |

## File Structure

```
src/agents/
├── agent-experts.ts       # CODEBASE_EXPERTS, domain detection, meta-agentic
├── claude-sdk-agent.ts    # Two-Phase workflow, task persistence
├── expertise-manager.ts   # Act-Learn-Reuse, learning extraction
├── lightweight-agent.ts   # Simple agent with learning support
├── openhands-agent.ts     # OpenHands SDK integration
├── index.ts               # Unified exports
├── expertise/             # Expertise files (learning persistence)
│   ├── security.md
│   ├── database.md
│   ├── trading.md
│   ├── api_integration.md
│   ├── billing.md
│   ├── performance.md
│   ├── meta_agentic.md
│   └── ...
├── core/                  # Two-phase support
├── phases/                # Initializer + Executor
├── session/               # Session persistence
└── patterns/              # Fabric patterns
```

## Key Principles (TAC Lesson 13)

1. **Mental Models are Data Structures** - Evolve over time with each action
2. **Self-Improving Template Meta Prompts** - Prompts that build other prompts
3. **Never Update Expertise Directly** - Teach agents HOW to learn
4. **Bounded Growth** - Prevent unbounded expertise files
5. **Act-Learn-Reuse Cycle** - Every agent execution follows this pattern
