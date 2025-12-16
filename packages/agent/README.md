# @mariozechner/pi-agent-core

Stateful agent abstraction with transport layer for LLM interactions. Provides a reactive `Agent` class that manages conversation state, emits granular events, and supports pluggable transports for different deployment scenarios.

## Installation

```bash
npm install @mariozechner/pi-agent-core
```

## Quick Start

```typescript
import { Agent, ProviderTransport } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';

// Create agent with direct provider transport
const agent = new Agent({
  transport: new ProviderTransport(),
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
    case 'message_update':
      // Stream text to UI
      const content = event.message.content;
      for (const block of content) {
        if (block.type === 'text') console.log(block.text);
      }
      break;
    case 'tool_execution_start':
      console.log(`Calling ${event.toolName}...`);
      break;
    case 'tool_execution_update':
      // Stream tool output (e.g., bash stdout)
      console.log('Progress:', event.partialResult.content);
      break;
    case 'tool_execution_end':
      console.log(`Result:`, event.result.content);
      break;
  }
});

// Send a prompt
await agent.prompt('Hello, world!');

// Access conversation state
console.log(agent.state.messages);
```

## Core Concepts

### Agent State

The `Agent` maintains reactive state:

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;  // 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  tools: AgentTool<any>[];
  messages: AppMessage[];
  isStreaming: boolean;
  streamMessage: Message | null;
  pendingToolCalls: Set<string>;
  error?: string;
}
```

### Events

Events provide fine-grained lifecycle information:

| Event | Description |
|-------|-------------|
| `agent_start` | Agent begins processing |
| `agent_end` | Agent completes, contains all generated messages |
| `turn_start` | New turn begins (one LLM response + tool executions) |
| `turn_end` | Turn completes with assistant message and tool results |
| `message_start` | Message begins (user, assistant, or toolResult) |
| `message_update` | Assistant message streaming update |
| `message_end` | Message completes |
| `tool_execution_start` | Tool begins execution |
| `tool_execution_update` | Tool streams progress (e.g., bash output) |
| `tool_execution_end` | Tool completes with result |

### Transports

Transports abstract LLM communication:

- **`ProviderTransport`**: Direct API calls using `@mariozechner/pi-ai`
- **`AppTransport`**: Proxy through a backend server (for browser apps)

```typescript
// Direct provider access (Node.js)
const agent = new Agent({
  transport: new ProviderTransport({
    apiKey: process.env.ANTHROPIC_API_KEY
  })
});

// Via proxy (browser)
const agent = new Agent({
  transport: new AppTransport({
    endpoint: '/api/agent',
    headers: { 'Authorization': 'Bearer ...' }
  })
});
```

## Message Queue

Queue messages to inject at the next turn:

```typescript
// Queue mode: 'all' or 'one-at-a-time'
agent.setQueueMode('one-at-a-time');

// Queue a message while agent is streaming
await agent.queueMessage({
  role: 'user',
  content: 'Additional context...',
  timestamp: Date.now()
});
```

## Attachments

User messages can include attachments:

```typescript
await agent.prompt('What is in this image?', [{
  id: 'img1',
  type: 'image',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 102400,
  content: base64ImageData
}]);
```

## Custom Message Types

Extend `AppMessage` for app-specific messages via declaration merging:

```typescript
declare module '@mariozechner/pi-agent-core' {
  interface CustomMessages {
    artifact: { role: 'artifact'; code: string; language: string };
  }
}

// Now AppMessage includes your custom type
const msg: AppMessage = { role: 'artifact', code: '...', language: 'typescript' };
```

## API Reference

### Agent Methods

| Method | Description |
|--------|-------------|
| `prompt(text, attachments?)` | Send a user prompt |
| `continue()` | Continue from current context (for retry after overflow) |
| `abort()` | Abort current operation |
| `waitForIdle()` | Returns promise that resolves when agent is idle |
| `reset()` | Clear all messages and state |
| `subscribe(fn)` | Subscribe to events, returns unsubscribe function |
| `queueMessage(msg)` | Queue message for next turn |
| `clearMessageQueue()` | Clear queued messages |

### State Mutators

| Method | Description |
|--------|-------------|
| `setSystemPrompt(v)` | Update system prompt |
| `setModel(m)` | Switch model |
| `setThinkingLevel(l)` | Set reasoning level |
| `setQueueMode(m)` | Set queue mode ('all' or 'one-at-a-time') |
| `setTools(t)` | Update available tools |
| `replaceMessages(ms)` | Replace all messages |
| `appendMessage(m)` | Append a message |
| `clearMessages()` | Clear all messages |

## License

MIT
