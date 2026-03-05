# Hive Mind Documentation Index

Extracted from: https://github.com/ruvnet/ruflo/tree/main

## Directory Structure

```
extracted/
├── core-docs/          # Main project documentation
├── skills/             # Skill definitions for hive-mind capabilities
├── agents/             # Agent definitions (queen, workers, etc.)
├── commands/           # CLI command documentation
├── adrs/               # Architecture Decision Records
├── benchmarks/         # Performance benchmark reports
├── v2-docs/            # Version 2 specific documentation
├── v3-docs/            # Version 3 specific documentation
└── implementation/     # Implementation plans and migration guides
```

## File Count: 94 markdown files

---

## Key Documentation Files

### Start Here
| File | Description |
|------|-------------|
| `core-docs/README.md` | Main project README with overview |
| `implementation/HIVE-MIND-MIGRATION.md` | **BEST: Comprehensive architecture & concepts** |
| `implementation/SWARM-OVERVIEW.md` | 15-agent concurrent swarm architecture |
| `implementation/ADR-038-multi-agent-coordination-plugin.md` | Neural coordination (advanced) |

### Skills
| File | Description |
|------|-------------|
| `skills/hive-mind-basic.md` | Basic hive-mind skill definition |
| `skills/hive-mind-advanced.md` | **Comprehensive skill documentation** |
| `skills/agent-queen-coordinator_SKILL.md` | Queen coordinator agent skill |
| `skills/agent-worker-specialist_SKILL.md` | Worker specialist agent skill |
| `skills/agent-scout-explorer_SKILL.md` | Scout/explorer agent skill |
| `skills/agent-swarm-memory-manager_SKILL.md` | Memory manager agent skill |
| `skills/agent-collective-intelligence-coordinator_SKILL.md` | Collective intelligence skill |

### Agents
| File | Description |
|------|-------------|
| `agents/queen-coordinator.md` | Queen agent definition |
| `agents/worker-specialist.md` | Worker agent definition |
| `agents/scout-explorer.md` | Scout agent definition |
| `agents/swarm-memory-manager.md` | Memory manager agent definition |
| `agents/collective-intelligence-coordinator.md` | Collective intelligence agent |

### Commands
| File | Description |
|------|-------------|
| `commands/README.md` | Commands overview |
| `commands/hive-mind-init.md` | Initialize hive-mind |
| `commands/hive-mind-spawn.md` | Spawn agents |
| `commands/hive-mind-status.md` | Check status |
| `commands/hive-mind-consensus.md` | Consensus operations |
| `commands/hive-mind-memory.md` | Memory management |
| `commands/hive-mind-metrics.md` | Metrics and monitoring |
| `commands/hive-mind-sessions.md` | Session management |
| `commands/hive-mind-wizard.md` | Interactive wizard |

### Architecture & Implementation
| File | Description |
|------|-------------|
| `implementation/HIVE-MIND-MIGRATION.md` | V2 to V3 migration with architecture details |
| `implementation/SWARM-OVERVIEW.md` | Swarm topology and agent roster |
| `implementation/AGENT-SPECIFICATIONS.md` | Detailed agent specifications |
| `implementation/CLI-MIGRATION.md` | CLI command migration |
| `implementation/BACKWARD-COMPATIBILITY.md` | Compatibility notes |
| `implementation/CAPABILITY-GAP-ANALYSIS.md` | Feature gaps analysis |

### Benchmarks
| File | Description |
|------|-------------|
| `benchmarks/hive_mind_comprehensive_benchmark_report.md` | Comprehensive benchmarks |
| `benchmarks/hive-mind-performance-analysis.md` | Performance analysis |
| `benchmarks/performance_summary.md` | Performance summary |

---

## Core Concepts Summary

### Hive Mind Architecture
- **Queen-led coordination** with specialized workers
- **Consensus algorithms**: Byzantine, Raft, Gossip, CRDT, Quorum
- **Topologies**: hierarchical, mesh, ring, star, hierarchical-mesh
- **Collective memory**: SQLite-based shared knowledge

### Agent Types
- **Queen Coordinator**: Strategic decision-making
- **Workers**: Implementation specialists (coder, tester, etc.)
- **Scouts**: Research and exploration
- **Guardians**: Quality assurance
- **Architects**: System design

### Key Commands
```bash
npx ruflo hive-mind init
npx ruflo hive-mind spawn "objective" --queen-type strategic
npx ruflo hive-mind status
npx ruflo hive-mind memory
```

---

## Related Source Files (Not Extracted)

The following source files were identified but not extracted (these are TypeScript/JavaScript implementation files):

- `v2/src/hive-mind/core/HiveMind.ts` - Main orchestrator
- `v2/src/hive-mind/core/Queen.ts` - Queen coordinator
- `v2/src/hive-mind/core/Agent.ts` - Agent base class
- `v2/src/hive-mind/core/Memory.ts` - Collective memory
- `v2/src/hive-mind/integration/ConsensusEngine.ts` - Consensus logic
- `v3/@claude-flow/swarm/src/unified-coordinator.ts` - V3 coordinator
- `v3/@claude-flow/swarm/src/queen-coordinator.ts` - V3 queen

---

**Extraction Date**: 2026-03-04
**Source Repository**: https://github.com/ruvnet/ruflo
