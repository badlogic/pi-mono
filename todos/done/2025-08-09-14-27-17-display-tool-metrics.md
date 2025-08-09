# Display Tool Call Metrics

**Status:** Done
**Agent PID:** 96631

## Original Todo
agent: we should output number of tool calls so far next to input and output and cached tokens. Can use that hammer emoji or whatever.

## Description
Add a tool call counter to the token usage display in the agent's TUI and console renderers, showing the number of tool calls made in the current conversation alongside the existing token metrics.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*

## Implementation Plan
- [x] Add tool call counter property to TUI renderer (packages/agent/src/renderers/tui-renderer.ts:60-64)
- [x] Track tool_call events in TUI renderer's event handler (packages/agent/src/renderers/tui-renderer.ts:250-270)
- [x] Update TUI token display to show tool calls with ⚒ (packages/agent/src/renderers/tui-renderer.ts:284-305)
- [x] Add tool call counter to console renderer (packages/agent/src/renderers/console-renderer.ts)
- [x] Track tool_call events in console renderer (packages/agent/src/renderers/console-renderer.ts:45-130)
- [x] Display tool metrics after assistant messages in console (packages/agent/src/renderers/console-renderer.ts:124-127)
- [x] Test console mode: `npx tsx packages/agent/src/cli.ts "what files are in /tmp"`  
  - Success: After response completes, shows metrics line with tool count like "↑123 ↓456 ⚒1" ✓
- [x] Test multiple tools: `npx tsx packages/agent/src/cli.ts "create a file /tmp/test.txt with 'hello' then read it back"`
  - Success: Should show ⚒2 (one for write, one for read) ✓
- [x] Test JSON mode: `echo '{"type":"message","content":"list files in /tmp"}' | npx tsx packages/agent/src/cli.ts --json | grep tool_call | wc -l`
  - Success: Count matches number of tool_call events in output ✓ (shows 1 tool call)
- [x] User test: Start interactive TUI `npx tsx packages/agent/src/cli.ts`, ask it to use multiple tools, verify counter increments live ✓

## Notes
Using ⚒ (hammer and pick) symbol for tool calls