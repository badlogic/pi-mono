# Google Gemini SDK Implementation Guide

This document provides comprehensive implementation guidance for the Google Gemini SDK (`@google/genai`) showing exactly how to implement all required features for our unified AI API.

## Table of Contents

1. [Setup and Basic Usage](#setup-and-basic-usage)
2. [Streaming Responses](#streaming-responses)
3. [Aborting Requests](#aborting-requests)
4. [Error Handling](#error-handling)
5. [Stop Reasons](#stop-reasons)
6. [Message History and Serialization](#message-history-and-serialization)
7. [Token Counting](#token-counting)
8. [Context Caching](#context-caching)
9. [Function Calling (Tools)](#function-calling-tools)
10. [System Instructions](#system-instructions)
11. [Parts System for Content](#parts-system-for-content)
12. [Thinking Tokens](#thinking-tokens)
13. [Peculiarities and Gotchas](#peculiarities-and-gotchas)

## Setup and Basic Usage

### Installation and Initialization

```typescript
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';

// Initialize client
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  // Optional: Use Vertex AI instead
  // vertexai: true,
  // project: 'your-project-id',
  // location: 'us-central1',
});

// Basic non-streaming request
const response = await client.models.generateContent({
  model: 'gemini-2.0-flash-exp',
  contents: 'Hello, how are you?'
});

console.log(response.text);
```

### Key Types and Interfaces

```typescript
// Core types from the SDK
interface GoogleGenAIOptions {
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  apiVersion?: string;
}

interface Content {
  parts?: Part[];
  role?: string; // 'user' | 'model'
}

interface Part {
  text?: string;
  thought?: boolean; // For thinking content
  functionCall?: FunctionCall;
  functionResponse?: FunctionResponse;
  inlineData?: Blob;
  fileData?: FileData;
}

interface GenerateContentResponse {
  candidates?: Candidate[];
  usageMetadata?: GenerateContentResponseUsageMetadata;
  promptFeedback?: GenerateContentResponsePromptFeedback;
  text: string | undefined; // Convenience getter
}
```

## Streaming Responses

Gemini supports streaming via `generateContentStream` which returns an `AsyncGenerator`:

```typescript
async function streamContent() {
  const stream = await client.models.generateContentStream({
    model: 'gemini-2.0-flash-exp',
    contents: 'Write a short story about a robot.'
  });

  let fullText = '';
  for await (const chunk of stream) {
    // Each chunk is a GenerateContentResponse
    const chunkText = chunk.text;
    if (chunkText) {
      fullText += chunkText;
      process.stdout.write(chunkText); // Stream to output
    }

    // Check for function calls in streaming
    if (chunk.candidates?.[0]?.content?.parts) {
      for (const part of chunk.candidates[0].content.parts) {
        if (part.functionCall) {
          console.log('Function call:', part.functionCall);
        }
        if (part.thought) {
          console.log('Thinking:', part.text);
        }
      }
    }
  }

  return fullText;
}
```

### Streaming with Thinking Tokens

```typescript
async function streamWithThinking() {
  const stream = await client.models.generateContentStream({
    model: 'gemini-2.0-flash-thinking-exp-1219',
    contents: 'Solve this math problem: 2x + 5 = 13'
  });

  let thinking = '';
  let response = '';

  for await (const chunk of stream) {
    if (chunk.candidates?.[0]?.content?.parts) {
      for (const part of chunk.candidates[0].content.parts) {
        if (part.thought && part.text) {
          thinking += part.text;
          console.log('[THINKING]', part.text);
        } else if (part.text && !part.thought) {
          response += part.text;
          console.log('[RESPONSE]', part.text);
        }
      }
    }
  }

  return { thinking, response };
}
```

## Aborting Requests

Gemini supports request cancellation via `AbortSignal`:

```typescript
class GeminiClient {
  private currentController: AbortController | null = null;

  async generateWithCancellation(prompt: string): Promise<string> {
    // Create new abort controller
    this.currentController = new AbortController();

    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        abortSignal: this.currentController.signal
      });

      return response.text || '';
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request was cancelled');
        throw new Error('Request cancelled by user');
      }
      throw error;
    } finally {
      this.currentController = null;
    }
  }

  async generateStreamWithCancellation(prompt: string): Promise<AsyncGenerator<string>> {
    this.currentController = new AbortController();

    try {
      const stream = await client.models.generateContentStream({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        abortSignal: this.currentController.signal
      });

      return this.processStream(stream);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request cancelled by user');
      }
      throw error;
    }
  }

  private async* processStream(stream: AsyncGenerator<GenerateContentResponse>): AsyncGenerator<string> {
    try {
      for await (const chunk of stream) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return; // Exit generator cleanly
      }
      throw error;
    } finally {
      this.currentController = null;
    }
  }

  // Cancel current request
  cancel(): void {
    if (this.currentController) {
      this.currentController.abort();
    }
  }
}
```

## Error Handling

### Error Types and Handling

```typescript
import { ApiError } from '@google/genai';

interface GeminiErrorInfo {
  type: 'rate_limit' | 'auth' | 'invalid_request' | 'network' | 'server' | 'unknown';
  message: string;
  statusCode?: number;
  retryable: boolean;
}

function handleGeminiError(error: unknown): GeminiErrorInfo {
  if (error instanceof ApiError) {
    const statusCode = error.status;
    
    switch (statusCode) {
      case 401:
      case 403:
        return {
          type: 'auth',
          message: 'Authentication failed - check API key',
          statusCode,
          retryable: false
        };
        
      case 429:
        return {
          type: 'rate_limit',
          message: 'Rate limit exceeded',
          statusCode,
          retryable: true
        };
        
      case 400:
        return {
          type: 'invalid_request',
          message: error.message || 'Invalid request parameters',
          statusCode,
          retryable: false
        };
        
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          type: 'server',
          message: 'Server error - try again later',
          statusCode,
          retryable: true
        };
        
      default:
        return {
          type: 'unknown',
          message: error.message || 'Unknown API error',
          statusCode,
          retryable: false
        };
    }
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return {
        type: 'network',
        message: 'Request was cancelled',
        retryable: false
      };
    }

    return {
      type: 'network',
      message: error.message,
      retryable: true
    };
  }

  return {
    type: 'unknown',
    message: 'Unknown error occurred',
    retryable: false
  };
}

// Usage with retry logic
async function generateWithRetry(prompt: string, maxRetries = 3): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt
      });
      
      return response.text || '';
    } catch (error) {
      const errorInfo = handleGeminiError(error);
      
      if (!errorInfo.retryable || attempt === maxRetries) {
        throw new Error(`${errorInfo.type}: ${errorInfo.message}`);
      }
      
      // Exponential backoff for retryable errors
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Max retries exceeded');
}
```

## Stop Reasons

Gemini provides finish reasons in the response candidates:

```typescript
enum FinishReason {
  FINISH_REASON_UNSPECIFIED = 'FINISH_REASON_UNSPECIFIED',
  STOP = 'STOP', // Natural stop
  MAX_TOKENS = 'MAX_TOKENS', // Hit token limit
  SAFETY = 'SAFETY', // Safety filter triggered
  RECITATION = 'RECITATION', // Recitation filter
  LANGUAGE = 'LANGUAGE', // Language not supported
  OTHER = 'OTHER'
}

function extractStopReason(response: GenerateContentResponse): string | null {
  const candidate = response.candidates?.[0];
  if (!candidate) return null;
  
  return candidate.finishReason || null;
}

// Handle different stop reasons
function handleStopReason(response: GenerateContentResponse): void {
  const reason = extractStopReason(response);
  
  switch (reason) {
    case 'STOP':
      console.log('Response completed naturally');
      break;
      
    case 'MAX_TOKENS':
      console.log('Response truncated due to token limit');
      break;
      
    case 'SAFETY':
      console.log('Response blocked by safety filters');
      // Check promptFeedback for details
      if (response.promptFeedback?.blockReason) {
        console.log('Block reason:', response.promptFeedback.blockReason);
      }
      break;
      
    case 'RECITATION':
      console.log('Response blocked due to recitation concerns');
      break;
      
    default:
      if (reason) {
        console.log('Unexpected finish reason:', reason);
      }
  }
}
```

## Message History and Serialization

### Managing Conversation History

```typescript
interface SerializableMessage {
  role: 'user' | 'model';
  content: string;
  functionCalls?: FunctionCall[];
  functionResponses?: FunctionResponse[];
  thinking?: string;
}

interface SerializableSession {
  messages: SerializableMessage[];
  totalUsage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    thoughtsTokens?: number;
  };
}

class GeminiConversation {
  private messages: Content[] = [];
  private totalUsage = {
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0,
    thoughtsTokens: 0
  };

  addUserMessage(text: string): void {
    this.messages.push({
      role: 'user',
      parts: [{ text }]
    });
  }

  addAssistantMessage(response: GenerateContentResponse): void {
    const candidate = response.candidates?.[0];
    if (!candidate?.content) return;

    this.messages.push(candidate.content);

    // Update usage
    if (response.usageMetadata) {
      this.totalUsage.promptTokens += response.usageMetadata.promptTokenCount || 0;
      this.totalUsage.candidatesTokens += response.usageMetadata.candidatesTokenCount || 0;
      this.totalUsage.totalTokens += response.usageMetadata.totalTokenCount || 0;
      this.totalUsage.thoughtsTokens += response.usageMetadata.thoughtsTokenCount || 0;
    }
  }

  async sendMessage(text: string): Promise<string> {
    this.addUserMessage(text);

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: this.messages
    });

    this.addAssistantMessage(response);
    return response.text || '';
  }

  // Serialize for persistence
  serialize(): SerializableSession {
    const messages: SerializableMessage[] = [];
    
    for (const content of this.messages) {
      const message: SerializableMessage = {
        role: (content.role as 'user' | 'model') || 'user',
        content: '',
        functionCalls: [],
        functionResponses: [],
        thinking: ''
      };

      for (const part of content.parts || []) {
        if (part.text) {
          if (part.thought) {
            message.thinking += part.text;
          } else {
            message.content += part.text;
          }
        }
        if (part.functionCall) {
          message.functionCalls!.push(part.functionCall);
        }
        if (part.functionResponse) {
          message.functionResponses!.push(part.functionResponse);
        }
      }

      messages.push(message);
    }

    return {
      messages,
      totalUsage: { ...this.totalUsage }
    };
  }

  // Deserialize from storage
  static fromSerialized(session: SerializableSession): GeminiConversation {
    const conversation = new GeminiConversation();
    conversation.totalUsage = { ...session.totalUsage };

    for (const msg of session.messages) {
      const parts: Part[] = [];
      
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      
      if (msg.thinking) {
        parts.push({ text: msg.thinking, thought: true });
      }
      
      for (const funcCall of msg.functionCalls || []) {
        parts.push({ functionCall: funcCall });
      }
      
      for (const funcResp of msg.functionResponses || []) {
        parts.push({ functionResponse: funcResp });
      }

      conversation.messages.push({
        role: msg.role,
        parts
      });
    }

    return conversation;
  }
}
```

## Token Counting

### Understanding Gemini Token Usage

```typescript
interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number; // Output tokens
  totalTokens: number;
  thoughtsTokens?: number; // Thinking tokens (reasoning models)
  cachedContentTokens?: number; // Cache read tokens
}

function extractTokenUsage(response: GenerateContentResponse): TokenUsage {
  const usage = response.usageMetadata;
  
  return {
    promptTokens: usage?.promptTokenCount || 0,
    candidatesTokens: usage?.candidatesTokenCount || 0,
    totalTokens: usage?.totalTokenCount || 0,
    thoughtsTokens: usage?.thoughtsTokenCount || 0,
    cachedContentTokens: usage?.cachedContentTokenCount || 0
  };
}

// Count tokens before sending (estimation)
async function countTokens(content: string | Content[]): Promise<number> {
  const response = await client.models.computeTokens({
    model: 'gemini-2.0-flash-exp',
    contents: typeof content === 'string' 
      ? [{ parts: [{ text: content }] }]
      : content
  });

  return response.totalTokens || 0;
}

// Token usage accumulation
class TokenTracker {
  private usage = {
    totalPromptTokens: 0,
    totalCandidatesTokens: 0,
    totalThoughtsTokens: 0,
    totalCachedTokens: 0,
    totalRequests: 0
  };

  addUsage(response: GenerateContentResponse): void {
    const tokenUsage = extractTokenUsage(response);
    
    this.usage.totalPromptTokens += tokenUsage.promptTokens;
    this.usage.totalCandidatesTokens += tokenUsage.candidatesTokens;
    this.usage.totalThoughtsTokens += tokenUsage.thoughtsTokens || 0;
    this.usage.totalCachedTokens += tokenUsage.cachedContentTokens || 0;
    this.usage.totalRequests++;
  }

  getStats() {
    return {
      ...this.usage,
      totalTokens: this.usage.totalPromptTokens + this.usage.totalCandidatesTokens,
      averageTokensPerRequest: this.usage.totalRequests > 0 
        ? (this.usage.totalPromptTokens + this.usage.totalCandidatesTokens) / this.usage.totalRequests 
        : 0
    };
  }
}
```

## Context Caching

Gemini supports context caching to reduce costs for repeated large prompts:

```typescript
import { type CachedContent } from '@google/genai';

class GeminiCache {
  async createCache(
    systemInstruction: string,
    contents: Content[],
    ttlHours = 1
  ): Promise<CachedContent> {
    const cache = await client.caches.create({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      ttl: `${ttlHours * 3600}s` // Convert hours to seconds
    });

    return cache;
  }

  async generateWithCache(
    cachedContent: CachedContent,
    userMessage: string
  ): Promise<GenerateContentResponse> {
    return await client.models.generateContent({
      model: cachedContent.model || 'gemini-2.0-flash-exp',
      cachedContent: cachedContent.name,
      contents: [{ 
        role: 'user', 
        parts: [{ text: userMessage }] 
      }]
    });
  }

  async listCaches(): Promise<CachedContent[]> {
    const caches = [];
    for await (const cache of client.caches.list()) {
      caches.push(cache);
    }
    return caches;
  }

  async deleteCache(cacheName: string): Promise<void> {
    await client.caches.delete({ name: cacheName });
  }

  // Example: Cache a large document for repeated analysis
  async createDocumentCache(document: string): Promise<CachedContent> {
    const systemInstruction = `
      You are a document analysis assistant. The user will provide a large document,
      and you should be ready to answer questions about it, summarize it, or extract
      information from it.
    `;

    const contents = [{
      role: 'user' as const,
      parts: [{ text: `Please analyze this document:\n\n${document}` }]
    }];

    return this.createCache(systemInstruction, contents, 24); // Cache for 24 hours
  }
}

// Usage example
async function demonstrateCache() {
  const cache = new GeminiCache();
  
  // Create cache with large document
  const document = "... very large document content ...";
  const cachedContent = await cache.createDocumentCache(document);
  
  // Now ask questions using the cache (saves tokens!)
  const response1 = await cache.generateWithCache(
    cachedContent, 
    "What are the key points in this document?"
  );
  
  const response2 = await cache.generateWithCache(
    cachedContent, 
    "Can you summarize the conclusions?"
  );
  
  // Clean up when done
  await cache.deleteCache(cachedContent.name!);
}
```

## Function Calling (Tools)

### Basic Function Calling Setup

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

// Define tools
const tools: ToolDefinition[] = [{
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location'
      },
      units: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: 'Temperature units'
      }
    },
    required: ['location']
  }
}];

// Convert to Gemini format
function createGeminiTools(tools: ToolDefinition[]) {
  return [{
    functionDeclarations: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.parameters
    }))
  }];
}

// Function call handler
async function executeFunction(functionCall: FunctionCall): Promise<any> {
  const { name, args } = functionCall;
  const params = typeof args === 'string' ? JSON.parse(args) : args;

  switch (name) {
    case 'get_weather':
      return await getWeatherData(params.location, params.units);
    default:
      throw new Error(`Unknown function: ${name}`);
  }
}

// Mock weather function
async function getWeatherData(location: string, units = 'celsius') {
  return {
    location,
    temperature: 22,
    conditions: 'sunny',
    units
  };
}
```

### Complete Function Calling Flow

```typescript
class GeminiFunctionCalling {
  private tools: ToolDefinition[];

  constructor(tools: ToolDefinition[]) {
    this.tools = tools;
  }

  async processWithTools(messages: Content[]): Promise<string> {
    let currentMessages = [...messages];
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: currentMessages,
        tools: createGeminiTools(this.tools),
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO' // Let model decide when to call functions
          }
        }
      });

      const candidate = response.candidates?.[0];
      if (!candidate?.content) break;

      // Add assistant response to conversation
      currentMessages.push(candidate.content);

      // Check for function calls
      const functionCalls = this.extractFunctionCalls(candidate.content);
      
      if (functionCalls.length === 0) {
        // No more function calls, return final response
        return response.text || '';
      }

      // Execute function calls
      for (const functionCall of functionCalls) {
        try {
          const result = await executeFunction(functionCall);
          
          // Add function response to conversation
          currentMessages.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: functionCall.name,
                id: functionCall.id,
                response: { result }
              }
            }]
          });
        } catch (error) {
          // Add error response
          currentMessages.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: functionCall.name,
                id: functionCall.id,
                response: { error: error.message }
              }
            }]
          });
        }
      }

      iterations++;
    }

    throw new Error('Max function calling iterations exceeded');
  }

  private extractFunctionCalls(content: Content): FunctionCall[] {
    const calls: FunctionCall[] = [];
    
    for (const part of content.parts || []) {
      if (part.functionCall) {
        calls.push(part.functionCall);
      }
    }
    
    return calls;
  }

  // Streaming version with function calls
  async *processStreamWithTools(messages: Content[]): AsyncGenerator<{
    type: 'content' | 'function_call' | 'function_result';
    content?: string;
    functionCall?: FunctionCall;
    functionResult?: any;
  }> {
    const stream = await client.models.generateContentStream({
      model: 'gemini-2.0-flash-exp',
      contents: messages,
      tools: createGeminiTools(this.tools),
      toolConfig: {
        functionCallingConfig: { mode: 'AUTO' }
      }
    });

    let pendingFunctionCalls: FunctionCall[] = [];

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content) continue;

      for (const part of candidate.content.parts || []) {
        if (part.text && !part.thought) {
          yield { type: 'content', content: part.text };
        }
        
        if (part.functionCall) {
          pendingFunctionCalls.push(part.functionCall);
          yield { type: 'function_call', functionCall: part.functionCall };
        }
      }
    }

    // Execute any pending function calls
    for (const functionCall of pendingFunctionCalls) {
      try {
        const result = await executeFunction(functionCall);
        yield { type: 'function_result', functionResult: result };
      } catch (error) {
        yield { 
          type: 'function_result', 
          functionResult: { error: error.message } 
        };
      }
    }
  }
}
```

## System Instructions

Gemini handles system instructions differently from other providers:

```typescript
// System instruction is a separate parameter, not part of messages
async function generateWithSystemInstruction(
  systemPrompt: string, 
  userMessage: string
): Promise<string> {
  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash-exp',
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: userMessage }]
    }]
  });

  return response.text || '';
}

// For conversation with system instruction
class GeminiConversationWithSystem {
  private systemInstruction: Content;
  private messages: Content[] = [];

  constructor(systemPrompt: string) {
    this.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }

  async sendMessage(text: string): Promise<string> {
    this.messages.push({
      role: 'user',
      parts: [{ text }]
    });

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: this.systemInstruction,
      contents: this.messages
    });

    const candidate = response.candidates?.[0];
    if (candidate?.content) {
      this.messages.push(candidate.content);
    }

    return response.text || '';
  }

  updateSystemInstruction(newPrompt: string): void {
    this.systemInstruction = {
      parts: [{ text: newPrompt }]
    };
  }
}
```

## Parts System for Content

Understanding Gemini's parts-based content system:

```typescript
// Text content
const textPart: Part = {
  text: 'Hello, world!'
};

// Thinking content (for reasoning models)
const thinkingPart: Part = {
  text: 'Let me think about this problem...',
  thought: true
};

// Function call
const functionCallPart: Part = {
  functionCall: {
    name: 'get_weather',
    args: { location: 'San Francisco' }
  }
};

// Function response
const functionResponsePart: Part = {
  functionResponse: {
    name: 'get_weather',
    response: { temperature: 72, conditions: 'sunny' }
  }
};

// Image data (inline)
const imagePart: Part = {
  inlineData: {
    mimeType: 'image/jpeg',
    data: 'base64-encoded-image-data'
  }
};

// File reference
const filePart: Part = {
  fileData: {
    mimeType: 'image/jpeg',
    fileUri: 'gs://bucket/image.jpg'
  }
};

// Creating multi-part content
const multiPartContent: Content = {
  role: 'user',
  parts: [
    { text: 'What is in this image?' },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: await imageToBase64('path/to/image.jpg')
      }
    }
  ]
};

// Utility functions for parts
function createTextPart(text: string): Part {
  return { text };
}

function createThinkingPart(text: string): Part {
  return { text, thought: true };
}

function createImagePart(imageData: string, mimeType: string): Part {
  return {
    inlineData: {
      mimeType,
      data: imageData
    }
  };
}

async function imageToBase64(filePath: string): Promise<string> {
  const fs = await import('fs/promises');
  const buffer = await fs.readFile(filePath);
  return buffer.toString('base64');
}
```

## Thinking Tokens

Gemini thinking models (like `gemini-2.0-flash-thinking-exp-1219`) provide reasoning traces:

```typescript
interface ThinkingExtractor {
  thinking: string;
  response: string;
  thinkingTokens: number;
  responseTokens: number;
}

function extractThinking(response: GenerateContentResponse): ThinkingExtractor {
  let thinking = '';
  let responseText = '';
  
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        if (part.thought) {
          thinking += part.text;
        } else {
          responseText += part.text;
        }
      }
    }
  }

  const usage = response.usageMetadata;
  
  return {
    thinking,
    response: responseText,
    thinkingTokens: usage?.thoughtsTokenCount || 0,
    responseTokens: usage?.candidatesTokenCount || 0
  };
}

// Streaming thinking extraction
async function streamWithThinkingExtraction(prompt: string) {
  const stream = await client.models.generateContentStream({
    model: 'gemini-2.0-flash-thinking-exp-1219',
    contents: prompt
  });

  let thinkingContent = '';
  let responseContent = '';

  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0];
    if (!candidate?.content?.parts) continue;

    for (const part of candidate.content.parts) {
      if (part.text) {
        if (part.thought) {
          thinkingContent += part.text;
          console.log('[THINKING DELTA]', part.text);
        } else {
          responseContent += part.text;
          console.log('[RESPONSE DELTA]', part.text);
        }
      }
    }
  }

  return {
    thinking: thinkingContent,
    response: responseContent
  };
}

// Enable thinking for models that support it
async function generateWithThinking(prompt: string, model = 'gemini-2.0-flash-thinking-exp-1219') {
  const response = await client.models.generateContent({
    model,
    contents: prompt
  });

  return extractThinking(response);
}
```

## Peculiarities and Gotchas

### Key Differences from Other APIs

1. **System Instructions**: Separate parameter, not part of message history
2. **Parts-based Content**: Content is split into parts, each with specific types
3. **Thinking Detection**: Must check `part.thought` flag to identify reasoning content
4. **Function Calls**: Embedded in parts, not separate message types
5. **Role Names**: Uses 'model' instead of 'assistant' for AI responses
6. **Streaming**: Returns full `GenerateContentResponse` objects, not deltas

### Common Pitfalls

```typescript
// ❌ Wrong: Treating text as complete response
const response = await client.models.generateContent({...});
console.log(response.candidates[0].content.parts[0].text); // May miss other parts

// ✅ Correct: Use convenience getter or process all parts
console.log(response.text); // Concatenates all text parts automatically

// ❌ Wrong: Mixing system instruction with messages
const messages = [
  { role: 'system', parts: [{ text: 'You are helpful' }] }, // Not supported
  { role: 'user', parts: [{ text: 'Hello' }] }
];

// ✅ Correct: Separate system instruction
const response = await client.models.generateContent({
  systemInstruction: { parts: [{ text: 'You are helpful' }] },
  contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
});

// ❌ Wrong: Assuming single part responses
for await (const chunk of stream) {
  console.log(chunk.text); // May miss function calls or thinking
}

// ✅ Correct: Process all parts
for await (const chunk of stream) {
  const candidate = chunk.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text && !part.thought) {
        console.log('[RESPONSE]', part.text);
      } else if (part.text && part.thought) {
        console.log('[THINKING]', part.text);
      } else if (part.functionCall) {
        console.log('[FUNCTION CALL]', part.functionCall);
      }
    }
  }
}
```

### Performance Tips

1. **Use streaming** for better user experience with long responses
2. **Cache large prompts** to reduce token costs
3. **Batch token counting** when possible
4. **Set appropriate `abortSignal` timeouts** for long-running requests
5. **Handle function calls efficiently** to avoid timeout issues

### Model-Specific Behaviors

```typescript
// Different models have different capabilities
const modelCapabilities = {
  'gemini-2.0-flash-exp': {
    thinking: false,
    functionCalling: true,
    vision: true,
    maxTokens: 1000000
  },
  'gemini-2.0-flash-thinking-exp-1219': {
    thinking: true,
    functionCalling: true,
    vision: true,
    maxTokens: 32768
  },
  'gemini-1.5-pro': {
    thinking: false,
    functionCalling: true,
    vision: true,
    maxTokens: 2000000
  }
};

// Check model capabilities before using features
function supportsThinking(model: string): boolean {
  return model.includes('thinking');
}

function getMaxTokens(model: string): number {
  return modelCapabilities[model]?.maxTokens || 32768;
}
```

This comprehensive guide covers all the essential aspects of implementing Gemini API features. The key is understanding Gemini's parts-based content system and properly handling the different types of content (text, thinking, function calls) that can appear in responses.