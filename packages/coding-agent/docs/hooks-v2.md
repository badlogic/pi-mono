# Hooks v2: Context Control + Commands

Issue: #289

## Motivation

Enable features like session stacking (`/pop`) as hooks, not core code. Core provides primitives, hooks implement features.

## Primitives

| Primitive | Purpose |
|-----------|---------|
| `ctx.saveEntry({type, ...})` | Persist custom entry to session |
| `pi.on("context", handler)` | Transform messages before LLM |
| `ctx.rebuildContext()` | Trigger context rebuild |
| `pi.command(name, opts)` | Register slash command |

## Extended HookEventContext

```typescript
interface HookEventContext {
  // Existing
  exec, ui, hasUI, cwd, sessionFile

  // State (read-only)
  model: Model<any> | null;
  thinkingLevel: ThinkingLevel;
  entries: readonly SessionEntry[];

  // Utilities
  findModel(provider: string, id: string): Model<any> | null;
  availableModels(): Promise<Model<any>[]>;
  resolveApiKey(model: Model<any>): Promise<string | undefined>;

  // Mutation
  saveEntry(entry: { type: string; [k: string]: unknown }): Promise<void>;
  rebuildContext(): Promise<void>;
}

interface ContextMessage {
  message: AppMessage;
  entryIndex: number | null;  // null = synthetic
}

interface ContextEvent {
  type: "context";
  entries: readonly SessionEntry[];
  messages: ContextMessage[];
}
```

Commands also get: `args`, `argsRaw`, `signal`, `setModel()`, `setThinkingLevel()`.

## Stacking: Design

### Entry Format

```typescript
interface StackPopEntry {
  type: "stack_pop";
  backToIndex: number;
  summary: string;
  prePopSummary?: string;  // when crossing compaction
  timestamp: number;
}
```

### Crossing Compaction

Entries are never deleted. Raw data always available.

When `backToIndex < compaction.firstKeptEntryIndex`:
1. Read raw entries `[0, backToIndex)` → summarize → `prePopSummary`
2. Read raw entries `[backToIndex, now)` → summarize → `summary`

### Context Algorithm: Later Wins

Assign sequential IDs to ranges. On overlap, highest ID wins.

```
Compaction at 40: range [0, 30) id=0
StackPop at 50, backTo=20, prePopSummary: ranges [0, 20) id=1, [20, 50) id=2

Index 0-19: id=0 and id=1 cover → id=1 wins (prePopSummary)
Index 20-29: id=0 and id=2 cover → id=2 wins (popSummary)
Index 30-49: id=2 covers → id=2 (already emitted at 20)
Index 50+: no coverage → include as messages
```

## Complex Scenario Trace

```
Initial: [msg1, msg2, msg3, msg4, msg5]
         idx: 1,   2,    3,   4,    5

Compaction triggers:
  [msg1-5, compaction{firstKept:4, summary:C1}]
  idx: 1-5,   6
  Context: [C1, msg4, msg5]

User continues:
  [..., compaction, msg4, msg5, msg6, msg7]
  idx:     6,        4*,   5*,   7,    8    (* kept from before)
  
User does /pop to msg2 (index 2):
  - backTo=2 < firstKept=4 → crossing!
  - prePopSummary: summarize raw [0,2) → P1
  - summary: summarize raw [2,8) → S1
  - save: stack_pop{backTo:2, summary:S1, prePopSummary:P1} at index 9

  Ranges:
    compaction [0,4) id=0
    prePopSummary [0,2) id=1
    popSummary [2,9) id=2

  Context build:
    idx 0: covered by id=0,1 → id=1 wins, emit P1
    idx 1: covered by id=0,1 → id=1 (already emitted)
    idx 2: covered by id=0,2 → id=2 wins, emit S1
    idx 3-8: covered by id=0 or id=2 → id=2 (already emitted)
    idx 9: stack_pop entry, skip
    idx 10+: not covered, include as messages

  Result: [P1, S1, msg10+]

User continues, another compaction:
  [..., stack_pop, msg10, msg11, msg12, compaction{firstKept:11, summary:C2}]
  idx:     9,       10,    11,   12,       13

  Ranges:
    compaction@6 [0,4) id=0
    prePopSummary [0,2) id=1
    popSummary [2,9) id=2
    compaction@13 [0,11) id=3  ← this now covers previous ranges!

  Context build:
    idx 0-10: covered by multiple, id=3 wins → emit C2 at idx 0
    idx 11+: include as messages

  Result: [C2, msg11, msg12]
  
  C2's summary text includes info from P1 and S1 (they were in context when C2 was generated).
```

The "later wins" rule naturally handles all cases.

## Core Changes

| File | Change |
|------|--------|
| `session-manager.ts` | `saveEntry()`, `buildSessionContext()` returns `ContextMessage[]` |
| `hooks/types.ts` | `ContextEvent`, `ContextMessage`, extended context, command types |
| `hooks/loader.ts` | Track commands |
| `hooks/runner.ts` | `setStateCallbacks()`, `emitContext()`, command methods |
| `agent-session.ts` | `saveEntry()`, `rebuildContext()`, state callbacks |
| `interactive-mode.ts` | Command handling, autocomplete |

## Stacking Hook: Complete Implementation

```typescript
import { complete } from "@mariozechner/pi-ai";
import type { HookAPI, AppMessage, SessionEntry, ContextMessage } from "@mariozechner/pi-coding-agent/hooks";

export default function(pi: HookAPI) {
  pi.command("pop", {
    description: "Pop to previous turn, summarizing work",
    handler: async (ctx) => {
      const entries = ctx.entries as SessionEntry[];
      
      // Get user turns
      const turns = entries
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.type === "message" && (e as any).message.role === "user")
        .map(({ e, i }) => ({ idx: i, text: preview((e as any).message) }));
      
      if (turns.length < 2) return { status: "Need at least 2 turns" };
      
      // Select target (skip last turn - that's current)
      const options = turns.slice(0, -1).map(t => `[${t.idx}] ${t.text}`);
      const selected = ctx.args[0] 
        ? options.find(o => o.startsWith(`[${ctx.args[0]}]`))
        : await ctx.ui.select("Pop to:", options);
      
      if (!selected) return;
      const backTo = parseInt(selected.match(/\[(\d+)\]/)![1]);
      
      // Check compaction crossing
      const compactions = entries.filter(e => e.type === "compaction") as any[];
      const latestCompaction = compactions[compactions.length - 1];
      const crossing = latestCompaction && backTo < latestCompaction.firstKeptEntryIndex;
      
      // Generate summaries
      let prePopSummary: string | undefined;
      if (crossing) {
        ctx.ui.notify("Crossing compaction, generating pre-pop summary...", "info");
        const preMsgs = getMessages(entries.slice(0, backTo));
        prePopSummary = await summarize(preMsgs, ctx, "context before this work");
      }
      
      const popMsgs = getMessages(entries.slice(backTo));
      const summary = await summarize(popMsgs, ctx, "completed work");
      
      // Save and rebuild
      await ctx.saveEntry({
        type: "stack_pop",
        backToIndex: backTo,
        summary,
        prePopSummary,
      });
      
      await ctx.rebuildContext();
      return { status: `Popped to turn ${backTo}` };
    }
  });

  pi.on("context", (event, ctx) => {
    const hasPops = event.entries.some(e => e.type === "stack_pop");
    if (!hasPops) return;
    
    // Collect ranges with IDs
    let rangeId = 0;
    const ranges: Array<{from: number; to: number; summary: string; id: number}> = [];
    
    for (let i = 0; i < event.entries.length; i++) {
      const e = event.entries[i] as any;
      if (e.type === "compaction") {
        ranges.push({ from: 0, to: e.firstKeptEntryIndex, summary: e.summary, id: rangeId++ });
      }
      if (e.type === "stack_pop") {
        if (e.prePopSummary) {
          ranges.push({ from: 0, to: e.backToIndex, summary: e.prePopSummary, id: rangeId++ });
        }
        ranges.push({ from: e.backToIndex, to: i, summary: e.summary, id: rangeId++ });
      }
    }
    
    // Build messages
    const messages: ContextMessage[] = [];
    const emitted = new Set<number>();
    
    for (let i = 0; i < event.entries.length; i++) {
      const covering = ranges.filter(r => r.from <= i && i < r.to);
      
      if (covering.length) {
        const winner = covering.reduce((a, b) => a.id > b.id ? a : b);
        if (i === winner.from && !emitted.has(winner.id)) {
          messages.push({
            message: { role: "user", content: `[Summary]\n\n${winner.summary}`, timestamp: Date.now() } as AppMessage,
            entryIndex: null
          });
          emitted.add(winner.id);
        }
        continue;
      }
      
      const e = event.entries[i];
      if (e.type === "message") {
        messages.push({ message: (e as any).message, entryIndex: i });
      }
    }
    
    return { messages };
  });
}

function getMessages(entries: SessionEntry[]): AppMessage[] {
  return entries.filter(e => e.type === "message").map(e => (e as any).message);
}

function preview(msg: AppMessage): string {
  const text = typeof msg.content === "string" ? msg.content 
    : (msg.content as any[]).filter(c => c.type === "text").map(c => c.text).join(" ");
  return text.slice(0, 40) + (text.length > 40 ? "..." : "");
}

async function summarize(msgs: AppMessage[], ctx: any, purpose: string): Promise<string> {
  const apiKey = await ctx.resolveApiKey(ctx.model);
  const resp = await complete(ctx.model, {
    messages: [...msgs, { role: "user", content: `Summarize as "${purpose}". Be concise.`, timestamp: Date.now() }]
  }, { apiKey, maxTokens: 2000, signal: ctx.signal });
  return resp.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}
```

## Edge Cases

### Session Resumed Without Hook

User has stacking hook, does `/pop`, saves `stack_pop` entry. Later removes hook and resumes session.

**What happens:**
1. Core loads all entries (including `stack_pop`)
2. Core's `buildSessionContext()` ignores unknown types, returns compaction + message entries
3. `context` event fires, but no handler processes `stack_pop`
4. Core's messages pass through unchanged

**Result:** Messages that were "popped" return to context. The pop is effectively undone.

**Why this is OK:**
- Session file is intact, no data lost
- If compaction happened after pop, the compaction summary captured the popped state
- User removed the hook, so hook's behavior (hiding messages) is gone
- User can re-add hook to restore stacking behavior

**Mitigation:** Could warn on session load if unknown entry types found:
```typescript
// In session load
const unknownTypes = entries
  .map(e => e.type)
  .filter(t => !knownTypes.has(t));
if (unknownTypes.length) {
  console.warn(`Session has entries of unknown types: ${unknownTypes.join(", ")}`);
}
```

### Hook Added to Existing Session

User has old session without stacking. Adds stacking hook, does `/pop`.

**What happens:**
1. Hook saves `stack_pop` entry
2. `context` event fires, hook processes it
3. Works normally

No issue. Hook processes entries it recognizes, ignores others.

### Multiple Hooks with Different Entry Types

Hook A handles `type_a` entries, Hook B handles `type_b` entries.

**What happens:**
1. `context` event chains through both hooks
2. Each hook checks for its entry types, passes through if none found
3. Each hook's transforms are applied in order

**Best practice:** Hooks should:
- Only process their own entry types
- Return `undefined` (pass through) if no relevant entries
- Use prefixed type names: `myhook_pop`, `myhook_prune`

### Conflicting Hooks

Two hooks both try to handle the same entry type (e.g., both handle `compaction`).

**What happens:**
- Later hook (project > global) wins in the chain
- Earlier hook's transform is overwritten

**Mitigation:** 
- Core entry types (`compaction`, `message`, etc.) should not be overridden by hooks
- Hooks should use unique prefixed type names
- Document which types are "reserved"

### Session with Future Entry Types

User downgrades pi version, session has entry types from newer version.

**What happens:**
- Same as "hook removed" - unknown types ignored
- Core handles what it knows, hooks handle what they know

**Session file is forward-compatible:** Unknown entries are preserved in file, just not processed.

## Implementation Phases

| Phase | Scope | LOC |
|-------|-------|-----|
| v2.0 | `saveEntry`, `context` event, `rebuildContext`, extended context | ~150 |
| v2.1 | `pi.command()`, TUI integration, autocomplete | ~200 |
| v2.2 | Example hooks, documentation | ~300 |

## Implementation Order

1. `ContextMessage` type, update `buildSessionContext()` return type
2. `saveEntry()` in session-manager
3. `context` event in runner with chaining
4. State callbacks interface and wiring
5. `rebuildContext()` in agent-session
6. Manual test with simple hook
7. Command registration in loader
8. Command invocation in runner
9. TUI command handling + autocomplete
10. Stacking example hook
11. Pruning example hook
12. Update hooks.md
