# Session Tree Format

Analysis of switching from linear JSONL to tree-based session storage.

## Current Format (Linear)

```jsonl
{"type":"session","id":"...","timestamp":"...","cwd":"..."}
{"type":"message","timestamp":"...","message":{"role":"user",...}}
{"type":"message","timestamp":"...","message":{"role":"assistant",...}}
{"type":"compaction","timestamp":"...","summary":"...","firstKeptEntryIndex":2,"tokensBefore":50000}
{"type":"message","timestamp":"...","message":{"role":"user",...}}
```

Context is built by scanning linearly, applying compaction ranges.

## Proposed Format (Tree)

Each entry has a `parent` field pointing to its parent entry's index (-1 for root):

```jsonl
{"type":"session","id":"...","parent":-1}                           // 0: root
{"type":"message","parent":0,"message":{"role":"user",...}}         // 1
{"type":"message","parent":1,"message":{"role":"assistant",...}}    // 2
{"type":"message","parent":2,"message":{"role":"user",...}}         // 3
{"type":"message","parent":3,"message":{"role":"assistant",...}}    // 4
{"type":"head","parent":4,"name":"main"}                            // 5: current head
```

The **last entry** is always the current leaf. Context = walk from leaf to root.

### Branching

Branch from entry 2 (after first assistant response):

```jsonl
... entries 0-5 unchanged ...
{"type":"message","parent":2,"message":{"role":"user",...}}         // 6: new branch
{"type":"message","parent":6,"message":{"role":"assistant",...}}    // 7
{"type":"head","parent":7,"name":"main"}                            // 8: new head
```

Now entry 8 is the leaf. Walking 8→7→6→2→1→0 gives the branched context.

The old path (entries 3-5) remains in the file but is not in the current context.

### Visual

```
     [0:session]
          │
     [1:user "hello"]
          │
     [2:assistant "hi"]
          │
     ┌────┴────┐
     │         │
[3:user A]  [6:user B]    ← branch point at 2
     │         │
[4:asst A]  [7:asst B]
     │         │
  (old)    [8:head]       ← current leaf
```

## Context Building

```typescript
function buildContext(entries: SessionEntry[]): AppMessage[] {
  // Find current head (last entry, or last head entry)
  let current = entries.length - 1;
  
  // Walk to root, collecting messages
  const path: SessionEntry[] = [];
  while (current >= 0) {
    const entry = entries[current];
    path.unshift(entry);
    current = entry.parent;
  }
  
  // Extract messages, apply compaction summaries
  return pathToMessages(path);
}
```

Complexity: O(depth) instead of O(n) for linear scan.

## Consequences for Stacking

### Current Approach (hooks-v2.md)

Stacking uses `stack_pop` entries with complex range overlap rules:

```typescript
interface StackPopEntry {
  type: "stack_pop";
  backToIndex: number;
  summary: string;
  prePopSummary?: string;
}
```

Context building requires tracking ranges, IDs, "later wins" logic.

### Tree Approach

Stacking becomes trivial branching:

```jsonl
... conversation entries 0-10 ...
{"type":"stack_summary","parent":3,"summary":"Work done in entries 4-10"}  // 11
{"type":"head","parent":11}                                                 // 12
```

To "pop" to entry 3:
1. Generate summary of entries 4-10
2. Append summary entry with `parent:3`
3. Append new head

Context walk: 12→11→3→2→1→0. Entries 4-10 are not traversed.

**No range tracking. No overlap rules. No "later wins" logic.**

### Multiple Pops

```
[0]─[1]─[2]─[3]─[4]─[5]─[6]─[7]─[8]
              │
              └─[9:summary of 4-8]─[10]─[11]─[12]
                                         │
                                         └─[13:summary of 10-12]─[14:head]
```

Each pop just creates a new branch. Context: 14→13→9→3→2→1→0.

## Consequences for Compaction

### Current Approach

Compaction stores `firstKeptEntryIndex` and requires careful handling when stacking crosses compaction boundaries.

### Tree Approach

Compaction creates a summary node:

```jsonl
{"type":"compaction","parent":0,"summary":"...","summarizedPath":[1,2,3,4,5]}  // 6
{"type":"message","parent":6,"message":{"role":"user",...}}                     // 7
```

The compaction node's `parent:0` means it attaches to root. Walking from 7: 7→6→0.

Entries 1-5 are still in the file (for export, debugging) but not in context.

### Compaction + Stacking

No special handling needed. They're both just branches:

```
[0]─[1]─[2]─[3]─[4]─[5]
 │
 └─[6:compaction summary]─[7]─[8]─[9]─[10]
                           │
                           └─[11:stack summary]─[12:head]
```

Context: 12→11→7→6→0. Clean.

## Consequences for API

### SessionManager Changes

```typescript
interface SessionEntry {
  type: string;
  parent: number;  // NEW: -1 for root, otherwise index of parent
  timestamp?: string;
  // ... type-specific fields
}

class SessionManager {
  // NEW: Get current head index
  getCurrentHead(): number;
  
  // NEW: Walk from entry to root
  getPath(fromIndex?: number): SessionEntry[];
  
  // CHANGED: Uses tree walk instead of linear scan
  buildSessionContext(): SessionContext;
  
  // NEW: Create branch point, returns new head index
  branch(parentIndex: number): number;
  
  // NEW: Create branch with summary of abandoned subtree
  branchWithSummary(parentIndex: number, summary: string): number;
  
  // CHANGED: Simpler, just creates summary node
  saveCompaction(entry: CompactionEntry): void;
  
  // UNCHANGED
  saveMessage(message: AppMessage): void;
  saveEntry(entry: SessionEntry): void;
}
```

### AgentSession Changes

```typescript
class AgentSession {
  // CHANGED: Uses tree-based branching
  async branch(entryIndex: number): Promise<BranchResult>;
  
  // NEW: Branch in current session (no new file)
  async branchInPlace(entryIndex: number, options?: {
    summarize?: boolean;  // Generate summary of abandoned subtree
  }): Promise<void>;
  
  // NEW: Get tree structure for visualization
  getSessionTree(): SessionTree;
  
  // CHANGED: Simpler implementation
  async compact(): Promise<CompactionResult>;
}

interface BranchResult {
  selectedText: string;
  cancelled: boolean;
  newSessionFile?: string;  // If branching to new file
  inPlace: boolean;         // If branched in current file
}
```

### Hook API Changes

```typescript
interface HookEventContext {
  // NEW: Tree-aware entry access
  entries: readonly SessionEntry[];
  currentPath: readonly SessionEntry[];  // Entries from root to current head
  
  // NEW: Branch without creating new file
  branchInPlace(parentIndex: number, summary?: string): Promise<void>;
  
  // Existing
  saveEntry(entry: SessionEntry): Promise<void>;
  rebuildContext(): Promise<void>;
}
```

## New Features Enabled

### 1. In-Place Branching

Currently, `/branch` always creates a new session file. With tree format:

```
/branch        → Create new session file (current behavior)
/branch-here   → Branch in current file, optionally with summary
```

Use case: Quick "let me try something else" without file proliferation.

### 2. Branch History Navigation

```
/branches      → List all branches in current session
/switch 3      → Switch to branch starting at entry 3
```

The session file contains full history. UI can visualize the tree.

### 3. Simpler Stacking

No hooks needed for basic stacking:

```
/pop           → Branch to previous user message with auto-summary
/pop 5         → Branch to entry 5 with auto-summary
```

Core functionality, not hook-dependent.

### 4. Subtree Export

```
/export-branch 3   → Export just the subtree from entry 3
```

Useful for sharing specific conversation paths.

### 5. Merge/Cherry-pick (Future)

With tree structure, could support:

```
/cherry-pick 7    → Copy entry 7's message to current branch
/merge 3          → Merge branch at entry 3 into current
```

## Migration

### File Format

Add `parent` field to all entries. Existing sessions get `parent: previousIndex`:

```typescript
function migrateSession(content: string): string {
  const lines = content.trim().split('\n');
  return lines.map((line, i) => {
    const entry = JSON.parse(line);
    entry.parent = i === 0 ? -1 : i - 1;  // Linear chain
    return JSON.stringify(entry);
  }).join('\n');
}
```

Migrated sessions work exactly as before (linear path).

### API Compatibility

- `buildSessionContext()` returns same structure
- `branch()` still works, just more options
- Existing hooks continue to work

## Complexity Analysis

| Operation | Linear | Tree |
|-----------|--------|------|
| Append message | O(1) | O(1) |
| Build context | O(n) | O(depth) |
| Branch | O(n) copy | O(1) append |
| Find entry | O(n) | O(n) |
| Compaction | O(n) | O(depth) |

Tree is better or equal for all operations except "find arbitrary entry" (same).

## File Size

Tree format adds ~15 bytes per entry (`"parent":123,`). For 1000-entry session: ~15KB overhead. Negligible.

Abandoned branches remain in file but don't affect context building performance.

## Example: Full Session with Branching

```jsonl
{"type":"session","id":"abc","parent":-1,"cwd":"/project"}
{"type":"message","parent":0,"message":{"role":"user","content":"Build a CLI"}}
{"type":"message","parent":1,"message":{"role":"assistant","content":"I'll create..."}}
{"type":"message","parent":2,"message":{"role":"user","content":"Add --verbose flag"}}
{"type":"message","parent":3,"message":{"role":"assistant","content":"Here's the flag..."}}
{"type":"message","parent":4,"message":{"role":"user","content":"Actually use Python"}}
{"type":"message","parent":5,"message":{"role":"assistant","content":"Converting to Python..."}}
{"type":"branch_summary","parent":2,"summary":"Attempted Node.js CLI with --verbose flag"}
{"type":"message","parent":7,"message":{"role":"user","content":"Use Rust instead"}}
{"type":"message","parent":8,"message":{"role":"assistant","content":"Creating Rust CLI..."}}
{"type":"head","parent":9}
```

Context path: 10→9→8→7→2→1→0

Result:
1. User: "Build a CLI"
2. Assistant: "I'll create..."
3. Summary: "Attempted Node.js CLI with --verbose flag"
4. User: "Use Rust instead"
5. Assistant: "Creating Rust CLI..."

Entries 3-6 (the Node.js path) are preserved but not in context.

## Recommendation

The tree format:
- Simplifies stacking (no range overlap logic)
- Simplifies compaction (no boundary crossing)
- Enables in-place branching
- Enables branch visualization/navigation
- Maintains backward compatibility
- Has negligible overhead

**Recommend implementing for v2 of hooks/session system.**
