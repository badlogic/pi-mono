# Changelog

## [Unreleased]

### Added

- Added `validateToolCallsAtProvider` option to streaming and agent APIs to optionally skip provider-level tool-call validation (default on), allowing agent loops to surface schema errors as toolResult messages and retry.

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
