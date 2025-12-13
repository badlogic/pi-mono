# Changelog

## [0.1.0] - Unreleased

### Added

- Initial Discord bot implementation
- @mention support in guild channels
- Direct message support
- Core tools: bash, read, write, edit, attach
- Memory system (MEMORY.md)
- Conversation logging (log.jsonl)
- Docker sandbox support
- Slash commands: /mom, /mom-stop, /mom-memory
- Working indicator (... appended to messages)
- File attachment handling

### Notes

- Requires MESSAGE_CONTENT privileged intent
- Message limit is 2000 characters (vs Slack's 40,000)
- Uses follow-up messages instead of thread replies
