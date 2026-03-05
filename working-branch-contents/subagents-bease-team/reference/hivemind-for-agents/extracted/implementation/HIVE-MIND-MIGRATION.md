# Hive-Mind Migration Guide

> Migrating from V2 Hive-Mind to V3 Swarm Coordination

## Overview

V2's Hive-Mind system is a comprehensive multi-agent coordination framework. V3 consolidates this into the `@claude-flow/swarm` module with a unified `SwarmCoordinator` per ADR-003.

## Architecture Comparison

### V2 Hive-Mind Structure
```
v2/src/hive-mind/
├── core/
│   ├── HiveMind.ts        # Main orchestrator
│   ├── Queen.ts           # Strategic coordinator
│   ├── Agent.ts           # Agent base class
│   ├── Memory.ts          # Collective memory
│   └── Communication.ts   # Inter-agent messaging
├── integration/
│   ├── ConsensusEngine.ts # Voting & consensus
│   ├── SwarmOrchestrator.ts
│   └── MCPToolWrapper.ts
└── types.ts
```

### V3 Swarm Structure
```
v3/@claude-flow/swarm/
├── src/
│   ├── unified-coordinator.ts  # Main coordinator (ADR-003)
│   ├── topology-manager.ts     # Topology handling
│   ├── types.ts
│   ├── consensus/
│   │   └── consensus-engine.ts
│   ├── coordination/
│   │   └── coordinator.ts
│   ├── domain/
│   │   ├── entities/
│   │   ├── repositories/
│   │   └── services/
│   └── application/
│       ├── commands/
│       └── services/
```

## Feature Migration Map

### Core Components

| V2 Component | V3 Equivalent | Status |
|--------------|---------------|--------|
| `HiveMind.ts` | `unified-coordinator.ts` | ⚠️ Partial |
| `Queen.ts` | Missing | ❌ Needs implementation |
| `Agent.ts` | `domain/entities/agent.ts` | ✅ Complete |
| `Memory.ts` | `@claude-flow/memory` | ✅ Enhanced |
| `Communication.ts` | `@claude-flow/shared/events` | ✅ Complete |

### Queen Coordinator - MISSING

The V2 Queen provides:
- Strategic decision-making with MCP neural analysis
- Agent capability scoring for task assignment
- Coordination strategies per topology
- Consensus initiation for critical tasks
- Performance pattern training
- Task stall detection and recovery

**Migration Path:**
```typescript
// V3 Implementation needed in @claude-flow/swarm/src/queen-coordinator.ts
export class QueenCoordinator {
  private swarm: UnifiedSwarmCoordinator;
  private neural: NeuralLearningSystem;

  async analyzeTask(task: Task): Promise<TaskAnalysis> {
    // Use ReasoningBank for pattern analysis
    const patterns = await this.neural.retrievePatterns(task.description);
    return this.scoreAgents(task, patterns);
  }

  async selectStrategy(topology: TopologyType): Promise<CoordinationStrategy> {
    const strategies = {
      'hierarchical': 'hierarchical-cascade',
      'mesh': 'mesh-consensus',
      'hierarchical-mesh': 'adaptive-default'
    };
    return strategies[topology] || 'adaptive-default';
  }

  async initiateConsensus(proposal: ConsensusProposal): Promise<ConsensusResult> {
    return this.swarm.consensus.propose(proposal);
  }
}
```

## Topologies

### Supported Topologies

| Topology | V2 | V3 | Migration Notes |
|----------|----|----|-----------------|
| **mesh** | ✅ All-to-all | ✅ All-to-all | Direct migration |
| **hierarchical** | ✅ Tree structure | ✅ Tree structure | Direct migration |
| **ring** | ✅ Circular | ⚠️ Basic | Enhance circular handling |
| **star** | ✅ Central hub | ⚠️ Basic | Enhance hub management |
| **hierarchical-mesh** | ❌ | ✅ V3 only | New hybrid topology |
| **specs-driven** | ✅ Maestro | ❌ Missing | Implement workflow pattern |

### V2 Topology Configuration
```typescript
// V2: v2/src/core/TopologyManager.ts
const topologyConfigs = {
  mesh: {
    connectionType: 'direct',
    reliability: 0.95,
    latencyMs: 50
  },
  hierarchical: {
    connectionType: 'direct+relay',
    reliability: 0.85,
    latencyMs: 100
  },
  ring: {
    connectionType: 'direct',
    reliability: 0.75,
    latencyMs: 75
  },
  star: {
    connectionType: 'direct',
    reliability: 0.70,
    latencyMs: 60
  }
};
```

### V3 Topology Configuration
```typescript
// V3: v3/@claude-flow/swarm/src/topology-manager.ts
const topologyConfigs = {
  mesh: { /* similar */ },
  hierarchical: { /* similar */ },
  'hierarchical-mesh': {
    connectionType: 'hybrid',
    reliability: 0.92,
    latencyMs: 70,
    queenCoordination: true
  }
};
```

## Consensus Algorithms

### Implemented in V3 ✅

```typescript
// V3: v3/@claude-flow/swarm/src/consensus/consensus-engine.ts
export class ConsensusEngine {
  async raft(proposal: Proposal): Promise<ConsensusResult>;
  async byzantine(proposal: Proposal): Promise<ConsensusResult>;
  async simpleMajority(proposal: Proposal): Promise<ConsensusResult>;
  async supermajority(proposal: Proposal): Promise<ConsensusResult>;
  async unanimous(proposal: Proposal): Promise<ConsensusResult>;
}
```

### Missing in V3 ❌

```typescript
// Need to implement:
export class ConsensusEngine {
  // Missing: Performance-weighted voting
  async proofOfLearning(proposal: Proposal): Promise<ConsensusResult> {
    const votes = await this.collectWeightedVotes(proposal);
    const weighted = votes.map(v => ({
      ...v,
      weight: v.agent.performanceScore * v.agent.learningScore
    }));
    return this.tallyWeighted(weighted);
  }

  // Missing: Expertise-weighted
  async qualifiedMajority(proposal: Proposal, expertiseWeights: Map<string, number>): Promise<ConsensusResult>;

  // Missing: Eventually consistent
  async gossip(proposal: Proposal): Promise<ConsensusResult>;
}
```

## Agent Types

### V2 Hive Agent Types
```typescript
// v2/src/cli/agents/hive-agents.ts
const hiveAgentTypes = {
  queen: {
    role: 'Orchestrator and Decision Maker',
    capabilities: ['orchestration', 'consensus', 'decision-making', 'delegation'],
    reliability: 0.95
  },
  worker: {
    role: 'Implementation Specialist',
    capabilities: ['implementation', 'coding', 'testing', 'debugging'],
    reliability: 0.90
  },
  scout: {
    role: 'Research and Exploration',
    capabilities: ['research', 'exploration', 'analysis', 'discovery'],
    reliability: 0.85
  },
  guardian: {
    role: 'Quality Assurance',
    capabilities: ['validation', 'security', 'quality', 'review'],
    reliability: 0.98
  },
  architect: {
    role: 'System Design',
    capabilities: ['design', 'planning', 'architecture', 'patterns'],
    reliability: 0.92
  }
};
```

### V3 Agent Types
```typescript
// v3/@claude-flow/swarm/src/types.ts
// V3 has 15-agent hierarchical mesh but missing hive-specific types
// Need to add hive agent type definitions for backward compatibility
```

**Migration Action:** Add hive agent types to V3 agent type registry.

## CLI Migration

### V2 Hive Commands
```bash
# V2 Commands
npx claude-flow hive --topology mesh --consensus quorum --max-agents 8
npx claude-flow hive-mind init
npx claude-flow hive-mind status
npx claude-flow hive-mind spawn --type queen
npx claude-flow hive-mind task --description "Implement feature"
npx claude-flow hive-mind wizard
npx claude-flow hive-mind pause
npx claude-flow hive-mind resume
npx claude-flow hive-mind stop
npx claude-flow hive-mind ps
npx claude-flow hive-mind optimize-memory
```

### V3 Equivalent Commands
```bash
# V3 Commands (partial coverage)
npx claude-flow swarm init --topology hierarchical-mesh --max-agents 15
npx claude-flow swarm status
npx claude-flow agent spawn --type queen-coordinator

# Missing V3 commands:
# - hive (dedicated hive mode)
# - hive-mind task
# - hive-mind wizard
# - hive-mind pause/resume/stop
# - hive-mind ps
# - hive-mind optimize-memory
```

## MCP Tool Migration

### V2 Hive-Mind MCP Tools
```typescript
// V2 tools from v2/src/mcp/swarm-tools.ts
const hiveMindTools = [
  'dispatch_agent',      // Legacy agent spawn
  'swarm_status',        // Swarm status
  'swarm/create-objective',
  'swarm/execute-objective',  // Missing in V3
  'swarm/get-status',
  'swarm/emergency-stop'      // Missing in V3
];
```

### V3 Swarm MCP Tools
```typescript
// V3 tools from v3/mcp/tools/swarm-tools.ts
const swarmTools = [
  'swarm/init',
  'swarm/status',
  'swarm/scale'    // New in V3
];

// Missing: execute-objective, emergency-stop
```

## Migration Steps

### Step 1: Update Imports
```typescript
// V2
import { HiveMind } from 'claude-flow/hive-mind';
import { Queen } from 'claude-flow/hive-mind/core/Queen';

// V3
import { UnifiedSwarmCoordinator } from '@claude-flow/swarm';
// Queen needs to be implemented
```

### Step 2: Initialize Swarm
```typescript
// V2
const hive = new HiveMind({
  topology: 'hierarchical',
  consensus: 'quorum',
  maxAgents: 8
});
await hive.initialize();
await hive.spawnQueen();

// V3
const swarm = new UnifiedSwarmCoordinator({
  topology: 'hierarchical-mesh',
  maxAgents: 15,
  consensus: 'majority'
});
await swarm.initialize();
// Queen spawn needs implementation
```

### Step 3: Submit Tasks
```typescript
// V2
const task = await hive.submitTask({
  type: 'implementation',
  description: 'Implement feature X',
  priority: 'high',
  consensus: true
});

// V3
const task = await swarm.submitTask({
  type: 'implementation',
  title: 'Implement feature X',
  description: 'Details...',
  priority: 'high'
  // consensus not yet supported
});
```

## Implementation Priorities

### Priority 1 - HIGH
1. **Queen Coordinator** - Strategic decision-making
2. **Proof-of-Learning Consensus** - Performance-weighted voting
3. **Execute Objective** - MCP tool
4. **Emergency Stop** - MCP tool

### Priority 2 - MEDIUM
1. **Specs-Driven Topology** - Maestro workflow
2. **Hive CLI Command** - Full hive mode
3. **Task Wizard** - Interactive task creation
4. **Qualified Majority** - Expertise-weighted consensus

### Priority 3 - LOW
1. **Gossip Consensus** - Eventually consistent
2. **PS Command** - Process listing
3. **Optimize Memory** - Memory optimization command
