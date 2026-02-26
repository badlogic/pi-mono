# OpenClaw Token 优化分析与建议

OpenClaw 作为一个生产级的 AI Agent 框架，在 Token 使用和上下文窗口管理方面已经实施了多层级的优化策略。本文将分析其现有的优化机制，并提出进一步的改进建议。

## 1. 现有的优化机制 (Existing Optimizations)

OpenClaw 在上下文管理上采用了“分层防御”的策略，从预防到事后修复，全方位减少 Token 浪费。

### 1.1 自动压缩与摘要 (Auto-Compaction & Summarization)
这是 OpenClaw 最核心的 Token 优化手段。
*   **机制**: `compactEmbeddedPiSessionDirect` (src/agents/pi-embedded-runner/compact.ts)。
*   **触发**: 当上下文接近溢出或达到预设阈值时触发。
*   **逻辑**: 将早期的对话历史发送给 LLM，要求其生成一个紧凑的摘要（Summary），然后用这个摘要替换掉原始的冗长对话。
*   **优势**: 极大释放上下文空间，同时保留关键记忆。

### 1.2 工具结果截断 (Tool Result Truncation)
防止某个工具输出（如 `cat` 一个大文件或 `ls -R`）瞬间撑爆上下文。
*   **机制**: `truncateOversizedToolResultsInSession` (src/agents/pi-embedded-runner/tool-result-truncation.ts)。
*   **阈值**: 单个工具结果的 Token 占用不能超过上下文窗口的 30% (`MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3`)。
*   **实现**: 按照字符数估算（4 chars ≈ 1 token），如果超出则截断中间部分，并追加警告后缀。
*   **智能恢复**: 在发生 Context Overflow 错误后，会自动尝试截断历史中的超大工具结果。

### 1.3 上下文窗口守卫 (Context Window Guard)
在请求发送前进行预检查，防止必然失败的请求。
*   **机制**: `evaluateContextWindowGuard` (src/agents/context-window-guard.ts)。
*   **策略**:
    *   **Warn**: 当 Token 剩余量低于 `CONTEXT_WINDOW_WARN_BELOW_TOKENS` (32k) 时发出警告。
    *   **Block**: 当 Token 剩余量低于 `CONTEXT_WINDOW_HARD_MIN_TOKENS` (16k) 时直接拦截，避免浪费 API 调用。

### 1.4 动态 System Prompt (Minimal Mode)
根据 Agent 的类型和任务，动态调整 System Prompt 的长度。
*   **机制**: `buildAgentSystemPrompt` (src/agents/system-prompt.ts)。
*   **模式**:
    *   `full`: 包含所有说明（默认）。
    *   `minimal`: 用于子代理 (Sub-agents) 和 Cron 任务。省略了 Skills、Memory、User Identity 等非必要部分，显著减少 Base Token 开销。

### 1.5 历史轮次限制 (History Turn Limiting)
*   **机制**: `limitHistoryTurns` (src/agents/pi-embedded-runner/history.ts)。
*   **逻辑**: 强制限制保留的对话轮次（如只保留最近 50 轮），直接丢弃过早的消息。

### 1.6 缓存感知 (Cache Awareness)
*   **机制**: 在 Usage 统计中区分 `cacheRead` 和 `cacheWrite`。
*   **目的**: 虽然不直接减少 Token，但通过监控缓存命中率，帮助开发者优化 Prompt 结构（如将静态指令放在前面）以利用 Provider 的 KV Cache。

## 2. 还可以继续提高的部分 (Areas for Improvement)

尽管现有机制已经很完善，但在极端场景或成本敏感场景下，仍有优化空间。

### 2.1 智能语义修剪 (Semantic Pruning)
*   **现状**: 目前主要依赖按时间顺序截断 (`limitHistoryTurns`) 或整体摘要 (`Compaction`)。
*   **问题**: 可能会误删重要的早期信息，或者保留了近期但无关的闲聊。
*   **建议**:
    *   引入基于 Embedding 的相关性检索。对于早期的消息，不完全摘要，而是将其存入向量数据库。
    *   在构建 Prompt 时，只检索与当前用户 Query 语义相关的历史片段（RAG-like Context Injection）。

### 2.2 结构化数据压缩 (Structured Data Compression)
*   **现状**: JSON 输出（如 API 响应）通常以纯文本形式进入上下文，包含大量冗余的键名和空格。
*   **建议**:
    *   在存入 History 前，将复杂的 JSON 对象转换为更紧凑的格式（如 YAML 或仅保留关键字段的摘要）。
    *   对于表格数据（CSV/Excel），自动转换为 Markdown Table 并限制行数。

### 2.3 差异化 System Prompt (Tiered System Prompts)
*   **现状**: `full` 和 `minimal` 两种模式。
*   **建议**:
    *   引入 **"Micro" 模式**：仅包含工具定义和极简指令，用于极其简单的任务（如“计算 1+1”）。
    *   **动态工具定义**: 如果可用工具很多，System Prompt 中的工具列表会很长。可以尝试根据用户意图，只动态注入可能用到的 Top-K 工具的定义。

### 2.4 激进的思维链清理 (Aggressive Chain-of-Thought Cleanup)
*   **现状**: `<think>` 块通常会保留在历史中（取决于 Provider 和配置）。
*   **建议**:
    *   在多轮对话中，Agent 的历史思考过程往往不再重要，重要的是结果。
    *   策略：在每轮对话结束后，自动从 History 中剥离并丢弃 `<think>` 内容，只保留 `<final>` 或实际回复。这将大幅节省 Input Token。

### 2.5 代码文件引用的智能摘要
*   **现状**: 用户让 Agent 读取文件时，文件内容全量进入上下文。
*   **建议**:
    *   对于大文件，Agent 第一次读取时生成一个“文件地图”（Class/Function 签名列表）。
    *   后续引用该文件时，优先使用“地图”而非全文，除非 Agent 明确要求读取特定行。

## 3. 总结

OpenClaw 目前在 **工程化兜底**（截断、压缩、守卫）方面做得非常好，保证了系统的稳定性。未来的优化方向应更多转向 **语义层面的智能筛选**，从“硬截断”进化为“软感知”，让每一分 Token 都花在刀刃上。
