# Session File Format

Sessions are stored as JSONL (JSON Lines) files. Each line is a JSON object with a `type` field.

## File Location

```
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Where `<path>` is the working directory with `/` replaced by `-`.

## Type Definitions

- [`src/session-manager.ts`](../src/session-manager.ts) - Session entry types (`SessionHeader`, `SessionMessageEntry`, etc.)
- [`packages/agent/src/types.ts`](../../agent/src/types.ts) - `AppMessage`, `Attachment`, `ThinkingLevel`
- [`packages/ai/src/types.ts`](../../ai/src/types.ts) - `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `Usage`, `ToolCall`

## Entry Types

### SessionHeader

First line of the file. Defines session metadata.

```json
{"type":"session","id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project","provider":"anthropic","modelId":"claude-sonnet-4-5","thinkingLevel":"off"}
```

For branched sessions, includes the source session path:

```json
{"type":"session","id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project","provider":"anthropic","modelId":"claude-sonnet-4-5","thinkingLevel":"off","branchedFrom":"/path/to/original/session.jsonl"}
```

### SessionMessageEntry

A message in the conversation. The `message` field contains an `AppMessage` (see [rpc.md](./rpc.md#message-types)).

```json
{"type":"message","timestamp":"2024-12-03T14:00:01.000Z","message":{"role":"user","content":"Hello","timestamp":1733234567890}}
{"type":"message","timestamp":"2024-12-03T14:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-5","usage":{...},"stopReason":"stop","timestamp":1733234567891}}
{"type":"message","timestamp":"2024-12-03T14:00:03.000Z","message":{"role":"toolResult","toolCallId":"call_123","toolName":"bash","content":[{"type":"text","text":"output"}],"isError":false,"timestamp":1733234567900}}
{"type":"message","timestamp":"2024-12-03T14:00:04.000Z","message":{"role":"bashExecution","command":"ls -la","output":"total 48\n...","exitCode":0,"cancelled":false,"truncated":false,"timestamp":1733234567950}}
```

The `bashExecution` role is a custom message type for user-executed bash commands (via `!` in TUI or `bash` RPC command). See [rpc.md](./rpc.md#bashexecutionmessage) for the full schema.

### ModelChangeEntry

Emitted when the user switches models mid-session.

```json
{"type":"model_change","timestamp":"2024-12-03T14:05:00.000Z","provider":"openai","modelId":"gpt-4o"}
```

### ThinkingLevelChangeEntry

Emitted when the user changes the thinking/reasoning level.

```json
{"type":"thinking_level_change","timestamp":"2024-12-03T14:06:00.000Z","thinkingLevel":"high"}
```

## Parsing Example

```typescript
import { readFileSync } from "fs";

const lines = readFileSync("session.jsonl", "utf8").trim().split("\n");

for (const line of lines) {
  const entry = JSON.parse(line);
  
  switch (entry.type) {
    case "session":
      console.log(`Session: ${entry.id}, Model: ${entry.provider}/${entry.modelId}`);
      break;
    case "message":
      console.log(`${entry.message.role}: ${JSON.stringify(entry.message.content)}`);
      break;
    case "model_change":
      console.log(`Switched to: ${entry.provider}/${entry.modelId}`);
      break;
    case "thinking_level_change":
      console.log(`Thinking: ${entry.thinkingLevel}`);
      break;
  }
}
```
