# 研究文档：OpenClaw Agent Loop 的状态机抽象分析

## 1. 现状：Agent Loop 的实现方式

通过对 `src/agents/pi-embedded-runner/run.ts` 和 `run/attempt.ts` 的深度分析，可以得出以下结论：

### 1.1 隐式流程 vs 显式流转
当前 OpenClaw 的 Agent Loop 主要表现为**隐式流程**。
- 核心逻辑被封装在一个巨大的 `while(true)` 循环中（见 `run.ts` 第 469 行）。
- 内部逻辑通过**过程式代码**处理 Auth Failover、Context Overflow、Compaction 和 LLM 调用。
- **状态分散**：当前的“状态”分散在闭包变量中（如 `overflowCompactionAttempts`, `thinkLevel`, `usageAccumulator`），而非存储在一个集中的状态对象中。

### 1.2 形式化为 FSM（有限状态机）的可能性
虽然目前是过程式的，但其逻辑具备明显的 FSM 特征，可以形式化为以下状态：
1. **INIT**: 环境初始化，加载 Workspace 与 Skills。
2. **RESOLVE_MODEL**: 确定 Provider/Model 并在多个 Auth Profile 间故障切换。
3. **PREPARE_CONTEXT**: 检查 Context Window，必要时触发 Compaction。
4. **LLM_CALL**: 调用 API 并获取流式响应。
5. **TOOL_EXECUTION**: 执行 LLM 请求的工具（此部分通常由 `pi-agent-core` 内部处理，但在 Loop 中表现为等待）。
6. **COMPACTION**: 特殊状态，当发生溢出时进入。
7. **FINISH**: 构造 Payloads 并返回结果。

## 2. 核心课题研究

### 2.1 是否支持中断恢复？
- **有限支持**：当前的 Loop 本身不支持“关机重启后从断点恢复”。
- **会话持久化支持**：由于 `SessionManager` 会实时将消息记录写入 `.jsonl` 文件，且在 `run/attempt.ts` 中有“修剪孤儿消息”和“修复角色顺序”的逻辑（`sanitizeSessionHistory`），因此即使进程崩溃，下次启动时可以通过读取历史记录“模拟”恢复。
- **缺失点**：缺乏“中间运行状态”（如：已经试过了哪些 Auth Profile，当前的 Compaction 重试次数）的持久化。

### 2.2 是否可以 Externalize State（状态外部化）？
- **当前瓶颈**：状态被硬编码在 `runEmbeddedPiAgent` 的异步函数栈中。
- **改进路径**：如果将 Loop 拆分为 `Step` 函数，并将所有计数器和上下文存入一个 `State` 对象（可序列化为 JSON），则可以轻松实现状态外部化。

## 3. 延展问题：类似 LangGraph 的显式图模型改造

### 3.1 改造可行性：**极高且有意义**。
LangGraph 的核心在于 `StateGraph`，将 Loop 转化为节点（Nodes）和边（Edges）。对于 OpenClaw 而言：
- **优点**：
    - **可视化**：复杂的故障切换逻辑和压缩逻辑变得清晰。
    - **钩子增强**：可以在特定的“边”上挂载钩子（例如：当进入 `COMPACTION` 状态时发送通知）。
    - **长程任务**：支持需要人工介入（Human-in-the-loop）的任务暂停与继续。
- **挑战**：
    - **性能开销**：状态的频繁序列化和反序列化。
    - **复杂度**：目前的 `while(true)` 虽然乱，但在简单场景下执行速度极快。

### 3.2 建议的图结构模型
如果改造，建议的图节点如下：
- `Node:Auth` -> 处理鉴权与 Failover。
- `Node:Guard` -> 检查 Context/Token 限制。
- `Node:Agent` -> 执行 LLM 调用。
- `Node:Tools` -> 异步或并行执行工具。
- `Edge:Overflow` -> 指向 `Node:Compact`。
- `Edge:Retry` -> 指向 `Node:Auth`。

## 4. 总结

OpenClaw 目前的 Agent Loop 是一个**基于过程控制的隐式状态机**。

- **现状**：它追求的是单次请求的高效率和极简的本地依赖，通过 `while` 循环和实时文件写入解决了大部分健壮性问题。
- **结论**：它**可以**且**应该**被抽象为状态机，特别是随着 Multi-agent 协作和长时间运行任务的需求增加，显式的图模型（如 LangGraph 风格）将大幅提升其可维护性和中断恢复能力。

---
*文档生成日期：2026-02-18*
*研究范围：src/agents/pi-embedded-runner/run.ts & attempt.ts*
