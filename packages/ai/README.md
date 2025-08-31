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

const response = await llm.complete({
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

const response = await llm.complete({
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

const response = await llm.complete({ messages, tools });
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
  const followUp = await llm.complete({ messages, tools });
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
const response = await llm.complete({
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

```typescript
const controller = new AbortController();

// Abort after 2 seconds
setTimeout(() => controller.abort(), 2000);

const response = await llm.complete({
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
} else {
  console.log('Request completed successfully');
}
```

## Provider-Specific Options

### OpenAI Reasoning (o1, o3)
```typescript
const llm = createLLM('openai', 'o1-mini');

await llm.complete(context, {
  reasoningEffort: 'medium'  // 'minimal' | 'low' | 'medium' | 'high'
});
```

### Anthropic Thinking
```typescript
const llm = createLLM('anthropic', 'claude-3-5-sonnet-20241022');

await llm.complete(context, {
  thinking: {
    enabled: true,
    budgetTokens: 2048  // Optional thinking token limit
  }
});
```

### Google Gemini Thinking
```typescript
const llm = createLLM('google', 'gemini-2.5-pro');

await llm.complete(context, {
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