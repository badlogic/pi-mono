# AI Package Implementation Plan
**Status:** Done
**Agent PID:** 54145

## Original Todo
ai: create an implementation plan based on packages/ai/plan.md and implement it

## Description
Implement the unified AI API as designed in packages/ai/plan.md. Create a single interface that works with OpenAI, Anthropic, and Gemini SDKs, handling their differences internally while exposing unified streaming events, tool calling, thinking/reasoning, and caching capabilities.

*Read [analysis.md](./analysis.md) in full for detailed codebase research and context*
*Read [plan.md](packages/ai/docs/plan.md) in full for the complete API design and implementation details*
*Read API documentation: [anthropic-api.md](packages/ai/docs/anthropic-api.md), [openai-api.md](packages/ai/docs/openai-api.md), [gemini-api.md](packages/ai/docs/gemini-api.md)*

## Implementation Plan
- [x] Define unified types in src/types.ts based on plan.md interfaces (AIConfig, Message, Request, Event, TokenUsage, ModelInfo)
- [x] Implement OpenAI provider in src/providers/openai.ts with both Chat Completions and Responses API support
- [x] Implement Anthropic provider in src/providers/anthropic.ts with MessageStream and content blocks handling
- [ ] Implement Gemini provider in src/providers/gemini.ts with parts system and thinking extraction
- [ ] Create main AI class in src/index.ts that selects and uses appropriate adapter
- [ ] Implement models database in src/models.ts with model information and cost data
- [ ] Add cost calculation integrated into each adapter's token tracking
- [ ] Create comprehensive test suite in test/ai.test.ts using Node.js test framework
- [ ] Test: Model database lookup and capabilities detection
- [ ] Test: Basic completion (non-streaming) for all providers (OpenAI, Anthropic, Gemini, OpenRouter, Groq)
- [ ] Test: Streaming responses with event normalization across all providers
- [ ] Test: Thinking/reasoning extraction (o1 via Responses API, Claude thinking, Gemini thinking)
- [ ] Test: Tool calling flow with execution and continuation across providers
- [ ] Test: Automatic caching (Anthropic explicit, OpenAI/Gemini automatic)
- [ ] Test: Message serialization/deserialization with full conversation history
- [ ] Test: Cross-provider conversation continuation (start with one provider, continue with another)
- [ ] Test: Abort/cancellation via AbortController
- [ ] Test: Error handling and retry logic for each provider
- [ ] Test: Cost tracking accuracy with known token counts
- [ ] Update root tsconfig.json paths to include @mariozechner/pi-ai
- [ ] Update root package.json build script to include AI package

## Notes
- Package structure already exists at packages/ai with dependencies installed
- Each adapter handles its own event normalization internally
- Tests use Node.js built-in test framework as per project conventions
- Available API keys: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
- **IMPORTANT**: Always run `npm run check` in the root directory before asking for approval to ensure code compiles and passes linting