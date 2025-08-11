# Fix interrupted message not showing when ESC pressed in agent TUI

**Status:** Done
**Agent PID:** 47968

## Original Todo
agent/tui: not seeing a read "interrupted" mesage anymore if i press ESC while agnet works

## Description
Fix the issue where the "interrupted" message is not displayed in the TUI when pressing ESC to interrupt the agent while it's processing. The root cause is duplicate UI cleanup in the ESC key handler that interferes with the asynchronous interrupted event handler.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*

## Implementation Plan
Remove duplicate UI cleanup from ESC key handler and ensure interrupted event handler properly displays the message:
- [x] Remove duplicate loading animation cleanup from ESC key handler in tui-renderer.ts (lines 115-120)
- [x] Add explicit render request after adding interrupted message (line 280)
- [x] Fix core issue: Emit "interrupted" event when API call is aborted (agent.ts line 606-607)
- [x] Pass abort signal to preflight reasoning check
- [x] Test interruption during API call (e.g., "write a poem")
- [x] Verify "[Interrupted by user]" message appears and UI is restored

## Notes
[Implementation notes]