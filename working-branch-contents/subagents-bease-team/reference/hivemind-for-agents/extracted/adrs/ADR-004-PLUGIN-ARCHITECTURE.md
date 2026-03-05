# ADR-004: Plugin-Based Architecture

**Status:** Implemented
**Date:** 2026-01-03

## Context

v2 bundles all features (Hive Mind, Maestro, Neural, Verification) into core, making the system large and complex even for users who only need basic features.

## Decision

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

## Plugin Interface

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

## Rationale

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

## Implementation

**Plugin Registration:**
```typescript
class PluginManager {
  private plugins: Map<string, ClaudeFlowPlugin> = new Map();

  async loadPlugin(plugin: ClaudeFlowPlugin): Promise<void> {
    // Check dependencies
    for (const dep of plugin.dependencies || []) {
      if (!this.plugins.has(dep)) {
        throw new Error(`Missing dependency: ${dep}`);
      }
    }

    // Initialize plugin
    await plugin.initialize(this.context);

    // Register extensions
    if (plugin.registerMCPTools) {
      const tools = plugin.registerMCPTools();
      this.mcpServer.registerTools(tools);
    }

    this.plugins.set(plugin.name, plugin);
  }
}
```

**Official Plugins:**
1. `@claude-flow/hive-mind` - Queen-led coordination
2. `@claude-flow/neural` - Neural training system
3. `@claude-flow/verification` - Truth scoring
4. `@claude-flow/enterprise` - Advanced features

## Success Metrics

- [x] Core <20MB (vs 50MB+ currently)
- [x] Plugin loading <100ms
- [x] At least 3 official plugins
- [x] Plugin development guide
- [ ] Community plugin contributed

---

**Implementation Date:** 2026-01-04
**Status:** ✅ Complete
