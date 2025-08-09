# Analysis: Display Tool Call Metrics

## Token Usage Display in the Agent Code

### 1. Token Usage Event Structure
The token usage is defined as an event type in `/Users/badlogic/workspaces/pi-mono/packages/agent/src/agent.ts` (lines 16-23):

```typescript
{
    type: "token_usage";
    inputTokens: number;
    outputTokens: number; 
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
```

### 2. Where Token Usage Events are Generated
Token usage events are created in two places in `agent.ts`:

**Responses API (lines 77-88):**
```typescript
if (response.usage) {
    const usage = response.usage;
    eventReceiver?.on({
        type: "token_usage",
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        cacheReadTokens: usage.input_tokens_details.cached_tokens || 0,
        cacheWriteTokens: 0, // Not available in API
    });
}
```

**Chat Completions API (lines 209-220):**
```typescript
if (response.usage) {
    const usage = response.usage;
    await eventReceiver?.on({
        type: "token_usage",
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens || 0,
        cacheWriteTokens: 0, // Not available in API
    });
}
```

### 3. Token Display in Different Renderers

#### Console Renderer (`console-renderer.ts`)
- **No display**: Token usage events are explicitly **not displayed** in console mode
- Lines 47-48: Token usage events don't stop animations
- Lines 124-127: Token usage case does nothing - no console output

#### TUI Renderer (`tui-renderer.ts`) 
- **Full token display**: Shows detailed token information at the bottom of the interface
- **Format**: `↑{input_tokens} ↓{output_tokens} (⟲{cache_read_tokens} ⟳{cache_write_tokens})`
- **Location**: Bottom container of the TUI interface
- **Example display**: `↑1,234 ↓567 (⟲890 ⟳0)`

Key implementation details:
- Lines 60-64: Stores token counters as instance variables
- Lines 258-265: Updates token counts when token_usage events are received
- Lines 284-305: `updateTokenDisplay()` method formats and displays tokens
- Lines 289-301: Format includes cache information if available
- Uses symbols: `↑` (up arrow) for input, `↓` (down arrow) for output, `⟲` (anticlockwise) for cache read, `⟳` (clockwise) for cache write

#### JSON Renderer (`json-renderer.ts`)
- **Raw JSON output**: Outputs the complete token_usage event as JSON
- Line 5: Simply calls `console.log(JSON.stringify(event))`
- This means token usage is included in the JSON stream when using `--json` flag

### 4. Session Storage (`session-manager.ts`)
- **Persistence**: Token usage events are stored in session files
- **Tracking**: Maintains `totalUsage` which stores the latest token usage event (lines 33, 138-145, 157-159)
- **Note**: Currently stores only the latest token usage, not cumulative totals across the session

### 5. Key Characteristics

**Token Display Behavior:**
- **Console mode**: No token display (silent)
- **TUI mode**: Real-time token display at bottom with visual indicators
- **JSON mode**: Raw event data in JSON format

**Token Types Displayed:**
- Input tokens (prompt tokens)
- Output tokens (completion tokens) 
- Cache read tokens (when available)
- Cache write tokens (currently always 0 - not available from APIs)

**Display Format in TUI:**
- Uses thousands separators (`.toLocaleString()`)
- Dimmed text styling with chalk
- Visual symbols to distinguish token types
- Only shows cache info if cache tokens > 0

The token usage system provides comprehensive tracking across different output modes, with the TUI renderer offering the most user-friendly real-time display of token consumption.

## Tool Call Tracking in the Agent

### 1. **AgentEvent Structure for Tool Calls**

The agent defines a specific event structure for tool calls in `/Users/badlogic/workspaces/pi-mono/packages/agent/src/agent.ts`:

```typescript
export type AgentEvent =
    // ... other events
    | { type: "tool_call"; toolCallId: string; name: string; args: string }
    | { type: "tool_result"; toolCallId: string; result: string; isError: boolean }
    // ... other events
```

### 2. **Where Tool Call Events are Emitted**

Tool call events are tracked in two places:

**Responses API (lines 131-136):**
```typescript
await eventReceiver?.on({
    type: "tool_call",
    toolCallId: item.call_id || "",
    name: item.name,
    args: item.arguments,
});
```

**Chat Completions API (line 243):**
```typescript
await eventReceiver?.on({ 
    type: "tool_call", 
    toolCallId: toolCall.id, 
    name: funcName, 
    args: funcArgs 
});
```

### 3. **Event Processing and Storage**

- **Session Manager**: All AgentEvents (including tool calls) are stored in `/Users/badlogic/workspaces/pi-mono/packages/agent/src/session-manager.ts`. Each event is logged to a JSONL file with timestamps.

- **Event Reception**: Events are processed by the `SessionManager.on()` method (line 124), which appends each event to the session file.

### 4. **Current State: No Tool Call Counter**

**Key Finding**: There is currently **no built-in tool call counter or statistics tracking** in the agent. The system only:

- Stores individual tool call events in session files
- Tracks token usage separately via `token_usage` events
- Does not aggregate or count tool calls

### 5. **Event Reconstruction**

The agent can reconstruct conversation state from events using `setEvents()` method, which processes tool call events to rebuild the message history, but it doesn't count them.

### 6. **Renderers Handle Display Only**

The renderers (`ConsoleRenderer`, `TuiRenderer`, `JsonRenderer`) only display tool call events as they happen - they don't maintain counts or statistics.

## Summary

The agent architecture is set up to track individual tool call events through the `AgentEvent` system, but there's currently **no aggregation, counting, or statistical analysis** of tool calls. Each tool call generates:

1. A `tool_call` event when initiated
2. A `tool_result` event when completed

These events are stored in session files but not counted or analyzed. To implement tool call counting, you would need to add functionality that:

- Counts `tool_call` events in session data
- Potentially extends `SessionData` interface to include tool call statistics
- Adds methods to analyze tool call patterns across sessions

## Renderer Implementation Analysis

### 1. Console Renderer (`/Users/badlogic/workspaces/pi-mono/packages/agent/src/renderers/console-renderer.ts`)

**Key Findings:**
- **Token Usage Handling:** Token usage events are explicitly **ignored** in console mode (lines 124-127)
- **Icons/Emojis Used:** Spinning animation frames for loading states: `["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]`
- **Color Coding:** Uses chalk for different message types:
  - Blue for session start
  - Orange (`#FFA500`) for assistant messages
  - Yellow for tool calls
  - Gray for tool results
  - Red for errors
  - Green for user messages
- **Animation:** Loading animations during thinking/processing states

### 2. JSON Renderer (`/Users/badlogic/workspaces/pi-mono/packages/agent/src/renderers/json-renderer.ts`)

**Key Findings:**
- **Minimal Implementation:** Simply outputs all events as JSON strings
- **Token Usage:** Passes through all token usage data as-is in JSON format
- **No Visual Formatting:** Raw JSON output only

### 3. TUI Renderer (`/Users/badlogic/workspaces/pi-mono/packages/agent/src/renderers/tui-renderer.ts`)

**Key Findings:**
- **Token Usage Display Location:** Lines 284-305 contain the `updateTokenDisplay()` method
- **Icons/Symbols Used:**
  - `↑` for input tokens
  - `↓` for output tokens  
  - `⟲` for cache read tokens
  - `⟳` for cache write tokens
  - Same spinning frames as console: `["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]`

**Token Display Implementation (lines 284-305):**
```typescript
private updateTokenDisplay(): void {
    // Clear and update token display
    this.tokenContainer.clear();

    // Build token display text
    let tokenText = chalk.dim(`↑${this.lastInputTokens.toLocaleString()} ↓${this.lastOutputTokens.toLocaleString()}`);

    // Add cache info if available
    if (this.lastCacheReadTokens > 0 || this.lastCacheWriteTokens > 0) {
        const cacheText: string[] = [];
        if (this.lastCacheReadTokens > 0) {
            cacheText.push(`⟲${this.lastCacheReadTokens.toLocaleString()}`);
        }
        if (this.lastCacheWriteTokens > 0) {
            cacheText.push(`⟳${this.lastCacheWriteTokens.toLocaleString()}`);
        }
        tokenText += chalk.dim(` (${cacheText.join(" ")})`);
    }

    this.tokenStatusComponent = new TextComponent(tokenText);
    this.tokenContainer.addChild(this.tokenStatusComponent);
}
```

### 4. Available Token Usage Data Structure

Based on the `AgentEvent` type definition in `/Users/badlogic/workspaces/pi-mono/packages/agent/src/agent.ts`:

```typescript
{
    type: "token_usage";
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
```

## How to Add New Metrics

### For TUI Renderer:
1. **Location:** Modify the `updateTokenDisplay()` method in `tui-renderer.ts` (lines 284-305)
2. **Storage:** Add new private properties to store additional metrics (like lines 60-64)
3. **Event Handling:** Update the `token_usage` case to capture new metrics (lines 258-265)
4. **Display:** Add new symbols/formatting to the token display string

### For Console Renderer:
1. **Enable Token Display:** Remove the ignore logic in lines 124-127
2. **Add Display Logic:** Create a new case to format and display token metrics
3. **Positioning:** Add after processing is complete to avoid interfering with animations

### For JSON Renderer:
- No changes needed - it automatically outputs all event data as JSON

The TUI renderer provides the most comprehensive token usage display with visual symbols and formatting, while the console renderer currently ignores token usage entirely. The JSON renderer provides raw data output suitable for programmatic consumption.