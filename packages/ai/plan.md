# Unified AI API Design Plan

Based on comprehensive investigation of OpenAI, Anthropic, and Gemini SDKs with actual implementation examples.

## Key API Differences Summary

### OpenAI
- **Dual APIs**: Chat Completions (broad support) vs Responses API (o1/o3 thinking content)
- **Thinking**: Only Responses API gives actual content, Chat Completions only gives counts
- **Roles**: `system`, `user`, `assistant`, `tool` (o1/o3 use `developer` instead of `system`)
- **Streaming**: Deltas in chunks with `stream_options.include_usage` for token usage

### Anthropic
- **Single API**: Messages API with comprehensive streaming
- **Content Blocks**: Always arrays, even for simple text
- **System**: Separate parameter, not in messages array
- **Tool Use**: Content blocks, not separate message role
- **Thinking**: Explicit budget allocation, appears as content blocks
- **Caching**: Per-block cache control with TTL options

### Gemini
- **Parts System**: All content split into typed parts
- **System**: Separate `systemInstruction` parameter
- **Roles**: Uses `model` instead of `assistant`
- **Thinking**: `part.thought: true` flag identifies reasoning
- **Streaming**: Returns complete responses, not deltas
- **Function Calls**: Embedded in parts array

## Unified API Design

### Core Client

```typescript
interface AIConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  apiKey: string;
  model: string;
  baseURL?: string; // For OpenAI-compatible endpoints
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    reasoning: boolean;
    toolCall: boolean;
    vision: boolean;
    audio?: boolean;
  };
  cost: {
    input: number;  // per million tokens
    output: number; // per million tokens
    cacheRead?: number;
    cacheWrite?: number;
  };
  limits: {
    context: number;
    output: number;
  };
  knowledge?: string; // Knowledge cutoff date
}

class AI {
  constructor(config: AIConfig);
  
  // Main streaming interface - everything else builds on this
  async *stream(request: Request): AsyncGenerator<Event>;
  
  // Convenience method for non-streaming
  async complete(request: Request): Promise<Response>;
  
  // Get model information
  getModelInfo(): ModelInfo;
  
  // Abort current request
  abort(): void;
}
```

### Message Format

```typescript
type Message = 
  | {
      role: 'user';
      content: string | Content[];
    }
  | {
      role: 'assistant';
      content: string | Content[];
      model: string;
      usage: TokenUsage;
      toolCalls?: {
        id: string;
        name: string;
        arguments: Record<string, any>;
      }[];
    }
  | {
      role: 'tool';
      content: string | Content[];
      toolCallId: string;
    };

interface Content {
  type: 'text' | 'image';
  text?: string;
  image?: {
    data: string; // base64
    mimeType: string;
  };
}
```

### Request Format

```typescript
interface Request {
  messages: Message[];
  
  // System prompt (separated for Anthropic/Gemini compatibility)
  systemPrompt?: string;
  
  // Common parameters
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  
  // Tools
  tools?: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  }[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  
  // Thinking/reasoning
  reasoning?: {
    enabled: boolean;
    effort?: 'low' | 'medium' | 'high'; // OpenAI reasoning_effort
    maxTokens?: number; // Anthropic thinking budget
  };
  
  // Abort signal
  signal?: AbortSignal;
}
```

### Event Stream

```typescript
type Event =
  | { type: 'start'; model: string; provider: string }
  | { type: 'text'; content: string; delta: string }
  | { type: 'thinking'; content: string; delta: string }
  | { type: 'toolCall'; toolCall: ToolCall }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; reason: StopReason; message: Message } // message includes model and usage
  | { type: 'error'; error: Error };

interface TokenUsage {
  input: number;
  output: number;
  total: number;
  thinking?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: {
    input: number;
    output: number;
    cache?: number;
    total: number;
  };
}

type StopReason = 'stop' | 'length' | 'toolUse' | 'safety' | 'error';
```

## Caching Strategy

Caching is handled automatically by each provider adapter:

- **OpenAI**: Automatic prompt caching (no configuration needed)
- **Gemini**: Automatic context caching (no configuration needed)  
- **Anthropic**: We automatically add cache_control to the system prompt and older messages

```typescript
class AnthropicAdapter {
  private addCaching(messages: Message[]): any[] {
    const anthropicMessages = [];
    
    // Automatically cache older messages (assuming incremental context)
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isOld = i < messages.length - 2; // Cache all but last 2 messages
      
      // Convert to Anthropic format with automatic caching
      const blocks = this.toContentBlocks(msg);
      if (isOld && blocks.length > 0) {
        blocks[0].cache_control = { type: 'ephemeral' };
      }
      
      anthropicMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: blocks
      });
    }
    
    return anthropicMessages;
  }
}
```

## Provider Adapter Implementation

### OpenAI Adapter

```typescript
class OpenAIAdapter {
  private client: OpenAI;
  private useResponsesAPI: boolean = false;
  
  async *stream(request: Request): AsyncGenerator<Event> {
    // Determine which API to use
    if (request.reasoning?.enabled && this.isReasoningModel()) {
      yield* this.streamResponsesAPI(request);
    } else {
      yield* this.streamChatCompletions(request);
    }
  }
  
  private async *streamChatCompletions(request: Request) {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: this.toOpenAIMessages(request),
      tools: this.toOpenAITools(request.tools),
      reasoning_effort: request.reasoning?.effort,
      stream: true,
      stream_options: { include_usage: true }
    });
    
    let content = '';
    let toolCalls: any[] = [];
    
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const delta = chunk.choices[0].delta.content;
        content += delta;
        yield { type: 'text', content, delta };
      }
      
      if (chunk.choices[0]?.delta?.tool_calls) {
        // Accumulate tool calls
        this.mergeToolCalls(toolCalls, chunk.choices[0].delta.tool_calls);
        for (const tc of toolCalls) {
          yield { type: 'toolCall', toolCall: tc, partial: true };
        }
      }
      
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            input: chunk.usage.prompt_tokens,
            output: chunk.usage.completion_tokens,
            total: chunk.usage.total_tokens,
            thinking: chunk.usage.completion_tokens_details?.reasoning_tokens
          }
        };
      }
    }
  }
  
  private async *streamResponsesAPI(request: Request) {
    // Use Responses API for actual thinking content
    const response = await this.client.responses.create({
      model: this.model,
      input: this.toResponsesInput(request),
      tools: this.toResponsesTools(request.tools),
      stream: true
    });
    
    for await (const event of response) {
      if (event.type === 'response.reasoning_text.delta') {
        yield {
          type: 'thinking',
          content: event.text,
          delta: event.delta
        };
      }
      // Handle other event types...
    }
  }
  
  private toOpenAIMessages(request: Request): any[] {
    const messages: any[] = [];
    
    // Handle system prompt
    if (request.systemPrompt) {
      const role = this.isReasoningModel() ? 'developer' : 'system';
      messages.push({ role, content: request.systemPrompt });
    }
    
    // Convert unified messages
    for (const msg of request.messages) {
      if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId
        });
      } else {
        messages.push({
          role: msg.role,
          content: this.contentToString(msg.content),
          tool_calls: msg.toolCalls
        });
      }
    }
    
    return messages;
  }
}
```

### Anthropic Adapter

```typescript
class AnthropicAdapter {
  private client: Anthropic;
  
  async *stream(request: Request): AsyncGenerator<Event> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens || 1024,
      messages: this.addCaching(request.messages),
      system: request.systemPrompt,
      tools: this.toAnthropicTools(request.tools),
      thinking: request.reasoning?.enabled ? {
        type: 'enabled',
        budget_tokens: request.reasoning.maxTokens || 2000
      } : undefined
    });
    
    let content = '';
    let thinking = '';
    
    stream.on('text', (delta, snapshot) => {
      content = snapshot;
      // Note: Can't yield from callback, need different approach
    });
    
    stream.on('thinking', (delta, snapshot) => {
      thinking = snapshot;
    });
    
    // Use raw streaming instead for proper async generator
    const rawStream = await this.client.messages.create({
      ...params,
      stream: true
    });
    
    for await (const chunk of rawStream) {
      switch (chunk.type) {
        case 'content_block_delta':
          if (chunk.delta.type === 'text_delta') {
            content += chunk.delta.text;
            yield {
              type: 'text',
              content,
              delta: chunk.delta.text
            };
          }
          break;
          
        case 'message_delta':
          if (chunk.usage) {
            yield {
              type: 'usage',
              usage: {
                input: chunk.usage.input_tokens,
                output: chunk.usage.output_tokens,
                total: chunk.usage.input_tokens + chunk.usage.output_tokens,
                cacheRead: chunk.usage.cache_read_input_tokens,
                cacheWrite: chunk.usage.cache_creation_input_tokens
              }
            };
          }
          break;
      }
    }
  }
  
  private toAnthropicMessages(request: Request): any[] {
    return request.messages.map(msg => {
      if (msg.role === 'tool') {
        // Tool results go as user messages with tool_result blocks
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: msg.content
          }]
        };
      }
      
      // Always use content blocks
      const blocks: any[] = [];
      
      if (typeof msg.content === 'string') {
        blocks.push({
          type: 'text',
          text: msg.content,
          cache_control: msg.cacheControl
        });
      } else {
        // Convert unified content to blocks
        for (const part of msg.content) {
          if (part.type === 'text') {
            blocks.push({ type: 'text', text: part.text });
          } else if (part.type === 'image') {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: part.image.mimeType,
                data: part.image.data
              }
            });
          }
        }
      }
      
      // Add tool calls as blocks
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments
          });
        }
      }
      
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: blocks
      };
    });
  }
}
```

### Gemini Adapter

```typescript
class GeminiAdapter {
  private client: GoogleGenAI;
  
  async *stream(request: Request): AsyncGenerator<Event> {
    const stream = await this.client.models.generateContentStream({
      model: this.model,
      systemInstruction: request.systemPrompt ? {
        parts: [{ text: request.systemPrompt }]
      } : undefined,
      contents: this.toGeminiContents(request),
      tools: this.toGeminiTools(request.tools),
      abortSignal: request.signal
    });
    
    let content = '';
    let thinking = '';
    
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;
      
      for (const part of candidate.content.parts) {
        if (part.text && !part.thought) {
          content += part.text;
          yield {
            type: 'text',
            content,
            delta: part.text
          };
        } else if (part.text && part.thought) {
          thinking += part.text;
          yield {
            type: 'thinking',
            content: thinking,
            delta: part.text
          };
        } else if (part.functionCall) {
          yield {
            type: 'toolCall',
            toolCall: {
              id: part.functionCall.id || crypto.randomUUID(),
              name: part.functionCall.name,
              arguments: part.functionCall.args
            }
          };
        }
      }
      
      if (chunk.usageMetadata) {
        yield {
          type: 'usage',
          usage: {
            input: chunk.usageMetadata.promptTokenCount || 0,
            output: chunk.usageMetadata.candidatesTokenCount || 0,
            total: chunk.usageMetadata.totalTokenCount || 0,
            thinking: chunk.usageMetadata.thoughtsTokenCount,
            cacheRead: chunk.usageMetadata.cachedContentTokenCount
          }
        };
      }
    }
  }
  
  private toGeminiContents(request: Request): any[] {
    return request.messages.map(msg => {
      const parts: any[] = [];
      
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image') {
            parts.push({
              inlineData: {
                mimeType: part.image.mimeType,
                data: part.image.data
              }
            });
          }
        }
      }
      
      // Add function calls as parts
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments
            }
          });
        }
      }
      
      // Add tool results as function responses
      if (msg.role === 'tool') {
        parts.push({
          functionResponse: {
            name: msg.toolCallId,
            response: { result: msg.content }
          }
        });
      }
      
      return {
        role: msg.role === 'assistant' ? 'model' : msg.role === 'tool' ? 'user' : msg.role,
        parts
      };
    });
  }
}
```

## Usage Examples

### Basic Streaming

```typescript
const ai = new AI({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4'
});

const stream = ai.stream({
  messages: [
    { role: 'user', content: 'Write a haiku about coding' }
  ],
  systemPrompt: 'You are a poetic programmer'
});

for await (const event of stream) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.delta);
      break;
    case 'usage':
      console.log(`\nTokens: ${event.usage.total}`);
      break;
    case 'done':
      console.log(`\nFinished: ${event.reason}`);
      break;
  }
}
```

### Cross-Provider Tool Calling

```typescript
async function callWithTools(provider: 'openai' | 'anthropic' | 'gemini') {
  const ai = new AI({
    provider,
    apiKey: process.env[`${provider.toUpperCase()}_API_KEY`],
    model: getDefaultModel(provider)
  });
  
  const messages: Message[] = [{
    role: 'user',
    content: 'What is the weather in Paris and calculate 15 * 23?'
  }];
  
  const stream = ai.stream({
    messages,
    tools: [
      {
        name: 'weather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          },
          required: ['location']
        }
      },
      {
        name: 'calculator',
        description: 'Calculate math expressions',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string' }
          },
          required: ['expression']
        }
      }
    ]
  });
  
  const toolCalls: any[] = [];
  
  for await (const event of stream) {
    if (event.type === 'toolCall') {
      toolCalls.push(event.toolCall);
      
      // Execute tool
      const result = await executeToolCall(event.toolCall);
      
      // Add tool result to conversation
      messages.push({
        role: 'assistant',
        toolCalls: [event.toolCall]
      });
      
      messages.push({
        role: 'tool',
        content: JSON.stringify(result),
        toolCallId: event.toolCall.id
      });
    }
  }
  
  // Continue conversation with tool results
  if (toolCalls.length > 0) {
    const finalStream = ai.stream({ messages });
    
    for await (const event of finalStream) {
      if (event.type === 'text') {
        process.stdout.write(event.delta);
      }
    }
  }
}
```

### Thinking/Reasoning

```typescript
async function withThinking() {
  // OpenAI o1
  const openai = new AI({
    provider: 'openai',
    model: 'o1-preview'
  });
  
  // Anthropic Claude
  const anthropic = new AI({
    provider: 'anthropic',
    model: 'claude-3-opus-20240229'
  });
  
  // Gemini thinking model
  const gemini = new AI({
    provider: 'gemini',
    model: 'gemini-2.0-flash-thinking-exp-1219'
  });
  
  for (const ai of [openai, anthropic, gemini]) {
    const stream = ai.stream({
      messages: [{
        role: 'user',
        content: 'Solve this step by step: If a tree falls in a forest...'
      }],
      reasoning: {
        enabled: true,
        effort: 'high', // OpenAI reasoning_effort
        maxTokens: 2000 // Anthropic budget
      }
    });
    
    for await (const event of stream) {
      if (event.type === 'thinking') {
        console.log('[THINKING]', event.delta);
      } else if (event.type === 'text') {
        console.log('[RESPONSE]', event.delta);
      } else if (event.type === 'done') {
        // Final message includes model and usage with cost
        console.log('Model:', event.message.model);
        console.log('Tokens:', event.message.usage?.total);
        console.log('Cost: $', event.message.usage?.cost?.total);
      }
    }
  }
}
```

## Implementation Notes

### Critical Decisions

1. **Streaming First**: All providers support streaming, non-streaming is just collected events
2. **Unified Events**: Same event types across all providers for consistent handling
3. **Separate System Prompt**: Required for Anthropic/Gemini compatibility
4. **Tool Role**: Unified way to handle tool responses across providers
5. **Content Arrays**: Support both string and structured content
6. **Thinking Extraction**: Normalize reasoning across different provider formats

### Provider-Specific Handling

**OpenAI**:
- Choose between Chat Completions and Responses API based on model and thinking needs
- Map `developer` role for o1/o3 models
- Handle streaming tool call deltas

**Anthropic**:
- Convert to content blocks (always arrays)
- Tool results as user messages with tool_result blocks
- Handle MessageStream events or raw streaming

**Gemini**:
- Convert to parts system
- Extract thinking from `part.thought` flag
- Map `assistant` to `model` role
- Handle function calls/responses in parts

### Error Handling

```typescript
class AIError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider: string,
    public retryable: boolean,
    public statusCode?: number
  ) {
    super(message);
  }
}

// In adapters
try {
  // API call
} catch (error) {
  if (error instanceof RateLimitError) {
    throw new AIError(
      'Rate limit exceeded',
      'rate_limit',
      this.provider,
      true,
      429
    );
  }
  // Map other errors...
}
```

## Model Information & Cost Tracking

### Models Database

We cache the models.dev API data at build time for fast, offline access:

```typescript
// scripts/update-models.ts - Run during build or manually
async function updateModels() {
  const response = await fetch('https://models.dev/api.json');
  const data = await response.json();
  
  // Transform to our format
  const models: ModelsDatabase = transformModelsData(data);
  
  // Generate TypeScript file
  const content = `// Auto-generated from models.dev API
// Last updated: ${new Date().toISOString()}
// Run 'npm run update-models' to refresh

export const MODELS_DATABASE: ModelsDatabase = ${JSON.stringify(models, null, 2)};
`;
  
  await fs.writeFile('src/models-data.ts', content);
}

// src/models.ts - Runtime model lookup
import { MODELS_DATABASE } from './models-data.js';

// Simple lookup with fallback
export function getModelInfo(provider: string, model: string): ModelInfo {
  const info = MODELS_DATABASE.providers[provider]?.models[model];
  
  if (!info) {
    // Fallback for unknown models
    return {
      id: model,
      name: model,
      provider,
      capabilities: {
        reasoning: false,
        toolCall: true,
        vision: false
      },
      cost: { input: 0, output: 0 },
      limits: { context: 128000, output: 4096 }
    };
  }
  
  return info;
}

// Optional: Runtime override for testing new models
const runtimeOverrides = new Map<string, ModelInfo>();

export function registerModel(provider: string, model: string, info: ModelInfo) {
  runtimeOverrides.set(`${provider}:${model}`, info);
}
```

### Cost Calculation

```typescript
class CostTracker {
  private usage: TokenUsage = {
    input: 0,
    output: 0,
    total: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
  
  private modelInfo: ModelInfo;
  
  constructor(modelInfo: ModelInfo) {
    this.modelInfo = modelInfo;
  }
  
  addUsage(tokens: Partial<TokenUsage>): TokenUsage {
    this.usage.input += tokens.input || 0;
    this.usage.output += tokens.output || 0;
    this.usage.thinking += tokens.thinking || 0;
    this.usage.cacheRead += tokens.cacheRead || 0;
    this.usage.cacheWrite += tokens.cacheWrite || 0;
    this.usage.total = this.usage.input + this.usage.output + (this.usage.thinking || 0);
    
    // Calculate costs (per million tokens)
    const cost = this.modelInfo.cost;
    this.usage.cost = {
      input: (this.usage.input / 1_000_000) * cost.input,
      output: (this.usage.output / 1_000_000) * cost.output,
      cache: 
        ((this.usage.cacheRead || 0) / 1_000_000) * (cost.cacheRead || 0) +
        ((this.usage.cacheWrite || 0) / 1_000_000) * (cost.cacheWrite || 0),
      total: 0
    };
    
    this.usage.cost.total = 
      this.usage.cost.input + 
      this.usage.cost.output + 
      this.usage.cost.cache;
    
    return { ...this.usage };
  }
  
  getTotalCost(): number {
    return this.usage.cost?.total || 0;
  }
  
  getUsageSummary(): string {
    return `Tokens: ${this.usage.total} (${this.usage.input}→${this.usage.output}) | Cost: $${this.getTotalCost().toFixed(4)}`;
  }
}
```

### Integration in Adapters

```typescript
class OpenAIAdapter {
  private costTracker: CostTracker;
  
  constructor(config: AIConfig) {
    const modelInfo = getModelInfo('openai', config.model);
    this.costTracker = new CostTracker(modelInfo);
  }
  
  async *stream(request: Request): AsyncGenerator<Event> {
    // ... streaming logic ...
    
    if (chunk.usage) {
      const usage = this.costTracker.addUsage({
        input: chunk.usage.prompt_tokens,
        output: chunk.usage.completion_tokens,
        thinking: chunk.usage.completion_tokens_details?.reasoning_tokens,
        cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens
      });
      
      yield { type: 'usage', usage };
    }
  }
}
```

## Next Steps

1. Create models.ts with models.dev integration
2. Implement base `AI` class with adapter pattern
3. Create three provider adapters with full streaming support
4. Add comprehensive error mapping
5. Implement token counting and cost tracking
6. Add test suite for each provider
7. Create migration guide from native SDKs