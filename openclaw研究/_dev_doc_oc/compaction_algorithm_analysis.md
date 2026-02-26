# OpenClaw 自动压缩算法 (Compaction) 研究文档

## 1. 概述

在长时间的 AI 对话中，上下文窗口（Context Window）的限制是核心挑战。OpenClaw 实现了一套精密的**自动压缩算法 (Compaction)**，旨在在不丢失关键信息的前提下，通过总结（Summarization）和修剪（Pruning）来维持会话的持续性。

核心实现代码位于 `src/agents/compaction.ts` 及其配套的修复逻辑 `src/agents/session-transcript-repair.ts`。

## 2. 核心压缩流程

OpenClaw 的压缩过程分为三个关键阶段：

### 2.1 阶段一：识别与触发
系统会持续监控当前会话的 Token 使用量。当剩余 Token 空间不足时，触发压缩：
- **Token 估算**：使用 `estimateMessagesTokens`。为了安全，估算时会临时剔除 `toolResult.details`（通常包含大量不可信或过长的调试信息），以确保 LLM 面对的是核心逻辑。

### 2.2 阶段二：智能修剪 (Pruning)
在进行 LLM 总结之前，系统会先尝试通过硬性修剪来平衡上下文：
- **预算控制**：根据 `maxHistoryShare`（默认 50%）计算历史记录允许占用的最大 Token 数。
- **分块删除**：将历史消息按 Token 比例分块（`splitMessagesByTokenShare`），优先删除最早的一块。
- **结构修复 (Transcript Repair)**：**这是 OpenClaw 的核心竞争力**。修剪历史可能导致 `tool_use` 被删但对应的 `tool_result` 留下，这会引发 Anthropic 等 API 的报错。
    - `repairToolUseResultPairing` 会自动识别并删除这些孤儿结果。
    - 确保 `assistant` 的工具调用紧跟其结果，维持对话流的合法性。

### 2.3 阶段三：分阶段总结 (Summarization)
对于被修剪掉的旧消息，OpenClaw 会利用 LLM 生成摘要：
- **自适应分块**：如果消息平均很大，算法会自动调低每块的比例（`computeAdaptiveChunkRatio`），避免单次总结请求超限。
- **分阶段处理 (`summarizeInStages`)**：
    1. 将旧消息分成若干小块。
    2. 分别生成每块的局部摘要。
    3. **递归合并**：将多个局部摘要再次合并为一个总摘要，确保不丢失决策、TODO 和约束条件。
- **降级保护**：如果单条消息过大（超过 50% 上下文），算法会跳过总结该条消息，并插入一条占位符，说明此处略去了大量数据。

## 3. 安全与准确性保障

### 3.1 隐私与安全
- **排除详情**：在总结时，明确调用 `stripToolResultDetails`。工具执行的原始长数据（如网页 HTML、大段日志）不会喂给总结模型，只保留核心结果描述。

### 3.2 动态容错 (Safety Margin)
- **20% 缓冲区**：由于 Token 估算算法（如字节计数或简单启发式）可能不准，OpenClaw 在所有计算中引入了 `SAFETY_MARGIN = 1.2`，预防溢出。
- **重试机制**：总结过程使用 `retryAsync`，带有指数退避，确保瞬时 API 错误不中断压缩流程。

## 4. 算法参数速查

| 参数名 | 默认值 | 作用 |
| :--- | :--- | :--- |
| `BASE_CHUNK_RATIO` | 0.4 | 默认总结分块占上下文的比例 |
| `MIN_CHUNK_RATIO` | 0.15 | 最小分块比例（防止分块太碎） |
| `MAX_HISTORY_SHARE` | 0.5 | 历史记录在总上下文中的最大占比 |
| `DEFAULT_PARTS` | 2 | 默认拆分块数 |

## 5. 总结

OpenClaw 的自动压缩算法不仅是简单的“截断”，而是一套**具有语义感知和结构修复能力的工程化方案**。它通过“修剪历史 -> 修复配对 -> 递归总结”的链路，成功解决了长会话下的 API 合规性问题和信息遗忘问题。

---
*文档生成日期：2026-02-18*
*相关源码：src/agents/compaction.ts, src/agents/session-transcript-repair.ts*
