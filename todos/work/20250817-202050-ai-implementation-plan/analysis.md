# AI Package Implementation Analysis

## Overview
Based on the comprehensive plan in `packages/ai/plan.md` and detailed API documentation for OpenAI, Anthropic, and Gemini SDKs, the AI package needs to provide a unified API that abstracts over these three providers while maintaining their unique capabilities.

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