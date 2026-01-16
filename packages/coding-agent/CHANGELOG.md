# Changelog

## [Unreleased]

### Added

- Added bash-style argument slicing for prompt templates ([#770](https://github.com/badlogic/pi-mono/pull/770) by [@airtonix](https://github.com/airtonix))
- Extension commands can provide argument auto-completions via `getArgumentCompletions` in `pi.registerCommand()` ([#775](https://github.com/badlogic/pi-mono/pull/775) by [@ribelo](https://github.com/ribelo))

### Fixed

- Fixed extension messages rendering twice on startup when `pi.sendMessage({ display: true })` is called during `session_start` ([#765](https://github.com/badlogic/pi-mono/pull/765) by [@dannote](https://github.com/dannote))

## [0.47.0] - 2026-01-16

### Breaking Changes

- Extensions using `Editor` directly must now pass `TUI` as the first constructor argument: `new Editor(tui, theme)`. The `tui` parameter is available in extension factory functions. ([#732](https://github.com/badlogic/pi-mono/issues/732))

### Added

- **OpenAI Codex official support**: Full compatibility with OpenAI's Codex CLI models (`gpt-5.1`, `gpt-5.2`, `gpt-5.1-codex-mini`, `gpt-5.2-codex`). Features include static system prompt for OpenAI allowlisting, prompt caching via session ID, and reasoning signature retention across turns. Set `OPENAI_API_KEY` and use `--provider openai-codex` or select a Codex model. ([#737](https://github.com/badlogic/pi-mono/pull/737))
- `pi-internal://` URL scheme in read tool for accessing internal documentation. The model can read files from the coding-agent package (README, docs, examples) to learn about extending pi.
- New `input` event in extension system for intercepting, transforming, or handling user input before the agent processes it. Supports three result types: `continue` (pass through), `transform` (modify text/images), `handled` (respond without LLM). Handlers chain transforms and short-circuit on handled. ([#761](https://github.com/badlogic/pi-mono/pull/761) by [@nicobailon](https://github.com/nicobailon))
- Extension example: `input-transform.ts` demonstrating input interception patterns (quick mode, instant commands, source routing) ([#761](https://github.com/badlogic/pi-mono/pull/761) by [@nicobailon](https://github.com/nicobailon))
- Custom tool HTML export: extensions with `renderCall`/`renderResult` now render in `/share` and `/export` output with ANSI-to-HTML color conversion ([#702](https://github.com/badlogic/pi-mono/pull/702) by [@aliou](https://github.com/aliou))
- Direct filter shortcuts in Tree mode: Ctrl+D (default), Ctrl+T (no-tools), Ctrl+U (user-only), Ctrl+L (labeled-only), Ctrl+A (all) ([#747](https://github.com/badlogic/pi-mono/pull/747) by [@kaofelix](https://github.com/kaofelix))

### Changed

- Skill commands (`/skill:name`) are now expanded in AgentSession instead of interactive mode. This enables skill commands in RPC and print modes, and allows the `input` event to intercept `/skill:name` before expansion.

### Fixed

- Editor no longer corrupts terminal display when loading large prompts via `setEditorText`. Content now scrolls vertically with indicators showing lines above/below the viewport. ([#732](https://github.com/badlogic/pi-mono/issues/732))
- Piped stdin now works correctly: `echo foo | pi` is equivalent to `pi -p foo`. When stdin is piped, print mode is automatically enabled since interactive mode requires a TTY ([#708](https://github.com/badlogic/pi-mono/issues/708))
- Session tree now preserves branch connectors and indentation when filters hide intermediate entries so descendants attach to the nearest visible ancestor and sibling branches align. Fixed in both TUI and HTML export ([#739](https://github.com/badlogic/pi-mono/pull/739) by [@w-winter](https://github.com/w-winter))
- Added `upstream connect`, `connection refused`, and `reset before headers` patterns to auto-retry error detection ([#733](https://github.com/badlogic/pi-mono/issues/733))
- Multi-line YAML frontmatter in skills and prompt templates now parses correctly. Centralized frontmatter parsing using the `yaml` library. ([#728](https://github.com/badlogic/pi-mono/pull/728) by [@richardgill](https://github.com/richardgill))
- `ctx.shutdown()` now waits for pending UI renders to complete before exiting, ensuring notifications and final output are visible ([#756](https://github.com/badlogic/pi-mono/issues/756))
- OpenAI Codex provider now retries on transient errors (429, 5xx, connection failures) with exponential backoff ([#733](https://github.com/badlogic/pi-mono/issues/733))

## [0.46.0] - 2026-01-15

### Fixed

- Scoped models (`--models` or `enabledModels`) now remember the last selected model across sessions instead of always starting with the first model in the scope ([#736](https://github.com/badlogic/pi-mono/pull/736) by [@ogulcancelik](https://github.com/ogulcancelik))
- Show `bun install` instead of `npm install` in update notification when running under Bun ([#714](https://github.com/badlogic/pi-mono/pull/714) by [@dannote](https://github.com/dannote))
- `/skill` prompts now include the skill path ([#711](https://github.com/badlogic/pi-mono/pull/711) by [@jblwilliams](https://github.com/jblwilliams))
- Use configurable `expandTools` keybinding instead of hardcoded Ctrl+O ([#717](https://github.com/badlogic/pi-mono/pull/717) by [@dannote](https://github.com/dannote))
- Compaction turn prefix summaries now merge correctly ([#738](https://github.com/badlogic/pi-mono/pull/738) by [@vsabavat](https://github.com/vsabavat))
- Avoid unsigned Gemini 3 tool calls ([#741](https://github.com/badlogic/pi-mono/pull/741) by [@roshanasingh4](https://github.com/roshanasingh4))
- Fixed signature support for non-Anthropic models in Amazon Bedrock provider ([#727](https://github.com/badlogic/pi-mono/pull/727) by [@unexge](https://github.com/unexge))
- Keyboard shortcuts (Ctrl+C, Ctrl+D, etc.) now work on non-Latin keyboard layouts (Russian, Ukrainian, Bulgarian, etc.) in terminals supporting Kitty keyboard protocol with alternate key reporting ([#718](https://github.com/badlogic/pi-mono/pull/718) by [@dannote](https://github.com/dannote))

### Added

- Edit tool now uses fuzzy matching as fallback when exact match fails, tolerating trailing whitespace, smart quotes, Unicode dashes, and special spaces ([#713](https://github.com/badlogic/pi-mono/pull/713) by [@dannote](https://github.com/dannote))
- Support `APPEND_SYSTEM.md` to append instructions to the system prompt ([#716](https://github.com/badlogic/pi-mono/pull/716) by [@tallshort](https://github.com/tallshort))
- Session picker search: Ctrl+R toggles sorting between fuzzy match (default) and most recent; supports quoted phrase matching and `re:` regex mode ([#731](https://github.com/badlogic/pi-mono/pull/731) by [@ogulcancelik](https://github.com/ogulcancelik))
- Export `getAgentDir` for extensions ([#749](https://github.com/badlogic/pi-mono/pull/749) by [@dannote](https://github.com/dannote))
- Show loaded prompt templates on startup ([#743](https://github.com/badlogic/pi-mono/pull/743) by [@tallshort](https://github.com/tallshort))
- MiniMax China (`minimax-cn`) provider support ([#725](https://github.com/badlogic/pi-mono/pull/725) by [@tallshort](https://github.com/tallshort))
- `gpt-5.2-codex` models for GitHub Copilot and OpenCode Zen providers ([#734](https://github.com/badlogic/pi-mono/pull/734) by [@aadishv](https://github.com/aadishv))

### Changed

- Replaced `wasm-vips` with `@silvia-odwyer/photon-node` for image processing ([#710](https://github.com/badlogic/pi-mono/pull/710) by [@can1357](https://github.com/can1357))
- Extension example: `plan-mode/` shortcut changed from Shift+P to Ctrl+Alt+P to avoid conflict with typing capital P ([#746](https://github.com/badlogic/pi-mono/pull/746) by [@ferologics](https://github.com/ferologics))
- UI keybinding hints now respect configured keybindings across components ([#724](https://github.com/badlogic/pi-mono/pull/724) by [@dannote](https://github.com/dannote))
- CLI process title is now set to `pi` for easier process identification ([#742](https://github.com/badlogic/pi-mono/pull/742) by [@richardgill](https://github.com/richardgill))

## [0.45.7] - 2026-01-13

### Added

- Exported `highlightCode` and `getLanguageFromPath` for extensions ([#703](https://github.com/badlogic/pi-mono/pull/703) by [@dannote](https://github.com/dannote))

## [0.45.6] - 2026-01-13

### Added

- `ctx.ui.custom()` now accepts `overlayOptions` for overlay positioning and sizing (anchor, margins, offsets, percentages, absolute positioning) ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- `ctx.ui.custom()` now accepts `onHandle` callback to receive the `OverlayHandle` for controlling overlay visibility ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- Extension example: `overlay-qa-tests.ts` with 10 commands for testing overlay positioning, animation, and toggle scenarios ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- Extension example: `doom-overlay/` - DOOM game running as an overlay at 35 FPS (auto-downloads WAD on first run) ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))

## [0.45.5] - 2026-01-13

### Fixed

- Skip changelog display on fresh install (only show on upgrades)

## [0.45.4] - 2026-01-13

### Changed

- Light theme colors adjusted for WCAG AA compliance (4.5:1 contrast ratio against white backgrounds)
- Replaced `sharp` with `wasm-vips` for image processing (resize, PNG conversion). Eliminates native build requirements that caused installation failures on some systems. ([#696](https://github.com/badlogic/pi-mono/issues/696))

### Added

- Extension example: `summarize.ts` for summarizing conversations using custom UI and an external model ([#684](https://github.com/badlogic/pi-mono/pull/684) by [@scutifer](https://github.com/scutifer))
- Extension example: `question.ts` enhanced with custom UI for asking user questions ([#693](https://github.com/badlogic/pi-mono/pull/693) by [@ferologics](https://github.com/ferologics))
- Extension example: `plan-mode/` enhanced with explicit step tracking and progress widget ([#694](https://github.com/badlogic/pi-mono/pull/694) by [@ferologics](https://github.com/ferologics))
- Extension example: `questionnaire.ts` for multi-question input with tab bar navigation ([#695](https://github.com/badlogic/pi-mono/pull/695) by [@ferologics](https://github.com/ferologics))
- Experimental Vercel AI Gateway provider support: set `AI_GATEWAY_API_KEY` and use `--provider vercel-ai-gateway`. Token usage is currently reported incorrectly by Anthropic Messages compatible endpoint. ([#689](https://github.com/badlogic/pi-mono/pull/689) by [@timolins](https://github.com/timolins))

### Fixed

- Fix API key resolution after model switches by using provider argument ([#691](https://github.com/badlogic/pi-mono/pull/691) by [@joshp123](https://github.com/joshp123))
- Fixed z.ai thinking/reasoning: thinking toggle now correctly enables/disables thinking for z.ai models ([#688](https://github.com/badlogic/pi-mono/issues/688))
- Fixed extension loading in compiled Bun binary: extensions with local file imports now work correctly. Updated `@mariozechner/jiti` to v2.6.5 which bundles babel for Bun binary compatibility. ([#681](https://github.com/badlogic/pi-mono/issues/681))
- Fixed theme loading when installed via mise: use wrapper directory in release tarballs for compatibility with mise's `strip_components=1` extraction. ([#681](https://github.com/badlogic/pi-mono/issues/681))

## [0.45.3] - 2026-01-13

## [0.45.2] - 2026-01-13

### Fixed

- Extensions now load correctly in compiled Bun binary using `@mariozechner/jiti` fork with `virtualModules` support. Bundled packages (`@sinclair/typebox`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`) are accessible to extensions without filesystem node_modules.

## [0.45.1] - 2026-01-13

### Changed

- `/share` now outputs `buildwithpi.ai` session preview URLs instead of `shittycodingagent.ai`

## [0.45.0] - 2026-01-13

### Added

- MiniMax provider support: set `MINIMAX_API_KEY` and use `minimax/MiniMax-M2.1` ([#656](https://github.com/badlogic/pi-mono/pull/656) by [@dannote](https://github.com/dannote))
- `/scoped-models`: Alt+Up/Down to reorder enabled models. Order is preserved when saving with Ctrl+S and determines Ctrl+P cycling order. ([#676](https://github.com/badlogic/pi-mono/pull/676) by [@thomasmhr](https://github.com/thomasmhr))
- Amazon Bedrock provider support (experimental, tested with Anthropic Claude models only) ([#494](https://github.com/badlogic/pi-mono/pull/494) by [@unexge](https://github.com/unexge))
- Extension example: `sandbox/` for OS-level bash sandboxing using `@anthropic-ai/sandbox-runtime` with per-project config ([#673](https://github.com/badlogic/pi-mono/pull/673) by [@dannote](https://github.com/dannote))
- Print mode JSON output now emits the session header as the first line.

## [0.44.0] - 2026-01-12

### Breaking Changes

- `pi.getAllTools()` now returns `ToolInfo[]` (with `name` and `description`) instead of `string[]`. Extensions that only need names can use `.map(t => t.name)`. ([#648](https://github.com/badlogic/pi-mono/pull/648) by [@carsonfarmer](https://github.com/carsonfarmer))

### Added

- Session naming: `/name <name>` command sets a display name shown in the session selector instead of the first message. Useful for distinguishing forked sessions. Extensions can use `pi.setSessionName()` and `pi.getSessionName()`. ([#650](https://github.com/badlogic/pi-mono/pull/650) by [@scutifer](https://github.com/scutifer))
- Extension example: `notify.ts` for desktop notifications via OSC 777 escape sequence ([#658](https://github.com/badlogic/pi-mono/pull/658) by [@ferologics](https://github.com/ferologics))
- Inline hint for queued messages showing the `Alt+Up` restore shortcut ([#657](https://github.com/badlogic/pi-mono/pull/657) by [@tmustier](https://github.com/tmustier))
- Page-up/down navigation in `/resume` session selector to jump by 5 items ([#662](https://github.com/badlogic/pi-mono/pull/662) by [@aliou](https://github.com/aliou))
- Fuzzy search in `/settings` menu: type to filter settings by label ([#643](https://github.com/badlogic/pi-mono/pull/643) by [@ninlds](https://github.com/ninlds))

### Fixed

- Session selector now stays open when current folder has no sessions, allowing Tab to switch to "all" scope ([#661](https://github.com/badlogic/pi-mono/pull/661) by [@aliou](https://github.com/aliou))
- Extensions using theme utilities like `getSettingsListTheme()` now work in dev mode with tsx

## [0.43.0] - 2026-01-11

### Breaking Changes

- Extension editor (`ctx.ui.editor()`) now uses Enter to submit and Shift+Enter for newlines, matching the main editor. Previously used Ctrl+Enter to submit. Extensions with hardcoded "ctrl+enter" hints need updating. ([#642](https://github.com/badlogic/pi-mono/pull/642) by [@mitsuhiko](https://github.com/mitsuhiko))
- Renamed `/branch` command to `/fork` ([#641](https://github.com/badlogic/pi-mono/issues/641))
  - RPC: `branch` → `fork`, `get_branch_messages` → `get_fork_messages`
  - SDK: `branch()` → `fork()`, `getBranchMessages()` → `getForkMessages()`
  - AgentSession: `branch()` → `fork()`, `getUserMessagesForBranching()` → `getUserMessagesForForking()`
  - Extension events: `session_before_branch` → `session_before_fork`, `session_branch` → `session_fork`
  - Settings: `doubleEscapeAction: "branch" | "tree"` → `"fork" | "tree"`
- `SessionManager.list()` and `SessionManager.listAll()` are now async, returning `Promise<SessionInfo[]>`. Callers must await them. ([#620](https://github.com/badlogic/pi-mono/pull/620) by [@tmustier](https://github.com/tmustier))

### Added
- `/resume` selector now toggles between current-folder and all sessions with Tab, showing the session cwd in the All view and loading progress. ([#620](https://github.com/badlogic/pi-mono/pull/620) by [@tmustier](https://github.com/tmustier))
- `SessionManager.list()` and `SessionManager.listAll()` accept optional `onProgress` callback for progress updates
- `SessionInfo.cwd` field containing the session's working directory (empty string for old sessions)
- `SessionListProgress` type export for progress callbacks
- `/scoped-models` command to enable/disable models for Ctrl+P cycling. Changes are session-only by default; press Ctrl+S to persist to settings.json. ([#626](https://github.com/badlogic/pi-mono/pull/626) by [@CarlosGtrz](https://github.com/CarlosGtrz))
- `model_select` extension hook fires when model changes via `/model`, model cycling, or session restore with `source` field and `previousModel` ([#628](https://github.com/badlogic/pi-mono/pull/628) by [@marckrenn](https://github.com/marckrenn))
- `ctx.ui.setWorkingMessage()` extension API to customize the "Working..." message during streaming ([#625](https://github.com/badlogic/pi-mono/pull/625) by [@nicobailon](https://github.com/nicobailon))
- Skill slash commands: loaded skills are registered as `/skill:name` commands for quick access. Toggle via `/settings` or `skills.enableSkillCommands` in settings.json. ([#630](https://github.com/badlogic/pi-mono/pull/630) by [@Dwsy](https://github.com/Dwsy))
- Slash command autocomplete now uses fuzzy matching (type `/skbra` to match `/skill:brave-search`)
- `/tree` branch summarization now offers three options: "No summary", "Summarize", and "Summarize with custom prompt". Custom prompts are appended as additional focus to the default summarization instructions. ([#642](https://github.com/badlogic/pi-mono/pull/642) by [@mitsuhiko](https://github.com/mitsuhiko))

### Fixed

- Missing spacer between assistant message and text editor ([#655](https://github.com/badlogic/pi-mono/issues/655))
- Session picker respects custom keybindings when using `--resume` ([#633](https://github.com/badlogic/pi-mono/pull/633) by [@aos](https://github.com/aos))
- Custom footer extensions now see model changes: `ctx.model` is now a getter that returns the current model instead of a snapshot from when the context was created ([#634](https://github.com/badlogic/pi-mono/pull/634) by [@ogulcancelik](https://github.com/ogulcancelik))
- Footer git branch not updating after external branch switches. Git uses atomic writes (temp file + rename), which changes the inode and breaks `fs.watch` on the file. Now watches the directory instead.
- Extension loading errors are now displayed to the user instead of being silently ignored ([#639](https://github.com/badlogic/pi-mono/pull/639) by [@aliou](https://github.com/aliou))

## [0.42.5] - 2026-01-11

### Fixed

- Reduced flicker by only re-rendering changed lines ([#617](https://github.com/badlogic/pi-mono/pull/617) by [@ogulcancelik](https://github.com/ogulcancelik)). No worries tho, there's still a little flicker in the VS Code Terminal. Praise the flicker.
- Cursor position tracking when content shrinks with unchanged remaining lines
- TUI renders with wrong dimensions after suspend/resume if terminal was resized while suspended ([#599](https://github.com/badlogic/pi-mono/issues/599))
- Pasted content containing Kitty key release patterns (e.g., `:3F` in MAC addresses) was incorrectly filtered out ([#623](https://github.com/badlogic/pi-mono/pull/623) by [@ogulcancelik](https://github.com/ogulcancelik))

## [0.42.4] - 2026-01-10

### Fixed

- Bash output expanded hint now says "(ctrl+o to collapse)" ([#610](https://github.com/badlogic/pi-mono/pull/610) by [@tallshort](https://github.com/tallshort))
- Fixed UTF-8 text corruption in remote bash execution (SSH, containers) by using streaming TextDecoder ([#608](https://github.com/badlogic/pi-mono/issues/608))

## [0.42.3] - 2026-01-10

### Changed

- OpenAI Codex: updated to use bundled system prompt from upstream

## [0.42.2] - 2026-01-10

### Added

- `/model <search>` now pre-filters the model selector or auto-selects on exact match. Use `provider/model` syntax to disambiguate (e.g., `/model openai/gpt-4`). ([#587](https://github.com/badlogic/pi-mono/pull/587) by [@zedrdave](https://github.com/zedrdave))
- `FooterDataProvider` for custom footers: `ctx.ui.setFooter()` now receives a third `footerData` parameter providing `getGitBranch()`, `getExtensionStatuses()`, and `onBranchChange()` for reactive updates ([#600](https://github.com/badlogic/pi-mono/pull/600) by [@nicobailon](https://github.com/nicobailon))
- `Alt+Up` hotkey to restore queued steering/follow-up messages back into the editor without aborting the current run ([#604](https://github.com/badlogic/pi-mono/pull/604) by [@tmustier](https://github.com/tmustier))

### Fixed

- Fixed LM Studio compatibility for OpenAI Responses tool strict mapping in the ai provider ([#598](https://github.com/badlogic/pi-mono/pull/598) by [@gnattu](https://github.com/gnattu))

## [0.42.1] - 2026-01-09

### Fixed

- Symlinked directories in `prompts/` folders are now followed when loading prompt templates ([#601](https://github.com/badlogic/pi-mono/pull/601) by [@aliou](https://github.com/aliou))

## [0.42.0] - 2026-01-09

### Added

- Added OpenCode Zen provider support. Set `OPENCODE_API_KEY` env var and use `opencode/<model-id>` (e.g., `opencode/claude-opus-4-5`).

## [0.41.0] - 2026-01-09

### Added

- Anthropic OAuth support is back! Use `/login` to authenticate with your Claude Pro/Max subscription.

## [0.40.1] - 2026-01-09

### Removed

- Anthropic OAuth support (`/login`). Use API keys instead.

## [0.40.0] - 2026-01-08

### Added

- Documentation on component invalidation and theme changes in `docs/tui.md`

### Fixed

- Components now properly rebuild their content on theme change (tool executions, assistant messages, bash executions, custom messages, branch/compaction summaries)

## [0.39.1] - 2026-01-08

### Fixed

- `setTheme()` now triggers a full rerender so previously rendered components update with the new theme colors
- `mac-system-theme.ts` example now polls every 2 seconds and uses `osascript` for real-time macOS appearance detection

## [0.39.0] - 2026-01-08

### Breaking Changes

- `before_agent_start` event now receives `systemPrompt` in the event object and returns `systemPrompt` (full replacement) instead of `systemPromptAppend`. Extensions that were appending must now use `event.systemPrompt + extra` pattern. ([#575](https://github.com/badlogic/pi-mono/issues/575))
- `discoverSkills()` now returns `{ skills: Skill[], warnings: SkillWarning[] }` instead of `Skill[]`. This allows callers to handle skill loading warnings. ([#577](https://github.com/badlogic/pi-mono/pull/577) by [@cv](https://github.com/cv))

### Added

- `ctx.ui.getAllThemes()`, `ctx.ui.getTheme(name)`, and `ctx.ui.setTheme(name | Theme)` methods for extensions to list, load, and switch themes at runtime ([#576](https://github.com/badlogic/pi-mono/pull/576))
- `--no-tools` flag to disable all built-in tools, allowing extension-only tool setups ([#557](https://github.com/badlogic/pi-mono/pull/557) by [@cv](https://github.com/cv))
- Pluggable operations for built-in tools enabling remote execution via SSH or other transports ([#564](https://github.com/badlogic/pi-mono/issues/564)). Interfaces: `ReadOperations`, `WriteOperations`, `EditOperations`, `BashOperations`, `LsOperations`, `GrepOperations`, `FindOperations`
- `user_bash` event for intercepting user `!`/`!!` commands, allowing extensions to redirect to remote systems ([#528](https://github.com/badlogic/pi-mono/issues/528))
- `setActiveTools()` in ExtensionAPI for dynamic tool management
- Built-in renderers used automatically for tool overrides without custom `renderCall`/`renderResult`
- `ssh.ts` example: remote tool execution via `--ssh user@host:/path`
- `interactive-shell.ts` example: run interactive commands (vim, git rebase, htop) with full terminal access via `!i` prefix or auto-detection
- Wayland clipboard support for `/copy` command using wl-copy with xclip/xsel fallback ([#570](https://github.com/badlogic/pi-mono/pull/570) by [@OgulcanCelik](https://github.com/OgulcanCelik))
- **Experimental:** `ctx.ui.custom()` now accepts `{ overlay: true }` option for floating modal components that composite over existing content without clearing the screen ([#558](https://github.com/badlogic/pi-mono/pull/558) by [@nicobailon](https://github.com/nicobailon))
- `AgentSession.skills` and `AgentSession.skillWarnings` properties to access loaded skills without rediscovery ([#577](https://github.com/badlogic/pi-mono/pull/577) by [@cv](https://github.com/cv))

### Fixed

- String `systemPrompt` in `createAgentSession()` now works as a full replacement instead of having context files and skills appended, matching documented behavior ([#543](https://github.com/badlogic/pi-mono/issues/543))
- Update notification for bun binary installs now shows release download URL instead of npm command ([#567](https://github.com/badlogic/pi-mono/pull/567) by [@ferologics](https://github.com/ferologics))
- ESC key now works during "Working..." state after auto-retry ([#568](https://github.com/badlogic/pi-mono/pull/568) by [@tmustier](https://github.com/tmustier))
- Abort messages now show correct retry attempt count (e.g., "Aborted after 2 retry attempts") ([#568](https://github.com/badlogic/pi-mono/pull/568) by [@tmustier](https://github.com/tmustier))
- Fixed Antigravity provider returning 429 errors despite available quota ([#571](https://github.com/badlogic/pi-mono/pull/571) by [@ben-vargas](https://github.com/ben-vargas))
- Fixed malformed thinking text in Gemini/Antigravity responses where thinking content appeared as regular text or vice versa. Cross-model conversations now properly convert thinking blocks to plain text. ([#561](https://github.com/badlogic/pi-mono/issues/561))
- `--no-skills` flag now correctly prevents skills from loading in interactive mode ([#577](https://github.com/badlogic/pi-mono/pull/577) by [@cv](https://github.com/cv))

## [0.38.0] - 2026-01-08

### Breaking Changes

- `ctx.ui.custom()` factory signature changed from `(tui, theme, done)` to `(tui, theme, keybindings, done)` for keybinding access in custom components
- `LoadedExtension` type renamed to `Extension`
- `LoadExtensionsResult.setUIContext()` removed, replaced with `runtime: ExtensionRuntime`
- `ExtensionRunner` constructor now requires `runtime: ExtensionRuntime` as second parameter
- `ExtensionRunner.initialize()` signature changed from options object to positional params `(actions, contextActions, commandContextActions?, uiContext?)`
- `ExtensionRunner.getHasUI()` renamed to `hasUI()`
- OpenAI Codex model aliases removed (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `codex-mini-latest`). Use canonical IDs: `gpt-5.1`, `gpt-5.1-codex-mini`, `gpt-5.2`, `gpt-5.2-codex`. ([#536](https://github.com/badlogic/pi-mono/pull/536) by [@ghoulr](https://github.com/ghoulr))

### Added

- `--no-extensions` flag to disable extension discovery while still allowing explicit `-e` paths ([#524](https://github.com/badlogic/pi-mono/pull/524) by [@cv](https://github.com/cv))
- SDK: `InteractiveMode`, `runPrintMode()`, `runRpcMode()` exported for building custom run modes. See `docs/sdk.md`.
- `PI_SKIP_VERSION_CHECK` environment variable to disable new version notifications at startup ([#549](https://github.com/badlogic/pi-mono/pull/549) by [@aos](https://github.com/aos))
- `thinkingBudgets` setting to customize token budgets per thinking level for token-based providers ([#529](https://github.com/badlogic/pi-mono/pull/529) by [@melihmucuk](https://github.com/melihmucuk))
- Extension UI dialogs (`ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`) now support a `timeout` option with live countdown display ([#522](https://github.com/badlogic/pi-mono/pull/522) by [@nicobailon](https://github.com/nicobailon))
- Extensions can now provide custom editor components via `ctx.ui.setEditorComponent()`. See `examples/extensions/modal-editor.ts` and `docs/tui.md` Pattern 7.
- Extension factories can now be async, enabling dynamic imports and lazy-loaded dependencies ([#513](https://github.com/badlogic/pi-mono/pull/513) by [@austinm911](https://github.com/austinm911))
- `ctx.shutdown()` is now available in extension contexts for requesting a graceful shutdown. In interactive mode, shutdown is deferred until the agent becomes idle (after processing all queued steering and follow-up messages). In RPC mode, shutdown is deferred until after completing the current command response. In print mode, shutdown is a no-op as the process exits automatically when prompts complete. ([#542](https://github.com/badlogic/pi-mono/pull/542) by [@kaofelix](https://github.com/kaofelix))

### Fixed

- Default thinking level from settings now applies correctly when `enabledModels` is configured ([#540](https://github.com/badlogic/pi-mono/pull/540) by [@ferologics](https://github.com/ferologics))
- External edits to `settings.json` while pi is running are now preserved when pi saves settings ([#527](https://github.com/badlogic/pi-mono/pull/527) by [@ferologics](https://github.com/ferologics))
- Overflow-based compaction now skips if error came from a different model or was already handled by a previous compaction ([#535](https://github.com/badlogic/pi-mono/pull/535) by [@mitsuhiko](https://github.com/mitsuhiko))
- OpenAI Codex context window reduced from 400k to 272k tokens to match Codex CLI defaults and prevent 400 errors ([#536](https://github.com/badlogic/pi-mono/pull/536) by [@ghoulr](https://github.com/ghoulr))
- Context overflow detection now recognizes `context_length_exceeded` errors.
- Key presses no longer dropped when input is batched over SSH ([#538](https://github.com/badlogic/pi-mono/issues/538))
- Clipboard image support now works on Alpine Linux and other musl-based distros ([#533](https://github.com/badlogic/pi-mono/issues/533))

## [0.37.8] - 2026-01-07

## [0.37.7] - 2026-01-07

## [0.37.6] - 2026-01-06

### Added

- Extension UI dialogs (`ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`) now accept an optional `AbortSignal` to programmatically dismiss dialogs. Useful for implementing timeouts. See `examples/extensions/timed-confirm.ts`. ([#474](https://github.com/badlogic/pi-mono/issues/474))
- HTML export now shows bridge prompts in model change messages for Codex sessions ([#510](https://github.com/badlogic/pi-mono/pull/510) by [@mitsuhiko](https://github.com/mitsuhiko))

## [0.37.5] - 2026-01-06

### Added

- ExtensionAPI: `setModel()`, `getThinkingLevel()`, `setThinkingLevel()` methods for extensions to change model and thinking level at runtime ([#509](https://github.com/badlogic/pi-mono/issues/509))
- Exported truncation utilities for custom tools: `truncateHead`, `truncateTail`, `truncateLine`, `formatSize`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`, `TruncationOptions`, `TruncationResult`
- New example `truncated-tool.ts` demonstrating proper output truncation with custom rendering for extensions
- New example `preset.ts` demonstrating preset configurations with model/thinking/tools switching ([#347](https://github.com/badlogic/pi-mono/issues/347))
- Documentation for output truncation best practices in `docs/extensions.md`
- Exported all UI components for extensions: `ArminComponent`, `AssistantMessageComponent`, `BashExecutionComponent`, `BorderedLoader`, `BranchSummaryMessageComponent`, `CompactionSummaryMessageComponent`, `CustomEditor`, `CustomMessageComponent`, `DynamicBorder`, `ExtensionEditorComponent`, `ExtensionInputComponent`, `ExtensionSelectorComponent`, `FooterComponent`, `LoginDialogComponent`, `ModelSelectorComponent`, `OAuthSelectorComponent`, `SessionSelectorComponent`, `SettingsSelectorComponent`, `ShowImagesSelectorComponent`, `ThemeSelectorComponent`, `ThinkingSelectorComponent`, `ToolExecutionComponent`, `TreeSelectorComponent`, `UserMessageComponent`, `UserMessageSelectorComponent`, plus utilities `renderDiff`, `truncateToVisualLines`
- `docs/tui.md`: Common Patterns section with copy-paste code for SelectList, BorderedLoader, SettingsList, setStatus, setWidget, setFooter
- `docs/tui.md`: Key Rules section documenting critical patterns for extension UI development
- `docs/extensions.md`: Exhaustive example links for all ExtensionAPI methods and events
- System prompt now references `docs/tui.md` for TUI component development

## [0.37.4] - 2026-01-06

### Added

- Session picker (`pi -r`) and `--session` flag now support searching/resuming by session ID (UUID prefix) ([#495](https://github.com/badlogic/pi-mono/issues/495) by [@arunsathiya](https://github.com/arunsathiya))
- Extensions can now replace the startup header with `ctx.ui.setHeader()`, see `examples/extensions/custom-header.ts` ([#500](https://github.com/badlogic/pi-mono/pull/500) by [@tudoroancea](https://github.com/tudoroancea))

### Changed

- Startup help text: fixed misleading "ctrl+k to delete line" to "ctrl+k to delete to end"
- Startup help text and `/hotkeys`: added `!!` shortcut for running bash without adding output to context

### Fixed

- Queued steering/follow-up messages no longer wipe unsent editor input ([#503](https://github.com/badlogic/pi-mono/pull/503) by [@tmustier](https://github.com/tmustier))
- OAuth token refresh failure no longer crashes app at startup, allowing user to `/login` to re-authenticate ([#498](https://github.com/badlogic/pi-mono/issues/498))

## [0.37.3] - 2026-01-06

### Added

- Extensions can now replace the footer with `ctx.ui.setFooter()`, see `examples/extensions/custom-footer.ts` ([#481](https://github.com/badlogic/pi-mono/issues/481))
- Session ID is now forwarded to LLM providers for session-based caching (used by OpenAI Codex for prompt caching).
- Added `blockImages` setting to prevent images from being sent to LLM providers ([#492](https://github.com/badlogic/pi-mono/pull/492) by [@jsinge97](https://github.com/jsinge97))
- Extensions can now send user messages via `pi.sendUserMessage()` ([#483](https://github.com/badlogic/pi-mono/issues/483))

### Fixed

- Add `minimatch` as a direct dependency for explicit imports.
- Status bar now shows correct git branch when running in a git worktree ([#490](https://github.com/badlogic/pi-mono/pull/490) by [@kcosr](https://github.com/kcosr))
- Interactive mode: Ctrl+V clipboard image paste now works on Wayland sessions by using `wl-paste` with `xclip` fallback ([#488](https://github.com/badlogic/pi-mono/pull/488) by [@ghoulr](https://github.com/ghoulr))

## [0.37.2] - 2026-01-05

### Fixed

- Extension directories in `settings.json` now respect `package.json` manifests, matching global extension behavior ([#480](https://github.com/badlogic/pi-mono/pull/480) by [@prateekmedia](https://github.com/prateekmedia))
- Share viewer: deep links now scroll to the target message when opened via `/share`
- Bash tool now handles spawn errors gracefully instead of crashing the agent (missing cwd, invalid shell path) ([#479](https://github.com/badlogic/pi-mono/pull/479) by [@robinwander](https://github.com/robinwander))

## [0.37.1] - 2026-01-05

### Fixed

- Share viewer: copy-link buttons now generate correct URLs when session is viewed via `/share` (iframe context)

## [0.37.0] - 2026-01-05

### Added

- Share viewer: copy-link button on messages to share URLs that navigate directly to a specific message ([#477](https://github.com/badlogic/pi-mono/pull/477) by [@lockmeister](https://github.com/lockmeister))
- Extension example: add `claude-rules` to load `.claude/rules/` entries into the system prompt ([#461](https://github.com/badlogic/pi-mono/pull/461) by [@vaayne](https://github.com/vaayne))
- Headless OAuth login: all providers now show paste input for manual URL/code entry, works over SSH without DISPLAY ([#428](https://github.com/badlogic/pi-mono/pull/428) by [@ben-vargas](https://github.com/ben-vargas), [#468](https://github.com/badlogic/pi-mono/pull/468) by [@crcatala](https://github.com/crcatala))

### Changed

- OAuth login UI now uses dedicated dialog component with consistent borders
- Assume truecolor support for all terminals except `dumb`, empty, or `linux` (fixes colors over SSH)
- OpenAI Codex clean-up: removed per-thinking-level model variants, thinking level is now set separately and the provider clamps to what each model supports internally (initial implementation in [#472](https://github.com/badlogic/pi-mono/pull/472) by [@ben-vargas](https://github.com/ben-vargas))

### Fixed

- Messages submitted during compaction are queued and delivered after compaction completes, preserving steering and follow-up behavior. Extension commands execute immediately during compaction. ([#476](https://github.com/badlogic/pi-mono/pull/476) by [@tmustier](https://github.com/tmustier))
- Managed binaries (`fd`, `rg`) now stored in `~/.pi/agent/bin/` instead of `tools/`, eliminating false deprecation warnings ([#470](https://github.com/badlogic/pi-mono/pull/470) by [@mcinteerj](https://github.com/mcinteerj))
- Extensions defined in `settings.json` were not loaded ([#463](https://github.com/badlogic/pi-mono/pull/463) by [@melihmucuk](https://github.com/melihmucuk))
- OAuth refresh no longer logs users out when multiple pi instances are running ([#466](https://github.com/badlogic/pi-mono/pull/466) by [@Cursivez](https://github.com/Cursivez))
- Migration warnings now ignore `fd.exe` and `rg.exe` in `tools/` on Windows ([#458](https://github.com/badlogic/pi-mono/pull/458) by [@carlosgtrz](https://github.com/carlosgtrz))
- CI: add `examples/extensions/with-deps` to workspaces to fix typecheck ([#467](https://github.com/badlogic/pi-mono/pull/467) by [@aliou](https://github.com/aliou))
- SDK: passing `extensions: []` now disables extension discovery as documented ([#465](https://github.com/badlogic/pi-mono/pull/465) by [@aliou](https://github.com/aliou))

## [0.36.0] - 2026-01-05

### Added

- Experimental: OpenAI Codex OAuth provider support: access Codex models via ChatGPT Plus/Pro subscription using `/login openai-codex` ([#451](https://github.com/badlogic/pi-mono/pull/451) by [@kim0](https://github.com/kim0))

## [0.35.0] - 2026-01-05

This release unifies hooks and custom tools into a single "extensions" system and renames "slash commands" to "prompt templates". ([#454](https://github.com/badlogic/pi-mono/issues/454))

**Before migrating, read:**

- [docs/extensions.md](docs/extensions.md) - Full API reference
- [README.md](README.md) - Extensions section with examples
- [examples/extensions/](examples/extensions/) - Working examples

### Extensions Migration

Hooks and custom tools are now unified as **extensions**. Both were TypeScript modules exporting a factory function that receives an API object. Now there's one concept, one discovery location, one CLI flag, one settings.json entry.

**Automatic migration:**

- `commands/` directories are automatically renamed to `prompts/` on startup (both `~/.pi/agent/commands/` and `.pi/commands/`)

**Manual migration required:**

1. Move files from `hooks/` and `tools/` directories to `extensions/` (deprecation warnings shown on startup)
2. Update imports and type names in your extension code
3. Update `settings.json` if you have explicit hook and custom tool paths configured

**Directory changes:**

```
# Before
~/.pi/agent/hooks/*.ts       →  ~/.pi/agent/extensions/*.ts
~/.pi/agent/tools/*.ts       →  ~/.pi/agent/extensions/*.ts
.pi/hooks/*.ts               →  .pi/extensions/*.ts
.pi/tools/*.ts               →  .pi/extensions/*.ts
```

**Extension discovery rules** (in `extensions/` directories):

1. **Direct files:** `extensions/*.ts` or `*.js` → loaded directly
2. **Subdirectory with index:** `extensions/myext/index.ts` → loaded as single extension
3. **Subdirectory with package.json:** `extensions/myext/package.json` with `"pi"` field → loads declared paths

```json
// extensions/my-package/package.json
{
  "name": "my-extension-package",
  "dependencies": { "zod": "^3.0.0" },
  "pi": {
    "extensions": ["./src/main.ts", "./src/tools.ts"]
  }
}
```

No recursion beyond one level. Complex packages must use the `package.json` manifest. Dependencies are resolved via jiti, and extensions can be published to and installed from npm.

**Type renames:**

- `HookAPI` → `ExtensionAPI`
- `HookContext` → `ExtensionContext`
- `HookCommandContext` → `ExtensionCommandContext`
- `HookUIContext` → `ExtensionUIContext`
- `CustomToolAPI` → `ExtensionAPI` (merged)
- `CustomToolContext` → `ExtensionContext` (merged)
- `CustomToolUIContext` → `ExtensionUIContext`
- `CustomTool` → `ToolDefinition`
- `CustomToolFactory` → `ExtensionFactory`
- `HookMessage` → `CustomMessage`

**Import changes:**

```typescript
// Before (hook)
import type { HookAPI, HookContext } from "@mariozechner/pi-coding-agent";
export default function (pi: HookAPI) { ... }

// Before (custom tool)
import type { CustomToolFactory } from "@mariozechner/pi-coding-agent";
const factory: CustomToolFactory = (pi) => ({ name: "my_tool", ... });
export default factory;

// After (both are now extensions)
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => { ... });
  pi.registerTool({ name: "my_tool", ... });
}
```

**Custom tools now have full context access.** Tools registered via `pi.registerTool()` now receive the same `ctx` object that event handlers receive. Previously, custom tools had limited context. Now all extension code shares the same capabilities:

- `pi.registerTool()` - Register tools the LLM can call
- `pi.registerCommand()` - Register commands like `/mycommand`
- `pi.registerShortcut()` - Register keyboard shortcuts (shown in `/hotkeys`)
- `pi.registerFlag()` - Register CLI flags (shown in `--help`)
- `pi.registerMessageRenderer()` - Custom TUI rendering for message types
- `pi.on()` - Subscribe to lifecycle events (tool_call, session_start, etc.)
- `pi.sendMessage()` - Inject messages into the conversation
- `pi.appendEntry()` - Persist custom data in session (survives restart/branch)
- `pi.exec()` - Run shell commands
- `pi.getActiveTools()` / `pi.setActiveTools()` - Dynamic tool enable/disable
- `pi.getAllTools()` - List all available tools
- `pi.events` - Event bus for cross-extension communication
- `ctx.ui.confirm()` / `select()` / `input()` - User prompts
- `ctx.ui.notify()` - Toast notifications
- `ctx.ui.setStatus()` - Persistent status in footer (multiple extensions can set their own)
- `ctx.ui.setWidget()` - Widget display above editor
- `ctx.ui.setTitle()` - Set terminal window title
- `ctx.ui.custom()` - Full TUI component with keyboard handling
- `ctx.ui.editor()` - Multi-line text editor with external editor support
- `ctx.sessionManager` - Read session entries, get branch history

**Settings changes:**

```json
// Before
{
  "hooks": ["./my-hook.ts"],
  "customTools": ["./my-tool.ts"]
}

// After
{
  "extensions": ["./my-extension.ts"]
}
```

**CLI changes:**

```bash
# Before
pi --hook ./safety.ts --tool ./todo.ts

# After
pi --extension ./safety.ts -e ./todo.ts
```

### Prompt Templates Migration

"Slash commands" (markdown files defining reusable prompts invoked via `/name`) are renamed to "prompt templates" to avoid confusion with extension-registered commands.

**Automatic migration:** The `commands/` directory is automatically renamed to `prompts/` on startup (if `prompts/` doesn't exist). Works for both regular directories and symlinks.

**Directory changes:**

```
~/.pi/agent/commands/*.md    →  ~/.pi/agent/prompts/*.md
.pi/commands/*.md            →  .pi/prompts/*.md
```

**SDK type renames:**

- `FileSlashCommand` → `PromptTemplate`
- `LoadSlashCommandsOptions` → `LoadPromptTemplatesOptions`

**SDK function renames:**

- `discoverSlashCommands()` → `discoverPromptTemplates()`
- `loadSlashCommands()` → `loadPromptTemplates()`
- `expandSlashCommand()` → `expandPromptTemplate()`
- `getCommandsDir()` → `getPromptsDir()`

**SDK option renames:**

- `CreateAgentSessionOptions.slashCommands` → `.promptTemplates`
- `AgentSession.fileCommands` → `.promptTemplates`
- `PromptOptions.expandSlashCommands` → `.expandPromptTemplates`

### SDK Migration

**Discovery functions:**

- `discoverAndLoadHooks()` → `discoverAndLoadExtensions()`
- `discoverAndLoadCustomTools()` → merged into `discoverAndLoadExtensions()`
- `loadHooks()` → `loadExtensions()`
- `loadCustomTools()` → merged into `loadExtensions()`

**Runner and wrapper:**

- `HookRunner` → `ExtensionRunner`
- `wrapToolsWithHooks()` → `wrapToolsWithExtensions()`
- `wrapToolWithHooks()` → `wrapToolWithExtensions()`

**CreateAgentSessionOptions:**

- `.hooks` → removed (use `.additionalExtensionPaths` for paths)
- `.additionalHookPaths` → `.additionalExtensionPaths`
- `.preloadedHooks` → `.preloadedExtensions`
- `.customTools` type changed: `Array<{ path?; tool: CustomTool }>` → `ToolDefinition[]`
- `.additionalCustomToolPaths` → merged into `.additionalExtensionPaths`
- `.slashCommands` → `.promptTemplates`

**AgentSession:**

- `.hookRunner` → `.extensionRunner`
- `.fileCommands` → `.promptTemplates`
- `.sendHookMessage()` → `.sendCustomMessage()`

### Session Migration

**Automatic.** Session version bumped from 2 to 3. Existing sessions are migrated on first load:

- Message role `"hookMessage"` → `"custom"`

### Breaking Changes

- **Settings:** `hooks` and `customTools` arrays replaced with single `extensions` array
- **CLI:** `--hook` and `--tool` flags replaced with `--extension` / `-e`
- **Directories:** `hooks/`, `tools/` → `extensions/`; `commands/` → `prompts/`
- **Types:** See type renames above
- **SDK:** See SDK migration above

### Changed

- Extensions can have their own `package.json` with dependencies (resolved via jiti)
- Documentation: `docs/hooks.md` and `docs/custom-tools.md` merged into `docs/extensions.md`
- Examples: `examples/hooks/` and `examples/custom-tools/` merged into `examples/extensions/`
- README: Extensions section expanded with custom tools, commands, events, state persistence, shortcuts, flags, and UI examples
- SDK: `customTools` option now accepts `ToolDefinition[]` directly (simplified from `Array<{ path?, tool }>`)
- SDK: `extensions` option accepts `ExtensionFactory[]` for inline extensions
- SDK: `additionalExtensionPaths` replaces both `additionalHookPaths` and `additionalCustomToolPaths`

## [0.34.2] - 2026-01-04

## [0.34.1] - 2026-01-04

### Added

- Hook API: `ctx.ui.setTitle(title)` allows hooks to set the terminal window/tab title ([#446](https://github.com/badlogic/pi-mono/pull/446) by [@aliou](https://github.com/aliou))

### Changed

- Expanded keybinding documentation to list all 32 supported symbol keys with notes on ctrl+symbol behavior ([#450](https://github.com/badlogic/pi-mono/pull/450) by [@kaofelix](https://github.com/kaofelix))

## [0.34.0] - 2026-01-04

### Added

- Hook API: `pi.getActiveTools()` and `pi.setActiveTools(toolNames)` for dynamically enabling/disabling tools from hooks
- Hook API: `pi.getAllTools()` to enumerate all configured tools (built-in via --tools or default, plus custom tools)
- Hook API: `pi.registerFlag(name, options)` and `pi.getFlag(name)` for hooks to register custom CLI flags (parsed automatically)
- Hook API: `pi.registerShortcut(shortcut, options)` for hooks to register custom keyboard shortcuts using `KeyId` (e.g., `Key.shift("p")`). Conflicts with built-in shortcuts are skipped, conflicts between hooks logged as warnings.
- Hook API: `ctx.ui.setWidget(key, content)` for status displays above the editor. Accepts either a string array or a component factory function.
- Hook API: `theme.strikethrough(text)` for strikethrough text styling
- Hook API: `before_agent_start` handlers can now return `systemPromptAppend` to dynamically append text to the system prompt for that turn. Multiple hooks' appends are concatenated.
- Hook API: `before_agent_start` handlers can now return multiple messages (all are injected, not just the first)
- `/hotkeys` command now shows hook-registered shortcuts in a separate "Hooks" section
- New example hook: `plan-mode.ts` - Claude Code-style read-only exploration mode:
  - Toggle via `/plan` command, `Shift+P` shortcut, or `--plan` CLI flag
  - Read-only tools: `read`, `bash`, `grep`, `find`, `ls` (no `edit`/`write`)
  - Bash commands restricted to non-destructive operations (blocks `rm`, `mv`, `git commit`, `npm install`, etc.)
  - Interactive prompt after each response: execute plan, stay in plan mode, or refine
  - Todo list widget showing progress with checkboxes and strikethrough for completed items
  - Each todo has a unique ID; agent marks items done by outputting `[DONE:id]`
  - Progress updates via `agent_end` hook (parses completed items from final message)
  - `/todos` command to view current plan progress
  - Shows `⏸ plan` indicator in footer when in plan mode, `📋 2/5` when executing
  - State persists across sessions (including todo progress)
- New example hook: `tools.ts` - Interactive `/tools` command to enable/disable tools with session persistence
- New example hook: `pirate.ts` - Demonstrates `systemPromptAppend` to make the agent speak like a pirate
- Tool registry now contains all built-in tools (read, bash, edit, write, grep, find, ls) even when `--tools` limits the initially active set. Hooks can enable any tool from the registry via `pi.setActiveTools()`.
- System prompt now automatically rebuilds when tools change via `setActiveTools()`, updating tool descriptions and guidelines to match the new tool set
- Hook errors now display full stack traces for easier debugging
- Event bus (`pi.events`) for tool/hook communication: shared pub/sub between custom tools and hooks
- Custom tools now have `pi.sendMessage()` to send messages directly to the agent session without needing the event bus
- `sendMessage()` supports `deliverAs: "nextTurn"` to queue messages for the next user prompt

### Changed

- Removed image placeholders after copy & paste, replaced with inserting image file paths directly. ([#442](https://github.com/badlogic/pi-mono/pull/442) by [@mitsuhiko](https://github.com/mitsuhiko))

### Fixed

- Fixed potential text decoding issues in bash executor by using streaming TextDecoder instead of Buffer.toString()
- External editor (Ctrl-G) now shows full pasted content instead of `[paste #N ...]` placeholders ([#444](https://github.com/badlogic/pi-mono/pull/444) by [@aliou](https://github.com/aliou))

## [0.33.0] - 2026-01-04

### Breaking Changes

- **Key detection functions removed from `@mariozechner/pi-tui`**: All `isXxx()` key detection functions (`isEnter()`, `isEscape()`, `isCtrlC()`, etc.) have been removed. Use `matchesKey(data, keyId)` instead (e.g., `matchesKey(data, "enter")`, `matchesKey(data, "ctrl+c")`). This affects hooks and custom tools that use `ctx.ui.custom()` with keyboard input handling. ([#405](https://github.com/badlogic/pi-mono/pull/405))

### Added

- Clipboard image paste support via `Ctrl+V`. Images are saved to a temp file and attached to the message. Works on macOS, Windows, and Linux (X11). ([#419](https://github.com/badlogic/pi-mono/issues/419))
- Configurable keybindings via `~/.pi/agent/keybindings.json`. All keyboard shortcuts (editor navigation, deletion, app actions like model cycling, etc.) can now be customized. Supports multiple bindings per action. ([#405](https://github.com/badlogic/pi-mono/pull/405) by [@hjanuschka](https://github.com/hjanuschka))
- `/quit` and `/exit` slash commands to gracefully exit the application. Unlike double Ctrl+C, these properly await hook and custom tool cleanup handlers before exiting. ([#426](https://github.com/badlogic/pi-mono/pull/426) by [@ben-vargas](https://github.com/ben-vargas))

### Fixed

- Subagent example README referenced incorrect filename `subagent.ts` instead of `index.ts` ([#427](https://github.com/badlogic/pi-mono/pull/427) by [@Whamp](https://github.com/Whamp))

## [0.32.3] - 2026-01-03

### Fixed

- `--list-models` no longer shows Google Vertex AI models without explicit authentication configured
- JPEG/GIF/WebP images not displaying in terminals using Kitty graphics protocol (Kitty, Ghostty, WezTerm). The protocol requires PNG format, so non-PNG images are now converted before display.
- Version check URL typo preventing update notifications from working ([#423](https://github.com/badlogic/pi-mono/pull/423) by [@skuridin](https://github.com/skuridin))
- Large images exceeding Anthropic's 5MB limit now retry with progressive quality/size reduction ([#424](https://github.com/badlogic/pi-mono/pull/424) by [@mitsuhiko](https://github.com/mitsuhiko))

## [0.32.2] - 2026-01-03

### Added

- `$ARGUMENTS` syntax for custom slash commands as alternative to `$@` for all arguments joined. Aligns with patterns used by Claude, Codex, and OpenCode. Both syntaxes remain fully supported. ([#418](https://github.com/badlogic/pi-mono/pull/418) by [@skuridin](https://github.com/skuridin))

### Changed

- **Slash commands and hook commands now work during streaming**: Previously, using a slash command or hook command while the agent was streaming would crash with "Agent is already processing". Now:
  - Hook commands execute immediately (they manage their own LLM interaction via `pi.sendMessage()`)
  - File-based slash commands are expanded and queued via steer/followUp
  - `steer()` and `followUp()` now expand file-based slash commands and error on hook commands (hook commands cannot be queued)
  - `prompt()` accepts new `streamingBehavior` option (`"steer"` or `"followUp"`) to specify queueing behavior during streaming
  - RPC `prompt` command now accepts optional `streamingBehavior` field
    ([#420](https://github.com/badlogic/pi-mono/issues/420))

### Fixed

- Slash command argument substitution now processes positional arguments (`$1`, `$2`, etc.) before all-arguments (`$@`, `$ARGUMENTS`) to prevent recursive substitution when argument values contain dollar-digit patterns like `$100`. ([#418](https://github.com/badlogic/pi-mono/pull/418) by [@skuridin](https://github.com/skuridin))

## [0.32.1] - 2026-01-03

### Added

- Shell commands without context contribution: use `!!command` to execute a bash command that is shown in the TUI and saved to session history but excluded from LLM context. Useful for running commands you don't want the AI to see. ([#414](https://github.com/badlogic/pi-mono/issues/414))

### Fixed

- Edit tool diff not displaying in TUI due to race condition between async preview computation and tool execution

## [0.32.0] - 2026-01-03

### Breaking Changes

- **Queue API replaced with steer/followUp**: The `queueMessage()` method has been split into two methods with different delivery semantics ([#403](https://github.com/badlogic/pi-mono/issues/403)):
  - `steer(text)`: Interrupts the agent mid-run (Enter while streaming). Delivered after current tool execution.
  - `followUp(text)`: Waits until the agent finishes (Alt+Enter while streaming). Delivered only when agent stops.
- **Settings renamed**: `queueMode` setting renamed to `steeringMode`. Added new `followUpMode` setting. Old settings.json files are migrated automatically.
- **AgentSession methods renamed**:
  - `queueMessage()` → `steer()` and `followUp()`
  - `queueMode` getter → `steeringMode` and `followUpMode` getters
  - `setQueueMode()` → `setSteeringMode()` and `setFollowUpMode()`
  - `queuedMessageCount` → `pendingMessageCount`
  - `getQueuedMessages()` → `getSteeringMessages()` and `getFollowUpMessages()`
  - `clearQueue()` now returns `{ steering: string[], followUp: string[] }`
  - `hasQueuedMessages()` → `hasPendingMessages()`
- **Hook API signature changed**: `pi.sendMessage()` second parameter changed from `triggerTurn?: boolean` to `options?: { triggerTurn?, deliverAs? }`. Use `deliverAs: "followUp"` for follow-up delivery. Affects both hooks and internal `sendHookMessage()` method.
- **RPC API changes**:
  - `queue_message` command → `steer` and `follow_up` commands
  - `set_queue_mode` command → `set_steering_mode` and `set_follow_up_mode` commands
  - `RpcSessionState.queueMode` → `steeringMode` and `followUpMode`
- **Settings UI**: "Queue mode" setting split into "Steering mode" and "Follow-up mode"

### Added

- Configurable double-escape action: choose whether double-escape with empty editor opens `/tree` (default) or `/branch`. Configure via `/settings` or `doubleEscapeAction` in settings.json ([#404](https://github.com/badlogic/pi-mono/issues/404))
- Vertex AI provider (`google-vertex`): access Gemini models via Google Cloud Vertex AI using Application Default Credentials ([#300](https://github.com/badlogic/pi-mono/pull/300) by [@default-anton](https://github.com/default-anton))
- Built-in provider overrides in `models.json`: override just `baseUrl` to route a built-in provider through a proxy while keeping all its models, or define `models` to fully replace the provider ([#406](https://github.com/badlogic/pi-mono/pull/406) by [@yevhen](https://github.com/yevhen))
- Automatic image resizing: images larger than 2000x2000 are resized for better model compatibility. Original dimensions are injected into the prompt. Controlled via `/settings` or `images.autoResize` in settings.json. ([#402](https://github.com/badlogic/pi-mono/pull/402) by [@mitsuhiko](https://github.com/mitsuhiko))
- Alt+Enter keybind to queue follow-up messages while agent is streaming
- `Theme` and `ThemeColor` types now exported for hooks using `ctx.ui.custom()`
- Terminal window title now displays "pi - dirname" to identify which project session you're in ([#407](https://github.com/badlogic/pi-mono/pull/407) by [@kaofelix](https://github.com/kaofelix))

### Changed

- Editor component now uses word wrapping instead of character-level wrapping for better readability ([#382](https://github.com/badlogic/pi-mono/pull/382) by [@nickseelert](https://github.com/nickseelert))

### Fixed

- `/model` selector now opens instantly instead of waiting for OAuth token refresh. Token refresh is deferred until a model is actually used.
- Shift+Space, Shift+Backspace, and Shift+Delete now work correctly in Kitty-protocol terminals (Kitty, WezTerm, etc.) instead of being silently ignored ([#411](https://github.com/badlogic/pi-mono/pull/411) by [@nathyong](https://github.com/nathyong))
- `AgentSession.prompt()` now throws if called while the agent is already streaming, preventing race conditions. Use `steer()` or `followUp()` to queue messages during streaming.
- Ctrl+C now works like Escape in selector components, so mashing Ctrl+C will eventually close the program ([#400](https://github.com/badlogic/pi-mono/pull/400) by [@mitsuhiko](https://github.com/mitsuhiko))

## [0.31.1] - 2026-01-02

### Fixed

- Model selector no longer allows negative index when pressing arrow keys before models finish loading ([#398](https://github.com/badlogic/pi-mono/pull/398) by [@mitsuhiko](https://github.com/mitsuhiko))
- Type guard functions (`isBashToolResult`, etc.) now exported at runtime, not just in type declarations ([#397](https://github.com/badlogic/pi-mono/issues/397))

## [0.31.0] - 2026-01-02

This release introduces session trees for in-place branching, major API changes to hooks and custom tools, and structured compaction with file tracking.

### Session Tree

Sessions now use a tree structure with `id`/`parentId` fields. This enables in-place branching: navigate to any previous point with `/tree`, continue from there, and switch between branches while preserving all history in a single file.

**Existing sessions are automatically migrated** (v1 → v2) on first load. No manual action required.

New entry types: `BranchSummaryEntry` (context from abandoned branches), `CustomEntry` (hook state), `CustomMessageEntry` (hook-injected messages), `LabelEntry` (bookmarks).

See [docs/session.md](docs/session.md) for the file format and `SessionManager` API.

### Hooks Migration

The hooks API has been restructured with more granular events and better session access.

**Type renames:**

- `HookEventContext` → `HookContext`
- `HookCommandContext` is now a new interface extending `HookContext` with session control methods

**Event changes:**

- The monolithic `session` event is now split into granular events: `session_start`, `session_before_switch`, `session_switch`, `session_before_branch`, `session_branch`, `session_before_compact`, `session_compact`, `session_shutdown`
- `session_before_switch` and `session_switch` events now include `reason: "new" | "resume"` to distinguish between `/new` and `/resume`
- New `session_before_tree` and `session_tree` events for `/tree` navigation (hook can provide custom branch summary)
- New `before_agent_start` event: inject messages before the agent loop starts
- New `context` event: modify messages non-destructively before each LLM call
- Session entries are no longer passed in events. Use `ctx.sessionManager.getEntries()` or `ctx.sessionManager.getBranch()` instead

**API changes:**

- `pi.send(text, attachments?)` → `pi.sendMessage(message, triggerTurn?)` (creates `CustomMessageEntry`)
- New `pi.appendEntry(customType, data?)` for hook state persistence (not in LLM context)
- New `pi.registerCommand(name, options)` for custom slash commands (handler receives `HookCommandContext`)
- New `pi.registerMessageRenderer(customType, renderer)` for custom TUI rendering
- New `ctx.isIdle()`, `ctx.abort()`, `ctx.hasQueuedMessages()` for agent state (available in all events)
- New `ctx.ui.editor(title, prefill?)` for multi-line text editing with Ctrl+G external editor support
- New `ctx.ui.custom(component)` for full TUI component rendering with keyboard focus
- New `ctx.ui.setStatus(key, text)` for persistent status text in footer (multiple hooks can set their own)
- New `ctx.ui.theme` getter for styling text with theme colors
- `ctx.exec()` moved to `pi.exec()`
- `ctx.sessionFile` → `ctx.sessionManager.getSessionFile()`
- New `ctx.modelRegistry` and `ctx.model` for API key resolution

**HookCommandContext (slash commands only):**

- `ctx.waitForIdle()` - wait for agent to finish streaming
- `ctx.newSession(options?)` - create new sessions with optional setup callback
- `ctx.fork(entryId) - fork from a specific entry, creating a new session file
- `ctx.navigateTree(targetId, options?)` - navigate the session tree

These methods are only on `HookCommandContext` (not `HookContext`) because they can deadlock if called from event handlers that run inside the agent loop.

**Removed:**

- `hookTimeout` setting (hooks no longer have timeouts; use Ctrl+C to abort)
- `resolveApiKey` parameter (use `ctx.modelRegistry.getApiKey(model)`)

See [docs/hooks.md](docs/hooks.md) and [examples/hooks/](examples/hooks/) for the current API.

### Custom Tools Migration

The custom tools API has been restructured to mirror the hooks pattern with a context object.

**Type renames:**

- `CustomAgentTool` → `CustomTool`
- `ToolAPI` → `CustomToolAPI`
- `ToolContext` → `CustomToolContext`
- `ToolSessionEvent` → `CustomToolSessionEvent`

**Execute signature changed:**

```typescript
// Before (v0.30.2)
execute(toolCallId, params, signal, onUpdate)

// After
execute(toolCallId, params, onUpdate, ctx, signal?)
```

The new `ctx: CustomToolContext` provides `sessionManager`, `modelRegistry`, `model`, and agent state methods:

- `ctx.isIdle()` - check if agent is streaming
- `ctx.hasQueuedMessages()` - check if user has queued messages (skip interactive prompts)
- `ctx.abort()` - abort current operation (fire-and-forget)

**Session event changes:**

- `CustomToolSessionEvent` now only has `reason` and `previousSessionFile`
- Session entries are no longer in the event. Use `ctx.sessionManager.getBranch()` or `ctx.sessionManager.getEntries()` to reconstruct state
- Reasons: `"start" | "switch" | "branch" | "tree" | "shutdown"` (no separate `"new"` reason; `/new` triggers `"switch"`)
- `dispose()` method removed. Use `onSession` with `reason: "shutdown"` for cleanup

See [docs/custom-tools.md](docs/custom-tools.md) and [examples/custom-tools/](examples/custom-tools/) for the current API.

### SDK Migration

**Type changes:**

- `CustomAgentTool` → `CustomTool`
- `AppMessage` → `AgentMessage`
- `sessionFile` returns `string | undefined` (was `string | null`)
- `model` returns `Model | undefined` (was `Model | null`)
- `Attachment` type removed. Use `ImageContent` from `@mariozechner/pi-ai` instead. Add images directly to message content arrays.

**AgentSession API:**

- `branch(entryIndex: number)` → `branch(entryId: string)`
- `getUserMessagesForBranching()` returns `{ entryId, text }` instead of `{ entryIndex, text }`
- `reset()` → `newSession(options?)` where options has optional `parentSession` for lineage tracking
- `newSession()` and `switchSession()` now return `Promise<boolean>` (false if cancelled by hook)
- New `navigateTree(targetId, options?)` for in-place tree navigation

**Hook integration:**

- New `sendHookMessage(message, triggerTurn?)` for hook message injection

**SessionManager API:**

- Method renames: `saveXXX()` → `appendXXX()` (e.g., `appendMessage`, `appendCompaction`)
- `branchInPlace()` → `branch()`
- `reset()` → `newSession(options?)` with optional `parentSession` for lineage tracking
- `createBranchedSessionFromEntries(entries, index)` → `createBranchedSession(leafId)`
- `SessionHeader.branchedFrom` → `SessionHeader.parentSession`
- `saveCompaction(entry)` → `appendCompaction(summary, firstKeptEntryId, tokensBefore, details?)`
- `getEntries()` now excludes the session header (use `getHeader()` separately)
- `getSessionFile()` returns `string | undefined` (undefined for in-memory sessions)
- New tree methods: `getTree()`, `getBranch()`, `getLeafId()`, `getLeafEntry()`, `getEntry()`, `getChildren()`, `getLabel()`
- New append methods: `appendCustomEntry()`, `appendCustomMessageEntry()`, `appendLabelChange()`
- New branch methods: `branch(entryId)`, `branchWithSummary()`

**ModelRegistry (new):**

`ModelRegistry` is a new class that manages model discovery and API key resolution. It combines built-in models with custom models from `models.json` and resolves API keys via `AuthStorage`.

```typescript
import {
  discoverAuthStorage,
  discoverModels,
} from "@mariozechner/pi-coding-agent";

const authStorage = discoverAuthStorage(); // ~/.pi/agent/auth.json
const modelRegistry = discoverModels(authStorage); // + ~/.pi/agent/models.json

// Get all models (built-in + custom)
const allModels = modelRegistry.getAll();

// Get only models with valid API keys
const available = await modelRegistry.getAvailable();

// Find specific model
const model = modelRegistry.find("anthropic", "claude-sonnet-4-20250514");

// Get API key for a model
const apiKey = await modelRegistry.getApiKey(model);
```

This replaces the old `resolveApiKey` callback pattern. Hooks and custom tools access it via `ctx.modelRegistry`.

**Renamed exports:**

- `messageTransformer` → `convertToLlm`
- `SessionContext` alias `LoadedSession` removed

See [docs/sdk.md](docs/sdk.md) and [examples/sdk/](examples/sdk/) for the current API.

### RPC Migration

**Session commands:**

- `reset` command → `new_session` command with optional `parentSession` field

**Branching commands:**

- `branch` command: `entryIndex` → `entryId`
- `get_branch_messages` response: `entryIndex` → `entryId`

**Type changes:**

- Messages are now `AgentMessage` (was `AppMessage`)
- `prompt` command: `attachments` field replaced with `images` field using `ImageContent` format

**Compaction events:**

- `auto_compaction_start` now includes `reason` field (`"threshold"` or `"overflow"`)
- `auto_compaction_end` now includes `willRetry` field
- `compact` response includes full `CompactionResult` (`summary`, `firstKeptEntryId`, `tokensBefore`, `details`)

See [docs/rpc.md](docs/rpc.md) for the current protocol.

### Structured Compaction

Compaction and branch summarization now use a structured output format:

- Clear sections: Goal, Progress, Key Information, File Operations
- File tracking: `readFiles` and `modifiedFiles` arrays in `details`, accumulated across compactions
- Conversations are serialized to text before summarization to prevent the model from "continuing" them

The `before_compact` and `before_tree` hook events allow custom compaction implementations. See [docs/compaction.md](docs/compaction.md).

### Interactive Mode

**`/tree` command:**

- Navigate the full session tree in-place
- Search by typing, page with ←/→
- Filter modes (Ctrl+O): default → no-tools → user-only → labeled-only → all
- Press `l` to label entries as bookmarks
- Selecting a branch switches context and optionally injects a summary of the abandoned branch

**Entry labels:**

- Bookmark any entry via `/tree` → select → `l`
- Labels appear in tree view and persist as `LabelEntry`

**Theme changes (breaking for custom themes):**

Custom themes must add these new color tokens or they will fail to load:

- `selectedBg`: background for selected/highlighted items in tree selector and other components
- `customMessageBg`: background for hook-injected messages (`CustomMessageEntry`)
- `customMessageText`: text color for hook messages
- `customMessageLabel`: label color for hook messages (the `[customType]` prefix)

Total color count increased from 46 to 50. See [docs/theme.md](docs/theme.md) for the full color list and copy values from the built-in dark/light themes.

**Settings:**

- `enabledModels`: allowlist models in `settings.json` (same format as `--models` CLI)

### Added

- `ctx.ui.setStatus(key, text)` for hooks to display persistent status text in the footer ([#385](https://github.com/badlogic/pi-mono/pull/385) by [@prateekmedia](https://github.com/prateekmedia))
- `ctx.ui.theme` getter for styling status text and other output with theme colors
- `/share` command to upload session as a secret GitHub gist and get a shareable URL via shittycodingagent.ai ([#380](https://github.com/badlogic/pi-mono/issues/380))
- HTML export now includes a tree visualization sidebar for navigating session branches ([#375](https://github.com/badlogic/pi-mono/issues/375))
- HTML export supports keyboard shortcuts: Ctrl+T to toggle thinking blocks, Ctrl+O to toggle tool outputs
- HTML export supports theme-configurable background colors via optional `export` section in theme JSON ([#387](https://github.com/badlogic/pi-mono/pull/387) by [@mitsuhiko](https://github.com/mitsuhiko))
- HTML export syntax highlighting now uses theme colors and matches TUI rendering
- **Snake game example hook**: Demonstrates `ui.custom()`, `registerCommand()`, and session persistence. See [examples/hooks/snake.ts](examples/hooks/snake.ts).
- **`thinkingText` theme token**: Configurable color for thinking block text. ([#366](https://github.com/badlogic/pi-mono/pull/366) by [@paulbettner](https://github.com/paulbettner))

### Changed

- **Entry IDs**: Session entries now use short 8-character hex IDs instead of full UUIDs
- **API key priority**: `ANTHROPIC_OAUTH_TOKEN` now takes precedence over `ANTHROPIC_API_KEY`
- HTML export template split into separate files (template.html, template.css, template.js) for easier maintenance

### Fixed

- HTML export now properly sanitizes user messages containing HTML tags like `<style>` that could break DOM rendering
- Crash when displaying bash output containing Unicode format characters like U+0600-U+0604 ([#372](https://github.com/badlogic/pi-mono/pull/372) by [@HACKE-RC](https://github.com/HACKE-RC))
- **Footer shows full session stats**: Token usage and cost now include all messages, not just those after compaction. ([#322](https://github.com/badlogic/pi-mono/issues/322))
- **Status messages spam chat log**: Rapidly changing settings (e.g., thinking level via Shift+Tab) would add multiple status lines. Sequential status updates now coalesce into a single line. ([#365](https://github.com/badlogic/pi-mono/pull/365) by [@paulbettner](https://github.com/paulbettner))
- **Toggling thinking blocks during streaming shows nothing**: Pressing Ctrl+T while streaming would hide the current message until streaming completed.
- **Resuming session resets thinking level to off**: Initial model and thinking level were not saved to session file, causing `--resume`/`--continue` to default to `off`. ([#342](https://github.com/badlogic/pi-mono/issues/342) by [@aliou](https://github.com/aliou))
- **Hook `tool_result` event ignores errors from custom tools**: The `tool_result` hook event was never emitted when tools threw errors, and always had `isError: false` for successful executions. Now emits the event with correct `isError` value in both success and error cases. ([#374](https://github.com/badlogic/pi-mono/issues/374) by [@nicobailon](https://github.com/nicobailon))
- **Edit tool fails on Windows due to CRLF line endings**: Files with CRLF line endings now match correctly when LLMs send LF-only text. Line endings are normalized before matching and restored to original style on write. ([#355](https://github.com/badlogic/pi-mono/issues/355) by [@Pratham-Dubey](https://github.com/Pratham-Dubey))
- **Edit tool fails on files with UTF-8 BOM**: Files with UTF-8 BOM marker could cause "text not found" errors since the LLM doesn't include the invisible BOM character. BOM is now stripped before matching and restored on write. ([#394](https://github.com/badlogic/pi-mono/pull/394) by [@prathamdby](https://github.com/prathamdby))
- **Use bash instead of sh on Unix**: Fixed shell commands using `/bin/sh` instead of `/bin/bash` on Unix systems. ([#328](https://github.com/badlogic/pi-mono/pull/328) by [@dnouri](https://github.com/dnouri))
- **OAuth login URL clickable**: Made OAuth login URLs clickable in terminal. ([#349](https://github.com/badlogic/pi-mono/pull/349) by [@Cursivez](https://github.com/Cursivez))
- **Improved error messages**: Better error messages when `apiKey` or `model` are missing. ([#346](https://github.com/badlogic/pi-mono/pull/346) by [@ronyrus](https://github.com/ronyrus))
- **Session file validation**: `findMostRecentSession()` now validates session headers before returning, preventing non-session JSONL files from being loaded
- **Compaction error handling**: `generateSummary()` and `generateTurnPrefixSummary()` now throw on LLM errors instead of returning empty strings
- **Compaction with branched sessions**: Fixed compaction incorrectly including entries from abandoned branches, causing token overflow errors. Compaction now uses `sessionManager.getPath()` to work only on the current branch path, eliminating 80+ lines of duplicate entry collection logic between `prepareCompaction()` and `compact()`
- **enabledModels glob patterns**: `--models` and `enabledModels` now support glob patterns like `github-copilot/*` or `*sonnet*`. Previously, patterns were only matched literally or via substring search. ([#337](https://github.com/badlogic/pi-mono/issues/337))

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
