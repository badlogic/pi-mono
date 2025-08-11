# Fix TUI Garbled Output When Sending Multiple Messages

**Status:** InProgress
**Agent PID:** 54802

## Original Todo
agent/tui: "read all README.md files except in node_modules". wait for completion, then send a new message. Getting garbled output. this happens for both of the renderDifferential and renderDifferentialSurgical methods. We need to emulate this in a test and get to the bottom of it.

## Description
Fix the TUI rendering corruption that occurs when sending multiple messages in rapid succession, particularly after tool calls that produce large outputs. The issue manifests as garbled/overlapping text when new messages are sent while previous output is still being displayed.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*

## Implementation Plan
[how we are building it]
- [x] Create test to reproduce the issue: Simulate rapid tool calls with large outputs followed by new message
- [x] Fix ANSI code handling in MarkdownComponent line wrapping (packages/tui/src/components/markdown-component.ts:203-276)
- [x] Implement new line-based rendering strategy that properly handles scrollback and viewport boundaries
- [x] Add comprehensive test coverage for multi-message scenarios
- [ ] User test: Run agent, execute "read all README.md files", wait for completion, send new message, verify no garbled output

## Notes
- Successfully reproduced the issue with test showing garbled text overlay
- Fixed ANSI code handling in MarkdownComponent line wrapping  
- Root cause: PARTIAL rendering strategy incorrectly calculated cursor position when content exceeded viewport
- When content is in scrollback, cursor can't reach it (can only move within viewport)
- Old PARTIAL strategy tried to move cursor 33 lines up when only 30 were possible
- This caused cursor to land at wrong position (top of viewport instead of target line in scrollback)
- Solution: Implemented new `renderLineBased` method that:
  - Compares old and new lines directly (component-agnostic)
  - Detects if changes are in scrollback (unreachable) or viewport
  - For scrollback changes: does full clear and re-render
  - For viewport changes: moves cursor correctly within viewport bounds and updates efficiently
  - Handles surgical line-by-line updates when possible for minimal redraws
- Test now passes - no more garbled output when messages exceed viewport!