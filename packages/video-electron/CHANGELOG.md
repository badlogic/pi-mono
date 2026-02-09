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
