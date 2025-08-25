# @mariozechner/ai

Unified API for OpenAI, Anthropic, and Google Gemini LLM providers with streaming, tool calling, and thinking support.

## Installation

```bash
npm install @mariozechner/ai
```

## Quick Start

```typescript
import { AnthropicLLM } from '@mariozechner/ai/providers/anthropic';
import { OpenAICompletionsLLM } from '@mariozechner/ai/providers/openai-completions';
import { GeminiLLM } from '@mariozechner/ai/providers/gemini';

// Pick your provider - same API for all
const llm = new AnthropicLLM('claude-3-5-sonnet-20241022');
// const llm = new OpenAICompletionsLLM('gpt-4o');
// const llm = new GeminiLLM('gemini-2.0-flash-exp');

// Basic completion
const response = await llm.complete({
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.content);

// Streaming with thinking
const streamResponse = await llm.complete({
  messages: [{ role: 'user', content: 'Explain quantum computing' }]
}, {
  onText: (chunk) => process.stdout.write(chunk),
  onThinking: (chunk) => process.stderr.write(chunk),
  thinking: { enabled: true }
});

// Tool calling
const tools = [{
  name: 'calculator',
  description: 'Perform calculations',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string' }
    },
    required: ['expression']
  }
}];

const toolResponse = await llm.complete({
  messages: [{ role: 'user', content: 'What is 15 * 27?' }],
  tools
});

if (toolResponse.toolCalls) {
  for (const call of toolResponse.toolCalls) {
    console.log(`Tool: ${call.name}, Args:`, call.arguments);
  }
}
```

## Features

- **Unified Interface**: Same API across OpenAI, Anthropic, and Gemini
- **Streaming**: Real-time text and thinking streams with completion signals
- **Tool Calling**: Consistent function calling with automatic ID generation
- **Thinking Mode**: Access reasoning tokens (o1, Claude, Gemini 2.0)
- **Token Tracking**: Input, output, cache, and thinking token counts
- **Error Handling**: Graceful fallbacks with detailed error messages

## Providers

| Provider | Models | Thinking | Tools | Streaming |
|----------|--------|----------|-------|-----------|
| OpenAI Completions | gpt-4o, gpt-4o-mini | ❌ | ✅ | ✅ |
| OpenAI Responses | o1, o3, gpt-5 | ✅ | ✅ | ✅ |
| Anthropic | claude-3.5-sonnet, claude-3.5-haiku | ✅ | ✅ | ✅ |
| Gemini | gemini-2.0-flash, gemini-2.0-pro | ✅ | ✅ | ✅ |

## Development

This package is part of the pi monorepo. See the main README for development instructions.

## License

MIT