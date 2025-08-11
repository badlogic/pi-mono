# Add Token Usage Tracking Command
**Status:** Done
**Agent PID:** 71159

## Original Todo
- agent: we get token_usage events. the last we get tells us how many input/output/cache read/cache write/reasoning tokens where used for the last request to the LLM endpoint. We want to:
    - have a /tokens command that outputs the accumulative counts, can just add it to the chat messages container as a nicely formatted TextComponent
    - means the tui-renderer needs to keep track of accumulative stats as well, not just last request stats.
    - please check agent.ts (read in full) to see if token_usage is actually some form of accumulative thing, or a per request to llm thing. want to undersatnd what we get.

## Description
Add a `/tokens` slash command to the TUI that displays cumulative token usage statistics for the current session. This includes fixing the SessionManager to properly accumulate token usage and implementing slash command infrastructure in the agent's TUI renderer.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*

## Implementation Plan
- [x] Fix SessionManager to accumulate token usage instead of storing only the last event (packages/agent/src/session-manager.ts:158-160)
- [x] Add cumulative token tracking properties to TUI renderer (packages/agent/src/renderers/tui-renderer.ts:60-66)
- [x] Add /tokens slash command to CombinedAutocompleteProvider (packages/agent/src/renderers/tui-renderer.ts:75-80)
- [x] Modify TUI renderer's onSubmit to handle slash commands locally (packages/agent/src/renderers/tui-renderer.ts:159-177)
- [x] Implement /tokens command handler that displays formatted cumulative statistics
- [x] Update token_usage event handler to accumulate totals (packages/agent/src/renderers/tui-renderer.ts:275-291)
- [x] Test: Verify /tokens command displays correct cumulative totals
- [x] Test: Send multiple messages and confirm accumulation works correctly
- [x] Fix file autocompletion that was broken by slash command implementation

## Notes
[Implementation notes]