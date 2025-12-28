# Changelog

## [Unreleased]

### Breaking Changes

- **Transport abstraction removed**: `ProviderTransport`, `AppTransport`, and `AgentTransport` interface have been removed. The `Agent` class now takes a `streamFn` option directly for custom streaming implementations.

- **Agent options renamed**:
  - `transport` → removed (use `streamFn` instead)
  - `messageTransformer` → `convertToLlm` (converts `AgentMessage[]` to LLM-compatible `Message[]`)
  - `preprocessor` → `transformContext` (transforms `AgentMessage[]` before `convertToLlm`)

- **AppMessage renamed to AgentMessage**: All references to `AppMessage` have been renamed to `AgentMessage` for consistency.

- **Agent loop moved from pi-ai**: The `agentLoop`, `agentLoopContinue`, and related types (`AgentContext`, `AgentEvent`, `AgentTool`, `AgentToolResult`, `AgentToolUpdateCallback`, `AgentLoopConfig`) have moved from `@mariozechner/pi-ai` to this package.

### Added

- **`streamFn` option**: Pass a custom stream function to the Agent for proxy backends or custom implementations. Default uses `streamSimple` from pi-ai.

- **`streamProxy` utility**: New helper function for browser apps that need to proxy through a backend server. Replaces `AppTransport`.

- **`getApiKey` option**: Dynamic API key resolution for expiring OAuth tokens (e.g., GitHub Copilot).

- **`AgentLoopContext` and `AgentLoopConfig`**: Exported types for the low-level agent loop API.

- **`agentLoop` and `agentLoopContinue`**: Low-level functions for running the agent loop directly without the `Agent` class wrapper.

### Migration Guide

**Before (0.30.x):**
```typescript
import { Agent, ProviderTransport } from '@mariozechner/pi-agent-core';

const agent = new Agent({
  transport: new ProviderTransport({ apiKey: '...' }),
  messageTransformer: (messages) => messages.filter(...),
  preprocessor: async (messages) => compactMessages(messages)
});
```

**After:**
```typescript
import { Agent } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';

const agent = new Agent({
  streamFn: streamSimple,  // or omit for default
  convertToLlm: (messages) => messages.filter(...),
  transformContext: async (messages) => compactMessages(messages),
  getApiKey: async (provider) => resolveApiKey(provider)
});
```

**For proxy usage (replaces AppTransport):**
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
