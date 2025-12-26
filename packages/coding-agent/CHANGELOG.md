# Changelog

## [Unreleased]

### Fixed

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

- **Renamed `/clear` to `/new`**: The command to start a fresh session is now `/new`. Hook event reasons `before_clear`/`clear` are now `before_new`/`new`. Merry Christmas [@mitsuhiko](https://github.com/mitsuhiko)! ([#305](https://github.com/badlogic/pi-mono/pull/305))

### Added

- **Auto-space before pasted file paths**: When pasting a file path (starting with `/`, `~`, or `.`) after a word character, a space is automatically prepended. ([#307](https://github.com/badlogic/pi-mono/pull/307) by [@mitsuhiko](https://github.com/mitsuhiko))
- **Word navigation in input fields**: Added Ctrl+Left/Right and Alt+Left/Right for word-by-word cursor movement. ([#306](https://github.com/badlogic/pi-mono/pull/306) by [@kim0](https://github.com/kim0))
- **Full Unicode input**: Input fields now accept Unicode characters beyond ASCII. ([#306](https://github.com/badlogic/pi-mono/pull/306) by [@kim0](https://github.com/kim0))

### Fixed

- **Readline-style Ctrl+W**: Now skips trailing whitespace before deleting the preceding word, matching standard readline behavior. ([#306](https://github.com/badlogic/pi-mono/pull/306) by [@kim0](https://github.com/kim0))

## [0.28.0] - 2025-12-25

### Changed

- **Credential storage refactored**: API keys and OAuth tokens are now stored in `~/.pi/agent/auth.json` instead of `oauth.json` and `settings.json`. Existing credentials are automatically migrated on first run. ([#296](https://github.com/badlogic/pi-mono/issues/296))

- **SDK API changes** ([#296](https://github.com/badlogic/pi-mono/issues/296)):
  - Added `AuthStorage` class for credential management (API keys and OAuth tokens)
  - Added `ModelRegistry` class for model discovery and API key resolution
  - Added `discoverAuthStorage()` and `discoverModels()` discovery functions
  - `createAgentSession()` now accepts `authStorage` and `modelRegistry` options
  - Removed `configureOAuthStorage()`, `defaultGetApiKey()`, `findModel()`, `discoverAvailableModels()`
  - Removed `getApiKey` callback option (use `AuthStorage.setRuntimeApiKey()` for runtime overrides)
  - Use `getModel()` from `@mariozechner/pi-ai` for built-in models, `modelRegistry.find()` for custom models + built-in models
  - See updated [SDK documentation](docs/sdk.md) and [README](README.md)

- **Settings changes**: Removed `apiKeys` from `settings.json`. Use `auth.json` instead. ([#296](https://github.com/badlogic/pi-mono/issues/296))

### Fixed

- **Duplicate skill warnings for symlinks**: Skills loaded via symlinks pointing to the same file are now silently deduplicated instead of showing name collision warnings. ([#304](https://github.com/badlogic/pi-mono/pull/304) by [@mitsuhiko](https://github.com/mitsuhiko))

## [0.27.9] - 2025-12-24

### Fixed

- **Model selector and --list-models with settings.json API keys**: Models with API keys configured in settings.json (but not in environment variables) now properly appear in the /model selector and `--list-models` output. ([#295](https://github.com/badlogic/pi-mono/issues/295))

## [0.27.8] - 2025-12-24

### Fixed

- **API key priority**: OAuth tokens now take priority over settings.json API keys. Previously, an API key in settings.json would trump OAuth, causing users logged in with a plan (unlimited tokens) to be billed via PAYG instead.

## [0.27.7] - 2025-12-24

### Fixed

- **Thinking tag leakage**: Fixed Claude mimicking literal `</thinking>` tags in responses. Unsigned thinking blocks (from aborted streams) are now converted to plain text without `<thinking>` tags. The TUI still displays them as thinking blocks. ([#302](https://github.com/badlogic/pi-mono/pull/302) by [@nicobailon](https://github.com/nicobailon))

## [0.27.6] - 2025-12-24

### Added

- **Compaction hook improvements**: The `before_compact` session event now includes:
  - `previousSummary`: Summary from the last compaction (if any), so hooks can preserve accumulated context
  - `messagesToKeep`: Messages that will be kept after the summary (recent turns), in addition to `messagesToSummarize`
  - `resolveApiKey`: Function to resolve API keys for any model (checks settings, OAuth, env vars)
  - Removed `apiKey` string in favor of `resolveApiKey` for more flexibility

- **SessionManager API cleanup**:
  - Renamed `loadSessionFromEntries()` to `buildSessionContext()` (builds LLM context from entries, handling compaction)
  - Renamed `loadEntries()` to `getEntries()` (returns defensive copy of all session entries)
  - Added `buildSessionContext()` method to SessionManager

## [0.27.5] - 2025-12-24

### Added

- **HTML export syntax highlighting**: Code blocks in markdown and tool outputs (read, write) now have syntax highlighting using highlight.js with theme-aware colors matching the TUI.
- **HTML export improvements**: Render markdown server-side using marked (tables, headings, code blocks, etc.), honor user's chosen theme (light/dark), add image rendering for user messages, and style code blocks with TUI-like language markers. ([@scutifer](https://github.com/scutifer))

### Fixed

- **Ghostty inline images in tmux**: Fixed terminal detection for Ghostty when running inside tmux by checking `GHOSTTY_RESOURCES_DIR` env var. ([#299](https://github.com/badlogic/pi-mono/pull/299) by [@nicobailon](https://github.com/nicobailon))

## [0.27.4] - 2025-12-24

### Fixed

- **Symlinked skill directories**: Skills in symlinked directories (e.g., `~/.pi/agent/skills/my-skills -> /path/to/skills`) are now correctly discovered and loaded.

## [0.27.3] - 2025-12-24

### Added

- **API keys in settings.json**: Store API keys in `~/.pi/agent/settings.json` under the `apiKeys` field (e.g., `{ "apiKeys": { "anthropic": "sk-..." } }`). Settings keys take priority over environment variables. ([#295](https://github.com/badlogic/pi-mono/issues/295))

### Fixed

- **Allow startup without API keys**: Interactive mode no longer throws when no API keys are configured. Users can now start the agent and use `/login` to authenticate. ([#288](https://github.com/badlogic/pi-mono/issues/288))
- **`--system-prompt` file path support**: The `--system-prompt` argument now correctly resolves file paths (like `--append-system-prompt` already did). ([#287](https://github.com/badlogic/pi-mono/pull/287) by [@scutifer](https://github.com/scutifer))

## [0.27.2] - 2025-12-23

### Added

- **Skip conversation restore on branch**: Hooks can return `{ skipConversationRestore: true }` from `before_branch` to create the branched session file without restoring conversation messages. Useful for checkpoint hooks that restore files separately. ([#286](https://github.com/badlogic/pi-mono/pull/286) by [@nicobarray](https://github.com/nicobarray))

## [0.27.1] - 2025-12-22

### Fixed

- **Skill discovery performance**: Skip `node_modules` directories when recursively scanning for skills. Fixes ~60ms startup delay when skill directories contain npm dependencies.

### Added

- **Startup timing instrumentation**: Set `PI_TIMING=1` to see startup performance breakdown (interactive mode only).

## [0.27.0] - 2025-12-22

### Breaking

- **Session hooks API redesign**: Merged `branch` event into `session` event. `BranchEvent`, `BranchEventResult` types and `pi.on("branch", ...)` removed. Use `pi.on("session", ...)` with `reason: "before_branch" | "branch"` instead. `AgentSession.branch()` returns `{ cancelled }` instead of `{ skipped }`. `AgentSession.reset()` and `switchSession()` now return `boolean` (false if cancelled by hook). RPC commands `reset`, `switch_session`, and `branch` now include `cancelled` in response data. ([#278](https://github.com/badlogic/pi-mono/issues/278))

### Added

- **Session lifecycle hooks**: Added `before_*` variants (`before_switch`, `before_clear`, `before_branch`) that fire before actions and can be cancelled with `{ cancel: true }`. Added `shutdown` reason for graceful exit handling. ([#278](https://github.com/badlogic/pi-mono/issues/278))

### Fixed

- **File tab completion display**: File paths no longer get cut off early. Folders now show trailing `/` and removed redundant "directory"/"file" labels to maximize horizontal space. ([#280](https://github.com/badlogic/pi-mono/issues/280))

- **Bash tool visual line truncation**: Fixed bash tool output in collapsed mode to use visual line counting (accounting for line wrapping) instead of logical line counting. Now consistent with bash-execution.ts behavior. Extracted shared `truncateToVisualLines` utility. ([#275](https://github.com/badlogic/pi-mono/issues/275))

## [0.26.1] - 2025-12-22

### Fixed

- **SDK tools respect cwd**: Core tools (bash, read, edit, write, grep, find, ls) now properly use the `cwd` option from `createAgentSession()`. Added tool factory functions (`createBashTool`, `createReadTool`, etc.) for SDK users who specify custom `cwd` with explicit tools. ([#279](https://github.com/badlogic/pi-mono/issues/279))

## [0.26.0] - 2025-12-22

### Added

- **SDK for programmatic usage**: New `createAgentSession()` factory with full control over model, tools, hooks, skills, session persistence, and settings. Philosophy: "omit to discover, provide to override". Includes 12 examples and comprehensive documentation. ([#272](https://github.com/badlogic/pi-mono/issues/272))

- **Project-specific settings**: Settings now load from both `~/.pi/agent/settings.json` (global) and `<cwd>/.pi/settings.json` (project). Project settings override global with deep merge for nested objects. Project settings are read-only (for version control). ([#276](https://github.com/badlogic/pi-mono/pull/276))

- **SettingsManager static factories**: `SettingsManager.create(cwd?, agentDir?)` for file-based settings, `SettingsManager.inMemory(settings?)` for testing. Added `applyOverrides()` for programmatic overrides.

- **SessionManager static factories**: `SessionManager.create()`, `SessionManager.open()`, `SessionManager.continueRecent()`, `SessionManager.inMemory()`, `SessionManager.list()` for flexible session management.

## [0.25.4] - 2025-12-22

### Fixed

- **Syntax highlighting stderr spam**: Fixed cli-highlight logging errors to stderr when markdown contains malformed code fences (e.g., missing newlines around closing backticks). Now validates language identifiers before highlighting and falls back silently to plain text. ([#274](https://github.com/badlogic/pi-mono/issues/274))

## [0.25.3] - 2025-12-21

### Added

- **Gemini 3 preview models**: Added `gemini-3-pro-preview` and `gemini-3-flash-preview` to the google-gemini-cli provider. ([#264](https://github.com/badlogic/pi-mono/pull/264) by [@LukeFost](https://github.com/LukeFost))

- **External editor support**: Press `Ctrl+G` to edit your message in an external editor. Uses `$VISUAL` or `$EDITOR` environment variable. On successful save, the message is replaced; on cancel, the original is kept. ([#266](https://github.com/badlogic/pi-mono/pull/266) by [@aliou](https://github.com/aliou))

- **Process suspension**: Press `Ctrl+Z` to suspend pi and return to the shell. Resume with `fg` as usual. ([#267](https://github.com/badlogic/pi-mono/pull/267) by [@aliou](https://github.com/aliou))

- **Configurable skills directories**: Added granular control over skill sources with `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject` toggles, plus `customDirectories` and `ignoredSkills` settings. ([#269](https://github.com/badlogic/pi-mono/pull/269) by [@nicobailon](https://github.com/nicobailon))

- **Skills CLI filtering**: Added `--skills <patterns>` flag for filtering skills with glob patterns. Also added `includeSkills` setting and glob pattern support for `ignoredSkills`. ([#268](https://github.com/badlogic/pi-mono/issues/268))

## [0.25.2] - 2025-12-21

### Fixed

- **Image shifting in tool output**: Fixed an issue where images in tool output would shift down (due to accumulating spacers) each time the tool output was expanded or collapsed via Ctrl+O.

## [0.25.1] - 2025-12-21

### Fixed

- **Gemini image reading broken**: Fixed the `read` tool returning images causing flaky/broken responses with Gemini models. Images in tool results are now properly formatted per the Gemini API spec.

- **Tab completion for absolute paths**: Fixed tab completion producing `//tmp` instead of `/tmp/`. Also fixed symlinks to directories (like `/tmp`) not getting a trailing slash, which prevented continuing to tab through subdirectories.

## [0.25.0] - 2025-12-20

### Added

- **Interruptible tool execution**: Queuing a message while tools are executing now interrupts the current tool batch. Remaining tools are skipped with an error result, and your queued message is processed immediately. Useful for redirecting the agent mid-task. ([#259](https://github.com/badlogic/pi-mono/pull/259) by [@steipete](https://github.com/steipete))

- **Google Gemini CLI OAuth provider**: Access Gemini 2.0/2.5 models for free via Google Cloud Code Assist. Login with `/login` and select "Google Gemini CLI". Uses your Google account with rate limits.

- **Google Antigravity OAuth provider**: Access Gemini 3, Claude (sonnet/opus thinking models), and GPT-OSS models for free via Google's Antigravity sandbox. Login with `/login` and select "Antigravity". Uses your Google account with rate limits.

### Changed

- **Model selector respects --models scope**: The `/model` command now only shows models specified via `--models` flag when that flag is used, instead of showing all available models. This prevents accidentally selecting models from unintended providers. ([#255](https://github.com/badlogic/pi-mono/issues/255))

### Fixed

- **Connection errors not retried**: Added "connection error" to the list of retryable errors so Anthropic connection drops trigger auto-retry instead of silently failing. ([#252](https://github.com/badlogic/pi-mono/issues/252))

- **Thinking level not clamped on model switch**: Fixed TUI showing xhigh thinking level after switching to a model that doesn't support it. Thinking level is now automatically clamped to model capabilities. ([#253](https://github.com/badlogic/pi-mono/issues/253))

- **Cross-model thinking handoff**: Fixed error when switching between models with different thinking signature formats (e.g., GPT-OSS to Claude thinking models via Antigravity). Thinking blocks without signatures are now converted to text with `<thinking>` delimiters.

## [0.24.5] - 2025-12-20

### Fixed

- **Input buffering in iTerm2**: Fixed Ctrl+C, Ctrl+D, and other keys requiring multiple presses in iTerm2. The cell size query response parser was incorrectly holding back keyboard input.

## [0.24.4] - 2025-12-20

### Fixed

- **Arrow keys and Enter in selector components**: Fixed arrow keys and Enter not working in model selector, session selector, OAuth selector, and other selector components when Caps Lock or Num Lock is enabled. ([#243](https://github.com/badlogic/pi-mono/issues/243))

## [0.24.3] - 2025-12-19

### Fixed

- **Footer overflow on narrow terminals**: Fixed footer path display exceeding terminal width when resizing to very narrow widths, causing rendering crashes. /arminsayshi

## [0.24.2] - 2025-12-20

### Fixed

- **More Kitty keyboard protocol fixes**: Fixed Backspace, Enter, Home, End, and Delete keys not working with Caps Lock enabled. The initial fix in 0.24.1 missed several key handlers that were still using raw byte detection. Now all key handlers use the helper functions that properly mask out lock key bits. ([#243](https://github.com/badlogic/pi-mono/issues/243))

## [0.24.1] - 2025-12-19

### Added

- **OAuth and model config exports**: Scripts using `AgentSession` directly can now import `getAvailableModels`, `getApiKeyForModel`, `findModel`, `login`, `logout`, and `getOAuthProviders` from `@mariozechner/pi-coding-agent` to reuse OAuth token storage and model resolution. ([#245](https://github.com/badlogic/pi-mono/issues/245))

- **xhigh thinking level for gpt-5.2 models**: The thinking level selector and shift+tab cycling now show xhigh option for gpt-5.2 and gpt-5.2-codex models (in addition to gpt-5.1-codex-max). ([#236](https://github.com/badlogic/pi-mono/pull/236) by [@theBucky](https://github.com/theBucky))

### Fixed

- **Hooks wrap custom tools**: Custom tools are now executed through the hook wrapper, so `tool_call`/`tool_result` hooks can observe, block, and modify custom tool executions (consistent with hook type docs). ([#248](https://github.com/badlogic/pi-mono/pull/248) by [@nicobailon](https://github.com/nicobailon))

- **Hook onUpdate callback forwarding**: The `onUpdate` callback is now correctly forwarded through the hook wrapper, fixing custom tool progress updates. ([#238](https://github.com/badlogic/pi-mono/pull/238) by [@nicobailon](https://github.com/nicobailon))

- **Terminal cleanup on Ctrl+C in session selector**: Fixed terminal not being properly restored when pressing Ctrl+C in the session selector. ([#247](https://github.com/badlogic/pi-mono/pull/247) by [@aliou](https://github.com/aliou))

- **OpenRouter models with colons in IDs**: Fixed parsing of OpenRouter model IDs that contain colons (e.g., `openrouter:meta-llama/llama-4-scout:free`). ([#242](https://github.com/badlogic/pi-mono/pull/242) by [@aliou](https://github.com/aliou))

- **Global AGENTS.md loaded twice**: Fixed global AGENTS.md being loaded twice when present in both `~/.pi/agent/` and the current directory. ([#239](https://github.com/badlogic/pi-mono/pull/239) by [@aliou](https://github.com/aliou))

- **Kitty keyboard protocol on Linux**: Fixed keyboard input not working in Ghostty on Linux when Num Lock is enabled. The Kitty protocol includes Caps Lock and Num Lock state in modifier values, which broke key detection. Now correctly masks out lock key bits when matching keyboard shortcuts. ([#243](https://github.com/badlogic/pi-mono/issues/243))

- **Emoji deletion and cursor movement**: Backspace, Delete, and arrow keys now correctly handle multi-codepoint characters like emojis. Previously, deleting an emoji would leave partial bytes, corrupting the editor state. ([#240](https://github.com/badlogic/pi-mono/issues/240))

## [0.24.0] - 2025-12-19

### Added

- **Subagent orchestration example**: Added comprehensive custom tool example for spawning and orchestrating sub-agents with isolated context windows. Includes scout/planner/reviewer/worker agents and workflow commands for multi-agent pipelines. ([#215](https://github.com/badlogic/pi-mono/pull/215) by [@nicobailon](https://github.com/nicobailon))

- **`getMarkdownTheme()` export**: Custom tools can now import `getMarkdownTheme()` from `@mariozechner/pi-coding-agent` to use the same markdown styling as the main UI.

- **`pi.exec()` signal and timeout support**: Custom tools and hooks can now pass `{ signal, timeout }` options to `pi.exec()` for cancellation and timeout handling. The result includes a `killed` flag when the process was terminated.

- **Kitty keyboard protocol support**: Shift+Enter, Alt+Enter, Shift+Tab, Ctrl+D, and all Ctrl+key combinations now work in Ghostty, Kitty, WezTerm, and other modern terminals. ([#225](https://github.com/badlogic/pi-mono/pull/225) by [@kim0](https://github.com/kim0))

- **Dynamic API key refresh**: OAuth tokens (GitHub Copilot, Anthropic OAuth) are now refreshed before each LLM call, preventing failures in long-running agent loops where tokens expire mid-session. ([#223](https://github.com/badlogic/pi-mono/pull/223) by [@kim0](https://github.com/kim0))

- **`/hotkeys` command**: Shows all keyboard shortcuts in a formatted table.

- **Markdown table borders**: Tables now render with proper top and bottom borders.

### Changed

- **Subagent example improvements**: Parallel mode now streams updates from all tasks. Chain mode shows all completed steps during streaming. Expanded view uses proper markdown rendering with syntax highlighting. Usage footer shows turn count.

- **Skills standard compliance**: Skills now adhere to the [Agent Skills standard](https://agentskills.io/specification). Validates name (must match parent directory, lowercase, max 64 chars), description (required, max 1024 chars), and frontmatter fields. Warns on violations but remains lenient. Prompt format changed to XML structure. Removed `{baseDir}` placeholder in favor of relative paths. ([#231](https://github.com/badlogic/pi-mono/issues/231))

### Fixed

- **JSON mode stdout flush**: Fixed race condition where `pi --mode json` could exit before all output was written to stdout, causing consumers to miss final events.

- **Symlinked tools, hooks, and slash commands**: Discovery now correctly follows symlinks when scanning for custom tools, hooks, and slash commands. ([#219](https://github.com/badlogic/pi-mono/pull/219), [#232](https://github.com/badlogic/pi-mono/pull/232) by [@aliou](https://github.com/aliou))

### Breaking Changes

- **Custom tools now require `index.ts` entry point**: Auto-discovered custom tools must be in a subdirectory with an `index.ts` file. The old pattern `~/.pi/agent/tools/mytool.ts` must become `~/.pi/agent/tools/mytool/index.ts`. This allows multi-file tools to import helper modules. Explicit paths via `--tool` or `settings.json` still work with any `.ts` file.

- **Hook `tool_result` event restructured**: The `ToolResultEvent` now exposes full tool result data instead of just text. ([#233](https://github.com/badlogic/pi-mono/pull/233))
  - Removed: `result: string` field
  - Added: `content: (TextContent | ImageContent)[]` - full content array
  - Added: `details: unknown` - tool-specific details (typed per tool via discriminated union on `toolName`)
  - `ToolResultEventResult.result` renamed to `ToolResultEventResult.text` (removed), use `content` instead
  - Hook handlers returning `{ result: "..." }` must change to `{ content: [{ type: "text", text: "..." }] }`
  - Built-in tool details types exported: `BashToolDetails`, `ReadToolDetails`, `GrepToolDetails`, `FindToolDetails`, `LsToolDetails`, `TruncationResult`
  - Type guards exported for narrowing: `isBashToolResult`, `isReadToolResult`, `isEditToolResult`, `isWriteToolResult`, `isGrepToolResult`, `isFindToolResult`, `isLsToolResult`

## [0.23.4] - 2025-12-18

### Added

- **Syntax highlighting**: Added syntax highlighting for markdown code blocks, read tool output, and write tool content. Uses cli-highlight with theme-aware color mapping and VS Code-style syntax colors. ([#214](https://github.com/badlogic/pi-mono/pull/214) by [@svkozak](https://github.com/svkozak))

- **Intra-line diff highlighting**: Edit tool now shows word-level changes with inverse highlighting when a single line is modified. Multi-line changes show all removed lines first, then all added lines.

### Fixed

- **Gemini tool result format**: Fixed tool result format for Gemini 3 Flash Preview which strictly requires `{ output: value }` for success and `{ error: value }` for errors. Previous format using `{ result, isError }` was rejected by newer Gemini models. ([#213](https://github.com/badlogic/pi-mono/issues/213), [#220](https://github.com/badlogic/pi-mono/pull/220))

- **Google baseUrl configuration**: Google provider now respects `baseUrl` configuration for custom endpoints or API proxies. ([#216](https://github.com/badlogic/pi-mono/issues/216), [#221](https://github.com/badlogic/pi-mono/pull/221) by [@theBucky](https://github.com/theBucky))

- **Google provider FinishReason**: Added handling for new `IMAGE_RECITATION` and `IMAGE_OTHER` finish reasons. Upgraded @google/genai to 1.34.0.

## [0.23.3] - 2025-12-17

### Fixed

- Check for compaction before submitting user prompt, not just after agent turn ends. This catches cases where user aborts mid-response and context is already near the limit.

### Changed

- Improved system prompt documentation section with clearer pointers to specific doc files for custom models, themes, skills, hooks, custom tools, and RPC.

- Cleaned up documentation:
  - `theme.md`: Added missing color tokens (`thinkingXhigh`, `bashMode`)
  - `skills.md`: Rewrote with better framing and examples
  - `hooks.md`: Fixed timeout/error handling docs, added import aliases section
  - `custom-tools.md`: Added intro with use cases and comparison table
  - `rpc.md`: Added missing `hook_error` event documentation
  - `README.md`: Complete settings table, condensed philosophy section, standardized OAuth docs

- Hooks loader now supports same import aliases as custom tools (`@sinclair/typebox`, `@mariozechner/pi-ai`, `@mariozechner/pi-tui`, `@mariozechner/pi-coding-agent`).

### Breaking Changes

- **Hooks**: `turn_end` event's `toolResults` type changed from `AppMessage[]` to `ToolResultMessage[]`. If you have hooks that handle `turn_end` events and explicitly type the results, update your type annotations.

## [0.23.2] - 2025-12-17

### Fixed

- Fixed Claude models via GitHub Copilot re-answering all previous prompts in multi-turn conversations. The issue was that assistant message content was sent as an array instead of a string, which Copilot's Claude adapter misinterpreted. Also added missing `Openai-Intent: conversation-edits` header and fixed `X-Initiator` logic to check for any assistant/tool message in history. ([#209](https://github.com/badlogic/pi-mono/issues/209))

- Detect image MIME type via file magic (read tool and `@file` attachments), not filename extension.

- Fixed markdown tables overflowing terminal width. Tables now wrap cell contents to fit available width instead of breaking borders mid-row. ([#206](https://github.com/badlogic/pi-mono/pull/206) by [@kim0](https://github.com/kim0))

## [0.23.1] - 2025-12-17

### Fixed

- Fixed TUI performance regression caused by Box component lacking render caching. Built-in tools now use Text directly (like v0.22.5), and Box has proper caching for custom tool rendering.

- Fixed custom tools failing to load from `~/.pi/agent/tools/` when pi is installed globally. Module imports (`@sinclair/typebox`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`) are now resolved via aliases.

## [0.23.0] - 2025-12-17

### Added

- **Custom tools**: Extend pi with custom tools written in TypeScript. Tools can provide custom TUI rendering, interact with users via `pi.ui` (select, confirm, input, notify), and maintain state across sessions via `onSession` callback. See [docs/custom-tools.md](docs/custom-tools.md) and [examples/custom-tools/](examples/custom-tools/). ([#190](https://github.com/badlogic/pi-mono/issues/190))

- **Hook and tool examples**: Added `examples/hooks/` and `examples/custom-tools/` with working examples. Examples are now bundled in npm and binary releases.

### Breaking Changes

- **Hooks**: Replaced `session_start` and `session_switch` events with unified `session` event. Use `event.reason` (`"start" | "switch" | "clear"`) to distinguish. Event now includes `entries` array for state reconstruction.

## [0.22.5] - 2025-12-17

### Fixed

- Fixed `--session` flag not saving sessions in print mode (`-p`). The session manager was never receiving events because no subscriber was attached.

## [0.22.4] - 2025-12-17

### Added

- `--list-models [search]` CLI flag to list available models with optional fuzzy search. Shows provider, model ID, context window, max output, thinking support, and image support. Only lists models with configured API keys. ([#203](https://github.com/badlogic/pi-mono/issues/203))

### Fixed

- Fixed tool execution showing green (success) background while still running. Now correctly shows gray (pending) background until the tool completes.

## [0.22.3] - 2025-12-16

### Added

- **Streaming bash output**: Bash tool now streams output in real-time during execution. The TUI displays live progress with the last 5 lines visible (expandable with ctrl+o). ([#44](https://github.com/badlogic/pi-mono/issues/44))

### Changed

- **Tool output display**: When collapsed, tool output now shows the last N lines instead of the first N lines, making streaming output more useful.

- Updated `@mariozechner/pi-ai` with X-Initiator header support for GitHub Copilot, ensuring agent calls are not deducted from quota. ([#200](https://github.com/badlogic/pi-mono/pull/200) by [@kim0](https://github.com/kim0))

### Fixed

- Fixed editor text being cleared during compaction. Text typed while compaction is running is now preserved. ([#179](https://github.com/badlogic/pi-mono/issues/179))
- Improved RGB to 256-color mapping for terminals without truecolor support. Now correctly uses grayscale ramp for neutral colors and preserves semantic tints (green for success, red for error, blue for pending) instead of mapping everything to wrong cube colors.
- `/think off` now actually disables thinking for all providers. Previously, providers like Gemini with "dynamic thinking" enabled by default would still use thinking even when turned off. ([#180](https://github.com/badlogic/pi-mono/pull/180) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.22.2] - 2025-12-15

### Changed

- Updated `@mariozechner/pi-ai` with interleaved thinking enabled by default for Anthropic Claude 4 models.

## [0.22.1] - 2025-12-15

_Dedicated to Peter's shoulder ([@steipete](https://twitter.com/steipete))_

### Changed

- Updated `@mariozechner/pi-ai` with interleaved thinking support for Anthropic models.

## [0.22.0] - 2025-12-15

### Added

- **GitHub Copilot support**: Use GitHub Copilot models via OAuth login (`/login` -> "GitHub Copilot"). Supports both github.com and GitHub Enterprise. Models are sourced from models.dev and include Claude, GPT, Gemini, Grok, and more. All models are automatically enabled after login. ([#191](https://github.com/badlogic/pi-mono/pull/191) by [@cau1k](https://github.com/cau1k))

### Fixed

- Model selector fuzzy search now matches against provider name (not just model ID) and supports space-separated tokens where all tokens must match

## [0.21.0] - 2025-12-14

### Added

- **Inline image rendering**: Terminals supporting Kitty graphics protocol (Kitty, Ghostty, WezTerm) or iTerm2 inline images now render images inline in tool output. Aspect ratio is preserved by querying terminal cell dimensions on startup. Toggle with `/show-images` command or `terminal.showImages` setting. Falls back to text placeholder on unsupported terminals or when disabled. ([#177](https://github.com/badlogic/pi-mono/pull/177) by [@nicobailon](https://github.com/nicobailon))

- **Gemini 3 Pro thinking levels**: Thinking level selector now works with Gemini 3 Pro models. Minimal/low map to Google's LOW, medium/high map to Google's HIGH. ([#176](https://github.com/badlogic/pi-mono/pull/176) by [@markusylisiurunen](https://github.com/markusylisiurunen))

### Fixed

- Fixed read tool failing on macOS screenshot filenames due to Unicode Narrow No-Break Space (U+202F) in timestamp. Added fallback to try macOS variant paths and consolidated duplicate expandPath functions into shared path-utils.ts. ([#181](https://github.com/badlogic/pi-mono/pull/181) by [@nicobailon](https://github.com/nicobailon))

- Fixed double blank lines rendering after markdown code blocks ([#173](https://github.com/badlogic/pi-mono/pull/173) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.20.1] - 2025-12-13

### Added

- **Exported skills API**: `loadSkillsFromDir`, `formatSkillsForPrompt`, and related types are now exported for use by other packages (e.g., mom).

## [0.20.0] - 2025-12-13

### Breaking Changes

- **Pi skills now use `SKILL.md` convention**: Pi skills must now be named `SKILL.md` inside a directory, matching Codex CLI format. Previously any `*.md` file was treated as a skill. Migrate by renaming `~/.pi/agent/skills/foo.md` to `~/.pi/agent/skills/foo/SKILL.md`.

### Added

- Display loaded skills on startup in interactive mode

## [0.19.1] - 2025-12-12

### Fixed

- Documentation: Added skills system documentation to README (setup, usage, CLI flags, settings)

## [0.19.0] - 2025-12-12

### Added

- **Skills system**: Auto-discover and load instruction files on-demand. Supports Claude Code (`~/.claude/skills/*/SKILL.md`), Codex CLI (`~/.codex/skills/`), and Pi-native formats (`~/.pi/agent/skills/`, `.pi/skills/`). Skills are listed in system prompt with descriptions, agent loads them via read tool when needed. Supports `{baseDir}` placeholder. Disable with `--no-skills` or `skills.enabled: false` in settings. ([#169](https://github.com/badlogic/pi-mono/issues/169))

- **Version flag**: Added `--version` / `-v` flag to display the current version and exit. ([#170](https://github.com/badlogic/pi-mono/pull/170))

## [0.18.2] - 2025-12-11

### Added

- **Auto-retry on transient errors**: Automatically retries requests when providers return overloaded, rate limit, or server errors (429, 500, 502, 503, 504). Uses exponential backoff (2s, 4s, 8s). Shows retry status in TUI with option to cancel via Escape. Configurable in `settings.json` via `retry.enabled`, `retry.maxRetries`, `retry.baseDelayMs`. RPC mode emits `auto_retry_start` and `auto_retry_end` events. ([#157](https://github.com/badlogic/pi-mono/issues/157))

- **HTML export line numbers**: Read tool calls in HTML exports now display line number ranges (e.g., `file.txt:10-20`) when offset/limit parameters are used, matching the TUI display format. Line numbers appear in yellow color for better visibility. ([#166](https://github.com/badlogic/pi-mono/issues/166))

### Fixed

- **Branch selector now works with single message**: Previously the branch selector would not open when there was only one user message. Now it correctly allows branching from any message, including the first one. This is needed for checkpoint hooks to restore state from before the first message. ([#163](https://github.com/badlogic/pi-mono/issues/163))

- **In-memory branching for `--no-session` mode**: Branching now works correctly in `--no-session` mode without creating any session files. The conversation is truncated in memory.

- **Git branch indicator now works in subdirectories**: The footer's git branch detection now walks up the directory hierarchy to find the git root, so it works when running pi from a subdirectory of a repository. ([#156](https://github.com/badlogic/pi-mono/issues/156))

## [0.18.1] - 2025-12-10

### Added

- **Mistral provider**: Added support for Mistral AI models. Set `MISTRAL_API_KEY` environment variable to use.

### Fixed

- Fixed print mode (`-p`) not exiting after output when custom themes are present (theme watcher now properly stops in print mode) ([#161](https://github.com/badlogic/pi-mono/issues/161))

## [0.18.0] - 2025-12-10

### Added

- **Hooks system**: TypeScript modules that extend agent behavior by subscribing to lifecycle events. Hooks can intercept tool calls, prompt for confirmation, modify results, and inject messages from external sources. Auto-discovered from `~/.pi/agent/hooks/*.ts` and `.pi/hooks/*.ts`. Thanks to [@nicobailon](https://github.com/nicobailon) for the collaboration on the design and implementation. ([#145](https://github.com/badlogic/pi-mono/issues/145), supersedes [#158](https://github.com/badlogic/pi-mono/pull/158))

- **`pi.send()` API**: Hooks can inject messages into the agent session from external sources (file watchers, webhooks, CI systems). If streaming, messages are queued; otherwise a new agent loop starts immediately.

- **`--hook <path>` CLI flag**: Load hook files directly for testing without modifying settings.

- **Hook events**: `session_start`, `session_switch`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `tool_call` (can block), `tool_result` (can modify), `branch`.

- **Hook UI primitives**: `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.notify()` for interactive prompts from hooks.

- **Hooks documentation**: Full API reference at `docs/hooks.md`, shipped with npm package.

## [0.17.0] - 2025-12-09

### Changed

- **Simplified compaction flow**: Removed proactive compaction (aborting mid-turn when threshold approached). Compaction now triggers in two cases only: (1) overflow error from LLM, which compacts and auto-retries, or (2) threshold crossed after a successful turn, which compacts without retry.

- **Compaction retry uses `Agent.continue()`**: Auto-retry after overflow now uses the new `continue()` API instead of re-sending the user message, preserving exact context state.

- **Merged turn prefix summary**: When a turn is split during compaction, the turn prefix summary is now merged into the main history summary instead of being stored separately.

### Added

- **`isCompacting` property on AgentSession**: Check if auto-compaction is currently running.

- **Session compaction indicator**: When resuming a compacted session, displays "Session compacted N times" status message.

### Fixed

- **Block input during compaction**: User input is now blocked while auto-compaction is running to prevent race conditions.

- **Skip error messages in usage calculation**: Context size estimation now skips both aborted and error messages, as neither have valid usage data.

## [0.16.0] - 2025-12-09

### Breaking Changes

- **New RPC protocol**: The RPC mode (`--mode rpc`) has been completely redesigned with a new JSON protocol. The old protocol is no longer supported. See [`docs/rpc.md`](docs/rpc.md) for the new protocol documentation and [`test/rpc-example.ts`](test/rpc-example.ts) for a working example. Includes `RpcClient` TypeScript class for easy integration. ([#91](https://github.com/badlogic/pi-mono/issues/91))

### Changed

- **README restructured**: Reorganized documentation from 30+ flat sections into 10 logical groups. Converted verbose subsections to scannable tables. Consolidated philosophy sections. Reduced size by ~60% while preserving all information.

## [0.15.0] - 2025-12-09

### Changed

- **Major code refactoring**: Restructured codebase for better maintainability and separation of concerns. Moved files into organized directories (`core/`, `modes/`, `utils/`, `cli/`). Extracted `AgentSession` class as central session management abstraction. Split `main.ts` and `tui-renderer.ts` into focused modules. See `DEVELOPMENT.md` for the new code map. ([#153](https://github.com/badlogic/pi-mono/issues/153))

## [0.14.2] - 2025-12-08

### Added

- `/debug` command now includes agent messages as JSONL in the output

### Fixed

- Fix crash when bash command outputs binary data (e.g., `curl` downloading a video file)

## [0.14.1] - 2025-12-08

### Fixed

- Fix build errors with tsgo 7.0.0-dev.20251208.1 by properly importing `ReasoningEffort` type

## [0.14.0] - 2025-12-08

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
