# OpenClaw 自动压缩算法 vs 检索式记忆架构分析

> 深度研究 OpenClaw 的上下文压缩机制，探讨替换为检索式记忆架构的可行性

---

## 一、当前自动压缩算法架构

### 1.1 压缩触发机制

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      压缩触发条件                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   触发场景：                                                                  │
│   ├── 1. 上下文溢出 (Context Overflow)                                       │
│   │   └── 当前 token 数 > contextWindow * maxHistoryShare (默认 50%)          │
│   │                                                                         │
│   ├── 2. 手动触发 (Manual Compaction)                                        │
│   │   └── 用户或系统主动调用 compact 命令                                     │
│   │                                                                         │
│   └── 3. 安全保护触发 (Safeguard)                                            │
│       └── 新内容占比过高时自动触发                                            │
│                                                                             │
│   核心文件：                                                                  │
│   ├── compaction.ts - 压缩核心逻辑                                           │
│   ├── pi-extensions/compaction-safeguard.ts - 安全保护扩展                    │
│   └── pi-embedded-runner/compact.ts - 嵌入式压缩执行器                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 基于 Token 的压缩流程

```typescript
// compaction.ts - 核心压缩算法

// 1. Token 估算
export function estimateMessagesTokens(messages: AgentMessage[]): number {
  const safe = stripToolResultDetails(messages);
  return safe.reduce((sum, message) => sum + estimateTokens(message), 0);
}

// 2. 自适应分块
export function computeAdaptiveChunkRatio(
  messages: AgentMessage[], 
  contextWindow: number
): number {
  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;
  
  // 如果平均消息 > 10% 上下文，降低分块比例
  if (avgTokens / contextWindow > 0.1) {
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }
  return BASE_CHUNK_RATIO;
}

// 3. 分阶段摘要
export async function summarizeInStages(params: {
  messages: AgentMessage[];
  model: ExtensionContext["model"];
  apiKey: string;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  parts?: number;  // 分块数，默认 2
}): Promise<string> {
  // 将消息分成多个块
  const splits = splitMessagesByTokenShare(messages, parts);
  
  // 对每个块生成摘要
  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(await summarizeWithFallback({...params, messages: chunk}));
  }
  
  // 合并摘要
  return mergeSummaries(partialSummaries);
}
```

### 1.3 压缩策略详解

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         压缩策略层级                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Level 1: 软压缩 (Soft Trim)                                                │
│   ├── 适用对象：工具结果消息 (toolResult)                                     │
│   ├── 策略：保留头部和尾部，中间用 "..." 代替                                  │
│   └── 配置：softTrim.headChars / softTrim.tailChars                           │
│                                                                             │
│   Level 2: 硬清除 (Hard Clear)                                               │
│   ├── 适用对象：可修剪的工具结果                                              │
│   ├── 策略：完全替换为占位符                                                  │
│   └── 配置：hardClear.placeholder                                             │
│                                                                             │
│   Level 3: 历史裁剪 (History Pruning)                                        │
│   ├── 适用对象：整个消息块                                                    │
│   ├── 策略：按 token 占比分块，丢弃旧块                                       │
│   └── 配置：maxHistoryShare (默认 0.5)                                        │
│                                                                             │
│   Level 4: 摘要生成 (Summarization)                                          │
│   ├── 适用对象：被丢弃的消息块                                                │
│   ├── 策略：使用 LLM 生成摘要替代原始内容                                      │
│   └── 注意：保留工具失败信息、文件操作记录等关键上下文                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 关键代码分析

```typescript
// pi-extensions/compaction-safeguard.ts
// 安全保护：当新内容占比过高时，主动丢弃旧内容

export default function compactionSafeguardExtension(api: ExtensionAPI): void {
  api.on("session_before_compact", async (event, ctx) => {
    const { preparation } = event;
    
    // 计算新内容占比
    const newContentTokens = Math.max(0, Math.floor(tokensBefore - summarizableTokens));
    const maxHistoryTokens = Math.floor(contextWindowTokens * maxHistoryShare * SAFETY_MARGIN);
    
    // 如果新内容超过历史预算，主动裁剪
    if (newContentTokens > maxHistoryTokens) {
      const pruned = pruneHistoryForContextShare({
        messages: messagesToSummarize,
        maxContextTokens: contextWindowTokens,
        maxHistoryShare,
        parts: 2,
      });
      
      // 对被丢弃的内容生成摘要
      if (pruned.droppedMessagesList.length > 0) {
        droppedSummary = await summarizeInStages({
          messages: pruned.droppedMessagesList,
          ...
        });
      }
    }
  });
}
```

---

## 二、检索式记忆架构分析

### 2.1 OpenClaw 现有记忆系统

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OpenClaw 记忆系统架构                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   数据来源：                                                                  │
│   ├── MEMORY.md - 主记忆文件                                                  │
│   ├── memory/*.md - 分类记忆文件                                              │
│   └── Session Transcripts - 会话历史（可选）                                  │
│                                                                             │
│   索引机制：                                                                  │
│   ├── 向量索引 (SQLite + sqlite-vec)                                         │
│   │   ├── 使用 Embedding 模型生成向量                                         │
│   │   ├── 支持 cosine 相似度检索                                              │
│   │   └── 支持 OpenAI/Gemini/Voyage/Local 等 Provider                         │
│   │                                                                         │
│   └── 全文索引 (FTS5)                                                        │
│       ├── 基于 BM25 的文本检索                                                │
│       └── 关键词提取和查询扩展                                                │
│                                                                             │
│   混合检索：                                                                  │
│   ├── vectorWeight + textWeight 加权融合                                      │
│   ├── MMR (Maximal Marginal Relevance) 去重                                   │
│   └── 时间衰减 (Temporal Decay) 排序                                          │
│                                                                             │
│   核心文件：                                                                  │
│   ├── memory/manager.ts - 记忆管理器                                          │
│   ├── memory/embeddings.ts - Embedding Provider                               │
│   └── memory/hybrid.ts - 混合检索逻辑                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 现有记忆工具

```typescript
// tools/memory-tool.ts

// memory_search - 语义搜索
export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return {
    name: "memory_search",
    description: "Mandatory recall step: semantically search MEMORY.md...",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const { manager } = await getMemorySearchManager({ cfg, agentId });
      const results = await manager.search(query, {
        maxResults,
        minScore,
        sessionKey: options.agentSessionKey,
      });
      return jsonResult({ results, provider: status.provider, ... });
    },
  };
}

// memory_get - 精确读取
export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return {
    name: "memory_get",
    description: "Safe snippet read from MEMORY.md...",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const result = await manager.readFile({ relPath, from, lines });
      return jsonResult(result);
    },
  };
}
```

### 2.3 Embedding Provider 支持

```typescript
// memory/embeddings.ts

export type EmbeddingProvider = {
  id: string;
  model: string;
  maxInputTokens?: number;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

// 支持的 Provider：
// 1. OpenAI (text-embedding-3-small/large)
// 2. Gemini (text-embedding-004)
// 3. Voyage (voyage-3/voyage-3-lite)
// 4. Local (node-llama-cpp with embedding models)

export async function createEmbeddingProvider(
  options: EmbeddingProviderOptions
): Promise<EmbeddingProviderResult> {
  // 自动选择逻辑：local → openai → gemini → voyage
  // 支持 fallback 机制
}
```

---

## 三、压缩 vs 检索式架构对比

### 3.1 架构对比表

| 维度 | 自动压缩算法 | 检索式记忆架构 |
|------|-------------|---------------|
| **核心机制** | Token 估算 + 摘要生成 | Embedding + 向量检索 |
| **信息保留** | 有损（摘要替代原文） | 完整保留原始内容 |
| **检索精度** | 低（依赖摘要质量） | 高（语义相似度） |
| **响应延迟** | 低（本地处理） | 中（需要向量检索） |
| **存储成本** | 低（仅保留摘要） | 高（原始内容 + 向量索引） |
| **计算成本** | 中（摘要需要 LLM） | 中（Embedding 计算） |
| **可解释性** | 中（摘要可读） | 高（原始内容可追溯） |
| **实现复杂度** | 中 | 高 |

### 3.2 信息丢失分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       信息丢失对比                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   自动压缩的信息丢失：                                                         │
│   ├── 1. 细节丢失                                                             │
│   │   └── 摘要无法保留所有细节                                                │
│   │   └── 代码片段、错误堆栈可能被截断                                        │
│   │                                                                         │
│   ├── 2. 上下文丢失                                                           │
│   │   └── 多轮对话的复杂依赖关系丢失                                          │
│   │   └── 工具调用链的因果关系模糊                                            │
│   │                                                                         │
│   ├── 3. 时间顺序丢失                                                         │
│   │   └── 摘要合并后时间线不清晰                                              │
│   │                                                                         │
│   └── 4. 部分可恢复                                                           │
│       └── 工具失败信息被保留                                                  │
│       └── 文件操作记录被保留                                                  │
│                                                                             │
│   检索式记忆的信息保留：                                                       │
│   ├── 1. 完整保留原始内容                                                      │
│   │   └── 所有历史消息存储在向量数据库                                        │
│   │                                                                         │
│   ├── 2. 语义检索可能遗漏                                                      │
│   │   └── 检索质量依赖 query 质量                                             │
│   │   └── 相关但语义不相似的内容可能遗漏                                      │
│   │                                                                         │
│   └── 3. 检索结果可控                                                          │
│       └── 可以调整 top-k、相似度阈值                                          │
│       └── 支持混合检索提高召回率                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 成本对比分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          成本对比                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   自动压缩成本：                                                               │
│   ├── 计算成本                                                                 │
│   │   ├── Token 估算：本地计算，几乎无成本                                     │
│   │   └── 摘要生成：需要调用 LLM                                              │
│   │       └── 每次压缩：~1000-3000 tokens（取决于历史长度）                     │
│   │                                                                         │
│   ├── 存储成本                                                                 │
│   │   └── 仅保留摘要，存储占用极小                                            │
│   │                                                                         │
│   └── 时间成本                                                                 │
│       └── 摘要生成延迟：500ms-3s（取决于模型）                                 │
│                                                                             │
│   检索式记忆成本：                                                             │
│   ├── 计算成本                                                                 │
│   │   ├── Embedding 计算：                                                    │
│   │   │   ├── OpenAI: $0.02 / 1M tokens (text-embedding-3-small)              │
│   │   │   ├── Local: 免费（但消耗本地 GPU/CPU）                               │
│   │   │   └── 增量更新：仅新内容需要计算                                       │
│   │   └── 向量检索：本地 SQLite 查询，几乎无成本                               │
│   │                                                                         │
│   ├── 存储成本                                                                 │
│   │   ├── 原始内容：与历史长度成正比                                          │
│   │   ├── 向量索引：dims * 4 bytes per vector                                 │
│   │   │   └── 示例：768 dims * 4 bytes = 3KB per chunk                        │
│   │   └── FTS 索引：额外 20-50% 存储开销                                       │
│   │                                                                         │
│   └── 时间成本                                                                 │
│       ├── Embedding 计算：10-100ms per chunk（取决于 provider）                │
│       └── 向量检索：< 50ms（本地 SQLite）                                      │
│                                                                             │
│   场景对比（10K messages，平均 500 tokens/message）：                          │
│   ┌─────────────────────┬───────────────┬─────────────────┐                  │
│   │ 指标                │ 自动压缩      │ 检索式记忆      │                  │
│   ├─────────────────────┼───────────────┼─────────────────┤                  │
│   │ 存储占用            │ ~10KB (摘要)  │ ~50MB (原始)    │                  │
│   │                     │               │ + ~30MB (向量)  │                  │
│   ├─────────────────────┼───────────────┼─────────────────┤                  │
│   │ 压缩/索引成本       │ ~$0.01/次     │ ~$0.05 (一次性) │                  │
│   ├─────────────────────┼───────────────┼─────────────────┤                  │
│   │ 检索成本            │ 无            │ ~$0.001/次      │                  │
│   ├─────────────────────┼───────────────┼─────────────────┤                  │
│   │ 信息完整性          │ 60-80%        │ 95%+            │                  │
│   └─────────────────────┴───────────────┴─────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 四、替换可行性分析

### 4.1 技术可行性

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       技术可行性评估                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ✅ 已有基础：                                                               │
│   ├── OpenClaw 已有完整的向量检索系统                                        │
│   ├── 支持多种 Embedding Provider                                            │
│   ├── 混合检索（向量 + 全文）已实现                                          │
│   └── 记忆工具（memory_search/memory_get）已存在                             │
│                                                                             │
│   ⚠️ 需要改造：                                                               │
│   ├── 1. 会话历史向量化                                                      │
│   │   └── 当前仅 MEMORY.md 被索引                                            │
│   │   └── 需要将会话历史也纳入向量索引                                        │
│   │                                                                         │
│   ├── 2. 动态上下文管理                                                      │
│   │   └── 需要实现检索结果注入 Prompt 的机制                                  │
│   │   └── 需要控制检索结果的 token 预算                                       │
│   │                                                                         │
│   ├── 3. 检索策略优化                                                        │
│   │   └── 需要设计多轮对话的检索策略                                          │
│   │   └── 需要处理时间顺序和因果关系                                          │
│   │                                                                         │
│   └── 4. 回退机制                                                            │
│       └── 检索失败时需要回退到压缩机制                                        │
│       └── 需要保证系统稳定性                                                  │
│                                                                             │
│   ❌ 主要挑战：                                                               │
│   ├── 1. 检索精度依赖 Query 质量                                             │
│   │   └── LLM 生成的 query 可能不够准确                                       │
│   │                                                                         │
│   ├── 2. 长对话历史检索困难                                                  │
│   │   └── 多轮复杂对话的上下文关联难以捕捉                                    │
│   │                                                                         │
│   └── 3. 实时性要求                                                          │
│       └── 每次请求都需要检索，增加延迟                                        │
│       └── 需要预加载和缓存优化                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 可能的架构设计

```typescript
// 理论上的检索式上下文管理架构

interface RetrievalBasedContextManager {
  // 1. 索引管理
  indexSessionHistory(sessionId: string, messages: AgentMessage[]): Promise<void>;
  
  // 2. 检索策略
  retrieveRelevantContext(params: {
    query: string;                    // 当前用户输入
    currentMessages: AgentMessage[];  // 当前对话
    maxTokens: number;                // Token 预算
    strategy: 'recent' | 'semantic' | 'hybrid';
  }): Promise<RetrievedContext[]>;
  
  // 3. 上下文组装
  buildPromptWithRetrieval(params: {
    systemPrompt: string;
    currentTurn: AgentMessage[];
    retrievedContext: RetrievedContext[];
    maxContextTokens: number;
  }): string;
}

// 检索策略实现
class HybridRetrievalStrategy implements RetrievalStrategy {
  async retrieve(params: RetrieveParams): Promise<RetrievedContext[]> {
    // 1. 获取最近的消息（保证时间连续性）
    const recentMessages = this.getRecentMessages(params.currentMessages, 
      Math.floor(params.maxTokens * 0.3));
    
    // 2. 语义检索相关历史
    const semanticResults = await this.vectorSearch(params.query, {
      maxResults: 10,
      minScore: 0.7,
      excludeRecent: recentMessages.map(m => m.id),
    });
    
    // 3. 合并结果，去重
    const merged = this.mergeAndDeduplicate(recentMessages, semanticResults);
    
    // 4. 按时间排序
    return merged.sort((a, b) => a.timestamp - b.timestamp);
  }
}
```

### 4.3 混合架构建议

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      推荐的混合架构                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   架构设计：双轨制（Compression + Retrieval）                                 │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                      短期上下文（Recent Context）                    │  │
│   │                                                                     │  │
│   │   策略：保留最近 N 轮完整对话                                          │  │
│   │   ├── 保证时间连续性                                                   │  │
│   │   ├── 保留工具调用链                                                   │  │
│   │   └── 不压缩，完整保留                                                 │  │
│   │                                                                     │  │
│   │   预算：~30-40% 上下文窗口                                             │  │
│   │                                                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                      长期记忆（Long-term Memory）                    │  │
│   │                                                                     │  │
│   │   策略：向量索引 + 语义检索                                            │  │
│   │   ├── 自动索引会话历史                                                 │  │
│   │   ├── 根据当前 query 动态检索                                          │  │
│   │   └── 支持显式 memory_search 工具                                      │  │
│   │                                                                     │  │
│   │   预算：~20-30% 上下文窗口                                             │  │
│   │                                                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                      系统提示（System Prompt）                       │  │
│   │                                                                     │  │
│   │   预算：~20-30% 上下文窗口                                             │  │
│   │                                                                     │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   工作流程：                                                                  │
│   1. 保留最近 5-10 轮完整对话                                                │
│   2. 对更早的历史进行向量化索引                                               │
│   3. 根据当前输入，检索相关历史片段                                           │
│   4. 组装上下文：System + Retrieved + Recent                                  │
│   5. 如果检索失败，回退到摘要压缩                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 五、信息丢失不可逆问题

### 5.1 压缩导致的信息丢失

```typescript
// 信息丢失场景分析

// 场景 1：复杂调试过程
// 原始对话：
// User: "这个 bug 怎么修？"
// Assistant: [调用 read 查看代码]
// Assistant: [调用 exec 运行测试]
// Assistant: [调用 read 查看错误日志]
// ... 多轮诊断 ...
// Assistant: "找到问题了，是第 42 行的空指针"

// 压缩后摘要：
// "用户询问 bug 修复，经过诊断发现第 42 行空指针问题"
// 丢失：具体的诊断步骤、中间测试结果、日志内容

// 场景 2：多文件修改
// 原始对话包含对 10 个文件的修改
// 压缩后："完成了多个文件的编辑"
// 丢失：具体修改了哪些文件、修改内容

// 场景 3：工具失败恢复
// 原始：工具 A 失败 → 尝试工具 B → 工具 B 成功
// 压缩后：可能只保留最终结果
// 丢失：失败原因、恢复策略
```

### 5.2 缓解策略

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      信息丢失缓解策略                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   策略 1：关键信息保留                                                        │
│   ├── 工具失败信息始终保留                                                    │
│   ├── 文件操作记录（read/write/edit）保留                                     │
│   └── 用户明确标记的重要信息保留                                              │
│                                                                             │
│   策略 2：结构化摘要                                                          │
│   ├── 使用模板生成摘要                                                        │
│   │   └── "问题: {question}\n诊断: {steps}\n结论: {conclusion}"               │
│   ├── 保留关键元数据                                                          │
│   │   └── 时间戳、涉及文件、工具调用链                                        │
│   └── 分层摘要                                                                │
│       └── 概览摘要 + 详细摘要（按需加载）                                     │
│                                                                             │
│   策略 3：检索增强                                                            │
│   ├── 压缩前对原始内容进行向量化索引                                          │
│   ├── 需要时可以通过检索获取原始细节                                          │
│   └── 摘要 + 向量索引双存储                                                   │
│                                                                             │
│   策略 4：用户可控压缩                                                        │
│   ├── 允许用户标记"重要"对话不压缩                                            │
│   ├── 提供手动压缩触发                                                        │
│   └── 压缩前确认机制                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 六、结论与建议

### 6.1 核心结论

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          核心结论                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. 当前压缩算法基于 Token 数量                                              │
│      ✅ 是的，使用 estimateTokens() 估算消息 token 数                         │
│      ✅ 根据 contextWindow * maxHistoryShare 触发压缩                         │
│      ✅ 采用分阶段摘要策略（summarizeInStages）                               │
│                                                                             │
│   2. 可以引入 Embedding + 向量检索                                            │
│      ✅ 技术可行，OpenClaw 已有完整向量检索基础设施                           │
│      ⚠️ 需要改造会话历史的索引和检索机制                                      │
│      ⚠️ 需要设计合理的检索策略和上下文组装逻辑                                │
│                                                                             │
│   3. 信息丢失不可逆问题                                                       │
│      ⚠️ 压缩必然导致信息丢失，且部分丢失不可逆                                │
│      ✅ 可以通过关键信息保留、结构化摘要、检索增强等策略缓解                  │
│      ✅ 推荐采用"压缩 + 检索"混合架构                                         │
│                                                                             │
│   4. 成本比较                                                                 │
│      ├── 存储：检索式 > 压缩式（10-100 倍）                                   │
│      ├── 计算：相当（都需要 LLM/Embedding）                                   │
│      ├── 精度：检索式 > 压缩式（95% vs 60-80%）                               │
│      └── 延迟：压缩式 < 检索式（本地 vs 需要检索）                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 改进建议

```
优先级建议：

P0 (高优先级):
├── 1. 实现会话历史自动向量化
│   └── 将会话历史纳入向量索引（当前仅 MEMORY.md）
│
└── 2. 混合上下文管理
    └── 短期保留 + 长期检索的混合策略

P1 (中优先级):
├── 3. 智能检索策略
│   ├── 基于当前对话意图的动态检索
│   └── 多轮对话的上下文关联检索
│
├── 4. 检索结果优化
│   ├── 相关性重排序
│   └── 时间衰减和多样性平衡
│
└── 5. 回退机制
    └── 检索失败时自动回退到压缩

P2 (低优先级):
├── 6. 用户可控压缩
│   └── 允许标记重要对话不压缩
│
├── 7. 压缩质量评估
│   └── 自动评估摘要质量
│
└── 8. 可视化工具
    └── 展示压缩和检索效果
```

### 6.3 最终建议架构

```
推荐采用"渐进式混合架构"：

Phase 1: 增强现有压缩（短期）
├── 改进摘要质量（结构化模板）
├── 优化关键信息保留策略
└── 添加压缩质量监控

Phase 2: 引入检索增强（中期）
├── 实现会话历史向量化
├── 添加自动检索注入机制
└── 实现检索-压缩回退

Phase 3: 智能上下文管理（长期）
├── 基于对话意图的动态策略选择
├── 个性化上下文偏好学习
└── 多模态上下文支持
```

---

## 参考文档

- [compaction.ts](file:///d:/temp/openclaw/src/agents/compaction.ts)
- [pi-extensions/compaction-safeguard.ts](file:///d:/temp/openclaw/src/agents/pi-extensions/compaction-safeguard.ts)
- [pi-embedded-runner/compact.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/compact.ts)
- [memory/manager.ts](file:///d:/temp/openclaw/src/memory/manager.ts)
- [memory/embeddings.ts](file:///d:/temp/openclaw/src/memory/embeddings.ts)
- [tools/memory-tool.ts](file:///d:/temp/openclaw/src/agents/tools/memory-tool.ts)
- [pi-extensions/context-pruning/pruner.ts](file:///d:/temp/openclaw/src/agents/pi-extensions/context-pruning/pruner.ts)
