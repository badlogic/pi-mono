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
const llm = new AnthropicLLM('claude-sonnet-4-0');
// const llm = new OpenAICompletionsLLM('gpt-5-mini');
// const llm = new GeminiLLM('gemini-2.5-flash');

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
  // Provider specific config
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

## Development

This package is part of the pi monorepo. See the main README for development instructions.

## License

MIT