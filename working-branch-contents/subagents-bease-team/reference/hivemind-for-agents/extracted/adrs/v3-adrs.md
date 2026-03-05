# Claude-Flow v3 - Architecture Decision Records

**Project:** Claude-Flow v3 Reimagining
**Date Range:** 2026-01-03 onwards
**Status:** Proposed
**Decision Authority:** Architecture Team

---

## ADR Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| ADR-001 | Adopt agentic-flow as Core Foundation | In Progress | 2026-01-03 |
| ADR-002 | Implement Domain-Driven Design Structure | **Implemented** ✅ | 2026-01-03 |
| ADR-003 | Single Coordination Engine | **Implemented** ✅ | 2026-01-03 |
| ADR-004 | Plugin-Based Architecture | **Implemented** ✅ | 2026-01-03 |
| ADR-005 | MCP-First API Design | **Implemented** ✅ | 2026-01-03 |
| ADR-006 | Unified Memory Service | **Implemented** ✅ | 2026-01-03 |
| ADR-007 | Event Sourcing for State Changes | In Progress | 2026-01-03 |
| ADR-008 | Vitest Over Jest | **Implemented** ✅ | 2026-01-03 |
| ADR-009 | Hybrid Memory Backend as Default | **Implemented** ✅ | 2026-01-03 |
| ADR-010 | Remove Deno Support | **Implemented** ✅ | 2026-01-03 |
| ADR-011 | LLM Provider System | **Implemented** ✅ | 2026-01-05 |
| ADR-012 | MCP Security Features | **Implemented** ✅ | 2026-01-05 |
| ADR-013 | Core Security Module | **Implemented** ✅ | 2026-01-05 |
| ADR-014 | Cross-Platform Workers System | **Implemented** ✅ | 2026-01-05 |

---

## ADR-001: Adopt agentic-flow as Core Foundation

**Status:** Proposed
**Date:** 2026-01-03
**Decision Makers:** Architecture Team
**Context Owner:** Lead Architect

### Context

Claude-Flow v2.x implements its own agent orchestration, coordination, and execution systems. This duplicates significant functionality available in agentic-flow, our primary dependency. The current architecture treats agentic-flow as an optional add-on rather than the foundation.

**Current State:**
- Custom SwarmCoordinator (800+ lines)
- Custom AgentManager (1,736 lines)
- Custom session management
- Custom task execution
- agentic-flow used only via hooks system
- Duplicate implementations increase maintenance burden

**Analysis:**
```
Functionality Overlap:
┌─────────────────────────────────────┐
│  claude-flow   │   agentic-flow     │
├─────────────────────────────────────┤
│ SwarmCoordinator │ Swarm System    │ 80% overlap
│ AgentManager     │ Agent Lifecycle │ 70% overlap
│ TaskScheduler    │ Task Execution  │ 60% overlap
│ SessionManager   │ Session Mgmt    │ 50% overlap
└─────────────────────────────────────┘
```

### Decision

**We will adopt agentic-flow as the core foundation for v3, building claude-flow as a specialized extension rather than a parallel implementation.**

Specifically:
1. Use agentic-flow's Agent base class for all agents
2. Use agentic-flow's Swarm system for coordination
3. Use agentic-flow's task graph execution engine
4. Extend agentic-flow via plugins and hooks
5. Contribute improvements back to agentic-flow
6. Maintain abstraction layer for future flexibility

### Rationale

**Pros:**
- Eliminate 10,000+ lines of duplicate code
- Leverage battle-tested agentic-flow patterns
- Faster development (build on existing)
- Better integration with agentic-flow ecosystem
- Smaller maintenance surface area
- Community alignment

**Cons:**
- Dependency on external library
- Less control over core orchestration
- Need to contribute upstream for custom needs
- Migration effort from v2 to v3
- Learning curve for contributors

**Alternatives Considered:**

1. **Status Quo (Keep Custom Implementation)**
   - Rejected: High maintenance burden, duplicate effort
   - Would require 2-3 FTE just to maintain parity with agentic-flow

2. **Fork agentic-flow**
   - Rejected: Fragments ecosystem, loses upstream improvements
   - Creates long-term technical debt

3. **Build Abstraction Over Both**
   - Rejected: Adds complexity, doesn't reduce maintenance
   - Still need to maintain two systems

### Implementation Plan

**Phase 1: Foundation (Week 1-2)**
```typescript
// Create agentic-flow adapter layer
import { Agent as AgenticFlowAgent } from 'agentic-flow';

export class ClaudeFlowAgent extends AgenticFlowAgent {
  // Add claude-flow specific capabilities
  async handleClaudeFlowTask(task: ClaudeTask): Promise<TaskResult> {
    // Claude-specific logic
  }
}
```

**Phase 2: Migration (Week 3-8)**
- Migrate SwarmCoordinator to agentic-flow Swarm
- Migrate AgentManager to agentic-flow Agent system
- Migrate task execution to agentic-flow task graph
- Keep backward compatibility layer

**Phase 3: Optimization (Week 9-12)**
- Remove compatibility layer
- Optimize integration points
- Contribute improvements to agentic-flow

### Success Metrics

- [ ] <5,000 lines of orchestration code in claude-flow (vs 15,000+ currently)
- [ ] 100% feature parity with v2
- [ ] <10% performance regression (ideally improvement)
- [ ] All tests passing
- [ ] Documentation complete

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| agentic-flow breaking changes | Medium | High | Pin version, maintain adapter |
| Performance regression | Low | Medium | Benchmark continuously |
| Feature limitations | Medium | Medium | Contribute upstream |
| Migration complexity | High | Medium | Phased approach, compatibility layer |

### Related Decisions

- ADR-004: Plugin architecture enables clean extension of agentic-flow
- ADR-003: Single coordination engine built on agentic-flow
- ADR-006: Memory service can leverage agentic-flow memory

### References

- agentic-flow documentation: https://github.com/agentic-flow
- Current dependency: package.json line 123: "agentic-flow": "^1.9.4"
- Integration points: src/services/agentic-flow-hooks/

---

## ADR-002: Implement Domain-Driven Design Structure

**Status:** Proposed
**Date:** 2026-01-03

### Context

Current v2 structure organizes code by technical layer (cli/, core/, mcp/, swarm/), making it difficult to understand complete features and leading to high coupling between layers.

**Problems:**
- Feature code scattered across 5+ directories
- Unclear ownership and boundaries
- Changes require touching many files
- Difficult for new contributors to navigate

**Example: Agent Management Feature**
```
Current (scattered):
├── cli/commands/agent.ts          # CLI interface
├── core/orchestrator.ts           # Orchestration logic
├── agents/agent-manager.ts        # Management logic
├── mcp/tools.ts                   # MCP tools
└── swarm/coordinator.ts           # Coordination logic

Proposed (cohesive):
└── agent-lifecycle/
    ├── api/cli/agent-commands.ts
    ├── api/mcp/agent-tools.ts
    ├── application/agent-service.ts
    ├── domain/agent.ts
    └── infrastructure/agent-repository.ts
```

### Decision

**We will restructure v3 using Domain-Driven Design (DDD) principles with clear bounded contexts.**

**Structure:**
```
src/
├── agent-lifecycle/      # Bounded Context 1
│   ├── domain/          # Business logic, entities
│   ├── application/     # Use cases, services
│   ├── infrastructure/  # Persistence, external systems
│   └── api/            # External interfaces (CLI, MCP)
├── task-execution/      # Bounded Context 2
├── memory-management/   # Bounded Context 3
├── coordination/        # Bounded Context 4
├── shared-kernel/       # Shared types and utilities
└── infrastructure/      # Cross-cutting concerns
```

**Layer Rules:**
1. Domain layer: No external dependencies, pure business logic
2. Application layer: Orchestrates domain, no infrastructure details
3. Infrastructure layer: Implements technical concerns
4. API layer: Thin adapters to external world

### Rationale

**Benefits:**
- Features colocated, easy to find
- Clear boundaries reduce coupling
- Easy to understand and modify
- Enables team scaling (own a domain)
- Facilitates testing (mock boundaries)
- Supports microservices future (extract domains)

**Costs:**
- Migration effort from v2 structure
- Learning curve for DDD concepts
- More directories to navigate
- Requires discipline to maintain boundaries

### Implementation

**Directory Template:**
```
domain-name/
├── domain/
│   ├── models/           # Entities, value objects
│   ├── interfaces/       # Repository interfaces
│   ├── events/          # Domain events
│   └── services/        # Domain services
├── application/
│   ├── services/        # Application services
│   ├── handlers/        # Event handlers
│   └── queries/         # Query services (CQRS)
├── infrastructure/
│   ├── repositories/    # Repository implementations
│   ├── adapters/        # External system adapters
│   └── persistence/     # Persistence implementations
└── api/
    ├── cli/            # CLI commands
    ├── mcp/            # MCP tools
    └── dto/            # Data transfer objects
```

**Example: Task Execution Domain**
```typescript
// domain/models/task.ts
export class Task {
  constructor(
    readonly id: TaskId,
    readonly type: TaskType,
    private status: TaskStatus
  ) {}

  assign(agentId: AgentId): void {
    if (this.status !== TaskStatus.Created) {
      throw new InvalidStateError('Task already assigned');
    }
    this.status = TaskStatus.Assigned;
    this.emit(new TaskAssigned(this.id, agentId));
  }
}

// application/services/task-service.ts
export class TaskExecutionService {
  constructor(
    private taskRepo: ITaskRepository,
    private agentService: AgentLifecycleService,
    private eventBus: IEventBus
  ) {}

  async createTask(spec: TaskSpec): Promise<TaskId> {
    const task = Task.create(spec);
    await this.taskRepo.save(task);
    return task.id;
  }
}

// api/cli/task-commands.ts
export class CreateTaskCommand {
  constructor(private taskService: TaskExecutionService) {}

  async execute(args: CreateTaskArgs): Promise<void> {
    const taskId = await this.taskService.createTask(args);
    console.log(`Task created: ${taskId}`);
  }
}
```

### Success Criteria

- [ ] Clear domain boundaries documented
- [ ] All features contained within single domain
- [ ] No circular dependencies between domains
- [ ] Domain models independent of infrastructure
- [ ] New features can be added in <3 files

### References

- Domain-Driven Design by Eric Evans
- Implementing Domain-Driven Design by Vaughn Vernon
- Current architecture assessment: docs/architecture/v3-assessment.md

---

## ADR-003: Single Coordination Engine

**Status:** Proposed
**Date:** 2026-01-03

### Context

v2 has four overlapping coordination systems:
1. SwarmCoordinator (mesh, hierarchical, centralized)
2. Hive Mind (queen-led with consensus)
3. Maestro (SPARC methodology)
4. AgentManager (pools and clusters)

This creates:
- Confusion about which to use
- Duplicate code (coordination logic)
- Maintenance burden
- Potential conflicts and bugs

### Decision

**We will consolidate to a single CoordinationEngine with pluggable strategies.**

**Architecture:**
```typescript
class CoordinationEngine {
  constructor(
    private topology: ITopologyStrategy,
    private scheduler: ITaskScheduler,
    private consensus: IConsensusProtocol,
    private loadBalancer: ILoadBalancer
  ) {}

  // Core coordination methods
  async assignTask(task: Task): Promise<AgentId>;
  async electLeader(): Promise<AgentId>;
  async rebalanceLoad(): Promise<void>;
}

// Topology strategies (pluggable)
interface ITopologyStrategy {
  type: 'mesh' | 'hierarchical' | 'centralized';
  // ... methods
}

// Specialized behaviors as plugins
class HiveMindPlugin implements ClaudeFlowPlugin {
  enhance(engine: CoordinationEngine): void {
    engine.addConsensusProtocol(new ByzantineConsensus());
    engine.addStrategy('queen-led', new QueenLedStrategy());
  }
}
```

### Rationale

**Pros:**
- Single source of truth
- Easier to understand and maintain
- Consistent coordination behavior
- Extensible via strategies
- Reduced code size

**Cons:**
- Migration effort from specialized systems
- May lose some specialized features initially
- Need to support all use cases

**Strategy Selection Guide:**
```
Use Case → Topology Strategy
├── Simple tasks → Centralized
├── Large teams → Hierarchical
├── Resilience → Mesh
└── Consensus → Byzantine (via plugin)
```

### Implementation

**Phase 1: Core Engine**
```typescript
class CoordinationEngine {
  private strategies = new Map<string, ITopologyStrategy>();

  registerStrategy(name: string, strategy: ITopologyStrategy): void {
    this.strategies.set(name, strategy);
  }

  async initialize(config: CoordinationConfig): Promise<void> {
    const strategy = this.strategies.get(config.topology);
    if (!strategy) throw new Error('Unknown topology');

    this.topology = strategy;
    await this.topology.initialize();
  }
}
```

**Phase 2: Built-in Strategies**
- CentralizedStrategy (default)
- HierarchicalStrategy
- MeshStrategy

**Phase 3: Plugin Strategies**
- HiveMind (via plugin)
- Maestro (via plugin)

### Success Metrics

- [ ] Single CoordinationEngine class
- [ ] All v2 topologies supported
- [ ] 50% reduction in coordination code
- [ ] No performance regression
- [ ] All tests migrated and passing

---

## ADR-004: Plugin-Based Architecture

**Status:** Proposed
**Date:** 2026-01-03

### Context

v2 bundles all features (Hive Mind, Maestro, Neural, Verification) into core, making the system large and complex even for users who only need basic features.

### Decision

**We will adopt a microkernel architecture with plugins for optional features.**

**Core:**
- Agent lifecycle
- Task execution
- Memory management
- Basic coordination
- MCP server

**Plugins:**
- HiveMindPlugin (advanced coordination)
- MaestroPlugin (SPARC methodology)
- NeuralPlugin (neural training)
- VerificationPlugin (truth scoring)
- EnterprisePlugin (advanced features)

### Plugin Interface

```typescript
interface ClaudeFlowPlugin {
  name: string;
  version: string;
  dependencies?: string[];

  initialize(context: PluginContext): Promise<void>;
  shutdown(): Promise<void>;

  // Optional extensions
  registerAgentTypes?(): AgentTypeDefinition[];
  registerTaskTypes?(): TaskTypeDefinition[];
  registerMCPTools?(): MCPTool[];
  registerCLICommands?(): Command[];
  registerMemoryBackends?(): MemoryBackendFactory[];
}

// Plugin loading
const core = new ClaudeFlowCore();
await core.loadPlugin(new HiveMindPlugin());
await core.initialize();
```

### Rationale

**Benefits:**
- Smaller core (faster startup)
- User chooses features
- Easier to maintain (clear boundaries)
- Community can build plugins
- Optional dependencies

**Costs:**
- Plugin system complexity
- Versioning challenges
- Testing matrix expansion

### Success Metrics

- [ ] Core <20MB (vs 50MB+ currently)
- [ ] Plugin loading <100ms
- [ ] At least 3 official plugins
- [ ] Plugin development guide
- [ ] Community plugin contributed

---

## ADR-005: MCP-First API Design

**Status:** Proposed
**Date:** 2026-01-03

### Context

v2 CLI commands contain business logic, making it hard to use claude-flow programmatically or via other interfaces.

### Decision

**All functionality will be exposed as MCP tools first, with CLI as a thin wrapper.**

**Architecture:**
```
MCP Tools (primary interface)
    ↓
Application Services (business logic)
    ↓
Domain Models

CLI Commands = MCP tool wrappers
Programmatic API = Direct service access
```

### Example

```typescript
// MCP tool (primary)
const spawnAgentTool: MCPTool = {
  name: 'agent/spawn',
  handler: async (input, context) => {
    return context.agentService.spawnAgent(input);
  }
};

// CLI command (wrapper)
class SpawnCommand {
  async execute(args: SpawnArgs): Promise<void> {
    const result = await mcpClient.callTool('agent/spawn', args);
    console.log(result);
  }
}
```

### Benefits

- Consistent API across interfaces
- Easy to test (MCP tool tests)
- CLI automatically gets features
- External integrations use same API
- Documentation from MCP schema

### Success Metrics

- [ ] 100% CLI commands backed by MCP tools
- [ ] MCP schema complete
- [ ] CLI adds <10% code vs MCP tools

---

## ADR-006: Unified Memory Service

**Status:** Proposed
**Date:** 2026-01-03

### Context

v2 has 6 memory implementations: MemoryManager, DistributedMemory, SwarmMemory, AdvancedMemoryManager, SQLiteBackend, MarkdownBackend.

### Decision

**Single MemoryService with pluggable backends.**

```typescript
class MemoryService {
  constructor(
    private backend: IMemoryBackend, // SQLite, AgentDB, or Hybrid
    private cache: MemoryCache,
    private indexer: MemoryIndexer
  ) {}
}

// Backend selection via config
{
  memory: {
    backend: 'hybrid', // 'sqlite' | 'agentdb' | 'hybrid'
    cacheSize: 100,
    indexing: true
  }
}
```

### Backend Selection

| Backend | Use Case | Pros | Cons |
|---------|----------|------|------|
| SQLite | Structured queries, ACID | Fast, reliable | No vector search |
| AgentDB | Semantic search, RAG | Vector similarity | Requires setup |
| Hybrid | General purpose | Best of both | Higher memory |

### Success Metrics

- [ ] Single MemoryService interface
- [ ] 3 backend implementations
- [ ] 90% reduction in memory code
- [ ] Migration from v2 data

---

## ADR-007: Event Sourcing for State Changes

**Status:** Proposed
**Date:** 2026-01-03

### Context

v2 uses direct state mutation, making it hard to:
- Debug state changes
- Implement undo/redo
- Audit operations
- Replay events

### Decision

**Use event sourcing pattern for critical state changes.**

```typescript
// Domain events
class AgentSpawned extends DomainEvent {
  constructor(
    readonly agentId: AgentId,
    readonly type: AgentType,
    readonly timestamp: Date
  ) {}
}

// Event store
interface IEventStore {
  append(event: DomainEvent): Promise<void>;
  getEvents(aggregateId: string): Promise<DomainEvent[]>;
  subscribe(handler: EventHandler): void;
}

// Rebuild state from events
class Agent {
  static fromEvents(events: DomainEvent[]): Agent {
    const agent = new Agent();
    events.forEach(e => agent.apply(e));
    return agent;
  }

  private apply(event: DomainEvent): void {
    if (event instanceof AgentSpawned) {
      this.id = event.agentId;
      this.type = event.type;
    }
    // ... more events
  }
}
```

### Benefits

- Complete audit trail
- Time travel debugging
- Replay for testing
- Event-driven integration
- Temporal queries

### Scope

**Apply to:**
- Agent lifecycle events
- Task state changes
- Coordination decisions
- Critical errors

**Don't apply to:**
- High-frequency metrics
- Log messages
- Ephemeral cache

### Success Metrics

- [ ] Event store implemented
- [ ] All critical state changes emit events
- [ ] Can rebuild state from events
- [ ] Event replay for debugging

---

## ADR-008: Vitest Over Jest

**Status:** Proposed
**Date:** 2026-01-03

### Context

v2 uses Jest for testing. Vitest is a modern alternative that's faster and has better ESM support.

### Decision

**Migrate to Vitest for v3.**

### Rationale

**Vitest Advantages:**
- 10x faster (uses Vite)
- Better ESM support (native)
- Compatible Jest API (easy migration)
- Better watch mode
- Built-in coverage

**Migration:**
```json
// package.json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "vite": "^5.0.0"
  },
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

### Success Metrics

- [ ] All tests migrated to Vitest
- [ ] Test execution <5s (vs 30s+ with Jest)
- [ ] Coverage reporting working
- [ ] CI integration complete

---

## ADR-009: Hybrid Memory Backend as Default

**Status:** Proposed
**Date:** 2026-01-03

### Context

Need to choose default memory backend for v3.

### Decision

**HybridBackend (SQLite + AgentDB) as default.**

### Rationale

**SQLite:** Reliable, fast for structured queries
**AgentDB:** Vector search for semantic queries
**Together:** Best of both worlds

**Configuration:**
```typescript
{
  memory: {
    backend: 'hybrid',
    sqlite: {
      path: './claude-flow.db'
    },
    agentdb: {
      dimensions: 1536, // OpenAI embeddings
      indexType: 'HNSW'
    }
  }
}
```

### Implementation

```typescript
class HybridBackend implements IMemoryBackend {
  constructor(
    private structured: SQLiteBackend,
    private vector: AgentDBBackend
  ) {}

  async store(entry: MemoryEntry): Promise<void> {
    // Store in both
    await Promise.all([
      this.structured.store(entry),
      this.vector.store(entry)
    ]);
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (query.semantic) {
      // Use vector search
      return this.vector.query(query);
    } else {
      // Use SQL
      return this.structured.query(query);
    }
  }
}
```

### Success Metrics

- [ ] Hybrid backend working
- [ ] Both SQL and semantic queries supported
- [ ] Performance acceptable (<100ms queries)
- [ ] Migration from v2 SQLite

---

## ADR-010: Remove Deno Support

**Status:** Proposed
**Date:** 2026-01-03

### Context

v2 attempted to support both Node.js and Deno runtimes. This added complexity without clear benefit.

**Issues:**
- Dual testing required
- Different module systems
- Import path differences
- Limited adoption of Deno version

### Decision

**v3 will support Node.js 20+ only. Deno support removed.**

### Rationale

**Focus on Node.js:**
- Primary user base on Node
- Better ecosystem (npm packages)
- Simpler build and test
- Deno can run Node code via compatibility

**If Deno support needed:**
- Wait for Deno 2.0 full Node compatibility
- Add as plugin in v3.1+

### Migration

```typescript
// Remove Deno-specific code
- src/cli/main.deno.ts ❌
- deno.json ❌
- Deno imports ❌

// Keep Node-only
+ src/cli/main.ts ✅
+ package.json ✅
+ Node imports ✅
```

### Success Metrics

- [ ] All Deno code removed
- [ ] Single test suite (Node only)
- [ ] Build simplified
- [ ] Documentation updated

---

## Decision Framework

For future ADRs, use this template:

### ADR-XXX: [Title]

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** YYYY-MM-DD

#### Context
What is the issue we're trying to solve?

#### Decision
What are we going to do?

#### Rationale
Why this decision? What alternatives did we consider?

#### Consequences
What are the trade-offs?

#### Implementation
How will we do this?

#### Success Metrics
How do we know it worked?

#### Related Decisions
Links to other ADRs

---

## Approval Process

1. **Propose:** Create ADR in Proposed status
2. **Review:** Team discusses (1 week)
3. **Revise:** Incorporate feedback
4. **Accept:** Merge with Accepted status
5. **Implement:** Build according to ADR
6. **Validate:** Check success metrics

---

**Document Maintained By:** Architecture Team
**Last Updated:** 2026-01-05
**Next Review:** After Sprint 4 (2026-02-01)
