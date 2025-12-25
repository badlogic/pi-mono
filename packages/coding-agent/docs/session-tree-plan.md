# Session Tree Implementation Plan

Reference: [session-tree.md](./session-tree.md)

## Phase 1: SessionManager Core

- [x] Update entry types with `id`, `parentId` fields (using TreeNode intersection)
- [x] Add `version` field to `SessionHeader`
- [x] Change `CompactionEntry.firstKeptEntryIndex` → `firstKeptEntryId`
- [x] Add `BranchSummaryEntry` type
- [x] Add `byId: Map<string, ConversationEntry>` index
- [x] Add `leafId: string` tracking
- [x] Implement `getPath(fromId?)` tree traversal
- [x] Implement `getEntry(id)` lookup
- [x] Implement `getLeafId()` helper
- [x] Update `_buildIndex()` to populate `byId` map
- [x] Update `saveMessage()` to include id/parentId (returns id)
- [x] Update `saveCompaction()` signature and fields (returns id)
- [x] Update `saveThinkingLevelChange()` to include id/parentId (returns id)
- [x] Update `saveModelChange()` to include id/parentId (returns id)
- [x] Update `buildSessionContext()` to use `getPath()` traversal

### Type Hierarchy

```typescript
// Tree fields (added by SessionManager)
interface TreeNode { id, parentId, timestamp }

// Content types (for input)
interface MessageContent { type: "message"; message: AppMessage }
interface CompactionContent { type: "compaction"; summary; firstKeptEntryId; tokensBefore }
// etc...

// Full entry types (TreeNode & Content)
type SessionMessageEntry = TreeNode & MessageContent;
type CompactionEntry = TreeNode & CompactionContent;
// etc...
```

## Phase 2: Migration

- [x] Add `CURRENT_SESSION_VERSION = 2` constant
- [x] Implement `_migrateToV2()` for v1→v2
- [x] Update `setSessionFile()` to detect version and migrate
- [x] Implement `_rewriteFile()` for post-migration persistence
- [x] Handle `firstKeptEntryIndex` → `firstKeptEntryId` conversion in migration

## Phase 3: Branching

- [x] Implement `branchInPlace(id)` - switch leaf pointer
- [x] Implement `branchWithSummary(id, summary)` - create summary entry
- [x] Update `branchToNewFile()` to use IDs (no remapping)
- [ ] Update `AgentSession.branch()` to use new API

## Phase 4: Compaction Integration

- [x] Update `compaction.ts` to work with IDs
- [x] Update `prepareCompaction()` to return `firstKeptEntryId`
- [x] Update `compact()` to return `CompactionResult` with `firstKeptEntryId`
- [x] Update `AgentSession` compaction methods
- [x] Add `firstKeptEntryId` to `before_compact` hook event

## Phase 5: Testing

- [ ] Add test fixtures from existing sessions
- [ ] Test migration of v1 sessions
- [ ] Test context building with tree structure
- [ ] Test branching operations
- [ ] Test compaction with IDs
- [x] Update existing tests for new types

## Phase 6: UI Integration

- [ ] Update `/branch` command for new API
- [ ] Add `/branch-here` command for in-place branching
- [ ] Add `/branches` command to list branches (future)
- [ ] Update session display to show tree info (future)

## Notes

- All save methods return the new entry's ID
- Migration rewrites file on first load if version < CURRENT_VERSION
- Existing sessions become linear chains after migration (parentId = previous entry)
- Tree features available immediately after migration
- SessionHeader does NOT have id/parentId (it's metadata, not part of tree)
- Content types allow clean input/output separation
