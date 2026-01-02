# Examples

Example code for pi-coding-agent SDK, hooks, and custom tools.

## Directories

### [sdk/](sdk/)
Programmatic usage via `createAgentSession()`. Shows how to customize models, prompts, tools, hooks, and session management.

### [hooks/](hooks/)
Example hooks for intercepting tool calls, adding safety gates, and integrating with external systems.

### [custom-tools/](custom-tools/)
Example custom tools that extend the agent's capabilities.

## Tool + Hook Combinations

Some examples are designed to work together:

- **todo/** - The [custom tool](custom-tools/todo/) lets the LLM manage a todo list, while the [hook](hooks/todo/) adds a `/todos` command for users to view todos at any time.

## Documentation

- [SDK Reference](sdk/README.md)
- [Hooks Documentation](../docs/hooks.md)
- [Custom Tools Documentation](../docs/custom-tools.md)
- [Skills Documentation](../docs/skills.md)
