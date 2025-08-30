# AI Package Implementation Analysis

## Overview
Based on the comprehensive plan in `packages/ai/plan.md` and detailed API documentation for OpenAI, Anthropic, and Gemini SDKs, the AI package needs to provide a unified API that abstracts over these three providers while maintaining their unique capabilities.

## OpenAI Responses API Investigation

### API Structure
The OpenAI SDK includes a separate Responses API (`client.responses`) alongside the Chat Completions API. This API is designed for models with reasoning capabilities (o1/o3) and provides access to thinking/reasoning content.

### Key Differences from Chat Completions API

1. **Input Format**: Uses `input` array instead of `messages`
   - Supports `EasyInputMessage` type with roles: `user`, `assistant`, `system`, `developer`
   - Content can be text, image, audio, or file references
   - More structured approach with explicit types for each input type

2. **Streaming Events**: Rich set of events for detailed streaming
   - `ResponseReasoningTextDeltaEvent` - Incremental reasoning/thinking text
   - `ResponseReasoningTextDoneEvent` - Complete reasoning text
   - `ResponseTextDeltaEvent` - Main response text deltas
   - `ResponseFunctionCallArgumentsDeltaEvent` - Tool call argument streaming
   - `ResponseCompletedEvent` - Final completion with usage stats

3. **Response Structure**: More complex response object
   - `output` array containing various output items
   - Explicit reasoning items with content
   - Tool calls as part of output items
   - Usage tracking with detailed token breakdowns

### Implementation Examples

#### Basic Responses API Usage

```typescript
// Creating a response with streaming
const stream = await client.responses.create({
  model: "o1-preview",
  input: [
    {
      role: "developer", // or "system" for non-reasoning models
      content: "You are a helpful assistant"
    },
    {
      role: "user",
      content: "Explain quantum computing step by step"
    }
  ],
  stream: true,
  temperature: 0.7,
  max_completion_tokens: 2000
});

// Process streaming events
for await (const event of stream) {
  switch (event.type) {
    case 'response.reasoning_text.delta':
      // Thinking/reasoning content
      console.log('[THINKING]', event.delta);
      break;
    
    case 'response.text.delta':
      // Main response text
      console.log('[RESPONSE]', event.delta);
      break;
    
    case 'response.function_call_arguments.delta':
      // Tool call arguments being built
      console.log('[TOOL ARGS]', event.delta);
      break;
    
    case 'response.completed':
      // Final response with usage
      console.log('Usage:', event.usage);
      break;
  }
}
```

#### Using ResponseStream Helper

```typescript
// The SDK provides a ResponseStream helper for easier streaming
const responseStream = client.responses.stream({
  model: "o1-preview",
  input: [
    { role: "user", content: "Solve this math problem..." }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "calculate",
        description: "Perform calculations",
        parameters: { /* JSON Schema */ }
      }
    }
  ]
});

// Get final response after streaming
const finalResponse = await responseStream.finalResponse();
console.log('Output:', finalResponse.output);
console.log('Usage:', finalResponse.usage);
```

#### Converting Messages for Responses API

```typescript
private convertToResponsesInput(messages: Message[], systemPrompt?: string): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  
  // Add system/developer prompt
  if (systemPrompt) {
    input.push({
      type: "message",
      role: this.isReasoningModel() ? "developer" : "system",
      content: systemPrompt
    });
  }
  
  // Convert messages
  for (const msg of messages) {
    if (msg.role === "user") {
      input.push({
        type: "message",
        role: "user",
        content: msg.content
      });
    } else if (msg.role === "assistant") {
      // Assistant messages with potential tool calls
      const outputMessage: ResponseOutputMessage = {
        type: "message",
        role: "assistant",
        content: []
      };
      
      if (msg.content) {
        outputMessage.content.push({
          type: "text",
          text: msg.content
        });
      }
      
      if (msg.toolCalls) {
        // Tool calls need to be added as separate output items
        for (const toolCall of msg.toolCalls) {
          input.push({
            type: "function_call",
            id: toolCall.id,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments)
          });
        }
      }
      
      input.push(outputMessage);
    } else if (msg.role === "toolResult") {
      // Tool results as function call outputs
      input.push({
        type: "function_call_output",
        call_id: msg.toolCallId,
        output: msg.content
      });
    }
  }
  
  return input;
}
```

#### Processing Responses API Events

```typescript
private async completeWithResponsesAPI(request: Request, options?: OpenAIOptions): Promise<AssistantMessage> {
  try {
    const input = this.convertToResponsesInput(request.messages, request.systemPrompt);
    
    const stream = await this.client.responses.create({
      model: this.model,
      input,
      stream: true,
      max_completion_tokens: request.maxTokens,
      temperature: request.temperature,
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      tool_choice: options?.toolChoice
    });
    
    let content = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];
    let usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let finishReason: string = "stop";
    
    for await (const event of stream) {
      switch (event.type) {
        case 'response.reasoning_text.delta':
          thinking += event.delta;
          request.onThinking?.(event.delta);
          break;
        
        case 'response.reasoning_text.done':
          // Complete reasoning text available
          thinking = event.text;
          break;
        
        case 'response.text.delta':
          content += event.delta;
          request.onText?.(event.delta);
          break;
        
        case 'response.function_call_arguments.delta':
          // Build up tool calls incrementally
          // event.item_id identifies which tool call
          // event.arguments contains the delta
          break;
        
        case 'response.function_call_arguments.done':
          // Complete tool call
          toolCalls.push({
            id: event.item_id,
            name: event.name,
            arguments: JSON.parse(event.arguments)
          });
          break;
        
        case 'response.completed':
          // Final event with complete response and usage
          usage = {
            input: event.usage.input_tokens,
            output: event.usage.output_tokens,
            cacheRead: event.usage.input_tokens_details?.cached_tokens || 0,
            cacheWrite: 0
          };
          finishReason = event.stop_reason || "stop";
          break;
        
        case 'response.error':
          throw new Error(event.error.message);
      }
    }
    
    return {
      role: "assistant",
      content: content || undefined,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: this.model,
      usage,
      stopReason: this.mapStopReason(finishReason)
    };
  } catch (error) {
    // Error handling...
  }
}
```

### Important Notes

1. **"[Thinking: X tokens]" Issue**: The current implementation shows a placeholder for thinking tokens in Chat Completions API. This should only show actual thinking content from Responses API or omit the field entirely.

2. **Tool Calling Differences**: Responses API handles tool calls differently, with separate events for arguments delta and completion.

3. **Usage Tracking**: Responses API provides more detailed usage information including reasoning tokens in a different structure.

4. **Stream vs Iterator**: The Responses API returns an async iterable that can be used with `for await...of` directly.

## Existing Codebase Context

### Current Structure
- Monorepo using npm workspaces with packages in `packages/` directory
- Existing packages: `tui`, `agent`, `pods`
- TypeScript/ESM modules with Node.js ≥20.0.0
- Biome for linting and formatting
- Lockstep versioning at 0.5.8

### Package Location
The AI package should be created at `packages/ai/` following the existing pattern.

## Key Implementation Requirements

### Core Features
1. **Unified Client API** - Single interface for all providers
2. **Streaming First** - All providers support streaming, non-streaming is collected events
3. **Provider Adapters** - OpenAI, Anthropic, Gemini adapters
4. **Event Normalization** - Consistent event types across providers
5. **Tool/Function Calling** - Unified interface for tools across providers
6. **Thinking/Reasoning** - Support for reasoning models (o1/o3, Claude thinking, Gemini thinking)
7. **Token Tracking** - Usage and cost calculation
8. **Abort Support** - Request cancellation via AbortController
9. **Error Mapping** - Normalized error handling
10. **Caching** - Automatic caching strategies per provider

### Provider-Specific Handling

#### OpenAI
- Dual APIs: Chat Completions vs Responses API
- Responses API for o1/o3 reasoning content
- Developer role for o1/o3 system prompts
- Stream options for token usage

#### Anthropic  
- Content blocks always arrays
- Separate system parameter
- Tool results as user messages
- Explicit thinking budget allocation
- Cache control per block

#### Gemini
- Parts-based content system
- Separate systemInstruction parameter
- Model role instead of assistant
- Thinking via part.thought flag
- Function calls in parts array

## Implementation Structure

```
packages/ai/
├── src/
│   ├── index.ts           # Main exports
│   ├── types.ts           # Unified type definitions
│   ├── client.ts          # Main AI client class
│   ├── adapters/
│   │   ├── base.ts        # Base adapter interface
│   │   ├── openai.ts      # OpenAI adapter
│   │   ├── anthropic.ts   # Anthropic adapter
│   │   └── gemini.ts      # Gemini adapter
│   ├── models/
│   │   ├── models.ts      # Model info lookup
│   │   └── models-data.ts # Generated models database
│   ├── errors.ts          # Error mapping
│   ├── events.ts          # Event stream handling
│   ├── costs.ts           # Cost tracking
│   └── utils.ts           # Utility functions
├── test/
│   ├── openai.test.ts
│   ├── anthropic.test.ts
│   └── gemini.test.ts
├── scripts/
│   └── update-models.ts   # Update models database
├── package.json
├── tsconfig.build.json
└── README.md
```

## Dependencies
- `openai`: ^5.12.2 (for OpenAI SDK)
- `@anthropic-ai/sdk`: Latest
- `@google/genai`: Latest

## Files to Create/Modify

### New Files in packages/ai/
1. `package.json` - Package configuration
2. `tsconfig.build.json` - TypeScript build config
3. `src/index.ts` - Main exports
4. `src/types.ts` - Type definitions
5. `src/client.ts` - Main AI class
6. `src/adapters/base.ts` - Base adapter
7. `src/adapters/openai.ts` - OpenAI implementation
8. `src/adapters/anthropic.ts` - Anthropic implementation
9. `src/adapters/gemini.ts` - Gemini implementation
10. `src/models/models.ts` - Model info
11. `src/errors.ts` - Error handling
12. `src/events.ts` - Event streaming
13. `src/costs.ts` - Cost tracking
14. `README.md` - Package documentation

### Files to Modify
1. Root `tsconfig.json` - Add path mapping for @mariozechner/pi-ai
2. Root `package.json` - Add to build script order

## Implementation Strategy

### Phase 1: Core Structure
- Create package structure and configuration
- Define unified types and interfaces
- Implement base adapter interface

### Phase 2: Provider Adapters
- Implement OpenAI adapter (both APIs)
- Implement Anthropic adapter
- Implement Gemini adapter

### Phase 3: Features
- Add streaming support
- Implement tool calling
- Add thinking/reasoning support
- Implement token tracking

### Phase 4: Polish
- Error mapping and handling
- Cost calculation
- Model information database
- Documentation and examples

## Testing Approach
- Unit tests for each adapter
- Integration tests with mock responses
- Example scripts for manual testing
- Verify streaming, tools, thinking for each provider