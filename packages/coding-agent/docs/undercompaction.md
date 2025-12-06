# Under-Compaction Analysis

## Problem Statement

Auto-compaction triggers too late, causing context window overflows that result in failed LLM calls with `stopReason == "length"`.

## Architecture Overview

### Event Flow

```
User prompt
    │
    ▼
agent.prompt()
    │
    ▼
agentLoop() in packages/ai/src/agent/agent-loop.ts
    │
    ├─► streamAssistantResponse()
    │       │
    │       ▼
    │   LLM provider (Anthropic, OpenAI, etc.)
    │       │
    │       ▼
    │   Events: message_start → message_update* → message_end
    │       │
    │       ▼
    │   AssistantMessage with usage stats (input, output, cacheRead, cacheWrite)
    │
    ├─► If assistant has tool calls:
    │       │
    │       ▼
    │   executeToolCalls()
    │       │
    │       ├─► tool_execution_start (toolCallId, toolName, args)
    │       │
    │       ├─► tool.execute() runs (read, bash, write, edit, etc.)
    │       │
    │       ├─► tool_execution_end (toolCallId, toolName, result, isError)
    │       │
    │       └─► message_start + message_end for ToolResultMessage
    │
    └─► Loop continues until no more tool calls
            │
            ▼
        agent_end
```

### Token Usage Reporting

Token usage is ONLY available in `AssistantMessage.usage` after the LLM responds:

```typescript
// From packages/ai/src/types.ts
export interface Usage {
    input: number;      // Tokens in the request
    output: number;     // Tokens generated
    cacheRead: number;  // Cached tokens read
    cacheWrite: number; // Cached tokens written
    cost: Cost;
}
```

The `input` field represents the total context size sent to the LLM, which includes:
- System prompt
- All conversation messages
- All tool results from previous calls

### Current Compaction Check

Both TUI (`tui-renderer.ts`) and RPC (`main.ts`) modes check compaction identically:

```typescript
// In agent.subscribe() callback:
if (event.type === "message_end") {
    // ...
    if (event.message.role === "assistant") {
        await checkAutoCompaction();
    }
}

async function checkAutoCompaction() {
    // Get last non-aborted assistant message
    const messages = agent.state.messages;
    let lastAssistant = findLastNonAbortedAssistant(messages);
    if (!lastAssistant) return;

    const contextTokens = calculateContextTokens(lastAssistant.usage);
    const contextWindow = agent.state.model.contextWindow;

    if (!shouldCompact(contextTokens, contextWindow, settings)) return;

    // Trigger compaction...
}
```

**The check happens on `message_end` for assistant messages only.**

## The Under-Compaction Problem

### Failure Scenario

```
Context window: 200,000 tokens
Reserve tokens: 16,384 (default)
Threshold: 200,000 - 16,384 = 183,616

Turn N:
  1. Assistant message received, usage shows 180,000 tokens
  2. shouldCompact(180000, 200000, settings) → 180000 > 183616 → FALSE
  3. Tool executes: `cat large-file.txt` → outputs 100KB (~25,000 tokens)
  4. Context now effectively 205,000 tokens, but we don't know this
  5. Next LLM call fails: context exceeds 200,000 window
```

The problem occurs when:
1. Context is below threshold (so compaction doesn't trigger)
2. A tool adds enough content to push it over the window limit
3. We only discover this when the next LLM call fails

### Root Cause

1. **Token counts are retrospective**: We only learn the context size AFTER the LLM processes it
2. **Tool results are blind spots**: When a tool executes and returns a large result, we don't know how many tokens it adds until the next LLM call
3. **No estimation before submission**: We submit the context and hope it fits

## Current Tool Output Limits

| Tool | Our Limit | Worst Case |
|------|-----------|------------|
| bash | 10MB per stream | 20MB (~5M tokens) |
| read | 2000 lines × 2000 chars | 4MB (~1M tokens) |
| write | Byte count only | Minimal |
| edit | Diff output | Variable |

## How Other Tools Handle This

### SST/OpenCode

**Tool Output Limits (during execution):**

| Tool | Limit | Details |
|------|-------|---------|
| bash | 30KB chars | `MAX_OUTPUT_LENGTH = 30_000`, truncates with notice |
| read | 2000 lines × 2000 chars/line | No total cap, theoretically 4MB |
| grep | 100 matches, 2000 chars/line | Truncates with notice |
| ls | 100 files | Truncates with notice |
| glob | 100 results | Truncates with notice |
| webfetch | 5MB | `MAX_RESPONSE_SIZE` |

**Overflow Detection:**
- `isOverflow()` runs BEFORE each turn (not during)
- Uses last LLM-reported token count: `tokens.input + tokens.cache.read + tokens.output`
- Triggers if `count > context - maxOutput`
- Does NOT detect overflow from tool results in current turn

**Recovery - Pruning:**
- `prune()` runs AFTER each turn completes
- Walks backwards through completed tool results
- Keeps last 40k tokens of tool outputs (`PRUNE_PROTECT`)
- Removes content from older tool results (marks `time.compacted`)
- Only prunes if savings > 20k tokens (`PRUNE_MINIMUM`)
- Token estimation: `chars / 4`

**Recovery - Compaction:**
- Triggered when `isOverflow()` returns true before a turn
- LLM generates summary of conversation
- Replaces old messages with summary

**Gap:** No mid-turn protection. A single read returning 4MB would overflow. The 30KB bash limit is their primary practical protection.

### OpenAI/Codex

**Tool Output Limits (during execution):**

| Tool | Limit | Details |
|------|-------|---------|
| shell/exec | 10k tokens or 10k bytes | Per-model `TruncationPolicy`, user-configurable |
| read_file | 2000 lines, 500 chars/line | `MAX_LINE_LENGTH = 500`, ~1MB max |
| grep_files | 100 matches | Default limit |
| list_dir | Configurable | BFS with depth limits |

**Truncation Policy:**
- Per-model family setting: `TruncationPolicy::Bytes(10_000)` or `TruncationPolicy::Tokens(10_000)`
- User can override via `tool_output_token_limit` config
- Applied to ALL tool outputs uniformly via `truncate_function_output_items_with_policy()`
- Preserves beginning and end, removes middle with `"…N tokens truncated…"` marker

**Overflow Detection:**
- After each successful turn: `if total_usage_tokens >= auto_compact_token_limit { compact() }`
- Per-model thresholds (e.g., 180k for 200k context window)
- `ContextWindowExceeded` error caught and handled

**Recovery - Compaction:**
- If tokens exceed threshold after turn, triggers `run_inline_auto_compact_task()`
- During compaction, if `ContextWindowExceeded`: removes oldest history item and retries
- Loop: `history.remove_first_item()` until it fits
- Notifies user: "Trimmed N older conversation item(s)"

**Recovery - Turn Error:**
- On `ContextWindowExceeded` during normal turn: marks tokens as full, returns error to user
- Does NOT auto-retry the failed turn
- User must manually continue

**Gap:** Still no mid-turn protection, but aggressive 10k token truncation on all tool outputs prevents most issues in practice.

### Comparison

| Feature | pi-coding-agent | OpenCode | Codex |
|---------|-----------------|----------|-------|
| Bash limit | 10MB | 30KB | ~40KB (10k tokens) |
| Read limit | 2000×2000 (4MB) | 2000×2000 (4MB) | 2000×500 (1MB) |
| Truncation policy | None | Per-tool | Per-model, uniform |
| Token estimation | None | chars/4 | chars/4 |
| Pre-turn check | No | Yes (last tokens) | Yes (threshold) |
| Mid-turn check | No | No | No |
| Post-turn pruning | No | Yes (removes old tool output) | No |
| Overflow recovery | No | Compaction | Trim oldest + compact |

**Key insight:** None of these tools protect against mid-turn overflow. Their practical protection is aggressive static limits on tool output, especially bash. OpenCode's 30KB bash limit vs our 10MB is the critical difference.

## Recommended Solution

### Phase 1: Static Limits (immediate)

Add hard limits to tool outputs matching industry practice:

```typescript
// packages/coding-agent/src/tools/limits.ts
export const MAX_TOOL_OUTPUT_CHARS = 30_000; // ~7.5k tokens, matches OpenCode bash
export const MAX_TOOL_OUTPUT_NOTICE = "\n\n...(truncated, output exceeded limit)...";
```

Apply to all tools:
- bash: 10MB → 30KB
- read: Add 100KB total output cap
- edit: Cap diff output

### Phase 2: Post-Tool Estimation

After `tool_execution_end`, estimate and flag:

```typescript
let needsCompactionAfterTurn = false;

agent.subscribe(async (event) => {
    if (event.type === "tool_execution_end") {
        const resultChars = extractTextLength(event.result);
        const estimatedTokens = Math.ceil(resultChars / 4);
        
        const lastUsage = getLastAssistantUsage(agent.state.messages);
        if (lastUsage) {
            const current = calculateContextTokens(lastUsage);
            const projected = current + estimatedTokens;
            const threshold = agent.state.model.contextWindow - settings.reserveTokens;
            if (projected > threshold) {
                needsCompactionAfterTurn = true;
            }
        }
    }
    
    if (event.type === "turn_end" && needsCompactionAfterTurn) {
        needsCompactionAfterTurn = false;
        await triggerCompaction();
    }
});
```

### Phase 3: Overflow Recovery (like Codex)

Handle `stopReason === "length"` gracefully:

```typescript
if (event.type === "message_end" && event.message.role === "assistant") {
    if (event.message.stopReason === "length") {
        // Context overflow occurred
        await triggerCompaction();
        // Optionally: retry the turn
    }
}
```

During compaction, if it also overflows, trim oldest messages:

```typescript
async function compactWithRetry() {
    while (true) {
        try {
            await compact();
            break;
        } catch (e) {
            if (isContextOverflow(e) && messages.length > 1) {
                messages.shift(); // Remove oldest
                continue;
            }
            throw e;
        }
    }
}
```

## Summary

The under-compaction problem occurs because:
1. We only check context size after assistant messages
2. Tool results can add arbitrary amounts of content
3. We discover overflows only when the next LLM call fails

The fix requires:
1. Aggressive static limits on tool output (immediate safety net)
2. Token estimation after tool execution (proactive detection)
3. Graceful handling of overflow errors (fallback recovery)
