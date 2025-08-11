# Agent/TUI: Ctrl+C Display Artifact
**Status:** Done
**Agent PID:** 36116

## Original Todo
agent/tui: when pressing ctrl + c, the editor gets pushed down by one line, after a second it gets pushed up again, leaving an artifact (duplicate bottom border). Should replicate this in a test:
    Press Ctrl+C again to exit
    ╭────────────────────────────────────────────────────────────────────────────────────────────────────────╮
    │ >                                                                                                      │
    ╰────────────────────────────────────────────────────────────────────────────────────────────────────────╯
    ╰────────────────────────────────────────────────────────────────────────────────────────────────────────╯
    ↑967 ↓12 ⚒ 4

## Description
Create a test in the TUI package that reproduces the rendering artifact issue when components dynamically shift positions (like when a status message appears and disappears). The test will verify that when components move back to their original positions after a temporary layout change, no visual artifacts (duplicate borders) remain. If the test reveals a bug in the TUI's differential rendering, fix it.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*

## Implementation Plan
Create a test that reproduces the layout shift artifact issue in the TUI differential rendering, then fix the rendering logic if needed to properly clear old content when components shift positions.

- [x] Create test file `packages/tui/test/layout-shift-artifacts.test.ts` that reproduces the issue
- [x] Test should create components in vertical layout, add a temporary component causing shifts, remove it, and verify no artifacts
- [x] Run test to confirm it reproduces the artifact issue
- [x] Fix the differential rendering logic in `packages/tui/src/tui.ts` to properly clear content when components shift
- [x] Verify all tests pass (including the new one) after fix
- [x] Run `npm run check` to ensure code quality

## Notes
The issue was NOT in the differential rendering strategy as initially thought. The real bug was in the Container component:

When a Container is cleared (has 0 children), it wasn't reporting as "changed" because the render method only checked if any children reported changes. Since there were no children after clearing, `changed` remained false, and the differential renderer didn't know to re-render that area.

The fix: Container now tracks `previousChildCount` and reports as changed when the number of children changes (especially important for going from N children to 0).

This ensures that when statusContainer.clear() is called in the agent, the differential renderer properly clears and re-renders that section of the screen.