# Alive Subagents Implementation Plan

## Overview

This plan describes how to implement "alive" subagents in pi coding agent that can:
1. **Be called by the main agent** to delegate tasks (via tools)
2. **Allow user interaction** via slash commands when subagents are alive
3. **Support multiple execution modes**: in-memory and process-based

## Key Differentiator

Unlike Claude Code and Cursor where users can only interact with subagents through the main agent, pi will allow **direct user interaction** with alive subagents via slash commands like `/agent`, `/agent-send`, `/agents`.

## Documents

| Document | Description |
|----------|-------------|
| [PLAN.md](./PLAN.md) | Full architecture, design decisions, phases |
| [TYPES.md](./TYPES.md) | TypeScript interfaces and types |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Step-by-step implementation guide |

## Quick Architecture

```
┌─────────────────────────────────────────┐
│           Main Agent Session            │
│  ┌─────────────────────────────────┐   │
│  │      SubagentManager            │   │
│  │  - Registry of alive subagents  │   │
│  │  - Lifecycle management         │   │
│  │  - Message routing              │   │
│  └─────────────────────────────────┘   │
│                 │                       │
│  ┌─────────────────────────────────┐   │
│  │         Tool Registry           │   │
│  │  subagent_start | subagent_send │   │
│  │  subagent_list | subagent_stop  │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Scout   │ │ Planner │ │ Worker  │
   │ (alive) │ │ (alive) │ │ (done)  │
   └─────────┘ └─────────┘ └─────────┘
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/agents` | List all alive subagents with status |
| `/agent <id>` | Switch to subagent context |
| `/agent-send <msg>` | Send message to active subagent |
| `/agent-output` | View subagent output |
| `/agent-kill <id>` | Stop a subagent |

## Tools for LLM

| Tool | Description |
|------|-------------|
| `subagent_start` | Start a subagent (fork or alive mode) |
| `subagent_send` | Send message to alive subagent |
| `subagent_list` | List all alive subagents |
| `subagent_stop` | Stop a subagent |

## Implementation Phases

| Phase | Goal | Effort |
|-------|------|--------|
| **Phase 1** | Core infrastructure (in-memory) | 2-3 days |
| **Phase 2** | User interaction (slash commands) | 1-2 days |
| **Phase 3** | Enhanced features (memory, streaming) | 2-3 days |
| **Phase 4** | Process-based isolation (optional) | 3-4 days |

## Agent Definition Format

```markdown
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
memory: none
---

System prompt for the agent...
```

**File locations:**
- `~/.pi/agent/agents/*.md` - User-level
- `.pi/agents/*.md` - Project-level
- Built-in in `packages/coding-agent/src/core/subagents/builtins/`

## Research Sources

- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Cursor Subagents](https://cursor.com/docs/context/subagents)
- [Google Cloud Multi-agent Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
- [Azure AI Agent Orchestration](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Spring AI Subagent Orchestration](https://spring.io/blog/2026/01/27/spring-ai-agentic-patterns-4-task-subagents)

## Next Steps

1. Review PLAN.md for full architecture
2. Review TYPES.md for type definitions
3. Follow IMPLEMENTATION.md step-by-step
4. Start with Phase 1 (Core Infrastructure)
