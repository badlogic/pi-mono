## Analysis of TUI Differential Rendering and Layout Shift Artifacts

### Key Findings

**1. The Surgical Differential Rendering Implementation**

The TUI uses a three-strategy rendering system in `renderDifferentialSurgical` (lines 331-513 in `/Users/badlogic/workspaces/pi-mono/packages/tui/src/tui.ts`):

- **SURGICAL**: Updates only changed lines with same line counts 
- **PARTIAL**: Re-renders from first change when structure/line counts shift
- **FULL**: Clears scrollback when changes are above viewport

**2. The Critical Gap: Cursor Positioning in SURGICAL Strategy**

The artifact issue lies in the SURGICAL strategy's cursor positioning logic (lines 447-493). When components are added and removed dynamically, the cursor positioning calculations become incorrect, leading to incomplete clearing of old content.

**Specific Problem Areas:**

```typescript
// Lines 484-492: Cursor repositioning after surgical updates
const lastContentLine = totalNewLines - 1;
const linesToMove = lastContentLine - currentCursorLine;
if (linesToMove > 0) {
    output += `\x1b[${linesToMove}B`;
} else if (linesToMove < 0) {
    output += `\x1b[${-linesToMove}A`;
}
// Now add final newline to position cursor on next line
output += "\r\n";
```

**3. Component Change Detection Issues**

The system determines changes by comparing:
- Component IDs (structural changes)
- Line counts (hasLineCountChange) 
- Content with same line counts (changedLines array)

However, when a status message is added temporarily then removed, the detection logic may not properly identify all affected lines that need clearing.

**4. Missing Test Coverage**

Current tests in `/Users/badlogic/workspaces/pi-mono/packages/tui/test/` don't cover the specific scenario of:
- Dynamic addition of components that cause layout shifts
- Temporary status messages that appear and disappear
- Components moving back to original positions after removals

### The Agent Scenario Analysis

The agent likely does this sequence:
1. Has header, chat container, text editor in vertical layout
2. Adds a status message component between chat and editor
3. Editor shifts down (differential render uses PARTIAL strategy)
4. After delay, removes status message 
5. Editor shifts back up (this is where artifacts remain)

The issue is that when the editor moves back up, the SURGICAL strategy is chosen (same component structure, just content changes), but it doesn't properly clear the old border lines that were drawn when the editor was in the lower position.

### Root Cause

The differential rendering assumes that when using SURGICAL updates, only content within existing component boundaries changes. However, when components shift positions due to additions/removals, old rendered content at previous positions isn't being cleared properly.

**Specific gap:** The SURGICAL strategy clears individual lines with `\x1b[2K` but doesn't account for situations where component positions have changed, leaving artifacts from the previous render at the old positions.

### Test Creation Recommendation

A test reproducing this would:

```typescript
test("clears artifacts when components shift positions dynamically", async () => {
  // 1. Setup: header, container, editor
  // 2. Add status message (causes editor to shift down)
  // 3. Remove status message (editor shifts back up) 
  // 4. Verify no border artifacts remain at old editor position
});
```

The test should specifically check that after the removal, there are no stray border characters (`╭`, `╮`, `│`, `╰`, `╯`) left at the position where the editor was temporarily located.

### Proposed Fix Direction

The PARTIAL strategy should be used more aggressively when components are added/removed, even if the final structure looks identical, to ensure complete clearing of old content. Alternatively, the SURGICAL strategy needs enhanced logic to detect and clear content at previous component positions.