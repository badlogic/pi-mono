# TUI Garbled Output Analysis

## Problem Description
When reading multiple README.md files and then sending a new message, the TUI displays garbled output. This happens for both renderDifferential and renderDifferentialSurgical methods, affecting any model (not just gpt-5).

## Rendering System Overview

### Three Rendering Strategies
1. **SURGICAL Updates** - Updates only changed lines (1-2 lines typical)
2. **PARTIAL Re-render** - Clears from first change to end, re-renders tail
3. **FULL Re-render** - Clears scrollback and screen, renders everything

### Key Components
- **TUI Class** (`packages/tui/src/tui.ts`): Main rendering engine
- **Container Class**: Manages child components, auto-triggers re-renders
- **TuiRenderer** (`packages/agent/src/renderers/tui-renderer.ts`): Agent's TUI integration
- **Event System**: Event-driven updates through AgentEvent

## Root Causes Identified

### 1. Complex ANSI Code Handling
- MarkdownComponent line wrapping has issues with ANSI escape sequences
- Code comment at line 203: "Need to wrap - this is complex with ANSI codes"
- ANSI codes can be split across render operations, causing corruption

### 2. Race Conditions in Rapid Updates
When processing multiple tool calls:
- Multiple containers change simultaneously
- Content added both above and within viewport
- Surgical renderer handles structural changes while maintaining cursor position
- Heavy ANSI content (colored tool output, markdown) increases complexity

### 3. Cursor Position Miscalculation
- Rapid updates can cause cursor positioning logic errors
- Content shifts due to previous renders not properly accounted for
- Viewport vs scrollback buffer calculations can become incorrect

### 4. Container Change Detection Timing
- Recent fix (192d8d2) addressed container clear detection
- But rapid component addition/removal still may leave artifacts
- Multiple render requests debounced but may miss intermediate states

## Specific Scenario Analysis

### Sequence When Issue Occurs:
1. User sends "read all README.md files"
2. Multiple tool calls execute rapidly:
   - glob() finds files
   - Multiple read() calls for each README
3. Long file contents displayed with markdown formatting
4. User sends new message while output still rendering
5. New components added while previous render incomplete

### Visual Artifacts Observed:
- Text overlapping from different messages
- Partial ANSI codes causing color bleeding
- Editor borders duplicated or misaligned
- Content from previous render persisting
- Line wrapping breaking mid-word with styling

## Related Fixes
- Commit 1d9b772: Fixed ESC interrupt handling race conditions
- Commit 192d8d2: Fixed container change detection for clear operations
- Commit 2ec8a27: Added instructional header to chat demo

## Test Coverage Gaps
- No tests for rapid multi-tool execution scenarios
- Missing tests for ANSI code handling across line wraps
- No stress tests for viewport overflow with rapid updates
- Layout shift artifacts test exists but limited scope

## Recommended Solutions

### 1. Improve ANSI Handling
- Fix MarkdownComponent line wrapping to preserve ANSI codes
- Ensure escape sequences never split across operations
- Add ANSI-aware string measurement utilities

### 2. Add Render Queuing
- Implement render operation queue to prevent overlaps
- Ensure each render completes before next begins
- Add render state tracking

### 3. Enhanced Change Detection
- Track render generation/version numbers
- Validate cursor position before surgical updates
- Add checksums for rendered content verification

### 4. Comprehensive Testing
- Create test simulating exact failure scenario
- Add stress tests with rapid multi-component updates
- Test ANSI-heavy content with line wrapping
- Verify viewport calculations under load