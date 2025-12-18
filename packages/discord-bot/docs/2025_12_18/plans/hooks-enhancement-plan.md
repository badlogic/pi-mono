# Hooks System Enhancement Plan

## Current State (Completed)

- [x] Checkpoint hook - Git-based state snapshots
- [x] LSP hook - Language server diagnostics (7 languages)
- [x] Expert hook - Domain detection + Act-Learn-Reuse
- [x] Discord integration - Per-channel lifecycle hooks
- [x] Tool wrapping - bash/write/edit emit hook events
- [x] /hooks command - status/checkpoints/restore

## Phase 1: Hook System Hardening (Priority: High)

### 1.1 Branch Event Handling
Enable conversation branching via Discord UI.

**Tasks:**
- [ ] Add `/hooks branch <turn>` command to create branch point
- [ ] Store branch metadata in checkpoint
- [ ] Implement branch selection UI (Discord buttons)
- [ ] Auto-restore agent message history on branch

**Files to modify:**
- `src/main.ts` - Add branch subcommand
- `src/agents/hooks/checkpoint-hook.ts` - Add branch metadata
- `src/agents/hooks/discord-integration.ts` - Add emitBranch()

### 1.2 Hook Metrics & Logging
Track hook performance and debug issues.

**Tasks:**
- [ ] Add hook execution time tracking
- [ ] Add hook success/failure counters
- [ ] Add `/hooks metrics` command
- [ ] Add debug mode toggle (`/hooks debug on/off`)
- [ ] Log hook events to channel-specific log file

**Files to modify:**
- `src/agents/hooks/hook-manager.ts` - Add metrics collection
- `src/main.ts` - Add metrics/debug subcommands

### 1.3 Unit Tests for Hooks
Ensure hooks work correctly in isolation.

**Tasks:**
- [ ] Create `src/agents/hooks/checkpoint-hook.test.ts`
- [ ] Create `src/agents/hooks/lsp-hook.test.ts`
- [ ] Create `src/agents/hooks/expert-hook.test.ts`
- [ ] Create `src/agents/hooks/hook-manager.test.ts`
- [ ] Mock git operations for checkpoint tests
- [ ] Mock LSP connections for lsp tests

## Phase 2: User Experience (Priority: Medium)

### 2.1 Checkpoint Enhancements
Make checkpoints more useful.

**Tasks:**
- [ ] Add checkpoint naming/tagging (`/hooks tag <id> <name>`)
- [ ] Add checkpoint diff preview (`/hooks diff <id>`)
- [ ] Add auto-cleanup policy (keep last N checkpoints)
- [ ] Add checkpoint export/import
- [ ] Show file changes in checkpoint list

**Files to modify:**
- `src/main.ts` - Add tag/diff subcommands
- `src/agents/hooks/checkpoint-hook.ts` - Add metadata support

### 2.2 Expert Visibility
Let users see accumulated expertise.

**Tasks:**
- [ ] Add `/hooks expertise [domain]` command
- [ ] Show recent learnings per domain
- [ ] Add expertise clearing (`/hooks clear-expertise <domain>`)
- [ ] Add expertise export to markdown

**Files to modify:**
- `src/main.ts` - Add expertise subcommands
- `src/agents/hooks/expert-hook.ts` - Add expertise query functions

### 2.3 LSP Configuration
Allow users to configure LSP behavior.

**Tasks:**
- [ ] Add `/hooks lsp status` - Show active language servers
- [ ] Add `/hooks lsp enable/disable <language>`
- [ ] Add diagnostic severity filtering
- [ ] Auto-detect project languages from files

**Files to modify:**
- `src/main.ts` - Add lsp subcommands
- `src/agents/hooks/lsp-hook.ts` - Add configuration options

## Phase 3: Advanced Features (Priority: Low)

### 3.1 Tool Blocking Rules
Allow configurable tool blocking.

**Tasks:**
- [ ] Add `/hooks rules list` - Show blocking rules
- [ ] Add `/hooks rules add <pattern>` - Add blocking rule
- [ ] Add `/hooks rules remove <id>` - Remove rule
- [ ] Store rules in SQLite per channel
- [ ] Support regex patterns for commands

**New files:**
- `src/agents/hooks/blocking-rules.ts` - Rule management

### 3.2 Hook Extensions
Allow custom hooks via skills.

**Tasks:**
- [ ] Define hook extension interface
- [ ] Load hooks from skills directory
- [ ] Add `/hooks extensions` command
- [ ] Document hook extension API

**New files:**
- `src/agents/hooks/extension-loader.ts`

### 3.3 Multi-Channel Coordination
Coordinate hooks across channels.

**Tasks:**
- [ ] Share checkpoints between channels (same repo)
- [ ] Add global expertise aggregation
- [ ] Add cross-channel learning

## Phase 4: Performance (Priority: Low)

### 4.1 Lazy Initialization
Defer expensive operations.

**Tasks:**
- [ ] Lazy LSP server startup (on first write/edit)
- [ ] Cache expertise files in memory
- [ ] Batch checkpoint operations
- [ ] Add checkpoint compression

### 4.2 Resource Management
Prevent resource exhaustion.

**Tasks:**
- [ ] Limit active LSP connections
- [ ] Auto-cleanup old checkpoints (>100)
- [ ] Add memory usage monitoring
- [ ] Add hook timeout handling

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
