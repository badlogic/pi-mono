# 研究文档：openclaw 是否支持完整的 Agent Trace Replay？

## 1. 核心研究：思考链与轨迹记录

### 1.1 思考链（Thought Chain）保存
**结论：支持记录，但完整性取决于模型输出。**
*   **存储机制**：OpenClaw 将所有交互记录在 `~/.openclaw/agents/<agentId>/sessions/*.jsonl` 文件中。每个条目是一个 JSON 对象。
*   **记录内容**：
    *   `role: "assistant"` 的消息中包含 `content`。如果使用的是支持原生“思维链”的模型（如 Anthropic Claude 的 `thinking` 块或 OpenAI 的 `reasoning_content`），OpenClaw 会将其捕获并持久化。
    *   **工具调用轨迹**：系统完整记录了 `tool_use`（调用的工具及参数）和 `tool_result`（工具执行后的输出）。这是 Trace Replay 的核心基础。
*   **局限性**：内部非输出型的“思考”如果没被模型封装在响应协议中，则无法捕获。

### 1.2 确定性回放（Deterministic Replay）
**结论：部分支持（数据级回放），而非严谨的“比特级”确定性。**
*   **数据级回放**：由于所有 `tool_result` 都被序列化到了 JSONL 中，开发者可以通过加载 Transcript 来还原当时的上下文状态。
*   **重构确定性**：
    *   **输入确定性**：OpenClaw 记录了 Prompt 的构建逻辑，但模型端的 `temperature`, `seed` 等参数在默认配置中并不总是被硬性锁定，且 LLM 本身具有随机性。
    *   **工具回放**：目前没有发现内置的“Mock Replay Mode”（即：不实际执行 Bash，而是直接从 Transcript 中读取上一次的 `tool_result`）。实现该功能需要拦截 `bash-tools.ts` 的执行。

### 1.3 用于评估（Eval）
**结论：支持通过 Transcript 进行离线评估。**
*   **Transcript 工具**：`src/utils/transcript-tools.ts` 提供了统计工具调用次数、提取调用名称等功能，这直接支持了对 Agent 行为的量化分析。
*   **安全审计**：`src/security/fix.ts` 等文件显示系统对 Transcript 的权限管理非常严格，确保了 Trace 数据在用于 Eval 时的完整性和安全性。

## 2. 深度调研：Eval 框架对接

### 2.1 轨迹格式兼容性
OpenClaw 的 `.jsonl` 格式非常标准（Role/Content/ToolUse 结构），极易转换为以下主流框架格式：
*   **LangSmith / LangChain**：可以通过简单的脚本将 JSONL 映射到 LangSmith 的 Run 结构。
*   **OpenAI Evals**：支持将其作为 `samples` 进行微调或评估。

### 2.2 扩展点建议
若要实现“完美的 Eval 框架对接”，建议在以下方向扩展：
1.  **Replay Provider**：开发一个特殊的 `LLMProvider`，它不向 API 发送请求，而是按顺序读取 JSONL 中的响应。
2.  **Tool Mocks**：在执行 `pnpm test` 时，注入一个 `MockToolExecutor`，它根据 Transcript ID 匹配并返回存储好的结果，从而实现零成本、无副作用的闭环回放。

---

| 维度 | 支持度 | 技术细节 |
| :--- | :--- | :--- |
| **完整思考链** | **高** | 捕获模型输出的所有 content 及工具调用参数。 |
| **确定性回放** | **中** | 具备轨迹数据，但缺乏一键“静默回放”的执行引擎。 |
| **Eval 适配性** | **高** | JSONL 结构清晰，配套有 `transcript-tools` 进行分析。 |

---
*存储路径：_dev_doc_oc/agent_trace_replay_analysis.md*
