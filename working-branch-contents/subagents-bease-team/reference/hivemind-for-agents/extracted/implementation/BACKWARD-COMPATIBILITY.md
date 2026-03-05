# Backward Compatibility Guide

> Ensuring V2 code works with V3 architecture

## Overview

V3 introduces breaking changes per ADR-001 through ADR-010. This document outlines compatibility layers and migration paths.

## Breaking Changes Summary

### Architecture (ADR-001, ADR-002, ADR-003)

| Change | V2 | V3 | Migration |
|--------|----|----|-----------|
| Core Foundation | Custom implementation | agentic-flow@alpha | Update imports |
| Structure | Flat modules | DDD bounded contexts | Restructure code |
| Coordination | Multiple orchestrators | UnifiedSwarmCoordinator | Consolidate |

### API Changes (ADR-005)

| Change | V2 | V3 | Migration |
|--------|----|----|-----------|
| Tool Naming | Mixed (`dispatch_agent`, `swarm_status`) | Consistent (`agent/spawn`, `swarm/status`) | Update tool calls |
| Parameters | Inconsistent | Zod-validated schemas | Update params |

### Memory (ADR-006, ADR-009)

| Change | V2 | V3 | Migration |
|--------|----|----|-----------|
| Backend | SQLite only | Hybrid SQLite+AgentDB | Configure backend |
| Search | Brute-force | HNSW indexed | No changes needed |

### Runtime (ADR-010)

| Change | V2 | V3 | Migration |
|--------|----|----|-----------|
| Deno | Supported | Removed | Node.js only |
| Node.js | >=16 | >=20 | Update runtime |

## Compatibility Layers

### Import Aliases

```typescript
// v3/@claude-flow/shared/src/compat/v2-aliases.ts
// Provides V2-compatible imports

// V2 imports
import { HiveMind } from 'claude-flow/hive-mind';
import { SwarmCoordinator } from 'claude-flow/swarm';
import { MemoryManager } from 'claude-flow/memory';

// V3 compatibility layer
export { UnifiedSwarmCoordinator as HiveMind } from '@claude-flow/swarm';
export { UnifiedSwarmCoordinator as SwarmCoordinator } from '@claude-flow/swarm';
export { UnifiedMemoryService as MemoryManager } from '@claude-flow/memory';
```

### Tool Name Mapping

```typescript
// v3/mcp/tools/compat/v2-tool-names.ts
// Maps V2 tool names to V3 equivalents

export const toolNameMapping: Record<string, string> = {
  // Agent tools
  'dispatch_agent': 'agent/spawn',
  'agents/spawn': 'agent/spawn',
  'agents/list': 'agent/list',
  'agents/terminate': 'agent/terminate',
  'agents/info': 'agent/status',
  'agent/create': 'agent/spawn',

  // Swarm tools
  'swarm_status': 'swarm/status',
  'swarm/get-status': 'swarm/status',
  'swarm/get-comprehensive-status': 'swarm/status',
  'mcp__ruv-swarm__swarm_init': 'swarm/init',
  'mcp__ruv-swarm__swarm_status': 'swarm/status',
  'mcp__ruv-swarm__agent_spawn': 'agent/spawn',
  'mcp__ruv-swarm__agent_list': 'agent/list',
  'mcp__ruv-swarm__agent_metrics': 'agent/status',

  // Memory tools
  'memory/query': 'memory/search',
  'mcp__ruv-swarm__memory_usage': 'memory/list',

  // Config tools
  'config/get': 'config/load',
  'config/update': 'config/save',

  // Neural tools (hooks-based in V3)
  'mcp__ruv-swarm__neural_status': 'hooks/metrics',
  'mcp__ruv-swarm__neural_train': 'hooks/pretrain'
};

export function translateToolName(v2Name: string): string {
  return toolNameMapping[v2Name] || v2Name;
}
```

### Parameter Translation

```typescript
// v3/mcp/tools/compat/v2-params.ts
// Translates V2 parameters to V3 format

export function translateAgentSpawnParams(v2Params: any): any {
  return {
    agentType: v2Params.type,
    id: v2Params.name,
    config: {
      capabilities: v2Params.capabilities,
      systemPrompt: v2Params.systemPrompt,
      maxConcurrentTasks: v2Params.maxConcurrentTasks
    },
    priority: v2Params.priority > 5 ? 'high' : v2Params.priority < 5 ? 'low' : 'normal',
    metadata: {
      environment: v2Params.environment,
      workingDirectory: v2Params.workingDirectory
    }
  };
}

export function translateSwarmInitParams(v2Params: any): any {
  return {
    topology: v2Params.topology || 'hierarchical-mesh',
    maxAgents: v2Params.maxAgents || 15,
    config: {
      consensusMechanism: v2Params.consensus || 'majority',
      loadBalancing: v2Params.strategy === 'balanced'
    }
  };
}

export function translateMemoryQueryParams(v2Params: any): any {
  return {
    query: v2Params.search || '',
    searchType: 'hybrid',
    type: v2Params.type || 'all',
    tags: v2Params.tags,
    limit: v2Params.limit || 10,
    includeMetadata: true
  };
}
```

### CLI Command Mapping

```typescript
// v3/@claude-flow/cli/src/compat/v2-commands.ts
// Provides V2 command aliases

export const commandMapping: Record<string, string[]> = {
  // Hive commands -> swarm
  'hive-mind init': ['swarm', 'init'],
  'hive-mind status': ['swarm', 'status'],
  'hive-mind spawn': ['agent', 'spawn'],

  // Hook commands
  'hooks pre-task': ['hooks', 'pre-edit'],  // Closest equivalent
  'hooks post-task': ['hooks', 'post-edit'],

  // Deprecated commands
  'neural init': ['hooks', 'pretrain'],
  'goal init': ['hooks', 'pretrain']
};
```

## Configuration Migration

### V2 Configuration
```yaml
# v2/.claude-flow/config.yaml
orchestrator:
  maxAgents: 10
  defaultStrategy: balanced
memory:
  backend: sqlite
  path: ./.claude-flow/memory.db
coordination:
  topology: hierarchical
  consensus: quorum
```

### V3 Configuration
```yaml
# v3/.claude-flow/config.yaml
swarm:
  topology: hierarchical-mesh
  maxAgents: 15
  consensus:
    mechanism: majority
    timeout: 30000
memory:
  backend: hybrid  # SQLite + AgentDB
  sqlite:
    path: ./.claude-flow/memory.db
  agentdb:
    enableHNSW: true
    dimensions: 384
hooks:
  learning:
    enabled: true
    pretrainOnInit: false
```

### Migration Script

```typescript
// v3/@claude-flow/cli/src/commands/migrate.ts
export async function migrateConfig(v2ConfigPath: string): Promise<void> {
  const v2Config = await loadYaml(v2ConfigPath);

  const v3Config = {
    swarm: {
      topology: mapTopology(v2Config.coordination?.topology),
      maxAgents: v2Config.orchestrator?.maxAgents || 15,
      consensus: {
        mechanism: mapConsensus(v2Config.coordination?.consensus),
        timeout: 30000
      }
    },
    memory: {
      backend: 'hybrid',
      sqlite: {
        path: v2Config.memory?.path || './.claude-flow/memory.db'
      },
      agentdb: {
        enableHNSW: true,
        dimensions: 384
      }
    },
    hooks: {
      learning: {
        enabled: true,
        pretrainOnInit: false
      }
    }
  };

  await saveYaml('.claude-flow/config.yaml', v3Config);
}

function mapTopology(v2Topology: string): string {
  const mapping = {
    'hierarchical': 'hierarchical-mesh',
    'mesh': 'mesh',
    'ring': 'mesh',  // Ring deprecated
    'star': 'hierarchical'  // Star deprecated
  };
  return mapping[v2Topology] || 'hierarchical-mesh';
}

function mapConsensus(v2Consensus: string): string {
  const mapping = {
    'quorum': 'majority',
    'unanimous': 'unanimous',
    'weighted': 'qualified',  // Needs implementation
    'leader': 'raft'
  };
  return mapping[v2Consensus] || 'majority';
}
```

## Memory Data Migration

### Schema Changes

```sql
-- V2 Schema
CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  namespace TEXT,
  session_id TEXT,
  agent_id TEXT,
  type TEXT,
  content TEXT,
  metadata TEXT,
  tags TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- V3 Schema (additional columns)
ALTER TABLE memory_entries ADD COLUMN embedding BLOB;
ALTER TABLE memory_entries ADD COLUMN importance REAL DEFAULT 0.5;
ALTER TABLE memory_entries ADD COLUMN ttl INTEGER;
ALTER TABLE memory_entries ADD COLUMN access_count INTEGER DEFAULT 0;
```

### Migration Script

```typescript
// v3/@claude-flow/memory/src/migration.ts
export async function migrateMemoryData(v2DbPath: string, v3DbPath: string): Promise<void> {
  const v2Db = new Database(v2DbPath);
  const v3Db = new Database(v3DbPath);

  // Create V3 schema
  v3Db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      namespace TEXT,
      session_id TEXT,
      agent_id TEXT,
      type TEXT,
      content TEXT,
      metadata TEXT,
      tags TEXT,
      embedding BLOB,
      importance REAL DEFAULT 0.5,
      ttl INTEGER,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // Migrate entries
  const entries = v2Db.prepare('SELECT * FROM memory_entries').all();
  const insert = v3Db.prepare(`
    INSERT INTO memory_entries
    (id, namespace, session_id, agent_id, type, content, metadata, tags, importance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const entry of entries) {
    insert.run(
      entry.id,
      entry.namespace,
      entry.session_id,
      entry.agent_id,
      entry.type,
      entry.content,
      entry.metadata,
      entry.tags,
      0.5,  // Default importance
      entry.created_at,
      entry.updated_at
    );
  }

  // Generate embeddings for semantic search (async)
  await generateEmbeddings(v3Db);
}
```

## API Compatibility Mode

### Enabling Compatibility Mode

```typescript
// v3/mcp/server.ts
import { enableV2Compatibility } from './compat/v2-mode';

const server = createMCPServer({
  transport: 'stdio',
  compatibility: {
    v2: true,  // Enable V2 tool name mapping
    paramTranslation: true,  // Enable param translation
    deprecationWarnings: true  // Log deprecation warnings
  }
});

if (server.config.compatibility?.v2) {
  enableV2Compatibility(server);
}
```

### Deprecation Warnings

```typescript
// v3/mcp/tools/compat/deprecation.ts
export function warnDeprecated(v2Name: string, v3Name: string): void {
  console.warn(
    `[DEPRECATION] Tool "${v2Name}" is deprecated. ` +
    `Use "${v3Name}" instead. ` +
    `V2 compatibility will be removed in v4.0.0`
  );
}

export const deprecatedTools = [
  { v2: 'dispatch_agent', v3: 'agent/spawn', removed: '4.0.0' },
  { v2: 'swarm_status', v3: 'swarm/status', removed: '4.0.0' },
  { v2: 'memory/query', v3: 'memory/search', removed: '4.0.0' },
  { v2: 'config/get', v3: 'config/load', removed: '4.0.0' },
  { v2: 'config/update', v3: 'config/save', removed: '4.0.0' }
];
```

## Testing Compatibility

```typescript
// v3/__tests__/compat/v2-compatibility.test.ts
import { describe, it, expect } from 'vitest';
import { translateToolName, translateAgentSpawnParams } from '../compat';

describe('V2 Compatibility', () => {
  describe('Tool Name Translation', () => {
    it('should translate dispatch_agent to agent/spawn', () => {
      expect(translateToolName('dispatch_agent')).toBe('agent/spawn');
    });

    it('should translate swarm_status to swarm/status', () => {
      expect(translateToolName('swarm_status')).toBe('swarm/status');
    });
  });

  describe('Parameter Translation', () => {
    it('should translate V2 agent spawn params', () => {
      const v2Params = {
        type: 'coder',
        name: 'my-coder',
        capabilities: ['coding'],
        priority: 8
      };

      const v3Params = translateAgentSpawnParams(v2Params);

      expect(v3Params.agentType).toBe('coder');
      expect(v3Params.id).toBe('my-coder');
      expect(v3Params.priority).toBe('high');
    });
  });
});
```

## Deprecation Timeline

| Version | Changes |
|---------|---------|
| **v3.0.0** | Compatibility mode enabled by default |
| **v3.1.0** | Deprecation warnings added |
| **v3.2.0** | Compatibility mode opt-in |
| **v4.0.0** | V2 compatibility removed |
