# Branch Summary

This document describes the `/tree` command and branch summarization feature.

## Overview

The `/tree` command provides tree-based navigation of the session history, allowing users to:
1. View the entire session tree structure
2. Switch to any branch point
3. Optionally summarize the branch being abandoned

This differs from `/branch` which extracts a linear path to a new session file.

## Commands

### `/branch` (existing)
- Shows a flat list of user messages
- Extracts selected path to a **new session file**
- Selected user message text goes to editor for re-submission
- Fires `session_before_branch` / `session_branch` events

### `/tree` (new)
- Shows the **full session tree** with visual hierarchy
- Navigates within the **same session file** (changes active leaf)
- Optionally summarizes the abandoned branch
- Fires `session_before_tree` / `session_tree` events

## Tree UI

The tree selector displays the session structure with ASCII art:

```
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ user: "Let's try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ [compaction: 12k tokens]
│     │        └─ user: "That worked, now..."
│     │           └─ assistant: "Great! Next..."  ← active
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

### Visual Indicators

| Element | Display |
|---------|---------|
| Current active leaf | `← active` suffix, highlighted |
| User messages | Normal color (selectable) |
| Custom messages (display: true) | Normal color (selectable) |
| Assistant/tool results | Dimmed (selectable, for context continuation) |
| Compaction nodes | `[compaction: Xk tokens]` |
| Branch points | Node with multiple children visible |

### Navigation

| Key | Action |
|-----|--------|
| ↑/↓ | Move through nodes (depth-first pre-order) |
| Enter | Select node and proceed |
| Escape | Cancel |
| Ctrl+C | Cancel |
| Ctrl+U | Toggle: show only user messages |
| Ctrl+O | Toggle: show all entries (including custom/label) |

### Filtering

Default view hides:
- `label` entries (labels shown inline on their target node)
- `custom` entries (hook state, not relevant for navigation)

Ctrl+O shows everything for debugging/inspection.

### Component Size

Height is capped at **half terminal height** to show substantial tree context without overshooting the terminal.

## Selection Behavior

### Selecting Current Active Leaf

No-op. Display message: "Already at this point."

### Switching to Different Node

### User Message or Custom Message Selected
1. Active leaf is set to **parent** of selected node
2. Selected message text is placed in the **editor** for re-submission
3. User edits and submits, creating a new branch from that point

### Non-User Message Selected (assistant, tool result, etc.)
1. Active leaf is set to the **selected node itself**
2. Editor remains empty
3. User continues the conversation from that point

## Branch Summarization

When switching branches, the user is prompted: "Summarize the branch you're leaving?"

### What Gets Summarized

The abandoned branch is the path from the **old active leaf** back to the **common ancestor** of the old leaf and newly selected node.

```
A → B → C → D → E → F  ← old active leaf
        ↘ G → H        ← user selects H
```

- Common ancestor: C
- Abandoned path: D → E → F
- These nodes are summarized

### Stopping Conditions

When walking back from the old leaf to gather content for summarization:

1. **Stop at common ancestor** (always)
2. **Stop at compaction node** (if encountered before common ancestor)
   - Compaction already summarizes older content
   - Only summarize "fresh" content after the compaction

### Summary Storage

The summary is stored as a `BranchSummaryEntry`:

```typescript
interface BranchSummaryEntry {
  type: "branch_summary";
  id: string;
  parentId: string;      // Points to common ancestor
  timestamp: string;
  fromId: string;        // The old leaf we abandoned
  summary: string;       // LLM-generated summary
  details?: unknown;     // Optional hook data
}
```

The summary entry becomes a sibling of the path we're switching to, preserving the record of what was abandoned.

### Summary Generation

The summarizer:
1. Collects messages from old leaf back to stopping point
2. Sends to LLM with prompt: "Summarize this conversation branch concisely"
3. Creates `BranchSummaryEntry` with the result

User can skip summarization, in which case no `BranchSummaryEntry` is created.

## Example Flow

```
Initial state:
A → B → C → D  ← active

User runs /tree, selects B:

1. Show tree:
   ├─ A (user): "Start task..."
   │  └─ B (assistant): "I'll help..."
   │     └─ C (user): "Do X..."
   │        └─ D (assistant): "Done X..."  ← active

2. User navigates to B, presses Enter

3. Prompt: "Summarize branch you're leaving? [Y/n]"

4a. If Yes:
    - Summarize C → D
    - Create BranchSummaryEntry(fromId: D, summary: "...")
    - Set active leaf to B
    - Tree becomes:
      A → B → C → D
          ↓       ↘ [summary: "Tried X..."]
          └─ (active, user continues from here)

4b. If No:
    - Set active leaf to B
    - No summary entry created

5. Since B is assistant message:
   - Editor stays empty
   - User types new message, branches from B
```

## Implementation Notes

### SessionManager Methods (already exist)

- `getTree()` - Get full tree structure for display (needs: sort children by timestamp)
- `getPath(id)` - Get path from root to any node
- `getEntry(id)` - Look up individual entries
- `getLeafUuid()` - Get current active leaf
- `branch(id)` - Change active leaf
- `branchWithSummary(fromId, summary)` - Create branch summary entry
- `buildSessionContext()` - Get messages for LLM from current leaf

### AgentSession: New `navigateTree()` Method

```typescript
interface NavigateTreeOptions {
  /** Whether user wants to summarize abandoned branch */
  summarize?: boolean;
  /** Custom instructions for summarizer */
  customInstructions?: string;
}

interface NavigateTreeResult {
  /** Text to put in editor (if user message selected) */
  editorText?: string;
  /** Whether navigation was cancelled */
  cancelled: boolean;
}

async navigateTree(targetId: string, options?: NavigateTreeOptions): Promise<NavigateTreeResult>
```

Implementation flow:

1. **Validate target exists**
2. **Check if no-op** (target === current leaf) → return early
3. **Prepare summarization** (if `options.summarize`):
   - Find common ancestor
   - Collect entries to summarize (old leaf → common ancestor, stop at compaction)
4. **Fire `session_before_tree` event**:
   - Pass preparation, model, signal
   - If hook returns `cancel: true` → return `{ cancelled: true }`
   - If hook returns custom summary → use it, skip default summarizer
5. **Run default summarizer** (if needed):
   - Use conversation model
   - On failure/abort → return `{ cancelled: true }`
6. **Switch leaf**:
   - If summarizing: `sessionManager.branchWithSummary(targetId, summary)`
   - Otherwise: `sessionManager.branch(targetId)`
7. **Update agent state**:
   ```typescript
   const context = this.sessionManager.buildSessionContext();
   this.agent.replaceMessages(context.messages);
   ```
8. **Fire `session_tree` event**
9. **Notify custom tools** via `_emitToolSessionEvent("tree", ...)`
10. **Return result**:
    - If target was user message: `{ editorText: messageText, cancelled: false }`
    - Otherwise: `{ cancelled: false }`

### InteractiveMode: `/tree` Command Handler

```typescript
if (text === "/tree") {
  this.showTreeSelector();
  this.editor.setText("");
  return;
}
```

`showTreeSelector()` flow:

1. Get tree via `sessionManager.getTree()`
2. Show `TreeSelectorComponent` (new component)
3. On selection:
   - If target === current leaf → show "Already at this point", done
   - Prompt: "Summarize branch you're leaving? [Y/n]"
   - Call `session.navigateTree(targetId, { summarize })`
   - If cancelled → done
   - Clear chat: `this.chatContainer.clear()`
   - Re-render: `this.renderInitialMessages()`
   - If `result.editorText` → `this.editor.setText(result.editorText)`
   - Show status: "Switched to entry X"

### TUI Update Flow

After `navigateTree()` completes successfully:

```typescript
// In InteractiveMode, after navigateTree returns
if (!result.cancelled) {
  this.chatContainer.clear();
  this.renderInitialMessages();  // Uses sessionManager.buildSessionContext()
  if (result.editorText) {
    this.editor.setText(result.editorText);
  }
  this.showStatus("Navigated to selected point");
}
```

This matches the existing pattern in `handleResumeSession()` and `handleClearCommand()`.

### Finding Common Ancestor

```typescript
function findCommonAncestor(nodeA: string, nodeB: string): string {
  const pathA = new Set(sessionManager.getPath(nodeA).map(e => e.id));
  for (const entry of sessionManager.getPath(nodeB)) {
    if (pathA.has(entry.id)) {
      return entry.id;
    }
  }
  throw new Error("No common ancestor found");
}
```

### Collecting Abandoned Branch

```typescript
function collectAbandonedBranch(oldLeaf: string, commonAncestor: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let current = oldLeaf;
  
  while (current !== commonAncestor) {
    const entry = sessionManager.getEntry(current);
    if (!entry) break;
    
    // Stop at compaction - older content already summarized
    if (entry.type === "compaction") break;
    
    entries.push(entry);
    current = entry.parentId;
  }
  
  return entries.reverse(); // Chronological order
}
```

### Tree Child Ordering

`getTree()` should sort children by timestamp (oldest first, newest at bottom):

```typescript
// In getTree(), after building tree:
function sortChildren(node: SessionTreeNode): void {
  node.children.sort((a, b) => 
    new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
  );
  node.children.forEach(sortChildren);
}
roots.forEach(sortChildren);
```

### Error Handling

**Summarization fails** (API error, timeout, etc.):
- Cancel the entire switch
- Show error message
- User stays at current position

**User aborts during summarization** (Escape):
- Cancel the entire switch
- Show "Navigation cancelled"
- User stays at current position

**Hook returns `cancel: true`**:
- Cancel the switch
- No error message (hook may have shown its own UI)
- User stays at current position

### TreeSelectorComponent

New TUI component at `src/modes/interactive/components/tree-selector.ts`:

```typescript
interface TreeSelectorProps {
  tree: SessionTreeNode[];
  currentLeafId: string;
  onSelect: (entryId: string) => void;
  onCancel: () => void;
}
```

Features:
- Height: half terminal height (capped)
- ASCII tree rendering with `├─`, `│`, `└─` connectors
- Depth-first traversal for up/down navigation
- Visual indicators:
  - `← active` for current leaf
  - Resolved labels shown inline
  - Compaction nodes as `[compaction: Xk tokens]`
- Filter modes:
  - Default: hide `label` and `custom` entries
  - Ctrl+U: user messages only
  - Ctrl+O: show all entries
- Scrolling with selected node kept visible

## Hook Events

These events are separate from `session_before_branch`/`session_branch` which are used by the existing `/branch` command (creates new session file).

### `session_before_tree`

Fired before switching branches within the same session file. Hooks can cancel or provide custom summary.

```typescript
interface TreePreparation {
  /** Node being switched to */
  targetId: string;
  /** Current active leaf (being abandoned) */
  oldLeafId: string;
  /** Common ancestor of target and old leaf */
  commonAncestorId: string;
  /** Entries to summarize (old leaf back to common ancestor or compaction) */
  entriesToSummarize: SessionEntry[];
  /** Whether user chose to summarize */
  userWantsSummary: boolean;
}

interface SessionBeforeTreeEvent {
  type: "session_before_tree";
  preparation: TreePreparation;
  /** Model to use for summarization (conversation model) */
  model: Model;
  /** Abort signal - honors Escape during summarization */
  signal: AbortSignal;
}

interface SessionBeforeTreeResult {
  /** Cancel the navigation entirely */
  cancel?: boolean;
  /** Custom summary (skips default summarizer). Only used if userWantsSummary is true. */
  summary?: {
    summary: string;
    details?: unknown;
  };
}
```

### `session_tree`

Fired after navigation completes successfully. Not fired if cancelled.

```typescript
interface SessionTreeEvent {
  type: "session_tree";
  /** The new active leaf */
  newLeafId: string;
  /** Previous active leaf */
  oldLeafId: string;
  /** Branch summary entry if one was created, undefined if user skipped summarization */
  summaryEntry?: BranchSummaryEntry;
  /** Whether summary came from hook (false if default summarizer used, undefined if no summary) */
  fromHook?: boolean;
}
```

### Example: Custom Branch Summarizer

```typescript
export default function(pi: HookAPI) {
  pi.on("session_before_tree", async (event, ctx) => {
    if (!event.preparation.userWantsSummary) return;
    if (event.preparation.entriesToSummarize.length === 0) return;
    
    // Use a different model for summarization
    const model = getModel("google", "gemini-2.5-flash");
    const apiKey = await ctx.modelRegistry.getApiKey(model);
    
    // Custom summarization logic
    const summary = await summarizeWithCustomPrompt(
      event.preparation.entriesToSummarize,
      model,
      apiKey
    );
    
    return {
      summary: {
        summary,
        details: { model: model.id, timestamp: Date.now() }
      }
    };
  });
}
```
