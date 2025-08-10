# TUI Double Buffer Implementation Analysis

## Current Architecture

### Core TUI Rendering System
- **Location:** `/Users/badlogic/workspaces/pi-mono/packages/tui/src/tui.ts`
- **render()** method (lines 107-150): Traverses components, calculates keepLines
- **renderToScreen()** method (lines 354-429): Outputs to terminal with differential rendering
- **Terminal output:** Single `writeSync()` call at line 422

### Component Interface
```typescript
interface ComponentRenderResult {
  lines: string[];
  changed: boolean;
}

interface ContainerRenderResult extends ComponentRenderResult {
  keepLines: number; // Lines from top that are unchanged
}
```

### The Flicker Problem

**Root Cause:**
1. LoadingAnimation (`packages/agent/src/renderers/tui-renderer.ts`) updates every 80ms
2. Calls `ui.requestRender()` on each frame, marking itself as changed
3. Container's `keepLines` logic stops accumulating once any child changes
4. All components below animation must re-render completely
5. TextEditor always returns `changed: true` for cursor updates

**Current Differential Rendering:**
- Moves cursor up by `(totalLines - keepLines)` lines
- Clears everything from cursor down with `\x1b[0J`
- Writes all lines after `keepLines` position
- Creates visible flicker when large portions re-render

### Performance Bottlenecks

1. **TextEditor (`packages/tui/src/text-editor.ts`):**
   - Always returns `changed: true` (lines 122-125)
   - Complex `layoutText()` recalculates wrapping every render
   - Heavy computation for cursor positioning and highlighting

2. **Animation Cascade Effect:**
   - Single animated component forces all components below to re-render
   - Container stops accumulating `keepLines` after first change
   - No isolation between independent component updates

3. **Terminal I/O:**
   - Single large `writeSync()` call for all changing content
   - Clears and redraws entire sections even for minor changes

### Existing Optimizations

**Component Caching:**
- TextComponent: Stores `lastRenderedLines[]`, compares arrays
- MarkdownComponent: Uses `previousLines[]` comparison
- WhitespaceComponent: `firstRender` flag
- Components properly detect and report changes

**Render Batching:**
- `requestRender()` uses `process.nextTick()` to batch updates
- Prevents multiple renders in same tick

## Double Buffer Solution

### Architecture Benefits
- Components already return `{lines, changed}` - no interface changes needed
- Clean separation between rendering (back buffer) and output (terminal)
- Single `writeSync()` location makes implementation straightforward
- Existing component caching remains useful

### Implementation Strategy

**TuiDoubleBuffer Class:**
1. Extend current TUI class
2. Maintain front buffer (last rendered lines) and back buffer (new render)
3. Override `renderToScreen()` with line-by-line diffing algorithm
4. Batch consecutive changed lines to minimize writeSync() calls
5. Position cursor only at changed lines, not entire sections

**Line-Level Diffing Algorithm:**
```typescript
// Pseudocode
for (let i = 0; i < maxLines; i++) {
  if (frontBuffer[i] !== backBuffer[i]) {
    // Position cursor at line i
    // Clear line
    // Write new content
    // Or batch with adjacent changes
  }
}
```

### Expected Benefits

1. **Reduced Flicker:**
   - Only changed lines are redrawn
   - Animation updates don't affect static content below
   - TextEditor cursor updates don't require full redraw

2. **Better Performance:**
   - Fewer terminal control sequences
   - Smaller writeSync() payloads
   - Components can cache aggressively

3. **Preserved Functionality:**
   - No changes to existing components
   - Backward compatible with current TUI class
   - Can switch between single/double buffer modes

### Test Plan

Create comparison tests:
1. `packages/tui/test/single-buffer.ts` - Current implementation
2. `packages/tui/test/double-buffer.ts` - New implementation
3. Both with LoadingAnimation above TextEditor
4. Measure render() timing and visual flicker

### Files to Modify

**New Files:**
- `packages/tui/src/tui-double-buffer.ts` - New TuiDoubleBuffer class

**Test Files:**
- `packages/tui/test/single-buffer.ts` - Test current implementation
- `packages/tui/test/double-buffer.ts` - Test new implementation

**No Changes Needed:**
- Component implementations (already support caching and change detection)
- Component interfaces (already return required data)