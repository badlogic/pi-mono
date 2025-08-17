# Anthropic SDK Implementation Guide

This document provides a comprehensive guide for implementing the required features using the Anthropic SDK. All examples use TypeScript and include actual code that works with the SDK.

## Table of Contents

1. [Basic Client Setup](#basic-client-setup)
2. [Streaming Responses](#streaming-responses)
3. [Request Abortion](#request-abortion)
4. [Error Handling](#error-handling)
5. [Stop Reasons](#stop-reasons)
6. [Context and Message History](#context-and-message-history)
7. [Token Counting](#token-counting)
8. [Prompt Caching](#prompt-caching)
9. [Tool Use (Function Calling)](#tool-use-function-calling)
10. [System Prompts](#system-prompts)
11. [Content Block System](#content-block-system)
12. [MessageStream Helper Class](#messagestream-helper-class)
13. [Thinking Tokens and Extended Reasoning](#thinking-tokens-and-extended-reasoning)
14. [Complete Implementation Example](#complete-implementation-example)

## Basic Client Setup

```typescript
import Anthropic from '@anthropic-ai/sdk';

// Create client with configuration
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, // Required
  baseURL: 'https://api.anthropic.com', // Optional, this is the default
  timeout: 60000, // Optional, in milliseconds
  maxRetries: 3, // Optional, default is 2
});
```

### Environment Variables

The SDK automatically reads from these environment variables:
- `ANTHROPIC_API_KEY` - Your API key
- `ANTHROPIC_BASE_URL` - Custom base URL (optional)

## Streaming Responses

### Basic Streaming with MessageStream

```typescript
import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';

async function basicStream() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello, Claude!' }],
  });

  // Listen to different event types
  stream.on('text', (text, snapshot) => {
    process.stdout.write(text); // text is the delta, snapshot is accumulated
  });

  stream.on('message', (message) => {
    console.log('\nFinal message:', message);
  });

  stream.on('error', (error) => {
    console.error('Error:', error);
  });

  // Wait for completion
  const finalMessage = await stream.finalMessage();
  return finalMessage;
}
```

### Raw Streaming with create()

```typescript
import { RawMessageStreamEvent } from '@anthropic-ai/sdk';

async function rawStreaming() {
  const stream = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true,
  });

  let content = '';
  let usage: any = null;

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'message_start':
        console.log('Message started:', chunk.message);
        break;
        
      case 'content_block_delta':
        if (chunk.delta.type === 'text_delta') {
          content += chunk.delta.text;
          process.stdout.write(chunk.delta.text);
        }
        break;
        
      case 'message_delta':
        if (chunk.usage) {
          usage = chunk.usage;
        }
        console.log('\nStop reason:', chunk.delta.stop_reason);
        break;
        
      case 'message_stop':
        console.log('\nStream ended');
        break;
    }
  }

  return { content, usage };
}
```

### Handling Thinking Tokens in Streams

```typescript
async function streamWithThinking() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    thinking: {
      type: 'enabled',
      budget_tokens: 2000,
    },
    messages: [{ role: 'user', content: 'Solve this complex math problem: ...' }],
  });

  stream.on('thinking', (thinking, snapshot) => {
    console.log('[Thinking]', thinking); // Delta thinking content
  });

  stream.on('text', (text, snapshot) => {
    process.stdout.write(text); // Regular response text
  });

  const message = await stream.finalMessage();
  
  // Access thinking content from final message
  for (const block of message.content) {
    if (block.type === 'thinking') {
      console.log('Final thinking:', block.thinking);
    }
  }
}
```

## Request Abortion

### AbortController Integration

```typescript
async function abortableRequest() {
  const controller = new AbortController();
  
  // Abort after 5 seconds
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Long task...' }],
    }, {
      // Pass abort signal in request options
      signal: controller.signal,
    });

    stream.on('error', (error) => {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
      } else {
        console.error('Other error:', error);
      }
    });

    const result = await stream.finalMessage();
    clearTimeout(timeoutId);
    return result;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      console.log('Request aborted by user');
    } else {
      throw error;
    }
  }
}

// Manual abort from MessageStream
async function manualAbort() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Start a story...' }],
  });

  // Abort after receiving some content
  stream.on('text', (text, snapshot) => {
    if (snapshot.length > 100) {
      stream.abort(); // Built-in abort method
    }
  });

  try {
    await stream.finalMessage();
  } catch (error) {
    if (stream.aborted) {
      console.log('Stream was manually aborted');
    }
  }
}
```

## Error Handling

### Comprehensive Error Types

```typescript
import {
  AnthropicError,
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  BadRequestError,
  AuthenticationError,
  InternalServerError,
  PermissionDeniedError,
  UnprocessableEntityError,
} from '@anthropic-ai/sdk';

async function handleErrors() {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }],
    });
    
    return message;
    
  } catch (error) {
    // Handle specific error types
    if (error instanceof RateLimitError) {
      console.error('Rate limit exceeded:', {
        status: error.status,
        headers: error.headers,
        retryAfter: error.headers.get('retry-after'),
      });
      
      // Wait and retry logic
      const retryAfter = parseInt(error.headers.get('retry-after') || '60');
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      
    } else if (error instanceof AuthenticationError) {
      console.error('Authentication failed:', error.status);
      throw new Error('Invalid API key');
      
    } else if (error instanceof BadRequestError) {
      console.error('Bad request:', {
        status: error.status,
        error: error.error,
        message: error.message,
      });
      
    } else if (error instanceof APIConnectionTimeoutError) {
      console.error('Request timed out');
      // Retry with longer timeout
      
    } else if (error instanceof APIConnectionError) {
      console.error('Network error:', error.message);
      // Retry with backoff
      
    } else if (error instanceof APIUserAbortError) {
      console.log('Request was aborted by user');
      
    } else if (error instanceof InternalServerError) {
      console.error('Server error:', error.status);
      // Retry with exponential backoff
      
    } else if (error instanceof APIError) {
      console.error('API error:', {
        status: error.status,
        error: error.error,
        requestId: error.requestID,
      });
      
    } else {
      console.error('Unexpected error:', error);
      throw error;
    }
  }
}

// Error handling in streams
function handleStreamErrors() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }],
  });

  stream.on('error', (error) => {
    if (error instanceof RateLimitError) {
      console.log('Rate limited during stream');
    } else if (error instanceof APIConnectionError) {
      console.log('Connection lost during stream');
    } else {
      console.error('Stream error:', error);
    }
  });

  return stream;
}
```

## Stop Reasons

### Understanding Stop Reasons

```typescript
import { StopReason } from '@anthropic-ai/sdk';

async function handleStopReasons() {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100, // Intentionally low to trigger max_tokens
    messages: [{ role: 'user', content: 'Write a long story...' }],
    stop_sequences: ['THE END'], // Custom stop sequence
  });

  // Extract and handle stop reason
  const stopReason: StopReason = message.stop_reason;
  
  switch (stopReason) {
    case 'end_turn':
      console.log('Model completed naturally');
      break;
      
    case 'max_tokens':
      console.log('Hit token limit, response may be incomplete');
      // Consider continuing with a follow-up request
      break;
      
    case 'stop_sequence':
      console.log('Hit custom stop sequence:', message.stop_sequence);
      break;
      
    case 'tool_use':
      console.log('Model wants to use tools');
      // Handle tool calls (see Tool Use section)
      break;
      
    case 'pause_turn':
      console.log('Long turn paused, can continue');
      // Continue with the partial response as context
      break;
      
    case 'refusal':
      console.log('Model refused to respond due to safety');
      break;
      
    default:
      console.log('Unknown stop reason:', stopReason);
  }

  return { message, stopReason };
}

// In streaming mode
function handleStopReasonsInStream() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }],
  });

  stream.on('message', (message) => {
    const stopReason = message.stop_reason;
    console.log('Final stop reason:', stopReason);
    
    if (stopReason === 'max_tokens') {
      console.log('Response was truncated');
    }
  });

  return stream;
}
```

## Context and Message History

### Message Format and Serialization

```typescript
import { MessageParam, Message } from '@anthropic-ai/sdk';

interface ConversationState {
  messages: MessageParam[];
  totalTokens: number;
  model: string;
  systemPrompt?: string;
}

class ConversationManager {
  private state: ConversationState;

  constructor(model: string, systemPrompt?: string) {
    this.state = {
      messages: [],
      totalTokens: 0,
      model,
      systemPrompt,
    };
  }

  // Add user message
  addUserMessage(content: string | any[]) {
    this.state.messages.push({
      role: 'user',
      content,
    });
  }

  // Add assistant message from API response
  addAssistantMessage(message: Message) {
    this.state.messages.push({
      role: 'assistant',
      content: message.content,
    });
    
    // Update token count
    this.state.totalTokens += message.usage.input_tokens + message.usage.output_tokens;
  }

  // Add tool results
  addToolResult(toolUseId: string, result: string, isError = false) {
    // Find the last message and ensure it has tool use
    const lastMessage = this.state.messages[this.state.messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      // Add tool result as new user message
      this.state.messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: result,
          is_error: isError,
        }],
      });
    }
  }

  // Get messages for API call
  getMessages(): MessageParam[] {
    return [...this.state.messages];
  }

  // Serialize for persistence
  serialize(): string {
    return JSON.stringify(this.state);
  }

  // Deserialize from storage
  static deserialize(json: string): ConversationManager {
    const state = JSON.parse(json);
    const manager = new ConversationManager(state.model, state.systemPrompt);
    manager.state = state;
    return manager;
  }

  // Create request parameters
  createRequestParams(newMessage?: string): any {
    if (newMessage) {
      this.addUserMessage(newMessage);
    }

    const params: any = {
      model: this.state.model,
      max_tokens: 4000,
      messages: this.getMessages(),
    };

    if (this.state.systemPrompt) {
      params.system = this.state.systemPrompt;
    }

    return params;
  }

  // Get conversation stats
  getStats() {
    return {
      messageCount: this.state.messages.length,
      totalTokens: this.state.totalTokens,
      userMessages: this.state.messages.filter(m => m.role === 'user').length,
      assistantMessages: this.state.messages.filter(m => m.role === 'assistant').length,
    };
  }
}

// Usage example
async function conversationExample() {
  const conversation = new ConversationManager(
    'claude-sonnet-4-20250514',
    'You are a helpful coding assistant.'
  );

  // First exchange
  const params1 = conversation.createRequestParams('Hello, can you help me with Python?');
  const response1 = await anthropic.messages.create(params1);
  conversation.addAssistantMessage(response1);

  // Second exchange
  const params2 = conversation.createRequestParams('Show me a simple function.');
  const response2 = await anthropic.messages.create(params2);
  conversation.addAssistantMessage(response2);

  // Save conversation
  const saved = conversation.serialize();
  localStorage.setItem('conversation', saved);

  // Later: restore conversation
  const restored = ConversationManager.deserialize(saved);
  console.log('Conversation stats:', restored.getStats());
}
```

## Token Counting

### Using the Count Tokens API

```typescript
import { MessageCountTokensParams, MessageTokensCount } from '@anthropic-ai/sdk';

async function countTokens() {
  const messages = [
    { role: 'user', content: 'Hello, how are you?' },
    { role: 'assistant', content: 'I am doing well, thank you for asking!' },
    { role: 'user', content: 'Can you help me write some code?' },
  ] as const;

  // Count tokens for messages
  const tokenCount: MessageTokensCount = await anthropic.messages.countTokens({
    model: 'claude-sonnet-4-20250514',
    messages,
    system: 'You are a helpful coding assistant.',
  });

  console.log('Input tokens:', tokenCount.input_tokens);
  return tokenCount.input_tokens;
}

// Count tokens with tools
async function countTokensWithTools() {
  const tools = [
    {
      name: 'calculator',
      description: 'Perform mathematical calculations',
      input_schema: {
        type: 'object',
        properties: {
          expression: { type: 'string' },
        },
        required: ['expression'],
      },
    },
  ];

  const tokenCount = await anthropic.messages.countTokens({
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'Calculate 2+2' }],
    tools,
  });

  return tokenCount.input_tokens;
}

// Extract usage from responses
function extractUsageFromResponse(message: Message) {
  const usage = message.usage;
  
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cache_creation_input_tokens || 0,
    totalTokens: usage.input_tokens + usage.output_tokens,
    serviceTier: usage.service_tier,
    cacheCreation: usage.cache_creation,
  };
}

// Token usage in streaming
function trackTokensInStream() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }],
  });

  let finalUsage: any = null;

  stream.on('message', (message) => {
    finalUsage = extractUsageFromResponse(message);
    console.log('Final usage:', finalUsage);
  });

  return stream;
}
```

## Prompt Caching

### Basic Caching Implementation

```typescript
import { CacheControlEphemeral } from '@anthropic-ai/sdk';

async function usePromptCaching() {
  // Cache control for system prompt
  const systemPrompt = [
    {
      type: 'text',
      text: 'You are an expert software engineer with deep knowledge of...',
      cache_control: { type: 'ephemeral', ttl: '1h' } as CacheControlEphemeral,
    },
  ];

  // Cache control for large document
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Here is a large codebase to analyze:',
        },
        {
          type: 'document',
          source: {
            type: 'text',
            data: '// Large codebase content...',
            media_type: 'text/plain',
          },
          cache_control: { type: 'ephemeral', ttl: '1h' } as CacheControlEphemeral,
        },
        {
          type: 'text',
          text: 'Please analyze this code for bugs.',
        },
      ],
    },
  ] as const;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  // Check cache usage
  const usage = response.usage;
  console.log('Cache read tokens:', usage.cache_read_input_tokens);
  console.log('Cache write tokens:', usage.cache_creation_input_tokens);
  
  return response;
}

// Caching with different TTL options
async function cachingWithTTL() {
  const shortCache = {
    type: 'ephemeral',
    ttl: '5m', // 5 minutes
  } as CacheControlEphemeral;

  const longCache = {
    type: 'ephemeral', 
    ttl: '1h', // 1 hour (default)
  } as CacheControlEphemeral;

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Short-lived context',
          cache_control: shortCache,
        },
        {
          type: 'text',
          text: 'Long-lived context that should be cached longer',
          cache_control: longCache,
        },
        {
          type: 'text',
          text: 'What can you tell me about this?',
        },
      ],
    },
  ] as const;

  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages,
  });
}
```

## Tool Use (Function Calling)

### Complete Tool Implementation

```typescript
import { Tool, ToolUseBlock, ToolChoice } from '@anthropic-ai/sdk';

// Define tools
const tools: Tool[] = [
  {
    name: 'calculator',
    description: 'Perform mathematical calculations',
    input_schema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to evaluate',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'weather',
    description: 'Get weather information for a location',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name or coordinates',
        },
        units: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature units',
        },
      },
      required: ['location'],
    },
  },
];

// Tool implementations
const toolImplementations = {
  calculator: (args: { expression: string }) => {
    try {
      // Simple eval - in production, use a safe math parser
      const result = eval(args.expression);
      return `Result: ${result}`;
    } catch (error) {
      return `Error: Invalid expression - ${error.message}`;
    }
  },
  
  weather: async (args: { location: string; units?: string }) => {
    // Mock weather API call
    return `Weather in ${args.location}: 22°C, sunny with light clouds`;
  },
};

async function toolUseExample() {
  const conversation = new ConversationManager('claude-sonnet-4-20250514');
  
  // Send initial message with tools
  conversation.addUserMessage('What is 15 * 23 and what is the weather in Paris?');
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: conversation.getMessages(),
    tools,
    tool_choice: { type: 'auto' } as ToolChoice,
  });

  conversation.addAssistantMessage(response);

  // Handle tool calls
  const toolCalls: ToolUseBlock[] = response.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  );

  // Execute each tool call
  for (const toolCall of toolCalls) {
    const toolName = toolCall.name;
    const toolArgs = toolCall.input;
    const toolId = toolCall.id;

    console.log(`Executing tool: ${toolName} with args:`, toolArgs);

    try {
      let result: string;
      
      if (toolName in toolImplementations) {
        result = await toolImplementations[toolName](toolArgs as any);
      } else {
        result = `Error: Unknown tool "${toolName}"`;
      }

      // Add tool result to conversation
      conversation.addToolResult(toolId, result);
      
    } catch (error) {
      // Add error result
      conversation.addToolResult(toolId, `Error: ${error.message}`, true);
    }
  }

  // Get final response after tool execution
  if (toolCalls.length > 0) {
    const finalResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: conversation.getMessages(),
      tools,
    });

    conversation.addAssistantMessage(finalResponse);
    return finalResponse;
  }

  return response;
}

// Streaming with tools
async function streamingWithTools() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Calculate 42 * 17' }],
    tools,
  });

  const toolCalls: ToolUseBlock[] = [];

  stream.on('contentBlock', (block) => {
    if (block.type === 'tool_use') {
      toolCalls.push(block);
    }
  });

  stream.on('message', async (message) => {
    if (message.stop_reason === 'tool_use') {
      console.log('Tool calls detected:', toolCalls);
      // Handle tools...
    }
  });

  return stream;
}

// Force specific tool usage
async function forceToolUsage() {
  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'I need to do some math' }],
    tools,
    tool_choice: { 
      type: 'tool',
      name: 'calculator',
    } as ToolChoice,
  });
}
```

## System Prompts

### System Prompt Variations

```typescript
// Simple string system prompt
async function basicSystemPrompt() {
  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: 'You are a helpful coding assistant specialized in Python.',
    messages: [{ role: 'user', content: 'Help me write a function' }],
  });
}

// Complex system prompt with caching
async function complexSystemPrompt() {
  const systemPrompt = [
    {
      type: 'text',
      text: `You are an expert software engineer with the following expertise:

1. Python development and best practices
2. Web frameworks like Django and FastAPI  
3. Database design and optimization
4. Testing strategies and TDD
5. Code review and refactoring

Guidelines for your responses:
- Always write clean, readable code
- Include proper error handling
- Add type hints when using Python
- Explain your reasoning
- Suggest improvements when applicable

When reviewing code:
- Focus on functionality, performance, and maintainability
- Point out potential bugs or edge cases
- Suggest more pythonic approaches when relevant`,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
  ] as const;

  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Review this Python function for me' }],
  });
}

// Dynamic system prompt based on context
function buildSystemPrompt(userRole: string, expertise: string[]): string {
  const basePrompt = `You are an AI assistant helping a ${userRole}.`;
  
  const expertisePrompt = expertise.length > 0 
    ? `\n\nYour areas of expertise include: ${expertise.join(', ')}.`
    : '';
    
  const guidelines = `
  
Guidelines:
- Be helpful and accurate
- Explain complex concepts clearly
- Provide practical examples
- Ask for clarification when needed`;

  return basePrompt + expertisePrompt + guidelines;
}

async function dynamicSystemPrompt() {
  const systemPrompt = buildSystemPrompt('software developer', [
    'JavaScript', 'TypeScript', 'React', 'Node.js'
  ]);

  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Help me optimize this React component' }],
  });
}
```

## Content Block System

### Understanding Content Blocks

The Anthropic API uses a content block system where message content is always an array, even for simple text.

```typescript
import { 
  ContentBlockParam, 
  TextBlockParam, 
  ImageBlockParam,
  DocumentBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam 
} from '@anthropic-ai/sdk';

// Text content (most common)
const textContent: TextBlockParam = {
  type: 'text',
  text: 'Hello, Claude!',
};

// Image content
const imageContent: ImageBlockParam = {
  type: 'image',
  source: {
    type: 'base64',
    media_type: 'image/jpeg',
    data: '/9j/4AAQSkZJRg...', // base64 encoded image
  },
};

// Document content with caching
const documentContent: DocumentBlockParam = {
  type: 'document',
  source: {
    type: 'text',
    data: 'Large document content...',
    media_type: 'text/plain',
  },
  cache_control: { type: 'ephemeral', ttl: '1h' },
  title: 'Important Document',
  context: 'This document contains key information for the project',
};

// Tool use block (from assistant)
const toolUseContent: ToolUseBlockParam = {
  type: 'tool_use',
  id: 'tool_123',
  name: 'calculator',
  input: { expression: '2 + 2' },
};

// Tool result block (from user)
const toolResultContent: ToolResultBlockParam = {
  type: 'tool_result',
  tool_use_id: 'tool_123',
  content: 'Result: 4',
};

// Mixed content message
async function mixedContentExample() {
  const mixedMessage: ContentBlockParam[] = [
    {
      type: 'text',
      text: 'Here is an image and a document to analyze:',
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgA...', // base64 image
      },
    },
    {
      type: 'document',
      source: {
        type: 'text',
        data: 'Document content here...',
        media_type: 'text/plain',
      },
      title: 'Analysis Document',
    },
    {
      type: 'text',
      text: 'What insights can you provide from these?',
    },
  ];

  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: mixedMessage }],
  });
}

// Helper functions for content manipulation
function createTextBlock(text: string, cached = false): TextBlockParam {
  const block: TextBlockParam = {
    type: 'text',
    text,
  };
  
  if (cached) {
    block.cache_control = { type: 'ephemeral', ttl: '1h' };
  }
  
  return block;
}

function createImageBlock(base64Data: string, mimeType: string): ImageBlockParam {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mimeType as any,
      data: base64Data,
    },
  };
}

// Extract text from response content blocks
function extractTextFromResponse(content: any[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

// Extract thinking content
function extractThinkingFromResponse(content: any[]): string | null {
  const thinkingBlock = content.find(block => block.type === 'thinking');
  return thinkingBlock?.thinking || null;
}
```

## MessageStream Helper Class

### Advanced MessageStream Usage

```typescript
import { MessageStream, MessageStreamEvents } from '@anthropic-ai/sdk/lib/MessageStream';

class AdvancedMessageHandler {
  private stream: MessageStream;
  private content = '';
  private thinking = '';
  private toolCalls: any[] = [];
  private citations: any[] = [];

  constructor(stream: MessageStream) {
    this.stream = stream;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Connection established
    this.stream.on('connect', () => {
      console.log('Stream connected');
    });

    // Text content (delta and snapshot)
    this.stream.on('text', (delta: string, snapshot: string) => {
      process.stdout.write(delta);
      this.content = snapshot;
    });

    // Thinking content (Claude's internal reasoning)
    this.stream.on('thinking', (delta: string, snapshot: string) => {
      console.log('[Thinking]', delta);
      this.thinking = snapshot;
    });

    // Citations (when referencing documents)
    this.stream.on('citation', (citation, citations) => {
      console.log('Citation:', citation);
      this.citations = citations;
    });

    // Content blocks (including tool calls)
    this.stream.on('contentBlock', (block) => {
      if (block.type === 'tool_use') {
        console.log('Tool call:', block);
        this.toolCalls.push(block);
      }
    });

    // Raw stream events
    this.stream.on('streamEvent', (event, snapshot) => {
      // Handle any stream event
      console.log('Stream event:', event.type);
    });

    // Final message
    this.stream.on('finalMessage', (message) => {
      console.log('\nFinal message received');
      this.handleFinalMessage(message);
    });

    // Error handling
    this.stream.on('error', (error) => {
      console.error('Stream error:', error);
    });

    // Stream end
    this.stream.on('end', () => {
      console.log('\nStream ended');
    });

    // User abort
    this.stream.on('abort', (error) => {
      console.log('Stream aborted by user');
    });
  }

  private handleFinalMessage(message: any) {
    console.log('Stop reason:', message.stop_reason);
    console.log('Token usage:', message.usage);
    
    // Process thinking content if available
    for (const block of message.content) {
      if (block.type === 'thinking') {
        console.log('Final thinking content:', block.thinking);
      }
    }
  }

  async waitForCompletion() {
    try {
      const finalMessage = await this.stream.finalMessage();
      return {
        message: finalMessage,
        content: this.content,
        thinking: this.thinking,
        toolCalls: this.toolCalls,
        citations: this.citations,
      };
    } catch (error) {
      if (this.stream.aborted) {
        console.log('Stream was aborted');
      } else {
        throw error;
      }
    }
  }

  abort() {
    this.stream.abort();
  }

  // Get request ID for debugging
  getRequestId() {
    return this.stream.request_id;
  }

  // Access the underlying Response object
  async getResponse() {
    const { response } = await this.stream.withResponse();
    return response;
  }
}

// Usage example
async function advancedStreamExample() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    thinking: {
      type: 'enabled',
      budget_tokens: 1000,
    },
    messages: [{ 
      role: 'user', 
      content: 'Analyze this complex problem and show your reasoning...' 
    }],
  });

  const handler = new AdvancedMessageHandler(stream);
  
  // Optional: abort after 30 seconds
  const timeoutId = setTimeout(() => {
    handler.abort();
  }, 30000);

  try {
    const result = await handler.waitForCompletion();
    clearTimeout(timeoutId);
    
    console.log('Final result:', {
      contentLength: result.content.length,
      thinkingLength: result.thinking.length,
      toolCallCount: result.toolCalls.length,
      citationCount: result.citations.length,
    });
    
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
```

## Thinking Tokens and Extended Reasoning

### Enabling Extended Thinking

```typescript
async function extendedThinkingExample() {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    thinking: {
      type: 'enabled',
      budget_tokens: 2000, // Minimum 1024, must be < max_tokens
    },
    messages: [{
      role: 'user',
      content: `Solve this complex problem step by step:
        
A company has 3 factories. Factory A produces 100 units/day, 
Factory B produces 150 units/day, and Factory C produces 200 units/day.
If the company needs to fulfill an order of 10,000 units in the most
cost-efficient way, and the costs per unit are $5, $4, and $6 respectively,
what's the optimal production strategy?`
    }],
  });

  // Extract thinking content
  for (const block of response.content) {
    if (block.type === 'thinking') {
      console.log('Claude\'s thinking process:');
      console.log(block.thinking);
      console.log('Signature:', block.signature);
    } else if (block.type === 'text') {
      console.log('\nFinal answer:');
      console.log(block.text);
    }
  }

  return response;
}

// Disable thinking
async function disableThinking() {
  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    thinking: {
      type: 'disabled',
    },
    messages: [{ role: 'user', content: 'Quick answer please' }],
  });
}

// Streaming with thinking
async function streamThinking() {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    thinking: {
      type: 'enabled',
      budget_tokens: 1500,
    },
    messages: [{
      role: 'user',
      content: 'Think through this carefully: How would you design a distributed cache?'
    }],
  });

  let thinkingContent = '';
  let responseContent = '';

  stream.on('thinking', (delta, snapshot) => {
    // Stream thinking content as it comes
    process.stdout.write(`[THINKING] ${delta}`);
    thinkingContent = snapshot;
  });

  stream.on('text', (delta, snapshot) => {
    // Stream final response
    process.stdout.write(delta);
    responseContent = snapshot;
  });

  const finalMessage = await stream.finalMessage();
  
  return {
    thinking: thinkingContent,
    response: responseContent,
    usage: finalMessage.usage,
  };
}
```

## Complete Implementation Example

Here's a comprehensive example that combines all the features:

```typescript
import Anthropic, { 
  MessageParam, 
  Message, 
  Tool,
  ToolUseBlock,
  AnthropicError 
} from '@anthropic-ai/sdk';

class AnthropicClient {
  private client: Anthropic;
  private conversation: MessageParam[] = [];
  private totalTokens = 0;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async sendMessage(
    content: string,
    options: {
      stream?: boolean;
      tools?: Tool[];
      thinking?: boolean;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      cached?: boolean;
    } = {}
  ) {
    const {
      stream = false,
      tools = [],
      thinking = false,
      systemPrompt,
      maxTokens = 1024,
      temperature = 1.0,
      cached = false,
    } = options;

    // Add user message
    this.conversation.push({
      role: 'user',
      content: cached 
        ? [{ type: 'text', text: content, cache_control: { type: 'ephemeral', ttl: '1h' } }]
        : content,
    });

    const params: any = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      temperature,
      messages: [...this.conversation],
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    if (tools.length > 0) {
      params.tools = tools;
      params.tool_choice = { type: 'auto' };
    }

    if (thinking) {
      params.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(maxTokens / 2, 2000),
      };
    }

    try {
      if (stream) {
        return await this.handleStreamingResponse(params, tools);
      } else {
        return await this.handleSingleResponse(params, tools);
      }
    } catch (error) {
      return this.handleError(error);
    }
  }

  private async handleSingleResponse(params: any, tools: Tool[]) {
    const response = await this.client.messages.create(params);
    
    // Track tokens
    this.totalTokens += response.usage.input_tokens + response.usage.output_tokens;
    
    // Add assistant response
    this.conversation.push({
      role: 'assistant',
      content: response.content,
    });

    // Handle tool calls
    const toolCalls = response.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use'
    );

    if (toolCalls.length > 0 && tools.length > 0) {
      await this.handleToolCalls(toolCalls, params, tools);
    }

    return {
      content: this.extractText(response.content),
      thinking: this.extractThinking(response.content),
      toolCalls,
      usage: response.usage,
      stopReason: response.stop_reason,
    };
  }

  private async handleStreamingResponse(params: any, tools: Tool[]) {
    const stream = this.client.messages.stream(params);
    
    let content = '';
    let thinking = '';
    const toolCalls: ToolUseBlock[] = [];
    let finalMessage: Message;

    return new Promise((resolve, reject) => {
      stream.on('text', (delta, snapshot) => {
        process.stdout.write(delta);
        content = snapshot;
      });

      stream.on('thinking', (delta, snapshot) => {
        console.log(`[THINKING] ${delta}`);
        thinking = snapshot;
      });

      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          toolCalls.push(block);
        }
      });

      stream.on('finalMessage', async (message) => {
        finalMessage = message;
        this.totalTokens += message.usage.input_tokens + message.usage.output_tokens;
        
        this.conversation.push({
          role: 'assistant',
          content: message.content,
        });

        if (toolCalls.length > 0 && tools.length > 0) {
          try {
            await this.handleToolCalls(toolCalls, params, tools);
          } catch (error) {
            reject(error);
            return;
          }
        }

        resolve({
          content,
          thinking,
          toolCalls,
          usage: message.usage,
          stopReason: message.stop_reason,
        });
      });

      stream.on('error', reject);
    });
  }

  private async handleToolCalls(toolCalls: ToolUseBlock[], params: any, tools: Tool[]) {
    // Execute tool calls
    for (const toolCall of toolCalls) {
      const result = await this.executeToolCall(toolCall);
      
      this.conversation.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.content,
          is_error: result.isError,
        }],
      });
    }

    // Get response after tool execution
    const followUpResponse = await this.client.messages.create({
      ...params,
      messages: [...this.conversation],
    });

    this.conversation.push({
      role: 'assistant',
      content: followUpResponse.content,
    });

    this.totalTokens += followUpResponse.usage.input_tokens + followUpResponse.usage.output_tokens;
  }

  private async executeToolCall(toolCall: ToolUseBlock): Promise<{ content: string; isError: boolean }> {
    // Mock tool implementations
    const tools = {
      calculator: (args: any) => {
        try {
          const result = eval(args.expression);
          return { content: `Result: ${result}`, isError: false };
        } catch (error) {
          return { content: `Error: ${error.message}`, isError: true };
        }
      },
      weather: (args: any) => {
        return { content: `Weather in ${args.location}: 22°C, sunny`, isError: false };
      },
    };

    const toolName = toolCall.name;
    if (toolName in tools) {
      return tools[toolName](toolCall.input);
    } else {
      return { content: `Unknown tool: ${toolName}`, isError: true };
    }
  }

  private extractText(content: any[]): string {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }

  private extractThinking(content: any[]): string {
    const thinkingBlock = content.find(block => block.type === 'thinking');
    return thinkingBlock?.thinking || '';
  }

  private handleError(error: any) {
    if (error instanceof AnthropicError) {
      console.error('Anthropic API error:', error.message);
      
      if (error.status === 429) {
        console.log('Rate limited - should retry with backoff');
      } else if (error.status === 401) {
        console.log('Authentication failed - check API key');
      }
    } else {
      console.error('Unexpected error:', error);
    }
    
    throw error;
  }

  // Utility methods
  getConversationHistory(): MessageParam[] {
    return [...this.conversation];
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  clearConversation(): void {
    this.conversation = [];
    this.totalTokens = 0;
  }

  async countTokens(messages: MessageParam[], systemPrompt?: string): Promise<number> {
    const params: any = {
      model: 'claude-sonnet-4-20250514',
      messages,
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    const result = await this.client.messages.countTokens(params);
    return result.input_tokens;
  }
}

// Usage example
async function completeExample() {
  const client = new AnthropicClient(process.env.ANTHROPIC_API_KEY!);

  const tools: Tool[] = [
    {
      name: 'calculator',
      description: 'Perform mathematical calculations',
      input_schema: {
        type: 'object',
        properties: {
          expression: { type: 'string' },
        },
        required: ['expression'],
      },
    },
  ];

  // Simple message
  let result = await client.sendMessage('Hello, Claude!');
  console.log('Response:', result.content);

  // Message with thinking
  result = await client.sendMessage(
    'Solve this complex math problem: What is the optimal way to arrange 10 people around a circular table?',
    { thinking: true, maxTokens: 2000 }
  );
  console.log('Thinking:', result.thinking);
  console.log('Response:', result.content);

  // Streaming with tools
  result = await client.sendMessage(
    'Calculate 15 * 23 and explain the steps',
    { stream: true, tools, thinking: true }
  );

  console.log('Total tokens used:', client.getTotalTokens());
}
```

## Key Implementation Notes

1. **Content is Always an Array**: Even simple text messages use the content block system
2. **Error Handling**: The SDK provides specific error types for different HTTP status codes
3. **Streaming Events**: Use MessageStream for easier event handling, or raw streaming for more control
4. **Token Counting**: Use the dedicated countTokens API for accurate estimates
5. **Caching**: Add cache_control to content blocks, not to the message level
6. **Tool Calls**: Always check stop_reason for 'tool_use' and handle the tool execution flow
7. **Thinking**: Requires explicit configuration and sufficient token budget
8. **Abort**: Use AbortController for request cancellation, or MessageStream.abort() for streams

This guide covers all the essential patterns for working with the Anthropic SDK effectively.