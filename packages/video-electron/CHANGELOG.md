# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

### Added
- Added initial Electron video-agent package with:
  - Pi coding-agent SDK integration in main process
  - Typed IPC command/event contracts
  - Project-local `.pi-video/` manifest and artifact storage
  - VotGO binary runner and tool adapters
  - Approval gate model for mutating VotGO commands

### Changed
- Improved the renderer processing overlay with explicit phase labels, elapsed-time tracking, and a live tool task list so users can see when the agent is still running.
- Added a bottom transcript-sidebar media I/O panel (video/audio inputs and outputs) and synchronized video/audio timeline lanes in the preview footer.
- Added timeline double-click split markers, global undo/redo shortcuts (`Cmd/Ctrl+Z`, `Cmd/Ctrl+Y`, `Cmd/Ctrl+Shift+Z`), and folder-style media I/O entries with clickable audio/video file previews.
- Refactored video projects to use dedicated per-project `inputs/` and `outputs/` folders, with media import routing through main-process IPC for safer and more deterministic file handling.
- Added persistent `.pi-video/logs/changes.jsonl` change logging for project opens/imports, agent prompts, artifact saves, and VotGO executions, and enabled timeline drag-and-drop import of video files directly into project inputs.
- Added suggestion-first transcript edit handling in the renderer for prompts like cutting repetitions/keeping the last take, including automatic mapping of AI timestamp suggestions to highlighted transcript words.
- Enabled approval dialogs by default for mutating VotGO commands in the Electron host and added explicit approve/deny flow before media-changing agent actions execute.
