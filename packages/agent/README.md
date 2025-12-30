# @mariozechner/pi-agent-core

Stateful agent with tool execution, event streaming, and extensible message types. Built on `@mariozechner/pi-ai`.

## Installation

```bash
npm install @mariozechner/pi-agent-core
```

## Quick Start

```typescript
import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';

const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant.',
    model: getModel('anthropic', 'claude-sonnet-4-20250514'),
    thinkingLevel: 'medium',
    tools: []
  }
});

// Subscribe to events for reactive UI updates
agent.subscribe((event) => {
  switch (event.type) {
    case 'message_start':
      console.log(`${event.message.role} message started`);
      break;
    case 'message_update':
      // Only emitted for assistant messages during streaming
      // event.message is partial - may have incomplete content
      for (const block of event.message.content) {
        if (block.type === 'text') process.stdout.write(block.text);
      }
      break;
    case 'message_end':
      console.log(`${event.message.role} message complete`);
      break;
    case 'tool_execution_start':
      console.log(`Calling ${event.toolName}...`);
      break;
    case 'tool_execution_end':
      console.log(`Result:`, event.result.content);
      break;
  }
});

await agent.prompt('Hello, world!');
console.log(agent.state.messages);
```

## AgentMessage vs LLM Message

The agent internally works with `AgentMessage`, a flexible type that can include:
- Standard LLM messages (`user`, `assistant`, `toolResult`)
- Custom app-specific message types (via declaration merging)

LLMs only understand a subset: `user`, `assistant`, and `toolResult` messages with specific content formats. The `convertToLlm` function bridges this gap.

### Why This Separation?

1. **Rich UI state**: Store UI-specific data (attachments metadata, custom message types) alongside the conversation
2. **Session persistence**: Save the full conversation state including app-specific messages
3. **Context manipulation**: Transform messages before sending to LLM (compaction, injection, filtering)

### The Conversion Flow

```
AgentMessage[]  →  transformContext()  →  AgentMessage[]  →  convertToLlm()  →  Message[]  →  LLM
     ↑                (optional)                                (required)
     |
  App state with custom types,
  attachments, UI metadata
```

### Constraints

**Messages passed to `prompt()` or queued via `queueMessage()` must convert to LLM messages with `role: "user"` or `role: "toolResult"`.**

When calling `continue()`, the last message in the context must also convert to `user` or `toolResult`. The LLM expects to respond to a user or tool result, not to its own assistant message.

```typescript
// OK: Standard user message
await agent.prompt('Hello');

// OK: Custom type that converts to user message
await agent.prompt({ role: 'hookMessage', content: 'System notification', timestamp: Date.now() });
// But convertToLlm must handle this:
convertToLlm: (messages) => messages.map(m => {
  if (m.role === 'hookMessage') {
    return { role: 'user', content: m.content, timestamp: m.timestamp };
  }
  return m;
})

// ERROR: Cannot prompt with assistant message
await agent.prompt({ role: 'assistant', content: [...], ... }); // Will fail at LLM
```

## Agent Options

```typescript
interface AgentOptions {
  initialState?: Partial<AgentState>;

  // Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
  // Default: filters to user/assistant/toolResult and converts image attachments.
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  // Transform context before convertToLlm (for pruning, compaction, injecting context)
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  // Queue mode: 'all' sends all queued messages, 'one-at-a-time' sends one per turn
  queueMode?: 'all' | 'one-at-a-time';

  // Custom stream function (for proxy backends). Default: streamSimple from pi-ai
  streamFn?: StreamFn;

  // Dynamic API key resolution (useful for expiring OAuth tokens)
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
}
```

## Agent State

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;  // 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  tools: AgentTool<any>[];
  messages: AgentMessage[];      // Full conversation including custom types
  isStreaming: boolean;
  streamMessage: AgentMessage | null;  // Current partial message during streaming
  pendingToolCalls: Set<string>;
  error?: string;
}
```

## Events

Events provide fine-grained lifecycle information for building reactive UIs.

### Event Types

| Event | Description |
|-------|-------------|
| `agent_start` | Agent begins processing |
| `agent_end` | Agent completes, contains all generated messages |
| `turn_start` | New turn begins (one LLM response + tool executions) |
| `turn_end` | Turn completes with assistant message and tool results |
| `message_start` | Message begins (user, assistant, or toolResult) |
| `message_update` | **Assistant messages only.** Partial message during streaming |
| `message_end` | Message completes |
| `tool_execution_start` | Tool begins execution |
| `tool_execution_update` | Tool streams progress |
| `tool_execution_end` | Tool completes with result |

### Message Events for prompt() and queueMessage()

When you call `prompt(message)`, the agent emits `message_start` and `message_end` events for that message before the assistant responds:

```
prompt(userMessage)
  → agent_start
  → turn_start
  → message_start { message: userMessage }
  → message_end { message: userMessage }
  → message_start { message: assistantMessage }  // LLM starts responding
  → message_update { message: partialAssistant } // streaming...
  → message_end { message: assistantMessage }
  ...
```

Queued messages (via `queueMessage()`) emit the same events when injected:

```
// During tool execution, a message is queued
agent.queueMessage(interruptMessage)

// After tool completes, before next LLM call:
  → message_start { message: interruptMessage }
  → message_end { message: interruptMessage }
  → message_start { message: assistantMessage }  // LLM responds to interrupt
  ...
```

### Handling Partial Messages in Reactive UIs

`message_update` events contain partial assistant messages during streaming. The `event.message` may have:
- Incomplete text (truncated mid-word)
- Partial tool call arguments
- Missing content blocks that haven't started streaming yet

**Pattern for reactive UIs:**

```typescript
agent.subscribe((event) => {
  switch (event.type) {
    case 'message_start':
      if (event.message.role === 'assistant') {
        // Create placeholder in UI
        ui.addMessage({ id: tempId, role: 'assistant', content: [] });
      }
      break;

    case 'message_update':
      // Replace placeholder content with partial content
      // This is only emitted for assistant messages
      ui.updateMessage(tempId, event.message.content);
      break;

    case 'message_end':
      if (event.message.role === 'assistant') {
        // Finalize with complete message
        ui.finalizeMessage(tempId, event.message);
      }
      break;
  }
});
```

**Accessing the current partial message:**

During streaming, `agent.state.streamMessage` contains the current partial message. This is useful for rendering outside the event handler:

```typescript
// In a render loop or reactive binding
if (agent.state.isStreaming && agent.state.streamMessage) {
  renderPartialMessage(agent.state.streamMessage);
}
```

## Custom Message Types

Extend `AgentMessage` for app-specific messages via declaration merging:

```typescript
declare module '@mariozechner/pi-agent-core' {
  interface CustomAgentMessages {
    artifact: { role: 'artifact'; code: string; language: string; timestamp: number };
    notification: { role: 'notification'; text: string; timestamp: number };
  }
}

// AgentMessage now includes your custom types
const msg: AgentMessage = { role: 'artifact', code: '...', language: 'typescript', timestamp: Date.now() };
```

Custom messages are stored in state but filtered out by the default `convertToLlm`. Provide your own converter to handle them:

```typescript
const agent = new Agent({
  convertToLlm: (messages) => {
    return messages
      .filter(m => m.role !== 'notification')  // Filter out UI-only messages
      .map(m => {
        if (m.role === 'artifact') {
          // Convert to user message so LLM sees the artifact
          return { role: 'user', content: `[Artifact: ${m.language}]\n${m.code}`, timestamp: m.timestamp };
        }
        return m;
      });
  }
});
```

## Message Queue

Queue messages to inject at the next turn:

```typescript
agent.setQueueMode('one-at-a-time');

// Queue while agent is streaming
agent.queueMessage({
  role: 'user',
  content: 'Stop what you are doing and focus on this instead.',
  timestamp: Date.now()
});
```

When queued messages are detected after a tool call, remaining tool calls are skipped with error results ("Skipped due to queued user message"). The queued message is then injected before the next assistant response.

## Images

User messages can include images:

```typescript
await agent.prompt('What is in this image?', [
  { type: 'image', data: base64ImageData, mimeType: 'image/jpeg' }
]);
```

## Proxy Usage

For browser apps that need to proxy through a backend, use `streamProxy`:

```typescript
import { Agent, streamProxy } from '@mariozechner/pi-agent-core';

const agent = new Agent({
  streamFn: (model, context, options) => streamProxy(
    '/api/agent',
    model,
    context,
    options,
    { 'Authorization': 'Bearer ...' }
  )
});
```

## Low-Level API

For more control, use `agentLoop` and `agentLoopContinue` directly:

```typescript
import { agentLoop, agentLoopContinue, AgentContext, AgentLoopConfig } from '@mariozechner/pi-agent-core';
import { getModel, streamSimple } from '@mariozechner/pi-ai';

const context: AgentContext = {
  systemPrompt: 'You are helpful.',
  messages: [],
  tools: [myTool]
};

const config: AgentLoopConfig = {
  model: getModel('openai', 'gpt-4o-mini'),
  convertToLlm: (msgs) => msgs.filter(m => ['user', 'assistant', 'toolResult'].includes(m.role))
};

const userMessage = { role: 'user', content: 'Hello', timestamp: Date.now() };

for await (const event of agentLoop(userMessage, context, config, undefined, streamSimple)) {
  console.log(event.type);
}

// Continue from existing context (e.g., after overflow recovery)
// Last message in context must convert to 'user' or 'toolResult'
for await (const event of agentLoopContinue(context, config, undefined, streamSimple)) {
  console.log(event.type);
}
```

## API Reference

### Agent Methods

| Method | Description |
|--------|-------------|
| `prompt(text, images?)` | Send a user prompt with optional images |
| `prompt(message)` | Send an AgentMessage directly (must convert to user/toolResult) |
| `continue()` | Continue from current context (last message must convert to user/toolResult) |
| `abort()` | Abort current operation |
| `waitForIdle()` | Promise that resolves when agent is idle |
| `reset()` | Clear all messages and state |
| `subscribe(fn)` | Subscribe to events, returns unsubscribe function |
| `queueMessage(msg)` | Queue message for next turn (must convert to user/toolResult) |
| `clearMessageQueue()` | Clear queued messages |

### State Mutators

| Method | Description |
|--------|-------------|
| `setSystemPrompt(v)` | Update system prompt |
| `setModel(m)` | Switch model |
| `setThinkingLevel(l)` | Set reasoning level |
| `setQueueMode(m)` | Set queue mode |
| `setTools(t)` | Update available tools |
| `replaceMessages(ms)` | Replace all messages |
| `appendMessage(m)` | Append a message |
| `clearMessages()` | Clear all messages |

## License

MIT
