# RPC Mode Protocol

The coding agent supports an RPC (Remote Procedure Call) mode for programmatic integration. This document describes the protocol for communicating with the agent over stdin/stdout using JSON messages.

## Starting RPC Mode

```bash
pi --mode rpc [--no-session]
```

- `--mode rpc`: Enables RPC mode (JSON over stdin/stdout)
- `--no-session`: Optional flag to disable session persistence

## Input Protocol

Send JSON messages to stdin, one per line. Each message must be a complete JSON object followed by a newline.

### Input Message Types

#### Prompt Message

Send a user prompt to the agent:

```json
{
  "type": "prompt",
  "message": "Your prompt text here",
  "attachments": []  // Optional array of Attachment objects
}
```

The `attachments` field is optional and supports images and documents. See [Attachment](#attachment) for the schema.

#### Abort Message

Abort the current agent operation:

```json
{
  "type": "abort"
}
```

## Output Protocol

The agent emits JSON events to stdout, one per line. Events follow the `AgentEvent` type hierarchy.

### Event Types Overview

| Event Type | Description |
|------------|-------------|
| `agent_start` | Agent begins processing a prompt |
| `agent_end` | Agent completes all processing |
| `turn_start` | A new turn begins (assistant response + tool calls) |
| `turn_end` | A turn completes |
| `message_start` | A message begins (user, assistant, or tool result) |
| `message_update` | Streaming update for assistant messages |
| `message_end` | A message completes |
| `tool_execution_start` | Tool execution begins |
| `tool_execution_end` | Tool execution completes |
| `error` | An error occurred |

### Event Schemas

#### agent_start

Emitted when the agent begins processing a prompt.

```json
{
  "type": "agent_start"
}
```

#### agent_end

Emitted when the agent completes all processing. Contains all messages generated during this prompt.

```json
{
  "type": "agent_end",
  "messages": [...]  // Array of AppMessage objects
}
```

#### turn_start

Emitted when a new turn begins. A turn consists of an optional user message, an assistant response, and any resulting tool calls/results.

```json
{
  "type": "turn_start"
}
```

#### turn_end

Emitted when a turn completes.

```json
{
  "type": "turn_end",
  "message": {...},      // AssistantMessage
  "toolResults": [...]   // Array of ToolResultMessage objects
}
```

#### message_start

Emitted when a message begins. The message can be a user message, assistant message, or tool result.

```json
{
  "type": "message_start",
  "message": {...}  // AppMessage (UserMessage, AssistantMessage, or ToolResultMessage)
}
```

#### message_update

Emitted during streaming of assistant messages. Contains both the partial message and the specific streaming event.

```json
{
  "type": "message_update",
  "message": {...},                // Partial AssistantMessage
  "assistantMessageEvent": {...}   // AssistantMessageEvent with delta
}
```

The `assistantMessageEvent` contains streaming deltas:

- `text_delta`: New text content `{ "type": "text_delta", "contentIndex": 0, "delta": "text chunk", "partial": {...} }`
- `thinking_delta`: New thinking content `{ "type": "thinking_delta", "contentIndex": 0, "delta": "thinking chunk", "partial": {...} }`
- `toolcall_delta`: Tool call argument streaming `{ "type": "toolcall_delta", "contentIndex": 0, "delta": "json chunk", "partial": {...} }`

See [AssistantMessageEvent](#assistantmessageevent) for all event types.

#### message_end

Emitted when a message is complete.

```json
{
  "type": "message_end",
  "message": {...}  // Complete AppMessage
}
```

#### tool_execution_start

Emitted when a tool begins execution.

```json
{
  "type": "tool_execution_start",
  "toolCallId": "call_abc123",
  "toolName": "bash",
  "args": { "command": "ls -la" }
}
```

#### tool_execution_end

Emitted when a tool completes execution.

```json
{
  "type": "tool_execution_end",
  "toolCallId": "call_abc123",
  "toolName": "bash",
  "result": {...},   // AgentToolResult or error string
  "isError": false
}
```

The `result` field contains either:
- An `AgentToolResult` object with `content` and `details` fields
- A string error message if `isError` is true

#### error

Emitted when an error occurs during input processing.

```json
{
  "type": "error",
  "error": "Error message"
}
```

---

## Type Definitions

All types are defined in the following source files:

- **Agent types**: [`packages/agent/src/types.ts`](../packages/agent/src/types.ts)
- **AI types**: [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)
- **Agent loop types**: [`packages/ai/src/agent/types.ts`](../packages/ai/src/agent/types.ts)

### Message Types

#### UserMessage

Defined in [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;  // Unix timestamp in milliseconds
}
```

#### UserMessageWithAttachments

Defined in [`packages/agent/src/types.ts`](../packages/agent/src/types.ts)

Extends `UserMessage` with optional attachments for the agent layer:

```typescript
type UserMessageWithAttachments = UserMessage & {
  attachments?: Attachment[];
}
```

#### AssistantMessage

Defined in [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;  // Unix timestamp in milliseconds
}
```

#### ToolResultMessage

Defined in [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)

```typescript
interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;  // Unix timestamp in milliseconds
}
```

#### AppMessage

Defined in [`packages/agent/src/types.ts`](../packages/agent/src/types.ts)

Union type of all message types including custom app messages:

```typescript
type AppMessage =
  | AssistantMessage
  | UserMessageWithAttachments
  | Message  // Includes ToolResultMessage
  | CustomMessages[keyof CustomMessages];
```

### Content Types

#### TextContent

```typescript
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}
```

#### ThinkingContent

```typescript
interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
}
```

#### ImageContent

```typescript
interface ImageContent {
  type: "image";
  data: string;      // base64 encoded
  mimeType: string;  // e.g., "image/jpeg", "image/png"
}
```

#### ToolCall

```typescript
interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;
}
```

### Attachment

Defined in [`packages/agent/src/types.ts`](../packages/agent/src/types.ts)

```typescript
interface Attachment {
  id: string;
  type: "image" | "document";
  fileName: string;
  mimeType: string;
  size: number;
  content: string;        // base64 encoded (without data URL prefix)
  extractedText?: string; // For documents
  preview?: string;       // base64 image preview
}
```

### Usage

Defined in [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)

```typescript
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

### StopReason

```typescript
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

### AssistantMessageEvent

Defined in [`packages/ai/src/types.ts`](../packages/ai/src/types.ts)

Streaming events for assistant message generation:

```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

### AgentToolResult

Defined in [`packages/ai/src/agent/types.ts`](../packages/ai/src/agent/types.ts)

```typescript
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

---

## Example Session

### Input

```json
{"type": "prompt", "message": "List files in the current directory"}
```

### Output Stream

```json
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"user","content":"List files in the current directory","timestamp":1733234567890}}
{"type":"message_end","message":{"role":"user","content":"List files in the current directory","timestamp":1733234567890}}
{"type":"message_start","message":{"role":"assistant","content":[],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-5","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1733234567891}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"I'll list","partial":{...}}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":" the files","partial":{...}}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"toolcall_start","contentIndex":1,"partial":{...}}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"toolcall_end","contentIndex":1,"toolCall":{"type":"toolCall","id":"call_123","name":"bash","arguments":{"command":"ls -la"}},"partial":{...}}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"I'll list the files for you."},{"type":"toolCall","id":"call_123","name":"bash","arguments":{"command":"ls -la"}}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-5","usage":{...},"stopReason":"toolUse","timestamp":1733234567891}}
{"type":"tool_execution_start","toolCallId":"call_123","toolName":"bash","args":{"command":"ls -la"}}
{"type":"tool_execution_end","toolCallId":"call_123","toolName":"bash","result":{"content":[{"type":"text","text":"total 48\ndrwxr-xr-x  12 user  staff   384 Dec  3 14:00 .\n..."}],"details":undefined},"isError":false}
{"type":"message_start","message":{"role":"toolResult","toolCallId":"call_123","toolName":"bash","content":[{"type":"text","text":"total 48\n..."}],"isError":false,"timestamp":1733234567900}}
{"type":"message_end","message":{"role":"toolResult","toolCallId":"call_123","toolName":"bash","content":[{"type":"text","text":"total 48\n..."}],"isError":false,"timestamp":1733234567900}}
{"type":"turn_end","message":{...},"toolResults":[{...}]}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"assistant","content":[],...}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Here are the files","partial":{...}}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Here are the files in the current directory:\n..."}],...,"stopReason":"stop",...}}
{"type":"turn_end","message":{...},"toolResults":[]}
{"type":"agent_end","messages":[...]}
```

---

## Example Client

See [`packages/coding-agent/test/rpc-example.ts`](../packages/coding-agent/test/rpc-example.ts) for a complete example of an interactive RPC client.

```typescript
import { spawn } from "node:child_process";
import * as readline from "readline";

// Spawn agent in RPC mode
const agent = spawn("pi", ["--mode", "rpc", "--no-session"]);

// Parse output events
readline.createInterface({ input: agent.stdout }).on("line", (line) => {
  const event = JSON.parse(line);
  
  if (event.type === "message_update") {
    const { assistantMessageEvent } = event;
    if (assistantMessageEvent.type === "text_delta") {
      process.stdout.write(assistantMessageEvent.delta);
    }
  }
  
  if (event.type === "tool_execution_start") {
    console.log(`\n[Tool: ${event.toolName}]`);
  }
});

// Send prompt
agent.stdin.write(JSON.stringify({ type: "prompt", message: "Hello" }) + "\n");

// Abort on Ctrl+C
process.on("SIGINT", () => {
  agent.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
});
```
