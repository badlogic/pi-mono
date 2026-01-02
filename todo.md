# Export HTML TODOs

- [x] "Ctrl+T toggle thinking · Ctrl+O toggle tools" font size is not the same as all the other font sizes
- [ ] System prompt doesn't show included AGENTS.md, skills. See `packages/coding-agent/src/core/system-prompt.ts`. Can only be done if we export live from a session, not via `--export` CLI flag
- [x] "Available Tools" has no newline after it
- [x] `read` tool has too much vertical spacing between tool call header and tool result, and also with tool bottom border (was white-space: pre-wrap on .tool-output preserving template literal whitespace)
