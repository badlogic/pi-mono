# Changelog

## [Unreleased]

### Added

- Working memory system with MEMORY.md files
  - Global workspace memory (`workspace/MEMORY.md`) shared across all channels
  - Channel-specific memory (`workspace/<channel>/MEMORY.md`) for per-channel context
  - Automatic memory loading into system prompt on each request
  - Mom can update memory files to remember project details, preferences, and context
- ISO 8601 date field in log.jsonl for easy date-based grepping
  - Format: `"date":"2025-11-26T10:44:00.123Z"`
  - Enables queries like: `grep '"date":"2025-11-26' log.jsonl`

### Changed

- Enhanced system prompt with clearer directory structure and path examples
- Improved memory file path documentation to prevent confusion
- Message history format now includes ISO 8601 date for better searchability
- System prompt now includes log.jsonl format documentation with grep examples
- System prompt now includes current date and time for date-aware operations
- Added efficient log query patterns using jq to prevent context overflow
- System prompt emphasizes limiting NUMBER of messages (10-50), not truncating message text
- Log queries now show full message text and attachments for better context
- Fixed jq patterns to handle null/empty attachments with `(.attachments // [])`
- Recent messages in system prompt now formatted as TSV (43% token savings vs raw JSONL)
- Enhanced security documentation with prompt injection risk warnings and mitigations

### Fixed

- jq query patterns now properly handle messages without attachments (no more errors on empty arrays)

## [0.9.4] - 2025-11-26

### Added

- Initial release of Mom Slack bot
- Slack integration with @mentions and DMs
- Docker sandbox mode for isolated execution
- Bash tool with full shell access
- Read, write, edit file tools
- Attach tool for sharing files in Slack
- Thread-based tool details (clean main messages, verbose details in threads)
- Single accumulated message per agent run
- Stop command (`@mom stop`) to abort running tasks
- Persistent workspace per channel with scratchpad directory
- Streaming console output for monitoring
