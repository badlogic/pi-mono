# Coordination Log

## Executive Summary

This coordination session executed the **pi-overlay-core-spec.md** plan in 11m 45s. 0 workers completed 0 tasks. Total cost: $0.0000. Outcome: ended with status: analyzing.

**Session ID:** `8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d`
**Status:** analyzing
**Started:** 2026-01-07 21:02:41.076
**Duration:** 11m 45s
**Total Cost:** $0.0000
**Workers:** 0/3 succeeded

## Phase Timeline

| Phase       | Status   | Duration | Cost   | Notes                    |
|-------------|----------|----------|--------|--------------------------|
| scout       | complete | 3m 23s   | $0.64  |                          |
| coordinator | complete | 6m 17s   | $0.90  |                          |
| workers     | complete | --       | --     |                          |
| review      | complete | 1m 9s    | $0.41  |                          |
| complete    | complete | --       | --     |                          |

## Plan

**File:** `/Users/nicobailon/Documents/docs/pi-overlay-core-spec.md`

<details>
<summary>Plan Content</summary>

```markdown
# TUI Overlay Core Implementation Spec

## Overview

Add overlay rendering capability to the TUI package, allowing components to render as floating modals at absolute screen positions while preserving underlying content visibility.

**Total estimated changes: ~120 lines**

---

## Design Decisions (from interview)

| Decision | Choice |
|----------|--------|
| Cursor visibility | Managed by overlay component (cursor shows in overlay) |
| Base content updates | Allowed - overlay redraws on top after base updates |
| Input routing | Use existing `setFocus()` mechanism |
| Multiple overlays | Single active, with stack support for future |
| API surface | Add `overlay` option to existing `ctx.ui.custom()` |

---

## Part 1: TUI Package Changes

### File: `packages/tui/src/tui.ts`

#### New State (~5 lines)

```typescript
// Add after line 92 (private cursorRow = 0;)
private overlayStack: {
  component: Component;
  position: { row: number; col: number; width: number; height: number };
  preFocus: Component | null;
}[] = [];
```

#### New Public Methods (~45 lines)

```typescript
/**
 * Show an overlay component at the specified position (or centered).
 * The overlay renders on top of existing content using absolute cursor positioning.
 * Input is routed to the overlay via existing focus mechanism.
 */
showOverlay(component: Component, options?: { 
  row?: number; 
  col?: number; 
  width?: number;
}): void {
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  
  // Default width: min(80, termWidth - 4)
  const overlayWidth = Math.min(options?.width ?? 80, termWidth - 4);
  
  // Render once to determine height
  const lines = component.render(overlayWidth);
  const overlayHeight = lines.length;
  
  // Calculate position (centered by default)
  const row = options?.row ?? Math.max(0, Math.floor((termHeight - overlayHeight) / 2));
  const col = options?.col ?? Math.max(0, Math.floor((termWidth - overlayWidth) / 2));
  
  // Push onto stack
  this.overlayStack.push({
    component,
    position: { row, col, width: overlayWidth, height: overlayHeight },
    preFocus: this.focusedComponent,
  });
  
  // Focus the overlay component
  this.setFocus(component);
  
  // Show cursor (overlay may have input field)
  this.terminal.showCursor();
  
  // Trigger render - doRender() will handle base content + overlay
  this.requestRender(true); // force=true ensures full redraw
}

/**
 * Hide the topmost overlay and restore previous focus.
 */
hideOverlay(): void {
  const overlay = this.overlayStack.pop();
  if (!overlay) return;
  
  // Restore previous focus
  if (overlay.preFocus) {
    this.setFocus(overlay.preFocus);
  }
  
  // If no more overlays, hide cursor (TUI default)
  if (this.overlayStack.length === 0) {
    this.terminal.hideCursor();
  }
  
  // Force full redraw with screen clear to remove overlay remnants.
  // Set previousLines to non-empty to skip first-render path (which doesn't clear).
  // Set previousWidth to -1 (sentinel) to trigger widthChanged path (which clears).
  // If more overlays remain, the overlay code path in doRender() handles it.
  this.previousLines = [""];
  this.previousWidth = -1;
  this.cursorRow = 0;
  this.requestRender();
}

/**
 * Check if any overlay is currently shown.
 */
hasOverlay(): boolean {
  return this.overlayStack.length > 0;
}
```

#### New Private Method: `renderOverlay()` (~35 lines)

```typescript
/**
 * Render the topmost overlay using absolute cursor positioning.
 * Called after base content renders.
 */
private renderOverlay(): void {
  const overlay = this.overlayStack[this.overlayStack.length - 1];
  if (!overlay) return;
  
  const { component, position } = overlay;
  const { width } = position;
  
  // Re-render component (may have changed)
  const lines = component.render(width);
  
  // Update stored height
  overlay.position.height = lines.length;
  
  // Clamp position to viewport
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  const clampedRow = Math.max(0, Math.min(position.row, termHeight - lines.length));
  const clampedCol = Math.max(0, Math.min(position.col, termWidth - width));
  
  // Build output buffer with absolute positioning
  let buffer = "\x1b[?2026h"; // Begin synchronized output
  
  for (let i = 0; i < lines.length; i++) {
    const screenRow = clampedRow + i + 1; // ANSI uses 1-indexed rows
    const screenCol = clampedCol + 1;     // ANSI uses 1-indexed cols
    
    // Move cursor to absolute position
    buffer += `\x1b[${screenRow};${screenCol}H`;
    
    // Write line, padded to overlay width to fully overwrite background
    const line = lines[i];
    const lineWidth = visibleWidth(line);
    const padding = " ".repeat(Math.max(0, width - lineWidth));
    buffer += line + padding;
  }
  
  buffer += "\x1b[?2026l"; // End synchronized output
  this.terminal.write(buffer);
}
```

#### Modify `doRender()` (~15 lines)

Add a dedicated code path for overlay rendering at the START of `doRender()`, right after computing `newLines`. This avoids any interaction with the existing differential rendering logic:

```typescript
private doRender(): void {
  const width = this.terminal.columns;
  const height = this.terminal.rows;

  // Render all components to get new lines
  const newLines = this.render(width);

  // When overlay is active, use dedicated clear+redraw path to avoid
  // cursor position conflicts between overlay (absolute) and differential (relative)
  if (this.overlayStack.length > 0) {
    let buffer = "\x1b[?2026h"; // Begin synchronized output
    buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
    for (let i = 0; i < newLines.length; i++) {
      if (i > 0) buffer += "\r\n";
      buffer += newLines[i];
    }
    buffer += "\x1b[?2026l"; // End synchronized output
    this.terminal.write(buffer);
    this.cursorRow = newLines.length - 1;
    this.previousLines = newLines;
    this.previousWidth = width;
    this.renderOverlay();
    return; // Skip normal render paths
  }

  // ... rest of existing doRender() code unchanged ...
}
```

---

## Part 2: Extension Types Changes

### File: `packages/coding-agent/src/core/extensions/types.ts`

#### Modify `ExtensionUIContext` interface (~5 lines)

Update the `custom()` method signature to support overlay mode:

```typescript
/** Show a custom component with keyboard focus. */
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>;
```

---

## Part 3: Interactive Mode Changes

### File: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

#### Modify `showExtensionCustom()` (~20 lines)

Update the existing method to support overlay mode:

```typescript
private async showExtensionCustom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T> {
  const savedText = this.editor.getText();
  const isOverlay = options?.overlay ?? false;

  return new Promise((resolve) => {
    let component: Component & { dispose?(): void };

    const close = (result: T) => {
      component.dispose?.();
      if (isOverlay) {
        this.ui.hideOverlay();
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(this.editor);
        this.editor.setText(savedText);
        this.ui.setFocus(this.editor);
      }
      this.ui.requestRender();
      resolve(result);
    };

    Promise.resolve(factory(this.ui, theme, this.keybindings, close)).then((c) => {
      component = c;
      if (isOverlay) {
        // showOverlay() calls requestRender(true) internally
        this.ui.showOverlay(component);
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(component);
        this.ui.setFocus(component);
        this.ui.requestRender();
      }
    });
  });
}
```

#### Update `createExtensionUIContext()` (~1 line)

Change the binding to pass options through:

```typescript
custom: (factory, options) => this.showExtensionCustom(factory, options),
```

---

## Summary of Changes

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| `packages/tui/src/tui.ts` | ~100 | ~0 |
| `packages/coding-agent/src/core/extensions/types.ts` | ~3 | ~3 |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | ~15 | ~5 |
| **Total** | **~118** | **~8** |

---

## Key Implementation Notes

### Why a dedicated overlay code path in doRender()?

The TUI uses relative cursor positioning (`\x1b[nA` up, `\x1b[nB` down) for differential updates, tracking position via `cursorRow`. The overlay uses absolute positioning (`\x1b[row;colH`). After overlay renders, the cursor is inside the overlay, but `cursorRow` reflects the base content position. This mismatch would corrupt subsequent differential renders.

Rather than trying to patch the existing render paths (which have subtle edge cases around `previousLines` and `previousWidth`), we add a dedicated code path when overlay is active that:
1. Clears the screen (`\x1b[3J\x1b[2J\x1b[H`)
2. Rewrites all base content from scratch
3. Renders overlay on top
4. Returns early, skipping the normal render paths

This is simple, robust, and avoids any interaction with the differential rendering logic. Performance impact is negligible since overlay is interactive (user is typing).

### Why sentinel values in hideOverlay()?

When closing an overlay, we need to clear the screen to remove overlay remnants. The `doRender()` method has three code paths:
1. **First-render path** (`previousLines.length === 0`): Writes without clearing - assumes screen is empty
2. **WidthChanged path** (`widthChanged === true`): Clears screen then rewrites - correct for overlay close
3. **Differential path**: Uses relative cursor moves - incompatible with overlay

After `hideOverlay()`, if no more overlays remain, we need path 2 (widthChanged). Setting `previousLines = [""]` (non-empty) skips path 1, and setting `previousWidth = -1` (sentinel that differs from any real width) triggers path 2.

If overlays remain after `hideOverlay()`, the overlay code path in `doRender()` handles it (which also clears screen).

### Why no `getCursorPosition()` interface?

Removed to reduce complexity. The cursor ends up at the last written position in the overlay, which is typically the end of the last line. Overlay components can include cursor positioning in their own ANSI output if needed. Most command palettes don't need precise cursor positioning anyway - the visual cursor in the input field is rendered as part of the component's output (e.g., `"> search█"`).

---

## Usage Example

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => {
    return new CommandPaletteComponent({
      theme,
      onClose: done,
      items: ["item1", "item2", "item3"],
    });
  },
  { overlay: true }
);
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| Terminal resize during overlay | Full re-render recalculates position, overlay re-renders centered |
| Base content updates during overlay | Full re-render + overlay on top (layering preserved) |
| Overlay larger than terminal | Clamped to fit within viewport |
| User closes overlay | `hideOverlay()` forces full redraw to restore underlying content |
| Nested overlays | Stack-based - `showOverlay()` pushes, `hideOverlay()` pops |
| Focus restoration | Stored in stack entry, restored on `hideOverlay()` |
| No base changes, overlay changes | Full re-render via dedicated overlay code path |

---

## Testing Checklist

- [ ] Overlay renders centered on screen
- [ ] Underlying content visible around overlay edges
- [ ] Keyboard input routes to overlay component
- [ ] Escape/close properly restores underlying content
- [ ] Terminal resize repositions overlay correctly
- [ ] Typing in overlay updates display correctly
- [ ] Cursor visible in overlay
- [ ] Focus returns to editor after overlay closes
- [ ] Multiple rapid overlay open/close doesn't corrupt display

```

</details>

## Workers Summary

| Worker | Status | Duration | Cost | Turns | Files Modified |
|--------|--------|----------|------|-------|----------------|
| worker:worker-070e | working | -- | $0.0000 | 0 | -- |
| worker:worker-8eee | working | -- | $0.0000 | 0 | -- |
| worker:worker-c563 | working | -- | $0.0000 | 0 | -- |

## Contracts

| Item | Type | Provider | Waiters | Status |
|------|------|----------|---------|--------|
| TUI overlay methods | function | worker-tui | worker-interactive | pending |
| ExtensionUIContext custom options | type | worker-types | worker-interactive | pending |

## Event Timeline

- `+0.0s` 
- `+0.1s` 
- `+8.3s` 
- `+8.3s` [scout] bash (pack...)
- `+8.3s` [scout] bash (pac...)
- `+8.3s` [scout] bash (pac...)
- `+8.3s` [scout] bash (pac...)
- `+18.0s` [scout] read (...)
- `+18.0s` [scout] bash (...)
- `+18.0s` [scout] bash (...)
- `+24.8s` 
- `+24.8s` [scout] read (...)
- `+30.4s` [scout] bash (dev...)
- `+30.4s` [scout] bash (pa...)
- `+30.4s` [scout] bash (pi-mono...)
- `+38.1s` [scout] bash (nicobailon...)
- `+38.1s` [scout] read (...)
- `+38.1s` [scout] bash (Us...)
- `+42.3s` 
- `+42.3s` [scout] read (...)
- `+42.3s` [scout] bash (pa...)
- `+48.5s` [scout] read (...)
- `+48.5s` [scout] read (...)
- `+52.2s` [scout] read (...)
- `+193.1s` 
- `+193.1s` [scout] write (8b562...)
- `+203.4s` 
- `+203.4s` 
- `+203.4s` **Phase scout complete** (3m 23s, $0.64)
- `+203.4s` 
- `+203.5s` 
- `+203.5s` 
- `+258.4s` 
- `+258.4s` 
- `+258.5s` **Phase planner complete** (55s, $0.21)
- `+258.5s` 
- `+258.5s` 
- `+284.9s` 
- `+284.9s` 
- `+284.9s` 
- `+284.9s` [coordina] assign_files
- `+284.9s` 
- `+284.9s` 
- `+284.9s` [coordina] assign_files
- `+284.9s` 
- `+284.9s` [coordina] assign_files
- `+291.3s` [coordinator] Contract created: TUI overlay methods
- `+291.3s` 
- `+291.3s` [coordina] create_contract
- `+291.3s` [coordinator] Contract created: ExtensionUIContext custom options
- `+291.3s` 
- `+291.3s` [coordina] create_contract
- `+328.4s` 
- `+328.4s` 
- `+328.4s` 
- `+328.4s` 
- `+328.4s` **[c5632f18]** Worker started
- `+328.4s` **[c5632f18]** Worker started
- `+328.4s` 
- `+328.4s` **[8eeee2c3]** Worker started
- `+328.4s` **[8eeee2c3]** Worker started
- `+328.4s` 
- `+328.4s` **[070e726d]** Worker started
- `+328.4s` **[070e726d]** Worker started
- `+329.2s` [coordinator] [worker:worker-c563] stderr: [rewind] Extension loaded
- `+329.2s` [coordinator] [worker:worker-8eee] stderr: [rewind] Extension loaded
- `+329.2s` [coordinator] [worker:worker-070e] stderr: [rewind] Extension loaded
- `+335.9s` [worker-t] read (8b562...)
- `+335.9s` [worker-t] read (...)
- `+336.4s` [worker-t] read (8b562...)
- `+336.4s` [worker-t] read (...)
- `+337.0s` [worker-i] agent_sync
- `+337.0s` [worker-i] agent_sync
- `+337.0s` [worker-i] read (8b562...)
- `+345.7s` [worker-t] edit (...)
- `+346.4s` [worker-t] edit (...)
- `+346.9s` [worker-i] read (...)
- `+346.9s` [worker-i] read (...)
- `+349.8s` [worker-t] read (...)
- `+361.4s` [worker-t] edit (...)
- `+363.7s` [worker-t] agent_sync
- `+363.7s` [worker-t] write (8b562...)
- `+364.9s` [worker-i] edit (...)
- `+369.0s` [worker-t] agent_work
- `+369.7s` [worker-i] edit (...)
- `+372.9s` [worker-t] edit (...)
- `+374.3s` [worker-i] read (...)
- `+374.3s` [worker-i] read (...)
- `+378.6s` [worker-i] bash (pi-mono && npx...)
- `+381.1s` [worker-t] edit (...)
- `+382.4s` [worker-i] bash (pi-mono && fin...)
- `+385.0s` [worker-t] bash (pi-mono && hea...)
- `+387.2s` [worker-i] bash (pi-mono && npx...)
- `+389.5s` [worker-t] bash (pi-mono && gre...)
- `+393.9s` [worker-t] read (...)
- `+399.8s` [worker-t] bash (packag...)
- `+405.8s` [worker-i] write (8b562...)
- `+406.7s` [worker-t] bash (packag...)
- `+411.3s` [worker-t] bash (pi-mono && pnp...)
- `+415.6s` [worker-t] bash (pi-mono && cat...)
- `+421.3s` [worker-t] bash (pi-mono && pnp...)
- `+427.2s` [worker-t] bash (packag...)
- `+432.0s` [worker-t] bash (packag...)
- `+449.3s` [worker-t] write (8b562...)
- `+465.6s` **[c5632f18]** Worker completed
- `+465.6s` **[8eeee2c3]** Worker completed
- `+465.6s` **[070e726d]** Worker completed
- `+465.6s` [coordina] spawn_workers
- `+470.3s` [coordina] check_status
- `+477.0s` [coordina] bash (pi-mono && git...)
- `+482.2s` [coordina] bash (pi-mono && gre...)
- `+482.2s` [coordina] bash (pi-mono && gre...)
- `+482.2s` [coordina] bash (pi-mono && gre...)
- `+487.0s` [coordina] bash (pi-mono && npx...)
- `+487.2s` [coordina] bash (pi-mono && npx...)
- `+491.4s` [coordina] bash (pi-mono && fin...)
- `+495.3s` [coordina] bash (pi-mono && ls ...)
- `+499.8s` [coordina] bash (pi-mono && cat...)
- `+504.0s` [coordina] bash (packag...)
- `+509.3s` [coordina] bash (packag...)
- `+519.7s` [coordina] update_progress
- `+536.0s` [coordina] done
- `+544.3s` [coordina] check_status
- `+551.5s` [coordina] bash (pi-mono && git...)
- `+557.3s` [coordina] bash (pi-mono && git...)
- `+557.3s` [coordina] bash (pi-mono && git...)
- `+565.2s` [coordina] check_status
- `+570.8s` [coordina] coord_output
- `+574.8s` [coordina] coord_output
- `+590.3s` [coordina] done
- `+601.3s` [coordina] bash (coordinatio...)
- `+605.4s` [coordina] bash (8...)
- `+609.0s` [coordina] bash (8...)
- `+613.6s` [coordina] bash (coordinat...)
- `+625.3s` [coordina] bash (pi-mono && gre...)
- `+625.3s` [coordina] bash (pi-mono && gre...)
- `+625.3s` [coordina] bash (pi-mono && gre...)
- `+636.4s` 
- `+636.4s` 
- `+636.4s` **Phase coordinator complete** (6m 17s, $0.90)
- `+636.4s` 
- `+636.4s` 
- `+636.4s` **Phase workers complete** (0s, $0.00)
- `+636.4s` 
- `+636.4s` 
- `+705.8s` 
- `+705.8s` 
- `+705.8s` 
- `+705.8s` **Phase review complete** (1m 9s, $0.41)
- `+705.8s` 
- `+705.8s` **Phase complete complete** (0s, $0.00)
- `+705.8s` 

## Worker Details

### worker:worker-070e

- **Agent:** worker
- **Status:** working
- **Assigned Steps:** 3
- **Completed Steps:** none

<details>
<summary>Handshake Spec</summary>

```
## Your Assignment: Interactive Mode Integration

**Worker**: worker-interactive
**Files**: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

### Shared Context
Read `/Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/shared-context.md` for full plan details.

### Dependencies - WAIT FIRST
Before starting work, wait for both contracts:
1. `wait_for_contract({ item: 'TUI overlay methods' })`
2. `wait_for_contract({ item: 'ExtensionUIContext custom options' })`

### Your Task
Implement Part 3 of the spec - wire up overlay support in interactive mode:

**File**: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

1. **Modify showExtensionCustom()** (around line 1000-1030):
   - Add `options?: { overlay?: boolean }` parameter
   - Extract `const isOverlay = options?.overlay ?? false;`
   - In `close()` callback:
     - If isOverlay: call `this.ui.hideOverlay()` instead of manipulating editorContainer
     - If not overlay: keep existing editorContainer.clear()/addChild() logic
   - After factory resolves:
     - If isOverlay: call `this.ui.showOverlay(component)` instead of editorContainer manipulation
     - If not overlay: keep existing editorContainer.clear()/addChild() logic

2. **Update createExtensionUIContext()** (around line 755):
   - Change from: `custom: (factory) => this.showExtensionCustom(factory),`
   - To: `custom: (factory, options) => this.showExtensionCustom(factory, options),`

### Working Directory
`/Users/nicobailon/Documents/development/pi-mono`

## Your Context
- **Identity:** worker:worker-070e
- **Logical Name:** worker-interactive
- **Assigned Files:** packages/coding-agent/src/modes/interactive/interactive-mode.ts
- **Adjacent Workers:** worker-tui -> worker:worker-c563, worker-types -> worker:worker-8eee

## Shared Context
Read: /Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/shared-context.md

## Output
Write primary results to: /Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/outputs/070e726d-30b1-430d-99db-ec25bf970edb.md

## Identity Mapping
- worker-tui = worker:worker-c563
- worker-types = worker:worker-8eee
- worker-interactive = worker:worker-070e

## Full Plan
```markdown
# TUI Overlay Core Implementation Spec

## Overview

Add overlay rendering capability to the TUI package, allowing components to render as floating modals at absolute screen positions while preserving underlying content visibility.

**Total estimated changes: ~120 lines**

---

## Design Decisions (from interview)

| Decision | Choice |
|----------|--------|
| Cursor visibility | Managed by overlay component (cursor shows in overlay) |
| Base content updates | Allowed - overlay redraws on top after base updates |
| Input routing | Use existing `setFocus()` mechanism |
| Multiple overlays | Single active, with stack support for future |
| API surface | Add `overlay` option to existing `ctx.ui.custom()` |

---

## Part 1: TUI Package Changes

### File: `packages/tui/src/tui.ts`

#### New State (~5 lines)

```typescript
// Add after line 92 (private cursorRow = 0;)
private overlayStack: {
  component: Component;
  position: { row: number; col: number; width: number; height: number };
  preFocus: Component | null;
}[] = [];
```

#### New Public Methods (~45 lines)

```typescript
/**
 * Show an overlay component at the specified position (or centered).
 * The overlay renders on top of existing content using absolute cursor positioning.
 * Input is routed to the overlay via existing focus mechanism.
 */
showOverlay(component: Component, options?: { 
  row?: number; 
  col?: number; 
  width?: number;
}): void {
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  
  // Default width: min(80, termWidth - 4)
  const overlayWidth = Math.min(options?.width ?? 80, termWidth - 4);
  
  // Render once to determine height
  const lines = component.render(overlayWidth);
  const overlayHeight = lines.length;
  
  // Calculate position (centered by default)
  const row = options?.row ?? Math.max(0, Math.floor((termHeight - overlayHeight) / 2));
  const col = options?.col ?? Math.max(0, Math.floor((termWidth - overlayWidth) / 2));
  
  // Push onto stack
  this.overlayStack.push({
    component,
    position: { row, col, width: overlayWidth, height: overlayHeight },
    preFocus: this.focusedComponent,
  });
  
  // Focus the overlay component
  this.setFocus(component);
  
  // Show cursor (overlay may have input field)
  this.terminal.showCursor();
  
  // Trigger render - doRender() will handle base content + overlay
  this.requestRender(true); // force=true ensures full redraw
}

/**
 * Hide the topmost overlay and restore previous focus.
 */
hideOverlay(): void {
  const overlay = this.overlayStack.pop();
  if (!overlay) return;
  
  // Restore previous focus
  if (overlay.preFocus) {
    this.setFocus(overlay.preFocus);
  }
  
  // If no more overlays, hide cursor (TUI default)
  if (this.overlayStack.length === 0) {
    this.terminal.hideCursor();
  }
  
  // Force full redraw with screen clear to remove overlay remnants.
  // Set previousLines to non-empty to skip first-render path (which doesn't clear).
  // Set previousWidth to -1 (sentinel) to trigger widthChanged path (which clears).
  // If more overlays remain, the overlay code path in doRender() handles it.
  this.previousLines = [""];
  this.previousWidth = -1;
  this.cursorRow = 0;
  this.requestRender();
}

/**
 * Check if any overlay is currently shown.
 */
hasOverlay(): boolean {
  return this.overlayStack.length > 0;
}
```

#### New Private Method: `renderOverlay()` (~35 lines)

```typescript
/**
 * Render the topmost overlay using absolute cursor positioning.
 * Called after base content renders.
 */
private renderOverlay(): void {
  const overlay = this.overlayStack[this.overlayStack.length - 1];
  if (!overlay) return;
  
  const { component, position } = overlay;
  const { width } = position;
  
  // Re-render component (may have changed)
  const lines = component.render(width);
  
  // Update stored height
  overlay.position.height = lines.length;
  
  // Clamp position to viewport
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  const clampedRow = Math.max(0, Math.min(position.row, termHeight - lines.length));
  const clampedCol = Math.max(0, Math.min(position.col, termWidth - width));
  
  // Build output buffer with absolute positioning
  let buffer = "\x1b[?2026h"; // Begin synchronized output
  
  for (let i = 0; i < lines.length; i++) {
    const screenRow = clampedRow + i + 1; // ANSI uses 1-indexed rows
    const screenCol = clampedCol + 1;     // ANSI uses 1-indexed cols
    
    // Move cursor to absolute position
    buffer += `\x1b[${screenRow};${screenCol}H`;
    
    // Write line, padded to overlay width to fully overwrite background
    const line = lines[i];
    const lineWidth = visibleWidth(line);
    const padding = " ".repeat(Math.max(0, width - lineWidth));
    buffer += line + padding;
  }
  
  buffer += "\x1b[?2026l"; // End synchronized output
  this.terminal.write(buffer);
}
```

#### Modify `doRender()` (~15 lines)

Add a dedicated code path for overlay rendering at the START of `doRender()`, right after computing `newLines`. This avoids any interaction with the existing differential rendering logic:

```typescript
private doRender(): void {
  const width = this.terminal.columns;
  const height = this.terminal.rows;

  // Render all components to get new lines
  const newLines = this.render(width);

  // When overlay is active, use dedicated clear+redraw path to avoid
  // cursor position conflicts between overlay (absolute) and differential (relative)
  if (this.overlayStack.length > 0) {
    let buffer = "\x1b[?2026h"; // Begin synchronized output
    buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
    for (let i = 0; i < newLines.length; i++) {
      if (i > 0) buffer += "\r\n";
      buffer += newLines[i];
    }
    buffer += "\x1b[?2026l"; // End synchronized output
    this.terminal.write(buffer);
    this.cursorRow = newLines.length - 1;
    this.previousLines = newLines;
    this.previousWidth = width;
    this.renderOverlay();
    return; // Skip normal render paths
  }

  // ... rest of existing doRender() code unchanged ...
}
```

---

## Part 2: Extension Types Changes

### File: `packages/coding-agent/src/core/extensions/types.ts`

#### Modify `ExtensionUIContext` interface (~5 lines)

Update the `custom()` method signature to support overlay mode:

```typescript
/** Show a custom component with keyboard focus. */
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>;
```

---

## Part 3: Interactive Mode Changes

### File: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

#### Modify `showExtensionCustom()` (~20 lines)

Update the existing method to support overlay mode:

```typescript
private async showExtensionCustom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T> {
  const savedText = this.editor.getText();
  const isOverlay = options?.overlay ?? false;

  return new Promise((resolve) => {
    let component: Component & { dispose?(): void };

    const close = (result: T) => {
      component.dispose?.();
      if (isOverlay) {
        this.ui.hideOverlay();
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(this.editor);
        this.editor.setText(savedText);
        this.ui.setFocus(this.editor);
      }
      this.ui.requestRender();
      resolve(result);
    };

    Promise.resolve(factory(this.ui, theme, this.keybindings, close)).then((c) => {
      component = c;
      if (isOverlay) {
        // showOverlay() calls requestRender(true) internally
        this.ui.showOverlay(component);
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(component);
        this.ui.setFocus(component);
        this.ui.requestRender();
      }
    });
  });
}
```

#### Update `createExtensionUIContext()` (~1 line)

Change the binding to pass options through:

```typescript
custom: (factory, options) => this.showExtensionCustom(factory, options),
```

---

## Summary of Changes

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| `packages/tui/src/tui.ts` | ~100 | ~0 |
| `packages/coding-agent/src/core/extensions/types.ts` | ~3 | ~3 |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | ~15 | ~5 |
| **Total** | **~118** | **~8** |

---

## Key Implementation Notes

### Why a dedicated overlay code path in doRender()?

The TUI uses relative cursor positioning (`\x1b[nA` up, `\x1b[nB` down) for differential updates, tracking position via `cursorRow`. The overlay uses absolute positioning (`\x1b[row;colH`). After overlay renders, the cursor is inside the overlay, but `cursorRow` reflects the base content position. This mismatch would corrupt subsequent differential renders.

Rather than trying to patch the existing render paths (which have subtle edge cases around `previousLines` and `previousWidth`), we add a dedicated code path when overlay is active that:
1. Clears the screen (`\x1b[3J\x1b[2J\x1b[H`)
2. Rewrites all base content from scratch
3. Renders overlay on top
4. Returns early, skipping the normal render paths

This is simple, robust, and avoids any interaction with the differential rendering logic. Performance impact is negligible since overlay is interactive (user is typing).

### Why sentinel values in hideOverlay()?

When closing an overlay, we need to clear the screen to remove overlay remnants. The `doRender()` method has three code paths:
1. **First-render path** (`previousLines.length === 0`): Writes without clearing - assumes screen is empty
2. **WidthChanged path** (`widthChanged === true`): Clears screen then rewrites - correct for overlay close
3. **Differential path**: Uses relative cursor moves - incompatible with overlay

After `hideOverlay()`, if no more overlays remain, we need path 2 (widthChanged). Setting `previousLines = [""]` (non-empty) skips path 1, and setting `previousWidth = -1` (sentinel that differs from any real width) triggers path 2.

If overlays remain after `hideOverlay()`, the overlay code path in `doRender()` handles it (which also clears screen).

### Why no `getCursorPosition()` interface?

Removed to reduce complexity. The cursor ends up at the last written position in the overlay, which is typically the end of the last line. Overlay components can include cursor positioning in their own ANSI output if needed. Most command palettes don't need precise cursor positioning anyway - the visual cursor in the input field is rendered as part of the component's output (e.g., `"> search█"`).

---

## Usage Example

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => {
    return new CommandPaletteComponent({
      theme,
      onClose: done,
      items: ["item1", "item2", "item3"],
    });
  },
  { overlay: true }
);
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| Terminal resize during overlay | Full re-render recalculates position, overlay re-renders centered |
| Base content updates during overlay | Full re-render + overlay on top (layering preserved) |
| Overlay larger than terminal | Clamped to fit within viewport |
| User closes overlay | `hideOverlay()` forces full redraw to restore underlying content |
| Nested overlays | Stack-based - `showOverlay()` pushes, `hideOverlay()` pops |
| Focus restoration | Stored in stack entry, restored on `hideOverlay()` |
| No base changes, overlay changes | Full re-render via dedicated overlay code path |

---

## Testing Checklist

- [ ] Overlay renders centered on screen
- [ ] Underlying content visible around overlay edges
- [ ] Keyboard input routes to overlay component
- [ ] Escape/close properly restores underlying content
- [ ] Terminal resize repositions overlay correctly
- [ ] Typing in overlay updates display correctly
- [ ] Cursor visible in overlay
- [ ] Focus returns to editor after overlay closes
- [ ] Multiple rapid overlay open/close doesn't corrupt display

```

```

</details>

### worker:worker-8eee

- **Agent:** worker
- **Status:** working
- **Assigned Steps:** 2
- **Completed Steps:** none

<details>
<summary>Handshake Spec</summary>

```
## Your Assignment: Extension Types Update

**Worker**: worker-types
**Files**: `packages/coding-agent/src/core/extensions/types.ts`

### Shared Context
Read `/Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/shared-context.md` for full plan details.

### Your Task
Implement Part 2 of the spec - update the `custom()` method signature in `ExtensionUIContext` interface:

**File**: `packages/coding-agent/src/core/extensions/types.ts` (around line 94-100)

**Change the custom() signature from**:
```typescript
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
): Promise<T>;
```

**To**:
```typescript
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>;
```

This adds an optional `options` parameter with an `overlay` boolean flag.

### Contract
When complete, call `signal_contract_complete({ item: 'ExtensionUIContext custom options', file: 'packages/coding-agent/src/core/extensions/types.ts' })`

### Working Directory
`/Users/nicobailon/Documents/development/pi-mono`

## Your Context
- **Identity:** worker:worker-8eee
- **Logical Name:** worker-types
- **Assigned Files:** packages/coding-agent/src/core/extensions/types.ts
- **Adjacent Workers:** worker-interactive -> worker:worker-070e

## Shared Context
Read: /Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/shared-context.md

## Output
Write primary results to: /Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/outputs/8eeee2c3-9fc8-41bc-9a6b-7677a921156e.md

## Identity Mapping
- worker-tui = worker:worker-c563
- worker-types = worker:worker-8eee
- worker-interactive = worker:worker-070e

## Full Plan
```markdown
# TUI Overlay Core Implementation Spec

## Overview

Add overlay rendering capability to the TUI package, allowing components to render as floating modals at absolute screen positions while preserving underlying content visibility.

**Total estimated changes: ~120 lines**

---

## Design Decisions (from interview)

| Decision | Choice |
|----------|--------|
| Cursor visibility | Managed by overlay component (cursor shows in overlay) |
| Base content updates | Allowed - overlay redraws on top after base updates |
| Input routing | Use existing `setFocus()` mechanism |
| Multiple overlays | Single active, with stack support for future |
| API surface | Add `overlay` option to existing `ctx.ui.custom()` |

---

## Part 1: TUI Package Changes

### File: `packages/tui/src/tui.ts`

#### New State (~5 lines)

```typescript
// Add after line 92 (private cursorRow = 0;)
private overlayStack: {
  component: Component;
  position: { row: number; col: number; width: number; height: number };
  preFocus: Component | null;
}[] = [];
```

#### New Public Methods (~45 lines)

```typescript
/**
 * Show an overlay component at the specified position (or centered).
 * The overlay renders on top of existing content using absolute cursor positioning.
 * Input is routed to the overlay via existing focus mechanism.
 */
showOverlay(component: Component, options?: { 
  row?: number; 
  col?: number; 
  width?: number;
}): void {
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  
  // Default width: min(80, termWidth - 4)
  const overlayWidth = Math.min(options?.width ?? 80, termWidth - 4);
  
  // Render once to determine height
  const lines = component.render(overlayWidth);
  const overlayHeight = lines.length;
  
  // Calculate position (centered by default)
  const row = options?.row ?? Math.max(0, Math.floor((termHeight - overlayHeight) / 2));
  const col = options?.col ?? Math.max(0, Math.floor((termWidth - overlayWidth) / 2));
  
  // Push onto stack
  this.overlayStack.push({
    component,
    position: { row, col, width: overlayWidth, height: overlayHeight },
    preFocus: this.focusedComponent,
  });
  
  // Focus the overlay component
  this.setFocus(component);
  
  // Show cursor (overlay may have input field)
  this.terminal.showCursor();
  
  // Trigger render - doRender() will handle base content + overlay
  this.requestRender(true); // force=true ensures full redraw
}

/**
 * Hide the topmost overlay and restore previous focus.
 */
hideOverlay(): void {
  const overlay = this.overlayStack.pop();
  if (!overlay) return;
  
  // Restore previous focus
  if (overlay.preFocus) {
    this.setFocus(overlay.preFocus);
  }
  
  // If no more overlays, hide cursor (TUI default)
  if (this.overlayStack.length === 0) {
    this.terminal.hideCursor();
  }
  
  // Force full redraw with screen clear to remove overlay remnants.
  // Set previousLines to non-empty to skip first-render path (which doesn't clear).
  // Set previousWidth to -1 (sentinel) to trigger widthChanged path (which clears).
  // If more overlays remain, the overlay code path in doRender() handles it.
  this.previousLines = [""];
  this.previousWidth = -1;
  this.cursorRow = 0;
  this.requestRender();
}

/**
 * Check if any overlay is currently shown.
 */
hasOverlay(): boolean {
  return this.overlayStack.length > 0;
}
```

#### New Private Method: `renderOverlay()` (~35 lines)

```typescript
/**
 * Render the topmost overlay using absolute cursor positioning.
 * Called after base content renders.
 */
private renderOverlay(): void {
  const overlay = this.overlayStack[this.overlayStack.length - 1];
  if (!overlay) return;
  
  const { component, position } = overlay;
  const { width } = position;
  
  // Re-render component (may have changed)
  const lines = component.render(width);
  
  // Update stored height
  overlay.position.height = lines.length;
  
  // Clamp position to viewport
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  const clampedRow = Math.max(0, Math.min(position.row, termHeight - lines.length));
  const clampedCol = Math.max(0, Math.min(position.col, termWidth - width));
  
  // Build output buffer with absolute positioning
  let buffer = "\x1b[?2026h"; // Begin synchronized output
  
  for (let i = 0; i < lines.length; i++) {
    const screenRow = clampedRow + i + 1; // ANSI uses 1-indexed rows
    const screenCol = clampedCol + 1;     // ANSI uses 1-indexed cols
    
    // Move cursor to absolute position
    buffer += `\x1b[${screenRow};${screenCol}H`;
    
    // Write line, padded to overlay width to fully overwrite background
    const line = lines[i];
    const lineWidth = visibleWidth(line);
    const padding = " ".repeat(Math.max(0, width - lineWidth));
    buffer += line + padding;
  }
  
  buffer += "\x1b[?2026l"; // End synchronized output
  this.terminal.write(buffer);
}
```

#### Modify `doRender()` (~15 lines)

Add a dedicated code path for overlay rendering at the START of `doRender()`, right after computing `newLines`. This avoids any interaction with the existing differential rendering logic:

```typescript
private doRender(): void {
  const width = this.terminal.columns;
  const height = this.terminal.rows;

  // Render all components to get new lines
  const newLines = this.render(width);

  // When overlay is active, use dedicated clear+redraw path to avoid
  // cursor position conflicts between overlay (absolute) and differential (relative)
  if (this.overlayStack.length > 0) {
    let buffer = "\x1b[?2026h"; // Begin synchronized output
    buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
    for (let i = 0; i < newLines.length; i++) {
      if (i > 0) buffer += "\r\n";
      buffer += newLines[i];
    }
    buffer += "\x1b[?2026l"; // End synchronized output
    this.terminal.write(buffer);
    this.cursorRow = newLines.length - 1;
    this.previousLines = newLines;
    this.previousWidth = width;
    this.renderOverlay();
    return; // Skip normal render paths
  }

  // ... rest of existing doRender() code unchanged ...
}
```

---

## Part 2: Extension Types Changes

### File: `packages/coding-agent/src/core/extensions/types.ts`

#### Modify `ExtensionUIContext` interface (~5 lines)

Update the `custom()` method signature to support overlay mode:

```typescript
/** Show a custom component with keyboard focus. */
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>;
```

---

## Part 3: Interactive Mode Changes

### File: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

#### Modify `showExtensionCustom()` (~20 lines)

Update the existing method to support overlay mode:

```typescript
private async showExtensionCustom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T> {
  const savedText = this.editor.getText();
  const isOverlay = options?.overlay ?? false;

  return new Promise((resolve) => {
    let component: Component & { dispose?(): void };

    const close = (result: T) => {
      component.dispose?.();
      if (isOverlay) {
        this.ui.hideOverlay();
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(this.editor);
        this.editor.setText(savedText);
        this.ui.setFocus(this.editor);
      }
      this.ui.requestRender();
      resolve(result);
    };

    Promise.resolve(factory(this.ui, theme, this.keybindings, close)).then((c) => {
      component = c;
      if (isOverlay) {
        // showOverlay() calls requestRender(true) internally
        this.ui.showOverlay(component);
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(component);
        this.ui.setFocus(component);
        this.ui.requestRender();
      }
    });
  });
}
```

#### Update `createExtensionUIContext()` (~1 line)

Change the binding to pass options through:

```typescript
custom: (factory, options) => this.showExtensionCustom(factory, options),
```

---

## Summary of Changes

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| `packages/tui/src/tui.ts` | ~100 | ~0 |
| `packages/coding-agent/src/core/extensions/types.ts` | ~3 | ~3 |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | ~15 | ~5 |
| **Total** | **~118** | **~8** |

---

## Key Implementation Notes

### Why a dedicated overlay code path in doRender()?

The TUI uses relative cursor positioning (`\x1b[nA` up, `\x1b[nB` down) for differential updates, tracking position via `cursorRow`. The overlay uses absolute positioning (`\x1b[row;colH`). After overlay renders, the cursor is inside the overlay, but `cursorRow` reflects the base content position. This mismatch would corrupt subsequent differential renders.

Rather than trying to patch the existing render paths (which have subtle edge cases around `previousLines` and `previousWidth`), we add a dedicated code path when overlay is active that:
1. Clears the screen (`\x1b[3J\x1b[2J\x1b[H`)
2. Rewrites all base content from scratch
3. Renders overlay on top
4. Returns early, skipping the normal render paths

This is simple, robust, and avoids any interaction with the differential rendering logic. Performance impact is negligible since overlay is interactive (user is typing).

### Why sentinel values in hideOverlay()?

When closing an overlay, we need to clear the screen to remove overlay remnants. The `doRender()` method has three code paths:
1. **First-render path** (`previousLines.length === 0`): Writes without clearing - assumes screen is empty
2. **WidthChanged path** (`widthChanged === true`): Clears screen then rewrites - correct for overlay close
3. **Differential path**: Uses relative cursor moves - incompatible with overlay

After `hideOverlay()`, if no more overlays remain, we need path 2 (widthChanged). Setting `previousLines = [""]` (non-empty) skips path 1, and setting `previousWidth = -1` (sentinel that differs from any real width) triggers path 2.

If overlays remain after `hideOverlay()`, the overlay code path in `doRender()` handles it (which also clears screen).

### Why no `getCursorPosition()` interface?

Removed to reduce complexity. The cursor ends up at the last written position in the overlay, which is typically the end of the last line. Overlay components can include cursor positioning in their own ANSI output if needed. Most command palettes don't need precise cursor positioning anyway - the visual cursor in the input field is rendered as part of the component's output (e.g., `"> search█"`).

---

## Usage Example

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => {
    return new CommandPaletteComponent({
      theme,
      onClose: done,
      items: ["item1", "item2", "item3"],
    });
  },
  { overlay: true }
);
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| Terminal resize during overlay | Full re-render recalculates position, overlay re-renders centered |
| Base content updates during overlay | Full re-render + overlay on top (layering preserved) |
| Overlay larger than terminal | Clamped to fit within viewport |
| User closes overlay | `hideOverlay()` forces full redraw to restore underlying content |
| Nested overlays | Stack-based - `showOverlay()` pushes, `hideOverlay()` pops |
| Focus restoration | Stored in stack entry, restored on `hideOverlay()` |
| No base changes, overlay changes | Full re-render via dedicated overlay code path |

---

## Testing Checklist

- [ ] Overlay renders centered on screen
- [ ] Underlying content visible around overlay edges
- [ ] Keyboard input routes to overlay component
- [ ] Escape/close properly restores underlying content
- [ ] Terminal resize repositions overlay correctly
- [ ] Typing in overlay updates display correctly
- [ ] Cursor visible in overlay
- [ ] Focus returns to editor after overlay closes
- [ ] Multiple rapid overlay open/close doesn't corrupt display

```

```

</details>

### worker:worker-c563

- **Agent:** worker
- **Status:** working
- **Assigned Steps:** 1
- **Completed Steps:** none

<details>
<summary>Handshake Spec</summary>

```
## Your Assignment: TUI Overlay Implementation

**Worker**: worker-tui
**Files**: `packages/tui/src/tui.ts`

### Shared Context
Read `/Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/shared-context.md` for full plan details.

### Your Task
Implement Part 1 of the TUI Overlay spec in `packages/tui/src/tui.ts`:

1. **Add overlayStack state** (after line 92, after `private cursorRow = 0;`):
```typescript
private overlayStack: {
  component: Component;
  position: { row: number; col: number; width: number; height: number };
  preFocus: Component | null;
}[] = [];
```

2. **Add public methods**:
   - `showOverlay(component: Component, options?: { row?: number; col?: number; width?: number }): void`
     - Default width: min(80, termWidth - 4)
     - Render once to get height
     - Center by default
     - Push to overlayStack with preFocus
     - Call setFocus(component)
     - Call terminal.showCursor()
     - Call requestRender(true)
   
   - `hideOverlay(): void`
     - Pop from overlayStack
     - Restore preFocus
     - If no overlays left, call terminal.hideCursor()
     - Set previousLines = [""], previousWidth = -1, cursorRow = 0
     - Call requestRender()
   
   - `hasOverlay(): boolean` - return overlayStack.length > 0

3. **Add private renderOverlay() method**:
   - Get topmost overlay from stack
   - Re-render component at stored width
   - Update position.height
   - Clamp position to viewport
   - Use absolute cursor positioning: `\x1b[row;colH`
   - Wrap in synchronized output
   - Pad lines to overlay width

4. **Modify doRender()**: Add overlay code path at START of method, after computing newLines:
   - If overlayStack.length > 0:
     - Clear screen: `\x1b[3J\x1b[2J\x1b[H`
     - Write all newLines
     - Update cursorRow, previousLines, previousWidth
     - Call renderOverlay()
     - Return early (skip normal render paths)

### Contract
When complete, call `signal_contract_complete({ item: 'TUI overlay methods', file: 'packages/tui/src/tui.ts' })`

### Working Directory
`/Users/nicobailon/Documents/development/pi-mono`

## Your Context
- **Identity:** worker:worker-c563
- **Logical Name:** worker-tui
- **Assigned Files:** packages/tui/src/tui.ts
- **Adjacent Workers:** worker-interactive -> worker:worker-070e

## Shared Context
Read: /Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/shared-context.md

## Output
Write primary results to: /Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d/outputs/c5632f18-4188-4f3d-9954-b7a30c89e7e5.md

## Identity Mapping
- worker-tui = worker:worker-c563
- worker-types = worker:worker-8eee
- worker-interactive = worker:worker-070e

## Full Plan
```markdown
# TUI Overlay Core Implementation Spec

## Overview

Add overlay rendering capability to the TUI package, allowing components to render as floating modals at absolute screen positions while preserving underlying content visibility.

**Total estimated changes: ~120 lines**

---

## Design Decisions (from interview)

| Decision | Choice |
|----------|--------|
| Cursor visibility | Managed by overlay component (cursor shows in overlay) |
| Base content updates | Allowed - overlay redraws on top after base updates |
| Input routing | Use existing `setFocus()` mechanism |
| Multiple overlays | Single active, with stack support for future |
| API surface | Add `overlay` option to existing `ctx.ui.custom()` |

---

## Part 1: TUI Package Changes

### File: `packages/tui/src/tui.ts`

#### New State (~5 lines)

```typescript
// Add after line 92 (private cursorRow = 0;)
private overlayStack: {
  component: Component;
  position: { row: number; col: number; width: number; height: number };
  preFocus: Component | null;
}[] = [];
```

#### New Public Methods (~45 lines)

```typescript
/**
 * Show an overlay component at the specified position (or centered).
 * The overlay renders on top of existing content using absolute cursor positioning.
 * Input is routed to the overlay via existing focus mechanism.
 */
showOverlay(component: Component, options?: { 
  row?: number; 
  col?: number; 
  width?: number;
}): void {
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  
  // Default width: min(80, termWidth - 4)
  const overlayWidth = Math.min(options?.width ?? 80, termWidth - 4);
  
  // Render once to determine height
  const lines = component.render(overlayWidth);
  const overlayHeight = lines.length;
  
  // Calculate position (centered by default)
  const row = options?.row ?? Math.max(0, Math.floor((termHeight - overlayHeight) / 2));
  const col = options?.col ?? Math.max(0, Math.floor((termWidth - overlayWidth) / 2));
  
  // Push onto stack
  this.overlayStack.push({
    component,
    position: { row, col, width: overlayWidth, height: overlayHeight },
    preFocus: this.focusedComponent,
  });
  
  // Focus the overlay component
  this.setFocus(component);
  
  // Show cursor (overlay may have input field)
  this.terminal.showCursor();
  
  // Trigger render - doRender() will handle base content + overlay
  this.requestRender(true); // force=true ensures full redraw
}

/**
 * Hide the topmost overlay and restore previous focus.
 */
hideOverlay(): void {
  const overlay = this.overlayStack.pop();
  if (!overlay) return;
  
  // Restore previous focus
  if (overlay.preFocus) {
    this.setFocus(overlay.preFocus);
  }
  
  // If no more overlays, hide cursor (TUI default)
  if (this.overlayStack.length === 0) {
    this.terminal.hideCursor();
  }
  
  // Force full redraw with screen clear to remove overlay remnants.
  // Set previousLines to non-empty to skip first-render path (which doesn't clear).
  // Set previousWidth to -1 (sentinel) to trigger widthChanged path (which clears).
  // If more overlays remain, the overlay code path in doRender() handles it.
  this.previousLines = [""];
  this.previousWidth = -1;
  this.cursorRow = 0;
  this.requestRender();
}

/**
 * Check if any overlay is currently shown.
 */
hasOverlay(): boolean {
  return this.overlayStack.length > 0;
}
```

#### New Private Method: `renderOverlay()` (~35 lines)

```typescript
/**
 * Render the topmost overlay using absolute cursor positioning.
 * Called after base content renders.
 */
private renderOverlay(): void {
  const overlay = this.overlayStack[this.overlayStack.length - 1];
  if (!overlay) return;
  
  const { component, position } = overlay;
  const { width } = position;
  
  // Re-render component (may have changed)
  const lines = component.render(width);
  
  // Update stored height
  overlay.position.height = lines.length;
  
  // Clamp position to viewport
  const termWidth = this.terminal.columns;
  const termHeight = this.terminal.rows;
  const clampedRow = Math.max(0, Math.min(position.row, termHeight - lines.length));
  const clampedCol = Math.max(0, Math.min(position.col, termWidth - width));
  
  // Build output buffer with absolute positioning
  let buffer = "\x1b[?2026h"; // Begin synchronized output
  
  for (let i = 0; i < lines.length; i++) {
    const screenRow = clampedRow + i + 1; // ANSI uses 1-indexed rows
    const screenCol = clampedCol + 1;     // ANSI uses 1-indexed cols
    
    // Move cursor to absolute position
    buffer += `\x1b[${screenRow};${screenCol}H`;
    
    // Write line, padded to overlay width to fully overwrite background
    const line = lines[i];
    const lineWidth = visibleWidth(line);
    const padding = " ".repeat(Math.max(0, width - lineWidth));
    buffer += line + padding;
  }
  
  buffer += "\x1b[?2026l"; // End synchronized output
  this.terminal.write(buffer);
}
```

#### Modify `doRender()` (~15 lines)

Add a dedicated code path for overlay rendering at the START of `doRender()`, right after computing `newLines`. This avoids any interaction with the existing differential rendering logic:

```typescript
private doRender(): void {
  const width = this.terminal.columns;
  const height = this.terminal.rows;

  // Render all components to get new lines
  const newLines = this.render(width);

  // When overlay is active, use dedicated clear+redraw path to avoid
  // cursor position conflicts between overlay (absolute) and differential (relative)
  if (this.overlayStack.length > 0) {
    let buffer = "\x1b[?2026h"; // Begin synchronized output
    buffer += "\x1b[3J\x1b[2J\x1b[H"; // Clear scrollback, screen, and home
    for (let i = 0; i < newLines.length; i++) {
      if (i > 0) buffer += "\r\n";
      buffer += newLines[i];
    }
    buffer += "\x1b[?2026l"; // End synchronized output
    this.terminal.write(buffer);
    this.cursorRow = newLines.length - 1;
    this.previousLines = newLines;
    this.previousWidth = width;
    this.renderOverlay();
    return; // Skip normal render paths
  }

  // ... rest of existing doRender() code unchanged ...
}
```

---

## Part 2: Extension Types Changes

### File: `packages/coding-agent/src/core/extensions/types.ts`

#### Modify `ExtensionUIContext` interface (~5 lines)

Update the `custom()` method signature to support overlay mode:

```typescript
/** Show a custom component with keyboard focus. */
custom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T>;
```

---

## Part 3: Interactive Mode Changes

### File: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`

#### Modify `showExtensionCustom()` (~20 lines)

Update the existing method to support overlay mode:

```typescript
private async showExtensionCustom<T>(
  factory: (
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: T) => void,
  ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
  options?: { overlay?: boolean },
): Promise<T> {
  const savedText = this.editor.getText();
  const isOverlay = options?.overlay ?? false;

  return new Promise((resolve) => {
    let component: Component & { dispose?(): void };

    const close = (result: T) => {
      component.dispose?.();
      if (isOverlay) {
        this.ui.hideOverlay();
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(this.editor);
        this.editor.setText(savedText);
        this.ui.setFocus(this.editor);
      }
      this.ui.requestRender();
      resolve(result);
    };

    Promise.resolve(factory(this.ui, theme, this.keybindings, close)).then((c) => {
      component = c;
      if (isOverlay) {
        // showOverlay() calls requestRender(true) internally
        this.ui.showOverlay(component);
      } else {
        this.editorContainer.clear();
        this.editorContainer.addChild(component);
        this.ui.setFocus(component);
        this.ui.requestRender();
      }
    });
  });
}
```

#### Update `createExtensionUIContext()` (~1 line)

Change the binding to pass options through:

```typescript
custom: (factory, options) => this.showExtensionCustom(factory, options),
```

---

## Summary of Changes

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| `packages/tui/src/tui.ts` | ~100 | ~0 |
| `packages/coding-agent/src/core/extensions/types.ts` | ~3 | ~3 |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | ~15 | ~5 |
| **Total** | **~118** | **~8** |

---

## Key Implementation Notes

### Why a dedicated overlay code path in doRender()?

The TUI uses relative cursor positioning (`\x1b[nA` up, `\x1b[nB` down) for differential updates, tracking position via `cursorRow`. The overlay uses absolute positioning (`\x1b[row;colH`). After overlay renders, the cursor is inside the overlay, but `cursorRow` reflects the base content position. This mismatch would corrupt subsequent differential renders.

Rather than trying to patch the existing render paths (which have subtle edge cases around `previousLines` and `previousWidth`), we add a dedicated code path when overlay is active that:
1. Clears the screen (`\x1b[3J\x1b[2J\x1b[H`)
2. Rewrites all base content from scratch
3. Renders overlay on top
4. Returns early, skipping the normal render paths

This is simple, robust, and avoids any interaction with the differential rendering logic. Performance impact is negligible since overlay is interactive (user is typing).

### Why sentinel values in hideOverlay()?

When closing an overlay, we need to clear the screen to remove overlay remnants. The `doRender()` method has three code paths:
1. **First-render path** (`previousLines.length === 0`): Writes without clearing - assumes screen is empty
2. **WidthChanged path** (`widthChanged === true`): Clears screen then rewrites - correct for overlay close
3. **Differential path**: Uses relative cursor moves - incompatible with overlay

After `hideOverlay()`, if no more overlays remain, we need path 2 (widthChanged). Setting `previousLines = [""]` (non-empty) skips path 1, and setting `previousWidth = -1` (sentinel that differs from any real width) triggers path 2.

If overlays remain after `hideOverlay()`, the overlay code path in `doRender()` handles it (which also clears screen).

### Why no `getCursorPosition()` interface?

Removed to reduce complexity. The cursor ends up at the last written position in the overlay, which is typically the end of the last line. Overlay components can include cursor positioning in their own ANSI output if needed. Most command palettes don't need precise cursor positioning anyway - the visual cursor in the input field is rendered as part of the component's output (e.g., `"> search█"`).

---

## Usage Example

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => {
    return new CommandPaletteComponent({
      theme,
      onClose: done,
      items: ["item1", "item2", "item3"],
    });
  },
  { overlay: true }
);
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| Terminal resize during overlay | Full re-render recalculates position, overlay re-renders centered |
| Base content updates during overlay | Full re-render + overlay on top (layering preserved) |
| Overlay larger than terminal | Clamped to fit within viewport |
| User closes overlay | `hideOverlay()` forces full redraw to restore underlying content |
| Nested overlays | Stack-based - `showOverlay()` pushes, `hideOverlay()` pops |
| Focus restoration | Stored in stack entry, restored on `hideOverlay()` |
| No base changes, overlay changes | Full re-render via dedicated overlay code path |

---

## Testing Checklist

- [ ] Overlay renders centered on screen
- [ ] Underlying content visible around overlay edges
- [ ] Keyboard input routes to overlay component
- [ ] Escape/close properly restores underlying content
- [ ] Terminal resize repositions overlay correctly
- [ ] Typing in overlay updates display correctly
- [ ] Cursor visible in overlay
- [ ] Focus returns to editor after overlay closes
- [ ] Multiple rapid overlay open/close doesn't corrupt display

```

```

</details>

## Review Cycles

### Review Cycle 1

- **All Passing:** Yes
- **Summary:** TUI Overlay implementation is complete. All 3 files modified per spec: tui.ts adds overlay stack, showOverlay/hideOverlay/hasOverlay methods, renderOverlay private method, and doRender overlay code path. types.ts adds options parameter to custom(). interactive-mode.ts adds overlay support to showExtensionCustom. Code compiles successfully with no new errors.
- **Duration:** 1m 9s
- **Cost:** $0.4134

## Cost Breakdown

**Total:** $2.1622

**By Phase:**
- scout: $0.6413
- planner: $0.2088
- coordinator: $0.8986
- review: $0.4134

**Limit:** $40.00

## Metadata

- **Coordination Directory:** `/Users/nicobailon/.pi/sessions/default/coordination/8b562e7d-1820-4eff-ba63-3f8a6c6bbf9d`
- **Plan Hash:** `77c826f50abf7f32`
- **Total Input Tokens:** 0
- **Total Output Tokens:** 0
- **Total Turns:** 0
