# Code Task: Kiro Provider Enhancements

## Objective
Add missing features from opencode-kiro-auth to the pi-mono Kiro provider for production robustness.

## Reference Implementation
- `/Users/mobrienv/Code/opencode-kiro-auth/src/plugin/request.ts`
- `/Users/mobrienv/Code/opencode-kiro-auth/src/infrastructure/transformers/`
- `/Users/mobrienv/Code/opencode-kiro-auth/src/core/request/error-handler.ts`

## Tasks

### 1. History Truncation
**File:** `packages/ai/src/providers/kiro.ts`

Add `truncateHistory()` function that limits history to ~850KB (850000 chars).
- Truncate from the beginning (oldest messages first)
- Preserve message structure integrity
- Reference: `opencode-kiro-auth/src/infrastructure/transformers/history-builder.ts:truncateHistory()`

### 2. Tool Result Truncation  
**File:** `packages/ai/src/providers/kiro.ts`

Add `truncate()` helper that limits tool result text to ~250KB (250000 chars).
- Apply to all tool result content
- Add `[TRUNCATED]` suffix when truncated
- Reference: `opencode-kiro-auth/src/infrastructure/transformers/message-transformer.ts:truncate()`

### 3. Retry with Context Reduction
**File:** `packages/ai/src/providers/kiro.ts`

On 400 "Improperly formed request" errors:
- Retry with `reductionFactor` starting at 1.0, decreasing by 0.2 each retry
- Apply factor to history limit (850000 * factor) and tool result limit (250000 * factor)
- Stop retrying when factor < 0.4
- Reference: `opencode-kiro-auth/src/core/request/error-handler.ts`

### 4. Image Support
**File:** `packages/ai/src/providers/kiro.ts`

Handle `ImageContent` in messages:
- Convert base64 images to Kiro format: `{ format: string, source: { bytes: string } }`
- Support in both history and current message
- Reference: `opencode-kiro-auth/src/plugin/image-handler.ts`

### 5. Placeholder Tools for History
**File:** `packages/ai/src/providers/kiro.ts`

When history contains tool calls but current tools list doesn't include them:
- Add placeholder tool definitions for tools used in history
- Prevents Kiro from rejecting requests with orphaned tool references
- Reference: `opencode-kiro-auth/src/plugin/request.ts` lines 200-220

### 6. Orphaned Tool Result Handling
**File:** `packages/ai/src/providers/kiro.ts`

When tool results reference tool calls not in history:
- Inject synthetic assistant message with the tool call
- Or append tool result as text to current message content
- Reference: `opencode-kiro-auth/src/plugin/request.ts` lines 150-180

## Verification
```bash
cd /Users/mobrienv/Code/pi-mono
npm run build
npm run check

# Test with large context
cd packages/coding-agent
node dist/cli.js --provider kiro --model claude-sonnet-4-5 -p "read a large file and summarize"

# Test with images (if pi supports image input)
# Test multi-turn with many tool calls
```

## Notes
- Keep browser compatibility (no Node-only imports at top level)
- Follow existing patterns in `kiro.ts`
- Truncation limits are based on Kiro's ~1MB request size limit
