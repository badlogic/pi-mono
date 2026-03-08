# Memories Feature Integration Plan

## Overview

This document outlines the implementation plan for porting the **memories** system from oh-my-pi into pi-mono. The memories feature provides long-term memory consolidation across sessions, enabling the agent to learn from past interactions and extract reusable knowledge.

---

## Problem Statement

**Current State**: pi-mono coding-agent sessions are isolated - each session starts fresh without retaining knowledge from previous sessions in the same project.

**Desired State**: A memories system that:
1. Extracts durable knowledge from completed session rollouts
2. Consolidates memories into a project-specific knowledge base
3. Injects relevant memory context into the system prompt
4. Generates reusable skills based on patterns across sessions

---

## Technical Approach

### Architecture Overview

The memories system uses a **two-phase consolidation pipeline**:

```
┌─────────────────────────────────────────────────────────────────┐
│                      SESSION ROLLOUTS                           │
│  (JSONL files in ~/.pi/agent/sessions/)                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 1: EXTRACTION                          │
│  - Per-thread processing                                        │
│  - LLM extracts: raw_memory, rollout_summary, rollout_slug     │
│  - Stores in stage1_outputs table                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 PHASE 2: CONSOLIDATION                          │
│  - Global aggregation of stage1 outputs                         │
│  - LLM produces: MEMORY.md, memory_summary.md, skills/         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                ARTIFACTS (per project)                          │
│  ~/.pi/agent/memories/<encoded-project-path>/                   │
│  ├── MEMORY.md           (full long-term memory)               │
│  ├── memory_summary.md   (compact for prompt injection)        │
│  ├── raw_memories.md     (aggregated phase1 outputs)           │
│  ├── rollout_summaries/  (individual summaries)                │
│  └── skills/             (extracted reusable skills)           │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `memories/index.ts` | Main pipeline orchestration | `src/core/memories/` |
| `memories/storage.ts` | SQLite state management | `src/core/memories/` |
| `memories/prompts/*.md` | LLM prompt templates | `src/core/prompts/memories/` |
| Settings integration | Memory configuration | `src/core/settings-manager.ts` |
| System prompt integration | Memory injection | `src/core/system-prompt.ts` |

---

## Implementation Steps

### Phase 1: Core Infrastructure

#### Step 1.1: Add SQLite Dependency

Add `better-sqlite3` to pi-mono for SQLite support (Node.js equivalent of `bun:sqlite`).

**File**: `packages/coding-agent/package.json`
```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

**Note**: better-sqlite3 requires native compilation. Ensure build scripts handle this.

#### Step 1.2: Create JSONL Parsing Utility

Port `parseJsonlLenient` to pi-mono without Bun-specific APIs.

**File**: `packages/coding-agent/src/utils/jsonl.ts`

```typescript
/**
 * Parse a complete JSONL string, skipping malformed lines instead of throwing.
 */
export function parseJsonlLenient<T>(buffer: string): T[] {
  const entries: T[] = [];
  const lines = buffer.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed lines
    }
  }
  
  return entries;
}
```

#### Step 1.3: Create Memories Directory Structure

**Files to create**:
```
packages/coding-agent/src/core/memories/
├── index.ts        # Main pipeline (ported from oh-my-pi)
├── storage.ts      # SQLite operations (ported, using better-sqlite3)
└── types.ts        # TypeScript interfaces

packages/coding-agent/src/core/prompts/memories/
├── consolidation.md
├── read-path.md
├── stage_one_input.md
└── stage_one_system.md
```

---

### Phase 2: Storage Layer

#### Step 2.1: Port storage.ts

Replace `bun:sqlite` with `better-sqlite3`.

**Key changes**:
```typescript
// Before (bun:sqlite)
import { Database } from "bun:sqlite";
const db = new Database(dbPath);

// After (better-sqlite3)
import Database from "better-sqlite3";
const db = new Database(dbPath);
```

**Database schema** (unchanged):
```sql
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  rollout_path TEXT NOT NULL,
  cwd TEXT NOT NULL,
  source_kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage1_outputs (
  thread_id TEXT PRIMARY KEY,
  source_updated_at INTEGER NOT NULL,
  raw_memory TEXT NOT NULL,
  rollout_summary TEXT NOT NULL,
  rollout_slug TEXT,
  generated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  kind TEXT NOT NULL,
  job_key TEXT NOT NULL,
  status TEXT NOT NULL,
  worker_id TEXT,
  ownership_token TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  lease_until INTEGER,
  retry_at INTEGER,
  retry_remaining INTEGER NOT NULL,
  last_error TEXT,
  input_watermark INTEGER,
  last_success_watermark INTEGER,
  PRIMARY KEY (kind, job_key)
);
```

#### Step 2.2: Add getAgentDbPath Helper

**File**: `packages/coding-agent/src/config.ts`

```typescript
/** Get path to agent.db (SQLite state database) */
export function getAgentDbPath(agentDir?: string): string {
  return join(agentDir ?? getAgentDir(), "agent.db");
}
```

---

### Phase 3: Core Pipeline

#### Step 3.1: Port index.ts Main Functions

Replace Bun-specific APIs:

| Original (oh-my-pi) | Replacement (pi-mono) |
|---------------------|----------------------|
| `Bun.file(path).text()` | `fs/promises.readFile(path, 'utf-8')` |
| `Bun.write(path, content)` | `fs/promises.writeFile(path, content)` |
| `parseJsonlLenient` (from utils) | Local implementation in `utils/jsonl.ts` |
| `logger` (from pi-utils) | Use `console.debug/warn` or create simple logger |

**Key functions to port**:

1. `startMemoryStartupTask()` - Entry point for memory processing
2. `buildMemoryToolDeveloperInstructions()` - System prompt injection
3. `clearMemoryData()` - Clear all memory state
4. `runPhase1()` - Per-thread extraction
5. `runPhase2()` - Global consolidation
6. `collectThreads()` - Session discovery
7. `runStage1Job()` - Single thread extraction
8. `runConsolidationModel()` - Phase 2 LLM call
9. `applyConsolidation()` - Write artifacts

#### Step 3.2: Create Prompt Templates

Copy prompt templates from oh-my-pi:

**File**: `packages/coding-agent/src/core/prompts/memories/consolidation.md`
```markdown
You are the memory consolidation agent.
Memory root: memory://root
Input corpus (raw memories):
{{raw_memories}}
Input corpus (rollout summaries):
{{rollout_summaries}}
[... rest of template]
```

**File**: `packages/coding-agent/src/core/prompts/memories/read-path.md`
```markdown
# Memory Guidance
Memory root: memory://root
Operational rules:
1) You **MUST** read `memory://root/memory_summary.md` first.
[... rest of template]
```

---

### Phase 4: Settings Integration

#### Step 4.1: Add Memory Settings Interface

**File**: `packages/coding-agent/src/core/settings-manager.ts`

```typescript
export interface MemorySettings {
  enabled?: boolean;                    // default: false
  maxRolloutsPerStartup?: number;       // default: 64
  maxRolloutAgeDays?: number;           // default: 30
  minRolloutIdleHours?: number;         // default: 12
  threadScanLimit?: number;             // default: 300
  maxRawMemoriesForGlobal?: number;     // default: 200
  stage1Concurrency?: number;           // default: 8
  stage1LeaseSeconds?: number;          // default: 120
  stage1RetryDelaySeconds?: number;     // default: 120
  phase2LeaseSeconds?: number;          // default: 180
  phase2RetryDelaySeconds?: number;     // default: 180
  phase2HeartbeatSeconds?: number;      // default: 30
  rolloutPayloadPercent?: number;       // default: 0.7
  fallbackTokenLimit?: number;          // default: 16000
  summaryInjectionTokenLimit?: number;  // default: 5000
}

export interface Settings {
  // ... existing settings ...
  memories?: MemorySettings;
}
```

#### Step 4.2: Add Settings Accessors

```typescript
// In SettingsManager class

getMemorySettings(): MemorySettings {
  return {
    enabled: this.settings.memories?.enabled ?? false,
    maxRolloutsPerStartup: this.settings.memories?.maxRolloutsPerStartup ?? 64,
    maxRolloutAgeDays: this.settings.memories?.maxRolloutAgeDays ?? 30,
    minRolloutIdleHours: this.settings.memories?.minRolloutIdleHours ?? 12,
    threadScanLimit: this.settings.memories?.threadScanLimit ?? 300,
    maxRawMemoriesForGlobal: this.settings.memories?.maxRawMemoriesForGlobal ?? 200,
    stage1Concurrency: this.settings.memories?.stage1Concurrency ?? 8,
    stage1LeaseSeconds: this.settings.memories?.stage1LeaseSeconds ?? 120,
    stage1RetryDelaySeconds: this.settings.memories?.stage1RetryDelaySeconds ?? 120,
    phase2LeaseSeconds: this.settings.memories?.phase2LeaseSeconds ?? 180,
    phase2RetryDelaySeconds: this.settings.memories?.phase2RetryDelaySeconds ?? 180,
    phase2HeartbeatSeconds: this.settings.memories?.phase2HeartbeatSeconds ?? 30,
    rolloutPayloadPercent: this.settings.memories?.rolloutPayloadPercent ?? 0.7,
    fallbackTokenLimit: this.settings.memories?.fallbackTokenLimit ?? 16000,
    summaryInjectionTokenLimit: this.settings.memories?.summaryInjectionTokenLimit ?? 5000,
  };
}

getMemoryEnabled(): boolean {
  return this.settings.memories?.enabled ?? false;
}

setMemoryEnabled(enabled: boolean): void {
  if (!this.globalSettings.memories) {
    this.globalSettings.memories = {};
  }
  this.globalSettings.memories.enabled = enabled;
  this.markModified("memories", "enabled");
  this.save();
}
```

---

### Phase 5: System Prompt Integration

#### Step 5.1: Extend buildSystemPrompt

**File**: `packages/coding-agent/src/core/system-prompt.ts`

```typescript
export interface BuildSystemPromptOptions {
  // ... existing options ...
  /** Memory summary to inject into prompt */
  memorySummary?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
  const { memorySummary, ...rest } = options;
  
  // ... existing prompt construction ...
  
  // Append memory guidance if available
  if (memorySummary) {
    prompt += `\n\n${memorySummary}`;
  }
  
  // ... rest of function ...
}
```

#### Step 5.2: Integrate with AgentSession

**File**: `packages/coding-agent/src/core/agent-session.ts`

Add memory summary loading and injection:

```typescript
import { buildMemoryToolDeveloperInstructions } from "./memories/index.js";

// In _rebuildSystemPrompt method:
private async _rebuildSystemPrompt(toolNames: string[]): Promise<string> {
  // ... existing logic ...
  
  // Load memory summary if enabled
  let memorySummary: string | undefined;
  if (this.settingsManager.getMemoryEnabled()) {
    memorySummary = await buildMemoryToolDeveloperInstructions(
      getAgentDir(),
      this.settingsManager,
    );
  }
  
  return buildSystemPrompt({
    cwd: this._cwd,
    skills: loadedSkills,
    contextFiles: loadedContextFiles,
    customPrompt: loaderSystemPrompt,
    appendSystemPrompt,
    selectedTools: validToolNames,
    toolSnippets,
    promptGuidelines,
    memorySummary,  // NEW
  });
}
```

---

### Phase 6: Startup Integration

#### Step 6.1: Integrate Memory Pipeline on Session Start

**File**: `packages/coding-agent/src/core/agent-session.ts`

```typescript
import { startMemoryStartupTask } from "./memories/index.js";

// After AgentSession construction or in an init method:
private _startMemoryPipeline(): void {
  startMemoryStartupTask({
    session: this,
    settings: this.settingsManager,
    modelRegistry: this._modelRegistry,
    agentDir: getAgentDir(),
    taskDepth: 0,  // 0 for main session, >0 for subagents
  });
}
```

---

### Phase 7: CLI Commands

#### Step 7.1: Add /memory Command

**File**: `packages/coding-agent/src/core/slash-commands.ts`

```typescript
export const BUILTIN_SLASH_COMMANDS: SlashCommandInfo[] = [
  // ... existing commands ...
  {
    name: "memory",
    description: "Manage long-term memories",
    usage: "/memory [clear|status|consolidate]",
    handler: async (args, ctx) => {
      const subCommand = args.trim();
      
      if (subCommand === "clear") {
        await clearMemoryData(getAgentDir(), ctx.sessionManager.getCwd());
        return "Memory data cleared.";
      }
      
      if (subCommand === "consolidate") {
        enqueueMemoryConsolidation(getAgentDir());
        return "Memory consolidation queued.";
      }
      
      // Default: show status
      const memoryRoot = getMemoryRoot(getAgentDir(), ctx.sessionManager.getCwd());
      const summaryPath = join(memoryRoot, "memory_summary.md");
      const hasMemory = existsSync(summaryPath);
      return `Memory status: ${hasMemory ? "Active" : "Not initialized"}\nMemory root: ${memoryRoot}`;
    },
  },
];
```

---

## Testing Strategy

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `test/memories/storage.test.ts` | SQLite operations, job claiming, retry logic |
| `test/memories/pipeline.test.ts` | Phase 1 & 2 processing |
| `test/memories/jsonl.test.ts` | JSONL parsing edge cases |
| `test/settings-manager.test.ts` | Memory settings accessors |

### Integration Tests

| Test File | Coverage |
|-----------|----------|
| `test/memories/e2e.test.ts` | Full pipeline with mock LLM |
| `test/memories/system-prompt.test.ts` | Memory injection into prompts |

### Test Fixtures

Create test session files in `test/fixtures/memories-sessions/`:
- Session with tool results (for extraction)
- Session without useful content (for no-output case)
- Session with secrets (for redaction testing)

---

## Potential Challenges & Solutions

### Challenge 1: Native Dependency (better-sqlite3)

**Problem**: better-sqlite3 requires native compilation, which may fail on some systems.

**Solution**: 
- Document native build requirements
- Provide fallback to in-memory storage for tests
- Consider conditional feature (graceful degradation if SQLite unavailable)

### Challenge 2: LLM API Calls in Background

**Problem**: Background memory processing makes unattended LLM calls.

**Solution**:
- Use same API key resolution as main session
- Log all background operations for debugging
- Implement proper error handling and retry logic (already in oh-my-pi)
- Make feature opt-in via settings (`memories.enabled: true`)

### Challenge 3: Token Budget Management

**Problem**: Memory injection consumes prompt tokens.

**Solution**:
- Configurable `summaryInjectionTokenLimit` setting
- Truncation with head/tail preservation
- Only inject when summary exists and is non-empty

### Challenge 4: Secret Redaction

**Problem**: Session rollouts may contain API keys, tokens.

**Solution**:
- Implement `redactSecrets()` function with regex patterns:
  - API key patterns: `sk-*`, `pk-*`, tokens
  - JWT patterns
  - AWS key patterns: `AKIA*`, `ASIA*`

---

## File Changes Summary

### New Files

```
packages/coding-agent/
├── src/core/memories/
│   ├── index.ts              # Main pipeline (~800 lines)
│   ├── storage.ts            # SQLite operations (~500 lines)
│   └── types.ts              # TypeScript interfaces (~100 lines)
├── src/core/prompts/memories/
│   ├── consolidation.md
│   ├── read-path.md
│   ├── stage_one_input.md
│   └── stage_one_system.md
├── src/utils/jsonl.ts        # JSONL parsing utility
└── test/memories/
    ├── storage.test.ts
    ├── pipeline.test.ts
    ├── jsonl.test.ts
    └── e2e.test.ts
```

### Modified Files

```
packages/coding-agent/
├── package.json              # Add better-sqlite3 dependency
├── src/config.ts             # Add getAgentDbPath()
├── src/core/settings-manager.ts  # Add MemorySettings interface & accessors
├── src/core/system-prompt.ts     # Add memorySummary option
├── src/core/agent-session.ts     # Integrate memory pipeline
└── src/core/slash-commands.ts    # Add /memory command
```

---

## Success Criteria

1. **Feature Parity**: All oh-my-pi memories functionality works in pi-mono
2. **No Breaking Changes**: Existing sessions and settings continue to work
3. **Opt-in by Default**: Feature disabled unless explicitly enabled
4. **Test Coverage**: >80% coverage for new code
5. **Documentation**: README.md updated with memories usage instructions
6. **Performance**: Background processing doesn't block interactive usage

---

## Rollout Plan

### Phase 1: Core Implementation (Week 1)
- Add dependencies and infrastructure
- Port storage layer
- Port pipeline with basic functionality

### Phase 2: Integration (Week 2)
- Settings integration
- System prompt integration
- CLI commands

### Phase 3: Testing & Polish (Week 3)
- Unit and integration tests
- Documentation
- Edge case handling

### Phase 4: Beta Release
- Feature flag for early adopters
- Collect feedback
- Iterate based on usage

---

## Appendix: Key Functions Reference

### Main Entry Points

```typescript
// Start background memory processing (non-blocking)
export function startMemoryStartupTask(options: {
  session: AgentSession;
  settings: SettingsManager;
  modelRegistry: ModelRegistry;
  agentDir: string;
  taskDepth: number;
}): void;

// Build memory guidance for prompt injection
export async function buildMemoryToolDeveloperInstructions(
  agentDir: string,
  settings: SettingsManager,
): Promise<string | undefined>;

// Clear all memory data
export async function clearMemoryData(agentDir: string, cwd: string): Promise<void>;

// Force consolidation (for CLI command)
export function enqueueMemoryConsolidation(agentDir: string): void;
```

### Storage Functions

```typescript
export function openMemoryDb(dbPath: string): Database;
export function closeMemoryDb(db: Database): void;
export function clearMemoryData(db: Database): void;
export function upsertThreads(db: Database, threads: MemoryThread[]): void;
export function claimStage1Jobs(db: Database, params: {...}): Stage1Claim[];
export function markStage1SucceededWithOutput(db: Database, params: {...}): boolean;
export function markStage1Failed(db: Database, params: {...}): boolean;
export function tryClaimGlobalPhase2Job(db: Database, params: {...}): {...};
export function listStage1OutputsForGlobal(db: Database, limit: number): Stage1OutputRow[];
export function markGlobalPhase2Succeeded(db: Database, params: {...}): boolean;
export function markGlobalPhase2Failed(db: Database, params: {...}): boolean;
```
