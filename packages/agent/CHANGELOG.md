# Changelog

## [0.7.6] - Unreleased

### Fixed

- Fixed error message loss when `turn_end` event contains an error. Previously, errors in `turn_end` events (e.g., "Provider returned error" from OpenRouter Auto Router) were not captured in `agent.state.error`, making it appear as if the agent completed successfully. ([#6](https://github.com/badlogic/pi-mono/issues/6))

## [0.7.5] - 2025-11-13

Previous releases did not maintain a changelog.
