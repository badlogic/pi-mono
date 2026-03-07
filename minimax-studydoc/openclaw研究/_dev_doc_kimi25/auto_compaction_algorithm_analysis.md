# OpenClaw 自动压缩算法深度分析

> 详细解析 OpenClaw 中 Session 自动压缩机制的实现原理、触发策略和优化算法

---

## 一、架构概述

### 1.1 为什么需要自动压缩

OpenClaw 作为长期运行的 AI Agent 系统，面临以下挑战：

```
上下文窗口限制挑战：
├── 模型上下文窗口有限（4K-1M tokens 不等）
├── 长会话历史累积导致超出窗口
├── 工具调用结果可能非常庞大
├── 多轮对话后 token 消耗剧增
└── 需要平衡历史完整性与上下文限制
```

### 1.2 压缩机制架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                      自动压缩架构                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐      ┌──────────────────┐                    │
│  │   触发层          │      │   执行层          │                    │
│  │  (Trigger Layer) │─────▶│ (Execution Layer)│                    │
│  └──────────────────┘      └──────────────────┘                    │
│         │                           │                               │
│         ▼                           ▼                               │
│  ┌──────────────────────────────────────────────┐                  │
│  │              压缩策略层                        │                  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │                  │
│  │  │ 分块    │ │ 摘要    │ │ 剪枝    │        │                  │
│  │  │ Chunk   │ │Summary │ │ Prune   │        │                  │
│  │  └─────────┘ └─────────┘ └─────────┘        │                  │
│  └──────────────────────────────────────────────┘                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      持久化层                                │   │
│  │  sessions.json  │  <sessionId>.jsonl  │  compaction entry  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心实现文件

| 文件 | 职责 |
|------|------|
| [compaction.ts](file:///d:/temp/openclaw/src/agents/compaction.ts) | 压缩算法核心（分块、摘要、剪枝） |
| [compact.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/compact.ts) | 嵌入式 Pi 会话压缩执行器 |
| [compaction-safeguard.ts](file:///d:/temp/openclaw/src/agents/pi-extensions/compaction-safeguard.ts) | 压缩保护扩展（工具失败记录、文件操作追踪） |
| [session-management-compaction.md](file:///d:/temp/openclaw/docs/reference/session-management-compaction.md) | 官方文档 |

---

## 三、触发机制

### 3.1 两种触发场景

根据官方文档和代码分析，自动压缩在以下两种情况下触发：

```
触发场景：
├── 1. 溢出恢复 (Overflow Recovery)
│   ├── 模型返回上下文溢出错误
│   ├── 立即执行压缩
│   └── 重试请求
│
└── 2. 阈值维护 (Threshold Maintenance)
    ├── 成功完成一轮对话后
    ├── 检查：contextTokens > contextWindow - reserveTokens
    └── 如果超过阈值，触发压缩
```

### 3.2 阈值计算公式

```typescript
// 来自 session-management-compaction.md
contextTokens > contextWindow - reserveTokens

// 参数说明：
// - contextTokens: 当前上下文 token 数量（运行时估算）
// - contextWindow: 模型上下文窗口大小
// - reserveTokens: 预留 token（用于 prompt 和模型输出）
```

### 3.3 配置参数

```json5
// Pi 压缩设置
{
  compaction: {
    enabled: true,
    reserveTokens: 16384,     // 预留 16K tokens
    keepRecentTokens: 20000,  // 保留最近 20K tokens 的消息
  }
}

// OpenClaw 安全下限
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,  // 默认 20K，可设为 0 禁用
      }
    }
  }
}
```

### 3.4 溢出恢复的重试机制

```typescript
// 来自 pi-embedded-runner/run.ts
const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;  // 最大重试 3 次

let overflowCompactionAttempts = 0;

// 当收到上下文溢出错误时
if (isContextOverflowError(error)) {
  if (overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {
    overflowCompactionAttempts++;
    // 执行压缩
    await compactEmbeddedPiSessionDirect(params);
    // 重试请求
    continue;
  }
}
```

---

## 四、压缩算法核心

### 4.1 算法流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                     压缩算法流程                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 估算 Token                                                  │
│     └── estimateMessagesTokens(messages)                        │
│                                                                 │
│  2. 检查是否需要分块                                             │
│     └── totalTokens > maxChunkTokens?                           │
│                                                                 │
│  3. 分块策略 (二选一)                                            │
│     ├── 按 Token 比例分块: splitMessagesByTokenShare()         │
│     └── 按最大 Token 分块: chunkMessagesByMaxTokens()          │
│                                                                 │
│  4. 逐块生成摘要                                                 │
│     └── summarizeChunks() → generateSummary()                  │
│                                                                 │
│  5. 合并摘要 (如果分多块)                                        │
│     └── summarizeInStages() → 递归合并                         │
│                                                                 │
│  6. 剪枝历史 (可选)                                              │
│     └── pruneHistoryForContextShare()                          │
│                                                                 │
│  7. 持久化                                                       │
│     └── 写入 compaction entry 到 jsonl                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Token 估算

```typescript
// compaction.ts
export function estimateMessagesTokens(messages: AgentMessage[]): number {
  // SECURITY: toolResult.details 可能包含不受信任的大负载
  // 在压缩前剥离，避免计入 token 估算
  const safe = stripToolResultDetails(messages);
  return safe.reduce((sum, message) => sum + estimateTokens(message), 0);
}
```

**安全考虑**：工具结果详情（如文件内容、命令输出）可能非常大，在估算时剥离，避免：
1. 不准确的 token 估算
2. 敏感信息进入摘要

### 4.3 自适应分块比例

```typescript
export const BASE_CHUNK_RATIO = 0.4;   // 基础比例：40% 上下文窗口
export const MIN_CHUNK_RATIO = 0.15;   // 最小比例：15% 上下文窗口
export const SAFETY_MARGIN = 1.2;      // 20% 安全余量

export function computeAdaptiveChunkRatio(
  messages: AgentMessage[], 
  contextWindow: number
): number {
  if (messages.length === 0) return BASE_CHUNK_RATIO;

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;
  
  // 应用安全余量
  const safeAvgTokens = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  // 如果平均消息 > 10% 上下文，降低分块比例
  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}
```

**自适应逻辑**：
- 消息较大时 → 使用更小的分块比例（避免单块超限）
- 消息较小时 → 使用基础比例（40%）

### 4.4 按 Token 比例分块

```typescript
export function splitMessagesByTokenShare(
  messages: AgentMessage[],
  parts = 2,  // 默认分成 2 份
): AgentMessage[][] {
  if (messages.length === 0) return [];
  
  const normalizedParts = normalizeParts(parts, messages.length);
  if (normalizedParts <= 1) return [messages];

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = totalTokens / normalizedParts;
  
  const chunks: AgentMessage[][] = [];
  let current: AgentMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateTokens(message);
    
    // 如果当前块已满足目标大小，且不是最后一块，开启新块
    if (chunks.length < normalizedParts - 1 &&
        current.length > 0 &&
        currentTokens + messageTokens > targetTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(message);
    currentTokens += messageTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
```

### 4.5 按最大 Token 分块

```typescript
export function chunkMessagesByMaxTokens(
  messages: AgentMessage[],
  maxTokens: number,
): AgentMessage[][] {
  const chunks: AgentMessage[][] = [];
  let currentChunk: AgentMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateTokens(message);
    
    // 如果当前块已满，开启新块
    if (currentChunk.length > 0 && 
        currentTokens + messageTokens > maxTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(message);
    currentTokens += messageTokens;

    // 如果单条消息就超过限制，单独成块
    if (messageTokens > maxTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
```

---

## 五、摘要生成

### 5.1 分阶段摘要

```typescript
export async function summarizeInStages(params: {
  messages: AgentMessage[];
  model: Model;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  previousSummary?: string;
  parts?: number;           // 分块数
  minMessagesForSplit?: number;  // 最小分块消息数
}): Promise<string> {
  const { messages } = params;
  if (messages.length === 0) {
    return params.previousSummary ?? "No prior history.";
  }

  const minMessagesForSplit = Math.max(2, params.minMessagesForSplit ?? 4);
  const parts = normalizeParts(params.parts ?? 2, messages.length);
  const totalTokens = estimateMessagesTokens(messages);

  // 如果消息太少或总 token 在限制内，直接摘要
  if (parts <= 1 || 
      messages.length < minMessagesForSplit || 
      totalTokens <= params.maxChunkTokens) {
    return summarizeWithFallback(params);
  }

  // 分块并行摘要
  const splits = splitMessagesByTokenShare(messages, parts)
    .filter(chunk => chunk.length > 0);
  
  if (splits.length <= 1) {
    return summarizeWithFallback(params);
  }

  // 并行生成部分摘要
  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(
      await summarizeWithFallback({
        ...params,
        messages: chunk,
        previousSummary: undefined,
      })
    );
  }

  // 合并部分摘要
  const summaryMessages: AgentMessage[] = partialSummaries.map(summary => ({
    role: "user",
    content: summary,
    timestamp: Date.now(),
  }));

  const mergeInstructions = 
    "Merge these partial summaries into a single cohesive summary. " +
    "Preserve decisions, TODOs, open questions, and any constraints." +
    (params.customInstructions ? `\n\nAdditional focus:\n${params.customInstructions}` : "");

  // 递归合并
  return summarizeWithFallback({
    ...params,
    messages: summaryMessages,
    customInstructions: mergeInstructions,
  });
}
```

### 5.2 带降级策略的摘要

```typescript
export async function summarizeWithFallback(params: {
  messages: AgentMessage[];
  model: Model;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  previousSummary?: string;
}): Promise<string> {
  // 尝试 1: 完整摘要
  try {
    return await summarizeChunks(params);
  } catch (fullError) {
    console.warn(`Full summarization failed, trying partial: ${fullError}`);
  }

  // 尝试 2: 仅摘要小消息，标记超大消息
  const smallMessages: AgentMessage[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of messages) {
    if (isOversizedForSummary(msg, params.contextWindow)) {
      const role = (msg as { role?: string }).role ?? "message";
      const tokens = estimateTokens(msg);
      oversizedNotes.push(
        `[Large ${role} (~${Math.round(tokens / 1000)}K tokens) omitted from summary]`
      );
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partialSummary = await summarizeChunks({
        ...params,
        messages: smallMessages,
      });
      const notes = oversizedNotes.length > 0 ? 
        `\n\n${oversizedNotes.join("\n")}` : "";
      return partialSummary + notes;
    } catch (partialError) {
      console.warn(`Partial summarization also failed: ${partialError}`);
    }
  }

  // 最终降级: 仅记录消息数量
  return (
    `Context contained ${messages.length} messages ` +
    `(${oversizedNotes.length} oversized). ` +
    `Summary unavailable due to size limits.`
  );
}
```

### 5.3 超大消息检测

```typescript
export function isOversizedForSummary(
  msg: AgentMessage, 
  contextWindow: number
): boolean {
  const tokens = estimateTokens(msg) * SAFETY_MARGIN;
  // 如果单条消息 > 50% 上下文窗口，认为无法安全摘要
  return tokens > contextWindow * 0.5;
}
```

---

## 六、历史剪枝

### 6.1 上下文份额剪枝

```typescript
export function pruneHistoryForContextShare(params: {
  messages: AgentMessage[];
  maxContextTokens: number;
  maxHistoryShare?: number;  // 默认 50%
  parts?: number;
}): {
  messages: AgentMessage[];           // 保留的消息
  droppedMessagesList: AgentMessage[]; // 被删除的消息
  droppedChunks: number;
  droppedMessages: number;
  droppedTokens: number;
  keptTokens: number;
  budgetTokens: number;
} {
  const maxHistoryShare = params.maxHistoryShare ?? 0.5;
  // 计算历史预算
  const budgetTokens = Math.floor(params.maxContextTokens * maxHistoryShare);
  
  let keptMessages = params.messages;
  const allDroppedMessages: AgentMessage[] = [];
  let droppedChunks = 0;
  let droppedMessages = 0;
  let droppedTokens = 0;

  // 循环删除旧块直到符合预算
  while (keptMessages.length > 0 && 
         estimateMessagesTokens(keptMessages) > budgetTokens) {
    const chunks = splitMessagesByTokenShare(keptMessages, parts);
    if (chunks.length <= 1) break;

    // 删除最旧的一块
    const [dropped, ...rest] = chunks;
    const flatRest = rest.flat();

    // 修复 tool_use/tool_result 配对
    // 防止删除 tool_use 后留下孤立的 tool_result
    const repairReport = repairToolUseResultPairing(flatRest);
    const repairedKept = repairReport.messages;
    const orphanedCount = repairReport.droppedOrphanCount;

    droppedChunks += 1;
    droppedMessages += dropped.length + orphanedCount;
    droppedTokens += estimateMessagesTokens(dropped);
    allDroppedMessages.push(...dropped);
    keptMessages = repairedKept;
  }

  return {
    messages: keptMessages,
    droppedMessagesList: allDroppedMessages,
    droppedChunks,
    droppedMessages,
    droppedTokens,
    keptTokens: estimateMessagesTokens(keptMessages),
    budgetTokens,
  };
}
```

### 6.2 工具调用配对修复

```typescript
// 删除旧消息时，可能导致 tool_use 被删除但 tool_result 保留
// 这会违反 Anthropic API 的规则（tool_result 必须有对应的 tool_use）

export function repairToolUseResultPairing(messages: AgentMessage[]): {
  messages: AgentMessage[];
  droppedOrphanCount: number;
} {
  const toolUseIds = new Set<string>();
  const result: AgentMessage[] = [];
  let droppedOrphanCount = 0;

  // 第一遍：收集所有 tool_use ID
  for (const msg of messages) {
    if (msg.role === "toolUse") {
      toolUseIds.add(msg.toolCallId);
    }
  }

  // 第二遍：过滤孤立的 tool_result
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      if (!toolUseIds.has(msg.toolCallId)) {
        // 孤立的 tool_result，删除
        droppedOrphanCount++;
        continue;
      }
    }
    result.push(msg);
  }

  return { messages: result, droppedOrphanCount };
}
```

---

## 七、压缩保护扩展 (Compaction Safeguard)

### 7.1 功能概述

```
压缩保护扩展职责：
├── 追踪工具失败记录
├── 记录文件操作（读/写）
├── 在摘要中保留关键上下文
├── 处理分轮次 (Split Turn) 场景
└── 注入工作区关键规则
```

### 7.2 工具失败收集

```typescript
const MAX_TOOL_FAILURES = 8;           // 最多记录 8 个失败
const MAX_TOOL_FAILURE_CHARS = 240;    // 每个失败最多 240 字符

type ToolFailure = {
  toolCallId: string;
  toolName: string;
  summary: string;
  meta?: string;  // 如 exitCode, status
};

function collectToolFailures(messages: AgentMessage[]): ToolFailure[] {
  const failures: ToolFailure[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    if (message.isError !== true) continue;

    const toolCallId = message.toolCallId;
    if (!toolCallId || seen.has(toolCallId)) continue;
    seen.add(toolCallId);

    const toolName = message.toolName || "tool";
    const rawText = extractToolResultText(message.content);
    const meta = formatToolFailureMeta(message.details);
    
    failures.push({
      toolCallId,
      toolName,
      summary: truncateFailureText(rawText || "failed", MAX_TOOL_FAILURE_CHARS),
      meta,
    });
  }

  return failures;
}
```

### 7.3 文件操作追踪

```typescript
function computeFileLists(fileOps: FileOperations): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readFiles = [...fileOps.read]
    .filter(f => !modified.has(f))
    .toSorted();
  const modifiedFiles = [...modified].toSorted();
  return { readFiles, modifiedFiles };
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  return sections.join("\n\n");
}
```

### 7.4 工作区关键规则注入

```typescript
async function readWorkspaceContextForSummary(): Promise<string> {
  const MAX_SUMMARY_CONTEXT_CHARS = 2000;
  const agentsPath = path.join(process.cwd(), "AGENTS.md");

  try {
    if (!fs.existsSync(agentsPath)) return "";

    const content = await fs.promises.readFile(agentsPath, "utf-8");
    // 提取 "Session Startup" 和 "Red Lines" 部分
    const sections = extractSections(content, ["Session Startup", "Red Lines"]);

    if (sections.length === 0) return "";

    const combined = sections.join("\n\n");
    const safeContent = combined.length > MAX_SUMMARY_CONTEXT_CHARS
      ? combined.slice(0, MAX_SUMMARY_CONTEXT_CHARS) + "\n...[truncated]..."
      : combined;

    return `\n\n<workspace-critical-rules>\n${safeContent}\n</workspace-critical-rules>`;
  } catch {
    return "";
  }
}
```

---

## 八、预压缩内存刷新 (Pre-Compaction Memory Flush)

### 8.1 机制概述

在自动压缩发生前，OpenClaw 会执行一个"静默"的 Agent 轮次，将关键状态写入磁盘：

```
预压缩刷新流程：
1. 监控会话上下文使用率
2. 当超过"软阈值"（低于 Pi 的压缩阈值）时
3. 运行一个静默的"立即写入记忆"指令
4. 使用 NO_REPLY 标记，用户无感知
```

### 8.2 配置

```json5
{
  agents: {
    defaults: {
      compaction: {
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,  // 软阈值
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store.",
        }
      }
    }
  }
}
```

### 8.3 执行条件

- 每个压缩周期只执行一次（在 sessions.json 中追踪）
- 仅对嵌入式 Pi 会话执行
- 工作区只读时跳过
- 使用 `NO_REPLY` 标记抑制输出

---

## 九、持久化格式

### 9.1 Transcript 结构

```jsonl
// <sessionId>.jsonl
{"type":"session","id":"sess-abc123","cwd":"/workspace","timestamp":1705312800000}
{"type":"message","id":"msg-1","role":"user","content":"Hello","timestamp":1705312801000}
{"type":"message","id":"msg-2","role":"assistant","content":"Hi there!","parentId":"msg-1","timestamp":1705312802000}
{"type":"compaction","id":"compact-1","firstKeptEntryId":"msg-10","tokensBefore":15000,"summary":"Previous conversation summarized...","timestamp":1705312900000}
{"type":"message","id":"msg-20","role":"user","content":"What's next?","timestamp":1705313000000}
```

### 9.2 Compaction Entry 结构

```typescript
type CompactionEntry = {
  type: "compaction";
  id: string;
  firstKeptEntryId: string;    // 保留的第一条消息 ID
  tokensBefore: number;        // 压缩前 token 数
  summary: string;             // 摘要内容
  timestamp: number;
  details?: {                  // 可选详情
    readFiles?: string[];
    modifiedFiles?: string[];
  };
};
```

---

## 十、性能与优化

### 10.1 算法复杂度

| 操作 | 复杂度 | 说明 |
|------|--------|------|
| Token 估算 | O(n) | n = 消息数量 |
| 分块 | O(n) | 单次遍历 |
| 摘要生成 | O(n/m) | m = 每块平均消息数，需 LLM 调用 |
| 合并摘要 | O(log_p(n)) | p = 分块数，递归合并 |

### 10.2 优化策略

```
优化策略：
├── 1. 自适应分块比例
│   └── 根据消息大小动态调整
│
├── 2. 并行摘要
│   └── 多块之间并行生成摘要
│
├── 3. 安全剥离
│   └── 压缩前剥离 toolResult.details
│
├── 4. 重试机制
│   └── 3 次指数退避重试
│
├── 5. 降级策略
│   └── 完整 → 部分 → 仅记录数量
│
└── 6. 缓存
    └── Session Store 45 秒 TTL 缓存
```

---

## 十一、监控与诊断

### 11.1 诊断 ID

```typescript
function createCompactionDiagId(): string {
  return `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 日志示例：
// [compaction-diag] end runId=run-123 sessionKey=agent:main:telegram:direct:u456 
// diagId=cmp-abc123 trigger=overflow provider=anthropic/claude-3-opus 
// attempt=1 maxAttempts=3 outcome=success durationMs=2450
```

### 11.2 用户可见表面

```
/status          - 显示压缩次数和 token 使用情况
openclaw status  - CLI 查看会话状态
verbose 模式     - 显示 "🧹 Auto-compaction complete"
```

---

## 十二、总结

### 12.1 核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **触发时机** | 溢出恢复 + 阈值维护 | 兼顾紧急和预防 |
| **分块策略** | 自适应比例 | 平衡块大小和数量 |
| **摘要算法** | 分阶段 + 降级 | 可靠性优先 |
| **历史剪枝** | 最旧优先 | 保留最近上下文 |
| **持久化** | JSONL + Compaction Entry | 可追踪、可恢复 |

### 12.2 关键代码路径

```
触发: pi-embedded-runner/run.ts
  ↓
执行: pi-embedded-runner/compact.ts
  ↓
算法: agents/compaction.ts
  ↓
保护: agents/pi-extensions/compaction-safeguard.ts
  ↓
持久化: SessionManager (pi-coding-agent SDK)
```

### 12.3 最佳实践

1. **合理设置 reserveTokens**：根据模型和用例调整
2. **监控压缩频率**：频繁压缩可能意味着上下文窗口太小
3. **利用预压缩刷新**：确保关键状态在压缩前持久化
4. **检查工具结果大小**：过大的工具结果会加速上下文耗尽

---

## 参考文档

- [compaction.ts](file:///d:/temp/openclaw/src/agents/compaction.ts)
- [compact.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/compact.ts)
- [compaction-safeguard.ts](file:///d:/temp/openclaw/src/agents/pi-extensions/compaction-safeguard.ts)
- [session-management-compaction.md](file:///d:/temp/openclaw/docs/reference/session-management-compaction.md)
- [pi-embedded-runner/run.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/run.ts)
