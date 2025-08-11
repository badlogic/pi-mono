# Analysis: Interrupted Message Not Showing in TUI

## Problem Summary
When pressing ESC to interrupt the agent while it's working, the "interrupted" message is not appearing in the TUI interface.

## Research Findings

### Interrupt Handling Flow

1. **ESC Key Detection** (TuiRenderer line 110)
   - ESC key is detected as `\x1b` in the `onGlobalKeyPress` handler
   - Only triggers when `this.currentLoadingAnimation` is active (agent is processing)

2. **Immediate UI Cleanup** (TuiRenderer lines 112-128)
   - Calls `this.onInterruptCallback()` (which calls `agent.interrupt()`)
   - Stops loading animation and clears status container
   - Re-enables text editor submission
   - Requests UI render

3. **Agent Interruption** (Agent.ts line 615-617)
   - `agent.interrupt()` calls `this.abortController?.abort()`
   - This triggers AbortSignal in ongoing API calls

4. **Interrupted Event Generation** (Agent.ts multiple locations)
   - When signal is aborted, code checks `signal?.aborted` 
   - Emits `{ type: "interrupted" }` event via `eventReceiver?.on()`
   - Throws `new Error("Interrupted")` to exit processing

5. **Message Display** (TuiRenderer line 272-283)
   - Handles `"interrupted"` event
   - Adds red "[Interrupted by user]" message to chat container
   - Requests render

### Root Cause Analysis

The issue appears to be a **race condition with duplicate cleanup**:

1. When ESC is pressed, the key handler **immediately** (lines 115-120):
   - Stops the loading animation
   - Clears the status container
   - Sets `currentLoadingAnimation = null`

2. Later, when the "interrupted" event arrives (lines 273-277), it tries to:
   - Stop the loading animation again (but it's already null)
   - Clear the status container again (already cleared)

3. The comment on line 123 says "Don't show message here - the interrupted event will handle it", but the event handler at line 280 **does** add the message to the chat container.

### The Actual Problem

Looking closely at the code flow:

1. ESC handler clears animation and calls `agent.interrupt()` (synchronous)
2. Agent aborts the controller (synchronous)
3. API call code detects abort and emits "interrupted" event (asynchronous)
4. TUI renderer receives "interrupted" event and adds message (asynchronous)

The issue is likely that:
- The interrupted event IS being emitted and handled
- The message IS being added to the chat container
- But the UI render might not be properly triggered or the differential rendering isn't detecting the change

### Additional Issues Found

1. **Duplicate Animation Cleanup**: The loading animation is stopped twice - once in the ESC handler and once in the interrupted event handler. This is redundant but shouldn't cause the missing message.

2. **Render Request Timing**: The ESC handler requests a render immediately after clearing the UI, then the interrupted event handler adds the message but doesn't explicitly request another render (it relies on the Container's automatic render request).

3. **Container Change Detection**: Recent commit 192d8d2 fixed container change detection issues. The interrupted message addition might not be triggering proper change detection.

## Solution Approach

The fix needs to ensure the interrupted message is properly displayed. Options:

1. **Add explicit render request** after adding the interrupted message
2. **Remove duplicate cleanup** in the ESC handler and let the event handler do all the work
3. **Ensure proper change detection** when adding the message to the chat container

The cleanest solution is likely option 2 - let the interrupted event handler do all the UI updates to avoid race conditions and ensure proper sequencing.