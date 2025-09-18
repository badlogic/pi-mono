# Agent API Rework Plan

## Executive Summary

Complete rewrite of the agent API with no backward compatibility constraints to support:

1. **Granular streaming events** - Fine-grained deltas (`text_delta`, `thinking_delta`, `toolcall_delta`) with clear message boundaries
2. **Streaming tool execution** - Tools can progressively stream output via `AsyncIterable<ToolExecutionEvent>`
3. **Remote tool execution** - Automatically detect remote tools (missing `execute` function) and suspend/resume execution
4. **HTTP-friendly transport** - Minimize data transfer with server-managed sessions and SSE streaming

Key design:
- `AgentEvent` is completely redesigned for granular streaming
- `AgentTool.execute` can return `Promise` or `AsyncIterable` (detected at runtime)
- Clean session-based API: `createSession()` and `execute()`
- `ExecuteStream` with `result()` method for getting pending tool calls
- Server manages all state, client is stateless
- No legacy code or compatibility layers

## Problem Statement

The current agent API has several limitations that prevent it from being used effectively in distributed environments:

1. **Coarse Event Granularity**: `message_update` events send the full message instead of deltas, making HTTP streaming inefficient
2. **Blocking Tool Execution**: Tools must complete execution before any results can be streamed
3. **Local-Only Tools**: Tools must run in the same environment as the `prompt()` call, preventing remote tool execution
4. **No Suspension/Resume**: The API cannot pause execution for external tool handling and resume later

## Requirements

### R1: Fine-Grained Streaming Events
- Stream text deltas, not full messages
- Stream thinking/reasoning deltas
- Stream tool call argument deltas
- Stream tool execution output progressively
- Clear message boundaries with start/end events

### R2: Remote Tool Execution
- Detect remote tools by absence of `execute` function (JSON.stringify naturally omits functions)
- Pause execution when remote tool is called
- Resume execution when remote tool completes
- Support both synchronous (local) and asynchronous (remote) tools

### R3: HTTP-Friendly
- Events should be efficiently serializable for Server-Sent Events (SSE)
- Minimize data transfer - no large context objects in events
- Server manages session state, client sends only deltas

### R4: Minimal API Surface
- Keep the API simple and intuitive
- No backward compatibility constraints - clean slate design
- Avoid complex state management on the client side

## Proposed Solution

### Core Concepts

#### 1. Agent Sessions
Sessions that can be suspended and resumed for remote tool execution:

```typescript
interface AgentSession {
  id: string;
  status: 'running' | 'awaiting_tool_execution' | 'completed' | 'error';
  model: Model;  // Last used model
  messages: Message[];  // Full conversation context
  totalCost: number;  // Accumulated cost across all turns
  pendingToolCalls?: ToolCall[];  // When status is 'awaiting_tool_execution'
}
```

#### 2. Tool Execution
Tools always return an async iterable stream, making the API consistent:

```typescript
type ToolExecutionEventStream = AsyncIterable<ToolExecutionEvent>;

interface AgentTool<TParams = any> extends Tool {
  label: string;  // Already exists
  // If execute is defined -> local tool
  // If execute is undefined (omitted during JSON serialization) -> remote tool
  execute?: (id: string, params: TParams) => ToolExecutionEventStream;
}

// Tool execution event for streaming
type ToolExecutionEvent =
  | { type: 'delta'; delta: string }
  | { type: 'complete'; output: string; details?: any };

// Detection logic remains simple
function isLocalTool(tool: AgentTool): boolean {
  return tool.execute !== undefined;
}
```

#### 3. Message Types
Extend the Message union to handle errors and aborts cleanly:

```typescript
// Extended Message type for cleaner error handling
type Message =
  | UserMessage
  | AssistantMessage  // stopReason: 'stop' | 'length' | 'tool_calls'
  | ToolResultMessage
  | ErrorMessage      // New: explicit error messages
  | AbortedMessage;   // New: explicit abort messages

interface ErrorMessage {
  role: 'error';
  error: string;
  partial?: AssistantMessage;  // Partial message before error
}

interface AbortedMessage {
  role: 'aborted';
  partial: AssistantMessage;  // Partial message before abort
}
```

#### 4. Granular Event System
Fine-grained events with message boundaries:

```typescript
type AgentEvent =
  // Session lifecycle
  | { type: 'session_start'; sessionId: string }
  | { type: 'session_end'; sessionId: string; messages: Message[] }  // Only NEW messages
  | { type: 'awaiting_tool_execution'; sessionId: string; toolCalls: ToolCall[] }

  // Message boundaries (role determined by message.role)
  | { type: 'message_start'; role: Message['role'] }
  | { type: 'message_end'; message: Message }  // Includes usage/cost for assistant messages

  // Assistant streaming (only during assistant messages)
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end'; text: string }

  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end'; thinking: string }

  | { type: 'toolcall_start'; index: number }
  | { type: 'toolcall_delta'; index: number; delta: string }
  | { type: 'toolcall_end'; index: number; toolCall: ToolCall }

  // Tool execution (local tools only)
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool_execution_delta'; toolCallId: string; delta: string }
  | { type: 'tool_execution_end'; toolCallId: string; output: string; details?: any }

  // Errors
  | { type: 'error'; error: string; message?: Message }
```

### New API Design

```typescript
// Create or restore a session
function createSession(
  sessionId: string,
  context: AgentContext,
  options?: PromptOptions  // Model, temperature, etc.
): AgentSession;

// Execute with event streaming
interface ExecuteResult {
  status: 'completed' | 'awaiting_tool_execution';
  messages: Message[];  // New messages added during execution
  pendingToolCalls?: ToolCall[];  // Present when status is 'awaiting_tool_execution'
  cost: number;  // Cost for this execution
}

interface ExecuteStream extends AsyncIterable<AgentEvent> {
  result(): Promise<ExecuteResult>;
}

function execute(
  session: AgentSession,
  input: UserMessage | ToolResultMessage[]
): ExecuteStream;

// Example usage - clean flow without nested loops
const session = createSession('session-123', {
  messages: [],
  tools: [localTool, remoteTool]
});

// Execute and handle events
const stream = execute(session, { role: 'user', content: 'Hello' });
for await (const event of stream) {
  // Handle events for UI updates
  console.log(event);
}

// Check result after stream completes
const result = await stream.result();
if (result.status === 'awaiting_tool_execution') {
  // Execute remote tools externally
  const toolResults = await executeRemoteTools(result.pendingToolCalls);

  // Resume execution with tool results
  const resumeStream = execute(session, toolResults);
  for await (const event of resumeStream) {
    console.log(event);
  }

  const finalResult = await resumeStream.result();
  // Continue until no more pending tools...
}
```

### Tool Execution Streaming

All tools return a `ToolExecutionEventStream` for consistency:

```typescript
// Example streaming tool with progressive output
const streamingSearchTool: AgentTool = {
  name: 'search',
  label: 'Search',
  parameters: Type.Object({ query: Type.String() }),
  async *execute(id, { query }) {
    // Stream deltas as they become available
    yield { type: 'delta', delta: 'Searching for: ' };
    yield { type: 'delta', delta: query };
    yield { type: 'delta', delta: '\nResults:\n' };

    for (const result of await search(query)) {
      yield { type: 'delta', delta: `- ${result.title}\n` };
    }

    // Final complete event with full output and optional details
    yield {
      type: 'complete',
      output: fullOutput,
      details: { resultCount: 10 }
    };
  }
};

// Example simple tool (still returns AsyncIterable for consistency)
const simpleTool: AgentTool = {
  name: 'calculate',
  label: 'Calculate',
  parameters: Type.Object({ expression: Type.String() }),
  async *execute(id, { expression }) {
    const result = eval(expression);  // Don't do this in production!

    // Even simple tools emit complete event
    yield {
      type: 'complete',
      output: `${expression} = ${result}`,
      details: { result }
    };
  }
};

// Helper for simple tools that don't need streaming
function createSimpleTool<TParams>(
  config: Omit<AgentTool<TParams>, 'execute'>,
  handler: (id: string, params: TParams) => Promise<{ output: string; details?: any }>
): AgentTool<TParams> {
  return {
    ...config,
    async *execute(id, params) {
      const result = await handler(id, params);
      yield { type: 'complete', ...result };
    }
  };
}

// Usage with helper
const calculateTool = createSimpleTool(
  {
    name: 'calculate',
    label: 'Calculate',
    parameters: Type.Object({ expression: Type.String() })
  },
  async (id, { expression }) => {
    const result = eval(expression);
    return {
      output: `${expression} = ${result}`,
      details: { result }
    };
  }
);
```

### HTTP Transport Layer

Server manages session state, client only sends inputs:

```typescript
// Server-side session store
class SessionStore {
  private sessions = new Map<string, AgentSession>();

  create(sessionId: string, context: AgentContext, options?: PromptOptions): AgentSession {
    const session = createSession(sessionId, context, options);
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Optional: Get context for UI sync
  getContext(sessionId: string): AgentContext | undefined {
    return this.sessions.get(sessionId)?.messages;
  }
}

// API Endpoints
interface ExecuteRequest {
  sessionId?: string;  // Optional, server generates if not provided
  input: UserMessage | ToolResultMessage[];
  context?: AgentContext;  // Only for new sessions
  options?: PromptOptions;  // Model, temperature, etc.
}

interface ExecuteResponse {
  sessionId: string;
  // SSE stream of AgentEvents
}

// Server implementation
app.post('/api/agent/execute', async (req, res) => {
  const { sessionId = generateId(), input, context, options } = req.body;

  // Get or create session
  let session = sessionStore.get(sessionId);
  if (!session) {
    if (!context) {
      return res.status(400).json({ error: 'Context required for new session' });
    }
    session = sessionStore.create(sessionId, context, options);
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Session-Id': sessionId,  // Return session ID in header
  });

  // Stream events
  const stream = execute(session, input);
  for await (const event of stream) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Get final result
  const result = await stream.result();

  // Send final event with status
  res.write(`data: ${JSON.stringify({
    type: 'execute_complete',
    status: result.status,
    pendingToolCalls: result.pendingToolCalls
  })}\n\n`);

  res.end();
});

// Optional: Get session context for UI sync
app.get('/api/agent/session/:sessionId', (req, res) => {
  const context = sessionStore.getContext(req.params.sessionId);
  if (!context) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ messages: context });
});

// Client implementation
async function executeOnServer(input: UserMessage, tools: AgentTool[]) {
  // Note: tools with execute functions will have them stripped during JSON.stringify
  const response = await fetch('/api/agent/execute', {
    method: 'POST',
    body: JSON.stringify({
      input,
      context: { messages: [], tools },  // Tools without execute = remote
      options: { model: 'gpt-4o-mini' }
    })
  });

  const sessionId = response.headers.get('X-Session-Id');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let pendingToolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const event = JSON.parse(line.slice(6));

        // Update UI with event
        handleEvent(event);

        if (event.type === 'execute_complete' && event.status === 'awaiting_tool_execution') {
          pendingToolCalls = event.pendingToolCalls;
        }
      }
    }
  }

  // Execute remote tools if needed
  if (pendingToolCalls.length > 0) {
    const toolResults = await executeLocalTools(pendingToolCalls);

    // Resume on server
    await fetch('/api/agent/execute', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        input: toolResults
      })
    });
  }
}
```

## Implementation Plan

### Phase 1: Core Event System Refactor
1. Define new granular `AgentEvent` types with message boundaries
2. Update agent loop to detect local vs remote tools (via `execute` presence)
3. Implement `ExecuteStream` with `result()` method
4. Map underlying streaming events to granular agent events

### Phase 2: Session Management
1. Implement `AgentSession` type with status tracking
2. Create `createSession()` and `execute()` functions
3. Handle suspension when remote tools detected
4. Track cost and model per session

### Phase 3: Streaming Tool Execution
1. Define `ToolExecutionEventStream` type alias
2. Update all tools to return `ToolExecutionEventStream`
3. Emit `tool_execution_delta` events during streaming
4. Provide `createSimpleTool` helper for non-streaming tools

### Phase 4: HTTP Transport
1. Implement server-side `SessionStore`
2. Create `/api/agent/execute` endpoint with SSE
3. Add `/api/agent/session/:id` for context sync
4. Build client SDK for SSE consumption

### Phase 5: Documentation & Examples
1. Create comprehensive documentation for new API
2. Build example applications demonstrating all features
3. Add TypeScript types and JSDoc comments
4. Create cookbook for common patterns

## Key Design Decisions

### Why AgentSession Instead of ExecutionSession?
- Clearer naming that matches the agent concept
- Consistent with `AgentContext`, `AgentTool`, `AgentEvent`

### Why Detect Remote Tools via Missing execute?
- JSON.stringify naturally omits functions
- No need for explicit `mode` field
- Zero configuration for remote tools

### Why ExecuteStream with result()?
- Follows the existing EventStream pattern
- Separates streaming (UI updates) from final state
- Clean way to get pending tool calls after streaming

### Why awaiting_tool_execution Instead of suspended?
- More descriptive of the actual state
- Clear indication that client action is required
- Better for debugging and logging

## Clean Break Strategy

Since we're not maintaining backward compatibility, we can:

1. **Remove all legacy code** - No need for wrapper functions or event mappers
2. **Simplify type definitions** - No union types for old/new formats
3. **Optimize for the new use cases** - Design purely for distributed execution
4. **Clear naming** - No need to avoid conflicts with existing names
5. **Breaking changes allowed** - Can restructure packages and exports as needed

This is a complete rewrite of the agent module with a new, cleaner API that fully supports:
- Granular streaming events
- Progressive tool execution
- Remote tool suspension/resumption
- Efficient HTTP transport

## Open Questions

1. **Tool Timeout**: How long should we wait for remote tool execution before timing out?
2. **Session Persistence**: Should sessions be stored in memory or persisted (Redis/DB)?
3. **Tool Chaining**: Can a remote tool trigger another LLM call that uses more tools?
4. **Error Recovery**: How to handle partial tool execution failures?
5. **Rate Limiting**: How to prevent abuse of the HTTP API?
6. **Error/Abort Messages**: Should we use explicit `ErrorMessage`/`AbortedMessage` types or keep errors in `AssistantMessage` with `stopReason: 'error'`? Explicit types are cleaner but add complexity.

## Next Steps

1. Implement Phase 1 - Core event system with granular events
2. Test with existing tools to ensure compatibility
3. Add streaming support to one built-in tool as proof of concept
4. Build minimal HTTP server to validate the design
5. Gather feedback and iterate before full implementation