# @mariozechner/ai

Unified API for OpenAI, Anthropic, and Google Gemini LLM providers. This package provides a common interface for working with multiple LLM providers, handling their differences transparently while exposing a consistent, minimal API.

## Features (Planned)

- **Unified Interface**: Single API for OpenAI, Anthropic, and Google Gemini
- **Streaming Support**: Real-time response streaming with delta events
- **Tool Calling**: Consistent tool/function calling across providers
- **Reasoning/Thinking**: Support for reasoning tokens where available
- **Session Management**: Serializable conversation state across providers
- **Token Tracking**: Unified token counting (input, output, cached, reasoning)
- **Interrupt Handling**: Graceful cancellation of requests
- **Provider Detection**: Automatic configuration based on endpoint
- **Caching Support**: Provider-specific caching strategies

## Installation

```bash
npm install @mariozechner/ai
```

## Quick Start (Coming Soon)

```typescript
import { createClient } from '@mariozechner/ai';

// Automatically detects provider from configuration
const client = createClient({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4'
});

// Same API works for all providers
const response = await client.complete({
  messages: [
    { role: 'user', content: 'Hello!' }
  ],
  stream: true
});

for await (const event of response) {
  if (event.type === 'content') {
    process.stdout.write(event.text);
  }
}
```

## Supported Providers

- **OpenAI**: GPT-3.5, GPT-4, o1, o3 models
- **Anthropic**: Claude models via native SDK
- **Google Gemini**: Gemini models with thinking support

## Development

This package is part of the pi monorepo. See the main README for development instructions.

## License

MIT