# Analysis: Thinking Tokens Handling in Pi-Agent

Based on my comprehensive search of the codebase, I found extensive thinking token handling implementation in the pi-agent package. Here's my detailed analysis:

## Current Implementation Overview

The pi-agent codebase already has **comprehensive thinking token support** implemented in `/Users/badlogic/workspaces/pi-mono/packages/agent/src/agent.ts`. The implementation covers both OpenAI's Responses API and Chat Completions API.

## Key Findings

### 1. **Thinking Token Event Type Defined**
The `AgentEvent` type includes a dedicated `thinking` event:
```typescript
export type AgentEvent = 
    // ... other event types
    | { type: "thinking"; text: string }
    // ... other event types
```

### 2. **Responses API Implementation (Lines 103-110)**
For the Responses API (used by GPT-OSS and potentially GPT-5 models), thinking tokens are already parsed:
```typescript
case "reasoning": {
    for (const content of item.content || []) {
        if (content.type === "reasoning_text") {
            await eventReceiver?.on({ type: "thinking", text: content.text });
        }
    }
    break;
}
```

### 3. **Token Usage Tracking**
Both API implementations properly track token usage with support for:
- Input tokens (`inputTokens`)  
- Output tokens (`outputTokens`)
- Cache read tokens (`cacheReadTokens`)
- Cache write tokens (`cacheWriteTokens`)

### 4. **UI Rendering Support**
Both console and TUI renderers have explicit support for thinking events:

**Console Renderer** (`console-renderer.ts:99-106`):
```typescript
case "thinking":
    this.stopAnimation();
    console.log(chalk.dim("[thinking]"));
    console.log(chalk.dim(event.text));
    console.log();
    // Resume animation after showing thinking
    this.startAnimation("Processing");
    break;
```

**TUI Renderer** (`tui-renderer.ts:188-201`):
```typescript
case "thinking": {
    // Show thinking in dim text
    const thinkingContainer = new Container();
    thinkingContainer.addChild(new TextComponent(chalk.dim("[thinking]")));
    // Split thinking text into lines for better display
    const thinkingLines = event.text.split("\n");
    for (const line of thinkingLines) {
        thinkingContainer.addChild(new TextComponent(chalk.dim(line)));
    }
    thinkingContainer.addChild(new WhitespaceComponent(1));
    this.chatContainer.addChild(thinkingContainer);
    break;
}
```

## Potential Issues Identified

### 1. **GPT-5 API Compatibility**
The current implementation assumes GPT-5 models work with the Chat Completions API (`callModelChatCompletionsApi`), but GPT-5 models might need the Responses API (`callModelResponsesApi`) to access thinking tokens. The agent defaults to `"completions"` API type.

### 2. **Missing Thinking Token Usage in Chat Completions API**
The Chat Completions API implementation doesn't parse or handle thinking/reasoning content - it only handles regular message content and tool calls. However, based on the web search results, GPT-5 models support reasoning tokens even in Chat Completions API.

### 3. **Model-Specific API Detection**
There's no automatic detection of which API to use based on the model name. The default model is `"gpt-5-mini"` but uses `api: "completions"`.

## Anthropic Models Support

For Anthropic models accessed via the OpenAI SDK compatibility layer, the current Chat Completions API implementation should work, but there might be missing thinking token extraction if Anthropic returns reasoning content in a different format than standard OpenAI models.

## Recommendations

### 1. **Add Model-Based API Detection**
Implement automatic API selection based on model names:
```typescript
function getApiTypeForModel(model: string): "completions" | "responses" {
    if (model.includes("gpt-5") || model.includes("o1") || model.includes("o3")) {
        return "responses";
    }
    return "completions";
}
```

### 2. **Enhanced Chat Completions API Support**
If GPT-5 models can return thinking tokens via Chat Completions API, the implementation needs to be enhanced to parse reasoning content from the response.

### 3. **Anthropic-Specific Handling**
Add specific logic for Anthropic models to extract thinking content if they provide it in a non-standard format.

## Files to Examine/Modify

1. **`/Users/badlogic/workspaces/pi-mono/packages/agent/src/agent.ts`** - Core API handling
2. **`/Users/badlogic/workspaces/pi-mono/packages/agent/src/main.ts`** - Default configuration and model setup

The codebase already has a solid foundation for thinking token support, but may need model-specific API routing and enhanced parsing logic to fully support GPT-5 and Anthropic thinking tokens.