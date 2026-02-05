# PRD: Onchain Game Agent (`@mariozechner/pi-onchain-agent`)

## Status: Complete

| Phase | Status | Tests |
|-------|--------|-------|
| 1. Scaffolding + Core Types | Done | 12 passing |
| 2. Mock Adapter | Done | 9 passing |
| 3. Soul + Task Lists | Done | 14 passing |
| 4. Game Tools | Done | 12 passing |
| 5. Decision Recording | Done | 13 passing |
| 6. Tick Loop | Done | 15 passing |
| 7. Agent Factory | Done | 18 passing |
| 8. Evolution Engine | Done | 23 passing |
| 9. Integration Tests | Done | 15 passing |
| 10. Templates | Done | N/A (static files) |

**Total: 131 tests passing, build clean (`tsgo` compiles with 0 errors)**

---

## Overview

An autonomous agent framework for playing onchain games that evolves and writes its own strategies. Built as a thin wrapper around the Pi agent framework.

### Core Concept

Every 60 seconds, the agent:
1. Reads its **Soul** (personality, philosophy, hard rules)
2. Reads its **Task Lists** (per-domain objectives: combat, economy, social, exploration)
3. Observes the **Game State** via chain indexer
4. **Thinks** using an LLM about what to do (loading relevant skills on demand)
5. **Executes** action(s) as blockchain transactions
6. **Updates** its own task lists, priorities, and soul via file writes
7. **Records** the decision as a markdown file

The agent can also **evolve** - a separate analysis session reviews game history and suggests improvements to the soul, task lists, and skills.

### Key Insight

The agent plays games with the **LLM in the hot path** (agentic per action, not static code). The soul, task lists, and skills are all markdown files that the agent reads before every decision and can modify itself.

---

## Architecture

### How It Maps to Pi

| Game Agent Concept | Pi Feature | Implementation |
|---|---|---|
| **Soul** | System prompt | `systemPromptOverride` reads `soul.md` |
| **Task Lists** | Appended system prompt | `appendSystemPromptOverride` reads `tasks/*.md` |
| **Skills** | Pi skills (standard) | SKILL.md files in `skills/`, loaded progressively |
| **Game Actions** | Custom tools | `AgentTool` for observe, execute, simulate |
| **Self-Mutation** | Built-in write tool | Agent uses `write` to update its own .md files |
| **Decision Log** | Extension events | `agent_end` listener writes decision .md files |
| **Evolution** | Separate session | Second Pi session with read-only tools |

### Dependency Flow

```
@mariozechner/pi-onchain-agent
  └── @mariozechner/pi-coding-agent (SDK: createAgentSession, tools, skills)
        └── @mariozechner/pi-agent-core (Agent loop, events, tools)
              └── @mariozechner/pi-ai (LLM providers, streaming, TypeBox)
```

---

## File System Layout

```
agent-data/                      # Per-agent instance data
├── soul.md                      # Agent personality + philosophy
├── tasks/
│   ├── combat.md                # Combat objectives + standing orders
│   ├── economy.md               # Economic objectives + standing orders
│   ├── social.md                # Diplomatic objectives + standing orders
│   ├── exploration.md           # Scouting objectives + standing orders
│   ├── priorities.md            # Domain weights + reasoning
│   └── reflection.md            # Running self-commentary
├── skills/
│   ├── siege-tactics/SKILL.md
│   ├── boom-build-order/SKILL.md
│   └── ...
├── decisions/
│   ├── 100-1706000000.md        # Decision at tick 100
│   └── ...
└── evolution/
    └── ...
```

---

## Core Types

### WorldState
```typescript
interface WorldState<TEntity = unknown> {
  tick: number;
  timestamp: number;
  entities: TEntity[];
  resources?: Map<string, number>;
  raw?: unknown;
}
```

### GameAdapter (implement per game)
```typescript
interface GameAdapter<TState extends WorldState = WorldState> {
  getWorldState(): Promise<TState>;
  executeAction(action: GameAction): Promise<ActionResult>;
  simulateAction(action: GameAction): Promise<SimulationResult>;
  subscribe?(callback: (state: TState) => void): () => void;
}
```

### GameAction
```typescript
interface GameAction {
  type: string;
  params: Record<string, unknown>;
}
```

---

## Agent Think Cycle (60s)

```
Second 0:    World state snapshot
Second 0.1:  Load soul.md as system prompt
Second 0.1:  Load tasks/*.md as appended context
Second 0.2:  Skill descriptions in prompt (progressive disclosure)
Second 0.5:  Send to LLM
Second 2-5:  LLM thinks, calls tools (observe, simulate, execute, write)
Second 5.1:  Decision recorded to decisions/*.md
Second 5-60: Wait for next cycle
```

---

## Soul Evolution

The soul is a living document. The agent can update:
- **Personality traits** (aggression, patience, etc.)
- **Current disposition** (mindset for this phase of the game)
- **Learnings** (patterns discovered about the game or opponent)
- **Strategic philosophy** (fundamental approach)

Evolution happens two ways:
1. **Self-directed**: Agent updates soul.md during normal play via write tool
2. **Periodic analysis**: Evolution engine reviews game history and suggests changes

---

## Tools

| Tool | Purpose | Schema |
|------|---------|--------|
| `observe_game` | Get current game state | `{ filter?: string }` |
| `execute_action` | Submit action to chain | `{ actionType: string, params?: object }` |
| `simulate_action` | Dry-run an action | `{ actionType: string, params?: object }` |
| `read` | Read any .md file (built-in) | `{ path: string }` |
| `write` | Write any .md file (built-in) | `{ path: string, content: string }` |

---

## Package Structure

```
packages/onchain-agent/
  src/
    index.ts           # Barrel exports
    types.ts           # Core generic types
    soul.ts            # Soul loading, task list loading, prompt assembly
    tools.ts           # Game tools (observe, execute, simulate)
    decision-log.ts    # Decision recording and reading
    tick-loop.ts       # Tick loop with mutex guard
    game-agent.ts      # createGameAgent() factory
    evolution.ts       # Evolution session and apply
  test/
    types.test.ts
    mock-adapter.test.ts
    soul.test.ts
    game-tools.test.ts
    decision-log.test.ts
    tick-loop.test.ts
    game-agent.test.ts
    evolution.test.ts
    integration.test.ts
    utils/
      mock-adapter.ts
      mock-stream.ts
  templates/           # Starter .md files for new agents
    soul.md
    tasks/*.md
    skills/*/SKILL.md
```

---

## Changelog

- **2026-02-06**: Initial PRD created. Starting Phase 1.
- **2026-02-06**: All 10 phases complete. 131 tests passing, build clean.
