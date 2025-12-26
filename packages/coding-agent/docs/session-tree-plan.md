# Session Tree Implementation Plan

Reference: [session-tree.md](./session-tree.md)

## Phase 1: SessionManager Core ✅

- [x] Update entry types with `id`, `parentId` fields (using SessionEntryBase)
- [x] Add `version` field to `SessionHeader`
- [x] Change `CompactionEntry.firstKeptEntryIndex` → `firstKeptEntryId`
- [x] Add `BranchSummaryEntry` type
- [x] Add `CustomEntry` type for hooks
- [x] Add `byId: Map<string, SessionEntry>` index
- [x] Add `leafId: string` tracking
- [x] Implement `getPath(fromId?)` tree traversal
- [x] Implement `getTree()` returning `SessionTreeNode[]`
- [x] Implement `getEntry(id)` lookup
- [x] Implement `getLeafUuid()` and `getLeafEntry()` helpers
- [x] Update `_buildIndex()` to populate `byId` map
- [x] Rename `saveXXX()` to `appendXXX()` (returns id, advances leaf)
- [x] Add `appendCustomEntry(customType, data)` for hooks
- [x] Update `buildSessionContext()` to use `getPath()` traversal

## Phase 2: Migration ✅

- [x] Add `CURRENT_SESSION_VERSION = 2` constant
- [x] Implement `migrateV1ToV2()` with extensible migration chain
- [x] Update `setSessionFile()` to detect version and migrate
- [x] Implement `_rewriteFile()` for post-migration persistence
- [x] Handle `firstKeptEntryIndex` → `firstKeptEntryId` conversion in migration

## Phase 3: Branching ✅

- [x] Implement `branch(id)` - switch leaf pointer
- [x] Implement `branchWithSummary(id, summary)` - create summary entry
- [x] Implement `createBranchedSession(leafId)` - extract path to new file
- [x] Update `AgentSession.branch()` to use new API

## Phase 4: Compaction Integration ✅

- [x] Update `compaction.ts` to work with IDs
- [x] Update `prepareCompaction()` to return `firstKeptEntryId`
- [x] Update `compact()` to return `CompactionResult` with `firstKeptEntryId`
- [x] Update `AgentSession` compaction methods
- [x] Add `firstKeptEntryId` to `before_compact` hook event

## Phase 5: Testing ✅

- [x] `migration.test.ts` - v1 to v2 migration, idempotency
- [x] `build-context.test.ts` - context building with tree structure, compaction, branches
- [x] `tree-traversal.test.ts` - append operations, getPath, getTree, branching
- [x] `file-operations.test.ts` - loadEntriesFromFile, findMostRecentSession
- [x] `save-entry.test.ts` - custom entry integration
- [x] Update existing compaction tests for new types

---

## Remaining Work

### Compaction Refactor

- [ ] Clean up types passed to hooks (currently messy mix of `CompactionEntry`, `CompactionResult`, hook's `compaction` content)
- [ ] Ensure consistent API between what hooks receive and what they return

### Branch Summary Design

Current type:
```typescript
export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  summary: string;
}
```

Questions to resolve:
- [ ] Add `abandonedLeafId` field to reference what was abandoned?
- [ ] Store metadata about why the branch happened?
- [ ] Who generates the summary - user, LLM, or both options?
- [ ] Design and implement branch summarizer
- [ ] Add tests for `branchWithSummary()` flow

### Entry Labels

- [ ] Add optional `label?: string` field to `SessionEntryBase`
- [ ] Allow users to label any entry
- [ ] Display labels in UI (tree view, path view)

### HTML Export

- [ ] Add collapsible sidebar showing full tree structure
- [ ] Allow selecting any node in tree to view that path
- [ ] Add "reset to session leaf" button
- [ ] Render full path (no compaction resolution needed)
- [ ] Responsive: collapse sidebar on mobile

### UI Commands

Design new commands based on refactored SessionManager:

**`/branch`** - Current behavior (creates new session file from path)
- [ ] Review if this is still the right UX with tree structure
- [ ] Consider: should this use `createBranchedSession()` or `branch()`?

**`/branch-here`** - In-place branching (new)
- [ ] Use `branch(id)` to move leaf pointer without creating new file
- [ ] Subsequent messages become new branch in same file
- [ ] Design: how to select branch point? (similar to current `/branch` UI?)

**`/branches`** - List/navigate branches (new)
- [ ] Show tree structure or list of branch points
- [ ] Allow switching between branches (move leaf pointer)
- [ ] Show current position in tree

**`/label`** - Label entries (new, if labels implemented)
- [ ] Allow labeling current or selected entry
- [ ] Display in tree view

---

## Notes

- All append methods return the new entry's ID
- Migration rewrites file on first load if version < CURRENT_VERSION
- Existing sessions become linear chains after migration (parentId = previous entry)
- Tree features available immediately after migration
- SessionHeader does NOT have id/parentId (it's metadata, not part of tree)
- Session is append-only: entries cannot be modified or deleted, only branching changes the leaf pointer
