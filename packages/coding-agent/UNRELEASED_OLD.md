
### Breaking Changes

- **Session tree structure (v2)**: Sessions now store entries as a tree with `id`/`parentId` fields, enabling in-place branching without creating new files. Existing v1 sessions are auto-migrated on load.
- **SessionManager API**:
  - `saveXXX()` renamed to `appendXXX()` (e.g., `appendMessage`, `appendCompaction`)
  - `branchInPlace()` renamed to `branch()`
  - `reset()` renamed to `newSession()`
  - `createBranchedSessionFromEntries(entries, index)` replaced with `createBranchedSession(leafId)`
  - `saveCompaction(entry)` replaced with `appendCompaction(summary, firstKeptEntryId, tokensBefore)`
  - `getEntries()` now excludes the session header (use `getHeader()` separately)
  - New methods: `getTree()`, `getPath()`, `getLeafUuid()`, `getLeafEntry()`, `getEntry()`, `branchWithSummary()`
  - New `appendCustomEntry(customType, data)` for hooks to store custom data (not in LLM context)
  - New `appendCustomMessageEntry(customType, content, display, details?)` for hooks to inject messages into LLM context
- **Compaction API**:
  - `CompactionEntry<T>` and `CompactionResult<T>` are now generic with optional `details?: T` for hook-specific data
  - `compact()` now returns `CompactionResult` (`{ summary, firstKeptEntryId, tokensBefore, details? }`) instead of `CompactionEntry`
  - `appendCompaction()` now accepts optional `details` parameter
  - `CompactionEntry.firstKeptEntryIndex` replaced with `firstKeptEntryId`
  - `prepareCompaction()` now returns `firstKeptEntryId` in its result
- **Hook types**:
  - `SessionEventBase` no longer has `sessionManager`/`modelRegistry` - access them via `HookEventContext` instead
  - `HookEventContext` now has `sessionManager` and `modelRegistry` (moved from events)
  - `HookEventContext` no longer has `exec()` - use `pi.exec()` instead
  - `HookCommandContext` no longer has `exec()` - use `pi.exec()` instead
  - `before_compact` event passes `preparation: CompactionPreparation` and `previousCompactions: CompactionEntry[]` (newest first)
  - `before_switch` event now has `targetSessionFile`, `switch` event has `previousSessionFile`
  - Removed `resolveApiKey` (use `modelRegistry.getApiKey(model)`)
  - Hooks can return `compaction.details` to store custom data (e.g., ArtifactIndex for structured compaction)
- **Hook API**:
  - `pi.send(text, attachments?)` replaced with `pi.sendMessage(message, triggerTurn?)` which creates `CustomMessageEntry` instead of user messages
  - New `pi.appendEntry(customType, data?)` to persist hook state (does NOT participate in LLM context)
  - New `pi.registerCommand(name, options)` to register custom slash commands
  - New `pi.registerMessageRenderer(customType, renderer)` to register custom renderers for hook messages
  - New `pi.exec(command, args, options?)` to execute shell commands (moved from `HookEventContext`/`HookCommandContext`)
  - `HookMessageRenderer` type: `(message: HookMessage, options, theme) => Component | null`
  - Renderers return inner content; the TUI wraps it in a styled Box
  - New types: `HookMessage<T>`, `RegisteredCommand`, `HookCommandContext`
  - Handler types renamed: `SendHandler` → `SendMessageHandler`, new `AppendEntryHandler`
- **SessionManager**:
  - `getSessionFile()` now returns `string | undefined` (undefined for in-memory sessions)
- **Themes**: Custom themes must add `customMessageBg`, `customMessageText`, `customMessageLabel` color tokens

### Added

- **`enabledModels` setting**: Configure whitelisted models in `settings.json` (same format as `--models` CLI flag). CLI `--models` takes precedence over the setting.

### Changed

- **Entry IDs**: Session entries now use short 8-character hex IDs instead of full UUIDs
- **API key priority**: `ANTHROPIC_OAUTH_TOKEN` now takes precedence over `ANTHROPIC_API_KEY`
- **New entry types**: `BranchSummaryEntry` for branch context, `CustomEntry<T>` for hook state persistence, `CustomMessageEntry<T>` for hook-injected context messages, `LabelEntry` for user-defined bookmarks
- **Entry labels**: New `getLabel(id)` and `appendLabelChange(targetId, label)` methods for labeling entries. Labels are included in `SessionTreeNode` for UI/export.
- **TUI**: `CustomMessageEntry` renders with purple styling (customMessageBg, customMessageText, customMessageLabel theme colors). Entries with `display: false` are hidden.
- **AgentSession**: New `sendHookMessage(message, triggerTurn?)` method for hooks to inject messages. Handles queuing during streaming, direct append when idle, and optional turn triggering.
- **HookMessage**: New message type with `role: "hookMessage"` for hook-injected messages in agent events. Use `isHookMessage(msg)` type guard to identify them. These are converted to user messages for LLM context via `messageTransformer`.
- **Agent.prompt()**: Now accepts `AppMessage` directly (in addition to `string, attachments?`) for custom message types like `HookMessage`.

### Fixed

- **Edit tool fails on Windows due to CRLF line endings**: Files with CRLF line endings now match correctly when LLMs send LF-only text. Line endings are normalized before matching and restored to original style on write. ([#355](https://github.com/badlogic/pi-mono/issues/355))
- **Session file validation**: `findMostRecentSession()` now validates session headers before returning, preventing non-session JSONL files from being loaded
- **Compaction error handling**: `generateSummary()` and `generateTurnPrefixSummary()` now throw on LLM errors instead of returning empty strings

