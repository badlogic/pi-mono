# Hooks v2: Commands + Context Control

Extends hooks with slash commands and context manipulation primitives.

## Goals

1. Hooks can register slash commands (`/pop`, `/pr`, `/test`)
2. Hooks can save custom session entries
3. Hooks can transform context before it goes to LLM
4. All handlers get unified baseline access to state

Benchmark: `/pop` (session stacking) implementable entirely as a hook.

## API Extensions

### Commands

```typescript
pi.command("pop", {
  description: "Pop to previous turn",
  handler: async (ctx) => {
    // ctx has full access (see Unified Context below)
    const selected = await ctx.ui.select("Pop to:", options);
    // ...
    return { status: "Done" };       // show status
    return "prompt text";            // send to agent
    return;                          // do nothing
  }
});
```

### Custom Entries

```typescript
// Save arbitrary entry to session
await ctx.saveEntry({
  type: "stack_pop",  // custom type, ignored by core
  backToIndex: 5,
  summary: "...",
  timestamp: Date.now()
});
```

### Context Transform

```typescript
// Fires when building context for LLM
pi.on("context", (event, ctx) => {
  // event.entries: all session entries (including custom types)
  // event.messages: core-computed messages (after compaction)
  
  // Return modified messages, or undefined to keep default
  return { messages: transformed };
});
```

Multiple `context` handlers chain: each receives previous handler's output.

### Rebuild Trigger

```typescript
// Force context rebuild (after saving entries)
await ctx.rebuildContext();
```

## Unified Context

All handlers receive:

```typescript
interface HookEventContext {
  // Existing
  exec(cmd: string, args: string[], opts?): Promise<ExecResult>;
  ui: { select, confirm, input, notify };
  hasUI: boolean;
  cwd: string;
  sessionFile: string | null;
  
  // New: State (read-only)
  model: Model<any> | null;
  thinkingLevel: ThinkingLevel;
  entries: readonly SessionEntry[];
  messages: readonly AppMessage[];
  
  // New: Utilities
  findModel(provider: string, id: string): Model<any> | null;
  availableModels(): Promise<Model<any>[]>;
  resolveApiKey(model: Model<any>): Promise<string | undefined>;
  
  // New: Mutation (commands only? or all?)
  saveEntry(entry: { type: string; [k: string]: unknown }): Promise<void>;
  rebuildContext(): Promise<void>;
}
```

Commands additionally get:
- `args: string[]`, `argsRaw: string`
- `setModel()`, `setThinkingLevel()` (state mutation)

## Benchmark: Stacking as Hook

```typescript
export default function(pi: HookAPI) {
  // Command: /pop
  pi.command("pop", {
    description: "Pop to previous turn, summarizing substack",
    handler: async (ctx) => {
      // 1. Build turn list from entries
      const turns = ctx.entries
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.type === "message" && e.message.role === "user")
        .map(({ e, i }) => ({ index: i, text: e.message.content.slice(0, 50) }));
      
      if (!turns.length) return { status: "No turns to pop" };
      
      // 2. User selects
      const selected = await ctx.ui.select("Pop to:", turns.map(t => t.text));
      if (!selected) return;
      const backTo = turns.find(t => t.text === selected)!.index;
      
      // 3. Summarize entries from backTo to now
      const toSummarize = ctx.entries.slice(backTo)
        .filter(e => e.type === "message")
        .map(e => e.message);
      const summary = await generateSummary(toSummarize, ctx);
      
      // 4. Save custom entry
      await ctx.saveEntry({
        type: "stack_pop",
        backToIndex: backTo,
        summary,
        timestamp: Date.now()
      });
      
      // 5. Rebuild
      await ctx.rebuildContext();
      return { status: "Popped stack" };
    }
  });
  
  // Context transform: apply stack pops
  pi.on("context", (event, ctx) => {
    const pops = event.entries.filter(e => e.type === "stack_pop");
    if (!pops.length) return; // use default
    
    // Build exclusion set
    const excluded = new Set<number>();
    const summaryAt = new Map<number, string>();
    
    for (const pop of pops) {
      const popIdx = event.entries.indexOf(pop);
      for (let i = pop.backToIndex; i <= popIdx; i++) excluded.add(i);
      summaryAt.set(pop.backToIndex, pop.summary);
    }
    
    // Build filtered messages
    const messages: AppMessage[] = [];
    for (let i = 0; i < event.entries.length; i++) {
      if (excluded.has(i)) continue;
      
      if (summaryAt.has(i)) {
        messages.push({
          role: "user",
          content: `[Subtask completed]\n\n${summaryAt.get(i)}`,
          timestamp: Date.now()
        });
      }
      
      const e = event.entries[i];
      if (e.type === "message") messages.push(e.message);
    }
    
    return { messages };
  });
}

async function generateSummary(messages, ctx) {
  const apiKey = await ctx.resolveApiKey(ctx.model);
  // Call LLM for summary...
}
```

## Core Changes Required

### session-manager.ts

```typescript
// Allow saving arbitrary entries
saveEntry(entry: { type: string; [k: string]: unknown }): void {
  if (!entry.type) throw new Error("Entry must have type");
  this.inMemoryEntries.push(entry);
  this._persist(entry);
}

// buildSessionContext ignores unknown types (existing behavior works)
```

### hooks/types.ts

```typescript
// New event
interface ContextEvent {
  type: "context";
  entries: readonly SessionEntry[];
  messages: AppMessage[];
}

// Extended base context (see Unified Context above)

// Command types
interface CommandOptions {
  description?: string;
  handler: (ctx: CommandContext) => Promise<CommandResult | void>;
}

type CommandResult = 
  | string 
  | { prompt: string; attachments?: Attachment[] }
  | { status: string };
```

### hooks/loader.ts

```typescript
// Track registered commands
interface LoadedHook {
  path: string;
  handlers: Map<string, Handler[]>;
  commands: Map<string, CommandOptions>;  // NEW
}

// createHookAPI adds command() method
```

### hooks/runner.ts

```typescript
class HookRunner {
  // State callbacks (set by AgentSession)
  setStateCallbacks(cb: StateCallbacks): void;
  
  // Command invocation
  getCommands(): Map<string, CommandOptions>;
  invokeCommand(name: string, argsRaw: string): Promise<CommandResult | void>;
  
  // Context event with chaining
  async emitContext(entries, messages): Promise<AppMessage[]> {
    let result = messages;
    for (const hook of this.hooks) {
      const handlers = hook.handlers.get("context");
      for (const h of handlers ?? []) {
        const out = await h({ entries, messages: result }, this.createContext());
        if (out?.messages) result = out.messages;
      }
    }
    return result;
  }
}
```

### agent-session.ts

```typescript
// Expose saveEntry
async saveEntry(entry): Promise<void> {
  this.sessionManager.saveEntry(entry);
}

// Rebuild context
async rebuildContext(): Promise<void> {
  const base = this.sessionManager.buildSessionContext();
  const entries = this.sessionManager.getEntries();
  const messages = await this._hookRunner.emitContext(entries, base.messages);
  this.agent.replaceMessages(messages);
}

// Fire context event during normal context building too
```

### interactive-mode.ts

```typescript
// In setupEditorSubmitHandler, check hook commands
const commands = this.session.hookRunner?.getCommands();
if (commands?.has(commandName)) {
  const result = await this.session.invokeCommand(commandName, argsRaw);
  // Handle result...
  return;
}

// Add hook commands to autocomplete
```

## Open Questions

1. **Mutation in all handlers or commands only?**
   - `saveEntry`/`rebuildContext` in all handlers = more power, more footguns
   - Commands only = safer, but limits hook creativity
   - Recommendation: start with commands only

2. **Context event timing**
   - Fire on every prompt? Or only when explicitly rebuilt?
   - Need to fire on session load too
   - Recommendation: fire whenever agent.replaceMessages is called

3. **Compaction interaction**
   - Core compaction runs first, then `context` event
   - Hooks can post-process compacted output
   - Future: compaction itself could become a replaceable hook

4. **Multiple context handlers**
   - Chain in load order (global → project)
   - Each sees previous output
   - No explicit priority system (KISS)
