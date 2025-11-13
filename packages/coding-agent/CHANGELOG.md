# Changelog

## [Unreleased]

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
