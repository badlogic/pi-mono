# 研究文档：自动压缩算法是否可替换为检索式记忆架构？

## 1. 现状分析：当前的自动压缩机制

通过分析 `src/agents/compaction.ts` 和 `src/agents/context-window-guard.ts`，OpenClaw 当前的架构完全建立在**基于 Token 数量的自动压缩（Auto-Compaction）**之上。

### 1.1 核心逻辑
*   **Token 触发量化**：系统通过 `estimateMessagesTokens` 实时估算当前对话历史。当 Token 总数超过上下文窗口（`contextWindow`）的特定比例（默认为 `maxHistoryShare = 0.5`）时，触发压缩。
*   **阶段性处理**：
    *   **切片 (Chunking)**：使用 `splitMessagesByTokenShare` 将消息分为多个块。
    *   **总结 (Summarization)**：调用 LLM（通过 `generateSummary`）对旧消息块进行总结。
    *   **分阶段压缩 (summarizeInStages)**：如果历史极长，会先总结小块，再将总结后的摘要进行二次合并。
*   **硬截断 (Pruning)**：当总结失败或单条消息过大时，会调用 `pruneHistoryForContextShare` 直接丢弃旧消息，仅保留最近的上下文。

## 2. 检索式记忆（RAG）架构的引入分析

### 2.1 是否可引入 Embedding + 向量检索？
**结论：架构上可行，但需要重构 Context 注入逻辑。**
*   **现有基础**：代码库中已有 `LlamaEmbedding` 的类型定义（`src/types/node-llama-cpp.d.ts`），说明底层具备处理向量的能力。
*   **改动点**：
    1.  **持久化层**：目前消息存储在内存或简单的 JSON 事务日志中。引入检索需要一个向量数据库（如 LanceDB 或简单的本地向量索引）。
    2.  **检索钩子**：在 `src/agents/context.ts` 构建 Prompt 之前，需根据用户当前 Query 进行语义检索（Similarity Search），召回 Top-K 相关片段。
    3.  **压缩触发器转换**：将“达到 50% Token 就总结”改为“达到 50% Token 就将最旧的 20% 消息存入向量库并从当前上下文中移除”。

### 2.2 信息丢失不可逆问题研究
*   **当前算法 (LLM Summary)**：**存在严重的信息丢失风险**。摘要过程是由 LLM 决定的二次创作，它可能漏掉某个特定的代码细节、特殊的配置参数或用户隐含的语气。这种丢失是不可逆的——一旦原始消息被 `prune`，细节就永久消失了。
*   **检索式架构**：**信息不丢失，但存在上下文断裂**。原始消息被完整保存为向量切片，但在召回时，如果 Top-K 片段切分不当，LLM 可能会得到互不相干的信息片段，失去逻辑上的连贯性（Coherence）。

## 3. 延展：压缩 vs 检索式 Memory 的成本比较

| 维度 | 自动压缩 (Current) | 检索式记忆 (Proposed) |
| :--- | :--- | :--- |
| **计算成本** | **高**。每次压缩都要调用 LLM 生成摘要，消耗大量输出 Token。 | **低**。Embedding 计算开销极低，召回不消耗 LLM 费用。 |
| **存储成本** | **低**。仅需存储一段简短的摘要。 | **中**。需要存储所有历史消息的 Embedding 向量（占用硬盘/内存）。 |
| **首词延迟 (TTFT)** | **低**。Context 是预处理好的。 | **中**。发送请求前需增加一次向量检索步骤（10-100ms）。 |
| **Token 效率** | **渐进式恶化**。摘要会随时间增长，且越旧的信息被概括得越模糊。 | **恒定高效**。仅注入与当前问题最相关的 N 个片段，Context 始终保持精简。 |

## 4. 最终建议

对于 OpenClaw 这种偏向工程实现的 Agent，**完全替换并非最优解**，建议采用**混合记忆（Hybrid Memory）**：

1.  **短期记忆 (FIFO)**：保留最近 10-20 条原始消息，不压缩，确保即时逻辑连贯。
2.  **中期记忆 (Summarized)**：对中间部分的对话进行高度概括（维持任务状态）。
3.  **远期记忆 (Vectorized)**：将过期的、已被总结过的原始消息归档到向量库。

---
*存储路径：_dev_doc_oc/compaction_vs_retrieval_analysis.md*
