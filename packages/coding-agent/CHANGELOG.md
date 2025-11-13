# Changelog

## [0.7.7] - Unreleased

### Added

- Automatic changelog viewer on startup in interactive mode. When starting a new session (not continuing/resuming), the agent will display all changelog entries since the last version you used in a scrollable markdown viewer. The last shown version is tracked in `~/.pi/agent/settings.json`.
- OpenRouter Auto Router model support ([#5](https://github.com/badlogic/pi-mono/pull/5))
- Windows Git Bash support with automatic detection and process tree termination ([#1](https://github.com/badlogic/pi-mono/pull/1))

### Changed

- **BREAKING**: Renamed project context file from `AGENT.md` to `AGENTS.md`. The system now looks for `AGENTS.md` or `CLAUDE.md` (with `AGENTS.md` preferred). Existing `AGENT.md` files will need to be renamed to `AGENTS.md` to continue working. (fixes [#9](https://github.com/badlogic/pi-mono/pull/9))
- **BREAKING**: Session file format changed to store provider and model ID separately instead of as a single `provider/modelId` string. Existing sessions will not restore the model correctly when resumed - you'll need to manually set the model again using `/model`. (fixes [#4](https://github.com/badlogic/pi-mono/pull/4))
- Improved Windows Git Bash detection logic with better error messages showing actual paths searched ([#13](https://github.com/badlogic/pi-mono/pull/13))

### Fixed

- Fixed markdown list rendering bug where bullets were not displayed when list items contained inline code with cyan color formatting
- Fixed context percentage showing 0% in footer when last assistant message was aborted ([#12](https://github.com/badlogic/pi-mono/issues/12))

## [0.7.6] - 2025-11-13

Previous releases did not maintain a changelog.
