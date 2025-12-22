# Examples

Example code for pi-coding-agent.

## Directories

### [sdk/](sdk/)
Programmatic usage via `createAgentSession()`. Shows how to customize models, prompts, tools, hooks, and session management.

### [hooks/](hooks/)
Example hooks for intercepting tool calls, adding safety gates, and integrating with external systems.

### [custom-tools/](custom-tools/)
Example custom tools that extend the agent's capabilities.

## Running Examples

```bash
cd packages/coding-agent
npx tsx examples/sdk/01-minimal.ts
npx tsx examples/hooks/permission-gate.ts
```

## Documentation

- [SDK Reference](sdk/README.md)
- [Hooks Documentation](../docs/hooks.md)
- [Custom Tools Documentation](../docs/custom-tools.md)
- [Skills Documentation](../docs/skills.md)
