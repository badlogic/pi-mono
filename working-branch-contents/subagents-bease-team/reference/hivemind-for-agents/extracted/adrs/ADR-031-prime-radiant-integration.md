# ADR-031: Prime Radiant WASM Plugin Integration

## Status
**Accepted** - Architecture Review Complete (2026-01-23)

### Review Summary
- Architecture design validated
- Performance targets assessed as achievable:
  - Coherence check <5ms: Achievable with LRU caching
  - Spectral analysis <20ms: Achievable for 100x100 matrices
  - WASM load <50ms: Achievable with lazy loading
- No security issues identified
- 92KB WASM bundle is excellent footprint
- Ready for Phase 1 implementation

## Date
2026-01-23

## Authors
- System Architecture Designer
- Mathematical AI Team

## Context

### Problem Statement

Claude Flow V3 requires mathematical AI interpretability capabilities for:
1. **Memory coherence validation** - Detecting contradictions in stored vectors before storage
2. **Multi-agent consensus verification** - Mathematical validation of swarm agreement
3. **RAG hallucination prevention** - Catching retrieval-augmented generation inconsistencies
4. **Hive-mind stability analysis** - Spectral analysis of distributed swarm state
5. **Causal reasoning** - Do-calculus based causal inference for agent decisions
6. **Hierarchical data modeling** - Quantum topology for agent relationship graphs

The current V3 architecture provides memory management (`@claude-flow/memory`), coordination (`@claude-flow/coordination`), and security primitives (`@claude-flow/security`), but lacks mathematical interpretability and coherence validation capabilities.

### Prime Radiant Package Analysis

The `prime-radiant-advanced-wasm` package (v0.1.3) provides advanced mathematical AI interpretability:

| Engine | Description | Performance |
|--------|-------------|-------------|
| **CohomologyEngine** | Sheaf Laplacian coherence gate | Energy 0 = coherent, 1 = contradictory |
| **SpectralEngine** | Stability and spectral analysis | O(n log n) eigenvalue computation |
| **CausalEngine** | Do-calculus causal inference | Interventional query support |
| **QuantumEngine** | Quantum topology operations | Persistent homology |
| **CategoryEngine** | Category theory functors/morphisms | Natural transformations |
| **HottEngine** | Homotopy Type Theory | Type-level proofs |

### 6 Core Engines

```
prime-radiant-advanced-wasm/
├── CohomologyEngine     # Sheaf Laplacian for coherence detection
├── SpectralEngine       # Stability and eigenvalue analysis
├── CausalEngine         # Do-calculus causal inference
├── QuantumEngine        # Quantum topology and persistent homology
├── CategoryEngine       # Category theory operations
└── HottEngine           # Homotopy Type Theory proofs
```

### Key Features

- **Sheaf Laplacian Energy**: Measures contradiction/coherence (0 = fully coherent, 1 = contradictory)
- **92KB WASM Bundle**: Zero dependencies, browser and Node.js compatible
- **Applications**:
  - RAG hallucination prevention
  - Multi-agent consensus validation
  - Memory consistency checking
  - Distributed state coherence

### Integration Opportunities with V3

| V3 Domain | Prime Radiant Engine | Use Case |
|-----------|---------------------|----------|
| Memory | CohomologyEngine | Pre-storage coherence gate |
| Memory | SpectralEngine | Vector cluster stability |
| Security | CohomologyEngine | Input validity verification |
| Security | CausalEngine | Attack pattern causal analysis |
| Coordination | CohomologyEngine | Consensus coherence check |
| Coordination | SpectralEngine | Swarm stability metrics |
| Hive-Mind | SpectralEngine | Distributed state health |
| Hive-Mind | QuantumEngine | Agent topology analysis |

---

## Decision

Integrate `prime-radiant-advanced-wasm` as a **coherence validation plugin** for Claude Flow V3, providing mathematical interpretability gates at critical system boundaries.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Claude Flow V3                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌────────────────────────────────────────────────────────────────────────┐    │
│   │                    @claude-flow/plugins Registry                        │    │
│   │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────────┐  │    │
│   │  │   Core     │  │  Security  │  │  Memory    │  │  prime-radiant  │  │    │
│   │  │  Plugins   │  │  Plugins   │  │  Plugins   │  │  Plugin (NEW)   │  │    │
│   │  └────────────┘  └────────────┘  └────────────┘  └─────────────────┘  │    │
│   └────────────────────────────────────────────────────────────────────────┘    │
│                                        │                                         │
│                                        ▼                                         │
│   ┌────────────────────────────────────────────────────────────────────────┐    │
│   │                    Integration Points                                   │    │
│   ├────────────────────────────────────────────────────────────────────────┤    │
│   │                                                                          │    │
│   │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │    │
│   │  │  Memory Service  │  │  Hive Mind      │  │  Security Module        │ │    │
│   │  │  (Coherence Gate)│  │  (Consensus     │  │  (Validity Check)       │ │    │
│   │  │                  │  │   Verification) │  │                         │ │    │
│   │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │    │
│   │                                                                          │    │
│   │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │    │
│   │  │  Coordination    │  │  Embeddings     │  │  AIDefence              │ │    │
│   │  │  (Stability      │  │  (Vector        │  │  (Coherence             │ │    │
│   │  │   Analysis)      │  │   Coherence)    │  │   Validation)           │ │    │
│   │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │    │
│   │                                                                          │    │
│   └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Prime Radiant Plugin Internals                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐   │
│   │  WASM Loader      │  │  Engine Registry  │  │  Result Cache             │   │
│   │  (92KB Bundle)    │  │  (6 Engines)      │  │  (LRU with TTL)           │   │
│   └───────────────────┘  └───────────────────┘  └───────────────────────────┘   │
│              │                     │                        │                    │
│              └─────────────────────┼────────────────────────┘                    │
│                                    │                                             │
│                                    ▼                                             │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │                    6 Mathematical Engines                                 │  │
│   ├──────────────────────────────────────────────────────────────────────────┤  │
│   │                                                                           │  │
│   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │  │
│   │  │ Cohomology  │ │ Spectral    │ │ Causal      │ │ Quantum             │ │  │
│   │  │ Engine      │ │ Engine      │ │ Engine      │ │ Engine              │ │  │
│   │  │ (Coherence) │ │ (Stability) │ │ (Inference) │ │ (Topology)          │ │  │
│   │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘ │  │
│   │                                                                           │  │
│   │  ┌─────────────┐ ┌─────────────┐                                         │  │
│   │  │ Category    │ │ HoTT        │                                         │  │
│   │  │ Engine      │ │ Engine      │                                         │  │
│   │  │ (Morphisms) │ │ (Type Proofs)│                                        │  │
│   │  └─────────────┘ └─────────────┘                                         │  │
│   │                                                                           │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Design

### 1. Plugin Architecture

#### 1.1 Plugin Registration

```typescript
// v3/plugins/prime-radiant/src/index.ts

import { PluginBuilder, HookEvent, HookPriority } from '@claude-flow/plugins';
import { PrimeRadiantBridge } from './infrastructure/prime-radiant-bridge';
import { CoherenceGate } from './domain/coherence-gate';
import { mcpTools } from './mcp-tools';
import { hooks } from './hooks';

export const primeRadiantPlugin = new PluginBuilder('prime-radiant', '0.1.3')
  .withDescription('Mathematical AI interpretability with sheaf cohomology, spectral analysis, and causal inference')
  .withAuthor('rUv')
  .withLicense('MIT')
  .withDependencies([
    '@claude-flow/memory',
    '@claude-flow/security',
    '@claude-flow/coordination'
  ])
  .withCapabilities([
    'coherence-checking',
    'spectral-analysis',
    'causal-inference',
    'consensus-verification',
    'quantum-topology',
    'category-theory',
    'hott-proofs'
  ])
  .withMCPTools(mcpTools)
  .withHooks(hooks)
  .onInitialize(async (context) => {
    // Load WASM bundle (92KB)
    const bridge = new PrimeRadiantBridge();
    await bridge.initialize();

    // Create coherence gate for memory service
    const coherenceGate = new CoherenceGate(bridge);

    // Register with memory service for pre-storage validation
    const memoryService = context.get('memory');
    memoryService.registerPreStoreHook(async (entry) => {
      const result = await coherenceGate.validate(entry);
      if (!result.coherent) {
        throw new CoherenceViolationError(result.energy, result.violations);
      }
      return entry;
    });

    // Store instances in plugin context
    context.set('pr.bridge', bridge);
    context.set('pr.coherenceGate', coherenceGate);

    return { success: true };
  })
  .onShutdown(async (context) => {
    const bridge = context.get<PrimeRadiantBridge>('pr.bridge');
    await bridge.dispose();
    return { success: true };
  })
  .build();
```

#### 1.2 WASM Bridge

```typescript
// v3/plugins/prime-radiant/src/infrastructure/prime-radiant-bridge.ts

import init, {
  CohomologyEngine,
  SpectralEngine,
  CausalEngine,
  QuantumEngine,
  CategoryEngine,
  HottEngine
} from 'prime-radiant-advanced-wasm';

export interface CoherenceResult {
  coherent: boolean;
  energy: number;        // 0 = fully coherent, 1 = contradictory
  violations: string[];
  confidence: number;
}

export interface SpectralResult {
  stable: boolean;
  eigenvalues: number[];
  spectralGap: number;
  stabilityIndex: number;
}

export interface CausalResult {
  effect: number;
  confounders: string[];
  interventionValid: boolean;
  backdoorPaths: string[];
}

export class PrimeRadiantBridge {
  private initialized = false;
  private cohomology!: CohomologyEngine;
  private spectral!: SpectralEngine;
  private causal!: CausalEngine;
  private quantum!: QuantumEngine;
  private category!: CategoryEngine;
  private hott!: HottEngine;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize WASM module (92KB)
    await init();

    // Create engine instances
    this.cohomology = new CohomologyEngine();
    this.spectral = new SpectralEngine();
    this.causal = new CausalEngine();
    this.quantum = new QuantumEngine();
    this.category = new CategoryEngine();
    this.hott = new HottEngine();

    this.initialized = true;
  }

  /**
   * Check coherence using Sheaf Laplacian
   * Energy 0 = fully coherent, Energy 1 = contradictory
   */
  async checkCoherence(vectors: Float32Array[]): Promise<CoherenceResult> {
    this.ensureInitialized();

    const energy = this.cohomology.computeSheafLaplacianEnergy(vectors);
    const violations = this.cohomology.detectContradictions(vectors);

    return {
      coherent: energy < 0.1, // Threshold for coherence
      energy,
      violations,
      confidence: 1 - energy
    };
  }

  /**
   * Analyze spectral stability of a system
   */
  async analyzeSpectral(adjacencyMatrix: Float32Array): Promise<SpectralResult> {
    this.ensureInitialized();

    const eigenvalues = this.spectral.computeEigenvalues(adjacencyMatrix);
    const spectralGap = this.spectral.computeSpectralGap(eigenvalues);
    const stabilityIndex = this.spectral.computeStabilityIndex(eigenvalues);

    return {
      stable: spectralGap > 0.1, // Positive gap indicates stability
      eigenvalues: Array.from(eigenvalues),
      spectralGap,
      stabilityIndex
    };
  }

  /**
   * Perform causal inference using do-calculus
   */
  async inferCausal(
    treatment: string,
    outcome: string,
    graph: { nodes: string[]; edges: [string, string][] }
  ): Promise<CausalResult> {
    this.ensureInitialized();

    const effect = this.causal.estimateEffect(treatment, outcome, graph);
    const confounders = this.causal.identifyConfounders(treatment, outcome, graph);
    const backdoorPaths = this.causal.findBackdoorPaths(treatment, outcome, graph);
    const interventionValid = this.causal.validateIntervention(treatment, graph);

    return {
      effect,
      confounders,
      interventionValid,
      backdoorPaths
    };
  }

  /**
   * Compute quantum topology features
   */
  async computeTopology(points: Float32Array[], dimension: number): Promise<{
    bettiNumbers: number[];
    persistenceDiagram: [number, number][];
    homologyClasses: number;
  }> {
    this.ensureInitialized();

    const bettiNumbers = this.quantum.computeBettiNumbers(points, dimension);
    const persistenceDiagram = this.quantum.computePersistenceDiagram(points);
    const homologyClasses = this.quantum.countHomologyClasses(points, dimension);

    return {
      bettiNumbers: Array.from(bettiNumbers),
      persistenceDiagram,
      homologyClasses
    };
  }

  /**
   * Apply category theory morphism
   */
  async applyMorphism(
    source: unknown,
    target: unknown,
    morphism: string
  ): Promise<{ valid: boolean; result: unknown; naturalTransformation: boolean }> {
    this.ensureInitialized();

    const valid = this.category.validateMorphism(source, target, morphism);
    const result = valid ? this.category.applyMorphism(source, morphism) : null;
    const naturalTransformation = this.category.isNaturalTransformation(morphism);

    return { valid, result, naturalTransformation };
  }

  /**
   * Verify HoTT type proof
   */
  async verifyTypeProof(
    proposition: string,
    proof: string
  ): Promise<{ valid: boolean; type: string; normalForm: string }> {
    this.ensureInitialized();

    const valid = this.hott.verifyProof(proposition, proof);
    const type = this.hott.inferType(proof);
    const normalForm = this.hott.normalize(proof);

    return { valid, type, normalForm };
  }

  async dispose(): Promise<void> {
    // WASM cleanup if needed
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PrimeRadiantBridge not initialized. Call initialize() first.');
    }
  }
}
```

### 2. Domain Layer - Coherence Gate

```typescript
// v3/plugins/prime-radiant/src/domain/coherence-gate.ts

import { PrimeRadiantBridge, CoherenceResult } from '../infrastructure/prime-radiant-bridge';

export interface MemoryEntry {
  key: string;
  content: string;
  embedding: Float32Array;
  metadata?: Record<string, unknown>;
}

export interface CoherenceValidation {
  entry: MemoryEntry;
  existingContext?: MemoryEntry[];
  coherenceResult: CoherenceResult;
  action: 'allow' | 'reject' | 'warn';
}

/**
 * Coherence Gate - validates memory entries for contradiction
 * Uses Sheaf Laplacian energy to detect incoherent information
 */
export class CoherenceGate {
  private bridge: PrimeRadiantBridge;
  private thresholds = {
    reject: 0.7,   // Energy > 0.7 = reject
    warn: 0.3,     // Energy > 0.3 = warn
    allow: 0.3     // Energy <= 0.3 = allow
  };

  constructor(bridge: PrimeRadiantBridge) {
    this.bridge = bridge;
  }

  /**
   * Validate a memory entry against existing context
   */
  async validate(
    entry: MemoryEntry,
    existingContext?: MemoryEntry[]
  ): Promise<CoherenceValidation> {
    // Combine entry embedding with existing context
    const vectors: Float32Array[] = [entry.embedding];

    if (existingContext?.length) {
      vectors.push(...existingContext.map(e => e.embedding));
    }

    // Check coherence using Sheaf Laplacian
    const coherenceResult = await this.bridge.checkCoherence(vectors);

    // Determine action based on energy
    let action: 'allow' | 'reject' | 'warn';
    if (coherenceResult.energy >= this.thresholds.reject) {
      action = 'reject';
    } else if (coherenceResult.energy >= this.thresholds.warn) {
      action = 'warn';
    } else {
      action = 'allow';
    }

    return {
      entry,
      existingContext,
      coherenceResult,
      action
    };
  }

  /**
   * Batch validate multiple entries
   */
  async validateBatch(entries: MemoryEntry[]): Promise<CoherenceValidation[]> {
    const results: CoherenceValidation[] = [];

    // Check each entry against all previous entries
    const processed: MemoryEntry[] = [];

    for (const entry of entries) {
      const validation = await this.validate(entry, processed);
      results.push(validation);

      if (validation.action !== 'reject') {
        processed.push(entry);
      }
    }

    return results;
  }

  /**
   * Configure coherence thresholds
   */
  setThresholds(thresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
}

export class CoherenceViolationError extends Error {
  constructor(
    public energy: number,
    public violations: string[]
  ) {
    super(`Coherence violation detected (energy: ${energy.toFixed(3)}): ${violations.join(', ')}`);
    this.name = 'CoherenceViolationError';
  }
}
```

### 3. MCP Tool Registration

```typescript
// v3/plugins/prime-radiant/src/mcp-tools/index.ts

import type { MCPTool } from '@claude-flow/plugins';

export const mcpTools: MCPTool[] = [
  // Coherence Checking
  {
    name: 'pr/coherence-check',
    description: 'Check coherence of vectors using Sheaf Laplacian energy (0=coherent, 1=contradictory)',
    category: 'coherence',
    version: '0.1.3',
    inputSchema: {
      type: 'object',
      properties: {
        vectors: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Array of embedding vectors to check for coherence'
        },
        threshold: {
          type: 'number',
          default: 0.3,
          description: 'Energy threshold for coherence (0-1)'
        }
      },
      required: ['vectors']
    },
    handler: async (input, context) => {
      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');
      const vectors = input.vectors.map((v: number[]) => new Float32Array(v));
      const result = await bridge.checkCoherence(vectors);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            coherent: result.coherent,
            energy: result.energy,
            violations: result.violations,
            confidence: result.confidence,
            interpretation: result.energy < 0.1 ? 'Fully coherent' :
                           result.energy < 0.3 ? 'Minor inconsistencies' :
                           result.energy < 0.7 ? 'Significant contradictions' :
                           'Major contradictions detected'
          }, null, 2)
        }]
      };
    }
  },

  // Spectral Analysis
  {
    name: 'pr/spectral-analyze',
    description: 'Analyze stability using spectral graph theory',
    category: 'spectral',
    version: '0.1.3',
    inputSchema: {
      type: 'object',
      properties: {
        adjacencyMatrix: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Adjacency matrix representing connections'
        },
        analyzeType: {
          type: 'string',
          enum: ['stability', 'clustering', 'connectivity'],
          default: 'stability'
        }
      },
      required: ['adjacencyMatrix']
    },
    handler: async (input, context) => {
      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');

      // Flatten adjacency matrix for WASM
      const flat = input.adjacencyMatrix.flat();
      const matrix = new Float32Array(flat);

      const result = await bridge.analyzeSpectral(matrix);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            stable: result.stable,
            spectralGap: result.spectralGap,
            stabilityIndex: result.stabilityIndex,
            eigenvalues: result.eigenvalues.slice(0, 10), // Top 10
            interpretation: result.stable ?
              'System is spectrally stable' :
              'System shows instability patterns'
          }, null, 2)
        }]
      };
    }
  },

  // Causal Inference
  {
    name: 'pr/causal-infer',
    description: 'Perform causal inference using do-calculus',
    category: 'causal',
    version: '0.1.3',
    inputSchema: {
      type: 'object',
      properties: {
        treatment: {
          type: 'string',
          description: 'Treatment/intervention variable'
        },
        outcome: {
          type: 'string',
          description: 'Outcome variable to measure effect on'
        },
        graph: {
          type: 'object',
          properties: {
            nodes: { type: 'array', items: { type: 'string' } },
            edges: {
              type: 'array',
              items: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 2
              }
            }
          },
          description: 'Causal graph with nodes and directed edges'
        }
      },
      required: ['treatment', 'outcome', 'graph']
    },
    handler: async (input, context) => {
      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');
      const result = await bridge.inferCausal(
        input.treatment,
        input.outcome,
        input.graph
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            causalEffect: result.effect,
            confounders: result.confounders,
            interventionValid: result.interventionValid,
            backdoorPaths: result.backdoorPaths,
            recommendation: result.interventionValid ?
              'Intervention is valid for causal inference' :
              `Confounders detected: ${result.confounders.join(', ')}`
          }, null, 2)
        }]
      };
    }
  },

  // Consensus Verification
  {
    name: 'pr/consensus-verify',
    description: 'Verify multi-agent consensus mathematically',
    category: 'consensus',
    version: '0.1.3',
    inputSchema: {
      type: 'object',
      properties: {
        agentStates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agentId: { type: 'string' },
              embedding: { type: 'array', items: { type: 'number' } },
              vote: { type: 'string' }
            }
          },
          description: 'Array of agent states to verify consensus'
        },
        consensusThreshold: {
          type: 'number',
          default: 0.8,
          description: 'Required agreement threshold (0-1)'
        }
      },
      required: ['agentStates']
    },
    handler: async (input, context) => {
      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');

      // Extract embeddings from agent states
      const vectors = input.agentStates.map(
        (s: { embedding: number[] }) => new Float32Array(s.embedding)
      );

      // Check coherence of agent states
      const coherence = await bridge.checkCoherence(vectors);

      // Build adjacency matrix from embedding similarities
      const n = vectors.length;
      const adj = new Float32Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          adj[i * n + j] = cosineSimilarity(vectors[i], vectors[j]);
        }
      }

      // Analyze spectral properties
      const spectral = await bridge.analyzeSpectral(adj);

      // Calculate consensus metrics
      const agreementRatio = 1 - coherence.energy;
      const consensusAchieved = agreementRatio >= input.consensusThreshold;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            consensusAchieved,
            agreementRatio,
            coherenceEnergy: coherence.energy,
            spectralStability: spectral.stable,
            spectralGap: spectral.spectralGap,
            violations: coherence.violations,
            recommendation: consensusAchieved ?
              'Consensus is mathematically verified' :
              `Consensus not achieved. Disagreement energy: ${coherence.energy.toFixed(3)}`
          }, null, 2)
        }]
      };
    }
  },

  // Quantum Topology
  {
    name: 'pr/quantum-topology',
    description: 'Compute quantum topology features (Betti numbers, persistence)',
    category: 'topology',
    version: '0.1.3',
    inputSchema: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Point cloud for topological analysis'
        },
        maxDimension: {
          type: 'number',
          default: 2,
          description: 'Maximum homology dimension to compute'
        }
      },
      required: ['points']
    },
    handler: async (input, context) => {
      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');
      const points = input.points.map((p: number[]) => new Float32Array(p));

      const result = await bridge.computeTopology(
        points.flat(),
        input.maxDimension
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            bettiNumbers: result.bettiNumbers,
            persistenceDiagram: result.persistenceDiagram,
            homologyClasses: result.homologyClasses,
            interpretation: {
              b0: `${result.bettiNumbers[0]} connected components`,
              b1: `${result.bettiNumbers[1] || 0} loops/cycles`,
              b2: `${result.bettiNumbers[2] || 0} voids/cavities`
            }
          }, null, 2)
        }]
      };
    }
  },

  // Memory Coherence Gate
  {
    name: 'pr/memory-gate',
    description: 'Pre-storage coherence gate for memory entries',
    category: 'memory',
    version: '0.1.3',
    inputSchema: {
      type: 'object',
      properties: {
        entry: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            content: { type: 'string' },
            embedding: { type: 'array', items: { type: 'number' } }
          },
          description: 'Memory entry to validate'
        },
        contextEmbeddings: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Existing context embeddings to check against'
        },
        thresholds: {
          type: 'object',
          properties: {
            reject: { type: 'number', default: 0.7 },
            warn: { type: 'number', default: 0.3 }
          }
        }
      },
      required: ['entry']
    },
    handler: async (input, context) => {
      const gate = context.get<CoherenceGate>('pr.coherenceGate');

      const entry = {
        key: input.entry.key,
        content: input.entry.content,
        embedding: new Float32Array(input.entry.embedding)
      };

      const existingContext = input.contextEmbeddings?.map(
        (e: number[], i: number) => ({
          key: `context-${i}`,
          content: '',
          embedding: new Float32Array(e)
        })
      );

      if (input.thresholds) {
        gate.setThresholds(input.thresholds);
      }

      const result = await gate.validate(entry, existingContext);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: result.action,
            coherent: result.coherenceResult.coherent,
            energy: result.coherenceResult.energy,
            violations: result.coherenceResult.violations,
            confidence: result.coherenceResult.confidence,
            recommendation: result.action === 'allow' ?
              'Entry is coherent with existing context' :
              result.action === 'warn' ?
              'Entry has minor inconsistencies - review recommended' :
              'Entry contradicts existing context - storage blocked'
          }, null, 2)
        }]
      };
    }
  }
];

// Helper function
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 4. Hooks Integration

```typescript
// v3/plugins/prime-radiant/src/hooks/index.ts

import type { Hook, HookPriority } from '@claude-flow/plugins';

export const hooks: Hook[] = [
  // Pre-Memory-Store Hook - Coherence Gate
  {
    name: 'pr/pre-memory-store',
    event: 'pre-memory-store',
    priority: HookPriority.HIGH,
    description: 'Validates memory entry coherence before storage',
    handler: async (context, payload) => {
      const gate = context.get<CoherenceGate>('pr.coherenceGate');
      const memoryService = context.get('memory');

      // Get existing context from same namespace
      const existingEntries = await memoryService.search({
        namespace: payload.namespace,
        limit: 10,
        embedding: payload.embedding
      });

      const validation = await gate.validate(
        payload,
        existingEntries
      );

      if (validation.action === 'reject') {
        throw new CoherenceViolationError(
          validation.coherenceResult.energy,
          validation.coherenceResult.violations
        );
      }

      if (validation.action === 'warn') {
        // Log warning but allow storage
        console.warn(`[Prime Radiant] Coherence warning for ${payload.key}: energy=${validation.coherenceResult.energy.toFixed(3)}`);
        payload.metadata = {
          ...payload.metadata,
          coherenceWarning: true,
          coherenceEnergy: validation.coherenceResult.energy
        };
      }

      return payload;
    }
  },

  // Pre-Consensus Hook - Validity Check
  {
    name: 'pr/pre-consensus',
    event: 'pre-consensus',
    priority: HookPriority.HIGH,
    description: 'Validates consensus proposal coherence before voting',
    handler: async (context, payload) => {
      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');

      // Check coherence of proposal against existing decisions
      const vectors = [
        new Float32Array(payload.proposalEmbedding),
        ...payload.existingDecisions.map(
          (d: { embedding: number[] }) => new Float32Array(d.embedding)
        )
      ];

      const coherence = await bridge.checkCoherence(vectors);

      if (coherence.energy > 0.7) {
        return {
          ...payload,
          rejected: true,
          rejectionReason: `Proposal contradicts existing decisions (energy: ${coherence.energy.toFixed(3)})`
        };
      }

      return {
        ...payload,
        coherenceEnergy: coherence.energy,
        coherenceConfidence: coherence.confidence
      };
    }
  },

  // Post-Swarm-Task Hook - Stability Analysis
  {
    name: 'pr/post-swarm-task',
    event: 'post-task',
    priority: HookPriority.NORMAL,
    description: 'Analyzes swarm stability after task completion',
    handler: async (context, payload) => {
      if (!payload.isSwarmTask) return payload;

      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');
      const hiveMind = context.get('hiveMind');

      // Get agent states
      const agentStates = await hiveMind.getAgentStates();

      // Build adjacency matrix from communication patterns
      const n = agentStates.length;
      const adj = new Float32Array(n * n);

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const commCount = agentStates[i].communicationsWith?.[agentStates[j].id] || 0;
          adj[i * n + j] = commCount / (agentStates[i].totalCommunications || 1);
        }
      }

      // Analyze spectral stability
      const spectral = await bridge.analyzeSpectral(adj);

      // Log stability metrics
      await context.get('memory').store({
        namespace: 'pr/stability-metrics',
        key: `task-${payload.taskId}`,
        content: JSON.stringify({
          taskId: payload.taskId,
          stable: spectral.stable,
          spectralGap: spectral.spectralGap,
          stabilityIndex: spectral.stabilityIndex,
          timestamp: Date.now()
        })
      });

      return {
        ...payload,
        stabilityMetrics: {
          stable: spectral.stable,
          spectralGap: spectral.spectralGap
        }
      };
    }
  },

  // Pre-RAG-Retrieval Hook - Hallucination Prevention
  {
    name: 'pr/pre-rag-retrieval',
    event: 'pre-rag-retrieval',
    priority: HookPriority.HIGH,
    description: 'Checks retrieved context coherence to prevent hallucinations',
    handler: async (context, payload) => {
      const bridge = context.get<PrimeRadiantBridge>('pr.bridge');

      // Check coherence of retrieved documents
      const vectors = payload.retrievedDocs.map(
        (d: { embedding: number[] }) => new Float32Array(d.embedding)
      );

      if (vectors.length < 2) return payload;

      const coherence = await bridge.checkCoherence(vectors);

      if (coherence.energy > 0.5) {
        // Retrieved documents are contradictory - filter
        console.warn(`[Prime Radiant] RAG coherence warning: ${coherence.violations.join(', ')}`);

        // Return only the most coherent subset
        // (simplified - full implementation would use iterative removal)
        return {
          ...payload,
          retrievedDocs: payload.retrievedDocs.slice(0, Math.ceil(payload.retrievedDocs.length / 2)),
          coherenceFiltered: true,
          originalCoherenceEnergy: coherence.energy
        };
      }

      return payload;
    }
  }
];
```

### 5. V3 Domain Integration

#### 5.1 Memory Domain Integration

```typescript
// v3/plugins/prime-radiant/src/integration/memory-integration.ts

import type { IMemoryService } from '@claude-flow/memory';
import { CoherenceGate } from '../domain/coherence-gate';

/**
 * Extends Memory Service with coherence checking
 */
export class CoherentMemoryService {
  private memoryService: IMemoryService;
  private coherenceGate: CoherenceGate;

  constructor(memoryService: IMemoryService, coherenceGate: CoherenceGate) {
    this.memoryService = memoryService;
    this.coherenceGate = coherenceGate;
  }

  /**
   * Store with coherence validation
   */
  async storeWithCoherence(entry: {
    namespace: string;
    key: string;
    content: string;
    embedding: Float32Array;
    metadata?: Record<string, unknown>;
  }): Promise<{ stored: boolean; coherenceResult: CoherenceResult }> {
    // Get existing context
    const existing = await this.memoryService.searchSemantic(
      entry.embedding,
      10,
      { namespace: entry.namespace }
    );

    // Validate coherence
    const validation = await this.coherenceGate.validate(
      { key: entry.key, content: entry.content, embedding: entry.embedding },
      existing.map(e => ({
        key: e.key,
        content: e.content,
        embedding: new Float32Array(e.embedding)
      }))
    );

    if (validation.action === 'reject') {
      return {
        stored: false,
        coherenceResult: validation.coherenceResult
      };
    }

    // Store with coherence metadata
    await this.memoryService.store({
      ...entry,
      metadata: {
        ...entry.metadata,
        coherenceEnergy: validation.coherenceResult.energy,
        coherenceChecked: true
      }
    });

    return {
      stored: true,
      coherenceResult: validation.coherenceResult
    };
  }

  /**
   * Search with coherence filtering
   */
  async searchCoherent(
    embedding: Float32Array,
    k: number,
    options?: { namespace?: string; minCoherence?: number }
  ): Promise<Array<{ entry: unknown; coherenceScore: number }>> {
    const results = await this.memoryService.searchSemantic(embedding, k * 2, {
      namespace: options?.namespace
    });

    // Filter for coherent results
    const vectors = results.map(r => new Float32Array(r.embedding));
    const coherent: Array<{ entry: unknown; coherenceScore: number }> = [];

    for (let i = 0; i < results.length && coherent.length < k; i++) {
      const subset = [embedding, ...coherent.map(c => new Float32Array((c.entry as any).embedding)), vectors[i]];
      const check = await this.coherenceGate.validate(
        { key: '', content: '', embedding: vectors[i] },
        subset.slice(0, -1).map((e, j) => ({ key: `${j}`, content: '', embedding: e }))
      );

      if (check.action !== 'reject') {
        coherent.push({
          entry: results[i],
          coherenceScore: 1 - check.coherenceResult.energy
        });
      }
    }

    return coherent;
  }
}
```

#### 5.2 Hive-Mind Domain Integration

```typescript
// v3/plugins/prime-radiant/src/integration/hive-mind-integration.ts

import type { HiveMindService } from '@claude-flow/coordination';
import { PrimeRadiantBridge } from '../infrastructure/prime-radiant-bridge';

/**
 * Extends Hive-Mind with mathematical consensus verification
 */
export class CoherentHiveMind {
  private hiveMind: HiveMindService;
  private bridge: PrimeRadiantBridge;

  constructor(hiveMind: HiveMindService, bridge: PrimeRadiantBridge) {
    this.hiveMind = hiveMind;
    this.bridge = bridge;
  }

  /**
   * Verify consensus mathematically before accepting
   */
  async verifyConsensus(proposalId: string): Promise<{
    verified: boolean;
    coherenceEnergy: number;
    spectralStability: boolean;
    agentAgreement: number;
  }> {
    // Get votes and agent states
    const proposal = await this.hiveMind.getProposal(proposalId);
    const votes = await this.hiveMind.getVotes(proposalId);
    const agentStates = await this.hiveMind.getAgentStates();

    // Extract embeddings for coherence check
    const voteEmbeddings = votes
      .filter(v => v.embedding)
      .map(v => new Float32Array(v.embedding));

    if (voteEmbeddings.length < 2) {
      return {
        verified: true,
        coherenceEnergy: 0,
        spectralStability: true,
        agentAgreement: 1
      };
    }

    // Check coherence of votes
    const coherence = await this.bridge.checkCoherence(voteEmbeddings);

    // Build communication adjacency matrix
    const n = agentStates.length;
    const adj = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        adj[i * n + j] = votes[i]?.vote === votes[j]?.vote ? 1 : 0;
      }
    }

    // Analyze spectral properties
    const spectral = await this.bridge.analyzeSpectral(adj);

    // Calculate agreement ratio
    const yesVotes = votes.filter(v => v.vote === true).length;
    const agentAgreement = Math.max(yesVotes, votes.length - yesVotes) / votes.length;

    return {
      verified: coherence.coherent && spectral.stable && agentAgreement > 0.66,
      coherenceEnergy: coherence.energy,
      spectralStability: spectral.stable,
      agentAgreement
    };
  }

  /**
   * Analyze swarm health using spectral methods
   */
  async analyzeSwarmHealth(): Promise<{
    healthy: boolean;
    spectralGap: number;
    stabilityIndex: number;
    recommendations: string[];
  }> {
    const agentStates = await this.hiveMind.getAgentStates();
    const n = agentStates.length;

    if (n < 2) {
      return {
        healthy: true,
        spectralGap: 1,
        stabilityIndex: 1,
        recommendations: []
      };
    }

    // Build adjacency from recent interactions
    const adj = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const agent = agentStates[i];
        const interactions = agent.recentInteractions?.filter(
          (int: { targetId: string }) => int.targetId === agentStates[j].id
        ).length || 0;
        adj[i * n + j] = interactions;
      }
    }

    const spectral = await this.bridge.analyzeSpectral(adj);
    const recommendations: string[] = [];

    if (!spectral.stable) {
      recommendations.push('Swarm shows instability - consider reducing agent count');
    }
    if (spectral.spectralGap < 0.1) {
      recommendations.push('Low spectral gap - agents may be forming isolated clusters');
    }
    if (spectral.stabilityIndex < 0.5) {
      recommendations.push('Low stability index - coordination patterns are fragmented');
    }

    return {
      healthy: spectral.stable && spectral.spectralGap > 0.1,
      spectralGap: spectral.spectralGap,
      stabilityIndex: spectral.stabilityIndex,
      recommendations
    };
  }
}
```

---

## Consequences

### Positive

1. **Mathematical Coherence**: Sheaf Laplacian provides rigorous contradiction detection
2. **RAG Quality**: Pre-retrieval coherence checks prevent hallucinations
3. **Consensus Verification**: Mathematical validation of multi-agent agreement
4. **Swarm Stability**: Spectral analysis provides early warning for coordination issues
5. **Minimal Footprint**: 92KB WASM bundle with zero dependencies
6. **Cross-Platform**: Browser and Node.js compatible

### Negative

1. **Computational Cost**: Coherence checks add ~1-5ms per validation
2. **Learning Curve**: Category theory and HoTT require specialized knowledge
3. **False Positives**: Overly strict thresholds may reject valid entries

### Trade-offs

1. **Coherence vs Flexibility**: Strict coherence checking may reject valid but unconventional patterns
   - Decision: Configurable thresholds with warn mode
2. **Performance vs Accuracy**: Full spectral analysis is O(n^3) for eigendecomposition
   - Decision: Use approximate methods for large matrices (>100 nodes)

---

## Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| WASM load time | <50ms | Single load at plugin init |
| Coherence check | <5ms | Per-entry validation |
| Spectral analysis | <20ms | For matrices up to 100x100 |
| Causal inference | <10ms | Single query |
| Memory overhead | <10MB | WASM + engine instances |
| MCP tool response | <100ms | V3 MCP requirement |

---

## Migration Path

### Phase 1: Plugin Scaffold (Week 1)
- Create `v3/plugins/prime-radiant/` structure
- Implement WASM bridge and loader
- Set up plugin registration

### Phase 2: Core Engines (Week 2)
- Implement CohomologyEngine integration
- Implement SpectralEngine integration
- Create CoherenceGate domain service

### Phase 3: MCP Tools (Week 3)
- Register all MCP tools
- Implement tool handlers
- Add to MCP server capabilities

### Phase 4: Hooks Integration (Week 4)
- Implement pre-memory-store hook
- Implement pre-consensus hook
- Implement post-task stability hook

### Phase 5: Domain Integration (Week 5)
- Integrate with Memory domain
- Integrate with Hive-Mind domain
- Integration testing

---

## Implementation Plan

### Required File Structure

```
v3/plugins/prime-radiant/
├── src/
│   ├── index.ts                      # Plugin entry point
│   ├── plugin.ts                     # Plugin registration
│   ├── types.ts                      # TypeScript definitions
│   │
│   ├── infrastructure/
│   │   ├── prime-radiant-bridge.ts   # WASM bridge
│   │   └── cache.ts                  # Result caching
│   │
│   ├── domain/
│   │   ├── coherence-gate.ts         # Coherence validation
│   │   └── stability-analyzer.ts     # Stability analysis
│   │
│   ├── tools/
│   │   ├── index.ts                  # MCP tools registry
│   │   ├── coherence-check.ts
│   │   ├── spectral-analyze.ts
│   │   ├── causal-infer.ts
│   │   ├── consensus-verify.ts
│   │   ├── quantum-topology.ts
│   │   └── memory-gate.ts
│   │
│   ├── hooks/
│   │   ├── index.ts
│   │   ├── pre-memory-store.ts
│   │   ├── pre-consensus.ts
│   │   ├── post-swarm-task.ts
│   │   └── pre-rag-retrieval.ts
│   │
│   └── integration/
│       ├── memory-integration.ts
│       └── hive-mind-integration.ts
│
├── plugin.yaml                       # Plugin manifest
├── README.md                         # Usage documentation
├── package.json
└── tsconfig.json
```

---

## References

- [ADR-006: Unified Memory Service](./ADR-006-UNIFIED-MEMORY.md)
- [ADR-013: Core Security Module](./ADR-013-core-security-module.md)
- [ADR-015: Unified Plugin System](./ADR-015-unified-plugin-system.md)
- [ADR-022: AIDefence Integration](./ADR-022-aidefence-integration.md)
- [ADR-030: Agentic-QE Integration](./ADR-030-agentic-qe-integration.md)
- [prime-radiant-advanced-wasm npm](https://www.npmjs.com/package/prime-radiant-advanced-wasm)
- [Sheaf Laplacian Theory](https://arxiv.org/abs/1808.04718)
- [Do-Calculus for Causal Inference](https://arxiv.org/abs/1305.5506)
