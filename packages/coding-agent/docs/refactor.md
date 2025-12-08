# Coding Agent Refactoring Plan

## Status

**Branch:** `refactor`
**Started:** 2024-12-08

To resume work on this refactoring:
1. Read this document fully
2. Run `git diff` to see current work in progress
3. Check the work packages below - find first unchecked item
4. Read any files mentioned in that work package before making changes

## Strategy: Keep Old Code for Reference

We create new files alongside old ones instead of modifying in place:
- `src/modes/print-mode.ts` (new) - old code stays in `main.ts`
- `src/modes/rpc-mode.ts` (new) - old code stays in `main.ts`
- `src/modes/interactive/interactive-mode.ts` (new) - old code stays in `tui/tui-renderer.ts`
- `src/main-new.ts` (new) - old code stays in `main.ts`
- `src/cli-new.ts` (new) - old code stays in `cli.ts`

This allows:
- Parallel comparison of old vs new behavior
- Gradual migration and testing
- Easy rollback if needed

Final switchover: When everything works, rename files and delete old code.

---

## Goals

1. **Eliminate code duplication** between the three run modes (interactive, print/json, rpc)
2. **Create a testable core** (`AgentSession`) that encapsulates all agent/session logic
3. **Separate concerns**: TUI rendering vs agent state management vs I/O
4. **Improve naming**: `TuiRenderer` → `InteractiveMode` (it's not just a renderer)
5. **Simplify main.ts**: Move setup logic out, make it just arg parsing + mode routing

---

## Architecture Overview

### Current State (Problems)

```
main.ts (1100+ lines)
├── parseArgs, printHelp
├── buildSystemPrompt, loadProjectContextFiles
├── resolveModelScope, model resolution logic
├── runInteractiveMode() - thin wrapper around TuiRenderer
├── runSingleShotMode() - duplicates event handling, session saving
├── runRpcMode() - duplicates event handling, session saving, auto-compaction, bash execution
└── executeRpcBashCommand() - duplicate of TuiRenderer.executeBashCommand()

tui/tui-renderer.ts (2400+ lines)
├── TUI lifecycle (init, render, event loop)
├── Agent event handling + session persistence (duplicated in main.ts)
├── Auto-compaction logic (duplicated in main.ts runRpcMode)
├── Bash execution (duplicated in main.ts)
├── All slash command implementations (/export, /copy, /model, /thinking, etc.)
├── All hotkey handlers (Ctrl+C, Ctrl+P, Shift+Tab, etc.)
├── Model/thinking cycling logic
└── 6 different selector UIs (model, thinking, theme, session, branch, oauth)
```

### Target State

```
src/
├── main.ts (~200 lines)
│   ├── parseArgs, printHelp
│   └── Route to appropriate mode
│
├── core/
│   ├── agent-session.ts      # Shared agent/session logic (THE key abstraction)
│   ├── bash-executor.ts      # Bash execution with streaming + cancellation
│   └── setup.ts              # Model resolution, system prompt building, session loading
│
└── modes/
    ├── print-mode.ts         # Simple: prompt, output result
    ├── rpc-mode.ts           # JSON stdin/stdout protocol
    └── interactive/
        ├── interactive-mode.ts   # Main orchestrator
        ├── command-handlers.ts   # Slash command implementations
        ├── hotkeys.ts            # Hotkey handling
        └── selectors.ts          # Modal selector management
```

---

## AgentSession API

This is the core abstraction shared by all modes. See full API design below.

```typescript
class AgentSession {
  // ─── Read-only State Access ───
  get state(): AgentState;
  get model(): Model<any> | null;
  get thinkingLevel(): ThinkingLevel;
  get isStreaming(): boolean;
  get messages(): AppMessage[];  // Includes custom types like BashExecutionMessage
  get queueMode(): QueueMode;

  // ─── Event Subscription ───
  // Handles session persistence internally (saves messages, checks auto-compaction)
  subscribe(listener: (event: AgentEvent) => void): () => void;

  // ─── Prompting ───
  prompt(text: string, options?: PromptOptions): Promise<void>;
  queueMessage(text: string): Promise<void>;
  clearQueue(): string[];
  abort(): Promise<void>;
  reset(): Promise<void>;

  // ─── Model Management ───
  setModel(model: Model<any>): Promise<void>;  // Validates API key, saves to session + settings
  cycleModel(): Promise<ModelCycleResult | null>;
  getAvailableModels(): Promise<Model<any>[]>;

  // ─── Thinking Level ───
  setThinkingLevel(level: ThinkingLevel): void;  // Saves to session + settings
  cycleThinkingLevel(): ThinkingLevel | null;
  supportsThinking(): boolean;

  // ─── Queue Mode ───
  setQueueMode(mode: QueueMode): void;  // Saves to settings

  // ─── Compaction ───
  compact(customInstructions?: string): Promise<CompactionResult>;
  abortCompaction(): void;
  checkAutoCompaction(): Promise<CompactionResult | null>;  // Called internally after assistant messages
  setAutoCompactionEnabled(enabled: boolean): void;  // Saves to settings
  get autoCompactionEnabled(): boolean;

  // ─── Bash Execution ───
  executeBash(command: string, onChunk?: (chunk: string) => void): Promise<BashResult>;
  abortBash(): void;
  get isBashRunning(): boolean;

  // Session management
  switchSession(sessionPath: string): Promise<void>;
  branch(entryIndex: number): string;
  getUserMessagesForBranching(): Array<{ entryIndex: number; text: string }>;
  getSessionStats(): SessionStats;
  exportToHtml(outputPath?: string): string;

  // Utilities
  getLastAssistantText(): string | null;
}
```

---

## Work Packages

### WP1: Create bash-executor.ts
> Extract bash execution into a standalone module that both AgentSession and tests can use.

**Files to create:**
- `src/core/bash-executor.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: `executeBashCommand()` method (lines ~2190-2270)
- `src/main.ts`: `executeRpcBashCommand()` function (lines ~640-700)

**Implementation:**
```typescript
// src/core/bash-executor.ts
export interface BashExecutorOptions {
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface BashResult {
  output: string;
  exitCode: number | null;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

export function executeBash(command: string, options?: BashExecutorOptions): Promise<BashResult>;
```

**Logic to include:**
- Spawn shell process with `getShellConfig()`
- Stream stdout/stderr through `onChunk` callback (if provided)
- Handle temp file creation for large output (> DEFAULT_MAX_BYTES)
- Sanitize output (stripAnsi, sanitizeBinaryOutput, normalize newlines)
- Apply truncation via `truncateTail()`
- Support cancellation via AbortSignal (calls `killProcessTree`)
- Return structured result

**Verification:**
1. `npm run check` passes
2. Manual test: Run `pi` in interactive mode, execute `!ls -la`, verify output appears
3. Manual test: Run `!sleep 10`, press Esc, verify cancellation works

- [x] Create `src/core/bash-executor.ts` with `executeBash()` function
- [x] Add proper TypeScript types and exports
- [x] Verify with `npm run check`

---

### WP2: Create agent-session.ts (Core Structure)
> Create the AgentSession class with basic structure and state access.

**Files to create:**
- `src/core/agent-session.ts`
- `src/core/index.ts` (barrel export)

**Dependencies:** None (can use existing imports)

**Implementation - Phase 1 (structure + state access):**
```typescript
// src/core/agent-session.ts
import type { Agent, AgentEvent, AgentState, AppMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type { SessionManager } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";

export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
  fileCommands?: FileSlashCommand[];
}

export class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  
  private scopedModels: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
  private fileCommands: FileSlashCommand[];

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.settingsManager = config.settingsManager;
    this.scopedModels = config.scopedModels ?? [];
    this.fileCommands = config.fileCommands ?? [];
  }

  // State access (simple getters)
  get state(): AgentState { return this.agent.state; }
  get model(): Model<any> | null { return this.agent.state.model; }
  get thinkingLevel(): ThinkingLevel { return this.agent.state.thinkingLevel; }
  get isStreaming(): boolean { return this.agent.state.isStreaming; }
  get messages(): AppMessage[] { return this.agent.state.messages; }
  get sessionFile(): string { return this.sessionManager.getSessionFile(); }
  get sessionId(): string { return this.sessionManager.getSessionId(); }
}
```

**Verification:**
1. `npm run check` passes
2. Class can be instantiated (will test via later integration)

- [x] Create `src/core/agent-session.ts` with basic structure
- [x] Create `src/core/index.ts` barrel export
- [x] Verify with `npm run check`

---

### WP3: AgentSession - Event Subscription + Session Persistence
> Add subscribe() method that wraps agent subscription and handles session persistence.

**Files to modify:**
- `src/core/agent-session.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: `subscribeToAgent()` method (lines ~470-495)
- `src/main.ts`: `runRpcMode()` subscription logic (lines ~720-745)
- `src/main.ts`: `runSingleShotMode()` subscription logic (lines ~605-610)

**Implementation:**
```typescript
// Add to AgentSession class

private unsubscribeAgent?: () => void;
private eventListeners: Array<(event: AgentEvent) => void> = [];

/**
 * Subscribe to agent events. Session persistence is handled internally.
 * Multiple listeners can be added. Returns unsubscribe function.
 */
subscribe(listener: (event: AgentEvent) => void): () => void {
  this.eventListeners.push(listener);
  
  // Set up agent subscription if not already done
  if (!this.unsubscribeAgent) {
    this.unsubscribeAgent = this.agent.subscribe(async (event) => {
      // Notify all listeners
      for (const l of this.eventListeners) {
        l(event);
      }
      
      // Handle session persistence
      if (event.type === "message_end") {
        this.sessionManager.saveMessage(event.message);
        
        // Initialize session after first user+assistant exchange
        if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
          this.sessionManager.startSession(this.agent.state);
        }
        
        // Check auto-compaction after assistant messages
        if (event.message.role === "assistant") {
          await this.checkAutoCompaction();
        }
      }
    });
  }
  
  // Return unsubscribe function for this specific listener
  return () => {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  };
}

/**
 * Unsubscribe from agent entirely (used during cleanup/reset)
 */
private unsubscribeAll(): void {
  if (this.unsubscribeAgent) {
    this.unsubscribeAgent();
    this.unsubscribeAgent = undefined;
  }
  this.eventListeners = [];
}
```

**Verification:**
1. `npm run check` passes

- [x] Add `subscribe()` method to AgentSession
- [x] Add `_disconnectFromAgent()` private method (renamed from unsubscribeAll)
- [x] Add `_reconnectToAgent()` private method (renamed from resubscribe)
- [x] Add `dispose()` public method for full cleanup
- [x] Verify with `npm run check`

---

### WP4: AgentSession - Prompting Methods
> Add prompt(), queueMessage(), clearQueue(), abort(), reset() methods.

**Files to modify:**
- `src/core/agent-session.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: editor.onSubmit validation logic (lines ~340-380)
- `src/tui/tui-renderer.ts`: handleClearCommand() (lines ~2005-2035)
- Slash command expansion from `expandSlashCommand()`

**Implementation:**
```typescript
// Add to AgentSession class

private queuedMessages: string[] = [];

/**
 * Send a prompt to the agent.
 * - Validates model and API key
 * - Expands slash commands by default
 * - Throws if no model or no API key
 */
async prompt(text: string, options?: { 
  expandSlashCommands?: boolean; 
  attachments?: Attachment[];
}): Promise<void> {
  const expandCommands = options?.expandSlashCommands ?? true;
  
  // Validate model
  if (!this.model) {
    throw new Error(
      "No model selected.\n\n" +
      "Set an API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)\n" +
      `or create ${getModelsPath()}\n\n` +
      "Then use /model to select a model."
    );
  }
  
  // Validate API key
  const apiKey = await getApiKeyForModel(this.model);
  if (!apiKey) {
    throw new Error(
      `No API key found for ${this.model.provider}.\n\n` +
      `Set the appropriate environment variable or update ${getModelsPath()}`
    );
  }
  
  // Expand slash commands
  const expandedText = expandCommands ? expandSlashCommand(text, this.fileCommands) : text;
  
  await this.agent.prompt(expandedText, options?.attachments);
}

/**
 * Queue a message while agent is streaming.
 */
async queueMessage(text: string): Promise<void> {
  this.queuedMessages.push(text);
  await this.agent.queueMessage({
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  });
}

/**
 * Clear queued messages. Returns them for restoration to editor.
 */
clearQueue(): string[] {
  const queued = [...this.queuedMessages];
  this.queuedMessages = [];
  this.agent.clearMessageQueue();
  return queued;
}

/**
 * Abort current operation and wait for idle.
 */
async abort(): Promise<void> {
  this.agent.abort();
  await this.agent.waitForIdle();
}

/**
 * Reset agent and session. Starts a fresh session.
 */
async reset(): Promise<void> {
  this.unsubscribeAll();
  await this.abort();
  this.agent.reset();
  this.sessionManager.reset();
  this.queuedMessages = [];
  // Re-subscribe (caller may have added listeners before reset)
  // Actually, listeners are cleared in unsubscribeAll, so caller needs to re-subscribe
}
```

**Verification:**
1. `npm run check` passes

- [x] Add `prompt()` method with validation and slash command expansion
- [x] Add `queueMessage()` method
- [x] Add `clearQueue()` method  
- [x] Add `abort()` method
- [x] Add `reset()` method
- [x] Add `queuedMessageCount` getter and `getQueuedMessages()` method
- [x] Verify with `npm run check`

---

### WP5: AgentSession - Model Management
> Add setModel(), cycleModel(), getAvailableModels() methods.

**Files to modify:**
- `src/core/agent-session.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: `cycleModel()` method (lines ~970-1070)
- Model validation scattered throughout

**Implementation:**
```typescript
// Add to AgentSession class

export interface ModelCycleResult {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
}

/**
 * Set model directly. Validates API key, saves to session and settings.
 */
async setModel(model: Model<any>): Promise<void> {
  const apiKey = await getApiKeyForModel(model);
  if (!apiKey) {
    throw new Error(`No API key for ${model.provider}/${model.id}`);
  }
  
  this.agent.setModel(model);
  this.sessionManager.saveModelChange(model.provider, model.id);
  this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
}

/**
 * Cycle to next model. Uses scoped models if available.
 * Returns null if only one model available.
 */
async cycleModel(): Promise<ModelCycleResult | null> {
  if (this.scopedModels.length > 0) {
    return this.cycleScopedModel();
  } else {
    return this.cycleAvailableModel();
  }
}

private async cycleScopedModel(): Promise<ModelCycleResult | null> {
  if (this.scopedModels.length <= 1) return null;
  
  const currentModel = this.model;
  let currentIndex = this.scopedModels.findIndex(
    (sm) => sm.model.id === currentModel?.id && sm.model.provider === currentModel?.provider
  );
  
  if (currentIndex === -1) currentIndex = 0;
  const nextIndex = (currentIndex + 1) % this.scopedModels.length;
  const next = this.scopedModels[nextIndex];
  
  // Validate API key
  const apiKey = await getApiKeyForModel(next.model);
  if (!apiKey) {
    throw new Error(`No API key for ${next.model.provider}/${next.model.id}`);
  }
  
  // Apply model
  this.agent.setModel(next.model);
  this.sessionManager.saveModelChange(next.model.provider, next.model.id);
  this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
  
  // Apply thinking level (silently use "off" if not supported)
  const effectiveThinking = next.model.reasoning ? next.thinkingLevel : "off";
  this.agent.setThinkingLevel(effectiveThinking);
  this.sessionManager.saveThinkingLevelChange(effectiveThinking);
  this.settingsManager.setDefaultThinkingLevel(effectiveThinking);
  
  return { model: next.model, thinkingLevel: effectiveThinking, isScoped: true };
}

private async cycleAvailableModel(): Promise<ModelCycleResult | null> {
  const { models: availableModels, error } = await getAvailableModels();
  if (error) throw new Error(`Failed to load models: ${error}`);
  if (availableModels.length <= 1) return null;
  
  const currentModel = this.model;
  let currentIndex = availableModels.findIndex(
    (m) => m.id === currentModel?.id && m.provider === currentModel?.provider
  );
  
  if (currentIndex === -1) currentIndex = 0;
  const nextIndex = (currentIndex + 1) % availableModels.length;
  const nextModel = availableModels[nextIndex];
  
  const apiKey = await getApiKeyForModel(nextModel);
  if (!apiKey) {
    throw new Error(`No API key for ${nextModel.provider}/${nextModel.id}`);
  }
  
  this.agent.setModel(nextModel);
  this.sessionManager.saveModelChange(nextModel.provider, nextModel.id);
  this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
  
  return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
}

/**
 * Get all available models with valid API keys.
 */
async getAvailableModels(): Promise<Model<any>[]> {
  const { models, error } = await getAvailableModels();
  if (error) throw new Error(error);
  return models;
}
```

**Verification:**
1. `npm run check` passes

- [x] Add `ModelCycleResult` interface
- [x] Add `setModel()` method
- [x] Add `cycleModel()` method with scoped/available variants
- [x] Add `getAvailableModels()` method
- [x] Verify with `npm run check`

---

### WP6: AgentSession - Thinking Level Management
> Add setThinkingLevel(), cycleThinkingLevel(), supportsThinking() methods.

**Files to modify:**
- `src/core/agent-session.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: `cycleThinkingLevel()` method (lines ~940-970)

**Implementation:**
```typescript
// Add to AgentSession class

/**
 * Set thinking level. Silently uses "off" if model doesn't support it.
 * Saves to session and settings.
 */
setThinkingLevel(level: ThinkingLevel): void {
  const effectiveLevel = this.supportsThinking() ? level : "off";
  this.agent.setThinkingLevel(effectiveLevel);
  this.sessionManager.saveThinkingLevelChange(effectiveLevel);
  this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
}

/**
 * Cycle to next thinking level.
 * Returns new level, or null if model doesn't support thinking.
 */
cycleThinkingLevel(): ThinkingLevel | null {
  if (!this.supportsThinking()) return null;
  
  const modelId = this.model?.id || "";
  const supportsXhigh = modelId.includes("codex-max");
  const levels: ThinkingLevel[] = supportsXhigh
    ? ["off", "minimal", "low", "medium", "high", "xhigh"]
    : ["off", "minimal", "low", "medium", "high"];
  
  const currentIndex = levels.indexOf(this.thinkingLevel);
  const nextIndex = (currentIndex + 1) % levels.length;
  const nextLevel = levels[nextIndex];
  
  this.setThinkingLevel(nextLevel);
  return nextLevel;
}

/**
 * Check if current model supports thinking.
 */
supportsThinking(): boolean {
  return !!this.model?.reasoning;
}
```

**Verification:**
1. `npm run check` passes

- [x] Add `setThinkingLevel()` method
- [x] Add `cycleThinkingLevel()` method
- [x] Add `supportsThinking()` method
- [x] Add `setQueueMode()` method and `queueMode` getter (see below)
- [x] Verify with `npm run check`

**Queue mode (add to same WP):**
```typescript
// Add to AgentSession class

get queueMode(): QueueMode {
  return this.agent.getQueueMode();
}

/**
 * Set message queue mode. Saves to settings.
 */
setQueueMode(mode: QueueMode): void {
  this.agent.setQueueMode(mode);
  this.settingsManager.setQueueMode(mode);
}
```

---

### WP7: AgentSession - Compaction
> Add compact(), abortCompaction(), checkAutoCompaction(), autoCompactionEnabled methods.

**Files to modify:**
- `src/core/agent-session.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: `executeCompaction()` (lines ~2280-2370)
- `src/tui/tui-renderer.ts`: `checkAutoCompaction()` (lines ~495-525)
- `src/main.ts`: `runRpcMode()` auto-compaction logic (lines ~730-770)

**Implementation:**
```typescript
// Add to AgentSession class

export interface CompactionResult {
  tokensBefore: number;
  tokensAfter: number;
  summary: string;
}

private compactionAbortController: AbortController | null = null;

/**
 * Manually compact the session context.
 * Aborts current agent operation first.
 */
async compact(customInstructions?: string): Promise<CompactionResult> {
  // Abort any running operation
  this.unsubscribeAll();
  await this.abort();
  
  // Create abort controller
  this.compactionAbortController = new AbortController();
  
  try {
    const apiKey = await getApiKeyForModel(this.model!);
    if (!apiKey) {
      throw new Error(`No API key for ${this.model!.provider}`);
    }
    
    const entries = this.sessionManager.loadEntries();
    const settings = this.settingsManager.getCompactionSettings();
    const compactionEntry = await compact(
      entries,
      this.model!,
      settings,
      apiKey,
      this.compactionAbortController.signal,
      customInstructions,
    );
    
    if (this.compactionAbortController.signal.aborted) {
      throw new Error("Compaction cancelled");
    }
    
    // Save and reload
    this.sessionManager.saveCompaction(compactionEntry);
    const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
    this.agent.replaceMessages(loaded.messages);
    
    return {
      tokensBefore: compactionEntry.tokensBefore,
      tokensAfter: compactionEntry.tokensAfter,
      summary: compactionEntry.summary,
    };
  } finally {
    this.compactionAbortController = null;
    // Note: caller needs to re-subscribe after compaction
  }
}

/**
 * Cancel in-progress compaction.
 */
abortCompaction(): void {
  this.compactionAbortController?.abort();
}

/**
 * Check if auto-compaction should run, and run if so.
 * Returns result if compaction occurred, null otherwise.
 */
async checkAutoCompaction(): Promise<CompactionResult | null> {
  const settings = this.settingsManager.getCompactionSettings();
  if (!settings.enabled) return null;
  
  // Get last non-aborted assistant message
  const messages = this.messages;
  let lastAssistant: AssistantMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      if (assistantMsg.stopReason !== "aborted") {
        lastAssistant = assistantMsg;
        break;
      }
    }
  }
  if (!lastAssistant) return null;
  
  const contextTokens = calculateContextTokens(lastAssistant.usage);
  const contextWindow = this.model?.contextWindow ?? 0;
  
  if (!shouldCompact(contextTokens, contextWindow, settings)) return null;
  
  // Perform auto-compaction (don't abort current operation for auto)
  try {
    const apiKey = await getApiKeyForModel(this.model!);
    if (!apiKey) return null;
    
    const entries = this.sessionManager.loadEntries();
    const compactionEntry = await compact(entries, this.model!, settings, apiKey);
    
    this.sessionManager.saveCompaction(compactionEntry);
    const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
    this.agent.replaceMessages(loaded.messages);
    
    return {
      tokensBefore: compactionEntry.tokensBefore,
      tokensAfter: compactionEntry.tokensAfter,
      summary: compactionEntry.summary,
    };
  } catch {
    return null; // Silently fail auto-compaction
  }
}

/**
 * Toggle auto-compaction setting.
 */
setAutoCompactionEnabled(enabled: boolean): void {
  this.settingsManager.setCompactionEnabled(enabled);
}

get autoCompactionEnabled(): boolean {
  return this.settingsManager.getCompactionEnabled();
}
```

**Verification:**
1. `npm run check` passes

- [x] Add `CompactionResult` interface
- [x] Add `compact()` method
- [x] Add `abortCompaction()` method
- [x] Add `checkAutoCompaction()` method
- [x] Add `setAutoCompactionEnabled()` and getter
- [x] Verify with `npm run check`

---

### WP8: AgentSession - Bash Execution
> Add executeBash(), abortBash(), isBashRunning using the bash-executor module.

**Files to modify:**
- `src/core/agent-session.ts`

**Dependencies:** WP1 (bash-executor.ts)

**Implementation:**
```typescript
// Add to AgentSession class

import { executeBash as executeBashCommand, type BashResult } from "./bash-executor.js";
import type { BashExecutionMessage } from "../messages.js";

private bashAbortController: AbortController | null = null;

/**
 * Execute a bash command. Adds result to agent context and session.
 */
async executeBash(command: string, onChunk?: (chunk: string) => void): Promise<BashResult> {
  this.bashAbortController = new AbortController();
  
  try {
    const result = await executeBashCommand(command, {
      onChunk,
      signal: this.bashAbortController.signal,
    });
    
    // Create and save message
    const bashMessage: BashExecutionMessage = {
      role: "bashExecution",
      command,
      output: result.output,
      exitCode: result.exitCode,
      cancelled: result.cancelled,
      truncated: result.truncated,
      fullOutputPath: result.fullOutputPath,
      timestamp: Date.now(),
    };
    
    this.agent.appendMessage(bashMessage);
    this.sessionManager.saveMessage(bashMessage);
    
    // Initialize session if needed
    if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
      this.sessionManager.startSession(this.agent.state);
    }
    
    return result;
  } finally {
    this.bashAbortController = null;
  }
}

/**
 * Cancel running bash command.
 */
abortBash(): void {
  this.bashAbortController?.abort();
}

get isBashRunning(): boolean {
  return this.bashAbortController !== null;
}
```

**Verification:**
1. `npm run check` passes

- [x] Add bash execution methods using bash-executor module
- [x] Verify with `npm run check`

---

### WP9: AgentSession - Session Management
> Add switchSession(), branch(), getUserMessagesForBranching(), getSessionStats(), exportToHtml().

**Files to modify:**
- `src/core/agent-session.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: `handleResumeSession()` (lines ~1650-1710)
- `src/tui/tui-renderer.ts`: `showUserMessageSelector()` branch logic (lines ~1560-1600)
- `src/tui/tui-renderer.ts`: `handleSessionCommand()` (lines ~1870-1930)

**Implementation:**
```typescript
// Add to AgentSession class

export interface SessionStats {
  sessionFile: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

/**
 * Switch to a different session file.
 * Aborts current operation, loads messages, restores model/thinking.
 */
async switchSession(sessionPath: string): Promise<void> {
  this.unsubscribeAll();
  await this.abort();
  this.queuedMessages = [];
  
  this.sessionManager.setSessionFile(sessionPath);
  const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
  this.agent.replaceMessages(loaded.messages);
  
  // Restore model
  const savedModel = this.sessionManager.loadModel();
  if (savedModel) {
    const availableModels = (await getAvailableModels()).models;
    const match = availableModels.find(
      (m) => m.provider === savedModel.provider && m.id === savedModel.modelId
    );
    if (match) {
      this.agent.setModel(match);
    }
  }
  
  // Restore thinking level
  const savedThinking = this.sessionManager.loadThinkingLevel();
  if (savedThinking) {
    this.agent.setThinkingLevel(savedThinking as ThinkingLevel);
  }
  
  // Note: caller needs to re-subscribe after switch
}

/**
 * Create a branch from a specific entry index.
 * Returns the text of the selected user message (for editor pre-fill).
 */
branch(entryIndex: number): string {
  const entries = this.sessionManager.loadEntries();
  const selectedEntry = entries[entryIndex];
  
  if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
    throw new Error("Invalid entry index for branching");
  }
  
  const selectedText = this.extractUserMessageText(selectedEntry.message.content);
  
  // Create branched session
  const newSessionFile = this.sessionManager.createBranchedSessionFromEntries(entries, entryIndex);
  this.sessionManager.setSessionFile(newSessionFile);
  
  // Reload
  const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
  this.agent.replaceMessages(loaded.messages);
  
  return selectedText;
}

/**
 * Get all user messages from session for branch selector.
 */
getUserMessagesForBranching(): Array<{ entryIndex: number; text: string }> {
  const entries = this.sessionManager.loadEntries();
  const result: Array<{ entryIndex: number; text: string }> = [];
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    if (entry.message.role !== "user") continue;
    
    const text = this.extractUserMessageText(entry.message.content);
    if (text) {
      result.push({ entryIndex: i, text });
    }
  }
  
  return result;
}

private extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

/**
 * Get session statistics.
 */
getSessionStats(): SessionStats {
  const state = this.state;
  const userMessages = state.messages.filter((m) => m.role === "user").length;
  const assistantMessages = state.messages.filter((m) => m.role === "assistant").length;
  const toolResults = state.messages.filter((m) => m.role === "toolResult").length;
  
  let toolCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  
  for (const message of state.messages) {
    if (message.role === "assistant") {
      const assistantMsg = message as AssistantMessage;
      toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
      totalInput += assistantMsg.usage.input;
      totalOutput += assistantMsg.usage.output;
      totalCacheRead += assistantMsg.usage.cacheRead;
      totalCacheWrite += assistantMsg.usage.cacheWrite;
      totalCost += assistantMsg.usage.cost.total;
    }
  }
  
  return {
    sessionFile: this.sessionFile,
    sessionId: this.sessionId,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: state.messages.length,
    tokens: {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
    },
    cost: totalCost,
  };
}

/**
 * Export session to HTML.
 */
exportToHtml(outputPath?: string): string {
  return exportSessionToHtml(this.sessionManager, this.state, outputPath);
}
```

**Verification:**
1. `npm run check` passes

- [x] Add `SessionStats` interface
- [x] Add `switchSession()` method
- [x] Add `branch()` method
- [x] Add `getUserMessagesForBranching()` method
- [x] Add `getSessionStats()` method
- [x] Add `exportToHtml()` method
- [x] Verify with `npm run check`

---

### WP10: AgentSession - Utility Methods
> Add getLastAssistantText() and any remaining utilities.

**Files to modify:**
- `src/core/agent-session.ts`

**Extract from:**
- `src/tui/tui-renderer.ts`: `handleCopyCommand()` (lines ~1840-1870)

**Implementation:**
```typescript
// Add to AgentSession class

/**
 * Get text content of last assistant message (for /copy).
 * Returns null if no assistant message exists.
 */
getLastAssistantText(): string | null {
  const lastAssistant = this.messages
    .slice()
    .reverse()
    .find((m) => m.role === "assistant");
  
  if (!lastAssistant) return null;
  
  let text = "";
  for (const content of lastAssistant.content) {
    if (content.type === "text") {
      text += content.text;
    }
  }
  
  return text.trim() || null;
}

/**
 * Get queued message count (for UI display).
 */
get queuedMessageCount(): number {
  return this.queuedMessages.length;
}

/**
 * Get queued messages (for display, not modification).
 */
getQueuedMessages(): readonly string[] {
  return this.queuedMessages;
}
```

**Verification:**
1. `npm run check` passes

- [x] Add `getLastAssistantText()` method
- [x] Add `queuedMessageCount` getter (done in WP4)
- [x] Add `getQueuedMessages()` method (done in WP4)
- [x] Verify with `npm run check`

---

### WP11: Create print-mode.ts
> Extract single-shot mode into its own module using AgentSession.

**Files to create:**
- `src/modes/print-mode.ts`

**Extract from:**
- `src/main.ts`: `runSingleShotMode()` function (lines ~615-640)

**Implementation:**
```typescript
// src/modes/print-mode.ts

import type { Attachment } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentSession } from "../core/agent-session.js";

export async function runPrintMode(
  session: AgentSession,
  mode: "text" | "json",
  messages: string[],
  initialMessage?: string,
  initialAttachments?: Attachment[],
): Promise<void> {
  
  if (mode === "json") {
    // Output all events as JSON
    session.subscribe((event) => {
      console.log(JSON.stringify(event));
    });
  }

  // Send initial message with attachments
  if (initialMessage) {
    await session.prompt(initialMessage, { attachments: initialAttachments });
  }

  // Send remaining messages
  for (const message of messages) {
    await session.prompt(message);
  }

  // In text mode, output final response
  if (mode === "text") {
    const state = session.state;
    const lastMessage = state.messages[state.messages.length - 1];
    
    if (lastMessage?.role === "assistant") {
      const assistantMsg = lastMessage as AssistantMessage;
      
      // Check for error/aborted
      if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
        console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
        process.exit(1);
      }
      
      // Output text content
      for (const content of assistantMsg.content) {
        if (content.type === "text") {
          console.log(content.text);
        }
      }
    }
  }
}
```

**Verification:**
1. `npm run check` passes
2. Manual test: `pi -p "echo hello"` still works

- [x] Create `src/modes/print-mode.ts`
- [x] Verify with `npm run check`

---

### WP12: Create rpc-mode.ts
> Extract RPC mode into its own module using AgentSession.

**Files to create:**
- `src/modes/rpc-mode.ts`

**Extract from:**
- `src/main.ts`: `runRpcMode()` function (lines ~700-800)

**Implementation:**
```typescript
// src/modes/rpc-mode.ts

import * as readline from "readline";
import type { AgentSession } from "../core/agent-session.js";

export async function runRpcMode(session: AgentSession): Promise<never> {
  // Output all events as JSON
  session.subscribe((event) => {
    console.log(JSON.stringify(event));
    
    // Emit auto-compaction events
    // (checkAutoCompaction is called internally by AgentSession after assistant messages)
  });

  // Listen for JSON input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line: string) => {
    try {
      const input = JSON.parse(line);

      switch (input.type) {
        case "prompt":
          if (input.message) {
            await session.prompt(input.message, { 
              attachments: input.attachments,
              expandSlashCommands: false, // RPC mode doesn't expand slash commands
            });
          }
          break;

        case "abort":
          await session.abort();
          break;

        case "compact":
          try {
            const result = await session.compact(input.customInstructions);
            console.log(JSON.stringify({ type: "compaction", ...result }));
          } catch (error: any) {
            console.log(JSON.stringify({ type: "error", error: `Compaction failed: ${error.message}` }));
          }
          break;

        case "bash":
          if (input.command) {
            try {
              const result = await session.executeBash(input.command);
              console.log(JSON.stringify({ type: "bash_end", message: result }));
            } catch (error: any) {
              console.log(JSON.stringify({ type: "error", error: `Bash failed: ${error.message}` }));
            }
          }
          break;

        default:
          console.log(JSON.stringify({ type: "error", error: `Unknown command: ${input.type}` }));
      }
    } catch (error: any) {
      console.log(JSON.stringify({ type: "error", error: error.message }));
    }
  });

  // Keep process alive forever
  return new Promise(() => {});
}
```

**Verification:**
1. `npm run check` passes
2. Manual test: RPC mode still works (if you have a way to test it)

- [x] Create `src/modes/rpc-mode.ts`
- [x] Verify with `npm run check`

---

### WP13: Create modes/index.ts barrel export
> Create barrel export for all modes.

**Files to create:**
- `src/modes/index.ts`

**Implementation:**
```typescript
// src/modes/index.ts
export { runPrintMode } from "./print-mode.js";
export { runRpcMode } from "./rpc-mode.js";
// InteractiveMode will be added later
```

- [x] Create `src/modes/index.ts`
- [x] Verify with `npm run check`

---

### WP14: Create main-new.ts using AgentSession and new modes
> Create a new main file that uses AgentSession and the new mode modules.
> Old main.ts is kept for reference/comparison.

**Files to create:**
- `src/main-new.ts` (copy from main.ts, then modify)
- `src/cli-new.ts` (copy from cli.ts, point to main-new.ts)

**Changes to main-new.ts:**
1. Remove `runSingleShotMode()` function (use print-mode.ts)
2. Remove `runRpcMode()` function (use rpc-mode.ts)
3. Remove `executeRpcBashCommand()` function (use bash-executor.ts)
4. Create `AgentSession` instance after agent setup
5. Pass `AgentSession` to mode functions

**Key changes in main():**
```typescript
// After agent creation, create AgentSession
const session = new AgentSession({
  agent,
  sessionManager,
  settingsManager,
  scopedModels,
  fileCommands: loadSlashCommands(),
});

// Route to modes
if (mode === "rpc") {
  await runRpcMode(session);
} else if (isInteractive) {
  // For now, still use TuiRenderer directly (will refactor in WP15+)
  await runInteractiveMode(agent, sessionManager, ...);
} else {
  await runPrintMode(session, mode, parsed.messages, initialMessage, initialAttachments);
}
```

**cli-new.ts:**
```typescript
#!/usr/bin/env node
import { main } from "./main-new.js";
main(process.argv.slice(2));
```

**Testing the new implementation:**
```bash
# Run new implementation directly
npx tsx src/cli-new.ts -p "hello"
npx tsx src/cli-new.ts --mode json "hello"
npx tsx src/cli-new.ts  # interactive mode
```

**Verification:**
1. `npm run check` passes
2. Manual test: `npx tsx src/cli-new.ts -p "hello"` works
3. Manual test: `npx tsx src/cli-new.ts --mode json "hello"` works
4. Manual test: `npx tsx src/cli-new.ts --mode rpc` works

- [x] Copy main.ts to main-new.ts
- [x] Remove `runSingleShotMode()` from main-new.ts
- [x] Remove `runRpcMode()` from main-new.ts  
- [x] Remove `executeRpcBashCommand()` from main-new.ts
- [x] Import and use `runPrintMode` from modes
- [x] Import and use `runRpcMode` from modes
- [x] Create `AgentSession` in main()
- [x] Update mode routing to use new functions
- [x] Create cli-new.ts
- [x] Verify with `npm run check`
- [ ] Manual test all three modes via cli-new.ts

---

### WP15: Create InteractiveMode using AgentSession
> Create a new interactive mode class that uses AgentSession.
> Old tui-renderer.ts is kept for reference.

**Files to create:**
- `src/modes/interactive/interactive-mode.ts` (based on tui-renderer.ts)

**This is the largest change. Strategy:**
1. Copy tui-renderer.ts to new location
2. Rename class from `TuiRenderer` to `InteractiveMode`
3. Change constructor to accept `AgentSession` instead of separate agent/sessionManager/settingsManager
4. Replace all `this.agent.*` calls with `this.session.agent.*` or appropriate AgentSession methods
5. Replace all `this.sessionManager.*` calls with AgentSession methods
6. Replace all `this.settingsManager.*` calls with AgentSession methods where applicable
7. Remove duplicated logic that now lives in AgentSession

**Key replacements:**
| Old | New |
|-----|-----|
| `this.agent.prompt()` | `this.session.prompt()` |
| `this.agent.abort()` | `this.session.abort()` |
| `this.sessionManager.saveMessage()` | (handled internally by AgentSession.subscribe) |
| `this.cycleThinkingLevel()` | `this.session.cycleThinkingLevel()` |
| `this.cycleModel()` | `this.session.cycleModel()` |
| `this.executeBashCommand()` | `this.session.executeBash()` |
| `this.executeCompaction()` | `this.session.compact()` |
| `this.checkAutoCompaction()` | (handled internally by AgentSession) |
| `this.handleClearCommand()` reset logic | `this.session.reset()` |
| `this.handleResumeSession()` | `this.session.switchSession()` |

**Constructor change:**
```typescript
// Old
constructor(
  agent: Agent,
  sessionManager: SessionManager,
  settingsManager: SettingsManager,
  version: string,
  ...
)

// New  
constructor(
  session: AgentSession,
  version: string,
  ...
)
```

**Verification:**
1. `npm run check` passes
2. Manual test via cli-new.ts: Full interactive mode works
3. Manual test: All slash commands work
4. Manual test: All hotkeys work
5. Manual test: Bash execution works
6. Manual test: Model/thinking cycling works

- [x] Create `src/modes/interactive/` directory
- [x] Copy tui-renderer.ts to interactive-mode.ts
- [x] Rename class to `InteractiveMode`
- [x] Change constructor to accept AgentSession
- [x] Update all agent access to go through session
- [x] Remove `subscribeToAgent()` method (use session.subscribe)
- [x] Remove `checkAutoCompaction()` method (handled by session)
- [x] Update `cycleThinkingLevel()` to use session method
- [x] Update `cycleModel()` to use session method
- [x] Update bash execution to use session.executeBash()
- [x] Update compaction to use session.compact()
- [x] Update reset logic to use session.reset()
- [x] Update session switching to use session.switchSession()
- [x] Update branch logic to use session.branch()
- [x] Remove all direct sessionManager access (use convenience getters for remaining access)
- [x] Update imports to point to `../../tui/` for components (keep old components in place for now)
- [x] Update modes/index.ts to export InteractiveMode
- [x] Verify with `npm run check`
- [ ] Manual test interactive mode via cli-new.ts

---

### WP16: Update main-new.ts runInteractiveMode to use InteractiveMode
> Update runInteractiveMode in main-new.ts to use the new InteractiveMode class.

**Files to modify:**
- `src/main-new.ts`

**Changes:**
```typescript
import { InteractiveMode } from "./modes/interactive/interactive-mode.js";

async function runInteractiveMode(
  session: AgentSession,
  version: string,
  changelogMarkdown: string | null,
  collapseChangelog: boolean,
  modelFallbackMessage: string | null,
  versionCheckPromise: Promise<string | null>,
  initialMessages: string[],
  initialMessage?: string,
  initialAttachments?: Attachment[],
  fdPath: string | null,
): Promise<void> {
  const mode = new InteractiveMode(
    session,
    version,
    changelogMarkdown,
    collapseChangelog,
    fdPath,
  );
  // ... rest stays similar
}
```

**Verification:**
1. `npm run check` passes
2. Manual test via cli-new.ts: Interactive mode works

- [x] Update `runInteractiveMode()` in main-new.ts
- [x] Update InteractiveMode instantiation
- [x] Verify with `npm run check`

---

### WP17: (OPTIONAL) Move TUI components to modes/interactive/
> Move TUI-specific components to the interactive mode directory.
> This is optional cleanup - can be skipped if too disruptive.

**Note:** The old `src/tui/` directory is kept. We just create copies/moves as needed.
For now, InteractiveMode can import from `../../tui/` to reuse existing components.

**Files to potentially move (if doing this WP):**
- `src/tui/assistant-message.ts` → `src/modes/interactive/components/`
- `src/tui/bash-execution.ts` → `src/modes/interactive/components/`
- etc.

**Skip this WP for now** - focus on getting the new architecture working first.
The component organization can be cleaned up later.

- [ ] SKIPPED (optional cleanup for later)

---

### WP19: Extract setup logic from main.ts
> Create setup.ts with model resolution, system prompt building, etc.

**Files to create:**
- `src/core/setup.ts`

**Extract from main.ts:**
- `buildSystemPrompt()` function
- `loadProjectContextFiles()` function
- `loadContextFileFromDir()` function
- `resolveModelScope()` function
- Model resolution logic (the priority system)
- Session loading/restoration logic

**Implementation:**
```typescript
// src/core/setup.ts

export interface SetupOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  thinking?: ThinkingLevel;
  continue?: boolean;
  resume?: boolean;
  models?: string[];
  tools?: ToolName[];
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
}

export interface SetupResult {
  agent: Agent;
  initialModel: Model<any> | null;
  initialThinking: ThinkingLevel;
  scopedModels: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
  modelFallbackMessage: string | null;
}

export async function setupAgent(options: SetupOptions): Promise<SetupResult>;

export function buildSystemPrompt(
  customPrompt?: string, 
  selectedTools?: ToolName[], 
  appendSystemPrompt?: string
): string;

export function loadProjectContextFiles(): Array<{ path: string; content: string }>;

export async function resolveModelScope(
  patterns: string[]
): Promise<Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>>;
```

**Verification:**
1. `npm run check` passes
2. All modes still work

- [ ] Create `src/core/setup.ts`
- [ ] Move `buildSystemPrompt()` from main.ts
- [ ] Move `loadProjectContextFiles()` from main.ts
- [ ] Move `loadContextFileFromDir()` from main.ts
- [ ] Move `resolveModelScope()` from main.ts
- [ ] Create `setupAgent()` function
- [ ] Update main.ts to use setup.ts
- [ ] Verify with `npm run check`

---

### WP20: Final cleanup and documentation
> Clean up main.ts, add documentation, verify everything works.

**Tasks:**
1. Remove any dead code from main.ts
2. Ensure main.ts is ~200-300 lines (just arg parsing + routing)
3. Add JSDoc comments to AgentSession public methods
4. Update README if needed
5. Final manual testing of all features

**Verification:**
1. `npm run check` passes
2. All three modes work
3. All slash commands work
4. All hotkeys work
5. Session persistence works
6. Compaction works
7. Bash execution works
8. Model/thinking cycling works

- [ ] Remove dead code from main.ts
- [ ] Add JSDoc to AgentSession
- [ ] Final testing
- [ ] Update README if needed

---

## Testing Checklist (E2E)

After refactoring is complete, verify these scenarios:

### Interactive Mode
- [ ] Start fresh session: `pi`
- [ ] Continue session: `pi -c`
- [ ] Resume session: `pi -r`
- [ ] Initial message: `pi "hello"`
- [ ] File attachment: `pi @file.txt "summarize"`
- [ ] Model cycling: Ctrl+P
- [ ] Thinking cycling: Shift+Tab
- [ ] Tool expansion: Ctrl+O
- [ ] Thinking toggle: Ctrl+T
- [ ] Abort: Esc during streaming
- [ ] Clear: Ctrl+C twice to exit
- [ ] Bash command: `!ls -la`
- [ ] Bash cancel: Esc during bash
- [ ] /thinking command
- [ ] /model command
- [ ] /export command
- [ ] /copy command
- [ ] /session command
- [ ] /changelog command
- [ ] /branch command
- [ ] /login and /logout commands
- [ ] /queue command
- [ ] /theme command
- [ ] /clear command
- [ ] /compact command
- [ ] /autocompact command
- [ ] /resume command
- [ ] Message queuing while streaming

### Print Mode
- [ ] Basic: `pi -p "hello"`
- [ ] JSON: `pi --mode json "hello"`
- [ ] Multiple messages: `pi -p "first" "second"`
- [ ] File attachment: `pi -p @file.txt "summarize"`

### RPC Mode
- [ ] Start: `pi --mode rpc`
- [ ] Send prompt via JSON
- [ ] Abort via JSON
- [ ] Compact via JSON
- [ ] Bash via JSON

---

## Notes

- This refactoring should be done incrementally, testing after each work package
- If a WP introduces regressions, fix them before moving to the next
- The most risky WP is WP15 (updating TuiRenderer) - take extra care there
- Consider creating git commits after each major WP for easy rollback
