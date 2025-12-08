# Changelog

## [Unreleased]

### Breaking Changes

- **Custom themes require new color tokens**: Themes must now include `thinkingXhigh` and `bashMode` color tokens. The theme loader provides helpful error messages listing missing tokens. See built-in themes (dark.json, light.json) for reference values.

### Added

- **OpenAI compatibility overrides in models.json**: Custom models using `openai-completions` API can now specify a `compat` object to override provider quirks (`supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `maxTokensField`). Useful for LiteLLM, custom proxies, and other non-standard endpoints. ([#133](https://github.com/badlogic/pi-mono/issues/133), thanks @fink-andreas for the initial idea and PR)

- **xhigh thinking level**: Added `xhigh` thinking level for OpenAI codex-max models. Cycle through thinking levels with Shift+Tab; `xhigh` appears only when using a codex-max model. ([#143](https://github.com/badlogic/pi-mono/issues/143))

- **Collapse changelog setting**: Add `"collapseChangelog": true` to `~/.pi/agent/settings.json` to show a condensed "Updated to vX.Y.Z" message instead of the full changelog after updates. Use `/changelog` to view the full changelog. ([#148](https://github.com/badlogic/pi-mono/issues/148))

- **Bash mode**: Execute shell commands directly from the editor by prefixing with `!` (e.g., `!ls -la`). Output streams in real-time, is added to the LLM context, and persists in session history. Supports multiline commands, cancellation (Escape), truncation for large outputs, and preview/expand toggle (Ctrl+O). Also available in RPC mode via `{"type":"bash","command":"..."}`. ([#112](https://github.com/badlogic/pi-mono/pull/112), original implementation by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.13.2] - 2025-12-07

### Changed

- **Tool output truncation**: All tools now enforce consistent truncation limits with actionable notices for the LLM. ([#134](https://github.com/badlogic/pi-mono/issues/134))
  - **Limits**: 2000 lines OR 50KB (whichever hits first), never partial lines
  - **read**: Shows `[Showing lines X-Y of Z. Use offset=N to continue]`. If first line exceeds 50KB, suggests bash command
  - **bash**: Tail truncation with temp file. Shows `[Showing lines X-Y of Z. Full output: /tmp/...]`
  - **grep**: Pre-truncates match lines to 500 chars. Shows match limit and line truncation notices
  - **find/ls**: Shows result/entry limit notices
  - TUI displays truncation warnings in yellow at bottom of tool output (visible even when collapsed)

## [0.13.1] - 2025-12-06

### Added

- **Flexible Windows shell configuration**: The bash tool now supports multiple shell sources beyond Git Bash. Resolution order: (1) custom `shellPath` in settings.json, (2) Git Bash in standard locations, (3) any bash.exe on PATH. This enables Cygwin, MSYS2, and other bash environments. Configure with `~/.pi/agent/settings.json`: `{"shellPath": "C:\\cygwin64\\bin\\bash.exe"}`.

### Fixed

- **Windows binary detection**: Fixed Bun compiled binary detection on Windows by checking for URL-encoded `%7EBUN` in addition to `$bunfs` and `~BUN` in `import.meta.url`. This ensures the binary correctly locates supporting files (package.json, themes, etc.) next to the executable.

## [0.12.15] - 2025-12-06

### Fixed

- **Editor crash with emojis/CJK characters**: Fixed crash when pasting or typing text containing wide characters (emojis like ✅, CJK characters) that caused line width to exceed terminal width. The editor now uses grapheme-aware text wrapping with proper visible width calculation.

## [0.12.14] - 2025-12-06

### Added

- **Double-Escape Branch Shortcut**: Press Escape twice with an empty editor to quickly open the `/branch` selector for conversation branching.

## [0.12.13] - 2025-12-05

### Changed

- **Faster startup**: Version check now runs in parallel with TUI initialization instead of blocking startup for up to 1 second. Update notifications appear in chat when the check completes.

## [0.12.12] - 2025-12-05

### Changed

- **Footer display**: Token counts now use M suffix for millions (e.g., `10.2M` instead of `10184k`). Context display shortened from `61.3% of 200k` to `61.3%/200k`.

### Fixed

- **Multi-key sequences in inputs**: Inputs like model search now handle multi-key sequences identically to the main prompt editor. ([#122](https://github.com/badlogic/pi-mono/pull/122) by [@markusylisiurunen](https://github.com/markusylisiurunen))
- **Line wrapping escape codes**: Fixed underline style bleeding into padding when wrapping long URLs. ANSI codes now attach to the correct content, and line-end resets only turn off underline (preserving background colors). ([#109](https://github.com/badlogic/pi-mono/issues/109))

### Added

- **Fuzzy search models and sessions**: Implemented a simple fuzzy search for models and sessions (e.g., `codexmax` now finds `gpt-5.1-codex-max`). ([#122](https://github.com/badlogic/pi-mono/pull/122) by [@markusylisiurunen](https://github.com/markusylisiurunen))
- **Prompt History Navigation**: Browse previously submitted prompts using Up/Down arrow keys when the editor is empty. Press Up to cycle through older prompts, Down to return to newer ones or clear the editor. Similar to shell history and Claude Code's prompt history feature. History is session-scoped and stores up to 100 entries. ([#121](https://github.com/badlogic/pi-mono/pull/121) by [@nicobailon](https://github.com/nicobailon))
- **`/resume` Command**: Switch to a different session mid-conversation. Opens an interactive selector showing all available sessions. Equivalent to the `--resume` CLI flag but can be used without restarting the agent. ([#117](https://github.com/badlogic/pi-mono/pull/117) by [@hewliyang](https://github.com/hewliyang))

## [0.12.11] - 2025-12-05

### Changed

- **Compaction UI**: Simplified collapsed compaction indicator to show warning-colored text with token count instead of styled banner. Removed redundant success message after compaction. ([#108](https://github.com/badlogic/pi-mono/issues/108))

### Fixed

- **Print mode error handling**: `-p` flag now outputs error messages and exits with code 1 when requests fail, instead of silently producing no output.
- **Branch selector crash**: Fixed TUI crash when user messages contained Unicode characters (like `✔` or `›`) that caused line width to exceed terminal width. Now uses proper `truncateToWidth` instead of `substring`.
- **Bash output escape sequences**: Fixed incomplete stripping of terminal escape sequences in bash tool output. `stripAnsi` misses some sequences like standalone String Terminator (`ESC \`), which could cause rendering issues when displaying captured TUI output.
- **Footer overflow crash**: Fixed TUI crash when terminal width is too narrow for the footer stats line. The footer now truncates gracefully instead of overflowing.

### Added

- **`authHeader` option in models.json**: Custom providers can set `"authHeader": true` to automatically add `Authorization: Bearer <apiKey>` header. Useful for providers that require explicit auth headers. ([#81](https://github.com/badlogic/pi-mono/issues/81))
- **`--append-system-prompt` Flag**: Append additional text or file contents to the system prompt. Supports both inline text and file paths. Complements `--system-prompt` for layering custom instructions without replacing the base system prompt. ([#114](https://github.com/badlogic/pi-mono/pull/114) by [@markusylisiurunen](https://github.com/markusylisiurunen))
- **Thinking Block Toggle**: Added `Ctrl+T` shortcut to toggle visibility of LLM thinking blocks. When toggled off, shows a static "Thinking..." label instead of full content. Useful for reducing visual clutter during long conversations. ([#113](https://github.com/badlogic/pi-mono/pull/113) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.12.10] - 2025-12-04

### Added

- Added `gpt-5.1-codex-max` model support

## [0.12.9] - 2025-12-04

### Added

- **`/copy` Command**: Copy the last agent message to clipboard. Works cross-platform (macOS, Windows, Linux). Useful for extracting text from rendered Markdown output. ([#105](https://github.com/badlogic/pi-mono/pull/105) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.12.8] - 2025-12-04

- Fix: Use CTRL+O consistently for compaction expand shortcut (not CMD+O on Mac)

## [0.12.7] - 2025-12-04

### Added

- **Context Compaction**: Long sessions can now be compacted to reduce context usage while preserving recent conversation history. ([#92](https://github.com/badlogic/pi-mono/issues/92), [docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#context-compaction))
  - `/compact [instructions]`: Manually compact context with optional custom instructions for the summary
  - `/autocompact`: Toggle automatic compaction when context exceeds threshold
  - Compaction summarizes older messages while keeping recent messages (default 20k tokens) verbatim
  - Auto-compaction triggers when context reaches `contextWindow - reserveTokens` (default 16k reserve)
  - Compacted sessions show a collapsible summary in the TUI (toggle with `o` key)
  - HTML exports include compaction summaries as collapsible sections
  - RPC mode supports `{"type":"compact"}` command and auto-compaction (emits compaction events)
- **Branch Source Tracking**: Branched sessions now store `branchedFrom` in the session header, containing the path to the original session file. Useful for tracing session lineage.

## [0.12.5] - 2025-12-03

### Added

- **Forking/Rebranding Support**: All branding (app name, config directory, environment variable names) is now configurable via `piConfig` in `package.json`. Forks can change `piConfig.name` and `piConfig.configDir` to rebrand the CLI without code changes. Affects CLI banner, help text, config paths, and error messages. ([#95](https://github.com/badlogic/pi-mono/pull/95))

### Fixed

- **Bun Binary Detection**: Fixed Bun compiled binary failing to start after Bun updated its virtual filesystem path format from `%7EBUN` to `$bunfs`. ([#95](https://github.com/badlogic/pi-mono/pull/95))

## [0.12.4] - 2025-12-02

### Added

- **RPC Termination Safeguard**: When running as an RPC worker (stdin pipe detected), the CLI now exits immediately if the parent process terminates unexpectedly. Prevents orphaned RPC workers from persisting indefinitely and consuming system resources.

## [0.12.3] - 2025-12-02

### Fixed

- **Rate limit handling**: Anthropic rate limit errors now trigger automatic retry with exponential backoff (base 10s, max 5 retries). Previously these errors would abort the request immediately.
- **Usage tracking during retries**: Retried requests now correctly accumulate token usage from all attempts, not just the final successful one. Fixes artificially low token counts when requests were retried.

## [0.12.2] - 2025-12-02

### Changed

- Removed support for gpt-4.5-preview and o3 models (not yet available)

## [0.12.1] - 2025-12-02

### Added

- **Models**: Added support for OpenAI's new models:
  - `gpt-4.1` (128K context)
  - `gpt-4.1-mini` (128K context)
  - `gpt-4.1-nano` (128K context)
  - `o3` (200K context, reasoning model)
  - `o4-mini` (200K context, reasoning model)

## [0.12.0] - 2025-12-02

### Added

- **`-p, --print` Flag**: Run in non-interactive batch mode. Processes input message or piped stdin without TUI, prints agent response directly to stdout. Ideal for scripting, piping, and CI/CD integration. Exits after first response.
- **`-P, --print-streaming` Flag**: Like `-p`, but streams response tokens as they arrive. Use `--print-streaming --no-markdown` for raw unformatted output.
- **`--print-turn` Flag**: Continue processing tool calls and agent turns until the agent naturally finishes or requires user input. Combine with `-p` for complete multi-turn conversations.
- **`--no-markdown` Flag**: Output raw text without Markdown formatting. Useful when piping output to tools that expect plain text.
- **Streaming Print Mode**: Added internal `printStreaming` option for streaming output in non-TUI mode.
- **RPC Mode `print` Command**: Send `{"type":"print","content":"text"}` to get formatted print output via `print_output` events.
- **Auto-Save in Print Mode**: Print mode conversations are automatically saved to the session directory, allowing later resumption with `--continue`.
- **Thinking level options**: Added `--thinking-off`, `--thinking-minimal`, `--thinking-low`, `--thinking-medium`, `--thinking-high` flags for directly specifying thinking level without the selector UI.

### Changed

- **Simplified RPC Protocol**: Replaced the `prompt` wrapper command with direct message objects. Send `{"role":"user","content":"text"}` instead of `{"type":"prompt","message":"text"}`. Better aligns with message format throughout the codebase.
- **RPC Message Handling**: Agent now processes raw message objects directly, with `timestamp` auto-populated if missing.

## [0.11.9] - 2025-12-02

### Changed

- Change Ctrl+I to Ctrl+P for model cycling shortcut to avoid collision with Tab key in some terminals

## [0.11.8] - 2025-12-01

### Fixed

- Absolute glob patterns (e.g., `/Users/foo/**/*.ts`) are now handled correctly. Previously the leading `/` was being stripped, causing the pattern to be interpreted relative to the current directory.

## [0.11.7] - 2025-12-01

### Fixed

- Fix read path traversal vulnerability. Paths are now validated to prevent reading outside the working directory or its parents. The `read` tool can read from `cwd`, its ancestors (for config files), and all descendants. Symlinks are resolved before validation.

## [0.11.6] - 2025-12-01

### Fixed

- Fix `--system-prompt <path>` allowing the path argument to be captured by the message collection, causing "file not found" errors.

## [0.11.5] - 2025-11-30

### Fixed

- Fixed fatal error "Cannot set properties of undefined (setting '0')" when editing empty files in the `edit` tool.
- Simplified `edit` tool output: Shows only "Edited file.txt" for successful edits instead of verbose search/replace details.
- Fixed fatal error in footer rendering when token counts contain NaN values due to missing usage data.

## [0.11.4] - 2025-11-30

### Fixed

- Fixed chat rendering crash when messages contain preformatted/styled text (e.g., thinking traces with gray italic styling). The markdown renderer now preserves existing ANSI escape codes when they appear before inline elements.

## [0.11.3] - 2025-11-29

### Fixed

- Fix file drop functionality for absolute paths

## [0.11.2] - 2025-11-29

### Fixed

- Fixed TUI crash when pasting content containing tab characters. Tabs are now converted to 4 spaces before insertion.
- Fixed terminal corruption after exit when shell integration sequences (OSC 133) appeared in bash output. These sequences are now stripped along with other ANSI codes.

## [0.11.1] - 2025-11-29

### Added

- Added `fd` integration for file path autocompletion. Now uses `fd` for faster fuzzy file search

### Fixed

- Fixed keyboard shortcuts Ctrl+A, Ctrl+E, Ctrl+K, Ctrl+U, Ctrl+W, and word navigation (Option+Arrow) not working in VS Code integrated terminal and some other terminal emulators

## [0.11.0] - 2025-11-29

### Added

- **File-based Slash Commands**: Create custom reusable prompts as `.txt` files in `~/.pi/slash-commands/`. Files become `/filename` commands with first-line descriptions. Supports `{{selection}}` placeholder for referencing selected/attached content.
- **`/branch` Command**: Create conversation branches from any previous user message. Opens a selector to pick a message, then creates a new session file starting from that point. Original message text is placed in the editor for modification.
- **Unified Content References**: Both `@path` in messages and `--file path` CLI arguments now use the same attachment system with consistent MIME type detection.
- **Drag & Drop Files**: Drop files onto the terminal to attach them to your message. Supports multiple files and both text and image content.

### Changed

- **Model Selector with Search**: The `/model` command now opens a searchable list. Type to filter models by name, use arrows to navigate, Enter to select.
- **Improved File Autocomplete**: File path completion after `@` now supports fuzzy matching and shows file/directory indicators.
- **Session Selector with Search**: The `--resume` and `--session` flags now open a searchable session list with fuzzy filtering.
- **Attachment Display**: Files added via `@path` are now shown as "Attached: filename" in the user message, separate from the prompt text.
- **Tab Completion**: Tab key now triggers file path autocompletion anywhere in the editor, not just after `@` symbol.

### Fixed

- Fixed autocomplete z-order issue where dropdown could appear behind chat messages
- Fixed cursor position when navigating through wrapped lines in the editor
- Fixed attachment handling for continued sessions to preserve file references

## [0.10.6] - 2025-11-28

### Changed

- Show base64-truncated indicator for large images in tool output

### Fixed

- Fixed image dimensions not being read correctly from PNG/JPEG/GIF files
- Fixed PDF images being incorrectly base64-truncated in display
- Allow reading files from ancestor directories (needed for monorepo configs)

## [0.10.5] - 2025-11-28

### Added

- Full multimodal support: attach images (PNG, JPEG, GIF, WebP) and PDFs to prompts using `@path` syntax or `--file` flag

### Fixed

- `@`-references now handle special characters in file names (spaces, quotes, unicode)
- Fixed cursor positioning issues with multi-byte unicode characters in editor

## [0.10.4] - 2025-11-28

### Fixed

- Removed padding on first user message in TUI to improve visual consistency.

## [0.10.3] - 2025-11-28

### Added

- Added RPC mode (`--rpc`) for programmatic integration. Accepts JSON commands on stdin, emits JSON events on stdout. See [RPC mode documentation](https://github.com/nicobailon/pi-mono/blob/main/packages/coding-agent/README.md#rpc-mode) for protocol details.

### Changed

- Refactored internal architecture to support multiple frontends (TUI, RPC) with shared agent logic.

## [0.10.2] - 2025-11-26

### Added

- Added thinking level persistence. Default level stored in `~/.pi/settings.json`, restored on startup. Per-session overrides saved in session files.
- Added model cycling shortcut: `Ctrl+I` cycles through available models (or scoped models with `-m` flag).
- Added automatic retry with exponential backoff for transient API errors (network issues, 500s, overload).
- Cumulative token usage now shown in footer (total tokens used across all messages in session).
- Added `--system-prompt` flag to override default system prompt with custom text or file contents.
- Footer now shows estimated total cost in USD based on model pricing.

### Changed

- Replaced `--models` flag with `-m/--model` supporting multiple values. Specify models as `provider/model@thinking` (e.g., `anthropic/claude-sonnet-4-20250514@high`). Multiple `-m` flags scope available models for the session.
- Thinking level border now persists visually after selector closes.
- Improved tool result display with collapsible output (default collapsed, expand with `Ctrl+O`).

## [0.10.1] - 2025-11-25

### Added

- Add custom model configuration via `~/.pi/models.json`

## [0.10.0] - 2025-11-25

Initial public release.

### Added

- Interactive TUI with streaming responses
- Conversation session management with `--continue`, `--resume`, and `--session` flags
- Multi-line input support (Shift+Enter or Option+Enter for new lines)
- Tool execution: `read`, `write`, `edit`, `bash`, `glob`, `grep`, `think`
- Thinking mode support for Claude with visual indicator and `/thinking` selector
- File path autocompletion with `@` prefix
- Slash command autocompletion
- `/export` command for HTML session export
- `/model` command for runtime model switching
- `/session` command for session statistics
- Model provider support: Anthropic (Claude), OpenAI, Google (Gemini)
- Git branch display in footer
- Message queueing during streaming responses
- OAuth integration for Gmail and Google Calendar access
- HTML export with syntax highlighting and collapsible sections
