# @claude-flow/swarm

[![npm version](https://img.shields.io/npm/v/@claude-flow/swarm.svg)](https://www.npmjs.com/package/@claude-flow/swarm)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/swarm.svg)](https://www.npmjs.com/package/@claude-flow/swarm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![ADR-003](https://img.shields.io/badge/ADR--003-Compliant-green.svg)](https://github.com/ruvnet/claude-flow)
[![Agents](https://img.shields.io/badge/Agents-Up%20to%20100+-orange.svg)](https://github.com/ruvnet/claude-flow)

> V3 Unified Swarm Coordination Module implementing ADR-003: Single Coordination Engine with Hive-Mind Intelligence

## Architecture (ADR-003)

This module provides a **complete multi-agent coordination system** with hive-mind capabilities:

### Key Components

```
@claude-flow/swarm
├── UnifiedSwarmCoordinator ⭐ CANONICAL ENGINE
│   ├── Configurable agent count (default 15, max 100+)
│   ├── Domain-based task routing
│   ├── Parallel execution across domains
│   ├── Multiple consensus algorithms
│   ├── 4 topology types (mesh, hierarchical, centralized, hybrid)
│   └── Performance: <100ms coordination
│
├── QueenCoordinator 👑 HIVE-MIND INTELLIGENCE
│   ├── Strategic task analysis & decomposition
│   ├── Agent capability-based delegation
│   ├── Swarm health monitoring & bottleneck detection
│   ├── 5 consensus types (majority, supermajority, unanimous, weighted, queen-override)
│   └── Learning from outcomes
│
├── AttentionCoordinator 🧠 ATTENTION MECHANISMS
│   ├── Flash Attention (2.49x-7.47x speedup)
│   ├── Multi-Head Attention (8 heads)
│   ├── Linear Attention (O(n) complexity)
│   ├── Hyperbolic Attention (Poincaré hierarchies)
│   ├── Mixture of Experts (MoE) routing
│   └── GraphRoPE (topology-aware positioning)
│
├── FederationHub 🌐 CROSS-SWARM COORDINATION
│   ├── Ephemeral agent spawning with TTL
│   ├── Cross-swarm messaging
│   ├── Federation-wide consensus voting
│   └── Auto-cleanup & heartbeat tracking
│
├── ConsensusEngines 🗳️ DISTRIBUTED AGREEMENT
│   ├── Raft (leader election, log replication)
│   ├── Byzantine (fault-tolerant, 2/3 supermajority)
│   └── Gossip (epidemic protocol for large swarms)
│
└── SwarmHub (deprecated) - Thin facade for backward compatibility
```

## ⚠️ Agent Count: Configurable, Not Limited

The default 15-agent architecture is a **recommendation**, not a hard limit:

```typescript
// Default: 15-agent V3 architecture
const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hierarchical', maxAgents: 15 },
});

// Scale up: 50 agents
const largeCoordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'mesh', maxAgents: 50 },
});

// Maximum: 100+ agents (DEFAULT_MAX_AGENTS = 100)
const enterpriseCoordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hybrid', maxAgents: 100 },
});
```

## Quick Start (Recommended)

```typescript
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';

// Create coordinator
const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hierarchical', maxAgents: 15 },
  consensus: { algorithm: 'raft', threshold: 0.66 },
});

// Initialize
await coordinator.initialize();

// Spawn 15-agent hierarchy
const agents = await coordinator.spawnFullHierarchy();
console.log(`Spawned ${agents.size} agents across 5 domains`);

// Submit tasks to specific domains
const securityTaskId = await coordinator.submitTask({
  type: 'review',
  name: 'CVE Security Audit',
  priority: 'critical',
  maxRetries: 3,
});

await coordinator.assignTaskToDomain(securityTaskId, 'security');

// Parallel execution across domains
const results = await coordinator.executeParallel([
  { task: { type: 'coding', name: 'Core Implementation' }, domain: 'core' },
  { task: { type: 'testing', name: 'Security Tests' }, domain: 'security' },
  { task: { type: 'documentation', name: 'API Docs' }, domain: 'integration' },
]);

console.log(`Completed ${results.filter(r => r.success).length} tasks in parallel`);

// Get swarm status
const status = coordinator.getStatus();
console.log('Domain Status:', status.domains);
console.log('Metrics:', status.metrics);

// Shutdown
await coordinator.shutdown();
```

## 15-Agent Domain Architecture

The coordinator manages 5 domains with specific agent assignments:

| Domain | Agents | Capabilities |
|--------|--------|--------------|
| **Queen** | 1 | Top-level coordination, consensus, planning |
| **Security** | 2-4 | Security architecture, CVE fixes, threat modeling |
| **Core** | 5-9 | DDD design, memory unification, type modernization |
| **Integration** | 10-12 | agentic-flow integration, CLI, neural features |
| **Support** | 13-15 | TDD testing, performance, deployment |

### Domain-Based Task Routing

```typescript
// Route tasks to optimal domains
await coordinator.assignTaskToDomain(securityTask, 'security');
await coordinator.assignTaskToDomain(coreTask, 'core');
await coordinator.assignTaskToDomain(integrationTask, 'integration');

// Get agents by domain
const securityAgents = coordinator.getAgentsByDomain('security');
console.log(`Security domain has ${securityAgents.length} agents`);

// Get domain status
const status = coordinator.getStatus();
status.domains.forEach(domain => {
  console.log(`${domain.name}: ${domain.availableAgents}/${domain.agentCount} available`);
});
```

## Parallel Execution

Execute tasks across multiple domains simultaneously for maximum throughput:

```typescript
const tasks = [
  { task: { type: 'coding', name: 'Implement Auth' }, domain: 'core' },
  { task: { type: 'testing', name: 'Security Tests' }, domain: 'security' },
  { task: { type: 'review', name: 'Code Review' }, domain: 'support' },
];

const results = await coordinator.executeParallel(tasks);

// Check results
results.forEach(result => {
  if (result.success) {
    console.log(`✅ ${result.domain}: ${result.durationMs}ms`);
  } else {
    console.error(`❌ ${result.domain}: ${result.error?.message}`);
  }
});
```

## Topology Support

Choose the coordination pattern that fits your needs:

| Topology | Best For | Scalability | Latency |
|----------|----------|-------------|---------|
| **Hierarchical** | Queen-led swarms | O(n), up to 100+ | 15-35ms |
| **Mesh** | Distributed workloads | O(n²), up to 20 | 10-40ms |
| **Centralized** | Simple coordination | O(n), up to 50 | 10-20ms |
| **Hybrid** | Large mixed workloads | O(n), up to 200 | 20-50ms |

### Hierarchical (Default)
```typescript
const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hierarchical', maxAgents: 15 },
});
```
- Queen agent coordinates domain leads
- Domain leads manage worker agents
- Best for domain-organized V3 architecture

### Mesh
```typescript
const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'mesh', maxAgents: 20 },
});
```
- Limited peer-to-peer connections (max ~10 per node)
- No central coordinator
- Best for distributed workloads under 20 agents

### Centralized
```typescript
const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'centralized', maxAgents: 50 },
});
```
- Single coordinator hub manages all agents
- Simplest to reason about
- Best for small to medium swarms

### Hybrid (Best for Scale)
```typescript
const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hybrid', maxAgents: 100 },
});
```
- Mesh workers + hierarchical coordinators
- Combines benefits of both patterns
- Best for large-scale enterprise deployments

## Consensus Algorithms

Choose how agents reach agreement:

### Raft (Default)
```typescript
const coordinator = createUnifiedSwarmCoordinator({
  consensus: { algorithm: 'raft', threshold: 0.66 },
});
```
- Leader-based consensus
- Strong consistency guarantees
- Target: <100ms consensus time

### Byzantine Fault Tolerance
```typescript
const coordinator = createUnifiedSwarmCoordinator({
  consensus: { algorithm: 'byzantine', threshold: 0.66 },
});
```
- Handles malicious agents
- Byzantine fault tolerance
- Higher overhead but more secure

### Gossip Protocol
```typescript
const coordinator = createUnifiedSwarmCoordinator({
  consensus: { algorithm: 'gossip', threshold: 0.66 },
});
```
- Eventual consistency
- Low overhead
- Best for large swarms

## Performance Targets

The coordinator is optimized for V3 performance requirements:

| Metric | Target | Actual |
|--------|--------|--------|
| Coordination Latency | <100ms | Verified in tests |
| Consensus Time | <100ms | Verified in tests |
| Message Throughput | >1000 msgs/sec | Verified in tests |
| Agent Utilization | >85% | Achieved via parallel execution |

### Performance Monitoring

```typescript
const report = coordinator.getPerformanceReport();

console.log('Coordination Latency:', {
  p50: report.coordinationLatencyP50,
  p99: report.coordinationLatencyP99,
});

console.log('Throughput:', {
  messagesPerSec: report.messagesPerSecond,
  tasksPerSec: report.taskThroughput,
});

console.log('Utilization:', {
  agentUtilization: report.agentUtilization,
  consensusSuccessRate: report.consensusSuccessRate,
});
```

## Backward Compatibility (SwarmHub)

For existing code using `SwarmHub`, the compatibility layer is maintained:

```typescript
import { createSwarmHub } from '@claude-flow/swarm';

// ⚠️ DEPRECATED: Use createUnifiedSwarmCoordinator() instead
const hub = createSwarmHub();
await hub.initialize();

// SwarmHub delegates all operations to UnifiedSwarmCoordinator
const coordinator = hub.getCoordinator();

// Use coordinator for advanced features
await coordinator.executeParallel(tasks);
```

### Migration from SwarmHub

```typescript
// OLD (deprecated)
import { createSwarmHub } from '@claude-flow/swarm';
const hub = createSwarmHub();
await hub.initialize();
await hub.spawnAllAgents();

// NEW (recommended)
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';
const coordinator = createUnifiedSwarmCoordinator();
await coordinator.initialize();
await coordinator.spawnFullHierarchy();
```

## Hive-Mind Intelligence (Queen Coordinator)

The Queen Coordinator provides intelligent task orchestration:

```typescript
import { createQueenCoordinator } from '@claude-flow/swarm';

const queen = createQueenCoordinator({
  swarmCoordinator: coordinator,
  // Optional: connect to neural learning system
  // neuralSystem: myNeuralSystem,
  // memoryService: myMemoryService,
});

// Analyze a complex task
const analysis = await queen.analyzeTask({
  id: 'task-1',
  type: 'security-audit',
  description: 'Comprehensive CVE audit of authentication system',
});

console.log('Task Analysis:', {
  complexity: analysis.complexity,        // 'low' | 'medium' | 'high' | 'critical'
  estimatedDuration: analysis.estimatedDuration,
  requiredCapabilities: analysis.requiredCapabilities,
  suggestedSubtasks: analysis.subtasks,
});

// Delegate to optimal agents
const plan = await queen.delegateToAgents(task, analysis);
console.log('Delegation Plan:', {
  primaryAgent: plan.primaryAgent,
  backupAgents: plan.backupAgents,
  parallelAssignments: plan.parallelAssignments,
});

// Monitor swarm health
const health = await queen.monitorSwarmHealth();
console.log('Health Report:', {
  overallStatus: health.status,
  bottlenecks: health.bottlenecks,
  alerts: health.alerts,
  recommendations: health.recommendations,
});

// Coordinate consensus with 5 types
const decision = await queen.coordinateConsensus({
  type: 'deployment',
  value: { version: '3.0.0', environment: 'production' },
  consensusType: 'supermajority', // 'majority' | 'supermajority' | 'unanimous' | 'weighted' | 'queen-override'
});
```

## Attention Mechanisms

Six attention mechanisms for intelligent agent coordination:

```typescript
import { createAttentionCoordinator } from '@claude-flow/swarm';

const attention = createAttentionCoordinator({
  topology: coordinator.getTopology(),
});

// Flash Attention - 2.49x-7.47x speedup for long sequences
const flashResult = await attention.coordinate(agents, task, { type: 'flash' });

// Multi-Head Attention - 8 parallel attention heads
const multiHeadResult = await attention.coordinate(agents, task, { type: 'multi-head' });

// Linear Attention - O(n) complexity for very long sequences
const linearResult = await attention.coordinate(agents, task, { type: 'linear' });

// Hyperbolic Attention - Poincaré distance for hierarchies
const hyperbolicResult = await attention.coordinate(agents, task, { type: 'hyperbolic' });

// Mixture of Experts - Route to top-k best agents
const moeResult = await attention.coordinate(agents, task, {
  type: 'moe',
  topK: 3,
  loadBalancing: true,
});

// GraphRoPE - Topology-aware position encoding
const graphResult = await attention.coordinate(agents, task, { type: 'graph-rope' });
```

## Federation Hub (Cross-Swarm Coordination)

Coordinate multiple swarms with ephemeral agents:

```typescript
import { createFederationHub, getDefaultFederationHub } from '@claude-flow/swarm';

// Get singleton hub or create custom
const hub = getDefaultFederationHub();
// or: const hub = createFederationHub({ maxSwarms: 10 });

// Register swarms
await hub.registerSwarm('swarm-security', {
  coordinator: securityCoordinator,
  capabilities: ['security-audit', 'penetration-testing'],
});

await hub.registerSwarm('swarm-dev', {
  coordinator: devCoordinator,
  capabilities: ['coding', 'testing', 'review'],
});

// Spawn ephemeral agent (auto-cleanup after TTL)
const { agentId } = await hub.spawnEphemeral({
  swarmId: 'swarm-security',
  ttlMs: 300000, // 5 minutes
  task: { type: 'quick-audit', target: 'auth-module' },
});

// Cross-swarm messaging
await hub.sendMessage({
  from: 'swarm-dev',
  to: 'swarm-security',
  type: 'audit-request',
  payload: { module: 'auth', priority: 'high' },
});

// Federation-wide consensus
const vote = await hub.proposeConsensus({
  topic: 'release-v3',
  options: ['approve', 'reject', 'defer'],
  timeout: 30000,
});

// Get federation stats
const stats = hub.getStats();
console.log('Federation:', {
  swarms: stats.swarmCount,
  ephemeralAgents: stats.ephemeralAgentCount,
  messagesSent: stats.messageCount,
});
```

## Advanced Features

### Agent Pool Management

```typescript
// Get domain-specific pool
const corePool = coordinator.getDomainPool('core');
const stats = corePool?.getPoolStats();

console.log('Core Domain Pool:', {
  total: stats?.total,
  available: stats?.available,
  busy: stats?.busy,
});

// Auto-scaling is built-in
// - Scale up at 80% utilization
// - Scale down at 20% utilization
```

### Custom Agent Registration

```typescript
// Register agent with automatic domain assignment
const { agentId, domain } = await coordinator.registerAgentWithDomain(
  {
    name: 'security-agent-2',
    type: 'specialist',
    status: 'idle',
    capabilities: {
      codeReview: true,
      securityAudit: true,
    },
    // ... other agent properties
  },
  2 // Agent number 2 → security domain
);

console.log(`Registered ${agentId} in ${domain} domain`);
```

### Event Monitoring

```typescript
coordinator.on('agent.joined', (event) => {
  console.log('Agent joined:', event.data.agentId);
});

coordinator.on('task.completed', (event) => {
  console.log('Task completed:', event.data.taskId);
});

coordinator.on('consensus.achieved', (event) => {
  console.log('Consensus achieved:', event.data.approvalRate);
});

coordinator.on('swarm.initialized', (event) => {
  console.log('Swarm initialized:', event.data.swarmId);
});
```

## API Reference

### UnifiedSwarmCoordinator

#### Lifecycle
- `initialize(): Promise<void>` - Initialize coordinator
- `shutdown(): Promise<void>` - Shutdown coordinator
- `pause(): Promise<void>` - Pause operations
- `resume(): Promise<void>` - Resume operations

#### Agent Management
- `registerAgent(agent): Promise<string>` - Register agent
- `registerAgentWithDomain(agent, number): Promise<{agentId, domain}>` - Register with domain
- `unregisterAgent(id): Promise<void>` - Unregister agent
- `spawnFullHierarchy(): Promise<Map<number, {agentId, domain}>>` - Spawn 15 agents
- `getAgent(id): AgentState | undefined` - Get agent by ID
- `getAllAgents(): AgentState[]` - Get all agents
- `getAgentsByDomain(domain): AgentState[]` - Get agents in domain

#### Task Management
- `submitTask(task): Promise<string>` - Submit task
- `assignTaskToDomain(taskId, domain): Promise<string | undefined>` - Assign to domain
- `executeParallel(tasks): Promise<ParallelExecutionResult[]>` - Parallel execution
- `cancelTask(taskId): Promise<void>` - Cancel task
- `getTask(id): TaskDefinition | undefined` - Get task by ID

#### Coordination
- `proposeConsensus(value): Promise<ConsensusResult>` - Propose consensus
- `broadcastMessage(payload, priority): Promise<void>` - Broadcast message

#### Monitoring
- `getState(): CoordinatorState` - Get current state
- `getMetrics(): CoordinatorMetrics` - Get metrics
- `getPerformanceReport(): PerformanceReport` - Get performance stats
- `getStatus(): {swarmId, status, domains, metrics}` - Get comprehensive status

## Integration with agentic-flow@alpha

This module can integrate with agentic-flow@alpha for enhanced capabilities:

```typescript
import { createUnifiedSwarmCoordinator } from '@claude-flow/swarm';
import { AgenticFlowBridge } from '@claude-flow/integration';

// Connect to agentic-flow for enhanced features
const bridge = new AgenticFlowBridge({
  agenticFlow: { version: 'alpha' },
});

const coordinator = createUnifiedSwarmCoordinator({
  topology: { type: 'hierarchical', maxAgents: 15 },
  // Enable agentic-flow features via bridge
  extensions: {
    transport: bridge.getQuicTransport(),     // QUIC 0-RTT
    learning: bridge.getSwarmLearningOptimizer(),
  },
});
```

### Available from agentic-flow@alpha

| Feature | Status | Description |
|---------|--------|-------------|
| QUIC Transport | 🔌 Via bridge | 0-RTT connections, 50-70% faster |
| Swarm Learning Optimizer | 🔌 Via bridge | Auto topology recommendations |
| E2B Sandbox Agents | 🔌 Via bridge | Isolated execution environments |
| P2P with GunDB/IPFS | 🔌 Via bridge | Free decentralized coordination |
| WASM Acceleration | ⏳ Planned | HNSW indexing, semantic routing |

## Roadmap: Future Enhancements

Based on agentic-flow@alpha capabilities that could be integrated:

### Priority 1 (High Impact)
- [ ] Native QUIC transport with HTTP/2 fallback
- [ ] Swarm learning optimizer for auto-topology
- [ ] Free P2P provider integration (GunDB, IPFS)

### Priority 2 (Medium Impact)
- [ ] WASM-accelerated member indexing
- [ ] E2B sandbox agent specialization
- [ ] Enhanced message types with fuel/memory budgets

### Priority 3 (Nice to Have)
- [ ] Advanced gossip variants
- [ ] CRDT synchronization
- [ ] Production-grade Ed25519/X25519 cryptography

## Contributing

This module follows ADR-003: Single Coordination Engine. When contributing:

1. **All coordination logic** goes in `UnifiedSwarmCoordinator`
2. **SwarmHub** is a thin facade - no new logic there
3. **Domain-based routing** should be used for organized hierarchies
4. **Performance targets** must be maintained (<100ms coordination)
5. **New features** should integrate via the extensions API

## License

MIT

---

**ADR-003 Compliance**: This module implements a single canonical coordination engine with hive-mind intelligence, 6 attention mechanisms, federation support, and backward compatibility via facade pattern.
