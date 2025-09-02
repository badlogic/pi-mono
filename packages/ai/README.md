# @mariozechner/pi-ai

Unified LLM API with automatic model discovery, provider configuration, token and cost tracking, and simple context persistence and hand-off to other models mid-session.

**Note**: This library only includes models that support tool calling (function calling), as this is essential for agentic workflows.

## Supported Providers

- **OpenAI**
- **Anthropic**
- **Google**
- **Groq**
- **Cerebras**
- **xAI**
- **OpenRouter**
- **Any OpenAI-compatible API**: Ollama, vLLM, LM Studio, etc.

## Installation

```bash
npm install @mariozechner/pi-ai
```

## Quick Start

```typescript
import { getModel, stream, complete, Context, Tool } from '@mariozechner/pi-ai';

// Fully typed with auto-complete support for both providers and models
const model = getModel('openai', 'gpt-4o-mini');

// Define tools
const tools: Tool[] = [{
  name: 'get_time',
  description: 'Get the current time',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
}];

// Build a conversation context (easily serializable and transferable between models)
const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'What time is it?' }],
  tools
};

// Option 1: Streaming with all event types
const s = stream(model, context);

for await (const event of s) {
  switch (event.type) {
    case 'start':
      console.log(`Starting with ${event.partial.model}`);
      break;
    case 'text_start':
      console.log('\n[Text started]');
      break;
    case 'text_delta':
      process.stdout.write(event.delta);
      break;
    case 'text_end':
      console.log('\n[Text ended]');
      break;
    case 'thinking_start':
      console.log('[Model is thinking...]');
      break;
    case 'thinking_delta':
      process.stdout.write(event.delta);
      break;
    case 'thinking_end':
      console.log('[Thinking complete]');
      break;
    case 'toolCall':
      console.log(`\nTool called: ${event.toolCall.name}`);
      break;
    case 'done':
      console.log(`\nFinished: ${event.reason}`);
      break;
    case 'error':
      console.error(`Error: ${event.error}`);
      break;
  }
}

// Get the final message after streaming, add it to the context
const finalMessage = await s.finalMessage();
context.messages.push(finalMessage);

// Handle tool calls if any
const toolCalls = finalMessage.content.filter(b => b.type === 'toolCall');
for (const call of toolCalls) {
  // Execute the tool
  const result = call.name === 'get_time'
    ? new Date().toISOString()
    : 'Unknown tool';

  // Add tool result to context
  context.messages.push({
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: result,
    isError: false
  });
}

// Continue if there were tool calls
if (toolCalls.length > 0) {
  const continuation = await complete(model, context);
  context.messages.push(continuation);
  console.log('After tool execution:', continuation.content);
}

console.log(`Total tokens: ${finalMessage.usage.input} in, ${finalMessage.usage.output} out`);
console.log(`Cost: $${finalMessage.usage.cost.total.toFixed(4)}`);

// Option 2: Get complete response without streaming
const response = await complete(model, context);

for (const block of response.content) {
  if (block.type === 'text') {
    console.log(block.text);
  } else if (block.type === 'toolCall') {
    console.log(`Tool: ${block.name}(${JSON.stringify(block.arguments)})`);
  }
}
```

## Image Input

Models with vision capabilities can process images. You can check if a model supports images via the `input` property. If you pass images to a non-vision model, they are silently ignored.

```typescript
import { readFileSync } from 'fs';
import { getModel, complete } from '@mariozechner/pi-ai';

const model = getModel('openai', 'gpt-4o-mini');

// Check if model supports images
if (model.input.includes('image')) {
  console.log('Model supports vision');
}

const imageBuffer = readFileSync('image.png');
const base64Image = imageBuffer.toString('base64');

const response = await complete(model, {
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image', data: base64Image, mimeType: 'image/png' }
    ]
  }]
});

// Access the response
for (const block of response.content) {
  if (block.type === 'text') {
    console.log(block.text);
  }
}
```

## Thinking/Reasoning

Many models support thinking/reasoning capabilities where they can show their internal thought process. You can check if a model supports reasoning via the `reasoning` property. If you pass reasoning options to a non-reasoning model, they are silently ignored.

### Unified Interface (streamSimple/completeSimple)

```typescript
import { getModel, streamSimple, completeSimple } from '@mariozechner/pi-ai';

// Many models across providers support thinking/reasoning
const model = getModel('anthropic', 'claude-sonnet-4-20250514');
// or getModel('openai', 'gpt-5-mini');
// or getModel('google', 'gemini-2.5-flash');
// or getModel('xai', 'grok-code-fast-1');
// or getModel('groq', 'openai/gpt-oss-20b');
// or getModel('cerebras', 'gpt-oss-120b');
// or getModel('openrouter', 'z-ai/glm-4.5v');

// Check if model supports reasoning
if (model.reasoning) {
  console.log('Model supports reasoning/thinking');
}

// Use the simplified reasoning option
const response = await completeSimple(model, {
  messages: [{ role: 'user', content: 'Solve: 2x + 5 = 13' }]
}, {
  reasoning: 'medium'  // 'minimal' | 'low' | 'medium' | 'high'
});

// Access thinking and text blocks
for (const block of response.content) {
  if (block.type === 'thinking') {
    console.log('Thinking:', block.thinking);
  } else if (block.type === 'text') {
    console.log('Response:', block.text);
  }
}
```

### Provider-Specific Options (stream/complete)

For fine-grained control, use the provider-specific options:

```typescript
import { getModel, complete } from '@mariozechner/pi-ai';

// OpenAI Reasoning (o1, o3, gpt-5)
const openaiModel = getModel('openai', 'gpt-5-mini');
await complete(openaiModel, context, {
  reasoningEffort: 'medium',
  reasoningSummary: 'detailed'  // OpenAI Responses API only
});

// Anthropic Thinking (Claude Sonnet 4)
const anthropicModel = getModel('anthropic', 'claude-sonnet-4-20250514');
await complete(anthropicModel, context, {
  thinkingEnabled: true,
  thinkingBudgetTokens: 8192  // Optional token limit
});

// Google Gemini Thinking
const googleModel = getModel('google', 'gemini-2.5-flash');
await complete(googleModel, context, {
  thinking: {
    enabled: true,
    budgetTokens: 8192  // -1 for dynamic, 0 to disable
  }
});
```

### Streaming Thinking Content

When streaming, thinking content is delivered through specific events:

```typescript
const s = streamSimple(model, context, { reasoning: 'high' });

for await (const event of s) {
  switch (event.type) {
    case 'thinking_start':
      console.log('[Model started thinking]');
      break;
    case 'thinking_delta':
      process.stdout.write(event.delta);  // Stream thinking content
      break;
    case 'thinking_end':
      console.log('\n[Thinking complete]');
      break;
  }
}
```

## Errors & Abort Signal

When a request ends with an error (including aborts), the API returns an `AssistantMessage` with:
- `stopReason: 'error'` - Indicates the request ended with an error
- `error: string` - Error message describing what happened
- `content: array` - **Partial content** accumulated before the error
- `usage: Usage` - **Token counts and costs** (may be incomplete depending on when error occurred)

### Aborting
The abort signal allows you to cancel in-progress requests. Aborted requests return an `AssistantMessage` with `stopReason === 'error'`.

```typescript
import { getModel, stream } from '@mariozechner/pi-ai';

const model = getModel('openai', 'gpt-4o-mini');
const controller = new AbortController();

// Abort after 2 seconds
setTimeout(() => controller.abort(), 2000);

const s = stream(model, {
  messages: [{ role: 'user', content: 'Write a long story' }]
}, {
  signal: controller.signal
});

for await (const event of s) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'error') {
    console.log('Error:', event.error);
  }
}

// Get results (may be partial if aborted)
const response = await s.finalMessage();
if (response.stopReason === 'error') {
  console.log('Error:', response.error);
  console.log('Partial content received:', response.content);
  console.log('Tokens used:', response.usage);
}
```

### Continuing After Abort

Aborted messages can be added to the conversation context and continued in subsequent requests:

```typescript
const context = {
  messages: [
    { role: 'user', content: 'Explain quantum computing in detail' }
  ]
};

// First request gets aborted after 2 seconds
const controller1 = new AbortController();
setTimeout(() => controller1.abort(), 2000);

const partial = await complete(model, context, { signal: controller1.signal });

// Add the partial response to context
context.messages.push(partial);
context.messages.push({ role: 'user', content: 'Please continue' });

// Continue the conversation
const continuation = await complete(model, context);
```

## APIs, Models, and Providers

The library implements 4 API interfaces, each with its own streaming function and options:

- **`anthropic-messages`**: Anthropic's Messages API (`streamAnthropic`, `AnthropicOptions`)
- **`google-generative-ai`**: Google's Generative AI API (`streamGoogle`, `GoogleOptions`)
- **`openai-completions`**: OpenAI's Chat Completions API (`streamOpenAICompletions`, `OpenAICompletionsOptions`)
- **`openai-responses`**: OpenAI's Responses API (`streamOpenAIResponses`, `OpenAIResponsesOptions`)

### Providers and Models

A **provider** offers models through a specific API. For example:
- **Anthropic** models use the `anthropic-messages` API
- **Google** models use the `google-generative-ai` API
- **OpenAI** models use the `openai-responses` API
- **xAI, Cerebras, Groq, etc.** models use the `openai-completions` API (OpenAI-compatible)

### Querying Providers and Models

```typescript
import { getProviders, getModels, getModel } from '@mariozechner/pi-ai';

// Get all available providers
const providers = getProviders();
console.log(providers); // ['openai', 'anthropic', 'google', 'xai', 'groq', ...]

// Get all models from a provider (fully typed)
const anthropicModels = getModels('anthropic');
for (const model of anthropicModels) {
  console.log(`${model.id}: ${model.name}`);
  console.log(`  API: ${model.api}`); // 'anthropic-messages'
  console.log(`  Context: ${model.contextWindow} tokens`);
  console.log(`  Vision: ${model.input.includes('image')}`);
  console.log(`  Reasoning: ${model.reasoning}`);
}

// Get a specific model (both provider and model ID are auto-completed in IDEs)
const model = getModel('openai', 'gpt-4o-mini');
console.log(`Using ${model.name} via ${model.api} API`);
```

### Custom Models

You can create custom models for local inference servers or custom endpoints:

```typescript
import { Model, stream } from '@mariozechner/pi-ai';

// Example: Ollama using OpenAI-compatible API
const ollamaModel: Model<'openai-completions'> = {
  id: 'llama-3.1-8b',
  name: 'Llama 3.1 8B (Ollama)',
  api: 'openai-completions',
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000
};

// Use the custom model
const response = await stream(ollamaModel, context, {
  apiKey: 'dummy' // Ollama doesn't need a real key
});
```

### Type Safety

Models are typed by their API, ensuring type-safe options:

```typescript
// TypeScript knows this is an Anthropic model
const claude = getModel('anthropic', 'claude-sonnet-4-20250514');

// So these options are type-checked for AnthropicOptions
await stream(claude, context, {
  thinkingEnabled: true,      // ✓ Valid for anthropic-messages
  thinkingBudgetTokens: 2048, // ✓ Valid for anthropic-messages
  // reasoningEffort: 'high'  // ✗ TypeScript error: not valid for anthropic-messages
});
```

## Cross-Provider Handoffs

The library supports seamless handoffs between different LLM providers within the same conversation. This allows you to switch models mid-conversation while preserving context, including thinking blocks, tool calls, and tool results.

### How It Works

When messages from one provider are sent to a different provider, the library automatically transforms them for compatibility:

- **User and tool result messages** are passed through unchanged
- **Assistant messages from the same provider/API** are preserved as-is
- **Assistant messages from different providers** have their thinking blocks converted to text with `<thinking>` tags
- **Tool calls and regular text** are preserved unchanged

### Example: Multi-Provider Conversation

```typescript
import { getModel, complete, Context } from '@mariozechner/pi-ai';

// Start with Claude
const claude = getModel('anthropic', 'claude-sonnet-4-20250514');
const context: Context = {
  messages: []
};

context.messages.push({ role: 'user', content: 'What is 25 * 18?' });
const claudeResponse = await complete(claude, context, {
  thinkingEnabled: true
});
context.messages.push(claudeResponse);

// Switch to GPT-5 - it will see Claude's thinking as <thinking> tagged text
const gpt5 = getModel('openai', 'gpt-5-mini');
context.messages.push({ role: 'user', content: 'Is that calculation correct?' });
const gptResponse = await complete(gpt5, context);
context.messages.push(gptResponse);

// Switch to Gemini
const gemini = getModel('google', 'gemini-2.5-flash');
context.messages.push({ role: 'user', content: 'What was the original question?' });
const geminiResponse = await complete(gemini, context);
```

### Provider Compatibility

All providers can handle messages from other providers, including:
- Text content
- Tool calls and tool results
- Thinking/reasoning blocks (transformed to tagged text for cross-provider compatibility)
- Aborted messages with partial content

This enables flexible workflows where you can:
- Start with a fast model for initial responses
- Switch to a more capable model for complex reasoning
- Use specialized models for specific tasks
- Maintain conversation continuity across provider outages

## Context Serialization

The `Context` object can be easily serialized and deserialized using standard JSON methods, making it simple to persist conversations, implement chat history, or transfer contexts between services:

```typescript
import { Context, getModel, complete } from '@mariozechner/pi-ai';

// Create and use a context
const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [
    { role: 'user', content: 'What is TypeScript?' }
  ]
};

const model = getModel('openai', 'gpt-4o-mini');
const response = await complete(model, context);
context.messages.push(response);

// Serialize the entire context
const serialized = JSON.stringify(context);
console.log('Serialized context size:', serialized.length, 'bytes');

// Save to database, localStorage, file, etc.
localStorage.setItem('conversation', serialized);

// Later: deserialize and continue the conversation
const restored: Context = JSON.parse(localStorage.getItem('conversation')!);
restored.messages.push({ role: 'user', content: 'Tell me more about its type system' });

// Continue with any model
const newModel = getModel('anthropic', 'claude-3-5-haiku-20241022');
const continuation = await complete(newModel, restored);
```

> **Note**: If the context contains images (encoded as base64 as shown in the Image Input section), those will also be serialized.

## Browser Usage

The library supports browser environments. You must pass the API key explicitly since environment variables are not available in browsers:

```typescript
import { getModel, complete } from '@mariozechner/pi-ai';

// API key must be passed explicitly in browser
const model = getModel('anthropic', 'claude-3-5-haiku-20241022');

const response = await complete(model, {
  messages: [{ role: 'user', content: 'Hello!' }]
}, {
  apiKey: 'your-api-key'
});
```

> **Security Warning**: Exposing API keys in frontend code is dangerous. Anyone can extract and abuse your keys. Only use this approach for internal tools or demos. For production applications, use a backend proxy that keeps your API keys secure.

### Environment Variables (Node.js only)

In Node.js environments, you can set environment variables to avoid passing API keys:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
GROQ_API_KEY=gsk_...
CEREBRAS_API_KEY=csk-...
XAI_API_KEY=xai-...
OPENROUTER_API_KEY=sk-or-...
```

When set, the library automatically uses these keys:

```typescript
// Uses OPENAI_API_KEY from environment
const model = getModel('openai', 'gpt-4o-mini');
const response = await complete(model, context);

// Or override with explicit key
const response = await complete(model, context, {
  apiKey: 'sk-different-key'
});
```

## License

MIT