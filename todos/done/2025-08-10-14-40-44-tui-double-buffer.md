# TUI Double Buffer Implementation

**Status:** Done
**Agent PID:** 74014

## Original Todo
- tui: we get tons of flicker in the text editor component. specifically, if we have an animated component above the editor, the editor needs re-rendering completely. Different strategy:
    - keep a back buffer and front buffer. a buffer is a list of lines.
    - on Tui.render()
        - render a new back buffer, top to bottom. components can cache previous render results and return that as a single list of lines if nothing changed
        - compare the back buffer with the front buffer. for each line that changed
            - position the cursor at that line
            - clear the line
            - render the new line
        - batch multiple subsequent lines that changed so we do not have tons of writeSync() calls
    - Open questions:
        - is this faster and procudes less flicker?
    - If possible, we should implement this as a new TuiDoubleBuffer class. Existing components should not need changing, as they already report if they changed and report their lines
    - Testing:
        - Create a packages/tui/test/single-buffer.ts file: it has a LoadingAnimation like in packages/agent/src/renderers/tui-renderer.ts inside a container as the first child, and a text editor component as the second child, which is focused.
        - Create a packages/tui/test/double-buffer.ts file: same setup
        - Measure timing of render() for both

## Description
Implement a double-buffering strategy for the TUI rendering system to eliminate flicker when animated components (like LoadingAnimation) are displayed above interactive components (like TextEditor). The solution will use line-by-line diffing between a front buffer (previous render) and back buffer (current render) to only update changed lines on the terminal, replacing the current section-based differential rendering.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*

## Implementation Plan
- [x] Create TuiDoubleBuffer class extending Container with same interface as TUI (`packages/tui/src/tui-double-buffer.ts`)
- [x] Implement line-by-line diffing algorithm in overridden renderToScreen() method
- [x] Add batching logic to group consecutive changed lines for efficient terminal writes
- [x] Create test file with current single-buffer implementation (`packages/tui/test/single-buffer.ts`)
- [x] Create test file with new double-buffer implementation (`packages/tui/test/double-buffer.ts`)
- [x] Add timing measurements to both test files to compare performance
- [x] Manual test: Run both test files to verify reduced flicker in double-buffer version
- [x] Manual test: Verify existing TUI functionality still works with original class
- [x] Fix cursor positioning bug in double-buffer implementation (stats appear at top, components don't update)
- [x] Add write function parameter to both TUI classes for testability
- [x] Create VirtualTerminal class for testing ANSI output
- [x] Create verification test that compares both implementations
- [x] Redesign double-buffer with proper cursor tracking to fix duplicate content issue
- [x] Implement component-based rendering with unique IDs to handle reordering

## Additional Work Completed

### Terminal Abstraction & Testing Infrastructure
- [x] Created Terminal interface abstracting stdin/stdout operations (`packages/tui/src/terminal.ts`)
- [x] Implemented ProcessTerminal for production use with process.stdin/stdout
- [x] Implemented VirtualTerminal using @xterm/headless for accurate terminal emulation in tests
- [x] Fixed @xterm/headless TypeScript imports (changed from wildcard to proper named imports)
- [x] Added test-specific methods to VirtualTerminal (flushAndGetViewport, writeSync)
- [x] Updated TUI class to accept Terminal interface via constructor for dependency injection

### Component Organization
- [x] Moved all component files to `packages/tui/src/components/` directory
- [x] Updated all imports in index.ts and test files to use new paths

### Test Suite Updates
- [x] Created comprehensive test suite for VirtualTerminal (`packages/tui/test/virtual-terminal.test.ts`)
- [x] Updated TUI rendering tests to use async/await pattern for proper render timing
- [x] Fixed all test assertions to work with exact output (no trim() allowed per user requirement)
- [x] Fixed xterm newline handling (discovered \r\n requirement vs just \n)
- [x] Added test for preserving existing terminal content when TUI starts and handles component growth

### Build Configuration
- [x] Updated root tsconfig.json to include test files for type checking
- [x] Ensured monorepo-wide type checking covers all source and test files

### Bug Fixes
- [x] Fixed TUI differential rendering bug when components grow in height
  - Issue: Old content wasn't properly cleared when component line count increased
  - Solution: Clear each old line individually before redrawing, ensure cursor at line start
  - This prevents line-wrapping artifacts when the text editor grows (e.g., SHIFT+ENTER adding lines)

## Notes
- Successfully implemented TuiDoubleBuffer class with line-by-line diffing
- Complete redesign with proper cursor tracking:
  - Tracks actual cursor position separately from buffer length
  - Clear separation between screenBuffer and new render
  - Removed console.log/stdout.write interceptors per user request
- Terminal abstraction enables proper testing without mocking process.stdin/stdout
- VirtualTerminal provides accurate terminal emulation using xterm.js
- Test results show significant reduction in flicker:
  - Single-buffer: Uses clear-down (`\x1b[0J`) which clears entire sections
  - Double-buffer: Uses clear-line (`\x1b[2K`) only for changed lines
  - Animation updates only affect the animation line, not the editor below
- Performance similar between implementations (~0.4-0.6ms per render)
- Both TUI and TuiDoubleBuffer maintain the same interface for backward compatibility
- Can be used as drop-in replacement: just change `new TUI()` to `new TuiDoubleBuffer()`
- All 22 tests passing with proper async handling and exact output matching
- Fixed critical rendering bug in TUI's differential rendering for growing components