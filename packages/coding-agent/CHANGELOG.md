# Changelog

## [Unreleased]

### Added

- **Thinking Level Cycling**: Press `Shift+Tab` to cycle through thinking levels (off → minimal → low → medium → high) for reasoning-capable models. Editor border color changes to indicate current level (gray → blue → cyan → magenta).

## [0.7.23] - 2025-11-20

### Added

- **Update Notifications**: Interactive mode now checks for new versions on startup and displays a notification if an update is available.

### Changed

- **System Prompt**: Updated system prompt to instruct agent to output plain text summaries directly instead of using cat or bash commands to display what it did.

### Fixed

- **File Path Completion**: Removed 10-file limit in tab completion selector. All matching files and directories now appear in the completion list.
- **Absolute Path Completion**: Fixed tab completion for absolute paths (e.g., `/Applications`). Absolute paths in the middle of text (like "hey /") now complete correctly. Also fixed crashes when trying to stat inaccessible files (like macOS `.VolumeIcon.icns`) during directory traversal.

## [0.7.22] - 2025-11-19

### Fixed

- **Long Line Wrapping**: Fixed crash when rendering long lines without spaces (e.g., file paths). Long words now break character-by-character to fit within terminal width.

## [0.7.21] - 2025-11-19

### Fixed

- **Terminal Flicker**: Fixed flicker at bottom of viewport (especially editor component) in xterm.js-based terminals (VS Code, etc.) by using per-line clear instead of clear-to-end sequence.
- **Background Color Rendering**: Fixed black cells appearing at end of wrapped lines when using background colors. Completely rewrote text wrapping and background application to properly handle ANSI reset codes.
- **Tool Output**: Strip ANSI codes from bash/tool output before rendering to prevent conflicts with TUI styling.

## [0.7.20] - 2025-11-18

### Fixed

- **Message Wrapping**: Fixed word-based text wrapping for long lines in chat messages. Text now properly wraps at word boundaries while preserving ANSI styling (colors, bold, italic, etc.) across wrapped lines. Background colors now extend to the full width of each line. Empty lines in messages now render correctly with full-width background.

## [0.7.18] - 2025-11-18

### Fixed

- **Bash Tool Error Handling**: Bash tool now properly throws errors for failed commands (non-zero exit codes), timeouts, and aborted executions. This ensures tool execution components display with red background when bash commands fail.
- **Thinking Traces Styling**: Thinking traces now maintain gray italic styling throughout, even when containing inline code blocks, bold text, or other inline formatting

## [0.7.17] - 2025-11-18

### Added

- **New Model**: Added `gemini-3-pro-preview` to Google provider.
- **OAuth Authentication**: Added `/login` and `/logout` commands for OAuth-based authentication with Claude Pro/Max subscriptions. Tokens are stored in `~/.pi/agent/oauth.json` with 0600 permissions and automatically refreshed when expired. OAuth tokens take priority over API keys for Anthropic models.

### Fixed

- **Anthropic Aborted Thinking**: Fixed error when resubmitting assistant messages with incomplete thinking blocks (from aborted streams). Thinking blocks without valid signatures are now converted to text blocks with `<thinking>` delimiters, preventing API rejection.
- **Model Selector Loading**: Fixed models not appearing in `/model` selector until user started typing. Models now load asynchronously and re-render when available.
- **Input Paste Support**: Added bracketed paste mode support to `Input` component, enabling paste of long OAuth authorization codes.

## [0.7.16] - 2025-11-17

### Fixed

- **Tool Error Display**: Fixed edit tool (and all other tools) not showing error state correctly in TUI. Failed tool executions now properly display with red background and show the error message. Previously, the `isError` flag from tool execution events was not being passed to the UI component, causing all tool results to show with green (success) background regardless of whether they succeeded or failed.

## [0.7.15] - 2025-11-17

### Fixed

- **Anthropic OAuth Support**: Added support for `ANTHROPIC_OAUTH_TOKEN` environment variable. The agent now checks for OAuth tokens before falling back to API keys for Anthropic models, enabling OAuth-based authentication.

## [0.7.14] - 2025-11-17

### Fixed

- **Mistral API Compatibility**: Fixed compatibility with Mistral API by excluding the `store` field and using `max_tokens` instead of `max_completion_tokens`, and avoiding the `developer` role in system prompts.
- **Error Display**: Fixed error message display in assistant messages to include proper spacing before the error text.
- **Message Streaming**: Fixed missing `message_start` event when no partial message chunks were received during streaming.

## [0.7.13] - 2025-11-16

### Fixed

- **TUI Editor**: Fixed unicode input support for umlauts (äöü), emojis (😀), and other extended characters. Previously the editor only accepted ASCII characters (32-126). Now properly handles all printable unicode while still filtering out control characters. ([#20](https://github.com/badlogic/pi-mono/pull/20))

## [0.7.12] - 2025-11-16

### Added

- **Custom Models and Providers**: Support for custom models and providers via `~/.pi/agent/models.json` configuration file. Add local models (Ollama, vLLM, LM Studio) or any OpenAI-compatible, Anthropic-compatible, or Google-compatible API. File is reloaded on every `/model` selector open, allowing live updates without restart. ([#21](https://github.com/badlogic/pi-mono/issues/21))
- Added `gpt-5.1-codex` model to OpenAI provider (400k context, 128k max output, reasoning-capable).

### Changed

- **Breaking**: No longer hardcodes Anthropic/Claude as default provider/model. Now prefers sensible defaults per provider (e.g., `claude-sonnet-4-5` for Anthropic, `gpt-5.1-codex` for OpenAI), or requires explicit selection in interactive mode.
- Interactive mode now allows starting without a model, showing helpful error on message submission instead of failing at startup.
- Non-interactive mode (CLI messages, JSON, RPC) still fails early if no model or API key is available.
- Model selector now saves selected model as default in settings.json.
- `models.json` validation errors (syntax + schema) now surface with precise file/field info in both CLI and `/model` selector.
- Agent system prompt now includes absolute path to its own README.md for self-documentation.

### Fixed

- Fixed crash when restoring a session with a custom model that no longer exists or lost credentials. Now gracefully falls back to default model, logs the reason, and appends a warning message to the restored chat.
- Footer no longer crashes when no model is selected.

## [0.7.11] - 2025-11-16

### Changed

- The `/model` selector now filters models based on available API keys. Only models for which API keys are configured in environment variables are shown. This prevents selecting models that would fail due to missing credentials. A yellow hint is displayed at the top of the selector explaining this behavior. ([#19](https://github.com/badlogic/pi-mono/pull/19))

## [0.7.10] - 2025-11-14

### Added

- `/branch` command for creating conversation branches. Opens a selector showing all user messages in chronological order. Selecting a message creates a new session with all messages before the selected one, and places the selected message in the editor for modification or resubmission. This allows exploring alternative conversation paths without losing the current session. (fixes [#16](https://github.com/badlogic/pi-mono/issues/16))

## [0.7.9] - 2025-11-14

### Changed

- Editor: updated keyboard shortcuts to follow Unix conventions:
  - **Ctrl+W** deletes the previous word (stopping at whitespace or punctuation)
  - **Ctrl+U** deletes from cursor to start of line (at line start, merges with previous line)
  - **Ctrl+K** deletes from cursor to end of line (at line end, merges with next line)
  - **Option+Backspace** in Ghostty now behaves like **Ctrl+W** (delete word backwards)
  - **Cmd+Backspace** in Ghostty now behaves like **Ctrl+U** (delete to start of line)

## [0.7.8] - 2025-11-13

### Changed

- Updated README.md with `/changelog` slash command documentation

## [0.7.7] - 2025-11-13

### Added

- Automatic changelog display on startup in interactive mode. When starting a new session (not continuing/resuming), the agent will display all changelog entries since the last version you used. The last shown version is tracked in `~/.pi/agent/settings.json`.
- `/changelog` command to display the changelog in the TUI
- OpenRouter Auto Router model support ([#5](https://github.com/badlogic/pi-mono/pull/5))
- Windows Git Bash support with automatic detection and process tree termination ([#1](https://github.com/badlogic/pi-mono/pull/1))

### Changed

- **BREAKING**: Renamed project context file from `AGENT.md` to `AGENTS.md`. The system now looks for `AGENTS.md` or `CLAUDE.md` (with `AGENTS.md` preferred). Existing `AGENT.md` files will need to be renamed to `AGENTS.md` to continue working. (fixes [#9](https://github.com/badlogic/pi-mono/pull/9))
- **BREAKING**: Session file format changed to store provider and model ID separately instead of as a single `provider/modelId` string. Existing sessions will not restore the model correctly when resumed - you'll need to manually set the model again using `/model`. (fixes [#4](https://github.com/badlogic/pi-mono/pull/4))
- Improved Windows Git Bash detection logic with better error messages showing actual paths searched ([#13](https://github.com/badlogic/pi-mono/pull/13))

### Fixed

- Fixed markdown list rendering bug where bullets were not displayed when list items contained inline code with cyan color formatting
- Fixed context percentage showing 0% in footer when last assistant message was aborted ([#12](https://github.com/badlogic/pi-mono/issues/12))
- Fixed error message loss when `turn_end` event contains an error. Previously, errors in `turn_end` events (e.g., "Provider returned error" from OpenRouter Auto Router) were not captured in `agent.state.error`, making it appear as if the agent completed successfully. ([#6](https://github.com/badlogic/pi-mono/issues/6))

## [0.7.6] - 2025-11-13

Previous releases did not maintain a changelog.
