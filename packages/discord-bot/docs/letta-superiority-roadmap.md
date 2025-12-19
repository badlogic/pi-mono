# Pi-Mono Superiority Roadmap: Surpassing Letta

## Current Advantages (Already Better)

### 1. Automatic Learning (Act-Learn-Reuse)
**Letta**: Skills must be manually created and updated
**Pi-Mono**: Agents automatically extract learnings and persist them

```typescript
// Pi-mono auto-learns from every execution
const result = await actLearnReuse("trading", task, executor);
// result.learned = { insight: "...", expertiseFile: "..." }
```

### 2. Local-First Architecture
**Letta**: Requires Letta Cloud API or self-hosted server
**Pi-Mono**: Runs entirely on local filesystem, zero external dependencies

### 3. Skill Resource Bundling
**Letta**: Skills are text-based SKILL.md only
**Pi-Mono**: Full bundles with executable scripts, reference docs, assets

```
skills/trading/
├── SKILL.md           # Description
├── expertise.md       # Auto-updated learnings
├── scripts/
│   └── backtest.py    # Executable tools
└── references/
    └── strategies.md  # Context documents
```

### 4. Domain Specialization
**Letta**: Generic agent platform
**Pi-Mono**: 89+ MCP tools, trading agents, cross-platform hub

---

## Improvements to Implement

### Phase 1: Memory Architecture (HIGH PRIORITY)

#### 1.1 Structured Memory Blocks
Adopt Letta's memory block concept but with local persistence:

```typescript
interface MemoryBlock {
  label: string;      // "persona", "human", "project", "trading"
  value: string;      // Current content
  readOnly: boolean;  // Some blocks agent can't modify
  limit: number;      // Character limit
}

interface AgentMemory {
  blocks: Map<string, MemoryBlock>;

  // Agent tools for self-editing
  memoryReplace(label: string, oldText: string, newText: string): void;
  memoryInsert(label: string, text: string): void;
  memoryRethink(label: string, newContent: string): void;
}
```

**Implementation**: Add memory-blocks.ts to agents/

#### 1.2 Conversation Search
Add semantic search over past conversations:

```typescript
interface ConversationMemory {
  // Store all agent interactions
  store(channelId: string, messages: Message[]): void;

  // Semantic search
  search(query: string, limit?: number): Message[];

  // Time-based recall
  recall(timeRange: { from: Date; to: Date }): Message[];
}
```

**Implementation**: Use SQLite FTS5 + optional embeddings

### Phase 2: Multi-Agent Orchestration (HIGH PRIORITY)

#### 2.1 Agent-to-Agent Messaging
```typescript
// Async (fire-and-forget)
await sendMessageToAgent(targetAgentId, message);

// Sync (wait for response)
const response = await sendMessageAndWait(targetAgentId, message);

// Broadcast to tagged agents
const responses = await broadcastToAgents(["worker", "trading"], message);
```

#### 2.2 Shared Memory Blocks
```typescript
// Agents can share memory blocks
const sharedBlock = await createSharedBlock("market_state", {
  trend: "bullish",
  signals: [...],
});

// Multiple agents read/write same block
await agent1.attachSharedBlock(sharedBlock);
await agent2.attachSharedBlock(sharedBlock);
```

### Phase 3: Stateful Workflows (MEDIUM PRIORITY)

#### 3.1 Persistent Agent State
```typescript
interface StatefulAgent {
  id: string;
  state: AgentState;  // Persists across sessions
  memory: AgentMemory;

  // Resume from any point
  async resume(): Promise<void>;

  // Checkpoint for rollback
  async checkpoint(): Promise<string>;
  async restore(checkpointId: string): Promise<void>;
}
```

#### 3.2 Workflow Chains
```typescript
// Define multi-step workflows with persistent state
const workflow = createWorkflow("trading-analysis", [
  { agent: "data-collector", output: "market_data" },
  { agent: "pattern-analyzer", input: "market_data", output: "patterns" },
  { agent: "signal-generator", input: "patterns", output: "signals" },
  { agent: "risk-assessor", input: "signals", output: "trade_plan" },
]);

// State persists across failures - resume from any step
await workflow.run();
```

### Phase 4: Context Engineering (MEDIUM PRIORITY)

#### 4.1 Smart Context Window Management
```typescript
interface ContextManager {
  // Automatic summarization when context grows
  compress(messages: Message[], targetTokens: number): Message[];

  // Priority-based inclusion
  prioritize(items: ContextItem[]): ContextItem[];

  // Rolling window with important items pinned
  roll(newMessages: Message[], pinnedItems: string[]): Message[];
}
```

#### 4.2 Archival Memory with Vector Search
```typescript
interface ArchivalMemory {
  // Store long-term facts
  archive(content: string, metadata: Record<string, any>): void;

  // Semantic retrieval
  retrieve(query: string, k?: number): ArchivalEntry[];

  // Agent can self-archive
  tools: ["archival_insert", "archival_search"];
}
```

**Implementation**: Use local embeddings (transformers.js) + SQLite vector extension

---

## Unique Differentiators (What Letta Can't Do)

### 1. Cross-Platform Hub
Pi-mono's unified messaging across Discord/Slack/Telegram/GitHub - Letta has nothing comparable.

### 2. Trading Specialization
- MoonDev-style multi-agent trading orchestration
- Real-time market data integration
- Backtesting and risk management agents

### 3. Coding Agent Integration
- OpenHands SDK integration with 9 expert modes
- Claude Code subagent spawning
- Hook system (checkpoint, LSP, expert)

### 4. Voice Capabilities
- Microsoft TTS integration
- Local Whisper STT
- Voice channel sessions

### 5. Full MCP Ecosystem
89+ tools already integrated vs Letta's basic tool support

---

## Implementation Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Memory Blocks | HIGH | MEDIUM | **P0** |
| Conversation Search | HIGH | MEDIUM | **P0** |
| Agent-to-Agent Messaging | HIGH | LOW | **P1** |
| Shared Memory | MEDIUM | MEDIUM | **P1** |
| Stateful Workflows | MEDIUM | HIGH | **P2** |
| Context Compression | LOW | HIGH | **P3** |
| Archival + Vectors | MEDIUM | HIGH | **P2** |

---

## Competitive Positioning

### Letta's Weakness = Pi-Mono's Opportunity

1. **Vendor Lock-in**: Letta requires their cloud or complex self-hosting
   → Pi-mono: Zero dependencies, runs anywhere

2. **No Auto-Learning**: Manual skill creation
   → Pi-mono: Automatic expertise accumulation

3. **Generic Platform**: Not optimized for any domain
   → Pi-mono: Trading, coding, cross-platform messaging

4. **Text-Only Skills**: No executable resources
   → Pi-mono: Scripts, references, assets per skill

5. **Paid API**: Letta Cloud costs money
   → Pi-mono: Free, local execution

### Marketing Message

> **Pi-Mono: The Self-Learning Agent Platform**
>
> Unlike Letta's manual approach, pi-mono agents automatically learn from every interaction, persist expertise locally with zero cloud costs, and come pre-integrated with 89+ tools for trading, coding, and cross-platform communication.

---

## Quick Wins (Implement This Week)

### 1. Add Memory Block Tools
Create `memory-tools.ts` with:
- `memory_replace`
- `memory_insert`
- `memory_rethink`

### 2. Conversation Recall
Add SQLite FTS5 search to existing `log.jsonl` files

### 3. Agent Messaging
Add to cross-platform hub:
```typescript
hub.sendToAgent(agentId, message);
hub.broadcastToAgents(tags, message);
```

### 4. Shared Blocks
Extend skill-manager with shared block support

---

*Roadmap created: 2025-12-19*
*Goal: Surpass Letta within 30 days*
