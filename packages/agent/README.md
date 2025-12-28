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
    case 'message_update':
      for (const block of event.message.content) {
        if (block.type === 'text') process.stdout.write(block.text);
      }
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

## Agent Options

```typescript
interface AgentOptions {
  initialState?: Partial<AgentState>;

  // Converts AgentMessage[] to LLM-compatible Message[] before each call.
  // Default: filters to user/assistant/toolResult and converts attachments.
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  // Transform context before convertToLlm (for pruning, injecting context, etc.)
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
  messages: AgentMessage[];
  isStreaming: boolean;
  streamMessage: AgentMessage | null;
  pendingToolCalls: Set<string>;
  error?: string;
}
```

## Events

Events provide fine-grained lifecycle information for building reactive UIs:

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
| `tool_execution_update` | Tool streams progress |
| `tool_execution_end` | Tool completes with result |

## Custom Message Types

Extend `AgentMessage` for app-specific messages via declaration merging:

```typescript
declare module '@mariozechner/pi-agent-core' {
  interface CustomMessages {
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
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult')
      .map(m => {
        // Convert custom types or pass through
        if (m.role === 'artifact') {
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

When queued messages are detected after a tool call, remaining tool calls are skipped with error results.

## Attachments

User messages can include attachments (images, documents):

```typescript
await agent.prompt('What is in this image?', [{
  id: 'img1',
  type: 'image',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 102400,
  content: base64ImageData  // base64 without data URL prefix
}]);
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
import { agentLoop, agentLoopContinue, AgentLoopContext, AgentLoopConfig } from '@mariozechner/pi-agent-core';
import { getModel, streamSimple } from '@mariozechner/pi-ai';

const context: AgentLoopContext = {
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
for await (const event of agentLoopContinue(context, config, undefined, streamSimple)) {
  console.log(event.type);
}
```

## API Reference

### Agent Methods

| Method | Description |
|--------|-------------|
| `prompt(text, attachments?)` | Send a user prompt |
| `prompt(message)` | Send an AgentMessage directly |
| `continue()` | Continue from current context |
| `abort()` | Abort current operation |
| `waitForIdle()` | Promise that resolves when agent is idle |
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
| `setQueueMode(m)` | Set queue mode |
| `setTools(t)` | Update available tools |
| `replaceMessages(ms)` | Replace all messages |
| `appendMessage(m)` | Append a message |
| `clearMessages()` | Clear all messages |

## License

MIT
