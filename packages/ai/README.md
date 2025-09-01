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
import { createLLM } from '@mariozechner/pi-ai';

const llm = createLLM('openai', 'gpt-4o-mini');

const response = await llm.generate({
  messages: [{ role: 'user', content: 'Hello!' }]
});

// response.content is an array of content blocks
for (const block of response.content) {
  if (block.type === 'text') {
    console.log(block.text);
  }
}
```

## Image Input

```typescript
import { readFileSync } from 'fs';

const imageBuffer = readFileSync('image.png');
const base64Image = imageBuffer.toString('base64');

const response = await llm.generate({
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image', data: base64Image, mimeType: 'image/png' }
    ]
  }]
});
```

## Tool Calling

```typescript
const tools = [{
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string' }
    },
    required: ['location']
  }
}];

const messages = [];
messages.push({ role: 'user', content: 'What is the weather in Paris?' });

const response = await llm.generate({ messages, tools });
messages.push(response);

// Check for tool calls in the content blocks
const toolCalls = response.content.filter(block => block.type === 'toolCall');

for (const call of toolCalls) {
  // Call your actual function
  const result = await getWeather(call.arguments.location);

  // Add tool result to context
  messages.push({
    role: 'toolResult',
    content: JSON.stringify(result),
    toolCallId: call.id,
    toolName: call.name,
    isError: false
  });
}

if (toolCalls.length > 0) {
  // Continue conversation with tool results
  const followUp = await llm.generate({ messages, tools });
  messages.push(followUp);

  // Print text blocks from the response
  for (const block of followUp.content) {
    if (block.type === 'text') {
      console.log(block.text);
    }
  }
}
```

## Streaming

```typescript
const response = await llm.generate({
  messages: [{ role: 'user', content: 'Write a story' }]
}, {
  onEvent: (event) => {
    switch (event.type) {
      case 'start':
        console.log(`Starting ${event.provider} ${event.model}`);
        break;
      case 'text_start':
        console.log('[Starting text block]');
        break;
      case 'text_delta':
        process.stdout.write(event.delta);
        break;
      case 'text_end':
        console.log(`\n[Text block complete: ${event.content.length} chars]`);
        break;
      case 'thinking_start':
        console.error('[Starting thinking]');
        break;
      case 'thinking_delta':
        process.stderr.write(event.delta);
        break;
      case 'thinking_end':
        console.error(`\n[Thinking complete: ${event.content.length} chars]`);
        break;
      case 'toolCall':
        console.log(`Tool called: ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})`);
        break;
      case 'done':
        console.log(`Completed with reason: ${event.reason}`);
        console.log(`Tokens: ${event.message.usage.input} in, ${event.message.usage.output} out`);
        break;
      case 'error':
        console.error('Error:', event.error);
        break;
    }
  }
});
```

## Abort Signal

The abort signal allows you to cancel in-progress requests. When aborted, providers return partial results accumulated up to the cancellation point, including accurate token counts and cost estimates.

### Basic Usage

```typescript
const controller = new AbortController();

// Abort after 2 seconds
setTimeout(() => controller.abort(), 2000);

const response = await llm.generate({
  messages: [{ role: 'user', content: 'Write a long story' }]
}, {
  signal: controller.signal,
  onEvent: (event) => {
    if (event.type === 'text_delta') {
      process.stdout.write(event.delta);
    }
  }
});

// Check if the request was aborted
if (response.stopReason === 'error' && response.error) {
  console.log('Request was aborted:', response.error);
  console.log('Partial content received:', response.content);
  console.log('Tokens used:', response.usage);
} else {
  console.log('Request completed successfully');
}
```

### Partial Results and Token Tracking

When a request is aborted, the API returns an `AssistantMessage` with:
- `stopReason: 'error'` - Indicates the request was aborted
- `error: string` - Error message describing the abort
- `content: array` - **Partial content** accumulated before the abort
- `usage: object` - **Token counts and costs** (may be incomplete depending on when abort occurred)

```typescript
// Example: User interrupts a long-running request
const controller = new AbortController();
document.getElementById('stop-button').onclick = () => controller.abort();

const response = await llm.generate(context, {
  signal: controller.signal,
  onEvent: (e) => {
    if (e.type === 'text_delta') updateUI(e.delta);
  }
});

// Even if aborted, you get:
// - Partial text that was streamed
// - Token count (may be partial/estimated)
// - Cost calculations (may be incomplete)
console.log(`Generated ${response.content.length} content blocks`);
console.log(`Estimated ${response.usage.output} output tokens`);
console.log(`Estimated cost: $${response.usage.cost.total}`);
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

const partial = await llm.generate(context, { signal: controller1.signal });

// Add the partial response to context
context.messages.push(partial);
context.messages.push({ role: 'user', content: 'Please continue' });

// Continue the conversation
const continuation = await llm.generate(context);
```

When an aborted message (with `stopReason: 'error'`) is resubmitted in the context:
- **OpenAI Responses**: Filters out thinking blocks and tool calls from aborted messages, as API call will fail if incomplete thinking and tool calls are submitted
- **Anthropic, Google, OpenAI Completions**: Send all blocks as-is (text, thinking, tool calls)

## Cross-Provider Handoffs

The library supports seamless handoffs between different LLM providers within the same conversation. This allows you to switch models mid-conversation while preserving context, including thinking blocks, tool calls, and tool results.

### How It Works

When messages from one provider are sent to a different provider, the library automatically transforms them for compatibility:

- **User and tool result messages** are passed through unchanged
- **Assistant messages from the same provider/model** are preserved as-is
- **Assistant messages from different providers** have their thinking blocks converted to text with `<thinking>` tags
- **Tool calls and regular text** are preserved unchanged

### Example: Multi-Provider Conversation

```typescript
import { createLLM } from '@mariozechner/pi-ai';

// Start with Claude
const claude = createLLM('anthropic', 'claude-sonnet-4-0');
const messages = [];

messages.push({ role: 'user', content: 'What is 25 * 18?' });
const claudeResponse = await claude.generate({ messages }, {
  thinking: { enabled: true }
});
messages.push(claudeResponse);

// Switch to GPT-5 - it will see Claude's thinking as <thinking> tagged text
const gpt5 = createLLM('openai', 'gpt-5-mini');
messages.push({ role: 'user', content: 'Is that calculation correct?' });
const gptResponse = await gpt5.generate({ messages });
messages.push(gptResponse);

// Switch to Gemini
const gemini = createLLM('google', 'gemini-2.5-flash');  
messages.push({ role: 'user', content: 'What was the original question?' });
const geminiResponse = await gemini.generate({ messages });
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

## Provider-Specific Options

### OpenAI Reasoning (o1, o3)
```typescript
const llm = createLLM('openai', 'o1-mini');

await llm.generate(context, {
  reasoningEffort: 'medium'  // 'minimal' | 'low' | 'medium' | 'high'
});
```

### Anthropic Thinking
```typescript
const llm = createLLM('anthropic', 'claude-3-5-sonnet-20241022');

await llm.generate(context, {
  thinking: {
    enabled: true,
    budgetTokens: 2048  // Optional thinking token limit
  }
});
```

### Google Gemini Thinking
```typescript
const llm = createLLM('google', 'gemini-2.5-pro');

await llm.generate(context, {
  thinking: { enabled: true }
});
```

## Custom Models

### Local Models (Ollama, vLLM, etc.)
```typescript
import { OpenAICompletionsLLM } from '@mariozechner/pi-ai';

const model = {
  id: 'gpt-oss:20b',
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 126000,
  maxTokens: 32000,
  name: 'Llama 3.1 8B'
};

const llm = new OpenAICompletionsLLM(model, 'dummy-key');
```

### Custom OpenAI-Compatible Endpoints
```typescript
const model = {
  id: 'custom-model',
  provider: 'custom',
  baseUrl: 'https://your-api.com/v1',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 8192,
  name: 'Custom Model'
};

const llm = new OpenAICompletionsLLM(model, 'your-api-key');
```

## Model Discovery

All models in this library support tool calling. Models are automatically fetched from OpenRouter and models.dev APIs at build time.

### List Available Models
```typescript
import { PROVIDERS } from '@mariozechner/pi-ai';

// List all OpenAI models (all support tool calling)
for (const [modelId, model] of Object.entries(PROVIDERS.openai.models)) {
  console.log(`${modelId}: ${model.name}`);
  console.log(`  Context: ${model.contextWindow} tokens`);
  console.log(`  Reasoning: ${model.reasoning}`);
  console.log(`  Vision: ${model.input.includes('image')}`);
  console.log(`  Cost: $${model.cost.input}/$${model.cost.output} per million tokens`);
}

// Find all models with reasoning support
const reasoningModels = [];
for (const provider of Object.values(PROVIDERS)) {
  for (const model of Object.values(provider.models)) {
    if (model.reasoning) {
      reasoningModels.push(model);
    }
  }
}

// Find all vision-capable models
const visionModels = [];
for (const provider of Object.values(PROVIDERS)) {
  for (const model of Object.values(provider.models)) {
    if (model.input.includes('image')) {
      visionModels.push(model);
    }
  }
}
```

### Check Model Capabilities
```typescript
import { getModel } from '@mariozechner/pi-ai';

const model = getModel('openai', 'gpt-4o-mini');
if (model) {
  console.log(`Model: ${model.name}`);
  console.log(`Provider: ${model.provider}`);
  console.log(`Context window: ${model.contextWindow} tokens`);
  console.log(`Max output: ${model.maxTokens} tokens`);
  console.log(`Supports reasoning: ${model.reasoning}`);
  console.log(`Supports images: ${model.input.includes('image')}`);
  console.log(`Input cost: $${model.cost.input} per million tokens`);
  console.log(`Output cost: $${model.cost.output} per million tokens`);
  console.log(`Cache read cost: $${model.cost.cacheRead} per million tokens`);
  console.log(`Cache write cost: $${model.cost.cacheWrite} per million tokens`);
}
```

## Environment Variables

Set these environment variables to use `createLLM` without passing API keys:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
GROQ_API_KEY=gsk_...
CEREBRAS_API_KEY=csk-...
XAI_API_KEY=xai-...
OPENROUTER_API_KEY=sk-or-...
```

When set, you can omit the API key parameter:
```typescript
// Uses OPENAI_API_KEY from environment
const llm = createLLM('openai', 'gpt-4o-mini');

// Or pass explicitly
const llm = createLLM('openai', 'gpt-4o-mini', 'sk-...');
```

## License

MIT