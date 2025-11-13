# Changelog

## [0.7.7] - Unreleased

### Added

- Automatic changelog viewer on startup in interactive mode. When starting a new session (not continuing/resuming), the agent will display all changelog entries since the last version you used in a scrollable markdown viewer. The last shown version is tracked in `~/.pi/agent/settings.json`.

### Changed

- **BREAKING**: Renamed project context file from `AGENT.md` to `AGENTS.md`. The system now looks for `AGENTS.md` or `CLAUDE.md` (with `AGENTS.md` preferred). Existing `AGENT.md` files will need to be renamed to `AGENTS.md` to continue working. (fixes [#9](https://github.com/badlogic/pi-mono/pull/9))

## [0.7.6] - 2025-11-13

Previous releases did not maintain a changelog.
