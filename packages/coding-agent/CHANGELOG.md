# Changelog

## [Unreleased]

### Added

- **Event bus (`pi.events`)**: Tools and hooks can now communicate via events. Tools emit events with `pi.events.emit()`, hooks subscribe with `pi.events.on()`. Enables async patterns where background work notifies the agent on completion. ([#323](https://github.com/badlogic/pi-mono/pull/323))

## [0.30.2] - 2025-12-26

### Changed

- **Consolidated migrations**: Moved auth migration from `AuthStorage.migrateLegacy()` to new `migrations.ts` module.

## [0.30.1] - 2025-12-26

### Fixed

- **Sessions saved to wrong directory**: In v0.30.0, sessions were being saved to `~/.pi/agent/` instead of `~/.pi/agent/sessions/<encoded-cwd>/`, breaking `--resume` and `/resume`. Misplaced sessions are automatically migrated on startup. ([#320](https://github.com/badlogic/pi-mono/issues/320) by [@aliou](https://github.com/aliou))
- **Custom system prompts missing context**: When using a custom system prompt string, project context files (AGENTS.md), skills, date/time, and working directory were not appended. ([#321](https://github.com/badlogic/pi-mono/issues/321))

## [0.30.0] - 2025-12-25

### Breaking Changes

- **SessionManager API**: The second parameter of `create()`, `continueRecent()`, and `list()` changed from `agentDir` to `sessionDir`. When provided, it specifies the session directory directly (no cwd encoding). When omitted, uses default (`~/.pi/agent/sessions/<encoded-cwd>/`). `open()` no longer takes `agentDir`. ([#313](https://github.com/badlogic/pi-mono/pull/313))

### Added

- **`--session-dir` flag**: Use a custom directory for sessions instead of the default `~/.pi/agent/sessions/<encoded-cwd>/`. Works with `-c` (continue) and `-r` (resume) flags. ([#313](https://github.com/badlogic/pi-mono/pull/313) by [@scutifer](https://github.com/scutifer))
- **Reverse model cycling and model selector**: Shift+Ctrl+P cycles models backward, Ctrl+L opens model selector (retaining text in editor). ([#315](https://github.com/badlogic/pi-mono/pull/315) by [@mitsuhiko](https://github.com/mitsuhiko))

## [0.29.1] - 2025-12-25

### Added

- **Automatic custom system prompt loading**: Pi now auto-loads `SYSTEM.md` files to replace the default system prompt. Project-local `.pi/SYSTEM.md` takes precedence over global `~/.pi/agent/SYSTEM.md`. CLI `--system-prompt` flag overrides both. ([#309](https://github.com/badlogic/pi-mono/issues/309))
- **Unified `/settings` command**: New settings menu consolidating thinking level, theme, queue mode, auto-compact, show images, hide thinking, and collapse changelog. Replaces individual `/thinking`, `/queue`, `/theme`, `/autocompact`, and `/show-images` commands. ([#310](https://github.com/badlogic/pi-mono/issues/310))

### Fixed

- **Custom tools/hooks with typebox subpath imports**: Fixed jiti alias for `@sinclair/typebox` to point to package root instead of entry file, allowing imports like `@sinclair/typebox/compiler` to resolve correctly. ([#311](https://github.com/badlogic/pi-mono/issues/311) by [@kim0](https://github.com/kim0))

## [0.29.0] - 2025-12-25

### Breaking Changes

- **SessionManager refactored**: `SessionManager` is now a stateless utility class. All session state (current session, session files) is managed by `AgentSession`. ([#299](https://github.com/badlogic/pi-mono/issues/299))
- **AgentSession state exposure**: `AgentSession` now exposes its session state via `currentSession` and `sessionFile` getters, replacing direct `SessionManager` access.
- **HookAPI session events**: `before_switch`, `switch`, `before_clear`, `clear`, `before_branch`, `branch`, `shutdown` - The event context now includes `sessionFile` (path to current session) instead of requiring session manager access.

### Added

- **Session tree with branches**: `/branch` starts a new branch from the current turn. `/switch` or `/resume` opens a visual session tree showing main timeline and branches. Navigate with j/k, select with Enter.
- **Session continuity**: Switching branches auto-saves current session. Branches appear as forks from their diverge point in the tree visualization.
- **Improved session persistence**: Sessions are saved after each turn instead of only at shutdown, reducing data loss if the process crashes.

### Fixed

- **Compact history rewrite**: Fixed an issue where compacting the message history would duplicate `tool_result` messages into `tool_use` blocks, causing API validation errors on subsequent compactions.

## [0.28.0] - 2025-12-23

### Breaking Changes

- **Model scoping in interactive mode**: Only `openai/gpt-4.1` (OpenRouter) and `claude-sonnet-4-5` (Anthropic) are available by default in interactive mode. Use `--model <name>` to explicitly scope additional models. Print mode (`-p`) is unaffected and uses all configured models. ([#294](https://github.com/badlogic/pi-mono/issues/294))

### Added

- **Model selector with `/model`**: New `/model` command opens an interactive selector to choose between scoped models. Shows provider, thinking level availability, and current selection.
- **Model cycling with Ctrl+P**: Press Ctrl+P to cycle through scoped models. The current model and thinking level are shown in the footer.
- **Smart model switching**: When switching to a model that doesn't support the current thinking level, the level is automatically downgraded (e.g., high -> low for OpenAI).

### Fixed

- **Error rendering in TUI**: Fixed issue where errors from tool execution weren't being displayed due to missing `isError` handling in the error object structure.

## [0.27.0] - 2025-12-22

### Added

- **Session lifecycle hooks**: Added `before_switch`, `before_clear`, and `before_branch` events that fire before their respective actions. Hooks can return `{ cancel: true }` to prevent the action. ([#281](https://github.com/badlogic/pi-mono/issues/281))
- **Session action cancellation**: The `HookAPI` now supports cancelling `before_*` session events by returning `{ cancel: true }`. Use this for confirmation prompts or guards.

### Changed

- **Hook event context**: Session events now include `sessionFile` (path to current session) and `targetTurnIndex` (for branch operations) in the context.

### Fixed

- **Tool calls/results with only image content**: Fixed rendering of tool calls and results that contain only images (no text). Previously these would render as empty or malformed. Now properly displays `[no text, X image(s)]` placeholder.
