# OpenAI SDK Implementation Guide

This document provides a comprehensive guide to implementing the required features using the OpenAI SDK v5.12.2. All examples are based on actual usage patterns from the pi-mono codebase and include real TypeScript types from the SDK.

## Table of Contents

1. [Basic Setup](#basic-setup)
2. [Streaming Responses](#streaming-responses)
3. [Aborting Requests](#aborting-requests)
4. [Error Handling](#error-handling)
5. [Stop Reasons](#stop-reasons)
6. [Message History & Serialization](#message-history--serialization)
7. [Token Counting](#token-counting)
8. [Caching](#caching)
9. [Chat Completions vs Responses API](#chat-completions-vs-responses-api)
10. [Tool/Function Calling](#toolfunction-calling)
11. [System Prompts](#system-prompts)
12. [Provider-Specific Features](#provider-specific-features)
13. [Complete Implementation Examples](#complete-implementation-examples)

## Basic Setup

```typescript
import OpenAI from "openai";

// Basic client setup
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1", // Optional, default shown
});

// For other providers (Groq, Anthropic OpenAI-compatible, etc.)
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});
```

### Client Configuration Options

```typescript
interface ClientOptions {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;      // Request timeout in milliseconds
  maxRetries?: number;   // Number of retry attempts
  defaultHeaders?: Record<string, string>;
  defaultQuery?: Record<string, unknown>;
}
```

## Streaming Responses

### Chat Completions Streaming

```typescript
import type { 
  ChatCompletionChunk, 
  ChatCompletionCreateParamsStreaming 
} from "openai/resources/chat/completions";
import { Stream } from "openai/core/streaming";

async function streamChatCompletion() {
  const params: ChatCompletionCreateParamsStreaming = {
    model: "gpt-4o",
    messages: [
      { role: "user", content: "Tell me a story" }
    ],
    stream: true,
    max_completion_tokens: 1000,
  };

  const stream: Stream<ChatCompletionChunk> = await client.chat.completions.create(params);

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    
    if (delta?.content) {
      process.stdout.write(delta.content);
    }
    
    if (delta?.tool_calls) {
      console.log("Tool call delta:", delta.tool_calls);
    }
    
    if (chunk.choices[0]?.finish_reason) {
      console.log("\nFinish reason:", chunk.choices[0].finish_reason);
    }
  }
}
```

### Responses API Streaming

```typescript
import type { 
  ResponseCreateParamsStreaming,
  ResponseStreamEvent 
} from "openai/resources/responses";

async function streamResponsesAPI() {
  const params: ResponseCreateParamsStreaming = {
    model: "o1-mini",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "Solve this math problem: 2x + 5 = 11" }]
      }
    ],
    stream: true,
    max_output_tokens: 2000,
    reasoning: {
      effort: "low",
      summary: "detailed"
    }
  };

  const stream: Stream<ResponseStreamEvent> = await client.responses.create(params);

  for await (const event of stream) {
    switch (event.type) {
      case "response.reasoning.text.delta":
        // Reasoning/thinking tokens (o1/o3)
        process.stdout.write(`[thinking] ${event.delta}`);
        break;
        
      case "response.text.delta":
        // Output content
        process.stdout.write(event.delta);
        break;
        
      case "response.function_call.arguments.delta":
        // Tool call arguments being built
        console.log("Tool call delta:", event.delta);
        break;
        
      case "response.completed":
        console.log("\nResponse completed");
        break;
    }
  }
}
```

### Streaming Patterns

```typescript
// Pattern 1: Simple content streaming
async function simpleStream(messages: any[]) {
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });

  let fullContent = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    fullContent += content;
    process.stdout.write(content);
  }
  
  return fullContent;
}

// Pattern 2: Event-driven streaming with handlers
interface StreamHandlers {
  onContent?: (delta: string) => void;
  onToolCall?: (toolCall: any) => void;
  onFinish?: (reason: string) => void;
}

async function eventDrivenStream(messages: any[], handlers: StreamHandlers) {
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    if (choice.delta?.content) {
      handlers.onContent?.(choice.delta.content);
    }

    if (choice.delta?.tool_calls) {
      handlers.onToolCall?.(choice.delta.tool_calls);
    }

    if (choice.finish_reason) {
      handlers.onFinish?.(choice.finish_reason);
    }
  }
}
```

## Aborting Requests

### Using AbortController

```typescript
class AbortableClient {
  private client: OpenAI;
  private abortController: AbortController | null = null;

  constructor(config: { apiKey: string; baseURL?: string }) {
    this.client = new OpenAI(config);
  }

  async askWithAbort(message: string): Promise<string> {
    // Create new AbortController for this request
    this.abortController = new AbortController();

    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: message }],
        max_completion_tokens: 1000,
      }, {
        signal: this.abortController.signal  // Pass abort signal
      });

      return response.choices[0]?.message?.content || "";
    } catch (error) {
      if (this.abortController.signal.aborted) {
        throw new Error("Request was interrupted");
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  // Call this to abort the current request
  interrupt(): void {
    this.abortController?.abort();
  }
}

// Usage example
const abortableClient = new AbortableClient({
  apiKey: process.env.OPENAI_API_KEY!
});

// Start request
const responsePromise = abortableClient.askWithAbort("Write a long essay");

// Abort after 5 seconds
setTimeout(() => {
  abortableClient.interrupt();
}, 5000);

try {
  const response = await responsePromise;
  console.log(response);
} catch (error) {
  console.log("Request was aborted:", error.message);
}
```

### Aborting Streaming Requests

```typescript
async function abortableStream(messages: any[]) {
  const abortController = new AbortController();
  
  // Abort after 10 seconds
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, 10000);

  try {
    const stream = await client.chat.completions.create({
      model: "gpt-4o",
      messages,
      stream: true,
    }, {
      signal: abortController.signal
    });

    for await (const chunk of stream) {
      // Check if aborted before processing each chunk
      if (abortController.signal.aborted) {
        break;
      }

      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        process.stdout.write(content);
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      console.log("\nStream was aborted");
    } else {
      throw error;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## Error Handling

### Error Types from OpenAI SDK

```typescript
import {
  OpenAIError,
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  UnprocessableEntityError
} from "openai";

// Comprehensive error handler
async function handleAPICall<T>(apiCall: () => Promise<T>): Promise<T> {
  try {
    return await apiCall();
  } catch (error) {
    if (error instanceof APIUserAbortError) {
      console.log("Request was aborted by user");
      throw new Error("Request interrupted");
    }
    
    if (error instanceof AuthenticationError) {
      console.error("Authentication failed:", error.message);
      throw new Error("Invalid API key");
    }
    
    if (error instanceof RateLimitError) {
      console.error("Rate limit exceeded:", error.message);
      // Could implement exponential backoff here
      throw new Error("Rate limited - try again later");
    }
    
    if (error instanceof APIConnectionError) {
      console.error("Connection error:", error.message);
      throw new Error("Network connection failed");
    }
    
    if (error instanceof APIConnectionTimeoutError) {
      console.error("Request timeout:", error.message);
      throw new Error("Request timed out");
    }
    
    if (error instanceof BadRequestError) {
      console.error("Bad request:", error.message);
      console.error("Error details:", error.error);
      throw new Error(`Invalid request: ${error.message}`);
    }
    
    if (error instanceof UnprocessableEntityError) {
      console.error("Unprocessable entity:", error.message);
      throw new Error(`Validation error: ${error.message}`);
    }
    
    if (error instanceof APIError) {
      console.error(`API Error ${error.status}:`, error.message);
      console.error("Error code:", error.code);
      console.error("Error type:", error.type);
      throw new Error(`API error: ${error.message}`);
    }
    
    if (error instanceof OpenAIError) {
      console.error("OpenAI SDK error:", error.message);
      throw new Error(`SDK error: ${error.message}`);
    }
    
    // Unknown error
    console.error("Unexpected error:", error);
    throw error;
  }
}

// Usage with retry logic
async function apiCallWithRetry<T>(
  apiCall: () => Promise<T>, 
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await handleAPICall(apiCall);
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on certain errors
      if (error instanceof AuthenticationError || 
          error instanceof BadRequestError ||
          error instanceof APIUserAbortError) {
        throw error;
      }
      
      // Exponential backoff for retryable errors
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}
```

### Error Context Extraction

```typescript
function extractErrorDetails(error: unknown): {
  message: string;
  code?: string;
  type?: string;
  status?: number;
  retryable: boolean;
} {
  if (error instanceof APIError) {
    return {
      message: error.message,
      code: error.code || undefined,
      type: error.type,
      status: error.status,
      retryable: error instanceof RateLimitError || 
                error instanceof APIConnectionError ||
                error instanceof InternalServerError
    };
  }
  
  if (error instanceof APIUserAbortError) {
    return {
      message: "Request was aborted",
      retryable: false
    };
  }
  
  if (error instanceof OpenAIError) {
    return {
      message: error.message,
      retryable: false
    };
  }
  
  return {
    message: error instanceof Error ? error.message : "Unknown error",
    retryable: false
  };
}
```

## Stop Reasons

### Chat Completions Stop Reasons

```typescript
type ChatCompletionFinishReason = 
  | "stop"           // Natural stopping point or stop sequence
  | "length"         // Maximum token limit reached
  | "content_filter" // Content filtered
  | "tool_calls"     // Model wants to call tools
  | "function_call"; // Legacy function calling

async function handleStopReasons() {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
    max_completion_tokens: 10, // Low limit to trigger "length" stop
    stop: ["END"], // Custom stop sequence
  });

  const choice = response.choices[0];
  const finishReason = choice.finish_reason;

  switch (finishReason) {
    case "stop":
      console.log("Completed naturally or hit stop sequence");
      break;
      
    case "length":
      console.log("Hit token limit - response may be incomplete");
      // Could request more tokens or continue conversation
      break;
      
    case "content_filter":
      console.log("Content was filtered");
      break;
      
    case "tool_calls":
      console.log("Model wants to call tools");
      // Handle tool calls (see Tool Calling section)
      break;
      
    default:
      console.log("Unknown finish reason:", finishReason);
  }

  return { 
    content: choice.message.content,
    finishReason,
    complete: finishReason === "stop"
  };
}
```

### Responses API Stop Reasons

```typescript
// Responses API uses different event types to indicate completion
async function handleResponsesStopReasons() {
  const response = await client.responses.create({
    model: "o1-mini",
    input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    max_output_tokens: 100,
  });

  for (const item of response.output || []) {
    switch (item.type) {
      case "message":
        // Check for refusal in content
        for (const content of item.content || []) {
          if (content.type === "refusal") {
            console.log("Response was refused:", content.refusal);
          } else if (content.type === "output_text") {
            console.log("Response completed normally");
          }
        }
        break;
        
      case "function_call":
        console.log("Tool call requested");
        break;
    }
  }
}
```

### Streaming Stop Reason Detection

```typescript
async function streamWithStopReasonHandling() {
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Count to 10" }],
    stream: true,
    max_completion_tokens: 50,
  });

  let content = "";
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    if (choice.delta?.content) {
      content += choice.delta.content;
      process.stdout.write(choice.delta.content);
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
      break;
    }
  }

  console.log(`\nStreaming finished. Reason: ${finishReason}`);
  
  if (finishReason === "length") {
    console.log("Response was cut off due to token limit");
    // Could continue the conversation to get the rest
  }
  
  return { content, finishReason };
}
```

## Message History & Serialization

### Message Types and Formats

```typescript
// Chat Completions message format
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: string | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string; // For tool response messages
}

// Responses API message format
interface ResponseMessage {
  role: "user" | "developer";
  content: Array<{
    type: "input_text" | "input_image" | "input_audio";
    text?: string;
    image?: { url: string };
    audio?: { data: string };
  }>;
}

// Unified conversation history
interface ConversationHistory {
  api: "completions" | "responses";
  model: string;
  systemPrompt?: string;
  messages: any[]; // API-specific format
  totalTokens: number;
  metadata: {
    created: number;
    lastUpdated: number;
    provider: string;
  };
}
```

### Serialization Implementation

```typescript
class ConversationManager {
  private messages: any[] = [];
  private api: "completions" | "responses";
  private systemPrompt?: string;
  private totalTokens = 0;

  constructor(api: "completions" | "responses", systemPrompt?: string) {
    this.api = api;
    this.systemPrompt = systemPrompt;
    
    if (systemPrompt) {
      if (api === "completions") {
        this.messages.push({ role: "system", content: systemPrompt });
      } else {
        this.messages.push({ role: "developer", content: systemPrompt });
      }
    }
  }

  addUserMessage(content: string) {
    if (this.api === "completions") {
      this.messages.push({ role: "user", content });
    } else {
      this.messages.push({
        role: "user",
        content: [{ type: "input_text", text: content }]
      });
    }
  }

  addAssistantMessage(content: string) {
    if (this.api === "completions") {
      this.messages.push({ role: "assistant", content });
    } else {
      this.messages.push({
        type: "message",
        content: [{ type: "output_text", text: content }]
      });
    }
  }

  addToolCall(id: string, name: string, args: string) {
    if (this.api === "completions") {
      // Add assistant message with tool calls
      this.messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id,
          type: "function" as const,
          function: { name, arguments: args }
        }]
      });
    } else {
      // Add function call to responses format
      this.messages.push({
        type: "function_call",
        call_id: id,
        name,
        arguments: args
      });
    }
  }

  addToolResult(id: string, result: string) {
    if (this.api === "completions") {
      this.messages.push({
        role: "tool",
        tool_call_id: id,
        content: result
      });
    } else {
      this.messages.push({
        type: "function_call_output",
        call_id: id,
        output: result
      });
    }
  }

  // Serialize to JSON
  serialize(): string {
    const data: ConversationHistory = {
      api: this.api,
      model: "unknown", // Set externally
      systemPrompt: this.systemPrompt,
      messages: this.messages,
      totalTokens: this.totalTokens,
      metadata: {
        created: Date.now(),
        lastUpdated: Date.now(),
        provider: "openai"
      }
    };
    return JSON.stringify(data, null, 2);
  }

  // Deserialize from JSON
  static deserialize(json: string): ConversationManager {
    const data: ConversationHistory = JSON.parse(json);
    const manager = new ConversationManager(data.api, data.systemPrompt);
    manager.messages = data.messages;
    manager.totalTokens = data.totalTokens;
    return manager;
  }

  getMessages() {
    return this.messages;
  }

  updateTokenUsage(tokens: number) {
    this.totalTokens += tokens;
  }
}

// Usage example
const conversation = new ConversationManager("completions", "You are a helpful assistant");
conversation.addUserMessage("Hello");
conversation.addAssistantMessage("Hi there!");
conversation.updateTokenUsage(25);

// Save to file
const serialized = conversation.serialize();
await fs.writeFile("conversation.json", serialized);

// Load from file
const loaded = await fs.readFile("conversation.json", "utf-8");
const restored = ConversationManager.deserialize(loaded);
```

### Event-Based History Reconstruction

```typescript
// From pi-agent codebase - reconstruct messages from events
type AgentEvent = 
  | { type: "user_message"; text: string }
  | { type: "assistant_message"; text: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: string }
  | { type: "tool_result"; toolCallId: string; result: string; isError: boolean }
  | { type: "reasoning"; text: string }
  | { type: "token_usage"; inputTokens: number; outputTokens: number; totalTokens: number };

function reconstructMessagesFromEvents(
  events: AgentEvent[], 
  api: "completions" | "responses", 
  systemPrompt?: string
): any[] {
  const messages: any[] = [];
  
  // Add system prompt
  if (systemPrompt) {
    if (api === "completions") {
      messages.push({ role: "system", content: systemPrompt });
    } else {
      messages.push({ role: "developer", content: systemPrompt });
    }
  }

  if (api === "responses") {
    // Responses API format reconstruction
    for (const event of events) {
      switch (event.type) {
        case "user_message":
          messages.push({
            role: "user",
            content: [{ type: "input_text", text: event.text }]
          });
          break;
          
        case "reasoning":
          messages.push({
            type: "reasoning",
            content: [{ type: "reasoning_text", text: event.text }]
          });
          break;
          
        case "tool_call":
          messages.push({
            type: "function_call",
            call_id: event.toolCallId,
            name: event.name,
            arguments: event.args
          });
          break;
          
        case "tool_result":
          messages.push({
            type: "function_call_output",
            call_id: event.toolCallId,
            output: event.result
          });
          break;
          
        case "assistant_message":
          messages.push({
            type: "message",
            content: [{ type: "output_text", text: event.text }]
          });
          break;
      }
    }
  } else {
    // Chat Completions format reconstruction
    let pendingToolCalls: any[] = [];
    
    for (const event of events) {
      switch (event.type) {
        case "user_message":
          messages.push({ role: "user", content: event.text });
          break;
          
        case "tool_call":
          pendingToolCalls.push({
            id: event.toolCallId,
            type: "function",
            function: {
              name: event.name,
              arguments: event.args
            }
          });
          break;
          
        case "tool_result":
          // Add assistant message with tool calls when we see first result
          if (pendingToolCalls.length > 0) {
            messages.push({
              role: "assistant",
              content: null,
              tool_calls: pendingToolCalls
            });
            pendingToolCalls = [];
          }
          
          messages.push({
            role: "tool",
            tool_call_id: event.toolCallId,
            content: event.result
          });
          break;
          
        case "assistant_message":
          messages.push({ role: "assistant", content: event.text });
          break;
      }
    }
  }
  
  return messages;
}
```

## Token Counting

### Usage Types from OpenAI SDK

```typescript
// Chat Completions usage
interface CompletionUsage {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
  completion_tokens_details?: {
    reasoning_tokens?: number; // o1/o3 reasoning tokens
    cached_tokens?: number;
  };
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

// Responses API usage
interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: {
    cached_tokens?: number;
  };
  output_tokens_details: {
    reasoning_tokens?: number; // o1/o3 reasoning tokens
  };
}
```

### Token Counting Implementation

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

class TokenCounter {
  private totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0
  };

  // Extract tokens from Chat Completions response
  extractChatCompletionUsage(usage?: CompletionUsage): TokenUsage | null {
    if (!usage) return null;

    const extracted: TokenUsage = {
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
      cacheReadTokens: usage.prompt_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: 0 // Not available in this format
    };

    this.addUsage(extracted);
    return extracted;
  }

  // Extract tokens from Responses API response
  extractResponseUsage(usage?: ResponseUsage): TokenUsage | null {
    if (!usage) return null;

    const extracted: TokenUsage = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0,
      cacheReadTokens: usage.input_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: 0 // Not available in current API
    };

    this.addUsage(extracted);
    return extracted;
  }

  private addUsage(usage: TokenUsage) {
    this.totalUsage.inputTokens += usage.inputTokens;
    this.totalUsage.outputTokens += usage.outputTokens;
    this.totalUsage.totalTokens += usage.totalTokens;
    this.totalUsage.reasoningTokens += usage.reasoningTokens;
    this.totalUsage.cacheReadTokens += usage.cacheReadTokens;
    this.totalUsage.cacheWriteTokens += usage.cacheWriteTokens;
  }

  getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  reset() {
    this.totalUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    };
  }

  // Format for display
  formatUsage(usage?: TokenUsage): string {
    const u = usage || this.totalUsage;
    let parts = [`↑${u.inputTokens}`, `↓${u.outputTokens}`];
    
    if (u.reasoningTokens > 0) {
      parts.push(`⚡${u.reasoningTokens}`);
    }
    
    if (u.cacheReadTokens > 0) {
      parts.push(`📖${u.cacheReadTokens}`);
    }
    
    if (u.cacheWriteTokens > 0) {
      parts.push(`📝${u.cacheWriteTokens}`);
    }
    
    return parts.join(" ");
  }
}

// Usage with streaming
async function countTokensInStream() {
  const tokenCounter = new TokenCounter();
  
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Tell me about AI" }],
    stream: true,
    stream_options: { include_usage: true } // Important for token counts
  });

  for await (const chunk of stream) {
    // Token usage comes in final chunk when stream_options.include_usage = true
    if (chunk.usage) {
      const usage = tokenCounter.extractChatCompletionUsage(chunk.usage);
      console.log("Token usage:", tokenCounter.formatUsage(usage));
    }
  }
  
  console.log("Total usage:", tokenCounter.formatUsage());
}
```

### Token Estimation (for planning)

```typescript
// Rough token estimation for planning purposes
function estimateTokens(text: string): number {
  // Very rough approximation: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: any[]): number {
  let total = 0;
  
  for (const message of messages) {
    if (typeof message.content === "string") {
      total += estimateTokens(message.content);
    } else if (Array.isArray(message.content)) {
      for (const content of message.content) {
        if (content.text) {
          total += estimateTokens(content.text);
        }
      }
    }
    
    // Add overhead for message formatting
    total += 10;
  }
  
  return total;
}

// Check if request will fit in context window
function checkContextLimit(messages: any[], maxTokens: number = 128000): boolean {
  const estimated = estimateMessageTokens(messages);
  const safetyMargin = 1000; // Reserve tokens for response
  
  return estimated + safetyMargin < maxTokens;
}
```

## Caching

### Cache Headers and Configuration

```typescript
// OpenAI supports prompt caching via special message formatting
// Cache is automatically used when messages are repeated

async function demonstrateCaching() {
  const longSystemPrompt = `
    You are an expert software engineer with deep knowledge of TypeScript, React, Node.js...
    [Very long system prompt - 1000+ tokens]
  `;

  // First request - will cache the system prompt
  const response1 = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: longSystemPrompt },
      { role: "user", content: "Explain TypeScript generics" }
    ]
  });

  console.log("First request usage:", response1.usage);

  // Second request with same system prompt - will use cache
  const response2 = await client.chat.completions.create({
    model: "gpt-4o", 
    messages: [
      { role: "system", content: longSystemPrompt }, // Cached
      { role: "user", content: "Explain React hooks" }
    ]
  });

  console.log("Second request usage:", response2.usage);
  console.log("Cache read tokens:", response2.usage?.prompt_tokens_details?.cached_tokens);
}
```

### Manual Cache Control

```typescript
// For providers that support explicit cache control
interface CacheConfig {
  enabled: boolean;
  ttl?: number; // Time to live in seconds
}

class CachedClient {
  private client: OpenAI;
  private cache = new Map<string, { response: any; timestamp: number; ttl: number }>();

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  private getCacheKey(messages: any[], model: string): string {
    return JSON.stringify({ messages, model });
  }

  private isCacheValid(entry: { timestamp: number; ttl: number }): boolean {
    return Date.now() - entry.timestamp < entry.ttl * 1000;
  }

  async completionWithCache(
    messages: any[], 
    model: string,
    cacheConfig: CacheConfig = { enabled: true, ttl: 3600 }
  ) {
    if (cacheConfig.enabled) {
      const cacheKey = this.getCacheKey(messages, model);
      const cached = this.cache.get(cacheKey);
      
      if (cached && this.isCacheValid(cached)) {
        console.log("Cache hit");
        return cached.response;
      }
    }

    const response = await this.client.chat.completions.create({
      model,
      messages
    });

    if (cacheConfig.enabled) {
      const cacheKey = this.getCacheKey(messages, model);
      this.cache.set(cacheKey, {
        response,
        timestamp: Date.now(),
        ttl: cacheConfig.ttl || 3600
      });
    }

    return response;
  }

  clearCache() {
    this.cache.clear();
  }
}
```

## Chat Completions vs Responses API

### When to Use Each API

```typescript
// Chat Completions API - Traditional conversational interface
// Use for: Most general chat/completion tasks
interface ChatCompletionsUseCase {
  // ✅ Good for:
  // - Regular conversations
  // - Function/tool calling
  // - Most models (gpt-4o, claude, gemini via compatibility)
  // - Streaming text generation
  // - File uploads and vision
  
  // ❌ Limitations:
  // - No access to reasoning/thinking tokens for o1/o3
  // - Less structured for complex workflows
}

// Responses API - Structured response interface  
// Use for: Complex reasoning tasks, tool workflows
interface ResponsesAPIUseCase {
  // ✅ Good for:
  // - o1/o3 models with reasoning access
  // - Complex tool calling workflows
  // - Structured output requirements
  // - Background processing
  // - Access to reasoning tokens
  
  // ❌ Limitations:
  // - Newer API with less ecosystem support
  // - More complex message format
  // - Not all models supported
}
```

### API Decision Logic

```typescript
function selectAPI(
  model: string, 
  requiresReasoning: boolean,
  hasComplexTools: boolean
): "completions" | "responses" {
  // Use Responses API for o1/o3 when reasoning is needed
  if ((model.includes("o1") || model.includes("o3")) && requiresReasoning) {
    return "responses";
  }
  
  // Use Responses API for complex tool workflows
  if (hasComplexTools && model.includes("gpt-4")) {
    return "responses";
  }
  
  // Default to Chat Completions for broader compatibility
  return "completions";
}

// Usage example
const model = "o1-mini";
const needsReasoning = true;
const api = selectAPI(model, needsReasoning, false);

if (api === "responses") {
  console.log("Using Responses API for reasoning access");
} else {
  console.log("Using Chat Completions API for compatibility");
}
```

### Dual API Client

```typescript
class DualAPIClient {
  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async complete(params: {
    model: string;
    messages: any[];
    tools?: any[];
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    reasoning?: boolean;
  }) {
    const api = this.selectAPI(params.model, params.reasoning || false);
    
    if (api === "responses") {
      return this.callResponsesAPI(params);
    } else {
      return this.callChatCompletionsAPI(params);
    }
  }

  private selectAPI(model: string, requiresReasoning: boolean): "completions" | "responses" {
    if ((model.includes("o1") || model.includes("o3")) && requiresReasoning) {
      return "responses";
    }
    return "completions";
  }

  private async callChatCompletionsAPI(params: any) {
    const requestParams = {
      model: params.model,
      messages: params.messages,
      max_completion_tokens: params.maxTokens,
      temperature: params.temperature,
      tools: params.tools,
      stream: params.stream
    };

    if (params.stream) {
      return this.client.chat.completions.create(requestParams);
    } else {
      return this.client.chat.completions.create(requestParams);
    }
  }

  private async callResponsesAPI(params: any) {
    // Convert messages to Responses API format
    const input = params.messages.map((msg: any) => {
      if (msg.role === "user") {
        return {
          role: "user",
          content: [{ type: "input_text", text: msg.content }]
        };
      } else if (msg.role === "system") {
        return {
          role: "developer", 
          content: msg.content
        };
      }
      return msg;
    });

    const requestParams = {
      model: params.model,
      input,
      max_output_tokens: params.maxTokens,
      tools: params.tools,
      stream: params.stream,
      reasoning: params.reasoning ? { effort: "low" } : undefined
    };

    return this.client.responses.create(requestParams);
  }
}
```

## Tool/Function Calling

### Tool Definition Format

```typescript
// OpenAI tool definition format (JSON Schema)
interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

// Example tool definitions
const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to read"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function", 
    function: {
      name: "execute_command",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to execute"
          },
          timeout: {
            type: "number",
            description: "Timeout in seconds",
            default: 30
          }
        },
        required: ["command"]
      }
    }
  }
];
```

### Tool Execution Engine

```typescript
type ToolFunction = (args: any) => Promise<string>;

class ToolExecutor {
  private tools = new Map<string, ToolFunction>();

  register(name: string, fn: ToolFunction) {
    this.tools.set(name, fn);
  }

  async execute(name: string, argsJson: string): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const args = JSON.parse(argsJson);
      return await tool(args);
    } catch (error) {
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }

  getAvailableTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

// Register tool implementations
const toolExecutor = new ToolExecutor();

toolExecutor.register("read_file", async (args: { path: string }) => {
  const fs = await import("fs/promises");
  try {
    const content = await fs.readFile(args.path, "utf-8");
    return content;
  } catch (error) {
    return `Error reading file: ${error.message}`;
  }
});

toolExecutor.register("execute_command", async (args: { command: string; timeout?: number }) => {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    const { stdout, stderr } = await execAsync(args.command, {
      timeout: (args.timeout || 30) * 1000
    });
    return stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
  } catch (error) {
    return `Command failed: ${error.message}`;
  }
});
```

### Complete Tool Calling Flow

```typescript
async function completeChatWithTools(userMessage: string) {
  const conversation = new ConversationManager("completions", "You are a helpful assistant with file system access.");
  const tokenCounter = new TokenCounter();
  
  conversation.addUserMessage(userMessage);
  
  while (true) {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: conversation.getMessages(),
      tools,
      tool_choice: "auto",
      max_completion_tokens: 1000
    });

    // Track token usage
    if (response.usage) {
      tokenCounter.extractChatCompletionUsage(response.usage);
    }

    const message = response.choices[0].message;
    
    if (message.tool_calls && message.tool_calls.length > 0) {
      // Add assistant message with tool calls to conversation
      conversation.getMessages().push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls
      });

      // Execute each tool call
      for (const toolCall of message.tool_calls) {
        console.log(`🔧 Calling ${toolCall.function.name}...`);
        
        try {
          const result = await toolExecutor.execute(
            toolCall.function.name, 
            toolCall.function.arguments
          );
          
          console.log(`✅ Tool result: ${result.substring(0, 100)}...`);
          conversation.addToolResult(toolCall.id, result);
          
        } catch (error) {
          console.log(`❌ Tool error: ${error.message}`);
          conversation.addToolResult(toolCall.id, `Error: ${error.message}`);
        }
      }
      
      // Continue conversation with tool results
      continue;
    } else {
      // Final response
      const content = message.content || "";
      conversation.addAssistantMessage(content);
      
      console.log("🤖 Assistant:", content);
      console.log("📊 Token usage:", tokenCounter.formatUsage());
      
      return content;
    }
  }
}

// Usage
await completeChatWithTools("Read the package.json file and tell me about this project");
```

### Streaming Tool Calls

```typescript
async function streamingToolCalls(userMessage: string) {
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: userMessage }],
    tools,
    tool_choice: "auto",
    stream: true
  });

  let currentToolCalls: Map<string, { name: string; args: string }> = new Map();
  let assistantMessage = "";

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const delta = choice.delta;

    // Regular content
    if (delta.content) {
      assistantMessage += delta.content;
      process.stdout.write(delta.content);
    }

    // Tool call deltas
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const id = toolCallDelta.id;
        if (!id) continue;

        if (!currentToolCalls.has(id)) {
          currentToolCalls.set(id, { name: "", args: "" });
        }

        const toolCall = currentToolCalls.get(id)!;
        
        if (toolCallDelta.function?.name) {
          toolCall.name += toolCallDelta.function.name;
        }
        
        if (toolCallDelta.function?.arguments) {
          toolCall.args += toolCallDelta.function.arguments;
        }
      }
    }

    // When finished, execute accumulated tool calls
    if (choice.finish_reason === "tool_calls") {
      console.log("\n🔧 Executing tools...");
      
      for (const [id, toolCall] of currentToolCalls) {
        try {
          const result = await toolExecutor.execute(toolCall.name, toolCall.args);
          console.log(`✅ ${toolCall.name}: ${result.substring(0, 100)}...`);
        } catch (error) {
          console.log(`❌ ${toolCall.name}: ${error.message}`);
        }
      }
      
      break;
    }
  }
}
```

### Responses API Tool Calling

```typescript
async function responsesAPIToolCalling() {
  const response = await client.responses.create({
    model: "gpt-4o",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "List files in current directory" }]
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "list_directory",
          description: "List files in a directory",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directory path" }
            },
            required: ["path"]
          }
        }
      }
    ]
  });

  for (const item of response.output || []) {
    switch (item.type) {
      case "function_call":
        console.log(`🔧 Tool call: ${item.name}`);
        console.log(`📝 Arguments: ${item.arguments}`);
        
        try {
          const result = await toolExecutor.execute(item.name, item.arguments);
          console.log(`✅ Result: ${result}`);
          
          // In a real implementation, you'd add this result back to the conversation
          // and continue the response
        } catch (error) {
          console.log(`❌ Error: ${error.message}`);
        }
        break;
        
      case "message":
        for (const content of item.content || []) {
          if (content.type === "output_text") {
            console.log("🤖 Response:", content.text);
          }
        }
        break;
    }
  }
}
```

## System Prompts

### System Prompt Handling by Model Type

```typescript
interface SystemPromptConfig {
  content: string;
  role: "system" | "developer";  // Different models use different roles
}

function formatSystemPrompt(prompt: string, model: string, api: "completions" | "responses"): any {
  // Chat Completions API
  if (api === "completions") {
    // Most models use "system" role
    if (model.includes("claude") || model.includes("gemini")) {
      // Some providers via OpenAI compatibility might expect "system"
      return { role: "system", content: prompt };
    }
    
    // OpenAI native models
    return { role: "system", content: prompt };
  }
  
  // Responses API uses "developer" role for system messages
  return { role: "developer", content: prompt };
}

// System prompt best practices
const systemPrompts = {
  // General assistant
  assistant: "You are a helpful, accurate, and reliable AI assistant. Provide clear, concise, and helpful responses.",
  
  // Code assistant
  coder: `You are an expert software engineer with deep knowledge of multiple programming languages, frameworks, and best practices. 

Key principles:
- Write clean, maintainable, and well-documented code
- Follow language-specific conventions and best practices  
- Explain your reasoning and trade-offs
- Suggest improvements and alternatives when appropriate
- Always test your code mentally before providing it

When helping with code:
1. Understand the requirements fully
2. Choose appropriate tools and patterns
3. Provide working, tested solutions
4. Explain key concepts and decisions`,

  // Research assistant
  researcher: `You are a thorough research assistant. When answering questions:

1. Provide accurate, well-sourced information
2. Acknowledge limitations in your knowledge
3. Structure responses clearly with headings and bullet points
4. Cite sources when possible
5. Distinguish between facts, analysis, and opinions
6. Ask clarifying questions when the request is ambiguous`,

  // Tool-enabled assistant
  toolEnabled: `You are an AI assistant with access to various tools for file operations, web searches, and code execution.

Guidelines for tool use:
- Use tools when they would be helpful to answer the user's question
- Always explain what you're doing before calling a tool
- Interpret and summarize tool results for the user
- If a tool fails, try alternative approaches
- Be transparent about what information comes from tools vs your training

Available capabilities:
- Read and write files
- Execute shell commands
- Search the web
- Analyze code and data`
};
```

### Dynamic System Prompt Building

```typescript
class SystemPromptBuilder {
  private sections: string[] = [];

  addRole(role: string): this {
    this.sections.push(`You are ${role}.`);
    return this;
  }

  addCapabilities(capabilities: string[]): this {
    if (capabilities.length > 0) {
      this.sections.push(`You have access to: ${capabilities.join(", ")}.`);
    }
    return this;
  }

  addGuidelines(guidelines: string[]): this {
    if (guidelines.length > 0) {
      this.sections.push("Guidelines:\n" + guidelines.map(g => `- ${g}`).join("\n"));
    }
    return this;
  }

  addContext(context: string): this {
    if (context.trim()) {
      this.sections.push(`Context: ${context}`);
    }
    return this;
  }

  build(): string {
    return this.sections.join("\n\n");
  }

  reset(): this {
    this.sections = [];
    return this;
  }
}

// Usage examples
const codeAssistantPrompt = new SystemPromptBuilder()
  .addRole("an expert TypeScript developer")
  .addCapabilities(["file system access", "code execution", "documentation lookup"])
  .addGuidelines([
    "Write clean, type-safe code",
    "Explain complex concepts clearly", 
    "Suggest best practices",
    "Test code before providing it"
  ])
  .build();

const customerServicePrompt = new SystemPromptBuilder()
  .addRole("a helpful customer service representative")
  .addGuidelines([
    "Be polite and professional",
    "Listen carefully to customer concerns",
    "Provide accurate information",
    "Escalate complex issues when needed"
  ])
  .addContext("You work for TechCorp, a software company that makes productivity tools.")
  .build();
```

### Model-Specific System Prompt Optimization

```typescript
function optimizeSystemPromptForModel(basePrompt: string, model: string): string {
  // OpenAI models (especially o1/o3) work well with detailed, structured prompts
  if (model.includes("gpt") || model.includes("o1") || model.includes("o3")) {
    return `${basePrompt}

Think step by step when solving complex problems. Show your reasoning process clearly.`;
  }
  
  // Claude models prefer more conversational, principle-based prompts
  if (model.includes("claude")) {
    return `${basePrompt}

I value helpful, harmless, and honest responses. Please be thoughtful and thorough in your analysis.`;
  }
  
  // Gemini models work well with structured instructions
  if (model.includes("gemini")) {
    return `${basePrompt}

Please structure your responses clearly and provide specific, actionable advice.`;
  }
  
  // Default: return as-is
  return basePrompt;
}

// Provider-specific prompt injection handling
function detectAndMitigatePromptInjection(userInput: string): { safe: boolean; cleaned?: string } {
  const injectionPatterns = [
    /ignore.*previous.*instruction/i,
    /forget.*system.*prompt/i,
    /act.*as.*different/i,
    /pretend.*you.*are/i,
    /new.*role.*now/i
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(userInput)) {
      return { 
        safe: false, 
        cleaned: userInput.replace(pattern, "[FILTERED]")
      };
    }
  }

  return { safe: true };
}
```

## Provider-Specific Features

### Reasoning Support Detection

```typescript
// From pi-agent codebase - detect and handle reasoning support per provider
type Provider = "openai" | "gemini" | "groq" | "anthropic" | "openrouter" | "other";

function detectProvider(baseURL?: string): Provider {
  if (!baseURL) return "openai";
  if (baseURL.includes("api.openai.com")) return "openai";
  if (baseURL.includes("generativelanguage.googleapis.com")) return "gemini";
  if (baseURL.includes("api.groq.com")) return "groq";
  if (baseURL.includes("api.anthropic.com")) return "anthropic";
  if (baseURL.includes("openrouter.ai")) return "openrouter";
  return "other";
}

// Provider-specific reasoning parameter handling
function adjustRequestForReasoning(
  requestOptions: any,
  api: "completions" | "responses",
  provider: Provider,
  supportsReasoning: boolean
): any {
  if (!supportsReasoning) return requestOptions;

  switch (provider) {
    case "openai":
      // OpenAI standard format
      if (api === "responses") {
        requestOptions.reasoning = {
          effort: "low",
          summary: "detailed"
        };
      } else {
        requestOptions.reasoning_effort = "low";
      }
      break;

    case "gemini":
      // Gemini uses extra_body for thinking configuration
      if (api === "completions") {
        requestOptions.extra_body = {
          google: {
            thinking_config: {
              thinking_budget: 1024,
              include_thoughts: true
            }
          }
        };
        // Remove reasoning_effort when using thinking_config
        delete requestOptions.reasoning_effort;
      }
      break;

    case "groq":
      // Groq uses reasoning_format for Chat Completions
      if (api === "completions") {
        requestOptions.reasoning_format = "parsed";
        requestOptions.reasoning_effort = "low";
      } else {
        // Groq Responses API doesn't support reasoning.summary
        requestOptions.reasoning = { effort: "low" };
      }
      break;

    case "openrouter":
      // OpenRouter unified reasoning format
      if (api === "completions") {
        requestOptions.reasoning = { effort: "low" };
        delete requestOptions.reasoning_effort;
      }
      break;

    default:
      // Standard OpenAI format for others
      if (api === "responses") {
        requestOptions.reasoning = { effort: "low" };
      } else {
        requestOptions.reasoning_effort = "low";
      }
  }

  return requestOptions;
}
```

### Provider-Specific Response Parsing

```typescript
// Extract reasoning content from provider-specific response formats
function parseReasoningFromMessage(message: any, provider: Provider): {
  cleanContent: string;
  reasoningTexts: string[];
} {
  const reasoningTexts: string[] = [];
  let cleanContent = message.content || "";

  switch (provider) {
    case "gemini":
      // Gemini returns thinking in <thought> tags
      if (cleanContent.includes("<thought>")) {
        const thoughtMatches = cleanContent.matchAll(/<thought>([\s\S]*?)<\/thought>/g);
        for (const match of thoughtMatches) {
          reasoningTexts.push(match[1].trim());
        }
        // Remove thought tags from response
        cleanContent = cleanContent.replace(/<thought>[\s\S]*?<\/thought>/g, "").trim();
      }
      break;

    case "groq":
      // Groq returns reasoning in separate field
      if (message.reasoning) {
        reasoningTexts.push(message.reasoning);
      }
      break;

    case "openrouter":
      // OpenRouter uses message.reasoning field
      if (message.reasoning) {
        reasoningTexts.push(message.reasoning);
      }
      break;

    default:
      // OpenAI and others handle reasoning via events
      break;
  }

  return { cleanContent, reasoningTexts };
}
```

### Provider-Specific Error Handling

```typescript
function handleProviderSpecificErrors(error: any, provider: Provider): Error {
  switch (provider) {
    case "groq":
      if (error.message?.includes("reasoning_format")) {
        return new Error("Reasoning not supported by this Groq model");
      }
      break;

    case "gemini":
      if (error.message?.includes("thinking_config")) {
        return new Error("Thinking mode not supported by this Gemini model");
      }
      break;

    case "anthropic":
      if (error.message?.includes("reasoning")) {
        return new Error("Reasoning not available via Anthropic's OpenAI compatibility layer");
      }
      break;

    case "openrouter":
      // OpenRouter passes through underlying provider errors
      if (error.message?.includes("not supported")) {
        return new Error("Feature not supported by the selected model on OpenRouter");
      }
      break;
  }

  return error;
}
```

## Complete Implementation Examples

### Basic Chat Client

```typescript
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

class BasicChatClient {
  private client: OpenAI;
  private messages: ChatCompletionMessageParam[] = [];

  constructor(apiKey: string, baseURL?: string, systemPrompt?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    
    if (systemPrompt) {
      this.messages.push({ role: "system", content: systemPrompt });
    }
  }

  async chat(userMessage: string): Promise<string> {
    this.messages.push({ role: "user", content: userMessage });

    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o",
        messages: this.messages,
        max_completion_tokens: 1000,
        temperature: 0.7
      });

      const assistantMessage = response.choices[0]?.message?.content || "";
      this.messages.push({ role: "assistant", content: assistantMessage });

      return assistantMessage;
    } catch (error) {
      console.error("Chat error:", error);
      throw error;
    }
  }

  getHistory(): ChatCompletionMessageParam[] {
    return [...this.messages];
  }

  clearHistory(): void {
    this.messages = this.messages.filter(m => m.role === "system");
  }
}
```

### Advanced Streaming Client with All Features

```typescript
import OpenAI from "openai";
import type { 
  ChatCompletionCreateParamsStreaming,
  ChatCompletionChunk 
} from "openai/resources/chat/completions";

interface StreamingClientConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  systemPrompt?: string;
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
}

interface StreamEvent {
  type: "content" | "tool_call" | "reasoning" | "usage" | "error" | "complete";
  data: any;
}

class AdvancedStreamingClient {
  private client: OpenAI;
  private config: StreamingClientConfig;
  private messages: any[] = [];
  private abortController: AbortController | null = null;
  private tokenCounter = new TokenCounter();

  constructor(config: StreamingClientConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL
    });

    if (config.systemPrompt) {
      this.messages.push({ role: "system", content: config.systemPrompt });
    }
  }

  async *streamChat(userMessage: string): AsyncGenerator<StreamEvent> {
    this.messages.push({ role: "user", content: userMessage });
    this.abortController = new AbortController();

    try {
      const params: ChatCompletionCreateParamsStreaming = {
        model: this.config.model,
        messages: this.messages,
        stream: true,
        max_completion_tokens: this.config.maxTokens || 1000,
        temperature: this.config.temperature || 0.7,
        tools: this.config.tools,
        tool_choice: this.config.tools ? "auto" : undefined,
        stream_options: { include_usage: true }
      };

      const stream = await this.client.chat.completions.create(params, {
        signal: this.abortController.signal
      });

      let assistantContent = "";
      let currentToolCalls = new Map<string, any>();

      for await (const chunk of stream) {
        if (this.abortController.signal.aborted) break;

        const choice = chunk.choices[0];
        if (!choice) continue;

        // Handle content
        if (choice.delta?.content) {
          assistantContent += choice.delta.content;
          yield {
            type: "content",
            data: { delta: choice.delta.content, content: assistantContent }
          };
        }

        // Handle tool calls
        if (choice.delta?.tool_calls) {
          for (const toolCall of choice.delta.tool_calls) {
            if (!toolCall.id) continue;

            if (!currentToolCalls.has(toolCall.id)) {
              currentToolCalls.set(toolCall.id, {
                id: toolCall.id,
                name: "",
                arguments: ""
              });
            }

            const call = currentToolCalls.get(toolCall.id);
            if (toolCall.function?.name) {
              call.name += toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              call.arguments += toolCall.function.arguments;
            }

            yield {
              type: "tool_call",
              data: { id: toolCall.id, delta: toolCall, current: call }
            };
          }
        }

        // Handle usage
        if (chunk.usage) {
          const usage = this.tokenCounter.extractChatCompletionUsage(chunk.usage);
          yield {
            type: "usage",
            data: usage
          };
        }

        // Handle completion
        if (choice.finish_reason) {
          if (choice.finish_reason === "tool_calls") {
            // Execute tool calls
            const toolResults = await this.executeToolCalls(Array.from(currentToolCalls.values()));
            
            // Add messages and continue
            this.messages.push({
              role: "assistant",
              content: assistantContent || null,
              tool_calls: Array.from(currentToolCalls.values()).map(call => ({
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: call.arguments
                }
              }))
            });

            for (const result of toolResults) {
              this.messages.push({
                role: "tool",
                tool_call_id: result.id,
                content: result.content
              });
            }

            // Continue stream for final response
            yield* this.streamChat("");
            return;
          } else {
            // Regular completion
            if (assistantContent) {
              this.messages.push({ role: "assistant", content: assistantContent });
            }

            yield {
              type: "complete",
              data: { reason: choice.finish_reason, content: assistantContent }
            };
          }
        }
      }
    } catch (error) {
      yield {
        type: "error",
        data: { error: error.message }
      };
    } finally {
      this.abortController = null;
    }
  }

  private async executeToolCalls(toolCalls: any[]): Promise<Array<{ id: string; content: string }>> {
    const results = [];
    
    for (const call of toolCalls) {
      try {
        // Tool execution would be implemented here
        const result = await this.executeTool(call.name, call.arguments);
        results.push({ id: call.id, content: result });
      } catch (error) {
        results.push({ id: call.id, content: `Error: ${error.message}` });
      }
    }
    
    return results;
  }

  private async executeTool(name: string, argsJson: string): Promise<string> {
    // Implement tool execution logic
    return `Tool ${name} executed with args: ${argsJson}`;
  }

  interrupt(): void {
    this.abortController?.abort();
  }

  getUsage() {
    return this.tokenCounter.getTotalUsage();
  }
}

// Usage example
const client = new AdvancedStreamingClient({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o",
  systemPrompt: "You are a helpful assistant.",
  tools: [/* tool definitions */]
});

for await (const event of client.streamChat("Help me write a TypeScript function")) {
  switch (event.type) {
    case "content":
      process.stdout.write(event.data.delta);
      break;
    case "tool_call":
      console.log(`\n🔧 Tool: ${event.data.current.name}`);
      break;
    case "usage":
      console.log(`\n📊 Tokens: ${event.data.totalTokens}`);
      break;
    case "complete":
      console.log(`\n✅ Complete (${event.data.reason})`);
      break;
    case "error":
      console.log(`\n❌ Error: ${event.data.error}`);
      break;
  }
}
```

This comprehensive guide covers all the essential features needed to implement a robust OpenAI SDK integration. Each section provides working code examples, actual types from the SDK, and real-world patterns from the pi-mono codebase.

## Key Takeaways

1. **Always use AbortController** for request cancellation
2. **Handle both Chat Completions and Responses APIs** depending on model capabilities
3. **Implement comprehensive error handling** with proper error types
4. **Track token usage** for cost management and optimization
5. **Support streaming** for better user experience
6. **Handle provider-specific features** like reasoning and caching
7. **Implement proper tool calling workflows** for agentic applications
8. **Serialize conversation state** for session persistence
9. **Use appropriate system prompts** for different model types
10. **Test reasoning support** dynamically for each provider/model combination