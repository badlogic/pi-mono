# V3 Migration Documentation

> Comprehensive guide for migrating from Claude Flow V2 to V3

## Overview

This directory contains detailed analysis of capabilities, gaps, and migration paths from V2 to V3. The migration involves significant architectural changes based on 10 Architecture Decision Records (ADRs).

## Migration Coverage Summary

| Category | V2 Features | V3 Implemented | Gap |
|----------|-------------|----------------|-----|
| **Hive-Mind/Swarm** | 18 | 12 | 6 MISSING |
| **Hooks** | 42 | 13 | 29 MISSING |
| **MCP Tools** | 65 | 22 | 43 MISSING |
| **CLI Commands** | 25 | 7 | 18 MISSING |
| **Memory** | 14 | 20 | +6 NEW |
| **Neural** | 3 | 14 | +11 NEW |

## Documents

### Core Analysis

| Document | Description |
|----------|-------------|
| [CAPABILITY-GAP-ANALYSIS.md](./CAPABILITY-GAP-ANALYSIS.md) | Complete gap analysis across all systems |
| [BACKWARD-COMPATIBILITY.md](./BACKWARD-COMPATIBILITY.md) | Backward compatibility requirements |

### System-Specific Migration

| Document | Description |
|----------|-------------|
| [HIVE-MIND-MIGRATION.md](./HIVE-MIND-MIGRATION.md) | Hive-mind, topologies, consensus migration |
| [HOOKS-MIGRATION.md](./HOOKS-MIGRATION.md) | Self-learning hooks system migration |
| [MCP-TOOLS-MIGRATION.md](./MCP-TOOLS-MIGRATION.md) | MCP tool definitions and handlers |
| [CLI-MIGRATION.md](./CLI-MIGRATION.md) | CLI commands and options |
| [MEMORY-NEURAL-MIGRATION.md](./MEMORY-NEURAL-MIGRATION.md) | Memory backends and neural systems |

## Key Architectural Changes

### ADR Summary

| ADR | Decision | Impact |
|-----|----------|--------|
| ADR-001 | Adopt agentic-flow@alpha as core | Eliminates 10,000+ duplicate lines |
| ADR-002 | Domain-Driven Design | Bounded contexts for modularity |
| ADR-003 | Single coordination engine | UnifiedSwarmCoordinator replaces multiple |
| ADR-004 | Plugin architecture | Microkernel for extensibility |
| ADR-005 | MCP-first API | Consistent tool interfaces |
| ADR-006 | Unified memory service | AgentDB integration |
| ADR-007 | Event sourcing | Full audit trail |
| ADR-008 | Vitest over Jest | 10x faster testing |
| ADR-009 | Hybrid memory backend | SQLite + AgentDB |
| ADR-010 | Remove Deno support | Node.js 20+ only |

## Critical Missing Capabilities

### Priority 1 - Core Functionality

1. **Hive-Mind System** - Queen coordination, consensus algorithms
2. **Task Management** - Task create/assign/cancel/status
3. **Session Management** - Session save/restore/export
4. **Workflow Execution** - Workflow create/execute/list

### Priority 2 - Integration

1. **GitHub Integration** - PR manager, issue tracker, release manager
2. **Terminal Management** - Terminal create/execute/list
3. **SPARC Methodology** - TDD workflow commands

### Priority 3 - Monitoring

1. **System Status** - Comprehensive status reporting
2. **Live Monitor** - Real-time dashboard
3. **Alert System** - monitor/get-alerts

## Migration Strategy

### Phase 1: Core (Weeks 1-4)
- Implement missing hive-mind capabilities
- Add task management MCP tools
- Restore session management

### Phase 2: Integration (Weeks 5-8)
- GitHub integration commands
- Terminal management
- SPARC methodology

### Phase 3: Polish (Weeks 9-12)
- System monitoring
- Shell hooks (TypeScript conversion)
- Verification system

## Quick Start

```bash
# Check migration status
npx claude-flow migrate status

# Run automatic migration
npx claude-flow migrate run --target all --backup

# Verify migration
npx claude-flow migrate verify
```

## Related Documentation

- [V3 README](../README.md) - V3 architecture overview
- [ADRs](../docs/adrs/) - Architecture Decision Records
- [Implementation Guide](../docs/guides/) - V3 implementation guides
