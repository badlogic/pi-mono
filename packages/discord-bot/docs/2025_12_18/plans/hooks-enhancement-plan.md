# Hooks System Enhancement Plan

## Status: ✅ ALL PHASES COMPLETE

**Commits:**
- `937c0f4` feat(hooks): Add metrics, tagging, and debug logging enhancements
- `db44f6e` feat(hooks): Complete enhancement plan phases 1-3
- `0c7ae8a` fix(hooks): Remove unused unlinkSync import
- `e71bd86` feat(hooks): Phase 4 performance optimizations

## Current State (Completed)

- [x] Checkpoint hook - Git-based state snapshots
- [x] LSP hook - Language server diagnostics (7 languages)
- [x] Expert hook - Domain detection + Act-Learn-Reuse
- [x] Discord integration - Per-channel lifecycle hooks
- [x] Tool wrapping - bash/write/edit emit hook events
- [x] /hooks command - status/checkpoints/restore

## Phase 1: Hook System Hardening (Priority: High) ✅

### 1.1 Branch Event Handling ✅
Enable conversation branching via Discord UI.

**Tasks:**
- [x] Add `/hooks branch <turn>` command to create branch point
- [x] Store branch metadata in checkpoint
- [x] Implement branch list/switch commands
- [x] Auto-restore agent state on branch switch

**Files to modify:**
- `src/main.ts` - Add branch subcommand
- `src/agents/hooks/checkpoint-hook.ts` - Add branch metadata
- `src/agents/hooks/discord-integration.ts` - Add emitBranch()

### 1.2 Hook Metrics & Logging ✅
Track hook performance and debug issues.

**Tasks:**
- [x] Add hook execution time tracking
- [x] Add hook success/failure counters
- [x] Add `/hooks metrics` command
- [x] Add debug mode toggle (`/hooks debug on/off`)
- [x] Add timeout tracking per hook

**Files to modify:**
- `src/agents/hooks/hook-manager.ts` - Add metrics collection
- `src/main.ts` - Add metrics/debug subcommands

### 1.3 Unit Tests for Hooks ✅
Ensure hooks work correctly in isolation.

**Tasks:**
- [x] Create `src/agents/hooks/hooks.test.ts` (28 tests)
- [x] Create `src/agents/hooks/checkpoint.test.ts` (15 tests)
- [x] Mock git operations for checkpoint tests
- [x] Mock LSP connections for lsp tests

## Phase 2: User Experience (Priority: Medium) ✅

### 2.1 Checkpoint Enhancements ✅
Make checkpoints more useful.

**Tasks:**
- [x] Add checkpoint naming/tagging (`/hooks tag <id> <name>`)
- [x] Add checkpoint diff preview (`/hooks diff <id>`)
- [x] Add auto-cleanup policy (`/hooks cleanup`)
- [x] getCheckpointDiff() and getFileDiff() functions
- [x] Show file changes in checkpoint list

**Files modified:**
- `src/main.ts` - Add tag/diff/cleanup subcommands
- `src/agents/hooks/checkpoint-hook.ts` - Add diff and cleanup functions

### 2.2 Expert Visibility ✅
Let users see accumulated expertise.

**Tasks:**
- [x] Add `/hooks expertise [domain]` command
- [x] Show recent learnings per domain
- [x] Add expertise clearing (`/hooks clear-expertise <domain>`)
- [x] Add expertise export to markdown

**Files modified:**
- `src/main.ts` - Add expertise subcommands
- `src/agents/hooks/expert-hook.ts` - Add expertise query functions

### 2.3 LSP Configuration ✅
Allow users to configure LSP behavior.

**Tasks:**
- [x] Add `/hooks lsp status` - Show active language servers
- [x] Add `/hooks lsp enable/disable <language>`
- [x] Auto-detect project languages from files

**Files modified:**
- `src/main.ts` - Add lsp subcommands
- `src/agents/hooks/lsp-hook.ts` - Add configuration options

## Phase 3: Advanced Features (Priority: Low) ✅

### 3.1 Tool Blocking Rules ✅
Allow configurable tool blocking.

**Tasks:**
- [x] Add `/hooks rules list` - Show blocking rules
- [x] Add `/hooks rules add <pattern>` - Add blocking rule
- [x] Add `/hooks rules remove <id>` - Remove rule
- [x] Store rules in SQLite per channel
- [x] Support regex patterns for commands
- [x] Add PRESET_RULES for security defaults

**New files:**
- `src/agents/hooks/blocking-rules.ts` - Rule management with SQLite

### 3.2 Hook Extensions (SKIPPED)
Future enhancement - allow custom hooks via skills.

### 3.3 Multi-Channel Coordination (SKIPPED)
Future enhancement - coordinate hooks across channels.

## Phase 4: Performance (Priority: Low) ✅

### 4.1 Lazy Initialization ✅
Defer expensive operations.

**Tasks:**
- [x] Lazy LSP server startup (on first write/edit)
- [x] Cache expertise files in memory (1min TTL, 10 max)
- [x] LRU eviction for caches

### 4.2 Resource Management ✅
Prevent resource exhaustion.

**Tasks:**
- [x] Limit active LSP connections (max 3)
- [x] Auto-cleanup old checkpoints
- [x] Add memory usage monitoring (heap, external)
- [x] Add hook timeout handling (5s default)

## Implementation Priority

| Phase | Priority | Effort | Impact |
|-------|----------|--------|--------|
| 1.1 Branch Events | High | Medium | High |
| 1.2 Metrics/Logging | High | Low | Medium |
| 1.3 Unit Tests | High | Medium | High |
| 2.1 Checkpoint UX | Medium | Medium | High |
| 2.2 Expert Visibility | Medium | Low | Medium |
| 2.3 LSP Config | Medium | Low | Low |
| 3.1 Blocking Rules | Low | Medium | Medium |
| 3.2 Extensions | Low | High | Medium |
| 3.3 Multi-Channel | Low | High | Low |
| 4.1 Lazy Init | Low | Medium | Medium |
| 4.2 Resource Mgmt | Low | Low | Medium |

## Quick Wins (Can Do Now)

1. **Add `/hooks metrics`** - Simple counter display
2. **Add checkpoint tagging** - Store name in ref metadata
3. **Add expertise viewer** - Read and display expertise files
4. **Add debug logging** - Console.log with prefix

## Dependencies

- Git CLI (checkpoint operations)
- Language servers (optional, for LSP)
- SQLite (for blocking rules persistence)

## Notes

- Hooks should fail gracefully (never block agent)
- All hook operations should be async
- Maintain pi-coding-agent compatibility
- Document all new commands in README
