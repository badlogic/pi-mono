# OpenClaw Token 使用优化分析

本文档分析 OpenClaw 中已实现的 Token 优化策略，以及可进一步改进的方向。

---

## 一、已实现的 Token 优化策略

### 1.1 自适应读取预算 (Adaptive Read Budget)

**文件**: [src/agents/pi-tools.read.ts](file:///d:/temp/openclaw/src/agents/pi-tools.read.ts)

```typescript
const DEFAULT_READ_PAGE_MAX_BYTES = 50 * 1024;
const MAX_ADAPTIVE_READ_MAX_BYTES = 512 * 1024;
const ADAPTIVE_READ_CONTEXT_SHARE = 0.2;  // 使用上下文窗口的 20%
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_ADAPTIVE_READ_PAGES = 8;

function resolveAdaptiveReadMaxBytes(options?: OpenClawReadToolOptions): number {
  const contextWindowTokens = options?.modelContextWindowTokens;
  if (typeof contextWindowTokens !== "number" || !Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    return DEFAULT_READ_PAGE_MAX_BYTES;
  }
  const fromContext = Math.floor(
    contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * ADAPTIVE_READ_CONTEXT_SHARE,
  );
  return clamp(fromContext, DEFAULT_READ_PAGE_MAX_BYTES, MAX_ADAPTIVE_READ_MAX_BYTES);
}
```

**优化点**:
- 根据模型上下文窗口动态调整读取文件的最大字节数
- 默认使用上下文窗口的 20% 作为读取预算
- 限制在 50KB ~ 512KB 范围内
- 支持分页读取，最多 8 页

---

### 1.2 工具结果上下文预算控制 (Tool Result Context Guard)

**文件**: [src/agents/pi-embedded-runner/tool-result-context-guard.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/tool-result-context-guard.ts)

```typescript
const CHARS_PER_TOKEN_ESTIMATE = 4;
const CONTEXT_INPUT_HEADROOM_RATIO = 0.75;  // 保留 25% 余量
const SINGLE_TOOL_RESULT_CONTEXT_SHARE = 0.5;  // 单个工具结果最多 50%
const TOOL_RESULT_CHARS_PER_TOKEN_ESTIMATE = 2;
const IMAGE_CHAR_ESTIMATE = 8_000;

function enforceToolResultContextBudgetInPlace(params: {
  messages: AgentMessage[];
  contextBudgetChars: number;
  maxSingleToolResultChars: number;
}): void {
  // 1. 首先限制单个工具结果的大小
  for (const message of messages) {
    if (!isToolResultMessage(message)) continue;
    const truncated = truncateToolResultToChars(message, maxSingleToolResultChars);
    applyMessageMutationInPlace(message, truncated);
  }

  // 2. 如果仍超出预算，压缩旧的工具结果
  let currentChars = estimateContextChars(messages);
  if (currentChars <= contextBudgetChars) return;
  
  compactExistingToolResultsInPlace({
    messages,
    charsNeeded: currentChars - contextBudgetChars,
  });
}
```

**优化点**:
- 保留 25% 的上下文余量，避免超出模型限制
- 单个工具结果最多占用上下文窗口的 50%
- 图片按 8000 字符估算
- 超出预算时，将旧的工具结果压缩为占位符

---

### 1.3 会话历史压缩 (Session Compaction)

**文件**: [src/agents/compaction.ts](file:///d:/temp/openclaw/src/agents/compaction.ts)

```typescript
export const BASE_CHUNK_RATIO = 0.4;
export const MIN_CHUNK_RATIO = 0.15;
export const SAFETY_MARGIN = 1.2;  // 20% 安全余量

export function pruneHistoryForContextShare(params: {
  messages: AgentMessage[];
  maxContextTokens: number;
  maxHistoryShare?: number;  // 默认 50%
  parts?: number;
}): PruneResult {
  const maxHistoryShare = params.maxHistoryShare ?? 0.5;
  const budgetTokens = Math.max(1, Math.floor(params.maxContextTokens * maxHistoryShare));
  
  // 分块处理，保留最新的消息
  while (keptMessages.length > 0 && estimateMessagesTokens(keptMessages) > budgetTokens) {
    const chunks = splitMessagesByTokenShare(keptMessages, parts);
    const [dropped, ...rest] = chunks;
    // 修复 tool_use/tool_result 配对问题
    const repairReport = repairToolUseResultPairing(flatRest);
    // ...
  }
}

export async function summarizeInStages(params: {
  messages: AgentMessage[];
  model: ExtensionContext["model"];
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  parts?: number;
}): Promise<string> {
  // 分阶段摘要，处理超大消息
  // 1. 尝试完整摘要
  // 2. 失败则部分摘要（排除超大消息）
  // 3. 最终回退：仅记录消息数量
}
```

**优化点**:
- 历史消息最多占用上下文窗口的 50%
- 20% 的安全余量应对 Token 估算误差
- 自适应分块比率（0.15 ~ 0.4）
- 超大消息（>50% 上下文窗口）特殊处理
- 修复 tool_use/tool_result 配对，避免 API 错误

---

### 1.4 图片尺寸限制 (Image Sanitization)

**文件**: [src/agents/image-sanitization.ts](file:///d:/temp/openclaw/src/agents/image-sanitization.ts)

```typescript
export const DEFAULT_IMAGE_MAX_DIMENSION_PX = 1200;
export const DEFAULT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;  // 5MB

export function resolveImageSanitizationLimits(cfg?: OpenClawConfig): ImageSanitizationLimits {
  const configured = cfg?.agents?.defaults?.imageMaxDimensionPx;
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return {};
  }
  return { maxDimensionPx: Math.max(1, Math.floor(configured)) };
}
```

**优化点**:
- 限制图片最大尺寸（默认 1200px）
- 限制图片文件大小（默认 5MB）
- 可在配置中自定义

---

### 1.5 命令输出限制 (Command Output Limits)

**文件**: [src/agents/bash-tools.exec-runtime.ts](file:///d:/temp/openclaw/src/agents/bash-tools.exec-runtime.ts)

```typescript
export const DEFAULT_MAX_OUTPUT = clampWithDefault(
  readEnvInt("PI_BASH_MAX_OUTPUT_CHARS"),
  200_000,  // 默认 200KB
  1_000,
  200_000,
);

export const DEFAULT_PENDING_MAX_OUTPUT = clampWithDefault(
  readEnvInt("OPENCLAW_BASH_PENDING_MAX_OUTPUT_CHARS"),
  30_000,  // 后台任务默认 30KB
  1_000,
  200_000,
);
```

**优化点**:
- 限制命令输出字符数（默认 20万字符）
- 后台任务单独限制（默认 3万字符）
- 支持环境变量自定义

---

### 1.6 上下文修剪 (Context Pruning)

**文件**: [src/agents/pi-extensions/context-pruning/](file:///d:/temp/openclaw/src/agents/pi-extensions/context-pruning/)

```typescript
// 基于规则的上下文修剪
export type ContextPruningConfig = {
  enabled?: boolean;
  tools?: ContextPruningToolMatch[];
  keepLastN?: number;
  maxMessages?: number;
};
```

**优化点**:
- 基于工具匹配规则修剪上下文
- 保留最近 N 条消息
- 设置最大消息数量限制

---

### 1.7 Thinking 级别控制

**文件**: 多处配置

```typescript
// src/config/types.agent-defaults.ts
export type AgentDefaultsConfig = {
  /** Default thinking level when no /think directive is present. */
  thinkingLevel?: ThinkLevel;
};

// 可选值: "off" | "low" | "medium" | "high" | "xhigh"
```

**优化点**:
- 控制模型的推理深度
- 低级别减少 Token 消耗
- 可按会话/Agent 配置

---

### 1.8 模型上下文窗口配置

**文件**: [src/config/types.models.ts](file:///d:/temp/openclaw/src/config/types.models.ts)

```typescript
export type ModelDefinitionConfig = {
  id: string;
  name: string;
  contextWindow: number;  // 上下文窗口大小
  maxTokens: number;      // 最大输出 Token
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};
```

**优化点**:
- 明确定义每个模型的上下文窗口
- 用于计算各种预算限制
- 支持成本追踪

---

## 二、可进一步改进的方向

### 2.1 智能消息摘要 (Smart Message Summarization)

**现状**: 当前使用简单的分块摘要策略

**改进建议**:
```typescript
// 1. 基于重要性的选择性摘要
interface MessageImportance {
  message: AgentMessage;
  importance: number;  // 0-1
  reasons: string[];
}

function calculateMessageImportance(msg: AgentMessage): MessageImportance {
  const factors = {
    hasToolCall: msg.content?.some(b => b.type === 'toolCall'),
    hasError: msg.content?.some(b => b.type === 'text' && b.text.includes('Error')),
    isUserRequest: msg.role === 'user',
    containsDecision: /decided|choose|select/i.test(text),
  };
  // 综合评分
}

// 2. 渐进式摘要（保留细节层次）
interface HierarchicalSummary {
  brief: string;      // 一句话总结
  detailed: string;   // 详细总结
  full: string;       // 完整内容（仅保留最近N条）
}
```

**预期收益**: 减少 30-50% 的历史消息 Token 消耗

---

### 2.2 代码块的智能处理

**现状**: 代码块按普通文本处理

**改进建议**:
```typescript
// 1. 代码去重
function deduplicateCodeBlocks(messages: AgentMessage[]): AgentMessage[] {
  // 检测重复的代码块（如多次读取同一文件）
  // 只保留最新版本
}

// 2. 代码差异存储
interface CodeBlockStorage {
  original: string;
  patches: Patch[];  // 只存储变更
}

// 3. 代码语义摘要
function summarizeCodeChanges(code: string): string {
  // 提取函数签名、类定义等关键信息
  // 而非保留完整代码
}
```

**预期收益**: 代码相关会话减少 40-60% Token

---

### 2.3 工具结果的渐进式详细程度

**现状**: 工具结果要么完整保留，要么完全压缩

**改进建议**:
```typescript
interface ProgressiveToolResult {
  summary: string;      // 始终保留
  details?: string;     // 按需加载
  fullOutput?: string;  // 需要时通过工具重新获取
}

// 基于查询意图决定详细程度
function resolveDetailLevel(query: string, toolResult: ToolResult): DetailLevel {
  if (isFollowUpQuestion(query, toolResult)) {
    return 'detailed';
  }
  if (isGeneralQuestion(query)) {
    return 'summary';
  }
  return 'normal';
}
```

**预期收益**: 工具结果 Token 减少 50-70%

---

### 2.4 上下文缓存预热

**现状**: 每次请求都重新构建上下文

**改进建议**:
```typescript
interface ContextCache {
  // 1. 系统提示词缓存
  systemPromptHash: string;
  systemPromptTokens: number;
  
  // 2. 技能文档缓存
  skillDocsHash: string;
  skillDocsTokens: number;
  
  // 3. 会话摘要缓存
  sessionSummary: string;
  summaryTokens: number;
}

// 使用模型原生缓存（如 Claude 的 prompt caching）
function buildCachedContext(session: Session): CachedContext {
  return {
    system: { content: systemPrompt, cache_control: { type: 'ephemeral' } },
    skills: { content: skills, cache_control: { type: 'ephemeral' } },
    recent: recentMessages,  // 不缓存
  };
}
```

**预期收益**: 长会话减少 50-80% 输入 Token 成本

---

### 2.5 动态上下文分配

**现状**: 固定比例分配（历史 50%，工具 50%）

**改进建议**:
```typescript
interface DynamicContextAllocation {
  // 基于会话阶段调整
  phase: 'exploration' | 'implementation' | 'review';
  
  // 探索阶段：更多历史上下文
  exploration: { history: 0.7, tools: 0.3 },
  
  // 实现阶段：更多工具结果
  implementation: { history: 0.4, tools: 0.6 },
  
  // 审查阶段：平衡分配
  review: { history: 0.5, tools: 0.5 },
}

// 基于当前任务动态调整
function allocateContextBudget(session: Session): Allocation {
  const recentTools = session.recentMessages.filter(m => m.role === 'toolResult');
  if (recentTools.length > 5) {
    return { history: 0.4, tools: 0.6 };  // 工具密集型
  }
  if (session.messageCount < 10) {
    return { history: 0.8, tools: 0.2 };  // 早期会话
  }
  return { history: 0.5, tools: 0.5 };    // 默认
}
```

**预期收益**: 提升 20-30% 上下文利用效率

---

### 2.6 文件内容的增量追踪

**现状**: 每次读取都返回完整文件内容

**改进建议**:
```typescript
interface FileVersionTracker {
  path: string;
  versions: Map<hash, FileVersion>;
  
  getDiff(fromHash: string, toHash: string): Diff;
  getSnapshot(hash: string): string;
}

// 在上下文中只存储变更
interface IncrementalFileReference {
  path: string;
  baseVersion: string;
  changes: Edit[];
  currentSnapshot?: string;  // 仅当需要时加载
}
```

**预期收益**: 文件编辑类会话减少 60-80% Token

---

### 2.7 语义搜索替代完整历史

**现状**: 保留完整历史或简单截断

**改进建议**:
```typescript
interface SemanticHistory {
  // 构建向量索引
  index: VectorIndex<MessageEmbedding>;
  
  // 基于当前查询检索相关历史
  async function retrieveRelevantHistory(
    query: string,
    session: Session,
    topK: number = 5
  ): Promise<AgentMessage[]> {
    const queryEmbedding = await embed(query);
    return index.search(queryEmbedding, topK);
  }
}

// 结合摘要和语义检索
function buildOptimizedContext(session: Session, query: string): Context {
  const recent = session.getRecentMessages(5);  // 始终保留最近5条
  const relevant = retrieveRelevantHistory(query, session, 5);
  const summary = getSessionSummary(session);
  
  return { summary, recent, relevant };
}
```

**预期收益**: 长会话减少 70-90% 历史 Token

---

### 2.8 工具调用链的压缩

**现状**: 每个工具调用和结果都单独存储

**改进建议**:
```typescript
// 检测并压缩工具调用链
interface ToolChain {
  tools: string[];  // ['read', 'read', 'read', 'write']
  pattern: 'explore-then-modify' | 'retry-loop' | 'batch-operation';
  summary: string;
}

function detectToolChains(messages: AgentMessage[]): CompressedChain[] {
  // 识别常见的工具调用模式
  // 如：多次读取后一次写入
  // 如：重试循环
  // 如：批量操作
  
  return chains.map(chain => ({
    originalMessages: chain.messages.length,
    compressed: chain.summary,
    savings: estimateTokens(chain.messages) - estimateTokens(chain.summary),
  }));
}
```

**预期收益**: 复杂工具链减少 50-70% Token

---

## 三、优化策略对比表

| 优化策略 | 实现复杂度 | 预期收益 | 当前状态 |
|----------|-----------|----------|----------|
| 自适应读取预算 | 低 | 20-30% | 已实现 |
| 工具结果预算控制 | 中 | 30-40% | 已实现 |
| 会话历史压缩 | 高 | 40-60% | 已实现 |
| 图片尺寸限制 | 低 | 10-20% | 已实现 |
| 命令输出限制 | 低 | 20-30% | 已实现 |
| 上下文修剪 | 中 | 20-30% | 已实现 |
| Thinking 级别 | 低 | 10-50% | 已实现 |
| 智能消息摘要 | 高 | 30-50% | 待改进 |
| 代码块智能处理 | 高 | 40-60% | 待改进 |
| 渐进式工具结果 | 中 | 50-70% | 待改进 |
| 上下文缓存预热 | 中 | 50-80% | 待改进 |
| 动态上下文分配 | 中 | 20-30% | 待改进 |
| 文件增量追踪 | 高 | 60-80% | 待改进 |
| 语义搜索历史 | 高 | 70-90% | 待改进 |
| 工具链压缩 | 高 | 50-70% | 待改进 |

---

## 四、实施建议

### 短期（1-2 周）
1. **优化现有压缩算法参数**
   - 调整 `SAFETY_MARGIN` 基于实际使用情况
   - 优化 `BASE_CHUNK_RATIO` 和 `MIN_CHUNK_RATIO`

2. **增强可观测性**
   - 添加 Token 使用指标收集
   - 监控压缩效果和成本节省

### 中期（1-2 月）
1. **实现代码块智能处理**
   - 代码去重和差异存储
   - 代码语义摘要

2. **渐进式工具结果**
   - 实现三级详细程度
   - 基于查询意图动态调整

### 长期（3-6 月）
1. **语义搜索历史**
   - 构建向量索引
   - 实现相关历史检索

2. **文件增量追踪**
   - 版本控制系统集成
   - 增量差异存储

---

## 五、参考文件

- [src/agents/pi-tools.read.ts](file:///d:/temp/openclaw/src/agents/pi-tools.read.ts) - 自适应读取预算
- [src/agents/pi-embedded-runner/tool-result-context-guard.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/tool-result-context-guard.ts) - 工具结果预算控制
- [src/agents/compaction.ts](file:///d:/temp/openclaw/src/agents/compaction.ts) - 会话历史压缩
- [src/agents/image-sanitization.ts](file:///d:/temp/openclaw/src/agents/image-sanitization.ts) - 图片尺寸限制
- [src/agents/bash-tools.exec-runtime.ts](file:///d:/temp/openclaw/src/agents/bash-tools.exec-runtime.ts) - 命令输出限制
- [src/agents/pi-extensions/context-pruning/](file:///d:/temp/openclaw/src/agents/pi-extensions/context-pruning/) - 上下文修剪
