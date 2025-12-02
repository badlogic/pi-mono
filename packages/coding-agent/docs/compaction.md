# Context Compaction

Research on how other coding assistants implement context compaction to manage long conversations.

## Overview

Context compaction (also called "handoff" or "summarization") is a technique to manage the context window in long coding sessions. When conversations grow too long, performance degrades and costs increase. Compaction summarizes the conversation history into a condensed form, allowing work to continue without hitting context limits.

## Claude Code

**Manual:** `/compact` command
**Auto:** Triggers at ~95% context capacity ([source](https://stevekinney.com/courses/ai-development/claude-code-compaction))

### How it works

1. Takes entire conversation history
2. Uses an LLM to generate a summary
3. Starts a new session with the summary as initial context
4. User can provide custom instructions with `/compact` (e.g., "summarize only the TODOs") ([source](https://stevekinney.com/courses/ai-development/claude-code-compaction))

### Prompt (extracted from community)

From [r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1jr52qj/here_is_claude_codes_compact_prompt/):

```
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary will be used as context when continuing the conversation, so preserve critical information including:
- What was accomplished
- Current work in progress  
- Files involved
- Next steps
- Key user requests or constraints
```

### Key observations

- Auto-compact triggers at ~95% capacity but users often recommend manual compaction earlier ([source](https://stevekinney.com/courses/ai-development/claude-code-compaction))
- Quality can degrade with multiple compactions (cumulative information loss) ([source](https://stevekinney.com/courses/ai-development/claude-code-compaction))
- Different from `/clear` which wipes history completely ([source](https://stevekinney.com/courses/ai-development/claude-code-compaction))
- Users report the model can "go off the rails" if auto-compact happens mid-task ([source](https://stevekinney.com/courses/ai-development/claude-code-compaction))

## OpenAI Codex CLI

Source: [github.com/openai/codex](https://github.com/openai/codex) (codex-rs/core/src/compact.rs, codex-rs/core/templates/compact/)

**Manual:** `/compact` slash command
**Auto:** Triggers when token usage exceeds `model_auto_compact_token_limit`

### How it works

1. Uses a dedicated summarization prompt
2. Sends entire history with the prompt appended
3. Collects the summary from the model response
4. Builds new history: initial context + recent user messages (up to 20k tokens) + summary
5. Replaces session history with the compacted version

### Prompt

From [codex-rs/core/templates/compact/prompt.md](https://github.com/openai/codex/blob/main/codex-rs/core/templates/compact/prompt.md):

```markdown
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

### Summary prefix (prepended to summaries in new context)

From [codex-rs/core/templates/compact/summary_prefix.md](https://github.com/openai/codex/blob/main/codex-rs/core/templates/compact/summary_prefix.md):

```markdown
Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:
```

### Key observations

- Uses token-based threshold (`model_auto_compact_token_limit`) rather than percentage ([config/mod.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs))
- Default thresholds vary by model (e.g., 180k for some models, 244k for others) ([config/mod.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs))
- Preserves recent user messages (last ~20k tokens worth) alongside summary ([compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs))
- Warns user: "Long conversations and multiple compactions can cause the model to be less accurate" ([compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs))
- Has retry logic with exponential backoff for failed compactions ([compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs))
- Uses "effective_context_window_percent" of 95% for safety margin ([model_family.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/model_family.rs))

## OpenCode (sst/opencode)

Source: [github.com/sst/opencode](https://github.com/sst/opencode) (packages/opencode/src/session/compaction.ts)

**Manual:** `/compact` command
**Auto:** Triggers when `isOverflow()` returns true (based on token usage vs model limits)

### How it works

1. Checks if tokens exceed (context_limit - output_limit) ([compaction.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/compaction.ts))
2. Creates a new assistant message marked as "summary"
3. Uses a compaction system prompt
4. Streams the summary generation
5. If auto-compaction, adds a "Continue if you have next steps" message

### Prompt

From [packages/opencode/src/session/prompt/compaction.txt](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/prompt/compaction.txt):

```
You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation. 
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.
```

### Final user message

From [compaction.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/compaction.ts):

```
Summarize our conversation above. This summary will be the only context available when the conversation continues, so preserve critical information including: what was accomplished, current work in progress, files involved, next steps, and any key user requests or constraints. Be concise but detailed enough that work can continue seamlessly.
```

### Key observations

- Has a "prune" mechanism separate from compaction ([compaction.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/compaction.ts)):
  - Scans backward through tool calls
  - Protects last 40k tokens of tool output (PRUNE_PROTECT constant)
  - Prunes tool outputs beyond that threshold if >20k tokens prunable (PRUNE_MINIMUM constant)
- Disables auto-compaction via `OPENCODE_DISABLE_AUTOCOMPACT` env var ([flag.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/flag/flag.ts))
- Separate summarization for UI display (2 sentences max) vs. compaction (detailed) ([summary.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/summary.ts))

## Amp (Sourcegraph)

Source: [ampcode.com/guides/context-management](https://ampcode.com/guides/context-management)

**Manual:** "Handoff" feature
**Auto:** None (manual context management encouraged)

### How it works

Amp takes a different approach, providing tools for manual context management rather than automatic compaction:

1. **Handoff**: Specify a goal for the next task, Amp analyzes the current thread and extracts relevant information into a new message for a fresh thread
2. **Fork**: Duplicate context window at a specific point
3. **Edit/Restore**: Edit or restore to previous messages
4. **Thread References**: Reference other threads to extract information on-demand

### Key observations

- Philosophy: "For best results, keep conversations short & focused" ([source](https://ampcode.com/guides/context-management))
- Emphasizes that everything in context affects output quality: "everything in the context window has an influence on the output" ([source](https://ampcode.com/guides/context-management))
- Uses a secondary model to extract relevant information during handoff ([source](https://ampcode.com/guides/context-management))
- Thread references allow selective extraction without full context inclusion ([source](https://ampcode.com/guides/context-management))
- No automatic compaction; relies on user discipline and tooling

## Implementation Recommendations for pi-coding-agent

### `/compact` Command

```typescript
// User triggers: /compact [optional custom instructions]
// 1. Generate summary using current conversation
// 2. Create new session with summary as initial context
// 3. Optionally continue with queued user message
```

### Auto-compaction

```typescript
// Threshold-based (e.g., 85-90% of context limit)
// Check after each turn:
if (tokenUsage / contextLimit > 0.85) {
  await compact({ auto: true });
}
```

### Compaction Prompt

Based on research, a good compaction prompt should include:

```markdown
Create a detailed summary for continuing this coding session. Include:

1. **Completed work**: What tasks were finished
2. **Current state**: Files modified, their current status
3. **In progress**: What is being worked on now
4. **Next steps**: Clear actions to take
5. **Constraints**: User preferences, project requirements, key decisions made
6. **Critical context**: Any information essential for continuing

Be concise but preserve enough detail that work can continue seamlessly.
```

### Key Design Decisions

1. **Threshold**: 85-90% recommended (95% is often too late, per Claude Code user feedback)
2. **Pruning**: Consider pruning old tool outputs before full compaction (OpenCode approach)
3. **Warning**: Notify users that compaction happened and quality may degrade (Codex approach)
4. **Disable option**: Allow users to disable auto-compaction via flag/env (OpenCode approach)
5. **Custom instructions**: Support `/compact [instructions]` for targeted summaries (Claude Code approach)
6. **Session continuity**: New session should feel seamless (summary as hidden context)

### Existing Infrastructure

The coding-agent already has:
- `/clear` command that resets the session
- Session management with message history
- Token counting per turn

For compaction, we need to:
1. Add `/compact` command handler (similar to `/clear` but with summary)
2. Add token threshold checking after each assistant turn
3. Create a summarization prompt
4. Wire it to create a new session with the summary

---

## Our Implementation Plan

### Commands

- **`/compact [custom instructions]`** - Manual compaction trigger. Optional custom instructions let users guide what to focus on in the summary.
- **`/autocompact`** - Opens selector UI to toggle auto-compaction on/off. Also displays current power-user settings (reserveTokens, keepRecentTokens).

### Configuration

Settings stored in `~/.pi/agent/settings.json`:

```typescript
interface Settings {
  // ... existing fields
  compaction?: {
    enabled?: boolean           // default: true, toggled via /autocompact
    reserveTokens?: number      // default: 16384, power-user setting
    keepRecentTokens?: number   // default: 20000, power-user setting
  }
}
```

**Why these defaults:**
- `reserveTokens: 16384` - Room for summary output (~8k) plus safety margin (~8k)
- `keepRecentTokens: 20000` - Preserves recent context verbatim, summary focuses on older content

### Token Calculation

Context tokens are calculated from assistant messages as:
```
contextTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite
```

The diff between consecutive (non-aborted, non-error) assistant messages gives the tokens added by that turn. Verified against actual session files.

**Trigger condition:**
```typescript
if (contextTokens > model.contextWindow - settings.compaction.reserveTokens) {
  await compact({ auto: true });
}
```

### Turn Boundaries

Messages follow patterns like: `user, assistant, toolResult, toolResult, user, assistant, ...`

**Critical rule:** Never cut mid-turn. A turn = user message → assistant responses + tool results until next user message. Always cut before a user message to keep assistant + toolResult pairs intact (providers fail if toolResult is orphaned from its assistant message with the toolCall).

### Summary Injection

The summary is injected as a **user message** with a prefix (similar to Codex approach). This makes it visible to the user and clearly frames it for the model.

Prefix:
```
Another language model worked on this task and produced a summary. Use this to continue the work without duplicating effort:
```

### Session File Format

Compaction events are **appended** to the session file (never inserted mid-file):

```typescript
interface CompactionEvent {
  type: "compaction"
  timestamp: string
  summary: string           // The summary text
  keepLastMessages: number  // How many messages before this event to keep
  tokensBefore: number      // Context size before compaction
}
```

Example session file after compaction:
```
{"type": "message", "message": {"role": "user", ...}}
{"type": "message", "message": {"role": "assistant", ...}}
{"type": "message", "message": {"role": "toolResult", ...}}
... more messages ...
{"type": "compaction", "summary": "...", "keepLastMessages": 4, ...}
{"type": "message", "message": {"role": "user", ...}}  <- new messages after compaction
```

**Session loader behavior:**
1. Find the latest compaction event
2. Take last `keepLastMessages` messages *before* the compaction event
3. Build context: `[summary_as_user_msg, ...kept_messages, ...messages_after_compaction]`

**Multiple compactions:** When doing a second compaction, don't cross the first compaction boundary. The new summary incorporates the previous summary (since current context already includes it).

### Summarization

Use **pi-ai directly** (not the full agent loop) for summarization:
- No tools needed
- Set `maxTokens: 8192` for bounded output
- Pass abort signal for cancellation
- Use the currently selected model

**Prompt** (based on Codex, enhanced):
```markdown
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

### Error Handling

- On compaction failure: output error, let user decide what to do
- In JSON/RPC mode: emit `{"type": "error", "error": "message"}` (existing pattern)
- Compaction is abortable via the same abort signal as regular streaming

### Image Handling

Two cases:
1. **Images via file path in prompt** → Model reads with tool → Can be captured in summary as "image at /path/to/file.png was analyzed". Prompt instructs model to include absolute file paths.
2. **Images via @attachment** → Attached to user message directly → Lost in compaction (can't summarize an image). Known limitation.

### Modes

Works in all modes:
- **TUI**: Commands available, UI shows compaction happening
- **Print/JSON**: Compaction events emitted as output
- **RPC**: Compaction events sent to client

### Implementation Steps

1. Add `compaction` field to `Settings` interface and `SettingsManager`
2. Add `CompactionEvent` type to session manager
3. Update session loader to handle compaction events
4. Add `/compact` command handler
5. Add `/autocompact` command with selector UI
6. Add compaction trigger check after each assistant turn
7. Implement summarization function using pi-ai
8. Add compaction event to RPC/JSON output types
9. Update footer to show when auto-compact is disabled
