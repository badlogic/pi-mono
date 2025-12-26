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

Each entry has a `uuid` and `parentUuid` field (null for root). Session header includes `version` for future migrations:

```jsonl
{"type":"session","version":2,"uuid":"a1b2c3","parentUuid":null,"id":"...","cwd":"..."}
{"type":"message","uuid":"d4e5f6","parentUuid":"a1b2c3","message":{"role":"user",...}}
{"type":"message","uuid":"g7h8i9","parentUuid":"d4e5f6","message":{"role":"assistant",...}}
{"type":"message","uuid":"j0k1l2","parentUuid":"g7h8i9","message":{"role":"user",...}}
{"type":"message","uuid":"m3n4o5","parentUuid":"j0k1l2","message":{"role":"assistant",...}}
```

Version history:
- **v1** (implicit): Linear format, no uuid/parentUuid
- **v2**: Tree format with uuid/parentUuid

The **last entry** is always the current leaf. Context = walk from leaf to root via `parentUuid`.

Using UUIDs (like Claude Code does) instead of indices because:
- No remapping needed when branching to new file
- Robust to entry deletion/reordering
- Orphan references are detectable
- ~30 extra bytes per entry is negligible for text-heavy sessions

### Branching

Branch from entry `g7h8i9` (after first assistant response):

```jsonl
... entries unchanged ...
{"type":"message","uuid":"p6q7r8","parentUuid":"g7h8i9","message":{"role":"user",...}}
{"type":"message","uuid":"s9t0u1","parentUuid":"p6q7r8","message":{"role":"assistant",...}}
```

Walking s9t0u1→p6q7r8→g7h8i9→d4e5f6→a1b2c3 gives the branched context.

The old path (j0k1l2, m3n4o5) remains in the file but is not in the current context.

### Visual

```
     [a1b2:session]
          │
     [d4e5:user "hello"]
          │
     [g7h8:assistant "hi"]
          │
     ┌────┴────┐
     │         │
[j0k1:user A]  [p6q7:user B]    ← branch point
     │              │
[m3n4:asst A]  [s9t0:asst B]    ← current leaf
     │
  (old path)
```

## Context Building

```typescript
function buildContext(entries: SessionEntry[]): AppMessage[] {
  // Build UUID -> entry map
  const byUuid = new Map(entries.map(e => [e.uuid, e]));
  
  // Start from last entry (current leaf)
  let current: SessionEntry | undefined = entries[entries.length - 1];
  
  // Walk to root, collecting messages
  const path: SessionEntry[] = [];
  while (current) {
    path.unshift(current);
    current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
  }
  
  // Extract messages, apply compaction summaries
  return pathToMessages(path);
}
```

Complexity: O(n) to build map, O(depth) to walk. Total O(n), but walk is fast.

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
... conversation entries ...
{"type":"stack_summary","uuid":"x1y2z3","parentUuid":"g7h8i9","summary":"Work done after this point"}
```

To "pop" to entry `g7h8i9`:
1. Generate summary of entries after `g7h8i9`
2. Append summary entry with `parentUuid: "g7h8i9"`

Context walk follows parentUuid chain. Abandoned entries are not traversed.

**No range tracking. No overlap rules. No "later wins" logic.**

### Multiple Pops

```
[a]─[b]─[c]─[d]─[e]─[f]─[g]─[h]
              │
              └─[i:summary]─[j]─[k]─[l]
                                  │
                                  └─[m:summary]─[n:current]
```

Each pop just creates a new branch. Context: n→m→k→j→i→c→b→a.

## Consequences for Compaction

### Current Approach

Compaction stores `firstKeptEntryIndex` (an index) and requires careful handling when stacking crosses compaction boundaries.

### Tree Approach

Compaction is just another entry in the linear chain, not a branch. Only change: `firstKeptEntryIndex` → `firstKeptEntryUuid`.

```
root → m1 → m2 → m3 → m4 → m5 → m6 → m7 → m8 → m9 → m10 → compaction
```

```jsonl
{"type":"compaction","uuid":"c1","parentUuid":"m10","summary":"...","firstKeptEntryUuid":"m6","tokensBefore":50000}
```

Context building:
1. Walk from leaf (compaction) to root
2. See compaction entry → note `firstKeptEntryUuid: "m6"`
3. Continue walking: m10, m9, m8, m7, m6 ← stop here
4. Everything before m6 is replaced by summary
5. Result: `[summary, m6, m7, m8, m9, m10]`

**Tree is for branching (stacking, alternative paths). Compaction is just a marker in the linear chain.**

### Compaction + Stacking

Stacking creates a branch, compaction is inline on each branch:

```
[root]─[m1]─[m2]─[m3]─[m4]─[m5]─[compaction1]─[m6]─[m7]─[m8]
                  │
                  └─[stack_summary]─[m9]─[m10]─[compaction2]─[m11:current]
```

Each branch has its own compaction history. Context walks the current branch only.

## Consequences for API

### SessionManager Changes

```typescript
interface SessionEntry {
  type: string;
  uuid: string;           // NEW: unique identifier
  parentUuid: string | null;  // NEW: null for root
  timestamp?: string;
  // ... type-specific fields
}

class SessionManager {
  // NEW: Get current leaf entry
  getCurrentLeaf(): SessionEntry;
  
  // NEW: Walk from entry to root
  getPath(fromUuid?: string): SessionEntry[];
  
  // NEW: Get entry by UUID
  getEntry(uuid: string): SessionEntry | undefined;
  
  // CHANGED: Uses tree walk instead of linear scan
  buildSessionContext(): SessionContext;
  
  // NEW: Create branch point
  branch(parentUuid: string): string;  // returns new entry's uuid
  
  // NEW: Create branch with summary of abandoned subtree
  branchWithSummary(parentUuid: string, summary: string): string;
  
  // CHANGED: Simpler, just creates summary node
  saveCompaction(entry: CompactionEntry): void;
  
  // CHANGED: Now requires parentUuid (uses current leaf if omitted)
  saveMessage(message: AppMessage, parentUuid?: string): void;
  saveEntry(entry: SessionEntry): void;
}
```

### AgentSession Changes

```typescript
class AgentSession {
  // CHANGED: Uses tree-based branching
  async branch(entryUuid: string): Promise<BranchResult>;
  
  // NEW: Branch in current session (no new file)
  async branchInPlace(entryUuid: string, options?: {
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
  currentPath: readonly SessionEntry[];  // Entries from root to current leaf
  
  // NEW: Branch without creating new file
  branchInPlace(parentUuid: string, summary?: string): Promise<void>;
  
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
/switch <uuid> → Switch to branch at entry
```

The session file contains full history. UI can visualize the tree.

### 3. Simpler Stacking

No hooks needed for basic stacking:

```
/pop           → Branch to previous user message with auto-summary
/pop <uuid>    → Branch to specific entry with auto-summary
```

Core functionality, not hook-dependent.

### 4. Subtree Export

```
/export-branch <uuid>   → Export just the subtree from entry
```

Useful for sharing specific conversation paths. No index remapping needed since UUIDs are stable.

### 5. Merge/Cherry-pick (Future)

With tree structure, could support:

```
/cherry-pick <uuid>    → Copy entry's message to current branch
/merge <uuid>          → Merge branch into current
```

## Migration

### Strategy: Migrate on Load + Rewrite

When loading a session, check if migration is needed. If so, migrate in memory and rewrite the file. This is transparent to users and only happens once per session file.

```typescript
const CURRENT_VERSION = 2;

function loadSession(path: string): SessionEntry[] {
  const content = readFileSync(path, 'utf8');
  const entries = parseEntries(content);
  
  const header = entries.find(e => e.type === 'session');
  const version = header?.version ?? 1;
  
  if (version < CURRENT_VERSION) {
    migrateEntries(entries, version);
    writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
  
  return entries;
}

function migrateEntries(entries: SessionEntry[], fromVersion: number): void {
  if (fromVersion < 2) {
    // v1 → v2: Add uuid/parentUuid, convert firstKeptEntryIndex
    const uuids: string[] = [];
    
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const uuid = generateUuid();
      uuids.push(uuid);
      
      entry.uuid = uuid;
      entry.parentUuid = i === 0 ? null : uuids[i - 1];
      
      // Update session header version
      if (entry.type === 'session') {
        entry.version = CURRENT_VERSION;
      }
      
      // Convert compaction index to UUID
      if (entry.type === 'compaction' && 'firstKeptEntryIndex' in entry) {
        entry.firstKeptEntryUuid = uuids[entry.firstKeptEntryIndex];
        delete entry.firstKeptEntryIndex;
      }
    }
  }
  
  // Future migrations: if (fromVersion < 3) { ... }
}
```

### What Gets Migrated

| v1 Field | v2 Field |
|----------|----------|
| (none) | `uuid` (generated) |
| (none) | `parentUuid` (previous entry's uuid, null for root) |
| (none on session) | `version: 2` |
| `firstKeptEntryIndex` | `firstKeptEntryUuid` |

Migrated sessions work exactly as before (linear path). Tree features become available.

### API Compatibility

- `buildSessionContext()` returns same structure
- `branch()` still works, just uses UUIDs
- Existing hooks continue to work
- Old sessions auto-migrate on first load

## Complexity Analysis

| Operation | Linear | Tree |
|-----------|--------|------|
| Append message | O(1) | O(1) |
| Build context | O(n) | O(n) map + O(depth) walk |
| Branch to new file | O(n) copy | O(path) copy, no remapping |
| Find entry by UUID | O(n) | O(1) with map |
| Compaction | O(n) | O(depth) |

Tree with UUIDs is comparable or better. The UUID map can be cached.

## File Size

Tree format adds ~50 bytes per entry (`"uuid":"...","parentUuid":"..."`, 36 chars each). For 1000-entry session: ~50KB overhead. Negligible for text-heavy sessions.

Abandoned branches remain in file but don't affect context building performance.

## Example: Full Session with Branching

```jsonl
{"type":"session","version":2,"uuid":"ses1","parentUuid":null,"id":"abc","cwd":"/project"}
{"type":"message","uuid":"m1","parentUuid":"ses1","message":{"role":"user","content":"Build a CLI"}}
{"type":"message","uuid":"m2","parentUuid":"m1","message":{"role":"assistant","content":"I'll create..."}}
{"type":"message","uuid":"m3","parentUuid":"m2","message":{"role":"user","content":"Add --verbose flag"}}
{"type":"message","uuid":"m4","parentUuid":"m3","message":{"role":"assistant","content":"Here's the flag..."}}
{"type":"message","uuid":"m5","parentUuid":"m4","message":{"role":"user","content":"Actually use Python"}}
{"type":"message","uuid":"m6","parentUuid":"m5","message":{"role":"assistant","content":"Converting to Python..."}}
{"type":"branch_summary","uuid":"bs1","parentUuid":"m2","summary":"Attempted Node.js CLI with --verbose flag"}
{"type":"message","uuid":"m7","parentUuid":"bs1","message":{"role":"user","content":"Use Rust instead"}}
{"type":"message","uuid":"m8","parentUuid":"m7","message":{"role":"assistant","content":"Creating Rust CLI..."}}
```

Context path: m8→m7→bs1→m2→m1→ses1

Result:
1. User: "Build a CLI"
2. Assistant: "I'll create..."
3. Summary: "Attempted Node.js CLI with --verbose flag"
4. User: "Use Rust instead"
5. Assistant: "Creating Rust CLI..."

Entries m3-m6 (the Node.js/Python path) are preserved but not in context.

## Prior Art

Claude Code uses the same approach:
- `uuid` field on each entry
- `parentUuid` links to parent (null for root)
- `leafUuid` in summary entries to track conversation endpoints
- Separate files for sidechains (`isSidechain: true`)

## Recommendation

The tree format with UUIDs:
- Simplifies stacking (no range overlap logic)
- Simplifies compaction (no boundary crossing)
- Enables in-place branching
- Enables branch visualization/navigation
- No index remapping on branch-to-file
- Maintains backward compatibility
- Validated by Claude Code's implementation

**Recommend implementing for v2 of hooks/session system.**
