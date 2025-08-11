# Token Usage Tracking Analysis - pi-agent Codebase

## 1. Token Usage Event Structure and Flow

### Per-Request vs Cumulative Analysis

After reading `/Users/badlogic/workspaces/pi-mono/packages/agent/src/agent.ts` in full, I can confirm that **token usage events are per-request, NOT cumulative**.

**Evidence:**
- Lines 296-308 in `callModelResponsesApi()`: Token usage is reported directly from API response usage object
- Lines 435-447 in `callModelChatCompletionsApi()`: Token usage is reported directly from API response usage object
- The token counts represent what was used for that specific LLM request only

### TokenUsageEvent Definition

**Location:** `/Users/badlogic/workspaces/pi-mono/packages/agent/src/agent.ts:16-24`

```typescript
{
    type: "token_usage";
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
}
```

## 2. Current Token Usage Display Implementation

### TUI Renderer
**Location:** `/Users/badlogic/workspaces/pi-mono/packages/agent/src/renderers/tui-renderer.ts`

**Current Behavior:**
- Lines 60-66: Stores "last" token values (not cumulative)
- Lines 251-259: Updates token counts on `token_usage` events
- Lines 280-311: Displays current request tokens in `updateTokenDisplay()`
- Format: `↑{input} ↓{output} ⚡{reasoning} ⟲{cache_read} ⟳{cache_write} ⚒ {tool_calls}`

**Comment on line 252:** "Store the latest token counts (not cumulative since prompt includes full context)"

### Console Renderer
**Location:** `/Users/badlogic/workspaces/pi-mono/packages/agent/src/renderers/console-renderer.ts`

**Current Behavior:**
- Lines 11-16: Stores "last" token values
- Lines 165-172: Updates token counts on `token_usage` events  
- Lines 52-82: Displays tokens after each assistant message

## 3. Session Storage

### SessionManager
**Location:** `/Users/badlogic/workspaces/pi-mono/packages/agent/src/session-manager.ts`

**Current Implementation:**
- Lines 138-146: Has a `totalUsage` field in `SessionData` interface
- Lines 158-160: **BUG**: Only stores the LAST token_usage event, not cumulative totals
- This should accumulate all token usage across the session

## 4. Slash Command Infrastructure

### Existing Slash Command Support
**Location:** `/Users/badlogic/workspaces/pi-mono/packages/tui/src/autocomplete.ts`

**Available Infrastructure:**
- `SlashCommand` interface with `name`, `description`, optional `getArgumentCompletions`
- `CombinedAutocompleteProvider` handles slash command detection and completion
- Text editor auto-triggers on "/" at start of line

### Current Usage in TUI Renderer
**Location:** `/Users/badlogic/workspaces/pi-mono/packages/agent/src/renderers/tui-renderer.ts:75-80`

```typescript
const autocompleteProvider = new CombinedAutocompleteProvider(
    [],  // <-- Empty command array!
    process.cwd(),
);
```

**No slash commands are currently implemented in the agent TUI!**

### Example Implementation
**Reference:** `/Users/badlogic/workspaces/pi-mono/packages/tui/test/chat-app.ts:25-60`

Shows how to:
1. Define slash commands with `CombinedAutocompleteProvider`
2. Handle slash command execution in `editor.onSubmit`
3. Add responses to chat container

## 5. Implementation Requirements for /tokens Command

### What Needs to Change

1. **Add Cumulative Token Tracking to TUI Renderer**
   - Add cumulative token counters alongside current "last" counters
   - Update cumulative totals on each `token_usage` event

2. **Add /tokens Slash Command**
   - Add to `CombinedAutocompleteProvider` in tui-renderer.ts
   - Handle in `editor.onSubmit` callback
   - Display formatted token summary as `TextComponent` in chat container

3. **Fix SessionManager Bug**
   - Change `totalUsage` calculation to accumulate all token_usage events
   - This will enable session-wide token tracking

4. **Message Handling in TUI**
   - Need to capture user input before it goes to agent
   - Check if it's a slash command vs regular message
   - Route accordingly

### Current User Input Flow
**Location:** `/Users/badlogic/workspaces/pi-mono/packages/agent/src/main.ts:190-198`

```typescript
while (true) {
    const userInput = await renderer.getUserInput();
    try {
        await agent.ask(userInput);  // All input goes to agent
    } catch (e: any) {
        await renderer.on({ type: "error", message: e.message });
    }
}
```

**Problem:** All user input goes directly to the agent - no interception for slash commands!

### Required Architecture Change

Need to modify the TUI interactive loop to:
1. Check if user input starts with "/"
2. If slash command: handle locally in renderer
3. If regular message: pass to agent as before

## 6. Token Display Format Recommendations

Based on existing format patterns, the `/tokens` command should display:

```
Session Token Usage:
↑ 1,234 input tokens
↓ 5,678 output tokens  
⚡ 2,345 reasoning tokens
⟲ 890 cache read tokens
⟳ 123 cache write tokens
📊 12,270 total tokens
⚒ 5 tool calls
```

## Summary

The current implementation tracks per-request token usage only. To add cumulative token tracking with a `/tokens` command, we need to:

1. **Fix SessionManager** to properly accumulate token usage
2. **Add cumulative tracking** to TUI renderer  
3. **Implement slash command infrastructure** in the agent (currently missing)
4. **Modify user input handling** to intercept slash commands before they reach the agent
5. **Add /tokens command** that displays formatted cumulative statistics

The TUI framework already supports slash commands, but the agent TUI renderer doesn't use them yet.