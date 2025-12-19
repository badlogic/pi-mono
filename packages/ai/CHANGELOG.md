# Changelog

## [Unreleased]

## [0.23.5] - 2025-12-19

### Added

- **Gemini 3 Flash thinking support**: Extended thinking level support for Gemini 3 Flash models (MINIMAL, LOW, MEDIUM, HIGH) to match Pro models' capabilities. ([#212](https://github.com/badlogic/pi-mono/pull/212) by [@markusylisiurunen](https://github.com/markusylisiurunen))

### Fixed

- **Gemini tool result format**: Fixed tool result format for Gemini 3 Flash Preview which strictly requires `{ output: value }` for success and `{ error: value }` for errors. Previous format using `{ result, isError }` was rejected by newer Gemini models. Also improved type safety by removing `as any` casts. ([#213](https://github.com/badlogic/pi-mono/issues/213), [#220](https://github.com/badlogic/pi-mono/pull/220))

- **Google baseUrl configuration**: Google provider now respects `baseUrl` configuration for custom endpoints or API proxies. ([#216](https://github.com/badlogic/pi-mono/issues/216), [#221](https://github.com/badlogic/pi-mono/pull/221) by [@theBucky](https://github.com/theBucky))

- **GitHub Copilot vision requests**: Added `Copilot-Vision-Request` header when sending images to GitHub Copilot models. ([#222](https://github.com/badlogic/pi-mono/issues/222))

- **GitHub Copilot X-Initiator header**: Fixed X-Initiator logic to check last message role instead of any message in history. This ensures proper billing when users send follow-up messages. ([#209](https://github.com/badlogic/pi-mono/issues/209))

## [0.22.3] - 2025-12-16

### Added

- **Image limits test suite**: Added comprehensive tests for provider-specific image limitations (max images, max size, max dimensions). Discovered actual limits: Anthropic (100 images, 5MB, 8000px), OpenAI (500 images, ≥25MB), Gemini (~2500 images, ≥40MB), Mistral (8 images, ~15MB), OpenRouter (~40 images context-limited, ~15MB). ([#120](https://github.com/badlogic/pi-mono/pull/120))

- **Tool result streaming**: Added `tool_execution_update` event and optional `onUpdate` callback to `AgentTool.execute()` for streaming tool output during execution. Tools can now emit partial results (e.g., bash stdout) that are forwarded to subscribers. ([#44](https://github.com/badlogic/pi-mono/issues/44))

- **X-Initiator header for GitHub Copilot**: Added X-Initiator header handling for GitHub Copilot provider to ensure correct call accounting (agent calls are not deducted from quota). Sets initiator based on last message role. ([#200](https://github.com/badlogic/pi-mono/pull/200) by [@kim0](https://github.com/kim0))

### Changed

- **Normalized tool_execution_end result**: `tool_execution_end` event now always contains `AgentToolResult` (no longer `AgentToolResult | string`). Errors are wrapped in the standard result format.

### Fixed

- **Reasoning disabled by default**: When `reasoning` option is not specified, thinking is now explicitly disabled for all providers. Previously, some providers like Gemini with "dynamic thinking" would use their default (thinking ON), causing unexpected token usage. This was the original intended behavior. ([#180](https://github.com/badlogic/pi-mono/pull/180) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.22.2] - 2025-12-15

### Added

- **Interleaved thinking for Anthropic**: Added `interleavedThinking` option to `AnthropicOptions`. When enabled, Claude 4 models can think between tool calls and reason after receiving tool results. Enabled by default (no extra token cost, just unlocks the capability). Set `interleavedThinking: false` to disable.

## [0.22.1] - 2025-12-15

_Dedicated to Peter's shoulder ([@steipete](https://twitter.com/steipete))_

### Added

- **Interleaved thinking for Anthropic**: Enabled interleaved thinking in the Anthropic provider, allowing Claude models to output thinking blocks interspersed with text responses.

## [0.22.0] - 2025-12-15

### Added

- **GitHub Copilot provider**: Added `github-copilot` as a known provider with models sourced from models.dev. Includes Claude, GPT, Gemini, Grok, and other models available through GitHub Copilot. ([#191](https://github.com/badlogic/pi-mono/pull/191) by [@cau1k](https://github.com/cau1k))

### Fixed

- **GitHub Copilot gpt-5 models**: Fixed API selection for gpt-5 models to use `openai-responses` instead of `openai-completions` (gpt-5 models are not accessible via completions endpoint)

- **GitHub Copilot cross-model context handoff**: Fixed context handoff failing when switching between GitHub Copilot models using different APIs (e.g., gpt-5 to claude-sonnet-4). Tool call IDs from OpenAI Responses API were incompatible with other models. ([#198](https://github.com/badlogic/pi-mono/issues/198))

- **Gemini 3 Pro thinking levels**: Thinking level configuration now works correctly for Gemini 3 Pro models. Previously all levels mapped to -1 (minimal thinking). Now LOW/MEDIUM/HIGH properly control test-time computation. ([#176](https://github.com/badlogic/pi-mono/pull/176) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.18.2] - 2025-12-11

### Changed

- **Anthropic SDK retries disabled**: Set `maxRetries: 0` on Anthropic client to allow application-level retry handling. The SDK's built-in retries were interfering with coding-agent's retry logic. ([#157](https://github.com/badlogic/pi-mono/issues/157))

## [0.18.1] - 2025-12-10

### Added

- **Mistral provider**: Added support for Mistral AI models via the OpenAI-compatible API. Includes automatic handling of Mistral-specific requirements (tool call ID format). Set `MISTRAL_API_KEY` environment variable to use.

### Fixed

- Fixed Mistral 400 errors after aborted assistant messages by skipping empty assistant messages (no content, no tool calls) ([#165](https://github.com/badlogic/pi-mono/issues/165))

- Removed synthetic assistant bridge message after tool results for Mistral (no longer required as of Dec 2025) ([#165](https://github.com/badlogic/pi-mono/issues/165))

- Fixed bug where `ANTHROPIC_API_KEY` environment variable was deleted globally after first OAuth token usage, causing subsequent prompts to fail ([#164](https://github.com/badlogic/pi-mono/pull/164))

## [0.17.0] - 2025-12-09

### Added

- **`agentLoopContinue` function**: Continue an agent loop from existing context without adding a new user message. Validates that the last message is `user` or `toolResult`. Useful for retry after context overflow or resuming from manually-added tool results.

### Breaking Changes

- Removed provider-level tool argument validation. Validation now happens in `agentLoop` via `executeToolCalls`, allowing models to retry on validation errors. For manual tool execution, use `validateToolCall(tools, toolCall)` or `validateToolArguments(tool, toolCall)`.

### Added

- Added `validateToolCall(tools, toolCall)` helper that finds the tool by name and validates arguments.

- **OpenAI compatibility overrides**: Added `compat` field to `Model` for `openai-completions` API, allowing explicit configuration of provider quirks (`supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `maxTokensField`). Falls back to URL-based detection if not set. Useful for LiteLLM, custom proxies, and other non-standard endpoints. ([#133](https://github.com/badlogic/pi-mono/issues/133), thanks @fink-andreas for the initial idea and PR)

- **xhigh reasoning level**: Added `xhigh` to `ReasoningEffort` type for OpenAI codex-max models. For non-OpenAI providers (Anthropic, Google), `xhigh` is automatically mapped to `high`. ([#143](https://github.com/badlogic/pi-mono/issues/143))

### Changed

- **Updated SDK versions**: OpenAI SDK 5.21.0 → 6.10.0, Anthropic SDK 0.61.0 → 0.71.2, Google GenAI SDK 1.30.0 → 1.31.0

## [0.13.0] - 2025-12-06

### Breaking Changes

- **Added `totalTokens` field to `Usage` type**: All code that constructs `Usage` objects must now include the `totalTokens` field. This field represents the total tokens processed by the LLM (input + output + cache). For OpenAI and Google, this uses native API values (`total_tokens`, `totalTokenCount`). For Anthropic, it's computed as `input + output + cacheRead + cacheWrite`.

## [0.12.10] - 2025-12-04

### Added

- Added `gpt-5.1-codex-max` model support

### Fixed

- **OpenAI Token Counting**: Fixed `usage.input` to exclude cached tokens for OpenAI providers. Previously, `input` included cached tokens, causing double-counting when calculating total context size via `input + cacheRead`. Now `input` represents non-cached input tokens across all providers, making `input + output + cacheRead + cacheWrite` the correct formula for total context size.

- **Fixed Claude Opus 4.5 cache pricing** (was 3x too expensive)
  - Corrected cache_read: $1.50 → $0.50 per MTok
  - Corrected cache_write: $18.75 → $6.25 per MTok
  - Added manual override in `scripts/generate-models.ts` until upstream fix is merged
  - Submitted PR to models.dev: https://github.com/sst/models.dev/pull/439

## [0.9.4] - 2025-11-26

Initial release with multi-provider LLM support.
